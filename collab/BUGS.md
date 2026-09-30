# Master bug table (aggregated by leader A from collab/agents/*/bugs.md)
Format / IDs: see README §2. 状態: open → fixing(X) → fixed(commit) / wontfix

| ID | sev | owner | where | summary | 状態 |
|---|---|---|---|---|---|
| A-001 (=B-001) | crit | A | index.html / main.js | boot crash: map & settings DOM (`#map`, `#map-canvas`, `#settings`, `#settings-body`, `#btn-map`, `#btn-settings`, `#ld-settings`) never added; `SHEETS.forEach(... $(id).addEventListener)` throws → loader stuck | fixed |
| A-002 | high | A | tools/autosave | v1 daemon: `sleep` child inherited flock fd → killed daemon kept the lock, restart impossible | fixed (v2) |
| A-003 | high | A | tools/autosave | v2 trap `kill ${SLP:-0}` = `kill 0` → SIGTERM to own process group → infinite trap loop (3,790 log lines/4 s) | fixed |
| A-004 | med | A | tools/setup_env.sh | serves dist on :4173 only if the port is free — if something else (raw repo server) owns :4173 QA silently tests the wrong build | open |
| A-005 | high | A | main.js settings | `audio.mute()` did not exist → toggling サウンド threw; saved `sound:false` was ignored at start | fixed |
| A-006 | low | A | main.js settings stat | `engine.fps` never set → stat line always "0 fps" (now EMA in main loop) | fixed |
| A-007 | med | A | style.css | map / settings sheets, preset buttons (.pz), toggles (.tg) had no CSS | fixed |
