#!/usr/bin/env bash
# IMATORE auto-save + multi-agent sync daemon (v2).
# Every INTERVAL seconds (default 180 = 3 min), with zero interaction:
#   1. commit any uncommitted work  (message tagged with this agent's id)
#   2. fetch + rebase onto the shared remote branch (pulls the other agents' work and their collab/ notes)
#   3. push (never force) and make sure the PR  $BRANCH -> $BASE  is open
#   4. write what the OTHER agents changed in collab/ since the last cycle to tools/autosave/inbox.log
#
#   bash tools/autosave/start.sh [AGENT_ID]   # start (idempotent). AGENT_ID = A|B|C|D (stored in .agent)
#   bash tools/autosave/stop.sh               # stop daemon + watchdog
#   touch tools/autosave/.pause               # pause (e.g. while doing a manual rebase / squash)
#   bash tools/autosave/now.sh                # run one save/sync cycle immediately (same code path)
#   tail -f tools/autosave/autosave.log       # watch ; cat tools/autosave/inbox.log -> news from other agents
#
# Safety:
#  * single instance (flock); a second start is a no-op; watchdog relaunches it if it dies
#  * never runs while a manual rebase/merge/cherry-pick is in progress, never force-pushes
#  * on a rebase conflict: abort, keep local work, push it to  autosave/<agent>-<ts>  and raise an ALERT
#    line in the log (the work is off-box either way). Resolve by hand, then delete the pause file.
#  * files > 45 MB are excluded (GitHub hard limit is 100 MB); node_modules/dist/logs are .gitignored
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$ROOT/tools/autosave"
BRANCH="${AUTOSAVE_BRANCH:-genspark_ai_developer}"
BASE="${AUTOSAVE_BASE:-main}"
INTERVAL="${AUTOSAVE_INTERVAL:-180}"
LOG="$DIR/autosave.log"
INBOX="$DIR/inbox.log"
AGENT="${AGENT_ID:-$(cat "$DIR/.agent" 2>/dev/null || echo X)}"
cd "$ROOT" || exit 1

if [ "${1:-}" != "--once" ]; then
  exec 9>"$DIR/.lock"
  flock -n 9 || { echo "autosave already running"; exit 0; }
  echo $$ > "$DIR/.pid"
fi

log() { echo "[$(date -u '+%F %T')Z][$AGENT] $*" >> "$LOG"; }
trim() { local f=$1; [ -f "$f" ] && [ "$(wc -l < "$f")" -gt 3000 ] && tail -n 1500 "$f" > "$f.tmp" && mv "$f.tmp" "$f"; }

ensure_pr() {
  command -v gh >/dev/null || return 0
  local n
  n=$(timeout 60 gh pr list --head "$BRANCH" --base "$BASE" --state open --json number -q '.[0].number' 2>/dev/null)
  if [ -z "$n" ]; then
    timeout 60 gh pr create --head "$BRANCH" --base "$BASE" \
      --title "WIP: 細部の大幅アップグレード (4-agent collab, autosave)" \
      --body "4 エージェント (A/B/C/D) の共同作業ブランチ。tools/autosave が 3 分おきに commit/push します。連絡網: collab/ 。最終的にリーダー(A)が内容をまとめて説明を更新します。" \
      >> "$LOG" 2>&1 && log "PR created" || log "PR create failed"
  fi
}

save_once() {
  # one cycle at a time (daemon vs. now.sh)
  exec 7>"$DIR/.cycle.lock"; flock -w 150 7 || { log "cycle lock busy, skip"; return 0; }
  [ -f "$DIR/.pause" ] && { log "paused"; return 0; }
  if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ] || [ -f .git/MERGE_HEAD ] || [ -f .git/CHERRY_PICK_HEAD ]; then log "git op in progress, skip"; return 0; fi
  local cur; cur=$(git rev-parse --abbrev-ref HEAD)
  if [ "$cur" != "$BRANCH" ]; then log "on '$cur' (not $BRANCH), skip"; return 0; fi
  # huge-file guard
  git ls-files -mo --exclude-standard -z | while IFS= read -r -d '' f; do
    [ -f "$f" ] && [ "$(stat -c %s "$f")" -gt 47185920 ] && echo "$f" >> .git/info/exclude && log "excluded large file $f"
  done
  if [ -n "$(git status --porcelain)" ]; then
    git add -A
    local files cnt
    files=$(git diff --cached --name-only | head -8 | tr '\n' ' ')
    cnt=$(git diff --cached --name-only | wc -l)
    git commit -q -m "wip(autosave/$AGENT): $(date -u '+%F %T')Z — ${cnt} files: ${files}" && log "committed $cnt files"
  fi
  local before; before=$(git rev-parse HEAD)
  if ! timeout 90 git fetch -q origin "$BRANCH" 2>>"$LOG"; then log "fetch failed (network?)"; return 0; fi
  local behind ahead
  behind=$(git rev-list --count "HEAD..origin/$BRANCH" 2>/dev/null || echo 0)
  if [ "$behind" != "0" ]; then
    if git rebase -q --autostash "origin/$BRANCH" >>"$LOG" 2>&1; then
      log "synced: +$behind remote commits"
      # news from the other agents (collab/ changes that are not ours)
      local news; news=$(git log --format='%h %s' "$before..HEAD" -- collab/ 2>/dev/null | grep -v "autosave/$AGENT)" | head -20)
      if [ -n "$news" ]; then
        { echo "=== $(date -u '+%F %T')Z  collab/ updates pulled ==="; echo "$news";
          git diff --stat "$before" HEAD -- collab/ 2>/dev/null | tail -n 12; } >> "$INBOX"
      fi
    else
      git rebase --abort 2>/dev/null
      local bk="autosave/${AGENT}-$(date -u +%Y%m%d-%H%M%S)"
      git push -q origin "HEAD:refs/heads/$bk" 2>>"$LOG"
      log "ALERT: rebase conflict with origin/$BRANCH — local work backed up to $bk ; pausing. Resolve by hand then rm tools/autosave/.pause"
      echo "ALERT $(date -u '+%F %T')Z rebase conflict, backup $bk" >> "$INBOX"
      touch "$DIR/.pause"
      return 0
    fi
  fi
  ahead=$(git rev-list --count "origin/$BRANCH..HEAD" 2>/dev/null || echo 1)
  if [ "$ahead" != "0" ]; then
    if timeout 120 git push -q origin "HEAD:$BRANCH" 2>>"$LOG"; then log "pushed ($ahead commits)"
    else log "push failed (will retry next cycle)"; fi
  fi
  ensure_pr
}

# run each cycle in a subshell: the cycle lock (fd 7) is released when the subshell exits
if [ "${1:-}" = "--once" ]; then ( save_once ); exit 0; fi
log "daemon start pid=$$ interval=${INTERVAL}s branch=$BRANCH"
trap 'log "daemon stop"; [ -n "${SLP:-}" ] && kill "$SLP" 2>/dev/null; rm -f "$DIR/.pid"; exit 0' TERM INT
while true; do
  date +%s > "$DIR/.heartbeat"
  ( save_once ) 9>&-
  trim "$LOG"; trim "$INBOX"
  # 9>&- 7>&-: the sleep child must NOT inherit the lock fds, or a killed daemon keeps the lock forever
  sleep "$INTERVAL" 9>&- 7>&- & SLP=$!; wait $SLP
done
