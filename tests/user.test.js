import { describe, it, expect } from 'vitest';
import rosters from '../src/data/rosters.json' with { type: 'json' };
import { Simulation } from '../src/sim/Simulation.js';

const blank = () => ({
  moveX: 0, moveZ: 0, sprint: false, stance: false, shootDown: false, shootPressed: false, pass: false, bounce: false, lob: false,
  icon: null, iconHeld: false, callScreen: false, steal: false, jump: false, handsUp: false, flick: null, rs: null, spin: false,
  sizeup: false, switchPlayer: false, takeCharge: false, timeout: false, post: false,
});

function practice(seed = 5, defender = false) {
  const sim = new Simulation({ teams: [rosters.teams[0], rosters.teams[1]], seed, settings: { mode: 'practice', userTeam: 0, playersPerSide: 1, difficulty: 'pro' } });
  if (!defender) { sim.teams[1].onCourt = []; sim.teams[1].roster.forEach((p) => { p.onCourt = false; }); }
  sim.match.beginGame();
  return sim;
}

function run(sim, n, inputFn) {
  const ev = [];
  for (let i = 0; i < n; i++) {
    sim.step(inputFn ? inputFn(i) : blank());
    ev.push(...sim.drainEvents());
  }
  return ev;
}

describe('user shooting', () => {
  it('releasing exactly at the set point grades Excellent and an open green goes in', () => {
    const sim = practice();
    const u = sim.user.player;
    run(sim, 10);
    let releasedAt = null;
    const ev = run(sim, 240, (i) => {
      const inp = blank();
      if (i === 0) { inp.shootPressed = true; inp.shootDown = true; return inp; }
      const a = u.action;
      if (a && a.type === 'shot' && !a.data.released) {
        // Hold until the ideal release time, then let go.
        inp.shootDown = a.t + 1 / 60 < a.data.tIdeal;
        if (!inp.shootDown && releasedAt === null) releasedAt = a.t;
      }
      return inp;
    });
    const rel = ev.find((e) => e.type === 'shotRelease');
    expect(rel).toBeTruthy();
    expect(rel.shot.user).toBe(true);
    expect(rel.shot.grade).toBe('Excellent');
    expect(rel.shot.intended).toBe(true);
    expect(ev.some((e) => e.type === 'score')).toBe(true);
  });

  it('a very early release grades as early and lowers the make chance', () => {
    const sim = practice(9);
    const u = sim.user.player;
    run(sim, 10);
    const ev = run(sim, 200, (i) => {
      const inp = blank();
      if (i === 0) { inp.shootPressed = true; inp.shootDown = true; return inp; }
      const a = u.action;
      inp.shootDown = !(a && a.type === 'shot' && a.t > a.data.tIdeal * 0.45);
      return inp;
    });
    const rel = ev.find((e) => e.type === 'shotRelease');
    expect(rel.shot.grade).toMatch(/Early/);
    expect(rel.shot.prob).toBeLessThan(0.4);
  });

  it('a quick tap is a pump fake that picks up the dribble', () => {
    const sim = practice(3);
    const u = sim.user.player;
    run(sim, 5, () => ({ ...blank(), moveX: 1 }));
    const ev = run(sim, 30, (i) => ({ ...blank(), shootPressed: i === 0, shootDown: i < 2 }));
    expect(ev.some((e) => e.type === 'pumpFake')).toBe(true);
    expect(u.pickedUp).toBe(true);
    expect(ev.some((e) => e.type === 'shotRelease')).toBe(false);
  });
});

describe('user dribbling', () => {
  it('a flick toward the off hand performs a crossover and switches hands', () => {
    const sim = practice(4);
    const u = sim.user.player;
    run(sim, 20, () => ({ ...blank(), moveX: 0.4 })); // start a live dribble
    expect(sim.ball.state).toBe('dribble');
    const hand0 = u.hand;
    // Off-hand side in world space: -hand * right vector.
    const fx = -hand0 * u.rx, fz = -hand0 * u.rz;
    const ev = run(sim, 40, (i) => ({ ...blank(), flick: i === 0 ? { x: fx, z: fz } : null }));
    const mv = ev.find((e) => e.type === 'dribbleMove');
    expect(mv && mv.move).toBe('crossover');
    expect(u.hand).toBe(-hand0);
    expect(ev.filter((e) => e.type === 'dribbleBounce').length).toBeGreaterThan(0);
  });

  it('a back flick performs a stepback that opens a rhythm-jumper window', () => {
    const sim = practice(6);
    const u = sim.user.player;
    run(sim, 20, () => ({ ...blank(), moveX: 0.3 }));
    const ev = run(sim, 40, (i) => ({ ...blank(), flick: i === 0 ? { x: -u.fx, z: -u.fz } : null }));
    expect(ev.find((e) => e.type === 'dribbleMove').move).toBe('stepback');
    expect(sim.t - u.shotReadyT).toBeLessThan(0.55); // still inside the stepback-jumper window
  });
});

describe('5v5 user controls', () => {
  function liveGame(seed) {
    const sim = new Simulation({ teams: [rosters.teams[0], rosters.teams[1]], seed, settings: { quarterMin: 5, userTeam: 0, difficulty: 'allstar' } });
    sim.match.beginGame();
    return sim;
  }

  it('the user can pass and the ball reaches a teammate', () => {
    const sim = liveGame(21);
    let passed = false;
    let caught = false;
    for (let i = 0; i < 60 * 120 && !caught; i++) {
      const u = sim.user.player;
      const inp = blank();
      if (u && sim.ball.owner === u && sim.match.phase === 'live' && !passed && !u.inbounding) { inp.pass = true; passed = true; }
      sim.step(inp);
      for (const e of sim.drainEvents()) if (passed && e.type === 'catch' && e.player.team === 0 && e.player !== u) caught = true;
    }
    expect(passed).toBe(true);
    expect(caught).toBe(true);
  });

  it('the user can switch players on defence and attempt a steal', () => {
    const sim = liveGame(8);
    let switched = false, stole = false;
    for (let i = 0; i < 60 * 120 && !(switched && stole); i++) {
      const inp = blank();
      const h = sim.holder();
      if (sim.match.phase === 'live' && h && h.team === 1) {
        if (!switched) { inp.switchPlayer = true; switched = true; }
        else if (!stole) { inp.steal = true; }
      }
      sim.step(inp);
      if (sim.user.player.action && sim.user.player.action.type === 'steal') stole = true;
    }
    expect(switched).toBe(true);
    expect(stole).toBe(true);
  });
});
