---
name: todo-sync
description: Sync one client (or all) from Gmail, Google Calendar, Jira and Slack/Teams into the user's todo app — hub updates written directly, task changes proposed for review, nothing the user already rejected or closed brought back. Use when a routine or the user says "/todo-sync <client>", "sync <client>", "run the <client> sync", or "set up sync for <client>". The argument is the client name, or "all".
---

# todo-sync

The procedure lives in the todo app so it always matches the app's features. This skill
just loads it.

1. The MCP server **todo** must be connected. If its tools aren't available, say so and stop.
2. Call `get_sync_guide(customer="<the client from the arguments>")` and **follow it exactly**.
   It starts with `get_client_sync`, which holds this client's rules and **feeds**. Each feed
   is one query against one source (a JQL, a Gmail search, Slack channels), with its own
   cursor. There can be several per source.
3. No client given? Ask which one, or run `all` if this is a scheduled run.
4. "Set up sync for <client>", or "add a feed": call `get_client_sync`. Then look at recent
   mail, calendar, Jira and Slack/Teams activity with that client to suggest feeds: their
   email domains, meeting title words, a JQL per kind of work, channels worth watching (and
   how to treat each). Show them to the user, then save each with `save_sync_feed` once they
   agree, and client-wide rules with `set_client_sync`. Then tell them the routine prompt
   to schedule: `/todo-sync <client>`.

Never write tasks anywhere but the todo app, and never bypass `propose_changes` for task changes.
