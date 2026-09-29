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
// shared uniforms (time, haze, moon)
export const LU = {
  uTime: { value: 0 },
  uHaze: { value: new THREE.Color(0.19, 0.11, 0.17) },
  uHazeDen: { value: 0.00062 },
  uMoon: { value: new THREE.Vector3(0.42, 0.36, 0.83).normalize() },
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
export const BAY_DIR = new THREE.Vector2(0.45, 0.893).normalize();
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
  lattice: { ...polar(160, 640), h: 250, name: 'TOKYO TOWER' },
  skytree: { ...polar(-38, 1500), h: 570, name: 'SKY TREE' },
};
// skyscraper clusters: {deg, r, sigma, amp}
const CLUSTERS = [
  { deg: -150, r: 820, s: 170, amp: 190, name: '新宿' },
  { deg: 18, r: 560, s: 120, amp: 140, name: '汐留' },
  { deg: -112, r: 1320, s: 130, amp: 130, name: '池袋' },
  { deg: 128, r: 720, s: 110, amp: 110, name: '渋谷' },
  { deg: -60, r: 700, s: 110, amp: 80, name: '上野' },
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
  if (r < 345) return false;
  if (waterDepth(x, z) > -18 - margin) return false;
  if (Math.abs(r - EXPRESS_R) < 13 + margin) return false;
  if (Math.abs(r - RAIL_R) < 9 + margin) return false;
  if (segDist(x, z, SPUR_A, BRIDGE_W) < 12 + margin) return false;
  if (segDist(x, z, BRIDGE_E, EAST_END) < 12 + margin) return false;
  if (riverDist(x, z) < 42 + margin) return false;
  for (const k in LANDMARKS) { const l = LANDMARKS[k]; if (Math.hypot(x - l.x, z - l.z) < 70) return false; }
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
