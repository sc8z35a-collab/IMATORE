// QA mode (?qa=1): used ONLY by the headless PC test harness (1GB RAM + SwiftShader).
// Real phones never set this flag and always get full quality.
export const QA = new URLSearchParams(location.search).has('qa');
// Root-absolute asset paths ('/img/x.jpg') are rewritten against Vite's base so the site also works
// under a sub-path (GitHub Pages: /IMATORE/). With base './' this yields document-relative URLs.
const BASE = (import.meta.env && import.meta.env.BASE_URL) || '/';
export const asset = (p) => (typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') ? BASE + p.slice(1) : p);
export const texPath = (p) => asset(QA && p.startsWith('/tex/') && !p.startsWith('/tex/lo/') ? p.replace('/tex/', '/tex/lo/') : p);

// QA: canvases are allocated at reduced resolution; width/height are shadowed with the logical size
// so all drawing code stays unchanged (a scale transform maps logical -> backing pixels).
export const QA_CANVAS = QA && !new URLSearchParams(location.search).has('fullcanvas') ? 0.3 : 1;
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  if (QA_CANVAS === 1) return [c, c.getContext('2d')];
  c.width = Math.max(8, Math.round(w * QA_CANVAS)); c.height = Math.max(8, Math.round(h * QA_CANVAS));
  const g = c.getContext('2d');
  const sx = c.width / w, sy = c.height / h;
  Object.defineProperty(c, 'width', { get: () => w, set: () => {} });
  Object.defineProperty(c, 'height', { get: () => h, set: () => {} });
  g.scale(sx, sy);
  const _set = g.setTransform.bind(g);
  g.setTransform = (a = 1, b = 0, cc = 0, d = 1, e = 0, f = 0) => (typeof a === 'object' ? _set(a) : _set(a * sx, b, cc, d * sy, e * sx, f * sy));
  g.resetTransform = () => _set(sx, 0, 0, sy, 0, 0);
  return [c, g];
}
export const imgPath = (p) => asset(QA && typeof p === 'string' && p.startsWith('/img/') && !p.startsWith('/img/lo/') ? p.replace('/img/', '/img/lo/') : p);
// fine-grained QA switches: ?qa=0.4&noshadow&norefl&nobloom
const _q = new URLSearchParams(location.search);
export const QA_OFF = { shadow: _q.has('noshadow'), refl: _q.has('norefl'), bloom: _q.has('nobloom'), compile: _q.has('nocompile'), screens: _q.has('noscreens'), fps: parseFloat(_q.get('fps')) || 0 };
// ?qa=0.4 -> render scale for the software rasteriser
export const QA_DPR = QA ? parseFloat(new URLSearchParams(location.search).get('qa')) || 0.4 : 1;
