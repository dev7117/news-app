"""The source ledger: a scheduled sync never brings back what you already decided on."""
from tests.test_mcp import AUTH, call


def setup(client):
    client.post("/api/projects", json={"name": "Portal", "area": "work", "customer": "Acme"})
    return client.get("/api/projects").json()[0]


def propose(client, *items, source="sync: Acme gmail", customer="Acme"):
    return call(client, "propose_changes", source=source, summary="sync", customer=customer, items=list(items))


def decide(client, proposal_id, approve):
    return client.post(f"/api/proposals/{proposal_id}/decide", json={"approve": approve}).json()


def test_rejected_refs_stay_rejected(client):
    setup(client)
    item = {"action": "create", "title": "Send Dana the SOW", "project": "Portal", "ref": "gmail:abc123"}
    _, first = propose(client, item)
    decide(client, first["id"], [])  # rejected
    error, again = propose(client, item)
    assert not error and again["status"] == "nothing_new"
    assert "you rejected this" in again["skipped"][0]["why"]
    # Brought back only with a reason, and flagged for the review.
    error, back = propose(client, {**item, "reconsider": True})
    assert "reason" in back["skipped"][0]["why"]
    error, back = propose(client, {**item, "reconsider": True, "reason": "Dana asked again on Oct 6"})
    assert not error and back["status"] == "pending"
    full = client.get(f"/api/proposals/{back['id']}").json()
    assert full["changes"][0]["payload"]["flags"] == ["brought_back"] and full["changes"][0]["ref"] == "gmail:abc123"


def test_pending_refs_dont_double_up(client):
    setup(client)
    item = {"action": "create", "title": "Renew the cert", "project": "Portal", "ref": "jira:acme-7"}
    _, first = propose(client, item)
    _, second = propose(client, item, {"action": "create", "title": "Fresh", "project": "Portal", "ref": "jira:ACME-8"})
    assert second["status"] == "pending" and [c["title"] for c in second["changes"]] == ["Fresh"]
    assert f"already waiting in Review (proposal #{first['id']})" in second["skipped"][0]["why"]


def test_tracked_refs_route_to_their_task(client):
    setup(client)
    _, first = propose(client, {"action": "create", "title": "Renew the cert", "project": "Portal", "ref": "jira:ACME-7"})
    decide(client, first["id"], "all")
    task_id = client.get("/api/tasks").json()[0]["id"]
    assert client.get(f"/api/tasks/{task_id}").json()["refs"] == ["jira:ACME-7"]
    # Recreating it is skipped; a note finds the task by ref.
    _, again = propose(client, {"action": "create", "title": "Renew SSL cert", "project": "Portal", "ref": "jira:ACME-7"},
                       {"action": "note", "note": "Moved to In Review", "ref": "jira:acme-7"})
    assert "already tracked as #" in again["skipped"][0]["why"]
    assert again["changes"][0]["task_id"] == task_id
    error, state = call(client, "check_refs", refs=["jira:ACME-7", "gmail:nope"])
    assert [s["state"] for s in state] == ["tracked", "unseen"] and state[0]["task_id"] == task_id


def test_closed_tasks_stay_closed(client):
    setup(client)
    _, first = propose(client, {"action": "create", "title": "Renew the cert", "project": "Portal", "ref": "jira:ACME-7"})
    decide(client, first["id"], "all")
    task_id = client.get("/api/tasks").json()[0]["id"]
    client.patch(f"/api/tasks/{task_id}", json={"status": "done"})
    _, again = propose(client, {"action": "note", "note": "still on it?", "ref": "jira:ACME-7"},
                       {"action": "complete", "task_id": task_id})
    assert again["status"] == "nothing_new" and all("is done" in s["why"] for s in again["skipped"])
    error, back = propose(client, {"action": "note", "note": "Expired again", "status": "todo", "ref": "jira:ACME-7",
                                   "reopen": True, "reason": "New expiry notice Oct 6"})
    assert not error and back["status"] == "pending"


def test_lookalikes_without_refs(client):
    setup(client)
    _, first = propose(client, {"action": "create", "title": "Send Dana the updated SOW", "project": "Portal"})
    decide(client, first["id"], [])
    _, again = propose(client, {"action": "create", "title": "Send the updated SOW to Dana", "project": "Portal"},
                       {"action": "create", "title": "Book the offsite venue", "project": "Portal"})
    assert "which you rejected on" in again["skipped"][0]["why"]
    assert [c["title"] for c in again["changes"]] == ["Book the offsite venue"]
    # Recently closed work too.
    task = client.post("/api/tasks", json={"title": "Rotate the API keys", "status": "done",
                                           "project_id": client.get("/api/projects").json()[0]["id"]}).json()
    _, third = propose(client, {"action": "create", "title": "Rotate API keys", "project": "Portal"})
    assert f"looks like #{task['id']}" in third["skipped"][0]["why"]


def test_ingest_records_refs(client):
    body = {"source": "jira-acme", "tasks": [{"external_id": "AC-9", "title": "Fix login", "status": "todo"}]}
    client.post("/api/ingest", json=body, headers={"Authorization": "Bearer test-token"})
    error, state = call(client, "check_refs", refs=["jira:ac-9"])
    assert state[0]["state"] == "tracked"


def test_client_sync_profile_and_feeds(client):
    setup(client)
    error, profile = call(client, "set_client_sync", customer="Acme", rules="Ignore Jira digests.", default_project="Portal")
    assert not error and profile["enabled"] and profile["rules"] == "Ignore Jira digests." and profile["feeds"] == []
    # Several feeds per source: two JQLs and two Slack channel sets, each with its own rules.
    feeds = [
        ("jira", "ACME open issues", {"site": "acme.atlassian.net", "projects": ["ACME"]}, ""),
        ("jira", "Escalations", {"site": "acme.atlassian.net", "jql": "labels = escalation"}, "Always a task, high priority."),
        ("slack", "#acme-shared", {"channels": ["#acme-shared"]}, ""),
        ("slack", "Alerts", {"channels": ["#acme-alerts"]}, "Only P1s become tasks."),
        ("gmail", "Acme mail", {"domains": ["acme.com"]}, ""),
    ]
    for source, name, filters, rules in feeds:
        error, feed = call(client, "save_sync_feed", customer="Acme", source=source, name=name, filters=filters, rules=rules)
        assert not error and feed["name"] == name and feed["filters"] == filters
    _, ctx = call(client, "get_client_sync", customer="Acme")
    assert [f["name"] for f in ctx["feeds"]] == ["Acme mail", "ACME open issues", "Escalations", "#acme-shared", "Alerts"]
    assert ctx["routine_prompt"] == "/todo-sync Acme" and ctx["projects"][0]["name"] == "Portal"

    # Each feed keeps its own cursor; ambiguous source names are refused.
    _, state = call(client, "set_sync_state", customer="Acme", feed="Escalations", cursor="2026-10-07T07:30:00Z", summary="2 issues")
    assert state["cursor"] == "2026-10-07T07:30:00Z" and state["last_summary"] == "2 issues"
    error, message = call(client, "set_sync_state", customer="Acme", feed="jira", cursor="x")
    assert error and "2 jira feeds" in message
    assert not call(client, "set_sync_state", customer="Acme", feed="gmail", cursor="2026-10-07T07:00:00Z")[0]
    _, ctx = call(client, "get_client_sync", customer="Acme")
    by_name = {f["name"]: f for f in ctx["feeds"]}
    assert by_name["Escalations"]["cursor"] == "2026-10-07T07:30:00Z" and by_name["ACME open issues"]["cursor"] is None

    # Changing a feed: only what's given; its source can't change; names stay unique.
    _, changed = call(client, "save_sync_feed", customer="Acme", feed="Alerts", enabled=False)
    assert changed["enabled"] is False and changed["rules"] == "Only P1s become tasks."
    assert "source can't change" in call(client, "save_sync_feed", customer="Acme", feed="Alerts", source="jira")[1]
    assert "already has a feed named" in call(client, "save_sync_feed", customer="Acme", source="gmail", name="alerts")[1]
    assert "jira takes" in call(client, "save_sync_feed", customer="Acme", source="jira", name="X", filters={"channels": ["y"]})[1]
    _, unnamed = call(client, "save_sync_feed", customer="Acme", source="jira", filters={"jql": "labels = x"})
    assert unnamed["name"] == "Jira"
    _, unnamed2 = call(client, "save_sync_feed", customer="Acme", source="jira", filters={"jql": "labels = y"})
    assert unnamed2["name"] == "Jira 2"
    call(client, "remove_sync_feed", customer="Acme", feed="Jira")
    call(client, "remove_sync_feed", customer="Acme", feed="Jira 2")
    _, removed = call(client, "remove_sync_feed", customer="Acme", feed="#acme-shared")
    assert "#acme-shared" not in removed["feeds"]

    # The REST side the Sync tab uses.
    cid = ctx["customer"]["id"]
    assert len(client.get(f"/api/customers/{cid}/sync").json()["feeds"]) == 4
    feed = client.post(f"/api/customers/{cid}/sync/feeds", json={"source": "teams", "name": "Teams", "filters": {"chats": ["Acme"]}}).json()
    assert client.patch(f"/api/customers/{cid}/sync/feeds/{feed['id']}", json={"rules": "FYI only"}).json()["rules"] == "FYI only"
    assert client.delete(f"/api/customers/{cid}/sync/feeds/{feed['id']}").status_code == 204
    assert client.put(f"/api/customers/{cid}/sync", json={"enabled": False}).json()["enabled"] is False


def test_sync_guide_and_prompt(client):
    error, guide = call(client, "get_sync_guide", customer="Acme")
    assert "check_refs" in guide and "Sync Acme" in guide
    prompt = client.post("/mcp", headers=AUTH, json={"jsonrpc": "2.0", "id": 1, "method": "prompts/get",
                                                     "params": {"name": "sync", "arguments": {"customer": "Acme"}}}).json()
    assert "get_client_sync(\"Acme\")" in prompt["result"]["messages"][0]["content"]["text"]


def test_attach_task_file(client):
    task = client.post("/api/tasks", json={"title": "W2"}).json()
    error, f = call(client, "attach_task_file", task_id=task["id"], name="notes.md", text="# hi")
    assert not error and client.get(f"/api/tasks/{task['id']}").json()["files"][0]["name"] == "notes.md"


def test_filtering_is_logged(client, caplog):
    import json
    import logging

    from todo_app.telemetry import JsonFormatter

    setup(client)
    item = {"action": "create", "title": "Send Dana the SOW", "project": "Portal", "ref": "gmail:log-1"}
    _, first = propose(client, item)
    decide(client, first["id"], [])
    with caplog.at_level(logging.INFO, logger="todo.ledger"):
        propose(client, item, {"action": "create", "title": "Book the venue", "project": "Portal", "ref": "gmail:log-2"})
        call(client, "save_sync_feed", customer="Acme", source="gmail", name="Acme mail", filters={"domains": ["acme.com"]})
        call(client, "set_sync_state", customer="Acme", feed="Acme mail", cursor="2026-10-06T08:00:00Z", summary="2 threads")
    lines = [json.loads(JsonFormatter().format(r)) for r in caplog.records if r.name == "todo.ledger"]
    skipped = next(l for l in lines if l["message"] == "ledger skipped")
    assert skipped["code"] == "rejected" and skipped["ref"] == "gmail:log-1" and skipped["customer"] == "Acme"
    screened = next(l for l in lines if l["message"] == "ledger screened")
    assert screened["kept"] == 1 and screened["skipped"] == 1 and screened["skipped_rejected"] == 1
    run = next(l for l in lines if l["message"] == "sync run")
    assert run["source"] == "gmail" and run["feed"] == "Acme mail" and run["summary"] == "2 threads"
