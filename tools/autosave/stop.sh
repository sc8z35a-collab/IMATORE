#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
# NOTE: never "pkill -f <path>" from an interactive tool shell: the pattern also matches the calling shell itself
for p in $(pgrep -f "bash $DIR/watchdog.sh"); do [ "$p" != "$$" ] && kill "$p" 2>/dev/null; done
[ -f "$DIR/.pid" ] && kill "$(cat "$DIR/.pid")" 2>/dev/null && echo "autosave stopped" || echo "not running"
