#!/usr/bin/env python3
"""Template for a customer-source sync: push the open items assigned to you into todo.

Copy it, replace fetch_items() with the real API call (Jira, Zendesk, Linear, a CSV…),
and run it on a schedule (cron / systemd timer). Each run is idempotent:

- items are upserted by (SOURCE, external_id): new ones land in the inbox, existing ones
  get their title/notes/due date refreshed without touching your triage (project, today,
  in progress)
- with close_missing, anything that's no longer open in the source is marked done here

Env: TODO_URL (default http://192.168.1.47:7670), TODO_API_TOKEN (the stack's API_TOKEN).
"""
import json
import os
import urllib.request

TODO_URL = os.getenv("TODO_URL", "http://192.168.1.47:7670").rstrip("/")
TOKEN = os.environ["TODO_API_TOKEN"]
SOURCE = "jira-acme"  # short, stable name for this source; shows on each task


def fetch_items() -> list[dict]:
    """Return every open item assigned to you, in todo's ingest shape."""
    return [
        {
            "external_id": "AC-142",
            "title": "Portal: export to CSV times out",
            "notes": "Customer reports > 30s for 10k rows.",
            "project": "Acme portal",  # existing project name (optional)
            "due_on": "2026-10-10",  # optional
            "external_url": "https://acme.atlassian.net/browse/AC-142",
        },
    ]


def main() -> None:
    body = {"source": SOURCE, "tasks": fetch_items(), "close_missing": True}
    request = urllib.request.Request(
        f"{TODO_URL}/api/ingest",
        data=json.dumps(body).encode(),
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN}"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    print(f"{SOURCE}: {len(result['created'])} new, {len(result['updated'])} updated, {len(result['closed'])} closed")


if __name__ == "__main__":
    main()
