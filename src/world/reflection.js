import * as THREE from 'three';
import { QA } from '../util/qa.js';

// Planar reflection for the ground plane (y = 0), shared by every ground material.
// Materials get it injected via onBeforeCompile -> wet asphalt with puddles & rain ripples.
export class GroundReflection {
  constructor(renderer, scale = 0.5) {
    this.renderer = renderer;
    this.scale = scale;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: QA ? 0 : 2 });
    this.cam = new THREE.PerspectiveCamera();
    this.texMat = new THREE.Matrix4();
    this.hide = [];            // objects hidden during reflection pass
    this.uniforms = {
      tRefl: { value: this.rt.texture },
      uReflMat: { value: this.texMat },
      uTime: { value: 0 },
      uRain: { value: 1 },
      uReflRes: { value: new THREE.Vector2(4, 4) },
    };
    this._clip = new THREE.Vector4();
    this._q = new THREE.Vector4();
    this._plane = new THREE.Plane();
    this._v = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._la = new THREE.Vector3();
    this._rm = new THREE.Matrix4();
  }

  setSize(w, h, dpr) {
    const W = Math.max(4, Math.floor(w * dpr * this.scale));
    const H = Math.max(4, Math.floor(h * dpr * this.scale));
    this.rt.setSize(W, H);
    this.uniforms.uReflRes.value.set(W, H);
  }

  update(scene, camera) {
    const cam = this.cam;
    const cp = camera.getWorldPosition(this._v);
    this._rm.extractRotation(camera.matrixWorld);
    this._la.set(0, 0, -1).applyMatrix4(this._rm).add(cp);
    // mirror about y=0
    cam.position.set(cp.x, -cp.y, cp.z);
    this._t.set(this._la.x, -this._la.y, this._la.z);
    cam.up.set(0, 1, 0).applyMatrix4(this._rm);
    cam.up.y *= -1;
    cam.lookAt(this._t);
    cam.far = camera.far;
    cam.near = camera.near;
    cam.fov = camera.fov; cam.aspect = camera.aspect; cam.zoom = camera.zoom; cam.layers.mask = camera.layers.mask;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    this.texMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.texMat.multiply(cam.projectionMatrix);
    this.texMat.multiply(cam.matrixWorldInverse);

    // oblique near plane clipping at ground
    this._plane.set(new THREE.Vector3(0, 1, 0), 0.02);
    this._plane.applyMatrix4(cam.matrixWorldInverse);
    const clip = this._clip.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant);
    const pm = cam.projectionMatrix;
    const q = this._q;
    q.x = (Math.sign(clip.x) + pm.elements[8]) / pm.elements[0];
    q.y = (Math.sign(clip.y) + pm.elements[9]) / pm.elements[5];
    q.z = -1.0;
    q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    clip.multiplyScalar(2.0 / clip.dot(q));
    pm.elements[2] = clip.x; pm.elements[6] = clip.y; pm.elements[10] = clip.z + 1.0; pm.elements[14] = clip.w;

    const r = this.renderer;
    // reflective surfaces sample this.rt -> they must not be drawn into it (feedback loop)
    if (!this._self) { this._self = []; scene.traverse((o) => { if (o.isMesh && o.material?.userData?.reflSelf) this._self.push(o); }); }
    for (const o of this._self) o.visible = false;
    for (const o of this.hide) o.visible = false;
    const prevRT = r.getRenderTarget();
    const prevShadow = r.shadowMap.autoUpdate;
    // first frame: let the shadow map be generated here, otherwise shadow samplers bind a non-depth dummy texture
    this._n = (this._n || 0) + 1;
    if (this._n > 2) r.shadowMap.autoUpdate = false;
    try {
      r.setRenderTarget(this.rt);
      r.clear();
      r.render(scene, cam);
    } finally {
      r.setRenderTarget(prevRT);
      r.shadowMap.autoUpdate = prevShadow;
      for (const o of this.hide) o.visible = true;
      for (const o of this._self) o.visible = true;
    }
  }

  // inject into a MeshStandardMaterial / MeshPhysicalMaterial
  // wet: base wetness 0..1 ; puddle: amount of puddles
  patch(material, { wet = 0.7, puddle = 0.5, tint = new THREE.Color(1, 1, 1) } = {}) {
    const U = this.uniforms;
    material.userData.reflSelf = true;
    material.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U, {
        uWet: { value: wet }, uPuddle: { value: puddle }, uTint: { value: tint },
      });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          uniform mat4 uReflMat; varying vec4 vReflUv; varying vec3 vWPos;`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vec4 wp4 = modelMatrix * vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp4 = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          #endif
          vWPos = wp4.xyz; vReflUv = uReflMat * wp4;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D tRefl; uniform float uTime; uniform float uRain; uniform float uWet; uniform float uPuddle;
          uniform vec3 uTint; uniform vec2 uReflRes;
          varying vec4 vReflUv; varying vec3 vWPos;
          float h21(vec2 p){ p = fract(p*vec2(233.34, 851.73)); p += dot(p, p+23.45); return fract(p.x*p.y); }
          float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
          float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s; }
          // expanding rain ripples, returns normal offset
          vec2 ripples(vec2 p, float t){
            vec2 acc = vec2(0.0);
            for(int k=0;k<2;k++){
              vec2 q = p*(k==0?1.3:2.1) + float(k)*7.3;
              vec2 id = floor(q); vec2 f = fract(q)-0.5;
              float rnd = h21(id + float(k)*3.1);
              float ph = fract(t*(0.9+rnd*0.6) + rnd*7.0);
              vec2 o = vec2(h21(id+1.7), h21(id+4.3)) - 0.5;
              vec2 d = f - o*0.6;
              float r = length(d);
              float ring = sin((r - ph*0.55)*48.0) * smoothstep(0.0,0.08,ph) * (1.0-ph) * smoothstep(0.55*ph+0.06, 0.55*ph-0.02, r) * smoothstep(0.0, 0.02, r);
              acc += normalize(d+1e-4) * ring;
            }
            return acc;
          }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          float pud = smoothstep(0.52 - uPuddle*0.25, 0.62 - uPuddle*0.25, fbm(vWPos.xz*0.09 + 3.1) * 0.75 + fbm(vWPos.xz*0.6)*0.25);
          float wetK = clamp(uWet*0.55 + pud, 0.0, 1.0);
          roughnessFactor = mix(roughnessFactor, mix(0.32, 0.06, pud), wetK);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          normal = normalize(mix(normal, vec3(0.0,0.0,1.0) * sign(normal.z + 1e-4) , pud*0.85));`)
        .replace('#include <opaque_fragment>', `
          {
            vec2 rp = ripples(vWPos.xz*1.6, uTime) * uRain;
            vec2 nrm = (normal.xy) * (1.0 - pud) * 0.06 + rp * 0.012;
            vec4 ru = vReflUv; ru.xy += vec4(nrm, 0.0, 0.0).xy * ru.w;
            vec2 uv = ru.xy / ru.w;
            // anisotropic vertical smear (wet asphalt streaks)
            float sm = mix(0.028, 0.002, pud);
            vec3 refl = vec3(0.0); float wsum = 0.0;
            for(int i=-3;i<=3;i++){ float w = 1.0 - abs(float(i))/4.0; refl += texture2D(tRefl, uv + vec2(0.0, float(i)*sm*0.33)).rgb * w; wsum += w; }
            refl /= wsum;
            vec3 V = normalize(cameraPosition - vWPos);
            float fres = 0.04 + 0.96 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
            float k = wetK * mix(0.35, 1.0, fres);
            outgoingLight = mix(outgoingLight, outgoingLight*0.3, wetK*0.7) + refl * uTint * k * 1.15;
          }
          #include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => 'wetground';
    return material;
  }
}
