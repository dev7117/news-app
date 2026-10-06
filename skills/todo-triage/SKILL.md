---
name: todo-triage
description: Work the user's todo app and customer hubs (MCP server "todo"). Use it to turn meeting notes, transcripts, or email threads into a meeting recap plus proposed task changes; to sync upcoming customer meetings from their calendar and write prep; or to update where things stand with a customer. Triggers include: meeting notes or a transcript pasted in, "action items", "follow-ups", "what do I need to do from this", "update my todo list", "triage this", "prep me for my meetings this week", "sync my calendar to todo", "what's going on with <customer>".
---

# Todo + customer hubs

The MCP server **todo** holds the user's tasks and a hub per customer: topics (each with
where things stand and a timeline of updates),
upcoming meetings with prep, meeting recaps, links and projects. If its tools aren't
available, say so and stop. Never write tasks to a file instead.

**Trust model.** You write hub content directly: recaps, calendar meetings, prep, topic
updates. You never change tasks directly. `propose_changes` records a change set that the
user reviews as a diff in the app (Review) and approves item by item. Customer links also
go through proposals (`add_link`).

**Refs: the app remembers what the user decided.** Give every proposed item from a source
you might read again a `ref`: `gmail:<threadId>`, `gcal:<eventId>` (or
`gcal:<eventId>#<item-slug>` for a meeting's action items), `jira:<KEY-123>`,
`slack:<channel>/<ts>`, `teams:<messageId>`. Run `check_refs` first.
- `rejected`: leave it alone.
- `pending`: it's already in Review.
- `tracked`: send a note or update to that task; the ref finds it.

`propose_changes` drops anything already decided on, or touching a closed task, and lists it
in `skipped`. Use `reconsider` or `reopen` only for genuinely new information, with a reason.

**Scheduled, per-client syncs** use the `todo-sync` skill (`/todo-sync <client>`), which
follows `get_sync_guide`. This skill is for what the user hands you directly.

## A. Meeting notes → recap + proposals

1. **Read the source.** Identify the customer, meeting title, date (YYYY-MM-DD) and
   attendees. Call `get_overview`, then `get_customer` for that customer to see open work,
   topics and upcoming meetings. If the meeting is in `upcoming_meetings` (synced from the
   calendar), note its `calendar_id`.
2. **Log the recap** with `log_meeting`:
   - `summary`: short markdown bullets covering what was discussed.
   - `decisions`, `attendees`, and `project` if the meeting was about one.
   - `calendar_id`, if the meeting was synced from the calendar.
   - `topics` it touched, each with `update` (what was said about it in this meeting, 1-3
     short sentences) and, only when the picture changed, `where_things_stand` (the
     current state, 1-3 sentences). Reuse existing topic names from `get_customer`; a new
     name creates a topic, so only use one for a genuinely new thread. Set
     `status: resolved` when a topic closed. Updates are appended to each topic's timeline;
     never restate history in them.

   Keep the returned meeting `id`.
3. **Extract action items the user owns or must chase.** Skip work that belongs only to
   others, and skip FYIs.
4. **Match each item.** Call `search_tasks` with 3–6 distinctive words; it also covers
   closed tasks. Classify each item as one of:
   - `note`: progress on tracked work, optionally with a `status` change.
   - `complete`: the user said it's done.
   - `update`: due date, priority or scope changed, or a ticket link via `external_url`.
   - `add_subtask` / `check_subtask`: a concrete step of an existing task came up, or was
     finished. Tasks have subtask blocks; read them with `get_task`.
   - **Someone else owns it**: if another person committed to an action item, create or update
     the task with `assignee` (their name). It leaves the user's Today and shows on that
     person's page.
   - **The user owns it, but it concerns someone** (to discuss, to keep them posted): keep
     it the user's and add them with action `follow`. Writing `@[Name](#person-ID)` in a
     task's notes does the same.
   - Add anyone missing with `create_person` first (`list_people` to match).
   - `create`: genuinely new; set its `project` to the right customer project.
   - `add_link`: a customer-wide URL, such as their Jira board.
   - **Idea, not a task:** maybes, "it'd be nice if", things a customer hinted at, and
     anything not ready to be worked. Call `list_ideas` for the customer. Either grow a
     matching idea, which is a notebook of markdown blocks (`add_idea_block` for a new
     part, `update_idea_block` with `append` to extend one), or `capture_idea` with a
     one-line summary and a "What they said" block. These write directly, and ideas stay
     off the boards. When unsure, make it an idea.
   - `promote_idea`: an existing idea that's now clearly committed work.
   - **Agent work:** a task that one of the user's agents plainly handles (`list_agents`:
     its projects and role) can be proposed with `assignee` = that agent. Approving it
     starts the agent. When unsure, suggest it rather than assign.
   - **Files:** an attachment that belongs to a task goes on it with `attach_task_file`.
   - Nothing.

   Prefer one task with history over a near-duplicate. Give every item a `reason` (the
   line from the notes), and a `ref` when it came from mail, a ticket, chat or a calendar
   event.
5. **Propose once.** Call `propose_changes(meeting_id=…, summary="Acme weekly: 2 new, 1 done, SSO update", items=[…])`.
6. **Report.** Show the user the returned `diff` and tell them it's waiting in **Review**.
   List anything you skipped and why. Don't re-propose; use `list_proposals` to see what's
   pending or decided.

Don't set `today` or `in_progress` unless the user asks. They curate their own day.

## B. Calendar → upcoming meetings + prep

1. Read the user's calendar for the window (default: today plus 7 days).
2. Keep **customer** meetings only. Match each to a customer by attendee email domains,
   the title, or the customer's website (`list_customers`). Skip internal meetings. If a
   meeting can't be matched, mention it rather than guessing.
3. Call `sync_calendar(window_start, window_end, events=[{calendar_id, customer, title, starts_at, ends_at, attendees, location}])`.
   Events that disappeared from the window become cancelled.
4. For each upcoming meeting, call `get_customer` and write `set_meeting_prep` as short
   markdown bullets covering:
   - in-progress and overdue tasks to raise
   - `waiting` items to chase, and who they're waiting on
   - active topics
   - what changed since the last recap
   - questions worth asking
5. Summarise the week for the user: which customers they're meeting, and the one or two
   things to prepare for each.

## C. Prepping a 1:1

`get_person` gives what to follow up on (overdue, due this week, waiting on them), what's on
their plate across customers, shared work, recent wins, meetings, and their 1:1 notes. Draft an
agenda into their notes with `add_person_note` (title like "1:1 2026-10-06"), then summarise it
for the user.

## D. "What's going on with <customer>?"

Call `get_customer` and answer from its topics (where each stands and the latest updates),
recent recaps and the work that needs attention. Something new from an email or a ticket
goes on the right topic with `log_topic_updates`.
