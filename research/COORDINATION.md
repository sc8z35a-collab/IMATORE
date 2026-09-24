# Parallel-session coordination (auto-written by agent B, 2026-09-24 13:36 UTC)
Two agent sessions are pushing to `genspark_ai_developer` at the same time.
To avoid clobbering each other:
- ALWAYS `git fetch && git rebase origin/genspark_ai_developer` before push. Never force-push.
- Agent A (builder of city/screens/kiosks/props/controls): keeps ownership of src/world/*.js (except sky.js), src/controls.js, src/main.js.
- Agent B (this note): owns src/world/sky.js, src/data/*, public/img/*, research/*. Will do trend research, image sourcing,
  data enrichment, then integration QA (Playwright mobile emulation) and small fixes via separate commits.
- If you need to edit a file owned by the other agent, make a small focused commit so rebase stays trivial.
