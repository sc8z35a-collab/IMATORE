import * as THREE from 'three';
import { Batch, box, quad, mat } from './geo.js';
import { rng, signAtlas, shopAtlas } from './textures.js';
import {
  PLAZA_R, TIP_END, AVE_HALF, AVE_END, ROAD_HALF, N_AVE, CURB, TAN_HALF, aveDir, aveAngle, avePoint,
} from './layout.js';
import { glow } from './materials.js';

const CELL_W = 3.2, FLOOR_H = 3.6, GF = 4.6; // facade grid & ground floor height
const SU = 1 / (8 * CELL_W), SV = 1 / (8 * FLOOR_H);

// yaw that maps local +Z (front) to world vector (fx,fz)
const yawFor = (fx, fz) => Math.atan2(fx, fz);

// Build a prism from a CCW (seen from above) footprint, walls UV'd with facade grid.
function prismWalls(batch, key, pts, y0, y1, uOff = 0) {
  let u = uOff;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L < 0.01) continue;
    const g = new THREE.BufferGeometry();
    const P = [a.x, y0, a.z, b.x, y0, b.z, b.x, y1, b.z, a.x, y0, a.z, b.x, y1, b.z, a.x, y1, a.z];
    const U = [u, y0, u + L, y0, u + L, y1, u, y0, u + L, y1, u, y1].map((v, i) => (i % 2 ? v * SV : v * SU));
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.computeVertexNormals();
    batch.add(key, g);
    u += L;
  }
}
function capPoly(batch, key, pts, y) {
  const sh = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
  const g = new THREE.ShapeGeometry(sh);
  g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
  batch.add(key, g);
}

export class City {
  constructor(scene, M, districts) {
    this.scene = scene; this.M = M; this.districts = districts;
    this.group = new THREE.Group();
    this.group.name = 'city';
    scene.add(this.group);
    this.screens = [];      // big LED screen anchors {center, yaw, w, h, district}
    this.spill = [];        // neon light pools on ground {x,z,color,size}
    this.lampPos = [];
    this.buildingBoxes = [];
    this.R = rng(2026);
  }

  build() {
    const b = new Batch();
    const signs = signAtlas(7);
    const shops = shopAtlas(3);
    this.signAtlas = signs; this.shopAtlas = shops;
    for (let i = 0; i < N_AVE; i++) {
      this.buildTip(b, i);
      for (const side of [-1, 1]) this.buildRow(b, i, side, signs, shops);
      this.buildEndLandmark(b, i);
    }
    this.buildSkyline(b);

    const M = this.M;
    const mats = {
      roof: M.roof, roofProps: M.roofProps, metalDark: M.metalDark, metal: M.metal, glassRail: M.glass,
      shop: new THREE.MeshBasicMaterial({ map: shops.tex, color: new THREE.Color(1.25, 1.25, 1.25) }),
      sign: new THREE.MeshBasicMaterial({ map: signs.tex, color: new THREE.Color(1.6, 1.6, 1.6) }),
      signBack: new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.6, metalness: 0.5 }),
      awning: new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }),
      awningRed: new THREE.MeshStandardMaterial({ color: 0x7a1016, roughness: 0.7, side: THREE.DoubleSide }),
      ac: new THREE.MeshStandardMaterial({ color: 0xc9cbc6, roughness: 0.55, metalness: 0.2 }),
      redLight: glow(0xff2020, 6),
      whiteLight: glow(0xffffff, 3),
      stripCyan: glow(0x27e0ff, 4), stripPink: glow(0xff3fbf, 4), stripAmber: glow(0xffb040, 4),
      screenOff: new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.3, metalness: 0.4 }),
    };
    M.facades.forEach((m, k) => (mats['f' + k] = m));
    mats.fc = M.facadeConcrete;
    const out = b.build(mats, this.group, {
      shadows: {
        f0: { cast: true, receive: true }, f1: { cast: true, receive: true }, f2: { cast: true, receive: true },
        f3: { cast: true, receive: true }, f4: { cast: true, receive: true }, f5: { cast: true, receive: true },
        awning: { cast: true }, ac: { cast: true }, roofProps: { cast: true },
      },
    });
    this.meshes = out;
    this.redLightMat = mats.redLight;
    return this;
  }

  // ---------- corner tip tower between avenue i and i+1 ----------
  buildTip(b, i) {
    const R = this.R;
    const j = (i + 1) % N_AVE;
    const r0 = PLAZA_R + 0.6;
    const along0 = Math.sqrt(r0 * r0 - AVE_HALF * AVE_HALF);
    const pA = avePoint(i, along0, AVE_HALF);        // right edge of avenue i
    const pB = avePoint(j, along0, -AVE_HALF);       // left edge of avenue j
    const pA2 = avePoint(i, TIP_END, AVE_HALF);
    const pB2 = avePoint(j, TIP_END, -AVE_HALF);
    // back point: along the bisector
    const bis = aveAngle(i) + Math.PI / N_AVE;
    const back = { x: Math.cos(bis) * (TIP_END + 16), z: Math.sin(bis) * (TIP_END + 16) };
    // CCW order seen from above => with our coords (x right, z down on map) we use this order:
    const foot = [pA, pA2, back, pB2, pB];
    const H = 64 + R() * 60;
    const key = 'f' + ((i * 3 + 1) % 6);
    // podium (0..GF) as dark glass + shop band, tower body above
    prismWalls(b, key, foot, CURB, H);
    capPoly(b, 'roof', foot, H);
    // crown: setback volume + antenna + red aviation lights
    const cx = (pA.x + pB.x + back.x) / 3, cz = (pA.z + pB.z + back.z) / 3;
    const crownH = 6 + R() * 10;
    const cw = 9 + R() * 5;
    b.add('roofProps', box(cw, crownH, cw), mat(cx, H, cz, bis));
    b.add('metal', new THREE.CylinderGeometry(0.15, 0.3, 14, 6), mat(cx, H + crownH + 7, cz));
    b.add('redLight', new THREE.SphereGeometry(0.45, 8, 6), mat(cx, H + crownH + 14.2, cz));
    for (const p of [pA, pB, back]) b.add('redLight', new THREE.SphereGeometry(0.35, 8, 6), mat(p.x * 0.97 + cx * 0.03, H + 0.4, p.z * 0.97 + cz * 0.03));

    // giant LED screen on the chamfer, facing the hub
    const mid = { x: (pA.x + pB.x) / 2, z: (pA.z + pB.z) / 2 };
    const w = Math.hypot(pA.x - pB.x, pA.z - pB.z);
    const n = { x: -mid.x / Math.hypot(mid.x, mid.z), z: -mid.z / Math.hypot(mid.x, mid.z) };
    const sh = 17 + R() * 5;
    const sy = 8.5;
    const yaw = yawFor(n.x, n.z);
    this.screens.push({ x: mid.x + n.x * 0.35, y: sy + sh / 2, z: mid.z + n.z * 0.35, yaw, w: w + 4, h: sh, district: i, kind: 'tip' });
    // bezel
    b.add('metalDark', box(w + 4.8, sh + 0.8, 0.5), mat(mid.x + n.x * 0.1, sy - 0.4, mid.z + n.z * 0.1, yaw));
    // second, wide horizontal LED band on the podium
    this.screens.push({ x: mid.x + n.x * 0.35, y: 5.2, z: mid.z + n.z * 0.35, yaw, w: w + 4, h: 2.0, district: i, kind: 'band' });
    b.add('metalDark', box(w + 4.4, 2.4, 0.4), mat(mid.x + n.x * 0.1, 4.0, mid.z + n.z * 0.1, yaw));
    // lit storefront glass at street level on the two avenue-facing sides
    for (const [p, q, face] of [[pA, pA2, 1], [pB2, pB, 1]]) {
      const L = Math.hypot(q.x - p.x, q.z - p.z);
      const dx = (q.x - p.x) / L, dz = (q.z - p.z) / L;
      const ny = yawFor(dz * face, -dx * face);
      const fx = dz * face, fz = -dx * face;
      for (let s = 1; s + 7 < L; s += 8) {
        const c = (i * 7 + s) % 16;
        const u0 = (c % 4) / 4, v0 = 1 - (((c / 4) | 0) + 1) / 4;
        const g = quad(7.6, 4.2, [u0, v0, u0 + 0.25, v0 + 0.25]);
        b.add('shop', g, mat(p.x + dx * s + fx * 0.05, CURB, p.z + dz * s + fz * 0.05, ny));
      }
      // canopy
      b.add('awning', box(L - 1, 0.25, 2.2), mat((p.x + q.x) / 2 + fx * 1.1, 4.5, (p.z + q.z) / 2 + fz * 1.1, ny));
      b.add(i % 2 ? 'stripCyan' : 'stripPink', box(L - 1, 0.08, 0.08), mat((p.x + q.x) / 2 + fx * 2.2, 4.45, (p.z + q.z) / 2 + fz * 2.2, ny));
    }
    this.buildingBoxes.push({ foot, h: H });
  }

  // ---------- row buildings along avenue i, side ±1 ----------
  buildRow(b, i, side, signs, shops) {
    const R = this.R;
    const d = aveDir(i);
    const rot = yawFor(d.x, d.z);
    // front faces the road: facing vector = -side * rightNormal
    const nx = -d.z, nz = d.x;
    const fx = -side * nx, fz = -side * nz;
    const faceYaw = yawFor(fx, fz);
    let a = TIP_END + 0.4;
    let bi = 0;
    while (a < AVE_END - 2) {
      let w = 7 + R() * 9;
      if (a + w > AVE_END) w = AVE_END - a;
      if (w < 4) break;
      const maxDepth = Math.min(30, a * TAN_HALF - AVE_HALF - 1.2);
      const depth = Math.max(8, maxDepth * (0.7 + R() * 0.3));
      const tall = R();
      let H = 16 + tall * tall * 64 + (a < 90 ? 10 : 0);
      if (R() < 0.08) H += 50;
      const setback = R() < 0.25 ? 0.6 + R() * 1.4 : 0;
      const lat = side * (AVE_HALF + setback + depth / 2);
      const c = avePoint(i, a + w / 2, lat);
      const key = 'f' + ((i + bi * 5 + (side > 0 ? 2 : 0)) % 6);
      // main body above ground floor
      const g = box(w, H - GF, depth, { su: SU, sv: SV, ou: R(), ov: 0, faces: 'fbrl' });
      b.add(key, g, mat(c.x, GF + CURB, c.z, faceYaw));
      b.add('roof', box(w, 0.01, depth, { faces: 't' }), mat(c.x, H + CURB, c.z, faceYaw));
      // parapet
      b.add('roofProps', box(w, 1.1, 0.25), mat(c.x + fx * (depth / 2 - 0.12), H + CURB, c.z + fz * (depth / 2 - 0.12), faceYaw));
      // ground floor: back box (dark) + lit shop front
      b.add('metalDark', box(w, GF, depth - 0.6, { faces: 'brl' }), mat(c.x - fx * 0.3, CURB, c.z - fz * 0.3, faceYaw));
      const cell = (i * 5 + bi * 3 + (side > 0 ? 1 : 0)) % 16;
      const u0 = (cell % 4) / 4, v0 = 1 - (((cell / 4) | 0) + 1) / 4;
      const frontC = { x: c.x + fx * (depth / 2 - 0.6), z: c.z + fz * (depth / 2 - 0.6) };
      // position quad: local origin bottom-left, so shift by -w/2 along local +X
      const lx = { x: Math.cos(faceYaw), z: -Math.sin(faceYaw) }; // local +X in world
      b.add('shop', quad(w - 0.4, GF - 0.3, [u0, v0, u0 + 0.25, v0 + 0.25]),
        mat(frontC.x - lx.x * (w / 2 - 0.2), CURB, frontC.z - lx.z * (w / 2 - 0.2), faceYaw));
      // pillars between shops
      for (const s of [-1, 1]) {
        b.add('fc', box(0.5, GF, 0.8, { su: 0.4, sv: 0.4 }), mat(frontC.x + lx.x * s * (w / 2 - 0.25) + fx * 0.3, CURB, frontC.z + lx.z * s * (w / 2 - 0.25) + fz * 0.3, faceYaw));
      }
      // awning or canopy band
      const front = { x: c.x + fx * depth / 2, z: c.z + fz * depth / 2 };
      if (R() < 0.6) {
        const aw = box(w - 0.6, 0.12, 1.6);
        b.add(R() < 0.3 ? 'awningRed' : 'awning', aw, mat(front.x + fx * 0.8, GF - 0.15, front.z + fz * 0.8, faceYaw, -0.18));
      }
      // floor band light strips on some modern buildings
      if (R() < 0.18) {
        const sk = ['stripCyan', 'stripPink', 'stripAmber'][(R() * 3) | 0];
        for (let y = GF + FLOOR_H; y < H; y += FLOOR_H * (R() < 0.5 ? 1 : 2)) {
          b.add(sk, box(w + 0.05, 0.07, 0.07), mat(front.x + fx * 0.04, y + CURB, front.z + fz * 0.04, faceYaw));
        }
      }
      // vertical neon signs (tate-kanban), projecting over the sidewalk
      const nSigns = H > 20 ? 1 + ((R() * 2.4) | 0) : R() < 0.6 ? 1 : 0;
      for (let k = 0; k < nSigns; k++) {
        const sw = 1.1, shH = 4 + R() * 4;
        const y0 = GF + 1 + k * (shH + 0.8) + R() * 2;
        if (y0 + shH > H - 1) break;
        const along = a + 0.9 + R() * (w - 1.8);
        const p = avePoint(i, along, side * (AVE_HALF + setback - 0.05 - sw * 0.55 - 0.15));
        const cellS = (R() * 36) | 0;
        const su0 = (cellS % 6) / 6, sv0 = 1 - (((cellS / 6) | 0) + 1) / 6;
        // sign faces are perpendicular to facade: they face along +/- avenue direction
        const gy = rot; // local +Z -> avenue direction
        const gA = quad(sw, shH, [su0, sv0, su0 + 1 / 6, sv0 + 1 / 6]);
        b.add('sign', gA, mat(p.x - Math.cos(gy) * sw / 2 + d.x * 0.09, y0 + CURB, p.z + Math.sin(gy) * sw / 2 + d.z * 0.09, gy));
        const gB = quad(sw, shH, [su0, sv0, su0 + 1 / 6, sv0 + 1 / 6]);
        b.add('sign', gB, mat(p.x + Math.cos(gy) * sw / 2 - d.x * 0.09, y0 + CURB, p.z - Math.sin(gy) * sw / 2 - d.z * 0.09, gy + Math.PI));
        b.add('signBack', box(sw + 0.14, shH + 0.14, 0.16), mat(p.x, y0 - 0.07 + CURB, p.z, gy));
        // bracket to wall
        b.add('metalDark', box(0.08, 0.08, sw * 0.6), mat(p.x - fx * sw * 0.55, y0 + shH * 0.8 + CURB, p.z - fz * sw * 0.55, faceYaw));
        this.spill.push({ x: p.x, z: p.z, color: cellS, size: 5 + shH * 0.6 });
      }
      // AC units + pipes on side walls & balconies on residential
      if (key === 'f4' || R() < 0.3) {
        for (let y = GF + 1.2; y < Math.min(H - 2, 40); y += FLOOR_H) {
          if (R() < 0.45) continue;
          const off = (R() - 0.5) * (w - 1.5);
          b.add('ac', box(0.8, 0.6, 0.35), mat(front.x + lx.x * off + fx * 0.18, y + CURB, front.z + lx.z * off + fz * 0.18, faceYaw));
        }
      }
      // rooftop clutter
      const nProps = 1 + ((R() * 4) | 0);
      for (let k = 0; k < nProps; k++) {
        const pw = 1.2 + R() * 3, ph = 1 + R() * 3.5, pd = 1.2 + R() * 3;
        const ox = (R() - 0.5) * (w - pw - 1), oz = (R() - 0.5) * (depth - pd - 1);
        b.add('roofProps', box(pw, ph, pd), mat(c.x + lx.x * ox + fx * oz, H + CURB, c.z + lx.z * ox + fz * oz, faceYaw));
      }
      if (R() < 0.35) {
        // water tank / cooling tower
        const ox = (R() - 0.5) * (w - 3), oz = (R() - 0.5) * (depth - 3);
        const cyl = new THREE.CylinderGeometry(1.1, 1.1, 2.4, 14);
        cyl.translate(0, 1.2, 0);
        b.add('roofProps', cyl, mat(c.x + lx.x * ox + fx * oz, H + CURB + 0.9, c.z + lx.z * ox + fz * oz));
      }
      if (H > 55) b.add('redLight', new THREE.SphereGeometry(0.3, 6, 5), mat(c.x, H + CURB + 1.4, c.z));
      // rooftop billboard frame (some) — faces the avenue
      if (R() < 0.22 && H < 50) {
        const bw = Math.min(w - 1, 10), bh = 4 + R() * 2;
        b.add('metalDark', box(bw, 0.2, 0.2), mat(front.x - fx * 1.5, H + CURB + 1.2, front.z - fz * 1.5, faceYaw));
        for (const s of [-1, 1]) b.add('metalDark', box(0.2, 1.6, 0.2), mat(front.x - fx * 1.5 + lx.x * s * bw * 0.4, H + CURB, front.z - fz * 1.5 + lx.z * s * bw * 0.4, faceYaw));
        this.screens.push({ x: front.x - fx * 1.4, y: H + CURB + 1.4 + bh / 2, z: front.z - fz * 1.4, yaw: faceYaw, w: bw, h: bh, district: i, kind: 'roof' });
      }
      // mid-facade screen on some tall buildings near the start of the avenue
      if (H > 36 && R() < 0.3 && w > 9) {
        const bw = w - 2, bh = Math.min(12, bw * 0.75);
        this.screens.push({ x: front.x + fx * 0.1, y: GF + 6 + bh / 2 + R() * 6, z: front.z + fz * 0.1, yaw: faceYaw, w: bw, h: bh, district: i, kind: 'wall' });
      }
      this.buildingBoxes.push({ c, w, depth, h: H, yaw: faceYaw });
      // second-row taller tower behind (skyline depth)
      const back0 = AVE_HALF + setback + depth + 3;
      const backMax = (a + w / 2) * TAN_HALF - 3;
      if (backMax - back0 > 10 && R() < 0.7) {
        const bd = Math.min(24, backMax - back0);
        const bh = H + 15 + R() * 70;
        const bc = avePoint(i, a + w / 2, side * (back0 + bd / 2));
        b.add('f' + ((bi + i) % 6), box(w * 0.95, bh, bd, { su: SU, sv: SV, ou: R(), faces: 'fbrl' }), mat(bc.x, CURB, bc.z, faceYaw));
        b.add('roof', box(w * 0.95, 0.01, bd, { faces: 't' }), mat(bc.x, bh + CURB, bc.z, faceYaw));
        if (bh > 60) b.add('redLight', new THREE.SphereGeometry(0.4, 6, 5), mat(bc.x, bh + CURB + 0.6, bc.z));
      }
      a += w + (R() < 0.12 ? 1.6 + R() * 1.5 : 0.05);
      bi++;
    }
  }

  // ---------- avenue end: tall landmark tower closing the vista ----------
  buildEndLandmark(b, i) {
    const R = this.R;
    const d = aveDir(i);
    const c = avePoint(i, AVE_END + 14, 0);
    const yaw = yawFor(-d.x, -d.z);
    const H = 120 + R() * 80;
    const key = 'f' + ((i + 3) % 6);
    b.add(key, box(26, H, 24, { su: SU, sv: SV, faces: 'fbrl' }), mat(c.x, CURB, c.z, yaw));
    b.add('roof', box(26, 0.01, 24, { faces: 't' }), mat(c.x, H + CURB, c.z, yaw));
    b.add('roofProps', box(14, 10, 12), mat(c.x, H + CURB, c.z, yaw));
    b.add('metal', new THREE.CylinderGeometry(0.2, 0.45, 26, 6), mat(c.x, H + 23, c.z));
    b.add('redLight', new THREE.SphereGeometry(0.6, 8, 6), mat(c.x, H + 36.3, c.z));
    // huge vertical screen at the end of the avenue
    const f = avePoint(i, AVE_END + 14 - 12.2, 0);
    this.screens.push({ x: f.x, y: 14 + 22, z: f.z, yaw, w: 20, h: 36, district: i, kind: 'end' });
    // backing frame sits BEHIND the screen (further along +d, away from the viewer)
    b.add('metalDark', box(21, 37, 0.5), mat(f.x + d.x * 0.4, 14 + 22 - 18.5, f.z + d.z * 0.4, yaw));
  }

  // ---------- distant skyline ring ----------
  buildSkyline(b) {
    const R = this.R;
    for (let k = 0; k < 360; k++) {
      const t = R() * Math.PI * 2;
      const r = 190 + R() * 170;
      // avoid avenue vistas
      const x = Math.cos(t) * r, z = Math.sin(t) * r;
      let near = false;
      for (let i = 0; i < N_AVE; i++) {
        const d = aveDir(i);
        const al = x * d.x + z * d.z, lt = -x * d.z + z * d.x;
        if (al > 0 && al < AVE_END + 34 && Math.abs(lt) < al * TAN_HALF + 4) { near = true; break; }
      }
      if (near && r < AVE_END + 40) continue;
      const w = 12 + R() * 22, dd = 12 + R() * 22;
      const H = 40 + Math.pow(R(), 1.6) * 190;
      const ry = R() * Math.PI;
      b.add('f' + (k % 6), box(w, H, dd, { su: SU, sv: SV, ou: R(), faces: 'fbrl' }), mat(x, 0, z, ry));
      b.add('roof', box(w, 0.01, dd, { faces: 't' }), mat(x, H, z, ry));
      if (H > 110) b.add('redLight', new THREE.SphereGeometry(0.9, 6, 5), mat(x, H + 1, z));
    }
  }
}
