// Headless CPU-vs-CPU match runner used by tests and for balancing.
import rosters from '../src/data/rosters.json' with { type: 'json' };
import { Simulation } from '../src/sim/Simulation.js';

export function runMatch({ home = 0, away = 1, quarterMin = 3, seed = 1, difficulty = 'allstar', maxSteps = 60 * 60 * 120, onStep = null, mode = 'playnow', playersPerSide = 5, targetScore = 21 } = {}) {
  const sim = new Simulation({
    teams: [rosters.teams[home], rosters.teams[away]],
    settings: { quarterMin, difficulty, userTeam: null, mode, playersPerSide, targetScore },
    seed,
  });
  sim.match.autoResume = true;
  sim.match.beginGame();
  const counts = {};
  let steps = 0;
  while (sim.match.phase !== 'final' && steps < maxSteps) {
    sim.step(null);
    if (onStep) onStep(sim, steps);
    for (const e of sim.drainEvents()) counts[e.type] = (counts[e.type] || 0) + 1;
    steps++;
  }
  return { sim, counts, steps };
}

if (process.argv[1] && process.argv[1].endsWith('runMatch.mjs')) {
  const t0 = Date.now();
  const { sim, counts, steps } = runMatch({ quarterMin: Number(process.argv[2] || 3), seed: Number(process.argv[3] || 1) });
  const m = sim.match;
  console.log('phase', m.phase, 'Q', m.quarter, 'score', m.score, 'steps', steps, 'simMin', (steps / 60 / 60).toFixed(1), 'ms', Date.now() - t0);
  console.log(JSON.stringify(counts));
  for (const t of sim.teams) {
    console.log('---', t.raw.abbr);
    for (const p of t.roster) {
      const s = p.stats;
      console.log(p.name.padEnd(22), p.pos, `MIN ${(s.min / 60).toFixed(1)} PTS ${s.pts} FG ${s.fgm}/${s.fga} 3P ${s.tpm}/${s.tpa} FT ${s.ftm}/${s.fta} REB ${s.oreb + s.dreb} AST ${s.ast} STL ${s.stl} BLK ${s.blk} TOV ${s.tov} PF ${s.pf} +/- ${s.pm}`);
    }
  }
  console.log('team stats', JSON.stringify(m.teamStats));
}
