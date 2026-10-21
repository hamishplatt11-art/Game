// Solves a launch velocity that carries the ball (under the live integrator,
// including drag) from a release point to pass through a target point.
import { integrateFree, SUBSTEPS } from './BallPhysics.js';
import { SIM_DT } from './constants.js';

const H = SIM_DT / SUBSTEPS;

/** Height of the ball when it reaches horizontal distance d, or -Infinity if it never does. */
function heightAtDistance(p0, dirX, dirZ, d, speed, angle) {
  const p = { x: 0, y: p0.y, z: 0 };
  const v = { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed, z: 0 };
  for (let i = 0; i < 6000; i++) {
    const px = p.x, py = p.y;
    integrateFree(p, v, H);
    if (p.x >= d) {
      const t = (d - px) / (p.x - px);
      return { y: py + (p.y - py) * t, vy: v.y, vx: v.x };
    }
    if (p.y < -1) break;
  }
  return { y: -Infinity, vy: 0, vx: 0 };
}

/**
 * @param p0 release point {x,y,z}
 * @param target point the ball centre should pass through {x,y,z}
 * @param angleDeg launch angle above horizontal
 * @returns {{v:{x,y,z}, speed:number, entryAngle:number}}
 */
export function solveLaunch(p0, target, angleDeg) {
  const dx = target.x - p0.x, dz = target.z - p0.z;
  const d = Math.max(0.05, Math.hypot(dx, dz));
  const dirX = dx / d, dirZ = dz / d;
  const a = (angleDeg * Math.PI) / 180;
  let lo = 0.5, hi = 30;
  let res = null;
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2;
    const r = heightAtDistance(p0, dirX, dirZ, d, mid, a);
    if (r.y < target.y) lo = mid;
    else hi = mid;
    res = r;
  }
  const speed = (lo + hi) / 2;
  const final = heightAtDistance(p0, dirX, dirZ, d, speed, a);
  const entryAngle = (Math.atan2(-final.vy, final.vx) * 180) / Math.PI;
  return {
    v: { x: dirX * Math.cos(a) * speed, y: Math.sin(a) * speed, z: dirZ * Math.cos(a) * speed },
    speed,
    entryAngle,
    ok: Number.isFinite(final.y) && res !== null,
  };
}

/** Velocity that lands at target after flight time T (used for passes; ignores drag on purpose, drag is small over a pass). */
export function solveTimed(p0, target, T, g = 9.81) {
  return {
    x: (target.x - p0.x) / T,
    y: (target.y - p0.y + 0.5 * g * T * T) / T,
    z: (target.z - p0.z) / T,
  };
}

/** Launch solve that raises the arc until the ball enters the rim at least `minEntry` degrees steep. */
export function solveShot(p0, target, preferredAngle = 52, minEntry = 40) {
  let a = preferredAngle;
  let sol = solveLaunch(p0, target, a);
  while (sol.entryAngle < minEntry && a < 76) {
    a += 2;
    sol = solveLaunch(p0, target, a);
  }
  sol.angle = a;
  return sol;
}

/** Timed solve that compensates for drag by iterating on the live integrator. */
export function solveTimedDrag(p0, target, T) {
  const aim = { x: target.x, y: target.y, z: target.z };
  let v = solveTimed(p0, aim, T);
  for (let it = 0; it < 3; it++) {
    const p = { x: p0.x, y: p0.y, z: p0.z };
    const vv = { x: v.x, y: v.y, z: v.z };
    const steps = Math.round(T / H);
    for (let i = 0; i < steps; i++) integrateFree(p, vv, H);
    aim.x += target.x - p.x; aim.y += target.y - p.y; aim.z += target.z - p.z;
    v = solveTimed(p0, aim, T);
  }
  return v;
}
