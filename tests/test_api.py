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


def test_image_upload_round_trip(client):
    png = b"\x89PNG\r\n\x1a\n" + b"screenshot"
    first = client.post("/api/uploads", content=png, headers={"content-type": "image/png"}).json()
    again = client.post("/api/uploads", content=png, headers={"content-type": "image/png"}).json()
    assert first["url"] == again["url"] and first["url"].endswith(".png")  # same bytes, one file
    got = client.get(first["url"])
    assert got.status_code == 200 and got.content == png and "immutable" in got.headers["cache-control"]
    assert client.post("/api/uploads", content=b"<svg/>", headers={"content-type": "image/svg+xml"}).status_code == 400
    assert client.get("/api/uploads/..%2Ftodo.db").status_code == 404
    assert client.get("/api/uploads/nope.png").status_code == 404


def test_cadence_api_files_and_runs(client):
    acme = client.post("/api/customers", json={"name": "Acme"}).json()
    cadence = client.post("/api/cadences", json={
        "customer_id": acme["id"], "name": "Weekly Ops", "schedule": {"cron": "0 9 * * 4"}, "agenda": ["Incidents"]}).json()
    assert cadence["schedule_text"] == "Thursdays at 9:00am"
    client.put(f"/api/cadences/{cadence['id']}/steps", json={"steps": [{"title": "Pull the numbers"}]})
    occ = client.post(f"/api/cadences/{cadence['id']}/prepare", json={}).json()
    assert occ["steps"][0]["task"]["title"] == "Pull the numbers"
    prep = client.get(f"/api/tasks/{occ['prep_task_id']}").json()
    assert prep["occurrence_id"] == occ["id"] and prep["children"][0]["title"] == "Pull the numbers"
    assert client.get(f"/api/meetings/{occ['meeting_id']}").json()["occurrence_id"] == occ["id"]

    up = client.post(f"/api/occurrences/{occ['id']}/files", params={"name": "page.html"}, content=b"<script>x</script>",
                     headers={"content-type": "text/html"}).json()
    got = client.get(up["url"])
    assert got.content == b"<script>x</script>" and got.headers["content-type"] == "application/octet-stream"
    assert got.headers["content-disposition"].startswith("attachment") and got.headers["x-content-type-options"] == "nosniff"
    csv = client.post(f"/api/occurrences/{occ['id']}/files", params={"name": "tickets.csv"}, content=b"a,b\n1,2",
                      headers={"content-type": "text/csv"}).json()
    assert client.get(csv["url"]).headers["content-disposition"].startswith("inline")

    topic = occ["topics"][0]
    client.put(f"/api/occurrences/{occ['id']}/topics/{topic['id']}", json={"points": "- P1 on Tuesday"})
    page = client.patch(f"/api/occurrences/{occ['id']}", json={"status": "ready", "notes": "All set"}).json()
    assert page["status"] == "ready" and page["topics"][0]["points"] == "- P1 on Tuesday" and len(page["files"]) == 2
    # Removing a meeting's agenda topic leaves the customer's topics alone (they once shared a route).
    customer_topic = client.post(f"/api/customers/{acme['id']}/topics", json={"name": "Renewal", "update": "Asked for Q1 pricing"}).json()
    assert client.delete(f"/api/occurrence-topics/{topic['id']}").status_code == 204
    assert client.get(f"/api/occurrences/{occ['id']}").json()["topics"] == []
    view = client.get(f"/api/customers/{acme['id']}/topics?days=7").json()
    assert [t["name"] for t in view["topics"]] == ["Renewal"] and view["topics"][0]["id"] == customer_topic["id"]
    # No tool on the step, so nothing to run.
    assert client.post(f"/api/occurrences/{occ['id']}/steps/{occ['steps'][0]['id']}/run", json={}).status_code == 400
