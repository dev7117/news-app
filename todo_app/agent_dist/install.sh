#!/bin/sh
# Install todo-agent on this Mac or Linux desktop:
#   curl -fsSL __URL__/agent/install.sh | sh
# Optional: ... | sh -s -- "MacBook"     (the machine's name in the app; default: hostname)
# It asks for the API token (the API_TOKEN on the todo stack) without echoing it.
set -eu
URL="__URL__"
NAME="${1:-$(hostname -s 2>/dev/null || hostname)}"
BIN="$HOME/.local/bin/todo-agent"
CONF="$HOME/.config/todo/agent.json"

command -v python3 >/dev/null 2>&1 || { echo "todo-agent needs python3 (macOS: xcode-select --install)"; exit 1; }
python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))' || { echo "todo-agent needs Python 3.9+"; exit 1; }

mkdir -p "$HOME/.local/bin" "$HOME/.config/todo"
curl -fsSL "$URL/agent/todo-agent.py" -o "$BIN"
chmod 755 "$BIN"

if [ -f "$CONF" ] && [ -z "${TODO_RESET:-}" ]; then
  echo "Keeping existing $CONF (TODO_RESET=1 to redo it)"
else
  printf "API token for %s: " "$URL" > /dev/tty
  stty -echo < /dev/tty; read -r TOKEN < /dev/tty; stty echo < /dev/tty; echo > /dev/tty
  TERMINAL="Terminal"
  if [ "$(uname)" = "Darwin" ]; then
    [ -d /Applications/Ghostty.app ] && TERMINAL="Ghostty"
    [ -d /Applications/iTerm.app ] && TERMINAL="iTerm"
  fi
  NAME="$NAME" URL="$URL" TOKEN="$TOKEN" TERMINAL="$TERMINAL" python3 - "$CONF" <<'PY'
import json, os, sys
json.dump({"url": os.environ["URL"], "token": os.environ["TOKEN"], "name": os.environ["NAME"],
           "terminal": os.environ["TERMINAL"]}, open(sys.argv[1], "w"), indent=2)
os.chmod(sys.argv[1], 0o600)
PY
fi

python3 "$BIN" install
python3 "$BIN" status
echo "Done. This machine shows up in the todo app under Settings → Machines."
