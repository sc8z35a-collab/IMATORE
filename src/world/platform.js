import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { N_AVE, EDGE, PLAT_H, CURB, AVE_HALF, ROAD_HALF, AVE_END, aveDir, avePoint, edgePoint, addObstacle } from './layout.js';
import { facadeMaterial, pointsGeo, pointsMaterial, hazeBasic, GY } from './landscape.js';
import { rng } from './textures.js';
import { glow } from './materials.js';

// The elevated artificial ground (人工地盤) that carries the whole hub:
//  * octagonal outer wall, PLAT_H tall, dressed as a lit multi-storey podium (the hub is built on top of a
//    mega-structure: offices / malls below) — uses the same procedural facade shader as the far city
//  * glass balustrade with LED handrail around the whole rim
//  * at each avenue end, a cantilevered observation terrace (展望テラス) with binocular viewers, benches,
//    spotlights and a floor-level LED edge — the place to look out over the 4x larger landscape
//  * vertical light fins / waterfalls of light on the wall below each terrace (visible from far away)
export class Platform {
  constructor(scene, M) {
    this.scene = scene; this.M = M;
    this.group = new THREE.Group(); this.group.name = 'platform';
    scene.add(this.group);
    this.R = rng(3131);
    this.reflHide = [];
  }

  build() {
    const R = this.R;
    // ---------------- outer wall (octagon), facade-shaded ----------------
    const pos = [], nor = [], aF = [], aS = [];
    let u = 0;
    for (let k = 0; k < N_AVE; k++) {
      const a = edgePoint(k), b = edgePoint(k + 1);
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      const nx = (b.z - a.z) / L, nz = -(b.x - a.x) / L; // outward normal (CW order in screen space)
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      const sgn = nx * mx + nz * mz > 0 ? 1 : -1;
      const y0 = GY, y1 = CURB;
      const quad = [[a, y0], [b, y0], [b, y1], [a, y0], [b, y1], [a, y1]];
      const uu = [[0, 0], [L, 0], [L, 1], [0, 0], [L, 1], [0, 1]];
      const order = sgn > 0 ? [0, 1, 2, 3, 4, 5] : [0, 2, 1, 3, 5, 4];
      for (const i of order) {
        const [p, y] = quad[i];
        pos.push(p.x, y, p.z); nor.push(nx * sgn, 0, nz * sgn);
        aF.push(u + uu[i][0], uu[i][1] ? (y1 - y0) : 0);
        aS.push(4.1 + k * 0.37, 0, 200, L);
      }
      u += L;
    }
    const wall = new THREE.BufferGeometry();
    wall.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    wall.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    wall.setAttribute('aF', new THREE.Float32BufferAttribute(aF, 2));
    wall.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 4));
    const wm = new THREE.Mesh(wall, facadeMaterial());
    wm.name = 'platformWall'; wm.frustumCulled = false;
    this.group.add(wm);
    this.reflHide.push(wm);

    // cornice slab + underside soffit lip (reads as a thick deck edge)
    const slab = [];
    for (let k = 0; k < N_AVE; k++) {
      const a = edgePoint(k), b = edgePoint(k + 1);
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      const g = new THREE.BoxGeometry(L + 1.2, 1.1, 1.6);
      g.translate(0, CURB - 0.55, 0);
      g.rotateY(-Math.atan2(b.z - a.z, b.x - a.x));
      g.translate((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
      slab.push(g);
    }
    const sm = new THREE.Mesh(mergeGeometries(slab), this.M.metalDark);
    sm.receiveShadow = true;
    this.group.add(sm);

    // ---------------- glass balustrade + LED handrail ----------------
    const glassG = [], railG = [], postG = [];
    const inset = 0.9;
    for (let k = 0; k < N_AVE; k++) {
      const A = edgePoint(k), B = edgePoint(k + 1);
      const ca = Math.hypot(A.x, A.z), cb = Math.hypot(B.x, B.z);
      const a = { x: A.x * (1 - inset / ca), z: A.z * (1 - inset / ca) }, b = { x: B.x * (1 - inset / cb), z: B.z * (1 - inset / cb) };
      const L = Math.hypot(b.x - a.x, b.z - a.z), yaw = -Math.atan2(b.z - a.z, b.x - a.x);
      const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
      const gp = new THREE.PlaneGeometry(L, 1.05); gp.translate(0, CURB + 0.6, 0); gp.rotateY(yaw); gp.translate(cx, 0, cz);
      glassG.push(gp);
      const rl = new THREE.BoxGeometry(L, 0.06, 0.12); rl.translate(0, CURB + 1.15, 0); rl.rotateY(yaw); rl.translate(cx, 0, cz);
      railG.push(rl);
      const n = Math.max(2, Math.round(L / 2.4));
      for (let j = 0; j <= n; j++) {
        const t = j / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        const pg = new THREE.BoxGeometry(0.07, 1.15, 0.07); pg.translate(x, CURB + 0.575, z); postG.push(pg);
      }
    }
    const glass = new THREE.Mesh(mergeGeometries(glassG), new THREE.MeshPhysicalMaterial({
      color: 0x9fc4dd, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0, envMapIntensity: 2.2, side: THREE.DoubleSide, depthWrite: false,
    }));
    glass.renderOrder = 3;
    const rail = new THREE.Mesh(mergeGeometries(railG), glow(0xbfefff, 2.4));
    const posts = new THREE.Mesh(mergeGeometries(postG), this.M.chrome);
    this.group.add(glass, rail, posts);

    // ---------------- observation terraces at each avenue end ----------------
    const lights = [];
    const benchG = [], scopeG = [], planterG = [], stripG = [];
    for (let i = 0; i < N_AVE; i++) {
      const d = aveDir(i);
      const yaw = Math.atan2(d.x, d.z);
      // tokens (binocular viewers) facing out, flanking the axis
      for (const s of [-3.2, 3.2]) {
        const p = avePoint(i, EDGE - 3.6 - Math.abs(s) * 0.42, s);
        const post = new THREE.CylinderGeometry(0.09, 0.14, 1.05, 10); post.translate(0, 0.52, 0);
        const head = new THREE.BoxGeometry(0.46, 0.26, 0.5); head.translate(0, 1.18, 0.04);
        const lens1 = new THREE.CylinderGeometry(0.075, 0.075, 0.2, 10); lens1.rotateX(Math.PI / 2); lens1.translate(-0.11, 1.2, 0.33);
        const lens2 = lens1.clone(); lens2.translate(0.22, 0, 0);
        const g = mergeGeometries([post, head, lens1, lens2].map((q) => q.toNonIndexed()));
        g.rotateY(yaw); g.translate(p.x, CURB, p.z);
        scopeG.push(g);
        addObstacle(p.x, p.z, 0.4);
      }
      // benches facing the view
      for (const s of [-6.2, 6.2]) {
        const p = avePoint(i, AVE_END + 14 + 3.2, s);
        const seat = new THREE.BoxGeometry(2.4, 0.1, 0.55); seat.translate(0, 0.46, 0);
        const back = new THREE.BoxGeometry(2.4, 0.5, 0.06); back.translate(0, 0.78, -0.26);
        const legs = new THREE.BoxGeometry(2.2, 0.42, 0.4); legs.translate(0, 0.21, 0);
        const g = mergeGeometries([seat, back, legs].map((q) => q.toNonIndexed()));
        g.rotateY(yaw); g.translate(p.x, CURB, p.z);
        benchG.push(g);
      }
      // low planters with LED uplight along the terrace sides
      for (const s of [-1, 1]) {
        const p = avePoint(i, AVE_END + 10, s * (ROAD_HALF + 1.6));
        const g = new THREE.BoxGeometry(1.1, 0.55, 5.5); g.translate(0, 0.275, 0); g.rotateY(yaw); g.translate(p.x, CURB, p.z);
        planterG.push(g);
        addObstacle(p.x, p.z, 0.8);
      }
      // floor LED strip that traces the prow (a chevron pointing out into the landscape)
      for (const s of [-1, 1]) {
        const a = avePoint(i, AVE_END + 6, s * 4.4), b = avePoint(i, EDGE - 1.6, 0);
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        const g = new THREE.BoxGeometry(0.12, 0.02, L); g.translate(0, CURB + 0.012, 0);
        g.rotateY(Math.atan2(b.x - a.x, b.z - a.z)); g.translate((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
        stripG.push(g);
      }
      // the prow: twin slim light masts (beacons) flanking the view axis. C-007: a single mast used to stand
      // exactly on the axis, i.e. dead centre of the landmark vista, and hid the slim Skytree completely.
      for (const s of [-1, 1]) {
        const tip = avePoint(i, EDGE - 2.2, s * 1.5);
        lights.push({ x: tip.x, y: CURB + 9.5, z: tip.z, c: [2.2, 2.4, 2.8], s: 0.8 });
      }
      // light fins cascading down the wall below the prow (seen from far away as vertical light lines)
      for (let y = GY + 1; y < 0; y += 1.4) {
        for (const s of [-2, 0, 2]) {
          const p = avePoint(i, EDGE + 0.3 - Math.abs(s) * 0.42, s);
          lights.push({ x: p.x, y, z: p.z, c: [0.6, 1.4, 2.2], s: 0.45 });
        }
      }
    }
    const mast = [];
    for (let i = 0; i < N_AVE; i++) {
      for (const s of [-1, 1]) {
        const tip = avePoint(i, EDGE - 2.2, s * 1.5);
        const g = new THREE.CylinderGeometry(0.05, 0.09, 9.4, 8); g.translate(tip.x, CURB + 4.7, tip.z);
        mast.push(g);
        addObstacle(tip.x, tip.z, 0.25);
      }
    }
    this.group.add(new THREE.Mesh(mergeGeometries(mast), this.M.chrome));
    const benchM = new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 0.55 });
    const bm = new THREE.Mesh(mergeGeometries(benchG), benchM); bm.castShadow = true; bm.receiveShadow = true;
    const sc = new THREE.Mesh(mergeGeometries(scopeG), new THREE.MeshStandardMaterial({ color: 0x1d6b8f, roughness: 0.35, metalness: 0.6 }));
    sc.castShadow = true;
    const pl = new THREE.Mesh(mergeGeometries(planterG), this.M.metalDark);
    const st = new THREE.Mesh(mergeGeometries(stripG), glow(0x6fe8ff, 3.2));
    this.group.add(bm, sc, pl, st);

    // rim lights every 6 m (tiny downlights on the balustrade, seen as a dotted outline of the platform)
    for (let k = 0; k < N_AVE; k++) {
      const a = edgePoint(k), b = edgePoint(k + 1);
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      for (let s = 0; s < L; s += 6) {
        const t = s / L;
        lights.push({ x: a.x + (b.x - a.x) * t, y: CURB - 1.2, z: a.z + (b.z - a.z) * t, c: [1.8, 1.4, 1.0], s: 0.35 });
      }
    }
    const pts = new THREE.Points(pointsGeo(lights), pointsMaterial());
    pts.frustumCulled = false;
    this.group.add(pts);
    this.reflHide.push(pts);
    return this;
  }
}
