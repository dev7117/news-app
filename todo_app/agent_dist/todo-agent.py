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

Config ~/.config/todo/agent.json: {"url": "...", "token": "...", "name": "MacBook",
"terminal": "Terminal" | "iTerm" | "Ghostty"} (terminal is macOS only; Linux uses
xdg-terminal-exec). Standard library only, Python 3.9+.
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
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

VERSION = "1.1"
MAC = sys.platform == "darwin"
HOME = Path.home()
CONFIG_DIR = HOME / ".config" / "todo"
CONFIG = CONFIG_DIR / "agent.json"
APPROVALS = CONFIG_DIR / "agent-approvals.json"
STATE = (HOME / "Library" / "Application Support" / "todo-agent") if MAC else (HOME / ".local" / "state" / "todo-agent")
PLIST = HOME / "Library" / "LaunchAgents" / "dev.todo.agent.plist"
UNIT = HOME / ".config" / "systemd" / "user" / "todo-agent.service"
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]|\r|\x08|\x04|\^D")
APPROVAL_TIMEOUT = 600
_lock = threading.Lock()


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


def report(cfg: dict, run_id: int, **fields) -> None:
    try:
        api(cfg, f"/api/agent/runs/{run_id}", {"name": cfg["name"], **fields})
    except Exception as exc:  # noqa: BLE001 - the run goes on; the hub just lags
        log(f"run {run_id}: couldn't report ({exc})")


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


def handle(cfg: dict, run: dict) -> None:
    log(f"run {run['id']}: {run['label']} ({run['mode']})")
    try:
        if fingerprint(run) not in approvals():
            decision = ask(cfg, run)
            if decision == "deny":
                log(f"run {run['id']}: declined")
                report(cfg, run["id"], status="declined", error="Not approved on " + cfg["name"])
                return
            if decision == "always":
                remember(run)
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
