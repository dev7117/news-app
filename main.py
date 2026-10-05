"""Entrypoint: python main.py (serves the UI, /api and /mcp on TODO_PORT, default 7670)."""
import os

from todo_app import telemetry

telemetry.setup("todo-web")  # before the app (and its SQLite connection) exists

import uvicorn  # noqa: E402

from todo_app.app import app  # noqa: E402

if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.getenv("TODO_HOST", "0.0.0.0"),
        port=int(os.getenv("TODO_PORT", "7670")),
        access_log=not telemetry.tracing_enabled(),
        log_config=None,
    )
