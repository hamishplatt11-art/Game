import { describe, it, expect } from 'vitest';
import { runMatch } from './runMatch.mjs';

function teamPoints(t) {
  return t.roster.reduce((a, p) => a + p.stats.pts, 0);
}

describe('full CPU vs CPU match', () => {
  const { sim, counts } = runMatch({ quarterMin: 3, seed: 11, onStep(s) {
    // Invariants checked every step.
    for (const t of s.teams) if (t.onCourt.length !== 5) throw new Error('team without five players on court');
    for (const p of s.players) if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) throw new Error('NaN position');
    const b = s.ball;
    if (!Number.isFinite(b.p.x + b.p.y + b.p.z)) throw new Error('NaN ball');
    if ((b.state === 'held' || b.state === 'dribble') && !b.owner) throw new Error('held ball without owner');
  } });
  const m = sim.match;

  it('reaches a final result through four quarters (or OT)', () => {
    expect(m.phase).toBe('final');
    expect(m.quarter).toBeGreaterThanOrEqual(4);
    expect(m.score[0]).not.toBe(m.score[1]);
  });

  it('scores come only from recorded scoring events and match the box score', () => {
    expect(m.score[0]).toBeGreaterThan(10);
    expect(m.score[1]).toBeGreaterThan(10);
    expect(teamPoints(sim.teams[0])).toBe(m.score[0]);
    expect(teamPoints(sim.teams[1])).toBe(m.score[1]);
    expect(counts.score).toBe(m.log.length);
  });

  it('box score is internally consistent', () => {
    for (const t of sim.teams) {
      for (const p of t.roster) {
        const s = p.stats;
        expect(s.fgm).toBeLessThanOrEqual(s.fga);
        expect(s.tpm).toBeLessThanOrEqual(s.tpa);
        expect(s.ftm).toBeLessThanOrEqual(s.fta);
        expect(s.pts).toBe(2 * (s.fgm - s.tpm) + 3 * s.tpm + s.ftm);
      }
    }
  });

  it('possession changes, rebounds, passes, fouls and the tip happen', () => {
    expect(counts.tipWon).toBe(1);
    expect(counts.possession).toBeGreaterThan(20);
    expect(counts.rebound).toBeGreaterThan(5);
    expect(counts.pass).toBeGreaterThan(30);
    expect(counts.shotRelease).toBeGreaterThan(20);
    expect(counts.periodEnd).toBeGreaterThanOrEqual(3);
  });
});

describe('blacktop half-court game', () => {
  it('plays 3v3 to the target score', () => {
    const { sim } = runMatch({ mode: 'blacktop', playersPerSide: 3, targetScore: 11, seed: 3, maxSteps: 60 * 60 * 40 });
    const m = sim.match;
    expect(m.phase).toBe('final');
    expect(Math.max(...m.score)).toBeGreaterThanOrEqual(11);
  });
});
