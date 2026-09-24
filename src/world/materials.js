import * as THREE from 'three';
import { windowTexture, facadeTexture, facadeRoughTexture } from './textures.js';

// Shared PBR / procedural materials. Loaded once, reused everywhere.
export class Materials {
  constructor(manager, renderer) {
    this.loader = new THREE.TextureLoader(manager);
    this.aniso = renderer.capabilities.getMaxAnisotropy();
    this.m = {};
  }

  tex(url, { srgb = true, repeat = 1 } = {}) {
    const t = this.loader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = this.aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set(repeat, repeat);
    return t;
  }

  pbr(base, { repeat = 1, color = 0xffffff, rough = 1, metal = 0, normalScale = 1 } = {}) {
    return new THREE.MeshStandardMaterial({
      map: this.tex(`/tex/${base}_diff.jpg`, { repeat }),
      normalMap: this.tex(`/tex/${base}_nor_gl.jpg`, { srgb: false, repeat }),
      roughnessMap: this.tex(`/tex/${base}_rough.jpg`, { srgb: false, repeat }),
      normalScale: new THREE.Vector2(normalScale, normalScale),
      color, roughness: rough, metalness: metal,
    });
  }

  build() {
    const m = this.m;
    // world-space UV (we generate UV in metres / tile size), so repeat stays 1
    m.asphalt = this.pbr('asphalt_02', { color: 0x6a6d74, normalScale: 1.2 });
    m.pavers = this.pbr('concrete_pavers_02', { color: 0x8d8f96 });
    m.plaza = this.pbr('concrete_pavers_02', { color: 0x7d8190 });
    m.facadeConcrete = this.pbr('concrete_tile_facade', { color: 0x9a9aa2 });
    m.metal = this.pbr('metal', { metal: 0.85, rough: 0.6, color: 0xb8bcc4 });
    m.metalDark = this.pbr('metal', { metal: 0.9, rough: 0.45, color: 0x3a3e46 });

    // building facades: 4 architectural variants
    const variants = [
      { seed: 11, base: '#5e6168', style: 'office' },
      { seed: 23, base: '#3d4450', style: 'glass' },
      { seed: 37, base: '#77736c', style: 'office' },
      { seed: 51, base: '#2d3038', style: 'glass' },
      { seed: 67, base: '#6b5f58', style: 'resi' },
      { seed: 79, base: '#4a4f58', style: 'office' },
    ];
    const roughO = facadeRoughTexture('office');
    const roughG = facadeRoughTexture('glass');
    m.facades = variants.map((v) => {
      const glass = v.style === 'glass';
      const mat = new THREE.MeshStandardMaterial({
        map: facadeTexture(v.seed, v.base, glass ? 'glass' : 'office'),
        emissiveMap: windowTexture(v.seed * 3, v.style === 'resi' ? 'resi' : v.style),
        emissive: new THREE.Color(1, 1, 1),
        emissiveIntensity: glass ? 1.6 : 1.9,
        roughnessMap: glass ? roughG : roughO,
        roughness: 1,
        metalness: glass ? 0.55 : 0.1,
        envMapIntensity: glass ? 1.6 : 0.6,
      });
      return mat;
    });
    m.roof = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.9, metalness: 0.1 });
    m.roofProps = new THREE.MeshStandardMaterial({ color: 0x5a5e66, roughness: 0.6, metalness: 0.6 });
    m.curb = new THREE.MeshStandardMaterial({ color: 0x7a7d84, roughness: 0.7 });
    m.lineWhite = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.lineYellow = new THREE.MeshStandardMaterial({ color: 0xd9a21b, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.glass = new THREE.MeshPhysicalMaterial({
      color: 0x223344, metalness: 0, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.35,
      envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0.05, depthWrite: false,
    });
    m.chrome = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 1, roughness: 0.12, envMapIntensity: 1.6 });
    m.blackGloss = new THREE.MeshPhysicalMaterial({ color: 0x07080b, metalness: 0.3, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 });
    m.rubber = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.9 });
    return m;
  }
}

// emissive helpers — MeshBasic with >1 colour so they bloom under ACES
export function glow(color, k = 3, opts = {}) {
  const c = new THREE.Color(color).multiplyScalar(k);
  return new THREE.MeshBasicMaterial({ color: c, toneMapped: true, ...opts });
}
