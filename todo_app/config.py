"""Environment-based configuration."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Config:
    db_path: Path
    port: int
    # Bearer token required on /mcp and /api/ingest (the machine-facing endpoints).
    # Unset = open, like the web UI. Set it in production.
    api_token: str | None
    frontend_dist: Path


def load() -> Config:
    root = Path(__file__).resolve().parent.parent
    return Config(
        db_path=Path(os.getenv("TODO_DB", root / "data" / "todo.db")),
        port=int(os.getenv("TODO_PORT", "7670")),
        api_token=os.getenv("API_TOKEN") or None,
        frontend_dist=Path(os.getenv("TODO_FRONTEND_DIST", root / "frontend" / "dist")),
    )
