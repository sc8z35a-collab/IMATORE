import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './textures.js';
import { Q, LITE } from '../settings.js';

// =====================================================================================================
//  Outer landscape ("マップ外の景観") — everything beyond the walkable hub, out to ~4.5 km.
//
//  The previous world ended at a ring of textured towers at r≈190-360 m and fog. This module quadruples
//  (and more) the visible extent with a believable Tokyo-bay megacity:
//
//    r 345-2600  far city: ~5k instanced buildings (1 draw call) with procedural night windows in the
//                shader (floor-coherent lit runs, shop bands, LED crowns, glass towers), skyscraper clusters
//    r 430       elevated expressway ring (首都高) on pillars with streams of head/tail lights
//    r 560       elevated loop railway (山手線-like) with two lit trains
//    SE          Tokyo Bay: moon-glitter water, suspension bridge with lit cables, port cranes, ships,
//                light reflections streaking across the water, far shore lights
//    landmarks   lattice tower (orange, 東京タワー風) + 570 m broadcast tower (スカイツリー風)
//    horizon     mountain ranges with a snow-capped Fuji under the moon, suburban light carpet
//    sky         aircraft on approach with strobes, sweeping searchlights
//
//  Everything uses small custom shaders that share one "haze" function (aerial perspective toward the
//  light-polluted horizon colour) instead of the near-city FogExp2, so distant lights stay visible.
// =====================================================================================================

const TAU = Math.PI * 2;
import { PLAT_H } from './layout.js';
export const GY = -PLAT_H;          // lower-city ground level (the hub platform is at y≈0)
const WY = GY - 1.2;                // water level
// shared uniforms (time, haze, moon)
export const LU = {
  uTime: { value: 0 },
  uHaze: { value: new THREE.Color(0.19, 0.11, 0.17) },
  uHazeDen: { value: 0.00062 },
  uMoon: { value: new THREE.Vector3(0.42, 0.36, 0.83).normalize() },
  uPx: { value: 400 },             // pixels per radian-ish: drawingBufferHeight / (2 tan(fov/2))
};

const HAZE_GLSL = /* glsl */ `
  uniform vec3 uHaze; uniform float uHazeDen; uniform float uTime; uniform vec3 uMoon;
  float lhash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
  vec3 applyHaze(vec3 col, vec3 wp){
    float d = length(wp - cameraPosition);
    float f = 1.0 - exp(-d * uHazeDen);
    // light pollution sits low: high things (tower tops, mountains) are less veiled but fade to a darker sky
    float hk = exp(-max(wp.y, 0.0) / 320.0);
    f *= mix(0.62, 1.0, hk);
    vec3 hz = mix(uHaze * 0.45, uHaze, hk);
    return mix(col, hz, clamp(f, 0.0, 1.0));
  }`;

// ---------------- geography ----------------
// The bay opens to the south-south-east, right under the moon (so the moon's glitter path lies on the water).
export const BAY_DIR = new THREE.Vector2(0.0, 1.0);
const COAST0 = 800;
function bayCoords(x, z) {
  const along = x * BAY_DIR.x + z * BAY_DIR.y;
  const lat = -x * BAY_DIR.y + z * BAY_DIR.x;
  return { along, lat };
}
function coastNoise(lat) { return Math.sin(lat * 0.011) * 38 + Math.sin(lat * 0.031 + 1.3) * 16 + Math.sin(lat * 0.0047 + 4.0) * 60; }
export function waterDepth(x, z) {
  // > 0 inside the bay (metres past the shoreline)
  const { along, lat } = bayCoords(x, z);
  return along - (COAST0 + (lat * lat) / 1400 + coastNoise(lat));
}
const COAST_GLSL = /* glsl */ `
  const vec2 BAY_DIR = vec2(${BAY_DIR.x.toFixed(5)}, ${BAY_DIR.y.toFixed(5)});
  float waterDepth(vec2 p){
    float along = dot(p, BAY_DIR);
    float lat = -p.x*BAY_DIR.y + p.y*BAY_DIR.x;
    float cn = sin(lat*0.011)*38.0 + sin(lat*0.031+1.3)*16.0 + sin(lat*0.0047+4.0)*60.0;
    return along - (${COAST0.toFixed(1)} + lat*lat/1400.0 + cn);
  }`;
const bayPoint = (along, lat) => ({ x: along * BAY_DIR.x - lat * BAY_DIR.y, z: along * BAY_DIR.y + lat * BAY_DIR.x });

// river (隅田川-like) meandering from the north-east hills into the bay
const RIVER = (() => {
  const pts = [];
  for (let k = 0; k <= 40; k++) {
    const t = k / 40;
    const along = -900 + t * 1900; // ends inside the bay
    const lat = -470 + Math.sin(t * 5.2) * 110 + t * 60;
    pts.push(bayPoint(along, lat));
  }
  return pts;
})();
function riverDist(x, z) {
  let best = 1e9;
  for (let k = 0; k < RIVER.length - 1; k++) {
    const a = RIVER[k], b = RIVER[k + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const ex = a.x + dx * t - x, ez = a.z + dz * t - z;
    best = Math.min(best, ex * ex + ez * ez);
  }
  return Math.sqrt(best);
}

export const EXPRESS_R = 430;
export const RAIL_R = 560;
// the bridge spans the bay across its width
const BRIDGE_ALONG = 1060, BRIDGE_HALF = 660;
const BRIDGE_W = bayPoint(BRIDGE_ALONG, -BRIDGE_HALF), BRIDGE_E = bayPoint(BRIDGE_ALONG, BRIDGE_HALF);
const polar = (deg, r) => ({ x: Math.cos((deg * Math.PI) / 180) * r, z: Math.sin((deg * Math.PI) / 180) * r });
export const LANDMARKS = {
  // each landmark closes the vista of one avenue (seen under / above the giant end-gate screens)
  lattice: { ...polar(135, 720), h: 333, name: 'TOKYO TOWER' },   // avenue 5
  skytree: { ...polar(-45, 1500), h: 634, name: 'SKYTREE' },      // avenue 1
  wheel: { ...polar(45, 980), h: 115, name: 'FERRIS WHEEL' },     // avenue 3
  fuji: { ...polar(180, 4700), h: 820, name: 'MT. FUJI' },        // avenue 6
};
// skyscraper clusters: {deg, r, sigma, amp}
export const CLUSTERS = [
  { deg: -135, r: 950, s: 190, amp: 200, name: '新宿' },    // avenue 7 vista
  { deg: 62, r: 640, s: 120, amp: 150, name: '汐留' },
  { deg: -90, r: 1400, s: 150, amp: 140, name: '池袋' },    // avenue 0 vista
  { deg: 118, r: 760, s: 120, amp: 120, name: '渋谷' },
  { deg: -20, r: 820, s: 130, amp: 90, name: '上野' },
  { deg: 20, r: 1500, s: 200, amp: 110, name: '幕張' },
];
for (const c of CLUSTERS) Object.assign(c, polar(c.deg, c.r));

function segDist(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
}
// expressway spur from the ring to the west bridge abutment
const SPUR_A = (() => { const L = Math.hypot(BRIDGE_W.x, BRIDGE_W.z); return { x: (BRIDGE_W.x / L) * EXPRESS_R, z: (BRIDGE_W.z / L) * EXPRESS_R }; })();
const EAST_END = bayPoint(BRIDGE_ALONG - 260, BRIDGE_HALF + 900);

export function isFree(x, z, margin = 0) {
  const r = Math.hypot(x, z);
  if (r < 224) return false;
  if (waterDepth(x, z) > -18 - margin) return false;
  if (Math.abs(r - EXPRESS_R) < 13 + margin) return false;
  if (Math.abs(r - RAIL_R) < 9 + margin) return false;
  if (segDist(x, z, SPUR_A, BRIDGE_W) < 12 + margin) return false;
  if (segDist(x, z, BRIDGE_E, EAST_END) < 12 + margin) return false;
  if (riverDist(x, z) < 42 + margin) return false;
  for (const k in LANDMARKS) { const l = LANDMARKS[k]; if (Math.hypot(x - l.x, z - l.z) < (k === 'wheel' ? 95 : 70)) return false; }
  return true;
}

// generic unlit + haze material (for lights, landmark emissive parts, lines)
function hazeBasic(color, k = 1, { vertexColors = false, transparent = false, additive = false, opacity = 1, side = THREE.FrontSide } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...LU, uColor: { value: new THREE.Color(color).multiplyScalar(k) }, uOpacity: { value: opacity } },
    vertexColors, transparent, side, depthWrite: !additive, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec3 vC;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        #ifdef USE_INSTANCING
          wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        #endif
        vW = wp.xyz;
        vC = vec3(1.0);
        #ifdef USE_COLOR
          vC = color;
        #endif
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity; varying vec3 vW; varying vec3 vC;
      ${HAZE_GLSL}
      void main(){
        gl_FragColor = vec4(applyHaze(uColor * vC, vW), uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}


// ---------------- shared GLSL ----------------
const NOISE_GLSL = /* glsl */ `
  float h21(vec2 p){ p = fract(p*vec2(233.34, 851.73)); p += dot(p, p+23.45); return fract(p.x*p.y); }
  float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }`;

// Procedural night facade used by every far building (instanced) and the platform retaining wall.
// Inputs: vF = face coords in metres (u along the wall, v up from the ground), vN world normal, vW world pos,
//         vS = (seed, style, height, width). style: 0 office, 1 glass tower, 2 residential, 3 dark/industrial
const FACADE_GLSL = /* glsl */ `
  vec3 facade(vec2 F, vec3 N, vec3 W, vec4 S){
    float seed = S.x, style = S.y, H = S.z;
    vec3 V = normalize(cameraPosition - W);
    if (N.y > 0.5) {
      // roof: dark membrane, a few lit skylights / helipads on tall towers
      vec3 rc = vec3(0.018, 0.02, 0.028) + vec3(0.05,0.06,0.09) * max(dot(N, uMoon), 0.0) * 0.4;
      return rc;
    }
    vec2 cell = style < 0.5 ? vec2(3.2, 3.6) : style < 1.5 ? vec2(1.6, 3.8) : style < 2.5 ? vec2(2.6, 2.9) : vec2(6.0, 5.0);
    vec2 g = F / cell;
    vec2 id = floor(g); vec2 f = fract(g);
    float fh = h21(vec2(id.y * 1.37, seed * 91.7));
    float pOn = style < 0.5 ? 0.62 : style < 1.5 ? 0.72 : style < 2.5 ? 0.55 : 0.08;
    float floorOn = step(fh, pOn);
    float run = h21(vec2(floor(id.x / (2.0 + floor(fh * 5.0))), id.y + seed * 13.1));
    float lit = mix(step(0.9, run), step(0.22, run), floorOn);
    // lit fraction goes down late at night on the upper floors of offices
    float mx = style < 1.5 ? 0.12 : 0.18;
    float win = step(mx, f.x) * step(f.x, 1.0 - mx) * step(0.16, f.y) * step(f.y, 0.86);
    if (style > 0.5 && style < 1.5) win = step(0.06, f.x) * step(0.08, f.y);
    float warmSel = h21(vec2(id.y + 3.1, seed * 17.0 + floor(id.x / 4.0)));
    vec3 warm = vec3(1.0, 0.72, 0.42), cool = vec3(0.72, 0.86, 1.0), resi = vec3(1.0, 0.8, 0.55);
    vec3 wc = style < 0.5 ? mix(warm, cool, step(0.45, warmSel)) : style < 1.5 ? mix(cool, vec3(0.9,0.95,1.0), warmSel) : mix(resi, vec3(0.55,0.7,1.0), step(0.85, warmSel));
    float lvl = 0.35 + 0.75 * h21(id + seed);
    // interior gradient (ceiling fixtures brighter)
    lvl *= mix(0.65, 1.15, f.y);
    vec3 em = wc * lit * win * lvl * 0.95;
    // anti-alias: once a window cell is smaller than ~1.5px, fade to its average emission
    vec2 fw = fwidth(g);
    float aa = smoothstep(0.35, 0.9, max(fw.x, fw.y));
    vec3 avg = wc * (pOn * 0.78 + (1.0 - pOn) * 0.1) * 0.55 * (style < 1.5 ? 0.62 : 0.5);
    em = mix(em, avg, aa);
    // ground floor shop band + entrance glow
    float shop = (1.0 - step(4.4, F.y)) * step(0.4, F.y) * step(style, 2.5);
    vec3 shopC = mix(vec3(1.0, 0.55, 0.3), vec3(0.4, 0.9, 1.0), h21(vec2(floor(F.x / 9.0), seed)));
    em = mix(em, shopC * 0.9, shop * 0.8);
    // LED crown band on tall towers (slowly colour-cycling), aviation-white top edge
    if (H > 90.0) {
      float top = step(H - 3.2, F.y) * step(F.y, H - 1.6);
      vec3 crown = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + seed * 3.0 + uTime * 0.03));
      em += crown * top * 1.6;
      em += vec3(0.8, 0.9, 1.0) * step(H - 0.5, F.y) * 0.6;
    }
    // facade: very dark cladding, moon rim + faint city bounce from below
    float moonL = max(dot(N, uMoon), 0.0);
    vec3 base = vec3(0.028, 0.03, 0.04) * (0.6 + 0.8 * h21(vec2(seed, 1.0)));
    vec3 col = base * (0.35 + moonL * 1.2) + vec3(0.05, 0.03, 0.04) * exp(-max(F.y, 0.0) / 30.0);
    if (style > 0.5 && style < 1.5) {
      // glass: reflects the moonlit sky a little at grazing angles
      float fr = pow(1.0 - max(dot(N, V), 0.0), 4.0);
      col += vec3(0.1, 0.12, 0.2) * fr + vec3(0.6,0.65,0.8) * pow(max(dot(reflect(-V, N), uMoon), 0.0), 60.0) * 0.5;
    }
    return col + em;
  }`;

// size-attenuated glowing point sprites (street lights, windows of far suburbs, aviation lights, cars…)
// aColor.rgb * intensity ; aSize = world diameter in metres ; aBlink = (phase, rate, duty, minPx)
function pointsMaterial({ moving = false, additive = true } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: LU, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aSize; attribute vec4 aBlink;
      ${moving ? 'attribute vec4 aA; attribute vec4 aB; attribute vec4 aM;' : ''}
      uniform float uTime; uniform float uPx; uniform float uHazeDen;
      varying vec3 vC; varying float vA;
      void main(){
        vec3 p = position;
        ${moving ? `
        // aA = (mode, r|ax, y|ay, az) ; aB = (bx, by, bz, len) ; aM = (speed m/s signed, phase 0..1, bob, -)
        float s = fract(aM.y + uTime * aM.x / max(aB.w, 1.0));
        if (aA.x < 0.5) { float a = s * 6.2831853; p = vec3(cos(a) * aA.y, aA.z, sin(a) * aA.y); }
        else { p = mix(aA.yzw, aB.xyz, s); }
        ` : ''}
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = max(-mv.z, 0.1);
        float px = aSize * uPx / d;
        float bl = 1.0;
        if (aBlink.y > 0.0) bl = step(fract(aBlink.x + uTime * aBlink.y), aBlink.z);
        // sub-pixel lights: keep a minimum size and trade size for brightness (no shimmering)
        float mn = max(aBlink.w, 1.2);
        vA = bl * min(1.0, px / mn) * exp(-d * uHazeDen * 0.55);
        gl_PointSize = clamp(px, mn, 48.0);
        vC = aColor;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC; varying float vA;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float r = length(q) * 2.0;
        float a = exp(-r * r * 4.0) + 0.25 * exp(-r * 9.0);
        if (a * vA < 0.004) discard;
        gl_FragColor = vec4(vC * a * vA, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
function pointsGeo(list, moving = false) {
  // list items: {x,y,z,c:[r,g,b],s, b:[ph,rate,duty,minPx], A:[..4], B:[..4], M:[..4]}
  const n = list.length;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), blink = new Float32Array(n * 4);
  const A = moving ? new Float32Array(n * 4) : null, B = moving ? new Float32Array(n * 4) : null, M = moving ? new Float32Array(n * 4) : null;
  list.forEach((p, k) => {
    pos.set([p.x || 0, p.y || 0, p.z || 0], k * 3); col.set(p.c, k * 3); size[k] = p.s;
    blink.set(p.b || [0, 0, 1, 1.2], k * 4);
    if (moving) { A.set(p.A, k * 4); B.set(p.B, k * 4); M.set(p.M, k * 4); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aBlink', new THREE.BufferAttribute(blink, 4));
  if (moving) { g.setAttribute('aA', new THREE.BufferAttribute(A, 4)); g.setAttribute('aB', new THREE.BufferAttribute(B, 4)); g.setAttribute('aM', new THREE.BufferAttribute(M, 4)); }
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8000);
  return g;
}

// =====================================================================================================
export class Landscape {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'landscape';
    scene.add(this.group);
    this.R = rng(7777);
    this.k = Q.landscape; // density factor (超軽量 0.35 … 高画質 1)
    this.movers = [];     // per-frame CPU animators
    this.reflHide = [];   // objects to skip in the planar ground-reflection pass
    this.moonDir = opts.moonDir || LU.uMoon.value;
    LU.uMoon.value.copy(this.moonDir);
  }

  build() {
    this.buildGround();
    this.buildWater();
    this.buildFarCity();
    this.buildExpressway();
    this.buildRail();
    this.buildBridge();
    this.buildPort();
    this.buildLandmarks();
    this.buildMountains();
    this.buildLightCarpet();
    this.buildSky();
    return this;
  }

  update(t, dt, camPos) {
    LU.uTime.value = t;
    for (const f of this.movers) f(t, dt, camPos);
  }
}
