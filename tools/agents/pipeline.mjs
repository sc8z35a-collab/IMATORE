// IMATORE 6-agent build pipeline (OpenAI-compatible LLM proxy).
//   node tools/agents/pipeline.mjs            -> preflight + run 6 agents in parallel
//   node tools/agents/pipeline.mjs --check    -> preflight only
// Needs OPENAI_API_KEY / OPENAI_BASE_URL (or ~/.genspark_llm.yaml). No npm deps.
// Output: research/agents/<run>/<agent>.json + merged.json (candidate data, never auto-overwrites src/data).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const MODEL = process.env.IMATORE_MODEL || 'gpt-5-mini';

function config() {
  let key = process.env.OPENAI_API_KEY, base = process.env.OPENAI_BASE_URL;
  const f = path.join(os.homedir(), '.genspark_llm.yaml');
  if ((!key || !base) && fs.existsSync(f)) {
    const y = fs.readFileSync(f, 'utf8');
    key ||= y.match(/api_key:\s*(\S+)/)?.[1];
    base ||= y.match(/base_url:\s*(\S+)/)?.[1];
  }
  if (!key || !base) throw new Error('LLM API not configured (OPENAI_API_KEY / OPENAI_BASE_URL)');
  return { key, base: base.replace(/\/$/, '') };
}

// The proxy answers HTTP 200 with a plain-text notice when credits are unavailable -> detect it explicitly.
const BLOCKED = /credits can't be used|credit_exhausted|purchase credits/i;

async function chat(cfg, messages, { json = false, retries = 2 } = {}) {
  for (let a = 0; ; a++) {
    const r = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model: MODEL, messages, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
    });
    const j = await r.json().catch(() => ({}));
    const text = j.choices?.[0]?.message?.content ?? '';
    if (BLOCKED.test(text)) { const e = new Error('LLM proxy refused: no paid credits. ' + text.slice(0, 160)); e.fatal = true; throw e; }
    if (r.ok && text) return text;
    if (a >= retries) throw new Error(`LLM error ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
    await new Promise((s) => setTimeout(s, 1500 * (a + 1)));
  }
}

const SCHEMA = 'Return JSON {"items":[{"district":"news|world|tech|games|anime|music|sports|life","title":"<=24 JP chars","date":"M/D","heat":0-100,"body":"<=90 JP chars","src":"source name"}],"issues":[string]}';
const NOTES = () => fs.readFileSync(path.join(ROOT, 'research/notes.md'), 'utf8');
const DATA = () => fs.readFileSync(path.join(ROOT, 'src/data/trends.js'), 'utf8');

// 6 agents: 4 domain editors + fact-checker + UX/scene reviewer. All run concurrently.
const AGENTS = [
  { id: 'A1_news_world', role: 'NEWS/WORLD editor', task: 'From the research notes, pick the strongest current items for districts news & world not yet in the dataset.' },
  { id: 'A2_sports', role: 'SPORTS editor', task: 'From the notes, pick the strongest sports items (Asian Games, NPB, MLB, sumo, football) not yet in the dataset.' },
  { id: 'A3_ent_music', role: 'ENTERTAINMENT/MUSIC editor', task: 'From the notes, pick music/entertainment/VTuber/drama items not yet in the dataset (district music).' },
  { id: 'A4_tech_games_anime', role: 'TECH/GAMES/ANIME editor', task: 'From the notes, pick items for tech, games, anime districts not yet in the dataset.' },
  { id: 'A5_factcheck', role: 'FACT-CHECKER', task: 'Cross-check the dataset against the notes. List contradictions, stale dates, duplicate items and districts over 13 items in "issues". items may be empty.' },
  { id: 'A6_ux', role: 'MOBILE-LANDSCAPE UX reviewer for a Three.js first-person hub', task: 'Review titles for readability on a landscape phone LED kiosk (short, punchy). Propose shortened titles as items (same district/date) and UX issues.' },
];

async function runAgent(cfg, ag, notes, data) {
  const t0 = Date.now();
  const text = await chat(cfg, [
    { role: 'system', content: `You are ${ag.role} for IMATORE, a 3D Japanese trend hub dated 2026-09-24/25 JST. Use ONLY facts in the provided notes/dataset; never invent. ${SCHEMA}` },
    { role: 'user', content: `${ag.task}\n\n# RESEARCH NOTES\n${notes}\n\n# CURRENT DATASET (src/data/trends.js)\n${data}` },
  ], { json: true });
  let out; try { out = JSON.parse(text); } catch { out = { items: [], issues: ['non-JSON output'], raw: text }; }
  return { agent: ag.id, ms: Date.now() - t0, ...out };
}

async function main() {
  const cfg = config();
  process.stdout.write(`preflight ${cfg.base} model=${MODEL} … `);
  await chat(cfg, [{ role: 'user', content: 'Reply with OK' }], { retries: 0 });
  console.log('OK');
  if (process.argv.includes('--check')) return;

  const run = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(ROOT, 'research/agents', run);
  fs.mkdirSync(dir, { recursive: true });
  const notes = NOTES(), data = DATA();
  const res = await Promise.allSettled(AGENTS.map((ag) => runAgent(cfg, ag, notes, data)));
  const merged = { run, model: MODEL, items: [], issues: [] };
  res.forEach((r, i) => {
    const id = AGENTS[i].id;
    const v = r.status === 'fulfilled' ? r.value : { agent: id, error: String(r.reason?.message || r.reason) };
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(v, null, 2));
    console.log(`${id}: ${v.error ? 'FAIL ' + v.error : `${v.items?.length ?? 0} items, ${v.issues?.length ?? 0} issues (${v.ms}ms)`}`);
    (v.items || []).forEach((it) => merged.items.push({ ...it, by: id }));
    (v.issues || []).forEach((s) => merged.issues.push(`[${id}] ${s}`));
  });
  // de-dupe by title, keep highest heat
  const seen = new Map();
  for (const it of merged.items) { const k = it.title; if (!seen.has(k) || seen.get(k).heat < it.heat) seen.set(k, it); }
  merged.items = [...seen.values()];
  fs.writeFileSync(path.join(dir, 'merged.json'), JSON.stringify(merged, null, 2));
  console.log(`merged -> ${path.relative(ROOT, dir)}/merged.json (${merged.items.length} candidates). Review before editing src/data/trends.js.`);
}

main().catch((e) => { console.error('PIPELINE STOPPED:', e.message); process.exit(e.fatal ? 2 : 1); });
