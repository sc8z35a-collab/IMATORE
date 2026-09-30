# IMATORE 4-agent collaboration network (連絡網)

Leader: **Agent A**. Members: **A, B, C, D** (same AI model, separate sandboxes).
Shared medium = this `collab/` directory on the remote branch **`genspark_ai_developer`**
(PR → `main`). Everything here is plain Markdown so any agent can read/write it with any tool.

> ### 開発者からの明示的な許可 (developer's explicit permission)
> **現状使える全ツール・ハーネス・その他便利機能は、細部作成のためにありとあらゆる手段を自由に行使してよい**と
> 開発者から明示的に言われている。
> すなわち: web_search / crawler / image_search (Creative Commons) / image_generation / audio_generation /
> video_generation / understand_images / analyze_media_content / Playwright (headless Chromium + SwiftShader) /
> GetServiceUrl / gsk CLI / LLM API (~/.genspark_llm.yaml) / npm・pip パッケージ / 外部 CDN アセット
> (CC0 / CC BY / Public Domain のテクスチャ・HDRI・フォント・効果音・3D モデル等) — 全て自由に使用可。
> 条件はライセンス遵守のみ: 画像は CC / PD / 自作 / AI 生成のみ。Getty / Shutterstock / Alamy / iStock /
> Adobe Stock 表記のある画像は使用禁止。使ったアセットは必ず `public/img/CREDITS.md` に出典を追記。

## 0. First 5 minutes (every agent)
```bash
cd /home/user/webapp
git fetch origin && git checkout -B genspark_ai_developer origin/genspark_ai_developer
bash tools/autosave/start.sh <YOUR_ID>     # A|B|C|D  — 3 分おきに自動 commit/rebase/push/PR 維持
bash tools/setup_env.sh                    # swap + playwright + build + static server :4173
cat collab/ASSIGNMENTS.md collab/BUGS.md collab/ENV_ISSUES.md collab/TOOLS.md
ls collab/msgs/                            # messages (read everything addressed to you or ALL)
```
Nothing else is required to stay in sync: the daemon pulls everyone's work (rebase) every 3 minutes and
writes a summary of what the others changed in `collab/` into `tools/autosave/inbox.log`
(`cat` it each time you finish a sub-task). Need to share something *now*? `bash tools/autosave/now.sh`.

## 1. Files — who writes where (conflict-free by construction)
| path | writer | purpose |
|---|---|---|
| `collab/README.md`, `ASSIGNMENTS.md` | A only | protocol, file ownership, task list |
| `collab/BUGS.md` | A only (aggregated) | master bug table; others report in their own file |
| `collab/ENV_ISSUES.md` | A only (aggregated) | dev-environment troubles + fixes (master) |
| `collab/TOOLS.md` | A (others: via msg) | tool/harness cheat-sheet |
| `collab/agents/<X>/status.md` | agent X | what I'm doing now / done / next (update every ~20 min) |
| `collab/agents/<X>/bugs.md` | agent X | bugs I found (any file, even outside my area) |
| `collab/agents/<X>/env.md` | agent X | dev-env errors I hit + how I solved them |
| `collab/msgs/<UTC yyyymmdd-HHMMSS>_<FROM>_to_<TO\|ALL>.md` | sender | messages. **new file per message, never edit others'** |

Because every agent only writes its own files (and message files have unique names), the 3-minute
rebase never conflicts on `collab/`. Source-code conflicts are avoided by the ownership table in
`ASSIGNMENTS.md`: **edit only files you own**; for anything else, file a bug in your `bugs.md` addressed to
the owner, or send a message asking for the change (small one-line fixes in another owner's file are OK if
you announce them in a message first and keep the commit tiny).

## 2. Bug report format (in `collab/agents/<X>/bugs.md`)
```
### X-007 [severity: crit|high|med|low] [owner: B] src/world/props.js:212
現象: …   再現: …   原因: …   修正案: …   状態: open | fixing(X) | fixed(<commit>) | wontfix
```
IDs are `<agent>-<number>` so they never collide. The leader copies them into `collab/BUGS.md`.
Fixed a bug? change its 状態 in *your* file (or tell the reporter by msg) and mention the ID in the commit.

## 3. Env issue format (in `collab/agents/<X>/env.md`)
```
### [X] <short title>
症状: (exact error text)   原因: …   解決: (exact commands)   再発防止: …
```
These feed the final `docs/DEV_ENV_ERRORS.md` (environment-level lessons, not project-specific).

## 4. Git rules
- Branch: `genspark_ai_developer` only. **Never force-push** (the leader squashes at the very end).
- Before any manual `git rebase`/`reset`: `touch tools/autosave/.pause` … then `rm tools/autosave/.pause`.
- If the log says `ALERT: rebase conflict`, your work was pushed to `autosave/<X>-<ts>`; resolve by hand
  (prefer the remote version for files you do not own), then remove `.pause`.
- Don't commit build output (`dist/` is gitignored), keep files < 45 MB, images ≤ ~500 KB (make a `/img/lo/` copy ≤ 60 KB too).

## 5. Definition of done (per change)
`npx vite build` passes → `python3 tools/smoke.py http://localhost:4173/` prints `RESULT OK` →
visual check with `tools/snap.py` / `tools/multisnap.py` → status.md updated.
