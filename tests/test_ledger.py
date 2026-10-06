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


def test_client_sync_profile_and_state(client):
    setup(client)
    error, profile = call(client, "set_client_sync", customer="Acme", rules="Ignore Jira digests.",
                          sources={"gmail": {"domains": ["acme.com"]}, "jira": {"site": "acme.atlassian.net", "projects": ["ACME"]}},
                          default_project="Portal")
    assert not error and profile["enabled"] and profile["sources"]["gmail"] == {"domains": ["acme.com"]}
    error, profile = call(client, "set_client_sync", customer="Acme", sources={"jira": None})
    assert profile["sources"]["jira"] is None and profile["sources"]["gmail"] and profile["rules"] == "Ignore Jira digests."
    error, state = call(client, "set_sync_state", customer="Acme", source="gmail", cursor="2026-10-06T07:30:00Z",
                        summary="3 threads, 1 new")
    assert state["cursor"] == "2026-10-06T07:30:00Z"
    error, ctx = call(client, "get_client_sync", customer="Acme")
    assert ctx["state"]["gmail"]["last_summary"] == "3 threads, 1 new"
    assert ctx["routine_prompt"] == "/todo-sync Acme" and ctx["projects"][0]["name"] == "Portal"
    # The REST side the Sync tab uses.
    cid = ctx["customer"]["id"]
    assert client.get(f"/api/customers/{cid}/sync").json()["rules"] == "Ignore Jira digests."
    put = client.put(f"/api/customers/{cid}/sync", json={"enabled": False}).json()
    assert put["enabled"] is False and put["sources"]["gmail"]
    error, message = call(client, "set_client_sync", customer="Acme", sources={"jira": {"domains": ["x"]}})
    assert error and "jira takes" in message


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
        call(client, "set_sync_state", customer="Acme", source="gmail", cursor="2026-10-06T08:00:00Z", summary="2 threads")
    lines = [json.loads(JsonFormatter().format(r)) for r in caplog.records if r.name == "todo.ledger"]
    skipped = next(l for l in lines if l["message"] == "ledger skipped")
    assert skipped["code"] == "rejected" and skipped["ref"] == "gmail:log-1" and skipped["customer"] == "Acme"
    screened = next(l for l in lines if l["message"] == "ledger screened")
    assert screened["kept"] == 1 and screened["skipped"] == 1 and screened["skipped_rejected"] == 1
    run = next(l for l in lines if l["message"] == "sync run")
    assert run["source"] == "gmail" and run["summary"] == "2 threads"
