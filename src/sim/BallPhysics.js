// Free-flight basketball physics: gravity, quadratic drag, floor bounce with
// spin/friction, rim (torus) and backboard (box) collisions, net damping and
// physical make detection. The same integrator is used by the shot solver so
// a planned trajectory is exactly what the live ball follows until contact.
import {
  BALL_R, RIM_R, RIM_TUBE, RIM_H, GRAVITY, BOARD_X, BOARD_W, BOARD_H,
  BOARD_BOTTOM, BOARD_THICK, hoopPos, HALF_L, HALF_W,
} from './constants.js';

export const DRAG_K = 0.012; // 0.5*rho*Cd*A/m with a slightly reduced Cd for spin
export const E_FLOOR = 0.78;
export const E_RIM = 0.52;
export const E_BOARD = 0.62;
export const SUBSTEPS = 8;

const HOOPS = [hoopPos(0), hoopPos(1)];

export function integrateFree(p, v, h) {
  const sp = Math.hypot(v.x, v.y, v.z);
  const k = DRAG_K * sp * h;
  v.x -= v.x * k;
  v.y -= v.y * k + GRAVITY * h;
  v.z -= v.z * k;
  p.x += v.x * h;
  p.y += v.y * h;
  p.z += v.z * h;
}

function rimCollide(ball, hi, out) {
  const c = HOOPS[hi];
  const p = ball.p, v = ball.v;
  const dx = p.x - c.x, dz = p.z - c.z;
  if (Math.abs(p.y - c.y) > BALL_R + 0.05) return;
  const pl = Math.hypot(dx, dz);
  if (pl > RIM_R + BALL_R + 0.05) return;
  const ux = pl > 1e-6 ? dx / pl : 1, uz = pl > 1e-6 ? dz / pl : 0;
  const rx = c.x + ux * RIM_R, rz = c.z + uz * RIM_R;
  const ex = p.x - rx, ey = p.y - c.y, ez = p.z - rz;
  const d = Math.hypot(ex, ey, ez);
  const minD = BALL_R + RIM_TUBE;
  if (d >= minD || d < 1e-6) return;
  const nx = ex / d, ny = ey / d, nz = ez / d;
  p.x = rx + nx * minD;
  p.y = c.y + ny * minD;
  p.z = rz + nz * minD;
  const vn = v.x * nx + v.y * ny + v.z * nz;
  if (vn < 0) {
    const tx = v.x - vn * nx, ty = v.y - vn * ny, tz = v.z - vn * nz;
    const fr = 0.86;
    v.x = tx * fr - vn * nx * E_RIM;
    v.y = ty * fr - vn * ny * E_RIM;
    v.z = tz * fr - vn * nz * E_RIM;
    // Spin picks up a little from the tangential scrape.
    ball.w.x += nz * 6 * Math.sign(vn);
    ball.w.z -= nx * 6 * Math.sign(vn);
    out.rim = Math.max(out.rim, -vn);
    out.rimHoop = hi;
  }
}

function boardCollide(ball, hi, out) {
  const s = hi === 0 ? -1 : 1;
  const face = s * BOARD_X;
  const back = s * (BOARD_X + BOARD_THICK);
  const minX = Math.min(face, back), maxX = Math.max(face, back);
  const p = ball.p, v = ball.v;
  const cx = Math.max(minX, Math.min(p.x, maxX));
  const cy = Math.max(BOARD_BOTTOM, Math.min(p.y, BOARD_BOTTOM + BOARD_H));
  const cz = Math.max(-BOARD_W / 2, Math.min(p.z, BOARD_W / 2));
  const ex = p.x - cx, ey = p.y - cy, ez = p.z - cz;
  const d = Math.hypot(ex, ey, ez);
  if (d >= BALL_R) return;
  let nx, ny, nz;
  if (d < 1e-6) { nx = -s; ny = 0; nz = 0; } else { nx = ex / d; ny = ey / d; nz = ez / d; }
  p.x = cx + nx * BALL_R;
  p.y = cy + ny * BALL_R;
  p.z = cz + nz * BALL_R;
  const vn = v.x * nx + v.y * ny + v.z * nz;
  if (vn < 0) {
    const tx = v.x - vn * nx, ty = v.y - vn * ny, tz = v.z - vn * nz;
    v.x = tx * 0.9 - vn * nx * E_BOARD;
    v.y = ty * 0.9 - vn * ny * E_BOARD;
    v.z = tz * 0.9 - vn * nz * E_BOARD;
    out.board = Math.max(out.board, -vn);
    out.boardHoop = hi;
    // Contact from behind the board or from above it is out of bounds.
    if (nx * s > 0.5 || ny > 0.7) out.boardOut = true;
  }
}

function netAndScore(ball, hi, prevY, out) {
  const c = HOOPS[hi];
  const p = ball.p, v = ball.v;
  const dx = p.x - c.x, dz = p.z - c.z;
  const pl = Math.hypot(dx, dz);
  // Physical make: centre crosses the rim plane downward inside the ring.
  if (prevY >= c.y && p.y < c.y && v.y < 0 && pl < RIM_R - 0.015) {
    out.scored = hi;
  }
  // Net funnel: below the rim, inside the cone, slow and centre the ball.
  if (p.y < c.y && p.y > c.y - 0.46 && pl < RIM_R + 0.02) {
    const depth = (c.y - p.y) / 0.46;
    const h = out.h;
    const pull = 10 * depth;
    v.x -= (dx * pull + v.x * 3.0) * h;
    v.z -= (dz * pull + v.z * 3.0) * h;
    if (v.y < -2.2) v.y += 9 * h;
    out.net = true;
    out.netHoop = hi;
  }
}

function floorCollide(ball, out, h) {
  const p = ball.p, v = ball.v, w = ball.w;
  if (p.y >= BALL_R) return;
  p.y = BALL_R;
  if (v.y < 0) {
    const impact = -v.y;
    v.y = impact > 0.35 ? impact * E_FLOOR : 0;
    // Spin/velocity coupling at contact (simplified rolling friction model).
    const slipX = v.x + w.z * BALL_R;
    const slipZ = v.z - w.x * BALL_R;
    v.x -= slipX * 0.12;
    v.z -= slipZ * 0.12;
    w.z = -v.x / BALL_R;
    w.x = v.z / BALL_R;
    out.floor = Math.max(out.floor, impact);
  } else if (v.y === 0) {
    // Rolling resistance.
    const f = Math.max(0, 1 - 0.5 * h);
    v.x *= f;
    v.z *= f;
    w.z = -v.x / BALL_R;
    w.x = v.z / BALL_R;
  }
}

/**
 * Advance a free ball by dt. Returns contact info for the frame:
 * { floor, rim, rimHoop, board, boardHoop, boardOut, scored, net, outOfBounds }
 */
export function stepFreeBall(ball, dt) {
  const out = { floor: 0, rim: 0, rimHoop: -1, board: 0, boardHoop: -1, boardOut: false, scored: -1, net: false, netHoop: -1, h: dt / SUBSTEPS };
  const h = dt / SUBSTEPS;
  for (let i = 0; i < SUBSTEPS; i++) {
    const prevY = ball.p.y;
    integrateFree(ball.p, ball.v, h);
    for (let hi = 0; hi < 2; hi++) {
      rimCollide(ball, hi, out);
      boardCollide(ball, hi, out);
      netAndScore(ball, hi, prevY, out);
    }
    floorCollide(ball, out, h);
  }
  // Integrate spin for rendering (orientation is advanced by the view).
  if (ball.p.y <= BALL_R + 0.001 && out.floor === 0 && ball.v.y === 0) {
    // rolling: spin already locked to velocity
  } else {
    ball.w.x *= 0.995;
    ball.w.y *= 0.995;
    ball.w.z *= 0.995;
  }
  if (ball.p.y <= BALL_R + 0.02 && (Math.abs(ball.p.x) > HALF_L || Math.abs(ball.p.z) > HALF_W)) {
    out.outOfBounds = true;
  }
  return out;
}

export function rimCenter(hi) {
  return HOOPS[hi];
}

export { RIM_H };
