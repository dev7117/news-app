"""The source ledger and client sync: what Claude has already brought you, and what you decided.

A scheduled sync re-reads the same mail threads, tickets and meetings run after run. Without a
memory it proposes the same things again: a create you rejected leaves no task behind, and a
thread read twice looks new twice. So every proposed item carries a **ref**, a stable id for
where it came from (``gmail:<threadId>``, ``jira:ACME-123``, ``gcal:<eventId>#<item>``,
``slack:<channel>/<ts>``, ``teams:<messageId>``), and this module remembers each one:

- ``task_refs``: ref → the task it became (on apply, or from ingest's external ids);
- ``changes.ref``: every proposal of it, pending / applied / rejected.

``screen`` runs on every proposed item before it reaches Review and drops what you already
decided on: a ref waiting in Review, a ref you rejected, a create for something already
tracked, anything touching a closed task, and (for items without a ref) a create that looks
like one you rejected or a task you recently closed. Claude can override with ``reconsider``
(you rejected it) or ``reopen`` (it's closed), with a reason; the review shows it.

Client sync: each customer has a sync profile (``customer_sync``: which mail domains, Jira
projects, Slack/Teams channels, calendar title patterns belong to them, plus client-specific
rules), and ``sync_state`` keeps where each source's last run stopped. A Claude Code routine
per client runs the todo-sync skill, which reads both through MCP.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from .store import _STOPWORDS, CLOSED_STATUSES, Invalid, NotFound, Store, now_iso

SOURCES = ("gmail", "calendar", "jira", "slack", "teams")
# Shape of each source's filters in a sync profile (all optional).
SOURCE_FIELDS = {
    "gmail": ("domains", "addresses", "labels", "query"),
    "calendar": ("domains", "title_patterns"),
    "jira": ("site", "projects", "jql"),
    "slack": ("channels", "users"),
    "teams": ("channels", "chats"),
}
SIMILAR = 0.8
REJECTED_DAYS = 90
CLOSED_DAYS = 30
JIRA_KEY = re.compile(r"/browse/([A-Z][A-Z0-9]+-\d+)")
_WORD = re.compile(r"[a-z0-9]+")


def normalize_ref(ref: str | None) -> str | None:
    """``Gmail: 18c2…`` → ``gmail:18c2…``. The kind is lower-case; the id is kept as given
    (thread ids are case-sensitive), except Jira keys, which are upper-case."""
    ref = (ref or "").strip()
    if not ref:
        return None
    kind, sep, rest = ref.partition(":")
    if not sep or not kind.strip() or not rest.strip():
        raise Invalid(f"ref {ref!r} should look like gmail:<threadId>, jira:ACME-123, gcal:<eventId>…")
    kind = kind.strip().lower()
    rest = rest.strip()
    return f"{kind}:{rest.upper() if kind == 'jira' else rest}"


def _words(title: str) -> set[str]:
    return {w for w in _WORD.findall((title or "").lower()) if w not in _STOPWORDS and len(w) > 1}


def similarity(a: str, b: str) -> float:
    """Token-set overlap of two titles (Jaccard), ignoring stopwords and order."""
    wa, wb = _words(a), _words(b)
    return len(wa & wb) / len(wa | wb) if wa and wb else 0.0


def _ago(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds")


def _day(ts: str | None) -> str:
    try:
        return datetime.fromisoformat(ts or "").strftime("%b %-d")
    except ValueError:
        return ts or "?"


class Ledger:
    def __init__(self, store: Store) -> None:
        self.store = store

    # ----- refs -----

    def record(self, task_id: int, ref: str | None) -> None:
        ref = normalize_ref(ref)
        if ref:
            with self.store.tx() as c:
                c.execute("INSERT OR IGNORE INTO task_refs (task_id, ref, created_at) VALUES (?, ?, ?)",
                          (task_id, ref, now_iso()))

    def refs_for(self, task_id: int) -> list[str]:
        return [r["ref"] for r in self.store._rows("SELECT ref FROM task_refs WHERE task_id = ? ORDER BY ref", (task_id,))]

    def backfill(self) -> int:
        """Jira keys already sitting in tasks' links become refs (idempotent)."""
        added = 0
        for row in self.store._rows("SELECT id, external_url FROM tasks WHERE external_url LIKE '%/browse/%'"):
            m = JIRA_KEY.search(row["external_url"] or "")
            if m and not self.store._row("SELECT 1 FROM task_refs WHERE ref = ?", (f"jira:{m[1]}",)):
                self.record(row["id"], f"jira:{m[1]}")
                added += 1
        return added

    def state(self, ref: str) -> dict[str, Any]:
        """unseen / pending / rejected / tracked / deleted, with what to say about it."""
        ref = normalize_ref(ref) or ""
        row = self.store._row(
            "SELECT tr.task_id, t.title, t.status, t.completed_at FROM task_refs tr JOIN tasks t ON t.id = tr.task_id"
            " WHERE tr.ref = ?", (ref,),
        )
        if row:
            return {"ref": ref, "state": "tracked", "task_id": row["task_id"], "title": row["title"],
                    "status": row["status"], "closed_on": row["completed_at"] if row["status"] in CLOSED_STATUSES else None}
        pending = self.store._row(
            "SELECT ch.changeset_id FROM changes ch WHERE ch.ref = ? AND ch.status = 'pending' ORDER BY ch.id DESC LIMIT 1",
            (ref,),
        )
        if pending:
            return {"ref": ref, "state": "pending", "proposal_id": pending["changeset_id"]}
        decided = self.store._row(
            "SELECT ch.status, ch.result_id, ch.action, cs.decided_at, cs.id AS proposal_id FROM changes ch"
            " JOIN changesets cs ON cs.id = ch.changeset_id WHERE ch.ref = ? AND ch.status IN ('applied', 'rejected')"
            " ORDER BY ch.id DESC LIMIT 1", (ref,),
        )
        if decided and decided["status"] == "rejected":
            return {"ref": ref, "state": "rejected", "on": decided["decided_at"], "proposal_id": decided["proposal_id"]}
        if decided and decided["action"] in ("create", "promote_idea"):
            return {"ref": ref, "state": "deleted", "on": decided["decided_at"]}  # applied, task since deleted
        return {"ref": ref, "state": "unseen"}

    def check(self, refs: list[str]) -> list[dict[str, Any]]:
        return [self.state(r) for r in refs]

    # ----- screening proposals -----

    def screen(self, item: dict[str, Any], customer_id: int | None) -> tuple[dict[str, Any] | None, str | None, list[str]]:
        """(item to keep, or None; why it was skipped; flags for the review).

        May fill in task_id from the ref. Never raises for "already decided": that's a skip."""
        item = dict(item)
        action = item.get("action")
        reason = (item.get("reason") or "").strip()
        flags: list[str] = []
        ref = normalize_ref(item.get("ref"))
        item["ref"] = ref
        if action == "add_link":
            return item, None, flags
        if ref:
            st = self.state(ref)
            if st["state"] == "pending":
                return None, f"already waiting in Review (proposal #{st['proposal_id']})", flags
            if st["state"] in ("rejected", "deleted"):
                what = "rejected this" if st["state"] == "rejected" else "deleted the task it became"
                if not item.get("reconsider"):
                    return None, f"you {what} on {_day(st['on'])}; pass reconsider with a new reason to bring it back", flags
                if not reason:
                    return None, "reconsider needs a reason (what's new since it was turned down)", flags
                flags.append("brought_back")
            if st["state"] == "tracked":
                if action in ("create", "promote_idea"):
                    closed = f", closed {_day(st['closed_on'])}" if st["closed_on"] else ""
                    return None, (f"already tracked as #{st['task_id']} “{st['title']}” ({st['status']}{closed}); "
                                  "send a note or update to it instead"), flags
                if item.get("task_id") in (None, ""):
                    item["task_id"] = st["task_id"]
                elif int(item["task_id"]) != st["task_id"]:
                    pass  # an explicit task wins; the ref gets attached to it too on apply
        if action not in ("create", "promote_idea") and item.get("task_id") not in (None, ""):
            try:
                task = self.store.get_task(int(item["task_id"]))
            except NotFound:
                return item, None, flags  # _prepare reports it
            if task["status"] in CLOSED_STATUSES:
                if not item.get("reopen"):
                    return None, (f"#{task['id']} “{task['title']}” is {task['status']} ({_day(task['completed_at'])}); "
                                  "pass reopen with a reason if it really needs to come back"), flags
                if not reason:
                    return None, "reopen needs a reason", flags
                flags.append("reopens")
        if action == "create" and not ref and not item.get("reconsider"):
            look = self._looks_like(item.get("title") or "", customer_id, item.get("project"))
            if look:
                return None, look + "; pass a ref or reconsider if it's really new", flags
        return item, None, flags

    def _looks_like(self, title: str, customer_id: int | None, project: Any) -> str | None:
        """A create without a ref that resembles something you already turned down or closed."""
        if not _words(title):
            return None
        if customer_id is None and project not in (None, ""):
            try:
                proj = self.store.resolve_project(project)
                customer_id = proj["customer_id"] if proj else None
            except NotFound:
                pass
        rejected = self.store._rows(
            "SELECT ch.payload, cs.decided_at, cs.customer_id FROM changes ch JOIN changesets cs ON cs.id = ch.changeset_id"
            " WHERE ch.action = 'create' AND ch.status = 'rejected' AND cs.decided_at >= ?", (_ago(REJECTED_DAYS),),
        )
        for r in rejected:
            if customer_id and r["customer_id"] and r["customer_id"] != customer_id:
                continue
            other = (json.loads(r["payload"]).get("fields") or {}).get("title") or ""
            if similarity(title, other) >= SIMILAR:
                return f"looks like “{other}”, which you rejected on {_day(r['decided_at'])}"
        closed = self.store._rows(
            "SELECT t.id, t.title, t.status, t.completed_at, p.customer_id FROM tasks t LEFT JOIN projects p ON p.id = t.project_id"
            f" WHERE t.status IN {CLOSED_STATUSES} AND t.completed_at >= ?", (_ago(CLOSED_DAYS),),
        )
        for t in closed:
            if customer_id and t["customer_id"] != customer_id:
                continue
            if similarity(title, t["title"]) >= SIMILAR:
                return f"looks like #{t['id']} “{t['title']}” ({t['status']} {_day(t['completed_at'])})"
        return None

    # ----- client sync profiles and state -----

    def profile(self, customer_id: int) -> dict[str, Any]:
        self.store.get_customer(customer_id)
        row = self.store._row("SELECT * FROM customer_sync WHERE customer_id = ?", (customer_id,))
        states = {r["source"]: dict(r) for r in self.store._rows(
            "SELECT source, cursor, last_run_at, last_summary FROM sync_state WHERE customer_id = ?", (customer_id,))}
        counts = self.store._row(
            """SELECT
                 (SELECT COUNT(*) FROM task_refs tr JOIN tasks t ON t.id = tr.task_id JOIN projects p ON p.id = t.project_id
                    WHERE p.customer_id = ?) AS tracked,
                 (SELECT COUNT(DISTINCT ch.ref) FROM changes ch JOIN changesets cs ON cs.id = ch.changeset_id
                    WHERE cs.customer_id = ? AND ch.status = 'rejected' AND ch.ref IS NOT NULL) AS rejected""",
            (customer_id, customer_id),
        )
        sources = json.loads(row["sources"]) if row else {}
        return {
            "customer_id": customer_id,
            "configured": bool(row),
            "enabled": bool(row["enabled"]) if row else False,
            "sources": {s: sources.get(s) for s in SOURCES},
            "rules": row["rules"] if row else "",
            "default_project_id": row["default_project_id"] if row else None,
            "state": {s: states.get(s) for s in SOURCES},
            "ledger": {"tracked": counts["tracked"], "rejected": counts["rejected"]},
            "updated_at": row["updated_at"] if row else None,
        }

    def save_profile(
        self, customer_id: int, *, enabled: bool | None = None, sources: dict[str, Any] | None = None,
        rules: str | None = None, default_project_id: int | None | str = "",
    ) -> dict[str, Any]:
        """Only what's given changes. In ``sources``, a source set to null turns it off; its
        filters are lists of strings (or a string for query / site / jql)."""
        current = self.profile(customer_id)
        merged = {k: v for k, v in current["sources"].items() if v}
        for name, spec in (sources or {}).items():
            if name not in SOURCES:
                raise Invalid(f"source must be one of {', '.join(SOURCES)}")
            if not spec:
                merged.pop(name, None)
                continue
            clean: dict[str, Any] = {}
            for key, value in spec.items():
                if key not in SOURCE_FIELDS[name]:
                    raise Invalid(f"{name} takes {', '.join(SOURCE_FIELDS[name])}")
                if isinstance(value, list):
                    value = [str(v).strip() for v in value if str(v).strip()]
                elif value is not None:
                    value = str(value).strip()
                if value:
                    clean[key] = value
            merged[name] = clean or {}
        if default_project_id not in ("", None):
            project = self.store.get_project(int(default_project_id))
            if project["customer_id"] != customer_id:
                raise Invalid(f"Project {project['name']} isn't this customer's")
        project_id = current["default_project_id"] if default_project_id == "" else default_project_id
        ts = now_iso()
        with self.store.tx() as c:
            c.execute(
                "INSERT INTO customer_sync (customer_id, enabled, sources, rules, default_project_id, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (customer_id) DO UPDATE SET enabled = excluded.enabled,"
                " sources = excluded.sources, rules = excluded.rules, default_project_id = excluded.default_project_id,"
                " updated_at = excluded.updated_at",
                (customer_id, int(enabled if enabled is not None else (current["enabled"] or not current["configured"])),
                 json.dumps(merged), rules if rules is not None else current["rules"], project_id, ts, ts),
            )
        return self.profile(customer_id)

    def set_state(self, customer_id: int, source: str, *, cursor: str | None, summary: str = "") -> dict[str, Any]:
        if source not in SOURCES:
            raise Invalid(f"source must be one of {', '.join(SOURCES)}")
        self.store.get_customer(customer_id)
        with self.store.tx() as c:
            c.execute(
                "INSERT INTO sync_state (customer_id, source, cursor, last_run_at, last_summary) VALUES (?, ?, ?, ?, ?)"
                " ON CONFLICT (customer_id, source) DO UPDATE SET cursor = COALESCE(excluded.cursor, cursor),"
                " last_run_at = excluded.last_run_at, last_summary = excluded.last_summary",
                (customer_id, source, cursor, now_iso(), summary or ""),
            )
        return self.profile(customer_id)["state"][source]

    def enabled_customers(self) -> list[dict[str, Any]]:
        rows = self.store._rows(
            "SELECT c.id, c.name FROM customer_sync s JOIN customers c ON c.id = s.customer_id"
            " WHERE s.enabled = 1 AND c.archived = 0 ORDER BY lower(c.name)"
        )
        return [dict(r) for r in rows]
