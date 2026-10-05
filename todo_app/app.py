"""FastAPI app: REST API, MCP endpoint and the React SPA."""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from starlette.routing import Route

from . import telemetry
from .api import router
from .deps import cfg
from .mcp_server import build_asgi_app, mcp
from .store import Invalid, NotFound


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        async with mcp.session_manager.run():
            yield
    finally:
        telemetry.shutdown()


app = FastAPI(title="Todo", lifespan=lifespan, telemetry=telemetry.fastapi_telemetry())
telemetry.instrument_fastapi(app)


@app.exception_handler(NotFound)
async def not_found(_: Request, exc: NotFound) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(Invalid)
@app.exception_handler(ValueError)
async def invalid(_: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(router)

# MCP (streamable HTTP) for Claude; registered before the SPA catch-all.
app.router.routes.append(Route("/mcp", build_asgi_app(), methods=["GET", "POST", "DELETE"]))

AGENT_DIST = Path(__file__).parent / "agent_dist"


@app.get("/agent/install.sh", include_in_schema=False)
def agent_installer(request: Request) -> PlainTextResponse:
    """`curl -fsSL http://<todo>/agent/install.sh | sh` installs todo-agent pointed back at this server."""
    base = str(request.base_url).rstrip("/")
    return PlainTextResponse((AGENT_DIST / "install.sh").read_text().replace("__URL__", base),
                             media_type="text/x-shellscript")


@app.get("/agent/todo-agent.py", include_in_schema=False)
def agent_script() -> FileResponse:
    return FileResponse(AGENT_DIST / "todo-agent.py", media_type="text/x-python")


DIST = cfg.frontend_dist
if (DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/{full_path:path}", include_in_schema=False)
def spa(full_path: str):
    if full_path.startswith("api/"):
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    file = (DIST / full_path).resolve()
    if full_path and file.is_file() and DIST.resolve() in file.parents:
        return FileResponse(file)
    index = DIST / "index.html"
    if index.exists():
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
    return JSONResponse(status_code=503, content={"detail": "Frontend not built (cd frontend && npm run build)"})
