import pytest

from todo_app.hub import Hub
from todo_app.ideas import Ideas
from todo_app.quickadd import quick_add
from todo_app.review import Review
from todo_app.store import Invalid


@pytest.fixture
def ideas(store):
    return Ideas(store)


def test_placement_rules(store, ideas):
    portal = store.create_project("Portal", "work", customer="Acme")
    acme = store.find_customer("Acme")
    by_customer = ideas.create("Self-serve onboarding", customer_id=acme["id"])
    assert by_customer["area"] == "work" and by_customer["project_id"] is None
    by_project = ideas.create("SSO dashboard", project_id=portal["id"])
    assert by_project["customer"] == "Acme" and by_project["area"] == "work"
    loose = ideas.create("Learn Rust", area="personal")
    assert loose["customer_id"] is None and loose["area"] == "personal"
    with pytest.raises(Invalid):
        ideas.create("x", customer_id=acme["id"], area="personal")
    other = store.create_project("Billing", "work", customer="Globex")
    with pytest.raises(Invalid):
        ideas.update(by_customer["id"], project_id=other["id"], customer_id=acme["id"])


def test_ideas_stay_off_boards_and_today(store, ideas):
    store.create_project("Portal", "work")
    idea = quick_add(store, "Maybe a CLI #portal !idea !today", ideas=ideas)
    assert idea["kind"] == "idea" and idea["project"] == "Portal"
    assert store.list_tasks(include_closed=True) == []
    assert store.today_view()["open"] == []
    assert ideas.count("work") == 1 and ideas.count("personal") == 0


def test_promote_and_drop(store, ideas):
    store.create_project("House", "personal")
    idea = ideas.create("Insulate the attic", summary="Cut the heating bill", area="personal",
                        blocks=[{"title": "Quotes", "body": "- A: $2k\n- B: $3k"}, {"body": "Ask the neighbours"}])
    with pytest.raises(Invalid):
        ideas.update(idea["id"], status="promoted")
    task = ideas.promote(idea["id"], {"project_id": store.find_project("House")["id"], "due_on": "2026-11-01"})
    assert task["title"] == "Insulate the attic" and task["notes"] == "Cut the heating bill"
    blocks = ideas.notebook.blocks("task", task["id"])
    # Every block became a subtask; the untitled one took its first line as the title.
    assert [(b["kind"], b["title"], b["body"]) for b in blocks] == [
        ("subtask", "Quotes", "- A: $2k\n- B: $3k"),
        ("subtask", "Ask the neighbours", ""),
    ]
    assert store.get_task(task["id"])["subtasks_total"] == 2
    assert task["project"] == "House" and task["due_on"] == "2026-11-01"
    promoted = ideas.get(idea["id"])
    assert promoted["status"] == "promoted" and promoted["task_id"] == task["id"]
    with pytest.raises(Invalid):
        ideas.promote(idea["id"])
    dropped = ideas.update(ideas.create("Podcast", area="personal")["id"], status="dropped")
    assert dropped["status"] == "dropped" and ideas.list() == []
    assert [i["title"] for i in ideas.list(status=None, query="podcast")] == ["Podcast"]


def test_promotion_as_a_proposal(store, ideas, tmp_path):
    store.create_project("Portal", "work", customer="Acme")
    idea = ideas.create("Usage dashboard", customer_id=store.find_customer("Acme")["id"])
    review = Review(store, Hub(store, tmp_path), ideas)
    cs = review.propose([{"action": "promote_idea", "idea_id": idea["id"], "project": "Portal",
                          "reason": "Dana asked for it"}], source="meeting: x")
    change = cs["changes"][0]
    assert cs["area"] == "work"
    assert [(line["op"], line["field"]) for line in change["lines"]][:3] == [(" ", "idea"), ("+", "task"), ("+", "project")]
    assert ideas.get(idea["id"])["status"] == "open"  # nothing yet
    review.decide(cs["id"], approve="all")
    assert ideas.get(idea["id"])["status"] == "promoted"
    assert [t["title"] for t in store.list_tasks()] == ["Usage dashboard"]


def test_ideas_api_and_mcp(client):
    from tests.test_mcp import call

    client.post("/api/projects", json={"name": "Portal", "area": "work", "customer": "Acme"})
    made = client.post("/api/tasks/quick", json={"text": "Partner API #portal !idea"}).json()
    assert made["kind"] == "idea"
    assert client.get("/api/counts?area=work").json()["ideas"] == 1
    _, captured = call(client, "capture_idea", title="Offer an SLA tier", customer="Acme", summary="Came up twice",
                       blocks=[{"title": "What they said", "body": "Dana: uptime matters"}])
    block_id = captured["blocks"][0]["id"]
    call(client, "update_idea_block", block_id=block_id, append="Budget in Q1")
    call(client, "add_idea_block", idea_id=captured["id"], title="Pricing", body="TBD", after_block_id=0)
    _, full = call(client, "get_idea", idea_id=captured["id"])
    assert [b["title"] for b in full["blocks"]] == ["Pricing", "What they said"]
    assert full["blocks"][1]["body"] == "Dana: uptime matters\n\nBudget in Q1"
    _, listed = call(client, "list_ideas", customer="Acme")
    assert {i["title"] for i in listed} == {"Partner API", "Offer an SLA tier"}
    task = client.post(f"/api/ideas/{made['id']}/promote", json={}).json()
    assert task["project"] == "Portal" and client.get(f"/api/ideas/{made['id']}").json()["status"] == "promoted"


def test_notebook_blocks(store, ideas):
    idea = ideas.create("Partner API", area="work")
    a = ideas.add_block(idea["id"], title="Problem", body="Partners re-key orders")
    c = ideas.add_block(idea["id"], title="Plan")
    b = ideas.add_block(idea["id"], title="Options", after_id=a["id"])
    top = ideas.add_block(idea["id"], title="TL;DR", after_id=0)
    assert [x["title"] for x in ideas.blocks(idea["id"])] == ["TL;DR", "Problem", "Options", "Plan"]
    ideas.notebook.reorder("idea", idea["id"], [c["id"], b["id"], a["id"], top["id"]])
    assert [x["title"] for x in ideas.blocks(idea["id"])] == ["Plan", "Options", "Problem", "TL;DR"]
    with pytest.raises(Invalid):
        ideas.notebook.reorder("idea", idea["id"], [a["id"]])
    ideas.notebook.update(b["id"], body="1. Webhooks\n2. Polling", collapsed=True)
    assert ideas.notebook.get(b["id"])["collapsed"] is True
    assert [i["title"] for i in ideas.list(query="webhooks")] == ["Partner API"]
    assert ideas.list()[0]["block_count"] == 4
    ideas.notebook.delete(top["id"])
    assert len(ideas.blocks(idea["id"])) == 3
    other = ideas.create("Other", area="work")
    with pytest.raises(Invalid):
        ideas.add_block(other["id"], after_id=a["id"])


def test_blocks_api(client):
    idea = client.post("/api/ideas", json={"title": "CLI", "area": "work", "blocks": [{"title": "Why"}]}).json()
    first = idea["blocks"][0]
    second = client.post(f"/api/ideas/{idea['id']}/blocks", json={"title": "How", "body": "argparse"}).json()
    client.patch(f"/api/blocks/{first['id']}", json={"body": "Speed"})
    client.put(f"/api/ideas/{idea['id']}/blocks/order", json={"ids": [second["id"], first["id"]]})
    got = client.get(f"/api/ideas/{idea['id']}").json()
    assert [(b["title"], b["body"]) for b in got["blocks"]] == [("How", "argparse"), ("Why", "Speed")]
    assert client.delete(f"/api/blocks/{second['id']}").status_code == 204


def test_promote_keeps_chosen_blocks_as_notes(store, ideas):
    idea = ideas.create("CLI", area="work", blocks=[{"title": "What they said", "body": "Dana: CLI please"},
                                                    {"title": "Scaffold"}, {"title": "Docs"}])
    said = idea["blocks"][0]["id"]
    task = ideas.promote(idea["id"], note_block_ids=[said])
    kinds = [(b["title"], b["kind"]) for b in ideas.notebook.blocks("task", task["id"])]
    assert kinds == [("What they said", "note"), ("Scaffold", "subtask"), ("Docs", "subtask")]
    events = [u["event"] for u in store.task_updates(task["id"])]
    assert events == ["created", "subtask_added", "subtask_added"]
    other = ideas.create("x", area="work")
    with pytest.raises(Invalid):
        ideas.promote(other["id"], note_block_ids=[said])
