import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Collects geometry per material key, merges into single meshes at the end (few draw calls).
export class Batch {
  constructor() { this.parts = new Map(); }
  add(key, geo, matrix) {
    if (matrix) geo.applyMatrix4(matrix);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(geo);
  }
  build(materials, parent, { shadows = {} } = {}) {
    const out = {};
    for (const [key, list] of this.parts) {
      if (!materials[key]) { console.warn('missing material', key); continue; }
      // normalise attributes so merge works (all need uv + normal, non-indexed/indexed consistency)
      const norm = list.map((g) => {
        let q = g.index ? g.toNonIndexed() : g;
        if (!q.attributes.uv) q.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2));
        if (!q.attributes.normal) q.computeVertexNormals();
        for (const n of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(n)) q.deleteAttribute(n);
        return q;
      });
      const merged = mergeGeometries(norm, false);
      list.forEach((g) => g.dispose());
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, materials[key]);
      mesh.name = key;
      const s = shadows[key] || {};
      mesh.castShadow = !!s.cast;
      mesh.receiveShadow = !!s.receive;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      out[key] = mesh;
    }
    this.parts.clear();
    return out;
  }
}

// Quad in local space: origin bottom-left, spans +X width and +Y height, facing +Z.
export function quad(w, h, uv = [0, 0, 1, 1]) {
  const g = new THREE.PlaneGeometry(w, h);
  g.translate(w / 2, h / 2, 0);
  const a = g.attributes.uv;
  const [u0, v0, u1, v1] = uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, u0 + a.getX(i) * (u1 - u0), v0 + a.getY(i) * (v1 - v0));
  return g;
}

// Box centred on X/Z, bottom at y=0. Per-face UVs in metres * scale so facades tile correctly.
// faces: string containing any of 'fbrlt' (front +z, back -z, right +x, left -x, top)
export function box(w, h, d, { su = 1, sv = 1, ou = 0, ov = 0, faces = 'fbrlt' } = {}) {
  const pos = [], nor = [], uv = [];
  const hw = w / 2, hd = d / 2;
  const face = (p0, p1, p2, p3, n, uw, vh) => {
    // p0 bl, p1 br, p2 tr, p3 tl
    const U = [[0, 0], [uw, 0], [uw, vh], [0, vh]];
    const idx = [0, 1, 2, 0, 2, 3];
    const P = [p0, p1, p2, p3];
    for (const i of idx) {
      pos.push(...P[i]); nor.push(...n);
      uv.push(U[i][0] * su + ou, U[i][1] * sv + ov);
    }
  };
  if (faces.includes('f')) face([-hw, 0, hd], [hw, 0, hd], [hw, h, hd], [-hw, h, hd], [0, 0, 1], w, h);
  if (faces.includes('b')) face([hw, 0, -hd], [-hw, 0, -hd], [-hw, h, -hd], [hw, h, -hd], [0, 0, -1], w, h);
  if (faces.includes('r')) face([hw, 0, hd], [hw, 0, -hd], [hw, h, -hd], [hw, h, hd], [1, 0, 0], d, h);
  if (faces.includes('l')) face([-hw, 0, -hd], [-hw, 0, hd], [-hw, h, hd], [-hw, h, -hd], [-1, 0, 0], d, h);
  if (faces.includes('t')) face([-hw, h, hd], [hw, h, hd], [hw, h, -hd], [-hw, h, -hd], [0, 1, 0], w, d);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// set UVs from world XZ (for ground materials) — call after transform
export function worldUV(geo, scale = 4, rot = 0) {
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    uv[i * 2] = (x * c - z * s) / scale;
    uv[i * 2 + 1] = (x * s + z * c) / scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
export function mat(x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return _m.clone().compose(_p, _q, _s);
}

// flat strip on ground between two lateral offsets along an avenue segment
export function groundStrip(dir, d0, d1, s0, s1, y = 0) {
  const nx = -dir.z, nz = dir.x;
  const P = (d, s) => [dir.x * d + nx * s, y, dir.z * d + nz * s];
  const a = P(d0, s0), b = P(d0, s1), c = P(d1, s1), e = P(d1, s0);
  const g = new THREE.BufferGeometry();
  // winding so normal points +Y
  const verts = [...a, ...c, ...b, ...a, ...e, ...c];
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) {
    const v2 = [...a, ...b, ...c, ...a, ...c, ...e];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v2, 3));
    g.computeVertexNormals();
  }
  return g;
}
