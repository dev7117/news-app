"""Quick-add syntax, shared by the app's add box, the bar intake and POST /api/tasks/quick.

    Call Dana about the renewal #acme-portal !today !high ^fri

    #project      existing project by name (case-insensitive, - or _ for spaces)
    @work @personal  area (@w / @p); a project implies its area
    @priya        a follower (it stays yours; it shows on their page)
    !today !t     put it on today          !now   on today and in progress
    !idea         save it as an idea instead of a task (kept off boards and today)
    !high !med !low  or !3 !2 !1 priority
    ^today ^tomorrow ^mon..^sun ^2026-10-31 ^10/31   due date
    +priya +priya-shah   assign it to a person (first name when unambiguous)

Tokens can go anywhere; whatever isn't a token is the title. An unknown #project is
left in the title so nothing typed is lost.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any, Callable

_WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
_PRIORITY = {"high": 3, "hi": 3, "3": 3, "med": 2, "medium": 2, "2": 2, "low": 1, "lo": 1, "1": 1}
_AREAS = {"work": "work", "w": "work", "personal": "personal", "p": "personal", "home": "personal"}


def parse_due(token: str, today: date) -> date | None:
    t = token.lower()
    if t in ("today", "tod"):
        return today
    if t in ("tomorrow", "tom", "tmr"):
        return today + timedelta(days=1)
    if t[:3] in _WEEKDAYS and (len(t) == 3 or t.startswith(_full_day(t[:3]))):
        ahead = (_WEEKDAYS.index(t[:3]) - today.weekday()) % 7 or 7
        return today + timedelta(days=ahead)
    if t in ("week", "nextweek"):
        return today + timedelta(days=7 - today.weekday())  # next Monday
    try:
        return date.fromisoformat(t)
    except ValueError:
        pass
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})", t)
    if m:
        month, day = int(m[1]), int(m[2])
        try:
            due = date(today.year, month, day)
        except ValueError:
            return None
        return due if due >= today else date(today.year + 1, month, day)
    return None


def _full_day(prefix: str) -> str:
    return {
        "mon": "monday", "tue": "tuesday", "wed": "wednesday", "thu": "thursday",
        "fri": "friday", "sat": "saturday", "sun": "sunday",
    }[prefix][: len(prefix)]


def parse(
    text: str,
    today: date,
    find_project: Callable[[str], dict[str, Any] | None],
    find_person: Callable[[str], dict[str, Any] | None] | None = None,
) -> dict[str, Any]:
    """Split quick-add text into task fields. Returns fields plus ``title``."""
    fields: dict[str, Any] = {}
    words: list[str] = []
    for word in text.split():
        head, rest = word[:1], word[1:]
        if head == "#" and rest:
            project = find_project(rest)
            if project:
                fields["project_id"] = project["id"]
                continue
        elif head == "@" and rest.lower() in _AREAS:
            fields["area"] = _AREAS[rest.lower()]
            continue
        elif head == "@" and rest and find_person:
            person = find_person(rest)
            if person:
                fields.setdefault("followers", []).append(person["id"])
                continue
        elif head == "!" and rest:
            key = rest.lower()
            if key in ("today", "t"):
                fields["today"] = True
                continue
            if key in ("idea", "i"):
                fields["idea"] = True
                continue
            if key in ("now", "doing"):
                fields["today"] = True
                fields["status"] = "in_progress"
                continue
            if key in _PRIORITY:
                fields["priority"] = _PRIORITY[key]
                continue
        elif head == "+" and rest and find_person:
            person = find_person(rest)
            if person:
                fields["assignee_id"] = person["id"]
                continue
        elif head == "^" and rest:
            due = parse_due(rest, today)
            if due:
                fields["due_on"] = due.isoformat()
                continue
        words.append(word)
    fields["title"] = " ".join(words).strip()
    return fields


def quick_add(
    store: Any,
    text: str,
    *,
    source: str = "app",
    notes: str = "",
    area: str | None = None,
    project_id: int | None = None,
    ideas: Any = None,
    people: Any = None,
) -> dict[str, Any]:
    """Parse and create. Untriaged captures (no project, not for today) land in the inbox.

    ``area`` / ``project_id`` are the caller's focus (the bar's or the app's): used unless
    the text names its own (#project / @area)."""
    fields = parse(text, store.today(), store.find_project, people.find if people else None)
    if not fields["title"]:
        raise ValueError("Type what needs doing")
    if project_id is not None and "project_id" not in fields and "area" not in fields:
        fields["project_id"] = project_id
    if area and "area" not in fields and "project_id" not in fields:
        fields["area"] = area
    followers = fields.pop("followers", [])
    if fields.pop("idea", False):
        if ideas is None:
            raise ValueError("Ideas aren't available here")
        fields.pop("assignee_id", None)
        idea = ideas.create(
            fields["title"], summary=notes, project_id=fields.get("project_id"), source=source,
            area=None if "project_id" in fields else fields.get("area"),
        )
        return {**idea, "kind": "idea"}
    if "project_id" in fields:
        fields.pop("area", None)
    if "status" not in fields:
        triaged = "project_id" in fields or fields.get("today") or "assignee_id" in fields
        fields["status"] = "todo" if triaged else "inbox"
    if notes:
        fields["notes"] = notes
    task = store.create_task(fields, source=source)
    if followers:
        task = store.set_followers(task["id"], followers, source=source)
    return {**task, "kind": "task"}
