// Regulation NBA geometry (NBA Official Rule No. 1 court diagram), in metres.
// World axes: x runs along the court length, z across the width, y is up.
export const FT = 0.3048;
export const IN = 0.0254;

export const COURT_L = 94 * FT;
export const COURT_W = 50 * FT;
export const HALF_L = COURT_L / 2;
export const HALF_W = COURT_W / 2;

export const RIM_H = 10 * FT;
export const RIM_R = 9 * IN; // 18" inside diameter
export const RIM_TUBE = 0.3125 * IN; // 5/8" rod
export const BALL_R = 0.1194; // size 7, 29.5" circumference
export const BALL_MASS = 0.62;

export const BOARD_FROM_BASELINE = 4 * FT;
export const RIM_FROM_BOARD = 15 * IN; // board face to rim centre
export const HOOP_X = HALF_L - BOARD_FROM_BASELINE - RIM_FROM_BOARD;
export const BOARD_X = HALF_L - BOARD_FROM_BASELINE;
export const BOARD_W = 6 * FT;
export const BOARD_H = 3.5 * FT;
export const BOARD_BOTTOM = RIM_H - 6 * IN;
export const BOARD_THICK = 0.05;

export const THREE_R = 23.75 * FT;
export const CORNER_Z = 22 * FT; // corner three distance from hoop centreline
export const CORNER_STRAIGHT_DX = Math.sqrt(THREE_R * THREE_R - CORNER_Z * CORNER_Z);
export const LANE_W = 16 * FT;
export const FT_LINE_FROM_BASELINE = 19 * FT;
export const FT_CIRCLE_R = 6 * FT;
export const RESTRICTED_R = 4 * FT;
export const CENTER_CIRCLE_R = 6 * FT;

export const GRAVITY = 9.81;
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

// Hoop index 0 sits at -x, hoop 1 at +x.
export function hoopPos(i) {
  return { x: i === 0 ? -HOOP_X : HOOP_X, y: RIM_H, z: 0 };
}
export function hoopSign(i) {
  return i === 0 ? -1 : 1;
}

/** Distance from (x,z) to the hoop centre on the floor plane. */
export function distToHoop(x, z, i) {
  const h = hoopPos(i);
  return Math.hypot(x - h.x, z - h.z);
}

/** True if a release from floor position (x,z) is a three-point attempt at hoop i. */
export function isThreePoint(x, z, i) {
  const s = hoopSign(i);
  const dxTowardCentre = (HOOP_X - x * s); // >0 means in front of the hoop
  if (dxTowardCentre < CORNER_STRAIGHT_DX) return Math.abs(z) > CORNER_Z;
  return distToHoop(x, z, i) > THREE_R;
}

export function inPaint(x, z, i) {
  const s = hoopSign(i);
  const fromBaseline = HALF_L - x * s;
  return fromBaseline >= 0 && fromBaseline <= FT_LINE_FROM_BASELINE && Math.abs(z) <= LANE_W / 2;
}

export function inRestrictedArea(x, z, i) {
  const s = hoopSign(i);
  return distToHoop(x, z, i) < RESTRICTED_R && (HOOP_X - x * s) > -0.1;
}

export function outOfBounds(x, z, margin = 0) {
  return Math.abs(x) > HALF_L + margin || Math.abs(z) > HALF_W + margin;
}
