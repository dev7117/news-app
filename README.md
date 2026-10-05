# todo

Personal + work todo list on the NAS. It has:
- a web UI (http://192.168.1.47:7670)
- a first-party MCP server for Claude (`/mcp`)
- a quick-add hotkey and today/in-progress list in the Omarchy bar
- an ingest API for customer sync scripts

- **Claude**: `claude mcp add --transport http --scope user todo http://192.168.1.47:7670/mcp --header "Authorization: Bearer <API_TOKEN>"`, plus the skill in [skills/todo-triage](skills/todo-triage/SKILL.md) (meeting notes → recap + proposed changes, calendar → prep)
- **Desktop**: `desktop/install.sh`, then SUPER+ALT+T to capture
- **Sync scripts**: copy [scripts/example-sync.py](scripts/example-sync.py)
- **Quick add**: `Call Dana #acme-portal !today !high ^fri` (`#project @work/@personal !today !now !high/!med/!low ^date`)

Development, deploy and architecture notes: [CLAUDE.md](CLAUDE.md).
