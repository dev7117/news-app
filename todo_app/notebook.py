"""Notebooks: ordered markdown blocks belonging to an idea or a task.

Each block is a small document (title + markdown body). On tasks a block can also be a
*subtask* (kind 'subtask') with a checkbox; adding, completing and removing subtasks is
written to the task's history so it shows on the task timeline. Positions are floats so a
block can be inserted between two others without renumbering.
"""
from __future__ import annotations

from typing import Any, Literal

from .store import Invalid, NotFound, Store, now_iso

Owner = Literal["idea", "task", "person"]
KINDS = ("note", "subtask")


class Notebook:
    def __init__(self, store: Store) -> None:
        self.store = store

    def _col(self, owner: Owner) -> str:
        if owner not in ("idea", "task", "person"):
            raise Invalid("owner must be idea, task or person")
        return f"{owner}_id"

    def _dict(self, row: Any) -> dict[str, Any]:
        out = dict(row)
        out["collapsed"] = bool(out["collapsed"])
        out["done"] = bool(out["done"])
        return out

    def blocks(self, owner: Owner, owner_id: int) -> list[dict[str, Any]]:
        rows = self.store._rows(
            f"SELECT * FROM blocks WHERE {self._col(owner)} = ? ORDER BY position, id", (owner_id,)
        )
        return [self._dict(r) for r in rows]

    def get(self, block_id: int) -> dict[str, Any]:
        row = self.store._row("SELECT * FROM blocks WHERE id = ?", (block_id,))
        if not row:
            raise NotFound(f"No block with id {block_id}")
        return self._dict(row)

    def progress(self, task_id: int) -> dict[str, int]:
        row = self.store._row(
            "SELECT COUNT(*) FILTER (WHERE kind = 'subtask') AS total,"
            " COUNT(*) FILTER (WHERE kind = 'subtask' AND done = 1) AS done FROM blocks WHERE task_id = ?",
            (task_id,),
        )
        return {"total": row["total"], "done": row["done"]}

    def _touch(self, block_or_owner: dict[str, Any], ts: str) -> None:
        if block_or_owner.get("idea_id"):
            self.store.conn.execute("UPDATE ideas SET updated_at = ? WHERE id = ?", (ts, block_or_owner["idea_id"]))
        if block_or_owner.get("task_id"):
            self.store.conn.execute("UPDATE tasks SET updated_at = ? WHERE id = ?", (ts, block_or_owner["task_id"]))
        if block_or_owner.get("person_id"):
            self.store.conn.execute("UPDATE people SET updated_at = ? WHERE id = ?", (ts, block_or_owner["person_id"]))

    def _log(self, block: dict[str, Any], event: str, text: str, source: str) -> None:
        if block.get("task_id"):
            self.store._log(block["task_id"], "change", text, source, event=event)

    @staticmethod
    def label(block: dict[str, Any]) -> str:
        return block["title"].strip() or (block["body"].strip().split("\n")[0][:80] or "Untitled")

    def add(
        self,
        owner: Owner,
        owner_id: int,
        *,
        title: str = "",
        body: str = "",
        after_id: int | None = None,
        kind: str = "note",
        source: str = "app",
    ) -> dict[str, Any]:
        """Add a block at the end, or right after ``after_id`` (0 = at the top)."""
        col = self._col(owner)
        if owner == "task":
            self.store.get_task(owner_id)
        else:
            table = "ideas" if owner == "idea" else "people"
            self.store._row(f"SELECT id FROM {table} WHERE id = ?", (owner_id,)) or _missing(owner, owner_id)
        if kind not in KINDS:
            raise Invalid(f"kind must be one of {', '.join(KINDS)}")
        if owner != "task" and kind == "subtask":
            raise Invalid("Subtasks belong to tasks")
        existing = self.blocks(owner, owner_id)
        if after_id is None:
            position = (existing[-1]["position"] + 1) if existing else 1.0
        elif after_id == 0:
            position = (existing[0]["position"] - 1) if existing else 1.0
        else:
            index = next((i for i, b in enumerate(existing) if b["id"] == after_id), None)
            if index is None:
                raise Invalid("after_id isn't a block here")
            nxt = existing[index + 1]["position"] if index + 1 < len(existing) else existing[index]["position"] + 2
            position = (existing[index]["position"] + nxt) / 2
        ts = now_iso()
        with self.store.tx() as c:
            cur = c.execute(
                f"INSERT INTO blocks ({col}, position, kind, title, body, source, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (owner_id, position, kind, (title or "").strip(), body or "", source or "app", ts, ts),
            )
            block = self.get(cur.lastrowid)
            self._touch(block, ts)
            if kind == "subtask":
                self._log(block, "subtask_added", f"Added subtask: {self.label(block)}", source)
            if block["task_id"]:
                self.store._reindex(block["task_id"])
                self.store.follow_mentions(block["task_id"], block["title"], block["body"], source=source)
        return block

    def update(self, block_id: int, *, source: str = "app", **fields: Any) -> dict[str, Any]:
        block = self.get(block_id)
        sets: dict[str, Any] = {}
        if fields.get("title") is not None:
            sets["title"] = fields["title"].strip()
        if fields.get("body") is not None:
            sets["body"] = fields["body"]
        if fields.get("append"):
            sets["body"] = (block["body"].rstrip() + "\n\n" + fields["append"].strip()).strip()
        if fields.get("collapsed") is not None:
            sets["collapsed"] = int(bool(fields["collapsed"]))
        if fields.get("kind") is not None:
            if fields["kind"] not in KINDS:
                raise Invalid(f"kind must be one of {', '.join(KINDS)}")
            if not block["task_id"] and fields["kind"] == "subtask":
                raise Invalid("Subtasks belong to tasks")
            sets["kind"] = fields["kind"]
        kind = sets.get("kind", block["kind"])
        if fields.get("done") is not None:
            if kind != "subtask":
                raise Invalid("Only subtasks can be checked off")
            done = bool(fields["done"])
            if done != block["done"]:
                sets["done"] = int(done)
                sets["done_at"] = now_iso() if done else None
        if not sets:
            return block
        ts = now_iso()
        sets["updated_at"] = ts
        with self.store.tx() as c:
            c.execute(f"UPDATE blocks SET {', '.join(f'{k} = ?' for k in sets)} WHERE id = ?", (*sets.values(), block_id))
            updated = self.get(block_id)
            if set(sets) - {"collapsed", "updated_at"}:
                self._touch(updated, ts)
            if "done" in sets:
                if sets["done"]:
                    self._log(updated, "subtask_done", f"Completed subtask: {self.label(updated)}", source)
                else:
                    self._log(updated, "subtask_reopened", f"Reopened subtask: {self.label(updated)}", source)
            elif sets.get("kind") == "subtask" and block["kind"] != "subtask":
                self._log(updated, "subtask_added", f"Added subtask: {self.label(updated)}", source)
            if updated["task_id"] and set(sets) & {"title", "body"}:
                self.store._reindex(updated["task_id"])
                self.store.follow_mentions(updated["task_id"], updated["title"], updated["body"], source=source)
        return updated

    def delete(self, block_id: int, *, source: str = "app") -> None:
        block = self.get(block_id)
        ts = now_iso()
        with self.store.tx() as c:
            c.execute("DELETE FROM blocks WHERE id = ?", (block_id,))
            self._touch(block, ts)
            if block["kind"] == "subtask":
                self._log(block, "subtask_removed", f"Removed subtask: {self.label(block)}", source)
            if block["task_id"]:
                self.store._reindex(block["task_id"])

    def reorder(self, owner: Owner, owner_id: int, ids: list[int]) -> list[dict[str, Any]]:
        current = {b["id"] for b in self.blocks(owner, owner_id)}
        if set(ids) != current:
            raise Invalid("Give every block, in the new order")
        with self.store.tx() as c:
            for index, block_id in enumerate(ids):
                c.execute("UPDATE blocks SET position = ? WHERE id = ?", (float(index + 1), block_id))
        return self.blocks(owner, owner_id)

    def as_markdown(self, owner: Owner, owner_id: int) -> str:
        """Every block as a section (subtasks as checklist headings)."""
        parts = []
        for block in self.blocks(owner, owner_id):
            prefix = ("[x] " if block["done"] else "[ ] ") if block["kind"] == "subtask" else ""
            heading = f"## {prefix}{block['title'].strip()}\n\n" if block["title"].strip() or prefix else ""
            if heading or block["body"].strip():
                parts.append(heading + block["body"].strip())
        return "\n\n".join(parts)


def _missing(what: str, ident: int) -> None:
    raise NotFound(f"No {what} with id {ident}")
