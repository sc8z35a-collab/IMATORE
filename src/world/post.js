import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// =====================================================================================================
//  Extra cinematic post passes (S, 2026-10-03)
//
//  StreakPass — anamorphic lens flare streaks. Very bright emitters (street lamps, headlights, LED trims,
//               the tower beam, fireworks) get long thin horizontal streaks like a 2.39:1 anamorphic lens.
//               Works on the linear HDR buffer (before tone mapping), quarter-res, 3 separable "Kawase"
//               style passes with growing tap spacing -> ~120 px streak for the cost of ~3 small blits.
//  The procedural lens raindrops live in engine.js FinalShader (they need the final colour).
// =====================================================================================================

const VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const PrefilterShader = {
  uniforms: { tDiffuse: { value: null }, uThreshold: { value: 3.0 }, uTexel: { value: new THREE.Vector2() } },
  vertexShader: VS,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uThreshold; uniform vec2 uTexel; varying vec2 vUv;
    vec3 tap(vec2 o){ vec3 c = texture2D(tDiffuse, vUv + o * uTexel).rgb; float l = max(c.r, max(c.g, c.b));
      // soft knee: only the hottest emitters streak; clamp so a single sun-bright texel can't flood the frame
      return c * smoothstep(uThreshold, uThreshold * 2.2, l) / max(1.0, l * 0.12); }
    void main(){
      // 4-tap box (we read the full-res buffer into a 1/4 res target): stable, no sparkle when panning
      vec3 c = tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0));
      gl_FragColor = vec4(c * 0.25, 1.0);
    }`,
};

const BlurShader = {
  uniforms: { tDiffuse: { value: null }, uStep: { value: 1 }, uTexel: { value: new THREE.Vector2() }, uFall: { value: 0.9 } },
  vertexShader: VS,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uStep; uniform vec2 uTexel; uniform float uFall; varying vec2 vUv;
    void main(){
      vec3 s = texture2D(tDiffuse, vUv).rgb; float w = 1.0;
      for (int i = 1; i <= 4; i++) {
        float k = pow(uFall, float(i));
        vec2 o = vec2(float(i) * uStep * uTexel.x, 0.0);
        s += (texture2D(tDiffuse, vUv + o).rgb + texture2D(tDiffuse, vUv - o).rgb) * k; w += 2.0 * k;
      }
      gl_FragColor = vec4(s / w, 1.0);
    }`,
};

const CompositeShader = {
  uniforms: { tDiffuse: { value: null }, tStreak: { value: null }, uStrength: { value: 0.6 }, uTint: { value: new THREE.Color(0.55, 0.75, 1.25) } },
  vertexShader: VS,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform sampler2D tStreak; uniform float uStrength; uniform vec3 uTint; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec3 s = texture2D(tStreak, vUv).rgb;
      // anamorphic coatings shift the streak blue; keep a little of the source hue
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      vec3 st = mix(vec3(l) * uTint, s, 0.35);
      gl_FragColor = vec4(c + st * uStrength, 1.0);
    }`,
};

export class StreakPass extends Pass {
  constructor({ strength = 0.6, threshold = 3.0 } = {}) {
    super();
    this.needsSwap = true;
    const opt = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(4, 4, opt);
    this.rtB = new THREE.WebGLRenderTarget(4, 4, opt);
    const mk = (s) => new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(s.uniforms), vertexShader: s.vertexShader, fragmentShader: s.fragmentShader, depthTest: false, depthWrite: false });
    this.pre = mk(PrefilterShader); this.blur = mk(BlurShader); this.comp = mk(CompositeShader);
    this.pre.uniforms.uThreshold.value = threshold;
    this.comp.uniforms.uStrength.value = strength;
    this.quad = new FullScreenQuad(null);
  }
  get strength() { return this.comp.uniforms.uStrength.value; }
  set strength(v) { this.comp.uniforms.uStrength.value = v; }
  setSize(w, h) {
    const W = Math.max(4, Math.round(w / 4)), H = Math.max(4, Math.round(h / 4));
    this.rtA.setSize(W, H); this.rtB.setSize(W, H);
    this.pre.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.blur.uniforms.uTexel.value.set(1 / W, 1 / H);
  }
  render(renderer, writeBuffer, readBuffer) {
    const q = this.quad;
    if (this.strength <= 0.001) {
      // pass-through (copy) so the chain stays valid when streaks are switched off at runtime
      q.material = this.comp; this.comp.uniforms.tDiffuse.value = readBuffer.texture; this.comp.uniforms.tStreak.value = this.rtB.texture;
      const s = this.strength; this.comp.uniforms.uStrength.value = 0;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); q.render(renderer);
      this.comp.uniforms.uStrength.value = s;
      return;
    }
    // 1) threshold + downsample
    q.material = this.pre; this.pre.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.rtA); q.render(renderer);
    // 2) three horizontal passes, tap spacing 1 -> 4 -> 16 (each pass spreads 9 taps)
    let src = this.rtA, dst = this.rtB;
    q.material = this.blur;
    for (const [step, fall] of [[1, 0.92], [4, 0.9], [16, 0.88]]) {
      this.blur.uniforms.tDiffuse.value = src.texture; this.blur.uniforms.uStep.value = step; this.blur.uniforms.uFall.value = fall;
      renderer.setRenderTarget(dst); q.render(renderer);
      [src, dst] = [dst, src];
    }
    // 3) composite onto the scene
    q.material = this.comp; this.comp.uniforms.tDiffuse.value = readBuffer.texture; this.comp.uniforms.tStreak.value = src.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); q.render(renderer);
  }
  dispose() { this.rtA.dispose(); this.rtB.dispose(); this.pre.dispose(); this.blur.dispose(); this.comp.dispose(); this.quad.dispose(); }
}

// GLSL used by the final grade pass: procedural raindrops on the lens (static beads + sliding drops with trails).
// Returns the UV offset to sample the scene with (refraction) in .xy and the drop mask in .z.
export const LENS_DROPS_GLSL = /* glsl */ `
  float dh1(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
  vec3 dh3(float p){ vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.11369, 0.13787)); p3 += dot(p3, p3.yzx + 19.19); return fract(vec3((p3.x + p3.y) * p3.z, (p3.x + p3.z) * p3.y, (p3.y + p3.z) * p3.x)); }
  // static round beads that pop in, sit, and evaporate
  vec2 beads(vec2 uv, float t){
    uv *= 34.0; vec2 id = floor(uv); uv = fract(uv) - 0.5;
    vec3 n = dh3(id.x * 107.45 + id.y * 3543.654);
    vec2 p = (n.xy - 0.5) * 0.7;
    float d = length(uv - p);
    float fade = fract(t * 0.05 + n.z); fade = smoothstep(0.0, 0.025, fade) * smoothstep(1.0, 0.25, fade);
    float m = smoothstep(0.32 * n.z + 0.05, 0.0, d) * fade * step(0.55, n.z);
    return vec2(m, d);
  }
  // larger drops that slide down in jerky steps leaving a trail of beads
  vec3 sliders(vec2 uv, float t){
    vec2 a = vec2(6.0, 1.0); vec2 grid = a * 2.0;
    vec2 id = floor(uv * grid);
    float colShift = dh1(id.x); uv.y += colShift; id = floor(uv * grid);
    vec3 n = dh3(id.x * 35.2 + id.y * 2376.1);
    vec2 st = fract(uv * grid) - vec2(0.5, 0.0);
    float x = n.x - 0.5;
    float y = uv.y * 20.0; float wig = sin(y + sin(y)); x += wig * (0.5 - abs(x)) * (n.z - 0.5); x *= 0.7;
    float ti = fract(t * 0.18 + n.z);
    y = (smoothstep(0.0, 0.85, ti) * smoothstep(1.0, 0.85, ti) - 0.5) * 0.9 + 0.5;
    vec2 p = vec2(x, y);
    float d = length((st - p) * a.yx);
    float drop = smoothstep(0.4, 0.0, d);
    float r = sqrt(smoothstep(1.0, y, st.y));
    float cd = abs(st.x - x);
    float trail = smoothstep(0.23 * r, 0.15 * r * r, cd);
    float trailFront = smoothstep(-0.02, 0.02, st.y - y);
    trail *= trailFront * r * r;
    y = fract(uv.y * 10.0) + (st.y - 0.5);
    float dd = length(st - vec2(x, y));
    float droplets = smoothstep(0.3, 0.0, dd);
    float m = drop + droplets * r * trailFront;
    return vec3(m, trail, 0.0);
  }
  // amt 0..1 ; returns refraction offset (xy) and coverage (z)
  vec3 lensDrops(vec2 uv, float t, float amt, float aspect){
    if (amt < 0.01) return vec3(0.0);
    vec2 q = vec2(uv.x * aspect, uv.y);
    vec2 b = beads(q, t);
    vec3 s1 = sliders(q * 1.0 + vec2(0.0, t * 0.012), t);
    vec3 s2 = sliders(q * 1.85 + vec2(7.3, t * 0.02), t * 1.3);
    float c = b.x * smoothstep(0.35, 1.0, amt) + (s1.x + s2.x * 0.7) * smoothstep(0.0, 0.6, amt);
    c = smoothstep(0.3, 1.0, c);
    // finite-difference normal of the drop height field -> refraction offset
    vec2 e = vec2(0.0015, 0.0);
    float cx = beads(q + e, t).x + sliders(q + e + vec2(0.0, t * 0.012), t).x;
    float cy = beads(q + e.yx, t).x + sliders(q + e.yx + vec2(0.0, t * 0.012), t).x;
    float c0 = b.x + s1.x;
    vec2 nrm = vec2(cx - c0, cy - c0);
    return vec3(nrm * 0.9 * amt, clamp(c, 0.0, 1.0) * amt);
  }
`;
