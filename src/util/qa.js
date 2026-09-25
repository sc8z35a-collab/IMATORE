// QA mode (?qa=1): used ONLY by the headless PC test harness (1GB RAM + SwiftShader).
// Real phones never set this flag and always get full quality.
export const QA = new URLSearchParams(location.search).has('qa');
export const texPath = (p) => (QA && p.startsWith('/tex/') && !p.startsWith('/tex/lo/') ? p.replace('/tex/', '/tex/lo/') : p);
