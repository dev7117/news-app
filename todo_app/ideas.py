"""Ideas: the backlog of not-yet-tasks.

An idea is something worth keeping that isn't ready to be worked: a title, a short summary,
and a notebook of markdown blocks (notebook.py), each a small document for one part of it
(the problem, options, open questions, a rough plan…), fleshed out over time. It can belong to a customer (even before there's a
project for it), a project, or neither, and follows the work / personal focus like tasks.
Ideas never appear on boards, Today, the bar or the inbox. When one is ready it's
*promoted*: a task is created from it (in a project; its notes are the summary plus every
block as a section), the idea is marked promoted and linked to that task. Dropped ideas are kept, not deleted, so nothing is lost.
"""
from __future__ import annotations

from typing import Any

from .notebook import Notebook
from .store import AREAS, Invalid, NotFound, Store, now_iso

IDEA_STATUSES = ("open", "promoted", "dropped")


class Ideas:
    def __init__(self, store: Store, notebook: Notebook | None = None) -> None:
        self.store = store
        self.notebook = notebook or Notebook(store)

    _SELECT = """
        SELECT i.*, p.name AS project, c.name AS customer, t.title AS task_title, t.status AS task_status
        FROM ideas i
        LEFT JOIN projects p ON p.id = i.project_id
        LEFT JOIN customers c ON c.id = i.customer_id
        LEFT JOIN tasks t ON t.id = i.task_id
    """

    def get(self, idea_id: int, with_blocks: bool = False) -> dict[str, Any]:
        row = self.store._row(self._SELECT + " WHERE i.id = ?", (idea_id,))
        if not row:
            raise NotFound(f"No idea with id {idea_id}")
        out = dict(row)
        if with_blocks:
            out["blocks"] = self.blocks(idea_id)
        return out

    def list(
        self,
        *,
        status: str | None = "open",
        area: str | None = None,
        customer_id: int | None = None,
        project_id: int | None = None,
        query: str | None = None,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        where, params = [], []
        if status:
            if status not in IDEA_STATUSES:
                raise Invalid(f"status must be one of {', '.join(IDEA_STATUSES)}")
            where.append("i.status = ?")
            params.append(status)
        if area:
            where.append("i.area = ?")
            params.append(area)
        if customer_id is not None:
            where.append("i.customer_id = ?")
            params.append(customer_id)
        if project_id is not None:
            where.append("i.project_id = ?")
            params.append(project_id)
        if query and query.strip():
            # Every word must appear in the title, summary or a block.
            for word in query.lower().split():
                where.append(
                    "(lower(i.title) LIKE ? OR lower(i.summary) LIKE ? OR EXISTS (SELECT 1 FROM blocks b"
                    " WHERE b.idea_id = i.id AND (lower(b.title) LIKE ? OR lower(b.body) LIKE ?)))"
                )
                params += [f"%{word}%"] * 4
        sql = self._SELECT.replace("FROM ideas i", ", (SELECT COUNT(*) FROM blocks b WHERE b.idea_id = i.id) AS block_count FROM ideas i")
        sql += f" WHERE {' AND '.join(where)}" if where else ""
        sql += " ORDER BY i.updated_at DESC, i.id DESC LIMIT ?"
        return [dict(r) for r in self.store._rows(sql, [*params, limit])]

    def count(self, area: str | None = None) -> int:
        sql = "SELECT COUNT(*) FROM ideas WHERE status = 'open'" + (" AND area = ?" if area else "")
        return self.store._row(sql, (area,) if area else ())[0]

    def _placement(
        self, fields: dict[str, Any], current: dict[str, Any] | None
    ) -> dict[str, Any]:
        """Resolve project / customer / area so they agree: a project fixes the customer and
        area, a customer means work."""
        out: dict[str, Any] = {}
        project = customer = None
        if "project_id" in fields:
            project = self.store.get_project(fields["project_id"]) if fields["project_id"] is not None else None
            out["project_id"] = project["id"] if project else None
        elif current and current["project_id"]:
            project = self.store.get_project(current["project_id"])
        if "customer_id" in fields:
            customer = self.store.get_customer(fields["customer_id"]) if fields["customer_id"] is not None else None
            out["customer_id"] = customer["id"] if customer else None
        if project:
            if customer and project["customer_id"] != customer["id"]:
                raise Invalid(f"Project {project['name']!r} isn't one of {customer['name']}'s projects")
            out["customer_id"] = project["customer_id"]
            out["area"] = project["area"]
        elif customer or (current and current["customer_id"] and "customer_id" not in fields):
            out["area"] = "work"
        area = fields.get("area")
        if area is not None:
            if area not in AREAS:
                raise Invalid(f"area must be one of {', '.join(AREAS)}")
            if "area" in out and out["area"] != area:
                raise Invalid("An idea for a customer or project takes its area from them")
            out["area"] = area
        return out

    def create(
        self,
        title: str,
        *,
        summary: str = "",
        blocks: list[dict[str, Any]] | None = None,
        area: str | None = None,
        customer_id: int | None = None,
        project_id: int | None = None,
        source: str = "app",
    ) -> dict[str, Any]:
        title = (title or "").strip()
        if not title:
            raise Invalid("An idea needs a title")
        fields: dict[str, Any] = {"area": area}
        if customer_id is not None:
            fields["customer_id"] = customer_id
        if project_id is not None:
            fields["project_id"] = project_id
        placed = self._placement({k: v for k, v in fields.items() if v is not None or k != "area"}, None)
        placed.setdefault("area", area or self.store.settings()["default_area"])
        ts = now_iso()
        with self.store.tx() as c:
            cur = c.execute(
                "INSERT INTO ideas (title, summary, area, customer_id, project_id, source, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (title, summary or "", placed["area"], placed.get("customer_id"), placed.get("project_id"),
                 source or "app", ts, ts),
            )
            for block in blocks or []:
                self.add_block(cur.lastrowid, title=block.get("title", ""), body=block.get("body", ""), source=source)
        return self.get(cur.lastrowid, with_blocks=True)

    def update(self, idea_id: int, **fields: Any) -> dict[str, Any]:
        current = self.get(idea_id)
        sets: dict[str, Any] = {}
        if fields.get("title") is not None:
            if not fields["title"].strip():
                raise Invalid("An idea needs a title")
            sets["title"] = fields["title"].strip()
        if fields.get("summary") is not None:
            sets["summary"] = fields["summary"]
        placement = {k: fields[k] for k in ("project_id", "customer_id") if k in fields}
        if fields.get("area") is not None:
            placement["area"] = fields["area"]
        if placement:
            sets.update(self._placement(placement, current))
        if fields.get("status") is not None:
            if fields["status"] not in ("open", "dropped"):
                raise Invalid("Set status to open or dropped; promote an idea to turn it into a task")
            sets["status"] = fields["status"]
            sets["decided_at"] = now_iso() if fields["status"] == "dropped" else None
        if not sets:
            return current
        sets["updated_at"] = now_iso()
        with self.store.tx() as c:
            c.execute(f"UPDATE ideas SET {', '.join(f'{k} = ?' for k in sets)} WHERE id = ?", (*sets.values(), idea_id))
        return self.get(idea_id)

    def delete(self, idea_id: int) -> None:
        self.get(idea_id)
        with self.store.tx() as c:
            c.execute("DELETE FROM ideas WHERE id = ?", (idea_id,))

    def promote(
        self,
        idea_id: int,
        fields: dict[str, Any] | None = None,
        *,
        source: str = "app",
        note_block_ids: list[int] | None = None,
    ) -> dict[str, Any]:
        """Turn an open idea into a task and return it.

        The summary becomes the task's description and each block becomes a subtask (same
        title and markdown body; an untitled block's first line becomes its title), except
        blocks listed in ``note_block_ids``, which are carried over as plain notes.
        """
        idea = self.get(idea_id)
        if idea["status"] != "open":
            raise Invalid(f"That idea is already {idea['status']}")
        blocks = self.blocks(idea_id)
        as_notes = set(note_block_ids or [])
        unknown = as_notes - {b["id"] for b in blocks}
        if unknown:
            raise Invalid(f"Block {sorted(unknown)[0]} isn't part of this idea")
        task_fields: dict[str, Any] = {"title": idea["title"], "notes": idea["summary"], "status": "todo"}
        if idea["project_id"]:
            task_fields["project_id"] = idea["project_id"]
        else:
            task_fields["area"] = idea["area"]
        task_fields.update({k: v for k, v in (fields or {}).items() if v is not None})
        if "project_id" in task_fields:
            task_fields.pop("area", None)
        with self.store.tx() as c:
            task = self.store.create_task(task_fields, source=source, created_note=f"Promoted from idea #{idea_id}")
            for block in blocks:
                title, body = block["title"].strip(), block["body"]
                kind = "note" if block["id"] in as_notes else "subtask"
                if kind == "subtask" and not title and body.strip():
                    first, _, rest = body.strip().partition("\n")
                    title, body = first.lstrip("#-*> ").strip()[:120], rest.strip()
                self.notebook.add("task", task["id"], title=title, body=body, kind=kind, source=source)
            ts = now_iso()
            c.execute(
                "UPDATE ideas SET status = 'promoted', task_id = ?, decided_at = ?, updated_at = ? WHERE id = ?",
                (task["id"], ts, ts, idea_id),
            )
        return task

    # ----- the notebook (blocks live in notebook.py, shared with tasks) -----

    def as_markdown(self, idea_id: int) -> str:
        """Summary, then each block as a section: the idea as one document (task notes on promote)."""
        idea = self.get(idea_id)
        parts = [idea["summary"].strip()] if idea["summary"].strip() else []
        body = self.notebook.as_markdown("idea", idea_id)
        return "\n\n".join(parts + ([body] if body else []))

    def blocks(self, idea_id: int) -> list[dict[str, Any]]:
        return self.notebook.blocks("idea", idea_id)

    def add_block(self, idea_id: int, *, title: str = "", body: str = "", after_id: int | None = None,
                  source: str = "app") -> dict[str, Any]:
        self.get(idea_id)
        return self.notebook.add("idea", idea_id, title=title, body=body, after_id=after_id, source=source)
