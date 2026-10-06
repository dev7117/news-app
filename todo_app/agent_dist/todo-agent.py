#!/usr/bin/env python3
"""todo-agent: runs customer-hub tools from the todo app on this machine (macOS or Linux).

The todo app lives on the NAS; this agent connects to it, waits for runs you start from a
customer hub, and executes them here:

  interactive  opens a terminal window with a real TTY (CLI logins, anything that asks
               questions); the session is recorded and sent back to the hub
  headless     runs in the background (e.g. `claude -p "..."`); output streams back to the
               hub and you get a notification when it finishes

Before running a command it hasn't seen, it asks you HERE: a dialog on macOS, a terminal
prompt on Linux. It fingerprints the command itself, so the server can't vouch for a command
you never approved. "Always allow" remembers that exact command; editing it asks again.

  todo-agent run          the agent loop (launchd / systemd run this)
  todo-agent install      set it up to start at login (needs ~/.config/todo/agent.json)
  todo-agent uninstall    stop it and remove the login item
  todo-agent status       config, service state, connection check
  todo-agent approvals    commands you've always-allowed;  `todo-agent forget` clears them
  todo-agent upload <meeting id> <file>… [--step <id>] [--note <text>]
                          attach files to a cadence meeting (reports, exports); scripts run
                          for a meeting get its id as $TODO_OCCURRENCE_ID

A tool run for a cadence meeting's prep step uploads the step's output files (the paths/globs
set on the step) that the run wrote, to that meeting.

Agents: when you assign a todo task to an agent, this machine works it. It makes a git
worktree of the project's repo for the task (branch agent/<id>-<slug>, from origin/<default
branch>), or for a task without a repo a scratch folder (workspaces/task-<id>; the agent file
then comes from ~/.claude/agents), then runs `claude -p --agent <name>` there, headless, with an MCP config that only
reaches the todo app's agent endpoint with a token for this one run. Claude reports progress on
the task and finishes with a PR. The first time an agent runs (or after its tools, model or
repo change) you're asked to approve it, like any new command. Worktrees live in the state
dir (worktrees/task-<id>) until you remove them (`git worktree prune` after deleting).

Config ~/.config/todo/agent.json: {"url": "...", "token": "...", "name": "MacBook",
"terminal": "Terminal" | "iTerm" | "Ghostty", "claude": "/path/to/claude", "max_task_runs": 2,
"repo_paths": {"<project name>": "~/code/elsewhere"}} (terminal is macOS only; Linux uses
xdg-terminal-exec; claude defaults to the one on your login shell's PATH; repo_paths
overrides a project's repo path on this machine). Standard library only, Python 3.9+.
"""
from __future__ import annotations

import glob
import hashlib
import json
import mimetypes
import os
import platform as _platform
import re
import shlex
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

VERSION = "1.2"
MAC = sys.platform == "darwin"
HOME = Path.home()
# TODO_AGENT_HOME runs a second agent (e.g. against a local dev server) with its own config,
# approvals and state, while keeping your real home for claude / gh / git logins.
_ALT = os.environ.get("TODO_AGENT_HOME")
CONFIG_DIR = Path(_ALT).expanduser() if _ALT else HOME / ".config" / "todo"
CONFIG = CONFIG_DIR / "agent.json"
APPROVALS = CONFIG_DIR / "agent-approvals.json"
STATE = (CONFIG_DIR / "state") if _ALT else (
    (HOME / "Library" / "Application Support" / "todo-agent") if MAC else (HOME / ".local" / "state" / "todo-agent"))
PLIST = HOME / "Library" / "LaunchAgents" / "dev.todo.agent.plist"
UNIT = HOME / ".config" / "systemd" / "user" / "todo-agent.service"
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]|\r|\x08|\x04|\^D")
APPROVAL_TIMEOUT = 600
_lock = threading.Lock()
_task_runs = 0  # agent runs going right now (capped by max_task_runs)


def log(message: str) -> None:
    print(time.strftime("%Y-%m-%d %H:%M:%S"), message, flush=True)


def load_config() -> dict:
    try:
        cfg = json.loads(CONFIG.read_text())
    except (OSError, ValueError):
        sys.exit(f"No config at {CONFIG}. Install with: curl -fsSL http://<todo>/agent/install.sh | sh")
    cfg["url"] = cfg["url"].rstrip("/")
    cfg.setdefault("name", socket.gethostname().split(".")[0])
    cfg.setdefault("terminal", "Terminal")
    return cfg


def api(cfg: dict, path: str, body: dict, timeout: float = 15) -> dict:
    request = urllib.request.Request(
        cfg["url"] + path, data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {cfg['token']}"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def upload(cfg: dict, occurrence_id: int, path: Path, *, step_id=None, note: str = "") -> dict:
    """Attach a file to a cadence meeting."""
    params = {"name": path.name, "source": "agent", "note": note}
    if step_id:
        params["step_id"] = str(step_id)
    request = urllib.request.Request(
        f"{cfg['url']}/api/occurrences/{occurrence_id}/files?{urllib.parse.urlencode(params)}",
        data=path.read_bytes(), method="POST",
        headers={"Content-Type": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
                 "Authorization": f"Bearer {cfg['token']}"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)


def attach_outputs(cfg: dict, run: dict, started: float) -> None:
    """After a prep-step run: upload the step's output files that this run wrote."""
    if not run.get("occurrence_id") or not run.get("outputs"):
        return
    found: list[str] = []
    for pattern in run["outputs"]:
        pattern = os.path.expanduser(pattern)
        if not os.path.isabs(pattern):
            pattern = os.path.join(workdir(run), pattern)
        found += [f for f in glob.glob(pattern, recursive=True) if os.path.isfile(f) and os.path.getmtime(f) >= started - 2]
    lines = []
    for f in sorted(set(found))[:20]:
        try:
            upload(cfg, run["occurrence_id"], Path(f), step_id=run.get("step_id"))
            lines.append(f"[attached {os.path.basename(f)} to the meeting]")
        except Exception as exc:  # noqa: BLE001
            lines.append(f"[couldn't attach {os.path.basename(f)}: {exc}]")
    if not found:
        lines.append(f"[no new files matched {', '.join(run['outputs'])}]")
    report(cfg, run["id"], output="\n" + "\n".join(lines) + "\n")


def report(cfg: dict, run_id: int, **fields) -> str | None:
    """Send status / output; returns the run's status on the server ('cancelled' = stop)."""
    try:
        return api(cfg, f"/api/agent/runs/{run_id}", {"name": cfg["name"], **fields}).get("status")
    except Exception as exc:  # noqa: BLE001 - the run goes on; the hub just lags
        log(f"run {run_id}: couldn't report ({exc})")
        return None


# ----- approvals -----

def fingerprint(run: dict) -> str:
    return hashlib.sha256(f"{run['command']}\0{run.get('cwd') or ''}".encode()).hexdigest()


def approvals() -> dict:
    try:
        return json.loads(APPROVALS.read_text())
    except (OSError, ValueError):
        return {}


def remember(run: dict) -> None:
    with _lock:
        data = approvals()
        data[fingerprint(run)] = {
            "label": run["label"], "command": run["command"], "cwd": run.get("cwd"),
            "approved_at": time.strftime("%Y-%m-%d %H:%M"),
        }
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        APPROVALS.write_text(json.dumps(data, indent=2) + "\n")
        APPROVALS.chmod(0o600)


def ask(cfg: dict, run: dict) -> str:
    """'once' | 'always' | 'deny'."""
    where = run.get("cwd") or "~"
    how = "in a terminal window" if run["mode"] == "terminal" else "in the background"
    if MAC:
        text = (f"Todo wants to run “{run['label']}” for {run.get('customer') or 'you'} on this Mac, {how}:\n\n"
                f"{run['command']}\n\nin {where}\n\nNew or changed command.")
        script = (
            f'display dialog {_as(text)} with title "Todo" buttons {{"Don\'t run", "Run once", "Always allow"}} '
            f'default button "Run once" cancel button "Don\'t run" with icon caution giving up after {APPROVAL_TIMEOUT}'
        )
        result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
        out = result.stdout
        if "gave up:true" in out or result.returncode != 0:
            return "deny"
        return "always" if "Always allow" in out else "once" if "Run once" in out else "deny"
    # Linux: the agent is a background service, so ask in a terminal window.
    STATE.mkdir(parents=True, exist_ok=True)
    request = STATE / f"ask-{run['id']}.json"
    answer = STATE / f"ask-{run['id']}.answer"
    answer.unlink(missing_ok=True)
    request.write_text(json.dumps({**run, "how": how}))
    subprocess.Popen(["xdg-terminal-exec", sys.executable, os.path.abspath(__file__), "prompt", str(request)],
                     start_new_session=True)
    deadline = time.time() + APPROVAL_TIMEOUT
    while time.time() < deadline:
        if answer.exists():
            decision = answer.read_text().strip()
            answer.unlink(missing_ok=True)
            request.unlink(missing_ok=True)
            return decision if decision in ("once", "always") else "deny"
        time.sleep(0.5)
    request.unlink(missing_ok=True)
    return "deny"


def prompt(path: str) -> None:
    """Runs in a terminal window (Linux): show the command and ask."""
    run = json.loads(Path(path).read_text())
    print(f"\n  Todo wants to run \033[1m{run['label']}\033[0m for {run.get('customer') or 'you'}, {run['how']}\n")
    print(f"  in   {run.get('cwd') or '~'}")
    print(f"  run  {run['command']}\n")
    print("  New or changed command. 'always' remembers this exact command.\n")
    reply = input("  Run it? [o]nce / [a]lways / [N]o: ").strip().lower()
    decision = "always" if reply.startswith("a") else "once" if reply.startswith("o") or reply == "y" else "deny"
    Path(path).with_suffix(".answer").write_text(decision)


def _as(text: str) -> str:
    """An AppleScript string literal."""
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


# ----- running -----

def environment(cfg: dict, run: dict) -> dict:
    return {
        **os.environ,
        "TODO_URL": cfg["url"],
        "TODO_RUN_ID": str(run["id"]),
        "TODO_TASK_ID": str(run.get("task_id") or ""),
        "TODO_CUSTOMER": run.get("customer") or "",
        "TODO_CUSTOMER_ID": str(run.get("customer_id") or ""),
        "TODO_OCCURRENCE_ID": str(run.get("occurrence_id") or ""),
        "TODO_STEP_ID": str(run.get("step_id") or ""),
    }


def workdir(run: dict) -> str:
    path = os.path.expanduser(run.get("cwd") or "~")
    return path if os.path.isdir(path) else str(HOME)


def user_shell() -> str:
    return os.environ.get("SHELL") or ("/bin/zsh" if MAC else "/bin/bash")


def notify(title: str, body: str, failed: bool = False) -> None:
    if MAC:
        subprocess.run(["osascript", "-e", f"display notification {_as(body[:200])} with title {_as(title)}"
                        + (' sound name "Basso"' if failed else "")], check=False)
    else:
        subprocess.run(["notify-send", "-a", "Todo", *(["-u", "critical"] if failed else []), title, body], check=False)


def run_headless(cfg: dict, run: dict) -> None:
    started = time.time()
    report(cfg, run["id"], status="running")
    proc = subprocess.Popen(
        [user_shell(), "-lc", run["command"]], cwd=workdir(run), env=environment(cfg, run),
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace",
    )
    buffer: list[str] = []
    tail: list[str] = []
    done = threading.Event()

    def flush() -> None:
        while not done.wait(2):
            send()

    def send() -> None:
        with _lock:
            chunk, buffer[:] = "".join(buffer), []
        if chunk:
            report(cfg, run["id"], output=chunk)

    threading.Thread(target=flush, daemon=True).start()
    assert proc.stdout
    for line in proc.stdout:
        line = ANSI.sub("", line)
        with _lock:
            buffer.append(line)
        tail[:] = (tail + [line.rstrip()])[-3:]
    code = proc.wait()
    done.set()
    send()
    attach_outputs(cfg, run, started)
    report(cfg, run["id"], status="succeeded" if code == 0 else "failed", exit_code=code)
    notify(f"{run['label']} {'finished' if code == 0 else f'failed ({code})'}",
           "\n".join(t for t in tail if t) or (run.get("customer") or ""), failed=code != 0)


def run_terminal(cfg: dict, run: dict) -> None:
    """A terminal window with a real TTY; `script` records the session for the hub."""
    STATE.mkdir(parents=True, exist_ok=True)
    base = STATE / f"run-{run['id']}"
    record, exit_file, wrapper = base.with_suffix(".log"), base.with_suffix(".exit"), base.with_suffix(".sh")
    for f in (record, exit_file):
        f.unlink(missing_ok=True)
    env = environment(cfg, run)
    exports = "".join(f"export {k}={shlex.quote(env[k])}\n" for k in (
        "TODO_URL", "TODO_RUN_ID", "TODO_CUSTOMER", "TODO_CUSTOMER_ID", "TODO_OCCURRENCE_ID", "TODO_STEP_ID"))
    started = time.time()
    inner = f"{shlex.quote(user_shell())} -lc {shlex.quote(run['command'])}"
    recorder = (f"script -q {shlex.quote(str(record))} {inner}" if MAC
                else f"script -q -e -c {shlex.quote(inner)} {shlex.quote(str(record))}")
    wrapper.write_text(
        "#!/bin/bash\n"
        f"printf '\\033]0;%s\\007' {shlex.quote(run['label'] + ' · todo')}\n"
        f"cd {shlex.quote(workdir(run))} || exit 1\n{exports}"
        f"echo {shlex.quote('▶ ' + run['label'])}; echo\n"
        f"{recorder}\ncode=$?\necho \"$code\" > {shlex.quote(str(exit_file))}\n"
        f"echo; echo \"[{run['label']} exited with $code]\"; printf 'Press Enter to close '; read -r _\n"
    )
    wrapper.chmod(0o700)
    open_terminal(cfg, str(wrapper))
    report(cfg, run["id"], status="running")
    sent = 0
    deadline = time.time() + 12 * 3600
    while time.time() < deadline and not exit_file.exists():
        sent = _send_new(cfg, run, record, sent)
        time.sleep(2)
    sent = _send_new(cfg, run, record, sent)
    try:
        code = int(exit_file.read_text().strip())
    except (OSError, ValueError):
        report(cfg, run["id"], status="failed", error="The terminal session didn't report back")
        return
    attach_outputs(cfg, run, started)
    report(cfg, run["id"], status="succeeded" if code == 0 else "failed", exit_code=code)
    for f in (record, exit_file, wrapper):
        f.unlink(missing_ok=True)


def _send_new(cfg: dict, run: dict, record: Path, sent: int) -> int:
    try:
        data = record.read_bytes()
    except OSError:
        return sent
    if len(data) > sent:
        report(cfg, run["id"], output=ANSI.sub("", data[sent:].decode("utf-8", "replace")))
    return len(data)


def open_terminal(cfg: dict, script: str) -> None:
    if not MAC:
        subprocess.Popen(["xdg-terminal-exec", "bash", script], start_new_session=True)
        return
    app = cfg.get("terminal", "Terminal")
    command = f"/bin/bash {shlex.quote(script)}"
    if app == "Ghostty":
        subprocess.Popen(["open", "-na", "Ghostty", "--args", "-e", "/bin/bash", script])
    elif app == "iTerm":
        subprocess.run(["osascript", "-e", f'tell application "iTerm" to create window with default profile command {_as(command)}'], check=False)
    else:
        subprocess.run(["osascript", "-e", f'tell application "Terminal"\nactivate\ndo script {_as(command)}\nend tell'], check=False)


# ----- agents: a task run (or a setup check) is Claude Code in a worktree -----

def repo_for(cfg: dict, run: dict):
    """The repo to work in, or None for general work (a scratch folder, no git)."""
    project = run.get("project")
    if not project:
        return None
    return os.path.expanduser((cfg.get("repo_paths") or {}).get(project["name"]) or project["repo_path"])


def describe_agent(cfg: dict, run: dict) -> None:
    """What the approval shows and fingerprints: the agent file, its tools and model, and the
    repo. The prompt and task change every run, so they're not part of it."""
    agent = run["agent"]
    run["cwd"] = repo_for(cfg, run) or "(a scratch folder, no repo)"
    run["command"] = (f"claude --agent {agent['claude_agent']}"
                      + (f" --model {agent['model']}" if agent.get("model") else "")
                      + f" --allowedTools {shlex.quote(agent.get('allowed_tools') or '(defaults)')}")


def git(repo: str, *args: str) -> str:
    result = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {(result.stderr or result.stdout).strip()}")
    return result.stdout.strip()


def workspace(run: dict, repo) -> str:
    """Where Claude works: a git worktree of the repo, or for general work a scratch folder of
    the task's own. Both are reused when the agent comes back to the task."""
    if repo is None:
        path = STATE / "workspaces" / (f"check-{run['id']}" if run["kind"] == "check" else f"task-{run['task_id']}")
        (path / "outputs").mkdir(parents=True, exist_ok=True)
        return str(path)
    return worktree(run, repo)


def worktree(run: dict, repo: str) -> str:
    """The task's worktree (reused when the agent comes back to it), on its own branch."""
    if not os.path.isdir(os.path.join(repo, ".git")) and not os.path.isfile(os.path.join(repo, ".git")):
        raise RuntimeError(f"{repo} isn't a git checkout (set the project's repo path, or repo_paths in {CONFIG})")
    base = run["project"]["default_branch"]
    git(repo, "fetch", "--quiet", "origin", base)
    root = STATE / "worktrees"
    root.mkdir(parents=True, exist_ok=True)
    if run["kind"] == "check":
        path = root / f"check-{run['id']}"
        git(repo, "worktree", "add", "--detach", str(path), f"origin/{base}")
        return str(path)
    path = root / f"task-{run['task_id']}"
    if path.exists():
        return str(path)
    git(repo, "worktree", "prune")
    branch = run["branch"]
    exists = subprocess.run(["git", "-C", repo, "rev-parse", "--verify", "--quiet", f"refs/heads/{branch}"],
                            capture_output=True).returncode == 0
    if exists:
        git(repo, "worktree", "add", str(path), branch)
    else:
        git(repo, "worktree", "add", "-b", branch, str(path), f"origin/{base}")
    return str(path)


def claude_command(cfg: dict, run: dict, mcp_config: Path) -> list:
    agent = run["agent"]
    claude = os.environ.get("TODO_AGENT_CLAUDE") or cfg.get("claude") or "claude"
    cmd = [claude, "-p", run["prompt"], "--agent", agent["claude_agent"],
           "--mcp-config", str(mcp_config), "--strict-mcp-config",
           "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits"]
    if agent.get("model"):
        cmd += ["--model", agent["model"]]
    if agent.get("max_turns"):
        cmd += ["--max-turns", str(agent["max_turns"])]
    if run.get("session_id") and run["kind"] == "task":
        cmd += ["--resume", run["session_id"]]
    # Last: it takes a list. The todo tools are always allowed (they only reach this task).
    return cmd + ["--allowedTools", *tool_rules(agent.get("allowed_tools") or ""), "mcp__todo"]


def tool_rules(text: str) -> list:
    """'Read Edit Bash(git *)' → ['Read', 'Edit', 'Bash(git *)']: split on spaces and commas
    outside parentheses."""
    rules, current, depth = [], "", 0
    for ch in text:
        depth += (ch == "(") - (ch == ")")
        if ch in " ,\n" and depth == 0:
            if current:
                rules.append(current)
            current = ""
        else:
            current += ch
    return rules + ([current] if current else [])


def readable(event: dict) -> tuple:
    """A stream-json event → (text for the log, session_id, usage). Usage is counted in tokens
    (subscription users don't pay the API price): new input incl. cache writes + output, and
    cache reads apart."""
    kind = event.get("type")
    session, usage, lines = event.get("session_id"), None, []
    if kind == "assistant":
        for block in (event.get("message") or {}).get("content") or []:
            if block.get("type") == "text" and block.get("text", "").strip():
                lines.append(block["text"].strip())
            elif block.get("type") == "tool_use":
                args = block.get("input") or {}
                hint = args.get("command") or args.get("file_path") or args.get("pattern") or args.get("note") or ""
                lines.append(f"→ {block.get('name')} {str(hint)[:160]}".rstrip())
    elif kind == "result":
        u = event.get("usage") or {}
        if u:
            usage = {"tokens": sum(int(u.get(k) or 0) for k in ("input_tokens", "cache_creation_input_tokens", "output_tokens")),
                     "cached_tokens": int(u.get("cache_read_input_tokens") or 0)}
        lines.append(f"[{event.get('subtype', 'done')}: {event.get('num_turns', '?')} turns"
                     + (f", {usage['tokens']:,} tokens" if usage else "") + "]")
    elif kind == "system" and event.get("subtype") == "init":
        lines.append(f"[claude {event.get('model', '')} in {event.get('cwd', '')}]")
    return ("\n".join(lines) + "\n") if lines else "", session, usage


def attach_outputs_to_task(cfg: dict, run: dict, path: str) -> str:
    """Upload what the agent saved in ./outputs/ (new or changed since the last run) to its
    task: the user sees the task, never this folder. Returns lines for the run log."""
    folder = Path(path) / "outputs"
    if run["kind"] != "task" or not folder.is_dir():
        return ""
    manifest = STATE / f"outputs-task-{run['task_id']}.json"
    try:
        sent = json.loads(manifest.read_text())
    except (OSError, ValueError):
        sent = {}
    lines = []
    for f in sorted(p for p in folder.rglob("*") if p.is_file() and not p.name.startswith("."))[:50]:
        rel = str(f.relative_to(folder))
        digest = hashlib.sha256(f.read_bytes()).hexdigest()
        if sent.get(rel) == digest:
            continue
        name = rel.replace(os.sep, "-")
        try:
            request = urllib.request.Request(
                f"{cfg['url']}/api/agent/runs/{run['id']}/files?"
                + urllib.parse.urlencode({"machine": cfg["name"], "name": name}),
                data=f.read_bytes(), method="POST",
                headers={"Content-Type": mimetypes.guess_type(name)[0] or "application/octet-stream",
                         "Authorization": f"Bearer {cfg['token']}"},
            )
            urllib.request.urlopen(request, timeout=120).read()
            sent[rel] = digest
            lines.append(f"[attached {name} to the task]")
        except Exception as exc:  # noqa: BLE001
            detail = exc.read().decode(errors="replace") if isinstance(exc, urllib.error.HTTPError) else str(exc)
            lines.append(f"[couldn't attach {name}: {detail}]")
    manifest.write_text(json.dumps(sent))
    return ("\n".join(lines) + "\n") if lines else ""


def run_agent(cfg: dict, run: dict) -> None:
    global _task_runs
    with _lock:
        _task_runs += 1
    mcp_config = STATE / f"mcp-{run['id']}.json"
    path = None
    try:
        repo = repo_for(cfg, run)
        path = workspace(run, repo)
        STATE.mkdir(parents=True, exist_ok=True)
        mcp_config.write_text(json.dumps({"mcpServers": {"todo": {
            "type": "http", "url": cfg["url"] + run["mcp_path"],
            "headers": {"Authorization": f"Bearer {run['token']}"}}}}))
        mcp_config.chmod(0o600)
        report(cfg, run["id"], status="running", branch=run.get("branch") if run["kind"] == "task" and repo else None,
               output=f"[{'worktree' if repo else 'scratch folder'} {path}]\n")
        command = " ".join(shlex.quote(a) for a in claude_command(cfg, run, mcp_config))
        proc = subprocess.Popen(
            [user_shell(), "-lc", command], cwd=path, env=environment(cfg, run), stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace",
        )
        buffer: list = []
        meta: dict = {}
        cancelled = threading.Event()
        done = threading.Event()

        def send() -> None:
            with _lock:
                chunk, buffer[:] = "".join(buffer), []
                fields = {k: meta.pop(k) for k in list(meta)}
            if chunk or fields:
                if report(cfg, run["id"], output=chunk or None, **fields) == "cancelled" and not cancelled.is_set():
                    cancelled.set()
                    proc.terminate()

        def flush() -> None:
            while not done.wait(2):
                send()

        threading.Thread(target=flush, daemon=True).start()
        assert proc.stdout
        last = ""
        for line in proc.stdout:
            try:
                event = json.loads(line)
            except ValueError:
                text, session, usage = ANSI.sub("", line), None, None
            else:
                text, session, usage = readable(event) if isinstance(event, dict) else ("", None, None)
            with _lock:
                if text:
                    buffer.append(text)
                    last = text.strip().splitlines()[-1] if text.strip() else last
                if session:
                    meta["session_id"] = session
                if usage:
                    meta.update(usage)
        code = proc.wait()
        done.set()
        send()
        if cancelled.is_set():
            notify(f"{run['label']} stopped", "Stopped from the todo app")
            return
        attached = attach_outputs_to_task(cfg, run, path)
        report(cfg, run["id"], status="succeeded" if code == 0 else "failed", exit_code=code, output=attached or None)
        notify(f"{run['label']} {'finished' if code == 0 else f'failed ({code})'}", last, failed=code != 0)
    finally:
        mcp_config.unlink(missing_ok=True)
        if run["kind"] == "check" and path:
            if repo_for(cfg, run):
                subprocess.run(["git", "-C", repo_for(cfg, run), "worktree", "remove", "--force", path], capture_output=True)
            else:
                shutil.rmtree(path, ignore_errors=True)
        with _lock:
            _task_runs -= 1


def handle(cfg: dict, run: dict) -> None:
    log(f"run {run['id']}: {run['label']} ({run.get('kind', 'tool')})")
    try:
        agent_run = run.get("kind") in ("task", "check")
        if agent_run:
            describe_agent(cfg, run)
        if fingerprint(run) not in approvals():
            decision = ask(cfg, run)
            if decision == "deny":
                log(f"run {run['id']}: declined")
                report(cfg, run["id"], status="declined", error="Not approved on " + cfg["name"])
                return
            if decision == "always":
                remember(run)
        if agent_run:
            run_agent(cfg, run)
        else:
            (run_terminal if run["mode"] == "terminal" else run_headless)(cfg, run)
    except Exception as exc:  # noqa: BLE001
        log(f"run {run['id']}: {exc}")
        report(cfg, run["id"], status="failed", error=str(exc))


def loop() -> None:
    cfg = load_config()
    log(f"todo-agent {VERSION} as {cfg['name']!r} → {cfg['url']}")
    backoff = 2
    body = {"name": cfg["name"], "platform": "macos" if MAC else "linux", "version": VERSION}
    while True:
        body["accept_tasks"] = _task_runs < int(cfg.get("max_task_runs", 2))
        try:
            run = api(cfg, "/api/agent/poll", body, timeout=45).get("run")
            backoff = 2
        except urllib.error.HTTPError as exc:
            log(f"server said {exc.code}: {'wrong token?' if exc.code == 401 else exc.reason}")
            time.sleep(60 if exc.code == 401 else backoff)
            continue
        except Exception as exc:  # noqa: BLE001 - offline, NAS rebooting, laptop asleep
            log(f"can't reach {cfg['url']}: {exc}")
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)
            continue
        if run:
            threading.Thread(target=handle, args=(cfg, run), daemon=True).start()


# ----- install / status -----

def install() -> None:
    load_config()
    me = os.path.abspath(__file__)
    if MAC:
        logs = HOME / "Library" / "Logs" / "todo-agent.log"
        PLIST.parent.mkdir(parents=True, exist_ok=True)
        PLIST.write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.todo.agent</string>
  <key>ProgramArguments</key><array><string>{sys.executable}</string><string>{me}</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>EnvironmentVariables</key><dict><key>SHELL</key><string>{os.environ.get('SHELL', '/bin/zsh')}</string></dict>
  <key>StandardOutPath</key><string>{logs}</string>
  <key>StandardErrorPath</key><string>{logs}</string>
</dict></plist>
""")
        uid = os.getuid()
        subprocess.run(["launchctl", "bootout", f"gui/{uid}", str(PLIST)], capture_output=True)
        subprocess.run(["launchctl", "bootstrap", f"gui/{uid}", str(PLIST)], check=True)
        print(f"Installed: starts at login (launchd). Logs: {logs}")
    else:
        UNIT.parent.mkdir(parents=True, exist_ok=True)
        UNIT.write_text(f"""[Unit]
Description=todo-agent (runs customer hub tools from the todo app)
PartOf=graphical-session.target
After=graphical-session.target

[Service]
ExecStart={sys.executable} {me} run
Restart=always
RestartSec=5

[Install]
WantedBy=graphical-session.target
""")
        subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
        subprocess.run(["systemctl", "--user", "enable", "--now", "todo-agent.service"], check=True)
        subprocess.run(["systemctl", "--user", "restart", "todo-agent.service"], check=True)
        print("Installed: systemd user service todo-agent. Logs: journalctl --user -u todo-agent -f")


def uninstall() -> None:
    if MAC:
        subprocess.run(["launchctl", "bootout", f"gui/{os.getuid()}", str(PLIST)], capture_output=True)
        PLIST.unlink(missing_ok=True)
    else:
        subprocess.run(["systemctl", "--user", "disable", "--now", "todo-agent.service"], capture_output=True)
        UNIT.unlink(missing_ok=True)
        subprocess.run(["systemctl", "--user", "daemon-reload"], capture_output=True)
    print("Removed the login item. Config and approvals are kept in", CONFIG_DIR)


def status() -> None:
    cfg = load_config()
    print(f"todo-agent {VERSION} · {cfg['name']} · {_platform.system()} · {cfg['url']}")
    try:
        api(cfg, "/api/agent/ping", {"name": cfg["name"], "platform": "macos" if MAC else "linux",
                                      "version": VERSION}, timeout=5)
    except urllib.error.HTTPError as exc:
        print(f"server: {exc.code} {'(wrong token)' if exc.code == 401 else exc.reason}")
    except Exception as exc:  # noqa: BLE001
        print(f"server: unreachable ({exc})")
    else:
        print("server: ok")
    print(f"always-allowed commands: {len(approvals())}")


def upload_cli(args: list) -> None:
    cfg = load_config()
    step = note = None
    files = []
    rest = iter(args[1:])
    for a in rest:
        if a == "--step":
            step = next(rest, None)
        elif a == "--note":
            note = next(rest, None)
        else:
            files.append(Path(a).expanduser())
    if not args[0].isdigit() or not files:
        sys.exit("usage: todo-agent upload <meeting id> <file>… [--step <id>] [--note <text>]")
    failed = False
    for f in files:
        try:
            got = upload(cfg, int(args[0]), f, step_id=step, note=note or "")
            print(f"attached {got['name']} ({got['bytes']} bytes): {cfg['url']}{got['url']}")
        except (OSError, urllib.error.URLError) as exc:
            detail = exc.read().decode(errors="replace") if isinstance(exc, urllib.error.HTTPError) else str(exc)
            print(f"couldn't attach {f}: {detail}", file=sys.stderr)
            failed = True
    sys.exit(1 if failed else 0)


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    if cmd == "run":
        loop()
    elif cmd == "install":
        install()
    elif cmd == "uninstall":
        uninstall()
    elif cmd == "status":
        status()
    elif cmd == "prompt" and len(sys.argv) == 3:
        prompt(sys.argv[2])
    elif cmd == "approvals":
        for fp, a in approvals().items():
            print(f"{a['approved_at']}  {a['label']}: {a['command']}  ({fp[:10]})")
    elif cmd == "upload" and len(sys.argv) >= 4:
        upload_cli(sys.argv[2:])
    elif cmd == "forget":
        APPROVALS.unlink(missing_ok=True)
        print("Forgot all approvals; every command will ask again.")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
