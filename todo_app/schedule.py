"""When a cadence's meetings happen.

Two kinds of rule, stored as JSON on the cadence:

- ``{"cron": "0 9 * * 4"}``: a 5-field cron expression (minute hour day-of-month month
  day-of-week; ``*``, lists, ranges and ``/`` steps; Sunday is 0 or 7). As in cron, when both
  day fields are restricted a day matches either. Times are local (the app's TZ).
- ``{"nth": 2, "weekday": 1, "time": "10:00"}``: the nth weekday of every month (weekday
  0 = Monday … 6 = Sunday; nth 1–4, or -1 for the last), which cron can't say.

A cadence can instead follow the calendar (``{"calendar": "Weekly Ops"}``): its meetings are
the synced ones whose title contains that text, so there's nothing to compute here.
"""
from __future__ import annotations

import calendar
import re
from datetime import date, datetime, time, timedelta
from typing import Any

from .store import Invalid

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
ORDINALS = {1: "1st", 2: "2nd", 3: "3rd", 4: "4th", -1: "last"}


def _field(spec: str, lo: int, hi: int, name: str) -> set[int]:
    out: set[int] = set()
    for part in spec.split(","):
        m = re.fullmatch(r"(\*|\d+(?:-\d+)?)(?:/(\d+))?", part.strip())
        if not m:
            raise Invalid(f"Can't read the cron {name} field {spec!r}")
        rng, step = m.group(1), int(m.group(2) or 1)
        if rng == "*":
            start, end = lo, hi
        elif "-" in rng:
            start, end = (int(x) for x in rng.split("-"))
        else:
            start = end = int(rng)
            if m.group(2):
                end = hi
        if start < lo or end > hi or start > end or step < 1:
            raise Invalid(f"Cron {name} {part!r} is out of range ({lo}–{hi})")
        out.update(range(start, end + 1, step))
    return out


class Cron:
    def __init__(self, expr: str) -> None:
        parts = expr.split()
        if len(parts) != 5:
            raise Invalid("A cron schedule has 5 fields: minute hour day-of-month month day-of-week")
        self.minutes = _field(parts[0], 0, 59, "minute")
        self.hours = _field(parts[1], 0, 23, "hour")
        self.days = _field(parts[2], 1, 31, "day-of-month")
        self.months = _field(parts[3], 1, 12, "month")
        dows = _field(parts[4], 0, 7, "day-of-week")
        self.dows = {(d - 1) % 7 for d in dows}  # cron 0/7 = Sunday → Python 6
        self.dom_any, self.dow_any = parts[2] == "*", parts[4] == "*"

    def matches_day(self, d: date) -> bool:
        if d.month not in self.months:
            return False
        dom, dow = d.day in self.days, d.weekday() in self.dows
        if self.dom_any or self.dow_any:
            return dom and dow
        return dom or dow

    def times(self) -> list[time]:
        return sorted(time(h, m) for h in self.hours for m in self.minutes)


def validate(schedule: dict[str, Any]) -> dict[str, Any]:
    """Normalize a schedule (raises Invalid with a readable message)."""
    if not isinstance(schedule, dict):
        raise Invalid("schedule must be an object")
    if "calendar" in schedule:
        text = str(schedule["calendar"] or "").strip()
        if not text:
            raise Invalid("A calendar schedule needs the meeting title to look for")
        return {"calendar": text}
    if "cron" in schedule:
        Cron(str(schedule["cron"]))
        return {"cron": " ".join(str(schedule["cron"]).split())}
    if "nth" in schedule:
        nth, weekday = int(schedule["nth"]), int(schedule.get("weekday", -1))
        if nth not in ORDINALS or not 0 <= weekday <= 6:
            raise Invalid("nth is 1–4 or -1 (last), weekday 0 (Monday) – 6 (Sunday)")
        return {"nth": nth, "weekday": weekday, "time": _time(schedule.get("time", "09:00")).strftime("%H:%M")}
    raise Invalid('schedule needs "cron", "nth" + "weekday", or "calendar"')


def _time(value: str) -> time:
    try:
        return time.fromisoformat(str(value))
    except ValueError:
        raise Invalid(f"Can't read the time {value!r}; use HH:MM") from None


def _nth_weekday(year: int, month: int, nth: int, weekday: int) -> date | None:
    days = [d for d in range(1, calendar.monthrange(year, month)[1] + 1) if date(year, month, d).weekday() == weekday]
    if nth == -1:
        return date(year, month, days[-1])
    return date(year, month, days[nth - 1]) if nth <= len(days) else None


def occurrences(schedule: dict[str, Any], start: date, end: date) -> list[datetime]:
    """Meeting times from ``start`` to ``end`` inclusive (local, naive). Calendar schedules → []."""
    out: list[datetime] = []
    if "cron" in schedule:
        cron = Cron(schedule["cron"])
        d = start
        while d <= end:
            if cron.matches_day(d):
                out += [datetime.combine(d, t) for t in cron.times()]
            d += timedelta(days=1)
    elif "nth" in schedule:
        at = _time(schedule["time"])
        y, m = start.year, start.month
        while date(y, m, 1) <= end:
            d = _nth_weekday(y, m, schedule["nth"], schedule["weekday"])
            if d and start <= d <= end:
                out.append(datetime.combine(d, at))
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def describe(schedule: dict[str, Any]) -> str:
    """A human line: "Thursdays at 9:00", "2nd Tuesday of the month at 10:00"."""
    if "calendar" in schedule:
        return f"Follows the calendar: “{schedule['calendar']}”"
    if "nth" in schedule:
        return f"{ORDINALS[schedule['nth']]} {WEEKDAYS[schedule['weekday']]} of the month at {_clock(_time(schedule['time']))}"
    cron = Cron(schedule["cron"])
    times = cron.times()
    when = ", ".join(_clock(t) for t in times[:3]) + ("…" if len(times) > 3 else "")
    parts = schedule["cron"].split()
    if parts[2] == "*" and parts[3] == "*" and parts[4] != "*":
        days = sorted(cron.dows)
        if days == [0, 1, 2, 3, 4]:
            return f"Weekdays at {when}"
        return f"{', '.join(WEEKDAYS[d] + 's' for d in days)} at {when}"
    if parts[2] == "*" and parts[3] == "*" and parts[4] == "*":
        return f"Every day at {when}"
    return f"cron {schedule['cron']}"


def _clock(t: time) -> str:
    return f"{t.hour % 12 or 12}:{t.minute:02d}{'am' if t.hour < 12 else 'pm'}"
