#!/usr/bin/env bash
# IMATORE auto-save daemon — commits + pushes work-in-progress every INTERVAL seconds and keeps a PR open,
# so nothing is lost if the sandbox is reset. Runs with zero interaction once started.
#
#   bash tools/autosave/start.sh        # start (idempotent; safe to call any time)
#   bash tools/autosave/stop.sh         # stop
#   touch tools/autosave/.pause         # temporarily pause (e.g. while squashing / force-pushing)
#   tail -f tools/autosave/autosave.log # watch
#
# Design:
#  * single instance via flock on .lock (a second start is a no-op)
#  * only commits when the tree is dirty; commit message lists changed files
#  * push is NON-force to $BRANCH; if the remote moved, rebase onto it first (autostash), and on conflict
#    abort and fall back to a backup branch autosave/<ts> so the work is still off-box
#  * ensures an open PR $BRANCH -> $BASE exists (creates one if missing)
#  * never commits node_modules/dist/logs (see .gitignore); skips files > 45MB (GitHub hard limit is 100MB)
#  * a heartbeat file lets start.sh detect a stale/dead daemon and replace it
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$ROOT/tools/autosave"
BRANCH="${AUTOSAVE_BRANCH:-genspark_ai_developer}"
BASE="${AUTOSAVE_BASE:-main}"
INTERVAL="${AUTOSAVE_INTERVAL:-180}"
LOG="$DIR/autosave.log"
cd "$ROOT" || exit 1

exec 9>"$DIR/.lock"
flock -n 9 || { echo "autosave already running"; exit 0; }
echo $$ > "$DIR/.pid"

log() { echo "[$(date -u '+%F %T')Z] $*" >> "$LOG"; }
trim_log() { [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 2000 ] && tail -n 1000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; }

ensure_pr() {
  command -v gh >/dev/null || return 0
  local n
  n=$(gh pr list --head "$BRANCH" --base "$BASE" --state open --json number -q '.[0].number' 2>/dev/null)
  if [ -z "$n" ]; then
    gh pr create --head "$BRANCH" --base "$BASE" \
      --title "WIP: グラフィック大幅アップグレード (autosave)" \
      --body "作業中の自動保存 PR です (tools/autosave が 3 分おきに commit/push)。最終的に内容をまとめて説明を更新します。" \
      >> "$LOG" 2>&1 && log "PR created" || log "PR create failed"
  fi
}

save_once() {
  [ -f "$DIR/.pause" ] && { log "paused"; return 0; }
  # never interfere with a manual rebase/merge in progress
  if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ] || [ -f .git/MERGE_HEAD ]; then log "git op in progress, skip"; return 0; fi
  local cur; cur=$(git rev-parse --abbrev-ref HEAD)
  if [ "$cur" != "$BRANCH" ]; then log "on '$cur' (not $BRANCH), skip"; return 0; fi
  # huge files guard
  git ls-files -mo --exclude-standard -z | while IFS= read -r -d '' f; do
    [ -f "$f" ] && [ "$(stat -c %s "$f")" -gt 47185920 ] && echo "$f" >> .git/info/exclude && log "excluded large file $f"
  done
  if [ -n "$(git status --porcelain)" ]; then
    git add -A
    local files; files=$(git diff --cached --name-only | head -8 | tr '\n' ' ')
    local cnt; cnt=$(git diff --cached --name-only | wc -l)
    git commit -q -m "wip(autosave): $(date -u '+%F %T')Z — ${cnt} files: ${files}" && log "committed $cnt files"
  fi
  git fetch -q origin "$BRANCH" 2>/dev/null
  local ahead; ahead=$(git rev-list --count "origin/$BRANCH..HEAD" 2>/dev/null || echo 1)
  [ "$ahead" = "0" ] && { ensure_pr; return 0; }
  if git push -q origin "HEAD:$BRANCH" 2>>"$LOG"; then
    log "pushed ($ahead commits ahead)"
  else
    # remote diverged (another session / force-push): try rebase, else back up to a side branch
    if git rebase -q --autostash "origin/$BRANCH" 2>>"$LOG" && git push -q origin "HEAD:$BRANCH" 2>>"$LOG"; then
      log "rebased + pushed"
    else
      git rebase --abort 2>/dev/null
      local bk="autosave/$(date -u +%Y%m%d-%H%M%S)"
      git push -q origin "HEAD:refs/heads/$bk" 2>>"$LOG" && log "diverged: backed up to $bk" || log "push FAILED"
    fi
  fi
  ensure_pr
}

log "daemon start pid=$$ interval=${INTERVAL}s branch=$BRANCH"
trap 'log "daemon stop"; rm -f "$DIR/.pid"; exit 0' TERM INT
while true; do
  date +%s > "$DIR/.heartbeat"
  save_once
  trim_log
  sleep "$INTERVAL" & wait $!
done
