// Multi-seed audit: scores, FGA, subs, bench minutes, stamina, fast-break pts.
import { runMatch } from './runMatch.mjs';
const q = Number(process.argv[2] || 3), seeds = Number(process.argv[3] || 7);
const rows = [];
for (let s = 1; s <= seeds; s++) {
  const { sim, counts } = runMatch({ quarterMin: q, seed: s, home: (s - 1) % 6, away: s % 6 });
  const m = sim.match;
  const fga = sim.teams.reduce((a, t) => a + t.roster.reduce((b, p) => b + p.stats.fga, 0), 0);
  const bench = sim.teams.map((t) => Math.round(t.roster.filter((p) => !p.starter || !p.def).reduce((a, p) => a + (p.starter ? 0 : p.stats.min), 0) / 60));
  const stam = sim.teams.map((t) => (t.onCourt.reduce((a, p) => a + p.stamina, 0) / t.onCourt.length).toFixed(2));
  rows.push({ seed: s, score: m.score.join('-'), q: m.quarter, fga, subs: counts.substitution || 0, benchMin: bench.join('/'), stamina: stam.join('/'), fb: m.teamStats.map((t) => t.fastBreak).join('/'), tov: m.teamStats.map((t) => t.turnovers).join('/') });
}
console.table(rows);
