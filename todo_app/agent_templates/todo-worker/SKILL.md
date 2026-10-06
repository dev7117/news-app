---
name: todo-worker
description: How to work a task assigned to you from the user's todo app when running headless as a todo agent — read the assignment, report progress, ask the user when blocked, and finish with a PR and request_review. Use whenever your prompt says you are working a todo task or running a todo setup check.
---

# Working a todo task

You were started by todo-agent on one of the user's machines because the user assigned a task
to you in their todo app. You're headless: the user isn't watching the terminal. The `todo`
MCP server (tools below) is your only line to them, and it only works for this task.

**The user only sees what's on the task** — never your working folder, never this terminal.
Everything you produce goes on the task:
- write-ups, drafts, findings, plans → notebook blocks (`add_note`; revise with `update_note`);
- files (PDFs, spreadsheets, images, exports) → save them in `./outputs/` (attached to the task
  when the run ends) or send them now with `attach_file`;
- what happened → `report_progress`.

Never tell the user a file is "in the scratch folder" or at a local path; they can't open it.

## 1. Read the assignment

Call `get_assignment` first. It returns:
- `task`: title, notes (the spec), status, children (if it's a group), external link;
- `notebook`: blocks; `kind: "subtask"` ones are checkboxes;
- `history`: what happened so far, including your earlier runs;
- `new_from_user` / `reply`: what the user said since you last ran. **Answer it first.**
- `repo`: you're already in a git worktree on `repo.branch`, created from `default_branch`.
  **`repo: null` means general work**: you're in a scratch folder for this task, there's no git
  and no PR. Follow `how` in the assignment.

If it says `setup_check: true`, do only what it says (call `report_progress("ready …")`) and stop.

## 2. Plan, briefly

For anything bigger than a one-file change, break it down with `add_subtask` (a title each,
optional markdown body) and `report_progress` a 2–4 line plan. Read the repo's CLAUDE.md first.

## 3. Work

- Follow this repo's CLAUDE.md and your agent file's rules and checks.
- `report_progress` at real milestones (not every step): what's done, what's next, anything
  surprising. Plain sentences; the user reads these on their phone.
- `check_subtask(block_id)` as you finish each subtask.
- Blocked on a decision only the user can make (scope, product choice, credentials, anything
  destructive)? Call `ask(question)` with a concrete question and options, then **stop**. Their
  answer starts a new run that resumes this session.

## 4. Finish

**General work (no repo):** make sure the deliverable is on the task (blocks via `add_note`,
files in `./outputs/` or via `attach_file`), then `request_review(summary)` without a pr_url:
a few lines on what you did and what's on the task now. Stop.

**Repo work:**
1. Run the checks your agent file lists. Fix what fails.
2. Commit with a clear message, `git push -u origin HEAD`, and open a PR with `gh pr create`
   (title from the task, body: what changed, how you checked it, `Todo task #<id>`).
3. `request_review(summary, pr_url)`: summary = what you did and how you verified it, in a
   few lines. This leaves the task waiting on the user's review and proposes marking it done.
4. Stop.

Never merge, never push to the default branch, never deploy. If you can't finish (tests you
can't fix, missing access), `report_progress` what you tried, then `ask` or just stop — the
app puts the task back in the user's hands with your notes.

## Tools

| tool | what |
|---|---|
| `get_assignment()` | the task, notebook, history, the user's replies, repo/branch |
| `report_progress(note, task_id?)` | a progress note in the task's history |
| `add_note(title, body)` / `update_note(block_id, body, append?)` | a notebook block on the task: the write-up itself |
| `attach_file(name, text \| content_base64, note?)` | attach a file to the task now (or save it in `./outputs/`) |
| `set_status(status, waiting_on?, note?)` | `in_progress` or `waiting` (e.g. waiting on CI) |
| `add_subtask(title, body?)` / `check_subtask(block_id, done?)` | your plan as checkboxes |
| `ask(question)` | wait on the user; stop after |
| `request_review(summary, pr_url)` | finished: PR + propose done; stop after |

`task_id` defaults to your task; you may also use it on that task's children (a group).
