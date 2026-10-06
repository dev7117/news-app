from datetime import timedelta

import pytest

from todo_app.hub import Hub
from todo_app.notebook import Notebook
from todo_app.people import People
from todo_app.quickadd import quick_add
from todo_app.review import Review
from todo_app.store import Invalid


@pytest.fixture
def setup(store, tmp_path):
    hub = Hub(store, tmp_path)
    nb = Notebook(store)
    return hub, nb, People(store, hub, nb)


def test_find_and_quick_add_assign(store, setup):
    _, _, people = setup
    priya = people.create("Priya Shah", email="priya@initech.example", title="InfoSec lead")
    people.create("Priyanka Rao")
    people.create("Dana Ruiz")
    assert people.find("dana")["name"] == "Dana Ruiz"           # unique prefix
    assert people.find("priya") is None                         # ambiguous: Priya / Priyanka
    assert people.find("priya-shah")["id"] == priya["id"]
    assert people.find("PRIYA@initech.example")["id"] == priya["id"]
    task = quick_add(store, "Review the DPA +priya-shah ^fri", people=people)
    assert task["assignee"] == "Priya Shah" and task["status"] == "todo"
    with pytest.raises(Invalid):
        people.create("Someone", email="priya@initech.example")


def test_assignment_and_follower_history(store, setup):
    _, _, people = setup
    dana = people.create("Dana Ruiz")
    sam = people.create("Sam Patel")
    task = store.create_task({"title": "Pilot plan", "assignee_id": dana["id"]})
    assert task["assignee"] == "Dana Ruiz"
    store.update_task(task["id"], {"assignee_id": None})
    assert store.task_updates(task["id"])[-1]["body"] == "Assigned to you (was Dana Ruiz)"
    store.set_followers(task["id"], [dana["id"], sam["id"]])
    assert [p["name"] for p in store.get_task(task["id"])["followers"]] == ["Dana Ruiz", "Sam Patel"]
    store.set_followers(task["id"], [sam["id"]])
    assert store.task_updates(task["id"])[-1]["event"] == "followed"
    assert [t["id"] for t in store.list_tasks(following=sam["id"])] == [task["id"]]
    assert store.list_tasks(following=dana["id"]) == []


def test_person_view(store, setup, clock):
    hub, nb, people = setup
    initech = store.create_project("Data platform", "work", customer="Initech")
    acme = store.create_project("Portal", "work", customer="Acme")
    priya = people.create("Priya Shah", email="priya@x.example")
    today = clock()
    overdue = store.create_task({"title": "Credits estimate", "project_id": initech["id"], "assignee_id": priya["id"],
                                 "due_on": (today - timedelta(days=2)).isoformat(), "status": "waiting"})
    later = store.create_task({"title": "Runbook review", "project_id": acme["id"], "assignee_id": priya["id"],
                               "due_on": (today + timedelta(days=20)).isoformat()})
    together = store.create_task({"title": "Pilot plan", "project_id": acme["id"]})
    store.set_followers(together["id"], [priya["id"]])
    shipped = store.create_task({"title": "Access request", "assignee_id": priya["id"]})
    store.update_task(shipped["id"], {"status": "done"})
    hub.create_meeting(store.find_customer("Initech")["id"], title="Monthly", held_on=today.isoformat(),
                       attendees="Priya Shah, Sam")
    nb.add("person", priya["id"], title="1:1 agenda", body="- credits\n- career")
    view = people.view(priya["id"])
    assert [t["title"] for t in view["follow_up"]] == ["Credits estimate"]
    assert [t["title"] for t in view["assigned"]] == ["Credits estimate", "Runbook review"]
    assert [t["title"] for t in view["following"]] == ["Pilot plan"]
    assert [t["title"] for t in view["done_recently"]] == ["Access request"]
    assert {(s["customer"], s["project"]) for s in view["shared"]} == {("Initech", "Data platform"), ("Acme", "Portal")}
    assert [m["title"] for m in view["meetings"]] == ["Monthly"]
    assert view["notes"][0]["title"] == "1:1 agenda"
    assert view["counts"] == {"assigned_open": 2, "following_open": 1, "overdue": 1, "waiting": 1, "done_30d": 1}
    listed = people.list()[0]
    assert (listed["assigned_open"], listed["overdue"], listed["following_open"]) == (2, 1, 1)
    people.delete(priya["id"])
    assert store.get_task(later["id"])["assignee_id"] is None  # back to you


def test_assignment_proposals(store, setup):
    hub, _, people = setup
    review = Review(store, hub, people=people)
    dana = people.create("Dana Ruiz")
    task = store.create_task({"title": "Pilot plan"})
    cs = review.propose([
        {"action": "update", "task_id": task["id"], "assignee": "dana"},
        {"action": "follow", "task_id": task["id"], "person": "Dana Ruiz"},
    ], source="meeting: x")
    lines = [[(l["op"], l["field"], l["text"]) for l in c["lines"]] for c in cs["changes"]]
    assert lines == [[("-", "assigned to", "you"), ("+", "assigned to", "Dana Ruiz")], [("+", "follower", "Dana Ruiz")]]
    review.decide(cs["id"], approve="all")
    got = store.get_task(task["id"])
    assert got["assignee"] == "Dana Ruiz" and [p["name"] for p in got["followers"]] == ["Dana Ruiz"]
    with pytest.raises(Invalid):
        review.propose([{"action": "follow", "task_id": task["id"], "person": "Nobody"}], source="x")



def test_take_proposed_task_on_today(store, setup):
    hub, _, people = setup
    review = Review(store, hub, people=people)
    people.create("Dana Ruiz")
    cs = review.propose([
        {"action": "create", "title": "Send the SOW", "assignee": "dana"},
        {"action": "create", "title": "Book the offsite"},
    ], source="meeting: x")
    first, second = (c["id"] for c in cs["changes"])
    done = review.decide(cs["id"], approve="all", edits={first: {"today": True}})
    mine, later = (store.get_task(c["result_id"]) for c in done["changes"])
    assert mine["today"] and mine["assignee_id"] is None  # on your list, so it's yours
    assert not later["today"]
    assert [t["title"] for t in store.today_view()["open"]] == ["Send the SOW"]

def test_people_api_and_mcp(client):
    from tests.test_mcp import call

    _, person = call(client, "create_person", name="Priya Shah", email="priya@initech.example", title="InfoSec")
    t = client.post("/api/tasks/quick", json={"text": "Send DPA redlines +priya"}).json()
    assert t["assignee_id"] == person["id"]
    client.put(f"/api/tasks/{t['id']}/followers", json={"person_ids": [person["id"]]})
    call(client, "add_person_note", person="Priya", title="1:1", body="- DPA")
    _, page = call(client, "get_person", person="priya@initech.example")
    assert page["assigned"][0]["title"] == "Send DPA redlines" and page["notes"][0]["title"] == "1:1"
    _, mine = call(client, "list_tasks", assignee="me")
    assert mine == []
    assert client.get(f"/api/people/{person['id']}").json()["counts"]["assigned_open"] == 1


def test_today_is_mine_only(store, setup):
    _, _, people = setup
    jordan = people.create("Jordan Lee")
    store.create_task({"title": "Mine", "today": True})
    theirs = store.create_task({"title": "Theirs", "today": True, "assignee_id": jordan["id"]})
    store.create_task({"title": "Theirs in progress", "status": "in_progress", "assignee_id": jordan["id"]})
    followed = store.create_task({"title": "Mine, Jordan follows", "today": True})
    store.set_followers(followed["id"], [jordan["id"]])
    assert [t["title"] for t in store.today_view()["open"]] == ["Mine", "Mine, Jordan follows"]
    assert store.counts()["today"] == 2 and store.counts()["in_progress"] == 0
    assert [t["title"] for t in store.bar_state()["tasks"]] == ["Mine", "Mine, Jordan follows"]
    store.update_task(theirs["id"], {"assignee_id": None})  # handed back: it's on my Today again
    assert len(store.today_view()["open"]) == 3


def test_mentions_add_followers(store, setup):
    _, nb, people = setup
    dana = people.create("Dana Ruiz")
    sam = people.create("Sam Patel")
    task = store.create_task({"title": "Pilot", "notes": "Check with @[Dana Ruiz](#person-%d)" % dana["id"]})
    assert [p["name"] for p in store.get_task(task["id"])["followers"]] == ["Dana Ruiz"]
    store.add_update(task["id"], "Ask @[Sam Patel](#person-%d) about comms" % sam["id"])
    assert {p["name"] for p in store.get_task(task["id"])["followers"]} == {"Dana Ruiz", "Sam Patel"}
    block = nb.add("task", task["id"], title="Plan")
    store.set_followers(task["id"], [])
    nb.update(block["id"], body="@[Sam Patel](#person-%d) owns the email" % sam["id"])
    assert [p["name"] for p in store.get_task(task["id"])["followers"]] == ["Sam Patel"]
    store.update_task(task["id"], {"notes": "@[Nobody](#person-999)"})  # unknown ids are ignored
    assert [p["name"] for p in store.get_task(task["id"])["followers"]] == ["Sam Patel"]
    assert store.task_updates(task["id"])[-1]["event"] != "followed"


def test_quick_add_follow_and_assign(store, setup):
    _, _, people = setup
    people.create("Dana Ruiz")
    people.create("Jordan Lee")
    task = quick_add(store, "Pilot timeline @dana +jordan @work", people=people)
    assert task["assignee"] == "Jordan Lee" and [p["name"] for p in task["followers"]] == ["Dana Ruiz"]
    assert task["area"] == "work" and task["title"] == "Pilot timeline"
    unknown = quick_add(store, "Ping @nobody", people=people)
    assert unknown["title"] == "Ping @nobody"
