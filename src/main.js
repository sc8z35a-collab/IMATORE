import * as THREE from 'three';
import { Engine } from './world/engine.js';
import { GroundReflection } from './world/reflection.js';
import { Sky } from './world/sky.js';
import { Materials } from './world/materials.js';
import { buildGround } from './world/ground.js';
import { City } from './world/city.js';
import { ScreenSystem } from './world/screens.js';
import { Kiosks } from './world/kiosks.js';
import { Props } from './world/props.js';
import { CityLife } from './world/life.js';
import { Controls } from './controls.js';
import { Landscape, LU, LANDMARKS } from './world/landscape.js';
import { Platform } from './world/platform.js';
import { MapUI, terraceFor } from './ui/map.js';
import { SETTINGS, PRESETS, Q, saveSettings } from './settings.js';
import { QA_OFF, asset } from './util/qa.js';
import { aveDir, avePoint, PLAZA_R, AVE_END, N_AVE, HUB_R, RING_OUT, EDGE, groundHeight } from './world/layout.js';
import { DISTRICTS, TOP_NOW, TICKER, AS_OF, X_TRENDS } from './data/trends.js';

const $ = (id) => document.getElementById(id);
// all trend text is injected via innerHTML -> escape it (titles may contain <, &, quotes)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cssUrl = (u) => `url(&quot;${esc(asset(u)).replace(/[()]/g, (c) => '%' + c.charCodeAt(0).toString(16))}&quot;)`;
const isMobile = /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.matchMedia('(pointer:coarse)').matches);
if (!isMobile) document.body.classList.add('desktop');
$('ld-date').textContent = AS_OF;
// loader: 8 district colour pips (light up with progress) + rotating tips
$('ld-dist').innerHTML = DISTRICTS.map((d) => `<i style="--c:${d.color}" title="${esc(d.name)}"></i>`).join('');
const TIPS = [
  '左半分をドラッグで移動、右半分をドラッグで視点。端末に向かってタップで記事を開けます',
  '☰ ガイドから 8 つの通りへワープ。MAP の AREA タブでランドマークを選ぶと展望テラスへ',
  '通りの突き当たりは展望テラス。スカイツリー・東京タワー・富士山の方向を向くと名前と距離が出ます',
  '2 本指でピンチするとズーム。GYRO をオンにすると端末の傾きで見回せます',
  '重いと感じたら ⚙ 設定 → 超軽量モード (影・反射・ポストエフェクトを省略、30fps)',
  'イヤホン推奨: 雨音、濡れた足音、横断歩道の誘導音、遠くの電車が聞こえます',
];
let tipI = Math.floor(Math.random() * TIPS.length);
// swap text directly + replay a CSS fade (no hidden gap: a delayed timer on a busy main thread left the tip blank)
const tipTimer = setInterval(() => { const el = $('ld-tip'); if (!el) return clearInterval(tipTimer); el.textContent = TIPS[tipI++ % TIPS.length]; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); }, 4200);
$('ld-tip').textContent = TIPS[tipI++ % TIPS.length]; $('ld-tip').classList.add('on');
$('asof').textContent = AS_OF;

const T0 = performance.now();
const setMsg = (m) => { $('ld-msg').textContent = m; console.log(`[boot ${((performance.now() - T0) / 1000).toFixed(1)}s] ${m}`); };
const setProg = (p) => {
  $('ld-fill').style.width = `${Math.round(p * 100)}%`;
  document.querySelectorAll('#ld-dist i').forEach((el, k, all) => el.classList.toggle('on', p >= (k + 0.5) / all.length));
};

async function boot() {
  // make sure web fonts are ready before rasterising canvas textures
  setMsg('フォントを読み込み中…');
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('900 64px "Noto Sans JP"', '今トレ速報'),
        document.fonts.load('700 64px "Noto Sans JP"', '今トレ'),
        document.fonts.load('400 32px "Noto Sans JP"', '今トレ'),
        document.fonts.load('900 64px Orbitron', 'IMATORE'),
        document.fonts.load('700 64px Orbitron', 'IMATORE'),
      ]),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
  } catch (e) { /* fallback fonts */ }

  const engine = new Engine($('gl'));
  const { scene, camera, renderer } = engine;
  const manager = new THREE.LoadingManager();
  let assetP = 0;
  manager.onProgress = (_u, l, t) => { assetP = l / t; setProg(0.35 + assetP * 0.6); };
  const assetsDone = new Promise((res) => { manager.onLoad = res; setTimeout(res, 25000); });

  const tick = () => new Promise((r) => requestAnimationFrame(() => r()));
  setMsg('夜空と月を生成中…'); setProg(0.05); await tick();
  const refl = new GroundReflection(renderer, 0.5);
  engine.resizeHooks = [(w, h, dpr) => refl.setSize(w, h, Math.min(dpr, 1.5))];
  engine.onResize(true);
  const sky = new Sky(scene, renderer, manager); sky.build();

  setMsg('街路を敷設中…'); setProg(0.1); await tick();
  const mats = new Materials(manager, renderer);
  const M = mats.build();
  buildGround(scene, M, refl);

  setMsg('人工地盤と展望テラスを建設中…'); await tick();
  const platform = new Platform(scene, M).build();
  refl.hide.push(...platform.reflHide);

  setMsg('湾岸・首都高・遠景の街を生成中…'); setProg(0.13); await tick();
  const land = new Landscape(scene, { moonDir: sky.moonDir }).build();
  refl.hide.push(...land.reflHide);

  setMsg('ビル群を建設中…'); setProg(0.16); await tick();
  const city = new City(scene, M, DISTRICTS).build();

  setMsg('ネオンと街灯を設置中…'); setProg(0.22); await tick();
  const props = new Props(scene, M, DISTRICTS).build(city);

  setMsg('人と車を配置中…'); await tick();
  const life = new CityLife(scene, DISTRICTS, X_TRENDS).build();
  refl.hide.push(...life.holos);
  if (life.crowd) refl.hide.push(life.crowd, life.umbrellas);

  setMsg('トレンド端末を起動中…'); setProg(0.28); await tick();
  const kiosks = new Kiosks(scene, M, DISTRICTS, TOP_NOW).build();

  setMsg('大型ビジョンに接続中…'); setProg(0.32); await tick();
  const screens = new ScreenSystem(scene, DISTRICTS, TOP_NOW);
  screens.loadImages();
  screens.build(city.screens);

  // refl pass hides rain + tiny stuff
  refl.hide.push(sky.rain);

  setMsg('テクスチャをストリーミング中…');
  // compile shaders up-front to avoid hitches
  camera.position.set(0, 1.6, 18);
  await tick();
  if (!QA_OFF.compile) try { renderer.compile(scene, camera); } catch (e) { /* ignore */ }
  await assetsDone;
  setProg(1);
  setMsg(isMobile ? '準備完了 — タップして入場' : 'スマホ専用ハブです(PCでは簡易操作)');

  // ---------- HUD ----------
  $('ticker-in').innerHTML = [...TICKER, ...TICKER].map((t) => `<span>${esc(t)}</span>`).join('');
  buildGuide();

  const controls = new Controls(camera, $('gl'), $('hud'));
  controls.pos.set(0, 0, HUB_R - 3);
  controls.yaw = 0; controls.pitch = 0.22;
  controls.update(0.016);

  const enter = $('enter');
  enter.disabled = false; enter.textContent = 'ENTER';
  let entered = false;
  enter.onclick = () => {
    if (entered) return; // double tap would start a second AudioContext / intro
    entered = true;
    $('loader').classList.add('fade');
    $('hud').classList.remove('hidden');
    setTimeout(() => $('loader').remove(), 1000);
    controls.enabled = true;
    intro = 0;
    audio.start();
    // Android Chrome: fullscreen first, then lock to landscape (lock requires fullscreen)
    try {
      const fs = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
      Promise.resolve(fs).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
    } catch (e) {}
  };

  // ---------- intro fly-in ----------
  let intro = -1; // -1 = pre-enter orbit
  const introFrom = new THREE.Vector3(), introTo = new THREE.Vector3();
  const introQ = new THREE.Quaternion(), introQ0 = new THREE.Quaternion(), introM = new THREE.Matrix4();
  const introLook = new THREE.Vector3(0, 16, 0), UP = new THREE.Vector3(0, 1, 0);

  // ---------- picking ----------
  const ray = new THREE.Raycaster();
  ray.far = 60;
  const v2 = new THREE.Vector2();
  const pickables = [...kiosks.pickables];
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), gp = new THREE.Vector3();
  controls.onTap = (x, y) => {
    if (!controls.enabled) return;
    // tapping the world while a sheet is open just closes the sheet
    if (sheetOpen()) { closeSheets(); return; }
    v2.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    ray.setFromCamera(v2, camera);
    ray.far = 60;
    const hit = ray.intersectObjects(pickables, false)[0];
    if (hit) { openHit(hit.object.userData, hit.distance); return; }
    // screens (far: the avenue-end screens are ~180 m away; ray.far=60 made them untappable)
    ray.far = 200;
    const sh = ray.intersectObjects(screens.meshes, false)[0];
    ray.far = 60;
    if (sh) { openDistrict(sh.object.userData.district); return; }
    // tap on ground: walk there
    if (ray.ray.intersectPlane(groundPlane, gp) && gp.distanceTo(camera.position) < 50) {
      controls.travelTo(gp.x, gp.z, null, { speed: 7 });
      tapMarker(gp);
    }
  };
  function openHit(u, dist) {
    if (u.kind === 'item') {
      // walk up to it first, then open
      if (dist > 9) approachItem(u.district, u.item, () => openItem(u.district, u.item));
      else openItem(u.district, u.item);
    } else if (u.kind === 'district') openDistrict(u.district);
    else if (u.kind === 'top') openTop();
    buzz(10);
  }
  function approachItem(di, ki, then) {
    const p = DISTRICTS[di].items[ki]._pos;
    // stand 3.2m in front of the panel face
    const sx = p.x + Math.sin(p.rotY) * 3.2, sz = p.z + Math.cos(p.rotY) * 3.2;
    controls.travelTo(sx, sz, { x: p.x, z: p.z, pitch: 0.12 }, { speed: 12 });
    pendingOpen = { then, travel: controls.travel };
  }
  let pendingOpen = null;

  // tap marker ring
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.32, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2, 2.5), transparent: true, depthWrite: false }));
  marker.rotation.x = -Math.PI / 2; marker.visible = false; scene.add(marker);
  let markerT = 0;
  function tapMarker(p) { marker.position.set(p.x, groundHeight(p.x, p.z) + 0.04, p.z); marker.visible = true; markerT = 0; }

  // ---------- sheets ----------
  const SHEETS = ['guide', 'detail', 'map', 'settings'];
  function sheetOpen() { return SHEETS.some((id) => !$(id).classList.contains('hidden')); }
  function closeSheets() { SHEETS.forEach((id) => $(id).classList.add('hidden')); }
  function toggleGuide() { ['detail', 'map', 'settings'].forEach((id) => $(id).classList.add('hidden')); $('guide').classList.toggle('hidden'); $('guide').scrollTop = 0; markGuideHere(); audio.blip(880); }
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => $(b.dataset.close).classList.add('hidden')));
  $('btn-guide').onclick = toggleGuide;
  window.addEventListener('keydown', (e) => {
    if (!controls.enabled) return;
    if (e.code === 'Escape') closeSheets();
    else if (e.code === 'KeyG' || e.code === 'Tab') { e.preventDefault(); toggleGuide(); }
    else if (e.code === 'KeyM') { if ($('map').classList.contains('hidden')) openMap(); else closeSheets(); }
  });
  $('btn-run').onclick = () => { controls.runToggle = !controls.runToggle; $('btn-run').classList.toggle('on', controls.runToggle); audio.blip(660); };
  $('btn-gyro').onclick = async () => {
    if (controls.gyro.on) { controls.disableGyro(); $('btn-gyro').classList.remove('on'); }
    else if (await controls.enableGyro()) $('btn-gyro').classList.add('on');
    else toast('ジャイロを利用できません(センサー非対応または許可されていません)');
    audio.blip(740);
  };
  // body.sheet-open must follow sheet visibility *immediately* (updatePrompt only runs every 3rd frame -> at low fps the
  // prompt card / HUD buttons stayed visible on top of a freshly opened sheet)
  let promptHit = null; // (declared here: syncSheetClass below and updatePrompt both use it)
  const syncSheetClass = () => {
    const so = sheetOpen();
    document.body.classList.toggle('sheet-open', so);
    if (so) { $('prompt').classList.add('hidden'); promptHit = null; $('crosshair').classList.remove('hot'); }
  };
  const sheetObs = new MutationObserver(syncSheetClass);
  SHEETS.forEach((id) => sheetObs.observe($(id), { attributes: true, attributeFilter: ['class'] }));
  // touching the world anywhere (also the joystick half, which never produces a 'tap') dismisses an open sheet
  $('gl').addEventListener('touchstart', () => { if (controls.enabled && sheetOpen()) closeSheets(); }, { passive: true });
  // stop touch on sheets propagating to canvas
  SHEETS.forEach((id) => $(id).addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true }));

  function heatRow(it, d, di, ki) {
    return `<div class="d-row" data-d="${di}" data-k="${ki}"><em>${esc(it.date)}</em><b>${esc(it.title)}</b><span class="h" style="color:${d.color}">${it.heat}</span></div>`;
  }
  function bindRows(root) {
    root.querySelectorAll('.d-row[data-d]').forEach((r) => r.addEventListener('click', () => {
      const di = +r.dataset.d, ki = +r.dataset.k;
      $('detail').classList.add('hidden');
      warpToItem(di, ki);
    }));
  }
  function openItem(di, ki) {
    const d = DISTRICTS[di], it = d.items[ki];
    const img = it.img || d.img;
    const src = it.src ? `<div class="d-src">出典: ${esc(it.src)}</div>` : '';
    const heat = Math.max(0, Math.min(100, +it.heat || 0));
    $('detail-body').innerHTML = `
      <div class="d-hero" style="background-image:${cssUrl(img)}"></div>
      <span class="d-tag" style="background:${d.color}">${esc(d.name)}</span>
      <div class="d-title">${esc(it.title)}</div>
      <div class="d-date">${esc(it.date)} ・ ${esc(d.jp)}</div>
      <div class="d-body">${esc(it.body)}</div>
      ${src}
      <div class="d-heat">HEAT<div class="bar"><i style="width:${heat}%;background:linear-gradient(90deg,${d.color},#fff)"></i></div>${heat}</div>
      <div class="d-more"><h4>MORE IN ${esc(d.name)}</h4>${d.items.map((x, k) => (k === ki ? '' : heatRow(x, d, di, k))).join('')}</div>`;
    bindRows($('detail-body'));
    $('guide').classList.add('hidden');
    $('detail').classList.remove('hidden');
    $('detail').scrollTop = 0;
    audio.blip(990);
  }
  function openDistrict(di) {
    const d = DISTRICTS[di];
    const sorted = d.items.map((x, k) => [x, k]).sort((a, b) => b[0].heat - a[0].heat);
    $('detail-body').innerHTML = `
      <div class="d-hero" style="background-image:${cssUrl(d.img)}"></div>
      <span class="d-tag" style="background:${d.color}">${esc(d.name)}</span>
      <div class="d-title">${esc(d.jp)} ／ ${esc(d.tagline)}</div>
      <div class="d-date">${d.items.length} TRENDS ・ ${esc(AS_OF)}</div>
      <div class="d-more"><h4>HEAT RANKING — タップで端末へ移動</h4>${sorted.map(([x, k]) => heatRow(x, d, di, k)).join('')}</div>`;
    bindRows($('detail-body'));
    $('guide').classList.add('hidden');
    $('detail').classList.remove('hidden');
    $('detail').scrollTop = 0;
    audio.blip(900);
  }
  function openTop() {
    const catToD = { ent: 'music', sports: 'sports', world: 'world', tech: 'tech', life: 'life', games: 'games', anime: 'anime', news: 'news' };
    $('detail-body').innerHTML = `
      <div class="d-hero" style="background-image:${cssUrl('/img/moon_skyline.jpg')}"></div>
      <span class="d-tag" style="background:#27e0ff">TOP NOW</span>
      <div class="d-title">いま一番アツいトレンド</div>
      <div class="d-date">${esc(AS_OF)}</div>
      <div class="d-more"><h4>REAL-TIME RANKING</h4>${TOP_NOW.map((t, k) => {
        const di = DISTRICTS.findIndex((d) => d.id === catToD[t.c]);
        const d = DISTRICTS[Math.max(0, di)];
        return `<div class="d-row" data-top="${Math.max(0, di)}"><em>#${k + 1}</em><b>${esc(t.t)}</b><span class="h" style="color:${d.color}">${t.heat}</span></div>`;
      }).join('')}</div>`;
    $('detail-body').querySelectorAll('[data-top]').forEach((r) => r.addEventListener('click', () => { $('detail').classList.add('hidden'); warpToDistrict(+r.dataset.top); }));
    $('guide').classList.add('hidden');
    $('detail').classList.remove('hidden');
    $('detail').scrollTop = 0;
    audio.blip(1040);
  }

  function warpToDistrict(di) {
    const p = avePoint(di, PLAZA_R - 2, 0);
    const look = avePoint(di, PLAZA_R + 30, 0);
    controls.travelTo(p.x, p.z, { x: look.x, z: look.z, pitch: 0.18 }, { warp: true });
    audio.whoosh();
  }
  function warpToItem(di, ki) {
    const it = DISTRICTS[di].items[ki];
    const p = it._pos;
    const sx = p.x + Math.sin(p.rotY) * 3.2, sz = p.z + Math.cos(p.rotY) * 3.2;
    controls.travelTo(sx, sz, { x: p.x, z: p.z, pitch: 0.12 }, { warp: true });
    pendingOpen = { then: () => openItem(di, ki), travel: controls.travel };
    audio.whoosh();
  }
  function warpHome() {
    controls.travelTo(0, HUB_R - 3, { x: 0, z: 0, pitch: 0.35 }, { warp: true });
    audio.whoosh();
  }

  function buildGuide() {
    const root = $('guide-list');
    root.innerHTML = `<div class="g-item g-plaza" data-home="1" style="background-image:${cssUrl('/img/moon_skyline.jpg')}"><i style="background:linear-gradient(90deg,#27e0ff,#ff4fd8,#ffe14f)"></i><div><b>CENTRAL PLAZA</b><small>今トレ タワー ・ TOP NOW #1 ${esc(TOP_NOW[0]?.t || '')}</small></div><em class="g-here">YOU ARE HERE</em></div>` +
      DISTRICTS.map((d, i) => {
        const top = [...d.items].sort((a, b) => b.heat - a.heat)[0];
        const heat = Math.max(0, Math.min(100, +(top && top.heat) || 0));
        return `<div class="g-item" data-i="${i}" style="--gc:${d.color};background-image:${cssUrl(d.img)}"><i style="background:${d.color}"></i>` +
          `<span class="g-no">${String(i + 1).padStart(2, '0')} ・ ${d.items.length} TRENDS</span>` +
          `<div><b style="color:${d.color}">${esc(d.name)} <span>${esc(d.jp)}</span></b><small>▲${heat} ${esc(top ? top.title : d.tagline)}</small>` +
          `<u><s style="width:${heat}%"></s></u></div><em class="g-here">YOU ARE HERE</em></div>`;
      }).join('');
    root.querySelectorAll('.g-item').forEach((el) => el.addEventListener('click', () => {
      $('guide').classList.add('hidden');
      buzz(8);
      if (el.dataset.home) warpHome(); else warpToDistrict(+el.dataset.i);
    }));
  }
  // mark the card of the zone the player is in (called whenever the guide opens)
  function markGuideHere() {
    const z = zoneAt(controls.pos.x, controls.pos.z);
    $('guide-list').querySelectorAll('.g-item').forEach((el) => el.classList.toggle('here', z.d < 0 ? !!el.dataset.home : el.dataset.i === String(z.d)));
  }

  // ---------- map (renewed): heading-up minimap + full-screen HUB / AREA map ----------
  const mapUI = new MapUI({
    districts: DISTRICTS, mini: $('minimap'), full: $('map-canvas'),
    onWarpDistrict: (i) => { closeSheets(); warpToDistrict(i); },
    onWarpLandmark: (key) => { closeSheets(); warpToLandmark(key); },
    onWarpHome: () => { closeSheets(); warpHome(); },
  });
  mapUI.prepare();
  function openMap() {
    $('detail').classList.add('hidden'); $('guide').classList.add('hidden'); $('settings').classList.add('hidden');
    $('map').classList.remove('hidden');
    // synchronous: removing .hidden + getBoundingClientRect forces layout, so the canvas has its real size now
    // (deferring to rAF let the main loop call drawFull() first with an unsized canvas)
    mapUI.open(controls.pos, controls.yaw + (controls.gyro.on ? controls.gyro.yaw : 0));
    audio.blip(880);
  }
  $('minimap').addEventListener('click', openMap);
  $('btn-map').onclick = openMap;
  document.querySelectorAll('[data-map]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-map]').forEach((x) => x.classList.toggle('on', x === b));
    mapUI.setMode(b.dataset.map); audio.blip(760);
  }));
  window.addEventListener('resize', () => { if (!$('map').classList.contains('hidden')) { mapUI.resize(); mapUI.drawFull(); } });
  function warpToLandmark(key) {
    const i = terraceFor(key);
    const L = LANDMARKS[key];
    const p = avePoint(i, EDGE - 5.5, 0);
    // pitch so the landmark sits nicely in frame (tall/near things -> look up a bit)
    const dist = Math.hypot(L.x - p.x, L.z - p.z);
    const pitch = Math.max(-0.05, Math.min(0.28, Math.atan2(L.h * 0.45 - 28, dist)));
    controls.travelTo(p.x, p.z, { x: L.x, z: L.z, pitch }, { warp: true });
    audio.whoosh();
  }

  // ---------- settings (画質プリセット / 超軽量モード) ----------
  function buildSettings() {
    const root = $('settings-body');
    const presetBtns = Object.entries(PRESETS).map(([k, p]) => `<button class="pz${SETTINGS.preset === k ? ' on' : ''}" data-preset="${k}"><b>${esc(p.label)}</b><small>${esc(p.desc)}</small></button>`).join('');
    const tog = (key, label, sub) => `<label class="tg"><span><b>${esc(label)}</b><small>${esc(sub)}</small></span><input type="checkbox" data-set="${key}" ${SETTINGS[key] ? 'checked' : ''}><i></i></label>`;
    root.innerHTML = `
      <h4>画質プリセット${SETTINGS.auto ? ' <em>(端末から自動選択)</em>' : ''}</h4>
      <div class="pz-row">${presetBtns}</div>
      <p class="note">プリセットの変更はページを再読み込みして反映します。超軽量モードはポストエフェクト・影・路面反射・遠景の密度・テクスチャ解像度を削減し、30fps に制限します。</p>
      <h4>表示</h4>
      ${tog('rain', '雨', '雨粒と路面の波紋')}
      ${tog('fx', 'レンズ効果', 'フィルムグレイン・色収差・周辺減光')}
      ${tog('people', '人を表示', 'オフ: 無人の街 (既定)。変更は再読み込み')}
      ${tog('traffic', '無人運転の車', '環状道路の自動運転車。変更は再読み込み')}
      ${tog('sound', 'サウンド', '環境音と効果音')}
      <div class="stat" id="stat"></div>`;
    root.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.preset === SETTINGS.preset && !SETTINGS.auto) return;
      saveSettings({ preset: b.dataset.preset });
      toast(`「${PRESETS[b.dataset.preset].label}」に切り替えます…`);
      setTimeout(() => location.reload(), 500);
    }));
    root.querySelectorAll('[data-set]').forEach((el) => el.addEventListener('change', () => {
      const k = el.dataset.set, v = el.checked;
      saveSettings({ [k]: v });
      if (k === 'rain') { sky.rainU.uAmt.value = v ? 1 : 0; refl.uniforms.uRain.value = v ? 1 : 0; audio.rain(v); }
      else if (k === 'fx') engine.setLensFx(v);
      else if (k === 'sound') audio.mute(!v);
      else if (k === 'people' || k === 'traffic') { toast('再読み込みして反映します…'); setTimeout(() => location.reload(), 600); }
      audio.blip(700);
    }));
  }
  function openSettings() {
    $('detail').classList.add('hidden'); $('guide').classList.add('hidden'); $('map').classList.add('hidden');
    buildSettings();
    $('settings').classList.remove('hidden');
    const i = engine.renderer.info.render;
    $('stat').textContent = `${Q.label} ・ 解像度 x${engine.dpr.toFixed(2)} ・ ${Math.round(engine.fps || 0)} fps ・ draw ${i.calls} ・ 遠景ビル ${land.buildingCount} 棟 ・ 光点 ${land.pointCount}`;
    audio.blip(820);
  }
  $('btn-settings').onclick = openSettings;
  $('ld-settings').onclick = (e) => { e.stopPropagation(); openSettings(); };

  // context for ambience: terrace wind, walk-signal chime near the 8 ring crossings
  function audioInfo(z) {
    const x = controls.pos.x, zz = controls.pos.z, r = Math.hypot(x, zz);
    let crossDist = 1e9, crossPan = 0;
    if (r > HUB_R - 6 && r < PLAZA_R + 8) {
      for (let i = 0; i < N_AVE; i++) {
        const c = avePoint(i, (HUB_R + RING_OUT) / 2, 0), dx = c.x - x, dz = c.z - zz, d = Math.hypot(dx, dz);
        if (d < crossDist) {
          crossDist = d;
          // stereo position relative to the view direction
          const yaw = controls.yaw; crossPan = (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / Math.max(d, 1);
        }
      }
    }
    return { terrace: !!z.terrace, walkSignal: (t % 20) / 20 >= 0.67, crossDist, crossPan }; // props.js signal cycle: cars red => pedestrians walk
  }
  // ---------- zone banner (entering an avenue / terrace / the plaza) ----------
  let zbT = 0;
  function zoneBanner(z, zd) {
    const el = $('zone-banner');
    $('zb-k').textContent = z.terrace ? 'OBSERVATION TERRACE' : zd ? 'NOW ENTERING' : 'WELCOME TO';
    $('zb-t').textContent = zd ? zd.name : 'CENTRAL PLAZA';
    $('zb-s').textContent = z.terrace ? '展望テラス ・ 遠くのランドマークを眺めよう' : zd ? `${zd.jp} ／ ${zd.tagline}` : '今トレ タワー ・ TOP NOW';
    el.style.setProperty('--zc', zd ? zd.color : '#27e0ff');
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    clearTimeout(zbT); zbT = setTimeout(() => el.classList.remove('on'), 2600);
    buzz(6);
  }
  // ---------- compass tape (heading-up, N = world −Z) ----------
  const CMP = (() => {
    const marks = [];
    for (let d = 0; d < 360; d += 15) {
      const lbl = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[d];
      marks.push(`<span style="left:${d * 2}px" class="${lbl ? (lbl.length === 1 ? 'c' : 'o') : 't'}">${lbl || ''}</span>`);
    }
    const one = marks.join('');
    $('compass-in').innerHTML = `<div>${one}</div><div>${one}</div><div>${one}</div>`;
    return { last: 1e9 };
  })();
  function compass(yaw) {
    // heading in degrees clockwise from north: facing -Z at yaw 0, yaw grows counter-clockwise
    let h = ((-yaw * 180) / Math.PI) % 360; if (h < 0) h += 360;
    if (Math.abs(h - CMP.last) < 0.2) return;
    CMP.last = h;
    $('compass-in').style.transform = `translateX(${-(h * 2) - 720}px)`;
  }
  // light haptic tick (Android Chrome; iOS ignores navigator.vibrate)
  function buzz(ms = 8) { try { navigator.vibrate?.(ms); } catch (e) { /* ignore */ } }

  // small transient notice (gyro unavailable, context restored, …)
  let toastT = 0;
  function toast(msg) {
    let el = $('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2600);
  }

  // ---------- zone + prompt ----------
  function zoneAt(x, z) {
    const r = Math.hypot(x, z);
    if (r < PLAZA_R) return { name: 'CENTRAL PLAZA', d: -1 };
    let best = -1, bd = 1e9;
    for (let i = 0; i < N_AVE; i++) {
      const dir = aveDir(i);
      const lat = Math.abs(-x * dir.z + z * dir.x);
      const al = x * dir.x + z * dir.z;
      if (al > 0 && lat < bd) { bd = lat; best = i; }
    }
    if (best < 0) return { name: 'CENTRAL PLAZA', d: -1 };
    const al = x * aveDir(best).x + z * aveDir(best).z;
    if (al > AVE_END + 4) return { name: `${DISTRICTS[best].name} TERRACE`, d: best, terrace: true };
    return { name: `${DISTRICTS[best].name} AVE.`, d: best };
  }
  const center = new THREE.Vector2(0, 0);
  let lastZone = '';
  // landmarks you can "spot" from a terrace (look roughly toward them) -> prompt shows name + distance
  const SIGHT = [['skytree', 'スカイツリー風 電波塔', '634m'], ['lattice', '東京タワー風 鉄塔', '333m'], ['wheel', '湾岸の大観覧車', '115m'], ['fuji', '富士山', '3776m']];
  const _fwd = new THREE.Vector3();
  function setPrompt(key, kTxt, tTxt, sTxt, color) {
    if (promptHit === key) return;
    promptHit = key;
    $('prompt-k').textContent = kTxt; $('prompt-t').textContent = tTxt; $('prompt-s').textContent = sTxt;
    $('prompt').style.setProperty('--pc', color || '#27e0ff');
  }
  function updatePrompt() {
    const so = sheetOpen();
    document.body.classList.toggle('sheet-open', so);
    if (so) { $('prompt').classList.add('hidden'); promptHit = null; $('crosshair').classList.remove('hot'); return; }
    ray.setFromCamera(center, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    const pr = $('prompt');
    if (hit && hit.distance < 16) {
      const u = hit.object.userData;
      if (u.kind === 'item') {
        const d = DISTRICTS[u.district], it = d.items[u.item];
        setPrompt(`i${u.district}.${u.item}`, `${d.name} ・ ${it.date} ・ HEAT ${it.heat}`, it.title, 'タップで開く', d.color);
      } else if (u.kind === 'district') {
        const d = DISTRICTS[u.district];
        setPrompt(`d${u.district}`, `${d.items.length} TRENDS`, `${d.name} — ${d.jp}`, 'タップでランキング', d.color);
      } else setPrompt('top', 'CENTRAL TOWER', 'TOP NOW — 総合ランキング', 'タップで開く', '#27e0ff');
      pr.classList.remove('hidden'); pr.classList.remove('info');
      $('crosshair').classList.add('hot');
      return;
    }
    $('crosshair').classList.remove('hot');
    // terrace sightseeing: name the landmark in the centre of view (informational, not tappable)
    if (zoneAt(controls.pos.x, controls.pos.z).terrace) {
      camera.getWorldDirection(_fwd);
      let best = null, bc = Math.cos(0.12);
      for (const [key, name, h] of SIGHT) {
        const L = LANDMARKS[key]; const dx = L.x - camera.position.x, dz = L.z - camera.position.z, dist = Math.hypot(dx, dz);
        const c = (dx * _fwd.x + dz * _fwd.z) / (dist * Math.hypot(_fwd.x, _fwd.z) || 1);
        if (c > bc) { bc = c; best = [key, name, h, dist]; }
      }
      if (best) {
        const km = best[3] >= 1000 ? `${(best[3] / 1000).toFixed(1)} km` : `${Math.round(best[3])} m`;
        setPrompt('L' + best[0], `LANDMARK ・ 高さ ${best[2]}`, best[1], `ここから約 ${km}`, '#ffd27a');
        pr.classList.remove('hidden'); pr.classList.add('info');
        return;
      }
    }
    pr.classList.add('hidden'); promptHit = null;
  }
  $('prompt').style.pointerEvents = 'auto';
  $('prompt').addEventListener('click', () => {
    if ($('prompt').classList.contains('info')) return;
    ray.setFromCamera(center, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    if (hit && hit.distance < 16) openHit(hit.object.userData, hit.distance);
  });

  // ---------- audio (procedural: rain, city hum, blips) ----------
  const audio = makeAudio();

  // ---------- loop ----------
  let t = 0, last = performance.now(), frame = 0;
  const clockEl = $('clk');
  const updClock = () => { clockEl.textContent = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }); };
  updClock();
  let lastDraw = 0;
  document.addEventListener('visibilitychange', () => {
    // don't let a long background pause count as one giant frame; pause audio in the background
    last = performance.now();
    audio.suspend(document.hidden);
    if (document.hidden) controls.releaseInputs();
  });
  function loop(now) {
    requestAnimationFrame(loop);
    const cap = QA_OFF.fps || Q.fpsCap;
    if (cap && now - lastDraw < 1000 / cap - 2) return;
    lastDraw = now;
    const rawDt = (now - last) / 1000;
    if (rawDt > 0 && rawDt < 1) engine.fps = engine.fps ? engine.fps * 0.95 + (1 / rawDt) * 0.05 : 1 / rawDt;
    let dt = Math.min(QA_OFF.fps ? 0.5 : 0.05, rawDt); last = now;
    t += dt; frame++;
    if (intro < 0) {
      // attract mode behind loader: slow orbit high above the plaza
      const a = t * 0.05;
      camera.position.set(Math.sin(a) * 60, 34, Math.cos(a) * 60);
      camera.lookAt(0, 16, 0);
    } else if (intro < 1) {
      intro = Math.min(1, intro + dt / 3.2);
      const e = 1 - Math.pow(1 - intro, 3);
      controls.update(dt);
      const a = t * 0.05;
      introFrom.set(Math.sin(a) * 60, 34, Math.cos(a) * 60);
      introTo.copy(camera.position);
      introQ.copy(camera.quaternion);
      camera.position.lerpVectors(introFrom, introTo, e);
      introQ0.setFromRotationMatrix(introM.lookAt(introFrom, introLook, UP));
      camera.quaternion.slerpQuaternions(introQ0, introQ, e);
    } else {
      controls.update(dt);
    }
    if (pendingOpen && controls.travel !== pendingOpen.travel) {
      // open only if the approach finished on its own (not cancelled by the joystick or a new travel)
      const f = pendingOpen.then, ok = controls.lastTravelEnd !== 'cancelled' && !controls.travel;
      pendingOpen = null;
      if (ok) setTimeout(f, 120);
    }
    engine.final.uniforms.uWarp.value = controls.warpAmt || 0;

    sky.update(t, camera.position);
    LU.uPx.value = engine.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    land.update(t, dt, camera.position);
    refl.uniforms.uTime.value = t;
    if (!QA_OFF.screens) screens.update(t, dt, camera.position);
    kiosks.update(t, dt, controls.enabled ? controls.pos : null);
    props.update(t);
    life.update(t, camera, scene);
    if (marker.visible) { markerT += dt; marker.scale.setScalar(1 + markerT * 3); marker.material.opacity = Math.max(0, 1 - markerT * 1.5); if (markerT > 0.7) marker.visible = false; }

    if (!QA_OFF.refl) refl.update(scene, camera);
    engine.render(t);
    engine.adapt(dt, t);

    if (controls.enabled && frame % 3 === 0) {
      const z = zoneAt(controls.pos.x, controls.pos.z);
      const zd = z.d >= 0 ? DISTRICTS[z.d] : null;
      mapUI.drawMini(controls.pos, controls.yaw + (controls.gyro.on ? controls.gyro.yaw : 0), { label: z.terrace ? 'TERRACE' : zd ? zd.name : 'PLAZA', color: zd ? zd.color : '#27e0ff' });
      if (!$('map').classList.contains('hidden') && frame % 6 === 0) { mapUI.player = { x: controls.pos.x, z: controls.pos.z, yaw: controls.yaw + (controls.gyro.on ? controls.gyro.yaw : 0) }; mapUI.drawFull(t); }
      if (z.name !== lastZone) { $('zone').textContent = z.name; if (lastZone) zoneBanner(z, zd); lastZone = z.name; audio.zone(z.d); }
      compass(controls.yaw + (controls.gyro.on ? controls.gyro.yaw : 0));
      updatePrompt();
      audio.update(controls.pos, controls.vel.length(), dt * 3, audioInfo(z));
    }
    if (frame % 30 === 0) updClock();
  }
  requestAnimationFrame(loop);
  // QA helper: instant teleport (x,z,yaw,pitch)
  const tp = (x, z, yaw = 0, pitch = 0.1) => { controls.travel = null; controls.warpAmt = 0; controls.pos.set(x, 0, z); controls.yaw = yaw; controls.pitch = pitch; controls.update(0.016); };
  window.__imatore = { introDone: () => intro >= 1, audio, tp, avePoint, life, land, platform, mapUI, openMap, openSettings, warpToLandmark, engine, controls, scene, camera, city, screens, kiosks, warpToDistrict, warpToItem, openItem, openTop };
}

// ---------------- procedural audio ----------------
// Everything is synthesised (no downloads): rain bed (+ near-field drips), city hum, ambient pad, wet footsteps
// (L/R alternating), crossing "piyo-piyo" chime near signalled crossings, distant train passes, terrace wind,
// UI blips, warp whoosh and a 2-note zone stinger. Respects settings サウンド / 雨.
function makeAudio() {
  let ctx = null, master, rainG, dripG, humG, windG, windF, noiseBuf, stepT = 0, stepSide = 1, muted = !SETTINGS.sound;
  let rainOn = SETTINGS.rain, chimeT = 0, trainT = 8 + Math.random() * 20, wind = 0;
  const now = () => ctx.currentTime;
  function noiseSrc(rate = 1) { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.playbackRate.value = rate; return s; }
  // looping bed: random start offset so the 4 beds sharing one buffer are decorrelated
  function loopBed(rate) { const s = noiseSrc(rate); s.start(0, Math.random() * 1.9); return s; }
  function pan(x) { if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, x)); return p; } return ctx.createGain(); }
  function tone(f, t0, dur, vol, type = 'sine', dest = master) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
    return o;
  }
  const api = {
    // settings → サウンド. Works before start() too (start() honours it).
    mute(m) {
      muted = !!m;
      if (!ctx || !master) return;
      master.gain.cancelScheduledValues(now());
      master.gain.setTargetAtTime(muted ? 0 : 0.9, now(), 0.08);
    },
    // settings → 雨: the rain bed and drips follow the visual rain
    rain(on) {
      rainOn = !!on;
      if (!ctx) return;
      rainG.gain.setTargetAtTime(rainOn ? 0.11 : 0, now(), 0.4);
      dripG.gain.setTargetAtTime(rainOn ? 0.05 : 0, now(), 0.4);
    },
    start() {
      if (ctx) return;
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9;
        // gentle bus compressor so stacked one-shots never clip on phone speakers
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
        master.connect(comp).connect(ctx.destination);
        const len = ctx.sampleRate * 2;
        noiseBuf = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const d = noiseBuf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; }
        // rain bed: filtered stereo noise
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
        rainG = ctx.createGain(); rainG.gain.value = rainOn ? 0.11 : 0;
        loopBed(1).connect(hp).connect(lp).connect(rainG).connect(master);
        // near-field drips: sparse resonant clicks (a slowed noise through a peaky bandpass)
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 8;
        dripG = ctx.createGain(); dripG.gain.value = rainOn ? 0.05 : 0;
        loopBed(0.07).connect(bp).connect(dripG).connect(master);
        // city hum: low brown-ish noise
        const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 180;
        humG = ctx.createGain(); humG.gain.value = 0.22;
        loopBed(0.25).connect(lp2).connect(humG).connect(master);
        // terrace wind: band-passed noise whose centre wanders (gusts)
        windF = ctx.createBiquadFilter(); windF.type = 'bandpass'; windF.frequency.value = 420; windF.Q.value = 0.7;
        windG = ctx.createGain(); windG.gain.value = 0;
        loopBed(0.5).connect(windF).connect(windG).connect(master);
        // ambient pad
        const pad = ctx.createGain(); pad.gain.value = 0.018; pad.connect(master);
        [110, 164.8, 220.5, 329.6].forEach((f, k) => {
          const o = ctx.createOscillator(); o.type = k % 2 ? 'triangle' : 'sine'; o.frequency.value = f;
          const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + k * 0.03;
          const lg = ctx.createGain(); lg.gain.value = 1.5; lfo.connect(lg).connect(o.frequency); lfo.start();
          o.connect(pad); o.start();
        });
      } catch (e) { ctx = null; }
      if (ctx) ctx.resume?.().catch(() => {});
    },
    suspend(hidden) {
      if (!ctx) return;
      try { if (hidden) ctx.suspend(); else ctx.resume(); } catch (e) { /* ignore */ }
    },
    blip(f = 880) {
      if (!ctx) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f, now()); o.frequency.exponentialRampToValueAtTime(f * 1.5, now() + 0.08);
      g.gain.setValueAtTime(0.08, now()); g.gain.exponentialRampToValueAtTime(0.0001, now() + 0.18);
      o.connect(g).connect(master); o.start(); o.stop(now() + 0.2);
    },
    whoosh() {
      if (!ctx) return;
      const len = ctx.sampleRate * 1.4;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((i / len) * Math.PI);
      const s = ctx.createBufferSource(); s.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
      f.frequency.setValueAtTime(300, now()); f.frequency.exponentialRampToValueAtTime(3000, now() + 0.7); f.frequency.exponentialRampToValueAtTime(400, now() + 1.4);
      const g = ctx.createGain(); g.gain.value = 0.35;
      s.connect(f).connect(g).connect(master); s.start();
    },
    // 2-note stinger, pitch set per district (plaza = rising fifth)
    zone(d) {
      if (!ctx) return;
      const base = d >= 0 ? 392 * Math.pow(2, [0, 2, 4, 5, 7, 9, 11, 12][d % 8] / 12) : 523.25;
      const t0 = now() + 0.01;
      tone(base, t0, 0.5, 0.05, 'triangle'); tone(base * 1.5, t0 + 0.11, 0.7, 0.04, 'sine');
    },
    // footstep on wet pavement: short noise burst + small splash, alternating L/R
    step(run) {
      const len = Math.floor(ctx.sampleRate * 0.11);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate); const dd = buf.getChannelData(0);
      for (let i = 0; i < len; i++) { const e = i / len; dd[i] = (Math.random() * 2 - 1) * (Math.pow(1 - e, 4) + (rainOn ? 0.35 * Math.exp(-Math.pow((e - 0.35) * 9, 2)) : 0)); }
      const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = 0.9 + Math.random() * 0.25;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = (rainOn ? 1700 : 1200) + Math.random() * 600; f.Q.value = 0.9;
      const g = ctx.createGain(); g.gain.value = run ? 0.15 : 0.11;
      stepSide = -stepSide;
      s.connect(f).connect(g).connect(pan(stepSide * 0.18)).connect(master); s.start();
    },
    // Japanese audible pedestrian signal (通りゃんせ-style 擬音 "piyo-piyo"): two quick chirps
    chime(x) {
      const t0 = now() + 0.01, p = pan(x);
      p.connect(master);
      for (const [dt, f] of [[0, 2600], [0.16, 2200]]) {
        const o = tone(f, t0 + dt, 0.12, 0.028, 'sine', p);
        o.frequency.exponentialRampToValueAtTime(f * 0.78, t0 + dt + 0.1);
      }
    },
    // distant elevated train passing: rumble swell + rhythmic wheel clatter, slow pan across the stereo field
    train() {
      const dur = 7, t0 = now(), p = pan(-0.8);
      if (p.pan) p.pan.linearRampToValueAtTime(0.8, t0 + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.07, t0 + dur * 0.45); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      const src = noiseSrc(0.35); src.connect(lp).connect(g).connect(p).connect(master);
      src.start(t0); src.stop(t0 + dur + 0.1);
      for (let k = 0; k < 14; k++) { const tk = t0 + 1 + k * 0.38 + (k % 2) * 0.09; tone(95, tk, 0.09, 0.02 * Math.sin(Math.PI * (k / 14)) + 0.002, 'square', p); }
    },
    update(pos, spd, dt = 0.05, info = {}) {
      if (!ctx) return;
      // iOS/Android may start the context suspended or suspend it after an interruption
      if (ctx.state === 'suspended' && !document.hidden) ctx.resume().catch(() => {});
      // footsteps (frame-rate independent: ~1.8 steps/s at walking speed)
      if (spd > 0.8) {
        stepT -= dt * 1.8 * (spd / 4.2);
        if (stepT <= 0) { stepT = 1; api.step(spd > 6); }
      }
      const r = Math.hypot(pos.x, pos.z);
      humG.gain.setTargetAtTime(0.16 + 0.1 * Math.max(0, 1 - r / 60), now(), 0.3);
      // wind: strong on the terraces (open edge of the platform), a breath elsewhere; gusty filter sweep
      wind += ((info.terrace ? 1 : 0.08) - wind) * Math.min(1, dt * 0.8);
      const gust = 0.6 + 0.4 * Math.sin(now() * 0.37) * Math.sin(now() * 0.11 + 1.3);
      windG.gain.setTargetAtTime(0.09 * wind * gust, now(), 0.25);
      windF.frequency.setTargetAtTime(300 + 500 * gust, now(), 0.5);
      // crossing chime while the signal is green and we stand near a ring crossing (PLAZA_R ring, on an avenue axis)
      chimeT -= dt;
      if (info.walkSignal && chimeT <= 0 && info.crossDist < 16) {
        chimeT = 1.25;
        api.chime(info.crossPan || 0);
      }
      // distant train every ~25-50 s
      trainT -= dt;
      if (trainT <= 0) { trainT = 25 + Math.random() * 25; api.train(); }
    },
  };
  return api;
}

boot().catch((e) => {
  console.error(e);
  const gl = /WebGL|context/i.test(String(e && e.message));
  setMsg(gl ? 'エラー: この端末/ブラウザでは WebGL を利用できません' : 'エラー: ' + (e && e.message));
  const b = $('enter');
  if (b) { b.disabled = false; b.textContent = 'RELOAD'; b.onclick = () => location.reload(); }
});
