// World layout: central pedestrian hub + ring road (roundabout) + 8 radial pedestrian avenues (歩行者天国).
//
//   r < HUB_R          : raised pedestrian hub with the central tower
//   HUB_R..RING_OUT    : ring road (asphalt, traffic)
//   RING_OUT..PLAZA_R  : outer sidewalk ring
//   PLAZA_R..          : corner "tip" towers between avenues, big screens facing the hub
//   avenues            : road |s|<ROAD_HALF, sidewalks to AVE_HALF, buildings beyond
export const HUB_R = 21;
export const RING_IN = 21;
export const RING_OUT = 30;
export const PLAZA_R = 36;
export const TIP_END = 58;           // along-distance where corner towers end and row buildings begin
export const AVE_HALF = 8.5;         // building line
export const ROAD_HALF = 4.5;
export const AVE_END = 176;          // along-distance where avenue is closed by the landmark
export const AVE_LEN = AVE_END - PLAZA_R;
export const N_AVE = 8;
export const KIOSK_START = 44;
export const KIOSK_STEP = 9.6;
export const EYE = 1.62;
export const CURB = 0.12;
export const TAN_HALF = Math.tan(Math.PI / N_AVE); // tan 22.5°

export function aveAngle(i) {
  // avenue 0 points to -Z (north) and goes clockwise seen from above
  return -Math.PI / 2 + (i / N_AVE) * Math.PI * 2;
}
export function aveDir(i) {
  const a = aveAngle(i);
  return { x: Math.cos(a), z: Math.sin(a) };
}
// point along avenue i at distance d from centre, lateral offset s (+ = right side when walking outward)
export function avePoint(i, d, s = 0) {
  const { x, z } = aveDir(i);
  const nx = -z, nz = x;
  return { x: x * d + nx * s, z: z * d + nz * s };
}
export function aveLocal(x, z) {
  let best = null;
  for (let i = 0; i < N_AVE; i++) {
    const { x: dx, z: dz } = aveDir(i);
    const along = x * dx + z * dz;
    const lateral = -x * dz + z * dx;
    if (along < 0) continue;
    if (!best || Math.abs(lateral) < Math.abs(best.lateral)) best = { i, along, lateral };
  }
  return best;
}

// obstacles registered at runtime (kiosks, lamps, tower...) as circles
export const obstacles = [];
export function addObstacle(x, z, r) { obstacles.push({ x, z, r }); }

export function isWalkable(x, z, pad = 0.3) {
  const r = Math.hypot(x, z);
  let ok = false;
  if (r < PLAZA_R - 0.8 - pad) ok = r > 6.2 + pad;
  else {
    const L = aveLocal(x, z);
    ok = !!L && Math.abs(L.lateral) < AVE_HALF - 0.9 - pad && L.along < AVE_END - 6;
  }
  if (!ok) return false;
  for (const o of obstacles) {
    const dx = x - o.x, dz = z - o.z;
    if (dx * dx + dz * dz < (o.r + pad) * (o.r + pad)) return false;
  }
  return true;
}

// ground height under a point (road = 0, pavement = CURB)
export function groundHeight(x, z) {
  const r = Math.hypot(x, z);
  if (r < RING_IN) return CURB;
  if (r < RING_OUT) return 0;
  if (r < PLAZA_R) {
    const L = aveLocal(x, z);
    if (L && Math.abs(L.lateral) < ROAD_HALF && r > RING_OUT) return 0;
    return CURB;
  }
  const L = aveLocal(x, z);
  if (L && Math.abs(L.lateral) < ROAD_HALF) return 0;
  return CURB;
}

// kiosks: double-sided pylons down the centre of each pedestrian avenue, zig-zag
export function kioskPose(i, k) {
  const side = k % 2 === 0 ? -1 : 1;
  const d = KIOSK_START + k * KIOSK_STEP;
  const s = side * 2.1;
  const p = avePoint(i, d, s);
  const { x: dx, z: dz } = aveDir(i);
  // face the hub (toward -dir), yawed a bit toward centre line
  const base = Math.atan2(-dx, -dz);
  const rotY = base + side * 0.32;
  return { x: p.x, z: p.z, rotY, side, d };
}
