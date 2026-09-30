# Assignments (leader: A) — last update 2026-09-30 16:00Z

Goal: **大幅な細部の作り込みアップグレード** of IMATORE (smartphone-only first-person 3D trend hub,
Three.js r186 + Vite 8, landscape phone). Find and fix as many bugs as possible along the way.
Leader A read the whole codebase (≈7,500 lines) before writing this. Map of the code:

```
index.html            DOM: loader / HUD / sheets (guide, detail, map, settings) / rotate guard
src/main.js           boot sequence, HUD wiring, picking, sheets, map+settings UI, zone, procedural audio, loop
src/settings.js       画質プリセット ultra/standard/high (localStorage), toggles rain/fx/people/traffic/sound
src/controls.js       joystick / look / pinch / gyro / tap / auto-travel (warp)
src/ui/map.js         heading-up minimap + full HUB/AREA map sheet
src/util/qa.js        ?qa harness flags, asset() base-path helper, makeCanvas (QA downscale)
src/data/trends.js    AS_OF, TOP_NOW, DISTRICTS[8]{items≤13}, TICKER, X_TRENDS
src/world/layout.js   geometry constants (HUB_R 21, RING 21-30, PLAZA_R 36, AVE_END 176, EDGE 212, PLAT_H 28), walkability
src/world/engine.js   renderer, composer (bloom + final grade), dynamic DPR
src/world/reflection.js planar wet-ground reflection (onBeforeCompile patch)
src/world/sky.js      dome, moon (NASA), rain, HDR env, moon key light
src/world/landscape.js far city (instanced shader facades), bay, river, expressway, rail, bridge, port, landmarks, Fuji, lights, aircraft
src/world/platform.js 人工地盤 wall, balustrade, observation terraces
src/world/city.js     near buildings: tip towers, rows, end gates, signs, shops, screen anchors
src/world/ground.js   hub, ring road, wedges, avenues, markings, tactile paving
src/world/props.js    lamps, signals, vending, trees, bollards, benches, bins, rails, manholes, post boxes, light pools
src/world/life.js     crowd (off by default: 無人の街), ring traffic, wires/poles, lanterns, X-trend holograms
src/world/kiosks.js   trend pylons, district gates, central tower
src/world/screens.js  LED screen shader + canvas channels
src/world/textures.js canvas textures (windows, facades, signs, shops, kiosk, banner, LED strip, tower)
src/world/materials.js PBR (Poly Haven CC0), glow()
src/world/geo.js      Batch merge helpers
tools/                QA harness (smoke/snap/multisnap/uishot/probe/diag), setup_env, deploy_pages, autosave/
```

## File ownership (edit only what you own — see README §1)
| agent | owns | theme |
|---|---|---|
| **A** (leader) | `index.html`, `src/main.js`, `src/style.css`, `src/settings.js`, `src/ui/*`, `src/util/*`, `tools/*`, `collab/*` (shared files), `docs/*`, `README.md`, `vite.config.js`, `package.json` | integration, boot, HUD/UI polish, map & settings sheets, audio, final docs |
| **B** | `src/world/city.js`, `ground.js`, `props.js`, `geo.js`, `materials.js`, `textures.js`, `public/tex/*` | **street level detail**: facades, shopfronts, signage, road markings, street furniture, decals, PBR textures |
| **C** | `src/world/landscape.js`, `platform.js`, `sky.js`, `reflection.js`, `engine.js`, `public/hdr/*` | **far view / atmosphere / rendering**: skyline, bay, landmarks, sky, rain, post FX, performance per preset |
| **D** | `src/world/kiosks.js`, `screens.js`, `life.js`, `layout.js`, `src/controls.js`, `src/data/*`, `public/img/*` | **content & interaction**: kiosks, LED screens, holograms, lanterns, traffic, controls feel, trend data, CC photos |

Everybody: **bug hunting everywhere** (read other owners' code, file bugs to them).

## Tasks
### A (leader)
- [x] autosave v2 (3 min, multi-agent rebase, inbox, ALERT backup) — `tools/autosave/`
- [x] collab network (this dir)
- [ ] **A-001 crit**: boot crash — `index.html` lacks `#map`, `#map-canvas`, `#settings`, `#settings-body`, `#btn-map`, `#btn-settings`, `#ld-settings`; CSS for map/settings sheets missing
- [ ] HUD polish: compass/zone chip, prompt card, sheet transitions, safe-area, haptics (`navigator.vibrate`), loader art
- [ ] audio detail (procedural rain on umbrellas/awnings, distant train, crossing chime, zone stingers)
- [ ] final: `docs/DEV_ENV_ERRORS.md`, `docs/NEXT_AGENT_ADVICE.md`, squash, PR description

### B — street level
- storefront interiors with depth (parallax interior mapping shader or layered quads), shutters on closed shops
- signage variety (horizontal kanban, roof signs, 袖看板 lit edges), noren curtains, A-frame sidewalk signs
- road: worn markings, manhole cover texture (canvas), drainage grates, crack/tar-seam decals, curb wear
- street furniture: bicycle racks + parked bikes, fire hydrants/消火栓 signs, utility boxes, bus stop shelter, taxi stand, cones
- facade detail: balconies/AC units density, rooftop water tanks, antennas, fire escapes, drainpipes
- verify all PBR textures load in both `/tex/` and `/tex/lo/`; add CC0 textures from Poly Haven / ambientCG if useful

### C — far view / atmosphere
- skyline silhouette variety (setbacks, spires, crown lights), far-city window shimmer, blinking aviation lights sync
- bay: ship wakes, bridge light reflections, lighthouse, 屋形船 (lit pleasure boats)
- sky: cloud detail, moon halo / cloud occlusion, occasional lightning glow in far clouds (subtle), low mist over bay
- rain: splash particles on ground near camera, drips from awnings (can coordinate with B), lens droplets (engine final pass)
- perf: verify ultra/standard/high presets, draw calls, `renderer.info`, no shader compile errors under SwiftShader

### D — content & interaction
- kiosks: animated screen content (subtle), heat bar pulse, proximity light-up, sound blip hook (call `window.__imatore.audio?.blip`)
- LED screens: more channel layouts (clock, weather, district logo loops), moiré control, brightness vs distance
- holograms/lanterns: flicker, sway in wind, lantern light pools
- controls: inertia feel, head-bob tuning, step-up curbs, look sensitivity setting (expose via `SETTINGS`, ask A)
- data: refresh trends if possible (web_search, today is 2026-09-30), CC photos for items without images (+ CREDITS.md, `/img/lo/` copies)
