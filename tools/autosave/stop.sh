#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
[ -f "$DIR/.pid" ] && kill "$(cat "$DIR/.pid")" 2>/dev/null && echo "autosave stopped" || echo "not running"
