import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { QA, imgPath } from '../util/qa.js';

// Night sky: procedural cloud dome lit by city glow, the (almost) harvest moon with NASA albedo,
// stars, HDR environment for reflections, rain streaks, and the global light rig.
export class Sky {
  constructor(scene, renderer, manager) {
    this.scene = scene;
    this.renderer = renderer;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.manager = manager;
    // direction of the moon (low in the south-east, above avenue 3 / 4)
    this.moonDir = new THREE.Vector3(0.42, 0.36, 0.83).normalize();
  }

  build() {
    const scene = this.scene;
    scene.fog = new THREE.FogExp2(0x0b0f1c, 0.0068);
    scene.background = new THREE.Color(0x05070d);

    // ---- HDR env map (reflections only, background stays procedural) ----
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    if (!QA || new URLSearchParams(location.search).has('env')) new HDRLoader(this.manager).load('/hdr/night.hdr', (hdr) => {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const env = pmrem.fromEquirectangular(hdr).texture;
      scene.environment = env;
      scene.environmentIntensity = 0.18;
      scene.environmentRotation.set(0, 1.2, 0);
      hdr.dispose();
      pmrem.dispose();
    });

    this.buildDome();
    this.buildMoon();
    this.buildRain();
    this.buildLights();
  }

  buildDome() {
    const md = this.moonDir;
    this.domeU = {
      uTime: { value: 0 },
      uMoon: { value: md.clone() },
    };
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: this.domeU,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uMoon; varying vec3 vDir;
        float h(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        float n3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
        float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<6;i++){ s+=a*n3(p); p=p*2.02+vec3(1.7,9.2,3.1); a*=.5; } return s; }
        void main(){
          vec3 d = normalize(vDir);
          float y = d.y;
          // base gradient: sodium/LED light pollution near the horizon, deep navy zenith
          vec3 zen = vec3(0.010,0.014,0.032);
          vec3 hor = vec3(0.16,0.10,0.16);
          vec3 glowC = vec3(0.34,0.18,0.20);
          vec3 col = mix(hor, zen, smoothstep(-0.02, 0.55, y));
          col += glowC * exp(-max(y,0.0)*14.0) * 0.9;
          // stars (sparse through clouds)
          vec3 sp = d*420.0; vec3 si = floor(sp);
          float st = step(0.9975, h(si)) * smoothstep(0.1,0.5,y);
          // clouds: two layers drifting
          vec2 uv = d.xz / (y*1.4 + 0.18);
          float t = uTime*0.006;
          float c1 = fbm(vec3(uv*1.1 + vec2(t, t*0.4), t*0.5));
          float c2 = fbm(vec3(uv*3.3 - vec2(t*1.8, 0.0), 3.0));
          float cov = smoothstep(0.38, 0.78, c1*0.8 + c2*0.35);
          // moon halo & clouds lit by moon
          float md = max(dot(d, uMoon), 0.0);
          float halo = pow(md, 900.0)*1.2 + pow(md, 60.0)*0.35 + pow(md, 8.0)*0.06;
          vec3 moonLit = vec3(0.55,0.62,0.78) * (pow(md, 14.0)*1.4 + 0.05);
          vec3 cityLit = vec3(0.30,0.14,0.22) * exp(-max(y,0.0)*5.0);
          vec3 cloudCol = mix(vec3(0.035,0.035,0.06), vec3(0.09,0.08,0.12), c2) + moonLit*(0.4+c2) + cityLit;
          // silver lining: thin cloud edges near moon
          float edge = smoothstep(0.2,0.5,cov) * (1.0 - smoothstep(0.5,0.9,cov));
          cloudCol += vec3(0.8,0.85,1.0) * edge * pow(md, 30.0) * 1.2;
          col += st * vec3(0.8,0.9,1.0) * (0.5 + 0.5*sin(uTime*3.0 + si.x));
          col += halo * vec3(0.75,0.82,1.0) * (1.0 - cov*0.7);
          col = mix(col, cloudCol, cov * smoothstep(-0.05, 0.12, y) * 0.92);
          // below horizon: dark haze
          col = mix(col, vec3(0.05,0.045,0.07), smoothstep(0.0, -0.1, y));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1400, 64, 32), mat);
    dome.frustumCulled = false;
    dome.renderOrder = -10;
    this.dome = dome;
    this.group.add(dome);
  }

  buildMoon() {
    const L = new THREE.TextureLoader(this.manager);
    const color = L.load(imgPath('/img/moon_color.jpg'));
    color.colorSpace = THREE.SRGBColorSpace;
    color.anisotropy = 8;
    const disp = L.load(imgPath('/img/moon_disp.jpg'));
    // waxing gibbous (2 days before full): lit from the side of the sun
    const sunDir = this.moonDir.clone().multiplyScalar(-1).add(new THREE.Vector3(0.9, 0.2, -0.35)).normalize();
    const mat = new THREE.ShaderMaterial({
      fog: false,
      uniforms: { tCol: { value: color }, tDisp: { value: disp }, uSun: { value: sunDir } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN; varying vec3 vT; varying vec3 vB;
        void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal);
          vT = normalize(mat3(modelMatrix) * vec3(-sin(uv.x*6.2831853), 0.0, cos(uv.x*6.2831853)));
          vB = cross(vN, vT);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tCol; uniform sampler2D tDisp; uniform vec3 uSun;
        varying vec2 vUv; varying vec3 vN; varying vec3 vT; varying vec3 vB;
        void main(){
          vec2 e = vec2(1.0/1024.0, 1.0/512.0);
          float h0 = texture2D(tDisp, vUv).r;
          float hx = texture2D(tDisp, vUv + vec2(e.x,0.0)).r;
          float hy = texture2D(tDisp, vUv + vec2(0.0,e.y)).r;
          vec3 n = normalize(vN - (vT*(hx-h0) + vB*(hy-h0)) * 9.0);
          float l = max(dot(n, uSun), 0.0);
          // lunar opposition surge-ish: flatter falloff (Hapke-like)
          float lit = pow(l, 0.7) * smoothstep(-0.05, 0.12, dot(normalize(vN), uSun));
          vec3 c = texture2D(tCol, vUv).rgb;
          c = pow(c, vec3(2.2));
          vec3 col = c * lit * vec3(1.9,1.85,1.75) * 2.6 + c * 0.012;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const moon = new THREE.Mesh(new THREE.SphereGeometry(26, 96, 64), mat);
    moon.position.copy(this.moonDir).multiplyScalar(1100);
    moon.rotation.y = 2.2;
    moon.renderOrder = -9;
    this.moon = moon;
    this.group.add(moon);
    // soft corona sprite
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 20, 128, 128, 128);
    grd.addColorStop(0, 'rgba(200,215,255,0.55)');
    grd.addColorStop(0.25, 'rgba(160,180,240,0.18)');
    grd.addColorStop(1, 'rgba(120,140,220,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
    spr.scale.setScalar(240);
    spr.position.copy(moon.position).multiplyScalar(0.99);
    spr.renderOrder = -8;
    this.group.add(spr);
  }

  buildRain() {
    // GPU rain: instanced thin quads, positions wrapped around camera in the vertex shader
    const N = 14000;
    const g = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(0.012, 0.9);
    g.index = base.index;
    g.attributes.position = base.attributes.position;
    g.attributes.uv = base.attributes.uv;
    const off = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      off[i * 4] = Math.random();
      off[i * 4 + 1] = Math.random();
      off[i * 4 + 2] = Math.random();
      off[i * 4 + 3] = 0.6 + Math.random() * 0.8;
    }
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    g.instanceCount = N;
    this.rainU = {
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(34, 22, 34) },
      uWind: { value: new THREE.Vector2(0.9, 0.35) }, uAmt: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform vec2 uWind; uniform float uAmt;
        attribute vec4 aOff; varying float vA; varying vec2 vUv;
        void main(){
          float speed = 11.0 * aOff.w;
          vec3 p = aOff.xyz * uBox;
          p.y -= uTime * speed;
          p.xz += uWind * uTime * speed * 0.08;
          // wrap around camera
          vec3 c = uCam - uBox*0.5; c.y = uCam.y - uBox.y*0.35;
          p = mod(p - c, uBox) + c;
          vec3 fall = normalize(vec3(uWind.x*0.08, -1.0, uWind.y*0.08));
          // billboard around fall axis
          vec3 toCam = normalize(uCam - p);
          vec3 side = normalize(cross(fall, toCam));
          vec3 wp = p + side * position.x * (1.0 + aOff.w) + (-fall) * position.y * (0.6 + aOff.w*0.5);
          float d = length(uCam - p);
          vA = smoothstep(0.6, 2.5, d) * (1.0 - smoothstep(12.0, 18.0, d)) * uAmt * step(aOff.x, uAmt + 0.001);
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA; varying vec2 vUv;
        void main(){
          float a = (1.0 - abs(vUv.x - 0.5)*2.0) * smoothstep(0.0,0.4,vUv.y) * smoothstep(1.0,0.6,vUv.y);
          gl_FragColor = vec4(vec3(0.62,0.72,0.9) * 1.4, a * vA * 0.33);
        }`,
    });
    const rain = new THREE.Mesh(g, mat);
    rain.frustumCulled = false;
    rain.renderOrder = 5;
    this.rain = rain;
    this.scene.add(rain);
  }

  buildLights() {
    const scene = this.scene;
    // cool moonlight key (shadows)
    const key = new THREE.DirectionalLight(0x9fb4ff, 0.55);
    key.position.copy(this.moonDir).multiplyScalar(120);
    key.castShadow = true;
    key.shadow.mapSize.set(QA ? 1024 : 4096, QA ? 1024 : 4096);
    const s = 70;
    Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 10, far: 400 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.04;
    key.shadow.radius = 3;
    scene.add(key);
    scene.add(key.target);
    this.key = key;
    // city bounce: magenta-ish from below, navy from above
    const hemi = new THREE.HemisphereLight(0x2a3560, 0x3a1e2a, 0.55);
    scene.add(hemi);
    this.hemi = hemi;
  }

  update(t, camPos) {
    this.domeU.uTime.value = t;
    this.dome.position.copy(camPos);
    this.rainU.uTime.value = t;
    this.rainU.uCam.value.copy(camPos);
    // shadow frustum follows the player (snapped to texels to avoid shimmering)
    const k = this.key;
    const snap = 1.5;
    const cx = Math.round(camPos.x / snap) * snap, cz = Math.round(camPos.z / snap) * snap;
    k.target.position.set(cx, 0, cz);
    k.position.set(cx, 0, cz).addScaledVector(this.moonDir, 150);
    k.target.updateMatrixWorld();
  }
}
