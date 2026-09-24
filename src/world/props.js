import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './textures.js';
import {
  avePoint, aveDir, aveAngle, addObstacle, PLAZA_R, TIP_END, AVE_END, AVE_HALF, ROAD_HALF, N_AVE, CURB, HUB_R, RING_OUT, RING_IN,
} from './layout.js';
import { glow } from './materials.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
function M4(x, y, z, ry = 0, s = 1) { _e.set(0, ry, 0); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(s, s, s); return _m.compose(_p, _q, _s).clone(); }

// Instanced multi-part prop: parts = [{geo, mat}] each gets its own InstancedMesh sharing matrices
class PropSet {
  constructor(name, parts, cast = true) { this.name = name; this.parts = parts; this.mats = []; this.cast = cast; }
  add(m) { this.mats.push(m); }
  build(parent) {
    const n = this.mats.length;
    if (!n) return;
    for (const p of this.parts) {
      const im = new THREE.InstancedMesh(p.geo, p.mat, n);
      this.mats.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = this.cast && !p.noShadow;
      im.receiveShadow = !p.noShadow;
      im.name = this.name;
      im.computeBoundingSphere();
      parent.add(im);
    }
  }
}

export class Props {
  constructor(scene, M, districts) {
    this.scene = scene; this.M = M; this.districts = districts;
    this.group = new THREE.Group(); scene.add(this.group);
    this.lampHeads = [];
    this.R = rng(99);
  }

  build(city) {
    const M = this.M, R = this.R;
    // ---- street lamp (modern LED, single arm) ----
    const pole = new THREE.CylinderGeometry(0.07, 0.11, 7, 10); pole.translate(0, 3.5, 0);
    const arm = new THREE.BoxGeometry(0.08, 0.08, 1.6); arm.translate(0, 7, 0.75);
    const head = new THREE.BoxGeometry(0.34, 0.1, 0.7); head.translate(0, 6.96, 1.45);
    const lens = new THREE.PlaneGeometry(0.28, 0.6); lens.rotateX(Math.PI / 2); lens.translate(0, 6.905, 1.45);
    const lampBody = mergeGeometries([pole, arm, head]);
    const lamps = new PropSet('lamps', [{ geo: lampBody, mat: M.metalDark }, { geo: lens, mat: glow(0xfff1d6, 9), noShadow: true }]);

    // ---- traffic signal (Japanese horizontal LED) ----
    const tpole = new THREE.CylinderGeometry(0.09, 0.11, 5.6, 10); tpole.translate(0, 2.8, 0);
    const tarm = new THREE.BoxGeometry(0.1, 0.1, 3.2); tarm.translate(0, 5.4, 1.5);
    const tbox = new THREE.BoxGeometry(1.25, 0.42, 0.28); tbox.translate(0, 5.1, 2.9);
    const visor = new THREE.BoxGeometry(1.25, 0.04, 0.18); visor.translate(0, 5.33, 3.1);
    const tBody = mergeGeometries([tpole, tarm, tbox, visor]);
    const lampG = new THREE.CircleGeometry(0.14, 20); lampG.translate(0.4, 5.1, 3.045);
    const lampY = new THREE.CircleGeometry(0.14, 20); lampY.translate(0, 5.1, 3.045);
    const lampR = new THREE.CircleGeometry(0.14, 20); lampR.translate(-0.4, 5.1, 3.045);
    // pedestrian signal
    const pbox = new THREE.BoxGeometry(0.36, 0.72, 0.2); pbox.translate(0, 2.6, 0.18);
    const pLamp = new THREE.PlaneGeometry(0.26, 0.26); pLamp.translate(0, 2.78, 0.285);
    const pLamp2 = new THREE.PlaneGeometry(0.26, 0.26); pLamp2.translate(0, 2.45, 0.285);
    this.sigGreen = glow(0x19ffb0, 6); this.sigRed = glow(0xff2a1a, 6); this.sigDim = new THREE.MeshBasicMaterial({ color: 0x151515 });
    this.sigAmber = new THREE.MeshBasicMaterial({ color: 0x2a1a05 });
    const signals = new PropSet('signals', [
      { geo: mergeGeometries([tBody, pbox]), mat: M.metalDark },
      { geo: lampG, mat: this.sigGreen, noShadow: true },
      { geo: lampY, mat: this.sigAmber, noShadow: true },
      { geo: lampR, mat: this.sigDim, noShadow: true },
      { geo: pLamp, mat: this.sigDim, noShadow: true },
      { geo: pLamp2, mat: glow(0x3fe0ff, 3), noShadow: true },
    ]);

    // ---- vending machine ----
    const vm = new THREE.BoxGeometry(1.0, 1.85, 0.75); vm.translate(0, 0.925, 0);
    const vmFront = new THREE.PlaneGeometry(0.86, 1.1); vmFront.translate(0, 1.25, 0.376);
    const vmTex = this.vendingTex();
    const vending = new PropSet('vending', [
      { geo: vm, mat: new THREE.MeshStandardMaterial({ color: 0xe8e8ea, roughness: 0.35, metalness: 0.2 }) },
      { geo: vmFront, mat: new THREE.MeshBasicMaterial({ map: vmTex, color: new THREE.Color(1.8, 1.8, 1.8) }), noShadow: true },
    ]);
    const vmRed = new PropSet('vendingRed', [
      { geo: vm, mat: new THREE.MeshStandardMaterial({ color: 0xb3121b, roughness: 0.3, metalness: 0.2 }) },
      { geo: vmFront, mat: new THREE.MeshBasicMaterial({ map: vmTex, color: new THREE.Color(1.8, 1.8, 1.8) }), noShadow: true },
    ]);

    // ---- street tree (zelkova-ish): trunk + clustered leaf blobs ----
    const trunk = new THREE.CylinderGeometry(0.1, 0.18, 3.2, 8); trunk.translate(0, 1.6, 0);
    const leaves = [];
    const LR = rng(5);
    for (let k = 0; k < 9; k++) {
      const s = new THREE.IcosahedronGeometry(0.9 + LR() * 0.7, 1);
      const a = LR() * Math.PI * 2, r = LR() * 1.1;
      s.translate(Math.cos(a) * r, 3.6 + LR() * 1.8, Math.sin(a) * r);
      leaves.push(s);
    }
    const leafGeo = mergeGeometries(leaves);
    // jitter vertices for organic look
    const lp = leafGeo.attributes.position;
    for (let k = 0; k < lp.count; k++) lp.setXYZ(k, lp.getX(k) + (LR() - 0.5) * 0.25, lp.getY(k) + (LR() - 0.5) * 0.25, lp.getZ(k) + (LR() - 0.5) * 0.25);
    leafGeo.computeVertexNormals();
    const grate = new THREE.BoxGeometry(1.4, 0.04, 1.4); grate.translate(0, 0.02, 0);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x1d3a22, roughness: 0.85, flatShading: true });
    const trees = new PropSet('trees', [
      { geo: trunk, mat: new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.95 }) },
      { geo: leafGeo, mat: leafMat },
      { geo: grate, mat: M.metalDark, noShadow: true },
    ]);

    // ---- bollard / bench / bin / bike ----
    const boll = new THREE.CylinderGeometry(0.09, 0.1, 0.9, 10); boll.translate(0, 0.45, 0);
    const bollCap = new THREE.CylinderGeometry(0.095, 0.095, 0.05, 10); bollCap.translate(0, 0.8, 0);
    const bollards = new PropSet('bollards', [{ geo: boll, mat: M.metalDark }, { geo: bollCap, mat: glow(0xffc070, 3), noShadow: true }]);
    const benchSeat = new THREE.BoxGeometry(1.8, 0.08, 0.5); benchSeat.translate(0, 0.45, 0);
    const benchLegs = mergeGeometries([-0.8, 0.8].map((x) => { const g = new THREE.BoxGeometry(0.08, 0.45, 0.45); g.translate(x, 0.225, 0); return g; }));
    const benches = new PropSet('benches', [
      { geo: benchSeat, mat: new THREE.MeshStandardMaterial({ color: 0x5a3b26, roughness: 0.6 }) },
      { geo: benchLegs, mat: M.metalDark },
    ]);
    const bin = new THREE.CylinderGeometry(0.28, 0.25, 0.9, 16); bin.translate(0, 0.45, 0);
    const bins = new PropSet('bins', [{ geo: bin, mat: M.metal }]);
    // guard rail along road
    const railPost = new THREE.CylinderGeometry(0.035, 0.035, 0.85, 6); railPost.translate(0, 0.425, 0);
    const railTop = new THREE.CylinderGeometry(0.03, 0.03, 2.5, 6); railTop.rotateZ(Math.PI / 2); railTop.translate(1.25, 0.8, 0);
    const railMid = railTop.clone(); railMid.translate(0, -0.35, 0);
    const rails = new PropSet('rails', [{ geo: mergeGeometries([railPost, railTop, railMid]), mat: new THREE.MeshStandardMaterial({ color: 0xd8dbe0, roughness: 0.3, metalness: 0.7 }) }], false);
    // manhole
    const manhole = new THREE.CylinderGeometry(0.32, 0.32, 0.01, 24); manhole.translate(0, 0.006, 0);
    const manholes = new PropSet('manholes', [{ geo: manhole, mat: M.metalDark }], false);
    // phone booth / public phone (Showa relic) & post box
    const post = new THREE.CylinderGeometry(0.22, 0.22, 1.25, 16); post.translate(0, 0.625, 0);
    const posts = new PropSet('postboxes', [{ geo: post, mat: new THREE.MeshStandardMaterial({ color: 0xc41414, roughness: 0.35 }) }]);

    // ---------- placement ----------
    for (let i = 0; i < N_AVE; i++) {
      const dir = aveDir(i);
      const yawRoad = Math.atan2(dir.x, dir.z);
      for (const side of [-1, 1]) {
        // lamps on sidewalk edge, arm pointing to road centre
        for (let a = PLAZA_R + 8; a < AVE_END - 4; a += 16) {
          const s = side * (ROAD_HALF + 0.55);
          const p = avePoint(i, a + (side > 0 ? 8 : 0), s);
          // arm local +Z -> toward centre (-side * right normal)
          const nx = -dir.z, nz = dir.x;
          const ry = Math.atan2(-side * nx, -side * nz);
          lamps.add(M4(p.x, CURB, p.z, ry));
          addObstacle(p.x, p.z, 0.25);
          this.lampHeads.push({ x: p.x - side * nx * 1.45, y: 6.9, z: p.z - side * nz * 1.45 });
        }
        // trees
        for (let a = PLAZA_R + 14; a < AVE_END - 6; a += 16) {
          const p = avePoint(i, a + (side > 0 ? 0 : 8), side * (ROAD_HALF + 1.6));
          trees.add(M4(p.x, CURB, p.z, R() * 6, 0.85 + R() * 0.35));
          addObstacle(p.x, p.z, 0.45);
        }
        // bollards
        for (let a = PLAZA_R + 4; a < AVE_END - 4; a += 4) {
          if ((a | 0) % 16 < 3) continue;
          const p = avePoint(i, a, side * (ROAD_HALF + 0.3));
          bollards.add(M4(p.x, CURB, p.z));
        }
        // vending machines against building fronts
        for (let a = TIP_END + 6 + R() * 10; a < AVE_END - 6; a += 18 + R() * 22) {
          const nx = -dir.z, nz = dir.x;
          const p = avePoint(i, a, side * (AVE_HALF - 0.45));
          const ry = Math.atan2(-side * nx, -side * nz);
          const n = 1 + ((R() * 3) | 0);
          for (let k = 0; k < n; k++) {
            const q = avePoint(i, a + k * 1.05, side * (AVE_HALF - 0.45));
            (R() < 0.35 ? vmRed : vending).add(M4(q.x, CURB, q.z, ry));
            addObstacle(q.x, q.z, 0.6);
          }
          this.vmSpots = this.vmSpots || [];
          this.vmSpots.push({ x: p.x - side * nx * 0.6, z: p.z - side * nz * 0.6 });
        }
        // benches + bins
        for (let a = PLAZA_R + 20; a < AVE_END - 10; a += 32) {
          const nx = -dir.z, nz = dir.x;
          const p = avePoint(i, a + 4, side * (ROAD_HALF + 2.8));
          benches.add(M4(p.x, CURB, p.z, yawRoad + Math.PI / 2 * side));
          addObstacle(p.x, p.z, 0.7);
          const b2 = avePoint(i, a + 6.2, side * (ROAD_HALF + 2.8));
          bins.add(M4(b2.x, CURB, b2.z));
          if (R() < 0.3) { const pb = avePoint(i, a + 7.4, side * (ROAD_HALF + 2.8)); posts.add(M4(pb.x, CURB, pb.z)); }
        }
        // manholes on road
        for (let a = RING_OUT + 10; a < AVE_END; a += 23) {
          const p = avePoint(i, a, side * 1.8);
          manholes.add(M4(p.x, 0, p.z));
        }
        // traffic signals at ring crossing
        {
          const nx = -dir.z, nz = dir.x;
          const p = avePoint(i, RING_OUT + 0.6, side * (ROAD_HALF + 0.6));
          // face the ring (toward hub), arm over the road
          const ry = Math.atan2(-side * nx, -side * nz);
          signals.add(M4(p.x, CURB, p.z, ry));
          addObstacle(p.x, p.z, 0.3);
        }
      }
      // guard rails on hub edge between crossings
    }
    // hub: ring of lamps and benches, rails along hub edge except crossings
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2 + Math.PI / 24;
      const x = Math.cos(a) * (HUB_R - 1.6), z = Math.sin(a) * (HUB_R - 1.6);
      if (k % 3 === 1) {
        lamps.add(M4(x, CURB, z, Math.atan2(Math.cos(a), Math.sin(a))));
        addObstacle(x, z, 0.25);
      }
    }
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + Math.PI / 8 + 0.12;
      const x = Math.cos(a) * 12, z = Math.sin(a) * 12;
      benches.add(M4(x, CURB, z, -a));
      addObstacle(x, z, 0.8);
      if (k % 2) {
        const tx = Math.cos(a + 0.2) * 15.5, tz = Math.sin(a + 0.2) * 15.5;
        trees.add(M4(tx, CURB, tz, a, 1.2));
        addObstacle(tx, tz, 0.5);
      }
    }
    // ring road rails on the hub side (with gaps at zebra crossings)
    const RN = 52;
    for (let k = 0; k < RN; k++) {
      const a = (k / RN) * Math.PI * 2;
      let nearAve = false;
      for (let i = 0; i < N_AVE; i++) {
        const da = Math.abs(((a - aveAngle(i) + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (da < (ROAD_HALF + 2.5) / HUB_R) nearAve = true;
      }
      if (nearAve) continue;
      const r = HUB_R - 0.35;
      rails.add(M4(Math.cos(a) * r, CURB, Math.sin(a) * r, -a - Math.PI / 2));
    }

    [lamps, signals, vending, vmRed, trees, bollards, benches, bins, rails, manholes, posts].forEach((s) => s.build(this.group));

    // ---- actual lights (limited): a handful of point lights; rest is faked by light pools ----
    this.buildLightPools(city);
    return this;
  }

  vendingTex() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 320;
    const g = c.getContext('2d');
    g.fillStyle = '#f4f6ff'; g.fillRect(0, 0, 256, 320);
    const cols = ['#e33', '#2a6', '#fc2', '#36c', '#f80', '#8c3', '#c3c', '#3cc'];
    for (let r = 0; r < 4; r++) for (let k = 0; k < 7; k++) {
      const x = 12 + k * 34, y = 16 + r * 76;
      g.fillStyle = cols[(r * 7 + k * 3) % cols.length];
      g.fillRect(x, y, 24, 48);
      g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(x + 3, y + 4, 5, 38);
      g.fillStyle = '#111'; g.fillRect(x, y + 54, 24, 8);
      g.fillStyle = '#3f3'; g.fillRect(x + 8, y + 56, 8, 4);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // additive ground decals for lamp cones + neon spill (cheap "many lights")
  buildLightPools(city) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, fog: true });
    const all = [];
    for (const h of this.lampHeads) all.push({ x: h.x, z: h.z, s: 9, c: new THREE.Color(0xffe2b8).multiplyScalar(0.55) });
    const pal = [0xff2a6d, 0x05d9e8, 0xffe14f, 0x7cff4f, 0xff9f1c, 0xb36bff, 0xffffff, 0xff4fd8];
    for (const s of city.spill) all.push({ x: s.x, z: s.z, s: s.size, c: new THREE.Color(pal[s.color % pal.length]).multiplyScalar(0.3) });
    for (const v of this.vmSpots || []) all.push({ x: v.x, z: v.z, s: 4, c: new THREE.Color(0xdfe8ff).multiplyScalar(0.5) });
    const im = new THREE.InstancedMesh(geo, mat, all.length);
    all.forEach((p, k) => {
      im.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(p.x, CURB + 0.02, p.z), new THREE.Quaternion(), new THREE.Vector3(p.s, 1, p.s)));
      im.setColorAt(k, p.c);
    });
    im.renderOrder = 2;
    this.group.add(im);
    this.pools = im;
  }

  update(t) {
    // simple signal cycle: 20s
    const ph = (t % 20) / 20;
    const green = ph < 0.55, amber = ph >= 0.55 && ph < 0.65;
    this.sigGreen.color.setRGB(green ? 0.2 * 6 : 0.02, green ? 1.0 * 6 : 0.04, green ? 0.7 * 6 : 0.03);
    this.sigAmber.color.setRGB(amber ? 6 : 0.1, amber ? 3 : 0.06, amber ? 0.2 : 0.01);
    this.sigDim.color.setRGB(!green && !amber ? 6 : 0.08, !green && !amber ? 0.4 : 0.02, 0.02);
  }
}
