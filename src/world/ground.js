import * as THREE from 'three';
import { Batch, worldUV, box, mat } from './geo.js';
import {
  HUB_R, RING_IN, RING_OUT, PLAZA_R, AVE_END, ROAD_HALF, N_AVE, CURB, aveDir, aveAngle, avePoint,
} from './layout.js';

const FAR = 320;

// intersection of avenue-i line at lateral s with circle radius r -> along distance
function alongAt(r, s) { return Math.sqrt(Math.max(0, r * r - s * s)); }

// pavement wedge between avenue i (right road edge) and avenue i+1 (left road edge)
function wedgeShape(i) {
  const j = (i + 1) % N_AVE;
  const pts = [];
  const a0 = alongAt(RING_OUT, ROAD_HALF);
  // along avenue i right edge from ring to far
  const p0 = avePoint(i, a0, ROAD_HALF);
  const p1 = avePoint(i, FAR, ROAD_HALF);
  const p2 = avePoint(j, FAR, -ROAD_HALF);
  const p3 = avePoint(j, a0, -ROAD_HALF);
  pts.push(p0, p1, p2, p3);
  // arc back from p3 to p0 along r = RING_OUT
  const t3 = Math.atan2(p3.z, p3.x), t0 = Math.atan2(p0.z, p0.x);
  let dt = t0 - t3; while (dt > 0) dt -= Math.PI * 2;
  const n = 18;
  for (let k = 1; k < n; k++) {
    const t = t3 + (dt * k) / n;
    pts.push({ x: Math.cos(t) * RING_OUT, z: Math.sin(t) * RING_OUT });
  }
  return pts;
}

function flatPoly(pts, y) {
  // Shape in XY with y := -z so that after rotateX(-90°) we're back at +z
  const sh = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
  const g = new THREE.ShapeGeometry(sh);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

// vertical curb face + curbstone along a polyline (points in order), facing left of travel
function curbAlong(batch, pts, closed = false) {
  const n = closed ? pts.length : pts.length - 1;
  for (let k = 0; k < n; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const L = Math.hypot(dx, dz);
    if (L < 1e-3) continue;
    const ry = Math.atan2(dx, dz) - Math.PI / 2;
    const g = box(L, CURB + 0.02, 0.3, { su: 1 / 1.2, sv: 1 / 1.2 });
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
    batch.add('curb', g, mat(cx, -0.02, cz, ry));
  }
}

export function buildGround(scene, M, refl) {
  const b = new Batch();

  // hub (raised)
  const hub = new THREE.CircleGeometry(HUB_R, 96);
  hub.rotateX(-Math.PI / 2); hub.translate(0, CURB, 0);
  b.add('plaza', worldUV(hub, 3.2));
  const hubCurb = [];
  for (let k = 0; k < 96; k++) { const t = (k / 96) * Math.PI * 2; hubCurb.push({ x: Math.cos(t) * HUB_R, z: Math.sin(t) * HUB_R }); }
  curbAlong(b, hubCurb, true);

  // ring road
  const ring = new THREE.RingGeometry(RING_IN, RING_OUT, 128, 1);
  ring.rotateX(-Math.PI / 2);
  b.add('asphalt', worldUV(ring, 7));

  // wedges (all pavement at curb height; buildings stand on them)
  for (let i = 0; i < N_AVE; i++) {
    const pts = wedgeShape(i);
    const g = flatPoly(pts, CURB);
    b.add('pavers', worldUV(g, 2.6, aveAngle(i)));
    // curb along road edge i, ring arc, road edge j
    const j = (i + 1) % N_AVE;
    curbAlong(b, [pts[0], pts[1]]);
    curbAlong(b, [pts[2], pts[3], ...pts.slice(4), pts[0]]);
  }

  // avenue road surfaces (level 0) from ring to AVE_END, then pavement cap
  for (let i = 0; i < N_AVE; i++) {
    const d = aveDir(i);
    const a0 = RING_OUT - 1.5;
    const g = new THREE.PlaneGeometry(ROAD_HALF * 2, AVE_END - a0);
    g.rotateX(-Math.PI / 2);
    const c = avePoint(i, (a0 + AVE_END) / 2, 0);
    g.rotateY(Math.atan2(d.x, d.z));
    g.translate(c.x, 0, c.z);
    b.add('asphalt', worldUV(g, 7, aveAngle(i)));
    // cap
    const cap = new THREE.PlaneGeometry(ROAD_HALF * 2 + 0.2, FAR - AVE_END);
    cap.rotateX(-Math.PI / 2);
    const cc = avePoint(i, (AVE_END + FAR) / 2, 0);
    cap.rotateY(Math.atan2(d.x, d.z));
    cap.translate(cc.x, CURB, cc.z);
    b.add('pavers', worldUV(cap, 2.6, aveAngle(i)));
    curbAlong(b, [avePoint(i, AVE_END, -ROAD_HALF), avePoint(i, AVE_END, ROAD_HALF)]);
  }

  // ---- road markings ----
  const Y = 0.012;
  // ring: dashed centre, solid edges
  const ringLine = (r, w, dash, key) => {
    if (!dash) {
      const g = new THREE.RingGeometry(r - w / 2, r + w / 2, 160, 1);
      g.rotateX(-Math.PI / 2); g.translate(0, Y, 0);
      b.add(key, g);
      return;
    }
    const n = Math.round((2 * Math.PI * r) / dash);
    for (let k = 0; k < n; k += 2) {
      const t0 = (k / n) * Math.PI * 2, t1 = ((k + 1) / n) * Math.PI * 2;
      const g = new THREE.RingGeometry(r - w / 2, r + w / 2, 3, 1, t0, t1 - t0);
      g.rotateX(-Math.PI / 2); g.translate(0, Y, 0);
      b.add(key, g);
    }
  };
  ringLine((RING_IN + RING_OUT) / 2, 0.15, 3.2, 'lineWhite');
  ringLine(RING_IN + 0.45, 0.15, 0, 'lineWhite');
  ringLine(RING_OUT - 0.45, 0.15, 0, 'lineWhite');

  for (let i = 0; i < N_AVE; i++) {
    const ang = aveAngle(i);
    const ry = -ang - Math.PI / 2; // local +Z -> avenue direction
    // zebra crossing over the ring road, aligned with avenue
    for (let s = -ROAD_HALF + 0.7; s <= ROAD_HALF - 0.6; s += 0.9) {
      const g = new THREE.PlaneGeometry(0.45, RING_OUT - RING_IN - 1.6);
      g.rotateX(-Math.PI / 2);
      const p = avePoint(i, (RING_IN + RING_OUT) / 2, s);
      g.rotateY(Math.atan2(aveDir(i).x, aveDir(i).z));
      g.translate(p.x, Y + 0.002, p.z);
      b.add('lineWhite', g);
    }
    // avenue: dashed centre & solid edge lines (hokoten on a real street)
    const d = aveDir(i);
    const rot = Math.atan2(d.x, d.z);
    for (let a = RING_OUT + 2; a < AVE_END - 3; a += 6) {
      const g = new THREE.PlaneGeometry(0.14, 3);
      g.rotateX(-Math.PI / 2); g.rotateY(rot);
      const p = avePoint(i, a + 1.5, 0);
      g.translate(p.x, Y, p.z);
      b.add('lineWhite', g);
    }
    for (const s of [-ROAD_HALF + 0.35, ROAD_HALF - 0.35]) {
      const L = AVE_END - RING_OUT - 2;
      const g = new THREE.PlaneGeometry(0.14, L);
      g.rotateX(-Math.PI / 2); g.rotateY(rot);
      const p = avePoint(i, RING_OUT + 1 + L / 2, s);
      g.translate(p.x, Y, p.z);
      b.add('lineYellow', g);
    }
    // stop line + "止まれ"-ish arrow stripes near the ring
    {
      const g = new THREE.PlaneGeometry(ROAD_HALF * 2 - 0.8, 0.4);
      g.rotateX(-Math.PI / 2); g.rotateY(rot);
      const p = avePoint(i, RING_OUT + 1.2, 0);
      g.translate(p.x, Y, p.z);
      b.add('lineWhite', g);
    }
    // tactile paving (yellow blocks) along sidewalks
    for (const s of [-(ROAD_HALF + 1.4), ROAD_HALF + 1.4]) {
      const L = AVE_END - PLAZA_R - 4;
      const g = new THREE.PlaneGeometry(0.3, L);
      g.rotateX(-Math.PI / 2); g.rotateY(rot);
      const p = avePoint(i, PLAZA_R + 2 + L / 2, s);
      g.translate(p.x, CURB + 0.006, p.z);
      b.add('tactile', g);
    }
  }
  // tactile ring around hub
  {
    const g = new THREE.RingGeometry(HUB_R - 1.1, HUB_R - 0.8, 128);
    g.rotateX(-Math.PI / 2); g.translate(0, CURB + 0.006, 0);
    b.add('tactile', g);
  }

  const mats = {
    plaza: M.plaza, asphalt: M.asphalt, pavers: M.pavers, curb: M.curb,
    lineWhite: M.lineWhite, lineYellow: M.lineYellow,
    tactile: M.tactile || (M.tactile = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
  };
  if (refl) {
    refl.patch(M.asphalt, { wet: 0.95, puddle: 0.62 });
    refl.patch(M.pavers, { wet: 0.7, puddle: 0.35 });
    refl.patch(M.plaza, { wet: 0.8, puddle: 0.45 });
    refl.patch(M.lineWhite, { wet: 0.6, puddle: 0.3 });
    refl.patch(M.lineYellow, { wet: 0.6, puddle: 0.3 });
    refl.patch(mats.tactile, { wet: 0.6, puddle: 0.2 });
  }
  const out = b.build(mats, scene, { shadows: { plaza: { receive: true }, asphalt: { receive: true }, pavers: { receive: true }, curb: { receive: true } } });
  return out;
}
