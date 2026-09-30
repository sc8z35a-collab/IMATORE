#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
pkill -f "$DIR/watchdog.sh" 2>/dev/null
[ -f "$DIR/.pid" ] && kill "$(cat "$DIR/.pid")" 2>/dev/null && echo "autosave stopped" || echo "not running"
