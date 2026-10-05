#!/usr/bin/env python3
"""Fill a local instance with sample projects and tasks through its API.

    python scripts/seed-sample-data.py [http://localhost:7670]

Never point this at production.
"""
import json
import sys
import urllib.request
from datetime import date, timedelta

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:7670").rstrip("/")
if "192.168.1.47" in BASE:
    sys.exit("Refusing to seed production")


def call(method, path, body=None, token=None):
    req = urllib.request.Request(
        BASE + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})},
    )
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read() or "null")


d = lambda n: (date.today() + timedelta(days=n)).isoformat()  # noqa: E731

projects = {
    p["name"]: p
    for p in [
        call("POST", "/api/projects", {"name": "Acme portal", "area": "work", "customer": "Acme Corp",
                                        "description": "SSO + customer portal rebuild for Acme."}),
        call("POST", "/api/projects", {"name": "Globex migration", "area": "work", "customer": "Globex",
                                        "description": "Moving Globex's data warehouse to Snowflake."}),
        call("POST", "/api/projects", {"name": "Initech support", "area": "work", "customer": "Initech",
                                        "description": "Managed-services retainer: tickets and monthly reviews."}),
        call("POST", "/api/projects", {"name": "Internal", "area": "work", "description": "Team, hiring, admin."}),
        call("POST", "/api/projects", {"name": "House", "area": "personal"}),
        call("POST", "/api/projects", {"name": "Todo app", "area": "personal", "description": "This app."}),
    ]
}

tasks = [
    {"title": "Send Dana the revised SOW", "project_id": projects["Acme portal"]["id"], "today": True, "priority": 3, "due_on": d(0)},
    {"title": "Fix SSO redirect loop on Safari", "project_id": projects["Acme portal"]["id"], "status": "in_progress"},
    {"title": "Review Globex cutover runbook", "project_id": projects["Globex migration"]["id"], "today": True, "due_on": d(2)},
    {"title": "Snowflake credits estimate", "project_id": projects["Globex migration"]["id"], "status": "waiting", "waiting_on": "Priya"},
    {"title": "Write Q4 hiring plan", "project_id": projects["Internal"]["id"], "due_on": d(-2), "priority": 2},
    {"title": "Monthly review deck for Initech", "project_id": projects["Initech support"]["id"], "due_on": d(3)},
    {"title": "Renew Initech VPN certificate", "project_id": projects["Initech support"]["id"], "status": "waiting", "waiting_on": "Initech IT"},
    {"title": "Migrate Initech backups to S3", "project_id": projects["Initech support"]["id"], "status": "in_progress", "priority": 2},
    {"title": "Close out Initech ticket backlog", "project_id": projects["Initech support"]["id"], "status": "done"},
    {"title": "Acme kickoff notes", "project_id": projects["Acme portal"]["id"], "status": "done"},
    {"title": "Globex access request", "project_id": projects["Globex migration"]["id"], "status": "done"},
    {"title": "Replace furnace filter", "project_id": projects["House"]["id"], "today": True},
    {"title": "Book gutter cleaning", "project_id": projects["House"]["id"], "due_on": d(9)},
    {"title": "Bar widget: show overdue count", "project_id": projects["Todo app"]["id"]},
]
for body in tasks:
    call("POST", "/api/tasks", body)
for text in ["Look into that Grafana alert noise", "Call the dentist ^fri @p"]:
    call("POST", "/api/tasks/quick", {"text": text, "source": "intake"})
try:
    call("POST", "/api/ingest", {"source": "jira-acme", "tasks": [
        {"external_id": "AC-142", "title": "Portal: export to CSV times out", "project": "Acme portal",
         "external_url": "https://example.atlassian.net/browse/AC-142"},
    ]}, token=sys.argv[2] if len(sys.argv) > 2 else None)
except urllib.error.HTTPError as exc:
    print(f"ingest skipped ({exc.code}); pass the API token as the 2nd argument")
print(f"Seeded {BASE}")
