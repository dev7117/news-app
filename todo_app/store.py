"""Domain logic: projects, tasks, their update history, search and the bar summary.

Every write goes through here, from the web UI, the MCP server, quick add and the
ingest endpoint alike, so they all record history the same way. A task's history
(``task_updates``) holds what happened to it: who created it (``created``), each
field change (``change``) and free-form progress notes (``note``), each tagged with
the source that did it (``app``, ``intake``, ``mcp``, ``meeting: Acme weekly``,
``jira``...).
"""
from __future__ import annotations

import re
import sqlite3
import threading
from contextlib import contextmanager
from datetime import date, datetime, timezone
from typing import Any, Callable, Iterator

AREAS = ("work", "personal")
STATUSES = ("inbox", "todo", "in_progress", "waiting", "done", "cancelled")
OPEN_STATUSES = ("inbox", "todo", "in_progress", "waiting")
CLOSED_STATUSES = ("done", "cancelled")
STATUS_LABELS = {
    "inbox": "Inbox",
    "todo": "To do",
    "in_progress": "In progress",
    "waiting": "Waiting",
    "done": "Done",
    "cancelled": "Cancelled",
}
PRIORITY_LABELS = {0: "none", 1: "low", 2: "medium", 3: "high"}

# Fields a caller may set on a task. ``today`` is a flag stored as the date it was set
# (today_on), so a task left on today shows how long it has been carried over.
TASK_FIELDS = (
    "title", "notes", "status", "area", "project_id", "priority",
    "due_on", "today", "waiting_on", "external_url",
)

_STOPWORDS = frozenset(
    "a an and are as at be by for from has have in into is it its of on or that the this to "
    "was we will with".split()
)


class NotFound(KeyError):
    def __str__(self) -> str:
        return str(self.args[0]) if self.args else "Not found"


class Invalid(ValueError):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _parse_date(value: Any, field: str) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, date):
        return value.isoformat()
    try:
        return date.fromisoformat(str(value)).isoformat()
    except ValueError as exc:
        raise Invalid(f"{field} must be a date like 2026-10-31, got {value!r}") from exc


class Store:
    def __init__(self, conn: sqlite3.Connection, today: Callable[[], date] = date.today) -> None:
        self.conn = conn
        self.today = today
        self._lock = threading.RLock()

    # ----- plumbing -----

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        """One write transaction. Nested calls join the outer one, so a batch is atomic."""
        with self._lock:
            if self.conn.in_transaction:
                yield self.conn
                return
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                yield self.conn
            except BaseException:
                self.conn.execute("ROLLBACK")
                raise
            self.conn.execute("COMMIT")

    def _rows(self, sql: str, params: Any = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self.conn.execute(sql, params).fetchall()

    def _row(self, sql: str, params: Any = ()) -> sqlite3.Row | None:
        with self._lock:
            return self.conn.execute(sql, params).fetchone()

    # ----- settings -----

    def settings(self) -> dict[str, Any]:
        values = {r["key"]: r["value"] for r in self._rows("SELECT key, value FROM settings")}
        return {
            "default_area": values.get("default_area", "work"),
            # Claude's task changes wait for approval in Review (see review.py).
            "review_claude_changes": values.get("review_claude_changes", "1") == "1",
        }

    def update_settings(
        self, default_area: str | None = None, review_claude_changes: bool | None = None
    ) -> dict[str, Any]:
        with self.tx() as c:
            if review_claude_changes is not None:
                c.execute(
                    "INSERT INTO settings (key, value) VALUES ('review_claude_changes', ?) "
                    "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                    ("1" if review_claude_changes else "0",),
                )
            if default_area is not None:
                if default_area not in AREAS:
                    raise Invalid(f"default_area must be one of {', '.join(AREAS)}")
                c.execute(
                    "INSERT INTO settings (key, value) VALUES ('default_area', ?) "
                    "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                    (default_area,),
                )
        return self.settings()

    # ----- customers -----

    def _customer_dict(self, row: sqlite3.Row) -> dict[str, Any]:
        out = dict(row)
        out["archived"] = bool(out["archived"])
        return out

    def list_customers(self, include_archived: bool = False) -> list[dict[str, Any]]:
        today = self.today().isoformat()
        rows = self._rows(
            f"""
            SELECT c.*,
                   (SELECT COUNT(*) FROM projects p WHERE p.customer_id = c.id AND p.archived = 0) AS project_count,
                   (SELECT MAX(m.held_on) FROM meetings m WHERE m.customer_id = c.id AND m.status = 'held') AS last_meeting_on,
                   (SELECT COUNT(*) FROM meetings m WHERE m.customer_id = c.id AND m.status = 'held') AS meeting_count,
                   COUNT(t.id) FILTER (WHERE t.status IN {OPEN_STATUSES}) AS open_count,
                   COUNT(t.id) FILTER (WHERE t.status = 'in_progress') AS in_progress_count,
                   COUNT(t.id) FILTER (WHERE t.status = 'waiting') AS waiting_count,
                   COUNT(t.id) FILTER (WHERE t.status IN {OPEN_STATUSES} AND t.due_on < ?) AS overdue_count,
                   MAX(t.updated_at) AS last_task_activity
            FROM customers c
            LEFT JOIN projects p ON p.customer_id = c.id
            LEFT JOIN tasks t ON t.project_id = p.id
            WHERE ? OR c.archived = 0
            GROUP BY c.id
            ORDER BY c.archived, lower(c.name)
            """,
            (today, include_archived),
        )
        return [self._customer_dict(r) for r in rows]

    def get_customer(self, customer_id: int) -> dict[str, Any]:
        row = self._row("SELECT * FROM customers WHERE id = ?", (customer_id,))
        if not row:
            raise NotFound(f"No customer with id {customer_id}")
        return self._customer_dict(row)

    def find_customer(self, name: str) -> dict[str, Any] | None:
        row = self._row("SELECT * FROM customers WHERE lower(name) = lower(?)", ((name or "").strip(),))
        return self._customer_dict(row) if row else None

    def resolve_customer(self, ref: int | str | None, create: bool = True) -> dict[str, Any] | None:
        """A customer by id or name. With create, an unknown name becomes a new customer."""
        if ref in (None, ""):
            return None
        if isinstance(ref, int) or (isinstance(ref, str) and ref.isdigit()):
            return self.get_customer(int(ref))
        found = self.find_customer(str(ref))
        if found or not create:
            if not found:
                raise NotFound(f"No customer named {ref!r}")
            return found
        return self.create_customer(str(ref))

    def create_customer(self, name: str, notes: str = "", website: str | None = None) -> dict[str, Any]:
        name = (name or "").strip()
        if not name:
            raise Invalid("Customer name is required")
        if self.find_customer(name):
            raise Invalid(f"A customer named {name!r} already exists")
        ts = now_iso()
        with self.tx() as c:
            cur = c.execute(
                "INSERT INTO customers (name, notes, website, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (name, notes or "", (website or "").strip() or None, ts, ts),
            )
        return self.get_customer(cur.lastrowid)

    def update_customer(self, customer_id: int, **fields: Any) -> dict[str, Any]:
        current = self.get_customer(customer_id)
        sets: dict[str, Any] = {}
        if fields.get("name") is not None:
            name = fields["name"].strip()
            if not name:
                raise Invalid("Customer name is required")
            other = self.find_customer(name)
            if other and other["id"] != customer_id:
                raise Invalid(f"A customer named {name!r} already exists")
            sets["name"] = name
        if fields.get("notes") is not None:
            sets["notes"] = fields["notes"]
        if fields.get("archived") is not None:
            sets["archived"] = int(bool(fields["archived"]))
        if "website" in fields:
            sets["website"] = (fields["website"] or "").strip() or None
        if fields.get("overview") is not None:
            sets["overview"] = fields["overview"]
            sets["overview_source"] = fields.get("overview_source") or "app"
            sets["overview_updated_at"] = now_iso()
        if "logo" in fields:
            sets["logo"] = fields["logo"]
        if not sets:
            return current
        sets["updated_at"] = now_iso()
        with self.tx() as c:
            c.execute(
                f"UPDATE customers SET {', '.join(f'{k} = ?' for k in sets)} WHERE id = ?",
                (*sets.values(), customer_id),
            )
        return self.get_customer(customer_id)

    def delete_customer(self, customer_id: int) -> None:
        """Delete a customer; its projects stay, without a customer."""
        self.get_customer(customer_id)
        with self.tx() as c:
            c.execute("DELETE FROM customers WHERE id = ?", (customer_id,))

    # ----- projects -----

    _PROJECT_SELECT = """
        SELECT p.*, c.name AS customer FROM projects p LEFT JOIN customers c ON c.id = p.customer_id
    """

    def _project_dict(self, row: sqlite3.Row) -> dict[str, Any]:
        out = dict(row)
        out["archived"] = bool(out["archived"])
        return out

    def list_projects(self, include_archived: bool = False) -> list[dict[str, Any]]:
        today = self.today().isoformat()
        rows = self._rows(
            f"""
            SELECT p.*, c.name AS customer,
                   COUNT(t.id) FILTER (WHERE t.status IN {OPEN_STATUSES}) AS open_count,
                   COUNT(t.id) FILTER (WHERE t.status IN {OPEN_STATUSES} AND t.due_on < ?) AS overdue_count,
                   COUNT(t.id) FILTER (WHERE t.status IN {CLOSED_STATUSES}) AS closed_count
            FROM projects p LEFT JOIN tasks t ON t.project_id = p.id
            LEFT JOIN customers c ON c.id = p.customer_id
            WHERE ? OR p.archived = 0
            GROUP BY p.id
            ORDER BY p.archived, p.area DESC, c.name IS NULL, lower(c.name), lower(p.name)
            """,
            (today, include_archived),
        )
        return [self._project_dict(r) for r in rows]

    def get_project(self, project_id: int) -> dict[str, Any]:
        row = self._row(self._PROJECT_SELECT + " WHERE p.id = ?", (project_id,))
        if not row:
            raise NotFound(f"No project with id {project_id}")
        return self._project_dict(row)

    def find_project(self, name: str) -> dict[str, Any] | None:
        """Case-insensitive name match; hyphens/underscores count as spaces (for #tags)."""
        key = re.sub(r"[-_\s]+", " ", name).strip().lower()
        for row in self._rows(self._PROJECT_SELECT):
            if re.sub(r"[-_\s]+", " ", row["name"]).strip().lower() == key:
                return self._project_dict(row)
        return None

    def resolve_project(self, ref: int | str | None) -> dict[str, Any] | None:
        """A project by id or name. None/"" means no project."""
        if ref in (None, ""):
            return None
        if isinstance(ref, int) or (isinstance(ref, str) and ref.isdigit()):
            return self.get_project(int(ref))
        project = self.find_project(str(ref))
        if not project:
            raise NotFound(f"No project named {ref!r}. Create it first or pick an existing one.")
        return project

    def create_project(
        self, name: str, area: str, customer: int | str | None = None, description: str = ""
    ) -> dict[str, Any]:
        """``customer`` is a customer id or name; an unknown name creates the customer."""
        name = (name or "").strip()
        if not name:
            raise Invalid("Project name is required")
        if area not in AREAS:
            raise Invalid(f"area must be one of {', '.join(AREAS)}")
        if self.find_project(name):
            raise Invalid(f"A project named {name!r} already exists")
        ts = now_iso()
        with self.tx() as c:
            client = self.resolve_customer(customer)
            cur = c.execute(
                "INSERT INTO projects (name, area, customer_id, description, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (name, area, client["id"] if client else None, description or "", ts, ts),
            )
        return self.get_project(cur.lastrowid)

    def update_project(self, project_id: int, **fields: Any) -> dict[str, Any]:
        current = self.get_project(project_id)
        sets: dict[str, Any] = {}
        if "name" in fields and fields["name"] is not None:
            name = fields["name"].strip()
            if not name:
                raise Invalid("Project name is required")
            other = self.find_project(name)
            if other and other["id"] != project_id:
                raise Invalid(f"A project named {name!r} already exists")
            sets["name"] = name
        if "area" in fields and fields["area"] is not None:
            if fields["area"] not in AREAS:
                raise Invalid(f"area must be one of {', '.join(AREAS)}")
            sets["area"] = fields["area"]
        if "customer" in fields:
            client = self.resolve_customer(fields["customer"])
            sets["customer_id"] = client["id"] if client else None
        if "description" in fields and fields["description"] is not None:
            sets["description"] = fields["description"]
        if "archived" in fields and fields["archived"] is not None:
            sets["archived"] = int(bool(fields["archived"]))
        if not sets:
            return current
        sets["updated_at"] = now_iso()
        with self.tx() as c:
            c.execute(
                f"UPDATE projects SET {', '.join(f'{k} = ?' for k in sets)} WHERE id = ?",
                (*sets.values(), project_id),
            )
            # A project's tasks live in its area.
            if "area" in sets and sets["area"] != current["area"]:
                c.execute(
                    "UPDATE tasks SET area = ?, updated_at = ? WHERE project_id = ?",
                    (sets["area"], sets["updated_at"], project_id),
                )
        return self.get_project(project_id)

    def delete_project(self, project_id: int) -> None:
        self.get_project(project_id)
        with self.tx() as c:
            c.execute("DELETE FROM projects WHERE id = ?", (project_id,))

    # ----- tasks: reading -----

    _TASK_SELECT = """
        SELECT t.*, p.name AS project, p.customer_id AS customer_id, c.name AS customer
        FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
        LEFT JOIN customers c ON c.id = p.customer_id
    """

    def _task_dict(self, row: sqlite3.Row) -> dict[str, Any]:
        today = self.today().isoformat()
        out = dict(row)
        out["today"] = bool(out["today_on"] and out["today_on"] <= today)
        out["overdue"] = bool(
            out["due_on"] and out["due_on"] < today and out["status"] in OPEN_STATUSES
        )
        return out

    def get_task(self, task_id: int, with_updates: bool = False) -> dict[str, Any]:
        row = self._row(self._TASK_SELECT + " WHERE t.id = ?", (task_id,))
        if not row:
            raise NotFound(f"No task with id {task_id}")
        out = self._task_dict(row)
        if with_updates:
            out["updates"] = self.task_updates(task_id)
        return out

    def task_updates(self, task_id: int) -> list[dict[str, Any]]:
        return [
            dict(r)
            for r in self._rows(
                "SELECT id, kind, body, source, created_at FROM task_updates WHERE task_id = ? ORDER BY id",
                (task_id,),
            )
        ]

    def list_tasks(
        self,
        *,
        status: list[str] | None = None,
        include_closed: bool = False,
        area: str | None = None,
        project_id: int | None = None,
        no_project: bool = False,
        customer_id: int | None = None,
        no_customer: bool = False,
        today: bool | None = None,
        source: str | None = None,
        due_before: str | None = None,
        closed_since: str | None = None,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        where: list[str] = []
        params: list[Any] = []
        if status:
            bad = [s for s in status if s not in STATUSES]
            if bad:
                raise Invalid(f"Unknown status {bad[0]!r}; use one of {', '.join(STATUSES)}")
            where.append(f"t.status IN ({','.join('?' * len(status))})")
            params += status
        elif not include_closed:
            where.append(f"t.status IN {OPEN_STATUSES}")
        if area:
            where.append("t.area = ?")
            params.append(area)
        if project_id is not None:
            where.append("t.project_id = ?")
            params.append(project_id)
        if no_project:
            where.append("t.project_id IS NULL")
        if customer_id is not None:
            where.append("p.customer_id = ?")
            params.append(customer_id)
        if no_customer:
            where.append("p.customer_id IS NULL")
        if today is not None:
            where.append(
                "(t.today_on IS NOT NULL AND t.today_on <= ?)" if today
                else "(t.today_on IS NULL OR t.today_on > ?)"
            )
            params.append(self.today().isoformat())
        if source:
            where.append("t.source = ?")
            params.append(source)
        if due_before:
            where.append("t.due_on IS NOT NULL AND t.due_on <= ?")
            params.append(_parse_date(due_before, "due_before"))
        if closed_since:
            where.append("t.completed_at >= ?")
            params.append(closed_since)
        sql = self._TASK_SELECT
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += """
            ORDER BY
              CASE t.status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'inbox' THEN 2
                            WHEN 'waiting' THEN 3 ELSE 4 END,
              t.completed_at DESC,
              t.priority DESC,
              t.due_on IS NULL, t.due_on,
              t.id DESC
            LIMIT ?
        """
        params.append(limit)
        return [self._task_dict(r) for r in self._rows(sql, params)]

    def today_view(self) -> dict[str, Any]:
        """Today: open tasks flagged for today plus anything in progress, in the user's order,
        and what got finished today."""
        today = self.today().isoformat()
        open_rows = self._rows(
            self._TASK_SELECT
            + f"""
            WHERE t.status IN {OPEN_STATUSES}
              AND ((t.today_on IS NOT NULL AND t.today_on <= ?) OR t.status = 'in_progress')
            ORDER BY t.sort_key, t.priority DESC, t.id
            """,
            (today,),
        )
        done_rows = self._rows(
            self._TASK_SELECT
            + f"""
            WHERE t.status IN {CLOSED_STATUSES} AND t.today_on IS NOT NULL
              AND date(t.completed_at, 'localtime') = ?
            ORDER BY t.completed_at DESC
            """,
            (today,),
        )
        return {
            "date": today,
            "open": [self._task_dict(r) for r in open_rows],
            "done": [self._task_dict(r) for r in done_rows],
        }

    def counts(self) -> dict[str, int]:
        today = self.today().isoformat()
        row = self._row(
            f"""
            SELECT
              COUNT(*) FILTER (WHERE status = 'inbox') AS inbox,
              COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
              COUNT(*) FILTER (WHERE status = 'waiting') AS waiting,
              COUNT(*) FILTER (WHERE status IN {OPEN_STATUSES}
                               AND ((today_on IS NOT NULL AND today_on <= :d) OR status = 'in_progress')) AS today,
              COUNT(*) FILTER (WHERE status IN {OPEN_STATUSES} AND due_on < :d) AS overdue,
              COUNT(*) FILTER (WHERE status IN {OPEN_STATUSES}) AS open,
              (SELECT COUNT(*) FROM changesets WHERE status = 'pending') AS review
            FROM tasks
            """,
            {"d": today},
        )
        return dict(row)

    def bar_state(self) -> dict[str, Any]:
        """Compact summary for the desktop bar widget."""
        view = self.today_view()
        keep = ("id", "title", "status", "area", "project", "priority", "due_on", "overdue", "today")
        return {
            "date": view["date"],
            "counts": {**self.counts(), "done_today": len(view["done"])},
            "tasks": [{k: t[k] for k in keep} for t in view["open"]],
            "updated": int(datetime.now(timezone.utc).timestamp() * 1000),
        }

    def search(
        self,
        query: str,
        *,
        include_closed: bool = True,
        area: str | None = None,
        limit: int = 15,
    ) -> list[dict[str, Any]]:
        """Full-text search over title, notes and history, best match first.

        Every word is optional (OR) and prefix-matched, so "renew SSL cert acme" also finds
        "Acme certificate renewal"; bm25 weights title above notes above history.
        """
        terms = [w for w in re.findall(r"\w+", query.lower()) if w not in _STOPWORDS and len(w) > 1]
        if not terms:
            return []
        expr = " OR ".join(f'"{w}"*' for w in dict.fromkeys(terms))
        where = ["tasks_fts MATCH ?"]
        params: list[Any] = [expr]
        if not include_closed:
            where.append(f"t.status IN {OPEN_STATUSES}")
        if area:
            where.append("t.area = ?")
            params.append(area)
        params.append(limit)
        rows = self._rows(
            f"""
            SELECT t.*, p.name AS project, p.customer_id AS customer_id, c.name AS customer,
                   bm25(tasks_fts, 10.0, 3.0, 1.0) AS rank
            FROM tasks_fts JOIN tasks t ON t.id = tasks_fts.rowid
            LEFT JOIN projects p ON p.id = t.project_id
            LEFT JOIN customers c ON c.id = p.customer_id
            WHERE {' AND '.join(where)}
            ORDER BY rank
            LIMIT ?
            """,
            params,
        )
        out = []
        for r in rows:
            task = self._task_dict(r)
            task["score"] = round(-task.pop("rank"), 3)
            out.append(task)
        return out

    # ----- tasks: writing -----

    def _validate(self, fields: dict[str, Any], current: dict[str, Any] | None) -> dict[str, Any]:
        """Normalize caller fields into column values. Unknown keys are an error."""
        unknown = set(fields) - set(TASK_FIELDS)
        if unknown:
            raise Invalid(f"Unknown task field {sorted(unknown)[0]!r}")
        cols: dict[str, Any] = {}
        if "title" in fields:
            title = (fields["title"] or "").strip()
            if not title:
                raise Invalid("Task title is required")
            cols["title"] = title
        if "notes" in fields:
            cols["notes"] = fields["notes"] or ""
        if "status" in fields and fields["status"] is not None:
            if fields["status"] not in STATUSES:
                raise Invalid(f"status must be one of {', '.join(STATUSES)}")
            cols["status"] = fields["status"]
        if "priority" in fields and fields["priority"] is not None:
            priority = fields["priority"]
            if isinstance(priority, str):
                lookup = {v: k for k, v in PRIORITY_LABELS.items()}
                if priority not in lookup:
                    raise Invalid("priority must be 0-3 or none/low/medium/high")
                priority = lookup[priority]
            if not isinstance(priority, int) or not 0 <= priority <= 3:
                raise Invalid("priority must be 0-3 or none/low/medium/high")
            cols["priority"] = priority
        if "due_on" in fields:
            cols["due_on"] = _parse_date(fields["due_on"], "due_on")
        if "waiting_on" in fields:
            cols["waiting_on"] = (fields["waiting_on"] or "").strip() or None
        if "external_url" in fields:
            cols["external_url"] = (fields["external_url"] or "").strip() or None
        if "today" in fields and fields["today"] is not None:
            if fields["today"]:
                already = current and current["today_on"] and current["today_on"] <= self.today().isoformat()
                if not already:
                    cols["today_on"] = self.today().isoformat()
            else:
                cols["today_on"] = None

        project = None
        if "project_id" in fields:
            project = self.get_project(fields["project_id"]) if fields["project_id"] is not None else None
            cols["project_id"] = project["id"] if project else None
        area = fields.get("area")
        if area is not None and area not in AREAS:
            raise Invalid(f"area must be one of {', '.join(AREAS)}")
        if project is None and current and current["project_id"] and "project_id" not in fields:
            project = self.get_project(current["project_id"])
        if project:
            if area and area != project["area"]:
                raise Invalid(
                    f"Project {project['name']!r} is a {project['area']} project; "
                    f"its tasks can't be {area}"
                )
            area = project["area"]
        if area:
            cols["area"] = area
        return cols

    def _describe(self, old: dict[str, Any], cols: dict[str, Any]) -> str:
        """One line describing what changed, for the history."""
        parts: list[str] = []
        for key, new in cols.items():
            before = old.get(key)
            if key in ("updated_at", "completed_at", "sort_key") or before == new:
                continue
            if key == "status":
                parts.append(f"Status: {STATUS_LABELS[before]} → {STATUS_LABELS[new]}")
            elif key == "today_on":
                parts.append("Added to today" if new else "Removed from today")
            elif key == "priority":
                parts.append(f"Priority: {PRIORITY_LABELS[before]} → {PRIORITY_LABELS[new]}")
            elif key == "due_on":
                parts.append(f"Due: {before or 'none'} → {new or 'none'}")
            elif key == "project_id":
                name = lambda pid: self.get_project(pid)["name"] if pid else "none"  # noqa: E731
                parts.append(f"Project: {name(before)} → {name(new)}")
            elif key == "area":
                if "project_id" not in cols or cols["project_id"] == old.get("project_id"):
                    parts.append(f"Area: {before} → {new}")
            elif key == "title":
                parts.append(f"Renamed from “{before}”")
            elif key == "notes":
                parts.append("Notes edited")
            elif key == "waiting_on":
                parts.append(f"Waiting on: {new}" if new else "No longer waiting on anyone")
            elif key == "external_url":
                parts.append("Link updated")
        return "; ".join(parts)

    def _log(self, task_id: int, kind: str, body: str, source: str, ts: str | None = None) -> None:
        self.conn.execute(
            "INSERT INTO task_updates (task_id, kind, body, source, created_at) VALUES (?, ?, ?, ?, ?)",
            (task_id, kind, body, source or "app", ts or now_iso()),
        )

    def _reindex(self, task_id: int) -> None:
        row = self.conn.execute("SELECT title, notes FROM tasks WHERE id = ?", (task_id,)).fetchone()
        self.conn.execute("DELETE FROM tasks_fts WHERE rowid = ?", (task_id,))
        if not row:
            return
        history = self.conn.execute(
            "SELECT body FROM task_updates WHERE task_id = ? AND kind IN ('note', 'created') "
            "ORDER BY id DESC LIMIT 50",
            (task_id,),
        ).fetchall()
        self.conn.execute(
            "INSERT INTO tasks_fts (rowid, title, notes, updates) VALUES (?, ?, ?, ?)",
            (task_id, row["title"], row["notes"], "\n".join(h["body"] for h in history)),
        )

    def _next_today_key(self) -> float:
        row = self.conn.execute(
            "SELECT MAX(sort_key) FROM tasks WHERE today_on IS NOT NULL OR status = 'in_progress'"
        ).fetchone()
        return (row[0] or 0) + 1

    def create_task(
        self,
        fields: dict[str, Any],
        *,
        source: str = "app",
        external_id: str | None = None,
        created_note: str = "",
    ) -> dict[str, Any]:
        """Create a task. ``created_note`` goes in the history (e.g. why/where it came from)."""
        fields = {k: v for k, v in fields.items() if v is not None or k == "project_id"}
        if "title" not in fields:
            raise Invalid("Task title is required")
        cols = self._validate(fields, None)
        cols.setdefault("area", self.settings()["default_area"])
        cols.setdefault("status", "todo")
        ts = now_iso()
        with self.tx() as c:
            if cols.get("today_on") or cols["status"] == "in_progress":
                cols["sort_key"] = self._next_today_key()
            if cols["status"] in CLOSED_STATUSES:
                cols["completed_at"] = ts
            cols.update(source=source or "app", external_id=external_id, created_at=ts, updated_at=ts)
            cur = c.execute(
                f"INSERT INTO tasks ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                tuple(cols.values()),
            )
            task_id = cur.lastrowid
            self._log(task_id, "created", created_note, source, ts)
            self._reindex(task_id)
        return self.get_task(task_id)

    def update_task(
        self, task_id: int, fields: dict[str, Any], *, source: str = "app", note: str | None = None
    ) -> dict[str, Any]:
        """Change fields (only the keys given). ``note`` is logged as a separate progress note."""
        with self.tx():
            old = self.get_task(task_id)
            cols = self._validate(fields, old)
            cols = {k: v for k, v in cols.items() if old.get(k) != v}
            if cols:
                ts = now_iso()
                if "status" in cols:
                    if cols["status"] in CLOSED_STATUSES and old["status"] not in CLOSED_STATUSES:
                        cols["completed_at"] = ts
                    elif cols["status"] not in CLOSED_STATUSES:
                        cols["completed_at"] = None
                joins_today = cols.get("today_on") or (
                    cols.get("status") == "in_progress" and not old["today"]
                )
                if joins_today:
                    cols["sort_key"] = self._next_today_key()
                description = self._describe(old, cols)
                cols["updated_at"] = ts
                self.conn.execute(
                    f"UPDATE tasks SET {', '.join(f'{k} = ?' for k in cols)} WHERE id = ?",
                    (*cols.values(), task_id),
                )
                if description:
                    self._log(task_id, "change", description, source, ts)
            if note and note.strip():
                self._add_note(task_id, note.strip(), source)
            if cols or note:
                self._reindex(task_id)
        return self.get_task(task_id)

    def _add_note(self, task_id: int, body: str, source: str) -> None:
        ts = now_iso()
        self._log(task_id, "note", body, source, ts)
        self.conn.execute("UPDATE tasks SET updated_at = ? WHERE id = ?", (ts, task_id))

    def add_update(
        self, task_id: int, body: str, *, source: str = "app", status: str | None = None
    ) -> dict[str, Any]:
        """Log a progress note on a task, optionally moving its status in the same step."""
        if not (body or "").strip():
            raise Invalid("Update text is required")
        with self.tx():
            fields = {"status": status} if status else {}
            return self.update_task(task_id, fields, source=source, note=body)

    def delete_task(self, task_id: int) -> None:
        self.get_task(task_id)
        with self.tx() as c:
            c.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
            c.execute("DELETE FROM tasks_fts WHERE rowid = ?", (task_id,))

    def reorder_today(self, task_ids: list[int]) -> None:
        with self.tx() as c:
            for index, task_id in enumerate(task_ids):
                c.execute("UPDATE tasks SET sort_key = ? WHERE id = ?", (index, task_id))

    def upsert_external(
        self, source: str, external_id: str, fields: dict[str, Any], *, note: str | None = None
    ) -> tuple[dict[str, Any], bool]:
        """Create or update the task a sync script owns, keyed by (source, external_id).

        On update only the fields passed change, so triage done in the app (project, today,
        priority) survives the next sync unless the script sends those fields too. Status is
        special: a closed status (done/cancelled) always applies, but an open one only reopens
        a closed task, so a script that sends "todo" every run never undoes "in progress".
        Returns (task, created).
        """
        if not source or not external_id:
            raise Invalid("source and external_id are required")
        with self.tx():
            row = self.conn.execute(
                "SELECT id, status FROM tasks WHERE source = ? AND external_id = ?", (source, external_id)
            ).fetchone()
            if row:
                status = fields.get("status")
                if status in OPEN_STATUSES and row["status"] in OPEN_STATUSES:
                    fields = {k: v for k, v in fields.items() if k != "status"}
                return self.update_task(row["id"], fields, source=source, note=note), False
            fields = {"status": "inbox", **fields}
            task = self.create_task(fields, source=source, external_id=external_id, created_note=note or "")
            return task, True
