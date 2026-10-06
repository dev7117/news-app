#!/usr/bin/env python3
"""A stand-in for `claude -p` to test agent runs end to end without spending tokens.

    TODO_AGENT_CLAUDE=scripts/fake-claude.py todo-agent run

It reads the MCP config todo-agent wrote, calls the worker tools like an agent would
(get_assignment, report_progress, then request_review, or "ready" for a setup check), and
prints stream-json the way claude does, so the run log, session and token count all show up.
"""
import json
import sys
import time
import urllib.request

args = sys.argv[1:]
config = json.load(open(args[args.index("--mcp-config") + 1]))["mcpServers"]["todo"]
session = args[args.index("--resume") + 1] if "--resume" in args else f"fake-{int(time.time())}"


def emit(event: dict) -> None:
    print(json.dumps({"session_id": session, **event}), flush=True)


def tool(name: str, **arguments) -> dict:
    emit({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": f"mcp__todo__{name}", "input": arguments}]}})
    request = urllib.request.Request(
        config["url"], method="POST",
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                         "params": {"name": name, "arguments": arguments}}).encode(),
        headers={**config["headers"], "Content-Type": "application/json",
                 "Accept": "application/json, text/event-stream"},
    )
    result = json.load(urllib.request.urlopen(request, timeout=15))["result"]
    if result.get("isError"):
        raise SystemExit(f"{name}: {result['content'][0]['text']}")
    return result.get("structuredContent") or json.loads(result["content"][0]["text"])


emit({"type": "system", "subtype": "init", "model": "fake", "cwd": "."})
assignment = tool("get_assignment")
if assignment.get("setup_check"):
    tool("report_progress", note=f"ready (fake claude, agent {args[args.index('--agent') + 1]})")
else:
    task = assignment["task"]
    emit({"type": "assistant", "message": {"content": [{"type": "text", "text": f"Working on: {task['title']}"}]}})
    if assignment.get("reply"):
        tool("report_progress", note=f"Got your reply: {assignment['reply']}")
    tool("report_progress", note="Read the task and the repo; making the change.")
    time.sleep(1)
    tool("request_review", summary="Fake run: nothing actually changed.", pr_url="https://example.com/pull/1")
emit({"type": "result", "subtype": "success", "num_turns": 3,
      "usage": {"input_tokens": 1200, "cache_creation_input_tokens": 800, "cache_read_input_tokens": 9000, "output_tokens": 400}})
