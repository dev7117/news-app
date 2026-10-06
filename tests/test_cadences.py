from datetime import datetime

import pytest

from todo_app.attachments import Attachments
from todo_app.cadences import Cadences
from todo_app.hub import Hub
from todo_app.store import Invalid, NotFound


@pytest.fixture
def setup(store, tmp_path):
    hub = Hub(store, tmp_path)
    cad = Cadences(store, hub, Attachments(store, tmp_path))
    acme = store.create_customer("Acme")
    project = store.create_project("Acme ops", area="work", customer="Acme")
    tool = hub.create_link(acme["id"], "launcher", label="Ops report", command="./ops-report.sh", cwd="~/acme")
    return store, hub, cad, acme, project, tool


def make_weekly(cad, acme, project, tool):
    cadence = cad.create(
        acme["id"], "Weekly Ops", {"cron": "0 9 * * 4"}, project_id=project["id"], prep_days=3,
        purpose="Thursday ops review with Acme IT.",
        agenda=["Incidents", {"title": "Backlog", "guidance": "Top 5 aging tickets"}],
    )
    cad.set_steps(cadence["id"], [
        {"title": "Run the ops report", "instructions": "Run it, attach the PDF", "link_id": tool["id"],
         "due_hours_before": 18, "outputs": "~/acme/out/*.pdf"},
        {"title": "Draft talking points", "due_hours_before": 2},
    ])
    return cad.get(cadence["id"])


def test_template_schedule_and_upcoming(setup):
    store, hub, cad, acme, project, tool = setup
    cadence = make_weekly(cad, acme, project, tool)
    assert cadence["schedule_text"] == "Thursdays at 9:00am"
    assert [s["tool"] for s in cadence["steps"]] == ["Ops report", None]
    assert [u["held_on"] for u in cadence["upcoming"][:3]] == ["2026-10-08", "2026-10-15", "2026-10-22"]
    assert cadence["agenda"][1] == {"title": "Backlog", "guidance": "Top 5 aging tickets"}
    with pytest.raises(Invalid):
        cad.create(acme["id"], "Bad", {"cron": "nope"})
    with pytest.raises(Invalid):
        cad.set_steps(cadence["id"], [{"title": "x", "link_id": hub.create_link(acme["id"], "link", label="Docs", url="acme.com")["id"]}])


def test_ensure_makes_meeting_prep_group_and_topics(setup, clock):
    store, hub, cad, acme, project, tool = setup
    cadence = make_weekly(cad, acme, project, tool)
    created = cad.ensure()["created"]
    assert len(created) == 1  # Thu Oct 8 is within 3 days of Mon Oct 5; Oct 15 isn't
    assert cad.ensure()["created"] == []  # idempotent
    occ = cad.occurrence(created[0])
    assert occ["held_on"] == "2026-10-08" and occ["meeting"]["status"] == "scheduled"
    assert occ["meeting"]["title"] == "Weekly Ops" and occ["meeting"]["ends_at"]
    group = store.get_task(occ["prep_task_id"])
    assert group["title"] == "Prep: Weekly Ops · Thu Oct 8" and group["project_id"] == project["id"]
    assert [c["title"] for c in group["children"]] == ["Run the ops report", "Draft talking points"]
    report = occ["steps"][0]["task"]
    assert report["due_on"] == "2026-10-07"  # 18h before Thu 9am
    assert "Desktop tool: Ops report" in store.get_task(report["id"])["notes"]
    assert [t["title"] for t in occ["topics"]] == ["Incidents", "Backlog"]

    cad.set_points(occ["id"], "backlog", "- 3 P2s older than 30 days", source="mcp")
    cad.set_points(occ["id"], "Backlog", "- vendor patch slipped", append=True)
    cad.set_points(occ["id"], "Renewal", "- ask about Q1 budget")
    topics = cad.occurrence(occ["id"])["topics"]
    assert topics[1]["points"] == "- 3 P2s older than 30 days\n- vendor patch slipped"
    assert topics[2]["title"] == "Renewal"

    done = cad.complete_step(occ["id"], "ops report", source="mcp")
    assert done["status"] == "done"
    assert cad.occurrence(occ["id"])["prep"] == {"done": 1, "total": 2}

    # After the meeting it's held; the next one picks up "last time".
    clock.value = clock.value.replace(day=13)
    nxt = cad.occurrence(cad.ensure()["created"][0])
    assert cad._row(occ["id"])["status"] == "held"
    assert nxt["previous"]["id"] == occ["id"] and nxt["previous"]["topics"][1]["points"].startswith("- 3 P2s")


def test_prepare_early_files_and_calendar_cadence(setup):
    store, hub, cad, acme, project, tool = setup
    cadence = make_weekly(cad, acme, project, tool)
    cad.update(cadence["id"], prep_days=0)
    occ = cad.prepare(cadence["id"])  # the next one, made now
    assert occ["held_on"] == "2026-10-08" and cad.prepare(cadence["id"])["id"] == occ["id"]

    pdf = cad.attachments.add(occ["id"], "../../etc/ops.pdf", b"%PDF-1.4 report", step_id=occ["steps"][0]["id"], source="agent")
    assert pdf["name"] == "ops.pdf" and pdf["content_type"] == "application/pdf"
    note = cad.attachments.add(occ["id"], "breakdown.md", b"# Breakdown\n- 4 P1s", source="mcp")
    assert cad.attachments.read_text(note["id"])["text"].startswith("# Breakdown")
    with pytest.raises(Invalid):
        cad.attachments.read_text(pdf["id"])
    packet = cad.occurrence(occ["id"])
    assert [f["name"] for f in packet["steps"][0]["files"]] == ["ops.pdf"] and len(packet["files"]) == 2
    cad.attachments.delete(note["id"])
    with pytest.raises(NotFound):
        cad.attachments.get(note["id"])

    # A cadence that follows the calendar uses the synced meetings instead of making its own.
    monthly = cad.create(acme["id"], "Exec review", {"calendar": "exec review"}, prep_days=7)
    hub.sync_calendar(
        [{"calendar_id": "evt-1", "customer_id": acme["id"], "title": "Acme Exec Review",
          "starts_at": datetime(2026, 10, 9, 14, 0).astimezone().isoformat()}],
        window_start="2026-10-05", window_end="2026-10-31",
    )
    made = [cad._row(i) for i in cad.ensure()["created"]]
    exec_occ = next(o for o in made if o["cadence_id"] == monthly["id"])
    assert hub.get_meeting(exec_occ["meeting_id"])["calendar_id"] == "evt-1"
    hub.sync_calendar([], window_start="2026-10-05", window_end="2026-10-31")  # meeting cancelled
    cad.ensure()
    assert cad._row(exec_occ["id"])["status"] == "skipped"
