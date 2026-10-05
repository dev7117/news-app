# todo

A todo list for personal and work projects, served from the Synology NAS. One FastAPI process serves:
- the web UI (React SPA, house style)
- the REST API at `/api/*`
- **customer hubs**: an overview, topics, upcoming meetings with prep, meeting recaps, links and desktop tools, per customer
- a first-party **MCP server** at `/mcp`, for Claude: recaps, calendar sync and prep, overviews, and *proposed* task changes

Everything shares one SQLite database. Tasks come from the app, the bar's quick-add hotkey, sync scripts (`POST /api/ingest`) and Claude (MCP).

## Model

- **Area**: `work` | `personal`. **Projects** belong to an area and optionally a **customer** (`customers` table; a task's customer comes from its project). Passing a customer *name* to project create/update finds it case-insensitively or creates it. A task's area follows its project.
- **Status**: `inbox` → `todo` → `in_progress` → `waiting` (`waiting_on`) → `done` / `cancelled`. Untriaged captures land in `inbox`.
- **Today**: a flag stored as the date it was set (`today_on`), so it carries over and shows "since Thu". The bar and the Today page show today ∪ in-progress, ordered by `sort_key` (drag to reorder).
- **History** (`task_updates`): `created` / `change` (readable field diffs) / `note` (progress), each tagged with a `source` (`app`, `intake`, `mcp`, `meeting: Acme weekly 2026-10-04`, `jira-acme`…). Every write goes through `Store`, so all entry points log the same way.
- **Customer hub** (`todo_app/hub.py`, `/customers/:id`):
  - Customer profile: website, logo (uploaded, or fetched from the website into `<data>/logos/`), notes, and an `overview` markdown ("where things stand", usually written by Claude).
  - `customer_topics`: what the customer keeps raising (active / watching / resolved), upserted by name with a mention count.
  - `meetings`: `scheduled` rows synced from the calendar (keyed by `calendar_id`, with `prep`) or `held` recaps (summary, decisions). Logging a recap with a `calendar_id` upgrades the scheduled row. `meeting_tasks` links a meeting to the tasks it produced.
  - `customer_links`: bookmarks, plus **desktop tools** (commands run by todo-agent; see below).
- **Desktop tools and todo-agent** (`todo_app/agents.py`, `todo_app/agent_dist/`):
  - A hub tool is a command that runs on one of the user's machines: the Mac (launchd) or Omarchy (systemd user service), via `todo-agent`, a single stdlib-only Python file (3.9+).
  - The agent long-polls `POST /api/agent/poll` with the API token. **Run** queues a `launcher_runs` row for a machine: the one picked, else the tool's `agent`, else the only one online. The agent claims the run, executes it, and reports status and output to `POST /api/agent/runs/{id}`.
  - **Interactive** mode opens a terminal (macOS: Terminal / iTerm / Ghostty from `agent.json`; Linux: `xdg-terminal-exec`) and records the TTY session with `script`. **Headless** mode streams output every 2s and sends a notification when done.
  - The agent fingerprints each command itself (sha256 of command + cwd) and asks before running anything new or changed: a native dialog on macOS, a terminal prompt on Linux. "Always allow" goes in `~/.config/todo/agent-approvals.json`.
  - Runs nobody claims expire after 2 minutes. Claimed runs that never start expire after 15.
  - Install: `curl -fsSL <url>/agent/install.sh | sh -s -- "<name>"`. The app serves the installer and agent, and the installer prompts for the token. Settings → Machines lists the connected machines.
- **Proposals** (`todo_app/review.py`, `/review`): Claude never edits tasks directly.
  - `propose_changes` stores a `changesets` row plus `changes` rows (create / update / note / complete / add_link), each with a payload in Store terms and a snapshot of the task.
  - The Review page renders them as a git-style diff, flags tasks changed since the proposal, and applies the approved ids one by one. A failure doesn't block the rest, and new-task titles can be edited before applying.
  - Applied changes take the changeset's source (e.g. `meeting: Weekly sync 2026-10-05`) and link to its meeting.
  - The setting `review_claude_changes` (default on) controls review; when it's off, proposals apply at once.
- **Board** (All tasks + project pages, `frontend/src/components/Board.tsx`): columns To do · In progress · Waiting · Done (last 14 days). Inbox stays on its own page. Drag a card to change its status. All tasks swimlanes by customer (default), by project, or not at all. The catch-all lanes are "No customer" (work) and "Personal". Board/list, grouping and collapsed lanes are kept per browser in localStorage.
- **Search**: FTS5 over title, notes and history (`tasks_fts`, rowid = task id, maintained by `Store._reindex`). Words are OR'd and prefix-matched, bm25 weights title > notes > history, and it includes closed tasks so Claude can tell "already done" from "new".
- **External items**: `(source, external_id)` is unique. `upsert_external` only changes the fields passed. A closed status always applies, but an open one only reopens, so a sync never undoes "in progress".

## Critical files

- [main.py](main.py): entrypoint (`telemetry.setup` first, then uvicorn)
- [todo_app/store.py](todo_app/store.py): all domain logic and history
- [todo_app/db.py](todo_app/db.py): schema + append-only migrations (`PRAGMA user_version`)
- [todo_app/api.py](todo_app/api.py): REST, incl. `/api/bar` (widget) and `/api/ingest` (scripts, token)
- [todo_app/hub.py](todo_app/hub.py): customer hub (meetings, calendar sync, topics, links/launchers, logos)
- [todo_app/review.py](todo_app/review.py): proposals: validation, diff rendering, apply/reject
- [todo_app/mcp_server.py](todo_app/mcp_server.py): MCP tools + `INSTRUCTIONS` (the trust model), bearer-token wrapper
- [todo_app/agents.py](todo_app/agents.py) + [todo_app/agent_dist/](todo_app/agent_dist/): machines, the run queue, and the todo-agent script + installer the app serves
- [todo_app/quickadd.py](todo_app/quickadd.py): `#project @area !today !now !high ^fri` syntax
- [todo_app/telemetry.py](todo_app/telemetry.py): JSON logs + OTel (copied from underground-bot)
- [frontend/](frontend/): React + Vite + Tailwind 3 + TanStack Query; tokens in `src/index.css` (house style)
- [desktop/](desktop/): omarchy-shell bar widget `dev.todo` + `install.sh` (SUPER+ALT+T quick add)
- [skills/todo-triage/SKILL.md](skills/todo-triage/SKILL.md): the Claude skill for meeting notes → tasks
- [scripts/example-sync.py](scripts/example-sync.py): template for customer-source sync scripts

## Environment

- `API_TOKEN`: bearer token required on `/mcp` and `/api/ingest`. Unset = open. Always set it in prod.
- `TODO_DB` (default `data/todo.db`; `/data/todo.db` in the image), `TODO_PORT` (default 7670)
- `TZ`: decides what "today" is. Set it on the stack.
- `OTEL_*`: standard OpenTelemetry vars (see Observability)

The web UI and the rest of `/api` are open on the LAN, like the user's other NAS apps.

## Development workflow (for Claude Code)

1. **Check**: `.venv/bin/python -m pytest -q` and `cd frontend && npx tsc --noEmit`
2. **Run locally**: `run-local` skill (below)
3. **Open a PR**: `open-pr` skill, once the user likes it
4. **Merge**: the user merges (or asks Claude to)
5. **Deploy**: `deploy-nas` skill

Never commit straight to `main`, and never merge or redeploy production without the user asking.

### Local run
- Compose: `docker compose -f docker-compose.dev.yml up -d --build` → http://localhost:7670, health `/health` (`{"status":"ok"}`)
- Data in `.local-data/` (git-ignored). Local `API_TOKEN` is `local-token`.
- Sample data: `.venv/bin/python scripts/seed-sample-data.py http://localhost:7670 local-token` (into an empty DB), then `scripts/seed-hub-demo.py`, which drives MCP like Claude: recap, overview, calendar sync with prep, and a pending proposal
- Dev server without Docker: `TODO_DB=/tmp/todo.db .venv/bin/python main.py` + `cd frontend && npm run dev` (Vite proxies `/api` to :7670)
- Rootless Docker runs the container's `python main.py` as your uid: **never `pkill -f main.py`**, it kills the container too

### Production deploy
- Build: `.github/workflows/publish-container.yml` on push to `main` → `ghcr.io/dev7117/todo:latest` + `sha-<commit>` (image named `todo`, not after the repo)
- Portainer: http://192.168.1.47:9000, stack **`todo`** (endpoint 2), web-editor stack from [portainer-stack.yml](portainer-stack.yml); stack env `API_TOKEN`
- Production: http://192.168.1.47:7670, health `/health`. Data in `/volume1/docker/todo/data/todo.db`

### Observability
- Logs: JSON on stdout → Loki (`service_name="todo"`, `stack="todo"`)
- Traces: `service.name = todo-web`. Spans:
  - FastAPI requests
  - `tools/call <tool>` → `mcp.tool_call` (MCP SDK + ours)
  - `proposal.create` (source, count, meeting) and `proposal.decide` (resulting status)
  - `calendar.sync` (created/updated/cancelled counts)
  - `customer.logo_fetch`
  - `ingest.batch` (source, created/updated/closed) `/health` and `/api/bar` (polled by the widget) aren't traced.
- `obs traces '{ resource.service.name = "todo-web" && name = "proposal.create" }' --since 1d`

### Desktop
- `desktop/install.sh [URL]` installs todo-agent (via the served installer; skip with `TODO_SKIP_AGENT=1`) and the widget to `~/.config/omarchy/plugins/dev.todo`, writes `~/.config/todo/bar.json` (`{"url": …}`), adds `dev.todo` after `dev.mediadeck` in `~/.config/omarchy/shell.json`, writes `~/.config/hypr/todo.lua` (SUPER+ALT+T → `omarchy-shell dev.todo add ""`), and restarts the shell. Undo it with `--uninstall`.
- After editing the QML, re-run the installer (or copy it and run `omarchy restart shell`). Never run `omarchy-shell shell rescanPlugins`; it has crashed the shell.
- The widget polls `GET /api/bar` every 30s and on open, and writes via `POST /api/tasks/quick` / `PATCH /api/tasks/{id}`.

### MCP
- Register in Claude Code: `claude mcp add --transport http --scope user todo http://192.168.1.47:7670/mcp --header "Authorization: Bearer <API_TOKEN>"`
- Stateless streamable HTTP, JSON responses. DNS-rebinding protection is off because it's reached by LAN IP; the token guards it.
- Keep the trust model: tools may write hub content, but task changes only go through `review.propose`.
- Add a tool: an `async def` decorated `@_tool(READ|WRITE)` in `mcp_server.py` that calls `store`. Raise `Invalid` / `NotFound` for user-fixable errors (they become tool errors). Update `INSTRUCTIONS` and the skill if the workflow changes.
