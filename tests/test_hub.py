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
    assert topics[0]["mentions"] == 2 and topics[0]["status"] == "watching"
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
