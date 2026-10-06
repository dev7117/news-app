"""Files attached to a cadence meeting (generated reports, exports, decks, breakdowns) or to a
task (what an agent produced for it, or anything you drop on it).

Content lives in ``<data>/files/`` named by its sha256 (the same report uploaded twice is one
file on disk); the ``attachments`` row keeps its name, type and where it belongs. Uploads come
from the app (drag and drop), todo-agent (a tool's outputs, or ``todo-agent upload``) and MCP.
"""
from __future__ import annotations

import hashlib
import mimetypes
import re
from pathlib import Path
from typing import Any

from .store import Invalid, NotFound, Store, now_iso

MAX_BYTES = 50 * 1024 * 1024
# Shown in the browser; everything else downloads (HTML/SVG could run script on our origin).
INLINE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain", "text/csv", "text/markdown"}
TEXT_TYPES = ("text/", "application/json", "application/xml", "application/x-yaml", "application/yaml")
MAX_TEXT_READ = 200_000


def safe_name(name: str) -> str:
    name = Path((name or "").replace("\\", "/")).name.strip()
    name = re.sub(r"[\x00-\x1f]", "", name)
    return name[:200] or "file"


def guess_type(name: str, given: str | None) -> str:
    given = (given or "").split(";")[0].strip().lower()
    if given and given != "application/octet-stream":
        return given
    if name.lower().endswith(".md"):
        return "text/markdown"
    return mimetypes.guess_type(name)[0] or "application/octet-stream"


class Attachments:
    def __init__(self, store: Store, data_dir: Path) -> None:
        self.store = store
        self.dir = data_dir / "files"

    def _dict(self, row: Any) -> dict[str, Any]:
        out = dict(row)
        out.pop("file", None)
        out["url"] = f"/api/files/{out['id']}/{out['name']}"
        return out

    def add(
        self,
        occurrence_id: int | None,
        name: str,
        data: bytes,
        content_type: str | None = None,
        *,
        step_id: int | None = None,
        task_id: int | None = None,
        note: str = "",
        source: str = "app",
    ) -> dict[str, Any]:
        """Attach to a cadence meeting (``occurrence_id``) or a task (``task_id``)."""
        if (occurrence_id is None) == (task_id is None):
            raise Invalid("A file belongs to a meeting or a task")
        if task_id is not None:
            self.store.get_task(task_id)
        elif not self.store._row("SELECT id FROM cadence_occurrences WHERE id = ?", (occurrence_id,)):
            raise NotFound(f"No cadence meeting with id {occurrence_id}")
        if step_id is not None and not self.store._row(
            "SELECT s.id FROM cadence_steps s JOIN cadence_occurrences o ON o.cadence_id = s.cadence_id"
            " WHERE s.id = ? AND o.id = ?", (step_id, occurrence_id)
        ):
            raise Invalid("That prep step isn't part of this meeting's cadence")
        if not data:
            raise Invalid("The file is empty")
        if len(data) > MAX_BYTES:
            raise Invalid("Files must be under 50 MB")
        name = safe_name(name)
        digest = hashlib.sha256(data).hexdigest()
        self.dir.mkdir(parents=True, exist_ok=True)
        path = self.dir / digest
        if not path.exists():
            path.write_bytes(data)
        with self.store.tx() as c:
            cur = c.execute(
                "INSERT INTO attachments (occurrence_id, task_id, step_id, name, file, content_type, bytes, note, source,"
                " created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (occurrence_id, task_id, step_id, name, digest, guess_type(name, content_type), len(data), note or "",
                 source or "app", now_iso()),
            )
            if task_id is not None:
                self.store._log(task_id, "change", f"Attached {name}" + (f": {note}" if note else ""), source or "app",
                                event="file")
        return self.get(cur.lastrowid)

    def get(self, attachment_id: int) -> dict[str, Any]:
        row = self.store._row("SELECT * FROM attachments WHERE id = ?", (attachment_id,))
        if not row:
            raise NotFound(f"No file with id {attachment_id}")
        return self._dict(row)

    def for_occurrence(self, occurrence_id: int) -> list[dict[str, Any]]:
        rows = self.store._rows(
            "SELECT * FROM attachments WHERE occurrence_id = ? ORDER BY created_at DESC, id DESC", (occurrence_id,)
        )
        return [self._dict(r) for r in rows]

    def for_task(self, task_id: int) -> list[dict[str, Any]]:
        rows = self.store._rows("SELECT * FROM attachments WHERE task_id = ? ORDER BY created_at DESC, id DESC", (task_id,))
        return [self._dict(r) for r in rows]

    def path(self, attachment_id: int) -> tuple[Path, dict[str, Any]]:
        row = self.store._row("SELECT * FROM attachments WHERE id = ?", (attachment_id,))
        if not row:
            raise NotFound(f"No file with id {attachment_id}")
        path = self.dir / row["file"]
        if not path.is_file():
            raise NotFound("The file is missing from storage")
        return path, dict(row)

    def read_text(self, attachment_id: int) -> dict[str, Any]:
        """A text file's contents (CSV, markdown, JSON, logs…), for Claude to read."""
        path, row = self.path(attachment_id)
        if not row["content_type"].startswith(TEXT_TYPES):
            raise Invalid(f"{row['name']} is {row['content_type']}, not text")
        data = path.read_bytes()
        return {**self._dict(row), "truncated": len(data) > MAX_TEXT_READ,
                "text": data[:MAX_TEXT_READ].decode("utf-8", errors="replace")}

    def delete(self, attachment_id: int) -> None:
        row = self.store._row("SELECT * FROM attachments WHERE id = ?", (attachment_id,))
        if not row:
            raise NotFound(f"No file with id {attachment_id}")
        with self.store.tx() as c:
            c.execute("DELETE FROM attachments WHERE id = ?", (attachment_id,))
            still = c.execute("SELECT 1 FROM attachments WHERE file = ?", (row["file"],)).fetchone()
        if not still:
            (self.dir / row["file"]).unlink(missing_ok=True)
