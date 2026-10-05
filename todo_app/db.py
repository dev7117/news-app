"""SQLite connection and schema migrations."""
from __future__ import annotations

import sqlite3
from pathlib import Path

# Each entry runs once, in order; PRAGMA user_version records how many have run.
# Never edit a shipped migration; append a new one.
MIGRATIONS: list[str] = [
    """
    CREATE TABLE projects (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        area        TEXT NOT NULL CHECK (area IN ('work', 'personal')),
        customer    TEXT,
        description TEXT NOT NULL DEFAULT '',
        archived    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    );
    CREATE UNIQUE INDEX projects_name ON projects (lower(name));

    CREATE TABLE tasks (
        id           INTEGER PRIMARY KEY,
        title        TEXT NOT NULL,
        notes        TEXT NOT NULL DEFAULT '',
        status       TEXT NOT NULL DEFAULT 'todo'
                     CHECK (status IN ('inbox', 'todo', 'in_progress', 'waiting', 'done', 'cancelled')),
        area         TEXT NOT NULL CHECK (area IN ('work', 'personal')),
        project_id   INTEGER REFERENCES projects (id) ON DELETE SET NULL,
        priority     INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
        due_on       TEXT,
        today_on     TEXT,
        waiting_on   TEXT,
        source       TEXT NOT NULL DEFAULT 'app',
        external_id  TEXT,
        external_url TEXT,
        sort_key     REAL NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        completed_at TEXT
    );
    CREATE UNIQUE INDEX tasks_external ON tasks (source, external_id) WHERE external_id IS NOT NULL;
    CREATE INDEX tasks_status ON tasks (status);
    CREATE INDEX tasks_project ON tasks (project_id);

    CREATE TABLE task_updates (
        id         INTEGER PRIMARY KEY,
        task_id    INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
        kind       TEXT NOT NULL CHECK (kind IN ('created', 'change', 'note')),
        body       TEXT NOT NULL DEFAULT '',
        source     TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX task_updates_task ON task_updates (task_id, id);

    -- rowid = tasks.id; maintained by Store._reindex.
    CREATE VIRTUAL TABLE tasks_fts USING fts5 (title, notes, updates, tokenize = 'porter unicode61');

    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """,
    # 2: customers become records (projects.customer text → customers + projects.customer_id).
    """
    CREATE TABLE customers (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        notes      TEXT NOT NULL DEFAULT '',
        archived   INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX customers_name ON customers (lower(name));
    INSERT INTO customers (name, created_at, updated_at)
        SELECT trim(customer), MIN(created_at), MIN(created_at) FROM projects
        WHERE customer IS NOT NULL AND trim(customer) <> ''
        GROUP BY lower(trim(customer));
    ALTER TABLE projects ADD COLUMN customer_id INTEGER REFERENCES customers (id) ON DELETE SET NULL;
    UPDATE projects SET customer_id =
        (SELECT c.id FROM customers c WHERE lower(c.name) = lower(trim(projects.customer)));
    ALTER TABLE projects DROP COLUMN customer;
    CREATE INDEX projects_customer ON projects (customer_id);
    """,
    # 3: customer hub: profile, overview, meetings (+ the tasks they produced), topics, links/launchers.
    """
    ALTER TABLE customers ADD COLUMN website TEXT;
    ALTER TABLE customers ADD COLUMN logo TEXT;
    ALTER TABLE customers ADD COLUMN overview TEXT NOT NULL DEFAULT '';
    ALTER TABLE customers ADD COLUMN overview_source TEXT;
    ALTER TABLE customers ADD COLUMN overview_updated_at TEXT;

    -- A meeting is either upcoming (status 'scheduled', synced from the calendar, with prep
    -- notes) or a recap ('held'). Logging a recap for a calendar event upgrades the same row.
    CREATE TABLE meetings (
        id           INTEGER PRIMARY KEY,
        customer_id  INTEGER NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
        project_id   INTEGER REFERENCES projects (id) ON DELETE SET NULL,
        status       TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('scheduled', 'held', 'cancelled')),
        title        TEXT NOT NULL,
        held_on      TEXT NOT NULL,
        starts_at    TEXT,
        ends_at      TEXT,
        calendar_id  TEXT UNIQUE,
        location     TEXT,
        attendees    TEXT NOT NULL DEFAULT '',
        prep         TEXT NOT NULL DEFAULT '',
        summary      TEXT NOT NULL DEFAULT '',
        decisions    TEXT NOT NULL DEFAULT '',
        external_url TEXT,
        source       TEXT NOT NULL DEFAULT 'app',
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
    );
    CREATE INDEX meetings_customer ON meetings (customer_id, held_on);
    CREATE INDEX meetings_upcoming ON meetings (status, starts_at);

    -- Claude's proposed task changes, reviewed in the app before they apply.
    CREATE TABLE changesets (
        id          INTEGER PRIMARY KEY,
        source      TEXT NOT NULL,
        summary     TEXT NOT NULL DEFAULT '',
        meeting_id  INTEGER REFERENCES meetings (id) ON DELETE SET NULL,
        customer_id INTEGER REFERENCES customers (id) ON DELETE SET NULL,
        status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'partial', 'rejected')),
        created_by  TEXT NOT NULL DEFAULT 'mcp',
        created_at  TEXT NOT NULL,
        decided_at  TEXT
    );
    CREATE INDEX changesets_status ON changesets (status, id);

    CREATE TABLE changes (
        id           INTEGER PRIMARY KEY,
        changeset_id INTEGER NOT NULL REFERENCES changesets (id) ON DELETE CASCADE,
        seq          INTEGER NOT NULL,
        action       TEXT NOT NULL CHECK (action IN ('create', 'update', 'note', 'complete', 'add_link')),
        task_id      INTEGER REFERENCES tasks (id) ON DELETE SET NULL,
        payload      TEXT NOT NULL,           -- JSON: the proposed fields / note / link
        before       TEXT,                    -- JSON: the task as it was when proposed
        reason       TEXT NOT NULL DEFAULT '',
        status       TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'applied', 'rejected', 'failed')),
        result_id    INTEGER,                 -- task (or link) id once applied
        error        TEXT
    );
    CREATE INDEX changes_set ON changes (changeset_id, seq);

    CREATE TABLE meeting_tasks (
        meeting_id INTEGER NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
        task_id    INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
        action     TEXT NOT NULL,
        PRIMARY KEY (meeting_id, task_id)
    );
    CREATE INDEX meeting_tasks_task ON meeting_tasks (task_id);

    CREATE TABLE customer_topics (
        id                INTEGER PRIMARY KEY,
        customer_id       INTEGER NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
        name              TEXT NOT NULL,
        summary           TEXT NOT NULL DEFAULT '',
        status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'watching', 'resolved')),
        mentions          INTEGER NOT NULL DEFAULT 1,
        last_mentioned_on TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
    );
    CREATE UNIQUE INDEX customer_topics_name ON customer_topics (customer_id, lower(name));

    CREATE TABLE customer_links (
        id          INTEGER PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
        kind        TEXT NOT NULL CHECK (kind IN ('link', 'launcher')),
        label       TEXT NOT NULL,
        url         TEXT,
        command     TEXT,
        cwd         TEXT,
        mode        TEXT NOT NULL DEFAULT 'terminal' CHECK (mode IN ('terminal', 'background')),
        sort_key    REAL NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    );
    CREATE INDEX customer_links_customer ON customer_links (customer_id, sort_key);
    """,
    # 4: desktop agents (todo-agent on the Mac / Omarchy) and the launcher runs they execute.
    """
    ALTER TABLE customer_links ADD COLUMN agent TEXT;  -- preferred machine; NULL = pick when running

    CREATE TABLE agents (
        name       TEXT PRIMARY KEY,
        platform   TEXT NOT NULL,
        version    TEXT NOT NULL DEFAULT '',
        last_seen  TEXT NOT NULL,
        created_at TEXT NOT NULL
    );

    CREATE TABLE launcher_runs (
        id           INTEGER PRIMARY KEY,
        link_id      INTEGER REFERENCES customer_links (id) ON DELETE SET NULL,
        customer_id  INTEGER REFERENCES customers (id) ON DELETE SET NULL,
        agent        TEXT NOT NULL,
        label        TEXT NOT NULL,
        command      TEXT NOT NULL,
        cwd          TEXT,
        mode         TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN
                     ('queued', 'claimed', 'running', 'succeeded', 'failed', 'declined', 'expired', 'cancelled')),
        exit_code    INTEGER,
        output       TEXT NOT NULL DEFAULT '',
        error        TEXT,
        requested_at TEXT NOT NULL,
        claimed_at   TEXT,
        started_at   TEXT,
        finished_at  TEXT
    );
    CREATE INDEX launcher_runs_queue ON launcher_runs (agent, status, id);
    CREATE INDEX launcher_runs_link ON launcher_runs (link_id, id);
    """,
]


def connect(path: Path) -> sqlite3.Connection:
    if str(path) != ":memory:":
        path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    migrate(conn)
    return conn


def migrate(conn: sqlite3.Connection) -> None:
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    for index, script in enumerate(MIGRATIONS[version:], start=version + 1):
        conn.executescript(f"BEGIN; {script}; PRAGMA user_version = {index}; COMMIT;")
