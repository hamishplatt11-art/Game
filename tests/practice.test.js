import { describe, it, expect } from 'vitest';
import rosters from '../src/data/rosters.json' with { type: 'json' };
import { Simulation } from '../src/sim/Simulation.js';
import { PRACTICE_SPOTS } from '../src/sim/Match.js';
import { summarizePractice } from '../src/sim/PracticeStats.js';

const blank = () => ({
  moveX: 0, moveZ: 0, sprint: false, stance: false, shootDown: false, shootPressed: false, pass: false, bounce: false, lob: false,
  icon: null, iconHeld: false, callScreen: false, steal: false, jump: false, handsUp: false, flick: null, rs: null, spin: false,
  sizeup: false, switchPlayer: false, takeCharge: false, timeout: false, post: false,
});

function practice({ seed = 5, defender = false, mode = 'active', autoReturn = true } = {}) {
  const sim = new Simulation({ teams: [rosters.teams[0], rosters.teams[1]], seed, settings: { mode: 'practice', userTeam: 0, playersPerSide: 1, difficulty: 'pro', defenderMode: mode, practiceAutoReturn: autoReturn } });
  for (const t of sim.teams) { t.onCourt = t.onCourt.slice(0, 1); t.roster.forEach((p) => { p.onCourt = t.onCourt.includes(p); }); }
  if (!defender) { sim.teams[1].onCourt = []; sim.teams[1].roster.forEach((p) => { p.onCourt = false; }); }
  sim.match.beginGame();
  return sim;
}

/** Shoot one jumper with the release `offset` seconds from the ideal point. */
function shoot(sim, offset = 0) {
  const u = sim.user.player;
  for (let i = 0; i < 20; i++) sim.step(blank());
  let started = false;
  for (let i = 0; i < 400; i++) {
    const inp = blank();
    const a = u.action;
    if (!started) { inp.shootPressed = true; inp.shootDown = true; started = true; }
    else if (a && a.type === 'shot' && !a.data.released) inp.shootDown = a.t + 1 / 60 < a.data.tIdeal + offset;
    sim.step(inp);
    sim.drainEvents();
    if (sim.ball.owner === u && i > 60) break;
  }
}

describe('practice mode', () => {
  it('logs every attempt with result, timing and zone, and summarises it', () => {
    const sim = practice();
    shoot(sim, 0);
    shoot(sim, -0.12);
    shoot(sim, 0);
    const log = sim.match.practiceLog;
    expect(log.length).toBe(3);
    for (const s of log) {
      expect(s.made === true || s.made === false).toBe(true);
      expect(s.zone).toBe('3PT');
      expect(typeof s.err).toBe('number');
    }
    expect(log[0].grade).toBe('Excellent');
    expect(log[0].made).toBe(true);
    expect(log[1].grade).toMatch(/Early/);
    const S = summarizePractice(log);
    expect(S.att).toBe(3);
    expect(S.zones['3PT'].att).toBe(3);
    expect(S.made).toBe(log.filter((s) => s.made).length);
    expect(S.tip.length).toBeGreaterThan(10);
  });

  it('reset cycles shooting spots and returns the ball to the shooter', () => {
    const sim = practice({ defender: true });
    const u = sim.user.player;
    sim.match.practiceReset(true);
    expect(sim.match.practiceSpot).toBe(PRACTICE_SPOTS[1]);
    expect(sim.ball.owner).toBe(u);
    expect(sim.match.phase).toBe('live');
    sim.match.practiceReset(false);
    expect(sim.match.practiceSpot).toBe(PRACTICE_SPOTS[1]);
  });

  it('a stand-in defender holds its spot while the shooter moves', () => {
    const sim = practice({ defender: true, mode: 'stand' });
    const d = sim.teams[1].onCourt[0];
    const x0 = d.x, z0 = d.z;
    for (let i = 0; i < 180; i++) { const inp = blank(); inp.moveZ = 1; sim.step(inp); sim.drainEvents(); }
    expect(Math.hypot(d.x - x0, d.z - z0)).toBeLessThan(0.05);
    expect(d.intent.handsUp).toBe(true);
  });

  it('an active defender closes out', () => {
    const sim = practice({ defender: true, mode: 'active' });
    const d = sim.teams[1].onCourt[0];
    const x0 = d.x, z0 = d.z;
    for (let i = 0; i < 180; i++) { const inp = blank(); inp.moveZ = 1; sim.step(inp); sim.drainEvents(); }
    expect(Math.hypot(d.x - x0, d.z - z0)).toBeGreaterThan(0.5);
  });
});

describe('practice defender possession', () => {
  it('a defender rebound or steal is handed straight back to the shooter and never logged', () => {
    const sim = practice({ defender: true, mode: 'active', seed: 11 });
    const u = sim.user.player, d = sim.teams[1].onCourt[0];
    sim.giveBall(d, 'inbound');
    for (let i = 0; i < 30; i++) { sim.step(blank()); sim.drainEvents(); }
    expect(sim.ball.owner).toBe(u);
    expect(sim.match.practiceLog.length).toBe(0);
    expect(sim.match.score[1]).toBe(0);
  });
});
