import { describe, it, expect } from 'vitest';
import { stepFreeBall } from '../src/sim/BallPhysics.js';
import { solveShot as solveLaunch } from '../src/sim/ShotSolver.js';
import { hoopPos, SIM_DT, BALL_R } from '../src/sim/constants.js';
import { Random } from '../src/core/Random.js';

function shoot(from, aimOffset, angle = 52) {
  const h = hoopPos(1);
  const target = { x: h.x + aimOffset.x, y: h.y, z: h.z + aimOffset.z };
  const sol = solveLaunch(from, target, angle);
  const ball = { p: { ...from }, v: { ...sol.v }, w: { x: 0, y: 0, z: 0 } };
  let scored = false, rim = false, board = false;
  for (let i = 0; i < 60 * 6; i++) {
    const out = stepFreeBall(ball, SIM_DT);
    if (out.scored === 1) scored = true;
    if (out.rim) rim = true;
    if (out.board) board = true;
  }
  return { scored, rim, board, sol, ball };
}

describe('ball physics', () => {
  it('rests on the floor after being dropped', () => {
    const ball = { p: { x: 0, y: 2, z: 0 }, v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 } };
    for (let i = 0; i < 60 * 8; i++) stepFreeBall(ball, SIM_DT);
    expect(ball.p.y).toBeCloseTo(BALL_R, 2);
    expect(Math.abs(ball.v.y)).toBeLessThan(0.01);
  });

  it('centred shots from many spots physically go through the rim', () => {
    const rng = new Random(7);
    let made = 0, n = 300;
    for (let i = 0; i < n; i++) {
      const ang = rng.range(-Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
      const d = rng.range(1.5, 8.5);
      const h = hoopPos(1);
      const from = { x: h.x - Math.cos(ang) * d, y: rng.range(2.3, 3.0), z: Math.sin(ang) * d };
      const off = { x: rng.range(-0.03, 0.03), z: rng.range(-0.03, 0.03) };
      if (shoot(from, off, rng.range(48, 56)).scored) made++;
    }
    expect(made / n).toBeGreaterThan(0.97);
  });

  it('aims at the front rim mostly miss and touch the rim', () => {
    let made = 0, rimHits = 0;
    for (let i = 0; i < 40; i++) {
      const h = hoopPos(1);
      const from = { x: h.x - 6.5, y: 2.6, z: -2 + i * 0.1 };
      const r = shoot(from, { x: -0.22, z: 0 }, 52);
      if (r.scored) made++;
      if (r.rim) rimHits++;
    }
    expect(made).toBeLessThan(15);
    expect(rimHits).toBeGreaterThan(30);
  });

  it('entry angle for a jumper is steep enough to clear the front rim', () => {
    const h = hoopPos(1);
    const r = shoot({ x: h.x - 7.3, y: 2.7, z: 0 }, { x: 0, z: 0 }, 52);
    expect(r.sol.entryAngle).toBeGreaterThan(38);
    expect(r.scored).toBe(true);
  });
});
