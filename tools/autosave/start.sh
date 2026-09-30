#!/usr/bin/env bash
# Start the auto-save daemon + watchdog detached from the shell (they survive the tool call that started them).
#   bash tools/autosave/start.sh [A|B|C|D]
# Idempotent: a healthy daemon is left alone; a stale one (no heartbeat for 10 min) is replaced.
DIR="$(cd "$(dirname "$0")" && pwd)"
[ -n "${1:-}" ] && echo "$1" > "$DIR/.agent"
if [ -f "$DIR/.pid" ] && kill -0 "$(cat "$DIR/.pid")" 2>/dev/null; then
  hb=$(cat "$DIR/.heartbeat" 2>/dev/null || echo 0)
  if [ $(( $(date +%s) - hb )) -lt 600 ]; then echo "autosave running (pid $(cat "$DIR/.pid"), agent $(cat "$DIR/.agent" 2>/dev/null))"; exit 0; fi
  kill "$(cat "$DIR/.pid")" 2>/dev/null; sleep 1
fi
setsid nohup bash "$DIR/autosave.sh" > /dev/null 2>&1 < /dev/null &
sleep 1
setsid nohup bash "$DIR/watchdog.sh" > /dev/null 2>&1 < /dev/null &
echo "autosave started (pid $(cat "$DIR/.pid" 2>/dev/null), agent $(cat "$DIR/.agent" 2>/dev/null || echo X))"
