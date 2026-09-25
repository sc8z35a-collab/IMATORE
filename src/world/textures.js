import * as THREE from 'three';
import { makeCanvas } from '../util/qa.js';

// ---------- helpers ----------
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const canvas = makeCanvas;

export function toTex(c, { srgb = true, repeat = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// wrap Japanese / mixed text by character width
export function wrapText(ctx, text, maxW) {
  const lines = [];
  let line = '';
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = ch;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

const JP = '"Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif';
const OR = 'Orbitron,"Noto Sans JP",sans-serif';

// ---------- building windows (emissive) ----------
// one tile = 8 columns x 8 floors
export function windowTexture(seed, style = 'office') {
  const R = rng(seed);
  const S = 1024, N = 8, cell = S / N;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  const warm = ['#ffd9a0', '#ffc27a', '#fff0d0', '#ffe7b0'];
  const cool = ['#cfe8ff', '#a8d4ff', '#e8f4ff', '#bfe3ff'];
  const neon = ['#ff4fd8', '#27e0ff', '#7cff4f', '#ffe14f'];
  for (let y = 0; y < N; y++) {
    const floorLit = R() < 0.85;
    for (let x = 0; x < N; x++) {
      const lit = floorLit && R() < (style === 'office' ? 0.62 : 0.45);
      const px = x * cell, py = y * cell;
      const m = style === 'glass' ? 4 : 14;
      if (lit) {
        const pal = style === 'glass' ? cool : R() < 0.7 ? warm : cool;
        const col = R() < 0.03 ? neon[(R() * 4) | 0] : pal[(R() * pal.length) | 0];
        const grd = g.createLinearGradient(px, py, px, py + cell);
        grd.addColorStop(0, col);
        grd.addColorStop(1, shade(col, 0.55 + R() * 0.3));
        g.globalAlpha = 0.55 + R() * 0.45;
        g.fillStyle = grd;
        g.fillRect(px + m, py + m, cell - m * 2, cell - m * 2 - (style === 'glass' ? 0 : 10));
        // blinds / silhouettes
        if (R() < 0.35) {
          g.globalAlpha = 0.5;
          g.fillStyle = '#000';
          const bl = (R() * 0.6) * (cell - m * 2);
          g.fillRect(px + m, py + m, cell - m * 2, bl);
          for (let k = 0; k < 6; k++) g.fillRect(px + m, py + m + bl + k * 8, cell - m * 2, 2);
        }
        if (R() < 0.15) {
          g.globalAlpha = 0.6; g.fillStyle = '#000';
          const w = 10 + R() * 14, hx = px + m + R() * (cell - m * 2 - w);
          g.beginPath(); g.arc(hx + w / 2, py + cell * 0.55, w * 0.45, 0, 7); g.fill();
          g.fillRect(hx, py + cell * 0.62, w, cell * 0.3);
        }
      } else {
        g.globalAlpha = 1;
        g.fillStyle = R() < 0.3 ? '#0a0d14' : '#030406';
        g.fillRect(px + m, py + m, cell - m * 2, cell - m * 2 - (style === 'glass' ? 0 : 10));
      }
      g.globalAlpha = 1;
    }
  }
  return toTex(c, { repeat: true });
}

// base facade albedo that lines up with window grid
export function facadeTexture(seed, base = '#6d6f74', style = 'office') {
  const R = rng(seed);
  const S = 1024, N = 8, cell = S / N;
  const [c, g] = canvas(S, S);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  // noise
  const id = g.getImageData(0, 0, S, S);
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (R() - 0.5) * 26;
    id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n;
  }
  g.putImageData(id, 0, 0);
  // streaks (rain stains)
  for (let i = 0; i < 90; i++) {
    g.globalAlpha = 0.05 + R() * 0.08;
    g.fillStyle = '#000';
    g.fillRect(R() * S, R() * S, 2 + R() * 5, 40 + R() * 200);
  }
  g.globalAlpha = 1;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const px = x * cell, py = y * cell, m = style === 'glass' ? 4 : 14;
      g.fillStyle = style === 'glass' ? '#1a2230' : '#15181e';
      g.fillRect(px + m, py + m, cell - m * 2, cell - m * 2 - (style === 'glass' ? 0 : 10));
      // sill
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(px + m - 3, py + cell - m - 10, cell - m * 2 + 6, 5);
    }
    // floor slab line
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, y * cell, S, 4);
  }
  return toTex(c, { repeat: true });
}

// window mask used as roughness (glass = smooth) : white=rough
export function facadeRoughTexture(style = 'office') {
  const S = 512, N = 8, cell = S / N;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#d0d0d0';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#1a1a1a';
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const m = style === 'glass' ? 2 : 7;
      g.fillRect(x * cell + m, y * cell + m, cell - m * 2, cell - m * 2 - (style === 'glass' ? 0 : 5));
    }
  return toTex(c, { srgb: false, repeat: true });
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * k) | 0,
    gg = Math.min(255, ((n >> 8) & 255) * k) | 0,
    b = Math.min(255, (n & 255) * k) | 0;
  return `rgb(${r},${gg},${b})`;
}

// ---------- vertical neon signs (tate-kanban) atlas ----------
export const SIGN_WORDS = [
  '今トレ', '速報', '月見', '卓球金', 'AI', '芋栗', '名月', '居酒屋', 'ゲーム', '映画館', 'ちいかわ', 'カラオケ',
  'ラーメン', 'GTA6', '相撲', '阪神', '推し活', 'ドバイ餅', '喫茶', 'ホテル', 'BAR', '書店', '薬局', '寿司',
  'オデュッセイア', '踊る', '平成女児', 'NEWS', 'iPhone', 'Duo', 'CLAUDE', '侍BLUE', '大の里', 'プロセカ', 'TGS', 'ニンダイ',
];
export function signAtlas(seed = 7) {
  const R = rng(seed);
  const cols = 6, rows = 6, W = 128, H = 512;
  const [c, g] = canvas(cols * W, rows * H);
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  const pal = ['#ff2a6d', '#05d9e8', '#ffe14f', '#7cff4f', '#ff9f1c', '#b36bff', '#ffffff', '#ff4fd8'];
  for (let i = 0; i < cols * rows; i++) {
    const x = (i % cols) * W, y = ((i / cols) | 0) * H;
    const word = SIGN_WORDS[i % SIGN_WORDS.length];
    const col = pal[(R() * pal.length) | 0];
    const bgDark = R() < 0.5;
    g.fillStyle = bgDark ? '#07070c' : shade(col, 0.25);
    g.fillRect(x + 6, y + 6, W - 12, H - 12);
    g.strokeStyle = col; g.lineWidth = 6;
    g.shadowColor = col; g.shadowBlur = 18;
    g.strokeRect(x + 12, y + 12, W - 24, H - 24);
    g.fillStyle = bgDark ? col : '#fff';
    const chars = [...word];
    const vertical = !/^[A-Za-z0-9]+$/.test(word) || chars.length <= 4;
    if (vertical) {
      const fs = Math.min(84, (H - 60) / chars.length);
      g.font = `900 ${fs}px ${JP}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      chars.forEach((ch, k) => g.fillText(ch, x + W / 2, y + 30 + fs / 2 + k * fs * 1.02 + (H - 60 - fs * chars.length) / 2));
    } else {
      g.save();
      g.translate(x + W / 2, y + H / 2); g.rotate(Math.PI / 2);
      g.font = `900 ${Math.min(80, 420 / chars.length * 1.4)}px ${OR}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(word, 0, 0);
      g.restore();
    }
    g.shadowBlur = 0;
  }
  const t = toTex(c);
  return { tex: t, cols, rows };
}

// ---------- storefront (ground floor) atlas ----------
const SHOPS = [
  ['月見フェア', '#ffe14f', '期間限定'], ['芋栗スイーツ', '#ff9f1c', 'NEW'], ['ドバイチョコ餅', '#7cff4f', '行列必至'],
  ['ヨアジョン', '#ffffff', 'YOGURT'], ['24H MART', '#27e0ff', 'OPEN'], ['ゲームセンター', '#ff4fd8', 'CLAW'],
  ['ラーメン', '#ff2a2a', '深夜営業'], ['CAFÉ 名月', '#ffd9a0', 'coffee'], ['ガチャ館', '#b36bff', 'めじるし'],
  ['DRUG', '#4fffc3', '24h'], ['書店', '#ffffff', '新刊'], ['居酒屋', '#ff7a3b', '生ビール'],
  ['Mellojoy', '#ffc0f0', 'squishy'], ['3Dフルーツ', '#ff5a5a', 'ICE'], ['カラオケ', '#27e0ff', '歌い放題'],
  ['TICKETS', '#ffe14f', 'GTA VI'],
];
export function shopAtlas(seed = 3) {
  const R = rng(seed);
  const cols = 4, rows = 4, W = 512, H = 256;
  const [c, g] = canvas(cols * W, rows * H);
  SHOPS.forEach(([name, col, sub], i) => {
    const x = (i % cols) * W, y = ((i / cols) | 0) * H;
    // interior glow
    const grd = g.createLinearGradient(x, y, x, y + H);
    grd.addColorStop(0, '#1a1a22');
    grd.addColorStop(0.28, '#1a1a22');
    grd.addColorStop(0.3, shade(col, 0.95));
    grd.addColorStop(1, shade(col, 0.35));
    g.fillStyle = grd;
    g.fillRect(x, y, W, H);
    // shelves / silhouettes
    for (let k = 0; k < 14; k++) {
      g.fillStyle = `rgba(0,0,0,${0.15 + R() * 0.35})`;
      g.fillRect(x + R() * W, y + H * 0.45 + R() * H * 0.4, 20 + R() * 60, 6 + R() * 40);
    }
    // people silhouettes
    for (let k = 0; k < 3; k++) {
      if (R() < 0.6) continue;
      g.fillStyle = 'rgba(0,0,0,.55)';
      const px = x + 40 + R() * (W - 80);
      g.beginPath(); g.arc(px, y + H * 0.5, 14, 0, 7); g.fill();
      g.fillRect(px - 18, y + H * 0.56, 36, H * 0.44);
    }
    // header sign
    g.fillStyle = '#08080c';
    g.fillRect(x, y, W, H * 0.28);
    g.shadowColor = col; g.shadowBlur = 16;
    g.fillStyle = col;
    g.font = `900 ${52}px ${JP}`;
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(name, x + 20, y + H * 0.14);
    g.font = `700 22px ${OR}`;
    g.textAlign = 'right';
    g.fillText(sub, x + W - 16, y + H * 0.14);
    g.shadowBlur = 0;
    // mullions
    g.fillStyle = 'rgba(10,10,14,.9)';
    for (let k = 1; k < 4; k++) g.fillRect(x + (W / 4) * k - 3, y + H * 0.28, 6, H);
  });
  return { tex: toTex(c), cols, rows };
}

// ---------- kiosk / trend panel ----------
export function kioskTexture(item, district, idx) {
  const W = 768, H = 1152;
  const [c, g] = canvas(W, H);
  const col = district.color;
  // bg
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, 'rgba(6,10,22,0.96)');
  bg.addColorStop(1, 'rgba(10,6,24,0.96)');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // scanlines
  g.fillStyle = 'rgba(255,255,255,0.025)';
  for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 2);
  // border
  g.strokeStyle = col; g.lineWidth = 8; g.shadowColor = col; g.shadowBlur = 30;
  g.strokeRect(14, 14, W - 28, H - 28);
  g.shadowBlur = 0;
  // header
  g.fillStyle = col;
  g.fillRect(14, 14, W - 28, 110);
  g.fillStyle = '#05060c';
  g.font = `900 46px ${OR}`;
  g.textBaseline = 'middle';
  g.fillText(district.name, 44, 70);
  g.textAlign = 'right';
  g.font = `900 54px ${OR}`;
  g.fillText(String(idx + 1).padStart(2, '0'), W - 44, 70);
  g.textAlign = 'left';
  // date
  g.fillStyle = district.accent;
  g.font = `700 34px ${OR}`;
  g.fillText(item.date, 44, 180);
  // title
  g.fillStyle = '#ffffff';
  g.font = `900 64px ${JP}`;
  g.shadowColor = col; g.shadowBlur = 12;
  const tl = wrapText(g, item.title, W - 88).slice(0, 4);
  tl.forEach((l, k) => g.fillText(l, 44, 270 + k * 80));
  g.shadowBlur = 0;
  let y = 270 + tl.length * 80 + 20;
  // heat
  g.fillStyle = 'rgba(255,255,255,.12)';
  g.fillRect(44, y, W - 88, 18);
  const hg = g.createLinearGradient(44, 0, W - 44, 0);
  hg.addColorStop(0, col); hg.addColorStop(1, '#ffffff');
  g.fillStyle = hg;
  g.fillRect(44, y, (W - 88) * item.heat / 100, 18);
  g.font = `700 26px ${OR}`;
  g.fillStyle = district.accent;
  g.fillText(`HEAT ${item.heat}`, 44, y + 50);
  y += 100;
  // body
  g.fillStyle = 'rgba(234,246,255,.85)';
  g.font = `400 36px ${JP}`;
  const bl = wrapText(g, item.body, W - 88);
  const maxL = Math.floor((H - y - 120) / 52);
  bl.slice(0, maxL).forEach((l, k) => g.fillText(k === maxL - 1 && bl.length > maxL ? l.slice(0, -1) + '…' : l, 44, y + k * 52));
  // footer
  g.fillStyle = col;
  g.font = `700 28px ${OR}`;
  g.fillText('TAP TO OPEN  ▶', 44, H - 60);
  g.textAlign = 'right';
  g.fillStyle = 'rgba(255,255,255,.5)';
  g.fillText('IMATORE', W - 44, H - 60);
  return toTex(c, { aniso: 16 });
}

// ---------- district gateway banner ----------
export function bannerTexture(district, headline) {
  const W = 2048, H = 512;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#05060c';
  g.fillRect(0, 0, W, H);
  const grd = g.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, district.color);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = 0.35; g.fillStyle = grd; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
  g.fillStyle = 'rgba(255,255,255,.04)';
  for (let y = 0; y < H; y += 8) g.fillRect(0, y, W, 3);
  g.shadowColor = district.color; g.shadowBlur = 40;
  g.fillStyle = '#fff';
  g.font = `900 190px ${OR}`;
  g.textBaseline = 'middle';
  g.fillText(district.name, 70, 200);
  g.shadowBlur = 0;
  g.fillStyle = district.color;
  g.font = `900 92px ${JP}`;
  g.fillText(district.jp + ' ／ ' + district.tagline, 76, 380);
  g.fillStyle = district.accent;
  g.font = `700 54px ${JP}`;
  g.textAlign = 'right';
  g.fillText('▶ ' + headline, W - 60, 460);
  return toTex(c, { aniso: 16 });
}

// ---------- scrolling LED headline strip ----------
export class LedStrip {
  constructor(text, color = '#ffe14f', w = 2048, h = 128) {
    [this.c, this.g] = canvas(w, h);
    this.text = text; this.color = color;
    this.tex = toTex(this.c);
    this.tex.wrapS = THREE.RepeatWrapping;
    this.draw();
  }
  draw() {
    const { g, c } = this;
    g.fillStyle = '#020203';
    g.fillRect(0, 0, c.width, c.height);
    g.font = `900 ${c.height * 0.62}px ${JP}`;
    g.textBaseline = 'middle';
    g.fillStyle = this.color;
    g.shadowColor = this.color; g.shadowBlur = 10;
    let x = 10;
    const t = this.text + '　◆　';
    while (x < c.width) { g.fillText(t, x, c.height / 2); x += g.measureText(t).width; }
    g.shadowBlur = 0;
    // LED dot mask
    g.fillStyle = 'rgba(0,0,0,.45)';
    for (let y = 0; y < c.height; y += 4) g.fillRect(0, y, c.width, 1);
    for (let xx = 0; xx < c.width; xx += 4) g.fillRect(xx, 0, 1, c.height);
    this.tex.needsUpdate = true;
  }
}

// ---------- central tower cylindrical text ----------
export function towerTexture(list) {
  const W = 4096, H = 1024;
  const [c, g] = canvas(W, H);
  g.fillStyle = 'rgba(0,0,0,0)';
  g.clearRect(0, 0, W, H);
  const rows = 6, rh = H / rows;
  const cols = ['#27e0ff', '#ff4fd8', '#ffe14f', '#7cff4f', '#ff9f1c', '#b36bff'];
  for (let r = 0; r < rows; r++) {
    let x = 0;
    g.font = `900 ${rh * 0.52}px ${JP}`;
    g.textBaseline = 'middle';
    let k = r * 3;
    while (x < W + 400) {
      const it = list[k % list.length];
      const s = `${it.t}　`;
      g.fillStyle = cols[(k + r) % cols.length];
      g.shadowColor = g.fillStyle; g.shadowBlur = 24;
      g.fillText(s, x, rh * r + rh / 2);
      x += g.measureText(s).width + 60;
      k++;
    }
  }
  g.shadowBlur = 0;
  const t = toTex(c, { aniso: 16 });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// radial soft spot (for light pools / glows)
export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 256) {
  const [c, g] = canvas(size, size);
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.35)'));
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return toTex(c);
}

// minimap-like floor marking for plaza
export function plazaFloorTexture(districts) {
  const S = 2048;
  const [c, g] = canvas(S, S);
  g.clearRect(0, 0, S, S);
  const cx = S / 2;
  g.lineWidth = 10;
  for (let r = 1; r <= 4; r++) {
    g.strokeStyle = `rgba(39,224,255,${0.1 + r * 0.05})`;
    g.beginPath(); g.arc(cx, cx, r * 230, 0, 7); g.stroke();
  }
  districts.forEach((d, i) => {
    const a = (i / districts.length) * Math.PI * 2;
    g.save();
    g.translate(cx, cx);
    g.rotate(-a + Math.PI / 2);
    g.strokeStyle = d.color; g.lineWidth = 14;
    g.shadowColor = d.color; g.shadowBlur = 30;
    g.beginPath(); g.moveTo(0, -250); g.lineTo(0, -1000); g.stroke();
    g.font = `900 64px ${OR}`;
    g.fillStyle = d.color;
    g.textAlign = 'center';
    g.fillText(d.name, 0, -820);
    g.restore();
  });
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,255,255,.9)';
  g.font = `900 120px ${JP}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  return toTex(c, { aniso: 16 });
}
