#!/usr/bin/env bash
# Optional belt-and-braces: a cron-less watchdog that re-launches the daemon if it dies.
# start.sh launches this too; it just calls start.sh every 5 minutes (start.sh is idempotent).
DIR="$(cd "$(dirname "$0")" && pwd)"
exec 8>"$DIR/.wlock"; flock -n 8 || exit 0
while true; do NO_WATCHDOG=1 bash "$DIR/start.sh" >/dev/null 2>&1 8>&-; sleep 300 8>&-; done
