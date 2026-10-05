import pytest

from todo_app.store import Invalid, NotFound


def test_create_defaults_and_history(store):
    task = store.create_task({"title": "  Write report  "}, source="intake", created_note="from the hotkey")
    assert task["title"] == "Write report"
    assert task["status"] == "todo"
    assert task["area"] == "work"  # default_area setting
    assert task["source"] == "intake"
    history = store.task_updates(task["id"])
    assert [(h["kind"], h["body"], h["source"]) for h in history] == [("created", "from the hotkey", "intake")]


def test_project_sets_area_and_conflict_is_rejected(store):
    home = store.create_project("House", "personal")
    task = store.create_task({"title": "Fix gutter", "project_id": home["id"]})
    assert task["area"] == "personal" and task["project"] == "House"
    with pytest.raises(Invalid):
        store.create_task({"title": "x", "project_id": home["id"], "area": "work"})


def test_update_logs_readable_changes(store):
    task = store.create_task({"title": "Ship it"})
    store.update_task(task["id"], {"status": "in_progress", "priority": 3, "due_on": "2026-10-09"}, source="mcp")
    last = store.task_updates(task["id"])[-1]
    assert last["kind"] == "change" and last["source"] == "mcp"
    assert "Status: To do → In progress" in last["body"]
    assert "Priority: none → high" in last["body"]
    assert "Due: none → 2026-10-09" in last["body"]


def test_noop_update_logs_nothing(store):
    task = store.create_task({"title": "Same"})
    store.update_task(task["id"], {"title": "Same", "status": "todo"})
    assert len(store.task_updates(task["id"])) == 1


def test_done_sets_and_reopen_clears_completed_at(store):
    task = store.create_task({"title": "t"})
    done = store.update_task(task["id"], {"status": "done"})
    assert done["completed_at"]
    reopened = store.update_task(task["id"], {"status": "todo"})
    assert reopened["completed_at"] is None


def test_today_flag_carries_over_and_view(store, clock):
    a = store.create_task({"title": "a", "today": True})
    b = store.create_task({"title": "b", "status": "in_progress"})
    store.create_task({"title": "c"})
    view = store.today_view()
    assert [t["title"] for t in view["open"]] == ["a", "b"]
    clock.value = clock.value.replace(day=6)
    assert store.get_task(a["id"])["today"] is True  # carried over
    assert store.get_task(a["id"])["today_on"] == "2026-10-05"
    store.reorder_today([b["id"], a["id"]])
    assert [t["title"] for t in store.today_view()["open"]] == ["b", "a"]
    store.update_task(a["id"], {"today": False})
    assert [t["title"] for t in store.today_view()["open"]] == ["b"]


def test_bar_state(store):
    store.create_task({"title": "Today thing", "today": True, "due_on": "2026-10-01"})
    store.create_task({"title": "Captured", "status": "inbox"})
    bar = store.bar_state()
    assert [t["title"] for t in bar["tasks"]] == ["Today thing"]
    assert bar["tasks"][0]["overdue"] is True
    assert bar["counts"]["inbox"] == 1 and bar["counts"]["today"] == 1 and bar["counts"]["overdue"] == 1


def test_search_finds_by_notes_and_history_including_closed(store):
    a = store.create_task({"title": "Renew SSL certificate", "notes": "for the Acme portal"})
    b = store.create_task({"title": "Quarterly review"})
    store.add_update(b["id"], "Dana wants the churn numbers", source="meeting: weekly")
    store.update_task(a["id"], {"status": "done"})
    assert [t["id"] for t in store.search("acme certificates")] == [a["id"]]
    assert [t["id"] for t in store.search("churn dana")] == [b["id"]]
    assert store.search("acme", include_closed=False) == []
    assert store.search("the of") == []


def test_upsert_external_preserves_triage(store):
    proj = store.create_project("Acme", "work", customer="Acme Corp")
    task, created = store.upsert_external("jira", "AC-1", {"title": "Bug"})
    assert created and task["status"] == "inbox"
    store.update_task(task["id"], {"status": "in_progress", "project_id": proj["id"], "today": True})
    task, created = store.upsert_external("jira", "AC-1", {"title": "Bug (renamed)", "status": "todo"})
    assert not created
    assert task["title"] == "Bug (renamed)"
    assert task["status"] == "in_progress" and task["project"] == "Acme" and task["today"]
    task, _ = store.upsert_external("jira", "AC-1", {"status": "done"})
    assert task["status"] == "done"
    task, _ = store.upsert_external("jira", "AC-1", {"status": "todo"})
    assert task["status"] == "todo"  # reopened


def test_batch_is_atomic(store):
    with pytest.raises(NotFound):
        with store.tx():
            store.create_task({"title": "kept?"})
            store.update_task(9999, {"title": "nope"})
    assert store.list_tasks(include_closed=True) == []


def test_project_area_change_moves_tasks(store):
    p = store.create_project("Side gig", "personal")
    t = store.create_task({"title": "Invoice", "project_id": p["id"]})
    store.update_project(p["id"], area="work")
    assert store.get_task(t["id"])["area"] == "work"


def test_validation(store):
    with pytest.raises(Invalid):
        store.create_task({"title": " "})
    with pytest.raises(Invalid):
        store.create_task({"title": "x", "due_on": "next week"})
    with pytest.raises(Invalid):
        store.create_project("Dup", "work") and store.create_project("dup", "work")


def test_customers_link_projects_and_tasks(store):
    p = store.create_project("Portal", "work", customer="Acme Corp")
    store.create_project("Billing", "work", customer="acme corp")  # same customer, any case
    assert [c["name"] for c in store.list_customers()] == ["Acme Corp"]
    t = store.create_task({"title": "x", "project_id": p["id"]})
    assert t["customer"] == "Acme Corp"
    acme = store.find_customer("ACME CORP")
    assert store.list_customers()[0]["project_count"] == 2
    assert [x["id"] for x in store.list_tasks(customer_id=acme["id"])] == [t["id"]]
    store.update_customer(acme["id"], name="Acme")
    assert store.get_task(t["id"])["customer"] == "Acme"
    store.update_project(p["id"], customer="")
    assert store.get_task(t["id"])["customer"] is None
    assert [x["id"] for x in store.list_tasks(no_customer=True)] == [t["id"]]


def test_migration_turns_customer_text_into_records(tmp_path):
    import sqlite3

    from todo_app import db

    path = tmp_path / "old.db"
    conn = sqlite3.connect(path, isolation_level=None)
    conn.executescript(f"BEGIN; {db.MIGRATIONS[0]}; PRAGMA user_version = 1; COMMIT;")
    for name, customer in [("A", "Acme"), ("B", "acme "), ("C", None)]:
        conn.execute(
            "INSERT INTO projects (name, area, customer, created_at, updated_at) VALUES (?, 'work', ?, 'x', 'x')",
            (name, customer),
        )
    conn.close()
    upgraded = db.connect(path)
    rows = upgraded.execute(
        "SELECT p.name, c.name FROM projects p LEFT JOIN customers c ON c.id = p.customer_id ORDER BY p.name"
    ).fetchall()
    assert [tuple(r) for r in rows] == [("A", "Acme"), ("B", "Acme"), ("C", None)]
