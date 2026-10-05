"""Optional OpenTelemetry tracing and JSON logging.

Everything here is opt-in and configured purely from the standard OTEL_* env
vars, so the same image runs with or without an observability stack:

- No OTEL_EXPORTER_OTLP_ENDPOINT: nothing is exported, nothing is patched, and
  logging keeps each process's existing plain-text format.
- With it set: traces go over OTLP/HTTP to that collector, logs become one JSON
  object per line carrying trace_id/span_id, and SQLite plus (via FastAPI's
  native telemetry) every request are traced.

LOG_FORMAT=json turns on JSON logs without tracing; LOG_FORMAT=text forces
plain text even with tracing on.
"""
from __future__ import annotations

import json
import logging
import os
import re
import sys
from typing import Any

from opentelemetry import context, trace
from opentelemetry.sdk.trace.id_generator import RandomIdGenerator
from opentelemetry.sdk.trace.sampling import Decision, Sampler, SamplingResult

log = logging.getLogger(__name__)

_tracing = False
_json_logs = False
_configured = False

# GET endpoints polled every few seconds (the bar widget), plus the SPA and its
# static assets. A trace per poll would bury the real work.
_POLLING_GET = re.compile(r"/health|/api/bar|/api/agents|/api/runs/\d+|/api/(links|customers)/\d+/runs")

# The SQLite instrumentation names spans after the statement's first keyword.
# Outside any request or job (the print worker's idle queue poll, the web
# watcher's scan) those queries would each become a one-span trace, so the
# sampler drops them when they would start a trace.
_SQL_SPAN_NAMES = frozenset(
    {"SELECT", "INSERT", "UPDATE", "DELETE", "REPLACE", "WITH", "BEGIN", "COMMIT",
     "ROLLBACK", "PRAGMA", "CREATE", "ALTER", "DROP", "todo.db"}
)


def tracing_enabled() -> bool:
    return _tracing


def json_logs_enabled() -> bool:
    return _json_logs


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        ctx = trace.get_current_span().get_span_context()
        if ctx.is_valid:
            out["trace_id"] = format(ctx.trace_id, "032x")
            out["span_id"] = format(ctx.span_id, "016x")
        if record.exc_info:
            out["exception"] = self.formatException(record.exc_info)
        return json.dumps(out, default=str)


def _setup_json_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), handlers=[handler], force=True)
    # uvicorn installs its own handlers; route them through ours.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.propagate = True


def setup(service_name: str) -> None:
    """Configure logging and tracing for this process. Call once, first thing.

    Must run before the database is opened (SQLite tracing patches
    sqlite3.connect) and before the FastAPI app is created.
    """
    global _tracing, _json_logs, _configured
    if _configured:
        return
    _configured = True

    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT") or os.getenv(
        "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"
    )
    log_format = os.getenv("LOG_FORMAT", "").strip().lower()
    _json_logs = log_format == "json" or (bool(endpoint) and log_format != "text")
    if _json_logs:
        _setup_json_logging()
    if not endpoint:
        return

    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.sdk.trace.sampling import ParentBased

    os.environ.setdefault("OTEL_SERVICE_NAME", service_name)
    resource = Resource.create({"service.version": os.getenv("GIT_SHA", "dev")})
    provider = TracerProvider(resource=resource, sampler=ParentBased(root=_RootNoiseFilter()))
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)

    from opentelemetry.instrumentation.sqlite3 import SQLite3Instrumentor

    SQLite3Instrumentor().instrument()
    _tracing = True
    log.info("Tracing enabled: service=%s endpoint=%s", os.environ["OTEL_SERVICE_NAME"], endpoint)


def shutdown() -> None:
    """Flush buffered spans. Safe to call when tracing is off."""
    if not _tracing:
        return
    provider = trace.get_tracer_provider()
    if hasattr(provider, "shutdown"):
        provider.shutdown()


def is_polling_request(scope: dict[str, Any]) -> bool:
    if scope.get("type") != "http":
        return False
    if scope.get("method") == "POST" and scope.get("path") == "/api/agent/poll":
        return True
    if scope.get("method") != "GET":
        return False
    path = scope.get("path", "")
    if not path.startswith(("/api/", "/mcp")):
        return True  # SPA pages and /assets
    return _POLLING_GET.fullmatch(path) is not None


def fastapi_telemetry() -> dict[str, Any]:
    """`FastAPI(telemetry=...)` settings.

    FastAPI traces requests natively once a tracer provider is set (setup() does
    that only when tracing is on). Its own env-based exporter setup is disabled
    so it can't attach a second exporter to ours.
    """
    return {"auto_configure": False, "exclude": is_polling_request}


def instrument_fastapi(app: Any) -> None:
    if _tracing:
        app.add_middleware(_UnsampledPolling)


class _UnsampledPolling:
    """ASGI middleware: run excluded polling requests under an unsampled parent.

    FastAPI's exclude hook only skips its own request span. Without this, the
    SQLite queries those requests make would each start a
    trace of their own.
    """

    _ids = RandomIdGenerator()

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if not is_polling_request(scope):
            await self.app(scope, receive, send)
            return
        parent = trace.NonRecordingSpan(
            trace.SpanContext(
                trace_id=self._ids.generate_trace_id(),
                span_id=self._ids.generate_span_id(),
                is_remote=False,
                trace_flags=trace.TraceFlags(trace.TraceFlags.DEFAULT),
            )
        )
        token = context.attach(trace.set_span_in_context(parent))
        try:
            await self.app(scope, receive, send)
        finally:
            context.detach(token)


def record_error(span: trace.Span, error: BaseException) -> None:
    span.record_exception(error)
    span.set_status(trace.Status(trace.StatusCode.ERROR, str(error)[:200]))


class _RootNoiseFilter(Sampler):
    """Root-span sampler: keep everything except orphan SQL queries.

    Wrapped in ParentBased, so it only decides for spans that start a trace.
    """

    def should_sample(self, parent_context, trace_id, name, kind=None,
                      attributes=None, links=None, trace_state=None):
        if kind == trace.SpanKind.CLIENT and name in _SQL_SPAN_NAMES:
            return SamplingResult(Decision.DROP, None, trace_state)
        return SamplingResult(Decision.RECORD_AND_SAMPLE, attributes, trace_state)

    def get_description(self) -> str:
        return "RootNoiseFilter"
