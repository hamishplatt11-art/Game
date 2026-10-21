// Shooting model: shot timelines, release windows, timing grades, defensive
// contest evaluation, make probability and the aim point handed to physics.
import { clamp } from '../core/math.js';
import { hoopPos, isThreePoint, distToHoop, THREE_R } from './constants.js';

// Timeline (seconds) for each shot type at release speed 1.0.
// gather -> dip -> jump -> ideal release -> follow-through -> landing.
export const SHOT_TYPES = {
  jumper: { dur: 1.12, jumpT: 0.36, ideal: 0.6, jumpH: 0.3, arcAdd: 0 },
  catchShoot: { dur: 1.02, jumpT: 0.3, ideal: 0.54, jumpH: 0.28, arcAdd: 0 },
  pullup: { dur: 1.12, jumpT: 0.36, ideal: 0.6, jumpH: 0.34, arcAdd: 0 },
  stepbackJ: { dur: 1.08, jumpT: 0.3, ideal: 0.56, jumpH: 0.3, arcAdd: 1 },
  fadeaway: { dur: 1.2, jumpT: 0.36, ideal: 0.62, jumpH: 0.36, arcAdd: 3 },
  hook: { dur: 1.0, jumpT: 0.3, ideal: 0.52, jumpH: 0.3, arcAdd: 6 },
  floater: { dur: 0.95, jumpT: 0.22, ideal: 0.46, jumpH: 0.32, arcAdd: 12 },
  ft: { dur: 1.55, jumpT: 0.9, ideal: 0.98, jumpH: 0.04, arcAdd: 2 },
};

export const DIFFICULTY = {
  rookie: { name: 'Rookie', window: 1.45, cpuReact: 0.5, cpuNoise: 0.35, cpuShot: 0.85, cpuDef: 0.7, cpuSteal: 0.5 },
  pro: { name: 'Pro', window: 1.2, cpuReact: 0.38, cpuNoise: 0.22, cpuShot: 0.95, cpuDef: 0.85, cpuSteal: 0.75 },
  allstar: { name: 'All-Star', window: 1.0, cpuReact: 0.28, cpuNoise: 0.15, cpuShot: 1.0, cpuDef: 1.0, cpuSteal: 1.0 },
  superstar: { name: 'Superstar', window: 0.85, cpuReact: 0.22, cpuNoise: 0.1, cpuShot: 1.04, cpuDef: 1.1, cpuSteal: 1.15 },
  hof: { name: 'Hall of Fame', window: 0.7, cpuReact: 0.17, cpuNoise: 0.06, cpuShot: 1.08, cpuDef: 1.2, cpuSteal: 1.3 },
};

/** Which rating governs a shot from this spot. */
export function shotRatingKey(kind, dist, three) {
  if (kind === 'ft') return 'freeThrow';
  if (kind === 'layup') return 'layup';
  if (kind === 'dunk') return 'drivingDunk';
  if (three) return 'threeShot';
  if (dist < 3.2) return 'closeShot';
  return 'midShot';
}

/** Ideal-release half-window in seconds (wider = more forgiving). */
export function releaseWindow(p, kind, ratingKey, contest, diff, catchAndShoot) {
  let w = 0.011 + 0.024 * p.r(ratingKey);
  w += 0.004 * p.badge('sniper');
  if (catchAndShoot) w += 0.003 * p.badge('spotUp');
  if (p.takeoverOn('shooting')) w += 0.008;
  if (kind === 'ft') w += 0.01;
  w *= 1 - 0.38 * contest;
  w *= diff.window;
  return clamp(w, 0.006, 0.07);
}

export function timingGrade(err, window) {
  const a = Math.abs(err);
  if (a <= window) return 'Excellent';
  const side = err < 0 ? 'Early' : 'Late';
  if (a <= window * 2.4) return `Slightly ${side}`;
  if (a <= 0.15) return side;
  return `Very ${side}`;
}

export function contestLabel(c) {
  if (c < 0.12) return 'Open';
  if (c < 0.33) return 'Light';
  if (c < 0.58) return 'Moderate';
  if (c < 0.82) return 'Heavy';
  return 'Smothered';
}

/**
 * Contest quality from every defender: distance, angle, hand activity, reach
 * vs. release height and timing (an airborne contest counts more than standing).
 */
export function evaluateContest(shooter, defenders, hoopIdx, releaseY) {
  const h = hoopPos(hoopIdx);
  const sx = h.x - shooter.x, sz = h.z - shooter.z;
  const sl = Math.hypot(sx, sz) || 1;
  const vals = [];
  for (const d of defenders) {
    const dx = d.x - shooter.x, dz = d.z - shooter.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 2.9) continue;
    const prox = clamp((2.7 - dist) / 1.9, 0, 1);
    const cosA = (dx * sx + dz * sz) / ((dist || 1) * sl);
    const angle = 0.3 + 0.7 * clamp((cosA + 0.35) / 1.35, 0, 1);
    const act = d.action && (d.action.type === 'block' || d.action.type === 'contest') ? (d.airborne ? 1 : 0.8) : d.intent.handsUp ? 0.72 : d.intent.stance ? 0.6 : 0.45;
    const reach = clamp(1 + (d.reachNow() + (act >= 0.8 ? 0.2 : 0) - releaseY) * 0.4, 0.55, 1.35);
    let c = prox * angle * act * reach;
    c *= 1 + 0.05 * d.badge('lockdown') + (d.takeoverOn('defense') ? 0.1 : 0);
    if (d.stumble > 0) c *= 0.3;
    const cross = dx * sz - dz * sx;
    vals.push({ c: clamp(c, 0, 1), d, dir: cosA > 0.5 ? 'front' : cosA < -0.3 ? 'behind' : cross > 0 ? 'left' : 'right' });
  }
  vals.sort((a, b) => b.c - a.c);
  if (!vals.length) return { value: 0, label: 'Open', dir: null, by: null };
  const v = clamp(vals[0].c + (vals[1] ? 0.3 * vals[1].c : 0), 0, 1);
  return { value: v, label: contestLabel(v), dir: vals[0].dir, by: vals[0].d };
}

/** Base make chance for a shot independent of release timing. */
export function baseMakeProbability(p, info) {
  const r = p.r(info.ratingKey);
  let base;
  switch (info.ratingKey) {
    case 'threeShot': base = 0.15 + 0.37 * r; break;
    case 'midShot': base = 0.22 + 0.33 * r; break;
    case 'closeShot': base = 0.3 + 0.32 * r; break;
    case 'freeThrow': base = 0.42 + 0.52 * r; break;
    case 'layup': base = 0.5 + 0.42 * r; break;
    default: base = 0.5;
  }
  if (info.three && info.dist > THREE_R + 0.8) {
    const over = info.dist - (THREE_R + 0.8);
    base -= over * 0.075 * (1 - 0.2 * p.badge('deepRange'));
  }
  if (info.dist > 13) base *= 0.25;
  const sniper = 0.05 * p.badge('sniper');
  base *= 1 - info.contest * (info.kind === 'layup' ? 0.72 : 0.62) * (1 - sniper);
  if (info.moving && !info.rhythm) base *= 0.88;
  if (info.type === 'fadeaway') base *= 0.93;
  if (info.catchAndShoot) base *= 1 + 0.025 * p.badge('spotUp');
  if (info.assistBoost) base *= 1 + info.assistBoost;
  base *= 0.84 + 0.16 * p.stamina;
  base *= 0.95 + 0.1 * p.r('offConsistency');
  if (p.takeoverOn('shooting') && info.kind !== 'layup') base *= 1.06;
  if (p.takeoverOn('finishing') && info.kind === 'layup') base *= 1.08;
  return clamp(base, 0.01, 0.97);
}

/** Final make chance once release timing is known. `user` enables the green-release rule. */
export function finalMakeProbability(base, grade, contest, user, kind) {
  if (grade === 'Excellent') {
    if (user) {
      if (kind === 'ft') return 1;
      if (contest < 0.33) return 1;
      if (contest < 0.58) return 0.85;
      if (contest < 0.82) return 0.62;
      return 0.38;
    }
    return clamp(base * 1.18, 0, 0.98);
  }
  if (grade.startsWith('Slightly')) return base * (user ? 0.95 : 1.0);
  if (grade === 'Early' || grade === 'Late') return base * 0.6;
  return base * 0.22;
}

/** Point the physics solver aims the ball at, consistent with the outcome and timing grade. */
export function aimPoint(hoopIdx, made, grade, from, rng) {
  const h = hoopPos(hoopIdx);
  const dx = h.x - from.x, dz = h.z - from.z;
  const l = Math.hypot(dx, dz) || 1;
  const fx = dx / l, fz = dz / l; // toward hoop
  if (made) {
    const r = rng.range(0, 0.035), a = rng.range(0, Math.PI * 2);
    return { x: h.x + Math.cos(a) * r, y: h.y, z: h.z + Math.sin(a) * r };
  }
  let mag, ang;
  if (grade.startsWith('Very')) { mag = rng.range(0.3, 0.6); }
  else if (grade === 'Early' || grade === 'Late') { mag = rng.range(0.21, 0.34); }
  else { mag = rng.range(0.17, 0.27); }
  if (grade.includes('Early')) ang = Math.PI + rng.range(-0.7, 0.7); // short
  else if (grade.includes('Late')) ang = rng.range(-0.7, 0.7); // long
  else ang = rng.range(0, Math.PI * 2);
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const ox = fx * ca - fz * sa, oz = fz * ca + fx * sa;
  return { x: h.x + ox * mag, y: h.y, z: h.z + oz * mag };
}

export function describeShot(p, hoopIdx) {
  const dist = distToHoop(p.x, p.z, hoopIdx);
  const three = isThreePoint(p.x, p.z, hoopIdx);
  return { dist, three };
}
