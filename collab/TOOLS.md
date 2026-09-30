# Tool / harness cheat-sheet (shared)
**開発者から明示的に「現状使える全ツール、ハーネス、その他便利機能は細部作成のためにありとあらゆる手段を自由に行使してよい」と言われている。**

## Agent tools (available to every agent in this model/harness)
| tool | use for |
|---|---|
| `image_search` | **CC-licensed photos** (built-in CC filter). Never use Getty/Shutterstock/Alamy/iStock/Adobe Stock images |
| `image_generation` | original textures/illustrations when no CC photo exists (signage art, posters, decals) |
| `web_search` / `crawler` | trend refresh, docs (three.js r186 API), asset sources (Poly Haven, ambientCG, Kenney, freesound CC0) |
| `understand_images` / `analyze_media_content` | visual QA of screenshots (upload with `UploadFileWrapper` first) |
| `audio_generation` | sound effects / ambience (elevenlabs/sound-effects) — optional, procedural audio exists |
| `GetServiceUrl` | public URL of a sandbox port (e.g. 4174) to view the build in a real phone browser |
| `PlaywrightConsoleCapture` | quick console-error check of a URL |
| Bash + Playwright | headless Chromium + SwiftShader harness in `tools/` |
| `gsk` CLI | `gsk help` |
| LLM API | `~/.genspark_llm.yaml` (OpenAI-compatible) — `tools/agents/pipeline.mjs` |

## Local harness
```bash
bash tools/setup_env.sh                  # swap(4G) + playwright + vite build + :4173 static server
npx vite build && (setsid nohup python3 -m http.server 4174 -d dist >/dev/null 2>&1 </dev/null &)
python3 tools/smoke.py http://localhost:4174/          # boot / 404 / pageerror  -> RESULT OK|NG
python3 tools/snap.py /tmp/a.png "window.__imatore.tp(0,26,0,.25)" 4 --q=0.35   # one canvas frame (landscape)
python3 tools/multisnap.py /tmp/m "js1" "js2" --q=0.5 ; python3 tools/grid.py /tmp/m 2
python3 tools/uishot.py /tmp/ui          # HTML HUD / sheets screenshots
```
QA URL flags: `?qa=0.4` (render scale, low-res textures), `&fps=1`, `&nocompile&noshadow&norefl&nobloom&noscreens`,
`&preset=ultra|standard|high`, `&fullcanvas`, `&env` (force HDR in QA).
Debug handle: `window.__imatore` = `{ tp(x,z,yaw,pitch), engine, scene, camera, controls, city, screens, kiosks, land, platform, mapUI, openItem, openTop, openMap, openSettings, warpToDistrict, warpToItem, warpToLandmark, avePoint, life }`.

## Gotchas
- SwiftShader is ~1-3 fps at qa=0.35 and the sandbox has ~1 GB RAM: keep one browser at a time, use swap (setup_env).
- `requestFullscreen` in headless crashes the GPU process → harness sets `Element.prototype.requestFullscreen = undefined`.
- CSS animations stall under SwiftShader → smoke uses `reduced_motion='reduce'`.
