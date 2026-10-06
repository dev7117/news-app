"""Cadences: a customer's recurring meetings and everything needed to prep each one.

A **cadence** is the template: when it meets (``schedule.py``), what it's for, the agenda
topics, and the prep steps (each optionally a desktop tool and the files it produces).

An **occurrence** is one meeting of it, created ``prep_days`` ahead (or on demand, to prep
early). It gets:
- a scheduled meeting on the calendar (rule-based cadences), or the synced calendar meeting it
  matches (calendar cadences);
- its prep steps as real tasks, in a group (``Prep: Weekly Ops · Thu Oct 8``), each due
  ``due_hours_before`` the meeting. They're keyed ``(source "cadence: <name>", external_id
  "occ<id>-step<id>")``;
- talking points per agenda topic, notes, and attached files (``attachments.py``).

The app stores, schedules and shows all this. A Claude Code skill does the work: it reads the
prep packet over MCP, runs what's needed, writes the talking points and uploads the files.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Any

from . import schedule as sched
from .attachments import Attachments
from .hub import Hub
from .store import CLOSED_STATUSES, Invalid, NotFound, Store, now_iso

STATUSES = ("upcoming", "ready", "held", "skipped")
HORIZON_DAYS = 60  # how far ahead to look for the next meetings


def _local(dt: datetime) -> datetime:
    return dt.astimezone()  # aware → local zone; naive is taken as local wall time


class Cadences:
    def __init__(self, store: Store, hub: Hub, attachments: Attachments) -> None:
        self.store = store
        self.hub = hub
        self.attachments = attachments

    # ----- the template -----

    def _dict(self, row: Any) -> dict[str, Any]:
        out = dict(row)
        out["schedule"] = json.loads(out["schedule"])
        out["agenda"] = json.loads(out["agenda"] or "[]")
        out["active"] = bool(out["active"])
        out["schedule_text"] = sched.describe(out["schedule"])
        return out

    _SELECT = """
        SELECT cd.*, c.name AS customer, p.name AS project FROM cadences cd
        JOIN customers c ON c.id = cd.customer_id LEFT JOIN projects p ON p.id = cd.project_id
    """

    def get(self, cadence_id: int, *, full: bool = True) -> dict[str, Any]:
        row = self.store._row(self._SELECT + " WHERE cd.id = ?", (cadence_id,))
        if not row:
            raise NotFound(f"No cadence with id {cadence_id}")
        out = self._dict(row)
        if full:
            out["steps"] = self.steps(cadence_id)
            out["occurrences"] = self.occurrences(cadence_id)
            out["upcoming"] = self.upcoming(out, limit=6)
        return out

    def list(self, *, customer_id: int | None = None, include_inactive: bool = True) -> list[dict[str, Any]]:
        rows = self.store._rows(
            self._SELECT + " WHERE (? IS NULL OR cd.customer_id = ?) AND (? OR cd.active = 1) ORDER BY c.name, cd.name",
            (customer_id, customer_id, include_inactive),
        )
        out = []
        for r in rows:
            cadence = self._dict(r)
            cadence["steps_count"] = self.store._row("SELECT COUNT(*) AS n FROM cadence_steps WHERE cadence_id = ?", (cadence["id"],))["n"]
            nxt = self.upcoming(cadence, limit=1)
            cadence["next"] = nxt[0] if nxt else None
            out.append(cadence)
        return out

    def resolve(self, ref: int | str, customer_id: int | None = None) -> dict[str, Any]:
        """By id, or by name (case-insensitive; a unique substring is enough)."""
        if isinstance(ref, int) or str(ref).isdigit():
            return self.get(int(ref), full=False)
        key = str(ref).strip().lower()
        rows = [c for c in self.list(customer_id=customer_id) if key in c["name"].lower()]
        exact = [c for c in rows if c["name"].lower() == key]
        if len(exact) == 1 or len(rows) == 1:
            return (exact or rows)[0]
        if not rows:
            raise NotFound(f"No cadence matching {ref!r}")
        raise Invalid(f"{ref!r} matches several cadences: {', '.join(c['customer'] + ' / ' + c['name'] for c in rows)}")

    def _fields(self, fields: dict[str, Any], customer_id: int) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if fields.get("name") is not None:
            if not str(fields["name"]).strip():
                raise Invalid("A cadence needs a name")
            out["name"] = str(fields["name"]).strip()
        if fields.get("purpose") is not None:
            out["purpose"] = str(fields["purpose"])
        if fields.get("schedule") is not None:
            out["schedule"] = json.dumps(sched.validate(fields["schedule"]))
        for key, lo, hi in (("duration_min", 5, 600), ("prep_days", 0, 30)):
            if fields.get(key) is not None:
                value = int(fields[key])
                if not lo <= value <= hi:
                    raise Invalid(f"{key} must be {lo}–{hi}")
                out[key] = value
        if fields.get("agenda") is not None:
            out["agenda"] = json.dumps(_agenda(fields["agenda"]))
        if fields.get("active") is not None:
            out["active"] = int(bool(fields["active"]))
        if "project_id" in fields:
            if fields["project_id"] is not None:
                project = self.store.get_project(fields["project_id"])
                if project["customer_id"] != customer_id:
                    raise Invalid(f"Project {project['name']!r} isn't one of this customer's projects")
            out["project_id"] = fields["project_id"]
        return out

    def create(self, customer_id: int, name: str, schedule: dict[str, Any], **fields: Any) -> dict[str, Any]:
        self.store.get_customer(customer_id)
        cols = self._fields({"name": name, "schedule": schedule, **fields}, customer_id)
        ts = now_iso()
        cols.update(customer_id=customer_id, created_at=ts, updated_at=ts)
        with self.store.tx() as c:
            cur = c.execute(f"INSERT INTO cadences ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", tuple(cols.values()))
        return self.get(cur.lastrowid)

    def update(self, cadence_id: int, **fields: Any) -> dict[str, Any]:
        cadence = self.get(cadence_id, full=False)
        cols = self._fields(fields, cadence["customer_id"])
        if cols:
            cols["updated_at"] = now_iso()
            with self.store.tx() as c:
                c.execute(f"UPDATE cadences SET {', '.join(f'{k} = ?' for k in cols)} WHERE id = ?", (*cols.values(), cadence_id))
        return self.get(cadence_id)

    def delete(self, cadence_id: int) -> None:
        """Remove the cadence and its meeting history. Prep tasks already made stay as tasks."""
        self.get(cadence_id, full=False)
        with self.store.tx() as c:
            c.execute("DELETE FROM cadences WHERE id = ?", (cadence_id,))

    # ----- prep steps -----

    def steps(self, cadence_id: int) -> list[dict[str, Any]]:
        rows = self.store._rows(
            "SELECT s.*, l.label AS tool, l.command AS tool_command, l.cwd AS tool_cwd, l.mode AS tool_mode"
            " FROM cadence_steps s LEFT JOIN customer_links l ON l.id = s.link_id"
            " WHERE s.cadence_id = ? ORDER BY s.position, s.id",
            (cadence_id,),
        )
        return [dict(r) for r in rows]

    def set_steps(self, cadence_id: int, steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Replace the prep steps with ``steps`` in order. A step with an ``id`` updates that
        step; one without is new; steps left out are removed (their past tasks stay)."""
        cadence = self.get(cadence_id, full=False)
        current = {s["id"] for s in self.steps(cadence_id)}
        ts = now_iso()
        keep: set[int] = set()
        with self.store.tx() as c:
            for index, step in enumerate(steps):
                title = str(step.get("title") or "").strip()
                if not title:
                    raise Invalid(f"Prep step {index + 1} needs a title")
                link_id = step.get("link_id")
                if link_id is not None:
                    link = self.hub.get_link(int(link_id))
                    if link["customer_id"] != cadence["customer_id"] or link["kind"] != "launcher":
                        raise Invalid(f"Step {title!r}: link {link_id} isn't one of this customer's desktop tools")
                values = {
                    "position": float(index + 1),
                    "title": title,
                    "instructions": str(step.get("instructions") or ""),
                    "link_id": link_id,
                    "due_hours_before": max(0, int(step.get("due_hours_before", 24) or 0)),
                    "outputs": str(step.get("outputs") or "").strip(),
                    "updated_at": ts,
                }
                if step.get("id") in current:
                    c.execute(f"UPDATE cadence_steps SET {', '.join(f'{k} = ?' for k in values)} WHERE id = ?",
                              (*values.values(), step["id"]))
                    keep.add(step["id"])
                else:
                    values.update(cadence_id=cadence_id, created_at=ts)
                    c.execute(f"INSERT INTO cadence_steps ({', '.join(values)}) VALUES ({', '.join('?' * len(values))})",
                              tuple(values.values()))
            for gone in current - keep:
                c.execute("DELETE FROM cadence_steps WHERE id = ?", (gone,))
        return self.steps(cadence_id)

    # ----- when it meets -----

    def upcoming(self, cadence: dict[str, Any], *, limit: int = 6, days: int = HORIZON_DAYS) -> list[dict[str, Any]]:
        """The next meetings (from today), each with its occurrence when one exists."""
        today = self.store.today()
        made = {
            r["starts_at"]: dict(r)
            for r in self.store._rows(
                "SELECT id, starts_at, status FROM cadence_occurrences WHERE cadence_id = ? AND held_on >= ?",
                (cadence["id"], today.isoformat()),
            )
        }
        out = []
        for when, meeting in self._meeting_times(cadence, today, today + timedelta(days=days)):
            occ = made.pop(when, None)
            out.append({"starts_at": when, "held_on": when[:10], "meeting_id": meeting["id"] if meeting else None,
                        "occurrence_id": occ["id"] if occ else None, "status": occ["status"] if occ else None})
        # Occurrences made for times the schedule no longer produces (schedule changed, prepped early).
        out += [{"starts_at": k, "held_on": k[:10], "meeting_id": None, "occurrence_id": v["id"], "status": v["status"]}
                for k, v in made.items()]
        now = datetime.combine(today, datetime.now().time()).astimezone()  # today per the store's clock
        out = [o for o in out if o["occurrence_id"] or datetime.fromisoformat(o["starts_at"]) >= now - timedelta(hours=1)
               or o["held_on"] >= today.isoformat()]
        return sorted(out, key=lambda o: o["starts_at"])[:limit]

    def _meeting_times(self, cadence: dict[str, Any], start: date, end: date) -> list[tuple[str, dict[str, Any] | None]]:
        schedule = cadence["schedule"]
        if "calendar" in schedule:
            rows = self.store._rows(
                "SELECT * FROM meetings WHERE customer_id = ? AND status = 'scheduled' AND starts_at IS NOT NULL"
                " AND held_on BETWEEN ? AND ? AND lower(title) LIKE ? ORDER BY starts_at",
                (cadence["customer_id"], start.isoformat(), end.isoformat(), f"%{schedule['calendar'].lower()}%"),
            )
            return [(_iso(datetime.fromisoformat(r["starts_at"])), dict(r)) for r in rows]
        return [(_iso(_local(dt)), None) for dt in sched.occurrences(schedule, start, end)]

    # ----- occurrences -----

    def ensure(self) -> dict[str, list[int]]:
        """The hourly pass: make occurrences (meeting, prep tasks, topics) for meetings within
        each cadence's prep window; mark past ones held and ones whose calendar meeting was
        cancelled skipped."""
        today = self.store.today()
        made: list[int] = []
        with self.store.tx() as c:
            c.execute("UPDATE cadence_occurrences SET status = 'held', updated_at = ? WHERE held_on < ? AND status IN ('upcoming', 'ready')",
                      (now_iso(), today.isoformat()))
            c.execute(
                "UPDATE cadence_occurrences SET status = 'skipped', updated_at = ? WHERE status IN ('upcoming', 'ready')"
                " AND meeting_id IN (SELECT id FROM meetings WHERE status = 'cancelled')", (now_iso(),))
        for row in self.store._rows(self._SELECT + " WHERE cd.active = 1"):
            cadence = self._dict(row)
            for when, meeting in self._meeting_times(cadence, today, today + timedelta(days=cadence["prep_days"])):
                if not self._find(cadence["id"], when):
                    made.append(self._create(cadence, when, meeting)["id"])
        return {"created": made}

    def prepare(self, cadence_id: int, starts_at: str | None = None) -> dict[str, Any]:
        """The occurrence for a meeting (the next one by default), made now if it isn't yet:
        to prep earlier than the cadence's prep window."""
        cadence = self.get(cadence_id, full=False)
        if starts_at:
            when = _iso(datetime.fromisoformat(starts_at))
            meeting = next((m for w, m in self._meeting_times(cadence, date.fromisoformat(when[:10]), date.fromisoformat(when[:10])) if w == when), None)
        else:
            nxt = next((u for u in self.upcoming(cadence, limit=10) if u["status"] in (None, "upcoming", "ready")), None)
            if not nxt:
                raise Invalid(f"{cadence['name']} has no upcoming meeting in the next {HORIZON_DAYS} days")
            if nxt["occurrence_id"]:
                return self.occurrence(nxt["occurrence_id"])
            when = nxt["starts_at"]
            meeting = self.hub.get_meeting(nxt["meeting_id"]) if nxt["meeting_id"] else None
        existing = self._find(cadence_id, when)
        return self.occurrence(existing["id"] if existing else self._create(cadence, when, meeting)["id"])

    def _find(self, cadence_id: int, starts_at: str) -> dict[str, Any] | None:
        row = self.store._row("SELECT * FROM cadence_occurrences WHERE cadence_id = ? AND starts_at = ?", (cadence_id, starts_at))
        return dict(row) if row else None

    def _create(self, cadence: dict[str, Any], starts_at: str, meeting: dict[str, Any] | None) -> dict[str, Any]:
        start = datetime.fromisoformat(starts_at)
        held_on = start.date().isoformat()
        source = f"cadence: {cadence['name']}"
        if meeting is None:  # rule-based: put it on the calendar
            meeting = self.hub.create_meeting(
                cadence["customer_id"], title=cadence["name"], held_on=held_on, starts_at=starts_at,
                project_id=cadence["project_id"], source="cadence", status="scheduled",
            )
            with self.store.tx() as c:
                c.execute("UPDATE meetings SET ends_at = ? WHERE id = ?",
                          (_iso(start + timedelta(minutes=cadence["duration_min"])), meeting["id"]))
        ts = now_iso()
        with self.store.tx() as c:
            cur = c.execute(
                "INSERT INTO cadence_occurrences (cadence_id, meeting_id, held_on, starts_at, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (cadence["id"], meeting["id"], held_on, starts_at, ts, ts),
            )
            occ_id = cur.lastrowid
            for index, topic in enumerate(cadence["agenda"]):
                c.execute(
                    "INSERT INTO occurrence_topics (occurrence_id, position, title, guidance, updated_at) VALUES (?, ?, ?, ?, ?)",
                    (occ_id, float(index + 1), topic["title"], topic.get("guidance", ""), ts),
                )
            # Prep as real tasks: a group, one task per step.
            place = {"project_id": cadence["project_id"]} if cadence["project_id"] else {"area": "work"}
            label = start.strftime("%a %b %-d")
            group = self.store.create_task(
                {"title": f"Prep: {cadence['name']} · {label}", "due_on": held_on, "notes": cadence["purpose"], **place},
                source=source, external_id=f"occ{occ_id}", created_note=f"Prep for {cadence['name']} on {label}",
            )
            c.execute("UPDATE tasks SET created_via = 'cadence' WHERE id = ?", (group["id"],))
            for step in self.steps(cadence["id"]):
                due = (start - timedelta(hours=step["due_hours_before"])).date().isoformat()
                notes = step["instructions"]
                if step["tool"]:
                    notes += f"\n\nDesktop tool: {step['tool']}"
                if step["outputs"]:
                    notes += f"\nAttach: {step['outputs']}"
                task = self.store.create_task(
                    {"title": step["title"], "notes": notes.strip(), "due_on": min(due, held_on), **place},
                    source=source, external_id=f"occ{occ_id}-step{step['id']}",
                    created_note=f"Prep step for {cadence['name']} on {label}",
                )
                c.execute("UPDATE tasks SET parent_id = ? WHERE id = ?", (group["id"], task["id"]))
            c.execute("UPDATE cadence_occurrences SET prep_task_id = ? WHERE id = ?", (group["id"], occ_id))
        return self._row(occ_id)

    def _row(self, occurrence_id: int) -> dict[str, Any]:
        row = self.store._row("SELECT * FROM cadence_occurrences WHERE id = ?", (occurrence_id,))
        if not row:
            raise NotFound(f"No cadence meeting with id {occurrence_id}")
        return dict(row)

    def occurrences(self, cadence_id: int, limit: int = 12) -> list[dict[str, Any]]:
        """Recent and upcoming meetings of a cadence, newest first, with prep progress."""
        rows = self.store._rows(
            "SELECT o.*, (SELECT COUNT(*) FROM attachments a WHERE a.occurrence_id = o.id) AS files"
            " FROM cadence_occurrences o WHERE cadence_id = ? ORDER BY starts_at DESC LIMIT ?",
            (cadence_id, limit),
        )
        return [{**dict(r), "prep": self._progress(r["prep_task_id"])} for r in rows]

    def _progress(self, group_id: int | None) -> dict[str, int]:
        if not group_id:
            return {"done": 0, "total": 0}
        row = self.store._row(
            f"SELECT COUNT(*) AS total, SUM(status IN {CLOSED_STATUSES}) AS done FROM tasks WHERE parent_id = ?", (group_id,)
        )
        return {"done": row["done"] or 0, "total": row["total"]}

    def occurrence(self, occurrence_id: int) -> dict[str, Any]:
        """The prep packet for one meeting: everything a skill needs to prep it."""
        occ = self._row(occurrence_id)
        cadence = self.get(occ["cadence_id"], full=False)
        files = self.attachments.for_occurrence(occurrence_id)
        source = f"cadence: {cadence['name']}"
        steps = []
        for step in self.steps(cadence["id"]):
            task = self.store._row(
                "SELECT id, title, status, due_on FROM tasks WHERE source = ? AND external_id = ?",
                (source, f"occ{occurrence_id}-step{step['id']}"),
            )
            run = self.store._row(
                "SELECT id, status, exit_code, finished_at, agent FROM launcher_runs WHERE occurrence_id = ? AND step_id = ?"
                " ORDER BY id DESC LIMIT 1", (occurrence_id, step["id"]))
            steps.append({**step, "task": dict(task) if task else None, "last_run": dict(run) if run else None,
                          "files": [f for f in files if f["step_id"] == step["id"]]})
        previous = self.store._row(
            "SELECT id, held_on, notes FROM cadence_occurrences WHERE cadence_id = ? AND starts_at < ? AND status <> 'skipped'"
            " ORDER BY starts_at DESC LIMIT 1", (cadence["id"], occ["starts_at"]))
        return {
            **occ,
            "cadence": cadence,
            "meeting": self.hub.get_meeting(occ["meeting_id"]) if occ["meeting_id"] else None,
            "steps": steps,
            "prep": self._progress(occ["prep_task_id"]),
            "topics": self.topics(occurrence_id),
            "files": files,
            "previous": {**dict(previous), "topics": self.topics(previous["id"])} if previous else None,
        }

    def update_occurrence(self, occurrence_id: int, *, notes: str | None = None, append: str | None = None,
                          status: str | None = None) -> dict[str, Any]:
        occ = self._row(occurrence_id)
        sets: dict[str, Any] = {}
        if notes is not None:
            sets["notes"] = notes
        if append:
            sets["notes"] = (occ["notes"].rstrip() + "\n\n" + append.strip()).strip()
        if status is not None:
            if status not in STATUSES:
                raise Invalid(f"status must be one of {', '.join(STATUSES)}")
            sets["status"] = status
        if sets:
            sets["updated_at"] = now_iso()
            with self.store.tx() as c:
                c.execute(f"UPDATE cadence_occurrences SET {', '.join(f'{k} = ?' for k in sets)} WHERE id = ?",
                          (*sets.values(), occurrence_id))
        return self.occurrence(occurrence_id)

    # ----- talking points -----

    def topics(self, occurrence_id: int) -> list[dict[str, Any]]:
        return [dict(r) for r in self.store._rows(
            "SELECT * FROM occurrence_topics WHERE occurrence_id = ? ORDER BY position, id", (occurrence_id,))]

    def set_points(self, occurrence_id: int, topic: int | str, points: str, *, append: bool = False,
                   source: str = "app") -> dict[str, Any]:
        """Write a topic's talking points (markdown). ``topic`` is its id or title; a title that
        isn't on the agenda adds it as a new topic at the end."""
        self._row(occurrence_id)
        current = self.topics(occurrence_id)
        found = next((t for t in current if (isinstance(topic, int) or str(topic).isdigit()) and t["id"] == int(topic)), None) \
            or next((t for t in current if str(topic).strip().lower() == t["title"].lower()), None)
        ts = now_iso()
        with self.store.tx() as c:
            if found:
                text = (found["points"].rstrip() + "\n" + points.strip()).strip() if append else points
                c.execute("UPDATE occurrence_topics SET points = ?, source = ?, updated_at = ? WHERE id = ?",
                          (text, source, ts, found["id"]))
                topic_id = found["id"]
            else:
                if isinstance(topic, int) or str(topic).isdigit():
                    raise NotFound(f"No topic {topic} on this meeting")
                cur = c.execute(
                    "INSERT INTO occurrence_topics (occurrence_id, position, title, points, source, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (occurrence_id, (current[-1]["position"] + 1) if current else 1.0, str(topic).strip(), points, source, ts),
                )
                topic_id = cur.lastrowid
        return dict(self.store._row("SELECT * FROM occurrence_topics WHERE id = ?", (topic_id,)))

    def remove_topic(self, topic_id: int) -> None:
        with self.store.tx() as c:
            c.execute("DELETE FROM occurrence_topics WHERE id = ?", (topic_id,))

    # ----- prep steps on one meeting -----

    def step_task(self, occurrence_id: int, step: int | str) -> dict[str, Any]:
        """The prep task for a step (by step id or title)."""
        occ = self._row(occurrence_id)
        cadence = self.get(occ["cadence_id"], full=False)
        steps = self.steps(cadence["id"])
        found = next((s for s in steps if str(step).isdigit() and s["id"] == int(step)), None) \
            or next((s for s in steps if str(step).strip().lower() in s["title"].lower()), None)
        if not found:
            raise NotFound(f"No prep step {step!r} in {cadence['name']}")
        task = self.store._row("SELECT id FROM tasks WHERE source = ? AND external_id = ?",
                               (f"cadence: {cadence['name']}", f"occ{occurrence_id}-step{found['id']}"))
        if not task:
            raise NotFound(f"Step {found['title']!r} has no task on this meeting (added after it was made?)")
        return {"step": found, "task": self.store.get_task(task["id"])}

    def complete_step(self, occurrence_id: int, step: int | str, *, done: bool = True, note: str | None = None,
                      source: str = "app") -> dict[str, Any]:
        found = self.step_task(occurrence_id, step)
        task = self.store.update_task(found["task"]["id"], {"status": "done" if done else "todo"}, source=source, note=note)
        return task


def _agenda(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        raise Invalid("agenda must be a list of topics")
    out = []
    for item in value:
        if isinstance(item, str):
            item = {"title": item}
        title = str((item or {}).get("title") or "").strip()
        if title:
            out.append({"title": title, "guidance": str(item.get("guidance") or "").strip()})
    return out


def _iso(dt: datetime) -> str:
    return _local(dt).isoformat(timespec="minutes")

