TOKEN = {"Authorization": "Bearer test-token"}


def setup_tool(client, **extra):
    c = client.post("/api/customers", json={"name": "Acme"}).json()
    return client.post(f"/api/customers/{c['id']}/links", json={
        "kind": "launcher", "label": "Login", "command": "gh auth login", "mode": "terminal", **extra,
    }).json()


def ping(client, name):
    return client.post("/api/agent/ping", json={"name": name, "platform": "macos"}, headers=TOKEN)


def test_agent_endpoints_need_the_token(client):
    assert client.post("/api/agent/ping", json={"name": "x", "platform": "linux"}).status_code == 401
    assert client.post("/api/agent/runs/1", json={"name": "x"}).status_code == 401


def test_run_flow(client):
    tool = setup_tool(client)
    # No machine connected yet.
    assert "No machine" in client.post(f"/api/links/{tool['id']}/run", json={}).json()["detail"]
    ping(client, "MacBook")
    run = client.post(f"/api/links/{tool['id']}/run", json={}).json()
    assert run["agent"] == "MacBook" and run["status"] == "queued"

    claimed = client.post("/api/agent/poll", json={"name": "MacBook", "platform": "macos"}, headers=TOKEN).json()["run"]
    assert claimed["command"] == "gh auth login" and claimed["customer"] == "Acme"
    # Another machine can't report on it.
    assert client.post(f"/api/agent/runs/{run['id']}", json={"name": "Omarchy", "status": "running"},
                       headers=TOKEN).status_code == 400
    client.post(f"/api/agent/runs/{run['id']}", json={"name": "MacBook", "status": "running"}, headers=TOKEN)
    client.post(f"/api/agent/runs/{run['id']}", json={"name": "MacBook", "output": "Logged in\n"}, headers=TOKEN)
    client.post(f"/api/agent/runs/{run['id']}", json={"name": "MacBook", "status": "succeeded", "exit_code": 0},
                headers=TOKEN)
    done = client.get(f"/api/runs/{run['id']}").json()
    assert done["status"] == "succeeded" and done["output"] == "Logged in\n" and done["finished_at"]
    assert [r["id"] for r in client.get(f"/api/links/{tool['id']}/runs").json()] == [run["id"]]


def test_machine_choice(client):
    tool = setup_tool(client)
    ping(client, "MacBook")
    ping(client, "Omarchy")
    assert "Pick a machine" in client.post(f"/api/links/{tool['id']}/run", json={}).json()["detail"]
    assert client.post(f"/api/links/{tool['id']}/run", json={"agent": "Omarchy"}).json()["agent"] == "Omarchy"
    client.patch(f"/api/links/{tool['id']}", json={"agent": "MacBook"})
    assert client.post(f"/api/links/{tool['id']}/run", json={}).json()["agent"] == "MacBook"
    assert client.get("/api/agents").json()[0]["online"] is True


def test_declined_and_cancel(client):
    tool = setup_tool(client)
    ping(client, "MacBook")
    first = client.post(f"/api/links/{tool['id']}/run", json={}).json()
    assert client.post(f"/api/runs/{first['id']}/cancel").json()["status"] == "cancelled"
    second = client.post(f"/api/links/{tool['id']}/run", json={}).json()
    client.post("/api/agent/poll", json={"name": "MacBook", "platform": "macos"}, headers=TOKEN)
    client.post(f"/api/agent/runs/{second['id']}", json={"name": "MacBook", "status": "declined"}, headers=TOKEN)
    assert client.get(f"/api/runs/{second['id']}").json()["status"] == "declined"
    # Final runs ignore late reports.
    client.post(f"/api/agent/runs/{second['id']}", json={"name": "MacBook", "status": "running"}, headers=TOKEN)
    assert client.get(f"/api/runs/{second['id']}").json()["status"] == "declined"


def test_installer_points_back_at_the_server(client):
    script = client.get("/agent/install.sh").text
    assert 'URL="http://testserver"' in script and "__URL__" not in script
    assert "todo-agent" in client.get("/agent/todo-agent.py").text
