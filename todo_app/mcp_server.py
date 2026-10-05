"""MCP server: the todo list and customer hubs as tools for Claude, served at /mcp.

Trust model: Claude reads everything and writes hub content directly (meeting recaps,
upcoming meetings from the calendar, prep notes, overviews, topics, customers/projects),
but every change to tasks, and every customer link, is a *proposal*. The user reviews it as
a diff in the app (Review page) and approves item by item. The setting
review_claude_changes (on by default) controls this; off, proposals apply at once.

Tools are thin adapters over Store / Hub / Review, the same code the web UI uses.
"""
from __future__ import annotations

import functools
import hmac
from typing import Any, Awaitable, Callable, Literal, TypeVar

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.streamable_http_manager import StreamableHTTPASGIApp
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from opentelemetry import trace
from pydantic import BaseModel, Field
from starlette.responses import JSONResponse
from starlette.types import Receive, Scope, Send

from . import telemetry
from .deps import cfg, hub, review, store
from .review import diff_text
from .store import PRIORITY_LABELS, Invalid, NotFound

F = TypeVar("F", bound=Callable[..., Awaitable[Any]])
tracer = trace.get_tracer("todo.mcp")

INSTRUCTIONS = """\
The user's todo list and customer hubs (personal + work). It feeds their desktop bar (today and
in-progress tasks) and gets tasks from the app, a hotkey intake, customer sync scripts, and you.

Model
- Area: "work" or "personal". Customers own projects; projects own tasks. The user plans work
  customer by customer, so file customer work under the right customer's project.
- Task status: inbox → todo → in_progress → waiting (waiting_on says who) → done / cancelled.
  today = "doing it today"; the user curates today and in_progress, so don't set them unless asked.
- Every task has a history (created, field changes, progress notes), each tagged with its source.

You change tasks by proposing
- propose_changes records a batch (create / update / note / complete / add_link) for the user to
  review as a diff and approve in the app. Nothing changes until they do. Give each item a short
  `reason` (the line from the notes that justifies it) and the batch a one-line `summary`.
- Show the user the returned diff and tell them it's waiting in Review. Don't re-propose the
  same changes; check list_proposals if unsure what's pending.
- Use `note` for progress ("Dana sent the contract; review Friday"), not rewriting notes.
  Put ticket links (Jira etc.) in the task's external_url; customer-wide links use add_link.

Customer hub (you write these directly)
- get_customer reads a hub: overview ("where things stand"), topics the customer keeps raising,
  upcoming meetings with prep, recaps, projects, links, and the work needing attention.
- Calendar: sync_calendar mirrors the user's customer meetings for a date window (you read their
  calendar; match each event to a customer by attendee domains / titles, skip internal ones).
  Then write prep with set_meeting_prep: open tasks to raise, waiting items to chase, active
  topics, what changed since the last meeting. Short markdown bullets.
- After a meeting: log_meeting (pass calendar_id when it was a synced event, so the scheduled
  entry becomes the recap) with summary, attendees, decisions and the topics it touched; then
  propose_changes with its meeting_id; then rewrite the overview with set_customer_overview,
  integrating what changed (keep it readable in a minute).

Turning meeting notes into proposals
1. get_overview, then get_customer for the customer.
2. For each action item, search_tasks with its key words (names, systems, customer). Search
   covers closed tasks, so you can tell "already done" from "new". Prefer updating an existing
   task over a near-duplicate; only items the user owns or must chase become tasks.
3. Classify: create / note (progress, optional status) / complete / update (scope, due date,
   link) / nothing. Then one propose_changes call.
- Dates are YYYY-MM-DD; date-times ISO 8601 with offset. In updates, "" clears a field.
"""

mcp = MCPServer(name="todo", title="Todo", instructions=INSTRUCTIONS)

READ = ToolAnnotations(read_only_hint=True, open_world_hint=False)
WRITE = ToolAnnotations(read_only_hint=False, destructive_hint=False, open_world_hint=False)

Area = Literal["work", "personal"]
Status = Literal["inbox", "todo", "in_progress", "waiting", "done", "cancelled"]
Priority = Literal["none", "low", "medium", "high"]


def _tool(annotations: ToolAnnotations) -> Callable[[F], F]:
    """Register a tool: traced, with expected failures returned as readable tool errors."""

    def decorate(fn: F) -> F:
        @functools.wraps(fn)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            with tracer.start_as_current_span(
                "mcp.tool_call", attributes={"mcp.tool.name": fn.__name__}
            ) as span:
                try:
                    return await fn(*args, **kwargs)
                except (NotFound, Invalid, ValueError) as exc:
                    span.set_attribute("mcp.tool.outcome", "error")
                    span.set_attribute("error.message", str(exc)[:200])
                    raise ToolError(str(exc)) from exc
                except Exception as exc:
                    telemetry.record_error(span, exc)
                    raise

        mcp.tool(annotations=annotations)(wrapper)
        return fn

    return decorate


# ----- shapes -----

def _task(t: dict[str, Any], notes: int | None = 200) -> dict[str, Any]:
    out = {
        "id": t["id"],
        "title": t["title"],
        "status": t["status"],
        "area": t["area"],
        "project": t["project"],
        "customer": t["customer"],
        "priority": PRIORITY_LABELS[t["priority"]],
        "due_on": t["due_on"],
        "today": t["today"],
        "overdue": t["overdue"],
        "waiting_on": t["waiting_on"],
        "source": t["source"],
        "external_id": t["external_id"],
        "external_url": t["external_url"],
        "updated_at": t["updated_at"],
        "completed_at": t["completed_at"],
    }
    note_text = t["notes"] or ""
    out["notes"] = note_text if notes is None or len(note_text) <= notes else note_text[:notes] + "…"
    return {k: v for k, v in out.items() if v not in (None, "", False) or k in ("today", "status")}


def _project(p: dict[str, Any]) -> dict[str, Any]:
    return {
        k: p[k]
        for k in ("id", "name", "area", "customer", "description", "archived", "open_count", "overdue_count")
        if k in p and p[k] not in (None, "")
    }


def _customer(c: dict[str, Any]) -> dict[str, Any]:
    return {
        k: c[k]
        for k in ("id", "name", "website", "notes", "archived", "project_count", "open_count", "overdue_count",
                  "last_meeting_on")
        if k in c and c[k] not in (None, "")
    }


def _meeting(m: dict[str, Any], summary: int | None = None) -> dict[str, Any]:
    text = m["summary"] or ""
    out = {
        "id": m["id"],
        "status": m["status"],
        "customer": m.get("customer"),
        "title": m["title"],
        "held_on": m["held_on"],
        "starts_at": m["starts_at"],
        "calendar_id": m["calendar_id"],
        "location": m["location"],
        "project": m.get("project"),
        "attendees": m["attendees"],
        "prep": m["prep"] if summary is None or m["status"] == "scheduled" else None,
        "summary": text if summary is None or len(text) <= summary else text[:summary] + "…",
        "decisions": m["decisions"] if summary is None else None,
        "external_url": m["external_url"],
        "source_label": hub.meeting_source(m) if m["status"] == "held" else None,
    }
    if "tasks" in m:
        out["tasks"] = [{"id": t["id"], "title": t["title"], "status": t["status"], "action": t["action"]}
                        for t in m["tasks"]]
    return {k: v for k, v in out.items() if v not in (None, "")}


def _topic(t: dict[str, Any]) -> dict[str, Any]:
    return {k: t[k] for k in ("id", "name", "summary", "status", "mentions", "last_mentioned_on")}


def _customer_ref(ref: str | int) -> dict[str, Any]:
    return store.resolve_customer(ref, create=False)  # type: ignore[return-value]


def _proposal(cs: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": cs["id"],
        "status": cs["status"],
        "source": cs["source"],
        "customer": cs["customer"],
        "review_url": f"/review?proposal={cs['id']}",
        "changes": [
            {"id": c["id"], "action": c["action"], "task_id": c["task_id"], "title": c["task_title"],
             "status": c["status"], **({"error": c["error"]} if c["error"] else {})}
            for c in cs["changes"]
        ],
        "diff": diff_text(cs),
    }


# ----- reading -----

@_tool(READ)
async def get_overview() -> dict[str, Any]:
    """Start here: customers and projects (with open counts), what's on today / in progress, the
    inbox, upcoming customer meetings this week, pending proposals, and counts."""
    view = store.today_view()
    return {
        "date": view["date"],
        "counts": {**store.counts(), "proposals_pending": review.pending_count()},
        "customers": [_customer(c) for c in store.list_customers()],
        "projects": [_project(p) for p in store.list_projects()],
        "today": [_task(t, notes=0) for t in view["open"]],
        "inbox": [_task(t, notes=0) for t in store.list_tasks(status=["inbox"], limit=50)],
        "upcoming_meetings": [_meeting(m, summary=0) for m in hub.upcoming_meetings(days=7)],
        "settings": store.settings(),
    }


@_tool(READ)
async def list_tasks(
    area: Area | None = None,
    project: str | None = Field(None, description="Project name or id"),
    customer: str | None = Field(None, description="Customer name or id"),
    status: list[Status] | None = Field(None, description="Default: every open status"),
    today: bool | None = Field(None, description="true = only today's, false = only not today"),
    include_closed: bool = Field(False, description="Include done/cancelled when status isn't given"),
    limit: int = Field(100, ge=1, le=500),
) -> list[dict[str, Any]]:
    """List tasks, in-progress first, then by priority and due date. Notes are truncated."""
    project_id = customer_id = None
    if project:
        project_id = store.resolve_project(project)["id"]  # type: ignore[index]
    if customer:
        customer_id = _customer_ref(customer)["id"]
    tasks = store.list_tasks(
        status=status, area=area, project_id=project_id, customer_id=customer_id, today=today,
        include_closed=include_closed, limit=limit,
    )
    return [_task(t) for t in tasks]


@_tool(READ)
async def search_tasks(
    query: str = Field(description="Key words: people, systems, customer, the action. Every word is optional."),
    include_closed: bool = Field(True, description="Also match done/cancelled tasks (to spot already-finished work)"),
    area: Area | None = None,
    limit: int = Field(10, ge=1, le=50),
) -> list[dict[str, Any]]:
    """Full-text search over task titles, notes and history, best match first. Use before
    proposing a task to find one that already tracks the same work. Each hit includes its most
    recent history entries."""
    hits = store.search(query, include_closed=include_closed, area=area, limit=limit)
    out = []
    for hit in hits:
        row = _task(hit, notes=300)
        row["score"] = hit["score"]
        row["recent_history"] = [
            f"{u['created_at'][:10]} {u['source']}: {u['body']}"
            for u in store.task_updates(hit["id"])[-3:]
            if u["body"]
        ]
        out.append(row)
    return out


@_tool(READ)
async def get_task(task_id: int) -> dict[str, Any]:
    """One task with full notes, its whole history, and the meetings it came up in."""
    task = store.get_task(task_id, with_updates=True)
    out = _task(task, notes=None)
    out["history"] = [
        {"at": u["created_at"], "kind": u["kind"], "source": u["source"], "text": u["body"]}
        for u in task["updates"]
    ]
    out["meetings"] = hub.meetings_for_task(task_id)
    return out


@_tool(READ)
async def list_customers(include_archived: bool = False) -> list[dict[str, Any]]:
    """Customers with website, notes, last meeting and project/open/overdue counts."""
    return [_customer(c) for c in store.list_customers(include_archived=include_archived)]


@_tool(READ)
async def get_customer(customer: str = Field(description="Customer name or id")) -> dict[str, Any]:
    """A customer's hub: profile, overview, topics, upcoming meetings (with prep), recent recaps,
    projects, links, and the open work that needs attention."""
    view = hub.customer_hub(_customer_ref(customer)["id"])
    c = view["customer"]
    return {
        "customer": _customer(c),
        "overview": c["overview"] or None,
        "overview_updated_at": c["overview_updated_at"],
        "counts": {k: c[k] for k in ("open_count", "in_progress_count", "waiting_count", "overdue_count")},
        "projects": [_project(p) for p in view["projects"]],
        "topics": [_topic(t) for t in view["topics"]],
        "upcoming_meetings": [_meeting(m, summary=0) for m in view["upcoming"]],
        "recent_meetings": [_meeting(m, summary=500) for m in view["meetings"]],
        "needs_attention": [_task(t, notes=0) for t in view["next_up"]],
        "links": [{"label": l["label"], "url": l["url"]} for l in view["links"] if l["kind"] == "link"],
    }


@_tool(READ)
async def list_meetings(
    customer: str = Field(description="Customer name or id"),
    limit: int = Field(20, ge=1, le=200),
) -> list[dict[str, Any]]:
    """A customer's meeting recaps, newest first (summaries truncated; get_meeting for all of one)."""
    return [_meeting(m, summary=300) for m in hub.list_meetings(_customer_ref(customer)["id"], limit=limit)]


@_tool(READ)
async def list_upcoming_meetings(
    days: int = Field(7, ge=1, le=60),
    customer: str | None = Field(None, description="Customer name or id; default all customers"),
) -> list[dict[str, Any]]:
    """Scheduled customer meetings from today through the next `days` days, with prep."""
    customer_id = _customer_ref(customer)["id"] if customer else None
    return [_meeting(m, summary=0) for m in hub.upcoming_meetings(customer_id=customer_id, days=days)]


@_tool(READ)
async def get_meeting(meeting_id: int) -> dict[str, Any]:
    """One meeting in full (prep, recap, decisions) with the tasks it created or updated."""
    return _meeting(hub.get_meeting(meeting_id))


@_tool(READ)
async def list_projects(include_archived: bool = False) -> list[dict[str, Any]]:
    """Projects with area, customer and open/overdue task counts."""
    return [_project(p) for p in store.list_projects(include_archived=include_archived)]


@_tool(READ)
async def list_proposals(
    status: Literal["pending", "applied", "partial", "rejected"] | None = Field(
        "pending", description="Default: still waiting for the user"
    ),
    limit: int = Field(20, ge=1, le=100),
) -> list[dict[str, Any]]:
    """Proposals you (or earlier sessions) made, and whether the user applied them."""
    return [
        {k: cs[k] for k in ("id", "status", "source", "summary", "customer", "change_count", "created_at", "decided_at")}
        for cs in review.list(status=status, limit=limit)
    ]


@_tool(READ)
async def get_proposal(proposal_id: int) -> dict[str, Any]:
    """One proposal as a diff, with each change's status (pending / applied / rejected / failed)."""
    return _proposal(review.get(proposal_id))


# ----- proposing task changes -----

class ChangeItem(BaseModel):
    action: Literal["create", "update", "note", "complete", "add_link"] = Field(
        description="create = new task; update = change fields; note = log progress (status optional); "
        "complete = mark done; add_link = bookmark a URL on the customer's hub"
    )
    task_id: int | None = Field(None, description="Required for update, note and complete")
    title: str | None = None
    notes: str | None = Field(None, description="create: the task's notes. update: replaces them")
    area: Area | None = None
    project: str | None = Field(None, description='Project name or id; "" removes')
    status: Status | None = None
    priority: Priority | None = None
    due_on: str | None = Field(None, description='YYYY-MM-DD; "" clears')
    today: bool | None = None
    waiting_on: str | None = None
    external_url: str | None = Field(None, description="Ticket link (e.g. the Jira issue) for the task")
    note: str | None = Field(None, description="Progress note for the history. Required for action 'note'.")
    reason: str | None = Field(None, description="Why: the line from the notes/conversation behind this change")
    customer: str | None = Field(None, description="add_link: customer name or id (default: the meeting's customer)")
    label: str | None = Field(None, description="add_link: e.g. 'Jira board'")
    url: str | None = Field(None, description="add_link: https://…")


@_tool(WRITE)
async def propose_changes(
    items: list[ChangeItem] = Field(description="Every change from this source"),
    summary: str = Field(description="One line for the review list, e.g. 'Acme weekly: 2 new, 1 done, SSO update'"),
    meeting_id: int | None = Field(None, description="The meeting (from log_meeting) these came from"),
    source: str | None = Field(None, description="Without a meeting, where these came from, e.g. 'email: Acme renewal'"),
    customer: str | None = Field(None, description="The customer these are about, if no meeting"),
) -> dict[str, Any]:
    """Propose task changes (and customer links) for the user to review as a diff and approve in
    the app. Nothing changes until they approve. Returns the proposal with its diff; show the
    diff to the user and point them to Review."""
    meeting = hub.get_meeting(meeting_id) if meeting_id else None
    label = source or (hub.meeting_source(meeting) if meeting else None)
    if not label:
        raise Invalid("Give meeting_id or source")
    customer_id = _customer_ref(customer)["id"] if customer else None
    with tracer.start_as_current_span(
        "proposal.create",
        attributes={"proposal.source": label, "proposal.count": len(items), "proposal.meeting_id": meeting_id or 0},
    ) as span:
        cs = review.propose(
            [i.model_dump(exclude_none=True) for i in items], source=label, summary=summary,
            meeting_id=meeting_id, customer_id=customer_id,
        )
        span.set_attribute("proposal.id", cs["id"])
        span.set_attribute("proposal.auto_applied", cs["status"] != "pending")
    out = _proposal(cs)
    out["next"] = (
        "Waiting for the user to review in the app (Review)." if cs["status"] == "pending"
        else "Review is off in settings, so these were applied immediately."
    )
    return out


# ----- customer hub (direct writes) -----

class TopicInput(BaseModel):
    name: str = Field(description="Short noun phrase, e.g. 'SSO rollout', 'Renewal pricing'. Reuse existing names.")
    summary: str | None = Field(None, description="Where this topic stands now, 1-2 sentences")
    status: Literal["active", "watching", "resolved"] | None = None


class CalendarEvent(BaseModel):
    calendar_id: str = Field(description="The calendar event's id (stable across syncs)")
    customer: str = Field(description="Customer name or id this meeting is with")
    title: str
    starts_at: str = Field(description="ISO 8601 with offset, e.g. 2026-10-06T14:00:00-04:00")
    ends_at: str | None = None
    attendees: str = Field("", description="Comma-separated names / emails")
    location: str | None = Field(None, description="Video link or room")


@_tool(WRITE)
async def sync_calendar(
    events: list[CalendarEvent] = Field(description="Every customer meeting in the window (skip internal ones)"),
    window_start: str = Field(description="YYYY-MM-DD, first day you read"),
    window_end: str = Field(description="YYYY-MM-DD, last day you read"),
) -> dict[str, Any]:
    """Mirror the user's upcoming customer meetings into their hubs. Events are matched by
    calendar_id; scheduled meetings in the window that are no longer on the calendar become
    cancelled. Then write prep for each with set_meeting_prep."""
    resolved = []
    for event in events:
        data = event.model_dump()
        data["customer_id"] = _customer_ref(data.pop("customer"))["id"]
        resolved.append(data)
    with tracer.start_as_current_span("calendar.sync", attributes={"calendar.events": len(events)}) as span:
        result = hub.sync_calendar(resolved, window_start=window_start, window_end=window_end)
        span.set_attributes({f"calendar.{k}": len(v) for k, v in result.items()})
    return {**result, "upcoming": [_meeting(m, summary=0) for m in hub.upcoming_meetings(days=14)]}


@_tool(WRITE)
async def set_meeting_prep(
    meeting_id: int,
    prep: str = Field(description="Markdown bullets: tasks to raise, items to chase, active topics, what changed"),
) -> dict[str, Any]:
    """Write (replace) the prep notes for an upcoming meeting."""
    return _meeting(hub.update_meeting(meeting_id, prep=prep), summary=0)


@_tool(WRITE)
async def log_meeting(
    customer: str = Field(description="Customer name or id"),
    title: str = Field(description="e.g. 'Weekly sync', 'Renewal call'"),
    held_on: str = Field(description="YYYY-MM-DD"),
    summary: str = Field(description="The recap in markdown: what was discussed, in short bullets or paragraphs"),
    attendees: str = Field("", description="Comma-separated names (and roles if useful)"),
    decisions: str = Field("", description="Decisions made, markdown bullets"),
    project: str | None = Field(None, description="The customer's project it was about, if one"),
    external_url: str | None = Field(None, description="Link to the recording, transcript or notes doc"),
    calendar_id: str | None = Field(None, description="The calendar event, if it was synced: that entry becomes the recap"),
    topics: list[TopicInput] = Field(default_factory=list, description="Topics discussed; matched to existing ones by name"),
) -> dict[str, Any]:
    """Save a meeting recap to the customer's hub and record the topics it touched. Returns the
    meeting id: pass it to propose_changes so the tasks from this meeting link back to it."""
    target = _customer_ref(customer)
    project_id = store.resolve_project(project)["id"] if project else None  # type: ignore[index]
    with store.tx():
        scheduled = hub.find_meeting_by_calendar_id(calendar_id) if calendar_id else None
        if scheduled:
            meeting = hub.update_meeting(
                scheduled["id"], status="held", title=title, held_on=held_on, attendees=attendees or None,
                summary=summary, decisions=decisions, project_id=project_id,
                **({"external_url": external_url} if external_url else {}),
            )
        else:
            meeting = hub.create_meeting(
                target["id"], title=title, held_on=held_on, attendees=attendees, summary=summary,
                decisions=decisions, project_id=project_id, external_url=external_url, source="mcp",
            )
        if topics:
            hub.upsert_topics(target["id"], [t.model_dump() for t in topics], mentioned_on=meeting["held_on"])
    return _meeting(meeting)


@_tool(WRITE)
async def update_meeting(
    meeting_id: int,
    title: str | None = None,
    held_on: str | None = None,
    summary: str | None = None,
    attendees: str | None = None,
    decisions: str | None = None,
    external_url: str | None = None,
) -> dict[str, Any]:
    """Correct or extend a meeting recap. Omitted fields stay as they are."""
    return _meeting(hub.update_meeting(
        meeting_id, title=title, held_on=held_on, summary=summary, attendees=attendees,
        decisions=decisions, **({"external_url": external_url} if external_url is not None else {}),
    ))


@_tool(WRITE)
async def set_customer_overview(
    customer: str = Field(description="Customer name or id"),
    overview: str = Field(description="The whole overview, markdown: current state, open threads, risks, next milestones"),
) -> dict[str, Any]:
    """Replace the customer's "where things stand" overview. Read the current one (get_customer)
    and integrate what changed; keep it short enough to read in a minute."""
    target = _customer_ref(customer)
    c = store.update_customer(target["id"], overview=overview, overview_source="mcp")
    return {"customer": c["name"], "overview_updated_at": c["overview_updated_at"]}


@_tool(WRITE)
async def update_topics(
    customer: str = Field(description="Customer name or id"),
    topics: list[TopicInput] = Field(description="Topics to add or update, matched by name"),
    mentioned_on: str | None = Field(None, description="YYYY-MM-DD the topics came up (default today)"),
) -> list[dict[str, Any]]:
    """Add or update what the customer is talking about, e.g. mark a topic resolved."""
    target = _customer_ref(customer)
    return [_topic(t) for t in hub.upsert_topics(target["id"], [t.model_dump() for t in topics], mentioned_on=mentioned_on)]


@_tool(WRITE)
async def create_customer(
    name: str,
    website: str | None = Field(None, description="Their domain or homepage"),
    notes: str = Field("", description="Who they are, contacts, how the user works with them"),
) -> dict[str, Any]:
    """Create a customer. Ask the user first unless they asked for it; check list_customers for
    an existing one under a slightly different name."""
    return _customer(store.create_customer(name, notes, website))


@_tool(WRITE)
async def update_customer(
    customer: str = Field(description="Customer name or id"),
    name: str | None = None,
    notes: str | None = Field(None, description="Who they are, contacts, how the user works with them"),
    website: str | None = None,
) -> dict[str, Any]:
    """Rename a customer or update its notes or website. (Overview: set_customer_overview.)"""
    target = _customer_ref(customer)
    extra = {"website": website} if website is not None else {}
    return _customer(store.update_customer(target["id"], name=name, notes=notes, **extra))


@_tool(WRITE)
async def create_project(
    name: str,
    area: Area,
    customer: str | None = Field(None, description="Customer name or id; an unknown name creates the customer"),
    description: str = "",
) -> dict[str, Any]:
    """Create a project. Ask the user first unless they asked for it."""
    return _project(store.create_project(name, area, customer, description))


# ----- HTTP transport -----

def build_asgi_app() -> "McpEndpoint":
    """The /mcp endpoint. Call before startup; run ``mcp.session_manager.run()`` in the lifespan."""
    mcp.streamable_http_app(
        stateless_http=True,
        json_response=True,
        # Reached by LAN IP, so the localhost-only Host check would reject every real
        # client. API_TOKEN locks the endpoint down instead.
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )
    return McpEndpoint(StreamableHTTPASGIApp(mcp.session_manager), cfg.api_token)


class McpEndpoint:
    """ASGI wrapper adding the bearer-token check in front of the MCP transport."""

    def __init__(self, app: StreamableHTTPASGIApp, token: str | None) -> None:
        self.app = app
        self.token = token

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if self.token and scope["type"] == "http":
            headers = dict(scope.get("headers") or [])
            supplied = headers.get(b"authorization", b"").decode("latin-1")
            if not hmac.compare_digest(supplied, f"Bearer {self.token}"):
                response = JSONResponse({"detail": "Missing or wrong API token"}, status_code=401)
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
