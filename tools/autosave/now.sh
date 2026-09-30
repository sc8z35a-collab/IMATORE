#!/usr/bin/env bash
# run one save + sync cycle right now (e.g. right after writing an urgent note in collab/)
DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$DIR/autosave.sh" --once; tail -n 5 "$DIR/autosave.log"
