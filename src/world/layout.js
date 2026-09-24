// World layout: a circular central plaza with 8 radial "trend avenues".
export const PLAZA_R = 30;          // plaza radius (m)
export const AVE_HALF = 8;          // avenue half width (road 4 + sidewalk 4)
export const ROAD_HALF = 4;
export const AVE_LEN = 130;         // avenue length from plaza edge
export const N_AVE = 8;
export const KIOSK_SPACING = 10.5;
export const KIOSK_START = 12;      // first kiosk distance from plaza edge
export const EYE = 1.62;

export function aveAngle(i) {
  // avenue 0 points to -Z (north) and goes clockwise
  return -Math.PI / 2 + (i / N_AVE) * Math.PI * 2;
}
export function aveDir(i) {
  const a = aveAngle(i);
  return { x: Math.cos(a), z: Math.sin(a) };
}
// point along avenue i at distance d from center, lateral offset s (+ = right side when walking outward)
export function avePoint(i, d, s = 0) {
  const { x, z } = aveDir(i);
  // right-hand normal (walking outward)
  const nx = -z, nz = x;
  return { x: x * d + nx * s, z: z * d + nz * s };
}
// returns {i, along, lateral} for nearest avenue
export function aveLocal(x, z) {
  let best = null;
  for (let i = 0; i < N_AVE; i++) {
    const { x: dx, z: dz } = aveDir(i);
    const along = x * dx + z * dz;
    const lateral = -x * dz + z * dx; // dot with right normal (-dz, dx)
    if (along < 0) continue;
    if (!best || Math.abs(lateral) < Math.abs(best.lateral)) best = { i, along, lateral };
  }
  return best;
}

export function isWalkable(x, z, pad = 0.35) {
  const r = Math.hypot(x, z);
  if (r < PLAZA_R - pad) {
    // central tower footprint
    return r > 5.2 + pad;
  }
  const L = aveLocal(x, z);
  if (!L) return false;
  return Math.abs(L.lateral) < AVE_HALF - 0.6 - pad && L.along < PLAZA_R + AVE_LEN - 2;
}

// kiosks are placed alternating left/right sidewalks, facing the road centre
export function kioskPose(i, k) {
  const side = k % 2 === 0 ? -1 : 1;
  const d = PLAZA_R + KIOSK_START + k * KIOSK_SPACING * 0.62;
  const s = side * (ROAD_HALF + 1.6);
  const p = avePoint(i, d, s);
  const { x: dx, z: dz } = aveDir(i);
  // face toward avenue centre line (normal pointing to -side)
  const nx = -dz * -side, nz = dx * -side;
  const rotY = Math.atan2(nx, nz);
  return { x: p.x, z: p.z, rotY, side, d };
}
