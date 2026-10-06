from datetime import date, datetime

import pytest

from todo_app.schedule import describe, occurrences, validate
from todo_app.store import Invalid


def test_weekly_cron():
    s = validate({"cron": "0 9 * * 4"})
    got = occurrences(s, date(2026, 10, 1), date(2026, 10, 31))
    assert got == [datetime(2026, 10, d, 9, 0) for d in (1, 8, 15, 22, 29)]
    assert describe(s) == "Thursdays at 9:00am"


def test_cron_lists_ranges_steps_and_sunday():
    s = validate({"cron": "30 8,14 * * 1-5"})
    assert describe(s) == "Weekdays at 8:30am, 2:30pm"
    assert len(occurrences(s, date(2026, 10, 5), date(2026, 10, 11))) == 10
    assert occurrences({"cron": "0 10 * * 0"}, date(2026, 10, 1), date(2026, 10, 7)) == [datetime(2026, 10, 4, 10)]
    assert occurrences({"cron": "0 10 * * 7"}, date(2026, 10, 1), date(2026, 10, 7)) == [datetime(2026, 10, 4, 10)]
    assert len(occurrences({"cron": "0 9 1,15 * *"}, date(2026, 10, 1), date(2026, 10, 31))) == 2


def test_nth_weekday_of_month():
    s = validate({"nth": 2, "weekday": 1, "time": "10:00"})
    assert occurrences(s, date(2026, 10, 1), date(2026, 12, 31)) == [
        datetime(2026, 10, 13, 10), datetime(2026, 11, 10, 10), datetime(2026, 12, 8, 10)]
    assert describe(s) == "2nd Tuesday of the month at 10:00am"
    last = validate({"nth": -1, "weekday": 4, "time": "15:30"})
    assert occurrences(last, date(2026, 10, 1), date(2026, 10, 31)) == [datetime(2026, 10, 30, 15, 30)]


def test_calendar_and_bad_schedules():
    assert validate({"calendar": " Weekly Ops "}) == {"calendar": "Weekly Ops"}
    assert occurrences({"calendar": "x"}, date(2026, 1, 1), date(2026, 2, 1)) == []
    for bad in ({"cron": "0 9 * *"}, {"cron": "61 9 * * *"}, {"nth": 5, "weekday": 1}, {}, {"calendar": ""}):
        with pytest.raises(Invalid):
            validate(bad)
