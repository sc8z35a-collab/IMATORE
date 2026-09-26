import * as THREE from 'three';
import { makeCanvas, imgPath } from '../util/qa.js';
import { wrapText, toTex } from './textures.js';

const JP = '"Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif';
const OR = 'Orbitron,"Noto Sans JP",sans-serif';

// LED panel shader: cover-fit UV, RGB sub-pixel grid visible up close, fades to smooth far away,
// slight view-angle falloff + scanline refresh band.
const vs = /* glsl */ `
  varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDist;
  void main(){
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position,1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = cameraPosition - wp.xyz;
    vDist = length(vV);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const fs = /* glsl */ `
  uniform sampler2D map; uniform vec4 uvXform; uniform float uBright; uniform float uTime; uniform vec2 uPx; uniform float uOn;
  varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDist;
  void main(){
    vec2 uv = uvXform.xy + vUv * uvXform.zw;
    vec3 c = texture2D(map, uv).rgb;
    c = pow(c, vec3(2.2)); // sRGB canvas -> linear
    // LED grid
    vec2 g = fract(vUv * uPx);
    float sub = fract(vUv.x * uPx.x * 3.0);
    vec3 mask = vec3(step(sub,0.333), step(0.333,sub)*step(sub,0.666), step(0.666,sub));
    float dotm = smoothstep(0.5, 0.36, length(g - 0.5));
    float near = clamp(1.0 - vDist / 22.0, 0.0, 1.0);
    vec3 led = c * mix(vec3(1.0), mask * 2.6 * dotm + 0.08, near * 0.85);
    // viewing angle falloff
    float ang = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
    led *= mix(0.45, 1.0, pow(ang, 0.6));
    // refresh band
    float band = smoothstep(0.0, 0.02, abs(fract(vUv.y - uTime * 0.07) - 0.5) - 0.47);
    led *= 0.94 + 0.06 * band;
    gl_FragColor = vec4(led * uBright * uOn, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function ledMaterial(tex, w, h, texAspect, bright = 2.2) {
  const a = w / h;
  // cover fit
  let sx = 1, sy = 1;
  if (a > texAspect) sy = texAspect / a; else sx = a / texAspect;
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: tex },
      uvXform: { value: new THREE.Vector4((1 - sx) / 2, (1 - sy) / 2, sx, sy) },
      uBright: { value: bright },
      uTime: { value: 0 },
      uOn: { value: 1 },
      uPx: { value: new THREE.Vector2(w * 18, h * 18) },
    },
    vertexShader: vs, fragmentShader: fs, toneMapped: true,
  });
}

// ------------------ animated channels ------------------
// A channel is a canvas slideshow. kinds: 'land' 1280x720, 'port' 720x1280, 'band' 2048x128
export class Channel {
  constructor(kind, district, images, allTop) {
    this.kind = kind; this.d = district; this.images = images; this.top = allTop;
    const [W, H] = kind === 'land' ? [1280, 720] : kind === 'port' ? [720, 1280] : [2048, 128];
    [this.c, this.g] = makeCanvas(W, H);
    this.tex = toTex(this.c, { aniso: 8 });
    this.tex.generateMipmaps = true;
    this.aspect = W / H;
    this.slide = 0;
    this.t0 = Math.random() * 6;
    this.slideLen = 7 + Math.random() * 2;
    this.scroll = Math.random() * 1000;
    this.mats = [];
  }

  img(k) {
    const list = this.images;
    if (!list.length) return null;
    const im = list[k % list.length];
    return im && im.complete && im.naturalWidth ? im : null;
  }

  drawCover(im, x, y, w, h, zoom = 1, panX = 0, panY = 0) {
    const g = this.g;
    if (!im.naturalWidth || !im.naturalHeight) return;
    const ia = im.naturalWidth / im.naturalHeight, a = w / h;
    let sw, sh;
    if (ia > a) { sh = im.naturalHeight; sw = sh * a; } else { sw = im.naturalWidth; sh = sw / a; }
    sw /= zoom; sh /= zoom;
    const sx = (im.naturalWidth - sw) / 2 + panX * (im.naturalWidth - sw) / 2;
    const sy = (im.naturalHeight - sh) / 2 + panY * (im.naturalHeight - sh) / 2;
    g.drawImage(im, sx, sy, sw, sh, x, y, w, h);
  }

  update(t) {
    const g = this.g, W = this.c.width, H = this.c.height, d = this.d;
    if (this.kind === 'band') return this.drawBand(t);
    const lt = t + this.t0;
    const idx = Math.floor(lt / this.slideLen);
    const p = (lt % this.slideLen) / this.slideLen;
    const items = d.items;
    if (!items.length) return;
    const mode = idx % 3;
    g.save();
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const im = this.img(idx);
    const port = this.kind === 'port';
    if (mode === 0 || mode === 2) {
      // hero image w/ ken burns + headline
      const item = items[idx % items.length];
      const ii = item.imgEl && item.imgEl.complete && item.imgEl.naturalWidth ? item.imgEl : im;
      if (ii) {
        this.drawCover(ii, 0, 0, W, H, 1.05 + p * 0.12, Math.sin(idx * 1.7) * 0.6 * (p - 0.5), Math.cos(idx) * 0.3 * (p - 0.5));
      } else {
        const gr = g.createLinearGradient(0, 0, W, H);
        gr.addColorStop(0, d.color); gr.addColorStop(1, '#000');
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
      }
      const grd = g.createLinearGradient(0, H * 0.35, 0, H);
      grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,.92)');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      // tag
      g.fillStyle = d.color;
      const tagH = port ? 64 : 58;
      g.fillRect(port ? 40 : 50, port ? 60 : 44, port ? 360 : 380, tagH);
      g.fillStyle = '#000';
      g.font = `900 ${port ? 36 : 34}px ${OR}`;
      g.textBaseline = 'middle';
      g.fillText(d.name, (port ? 40 : 50) + 18, (port ? 60 : 44) + tagH / 2 + 2);
      g.fillStyle = '#fff';
      g.font = `700 ${port ? 34 : 30}px ${OR}`;
      g.textAlign = 'right';
      g.fillText(item.date, W - (port ? 40 : 50), (port ? 60 : 44) + tagH / 2);
      g.textAlign = 'left';
      // headline (typewriter reveal)
      const fs = port ? 84 : 76;
      g.font = `900 ${fs}px ${JP}`;
      const lines = wrapText(g, item.title, W - (port ? 80 : 110)).slice(0, port ? 5 : 3);
      const reveal = Math.min(1, p * 3.2);
      // count against the visible (possibly truncated) lines, not the full title
      let chars = Math.floor(reveal * lines.reduce((n, l) => n + l.length, 0));
      g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 16;
      const baseY = H - (port ? 330 : 200) - (lines.length - 1) * fs * 1.12;
      lines.forEach((l, k) => {
        const s = l.slice(0, Math.max(0, chars)); chars -= l.length;
        g.fillText(s, port ? 40 : 55, baseY + k * fs * 1.12);
      });
      g.shadowBlur = 0;
      // body snippet
      g.fillStyle = 'rgba(255,255,255,.82)';
      g.font = `400 ${port ? 36 : 30}px ${JP}`;
      const bl = wrapText(g, item.body, W - (port ? 80 : 110)).slice(0, port ? 4 : 2);
      bl.forEach((l, k) => g.fillText(l, port ? 40 : 55, H - (port ? 190 : 110) + k * (port ? 50 : 42) - (port ? 0 : 0)));
      // heat bar
      g.fillStyle = 'rgba(255,255,255,.18)';
      g.fillRect(0, H - 12, W, 12);
      g.fillStyle = d.color;
      g.fillRect(0, H - 12, W * (Math.max(0, Math.min(100, item.heat)) / 100) * Math.min(1, p * 2), 12);
    } else {
      // ranking board
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, '#060a18'); gr.addColorStop(1, '#10061c');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      if (im) { g.globalAlpha = 0.18; this.drawCover(im, 0, 0, W, H, 1.2); g.globalAlpha = 1; }
      g.fillStyle = d.color;
      g.font = `900 ${port ? 64 : 56}px ${OR}`;
      g.textBaseline = 'middle';
      g.fillText(d.name, 50, port ? 90 : 70);
      g.fillStyle = 'rgba(255,255,255,.7)';
      g.font = `700 ${port ? 32 : 28}px ${JP}`;
      g.fillText('HEAT RANKING  ' + d.jp, 52, port ? 150 : 120);
      const sorted = [...items].sort((a, b) => b.heat - a.heat).slice(0, port ? 9 : 6);
      const rowH = port ? 118 : 88;
      const y0 = port ? 220 : 170;
      sorted.forEach((it, k) => {
        const a = Math.min(1, Math.max(0, p * 6 - k * 0.35));
        const y = y0 + k * rowH;
        g.globalAlpha = a;
        g.fillStyle = k < 3 ? d.color : 'rgba(255,255,255,.12)';
        g.fillRect(50, y, 86, rowH - 16);
        g.fillStyle = k < 3 ? '#000' : '#fff';
        g.font = `900 ${port ? 50 : 44}px ${OR}`;
        g.textAlign = 'center';
        g.fillText(String(k + 1), 93, y + (rowH - 16) / 2 + 2);
        g.textAlign = 'left';
        g.fillStyle = '#fff';
        g.font = `700 ${port ? 38 : 36}px ${JP}`;
        let tt = it.title;
        const mw = W - (port ? 220 : 360);
        if (g.measureText(tt).width > mw) {
          while (g.measureText(tt + '…').width > mw && tt.length > 1) tt = tt.slice(0, -1);
          tt += '…';
        }
        g.fillText(tt, 160, y + (rowH - 16) / 2 - (port ? 12 : 0));
        if (port) {
          g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(160, y + rowH - 44, W - 220, 8);
          g.fillStyle = d.color; g.fillRect(160, y + rowH - 44, (W - 220) * it.heat / 100 * a, 8);
        } else {
          g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(W - 180, y + 30, 130, 10);
          g.fillStyle = d.color; g.fillRect(W - 180, y + 30, 130 * it.heat / 100 * a, 10);
        }
        g.globalAlpha = 1;
      });
    }
    // sweep transition at start
    if (p < 0.06) {
      const k = p / 0.06;
      g.fillStyle = d.color;
      g.fillRect(port ? 0 : W * k - W * 0.15, port ? H * k - H * 0.15 : 0, port ? W : W * 0.15, port ? H * 0.15 : H);
    }
    // corner live badge
    g.fillStyle = '#ff2a2a';
    g.beginPath(); g.arc(W - 40, H - 44 - (port ? 0 : 0), 10, 0, 7);
    if (Math.sin(t * 5) > 0) g.fill();
    g.restore();
    this.tex.needsUpdate = true;
  }

  drawBand(t) {
    const g = this.g, W = this.c.width, H = this.c.height, d = this.d;
    g.fillStyle = '#020204'; g.fillRect(0, 0, W, H);
    g.font = `900 ${H * 0.6}px ${JP}`;
    g.textBaseline = 'middle';
    if (!this.bandText) {
      this.bandText = [d.name + ' ／ ' + d.jp, ...d.items.map((i) => i.title)].join('　◆　') + '　◆　';
      this.bandW = g.measureText(this.bandText).width;
    }
    const x = -((t * 180 + this.scroll) % Math.max(1, this.bandW));
    g.fillStyle = d.color;
    g.fillText(this.bandText, x, H / 2 + 2);
    g.fillText(this.bandText, x + this.bandW, H / 2 + 2);
    this.tex.needsUpdate = true;
  }
}

export class ScreenSystem {
  constructor(scene, districts, top) {
    this.scene = scene; this.districts = districts; this.top = top;
    this.channels = [];
    this.meshes = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.cursor = 0;
    this.time = 0;
  }

  loadImages(extra = []) {
    const cache = new Map();
    const load = (url) => {
      if (!url) return null;
      if (cache.has(url)) return cache.get(url);
      const im = new Image(); im.decoding = 'async';
      im.onerror = () => console.warn('image failed:', url);
      im.src = imgPath(url); cache.set(url, im); return im;
    };
    this.districts.forEach((d) => {
      d.imgEls = [d.img, ...(d.gallery || [])].map(load).filter(Boolean);
      d.items.forEach((it) => { if (it.img) it.imgEl = load(it.img); });
    });
    this.imgCache = cache;
    return load;
  }

  build(anchors) {
    const byD = this.districts.map((d) => ({
      land: [new Channel('land', d, d.imgEls, this.top), new Channel('land', d, d.imgEls, this.top)],
      port: new Channel('port', d, d.imgEls, this.top),
      band: new Channel('band', d, d.imgEls, this.top),
    }));
    byD.forEach((o) => this.channels.push(...o.land, o.port, o.band));
    anchors.forEach((a, k) => {
      const set = byD[a.district % this.districts.length];
      let ch;
      if (a.kind === 'band') ch = set.band;
      else if (a.h > a.w * 1.1) ch = set.port;
      else ch = set.land[k % 2];
      const m = ledMaterial(ch.tex, a.w, a.h, ch.aspect, a.kind === 'band' ? 2.6 : 2.0);
      ch.mats.push(m);
      const geo = new THREE.PlaneGeometry(a.w, a.h);
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(a.x, a.y, a.z);
      mesh.rotation.y = a.yaw;
      mesh.userData = { screen: true, district: a.district, kind: a.kind };
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      this.group.add(mesh);
      this.meshes.push(mesh);
    });
    // prime
    this.channels.forEach((c) => c.update(0));
  }

  // update a few channels per frame (staggered), all uniforms every frame
  update(t, dt, camPos) {
    this.time = t;
    const n = this.channels.length;
    if (!n) return;
    const perFrame = Math.min(3, n);
    for (let k = 0; k < perFrame; k++) {
      const c = this.channels[this.cursor % n];
      this.cursor++;
      c.update(t);
    }
    for (const m of this.meshes) m.material.uniforms.uTime.value = t;
  }
}
