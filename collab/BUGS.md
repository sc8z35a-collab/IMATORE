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
| A-008 | med | A | ui/map.js | `MapUI.dpr` undefined until first `resize()`; main loop could `drawFull()` before `open()` (rAF-deferred) → NaN font sizes / hit radii, NaN tap coords | fixed |
| A-009 | low | A | main.js | full map player arrow ignored gyro yaw (minimap used it) | fixed |
| A-010 | med | A | settings.js | toggling rain/sound saved the *auto-detected* preset → device auto-detect permanently disabled, "(端末から自動選択)" vanished | fixed |
| A-011 | med | A | main.js | in landscape the side sheet could not be dismissed by touching the world on the left (joystick) half — only right-half taps closed it | fixed |
| B-001 | crit | A | index.html | = A-001 | fixed |
| B-002 | high | A | main.js | = A-005 (audio.mute) | fixed |
| B-003 / C-001 | med | C | reflection.js | rain ripples ignore saved rain=off | fixing(C) |
| B-004 | low | B/D | settings consumers | preset anisotropy / screensPerFrame / steam unused | B part fixed (de84847); screensPerFrame → D/A |
| B-005 | med | B | props.js | tree crown white noise / shimmer | open(B) |
| B-006 | med | B | city.js | near low-rise facades read as black slabs | open(B) |
| C-002 | med | C | landscape.js | Fuji lathe inside-out (reversed profile) | fixing(C) |
| C-003 | low | C | landscape.js | containers all grey (instanceColor ignored) | fixing(C) |
| C-004 | low | C | landscape.js | yakatabune/sailing ships promised in comment but missing | fixing(C) |
| C-005 | low | C | engine.js | DPR ping-pong at 30 fps cap (ultra) | fixing(C) |
| C-006 | low | C | sky.js | moon corona sprite visible through thick clouds | fixing(C) |
| A-012 | low | A | main.js | prompt showed only the title; no district/heat context; nothing on terraces (landmarks unnamed) | fixed (prompt card + landmark spotting) |
| A-013 | crit | A | main.js:404 | own regression: `// comment` placed mid-line swallowed `crossDist, crossPan };` → SyntaxError, boot dead. Found+fixed by B (c536e7b) | fixed |
| A-014 | med | A | main.js audio | sound bed ignored the 雨 toggle; loop sources shared one buffer in phase; no limiter → clipping when one-shots stack | fixed |
