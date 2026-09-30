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
