import json

AUTH = {"Authorization": "Bearer test-token", "Accept": "application/json, text/event-stream"}


def rpc(client, method, params=None, headers=AUTH):
    return client.post(
        "/mcp", headers=headers, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
    )


def call(client, tool, **arguments):
    body = rpc(client, "tools/call", {"name": tool, "arguments": arguments}).json()
    result = body["result"]
    if result.get("isError"):
        return True, result["content"][0]["text"]
    payload = result.get("structuredContent")
    if payload is None:
        payload = json.loads(result["content"][0]["text"])
    elif set(payload) == {"result"}:
        payload = payload["result"]
    return False, payload


def test_requires_token(client):
    assert rpc(client, "tools/list", headers={"Accept": AUTH["Accept"]}).status_code == 401


def test_lists_tools(client):
    names = {t["name"] for t in rpc(client, "tools/list").json()["result"]["tools"]}
    assert {"get_overview", "search_tasks", "propose_changes", "log_meeting", "sync_calendar"} <= names
    # Task writes only go through proposals.
    assert not names & {"create_task", "update_task", "complete_task", "add_task_note", "delete_task"}


def seed(client):
    client.post("/api/projects", json={"name": "Portal", "area": "work", "customer": "Acme"})
    return client.post("/api/tasks", json={"title": "Renew Acme SSL certificate", "status": "in_progress",
                                            "project_id": client.get("/api/projects").json()[0]["id"]}).json()


def test_proposal_waits_for_review_then_applies(client):
    task = seed(client)
    _, hits = call(client, "search_tasks", query="acme certificate expiring")
    assert hits[0]["id"] == task["id"]

    error, prop = call(
        client, "propose_changes", source="email: Acme cert thread", summary="Cert done, new SOW task",
        items=[
            {"action": "complete", "task_id": task["id"], "note": "Cert installed", "reason": "Dana: it's live"},
            {"action": "create", "title": "Send Dana the SOW", "project": "Portal", "due_on": "2026-10-09"},
            {"action": "update", "task_id": task["id"], "external_url": "https://acme.atlassian.net/browse/AC-7"},
            {"action": "add_link", "customer": "Acme", "label": "Jira", "url": "https://acme.atlassian.net"},
        ],
    )
    assert not error and prop["status"] == "pending"
    assert "- status: In progress\n+ status: Done" in prop["diff"]
    assert "+ title: Send Dana the SOW" in prop["diff"]
    assert "+ link: Jira → https://acme.atlassian.net" in prop["diff"]
    # Nothing changed yet.
    assert client.get(f"/api/tasks/{task['id']}").json()["status"] == "in_progress"
    assert client.get("/api/counts").json()["review"] == 1

    ids = [c["id"] for c in prop["changes"]]
    decided = client.post(f"/api/proposals/{prop['id']}/decide",
                          json={"approve": ids[:2] + ids[3:], "edits": {str(ids[1]): {"title": "Send Dana the revised SOW"}}}).json()
    assert decided["status"] == "partial"
    assert [c["status"] for c in decided["changes"]] == ["applied", "applied", "rejected", "applied"]
    done = client.get(f"/api/tasks/{task['id']}").json()
    assert done["status"] == "done" and done["updates"][-1]["source"] == "email: Acme cert thread"
    titles = [t["title"] for t in client.get("/api/tasks").json()]
    assert "Send Dana the revised SOW" in titles
    _, listed = call(client, "list_proposals", status="partial")
    assert listed[0]["id"] == prop["id"]


def test_invalid_proposal_stores_nothing(client):
    error, out = call(client, "propose_changes", source="x", summary="x",
                      items=[{"action": "create", "title": "ok"}, {"action": "complete", "task_id": 424242}])
    assert error and "Item 1" in out
    assert client.get("/api/proposals").json() == []


def test_review_off_applies_immediately(client):
    client.put("/api/settings", json={"review_claude_changes": False})
    _, prop = call(client, "propose_changes", source="x", summary="x", items=[{"action": "create", "title": "Auto"}])
    assert prop["status"] == "applied"
    assert [t["title"] for t in client.get("/api/tasks").json()] == ["Auto"]


def test_calendar_meeting_prep_recap_and_proposal(client):
    seed(client)
    _, synced = call(client, "sync_calendar", window_start="2026-10-01", window_end="2026-12-31", events=[
        {"calendar_id": "evt-1", "customer": "Acme", "title": "Weekly sync",
         "starts_at": "2026-12-01T14:00:00-05:00", "attendees": "dana@acme.example"},
        {"calendar_id": "evt-2", "customer": "Acme", "title": "QBR", "starts_at": "2026-12-03T10:00:00-05:00"},
    ])
    assert len(synced["created"]) == 2
    weekly = synced["created"][0]
    _, prepped = call(client, "set_meeting_prep", meeting_id=weekly, prep="- Ask about SSO date")
    assert prepped["prep"] == "- Ask about SSO date" and prepped["status"] == "scheduled"
    # QBR dropped from the calendar → cancelled; weekly kept.
    _, again = call(client, "sync_calendar", window_start="2026-10-01", window_end="2026-12-31", events=[
        {"calendar_id": "evt-1", "customer": "Acme", "title": "Weekly sync (moved)", "starts_at": "2026-12-02T14:00:00-05:00"},
    ])
    assert again["updated"] == [weekly] and len(again["cancelled"]) == 1

    _, meeting = call(client, "log_meeting", customer="Acme", title="Weekly sync", held_on="2026-12-02",
                      summary="- SSO slipped", calendar_id="evt-1",
                      topics=[{"name": "SSO rollout", "summary": "Slipped to Dec 9"}])
    assert meeting["id"] == weekly and meeting["status"] == "held"
    _, prop = call(client, "propose_changes", meeting_id=meeting["id"], summary="SSO follow-up",
                   items=[{"action": "create", "title": "Send Dana the new SSO date", "project": "Portal"}])
    assert prop["source"] == "meeting: Weekly sync 2026-12-02" and prop["customer"] == "Acme"
    client.post(f"/api/proposals/{prop['id']}/decide", json={"approve": "all"})
    _, full = call(client, "get_meeting", meeting_id=meeting["id"])
    assert [t["title"] for t in full["tasks"]] == ["Send Dana the new SSO date"]

    call(client, "set_customer_overview", customer="Acme", overview="SSO is a week late.")
    _, hub_view = call(client, "get_customer", customer="Acme")
    assert hub_view["overview"] == "SSO is a week late."
    assert hub_view["topics"][0]["name"] == "SSO rollout"
    assert hub_view["recent_meetings"][0]["id"] == meeting["id"]


def test_hub_api(client):
    c = client.post("/api/customers", json={"name": "Acme", "website": "acme.example"}).json()
    assert client.put(f"/api/customers/{c['id']}/logo", content=b"<svg/>",
                      headers={"Content-Type": "image/svg+xml"}).status_code == 200
    assert client.get(f"/api/customers/{c['id']}/logo").content == b"<svg/>"
    link = client.post(f"/api/customers/{c['id']}/links",
                       json={"kind": "launcher", "label": "Sync", "command": "echo hi"}).json()
    m = client.post(f"/api/customers/{c['id']}/meetings", json={"title": "Kickoff", "held_on": "2026-10-01"}).json()
    hub_view = client.get(f"/api/customers/{c['id']}/hub").json()
    assert hub_view["meetings"][0]["id"] == m["id"] and hub_view["links"][0]["label"] == "Sync"
