// Rules and determinism: seeded replays, 2 vs 3 points, contest effect,
// out-of-bounds rulings, shooting-foul free throws, shot clock, travelling.
import { describe, it, expect } from 'vitest';
import rosters from '../src/data/rosters.json' with { type: 'json' };
import { Simulation } from '../src/sim/Simulation.js';
import { isThreePoint } from '../src/sim/constants.js';
import { baseMakeProbability, finalMakeProbability } from '../src/sim/Shooting.js';
import { runMatch } from './runMatch.mjs';

const blank = () => ({
  moveX: 0, moveZ: 0, sprint: false, stance: false, shootDown: false, shootPressed: false, pass: false, bounce: false, lob: false,
  icon: null, iconHeld: false, callScreen: false, steal: false, jump: false, handsUp: false, flick: null, rs: null, spin: false,
  sizeup: false, switchPlayer: false, takeCharge: false, timeout: false, post: false,
});

function liveGame(seed = 3, userTeam = null) {
  const sim = new Simulation({ teams: [rosters.teams[0], rosters.teams[1]], seed, settings: { quarterMin: 3, userTeam, difficulty: 'allstar' } });
  sim.match.autoResume = true;
  sim.match.beginGame();
  const ev = [];
  for (let i = 0; i < 60 * 60 && !(sim.match.phase === 'live' && sim.holder() && sim.t > 8); i++) { sim.step(null); ev.push(...sim.drainEvents()); }
  return { sim, ev };
}
const run = (sim, n, inp = null) => { const ev = []; for (let i = 0; i < n; i++) { sim.step(inp ? inp(i) : null); ev.push(...sim.drainEvents()); } return ev; };

describe('determinism', () => {
  it('the same seed replays the same game exactly', () => {
    const a = runMatch({ quarterMin: 1, seed: 21 });
    const b = runMatch({ quarterMin: 1, seed: 21 });
    expect(a.sim.match.score).toEqual(b.sim.match.score);
    expect(a.counts).toEqual(b.counts);
    expect(a.steps).toBe(b.steps);
  });
});

describe('scoring values', () => {
  it('threes are released beyond the arc and worth 3; everything else is worth 2 or 1', () => {
    const shots = [];
    const scores = [];
    runMatch({ quarterMin: 2, seed: 8, onStep(sim) {
      for (const e of sim.events) {
        if (e.type === 'shotRelease' && e.shot.kind !== 'ft') shots.push(e.shot);
        if (e.type === 'score') scores.push(e);
      }
    } });
    expect(shots.length).toBeGreaterThan(30);
    for (const s of shots) {
      expect(s.three).toBe(isThreePoint(s.releaseX ?? s.shooter.x, s.releaseZ ?? s.shooter.z, s.hoop));
      expect(s.pts).toBe(s.three ? 3 : 2);
    }
    for (const e of scores) {
      if (e.kind === 'ft') expect(e.pts).toBe(1);
      else if (e.shot) expect(e.pts).toBe(e.shot.three ? 3 : 2);
    }
    expect(scores.some((e) => e.pts === 3)).toBe(true);
  });
});

describe('contest', () => {
  it('a heavier contest lowers the make chance for the same shot', () => {
    const sim = new Simulation({ teams: [rosters.teams[0], rosters.teams[1]], seed: 1, settings: { quarterMin: 3, userTeam: null } });
    const p = sim.teams[0].onCourt[0];
    const info = (c) => ({ kind: 'jumper', type: 'jumper', ratingKey: 'threeShot', dist: 7.4, three: true, contest: c });
    const open = baseMakeProbability(p, info(0)), heavy = baseMakeProbability(p, info(0.7));
    expect(heavy).toBeLessThan(open * 0.7);
    expect(finalMakeProbability(heavy, 'Excellent', 0.7, true, 'jumper')).toBeLessThan(finalMakeProbability(open, 'Excellent', 0, true, 'jumper'));
  });
});

describe('out of bounds', () => {
  it('offence touching it last is a turnover; the defence inbounds', () => {
    const g = liveGame(4).sim;
    const o = g.match.possTeam;
    const h = g.holder();
    g.ball.lastTouch = h;
    const tov0 = g.match.teamStats[o].turnovers;
    g.match.outOfBounds(o, { x: h.x, z: 7.9 });
    const e2 = run(g, 60 * 2);
    expect(g.match.teamStats[o].turnovers).toBe(tov0 + 1);
    expect(g.match.possTeam).toBe(1 - o);
    expect(e2.some((e) => e.type === 'turnover' && e.team === o)).toBe(true);
  });

  it('defence touching it last: offence keeps the ball with no turnover', () => {
    const g = liveGame(5).sim;
    const o = g.match.possTeam;
    const h = g.holder();
    const tov0 = g.match.teamStats[o].turnovers;
    const tovD = g.match.teamStats[1 - o].turnovers;
    g.match.outOfBounds(1 - o, { x: h.x, z: 7.9 });
    run(g, 60 * 2);
    expect(g.match.teamStats[o].turnovers).toBe(tov0);
    expect(g.match.teamStats[1 - o].turnovers).toBe(tovD);
    expect(g.match.possTeam).toBe(o);
  });
});

describe('free throws', () => {
  it('a fouled missed three gets 3 shots, a fouled two gets 2, an and-one gets 1', () => {
    for (const [three, made, n] of [[true, false, 3], [false, false, 2], [false, true, 1]]) {
      const g = liveGame(6).sim;
      const shooter = g.holder();
      g.match.awardShootingFouls({ shooter, fouler: g.teams[1 - shooter.team].onCourt[0], t: g.t, shot: null, three }, made);
      run(g, 60 * 3);
      expect(g.match.phase).toBe('freethrow');
      expect(g.match.ft.total).toBe(n);
      expect(g.match.ft.shooter).toBe(shooter);
    }
  });
});

describe('violations', () => {
  it('the shot clock expiring with the ball held is a violation and a turnover', () => {
    const g = liveGame(7).sim;
    const o = g.match.possTeam;
    g.match.shotClock = 0.02;
    const ev = run(g, 10);
    expect(ev.some((e) => e.type === 'turnover' && e.kind === 'shot clock' && e.team === o)).toBe(true);
  });

  it('running with a picked-up ball is travelling', () => {
    const { sim: g } = liveGame(9, 0);
    // Give the user's team the ball in the half court and pick up the dribble.
    const u = g.teams[0].onCourt[0];
    g.match.possTeam = 0;
    g.giveBall(u, 'catch');
    g.setUserPlayer(u);
    // Open floor, away from every defender, so no contact interrupts the steps.
    const s = g.match.attackHoop(0) === 1 ? 1 : -1;
    u.setPos(s * 3, -6.5, 0);
    u.pickedUp = true;
    const ev = run(g, 60, () => ({ ...blank(), moveZ: 1, sprint: true }));
    expect(ev.some((e) => e.type === 'turnover' && e.kind === 'traveling')).toBe(true);
  });
});
