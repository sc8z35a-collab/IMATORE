#!/usr/bin/env bash
# One-shot recovery after a sandbox reset (the VM can be replaced between turns: only the git remote survives).
#   bash tools/autosave/resume.sh [AGENT_ID]
# 1. make sure we are on the shared work branch at its latest remote state (local unpushed work is kept: rebase)
# 2. (re)start the 3-minute autosave daemon + watchdog
# 3. print what the daemon will do and the last few log lines
# Git credentials must exist already (agent tool: setup_github_environment).
set -u
cd "$(dirname "$0")/../.." || exit 1
BR="${AUTOSAVE_BRANCH:-genspark_ai_developer}"
ID="${1:-$(cat tools/autosave/.agent 2>/dev/null || echo S)}"
git fetch -q origin "$BR" || echo "WARN: fetch failed (credentials?)"
cur=$(git rev-parse --abbrev-ref HEAD)
if [ "$cur" != "$BR" ]; then
  if git show-ref -q "refs/heads/$BR"; then git checkout -q "$BR"; else git checkout -q -B "$BR" "origin/$BR"; fi
fi
[ -n "$(git status --porcelain)" ] && git add -A && git commit -q -m "wip(autosave/$ID): pre-resume snapshot $(date -u '+%F %T')Z"
git rebase -q "origin/$BR" 2>/dev/null || { git rebase --abort 2>/dev/null; echo "WARN: rebase conflict, staying on local HEAD"; }
bash tools/autosave/start.sh "$ID"
echo "branch: $(git rev-parse --abbrev-ref HEAD) @ $(git log --oneline -1)"
echo "interval: ${AUTOSAVE_INTERVAL:-180}s ; log: tools/autosave/autosave.log"
tail -n 3 tools/autosave/autosave.log 2>/dev/null
