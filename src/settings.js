// User-selectable graphics settings (persisted in localStorage).
//
// Presets:
//   ultra    超軽量  — for old / low-memory phones: no post FX, no shadows, no planar reflection, low-res textures,
//                     no HDR download, fewer outer-city buildings, 30 fps cap, half-res canvas textures.
//   standard 標準    — balanced default for recent phones.
//   high     高画質  — everything on, higher resolution caps.
//
// Build-time choices (texture resolution, geometry density…) need a reload, so changing the preset reloads the page.
// Runtime toggles (rain, post FX strength) apply immediately.
const KEY = 'imatore.settings.v1';

export const PRESETS = {
  ultra: {
    label: '超軽量', desc: '古い端末・省電力向け。エフェクトと遠景を大幅に削減',
    dprCap: 0.85, dprFloor: 0.55, msaa: 0, bloom: false, post: false, shadows: false, shadowMap: 0,
    reflection: false, reflScale: 0, hdr: false, loTex: true, canvasScale: 0.5, rainN: 2500, fpsCap: 30,
    landscape: 0.35, steam: false, screensPerFrame: 1, anisotropy: 2,
  },
  standard: {
    label: '標準', desc: 'バランス重視 (推奨)',
    dprCap: 1.75, dprFloor: 0.75, msaa: 4, bloom: true, post: true, shadows: true, shadowMap: 2048,
    reflection: true, reflScale: 0.45, hdr: true, loTex: false, canvasScale: 1, rainN: 10000, fpsCap: 0,
    landscape: 0.75, steam: true, screensPerFrame: 3, anisotropy: 8,
  },
  high: {
    label: '高画質', desc: 'ハイエンド端末向け。全エフェクト・最大解像度',
    dprCap: 2.25, dprFloor: 1.0, msaa: 4, bloom: true, post: true, shadows: true, shadowMap: 4096,
    reflection: true, reflScale: 0.6, hdr: true, loTex: false, canvasScale: 1, rainN: 14000, fpsCap: 0,
    landscape: 1, steam: true, screensPerFrame: 3, anisotropy: 16,
  },
};

// very rough device-class guess used only when the user never picked a preset
function autoPreset() {
  try {
    const mem = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;
    const ua = navigator.userAgent;
    const oldIOS = /OS (1[0-4])_/.test(ua);
    if (mem <= 2 || cores <= 3 || oldIOS) return 'ultra';
    if (mem >= 8 && cores >= 8) return 'high';
  } catch (e) { /* ignore */ }
  return 'standard';
}

function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
  const q = new URLSearchParams(location.search);
  const forced = q.get('preset');
  const preset = PRESETS[forced] ? forced : PRESETS[saved.preset] ? saved.preset : autoPreset();
  return {
    preset,
    auto: !saved.preset && !forced,
    rain: saved.rain !== undefined ? !!saved.rain : true,
    sound: saved.sound !== undefined ? !!saved.sound : true,
    fx: saved.fx !== undefined ? !!saved.fx : true, // lens grain / CA / vignette
    // world premise: the city is deserted (無人の街). Pedestrians can be switched back on in settings.
    people: saved.people !== undefined ? !!saved.people : false,
    traffic: saved.traffic !== undefined ? !!saved.traffic : true, // driverless (無人運転) traffic on the ring
  };
}

export const SETTINGS = load();
export const Q = { ...PRESETS[SETTINGS.preset] };
export const LITE = SETTINGS.preset === 'ultra';

export function saveSettings(patch = {}) {
  // an explicit preset choice ends auto-detection; toggling rain/sound/... must NOT pin the auto-detected preset
  if ('preset' in patch) patch = { ...patch, auto: false };
  Object.assign(SETTINGS, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify({ preset: SETTINGS.auto ? undefined : SETTINGS.preset, rain: SETTINGS.rain, sound: SETTINGS.sound, fx: SETTINGS.fx, people: SETTINGS.people, traffic: SETTINGS.traffic }));
  } catch (e) { /* private mode */ }
}
