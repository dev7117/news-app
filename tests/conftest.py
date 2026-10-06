import os
import tempfile
from datetime import date

import pytest

# The app's singletons read config at import; point them at a throwaway DB first.
_tmp = tempfile.mkdtemp()
os.environ["TODO_DB"] = os.path.join(_tmp, "todo.db")
os.environ["API_TOKEN"] = "test-token"

from todo_app import db  # noqa: E402
from todo_app.store import Store  # noqa: E402


class Clock:
    def __init__(self, today: date) -> None:
        self.value = today

    def __call__(self) -> date:
        return self.value


@pytest.fixture
def clock() -> Clock:
    return Clock(date(2026, 10, 5))  # a Monday


@pytest.fixture
def store(clock: Clock) -> Store:
    return Store(db.connect(":memory:"), today=clock)


@pytest.fixture(scope="session")
def _app_client():
    # The MCP session manager can only start once per process, so one client for the run.
    from fastapi.testclient import TestClient

    from todo_app.app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def client(_app_client):
    from todo_app.deps import store as app_store

    with app_store.tx() as c:
        for table in ("attachments", "occurrence_topics", "cadence_occurrences", "cadence_steps", "cadences", "blocks", "task_people", "people", "ideas", "launcher_runs", "agents", "changes", "changesets", "meeting_tasks", "meetings", "customer_topics", "customer_links", "tasks", "tasks_fts", "projects", "customers", "settings"):
            c.execute(f"DELETE FROM {table}")
    return _app_client
