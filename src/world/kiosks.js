import * as THREE from 'three';
import { makeCanvas } from '../util/qa.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { kioskTexture, bannerTexture, towerTexture, LedStrip } from './textures.js';
import { kioskPose, addObstacle, avePoint, aveDir, PLAZA_R, ROAD_HALF, AVE_HALF, CURB, N_AVE, HUB_R } from './layout.js';
import { glow } from './materials.js';

// Double-sided trend pylons (one per item), district gateways, and the central IMATORE tower.
export class Kiosks {
  constructor(scene, M, districts, top) {
    this.scene = scene; this.M = M; this.districts = districts; this.top = top;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.pickables = [];
    this.animated = [];
    this.lights = [];
  }

  build() {
    const M = this.M;
    const body = new RoundedBoxGeometry(1.7, 3.3, 0.36, 4, 0.06);
    body.translate(0, 1.65 + 0.28, 0);
    const base = new RoundedBoxGeometry(1.9, 0.28, 0.6, 3, 0.05);
    base.translate(0, 0.14, 0);
    const screenGeo = new THREE.PlaneGeometry(1.5, 2.25);
    const trimParts = [];
    for (const sx of [-0.84, 0.84]) for (const sz of [-0.182, 0.182]) { const e = new THREE.BoxGeometry(0.022, 3.0, 0.022); e.translate(sx, 1.93, sz); trimParts.push(e); }
    for (const sz of [-0.182, 0.182]) { const c = new THREE.BoxGeometry(1.66, 0.022, 0.022); c.translate(0, 3.43, sz); trimParts.push(c); }
    const trimGeo = mergeGeometries(trimParts, false);
    this.districts.forEach((d, i) => {
      const edge = glow(d.color, 2.6);
      d.items.forEach((item, k) => {
        const p = kioskPose(i, k);
        const g = new THREE.Group();
        g.position.set(p.x, CURB, p.z);
        g.rotation.y = p.rotY;
        const bm = new THREE.Mesh(body, M.blackGloss);
        bm.castShadow = true; bm.receiveShadow = true;
        g.add(bm);
        const bs = new THREE.Mesh(base, M.metalDark); bs.receiveShadow = true;
        g.add(bs);
        const tex = kioskTexture(item, d, k);
        const sm = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.15, 1.15, 1.15) });
        const front = new THREE.Mesh(screenGeo, sm);
        front.position.set(0, 2.05, 0.185);
        g.add(front);
        const back = new THREE.Mesh(screenGeo, sm);
        back.position.set(0, 2.05, -0.185); back.rotation.y = Math.PI;
        g.add(back);
        // light edges
        // thin LED trims on the corners + top (one merged mesh per kiosk)
        g.add(new THREE.Mesh(trimGeo, edge));
        // floor glow decal
        const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), this.poolMat(d.color));
        pool.rotation.x = -Math.PI / 2; pool.position.y = 0.015;
        g.add(pool);
        // hit box
        const hit = new THREE.Mesh(new THREE.BoxGeometry(1.9, 3.6, 0.8), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.y = 1.9;
        hit.userData = { kind: 'item', district: i, item: k };
        g.add(hit);
        this.pickables.push(hit);
        this.group.add(g);
        addObstacle(p.x, p.z, 1.0);
        item._pos = { x: p.x, z: p.z, rotY: p.rotY };
      });
      this.buildGate(d, i);
    });
    this.buildTower();
    return this;
  }

  poolMat(color) {
    if (!this._poolTex) {
      const [c] = makeCanvas(128, 128);
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.25)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
      this._poolTex = new THREE.CanvasTexture(c);
    }
    return new THREE.MeshBasicMaterial({
      map: this._poolTex, color: new THREE.Color(color).multiplyScalar(0.35), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    });
  }

  // torii-like LED gateway at the mouth of each avenue
  buildGate(d, i) {
    const M = this.M;
    const dir = aveDir(i);
    const at = PLAZA_R + 3;
    const c = avePoint(i, at, 0);
    const yaw = Math.atan2(-dir.x, -dir.z); // faces hub
    const g = new THREE.Group();
    g.position.set(c.x, CURB, c.z);
    g.rotation.y = yaw;
    const span = (AVE_HALF - 0.6) * 2;
    const H = 9.5;
    const colGeo = new THREE.BoxGeometry(0.7, H, 0.7);
    colGeo.translate(0, H / 2, 0);
    for (const s of [-1, 1]) {
      const col = new THREE.Mesh(colGeo, M.metalDark);
      col.position.x = s * span / 2; col.castShadow = true;
      g.add(col);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, H - 0.4, 0.08), glow(d.color, 4));
      strip.position.set(s * span / 2 - s * 0.36, H / 2, 0.36);
      g.add(strip);
      addObstacle(c.x + Math.cos(yaw) * s * span / 2, c.z - Math.sin(yaw) * s * span / 2, 0.7);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 1.2, 2.9, 0.8), M.metalDark);
    beam.position.y = H + 1.2; beam.castShadow = true;
    g.add(beam);
    const hl = [...d.items].sort((a, b) => b.heat - a.heat)[0];
    const tex = bannerTexture(d, hl.title);
    const bm = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.6, 1.6, 1.6) });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(span + 0.8, 2.6), bm);
    face.position.set(0, H + 1.2, 0.41); g.add(face);
    const faceB = face.clone(); faceB.position.z = -0.41; faceB.rotation.y = Math.PI; g.add(faceB);
    // LED ticker under the beam
    const strip = new LedStrip(d.items.map((x) => x.title).join('　◆　'), d.color, 2048, 96);
    const sm = new THREE.MeshBasicMaterial({ map: strip.tex, color: new THREE.Color(2, 2, 2) });
    strip.tex.repeat.set(0.5, 1);
    const tick = new THREE.Mesh(new THREE.PlaneGeometry(span - 0.6, 0.55), sm);
    tick.position.set(0, H - 0.5, 0.41); g.add(tick);
    const tickB = tick.clone(); tickB.position.z = -0.41; tickB.rotation.y = Math.PI; g.add(tickB);
    this.animated.push((t) => { strip.tex.offset.x = (t * 0.035 + i * 0.1) % 1; });
    // gate hit (opens district overview)
    const hit = new THREE.Mesh(new THREE.BoxGeometry(span + 1.2, 3, 1), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = H + 1.2;
    hit.userData = { kind: 'district', district: i };
    g.add(hit);
    this.pickables.push(hit);
    this.group.add(g);
    this.lights.push({ x: c.x, y: H, z: c.z, color: d.color });
  }

  // central tower: stacked holographic rings with scrolling TOP headlines, crystal core, energy beam
  buildTower() {
    const M = this.M;
    const g = new THREE.Group();
    g.position.y = CURB;
    this.tower = g;
    // stepped base / fountain basin
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.5, 0.7, 96, 1, true), M.metalDark);
    basin.position.y = 0.35; basin.receiveShadow = true;
    g.add(basin);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(6.25, 0.14, 12, 128), M.chrome);
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.72; g.add(rim);
    // water surface
    const water = new THREE.Mesh(new THREE.CircleGeometry(6.1, 96), new THREE.MeshPhysicalMaterial({
      color: 0x02060c, roughness: 0.02, metalness: 0.0, clearcoat: 1, envMapIntensity: 2.5, ior: 1.33,
    }));
    water.rotation.x = -Math.PI / 2; water.position.y = 0.55; g.add(water);
    this.water = water;
    // core pillar
    const core = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.0, 46, 48), M.blackGloss);
    core.position.y = 23; core.castShadow = true; g.add(core);
    // vertical light ribs on core
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.06, 44, 0.06), glow(k % 2 ? 0x27e0ff : 0xff4fd8, 3));
      const r = 1.72;
      rib.position.set(Math.cos(a) * r, 23, Math.sin(a) * r);
      rib.rotation.z = Math.atan2(0.6, 46) * 0; g.add(rib);
    }
    // holographic headline rings
    const ttex = towerTexture(this.top);
    const rings = [];
    const specs = [
      { y: 7, r: 4.4, h: 3.4, sp: 0.03 }, { y: 13, r: 3.9, h: 3.0, sp: -0.025 },
      { y: 19, r: 3.5, h: 2.7, sp: 0.02 }, { y: 25, r: 3.1, h: 2.4, sp: -0.018 },
      { y: 31, r: 2.8, h: 2.1, sp: 0.016 }, { y: 37, r: 2.5, h: 1.8, sp: -0.014 },
    ];
    specs.forEach((s, k) => {
      const tex = ttex.clone();
      tex.needsUpdate = true;
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.set(2, 1 / 6);
      tex.offset.set(0, 1 - (k + 1) / 6);
      const m = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
        color: new THREE.Color(2.2, 2.2, 2.2),
      });
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(s.r, s.r, s.h, 128, 1, true), m);
      ring.position.y = s.y;
      g.add(ring);
      // thin chrome halo rings above/below
      for (const dy of [-s.h / 2 - 0.12, s.h / 2 + 0.12]) {
        const hr = new THREE.Mesh(new THREE.TorusGeometry(s.r, 0.035, 6, 160), glow(0xbfefff, 2.5));
        hr.rotation.x = Math.PI / 2; hr.position.y = s.y + dy; g.add(hr);
      }
      rings.push({ tex, sp: s.sp });
    });
    this.rings = rings;
    // crown: IMATORE logo ring + light beam
    const [logoC] = makeCanvas(2048, 256);
    const lg = logoC.getContext('2d');
    lg.fillStyle = '#000'; lg.fillRect(0, 0, 2048, 256);
    lg.font = '900 170px Orbitron, sans-serif'; lg.textBaseline = 'middle'; lg.textAlign = 'center';
    for (let k = 0; k < 2; k++) {
      const gr = lg.createLinearGradient(k * 1024, 0, k * 1024 + 1024, 0);
      gr.addColorStop(0, '#27e0ff'); gr.addColorStop(0.5, '#ff4fd8'); gr.addColorStop(1, '#ffe14f');
      lg.fillStyle = gr;
      lg.fillText(k ? '今トレ' : 'IMATORE', k * 1024 + 512, 134);
    }
    const lt = new THREE.CanvasTexture(logoC); lt.colorSpace = THREE.SRGBColorSpace; lt.anisotropy = 8;
    const logo = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.0, 2.4, 96, 1, true), new THREE.MeshBasicMaterial({
      map: lt, color: new THREE.Color(2.6, 2.6, 2.6), side: THREE.FrontSide,
    }));
    logo.position.y = 47.5; g.add(logo);
    this.logo = logo;
    const crown = new THREE.Mesh(new THREE.ConeGeometry(1.3, 9, 32), M.chrome);
    crown.position.y = 53.3; g.add(crown);
    // skyward beam
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: /* glsl */ `uniform float uTime; varying vec2 vUv;
        void main(){ float e = pow(1.0-abs(vUv.x-0.5)*2.0, 3.0); float f = pow(1.0-vUv.y, 1.6);
          float pulse = 0.75 + 0.25*sin(vUv.y*40.0 - uTime*4.0);
          gl_FragColor = vec4(vec3(0.35,0.8,1.0)*2.0*e*f*pulse, e*f*0.5); }`,
    });
    this.beamMat = beamMat;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.2, 600, 16, 1, true), beamMat);
    beam.position.y = 58 + 300; g.add(beam);
    // floating holo orbit particles
    const N = 900;
    const pos = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) {
      const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 8, y = 1 + Math.random() * 44;
      pos.set([Math.cos(a) * r, y, Math.sin(a) * r], k * 3);
    }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(pg, new THREE.PointsMaterial({
      size: 0.09, color: new THREE.Color(0.6, 1.6, 2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    g.add(pts);
    this.orbit = pts;
    // light onto plaza
    const pl = new THREE.PointLight(0x5fd8ff, 60, 34, 1.6);
    pl.position.set(0, 4, 0); g.add(pl);
    this.group.add(g);
    // tower hit
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 44, 12), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 22;
    hit.userData = { kind: 'top' };
    g.add(hit);
    this.pickables.push(hit);
  }

  update(t, dt) {
    for (const f of this.animated) f(t);
    if (this.rings) this.rings.forEach((r) => { r.tex.offset.x = (r.tex.offset.x + r.sp * dt) % 1; });
    if (this.logo) this.logo.rotation.y = t * 0.25;
    if (this.orbit) this.orbit.rotation.y = t * 0.05;
    if (this.beamMat) this.beamMat.uniforms.uTime.value = t;
  }
}
