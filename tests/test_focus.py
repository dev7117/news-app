"""Work / personal focus: nothing from the other side leaks into a focused view."""
from todo_app.hub import Hub
from todo_app.quickadd import quick_add
from todo_app.review import Review


def seed(store):
    acme = store.create_project("Portal", "work", customer="Acme")
    other = store.create_project("Billing", "work", customer="Globex")
    house = store.create_project("House", "personal")
    store.create_task({"title": "Work today", "project_id": acme["id"], "today": True})
    store.create_task({"title": "Globex today", "project_id": other["id"], "today": True})
    store.create_task({"title": "Home today", "project_id": house["id"], "today": True})
    store.create_task({"title": "Personal inbox", "area": "personal", "status": "inbox"})
    return acme, other, house


def test_today_counts_and_bar_scope(store):
    acme, _, house = seed(store)
    assert [t["title"] for t in store.today_view("personal")["open"]] == ["Home today"]
    assert {t["title"] for t in store.today_view("work")["open"]} == {"Work today", "Globex today"}
    assert len(store.today_view()["open"]) == 3
    assert store.counts("work")["inbox"] == 0 and store.counts("personal")["inbox"] == 1
    bar = store.bar_state("work", customer_id=acme["customer_id"])
    assert [t["title"] for t in bar["tasks"]] == ["Work today"]
    assert [t["title"] for t in store.bar_state(project_id=house["id"])["tasks"]] == ["Home today"]


def test_quick_add_follows_focus_unless_text_says_otherwise(store):
    _, _, house = seed(store)
    assert quick_add(store, "fix fence", area="personal")["area"] == "personal"
    assert quick_add(store, "paint", project_id=house["id"])["project"] == "House"
    assert quick_add(store, "call Dana @work", area="personal")["area"] == "work"
    assert quick_add(store, "SOW #portal", area="personal")["project"] == "Portal"


def test_proposal_area_and_review_counts(store, tmp_path):
    acme, _, house = seed(store)
    review = Review(store, Hub(store, tmp_path))
    home_task = store.today_view("personal")["open"][0]
    review.propose([{"action": "note", "task_id": home_task["id"], "note": "bought filters"}], source="chat")
    review.propose([{"action": "create", "title": "SOW", "project": "Portal"}], source="meeting")
    review.propose([
        {"action": "create", "title": "A", "project": "Portal"},
        {"action": "create", "title": "B", "project": "House"},
    ], source="mixed")
    assert [p["area"] for p in review.list()] == [None, "work", "personal"]
    assert store.counts("personal")["review"] == 2  # its own + the mixed one
    assert store.counts("work")["review"] == 2
    assert store.counts()["review"] == 3


def test_api_focus_params(client):
    client.post("/api/projects", json={"name": "House", "area": "personal"})
    client.post("/api/tasks/quick", json={"text": "home thing !t", "area": "personal"})
    client.post("/api/tasks/quick", json={"text": "work thing !t", "area": "work"})
    assert [t["title"] for t in client.get("/api/today?area=work").json()["open"]] == ["work thing"]
    bar = client.get("/api/bar?area=personal").json()
    assert [t["title"] for t in bar["tasks"]] == ["home thing"]
    assert bar["meetings"] == [] and bar["filters"]["customers"] == []
    assert [p["name"] for p in bar["filters"]["projects"]] == ["House"]
    assert client.get("/api/meetings/upcoming?area=personal").json() == []
