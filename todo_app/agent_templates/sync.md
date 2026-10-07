# Sync {{customer}} into the todo app

You're running a scheduled sync for **{{customer}}**: read what's new for this client in the
user's tools (Gmail, Google Calendar, Jira, Slack/Teams), write what you learn into the
client's hub, and propose task changes for the user to review. Nobody is watching while you
run; the user reads your report and the Review page later. Be quiet and precise: one good
proposal beats five noisy ones.

If the argument is `all`, call `get_client_sync` for each client that has sync enabled
(`list_customers`, then check each) and run this once per client.

## 0. Load the client
1. `get_client_sync("{{customer}}")`. You get:
   - **rules**: client-wide guidance. **They override everything below.**
   - **feeds**: what to read. Each feed is one query against one source, with its own
     `filters`, its own `rules` (which override the client's for that feed), `enabled`, and
     its own `cursor` and last run. A client can have several feeds per source: two JQLs,
     a few Slack channels handled differently, separate Gmail searches.
   - the client's projects, people, topics, cadences, **open tasks with their refs**, and the
     user's agents.
2. No feeds yet, or a feed has no usable filters? Don't guess. Report what's missing and offer
   `save_sync_feed` with filters you'd suggest (domains seen in recent mail, the Jira project
   key), then skip it.
3. A connector a feed needs isn't available in this session? Skip that feed and say so in the
   report. Never invent data.

## 1. The window
Run every **enabled feed**. For each, read from its `cursor` minus one day (overlap is safe:
the ledger dedupes), or the last 3 days if it has no cursor. Remember the newest timestamp
you saw in that feed; it becomes its next cursor. Feeds can overlap (the same Jira issue
matched by two JQLs): refs make that harmless, it's still one task.

## 2. Refs: say where everything came from
Every item you propose gets a **ref**, stable across runs:

| Source | ref |
|---|---|
| Gmail thread | `gmail:<threadId>` |
| Calendar event | `gcal:<eventId>`; one of its action items: `gcal:<eventId>#<short-slug>` |
| Jira issue | `jira:<KEY-123>` |
| Slack message/thread | `slack:<channelId>/<thread ts>` |
| Teams message | `teams:<messageId>` |

Before reading items in depth, call **`check_refs`** with the refs of everything in the window:
- `rejected` → the user turned it down. **Leave it alone.** Only if something genuinely new
  happened (a new reply that changes the ask) may you propose it again with
  `reconsider: true` and a reason saying what's new.
- `pending` → it's already in Review. Skip it.
- `tracked` → it's task #N. New information becomes a `note` / `update` with the same ref
  (the ref finds the task). If the task is closed, only a clear sign the work is back
  justifies `reopen: true` with a reason; otherwise skip it.
- `unseen` → read it.

`propose_changes` enforces all of this and returns anything it dropped in `skipped`. Don't
retry skipped items.

## 3. Per feed, by its source
Apply the feed's `filters` exactly; its `rules` say how to treat what it finds.

**Gmail.** Threads matching the feed (domains, addresses, labels, query) with activity in
the window. Skip newsletters, automated notifications and FYIs unless the rules say otherwise.
A thread is one ref; its newest messages are what matter.

**Calendar.**
- Next 7 days: the client's meetings (the feed's domains / title patterns) → `sync_calendar` with the
  window and events, then `set_meeting_prep` for each: open and overdue work, waiting items to
  chase, active topics, what changed since the last meeting.
- If a cadence covers a meeting (`cadences`), `get_meeting_prep` and fill its talking points
  instead.
- Past meetings in the window with notes or a transcript (attached to the event, in Drive, or
  in mail) → `log_meeting` (pass `calendar_id`) with summary, decisions and topic updates; its
  action items become proposals with `gcal:<eventId>#<slug>` refs and that `meeting_id`.

**Jira.** Issues matching the feed (site, projects, JQL) that changed in the window. Without a
JQL, take those assigned to the user, or that they reported or watch. One issue = one task, ref `jira:<KEY>`; put the
issue URL in `external_url`. Status moves map to notes ("moved to In Review"); resolved
issues → `complete` only if the task is the user's to close.

**Slack / Teams.** The feed's channels/chats: messages mentioning the user, DMs from the
client's people, and threads they're in. Only asks and commitments become proposals; ref the
thread, not each message.

## 4. What to write
**Direct writes** (no review): what you learned about the client.
- Topics: `log_topic_updates` (append-only; change `where_things_stand` only when the picture
  moved).
- People: `create_person` for new client contacts, with their employer.
- Ideas: maybes, "it'd be nice if", things they hinted at → `capture_idea` / `add_idea_block`.
- Files: `attach_task_file` for an attachment that belongs on a task.

**Proposals** (`propose_changes`, one call per feed with `source="sync: {{customer}} · <feed name>"`,
a ref on every item, a `reason` quoting the line behind it):
- `create`: new work the user owns or must chase. Put it in the client's project (the
  client's default project if unsure), with `external_url` for tickets.
- `note`: progress on tracked work (optionally a status).
- `update`: due date, priority, scope, ticket link.
- `complete`: only when the user said it's done, or the source plainly shows it.
- `add_subtask` / `check_subtask`: steps of an existing task.
- `assignee` (someone else committed to it); `follow` (it concerns someone but stays the user's).
- **Agents.** If a task is plainly work one of the user's agents does (its projects and role
  in `agents`), set `assignee` to that agent; approving it starts the agent. When in doubt,
  leave it unassigned and name the agent as a candidate in your report.
- Several items that are really one piece of work → one task with subtasks, not several tasks.

Don't set `today` or `in_progress`; the user curates their own day.

## 5. Finish each feed
After its proposals went through (or there was nothing to propose):
`set_sync_state(customer, feed=<feed name or id>, cursor=<newest timestamp you processed>, summary="…")`.
If something failed, don't advance that feed's cursor.

## 6. Report
A short message for the user, per feed:
- what you read (e.g. "6 threads, 2 meetings");
- what's waiting in **Review** (new / notes / done);
- hub updates (topics, people, ideas);
- **skipped as already decided** (a count; list only the ones you `reconsider`ed);
- anything you couldn't match or access, and suggested feed changes (a new feed, a tighter JQL).

No proposals and nothing to report? Say so in one line.
