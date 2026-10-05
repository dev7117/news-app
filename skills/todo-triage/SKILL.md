---
name: todo-triage
description: Work the user's todo app and customer hubs (MCP server "todo"). Use it to turn meeting notes, transcripts, or email threads into a meeting recap plus proposed task changes; to sync upcoming customer meetings from their calendar and write prep; or to refresh a customer's overview. Triggers include: meeting notes or a transcript pasted in, "action items", "follow-ups", "what do I need to do from this", "update my todo list", "triage this", "prep me for my meetings this week", "sync my calendar to todo", "what's going on with <customer>".
---

# Todo + customer hubs

The MCP server **todo** holds the user's tasks and a hub per customer: an overview, topics,
upcoming meetings with prep, meeting recaps, links and projects. If its tools aren't
available, say so and stop. Never write tasks to a file instead.

**Trust model.** You write hub content directly: recaps, calendar meetings, prep, overview,
topics. You never change tasks directly. `propose_changes` records a change set that the
user reviews as a diff in the app (Review) and approves item by item. Customer links also
go through proposals (`add_link`).

## A. Meeting notes → recap + proposals

1. **Read the source.** Identify the customer, meeting title, date (YYYY-MM-DD) and
   attendees. Call `get_overview`, then `get_customer` for that customer to see open work,
   topics and upcoming meetings. If the meeting is in `upcoming_meetings` (synced from the
   calendar), note its `calendar_id`.
2. **Log the recap** with `log_meeting`:
   - `summary`: short markdown bullets covering what was discussed.
   - `decisions`, `attendees`, and `project` if the meeting was about one.
   - `calendar_id`, if the meeting was synced from the calendar.
   - `topics` it touched. Reuse existing topic names. Set `status: resolved` when a topic closed.

   Keep the returned meeting `id`.
3. **Extract action items the user owns or must chase.** Skip work that belongs only to
   others, and skip FYIs.
4. **Match each item.** Call `search_tasks` with 3–6 distinctive words; it also covers
   closed tasks. Classify each item as one of:
   - `note`: progress on tracked work, optionally with a `status` change.
   - `complete`: the user said it's done.
   - `update`: due date, priority or scope changed, or a ticket link via `external_url`.
   - `create`: genuinely new; set its `project` to the right customer project.
   - `add_link`: a customer-wide URL, such as their Jira board.
   - Nothing.

   Prefer one task with history over a near-duplicate. Give every item a `reason` (the
   line from the notes).
5. **Propose once.** Call `propose_changes(meeting_id=…, summary="Acme weekly: 2 new, 1 done, SSO update", items=[…])`.
6. **Refresh the overview.** Use `set_customer_overview` to rewrite "where things stand"
   so it integrates the new meeting: current state, open threads, risks, next milestone.
   It should read in a minute.
7. **Report.** Show the user the returned `diff` and tell them it's waiting in **Review**.
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

## C. "What's going on with <customer>?"

Call `get_customer` and answer from the overview, topics, recent recaps and the work that
needs attention. Offer to refresh the overview if it's stale.
