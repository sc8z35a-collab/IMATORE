#!/usr/bin/env bash
# cron-less watchdog: re-launches the autosave daemon if it dies (checks every 5 min; start.sh is idempotent).
DIR="$(cd "$(dirname "$0")" && pwd)"
exec 8>"$DIR/.wlock"; flock -n 8 || exit 0
trap '[ -n "${S:-}" ] && kill "$S" 2>/dev/null; exit 0' TERM INT
while true; do
  NO_WATCHDOG=1 bash "$DIR/start.sh" >/dev/null 2>&1 8>&-
  sleep 300 8>&- & S=$!; wait $S
done
