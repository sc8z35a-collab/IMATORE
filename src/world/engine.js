import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { QA, QA_DPR, QA_OFF } from '../util/qa.js';

// Final cinematic grade: lens distortion, chromatic aberration, vignette, grain, rain-on-lens glints.
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uCA: { value: 0.0022 },
    uVig: { value: 1.05 },
    uGrain: { value: 0.045 },
    uWarp: { value: 0.0 },
    uFade: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes;
    uniform float uCA; uniform float uVig; uniform float uGrain; uniform float uWarp; uniform float uFade;
    varying vec2 vUv;
    float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c,c);
      // barrel distortion + warp (fast travel)
      uv = 0.5 + c * (1.0 + r2 * (0.035 + uWarp*0.6));
      vec2 dir = c * (uCA + uWarp*0.02) * (0.4 + r2*2.2);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir).b;
      // subtle split tone: cool shadows, warm highlights
      float l = dot(col, vec3(0.2126,0.7152,0.0722));
      col = mix(col * vec3(0.92,1.0,1.1), col * vec3(1.06,1.0,0.92), smoothstep(0.25,0.9,l));
      col = mix(vec3(l), col, 1.08);
      // vignette
      float v = smoothstep(0.95, 0.18, length(c * vec2(uRes.x/uRes.y, 1.0) * 0.72) * uVig);
      col *= mix(0.55, 1.0, v);
      // film grain
      float g = hash(uv * uRes + fract(uTime*7.13)*100.0) - 0.5;
      col += g * uGrain * (1.0 - l*0.6);
      col = mix(col, vec3(0.0), uFade);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !QA_OFF.shadow;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    this.maxDpr = Math.min(window.devicePixelRatio || 1, 3);
    this.dpr = QA ? QA_DPR : Math.min(this.maxDpr, 2.25);
    renderer.setPixelRatio(this.dpr);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 1600);
    this.camera.rotation.order = 'YXZ';

    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: QA ? 0 : 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.62, 0.42, 0.9);
    if (!QA_OFF.bloom) this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);

    this.clock = new THREE.Clock();
    this.frameTimes = [];
    this.lastQualityCheck = 0;
    this.onResize = this.onResize.bind(this);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', () => setTimeout(this.onResize, 250));
    this.onResize();
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    // wider vertical FOV in portrait so the city doesn't feel cramped
    this.camera.fov = w < h ? 78 : 64;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.dpr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w * 0.5, h * 0.5);
    this.final.uniforms.uRes.value.set(w * this.dpr, h * this.dpr);
    this.resizeHooks?.forEach((f) => f(w, h, this.dpr));
  }

  // dynamic resolution to keep motion fluid
  adapt(dt, now) {
    if (QA) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (now - this.lastQualityCheck < 2.5 || this.frameTimes.length < 60) return;
    this.lastQualityCheck = now;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const fps = 1 / avg;
    let next = this.dpr;
    if (fps < 38 && this.dpr > 1.0) next = Math.max(1.0, this.dpr - 0.25);
    else if (fps > 57 && this.dpr < Math.min(this.maxDpr, 2.5)) next = Math.min(this.maxDpr, this.dpr + 0.25);
    if (next !== this.dpr) {
      this.dpr = next;
      this.onResize();
      this.frameTimes.length = 0;
    }
  }

  render(t) {
    this.final.uniforms.uTime.value = t;
    this.composer.render();
  }
}
