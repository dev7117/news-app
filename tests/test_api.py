def test_health_and_quick_add_flow(client):
    assert client.get("/health").json() == {"status": "ok"}
    project = client.post("/api/projects", json={"name": "Acme", "area": "work", "customer": "Acme Corp"}).json()
    task = client.post("/api/tasks/quick", json={"text": "Send SOW #acme !t", "source": "intake"}).json()
    assert task["project_id"] == project["id"] and task["source"] == "intake"
    bar = client.get("/api/bar").json()
    assert [t["title"] for t in bar["tasks"]] == ["Send SOW"]
    patched = client.patch(f"/api/tasks/{task['id']}", json={"status": "done", "note": "sent"}).json()
    assert patched["status"] == "done"
    assert [u["kind"] for u in patched["updates"]] == ["created", "change", "note"]
    assert client.get("/api/tasks/999").status_code == 404
    assert client.post("/api/tasks", json={"title": "x", "due_on": "soon"}).status_code == 400


def test_patch_null_clears_project(client):
    project = client.post("/api/projects", json={"name": "P", "area": "work"}).json()
    task = client.post("/api/tasks", json={"title": "t", "project_id": project["id"]}).json()
    assert client.patch(f"/api/tasks/{task['id']}", json={"project_id": None}).json()["project_id"] is None


def test_ingest_requires_token_and_upserts(client):
    body = {"source": "jira-acme", "tasks": [{"external_id": "AC-1", "title": "Bug", "external_url": "http://j/AC-1"}]}
    assert client.post("/api/ingest", json=body).status_code == 401
    auth = {"Authorization": "Bearer test-token"}
    first = client.post("/api/ingest", json=body, headers=auth).json()
    assert len(first["created"]) == 1
    again = client.post("/api/ingest", json=body, headers=auth).json()
    assert again["updated"] == first["created"]
    gone = client.post("/api/ingest", json={"source": "jira-acme", "tasks": [], "close_missing": True}, headers=auth).json()
    assert gone["closed"] == first["created"]
    assert client.post("/api/ingest", json={"source": "mcp", "tasks": []}, headers=auth).status_code == 400


def test_spa_fallback_does_not_swallow_api(client):
    assert client.get("/api/nope").status_code == 404
