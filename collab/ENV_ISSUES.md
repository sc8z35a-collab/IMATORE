# Dev-environment issues & fixes (master, aggregated by A). Environment-level only.
Format: see README §3. Feeds docs/DEV_ENV_ERRORS.md at the end.

### [A] Background child processes inherit lock file descriptors
症状: after `kill <daemon>`, `start.sh` said "already running"; `lsof .lock` showed `sleep 180` holding fd 9.
原因: `exec 9>lock; flock 9` then `sleep N &` — children inherit fd 9 and keep the lock alive.
解決: close the fd for children: `sleep "$N" 9>&- & wait $!`.
再発防止: every long-lived child of a flock-holding script gets `N>&-`.

### [A] `kill 0` hits your whole process group
症状: log filled with thousands of "daemon stop" lines in 4 seconds.
原因: `kill ${PID:-0}` with PID unset → `kill 0` → signals the entire process group incl. self → trap re-fires.
解決: `[ -n "$PID" ] && kill "$PID"`.

### [A] `pkill -f <pattern>` kills the tool's own shell
症状: Bash tool returned exit code -1 with an empty error.
原因: the pattern string is part of the invoking `bash -c "..."` command line, so pkill matched the caller itself.
解決: `pgrep -f "bash /abs/path/script.sh"` and skip `$$`; or kill by pidfile.

### [A] Tool call hangs for 120 s after starting a daemon
症状: Bash tool timed out although the script ended.
原因: `[ cond ] || setsid nohup cmd > /dev/null 2>&1 &` — the `&` applies to the whole `||` list, so a
background *subshell* is forked that still holds the tool's stdout pipe open.
解決: `if [ cond ]; then setsid nohup cmd >/dev/null 2>&1 </dev/null & fi` (redirect all 3 fds of the real process).

### [A] Port confusion between servers
症状: QA hit the wrong content.
原因: a previous `python3 -m http.server 4173` (repo root) was still alive; `setup_env.sh` only starts a server when the port is free.
解決: `ss -ltnp | grep 4173`, kill it, or use a dedicated port (A uses :4174 for dist).

### [A] add/add conflict on template files during autosave rebase
症状: `ALERT: rebase conflict` — `CONFLICT (add/add): collab/agents/B/status.md`.
原因: leader pre-created empty per-agent files while B/C had already created their own versions remotely.
解決: take the remote version for other agents' files (`git checkout origin/<branch> -- collab/agents/B`), keep own files.
再発防止: never create files in another agent's namespace; each agent creates its own.

### [A] Full sandbox re-provisioning between turns (the big one)
症状: after a user interruption the next turn found `/home/user/webapp` back on `main`, `tools/autosave/` gone,
no swap, no Playwright browsers, no background processes (`uptime` = 2 min). Local branch + uncommitted edits were gone.
原因: the sandbox VM was replaced; only what is on the git remote survives (node_modules happened to be re-installed).
解決: `setup_github_environment` (re-creates git credentials) → `git fetch origin && git checkout -B <branch> origin/<branch>`
→ restart daemons → `bash tools/setup_env.sh`. Lost: only edits made in the last <3 min (autosave interval).
再発防止: autosave every 3 min to the remote (this repo's tools/autosave), keep ALL notes in the repo (collab/), never
rely on /tmp, background processes, swap or installed browsers persisting. Check `uptime` at the start of every turn.

### [A] Reset #2 (2026-10-01 ~09:16Z) — same symptoms as #1
Recovered in < 1 min with the same 4 commands. Lesson confirmed: the sandbox can be wiped on *every* user interruption.
Keep each tool call short (< 2 min) and commit early; a long-running test that is interrupted takes its uncommitted edits with it.

### [A/B] Editing code via python string replace / sed can silently produce invalid JS
症状: `SyntaxError: Unexpected end of input` at boot, loader stuck. Build (`vite build`) failed but the old `dist/` kept being served,
so the next browser test exercised *stale* code and reported a misleading "x is not a function".
原因: inserted `// comment` mid-line; `npx vite build | tail -1` hid the error line.
解決/再発防止: run `node --check file.js` after every scripted edit; check vite's exit status (`npx vite build >/tmp/b.log 2>&1 || { tail -30 /tmp/b.log; exit 1; }`);
autosave now tags `[BROKEN]` commits.
