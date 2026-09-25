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
import { Controls } from './controls.js';
import { QA_OFF } from './util/qa.js';
import { aveDir, avePoint, PLAZA_R, AVE_END, N_AVE, HUB_R, RING_OUT, kioskPose } from './world/layout.js';
import { DISTRICTS, TOP_NOW, TICKER, AS_OF } from './data/trends.js';

const $ = (id) => document.getElementById(id);
const isMobile = /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.matchMedia('(pointer:coarse)').matches);
if (!isMobile) document.body.classList.add('desktop');
$('ld-date').textContent = AS_OF;
$('asof').textContent = AS_OF;

const T0 = performance.now();
const setMsg = (m) => { $('ld-msg').textContent = m; console.log(`[boot ${((performance.now() - T0) / 1000).toFixed(1)}s] ${m}`); };
const setProg = (p) => ($('ld-fill').style.width = `${Math.round(p * 100)}%`);

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
  engine.onResize();
  const sky = new Sky(scene, renderer, manager); sky.build();

  setMsg('街路を敷設中…'); setProg(0.1); await tick();
  const mats = new Materials(manager, renderer);
  const M = mats.build();
  buildGround(scene, M, refl);

  setMsg('ビル群を建設中…'); setProg(0.16); await tick();
  const city = new City(scene, M, DISTRICTS).build();

  setMsg('ネオンと街灯を設置中…'); setProg(0.22); await tick();
  const props = new Props(scene, M, DISTRICTS).build(city);

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
  $('ticker-in').innerHTML = [...TICKER, ...TICKER].map((t) => `<span>${t}</span>`).join('');
  buildGuide();

  const controls = new Controls(camera, $('gl'), $('hud'));
  controls.pos.set(0, 0, HUB_R - 3);
  controls.yaw = 0; controls.pitch = 0.22;
  controls.update(0.016);

  const enter = $('enter');
  enter.disabled = false; enter.textContent = 'ENTER';
  enter.onclick = () => {
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

  // ---------- picking ----------
  const ray = new THREE.Raycaster();
  ray.far = 60;
  const v2 = new THREE.Vector2();
  const pickables = [...kiosks.pickables];
  controls.onTap = (x, y) => {
    if (!controls.enabled || sheetOpen()) return;
    v2.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    ray.setFromCamera(v2, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    if (hit) { openHit(hit.object.userData, hit.distance); return; }
    // screens
    const sh = ray.intersectObjects(screens.meshes, false)[0];
    if (sh && sh.distance < 140) { openDistrict(sh.object.userData.district); return; }
    // tap on ground: walk there
    const gp = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    if (gp && gp.distanceTo(camera.position) < 50) {
      controls.travelTo(gp.x, gp.z, null, { speed: 7 });
      tapMarker(gp);
    }
  };
  function openHit(u, dist) {
    if (u.kind === 'item') {
      if (dist > 9) {
        // walk up to it first, then open
        const it = DISTRICTS[u.district].items[u.item];
        approachItem(u.district, u.item, () => openItem(u.district, u.item));
      } else openItem(u.district, u.item);
    } else if (u.kind === 'district') openDistrict(u.district);
    else if (u.kind === 'top') openTop();
  }
  function approachItem(di, ki, then) {
    const it = DISTRICTS[di].items[ki];
    const p = it._pos;
    const fx = -Math.sin(p.rotY + Math.PI), fz = -Math.cos(p.rotY + Math.PI);
    // stand 3.2m in front of the panel face
    const sx = p.x + Math.sin(p.rotY) * 3.2, sz = p.z + Math.cos(p.rotY) * 3.2;
    controls.travelTo(sx, sz, { x: p.x, z: p.z, pitch: 0.12 }, { speed: 12 });
    pendingOpen = { then, t: 0 };
  }
  let pendingOpen = null;

  // tap marker ring
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.32, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2, 2.5), transparent: true, depthWrite: false }));
  marker.rotation.x = -Math.PI / 2; marker.visible = false; scene.add(marker);
  let markerT = 0;
  function tapMarker(p) { marker.position.set(p.x, 0.16, p.z); marker.visible = true; markerT = 0; }

  // ---------- sheets ----------
  function sheetOpen() { return !$('guide').classList.contains('hidden') || !$('detail').classList.contains('hidden'); }
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => $(b.dataset.close).classList.add('hidden')));
  $('btn-guide').onclick = () => { $('detail').classList.add('hidden'); $('guide').classList.toggle('hidden'); audio.blip(880); };
  $('btn-run').onclick = () => { controls.runToggle = !controls.runToggle; $('btn-run').classList.toggle('on', controls.runToggle); audio.blip(660); };
  $('btn-gyro').onclick = async () => {
    if (controls.gyro.on) { controls.disableGyro(); $('btn-gyro').classList.remove('on'); }
    else if (await controls.enableGyro()) $('btn-gyro').classList.add('on');
    audio.blip(740);
  };
  // stop touch on sheets propagating to canvas
  ['guide', 'detail'].forEach((id) => $(id).addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true }));

  function heatRow(it, d, di, ki) {
    return `<div class="d-row" data-d="${di}" data-k="${ki}"><em>${it.date}</em><b>${it.title}</b><span class="h" style="color:${d.color}">${it.heat}</span></div>`;
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
    const src = it.src ? `<div class="d-src">出典: ${it.src}</div>` : '';
    $('detail-body').innerHTML = `
      <div class="d-hero" style="background-image:url('${img}')"></div>
      <span class="d-tag" style="background:${d.color}">${d.name}</span>
      <div class="d-title">${it.title}</div>
      <div class="d-date">${it.date} ・ ${d.jp}</div>
      <div class="d-body">${it.body}</div>
      ${src}
      <div class="d-heat">HEAT<div class="bar"><i style="width:${it.heat}%;background:linear-gradient(90deg,${d.color},#fff)"></i></div>${it.heat}</div>
      <div class="d-more"><h4>MORE IN ${d.name}</h4>${d.items.map((x, k) => (k === ki ? '' : heatRow(x, d, di, k))).join('')}</div>`;
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
      <div class="d-hero" style="background-image:url('${d.img}')"></div>
      <span class="d-tag" style="background:${d.color}">${d.name}</span>
      <div class="d-title">${d.jp} ／ ${d.tagline}</div>
      <div class="d-date">${d.items.length} TRENDS ・ ${AS_OF}</div>
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
      <div class="d-hero" style="background-image:url('/img/moon_skyline.jpg')"></div>
      <span class="d-tag" style="background:#27e0ff">TOP NOW</span>
      <div class="d-title">いま一番アツいトレンド</div>
      <div class="d-date">${AS_OF}</div>
      <div class="d-more"><h4>REAL-TIME RANKING</h4>${TOP_NOW.map((t, k) => {
        const di = DISTRICTS.findIndex((d) => d.id === catToD[t.c]);
        const d = DISTRICTS[Math.max(0, di)];
        return `<div class="d-row" data-top="${Math.max(0, di)}"><em>#${k + 1}</em><b>${t.t}</b><span class="h" style="color:${d.color}">${t.heat}</span></div>`;
      }).join('')}</div>`;
    $('detail-body').querySelectorAll('[data-top]').forEach((r) => r.addEventListener('click', () => { $('detail').classList.add('hidden'); warpToDistrict(+r.dataset.top); }));
    $('guide').classList.add('hidden');
    $('detail').classList.remove('hidden');
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
    pendingOpen = { then: () => openItem(di, ki), t: 0 };
    audio.whoosh();
  }
  function warpHome() {
    controls.travelTo(0, HUB_R - 3, { x: 0, z: 0, pitch: 0.35 }, { warp: true });
    audio.whoosh();
  }

  function buildGuide() {
    const root = $('guide-list');
    root.innerHTML = `<div class="g-item g-plaza" data-home="1" style="background-image:url('/img/moon_skyline.jpg')"><i style="background:linear-gradient(90deg,#27e0ff,#ff4fd8,#ffe14f)"></i><div><b>CENTRAL PLAZA</b><small>今トレ タワー ・ TOP NOW</small></div></div>` +
      DISTRICTS.map((d, i) => {
        const top = [...d.items].sort((a, b) => b.heat - a.heat)[0];
        return `<div class="g-item" data-i="${i}" style="background-image:url('${d.img}')"><i style="background:${d.color}"></i><div><b style="color:${d.color}">${d.name}</b><small>${top.title}</small></div></div>`;
      }).join('');
    root.querySelectorAll('.g-item').forEach((el) => el.addEventListener('click', () => {
      $('guide').classList.add('hidden');
      if (el.dataset.home) warpHome(); else warpToDistrict(+el.dataset.i);
    }));
  }

  // ---------- minimap ----------
  const mm = $('minimap').getContext('2d');
  function drawMinimap() {
    const S = 240, c = S / 2, k = S / 2 / (AVE_END + 10);
    mm.clearRect(0, 0, S, S);
    mm.save();
    mm.translate(c, c);
    mm.rotate(controls.yaw);
    mm.translate(-controls.pos.x * k * 2.2, -controls.pos.z * k * 2.2);
    const kk = k * 2.2;
    mm.lineCap = 'round';
    DISTRICTS.forEach((d, i) => {
      const dir = aveDir(i);
      mm.strokeStyle = d.color; mm.globalAlpha = 0.8; mm.lineWidth = 14 * kk;
      mm.beginPath(); mm.moveTo(dir.x * PLAZA_R * kk, dir.z * PLAZA_R * kk); mm.lineTo(dir.x * AVE_END * kk, dir.z * AVE_END * kk); mm.stroke();
      mm.globalAlpha = 1;
      mm.fillStyle = '#fff';
      d.items.forEach((it) => { if (it._pos) mm.fillRect(it._pos.x * kk - 1.5, it._pos.z * kk - 1.5, 3, 3); });
    });
    mm.strokeStyle = 'rgba(160,220,255,.6)'; mm.lineWidth = (RING_OUT - HUB_R) * kk;
    mm.beginPath(); mm.arc(0, 0, (HUB_R + RING_OUT) / 2 * kk, 0, 7); mm.stroke();
    mm.fillStyle = '#27e0ff'; mm.beginPath(); mm.arc(0, 0, 5 * kk, 0, 7); mm.fill();
    mm.restore();
    // player
    mm.fillStyle = '#fff';
    mm.beginPath(); mm.moveTo(c, c - 9); mm.lineTo(c - 6, c + 6); mm.lineTo(c, c + 3); mm.lineTo(c + 6, c + 6); mm.closePath(); mm.fill();
    // FOV cone
    const g = mm.createRadialGradient(c, c, 0, c, c, 70);
    g.addColorStop(0, 'rgba(39,224,255,.35)'); g.addColorStop(1, 'rgba(39,224,255,0)');
    mm.fillStyle = g; mm.beginPath(); mm.moveTo(c, c); mm.arc(c, c, 70, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); mm.fill();
  }
  $('minimap').addEventListener('click', () => { $('guide').classList.remove('hidden'); });

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
    return { name: `${DISTRICTS[best].name} AVE.`, d: best };
  }
  const center = new THREE.Vector2(0, 0);
  let lastZone = '';
  let promptHit = null;
  function updatePrompt() {
    ray.setFromCamera(center, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    const pr = $('prompt');
    if (hit && hit.distance < 16) {
      const u = hit.object.userData;
      let t = '';
      if (u.kind === 'item') t = DISTRICTS[u.district].items[u.item].title;
      else if (u.kind === 'district') t = `${DISTRICTS[u.district].name} — ${DISTRICTS[u.district].jp}`;
      else t = 'TOP NOW — 総合ランキング';
      if (promptHit !== t) { $('prompt-t').textContent = t; promptHit = t; }
      pr.classList.remove('hidden');
      $('crosshair').classList.add('hot');
    } else {
      pr.classList.add('hidden'); promptHit = null;
      $('crosshair').classList.remove('hot');
    }
  }
  $('prompt').style.pointerEvents = 'auto';
  $('prompt').addEventListener('click', () => {
    ray.setFromCamera(center, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    if (hit) openHit(hit.object.userData, 0);
  });

  // ---------- audio (procedural: rain, city hum, blips) ----------
  const audio = makeAudio();

  // ---------- loop ----------
  let t = 0, last = performance.now(), frame = 0;
  const clockEl = $('clk');
  let lastDraw = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (QA_OFF.fps && now - lastDraw < 1000 / QA_OFF.fps) return;
    lastDraw = now;
    let dt = Math.min(QA_OFF.fps ? 0.5 : 0.05, (now - last) / 1000); last = now;
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
      const q = camera.quaternion.clone();
      camera.position.lerpVectors(introFrom, introTo, e);
      const q0 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(introFrom, new THREE.Vector3(0, 16, 0), new THREE.Vector3(0, 1, 0)));
      camera.quaternion.slerpQuaternions(q0, q, e);
    } else {
      controls.update(dt);
    }
    if (pendingOpen && !controls.travel) { const f = pendingOpen.then; pendingOpen = null; setTimeout(f, 120); }
    engine.final.uniforms.uWarp.value = controls.warpAmt || 0;

    sky.update(t, camera.position);
    refl.uniforms.uTime.value = t;
    if (!QA_OFF.screens) screens.update(t, dt, camera.position);
    kiosks.update(t, dt);
    props.update(t);
    if (marker.visible) { markerT += dt; marker.scale.setScalar(1 + markerT * 3); marker.material.opacity = Math.max(0, 1 - markerT * 1.5); if (markerT > 0.7) marker.visible = false; }

    if (!QA_OFF.refl) refl.update(scene, camera);
    engine.render(t);
    engine.adapt(dt, t);

    if (controls.enabled && frame % 3 === 0) {
      drawMinimap();
      const z = zoneAt(controls.pos.x, controls.pos.z);
      if (z.name !== lastZone) { $('zone').textContent = z.name; lastZone = z.name; audio.zone(z.d); }
      updatePrompt();
      audio.update(controls.pos, controls.vel.length());
    }
    if (frame % 30 === 0) {
      const d = new Date();
      clockEl.textContent = d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
    }
  }
  requestAnimationFrame(loop);
  // QA helper: instant teleport (x,z,yaw,pitch)
  const tp = (x, z, yaw = 0, pitch = 0.1) => { controls.travel = null; controls.warpAmt = 0; controls.pos.set(x, 0, z); controls.yaw = yaw; controls.pitch = pitch; controls.update(0.016); };
  window.__imatore = { tp, avePoint, engine, controls, scene, camera, city, screens, kiosks, warpToDistrict, warpToItem, openItem, openTop };
}

// ---------------- procedural audio ----------------
function makeAudio() {
  let ctx = null, master, rainG, humG, stepT = 0;
  const api = {
    start() {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
        // rain: filtered noise
        const len = ctx.sampleRate * 2;
        const buf = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; }
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
        rainG = ctx.createGain(); rainG.gain.value = 0.11;
        src.connect(hp).connect(lp).connect(rainG).connect(master); src.start();
        // city hum: low brown-ish noise + 2 detuned oscillators
        const src2 = ctx.createBufferSource(); src2.buffer = buf; src2.loop = true; src2.playbackRate.value = 0.25;
        const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 180;
        humG = ctx.createGain(); humG.gain.value = 0.22;
        src2.connect(lp2).connect(humG).connect(master); src2.start();
        // ambient pad
        const pad = ctx.createGain(); pad.gain.value = 0.018; pad.connect(master);
        [110, 164.8, 220.5, 329.6].forEach((f, k) => {
          const o = ctx.createOscillator(); o.type = k % 2 ? 'triangle' : 'sine'; o.frequency.value = f;
          const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + k * 0.03;
          const lg = ctx.createGain(); lg.gain.value = 1.5; lfo.connect(lg).connect(o.frequency); lfo.start();
          o.connect(pad); o.start();
        });
      } catch (e) { ctx = null; }
    },
    blip(f = 880) {
      if (!ctx) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(f * 1.5, ctx.currentTime + 0.08);
      g.gain.setValueAtTime(0.08, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      o.connect(g).connect(master); o.start(); o.stop(ctx.currentTime + 0.2);
    },
    whoosh() {
      if (!ctx) return;
      const len = ctx.sampleRate * 1.4;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((i / len) * Math.PI);
      const s = ctx.createBufferSource(); s.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
      f.frequency.setValueAtTime(300, ctx.currentTime); f.frequency.exponentialRampToValueAtTime(3000, ctx.currentTime + 0.7); f.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 1.4);
      const g = ctx.createGain(); g.gain.value = 0.35;
      s.connect(f).connect(g).connect(master); s.start();
    },
    zone(d) { if (ctx && d >= 0) api.blip(520 + d * 60); },
    update(pos, spd) {
      if (!ctx) return;
      // footsteps
      if (spd > 0.8) {
        stepT -= 0.05 * (spd / 4.2);
        if (stepT <= 0) {
          stepT = 1;
          const len = ctx.sampleRate * 0.09;
          const buf = ctx.createBuffer(1, len, ctx.sampleRate); const dd = buf.getChannelData(0);
          for (let i = 0; i < len; i++) dd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
          const s = ctx.createBufferSource(); s.buffer = buf;
          const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400 + Math.random() * 600; f.Q.value = 0.9;
          const g = ctx.createGain(); g.gain.value = 0.12;
          s.connect(f).connect(g).connect(master); s.start();
        }
      }
      const r = Math.hypot(pos.x, pos.z);
      humG.gain.value = 0.16 + 0.1 * Math.max(0, 1 - r / 60);
    },
  };
  return api;
}

boot().catch((e) => {
  console.error(e);
  setMsg('エラー: ' + e.message);
});
