#!/usr/bin/env python3
"""Fill the customer hubs on a local instance by driving the MCP server the way Claude would:
calendar sync + prep, a meeting recap with topics, an overview, and a pending proposal.

    python scripts/seed-hub-demo.py [http://localhost:7670] [token]

Run after seed-sample-data.py. Never point this at production.
"""
import json
import sys
import urllib.request
from datetime import date, datetime, timedelta

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:7670").rstrip("/")
TOKEN = sys.argv[2] if len(sys.argv) > 2 else "local-token"
if "192.168.1.47" in BASE:
    sys.exit("Refusing to seed production")


def tool(name, **arguments):
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}}
    request = urllib.request.Request(
        f"{BASE}/mcp", data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
                 "Authorization": f"Bearer {TOKEN}"},
    )
    result = json.load(urllib.request.urlopen(request))["result"]
    if result.get("isError"):
        sys.exit(f"{name}: {result['content'][0]['text']}")
    data = result.get("structuredContent") or json.loads(result["content"][0]["text"])
    return data.get("result", data) if isinstance(data, dict) and set(data) == {"result"} else data


def at(days, hour):
    local = datetime.combine(date.today() + timedelta(days=days), datetime.min.time()).replace(hour=hour)
    return local.astimezone().isoformat(timespec="minutes")


def task_id(query):
    return tool("search_tasks", query=query, limit=1)[0]["id"]


today = date.today()
last_week = (today - timedelta(days=6)).isoformat()

tool("update_customer", customer="Acme Corp", website="acme.example",
     notes="Dana Ruiz (CTO) owns the portal. Weekly sync Mondays. Contract renews in January.")

recap = tool(
    "log_meeting", customer="Acme Corp", title="Weekly sync", held_on=last_week,
    attendees="Dana Ruiz (CTO), Sam Patel (PM), you",
    summary="- SSO redirect loop reproduces on Safari 18 only; Dana says it **blocks the pilot**\n"
            "- Pilot group is 40 users in finance, target start in two weeks\n"
            "- Dana wants a written pilot timeline before Wednesday's exec review\n"
            "- CSV export timeouts are still hitting the ops team",
    decisions="- Pilot starts once SSO is fixed; no partial rollout\n- Sam owns comms to the finance group",
    topics=[
        {"name": "SSO rollout", "summary": "Blocked by the Safari redirect loop; pilot waits on it."},
        {"name": "Pilot timeline", "summary": "Dana needs a written plan for the exec review."},
        {"name": "CSV export performance", "summary": "Ops still sees timeouts on 10k+ rows.", "status": "watching"},
    ],
)

tool("set_customer_overview", customer="Acme Corp", overview=(
    "**Pilot is blocked on SSO.** The Safari redirect loop is the only thing standing between us and the "
    "40-user finance pilot, and Dana is watching it closely.\n\n"
    "- **Now:** fixing the SSO loop; sending Dana a pilot timeline before her exec review\n"
    "- **Risk:** the renewal in January leans on the pilot going well\n"
    "- **Watching:** CSV export timeouts (AC-142)\n"
    "- **Next milestone:** pilot kickoff, about two weeks out"
))

proposal = tool(
    "propose_changes", meeting_id=recap["id"], summary="Acme weekly: SSO blocker, pilot timeline, Jira links",
    items=[
        {"action": "note", "task_id": task_id("SSO redirect Safari"), "status": "in_progress",
         "note": "Repro confirmed on Safari 18 only; blocks the finance pilot.",
         "reason": "Dana: \"this is the one thing blocking the pilot\""},
        {"action": "update", "task_id": task_id("pilot timeline Dana"), "due_on": (today + timedelta(days=3)).isoformat(),
         "priority": "high", "reason": "Dana wants it before Wednesday's exec review"},
        {"action": "update", "task_id": task_id("CSV export times out"),
         "external_url": "https://acme.atlassian.net/browse/AC-142", "reason": "Track it on their Jira"},
        {"action": "complete", "task_id": task_id("revised SOW Dana"), "note": "Dana confirmed she has the signed SOW.",
         "reason": "Dana: \"got the SOW, thanks\""},
        {"action": "create", "title": "Write pilot comms checklist for Sam", "project": "Acme portal",
         "reason": "Sam owns comms to the finance group"},
        {"action": "add_link", "label": "Jira (ACME)", "url": "https://acme.atlassian.net/jira/software/projects/AC"},
    ],
)

sync = tool("sync_calendar", window_start=today.isoformat(), window_end=(today + timedelta(days=7)).isoformat(), events=[
    {"calendar_id": "demo-acme-weekly", "customer": "Acme Corp", "title": "Weekly sync", "starts_at": at(1, 10),
     "ends_at": at(1, 11), "attendees": "Dana Ruiz, Sam Patel", "location": "https://meet.example/acme-weekly"},
    {"calendar_id": "demo-globex-cutover", "customer": "Globex", "title": "Cutover runbook review",
     "starts_at": at(2, 14), "attendees": "Priya Shah"},
    {"calendar_id": "demo-initech-monthly", "customer": "Initech", "title": "Monthly service review",
     "starts_at": at(4, 9), "attendees": "Initech IT"},
])
weekly = next(m for m in sync["upcoming"] if m["calendar_id"] == "demo-acme-weekly")
tool("set_meeting_prep", meeting_id=weekly["id"], prep=(
    "- **SSO loop:** status of the Safari fix; can the pilot date hold?\n"
    "- **Pilot timeline:** send before this meeting (due " + (today + timedelta(days=3)).strftime("%a") + ")\n"
    "- **Chase:** nothing waiting on Acme right now\n"
    "- **Ask:** is CSV export still hurting ops? (AC-142)"
))
cutover = next(m for m in sync["upcoming"] if m["calendar_id"] == "demo-globex-cutover")
tool("set_meeting_prep", meeting_id=cutover["id"], prep=(
    "- Walk the runbook top to bottom; rollback step is still vague\n"
    "- **Chase Priya** for the Snowflake credits estimate (waiting since last week)"
))
tool("update_topics", customer="Globex", topics=[
    {"name": "Snowflake costs", "summary": "Credits estimate pending from Priya."},
    {"name": "Cutover date", "summary": "Targeting end of month if the runbook holds."},
])
print(f"Seeded hubs on {BASE}: recap #{recap['id']}, proposal #{proposal['id']} pending, "
      f"{len(sync['created'])} upcoming meetings")
