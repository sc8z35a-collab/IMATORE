import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './textures.js';
import { makeCanvas } from '../util/qa.js';
import {
  avePoint, aveDir, PLAZA_R, TIP_END, AVE_END, AVE_HALF, ROAD_HALF, N_AVE, CURB, HUB_R, RING_IN, RING_OUT,
} from './layout.js';

// "City life" layer: GPU-animated crowds with umbrellas, traffic on the ring + avenues,
// overhead power lines, chōchin lanterns and floating X-trend holograms.
// Everything is instanced and animated in the vertex shader so the CPU cost is ~0.

const PED_PER_AVE = 150;
const HUB_PEDS = 140;
const CARS_RING = 26;
const CARS_AVE = 7;

// ---------- pedestrians ----------
// Each instance has: aPath (x0,z0,x1,z1), aParam (speed, phase, height, umbrella?), aColor
function pedGeometry() {
  // stylised human ~1.7 m: legs, torso, head (low poly, but reads fine at night with rim light)
  const legL = new THREE.BoxGeometry(0.14, 0.82, 0.16); legL.translate(-0.09, 0.41, 0);
  const legR = new THREE.BoxGeometry(0.14, 0.82, 0.16); legR.translate(0.09, 0.41, 0);
  const torso = new THREE.CapsuleGeometry(0.2, 0.42, 4, 8); torso.translate(0, 1.13, 0);
  const head = new THREE.SphereGeometry(0.115, 10, 8); head.translate(0, 1.58, 0);
  const bag = new THREE.BoxGeometry(0.1, 0.28, 0.24); bag.translate(0.26, 0.95, 0);
  // tag parts via a "part" attribute: 0 leg L, 1 leg R, 2 body, 3 head, 4 bag
  const parts = [legL, legR, torso, head, bag].map((g, k) => {
    const q = g.index ? g.toNonIndexed() : g;
    q.setAttribute('part', new THREE.Float32BufferAttribute(new Float32Array(q.attributes.position.count).fill(k), 1));
    return q;
  });
  return mergeGeometries(parts, false);
}
function umbrellaGeometry() {
  const canopy = new THREE.ConeGeometry(0.55, 0.26, 12, 1, true); canopy.translate(0, 2.02, 0);
  const shaft = new THREE.CylinderGeometry(0.012, 0.012, 0.75, 4); shaft.translate(0, 1.64, 0);
  return mergeGeometries([canopy.toNonIndexed(), shaft.toNonIndexed()], false);
}

const pedVS = /* glsl */ `
  attribute vec4 aPath; attribute vec4 aParam; attribute vec3 aColor; attribute float part;
  uniform float uTime;
  varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying float vPart;
  void main(){
    float spd = aParam.x, ph = aParam.y, hs = aParam.z;
    vec2 A = aPath.xy, B = aPath.zw;
    float L = length(B - A);
    // ping-pong along the path
    float s = fract((uTime * spd + ph) / (2.0 * L)) * 2.0;
    float dirSign = s < 1.0 ? 1.0 : -1.0;
    float u = s < 1.0 ? s : 2.0 - s;
    vec2 P = mix(A, B, u);
    vec2 D = normalize(B - A) * dirSign;
    float yaw = atan(D.x, D.y);
    vec3 p = position;
    // walk cycle
    float cyc = uTime * spd * 3.4 + ph * 7.0;
    if (part < 0.5) { p.z += sin(cyc) * 0.22 * step(p.y, 0.8); p.y -= max(0.0, -cos(cyc)) * 0.04; }
    else if (part < 1.5) { p.z += sin(cyc + 3.14159) * 0.22 * step(p.y, 0.8); }
    float bob = abs(sin(cyc)) * 0.035;
    p.y = p.y * hs + bob;
    float c = cos(yaw), sn = sin(yaw);
    vec3 w = vec3(p.x * c + p.z * sn, p.y, -p.x * sn + p.z * c) + vec3(P.x, ${CURB.toFixed(3)}, P.y);
    vec3 n = normal; n = vec3(n.x * c + n.z * sn, n.y, -n.x * sn + n.z * c);
    vN = n; vW = w; vPart = part;
    vCol = part > 2.5 && part < 3.5 ? vec3(0.55, 0.42, 0.34) : aColor;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }`;
const umbVS = /* glsl */ `
  attribute vec4 aPath; attribute vec4 aParam; attribute vec3 aColor;
  uniform float uTime;
  varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying float vPart;
  void main(){
    float spd = aParam.x, ph = aParam.y, hs = aParam.z;
    vec2 A = aPath.xy, B = aPath.zw; float L = length(B - A);
    float s = fract((uTime * spd + ph) / (2.0 * L)) * 2.0;
    float u = s < 1.0 ? s : 2.0 - s;
    vec2 P = mix(A, B, u);
    float cyc = uTime * spd * 3.4 + ph * 7.0;
    vec3 p = position; p.y = p.y * hs + abs(sin(cyc)) * 0.035;
    // hide if no umbrella
    p *= step(0.5, aParam.w);
    vec3 w = p + vec3(P.x + 0.05, ${CURB.toFixed(3)}, P.y);
    vN = normal; vW = w; vPart = 9.0;
    vCol = aColor;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }`;
const pedFS = /* glsl */ `
  uniform vec3 uCam; uniform vec3 uFogColor; uniform float uFogDensity;
  varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying float vPart;
  void main(){
    vec3 N = normalize(vN);
    vec3 V = normalize(uCam - vW);
    // night lighting: cool sky from above, warm street bounce, neon rim
    float up = N.y * 0.5 + 0.5;
    vec3 amb = mix(vec3(0.05, 0.04, 0.06), vec3(0.09, 0.11, 0.18), up);
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);
    vec3 rimC = mix(vec3(1.0, 0.35, 0.85), vec3(0.2, 0.85, 1.0), fract(vW.x * 0.013 + vW.z * 0.011)) * 0.55;
    vec3 col = vCol * (amb * 2.4 + 0.05) + rimC * rim;
    if (vPart > 8.5) { // umbrella: translucent-ish, catches light
      col = vCol * 0.28 + rimC * rim * 1.2 + vec3(0.02);
    }
    float d = length(uCam - vW);
    float f = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
    gl_FragColor = vec4(mix(col, uFogColor, f), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// ---------- cars ----------
function carGeometry() {
  const body = new THREE.BoxGeometry(1.8, 0.62, 4.4); body.translate(0, 0.55, 0);
  const cabin = new THREE.BoxGeometry(1.6, 0.52, 2.3); cabin.translate(0, 1.1, -0.2);
  const parts = [body.toNonIndexed(), cabin.toNonIndexed()];
  const wheels = [];
  for (const sx of [-0.86, 0.86]) for (const sz of [-1.4, 1.4]) {
    const w = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12); w.rotateZ(Math.PI / 2); w.translate(sx, 0.34, sz); wheels.push(w.toNonIndexed());
  }
  const g = mergeGeometries([...parts, ...wheels], false);
  const n = g.attributes.position.count;
  const pa = new Float32Array(n);
  // part id: body 0, cabin 1, wheels 2
  let o = 0;
  const cnt = [parts[0].attributes.position.count, parts[1].attributes.position.count];
  for (let i = 0; i < n; i++) pa[i] = i < cnt[0] ? 0 : i < cnt[0] + cnt[1] ? 1 : 2;
  g.setAttribute('part', new THREE.Float32BufferAttribute(pa, 1));
  return g;
}
function lampGeometry() {
  // head lights (front, white) + tail lights (back, red) as small quads; part 0 = head, 1 = tail
  const q = [];
  for (const sx of [-0.62, 0.62]) {
    const h = new THREE.PlaneGeometry(0.34, 0.14); h.translate(sx, 0.66, 2.205); q.push(h.toNonIndexed());
    const t = new THREE.PlaneGeometry(0.36, 0.12); t.rotateY(Math.PI); t.translate(sx, 0.7, -2.205); q.push(t.toNonIndexed());
  }
  const g = mergeGeometries(q, false);
  const n = g.attributes.position.count, pa = new Float32Array(n);
  const per = q[0].attributes.position.count;
  for (let i = 0; i < n; i++) pa[i] = Math.floor(i / per) % 2;
  g.setAttribute('part', new THREE.Float32BufferAttribute(pa, 1));
  return g;
}
// car path kinds: ring (circle radius r, angular speed) or line (A->B looping)
const carVS = (lamp) => /* glsl */ `
  attribute vec4 aPath; attribute vec4 aParam; attribute vec3 aColor; attribute float part;
  uniform float uTime;
  varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying float vPart;
  void main(){
    float kind = aParam.x, spd = aParam.y, ph = aParam.z;
    vec2 P; float yaw;
    if (kind < 0.5) {
      // ring: aPath.x = radius, direction = aParam.w
      float a = ph + uTime * spd / aPath.x * aParam.w;
      P = vec2(cos(a), sin(a)) * aPath.x;
      vec2 T = vec2(-sin(a), cos(a)) * aParam.w;
      yaw = atan(T.x, T.y);
    } else {
      vec2 A = aPath.xy, B = aPath.zw; float L = length(B - A);
      float u = fract((uTime * spd + ph) / L);
      P = mix(A, B, u);
      vec2 D = normalize(B - A); yaw = atan(D.x, D.y);
    }
    vec3 p = position;
    float c = cos(yaw), s = sin(yaw);
    vec3 w = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c) + vec3(P.x, 0.0, P.y);
    vec3 n = normal; vN = vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
    vW = w; vPart = part; vCol = aColor;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }`;
const carFS = /* glsl */ `
  uniform vec3 uCam; uniform vec3 uFogColor; uniform float uFogDensity;
  varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying float vPart;
  void main(){
    vec3 N = normalize(vN); vec3 V = normalize(uCam - vW);
    float up = N.y * 0.5 + 0.5;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    vec3 col;
    if (vPart > 1.5) col = vec3(0.015);
    else if (vPart > 0.5) col = vec3(0.02, 0.025, 0.035) + fres * vec3(0.5, 0.6, 0.8); // glass
    else col = vCol * mix(0.05, 0.22, up) + fres * vec3(0.35, 0.4, 0.55) + vec3(0.9,0.5,1.0) * pow(max(N.y,0.0),16.0) * 0.08;
    float d = length(uCam - vW);
    float f = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
    gl_FragColor = vec4(mix(col, uFogColor, f), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const lampFS = /* glsl */ `
  uniform vec3 uCam; uniform float uFogDensity;
  varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying float vPart;
  void main(){
    vec3 col = vPart < 0.5 ? vec3(6.0, 5.6, 4.8) : vec3(5.0, 0.25, 0.15);
    float d = length(uCam - vW);
    float f = exp(-uFogDensity * uFogDensity * d * d * 0.5);
    gl_FragColor = vec4(col * f, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function instanced(geo, n, attrs) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = geo.index;
  for (const k of Object.keys(geo.attributes)) g.setAttribute(k, geo.attributes[k]);
  for (const [k, [arr, size]] of Object.entries(attrs)) g.setAttribute(k, new THREE.InstancedBufferAttribute(arr, size));
  g.instanceCount = n;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 600);
  return g;
}

export class CityLife {
  constructor(scene, districts, xTrends = []) {
    this.scene = scene; this.districts = districts; this.xTrends = xTrends;
    this.group = new THREE.Group(); this.group.name = 'life';
    scene.add(this.group);
    this.U = {
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() },
      uFogColor: { value: new THREE.Color(0x0b0f1c) }, uFogDensity: { value: 0.0068 },
    };
    this.R = rng(4242);
    this.holos = [];
  }

  build() {
    this.buildCrowd();
    this.buildTraffic();
    this.buildWires();
    this.buildLanterns();
    this.buildHolograms();
    return this;
  }

  buildCrowd() {
    const R = this.R;
    const paths = [];
    // sidewalk lanes along each avenue (both sides) + a few crossing the pedestrian street
    for (let i = 0; i < N_AVE; i++) {
      for (let k = 0; k < PED_PER_AVE; k++) {
        const side = R() < 0.5 ? -1 : 1;
        const lane = ROAD_HALF + 0.7 + R() * (AVE_HALF - ROAD_HALF - 1.6);
        const a0 = PLAZA_R + 2 + R() * (AVE_END - PLAZA_R - 30);
        const len = 14 + R() * 40;
        const A = avePoint(i, a0, side * lane), B = avePoint(i, Math.min(AVE_END - 8, a0 + len), side * (lane + (R() - 0.5) * 0.8));
        paths.push([A, B]);
      }
    }
    // hub: people strolling around / across the plaza
    for (let k = 0; k < HUB_PEDS; k++) {
      const a = R() * Math.PI * 2, b = a + (R() - 0.5) * 2.2;
      const r0 = 7.5 + R() * (HUB_R - 9.5), r1 = 7.5 + R() * (HUB_R - 9.5);
      paths.push([{ x: Math.cos(a) * r0, z: Math.sin(a) * r0 }, { x: Math.cos(b) * r1, z: Math.sin(b) * r1 }]);
    }
    const n = paths.length;
    const aPath = new Float32Array(n * 4), aParam = new Float32Array(n * 4), aColor = new Float32Array(n * 3), uColor = new Float32Array(n * 3);
    const cloth = [[0.08, 0.08, 0.09], [0.16, 0.16, 0.18], [0.35, 0.33, 0.3], [0.12, 0.14, 0.22], [0.5, 0.48, 0.45], [0.3, 0.1, 0.1], [0.55, 0.55, 0.58], [0.2, 0.25, 0.18]];
    const umb = [[0.9, 0.92, 0.95], [0.05, 0.05, 0.06], [0.9, 0.2, 0.35], [0.2, 0.55, 0.95], [0.95, 0.8, 0.2], [0.85, 0.85, 0.9]];
    paths.forEach(([A, B], k) => {
      aPath.set([A.x, A.z, B.x, B.z], k * 4);
      aParam.set([0.9 + R() * 0.7, R() * 100, 0.92 + R() * 0.16, R() < 0.55 ? 1 : 0], k * 4);
      aColor.set(cloth[(R() * cloth.length) | 0], k * 3);
      // clear plastic umbrellas (ビニール傘) dominate in Japan
      uColor.set(R() < 0.55 ? umb[0] : umb[(R() * umb.length) | 0], k * 3);
    });
    const mat = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: pedVS, fragmentShader: pedFS });
    const g = instanced(pedGeometry(), n, { aPath: [aPath, 4], aParam: [aParam, 4], aColor: [aColor, 3] });
    const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.name = 'crowd';
    this.group.add(mesh);
    const umat = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: umbVS, fragmentShader: pedFS, side: THREE.DoubleSide });
    const ug = instanced(umbrellaGeometry(), n, { aPath: [aPath, 4], aParam: [aParam, 4], aColor: [uColor, 3] });
    const um = new THREE.Mesh(ug, umat); um.frustumCulled = false; um.name = 'umbrellas';
    this.group.add(um);
    this.crowd = mesh; this.umbrellas = um;
    this.pedCount = n;
  }

  buildTraffic() {
    const R = this.R;
    const cars = [];
    // ring road: two lanes, counter-clockwise (Japan drives on the left => CCW seen from above is clockwise?).
    // Our ring is traversed in +a direction for the outer lane and -a for the inner lane.
    for (let k = 0; k < CARS_RING; k++) {
      const outer = k % 2 === 0;
      const r = outer ? RING_OUT - 2.2 : RING_IN + 2.2;
      cars.push({ kind: 0, path: [r, 0, 0, 0], spd: 6 + R() * 5, ph: R() * Math.PI * 2, dir: outer ? 1 : -1 });
    }
    // avenues: one lane each way, keep left
    for (let i = 0; i < N_AVE; i++) {
      for (let k = 0; k < CARS_AVE; k++) {
        const out = k % 2 === 0;
        const s = out ? -1.9 : 1.9; // left-hand traffic
        const A = avePoint(i, out ? RING_OUT + 1 : AVE_END - 8, s), B = avePoint(i, out ? AVE_END - 8 : RING_OUT + 1, s);
        cars.push({ kind: 1, path: [A.x, A.z, B.x, B.z], spd: 5 + R() * 5, ph: R() * 400, dir: 1 });
      }
    }
    const n = cars.length;
    const aPath = new Float32Array(n * 4), aParam = new Float32Array(n * 4), aColor = new Float32Array(n * 3);
    // Japanese car palette: lots of white/pearl, black, silver, the odd taxi yellow / deep red
    const pal = [[0.85, 0.86, 0.88], [0.85, 0.86, 0.88], [0.03, 0.03, 0.035], [0.45, 0.47, 0.5], [0.9, 0.7, 0.15], [0.45, 0.03, 0.05], [0.1, 0.2, 0.35], [0.1, 0.35, 0.2]];
    cars.forEach((c, k) => {
      aPath.set(c.path, k * 4);
      aParam.set([c.kind, c.spd, c.ph, c.dir], k * 4);
      aColor.set(pal[(R() * pal.length) | 0], k * 3);
    });
    const attrs = { aPath: [aPath, 4], aParam: [aParam, 4], aColor: [aColor, 3] };
    const body = new THREE.Mesh(instanced(carGeometry(), n, attrs), new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: carVS(false), fragmentShader: carFS }));
    body.frustumCulled = false; body.name = 'cars';
    const lamps = new THREE.Mesh(instanced(lampGeometry(), n, attrs), new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: carVS(true), fragmentShader: lampFS, side: THREE.DoubleSide }));
    lamps.frustumCulled = false; lamps.name = 'carLamps';
    this.group.add(body, lamps);
    this.cars = body; this.carLamps = lamps; this.carCount = n;
  }

  // sagging overhead utility wires between telegraph poles along the building line (very Tokyo)
  buildWires() {
    const R = this.R;
    const pts = [];
    const poles = [];
    for (let i = 0; i < N_AVE; i++) {
      for (const side of [-1, 1]) {
        const lat = side * (AVE_HALF - 0.35);
        let prev = null;
        for (let a = TIP_END + 4; a < AVE_END - 4; a += 22 + R() * 6) {
          const p = avePoint(i, a, lat);
          poles.push(p);
          if (prev) {
            for (let w = 0; w < 4; w++) {
              const h0 = 7.6 + w * 0.32;
              const sag = 0.55 + w * 0.08;
              const N = 10;
              for (let k = 0; k < N; k++) {
                const t0 = k / N, t1 = (k + 1) / N;
                const y0 = h0 - Math.sin(t0 * Math.PI) * sag, y1 = h0 - Math.sin(t1 * Math.PI) * sag;
                const o = (w - 1.5) * 0.18 * side;
                const x0 = prev.x + (p.x - prev.x) * t0, z0 = prev.z + (p.z - prev.z) * t0;
                const x1 = prev.x + (p.x - prev.x) * t1, z1 = prev.z + (p.z - prev.z) * t1;
                pts.push(x0 + o * 0, y0, z0, x1, y1, z1);
              }
            }
            // cross-street drop to the other side every other span
            if (R() < 0.35) {
              const q = avePoint(i, a - 6, -lat);
              const N = 12;
              for (let k = 0; k < N; k++) {
                const t0 = k / N, t1 = (k + 1) / N;
                const y0 = 7.9 - Math.sin(t0 * Math.PI) * 0.9, y1 = 7.9 - Math.sin(t1 * Math.PI) * 0.9;
                pts.push(p.x + (q.x - p.x) * t0, y0, p.z + (q.z - p.z) * t0, p.x + (q.x - p.x) * t1, y1, p.z + (q.z - p.z) * t1);
              }
            }
          }
          prev = p;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x0a0b0e, transparent: true, opacity: 0.85, fog: true }));
    lines.name = 'wires';
    this.group.add(lines);
    // concrete poles with transformer boxes + crossarms
    const pole = new THREE.CylinderGeometry(0.13, 0.17, 8.6, 8); pole.translate(0, 4.3, 0);
    const arm = new THREE.BoxGeometry(1.2, 0.08, 0.08); arm.translate(0, 7.9, 0);
    const arm2 = new THREE.BoxGeometry(0.9, 0.07, 0.07); arm2.translate(0, 7.3, 0);
    const trans = new THREE.CylinderGeometry(0.22, 0.22, 0.7, 10); trans.translate(0.3, 6.4, 0);
    const pg = mergeGeometries([pole.toNonIndexed(), arm.toNonIndexed(), arm2.toNonIndexed(), trans.toNonIndexed()], false);
    const pm = new THREE.MeshStandardMaterial({ color: 0x77787a, roughness: 0.85, metalness: 0.1 });
    const im = new THREE.InstancedMesh(pg, pm, poles.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    poles.forEach((p, k) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(p.x, p.z)); m.compose(new THREE.Vector3(p.x, CURB, p.z), q, new THREE.Vector3(1, 1, 1)); im.setMatrixAt(k, m); });
    im.castShadow = true; im.name = 'poles';
    this.group.add(im);
  }

  // red / white chōchin paper lanterns strung across the first stretch of each avenue (祭り feel for 中秋)
  buildLanterns() {
    const R = this.R;
    const lg = new THREE.SphereGeometry(0.24, 12, 10); lg.scale(1, 1.35, 1);
    const cap = new THREE.CylinderGeometry(0.13, 0.13, 0.05, 10);
    const mats = [];
    const lanterns = [];
    const string = [];
    for (let i = 0; i < N_AVE; i++) {
      const d = this.districts[i];
      for (let a = PLAZA_R + 10; a < TIP_END + 14; a += 7) {
        const A = avePoint(i, a, -(AVE_HALF - 0.6)), B = avePoint(i, a, AVE_HALF - 0.6);
        const N = 9;
        for (let k = 0; k <= N; k++) {
          const t = k / N;
          const y = 6.2 - Math.sin(t * Math.PI) * 0.8;
          const x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t;
          if (k < N) {
            const t1 = (k + 1) / N, y1 = 6.2 - Math.sin(t1 * Math.PI) * 0.8;
            string.push(x, y + 0.34, z, A.x + (B.x - A.x) * t1, y1 + 0.34, A.z + (B.z - A.z) * t1);
          }
          if (k === 0 || k === N) continue;
          lanterns.push({ x, y, z, c: k % 2 ? d.color : '#ff2a2a', ph: R() * 6.28 });
        }
      }
    }
    const n = lanterns.length;
    const col = new Float32Array(n * 3);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true });
    const im = new THREE.InstancedMesh(lg, mat, n);
    const capM = new THREE.InstancedMesh(cap, new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }), n * 2);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    lanterns.forEach((l, k) => {
      m.makeTranslation(l.x, l.y, l.z); im.setMatrixAt(k, m);
      c.set(l.c).multiplyScalar(2.2); im.setColorAt(k, c);
      m.makeTranslation(l.x, l.y + 0.3, l.z); capM.setMatrixAt(k * 2, m);
      m.makeTranslation(l.x, l.y - 0.3, l.z); capM.setMatrixAt(k * 2 + 1, m);
    });
    im.name = 'lanterns'; capM.name = 'lanternCaps';
    this.group.add(im, capM);
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(string, 3));
    this.group.add(new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: 0x151515 })));
    this.lanterns = im; this.lanternData = lanterns;
  }

  // floating holographic hashtags (X trend words) drifting above the hub and avenue mouths
  buildHolograms() {
    const words = this.xTrends.slice(0, 36);
    if (!words.length) return;
    const W = 1024, H = 96 * Math.ceil(words.length / 2);
    const [cv, g] = makeCanvas(W, H);
    g.clearRect(0, 0, W, H);
    const rowH = 96;
    words.forEach((w, k) => {
      const x = (k % 2) * 512, y = Math.floor(k / 2) * rowH;
      g.font = '900 52px "Noto Sans JP", sans-serif';
      g.textBaseline = 'middle';
      const txt = w.startsWith('#') ? w : '# ' + w;
      g.shadowColor = 'rgba(80,220,255,0.9)'; g.shadowBlur = 16;
      g.fillStyle = '#ffffff';
      let fs = 52; while (g.measureText(txt).width > 480 && fs > 20) { fs -= 4; g.font = `900 ${fs}px "Noto Sans JP", sans-serif`; }
      g.fillText(txt, x + 16, y + rowH / 2);
      g.shadowBlur = 0;
    });
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const rows = Math.ceil(words.length / 2);
    const R = this.R;
    const pal = ['#27e0ff', '#ff4fd8', '#ffe14f', '#7cff4f', '#b36bff', '#ff9f1c'];
    words.forEach((w, k) => {
      const u0 = (k % 2) * 0.5, v0 = 1 - (Math.floor(k / 2) + 1) / rows;
      const geo = new THREE.PlaneGeometry(6, 6 * (96 / 512));
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.5, v0 + uv.getY(i) / rows);
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(pal[k % pal.length]).multiplyScalar(1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true });
      const m = new THREE.Mesh(geo, mat);
      const a = R() * Math.PI * 2, r = 9 + R() * 11, y = 5.5 + R() * 13;
      m.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      m.userData = { a, r, y, sp: (R() < 0.5 ? -1 : 1) * (0.02 + R() * 0.03), bob: R() * 6 };
      m.renderOrder = 6;
      this.group.add(m);
      this.holos.push(m);
    });
  }

  update(t, cam, scene) {
    this.U.uTime.value = t;
    this.U.uCam.value.copy(cam.position);
    if (scene.fog) { this.U.uFogColor.value.copy(scene.fog.color); this.U.uFogDensity.value = scene.fog.density; }
    for (const h of this.holos) {
      const u = h.userData;
      const a = u.a + t * u.sp;
      h.position.set(Math.cos(a) * u.r, u.y + Math.sin(t * 0.6 + u.bob) * 0.35, Math.sin(a) * u.r);
      h.lookAt(cam.position.x, h.position.y, cam.position.z);
      h.material.opacity = 0.75 + Math.sin(t * 3 + u.bob) * 0.12;
    }
  }
}
