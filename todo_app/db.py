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
    # 5: focus modes: a proposal belongs to work or personal (NULL = mixed, shown in both).
    """
    ALTER TABLE changesets ADD COLUMN area TEXT;
    UPDATE changesets SET area = 'work' WHERE customer_id IS NOT NULL;
    """,
    # 6: ideas, the not-yet-tasks backlog. Never on boards / today / the bar; promoted into a task.
    """
    CREATE TABLE ideas (
        id          INTEGER PRIMARY KEY,
        title       TEXT NOT NULL,
        summary     TEXT NOT NULL DEFAULT '',   -- a line or two; the body lives in idea_blocks
        area        TEXT NOT NULL CHECK (area IN ('work', 'personal')),
        customer_id INTEGER REFERENCES customers (id) ON DELETE SET NULL,
        project_id  INTEGER REFERENCES projects (id) ON DELETE SET NULL,
        status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'promoted', 'dropped')),
        task_id     INTEGER REFERENCES tasks (id) ON DELETE SET NULL,
        source      TEXT NOT NULL DEFAULT 'app',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        decided_at  TEXT
    );
    CREATE INDEX ideas_scope ON ideas (status, area, customer_id, project_id);

    -- Notebooks: ordered markdown blocks, each a small document of its own, belonging to an
    -- idea or a task. On tasks a block can be a subtask (kind 'subtask', with done / done_at).
    -- People you work with: assign tasks to them, have them follow tasks, keep 1:1 notes on them.
    CREATE TABLE people (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        email       TEXT,
        title       TEXT NOT NULL DEFAULT '',
        customer_id INTEGER REFERENCES customers (id) ON DELETE SET NULL,  -- their employer; NULL = your side
        area        TEXT NOT NULL DEFAULT 'work' CHECK (area IN ('work', 'personal')),
        notes       TEXT NOT NULL DEFAULT '',
        archived    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    );
    CREATE UNIQUE INDEX people_email ON people (lower(email)) WHERE email IS NOT NULL;
    ALTER TABLE tasks ADD COLUMN assignee_id INTEGER REFERENCES people (id) ON DELETE SET NULL;  -- NULL = you
    CREATE INDEX tasks_assignee ON tasks (assignee_id);
    -- Followers: people a task concerns (to discuss, to keep in the loop). The task stays the
    -- assignee's; followers see it on their page. @mentions in a task's text add followers.
    CREATE TABLE task_people (
        task_id   INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
        person_id INTEGER NOT NULL REFERENCES people (id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, person_id)
    );
    CREATE INDEX task_people_person ON task_people (person_id);

    CREATE TABLE blocks (
        id         INTEGER PRIMARY KEY,
        idea_id    INTEGER REFERENCES ideas (id) ON DELETE CASCADE,
        task_id    INTEGER REFERENCES tasks (id) ON DELETE CASCADE,
        person_id  INTEGER REFERENCES people (id) ON DELETE CASCADE,   -- 1:1 notes
        position   REAL NOT NULL,
        kind       TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'subtask')),
        title      TEXT NOT NULL DEFAULT '',
        body       TEXT NOT NULL DEFAULT '',
        collapsed  INTEGER NOT NULL DEFAULT 0,
        done       INTEGER NOT NULL DEFAULT 0,
        done_at    TEXT,
        source     TEXT NOT NULL DEFAULT 'app',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK ((idea_id IS NOT NULL) + (task_id IS NOT NULL) + (person_id IS NOT NULL) = 1)
    );
    CREATE INDEX blocks_idea ON blocks (idea_id, position);
    CREATE INDEX blocks_task ON blocks (task_id, position);
    CREATE INDEX blocks_person ON blocks (person_id, position);

    -- What a history entry was about, for the task timeline (status, today, subtask_done…).
    ALTER TABLE task_updates ADD COLUMN event TEXT;

    -- promote_idea joins the proposal actions (CHECK constraints can't be altered in place).
    CREATE TABLE changes_new (
        id           INTEGER PRIMARY KEY,
        changeset_id INTEGER NOT NULL REFERENCES changesets (id) ON DELETE CASCADE,
        seq          INTEGER NOT NULL,
        action       TEXT NOT NULL CHECK (action IN ('create', 'update', 'note', 'complete', 'add_link', 'promote_idea',
                                                     'add_subtask', 'check_subtask', 'follow')),
        task_id      INTEGER REFERENCES tasks (id) ON DELETE SET NULL,
        payload      TEXT NOT NULL,
        before       TEXT,
        reason       TEXT NOT NULL DEFAULT '',
        status       TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'applied', 'rejected', 'failed')),
        result_id    INTEGER,
        error        TEXT
    );
    INSERT INTO changes_new SELECT * FROM changes;
    DROP TABLE changes;
    ALTER TABLE changes_new RENAME TO changes;
    CREATE INDEX changes_set ON changes (changeset_id, seq);
    """,
    # 7: board order. Dragging a card up or down a column ranks that column; unranked tasks
    # (new ones) come after the ranked ones. Separate from sort_key, which orders today.
    """
    ALTER TABLE tasks ADD COLUMN board_rank REAL;
    """,
    # 8: task groups. Drag one task onto another (like an iOS folder) and both become children
    # of a new parent task; drop more onto the parent to add them. Boards show only top-level tasks.
    """
    ALTER TABLE tasks ADD COLUMN parent_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
    ALTER TABLE tasks ADD COLUMN created_via TEXT;  -- 'group' for parents made by grouping
    CREATE INDEX tasks_parent ON tasks(parent_id);
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
