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
# People: client-side and our side, assigned and involved across customers.
customers_now = {c["name"]: c["id"] for c in call("GET", "/api/customers")}
person = {}
for name, email, title, customer in [
    ("Dana Ruiz", "dana@acme.example", "CTO", "Acme Corp"),
    ("Sam Patel", "sam@acme.example", "Program manager", "Acme Corp"),
    ("Priya Shah", "priya@globex.example", "Data platform lead", "Globex"),
    ("Jordan Lee", "jordan@ourco.example", "Senior engineer", None),
]:
    person[name] = call("POST", "/api/people", {"name": name, "email": email, "title": title,
                                                "customer_id": customers_now.get(customer)})["id"]
by_title = {t["title"]: t["id"] for t in call("GET", "/api/tasks?include_closed=true")}
call("PATCH", f"/api/tasks/{by_title['Snowflake credits estimate']}", {"assignee_id": person["Priya Shah"]})
call("PATCH", f"/api/tasks/{by_title['Migrate Initech backups to S3']}", {"assignee_id": person["Jordan Lee"], "due_on": d(-1)})
call("PATCH", f"/api/tasks/{by_title['Fix SSO redirect loop on Safari']}", {"assignee_id": person["Jordan Lee"], "due_on": d(2)})
call("PUT", f"/api/tasks/{by_title['Send Dana the revised SOW']}/followers", {"person_ids": [person["Dana Ruiz"], person["Sam Patel"]]})
call("PUT", f"/api/tasks/{by_title['Review Globex cutover runbook']}/followers", {"person_ids": [person["Priya Shah"], person["Jordan Lee"]]})
call("POST", "/api/tasks/quick", {"text": "Write the pilot comms email #acme-portal +sam ^fri"})
call("POST", f"/api/people/{person['Jordan Lee']}/blocks", {"title": "Next 1:1 agenda",
     "body": "- Backups migration slipped a day: what's blocking?\n- SSO fix: on track for Wednesday?\n- Wants to lead the Globex cutover"})

# A task with a notebook: subtasks (some done) and a notes block, so its timeline has shape.
sso = next(t for t in call("GET", "/api/tasks") if t["title"].startswith("Fix SSO redirect"))
subtasks = [
    ("Reproduce on Safari 18", "Only Safari 18+; Chrome and Firefox fine. HAR captured in the ticket.", True),
    ("Find where the redirect loops", "IdP callback drops the `state` param on the second hop.", True),
    ("Patch the callback handler", "- keep `state` through the hop\n- add a regression test", False),
    ("Deploy to staging and ask Dana to verify", "", False),
]
for title, body, done in subtasks:
    block = call("POST", f"/api/tasks/{sso['id']}/blocks", {"title": title, "body": body, "kind": "subtask"})
    if done:
        call("PATCH", f"/api/blocks/{block['id']}", {"done": True})
call("POST", f"/api/tasks/{sso['id']}/blocks", {"title": "Notes", "body": "Dana: this blocks the finance pilot.\n\nSafari ITP may be stripping the cookie; check `SameSite`."})
call("POST", f"/api/tasks/{sso['id']}/updates", {"body": "Root cause found: the state param is dropped on the IdP's second redirect."})

customer_ids = {c["name"]: c["id"] for c in call("GET", "/api/customers")}
call("POST", "/api/ideas", {
    "title": "Self-serve onboarding for Acme admins", "customer_id": customer_ids["Acme Corp"],
    "summary": "Let Acme's admins add their own users instead of filing a ticket with us every time.",
    "blocks": [
        {"title": "What they said", "body": "> Every new hire is a ticket to you. That doesn't scale. (Dana, weekly sync)\n\n- ~15 new users a month\n- Finance pilot adds 40 at once"},
        {"title": "Options", "body": "1. **Admin UI** in the portal: invite + role picker\n2. **SSO group mapping**: users appear on first login, roles from IdP groups\n3. Bulk CSV import as a stopgap"},
        {"title": "Open questions", "body": "- Do they want to manage *roles*, or just *who has access*?\n- Who audits it on their side?\n- Pricing: per seat today; does self-serve change that?"},
    ],
})
call("POST", "/api/ideas", {"title": "Usage dashboard for the exec review", "customer_id": customer_ids["Acme Corp"],
                            "summary": "Sam keeps asking what adoption looks like."})
call("POST", "/api/tasks/quick", {"text": "Snowflake cost alerts #globex-migration !idea"})
call("POST", "/api/ideas", {"title": "Bar widget: weekly review mode", "project_id": projects["Todo app"]["id"],
                            "blocks": [{"title": "Sketch", "body": "Friday afternoon: show what got done, what slipped, what's next."}]})
call("POST", "/api/ideas", {"title": "Learn to make sourdough", "area": "personal"})
print(f"Seeded {BASE}")
