import { describe, it, expect } from 'vitest';
import rosters from '../src/data/rosters.json' with { type: 'json' };
import { Simulation } from '../src/sim/Simulation.js';
import { runMatch } from './runMatch.mjs';

describe('fatigue and substitutions', () => {
  const games = [1, 2, 3, 4].map((seed) => {
    const fouledOut = new Set();
    let lineupHole = false;
    let foulOutReturned = false;
    const subPhases = new Set();
    const r = runMatch({ quarterMin: 3, seed, home: seed % 6, away: (seed + 2) % 6, onStep(sim) {
      for (const t of sim.teams) if (t.onCourt.length !== 5 || new Set(t.onCourt).size !== 5) lineupHole = true;
      for (const e of sim.events) {
        if (e.type === 'foulOut') fouledOut.add(e.player);
        if (e.type === 'substitution') { subPhases.add(sim.match.phase); if (fouledOut.has(e.in)) foulOutReturned = true; }
      }
    } });
    return { ...r, lineupHole, foulOutReturned, subPhases };
  });

  it('every game uses the bench (substitution events and real bench minutes)', () => {
    for (const g of games) {
      expect(g.counts.substitution || 0).toBeGreaterThanOrEqual(6);
      for (const t of g.sim.teams) {
        const benchSec = t.roster.filter((p) => !p.starter).reduce((a, p) => a + p.stats.min, 0);
        expect(benchSec).toBeGreaterThan(60);
      }
    }
  });

  it('keeps exactly five distinct players per side and never returns a fouled-out player', () => {
    for (const g of games) {
      expect(g.lineupHole).toBe(false);
      expect(g.foulOutReturned).toBe(false);
    }
  });

  it('only substitutes at stoppages, never during live play', () => {
    for (const g of games) expect(g.subPhases.has('live')).toBe(false);
  });

  it('players tire with exertion and recover on the bench', () => {
    const sim = new Simulation({ teams: [rosters.teams[0], rosters.teams[1]], seed: 3, settings: { quarterMin: 3, userTeam: null } });
    sim.match.beginGame();
    const p = sim.teams[0].onCourt[0];
    p.liveClock = true;
    p.speed = 7.5;
    const s0 = p.stamina;
    for (let i = 0; i < 600; i++) p.updateStamina(1 / 60, true, true);
    const sprinted = s0 - p.stamina;
    p.stamina = s0; p.speed = 0;
    for (let i = 0; i < 600; i++) p.updateStamina(1 / 60, false, true);
    const stood = s0 - p.stamina;
    expect(sprinted).toBeGreaterThan(stood * 4);
    const tired = p.stamina = 0.4;
    for (let i = 0; i < 60 * 30; i++) p.rest(1 / 60);
    expect(p.stamina).toBeGreaterThan(tired + 0.15);
    // Tired players are slower.
    p.stamina = 0.2;
    const slow = p.sprintMax() * p.fatigue();
    p.stamina = 1;
    expect(p.sprintMax() * p.fatigue()).toBeGreaterThan(slow * 1.1);
  });
});

describe('transition offense', () => {
  it('produces fast-break points over a sample of games, consistent with the box score', () => {
    let fb = 0;
    let breaks = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { sim } = runMatch({ quarterMin: 3, seed, home: seed % 6, away: (seed + 1) % 6, onStep(s) { for (const e of s.events) if (e.type === 'hitAhead') breaks++; } });
      for (let t = 0; t < 2; t++) {
        expect(sim.match.teamStats[t].fastBreak).toBeLessThanOrEqual(sim.match.score[t]);
        fb += sim.match.teamStats[t].fastBreak;
      }
    }
    expect(breaks).toBeGreaterThan(3);
    expect(fb).toBeGreaterThanOrEqual(12);
  });
});

describe('blacktop sizes', () => {
  for (const n of [1, 5]) {
    it(`${n}v${n} reaches the target score`, () => {
      const { sim } = runMatch({ mode: 'blacktop', playersPerSide: n, targetScore: 11, seed: 2, maxSteps: 60 * 60 * 60 });
      expect(sim.match.phase).toBe('final');
      expect(Math.max(...sim.match.score)).toBeGreaterThanOrEqual(11);
      for (const t of sim.teams) expect(t.onCourt.length).toBe(n);
    });
  }
});

describe('period buzzer', () => {
  it('only counts baskets released before the buzzer', () => {
    let checked = 0;
    for (let seed = 1; seed <= 4; seed++) {
      let buzzT = null;
      const late = [];
      runMatch({ quarterMin: 3, seed, onStep(sim) {
        for (const e of sim.events) {
          if (e.type === 'buzzer') buzzT = sim.t;
          if (e.type === 'score' && e.shot && e.shot.kind !== 'ft' && buzzT !== null && sim.t - buzzT < 4) late.push({ rel: e.shot.releaseT, buzz: buzzT });
          if (e.type === 'periodStart') buzzT = null;
        }
      } });
      for (const l of late) { expect(l.rel).toBeLessThanOrEqual(l.buzz + 1e-6); checked++; }
    }
    expect(checked).toBeGreaterThanOrEqual(0);
  });
});
