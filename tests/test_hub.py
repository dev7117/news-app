import pytest

from todo_app.hub import Hub
from todo_app.store import Invalid


@pytest.fixture
def hub(store, tmp_path):
    return Hub(store, tmp_path)


def test_meetings_topics_and_hub_view(store, hub):
    acme = store.create_customer("Acme")
    portal = store.create_project("Portal", "work", customer=acme["id"])
    meeting = hub.create_meeting(acme["id"], title="Weekly", held_on="2026-10-01", summary="- SSO slipped",
                                 project_id=portal["id"])
    task = store.create_task({"title": "Fix SSO", "project_id": portal["id"], "status": "in_progress"})
    hub.link_task(meeting["id"], task["id"], "create")
    hub.link_task(meeting["id"], task["id"], "note")  # first action wins
    assert [(t["title"], t["action"]) for t in hub.get_meeting(meeting["id"])["tasks"]] == [("Fix SSO", "create")]
    assert hub.meetings_for_task(task["id"])[0]["title"] == "Weekly"

    hub.upsert_topics(acme["id"], [{"name": "SSO rollout", "summary": "Slipped a week"}], mentioned_on="2026-10-01")
    topics = hub.upsert_topics(acme["id"], [{"name": "sso rollout", "status": "watching"}], mentioned_on="2026-09-20")
    assert len(topics) == 1
    assert topics[0]["mentions"] == 1 and topics[0]["status"] == "watching"  # a status change isn't a mention
    assert topics[0]["summary"] == "Slipped a week" and topics[0]["last_mentioned_on"] == "2026-10-01"

    view = hub.customer_hub(acme["id"])
    assert view["customer"]["last_meeting_on"] == "2026-10-01"
    assert [t["title"] for t in view["next_up"]] == ["Fix SSO"]
    assert view["projects"][0]["name"] == "Portal"


def test_meeting_project_must_belong_to_customer(store, hub):
    acme = store.create_customer("Acme")
    other = store.create_project("Other", "work", customer="Globex")
    with pytest.raises(Invalid):
        hub.create_meeting(acme["id"], title="x", held_on="2026-10-01", project_id=other["id"])


def test_links_and_launcher_fingerprint(store, hub):
    acme = store.create_customer("Acme")
    link = hub.create_link(acme["id"], "link", label="Jira", url="acme.atlassian.net")
    assert link["url"] == "https://acme.atlassian.net"
    with pytest.raises(Invalid):
        hub.create_link(acme["id"], "launcher", label="Sync")
    launcher = hub.create_link(acme["id"], "launcher", label="Sync", command="~/bin/acme-sync")
    first = hub.launcher(launcher["id"])
    assert first["customer"] == "Acme" and first["mode"] == "terminal"
    hub.update_link(launcher["id"], command="~/bin/acme-sync --all")
    assert hub.launcher(launcher["id"])["fingerprint"] != first["fingerprint"]
    with pytest.raises(Invalid):
        hub.launcher(link["id"])


def test_logo_upload_and_replace(store, hub):
    acme = store.create_customer("Acme")
    hub.set_logo(acme["id"], b"<svg/>", "image/svg+xml")
    first = hub.logo_file(acme["id"])
    assert first.read_bytes() == b"<svg/>"
    hub.set_logo(acme["id"], b"\x89PNG...", "image/png")
    assert not first.exists() and hub.logo_file(acme["id"]).suffix == ".png"
    with pytest.raises(Invalid):
        hub.set_logo(acme["id"], b"x", "text/html")


def test_last_met_ignores_scheduled(store, hub):
    acme = store.create_customer("Acme")
    hub.create_meeting(acme["id"], title="Past", held_on="2026-09-01")
    hub.create_meeting(acme["id"], title="Future", held_on="2026-12-01", status="scheduled")
    assert store.list_customers()[0]["last_meeting_on"] == "2026-09-01"
    assert [m["title"] for m in hub.list_meetings(acme["id"])] == ["Past"]


def test_meetings_between_for_the_week_view(store, hub):
    acme = store.create_customer("Acme")
    hub.create_meeting(acme["id"], title="Mon recap", held_on="2026-10-05")
    hub.create_meeting(acme["id"], title="Tue sync", held_on="2026-10-06", status="scheduled",
                       starts_at="2026-10-06T10:00:00-04:00")
    gone = hub.create_meeting(acme["id"], title="Cancelled", held_on="2026-10-07", status="scheduled")
    hub.update_meeting(gone["id"], status="cancelled")
    hub.create_meeting(acme["id"], title="Next week", held_on="2026-10-13", status="scheduled")
    assert [m["title"] for m in hub.meetings_between("2026-10-05", "2026-10-11")] == ["Mon recap", "Tue sync"]


def test_delegated_filter(store):
    from todo_app.people import People
    from todo_app.notebook import Notebook

    people = People(store, Hub(store, __import__("pathlib").Path("/tmp")), Notebook(store))
    jordan = people.create("Jordan Lee")
    store.create_task({"title": "Mine"})
    store.create_task({"title": "Theirs", "assignee_id": jordan["id"]})
    assert [t["title"] for t in store.list_tasks(delegated=True)] == ["Theirs"]
    assert [t["title"] for t in store.list_tasks(mine=True)] == ["Mine"]


def test_topic_timeline_window_and_merge(store, hub, clock):
    acme = store.create_customer("Acme")
    weekly = hub.create_meeting(acme["id"], title="Weekly", held_on="2026-10-05")
    hub.log_topic_updates(acme["id"], [
        {"topic": "SSO rollout", "update": "Safari loop found", "where_things_stand": "Blocked on Safari"},
        {"topic": "Renewal", "update": "Asked for Q1 pricing"},
    ], happened_on="2026-10-05", meeting_id=weekly["id"], source="mcp")
    hub.log_topic_updates(acme["id"], [{"topic": "sso rollout", "update": "Patch in staging"}], happened_on="2026-10-03")
    hub.log_topic_updates(acme["id"], [{"topic": "Old migration", "update": "Done"}], happened_on="2026-09-01")
    # A stand-only change doesn't add to the timeline or wipe it.
    hub.log_topic_updates(acme["id"], [{"topic": "SSO rollout", "where_things_stand": "Fix verifying Wed"}], source="mcp")

    today = hub.topics_view(acme["id"], days=1)
    assert [t["name"] for t in today["topics"]] == ["Renewal", "SSO rollout"]  # one update each today: ties go alphabetical
    week = hub.topics_view(acme["id"], days=7)
    assert [t["name"] for t in week["topics"]] == ["SSO rollout", "Renewal"] and week["quiet"] == 1
    sso = week["topics"][0]
    assert sso["stand"] == "Fix verifying Wed" and sso["stand_source"] == "mcp"
    assert [u["body"] for u in sso["updates"]] == ["Safari loop found", "Patch in staging"]
    assert sso["updates"][0]["meeting_title"] == "Weekly" and sso["window_count"] == 2
    assert len(hub.topics_view(acme["id"], days=30)["topics"]) == 2
    assert len(hub.topics_view(acme["id"], days=None)["topics"]) == 3

    with pytest.raises(Invalid):
        hub.log_topic_updates(acme["id"], [{"topic": "x", "status": "done"}])
    other = store.create_customer("Globex")
    with pytest.raises(Invalid):
        hub.log_topic_updates(other["id"], [{"topic": "x", "update": "y"}], meeting_id=weekly["id"])

    renewal = next(t for t in week["topics"] if t["name"] == "Renewal")
    with pytest.raises(Invalid):
        hub.update_topic(renewal["id"], name="SSO rollout")  # would duplicate a name
    merged = hub.merge_topics(renewal["id"], sso["id"])
    assert merged["name"] == "SSO rollout"
    bodies = [u["body"] for u in hub.topics_view(acme["id"], days=7)["topics"][0]["updates"]]
    assert "Asked for Q1 pricing" in bodies and len(hub.list_topics(acme["id"])) == 2
