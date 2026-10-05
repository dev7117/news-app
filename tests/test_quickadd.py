from datetime import date

from todo_app.quickadd import parse, parse_due, quick_add

MONDAY = date(2026, 10, 5)


def test_parse_due():
    assert parse_due("tomorrow", MONDAY) == date(2026, 10, 6)
    assert parse_due("fri", MONDAY) == date(2026, 10, 9)
    assert parse_due("friday", MONDAY) == date(2026, 10, 9)
    assert parse_due("mon", MONDAY) == date(2026, 10, 12)  # next Monday, not today
    assert parse_due("2026-12-01", MONDAY) == date(2026, 12, 1)
    assert parse_due("1/15", MONDAY) == date(2027, 1, 15)
    assert parse_due("frog", MONDAY) is None


def test_parse_tokens(store):
    p = store.create_project("Acme Portal", "work")
    fields = parse("Call Dana #acme-portal !today !high ^fri about renewal", MONDAY, store.find_project)
    assert fields == {
        "title": "Call Dana about renewal",
        "project_id": p["id"],
        "today": True,
        "priority": 3,
        "due_on": "2026-10-09",
    }


def test_unknown_project_stays_in_title(store):
    assert parse("Buy #milk", MONDAY, store.find_project)["title"] == "Buy #milk"


def test_quick_add_inbox_vs_triaged(store):
    assert quick_add(store, "random idea")["status"] == "inbox"
    assert quick_add(store, "do it !t")["status"] == "todo"
    now = quick_add(store, "fix prod !now @p")
    assert now["status"] == "in_progress" and now["today"] and now["area"] == "personal"
