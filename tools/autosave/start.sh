#!/usr/bin/env bash
# Start the auto-save daemon detached from the shell (survives the tool call that started it).
# Idempotent: if a healthy daemon is running this does nothing; a stale one (no heartbeat for 10 min) is replaced.
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$DIR/.pid" ] && kill -0 "$(cat "$DIR/.pid")" 2>/dev/null; then
  hb=$(cat "$DIR/.heartbeat" 2>/dev/null || echo 0)
  if [ $(( $(date +%s) - hb )) -lt 600 ]; then echo "autosave running (pid $(cat "$DIR/.pid"))"; exit 0; fi
  kill "$(cat "$DIR/.pid")" 2>/dev/null; sleep 1
fi
setsid nohup bash "$DIR/autosave.sh" > /dev/null 2>&1 < /dev/null &
sleep 1
setsid nohup bash "$DIR/watchdog.sh" >/dev/null 2>&1 < /dev/null &
echo "autosave started (pid $(cat "$DIR/.pid" 2>/dev/null))"
