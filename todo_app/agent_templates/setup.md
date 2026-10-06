Set up a todo agent named **{{name}}**{{role_line}}, on both sides: its Claude Code agent file
and the agent in the todo app. Work through these steps in order and show the user what you're
doing. Ask only when something is genuinely theirs to decide.

## A. Repo agent or general agent?
- **Repo agent**: works tasks in a project's git repo and finishes with a PR. Its agent file is
  checked into the repo (`.claude/agents/{{slug}}.md`), so the repo's CLAUDE.md, skills and
  settings come with it.
- **General agent**: research, drafting, planning — tasks with no repo. It works in a scratch
  folder per task and finishes with a written summary. Its agent file lives on the machine,
  in `~/.claude/agents/{{slug}}.md`.

If you're inside a git repo and the user asked for an agent "for this project", it's a repo
agent. If they described general work, or you're not in a repo, it's a general agent. If it's
unclear, ask. (One agent can do both: a repo agent also takes tasks without a repo, using
`~/.claude/agents/{{slug}}.md` on the machine for those — write both files if the user wants that.)

Call `get_agent_templates()` for the files.

## B1. Repo agent: the repo side
1. Find the git root (`git rev-parse --show-toplevel`), the remote (`git remote -v`) and the
   default branch (`git symbolic-ref refs/remotes/origin/HEAD`, else `main`).
2. Read CLAUDE.md / README and the package files: what the project is, how to run the checks
   (tests, type-check, lint), and its PR conventions. If `.claude/agents/` already has agents,
   list them — the user may want to reuse one.
3. Fill in `repo_agent` → `.claude/agents/{{slug}}.md` (one-line description, model `inherit`
   unless the user said, 2–5 bullets a newcomer needs, the exact check commands). Write
   `worker_skill` → `.claude/skills/todo-worker/SKILL.md` unchanged.
4. Show both files, then offer to commit them on a branch and open a PR the repo's usual way.
   **The agent runs from `origin/<default branch>`, so they must be merged before its first task.**
5. `set_project_repo(project, repo_path, default_branch)`: link the todo project to this
   checkout (`list_projects` to find it; a new name creates it). Use `~` for the home directory.

## B2. General agent: the machine side
1. Ask what it's for if the user hasn't said (e.g. "research and write up options", "draft
   emails and docs", "plan trips").
2. Fill in `general_agent` → `~/.claude/agents/{{slug}}.md` (role, what good output looks like).
   Write `worker_skill` → `~/.claude/skills/todo-worker/SKILL.md` (replace an older copy).
3. These files must be on **the machine the agent runs on**. If that's not this one, tell the
   user to copy them there.

## C. The agent in the todo app
6. `list_machines()`: pick where it runs. Prefer the machine you're on (compare with
   `hostname`). Task runs need todo-agent 1.2+.
7. `save_agent(name="{{name}}", claude_agent="{{slug}}", machine=…, allowed_tools=…,
   projects=[…] for a repo agent, [] for a general one)`. Pick `allowed_tools` from the
   templates' presets (`general` for a general agent), plus whatever the checks need.

## D. Verify
8. `check_agent_setup("{{name}}")` and fix what it reports.
9. `test_agent("{{name}}")` (a repo agent only once its files are on origin), then poll
   `get_run(run_id)` every ~15s until it finishes. The machine first asks the user to approve
   the agent: tell them to look for the prompt and answer "always". Report pass/fail with the log tail.
10. Tell the user how to use it: assign a task to **{{name}}** (task page, or quick add
    `+{{first_name}}`). In a project with a repo it works in a worktree and opens a PR; anywhere
    else it works in a scratch folder. Either way it logs progress on the task, asks when it's
    stuck, and ends with a "done" proposal in Review.
