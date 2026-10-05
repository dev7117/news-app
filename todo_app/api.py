"""REST API under /api for the web UI, the bar widget and sync scripts."""
from __future__ import annotations

import asyncio
import hmac
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from opentelemetry import trace
from pydantic import BaseModel, Field

from . import quickadd
from .deps import agents, cfg, hub, review, store
from .store import AREAS, CLOSED_STATUSES, STATUSES, STATUS_LABELS

router = APIRouter(prefix="/api")
tracer = trace.get_tracer("todo.api")

Area = Literal["work", "personal"]
Status = Literal["inbox", "todo", "in_progress", "waiting", "done", "cancelled"]


def require_token(authorization: str = Header(default="")) -> None:
    """Machine-facing endpoints: bearer API_TOKEN when one is configured."""
    if cfg.api_token and not hmac.compare_digest(authorization, f"Bearer {cfg.api_token}"):
        raise HTTPException(status_code=401, detail="Missing or wrong API token")


# ----- meta / settings -----

class SettingsIn(BaseModel):
    default_area: Area | None = None
    review_claude_changes: bool | None = None


@router.get("/meta")
def meta() -> dict[str, Any]:
    return {
        "areas": list(AREAS),
        "statuses": [{"id": s, "label": STATUS_LABELS[s], "closed": s in CLOSED_STATUSES} for s in STATUSES],
        "settings": store.settings(),
        "token_required": bool(cfg.api_token),
    }


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return store.settings()


@router.put("/settings")
def put_settings(body: SettingsIn) -> dict[str, Any]:
    return store.update_settings(default_area=body.default_area, review_claude_changes=body.review_claude_changes)


# ----- customers -----

class CustomerIn(BaseModel):
    name: str
    notes: str = ""
    website: str | None = None


class CustomerPatch(BaseModel):
    name: str | None = None
    notes: str | None = None
    website: str | None = None
    overview: str | None = None
    archived: bool | None = None


@router.get("/customers")
def list_customers(include_archived: bool = False) -> list[dict[str, Any]]:
    return store.list_customers(include_archived=include_archived)


@router.post("/customers", status_code=201)
def create_customer(body: CustomerIn) -> dict[str, Any]:
    return store.create_customer(body.name, body.notes, body.website)


@router.patch("/customers/{customer_id}")
def update_customer(customer_id: int, body: CustomerPatch) -> dict[str, Any]:
    return store.update_customer(customer_id, **body.model_dump(exclude_unset=True), overview_source="app")


@router.get("/customers/{customer_id}/hub")
def customer_hub(customer_id: int) -> dict[str, Any]:
    return hub.customer_hub(customer_id)


@router.get("/customers/{customer_id}/logo", include_in_schema=False)
def customer_logo(customer_id: int) -> Response:
    path = hub.logo_file(customer_id)
    if not path:
        raise HTTPException(status_code=404, detail="No logo")
    # The file name changes with its content, so the URL (?v=<logo>) can be cached for good.
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.put("/customers/{customer_id}/logo")
async def upload_logo(customer_id: int, request: Request) -> dict[str, Any]:
    """Raw image body (Content-Type: image/png etc.)."""
    return hub.set_logo(customer_id, await request.body(), request.headers.get("content-type", ""))


@router.post("/customers/{customer_id}/logo/fetch")
def fetch_logo(customer_id: int) -> dict[str, Any]:
    with tracer.start_as_current_span("customer.logo_fetch", attributes={"customer.id": customer_id}):
        return hub.fetch_logo(customer_id)


@router.delete("/customers/{customer_id}/logo")
def delete_logo(customer_id: int) -> dict[str, Any]:
    return hub.clear_logo(customer_id)


# ----- meetings -----

class MeetingIn(BaseModel):
    title: str
    held_on: str
    attendees: str = ""
    summary: str = ""
    decisions: str = ""
    project_id: int | None = None
    external_url: str | None = None


class MeetingPatch(BaseModel):
    prep: str | None = None
    status: Literal["scheduled", "held", "cancelled"] | None = None
    title: str | None = None
    held_on: str | None = None
    attendees: str | None = None
    summary: str | None = None
    decisions: str | None = None
    project_id: int | None = None
    external_url: str | None = None


@router.get("/customers/{customer_id}/meetings")
def list_meetings(customer_id: int, limit: int = 200) -> list[dict[str, Any]]:
    store.get_customer(customer_id)
    return hub.list_meetings(customer_id, limit=limit)


@router.post("/customers/{customer_id}/meetings", status_code=201)
def create_meeting(customer_id: int, body: MeetingIn) -> dict[str, Any]:
    return hub.create_meeting(customer_id, **body.model_dump(), source="app")


@router.get("/meetings/upcoming")
def upcoming_meetings(days: int = Query(default=7, ge=1, le=60), area: Area | None = None) -> list[dict[str, Any]]:
    # Customer meetings are work; the personal focus has none.
    return [] if area == "personal" else hub.upcoming_meetings(days=days)


@router.get("/meetings/{meeting_id}")
def get_meeting(meeting_id: int) -> dict[str, Any]:
    return hub.get_meeting(meeting_id)


@router.patch("/meetings/{meeting_id}")
def update_meeting(meeting_id: int, body: MeetingPatch) -> dict[str, Any]:
    return hub.update_meeting(meeting_id, **body.model_dump(exclude_unset=True))


@router.delete("/meetings/{meeting_id}", status_code=204)
def delete_meeting(meeting_id: int) -> None:
    hub.delete_meeting(meeting_id)


# ----- topics -----

class TopicIn(BaseModel):
    name: str
    summary: str | None = None
    status: Literal["active", "watching", "resolved"] | None = None


class TopicPatch(BaseModel):
    name: str | None = None
    summary: str | None = None
    status: Literal["active", "watching", "resolved"] | None = None


@router.post("/customers/{customer_id}/topics", status_code=201)
def add_topic(customer_id: int, body: TopicIn) -> list[dict[str, Any]]:
    return hub.upsert_topics(customer_id, [body.model_dump()])


@router.patch("/topics/{topic_id}")
def update_topic(topic_id: int, body: TopicPatch) -> dict[str, Any]:
    return hub.update_topic(topic_id, **body.model_dump(exclude_unset=True))


@router.delete("/topics/{topic_id}", status_code=204)
def delete_topic(topic_id: int) -> None:
    hub.delete_topic(topic_id)


# ----- links and desktop launchers -----

class LinkIn(BaseModel):
    kind: Literal["link", "launcher"]
    label: str
    url: str | None = None
    command: str | None = None
    cwd: str | None = None
    mode: Literal["terminal", "background"] = "terminal"
    agent: str | None = Field(default=None, description="Machine to run on; null = pick at run time")


class LinkPatch(BaseModel):
    label: str | None = None
    url: str | None = None
    command: str | None = None
    cwd: str | None = None
    mode: Literal["terminal", "background"] | None = None
    agent: str | None = None


@router.post("/customers/{customer_id}/links", status_code=201)
def create_link(customer_id: int, body: LinkIn) -> dict[str, Any]:
    fields = body.model_dump()
    return hub.create_link(customer_id, fields.pop("kind"), **fields)


@router.patch("/links/{link_id}")
def update_link(link_id: int, body: LinkPatch) -> dict[str, Any]:
    return hub.update_link(link_id, **body.model_dump(exclude_unset=True))


@router.delete("/links/{link_id}", status_code=204)
def delete_link(link_id: int) -> None:
    hub.delete_link(link_id)


class LinkOrderIn(BaseModel):
    ids: list[int]


@router.put("/customers/{customer_id}/links/order", status_code=204)
def order_links(customer_id: int, body: LinkOrderIn) -> None:
    hub.reorder_links(body.ids)


# ----- machines (todo-agent) and runs -----

class RunIn(BaseModel):
    agent: str | None = Field(default=None, description="Machine name; default: the tool's machine or the only one online")


@router.get("/agents")
def list_agents() -> list[dict[str, Any]]:
    return agents.list()


@router.delete("/agents/{name}", status_code=204)
def delete_agent(name: str) -> None:
    agents.delete(name)


@router.post("/links/{link_id}/run", status_code=201)
def run_launcher(link_id: int, body: RunIn) -> dict[str, Any]:
    with tracer.start_as_current_span("launcher.run", attributes={"link.id": link_id}) as span:
        run = agents.request_run(link_id, body.agent)
        span.set_attributes({"run.id": run["id"], "run.agent": run["agent"], "run.mode": run["mode"]})
    return run


@router.get("/links/{link_id}/runs")
def launcher_runs(link_id: int, limit: int = 10) -> list[dict[str, Any]]:
    return agents.list_runs(link_id=link_id, limit=limit)


@router.get("/customers/{customer_id}/runs")
def customer_runs(customer_id: int, limit: int = 20) -> list[dict[str, Any]]:
    return agents.list_runs(customer_id=customer_id, limit=limit)


@router.get("/runs/{run_id}")
def get_run(run_id: int) -> dict[str, Any]:
    return agents.get_run(run_id)


@router.post("/runs/{run_id}/cancel")
def cancel_run(run_id: int) -> dict[str, Any]:
    return agents.cancel(run_id)


# The agent's side. Token-protected: only your machines can take runs or report on them.

class PollIn(BaseModel):
    name: str
    platform: str
    version: str = ""


class ReportIn(BaseModel):
    name: str
    status: Literal["running", "succeeded", "failed", "declined"] | None = None
    exit_code: int | None = None
    output: str | None = None
    append: bool = True
    error: str | None = None


@router.post("/agent/poll", dependencies=[Depends(require_token)])
async def agent_poll(body: PollIn) -> dict[str, Any]:
    """Long poll: returns a run as soon as one is queued for this machine, else null after ~25s."""
    for tick in range(25):
        if tick % 10 == 0:
            agents.heartbeat(body.name, body.platform, body.version)
        run = agents.claim(body.name)
        if run:
            return {"run": run}
        await asyncio.sleep(1)
    return {"run": None}


@router.post("/agent/ping", dependencies=[Depends(require_token)])
def agent_ping(body: PollIn) -> dict[str, Any]:
    agents.heartbeat(body.name, body.platform, body.version)
    return {"ok": True}


@router.post("/agent/runs/{run_id}", dependencies=[Depends(require_token)])
def agent_report(run_id: int, body: ReportIn) -> dict[str, Any]:
    run = agents.report(
        run_id, body.name, status=body.status, exit_code=body.exit_code, output=body.output,
        append=body.append, error=body.error,
    )
    return {"status": run["status"]}


@router.delete("/customers/{customer_id}", status_code=204)
def delete_customer(customer_id: int) -> None:
    store.delete_customer(customer_id)


# ----- projects -----

class ProjectIn(BaseModel):
    name: str
    area: Area
    customer: str | int | None = Field(default=None, description="Customer id or name; a new name creates it")
    description: str = ""


class ProjectPatch(BaseModel):
    name: str | None = None
    area: Area | None = None
    customer: str | int | None = Field(default=None, description='Customer id or name; null or "" removes it')
    description: str | None = None
    archived: bool | None = None


@router.get("/projects")
def list_projects(include_archived: bool = False) -> list[dict[str, Any]]:
    return store.list_projects(include_archived=include_archived)


@router.post("/projects", status_code=201)
def create_project(body: ProjectIn) -> dict[str, Any]:
    return store.create_project(body.name, body.area, body.customer, body.description)


@router.patch("/projects/{project_id}")
def update_project(project_id: int, body: ProjectPatch) -> dict[str, Any]:
    return store.update_project(project_id, **body.model_dump(exclude_unset=True))


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: int) -> None:
    store.delete_project(project_id)


# ----- tasks -----

class TaskIn(BaseModel):
    title: str
    notes: str = ""
    status: Status = "todo"
    area: Area | None = None
    project_id: int | None = None
    priority: int = Field(default=0, ge=0, le=3)
    due_on: str | None = None
    today: bool = False
    waiting_on: str | None = None
    external_url: str | None = None


class TaskPatch(BaseModel):
    title: str | None = None
    notes: str | None = None
    status: Status | None = None
    area: Area | None = None
    project_id: int | None = None
    priority: int | None = Field(default=None, ge=0, le=3)
    due_on: str | None = None
    today: bool | None = None
    waiting_on: str | None = None
    external_url: str | None = None
    note: str | None = Field(default=None, description="Progress note logged with the change")


class QuickIn(BaseModel):
    text: str
    notes: str = ""
    source: str = "app"
    area: Area | None = Field(default=None, description="The caller's focus; used unless the text has @area/#project")
    project_id: int | None = Field(default=None, description="The caller's project filter, same rule")


class UpdateIn(BaseModel):
    body: str
    status: Status | None = None


class OrderIn(BaseModel):
    ids: list[int]


@router.get("/tasks")
def list_tasks(
    status: list[Status] | None = Query(default=None),
    area: Area | None = None,
    project_id: int | None = None,
    no_project: bool = False,
    customer_id: int | None = None,
    no_customer: bool = False,
    today: bool | None = None,
    source: str | None = None,
    include_closed: bool = False,
    closed_since: str | None = None,
    limit: int = Query(default=500, le=2000),
) -> list[dict[str, Any]]:
    return store.list_tasks(
        status=list(status) if status else None,
        area=area,
        project_id=project_id,
        no_project=no_project,
        customer_id=customer_id,
        no_customer=no_customer,
        today=today,
        source=source,
        include_closed=include_closed,
        closed_since=closed_since,
        limit=limit,
    )


@router.get("/today")
def today(area: Area | None = None, project_id: int | None = None, customer_id: int | None = None) -> dict[str, Any]:
    return store.today_view(area, project_id, customer_id)


@router.put("/today/order")
def order_today(body: OrderIn) -> dict[str, Any]:
    store.reorder_today(body.ids)
    return {"ok": True}


@router.get("/counts")
def counts(area: Area | None = None) -> dict[str, int]:
    return store.counts(area)


@router.get("/bar")
def bar(area: Area | None = None, project_id: int | None = None, customer_id: int | None = None) -> dict[str, Any]:
    """The bar widget's view of its focus. Also lists what it can narrow to in that area."""
    state = store.bar_state(area, project_id, customer_id)
    # Today's customer meetings (work), for the panel.
    state["meetings"] = [] if area == "personal" else [
        {k: m[k] for k in ("id", "customer_id", "customer", "title", "starts_at", "prep")}
        for m in hub.upcoming_meetings(days=0, customer_id=customer_id)
        if project_id is None or m["project_id"] in (None, project_id)
    ]
    projects = [p for p in store.list_projects() if not area or p["area"] == area]
    state["filters"] = {
        "customers": [
            {"id": c["id"], "name": c["name"], "open": c["open_count"]}
            for c in store.list_customers() if area != "personal"
        ],
        "projects": [
            {"id": p["id"], "name": p["name"], "customer_id": p["customer_id"], "area": p["area"], "open": p["open_count"]}
            for p in projects
        ],
    }
    return state


@router.get("/search")
def search(q: str, include_closed: bool = True, area: Area | None = None, limit: int = 30) -> list[dict[str, Any]]:
    return store.search(q, include_closed=include_closed, area=area, limit=limit)


def _task_full(task_id: int) -> dict[str, Any]:
    """A task as the task dialog shows it: history plus the meetings it came up in."""
    return {**store.get_task(task_id, with_updates=True), "meetings": hub.meetings_for_task(task_id)}


@router.get("/tasks/{task_id}")
def get_task(task_id: int) -> dict[str, Any]:
    return _task_full(task_id)


@router.post("/tasks", status_code=201)
def create_task(body: TaskIn) -> dict[str, Any]:
    return store.create_task(body.model_dump(), source="app")


@router.post("/tasks/quick", status_code=201)
def quick_add(body: QuickIn) -> dict[str, Any]:
    source = body.source if body.source in ("app", "intake") else "app"
    return quickadd.quick_add(
        store, body.text, source=source, notes=body.notes, area=body.area, project_id=body.project_id
    )


@router.patch("/tasks/{task_id}")
def update_task(task_id: int, body: TaskPatch) -> dict[str, Any]:
    fields = body.model_dump(exclude_unset=True)
    note = fields.pop("note", None)
    store.update_task(task_id, fields, source="app", note=note)
    return _task_full(task_id)


@router.post("/tasks/{task_id}/updates", status_code=201)
def add_update(task_id: int, body: UpdateIn) -> dict[str, Any]:
    store.add_update(task_id, body.body, source="app", status=body.status)
    return _task_full(task_id)


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: int) -> None:
    store.delete_task(task_id)


# ----- ingest (sync scripts) -----

class IngestTask(BaseModel):
    external_id: str = Field(description="The task's id in the source system (ticket number, etc.)")
    title: str | None = None
    notes: str | None = None
    status: Status | None = None
    area: Area | None = None
    project: str | int | None = Field(default=None, description="Project name or id")
    priority: int | None = Field(default=None, ge=0, le=3)
    due_on: str | None = None
    external_url: str | None = None
    note: str | None = Field(default=None, description="Logged in the task's history")


class IngestIn(BaseModel):
    source: str = Field(description="Short name of the source, e.g. 'jira-acme' or 'zendesk'")
    tasks: list[IngestTask]
    close_missing: bool = Field(
        default=False,
        description="Mark this source's open tasks that aren't in the batch as done "
        "(use when the batch is the complete list of open items)",
    )


@router.post("/ingest", dependencies=[Depends(require_token)])
def ingest(body: IngestIn) -> dict[str, Any]:
    """Idempotent upsert keyed by (source, external_id). Safe to run on a schedule."""
    source = body.source.strip()
    if not source or source in ("app", "intake", "mcp"):
        raise HTTPException(status_code=400, detail="source must name the external system")
    created: list[int] = []
    updated: list[int] = []
    closed: list[int] = []
    with tracer.start_as_current_span(
        "ingest.batch", attributes={"ingest.source": source, "ingest.count": len(body.tasks)}
    ) as span, store.tx():
        for item in body.tasks:
            fields = item.model_dump(exclude_unset=True, exclude={"external_id", "project", "note"})
            if "project" in item.model_fields_set:
                project = store.resolve_project(item.project)
                fields["project_id"] = project["id"] if project else None
            task, was_created = store.upsert_external(source, item.external_id, fields, note=item.note)
            (created if was_created else updated).append(task["id"])
        if body.close_missing:
            seen = {item.external_id for item in body.tasks}
            for task in store.list_tasks(source=source):
                if task["external_id"] and task["external_id"] not in seen:
                    store.update_task(
                        task["id"], {"status": "done"}, source=source, note="No longer open in the source"
                    )
                    closed.append(task["id"])
        span.set_attributes(
            {"ingest.created": len(created), "ingest.updated": len(updated), "ingest.closed": len(closed)}
        )
    return {"created": created, "updated": updated, "closed": closed}


# ----- proposals (Claude's changes awaiting review) -----

class DecideIn(BaseModel):
    approve: list[int] | Literal["all", "none"] = Field(description="Change ids to apply; the rest are rejected")
    edits: dict[int, dict[str, Any]] = Field(default_factory=dict, description="Per change: title/due_on/project_id/priority")


@router.get("/proposals")
def list_proposals(
    status: Literal["pending", "applied", "partial", "rejected"] | None = None,
    limit: int = 50,
    area: Area | None = None,
) -> list[dict[str, Any]]:
    return review.list(status=status, limit=limit, area=area)


@router.get("/proposals/{changeset_id}")
def get_proposal(changeset_id: int) -> dict[str, Any]:
    return review.get(changeset_id)


@router.post("/proposals/{changeset_id}/decide")
def decide_proposal(changeset_id: int, body: DecideIn) -> dict[str, Any]:
    approve = [] if body.approve == "none" else body.approve
    with tracer.start_as_current_span("proposal.decide", attributes={"proposal.id": changeset_id}) as span:
        result = review.decide(changeset_id, approve=approve, edits=body.edits)
        span.set_attribute("proposal.status", result["status"])
    return result
