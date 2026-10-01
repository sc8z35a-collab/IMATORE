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
  if (r < 216 + margin * 1.42) return false;
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


// 眺望保全 (protected view corridors): every avenue terrace frames a landmark; far buildings standing in that
// line of sight are capped below the eye->landmark sight line, like Tokyo's 富士見坂 rules. Without this the
// 820 m Fuji (4.7 km away, ~10° above the horizon) was completely hidden behind the far city.
const VISTA_EYE_Y = PLAT_H + 1.6;                    // terrace eye height above the lower city ground
const VISTAS = [
  { key: 'fuji', aim: 0.32, half: 0.075 },           // aim = fraction of the landmark height the sight line hits
  { key: 'lattice', aim: 0.18, half: 0.06 },
  { key: 'skytree', aim: 0.16, half: 0.05 },
  { key: 'wheel', aim: 0.05, half: 0.07 },
];
function vistaCap(x, z) {
  let cap = Infinity;
  for (const v of VISTAS) {
    const L = LANDMARKS[v.key], D = Math.hypot(L.x, L.z), ux = L.x / D, uz = L.z / D;
    const along = x * ux + z * uz;
    if (along < 200 || along > D - 80) continue;
    const lat = Math.abs(-x * uz + z * ux);
    const w = along * Math.tan(v.half) + 25;           // corridor widens with distance (angular cone)
    if (lat > w * 1.6) continue;
    const ty = L.h * v.aim;
    const line = VISTA_EYE_Y + (ty - VISTA_EYE_Y) * (along - 205) / (D - 205);
    // soft shoulder: full cap inside the cone, relaxing toward its edge
    const k = Math.min(1, Math.max(0, (lat - w) / (w * 0.6)));
    cap = Math.min(cap, Math.max(9, line - 6) + k * 400);
  }
  return cap;
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

// material for arbitrary meshes carrying the facade shader. Geometry needs attributes:
//   aF (vec2 facade metres), aS (vec4 seed/style/height/width)
export function facadeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: LU,
    extensions: { derivatives: true },
    vertexShader: /* glsl */ `
      attribute vec2 aF; attribute vec4 aS;
      varying vec3 vW; varying vec3 vN; varying vec2 vF; varying vec4 vS;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vF = aF; vS = aS; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN; varying vec2 vF; varying vec4 vS;
      ${HAZE_GLSL}
      ${NOISE_GLSL}
      ${FACADE_GLSL}
      void main(){
        vec3 col = facade(vF, normalize(vN), vW, vS);
        gl_FragColor = vec4(applyHaze(col, vW), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
export { pointsMaterial, pointsGeo, hazeBasic };

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

// ---------------- lit + hazed material for structures (expressway, bridge, cranes, ships…) ----------------
function hazeLit(color, { emissive = 0x000000, ek = 0, stripes = 0, instanced = false, side = THREE.FrontSide } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...LU, uColor: { value: new THREE.Color(color) }, uEm: { value: new THREE.Color(emissive).multiplyScalar(ek) }, uStripes: { value: stripes } },
    side,
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN; varying vec3 vIC;
      void main(){
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = modelMatrix * instanceMatrix;
        #endif
        vIC = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vIC = instanceColor; // C-003: per-instance tint (containers)
        #endif
        vec4 wp = m * vec4(position, 1.0);
        vW = wp.xyz; vN = normalize(mat3(m) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform vec3 uEm; uniform float uStripes; varying vec3 vW; varying vec3 vN; varying vec3 vIC;
      ${HAZE_GLSL}
      void main(){
        vec3 N = normalize(vN);
        float moon = max(dot(N, uMoon), 0.0);
        float up = N.y * 0.5 + 0.5;
        // moonlight key + navy sky fill from above + warm city bounce from below
        vec3 l = vec3(0.30, 0.34, 0.48) * moon + mix(vec3(0.10, 0.05, 0.05), vec3(0.03, 0.04, 0.08), up);
        vec3 c = uColor * vIC * l;
        // red/white banding (crane booms, lattice legs)
        if (uStripes > 0.0) c = mix(c, c * vec3(2.2, 0.35, 0.3), step(0.5, fract(vW.y / uStripes)));
        c += uEm;
        gl_FragColor = vec4(applyHaze(c, vW), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// catenary between two points (for bridge cables / wires)
function catenary(a, b, sag, n = 24) {
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    out.push(new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * sag, a.z + (b.z - a.z) * t));
  }
  return out;
}
function tube(pts, r, seg = 4) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, r, seg, false);
}
function boxAt(w, h, d, x, y, z, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}
const nonIdx = (list) => list.map((g) => (g.index ? g.toNonIndexed() : g));
function merge(list) {
  const norm = nonIdx(list).map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k); return g; });
  return mergeGeometries(norm, false);
}

Object.assign(Landscape.prototype, {
  // ---------------------------------------------------------------- ground: glowing street grid of the lower city
  buildGround() {
    const g = new THREE.RingGeometry(200, 7200, 192, 12);
    g.rotateX(-Math.PI / 2);
    g.translate(0, GY, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: LU,
      extensions: { derivatives: true },
      vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */ `
        varying vec3 vW;
        ${HAZE_GLSL}
        ${NOISE_GLSL}
        ${COAST_GLSL}
        float gridLine(vec2 q, float period, float width, out float cov){
          vec2 g = abs(fract(q / period + 0.5) - 0.5) * period;
          float dd = min(g.x, g.y);
          float fw = max(fwidth(dd), 1e-3);
          cov = width / period * 2.0;
          float line = 1.0 - smoothstep(width * 0.5 - fw, width * 0.5 + fw, dd);
          // when the grid is sub-pixel, use the average coverage instead (no moire)
          float pxPeriod = period / max(fwidth(q.x), 1e-3);
          return mix(line, cov, smoothstep(12.0, 3.0, pxPeriod));
        }
        void main(){
          vec2 p = vW.xz;
          float wd = waterDepth(p);
          if (wd > 0.0) discard;
          float r = length(p);
          // districts rotate -> the grid bends like a real organically grown city
          float ang = (vn(p * 0.0011) - 0.5) * 1.6;
          float ca = cos(ang), sa = sin(ang);
          vec2 q = vec2(ca * p.x - sa * p.y, sa * p.x + ca * p.y);
          float c1, c2;
          float minor = gridLine(q, 58.0, 4.0, c1);
          float major = gridLine(q + 17.0, 290.0, 13.0, c2);
          float dens = smoothstep(7200.0, 2300.0, r) * (0.55 + 0.45 * vn(p * 0.0027 + 3.0));
          dens *= 1.0 + 0.8 * smoothstep(-220.0, -30.0, wd);   // brighter waterfront
          vec3 sodium = vec3(1.0, 0.56, 0.22), led = vec3(0.85, 0.9, 1.0);
          vec3 streetC = mix(sodium, led, step(0.55, vn(p * 0.004)));
          vec3 col = vec3(0.010, 0.011, 0.016);
          col += streetC * minor * 0.42 * dens;
          col += mix(sodium, vec3(1.0, 0.85, 0.6), 0.5) * major * 1.1 * dens;
          // traffic on the arterials: moving head/tail light flecks
          vec2 mq = (q + 17.0) / 290.0;
          vec2 mg = abs(fract(mq + 0.5) - 0.5) * 290.0;
          float onH = step(mg.y, 6.5), onV = step(mg.x, 6.5);
          float laneH = step(0.0, fract(mq.y + 0.5) - 0.5), laneV = step(0.0, fract(mq.x + 0.5) - 0.5);
          float carsH = step(0.93, fract(q.x / 23.0 + uTime * (laneH > 0.5 ? 0.55 : -0.55) + h21(vec2(floor(mq.y + 0.5), 1.0))));
          float carsV = step(0.93, fract(q.y / 23.0 + uTime * (laneV > 0.5 ? 0.5 : -0.5) + h21(vec2(floor(mq.x + 0.5), 7.0))));
          vec3 carC = mix(vec3(1.6, 0.12, 0.08), vec3(1.4, 1.3, 1.1), laneH);
          float carFade = smoothstep(2600.0, 600.0, length(p - cameraPosition.xz));
          col += (carC * carsH * onH + mix(vec3(1.6, 0.12, 0.08), vec3(1.4, 1.3, 1.1), laneV) * carsV * onV) * carFade * dens;
          // parking lots / plazas / rooftop lights sprinkled inside blocks
          vec2 cell = floor(q / 9.0);
          float sp = h21(cell);
          float spark = step(0.988, sp) * (1.0 - minor);
          float fw = fwidth(q.x) / 9.0;
          col += mix(vec3(1.0, 0.75, 0.45), vec3(0.7, 0.85, 1.0), h21(cell + 3.0)) * mix(spark, 0.012, smoothstep(0.3, 1.0, fw)) * 1.3 * dens;
          // a little moonlight on the ground
          col += vec3(0.012, 0.014, 0.022);
          gl_FragColor = vec4(applyHaze(col, vW), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const m = new THREE.Mesh(g, mat);
    m.name = 'lowerGround'; m.frustumCulled = false; m.renderOrder = -2;
    this.group.add(m);
    this.reflHide.push(m);
  },

  // ---------------------------------------------------------------- Tokyo Bay + river
  buildWater() {
    const mat = new THREE.ShaderMaterial({
      uniforms: LU,
      extensions: { derivatives: true },
      vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */ `
        varying vec3 vW;
        ${HAZE_GLSL}
        ${NOISE_GLSL}
        ${COAST_GLSL}
        void main(){
          vec2 p = vW.xz;
          float wd = max(waterDepth(p), 0.0);
          vec3 V = normalize(cameraPosition - vW);
          float dist = length(cameraPosition - vW);
          // wave normal: two scrolling noise layers, flattened with distance (the glitter path narrows correctly)
          float t = uTime;
          vec2 w1 = p * 0.035 + vec2(t * 0.05, t * 0.03), w2 = p * 0.11 - vec2(t * 0.07, -t * 0.04);
          float e = 0.6;
          float n0 = vn(w1) + 0.5 * vn(w2);
          float nx = vn(w1 + vec2(e, 0.0)) + 0.5 * vn(w2 + vec2(e * 3.0, 0.0)) - n0;
          float nz = vn(w1 + vec2(0.0, e)) + 0.5 * vn(w2 + vec2(0.0, e * 3.0)) - n0;
          float amp = mix(0.9, 0.25, smoothstep(200.0, 3000.0, dist));
          vec3 N = normalize(vec3(-nx * amp, 1.0, -nz * amp));
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 R = reflect(-V, N);
          // reflected sky: horizon glow -> zenith navy
          vec3 sky = mix(vec3(0.16, 0.09, 0.14), vec3(0.012, 0.016, 0.034), smoothstep(0.0, 0.5, R.y));
          vec3 col = vec3(0.004, 0.008, 0.014) + sky * fres * 0.9;
          // moon glitter path
          float md = max(dot(R, uMoon), 0.0);
          col += vec3(0.85, 0.9, 1.0) * (pow(md, 900.0) * 9.0 + pow(md, 90.0) * 0.5 + pow(md, 12.0) * 0.03);
          // reflections of the shore lights: vertical streaks toward the viewer
          vec2 vd = normalize(p - cameraPosition.xz);
          float lat = dot(p, vec2(-vd.y, vd.x));
          float streak = pow(vn(vec2(lat * 0.06, 0.0)), 5.0) * 2.5 + pow(vn(vec2(lat * 0.21, 4.0)), 8.0) * 3.0;
          float wob = 0.75 + 0.25 * sin(p.y * 0.05 + p.x * 0.03 + t * 1.5 + n0 * 6.0);
          vec3 shoreC = mix(vec3(1.0, 0.6, 0.3), vec3(0.6, 0.8, 1.0), vn(vec2(lat * 0.013, 9.0)));
          col += shoreC * streak * wob * exp(-wd / 160.0) * 0.35;
          // bridge light reflections
          float bd = abs(p.y - ${BRIDGE_ALONG.toFixed(1)});
          float bl = step(abs(p.x), ${BRIDGE_HALF.toFixed(1)});
          col += vec3(0.9, 0.95, 1.0) * pow(vn(vec2(lat * 0.35, 2.0)), 6.0) * exp(-bd / 55.0) * bl * wob * 1.6;
          // shoreline foam/glow line
          col += vec3(0.5, 0.45, 0.4) * exp(-wd / 5.0) * 0.08;
          gl_FragColor = vec4(applyHaze(col, vW), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.waterMat = mat;
    const bay = new THREE.PlaneGeometry(16000, 9000, 1, 1);
    bay.rotateX(-Math.PI / 2);
    bay.translate(0, WY, 700 + 4500);
    const m = new THREE.Mesh(bay, mat);
    m.name = 'bay'; m.frustumCulled = false; m.renderOrder = -3;
    this.group.add(m);
    this.reflHide.push(m);
    // river: ribbon along the RIVER polyline (same water shader, but waterDepth<0 there -> use a separate flag-free copy)
    const rmat = mat.clone();
    rmat.fragmentShader = mat.fragmentShader.replace('float wd = max(waterDepth(p), 0.0);', 'float wd = 400.0;');
    rmat.uniforms = LU;
    const pos = [];
    const W = 34;
    for (let k = 0; k < RIVER.length - 1; k++) {
      const a = RIVER[k], b = RIVER[k + 1];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz), nx = -dz / L * W, nz = dx / L * W;
      const y = GY + 0.12;
      pos.push(a.x - nx, y, a.z - nz, b.x - nx, y, b.z - nz, b.x + nx, y, b.z + nz, a.x - nx, y, a.z - nz, b.x + nx, y, b.z + nz, a.x + nx, y, a.z + nz);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const river = new THREE.Mesh(rg, rmat);
    rmat.side = THREE.DoubleSide;
    river.name = 'river'; river.frustumCulled = false; river.renderOrder = -1;
    this.group.add(river);
    this.reflHide.push(river);
    // river bridges (small lit girder bridges every ~250 m)
    const lights = [];
    for (let k = 3; k < RIVER.length - 2; k += 5) {
      const a = RIVER[k], b = RIVER[k + 1];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz), nx = -dz / L, nz = dx / L;
      for (let s = -W - 6; s <= W + 6; s += 4) lights.push({ x: a.x + nx * s, y: GY + 6, z: a.z + nz * s, c: [1.4, 1.0, 0.6], s: 1.2 });
    }
    this.riverLights = lights;
  },

  // ---------------------------------------------------------------- far city: thousands of instanced towers
  buildFarCity() {
    const R = this.R;
    const list = [];
    const N = Math.round(5200 * this.k);
    const clusterH = (x, z) => {
      let h = 0;
      for (const c of CLUSTERS) { const d = Math.hypot(x - c.x, z - c.z); h = Math.max(h, c.amp * Math.exp(-(d * d) / (2 * c.s * c.s))); }
      return h;
    };
    let tries = 0;
    while (list.length < N && tries < N * 6) {
      tries++;
      // denser near the hub; distance distribution biased inward
      const r = 226 + Math.pow(R(), 1.45) * 2500;
      const a = R() * TAU;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const ch = clusterH(x, z);
      const w = 14 + R() * 26, d = 14 + R() * 24;
      if (!isFree(x, z, Math.max(w, d) * 0.5)) continue;
      // near the platform keep it low-rise so the terraces look over rooftops
      const nearK = Math.min(1, Math.max(0, (r - 226) / 300));
      let H = 8 + Math.pow(R(), 2.2) * (16 + 140 * nearK) + ch * (0.55 + R() * 0.7) * Math.min(1, nearK * 2);
      if (r > 1700) H *= 0.7;
      H = Math.min(H, vistaCap(x, z));
      const style = ch > 60 && R() < 0.6 ? 1 : H < 26 ? (R() < 0.7 ? 2 : 3) : R() < 0.25 ? 1 : R() < 0.15 ? 2 : 0;
      // align loosely with the same bending street grid as the ground shader
      const yaw = R() < 0.8 ? (Math.floor(R() * 4) * Math.PI) / 2 + (Math.sin(x * 0.0011) * 0.8) : R() * TAU;
      const seed = R();
      list.push({ x, z, w, d, h: H, y0: 0, yaw, seed, style });
      // setback tiers / crowns on tall towers
      // (tiers are kept under the view-corridor cap too)
      const room = vistaCap(x, z) - H;
      if (H > 110 && R() < 0.75 && room > 20) list.push({ x, z, w: w * 0.68, d: d * 0.68, h: Math.min(room - 2, 8 + R() * H * 0.28), y0: H, yaw, seed: seed + 0.3, style });
      if (H > 150 && R() < 0.5 && room > 40) list.push({ x, z, w: w * 0.4, d: d * 0.4, h: 6 + R() * 14, y0: H + 10, yaw: yaw + 0.785, seed: seed + 0.6, style: 3 });
    }
    const n = list.length;
    const aBox = new Float32Array(n * 4), aPos = new Float32Array(n * 4), aSty = new Float32Array(n * 2);
    const aviation = [];
    list.forEach((b, k) => {
      aBox.set([b.w, b.h, b.d, b.yaw], k * 4);
      aPos.set([b.x, b.y0, b.z, b.seed], k * 4);
      aSty.set([b.style, b.y0 + b.h], k * 2);
      if (b.y0 + b.h > 95 && b.y0 === 0 || b.y0 + b.h > 150) {
        aviation.push({ x: b.x, y: GY + b.y0 + b.h + 1.5, z: b.z, c: [2.6, 0.12, 0.06], s: 2.4, b: [R(), 0.5, 0.55, 1.6] });
      }
    });
    this.aviation = aviation;
    const base = new THREE.BoxGeometry(1, 1, 1);
    base.translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('normal', base.attributes.normal);
    g.setAttribute('aBox', new THREE.InstancedBufferAttribute(aBox, 4));
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 4));
    g.setAttribute('aSty', new THREE.InstancedBufferAttribute(aSty, 2));
    g.instanceCount = n;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 9000);
    const mat = new THREE.ShaderMaterial({
      uniforms: LU,
      extensions: { derivatives: true },
      vertexShader: /* glsl */ `
        attribute vec4 aBox; attribute vec4 aPos; attribute vec2 aSty;
        varying vec3 vW; varying vec3 vN; varying vec2 vF; varying vec4 vS;
        void main(){
          vec3 p = position * aBox.xyz;
          float c = cos(aBox.w), s = sin(aBox.w);
          vec3 w = vec3(p.x * c + p.z * s, p.y + aPos.y + ${GY.toFixed(1)}, -p.x * s + p.z * c) + vec3(aPos.x, 0.0, aPos.z);
          vN = vec3(normal.x * c + normal.z * s, normal.y, -normal.x * s + normal.z * c);
          float u = abs(normal.z) > 0.5 ? (position.x + 0.5) * aBox.x : (position.z + 0.5) * aBox.z;
          vF = vec2(u + aPos.w * 97.0, p.y + aPos.y);
          vS = vec4(aPos.w * 10.0, aSty.x, aSty.y, aBox.x);
          vW = w;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vW; varying vec3 vN; varying vec2 vF; varying vec4 vS;
        ${HAZE_GLSL}
        ${NOISE_GLSL}
        ${FACADE_GLSL}
        void main(){
          vec3 col = facade(vF, normalize(vN), vW, vS);
          gl_FragColor = vec4(applyHaze(col, vW), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const m = new THREE.Mesh(g, mat);
    m.name = 'farCity'; m.frustumCulled = false;
    this.group.add(m);
    this.farCity = m;
    this.buildingCount = n;
  },

  // ---------------------------------------------------------------- 首都高 expressway ring + spur to the bridge
  buildExpressway() {
    const R = this.R;
    const Y = GY + 16, W = 11;
    const parts = [], barrier = [];
    const SEG = 240;
    for (let k = 0; k < SEG; k++) {
      const a0 = (k / SEG) * TAU, a1 = ((k + 1) / SEG) * TAU;
      const mid = (a0 + a1) / 2;
      const x = Math.cos(mid) * EXPRESS_R, z = Math.sin(mid) * EXPRESS_R;
      if (waterDepth(x, z) > -10) continue;
      const L = EXPRESS_R * (a1 - a0) + 0.2;
      parts.push(boxAt(W * 2, 1.4, L, x, Y - 1.4, z, -mid));
      for (const s of [-1, 1]) barrier.push(boxAt(0.35, 1.1, L, x + Math.cos(mid) * s * W, Y, z + Math.sin(mid) * s * W, -mid));
      if (k % 3 === 0) {
        // T-shaped pier
        parts.push(boxAt(3.2, Y - 1.4 - GY, 3.2, x, GY, z, -mid));
        parts.push(boxAt(W * 1.6, 1.6, 3.4, x, Y - 3.0, z, -mid));
      }
    }
    // spur from the ring to the west bridge abutment
    const A = SPUR_A, B = BRIDGE_W;
    const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz);
    const deckY = WY + 46;
    for (let s = 0; s < L; s += 24) {
      const t = s / L, x = A.x + dx * t, z = A.z + dz * t, y = Y + (deckY - Y) * t;
      parts.push(boxAt(W * 1.6, 1.4, 24.4, x + dx / L * 12, y - 1.4, z + dz / L * 12, yaw));
      parts.push(boxAt(3, y - 1.4 - WY, 3, x, WY, z, yaw));
    }
    const mesh = new THREE.Mesh(merge(parts), hazeLit(0x6e7078));
    mesh.name = 'expressway';
    const bar = new THREE.Mesh(merge(barrier), hazeLit(0x8a8c94, { emissive: 0xffc890, ek: 0.05 }));
    this.group.add(mesh, bar);
    // lights: sodium lamps along the barriers + two opposing traffic streams
    const lamps = [], cars = [];
    for (let k = 0; k < 360; k++) {
      const a = (k / 360) * TAU;
      const x = Math.cos(a) * EXPRESS_R, z = Math.sin(a) * EXPRESS_R;
      if (waterDepth(x, z) > -10) continue;
      for (const s of [-1, 1]) lamps.push({ x: x + Math.cos(a) * s * (W - 0.3), y: Y + 8, z: z + Math.sin(a) * s * (W - 0.3), c: [1.9, 1.05, 0.45], s: 1.8 });
    }
    const nCars = Math.round(520 * this.k);
    const circ = TAU * EXPRESS_R;
    for (let k = 0; k < nCars; k++) {
      const out = k % 2 === 0;
      const r = EXPRESS_R + (out ? 1 : -1) * (3 + (k % 4 < 2 ? 0 : 3.6));
      const spd = (out ? 1 : -1) * (19 + R() * 9);
      const c = out ? [2.2, 2.0, 1.7] : [2.4, 0.16, 0.08];
      cars.push({ c, s: out ? 1.5 : 1.2, A: [0, r, Y + 0.8, 0], B: [0, 0, 0, circ], M: [spd, R(), 0, 0] });
    }
    this.expressLamps = lamps;
    const cm = new THREE.Points(pointsGeo(cars, true), pointsMaterial({ moving: true }));
    cm.frustumCulled = false; cm.name = 'expressTraffic';
    this.group.add(cm);
    this.reflHide.push(cm);
  },

  // ---------------------------------------------------------------- elevated loop railway with lit trains
  buildRail() {
    const Y = GY + 9;
    const parts = [];
    const SEG = 280;
    for (let k = 0; k < SEG; k++) {
      const a0 = (k / SEG) * TAU, a1 = ((k + 1) / SEG) * TAU, mid = (a0 + a1) / 2;
      const x = Math.cos(mid) * RAIL_R, z = Math.sin(mid) * RAIL_R;
      if (waterDepth(x, z) > -10) continue;
      const L = RAIL_R * (a1 - a0) + 0.2;
      parts.push(boxAt(9, 1.2, L, x, Y - 1.2, z, -mid));
      if (k % 2 === 0) parts.push(boxAt(2.2, Y - 1.2 - GY, 2.2, x, GY, z, -mid));
    }
    // catenary masts
    for (let k = 0; k < SEG; k += 2) {
      const a = (k / SEG) * TAU, x = Math.cos(a) * (RAIL_R + 4.2), z = Math.sin(a) * (RAIL_R + 4.2);
      if (waterDepth(x, z) > -10) continue;
      parts.push(boxAt(0.3, 6, 0.3, x, Y, z, -a));
    }
    this.group.add(Object.assign(new THREE.Mesh(merge(parts), hazeLit(0x5b5d63)), { name: 'railViaduct' }));
    // trains: 11 cars each, lit window strip (emissive) + green line livery; move by rotating the parent group
    const trainParts = [], winParts = [];
    const carL = 20, gap = 0.8, n = 11;
    const angPer = (carL + gap) / RAIL_R;
    for (let c = 0; c < n; c++) {
      const a = c * angPer;
      const x = Math.cos(a) * RAIL_R, z = Math.sin(a) * RAIL_R;
      trainParts.push(boxAt(2.9, 3.4, carL, x, Y + 0.4, z, -a));
      for (const s of [-1, 1]) winParts.push(boxAt(0.05, 0.9, carL - 2, x + Math.cos(a) * s * 1.48, Y + 2.1, z + Math.sin(a) * s * 1.48, -a));
    }
    const body = merge(trainParts), win = merge(winParts);
    const bodyMat = hazeLit(0xb8bcc0);
    const winMat = hazeBasic(0xf2f6ff, 1.6);
    this.trains = [];
    for (const [ph, dir, off] of [[0, 1, -2.4], [Math.PI, -1, 2.4]]) {
      const tg = new THREE.Group();
      const b = new THREE.Mesh(body, bodyMat), w = new THREE.Mesh(win, winMat);
      b.scale.setScalar(1); tg.add(b, w);
      tg.scale.set((RAIL_R + off) / RAIL_R, 1, (RAIL_R + off) / RAIL_R);
      tg.userData = { ph, dir };
      this.group.add(tg);
      this.trains.push(tg);
    }
    this.movers.push((t) => { for (const tg of this.trains) tg.rotation.y = -(tg.userData.ph + t * 0.024 * tg.userData.dir); });
  },

  // ---------------------------------------------------------------- suspension bridge across the bay
  buildBridge() {
    const A = BRIDGE_W, B = BRIDGE_E;
    const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, yaw = Math.atan2(dx, dz);
    const nx = -uz, nz = ux;
    const deckY = WY + 46;
    const parts = [];
    // deck (double-deck truss look): main slab + lower slab + side trusses
    for (let s = 0; s < L; s += 30) {
      const x = A.x + ux * (s + 15), z = A.z + uz * (s + 15);
      parts.push(boxAt(26, 1.6, 30.2, x, deckY - 1.6, z, yaw));
      parts.push(boxAt(22, 1.0, 30.2, x, deckY - 8, z, yaw));
      for (const sd of [-1, 1]) parts.push(boxAt(0.8, 6.4, 30.2, x + nx * sd * 12.5, deckY - 8, z + nz * sd * 12.5, yaw));
    }
    // towers
    const towerS = [L * 0.24, L * 0.76], TH = 150;
    const cableLights = [];
    for (const s of towerS) {
      const x = A.x + ux * s, z = A.z + uz * s;
      for (const sd of [-1, 1]) parts.push(boxAt(4.5, TH, 5.5, x + nx * sd * 14, WY, z + nz * sd * 14, yaw));
      for (const hh of [deckY + 30 - WY, TH - 26, TH - 2]) parts.push(boxAt(30, 4, 4, x, WY + hh, z, yaw));
      // tower floodlight: lights along the legs
      for (const sd of [-1, 1]) for (let y = 4; y < TH; y += 7) cableLights.push({ x: x + nx * sd * 16.4, y: WY + y, z: z + nz * sd * 16.4, c: [1.7, 1.75, 1.9], s: 1.6 });
      for (const sd of [-1, 1]) cableLights.push({ x: x + nx * sd * 14, y: WY + TH + 2, z: z + nz * sd * 14, c: [2.8, 0.1, 0.05], s: 3.2, b: [sd > 0 ? 0 : 0.5, 0.6, 0.5, 2] });
    }
    // main cables (catenary: anchor -> tower -> sag -> tower -> anchor) + hanger lights
    const cab = [];
    for (const sd of [-1, 1]) {
      const P = (s, y) => new THREE.Vector3(A.x + ux * s + nx * sd * 14, y, A.z + uz * s + nz * sd * 14);
      const spans = [[P(0, deckY + 2), P(towerS[0], WY + TH), 40], [P(towerS[0], WY + TH), P(towerS[1], WY + TH), 104], [P(towerS[1], WY + TH), P(L, deckY + 2), 40]];
      for (const [a, b, sag] of spans) {
        // side spans hang less: use a quadratic between the endpoints
        const pts = catenary(a, b, sag * (a.y === b.y ? 1 : 0.35), 30);
        cab.push(tube(pts, 0.6, 4));
        pts.forEach((p, k) => { if (k % 1 === 0) cableLights.push({ x: p.x, y: p.y + 0.8, z: p.z, c: [1.8, 1.9, 2.1], s: 1.7 }); });
        // vertical hangers (thin lines)
        for (let k = 1; k < pts.length - 1; k++) cab.push(boxAt(0.12, Math.max(0.5, pts[k].y - deckY), 0.12, pts[k].x, deckY, pts[k].z, yaw));
      }
    }
    // deck lights both edges + traffic streams
    for (let s = 0; s < L; s += 9) for (const sd of [-1, 1]) cableLights.push({ x: A.x + ux * s + nx * sd * 13, y: deckY + 5, z: A.z + uz * s + nz * sd * 13, c: [1.8, 1.25, 0.6], s: 1.5 });
    const mat = hazeLit(0xd8dce2, { emissive: 0xd8e4ff, ek: 0.06 });
    this.group.add(Object.assign(new THREE.Mesh(merge(parts), mat), { name: 'bridge' }));
    this.group.add(Object.assign(new THREE.Mesh(merge(cab), hazeBasic(0xcfe0ff, 0.9)), { name: 'bridgeCables' }));
    this.bridgeLights = cableLights;
    const R = this.R, cars = [];
    const nCars = Math.round(160 * this.k);
    for (let k = 0; k < nCars; k++) {
      const sd = k % 2 ? 1 : -1, off = sd * (3 + R() * 5);
      const a = [A.x + nx * off, deckY + 0.8, A.z + nz * off], b = [B.x + nx * off, deckY + 0.8, B.z + nz * off];
      const fwd = sd > 0;
      cars.push({ c: fwd ? [2.2, 2.0, 1.7] : [2.4, 0.16, 0.08], s: 1.4, A: [1, ...(fwd ? a : b)], B: [...(fwd ? b : a), L], M: [20 + R() * 8, R(), 0, 0] });
    }
    const cm = new THREE.Points(pointsGeo(cars, true), pointsMaterial({ moving: true }));
    cm.frustumCulled = false;
    this.group.add(cm);
    this.reflHide.push(cm);
  },

  // ---------------------------------------------------------------- port: gantry cranes, container stacks, ships
  buildPort() {
    const R = this.R;
    const parts = [], boxes = [], lights = [];
    // container terminal on the east shore of the bay
    const craneMat = hazeLit(0xd0d3d8, { stripes: 0 });
    const cranes = [];
    for (let k = 0; k < 9; k++) {
      const lat = 360 + k * 70;
      const along = COAST0 + (lat * lat) / 1400 + coastNoise(lat) - 26;
      const p = bayPoint(along, lat);
      const yaw = Math.atan2(BAY_DIR.x, BAY_DIR.y);
      const cx = p.x, cz = p.z;
      // legs
      for (const a of [-9, 9]) for (const b of [-7, 7]) cranes.push(boxAt(1.4, 48, 1.4, cx + a, WY, cz + b, 0));
      cranes.push(boxAt(22, 3, 18, cx, WY + 48, cz, 0));
      // boom out over the water (towards +along)
      cranes.push(boxAt(3, 3, 70, cx, WY + 50, cz + 34, 0));
      cranes.push(boxAt(2.4, 22, 2.4, cx, WY + 51, cz - 4, 0));
      lights.push({ x: cx, y: WY + 74, z: cz - 4, c: [2.8, 0.1, 0.05], s: 3, b: [R(), 0.45, 0.5, 2] });
      lights.push({ x: cx, y: WY + 53, z: cz + 68, c: [2.8, 0.1, 0.05], s: 2.4, b: [R(), 0.45, 0.5, 2] });
      for (let s = 0; s < 70; s += 10) lights.push({ x: cx, y: WY + 47, z: cz + s, c: [1.8, 1.6, 1.2], s: 1.4 });
      // container stacks behind
      for (let j = 0; j < 14; j++) {
        const bx = cx + (R() - 0.5) * 60, bz = cz - 40 - R() * 120;
        if (waterDepth(bx, bz) > -8) continue;
        boxes.push({ x: bx, z: bz, h: 2.6 * (1 + ((R() * 4) | 0)), c: R() });
      }
    }
    const cm = new THREE.Mesh(merge(cranes), craneMat);
    cm.name = 'cranes';
    this.group.add(cm);
    // container blocks as one instanced mesh with per-instance colour
    const cg = new THREE.BoxGeometry(12, 1, 2.5); cg.translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(cg, hazeLit(0xffffff, { instanced: true }), boxes.length);
    const pal = [0xb03a2e, 0x2e6fb0, 0xc9a227, 0x2e8b57, 0x8a8f99, 0xd35400];
    const m4 = new THREE.Matrix4(), c = new THREE.Color();
    boxes.forEach((b, k) => {
      m4.makeScale(1, b.h, 1).setPosition(b.x, WY + 2, b.z); im.setMatrixAt(k, m4);
      im.setColorAt(k, c.set(pal[Math.floor(b.c * pal.length) % pal.length]).multiplyScalar(0.8 + R() * 0.4));
    });
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.frustumCulled = false;
    im.name = 'containers';
    this.group.add(im);
    // ships at anchor / sailing slowly
    const shipParts = [];
    const ships = [];
    for (let k = 0; k < 11; k++) {
      const along = 1250 + R() * 2600, lat = (R() - 0.5) * 1800;
      const p = bayPoint(along, lat);
      if (waterDepth(p.x, p.z) < 120) continue;
      const len = 60 + R() * 170, yaw = R() * TAU;
      shipParts.push(boxAt(len * 0.16, 7, len, p.x, WY - 1, p.z, yaw));
      shipParts.push(boxAt(len * 0.14, 10 + R() * 8, len * 0.14, p.x - Math.sin(yaw) * len * 0.38, WY + 6, p.z - Math.cos(yaw) * len * 0.38, yaw));
      // deck lights + mast light
      for (let s = -len / 2; s < len / 2; s += 8) lights.push({ x: p.x + Math.sin(yaw) * s, y: WY + 8, z: p.z + Math.cos(yaw) * s, c: [1.9, 1.5, 0.9], s: 1.3 });
      lights.push({ x: p.x - Math.sin(yaw) * len * 0.38, y: WY + 30, z: p.z - Math.cos(yaw) * len * 0.38, c: [2.2, 2.2, 2.4], s: 2.2 });
      lights.push({ x: p.x + Math.sin(yaw) * len * 0.5, y: WY + 12, z: p.z + Math.cos(yaw) * len * 0.5, c: [0.2, 2.4, 0.4], s: 1.6 });
      ships.push(p);
    }
    if (shipParts.length) this.group.add(Object.assign(new THREE.Mesh(merge(shipParts), hazeLit(0x2a2e36)), { name: 'ships' }));
    // a lit cruise ship / yakatabune near the bridge
    this.portLights = lights;
  },

  // ---------------------------------------------------------------- landmarks
  buildLandmarks() {
    this.buildLatticeTower();
    this.buildSkytree();
    this.buildWheel();
  },

  buildLatticeTower() {
    const L = LANDMARKS.lattice;
    const H = L.h, parts = [], white = [];
    // 4 curved legs meeting near the top; profile half-width w(y)
    const w = (y) => 40 * Math.pow(1 - y / H, 1.9) + 2.2;
    const legs = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
    const STEP = 9;
    for (let y = 0; y < H - 10; y += STEP) {
      const y1 = Math.min(H - 10, y + STEP);
      const band = (Math.floor(y / 24) % 2 === 0);
      for (const [sx, sz] of legs) {
        const a = new THREE.Vector3(sx * w(y), y, sz * w(y)), b = new THREE.Vector3(sx * w(y1), y1, sz * w(y1));
        (band ? parts : white).push(tube([a, b], 1.1 * (1 - y / H * 0.6), 4));
      }
      // X bracing on the 4 faces
      for (let f = 0; f < 4; f++) {
        const [sx, sz] = legs[f], [tx, tz] = legs[(f + 1) % 4];
        const p0 = new THREE.Vector3(sx * w(y), y, sz * w(y)), p1 = new THREE.Vector3(tx * w(y1), y1, tz * w(y1));
        const q0 = new THREE.Vector3(tx * w(y), y, tz * w(y)), q1 = new THREE.Vector3(sx * w(y1), y1, sz * w(y1));
        (band ? parts : white).push(tube([p0, p1], 0.35, 3), tube([q0, q1], 0.35, 3));
      }
    }
    // observation decks
    const deck1 = new THREE.BoxGeometry(34, 10, 34); deck1.translate(0, 150, 0);
    const deck2 = new THREE.BoxGeometry(14, 6, 14); deck2.translate(0, 250, 0);
    const mast = new THREE.CylinderGeometry(0.6, 1.8, 76, 8); mast.translate(0, H - 38, 0);
    white.push(mast);
    const orange = hazeBasic(0xff7a1c, 2.4), whiteM = hazeBasic(0xfff1e0, 2.2);
    const g = new THREE.Group();
    g.position.set(L.x, GY, L.z);
    g.rotation.y = Math.PI / 4;
    g.add(new THREE.Mesh(merge(parts), orange), new THREE.Mesh(merge(white), whiteM));
    const deckMat = new THREE.ShaderMaterial({
      uniforms: LU,
      vertexShader: /* glsl */ `varying vec3 vW; varying vec3 vL; void main(){ vL = position; vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */ `varying vec3 vW; varying vec3 vL; ${HAZE_GLSL}
        void main(){ float band = step(0.35, fract(vL.y / 2.5)); vec3 c = mix(vec3(0.05), vec3(1.8, 1.5, 1.0), band);
          gl_FragColor = vec4(applyHaze(c, vW), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    g.add(new THREE.Mesh(deck1, deckMat), new THREE.Mesh(deck2, deckMat));
    g.name = 'latticeTower';
    this.group.add(g);
    this.lattice = g;
    this.landmarkLights = [{ x: L.x, y: GY + H + 1, z: L.z, c: [3, 0.1, 0.05], s: 4, b: [0, 0.5, 0.5, 2.5] }];
    // glow halo sprite around the tower base -> reads as floodlit at distance
    for (let y = 20; y < H; y += 30) this.landmarkLights.push({ x: L.x, y: GY + y, z: L.z, c: [1.2, 0.45, 0.1], s: w(y) * 2.6 });
  },

  buildSkytree() {
    const L = LANDMARKS.skytree, H = L.h;
    // lathe profile: triangular-ish base widening, slim shaft, two observation rings, antenna
    const prof = [];
    const rr = (y) => (y < 350 ? 34 * Math.pow(1 - y / 700, 1.6) + 6 : 9 - (y - 350) * 0.012);
    for (let y = 0; y <= 495; y += 15) prof.push(new THREE.Vector2(rr(y), y));
    const shaft = new THREE.LatheGeometry(prof, 36);
    const mat = new THREE.ShaderMaterial({
      uniforms: LU,
      extensions: { derivatives: true },
      vertexShader: /* glsl */ `varying vec3 vW; varying vec3 vL; varying vec3 vN; void main(){ vL = position; vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */ `varying vec3 vW; varying vec3 vL; varying vec3 vN; ${HAZE_GLSL}
        void main(){
          float a = atan(vL.z, vL.x);
          float r = length(vL.xz);
          // diagonal lattice (both directions) -> emissive lines, fade to average when sub-pixel
          vec2 q = vec2(a * r / 9.0 + vL.y / 9.0, a * r / 9.0 - vL.y / 9.0);
          vec2 f = abs(fract(q) - 0.5);
          float fw = max(fwidth(q.x), 1e-3);
          float line = 1.0 - smoothstep(0.06, 0.06 + fw * 1.5, min(f.x, f.y));
          line = mix(line, 0.25, smoothstep(0.25, 0.8, fw));
          // 粋 (pale blue) with 雅 (purple) slowly alternating in bands
          float band = 0.5 + 0.5 * sin(vL.y * 0.02 - uTime * 0.25);
          vec3 iki = vec3(0.45, 0.8, 1.6), miyabi = vec3(1.1, 0.35, 1.5);
          vec3 c = mix(iki, miyabi, smoothstep(0.55, 0.9, band));
          // floodlit from inside: brighter toward the base of each band, the lattice glowing on top
          float flood = 0.55 + 0.45 * smoothstep(0.0, 360.0, vL.y);
          vec3 col = vec3(0.02, 0.025, 0.04) + c * (0.42 + line * 1.9) * flood;
          // emissive landmarks punch through the aerial haze much more than unlit facades
          vec3 hz = applyHaze(col, vW);
          gl_FragColor = vec4(mix(hz, col, 0.55), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const g = new THREE.Group();
    g.position.set(L.x, GY, L.z);
    g.add(new THREE.Mesh(shaft, mat));
    // observation decks (lit glass rings)
    const ringMat = hazeBasic(0xdff2ff, 3.4);
    for (const [y, r, h] of [[340, 20, 14], [445, 12, 7]]) {
      const ring = new THREE.CylinderGeometry(r, r * 0.92, h, 36, 1, true);
      ring.translate(0, y, 0);
      g.add(new THREE.Mesh(ring, ringMat));
      const cap = new THREE.CylinderGeometry(r * 0.95, r, 2, 36); cap.translate(0, y + h / 2 + 1, 0);
      g.add(new THREE.Mesh(cap, hazeLit(0x6a7080)));
    }
    const ant = new THREE.CylinderGeometry(1.2, 3.6, H - 495, 10); ant.translate(0, 495 + (H - 495) / 2, 0);
    g.add(new THREE.Mesh(ant, hazeBasic(0xcfe8ff, 2.2)));
    g.name = 'skytree';
    this.group.add(g);
    this.landmarkLights.push({ x: L.x, y: GY + H + 2, z: L.z, c: [3, 0.1, 0.05], s: 6, b: [0.2, 0.5, 0.5, 2.5] });
    for (const y of [150, 250, 420, 560]) this.landmarkLights.push({ x: L.x, y: GY + y, z: L.z, c: [3, 0.1, 0.05], s: 4, b: [y / 600, 0.5, 0.5, 2] });
  },

  buildWheel() {
    const L = LANDMARKS.wheel, Rw = 52, H = L.h;
    const g = new THREE.Group();
    g.position.set(L.x, GY, L.z);
    // face the hub
    g.rotation.y = Math.atan2(-L.x, -L.z);
    const legs = [];
    for (const s of [-1, 1]) {
      legs.push(tube([new THREE.Vector3(-28, 0, s * 6), new THREE.Vector3(0, H - Rw, s * 2)], 1.2, 5));
      legs.push(tube([new THREE.Vector3(28, 0, s * 6), new THREE.Vector3(0, H - Rw, s * 2)], 1.2, 5));
    }
    g.add(new THREE.Mesh(merge(legs), hazeLit(0xc8ccd4)));
    const wheel = new THREE.Group();
    wheel.position.y = H - Rw;
    const rim = [];
    for (const s of [-1, 1]) {
      const pts = []; for (let k = 0; k <= 64; k++) { const a = (k / 64) * TAU; pts.push(new THREE.Vector3(Math.cos(a) * Rw, Math.sin(a) * Rw, s * 2)); }
      rim.push(tube(pts, 0.5, 4));
      for (let k = 0; k < 32; k++) { const a = (k / 32) * TAU; rim.push(tube([new THREE.Vector3(0, 0, s * 2), new THREE.Vector3(Math.cos(a) * Rw, Math.sin(a) * Rw, s * 2)], 0.15, 3)); }
    }
    wheel.add(new THREE.Mesh(merge(rim), hazeBasic(0xe8f0ff, 1.0)));
    // chasing rainbow LEDs on the rim + gondolas
    const pts = [];
    const n = 192;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const hue = k / n;
      const c = new THREE.Color().setHSL(hue, 1, 0.55).multiplyScalar(2.6);
      pts.push({ x: Math.cos(a) * Rw, y: Math.sin(a) * Rw, z: 0, c: [c.r, c.g, c.b], s: 2.2, b: [-(k / n) * 6, 0.35, 0.8, 1.6] });
      if (k % 6 === 0) pts.push({ x: Math.cos(a) * (Rw + 3), y: Math.sin(a) * (Rw + 3) - 2, z: 0, c: [2.2, 1.8, 1.2], s: 3.2 });
    }
    const pm = new THREE.Points(pointsGeo(pts), pointsMaterial());
    pm.frustumCulled = false;
    wheel.add(pm);
    g.add(wheel);
    g.name = 'wheel';
    this.group.add(g);
    this.movers.push((t) => { wheel.rotation.z = t * 0.02; });
  },

  // ---------------------------------------------------------------- mountain ranges + Mt. Fuji under the moon
  buildMountains() {
    const R = this.R;
    const segs = 360, pos = [], hgt = [];
    const Rm = 6600;
    const ridge = (a) => {
      let h = 0, amp = 1, f = 3;
      for (let o = 0; o < 5; o++) { h += amp * (Math.sin(a * f + o * 1.7) * 0.5 + Math.sin(a * f * 2.3 + o * 4.1) * 0.5); amp *= 0.5; f *= 2.1; }
      // high to the west (Tanzawa / Chichibu), low to the east (Kanto plain / Boso across the bay)
      const west = Math.max(0, Math.cos(a - Math.PI)) * 0.75 + 0.25;
      return (120 + h * 90) * west + 30;
    };
    for (let k = 0; k < segs; k++) {
      const a0 = (k / segs) * TAU, a1 = ((k + 1) / segs) * TAU;
      const h0 = ridge(a0), h1 = ridge(a1);
      const p0 = [Math.cos(a0) * Rm, Math.sin(a0) * Rm], p1 = [Math.cos(a1) * Rm, Math.sin(a1) * Rm];
      pos.push(p0[0], GY - 5, p0[1], p1[0], GY - 5, p1[1], p1[0], GY + h1, p1[1], p0[0], GY - 5, p0[1], p1[0], GY + h1, p1[1], p0[0], GY + h0, p0[1]);
      hgt.push(0, 0, 1, 0, 1, 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aH', new THREE.Float32BufferAttribute(hgt, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: LU, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `attribute float aH; varying float vH; varying vec3 vW; void main(){ vH = aH; vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */ `varying float vH; varying vec3 vW; ${HAZE_GLSL}
        void main(){
          // far range: flat silhouette, slightly lit rim toward the moon, deep aerial perspective
          vec3 c = mix(vec3(0.03, 0.03, 0.05), vec3(0.06, 0.065, 0.1), vH);
          vec3 hz = uHaze * 0.72;
          c = mix(c, hz, 0.55 - vH * 0.25);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const m = new THREE.Mesh(g, mat);
    m.name = 'mountains'; m.frustumCulled = false; m.renderOrder = -5;
    this.group.add(m);
    this.reflHide.push(m);
    // Fuji: concave cone with snow cap
    const F = LANDMARKS.fuji;
    const prof = [];
    // C-002: LatheGeometry expects the profile bottom -> top (reversing it turned the cone inside out)
    for (let k = 0; k <= 24; k++) { const t = k / 24; prof.push(new THREE.Vector2(3400 * Math.pow(1 - t, 1.9) + 140 * (1 - t) + 70, t * F.h)); }
    prof.push(new THREE.Vector2(0, F.h));
    const cone = new THREE.LatheGeometry(prof, 64);
    const fm = new THREE.ShaderMaterial({
      uniforms: LU,
      vertexShader: /* glsl */ `varying vec3 vL; varying vec3 vN; varying vec3 vW; void main(){ vL = position; vN = normalize(mat3(modelMatrix)*normal); vec4 wp = modelMatrix*vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }`,
      fragmentShader: /* glsl */ `varying vec3 vL; varying vec3 vN; varying vec3 vW; ${HAZE_GLSL} ${NOISE_GLSL}
        void main(){
          float h = vL.y / ${F.h.toFixed(1)};
          float a = atan(vL.z, vL.x);
          // snow line with gullies (valleys streak down from the crater)
          float gully = vn(vec2(a * 18.0, h * 3.0)) * 0.22 + vn(vec2(a * 55.0, h * 8.0)) * 0.08;
          float snow = smoothstep(0.52, 0.6, h + gully - 0.1);
          vec3 N = normalize(vN);
          float moon = max(dot(N, uMoon), 0.0) * 0.8 + 0.2;
          vec3 rock = vec3(0.035, 0.035, 0.055);
          vec3 sn = vec3(0.34, 0.38, 0.52) * moon;
          vec3 c = mix(rock, sn, snow);
          c = mix(c, uHaze * 0.72, 0.5 - h * 0.25);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const fuji = new THREE.Mesh(cone, fm);
    fuji.position.set(F.x, GY - 10, F.z);
    fuji.name = 'fuji'; fuji.renderOrder = -4; fuji.frustumCulled = false;
    this.group.add(fuji);
    this.reflHide.push(fuji);
  },

  // ---------------------------------------------------------------- all static glowing points in one draw call
  buildLightCarpet() {
    const R = this.R;
    const pts = [];
    // suburbs beyond the modelled city: sprinkled along radial highways and clustered towns
    const N = Math.round(26000 * this.k);
    for (let k = 0; k < N; k++) {
      const r = 2500 + Math.pow(R(), 0.8) * 3900, a = R() * TAU;
      // radial highways: pull some points onto 12 spokes
      let aa = a;
      if (R() < 0.35) aa = Math.round(a / (TAU / 12)) * (TAU / 12) + (R() - 0.5) * 0.004;
      const x = Math.cos(aa) * r, z = Math.sin(aa) * r;
      if (waterDepth(x, z) > -20) {
        // across the bay (Boso peninsula shore): keep only far-shore sprinkle
        if (waterDepth(x, z) < 3600) continue;
      }
      const warm = R() < 0.7;
      const k2 = 0.6 + R() * 0.9;
      pts.push({ x, y: GY + 2, z, c: warm ? [1.3 * k2, 0.75 * k2, 0.35 * k2] : [0.8 * k2, 0.9 * k2, 1.2 * k2], s: 5 + R() * 5, b: [0, 0, 1, 1.0] });
    }
    // lamps / lights gathered from the other builders
    for (const l of [...(this.expressLamps || []), ...(this.bridgeLights || []), ...(this.portLights || []), ...(this.riverLights || []), ...(this.aviation || []), ...(this.landmarkLights || [])]) pts.push(l);
    // street-lamp chains around the platform foot (the ring street right below the terraces)
    for (let k = 0; k < 300; k++) { const a = (k / 300) * TAU; pts.push({ x: Math.cos(a) * 219, y: GY + 8, z: Math.sin(a) * 219, c: [1.8, 1.15, 0.55], s: 1.4 }); }
    const m = new THREE.Points(pointsGeo(pts), pointsMaterial());
    m.name = 'lightCarpet'; m.frustumCulled = false;
    this.group.add(m);
    this.reflHide.push(m);
    this.pointCount = pts.length;
  },

  // ---------------------------------------------------------------- aircraft + searchlights
  buildSky() {
    const R = this.R;
    const planes = [];
    // approach path into a bay airport (south-east), descending, plus high cruisers crossing
    for (let k = 0; k < 6; k++) {
      const a = bayPoint(5200, -2600 + k * 60), b = bayPoint(1900, 2600);
      const ya = 900 - k * 20, yb = 140;
      for (const [dx, col, rate, duty, sz] of [[0, [2.6, 2.6, 2.8], 1.1, 0.08, 7], [-8, [2.6, 0.1, 0.05], 0.9, 0.5, 4], [8, [0.1, 2.6, 0.4], 0.9, 0.5, 4], [0, [2.2, 2.1, 1.9], 0, 1, 5]]) {
        planes.push({ c: col, s: sz, b: [R(), rate, duty, 1.6], A: [1, a.x + dx, ya, a.z], B: [b.x + dx, yb, b.z, 6000], M: [75, k / 6, 0, 0] });
      }
    }
    for (let k = 0; k < 4; k++) {
      const a0 = R() * TAU, y = 2200 + R() * 1400;
      const A = [Math.cos(a0) * 7000, y, Math.sin(a0) * 7000], B = [-Math.cos(a0 + 0.5) * 7000, y, -Math.sin(a0 + 0.5) * 7000];
      planes.push({ c: [2.6, 2.6, 2.8], s: 10, b: [R(), 1.0, 0.07, 1.4], A: [1, ...A], B: [...B, 14000], M: [230, R(), 0, 0] });
      planes.push({ c: [2.6, 0.1, 0.05], s: 7, b: [R(), 0.8, 0.5, 1.2], A: [1, ...A], B: [...B, 14000], M: [230, R(), 0, 0] });
    }
    const pm = new THREE.Points(pointsGeo(planes, true), pointsMaterial({ moving: true }));
    pm.frustumCulled = false; pm.name = 'aircraft';
    this.group.add(pm);
    // searchlights: soft additive cones sweeping the clouds
    const cone = new THREE.CylinderGeometry(22, 1.5, 1400, 20, 1, true);
    cone.translate(0, 700, 0);
    const smat = new THREE.ShaderMaterial({
      uniforms: LU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vW; varying vec3 vN; void main(){ vUv = uv; vN = normalize(mat3(modelMatrix)*normal); vec4 wp = modelMatrix*vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }`,
      fragmentShader: /* glsl */ `varying vec2 vUv; varying vec3 vW; varying vec3 vN;
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          float edge = pow(1.0 - abs(dot(normalize(vN), V)), 2.0);
          float core = 1.0 - edge;
          float fall = pow(vUv.y, 1.3);
          gl_FragColor = vec4(vec3(0.55, 0.65, 0.9) * core * fall * 0.09, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.searchlights = [];
    for (const [deg, r] of [[-128, 900], [-142, 1000], [100, 1500]]) {
      const p = polar(deg, r);
      const s = new THREE.Mesh(cone, smat);
      s.position.set(p.x, GY + 150, p.z);
      s.userData.ph = R() * TAU;
      s.frustumCulled = false; s.renderOrder = 4;
      this.group.add(s);
      this.searchlights.push(s);
      this.reflHide.push(s);
    }
    this.movers.push((t) => {
      for (const s of this.searchlights) { const a = t * 0.12 + s.userData.ph; s.rotation.set(Math.sin(a) * 0.35, 0, Math.cos(a * 0.7) * 0.35 + 0.1); }
    });
  },
});
