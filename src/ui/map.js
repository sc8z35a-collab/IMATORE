import {
  N_AVE, HUB_R, RING_IN, RING_OUT, PLAZA_R, AVE_END, AVE_HALF, ROAD_HALF, EDGE, aveDir, avePoint, edgePoint,
} from '../world/layout.js';
import { LANDMARKS, CLUSTERS, EXPRESS_R, RAIL_R, waterDepth } from '../world/landscape.js';

// ============================================================================================
//  Map renewal
//   * MiniMap  — rounded-square HUD map, heading-up, pre-rendered static layer (cheap per frame):
//                glowing district avenues, kiosk pins, platform outline, compass ring with N / landmark
//                bearings on the bezel, FOV cone, current-zone chip.
//   * FullMap  — sheet with two scales: HUB (the walkable platform, district labels, kiosks, terraces)
//                and AREA (the ~6 km landscape: bay, river, expressway, loop line, landmarks, clusters).
//                North-up, pinch/drag free; tap a district to warp, tap a landmark to warp to the terrace
//                that faces it (camera turns toward the landmark).
// ============================================================================================

const TAU = Math.PI * 2;
const FONT = '"Noto Sans JP", system-ui, sans-serif';
const OR = 'Orbitron, "Noto Sans JP", sans-serif';

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function octagon(g, r, k = 1) {
  g.beginPath();
  for (let i = 0; i <= N_AVE; i++) { const p = edgePoint(i % N_AVE); i ? g.lineTo(p.x * k * r / EDGE, p.z * k * r / EDGE) : g.moveTo(p.x * k * r / EDGE, p.z * k * r / EDGE); }
  g.closePath();
}

// ---- static HUB layer in world units, drawn into a canvas at scale s (px per metre) ----
function drawHub(g, districts, s, { labels = false, detail = false, t = 0 } = {}) {
  g.save();
  g.scale(s, s);
  const px = 1 / s;
  // platform deck with subtle radial gradient
  const grd = g.createRadialGradient(0, 0, 10, 0, 0, EDGE);
  grd.addColorStop(0, 'rgba(40,60,110,.55)'); grd.addColorStop(1, 'rgba(16,22,44,.7)');
  octagon(g, EDGE); g.fillStyle = grd; g.fill();
  g.lineWidth = 2.2 * px; g.strokeStyle = 'rgba(160,230,255,.85)'; g.stroke();
  // district wedges tinted by colour (very faint) so the map reads as 8 zones
  districts.forEach((d, i) => {
    const a0 = -Math.PI / 2 + ((i - 0.5) / N_AVE) * TAU, a1 = -Math.PI / 2 + ((i + 0.5) / N_AVE) * TAU;
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, EDGE * 0.98, a0, a1); g.closePath();
    g.fillStyle = d.color; g.globalAlpha = 0.07; g.fill(); g.globalAlpha = 1;
  });
  // building blocks between avenues (dark)
  g.fillStyle = 'rgba(4,6,14,.72)';
  for (let i = 0; i < N_AVE; i++) {
    const j = (i + 1) % N_AVE;
    const pts = [avePoint(i, PLAZA_R + 1, AVE_HALF), avePoint(i, AVE_END, AVE_HALF), avePoint(j, AVE_END, -AVE_HALF), avePoint(j, PLAZA_R + 1, -AVE_HALF)];
    g.beginPath(); pts.forEach((p, k) => (k ? g.lineTo(p.x, p.z) : g.moveTo(p.x, p.z))); g.closePath(); g.fill();
  }
  // avenues: glowing coloured bands
  g.lineCap = 'round';
  districts.forEach((d, i) => {
    const a = avePoint(i, RING_OUT, 0), b = avePoint(i, EDGE - 2, 0);
    g.strokeStyle = d.color;
    g.shadowColor = d.color; g.shadowBlur = 10;
    g.globalAlpha = 0.9; g.lineWidth = AVE_HALF * 1.7;
    g.beginPath(); g.moveTo(a.x, a.z); g.lineTo(b.x, b.z); g.stroke();
    g.shadowBlur = 0; g.globalAlpha = 1;
    // centre line
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1.1 * px; g.setLineDash([6 * px, 6 * px]);
    g.beginPath(); g.moveTo(a.x, a.z); g.lineTo(b.x, b.z); g.stroke(); g.setLineDash([]);
    // terrace chevron
    const t0 = avePoint(i, AVE_END + 6, -5), t1 = avePoint(i, EDGE - 1, 0), t2 = avePoint(i, AVE_END + 6, 5);
    g.strokeStyle = '#bff4ff'; g.lineWidth = 1.6 * px;
    g.beginPath(); g.moveTo(t0.x, t0.z); g.lineTo(t1.x, t1.z); g.lineTo(t2.x, t2.z); g.stroke();
    // kiosks
    g.fillStyle = '#ffffff';
    d.items.forEach((it) => { if (it._pos) { g.beginPath(); g.arc(it._pos.x, it._pos.z, (detail ? 1.7 : 1.4), 0, TAU); g.fill(); } });
  });
  // ring road + hub
  g.lineWidth = (RING_OUT - RING_IN); g.strokeStyle = 'rgba(20,26,40,.95)';
  g.beginPath(); g.arc(0, 0, (RING_IN + RING_OUT) / 2, 0, TAU); g.stroke();
  g.lineWidth = 1 * px; g.strokeStyle = 'rgba(255,220,140,.6)'; g.setLineDash([4 * px, 4 * px]);
  g.beginPath(); g.arc(0, 0, (RING_IN + RING_OUT) / 2, 0, TAU); g.stroke(); g.setLineDash([]);
  const hg = g.createRadialGradient(0, 0, 2, 0, 0, HUB_R);
  hg.addColorStop(0, 'rgba(39,224,255,.9)'); hg.addColorStop(0.3, 'rgba(39,224,255,.25)'); hg.addColorStop(1, 'rgba(60,80,140,.4)');
  g.fillStyle = hg; g.beginPath(); g.arc(0, 0, HUB_R, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(160,230,255,.7)'; g.lineWidth = 1.2 * px; g.stroke();
  // tower glyph
  g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, 4.5, 0, TAU); g.fill();
  g.strokeStyle = '#27e0ff'; g.lineWidth = 1.6 * px; g.beginPath(); g.arc(0, 0, 7.5, 0, TAU); g.stroke();
  if (labels) {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    districts.forEach((d, i) => {
      const p = avePoint(i, 118, 0);
      const ang = Math.atan2(p.z, p.x);
      g.save(); g.translate(p.x, p.z);
      let rot = ang; if (Math.cos(rot) < -0.01) rot += Math.PI; // keep text upright
      g.rotate(rot);
      g.font = `900 ${13 * px}px ${OR}`;
      const w = g.measureText(d.name).width + 14 * px;
      roundRect(g, -w / 2, -9 * px, w, 18 * px, 9 * px);
      g.fillStyle = 'rgba(4,8,20,.8)'; g.fill(); g.strokeStyle = d.color; g.lineWidth = 1.2 * px; g.stroke();
      g.fillStyle = d.color; g.fillText(d.name, 0, 0.5 * px);
      g.restore();
      const q = avePoint(i, 146, 0);
      g.font = `700 ${10 * px}px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.8)';
      g.fillText(d.jp, q.x, q.z);
    });
    g.font = `900 ${11 * px}px ${OR}`; g.fillStyle = '#e8fbff';
    g.fillText('CENTRAL PLAZA', 0, HUB_R + 12 * px);
  }
  g.restore();
}

// ---- AREA layer (bay, expressway, rail, landmarks) ----
function drawArea(g, s, R) {
  g.save(); g.scale(s, s);
  const px = 1 / s;
  // land: dark with a soft city-glow blob
  const bg = g.createRadialGradient(0, 0, 50, 0, 0, R);
  bg.addColorStop(0, '#1b1f38'); bg.addColorStop(0.5, '#111428'); bg.addColorStop(1, '#090a14');
  g.fillStyle = bg; g.fillRect(-R, -R, R * 2, R * 2);
  // bay: rasterise the coast function coarsely into a path
  g.beginPath();
  const step = R / 90;
  for (let x = -R; x <= R; x += step) {
    // find the coast along +z for this x
    let z = -R; while (z < R && waterDepth(x, z) <= 0) z += step;
    x === -R ? g.moveTo(x, z) : g.lineTo(x, z);
  }
  g.lineTo(R, R); g.lineTo(-R, R); g.closePath();
  const wg = g.createLinearGradient(0, 600, 0, R);
  wg.addColorStop(0, '#0d2f4e'); wg.addColorStop(1, '#061626');
  g.fillStyle = wg; g.fill();
  g.strokeStyle = 'rgba(120,200,255,.55)'; g.lineWidth = 1.4 * px; g.stroke();
  // clusters glow
  for (const c of CLUSTERS) {
    const cg = g.createRadialGradient(c.x, c.z, 0, c.x, c.z, c.s * 1.6);
    cg.addColorStop(0, 'rgba(255,190,120,.32)'); cg.addColorStop(1, 'rgba(255,190,120,0)');
    g.fillStyle = cg; g.beginPath(); g.arc(c.x, c.z, c.s * 1.6, 0, TAU); g.fill();
  }
  // street grid hint
  g.strokeStyle = 'rgba(255,200,140,.07)'; g.lineWidth = 1 * px;
  for (let v = -R; v <= R; v += 290) { g.beginPath(); g.moveTo(v, -R); g.lineTo(v, R); g.stroke(); g.beginPath(); g.moveTo(-R, v); g.lineTo(R, v); g.stroke(); }
  // expressway (amber) + loop line (green)
  g.lineWidth = 7 * px; g.strokeStyle = 'rgba(255,170,60,.85)';
  g.beginPath(); g.arc(0, 0, EXPRESS_R, 0, TAU); g.stroke();
  g.lineWidth = 4 * px; g.strokeStyle = 'rgba(120,230,120,.9)'; g.setLineDash([10 * px, 5 * px]);
  g.beginPath(); g.arc(0, 0, RAIL_R, 0, TAU); g.stroke(); g.setLineDash([]);
  g.restore();
}

export class MapUI {
  constructor({ districts, mini, full, onWarpDistrict, onWarpLandmark, onWarpHome }) {
    this.districts = districts;
    this.mini = mini; this.full = full;
    this.onWarpDistrict = onWarpDistrict; this.onWarpLandmark = onWarpLandmark; this.onWarpHome = onWarpHome;
    this.mode = 'hub';
    this.view = { x: 0, z: 0, s: 1 };
    this._bindFull();
  }

  // pre-render the static minimap layer once (hub in world units, 2x oversize so heading rotation never clips)
  prepare() {
    const S = 640;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    g.translate(S / 2, S / 2);
    drawHub(g, this.districts, (S / 2) / (EDGE + 16), { detail: false });
    this.miniLayer = c; this.miniScale = (S / 2) / (EDGE + 16);
    // area layer for the minimap outside the platform (very faint)
    const A = document.createElement('canvas'); A.width = A.height = 512;
    const ga = A.getContext('2d'); ga.translate(256, 256); drawArea(ga, 256 / 1600, 1600);
    this.areaLayer = A; this.areaScale = 256 / 1600;
  }

  // ---------------- minimap (called every few frames) ----------------
  drawMini(pos, yaw, zone) {
    const cv = this.mini, g = cv.getContext('2d');
    const W = cv.width, H = cv.height, cx = W / 2, cy = H / 2;
    const zoom = 2.3; // px per metre on the minimap backing store
    g.clearRect(0, 0, W, H);
    g.save();
    roundRect(g, 3, 3, W - 6, H - 6, 34); g.clip();
    g.fillStyle = 'rgba(5,8,18,.82)'; g.fillRect(0, 0, W, H);
    g.translate(cx, cy);
    g.rotate(yaw);
    // area underlay (visible when standing on a terrace)
    const ka = zoom / this.areaScale;
    g.globalAlpha = 0.9;
    g.drawImage(this.areaLayer, -pos.x * zoom - 256 * ka, -pos.z * zoom - 256 * ka, 512 * ka, 512 * ka);
    g.globalAlpha = 1;
    const k = zoom / this.miniScale;
    const S = this.miniLayer.width;
    g.drawImage(this.miniLayer, -pos.x * zoom - (S / 2) * k, -pos.z * zoom - (S / 2) * k, S * k, S * k);
    g.restore();
    // FOV cone + player arrow (heading up)
    const fg = g.createRadialGradient(cx, cy, 0, cx, cy, 86);
    fg.addColorStop(0, 'rgba(39,224,255,.42)'); fg.addColorStop(1, 'rgba(39,224,255,0)');
    g.fillStyle = fg; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, 86, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); g.closePath(); g.fill();
    g.save(); g.translate(cx, cy);
    g.shadowColor = '#27e0ff'; g.shadowBlur = 10;
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -11); g.lineTo(-8, 8); g.lineTo(0, 4); g.lineTo(8, 8); g.closePath(); g.fill();
    g.restore();
    // bezel: compass ring with N + landmark bearings
    g.save(); g.translate(cx, cy);
    const rB = W / 2 - 14;
    g.strokeStyle = 'rgba(160,220,255,.35)'; g.lineWidth = 1.5;
    for (let k2 = 0; k2 < 36; k2++) {
      const a = (k2 / 36) * TAU + yaw;
      const L = k2 % 9 === 0 ? 9 : 4;
      g.beginPath(); g.moveTo(Math.sin(a) * (rB + 8), -Math.cos(a) * (rB + 8)); g.lineTo(Math.sin(a) * (rB + 8 - L), -Math.cos(a) * (rB + 8 - L)); g.stroke();
    }
    // North: world −Z. Bearing of a world direction (dx,dz) on screen: angle = atan2(dx, -dz) + yaw
    const mark = (dx, dz, label, col, big) => {
      const a = Math.atan2(dx, -dz) + yaw;
      const x = Math.sin(a) * (rB - 6), y = -Math.cos(a) * (rB - 6);
      g.font = `${big ? 900 : 700} ${big ? 17 : 12}px ${big ? OR : FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(label, x, y);
      g.fillStyle = col; g.fillText(label, x, y);
    };
    mark(0, -1, 'N', '#ff5a5a', true);
    for (const key of ['skytree', 'lattice', 'wheel', 'fuji']) {
      const L = LANDMARKS[key];
      const icon = { skytree: '▲', lattice: '◆', wheel: '◎', fuji: '⛰' }[key];
      mark(L.x - pos.x, L.z - pos.z, icon, key === 'lattice' ? '#ff9a3c' : key === 'skytree' ? '#9fd8ff' : key === 'wheel' ? '#ff8cf0' : '#dfe8ff', false);
    }
    g.restore();
    // frame
    g.strokeStyle = 'rgba(160,220,255,.5)'; g.lineWidth = 2; roundRect(g, 3, 3, W - 6, H - 6, 34); g.stroke();
    // zone chip
    if (zone) {
      g.font = `900 15px ${OR}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      const tw = g.measureText(zone.label).width + 22;
      roundRect(g, cx - tw / 2, H - 34, tw, 22, 11);
      g.fillStyle = 'rgba(4,8,20,.85)'; g.fill(); g.strokeStyle = zone.color; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = zone.color; g.fillText(zone.label, cx, H - 22.5);
    }
  }

  // ---------------- full map sheet ----------------
  open(pos, yaw) {
    this.player = { x: pos.x, z: pos.z, yaw };
    this.view = this.mode === 'hub' ? { x: 0, z: 0, s: 1 } : { x: 0, z: 400, s: 1 };
    this.resize();
    this.drawFull();
  }
  setMode(m) { this.mode = m; this.view = m === 'hub' ? { x: 0, z: 0, s: 1 } : { x: 0, z: 400, s: 1 }; this.drawFull(); }
  resize() {
    const cv = this.full, r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.max(10, Math.round(r.width * dpr)); cv.height = Math.max(10, Math.round(r.height * dpr));
    this.dpr = dpr;
  }
  baseScale() {
    const cv = this.full, m = Math.min(cv.width, cv.height);
    return this.mode === 'hub' ? (m * 0.47) / EDGE : (m * 0.47) / 2600;
  }
  worldToScreen(x, z) {
    const cv = this.full, s = this.baseScale() * this.view.s;
    return { x: cv.width / 2 + (x - this.view.x) * s, y: cv.height / 2 + (z - this.view.z) * s };
  }
  screenToWorld(px, py) {
    const cv = this.full, s = this.baseScale() * this.view.s;
    return { x: (px - cv.width / 2) / s + this.view.x, z: (py - cv.height / 2) / s + this.view.z };
  }
  drawFull(t = performance.now() / 1000) {
    const cv = this.full, g = cv.getContext('2d');
    const W = cv.width, H = cv.height, s = this.baseScale() * this.view.s, d = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#070912'; g.fillRect(0, 0, W, H);
    g.save();
    g.translate(W / 2 - this.view.x * s, H / 2 - this.view.z * s);
    if (this.mode === 'area') {
      drawArea(g, s, 3200);
      // platform (mini version) + labels
      drawHub(g, this.districts, s, { labels: false });
      g.save(); g.scale(s, s);
      const px = 1 / s;
      // landmarks
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const lm = [['skytree', '▲', '東京スカイツリー風 634m', '#9fd8ff'], ['lattice', '◆', '東京タワー風 333m', '#ff9a3c'], ['wheel', '◎', '大観覧車', '#ff8cf0'], ['fuji', '⛰', '富士山 (遠景)', '#dfe8ff']];
      this.hits = [];
      for (const [key, icon, name, col] of lm) {
        const L = LANDMARKS[key];
        let x = L.x, z = L.z;
        // off-map landmarks are pinned to the edge in their bearing
        const lim = 3000;
        const out = Math.max(Math.abs(x), Math.abs(z)) > lim;
        if (out) { const k = lim / Math.max(Math.abs(x), Math.abs(z)); x *= k; z *= k; }
        g.shadowColor = col; g.shadowBlur = 16;
        g.font = `900 ${26 * d * px}px ${FONT}`; g.fillStyle = col; g.fillText(icon, x, z);
        g.shadowBlur = 0;
        g.font = `700 ${12 * d * px}px ${FONT}`; g.fillStyle = '#fff';
        g.lineWidth = 3 * d * px; g.strokeStyle = 'rgba(0,0,0,.8)';
        g.strokeText(name + (out ? ' →' : ''), x, z + 22 * d * px); g.fillText(name + (out ? ' →' : ''), x, z + 22 * d * px);
        this.hits.push({ kind: 'landmark', key, x, z, r: 40 * d * px });
      }
      for (const c of CLUSTERS) {
        g.font = `700 ${11 * d * px}px ${FONT}`; g.fillStyle = 'rgba(255,220,170,.85)';
        g.fillText(c.name, c.x, c.z);
      }
      g.font = `900 ${12 * d * px}px ${OR}`; g.fillStyle = 'rgba(140,210,255,.85)';
      g.fillText('TOKYO BAY', 0, 1900);
      g.font = `700 ${10 * d * px}px ${FONT}`; g.fillStyle = 'rgba(255,190,110,.9)';
      g.fillText('首都高速 環状線', EXPRESS_R * 0.7, -EXPRESS_R * 0.72);
      g.fillStyle = 'rgba(150,240,150,.9)';
      g.fillText('環状鉄道', -RAIL_R * 0.72, -RAIL_R * 0.7);
      g.restore();
    } else {
      drawHub(g, this.districts, s, { labels: true, detail: true, t });
      this.hits = this.districts.map((dd, i) => { const p = avePoint(i, 118, 0); return { kind: 'district', i, x: p.x, z: p.z, r: 26 / this.view.s }; });
      this.hits.push({ kind: 'home', x: 0, z: 0, r: HUB_R });
    }
    // player
    if (this.player) {
      const p = this.player;
      g.save(); g.translate(p.x * s, p.z * s); g.rotate(-p.yaw);
      const fg = g.createRadialGradient(0, 0, 0, 0, 0, 60 * d);
      fg.addColorStop(0, 'rgba(39,224,255,.5)'); fg.addColorStop(1, 'rgba(39,224,255,0)');
      g.fillStyle = fg; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 60 * d, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); g.closePath(); g.fill();
      const pulse = 1 + 0.25 * Math.sin(t * 4);
      g.strokeStyle = 'rgba(39,224,255,.8)'; g.lineWidth = 2 * d; g.beginPath(); g.arc(0, 0, 11 * d * pulse, 0, TAU); g.stroke();
      g.fillStyle = '#fff'; g.shadowColor = '#27e0ff'; g.shadowBlur = 12;
      g.beginPath(); g.moveTo(0, -10 * d); g.lineTo(-7 * d, 7 * d); g.lineTo(0, 3.5 * d); g.lineTo(7 * d, 7 * d); g.closePath(); g.fill();
      g.restore();
    }
    g.restore();
    // compass + scale bar
    g.save();
    g.translate(W - 34 * d, 34 * d);
    g.fillStyle = 'rgba(4,8,20,.75)'; g.beginPath(); g.arc(0, 0, 22 * d, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(160,220,255,.5)'; g.lineWidth = 1.2 * d; g.stroke();
    g.fillStyle = '#ff5a5a'; g.beginPath(); g.moveTo(0, -16 * d); g.lineTo(-5 * d, 0); g.lineTo(5 * d, 0); g.closePath(); g.fill();
    g.fillStyle = '#dde'; g.beginPath(); g.moveTo(0, 16 * d); g.lineTo(-5 * d, 0); g.lineTo(5 * d, 0); g.closePath(); g.fill();
    g.font = `900 ${9 * d}px ${OR}`; g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText('N', 0, -25 * d);
    g.restore();
    const target = 110 * d / s; // metres represented by ~110 css px
    const nice = [10, 20, 50, 100, 200, 500, 1000, 2000].find((v) => v >= target * 0.6) || 2000;
    const bw = nice * s;
    g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(16 * d, H - 22 * d, bw, 3 * d);
    g.fillRect(16 * d, H - 28 * d, 2 * d, 9 * d); g.fillRect(16 * d + bw - 2 * d, H - 28 * d, 2 * d, 9 * d);
    g.font = `700 ${10 * d}px ${OR}`; g.textAlign = 'left'; g.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, 16 * d, H - 34 * d);
  }

  _bindFull() {
    const cv = this.full;
    if (!cv) return;
    const pts = new Map();
    let moved = 0, pinch0 = null;
    const local = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * this.dpr, y: (e.clientY - r.top) * this.dpr }; };
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, local(e)); moved = 0; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), s: this.view.s }; } });
    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = local(e), q = pts.get(e.pointerId);
      const s = this.baseScale() * this.view.s;
      if (pts.size === 1) { this.view.x -= (p.x - q.x) / s; this.view.z -= (p.y - q.y) / s; moved += Math.abs(p.x - q.x) + Math.abs(p.y - q.y); }
      pts.set(e.pointerId, p);
      if (pts.size === 2 && pinch0) { const [a, b] = [...pts.values()]; this.view.s = Math.max(0.6, Math.min(6, pinch0.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch0.d)); moved += 99; }
      this.drawFull();
    });
    const up = (e) => {
      const p = pts.get(e.pointerId); pts.delete(e.pointerId); if (pts.size < 2) pinch0 = null;
      if (!p || moved > 10 * this.dpr || e.type === 'pointercancel') return;
      const w = this.screenToWorld(p.x, p.y);
      let best = null, bd = 1e9;
      for (const h of this.hits || []) { const dd = Math.hypot(h.x - w.x, h.z - w.z); if (dd < h.r && dd < bd) { bd = dd; best = h; } }
      if (!best) return;
      if (best.kind === 'district') this.onWarpDistrict?.(best.i);
      else if (best.kind === 'landmark') this.onWarpLandmark?.(best.key);
      else if (best.kind === 'home') this.onWarpHome?.();
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.view.s = Math.max(0.6, Math.min(6, this.view.s * Math.exp(-e.deltaY * 0.0015))); this.drawFull(); }, { passive: false });
  }
}

// which avenue terrace faces a landmark best (for "warp to the view")
export function terraceFor(key) {
  const L = LANDMARKS[key];
  const a = Math.atan2(L.z, L.x);
  let best = 0, bd = 1e9;
  for (let i = 0; i < N_AVE; i++) { const d = aveDir(i); const da = Math.abs(Math.atan2(Math.sin(a - Math.atan2(d.z, d.x)), Math.cos(a - Math.atan2(d.z, d.x)))); if (da < bd) { bd = da; best = i; } }
  return best;
}
void ROAD_HALF;
