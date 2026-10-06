import pytest

from todo_app.hub import Hub
from todo_app.notebook import Notebook
from todo_app.review import Review
from todo_app.store import Invalid
from todo_app.timeline import build


@pytest.fixture
def nb(store):
    return Notebook(store)


def test_subtasks_progress_and_history(store, nb):
    task = store.create_task({"title": "Fix SSO"})
    a = nb.add("task", task["id"], title="Reproduce", kind="subtask")
    b = nb.add("task", task["id"], title="Patch", body="- keep state param", kind="subtask")
    nb.add("task", task["id"], title="Notes", body="Dana: blocks the pilot")
    nb.update(a["id"], done=True)
    t = store.get_task(task["id"])
    assert (t["subtasks_done"], t["subtasks_total"]) == (1, 2)
    events = [u["event"] for u in store.task_updates(task["id"])]
    assert events == ["created", "subtask_added", "subtask_added", "subtask_done"]
    nb.update(a["id"], done=False)
    assert store.task_updates(task["id"])[-1]["event"] == "subtask_reopened"
    with pytest.raises(Invalid):
        nb.update(nb.blocks("task", task["id"])[2]["id"], done=True)  # a note can't be checked
    nb.update(b["id"], kind="note")
    assert store.get_task(task["id"])["subtasks_total"] == 1
    assert [t["id"] for t in store.search("state param")] == [task["id"]]  # blocks are searchable


def test_ideas_cant_have_subtasks(store, nb):
    from todo_app.ideas import Ideas

    idea = Ideas(store, nb).create("x", area="work")
    with pytest.raises(Invalid):
        nb.add("idea", idea["id"], kind="subtask")


def test_timeline_types_and_meetings(store, tmp_path):
    hub = Hub(store, tmp_path)
    nb = Notebook(store)
    store.create_project("Portal", "work", customer="Acme")
    task = store.create_task({"title": "Fix SSO", "project_id": store.find_project("Portal")["id"]})
    meeting = hub.create_meeting(store.find_customer("Acme")["id"], title="Weekly", held_on="2026-10-01")
    hub.link_task(meeting["id"], task["id"], "note")
    store.add_update(task["id"], "Dana: blocks the pilot", source=hub.meeting_source(meeting))
    other = hub.create_meeting(store.find_customer("Acme")["id"], title="QBR", held_on="2026-09-01")
    hub.link_task(other["id"], task["id"], "create")
    sub = nb.add("task", task["id"], title="Patch", kind="subtask")
    nb.update(sub["id"], done=True)
    store.update_task(task["id"], {"today": True})
    store.update_task(task["id"], {"status": "in_progress"})
    store.update_task(task["id"], {"status": "done"})
    events = build(store, hub, task["id"])
    types = [e["type"] for e in events]
    assert types[0] == "meeting" and events[0]["meeting_title"] == "QBR"  # linked, no entry of its own
    assert types[1:] == ["created", "note", "subtask_added", "subtask_done", "today", "status", "completed"]
    note = events[2]
    assert note["meeting_id"] == meeting["id"] and note["source"] == "meeting: Weekly 2026-10-01"


def test_subtask_proposals(store, tmp_path):
    hub = Hub(store, tmp_path)
    review = Review(store, hub)
    task = store.create_task({"title": "Fix SSO"})
    cs = review.propose([{"action": "add_subtask", "task_id": task["id"], "title": "Write a test", "body": "Safari only"}],
                        source="meeting: x")
    assert [(l["op"], l["field"], l["text"]) for l in cs["changes"][0]["lines"]] == [
        ("+", "subtask", "Write a test"), ("+", "details", "Safari only")]
    assert review.notebook.blocks("task", task["id"]) == []  # nothing until approved
    review.decide(cs["id"], approve="all")
    block = review.notebook.blocks("task", task["id"])[0]
    assert block["kind"] == "subtask" and block["source"] == "meeting: x"
    cs = review.propose([{"action": "check_subtask", "block_id": block["id"], "note": "Merged"}], source="chat")
    assert [l["text"] for l in cs["changes"][0]["lines"][:2]] == ["☐ Write a test", "☑ Write a test"]
    review.decide(cs["id"], approve="all")
    assert review.notebook.get(block["id"])["done"] is True
    with pytest.raises(Invalid):
        review.propose([{"action": "check_subtask", "block_id": 999}], source="x")


def test_task_page_api(client):
    task = client.post("/api/tasks", json={"title": "Fix SSO"}).json()
    sub = client.post(f"/api/tasks/{task['id']}/blocks", json={"title": "Repro", "kind": "subtask"}).json()
    client.patch(f"/api/blocks/{sub['id']}", json={"done": True})
    full = client.get(f"/api/tasks/{task['id']}").json()
    assert full["blocks"][0]["done"] is True and full["subtasks_done"] == 1
    timeline = client.get(f"/api/tasks/{task['id']}/timeline").json()
    assert [e["type"] for e in timeline] == ["created", "subtask_added", "subtask_done"]
