"""Customer hub: meetings (and the tasks they produced), topics, links, desktop launchers, logos.

Built on Store (same connection and transactions). Claude fills most of it over MCP:
log_meeting writes a recap and bumps the topics it touched, propose_changes(meeting_id=…)
links the resulting tasks back to the meeting, set_customer_overview keeps "where things
stand" current.
"""
from __future__ import annotations

import hashlib
import re
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from .store import CLOSED_STATUSES, OPEN_STATUSES, Invalid, NotFound, Store, _parse_date, now_iso

TOPIC_STATUSES = ("active", "watching", "resolved")
LINK_KINDS = ("link", "launcher")
LAUNCH_MODES = ("terminal", "background")
LOGO_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg", "image/webp": "webp",
              "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico", "image/gif": "gif"}
MAX_LOGO_BYTES = 2_000_000


class Hub:
    def __init__(self, store: Store, data_dir: Path) -> None:
        self.store = store
        self.logo_dir = data_dir / "logos"

    @property
    def conn(self):
        return self.store.conn

    # ----- the hub page -----

    def customer_hub(self, customer_id: int) -> dict[str, Any]:
        s = self.store
        customer = next((c for c in s.list_customers(include_archived=True) if c["id"] == customer_id), None)
        if not customer:
            raise NotFound(f"No customer with id {customer_id}")
        today = s.today().isoformat()
        open_tasks = s.list_tasks(customer_id=customer_id, limit=1000)
        # What needs attention: in progress, overdue, due within a week, on today, waiting.
        soon = (s.today().toordinal() + 7)
        next_up = [
            t for t in open_tasks
            if t["status"] in ("in_progress", "waiting") or t["today"] or t["overdue"]
            or (t["due_on"] and _ordinal(t["due_on"]) <= soon)
        ]
        return {
            "customer": customer,
            "projects": [p for p in s.list_projects(include_archived=True) if p["customer_id"] == customer_id],
            "topics": self.list_topics(customer_id),
            "upcoming": self.upcoming_meetings(customer_id=customer_id, days=14),
            "meetings": self.list_meetings(customer_id, limit=5),
            "links": self.list_links(customer_id),
            "next_up": next_up[:12],
            "recently_closed": s.list_tasks(
                customer_id=customer_id, status=list(CLOSED_STATUSES), limit=8
            ),
            "today": today,
        }

    # ----- meetings -----

    def _meeting_dict(self, row) -> dict[str, Any]:
        return dict(row)

    _MEETING_SELECT = """
        SELECT m.*, p.name AS project, c.name AS customer,
               (SELECT COUNT(*) FROM meeting_tasks mt WHERE mt.meeting_id = m.id) AS task_count,
               (SELECT o.id FROM cadence_occurrences o WHERE o.meeting_id = m.id) AS occurrence_id
        FROM meetings m JOIN customers c ON c.id = m.customer_id
        LEFT JOIN projects p ON p.id = m.project_id
    """

    def list_meetings(self, customer_id: int | None = None, limit: int = 50) -> list[dict[str, Any]]:
        """Recaps (held meetings), newest first."""
        where, params = ["m.status = 'held'"], []
        if customer_id:
            where.append("m.customer_id = ?")
            params.append(customer_id)
        rows = self.store._rows(
            self._MEETING_SELECT + f" WHERE {' AND '.join(where)} ORDER BY m.held_on DESC, m.starts_at DESC, m.id DESC"
            " LIMIT ?",
            [*params, limit],
        )
        return [self._meeting_dict(r) for r in rows]

    def upcoming_meetings(self, *, customer_id: int | None = None, days: int = 7) -> list[dict[str, Any]]:
        """Scheduled meetings from today through the next ``days`` days, soonest first."""
        today = self.store.today()
        until = today.fromordinal(today.toordinal() + days).isoformat()
        where, params = ["m.status = 'scheduled'", "m.held_on >= ?", "m.held_on <= ?"], [today.isoformat(), until]
        if customer_id:
            where.append("m.customer_id = ?")
            params.append(customer_id)
        rows = self.store._rows(
            self._MEETING_SELECT + f" WHERE {' AND '.join(where)} ORDER BY m.held_on, m.starts_at, m.id", params
        )
        return [self._meeting_dict(r) for r in rows]

    def meetings_between(self, start: str, end: str, *, customer_id: int | None = None) -> list[dict[str, Any]]:
        """Scheduled and held meetings from ``start`` to ``end`` (dates, inclusive), for the
        week calendar; cancelled ones are left out."""
        where = ["m.status <> 'cancelled'", "m.held_on >= ?", "m.held_on <= ?"]
        params: list[Any] = [_parse_date(start, "start"), _parse_date(end, "end")]
        if customer_id:
            where.append("m.customer_id = ?")
            params.append(customer_id)
        rows = self.store._rows(
            self._MEETING_SELECT + f" WHERE {' AND '.join(where)} ORDER BY m.held_on, m.starts_at, m.id", params
        )
        return [self._meeting_dict(r) for r in rows]

    def sync_calendar(
        self, events: list[dict[str, Any]], *, window_start: str, window_end: str
    ) -> dict[str, list[int]]:
        """Mirror calendar events into scheduled meetings, keyed by calendar_id.

        Each event: calendar_id, customer_id, title, starts_at (ISO datetime with offset),
        optional ends_at / attendees / location. Scheduled meetings in [window_start,
        window_end] whose event is gone are marked cancelled (their prep is kept). Meetings
        already held are never changed back.
        """
        start = _parse_date(window_start, "window_start")
        end = _parse_date(window_end, "window_end")
        created, updated, cancelled = [], [], []
        ts = now_iso()
        with self.store.tx() as c:
            seen = set()
            for event in events:
                cal_id = (event.get("calendar_id") or "").strip()
                if not cal_id:
                    raise Invalid("Every event needs its calendar_id")
                seen.add(cal_id)
                self.store.get_customer(event["customer_id"])
                starts = _iso_datetime(event.get("starts_at"), "starts_at")
                ends = _iso_datetime(event.get("ends_at"), "ends_at") if event.get("ends_at") else None
                fields = {
                    "customer_id": event["customer_id"],
                    "title": (event.get("title") or "").strip() or "Meeting",
                    "starts_at": starts,
                    "ends_at": ends,
                    "held_on": _local_date(starts),
                    "attendees": event.get("attendees") or "",
                    "location": (event.get("location") or "").strip() or None,
                }
                row = c.execute("SELECT id, status FROM meetings WHERE calendar_id = ?", (cal_id,)).fetchone()
                if row:
                    if row["status"] == "held":
                        continue
                    fields.update(status="scheduled", updated_at=ts)
                    c.execute(
                        f"UPDATE meetings SET {', '.join(f'{k} = ?' for k in fields)} WHERE id = ?",
                        (*fields.values(), row["id"]),
                    )
                    updated.append(row["id"])
                else:
                    fields.update(status="scheduled", calendar_id=cal_id, source="calendar", created_at=ts, updated_at=ts)
                    cur = c.execute(
                        f"INSERT INTO meetings ({', '.join(fields)}) VALUES ({', '.join('?' * len(fields))})",
                        tuple(fields.values()),
                    )
                    created.append(cur.lastrowid)
            for row in c.execute(
                "SELECT id, calendar_id FROM meetings WHERE status = 'scheduled' AND calendar_id IS NOT NULL"
                " AND held_on >= ? AND held_on <= ?",
                (start, end),
            ).fetchall():
                if row["calendar_id"] not in seen:
                    c.execute("UPDATE meetings SET status = 'cancelled', updated_at = ? WHERE id = ?", (ts, row["id"]))
                    cancelled.append(row["id"])
        return {"created": created, "updated": updated, "cancelled": cancelled}

    def find_meeting_by_calendar_id(self, calendar_id: str) -> dict[str, Any] | None:
        row = self.store._row("SELECT id FROM meetings WHERE calendar_id = ?", (calendar_id,))
        return self.get_meeting(row["id"]) if row else None

    def get_meeting(self, meeting_id: int) -> dict[str, Any]:
        row = self.store._row(self._MEETING_SELECT + " WHERE m.id = ?", (meeting_id,))
        if not row:
            raise NotFound(f"No meeting with id {meeting_id}")
        out = self._meeting_dict(row)
        links = self.store._rows(
            "SELECT task_id, action FROM meeting_tasks WHERE meeting_id = ? ORDER BY rowid", (meeting_id,)
        )
        out["tasks"] = [{**self.store.get_task(r["task_id"]), "action": r["action"]} for r in links]
        return out

    def create_meeting(
        self,
        customer_id: int,
        *,
        title: str,
        held_on: str,
        attendees: str = "",
        summary: str = "",
        decisions: str = "",
        project_id: int | None = None,
        external_url: str | None = None,
        source: str = "app",
        status: str = "held",
        starts_at: str | None = None,
    ) -> dict[str, Any]:
        self.store.get_customer(customer_id)
        if status not in ("scheduled", "held"):
            raise Invalid("status must be scheduled or held")
        title = (title or "").strip()
        if not title:
            raise Invalid("Meeting title is required")
        held = _parse_date(held_on, "held_on")
        if not held:
            raise Invalid("held_on (the meeting date) is required")
        if project_id is not None:
            project = self.store.get_project(project_id)
            if project["customer_id"] != customer_id:
                raise Invalid(f"Project {project['name']!r} isn't one of this customer's projects")
        ts = now_iso()
        with self.store.tx() as c:
            cur = c.execute(
                "INSERT INTO meetings (customer_id, project_id, status, title, held_on, starts_at, attendees, summary,"
                " decisions, external_url, source, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (customer_id, project_id, status, title, held,
                 _iso_datetime(starts_at, "starts_at") if starts_at else None, attendees or "", summary or "",
                 decisions or "", (external_url or "").strip() or None, source or "app", ts, ts),
            )
        return self.get_meeting(cur.lastrowid)

    def update_meeting(self, meeting_id: int, **fields: Any) -> dict[str, Any]:
        current = self.get_meeting(meeting_id)
        sets: dict[str, Any] = {}
        for key in ("title", "attendees", "summary", "decisions", "prep"):
            if fields.get(key) is not None:
                sets[key] = fields[key]
        if "title" in sets and not sets["title"].strip():
            raise Invalid("Meeting title is required")
        if fields.get("held_on") is not None:
            sets["held_on"] = _parse_date(fields["held_on"], "held_on")
        if "external_url" in fields:
            sets["external_url"] = (fields["external_url"] or "").strip() or None
        if fields.get("status") is not None:
            if fields["status"] not in ("scheduled", "held", "cancelled"):
                raise Invalid("status must be scheduled, held or cancelled")
            sets["status"] = fields["status"]
        if "project_id" in fields:
            if fields["project_id"] is not None:
                project = self.store.get_project(fields["project_id"])
                if project["customer_id"] != current["customer_id"]:
                    raise Invalid(f"Project {project['name']!r} isn't one of this customer's projects")
            sets["project_id"] = fields["project_id"]
        if not sets:
            return current
        sets["updated_at"] = now_iso()
        with self.store.tx() as c:
            c.execute(
                f"UPDATE meetings SET {', '.join(f'{k} = ?' for k in sets)} WHERE id = ?",
                (*sets.values(), meeting_id),
            )
        return self.get_meeting(meeting_id)

    def delete_meeting(self, meeting_id: int) -> None:
        self.get_meeting(meeting_id)
        with self.store.tx() as c:
            c.execute("DELETE FROM meetings WHERE id = ?", (meeting_id,))

    def link_task(self, meeting_id: int, task_id: int, action: str) -> None:
        """Record that a meeting created/updated/completed a task. The first action wins."""
        with self.store.tx() as c:
            c.execute(
                "INSERT OR IGNORE INTO meeting_tasks (meeting_id, task_id, action) VALUES (?, ?, ?)",
                (meeting_id, task_id, action),
            )

    def meeting_source(self, meeting: dict[str, Any]) -> str:
        return f"meeting: {meeting['title']} {meeting['held_on']}"

    def meetings_for_task(self, task_id: int) -> list[dict[str, Any]]:
        rows = self.store._rows(
            "SELECT m.id, m.title, m.held_on, mt.action FROM meeting_tasks mt JOIN meetings m ON m.id = mt.meeting_id"
            " WHERE mt.task_id = ? ORDER BY m.held_on DESC",
            (task_id,),
        )
        return [dict(r) for r in rows]

    # ----- topics -----

    def list_topics(self, customer_id: int, include_resolved: bool = True) -> list[dict[str, Any]]:
        rows = self.store._rows(
            "SELECT * FROM customer_topics WHERE customer_id = ? AND (? OR status <> 'resolved')"
            " ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'watching' THEN 1 ELSE 2 END,"
            " last_mentioned_on DESC, lower(name)",
            (customer_id, include_resolved),
        )
        return [dict(r) for r in rows]

    def upsert_topics(
        self, customer_id: int, topics: list[dict[str, Any]], *, mentioned_on: str | None = None
    ) -> list[dict[str, Any]]:
        """Create or update topics by name (case-insensitive). Each given topic counts as a mention."""
        self.store.get_customer(customer_id)
        mentioned = _parse_date(mentioned_on, "mentioned_on") or self.store.today().isoformat()
        ts = now_iso()
        with self.store.tx() as c:
            for topic in topics:
                name = (topic.get("name") or "").strip()
                if not name:
                    raise Invalid("Every topic needs a name")
                status = topic.get("status")
                if status is not None and status not in TOPIC_STATUSES:
                    raise Invalid(f"Topic status must be one of {', '.join(TOPIC_STATUSES)}")
                row = c.execute(
                    "SELECT * FROM customer_topics WHERE customer_id = ? AND lower(name) = lower(?)",
                    (customer_id, name),
                ).fetchone()
                if row:
                    last = max(filter(None, [row["last_mentioned_on"], mentioned]))
                    c.execute(
                        "UPDATE customer_topics SET summary = ?, status = ?, mentions = mentions + 1,"
                        " last_mentioned_on = ?, updated_at = ? WHERE id = ?",
                        (topic.get("summary") if topic.get("summary") is not None else row["summary"],
                         status or row["status"], last, ts, row["id"]),
                    )
                else:
                    c.execute(
                        "INSERT INTO customer_topics (customer_id, name, summary, status, last_mentioned_on,"
                        " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (customer_id, name, topic.get("summary") or "", status or "active", mentioned, ts, ts),
                    )
        return self.list_topics(customer_id)

    def update_topic(self, topic_id: int, **fields: Any) -> dict[str, Any]:
        row = self.store._row("SELECT * FROM customer_topics WHERE id = ?", (topic_id,))
        if not row:
            raise NotFound(f"No topic with id {topic_id}")
        sets = {k: fields[k] for k in ("name", "summary", "status") if fields.get(k) is not None}
        if sets.get("status") and sets["status"] not in TOPIC_STATUSES:
            raise Invalid(f"Topic status must be one of {', '.join(TOPIC_STATUSES)}")
        if sets:
            sets["updated_at"] = now_iso()
            with self.store.tx() as c:
                c.execute(
                    f"UPDATE customer_topics SET {', '.join(f'{k} = ?' for k in sets)} WHERE id = ?",
                    (*sets.values(), topic_id),
                )
        return dict(self.store._row("SELECT * FROM customer_topics WHERE id = ?", (topic_id,)))

    def delete_topic(self, topic_id: int) -> None:
        with self.store.tx() as c:
            c.execute("DELETE FROM customer_topics WHERE id = ?", (topic_id,))

    # ----- links and launchers -----

    def list_links(self, customer_id: int) -> list[dict[str, Any]]:
        rows = self.store._rows(
            "SELECT * FROM customer_links WHERE customer_id = ? ORDER BY kind, sort_key, id", (customer_id,)
        )
        return [dict(r) for r in rows]

    def get_link(self, link_id: int) -> dict[str, Any]:
        row = self.store._row(
            "SELECT l.*, c.name AS customer FROM customer_links l JOIN customers c ON c.id = l.customer_id"
            " WHERE l.id = ?",
            (link_id,),
        )
        if not row:
            raise NotFound(f"No link with id {link_id}")
        return dict(row)

    def _link_fields(self, kind: str, fields: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if "label" in fields and fields["label"] is not None:
            if not fields["label"].strip():
                raise Invalid("A label is required")
            out["label"] = fields["label"].strip()
        if "url" in fields:
            url = (fields["url"] or "").strip() or None
            if url and not re.match(r"^[a-z][a-z0-9+.-]*://", url, re.I):
                url = "https://" + url
            out["url"] = url
        if "command" in fields:
            out["command"] = (fields["command"] or "").strip() or None
        if "cwd" in fields:
            out["cwd"] = (fields["cwd"] or "").strip() or None
        if "agent" in fields:
            out["agent"] = (fields["agent"] or "").strip() or None
        if fields.get("mode") is not None:
            if fields["mode"] not in LAUNCH_MODES:
                raise Invalid(f"mode must be one of {', '.join(LAUNCH_MODES)}")
            out["mode"] = fields["mode"]
        return out

    def create_link(self, customer_id: int, kind: str, **fields: Any) -> dict[str, Any]:
        self.store.get_customer(customer_id)
        if kind not in LINK_KINDS:
            raise Invalid(f"kind must be one of {', '.join(LINK_KINDS)}")
        cols = self._link_fields(kind, {"label": fields.get("label") or "", **fields})
        if kind == "link" and not cols.get("url"):
            raise Invalid("A link needs a URL")
        if kind == "launcher" and not cols.get("command"):
            raise Invalid("A launcher needs a command")
        ts = now_iso()
        with self.store.tx() as c:
            key = c.execute(
                "SELECT COALESCE(MAX(sort_key), 0) + 1 FROM customer_links WHERE customer_id = ?", (customer_id,)
            ).fetchone()[0]
            cols.update(customer_id=customer_id, kind=kind, sort_key=key, created_at=ts, updated_at=ts)
            cur = c.execute(
                f"INSERT INTO customer_links ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                tuple(cols.values()),
            )
        return self.get_link(cur.lastrowid)

    def update_link(self, link_id: int, **fields: Any) -> dict[str, Any]:
        link = self.get_link(link_id)
        cols = self._link_fields(link["kind"], fields)
        if link["kind"] == "link" and "url" in cols and not cols["url"]:
            raise Invalid("A link needs a URL")
        if link["kind"] == "launcher" and "command" in cols and not cols["command"]:
            raise Invalid("A launcher needs a command")
        if cols:
            cols["updated_at"] = now_iso()
            with self.store.tx() as c:
                c.execute(
                    f"UPDATE customer_links SET {', '.join(f'{k} = ?' for k in cols)} WHERE id = ?",
                    (*cols.values(), link_id),
                )
        return self.get_link(link_id)

    def delete_link(self, link_id: int) -> None:
        self.get_link(link_id)
        with self.store.tx() as c:
            c.execute("DELETE FROM customer_links WHERE id = ?", (link_id,))

    def reorder_links(self, ids: list[int]) -> None:
        with self.store.tx() as c:
            for index, link_id in enumerate(ids):
                c.execute("UPDATE customer_links SET sort_key = ? WHERE id = ?", (index, link_id))

    def launcher(self, link_id: int) -> dict[str, Any]:
        """What the desktop handler needs to run a launcher, plus a fingerprint of the command
        so the handler can ask again whenever it changes."""
        link = self.get_link(link_id)
        if link["kind"] != "launcher":
            raise Invalid("That link isn't a launcher")
        fingerprint = hashlib.sha256(f"{link['command']}\0{link['cwd'] or ''}".encode()).hexdigest()
        return {
            "id": link["id"],
            "label": link["label"],
            "command": link["command"],
            "cwd": link["cwd"],
            "mode": link["mode"],
            "customer_id": link["customer_id"],
            "customer": link["customer"],
            "fingerprint": fingerprint,
        }

    # ----- logos -----

    def logo_file(self, customer_id: int) -> Path | None:
        name = self.store.get_customer(customer_id).get("logo")
        path = self.logo_dir / name if name else None
        return path if path and path.is_file() else None

    def set_logo(self, customer_id: int, data: bytes, content_type: str) -> dict[str, Any]:
        self.store.get_customer(customer_id)
        ext = LOGO_TYPES.get(content_type.split(";")[0].strip().lower())
        if not ext:
            raise Invalid("Logo must be a PNG, JPEG, SVG, WebP, GIF or ICO image")
        if not data or len(data) > MAX_LOGO_BYTES:
            raise Invalid("Logo must be under 2 MB")
        self.logo_dir.mkdir(parents=True, exist_ok=True)
        name = f"{customer_id}-{hashlib.sha256(data).hexdigest()[:12]}.{ext}"
        (self.logo_dir / name).write_bytes(data)
        old = self.logo_file(customer_id)
        customer = self.store.update_customer(customer_id, logo=name)
        if old and old.name != name:
            old.unlink(missing_ok=True)
        return customer

    def clear_logo(self, customer_id: int) -> dict[str, Any]:
        old = self.logo_file(customer_id)
        customer = self.store.update_customer(customer_id, logo=None)
        if old:
            old.unlink(missing_ok=True)
        return customer

    def fetch_logo(self, customer_id: int) -> dict[str, Any]:
        """Pull the customer's icon from their website: the page's declared icons (largest
        first), then /apple-touch-icon.png, then /favicon.ico."""
        website = self.store.get_customer(customer_id).get("website")
        if not website:
            raise Invalid("Set the customer's website first")
        base = website if "://" in website else f"https://{website}"
        candidates: list[str] = []
        try:
            html = _http_get(base, accept="text/html")[0].decode("utf-8", "replace")
            candidates += _icon_links(html, base)
        except Exception:  # noqa: BLE001 - fall through to the conventional paths
            pass
        root = "{0.scheme}://{0.netloc}".format(urllib.parse.urlsplit(base))
        candidates += [f"{root}/apple-touch-icon.png", f"{root}/favicon.ico"]
        for url in dict.fromkeys(candidates):
            try:
                data, content_type = _http_get(url, accept="image/*")
            except Exception:  # noqa: BLE001
                continue
            if content_type.split(";")[0].strip().lower() in LOGO_TYPES and 0 < len(data) <= MAX_LOGO_BYTES:
                return self.set_logo(customer_id, data, content_type)
        raise Invalid(f"Couldn't find an icon on {base}")


def _iso_datetime(value: Any, field: str) -> str:
    from datetime import datetime

    try:
        return datetime.fromisoformat(str(value)).isoformat(timespec="minutes")
    except (TypeError, ValueError) as exc:
        raise Invalid(f"{field} must be an ISO date-time like 2026-10-06T14:00:00-04:00, got {value!r}") from exc


def _local_date(iso_datetime: str) -> str:
    """The calendar day an event falls on here (TZ), whatever offset the calendar used."""
    from datetime import datetime

    moment = datetime.fromisoformat(iso_datetime)
    return (moment.astimezone() if moment.tzinfo else moment).date().isoformat()


def _ordinal(iso: str) -> int:
    from datetime import date

    return date.fromisoformat(iso).toordinal()


def _http_get(url: str, accept: str) -> tuple[bytes, str]:
    request = urllib.request.Request(url, headers={"User-Agent": "todo-hub/1.0", "Accept": accept})
    with urllib.request.urlopen(request, timeout=8) as response:  # noqa: S310 - user-provided site
        return response.read(MAX_LOGO_BYTES + 1), response.headers.get("Content-Type", "")


class _IconParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.icons: list[tuple[int, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "link":
            return
        a = {k.lower(): (v or "") for k, v in attrs}
        rel = a.get("rel", "").lower()
        if "icon" not in rel or not a.get("href"):
            return
        sizes = re.findall(r"(\d+)x\d+", a.get("sizes", ""))
        size = max(map(int, sizes)) if sizes else (180 if "apple" in rel else 16)
        if a.get("href", "").endswith(".svg"):
            size = 1000
        self.icons.append((size, a["href"]))


def _icon_links(html: str, base: str) -> list[str]:
    parser = _IconParser()
    parser.feed(html[:200_000])
    return [urllib.parse.urljoin(base, href) for _, href in sorted(parser.icons, reverse=True)]


__all__ = ["Hub", "OPEN_STATUSES"]
