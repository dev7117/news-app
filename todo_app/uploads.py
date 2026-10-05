"""Images pasted or dropped into notes (task descriptions, notebook blocks, progress notes).

Stored under ``<data>/uploads/`` named by content hash, so the same screenshot pasted twice
is one file and its URL can be cached for good. Notes reference them as markdown images
(``![screenshot](/api/uploads/<name>)``). Raster formats only: no SVG, which can carry script.
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

from .store import Invalid, NotFound

TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp"}
MAX_BYTES = 15 * 1024 * 1024
NAME = re.compile(r"^[0-9a-f]{24}\.(png|jpg|gif|webp)$")


class Uploads:
    def __init__(self, data_dir: Path) -> None:
        self.dir = data_dir / "uploads"

    def save(self, data: bytes, content_type: str) -> dict[str, str | int]:
        ext = TYPES.get(content_type.split(";")[0].strip().lower())
        if not ext:
            raise Invalid("Images must be PNG, JPEG, GIF or WebP")
        if not data:
            raise Invalid("The image is empty")
        if len(data) > MAX_BYTES:
            raise Invalid("Images must be under 15 MB")
        name = f"{hashlib.sha256(data).hexdigest()[:24]}.{ext}"
        self.dir.mkdir(parents=True, exist_ok=True)
        path = self.dir / name
        if not path.exists():
            path.write_bytes(data)
        return {"name": name, "url": f"/api/uploads/{name}", "bytes": len(data)}

    def path(self, name: str) -> Path:
        path = self.dir / name
        if not NAME.match(name) or not path.is_file():
            raise NotFound("No such image")
        return path
