"""A task's timeline: everything that happened to it, oldest first, typed for display.

Built from the task's history (task_updates: created, field changes, notes, subtasks) plus
the meetings it came up in. A history entry from a meeting carries that meeting's id; a
meeting that's linked to the task but left no entry gets an event of its own.
"""
from __future__ import annotations

from typing import Any

from .hub import Hub
from .store import Store

# Entries written before history had an `event` column are typed from their text.
def _event_of(update: dict[str, Any]) -> str:
    if update.get("event"):
        return update["event"]
    body = update["body"]
    if update["kind"] != "change":
        return update["kind"]
    if "Status:" in body and "→ Done" in body:
        return "completed"
    if "Status:" in body and "→ Cancelled" in body:
        return "cancelled"
    if "Status:" in body:
        return "status"
    if body.startswith("Added to today"):
        return "today"
    return "change"


TITLES = {
    "created": "Created",
    "note": "Note",
    "status": "Status changed",
    "completed": "Completed",
    "cancelled": "Cancelled",
    "today": "Put on today",
    "change": "Updated",
    "subtask_added": "Subtask added",
    "subtask_done": "Subtask done",
    "subtask_reopened": "Subtask reopened",
    "subtask_removed": "Subtask removed",
    "meeting": "Meeting",
    "assigned": "Assigned",
    "followed": "Followers",
}


def build(store: Store, hub: Hub, task_id: int) -> list[dict[str, Any]]:
    task = store.get_task(task_id)
    meetings = hub.meetings_for_task(task_id)
    by_source = {hub.meeting_source(m): m for m in meetings}
    events: list[dict[str, Any]] = []
    used_meetings: set[int] = set()
    for update in store.task_updates(task_id):
        event = _event_of(update)
        meeting = by_source.get(update["source"])
        if meeting:
            used_meetings.add(meeting["id"])
        events.append({
            "id": f"u{update['id']}",
            "at": update["created_at"],
            "type": event,
            "title": TITLES.get(event, "Updated"),
            "detail": update["body"],
            "source": update["source"],
            "meeting_id": meeting["id"] if meeting else None,
            "meeting_title": meeting["title"] if meeting else None,
        })
    for meeting in meetings:
        if meeting["id"] not in used_meetings:
            events.append({
                "id": f"m{meeting['id']}",
                "at": f"{meeting['held_on']}T12:00:00+00:00",
                "type": "meeting",
                "title": meeting["title"],
                "detail": f"Came up in {meeting['title']}",
                "source": hub.meeting_source(meeting),
                "meeting_id": meeting["id"],
                "meeting_title": meeting["title"],
            })
    events.sort(key=lambda e: e["at"])
    return [{**e, "task_status": task["status"]} for e in events]
