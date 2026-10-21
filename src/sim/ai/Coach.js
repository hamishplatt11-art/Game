// Coaching AI: play calling from personnel and matchups, defensive scheme,
// switching policy, timeouts and fatigue/foul-based substitutions.
import { clamp } from '../../core/math.js';

export class Coach {
  constructor(teamAI) {
    this.ai = teamAI;
    this.scheme = 'man';
    this.switching = false;
    this.lastTimeoutT = -999;
    this.decideScheme();
  }

  get sim() { return this.ai.sim; }
  get team() { return this.ai.team; }

  decideScheme() {
    const sim = this.sim;
    const mine = sim.teams[this.team].onCourt;
    const opp = sim.teams[1 - this.team].onCourt;
    const perim = mine.reduce((a, p) => a + p.r('perimeterD'), 0) / mine.length;
    const oppShoot = opp.reduce((a, p) => a + p.r('threeShot'), 0) / opp.length;
    const oppPost = Math.max(...opp.map((p) => p.r('postControl')));
    // Versatile perimeter defenders switch screens; weaker ones fight over them.
    this.switching = perim > 0.55;
    // Zone against post-heavy, poor-shooting opponents; stats can flip it mid-game.
    this.scheme = oppPost > 0.75 && oppShoot < 0.55 ? 'zone' : 'man';
    const m = sim.match;
    if (m) {
      const ts = m.teamStats[1 - this.team];
      if (ts.paint > 20 && oppShoot < 0.6) this.scheme = 'zone';
      if (this.scheme === 'zone' && oppShoot > 0.6) this.scheme = 'man';
    }
  }

  /** Choose this possession's play from team style, stars and mismatches. */
  callPlay() {
    const sim = this.sim;
    const players = sim.teams[this.team].onCourt;
    const n = players.length;
    const style = sim.teams[this.team].raw.style || 'motion';
    const star = [...players].sort((a, b) => b.def.ovr - a.def.ovr)[0];
    const bigs = players.filter((p) => p.pos === 'C' || p.pos === 'PF');
    const handler = players.find((p) => p.pos === 'PG') || star;
    const poster = [...players].sort((a, b) => (b.r('postControl') + b.r('passVision') * 0.4) - (a.r('postControl') + a.r('passVision') * 0.4))[0];
    const screener = [...(bigs.length ? bigs : players)].filter((p) => p !== handler).sort((a, b) => b.r('strength') - a.r('strength'))[0];
    // Mismatch hunting: a player much taller (post) or faster (iso) than his defender.
    const dai = sim.ai[1 - this.team];
    let mismatchPost = null, mismatchIso = null;
    for (const p of players) {
      const d = this.ai.defenderOf(p);
      if (!d) continue;
      if (p.heightM - d.heightM > 0.1 && p.r('postControl') > 0.5) mismatchPost = p;
      if (p.r('speedWithBall') - d.r('perimeterD') > 0.25 && p.r('ballHandle') > 0.6) mismatchIso = p;
    }
    const w = [
      ['pnr', style === 'pace-and-space' ? 3 : 2],
      ['motion', style === 'motion' ? 3 : 1.4],
      ['iso', star.def.ovr >= 90 && star.pos !== 'C' ? (style === 'midrange-iso' || style === 'star-wing' ? 2.5 : 1.2) : 0.3],
      ['post', poster.r('postControl') > 0.6 ? (style === 'inside-out' ? 2.6 : 1) : 0.15],
    ];
    if (mismatchPost) w.push(['postMismatch', 1.2]);
    if (mismatchIso) w.push(['isoMismatch', 1.0]);
    if (n < 5) { w.length = 0; w.push(['iso', 1], ['pnr', n >= 2 ? 1.5 : 0], ['motion', 1]); }
    const pick = sim.rng.weighted(w);
    const formation = n === 5 ? (pick === 'post' || pick === 'postMismatch' ? 'fourOut' : pick === 'pnr' && sim.rng.chance(0.4) ? 'horns' : 'fiveOut') : n === 3 ? 'threeOut' : 'twoOut';
    const side = sim.rng.chance(0.5) ? 1 : -1;
    switch (pick) {
      case 'pnr': return { type: 'pnr', handler, screener, side, start: sim.t, formation };
      case 'iso': return { type: 'iso', star, start: sim.t, formation: n === 5 ? 'fiveOut' : formation };
      case 'isoMismatch': return { type: 'iso', star: mismatchIso, start: sim.t, formation };
      case 'post': return { type: 'post', poster, start: sim.t, formation };
      case 'postMismatch': return { type: 'post', poster: mismatchPost, start: sim.t, formation: 'fourOut' };
      default: return { type: 'motion', start: sim.t, formation };
    }
  }

  onDeadBall() {
    const sim = this.sim;
    const m = sim.match;
    if (this.team === sim.user.team && !sim.settings.cpuCoachUserTeam) return;
    if (m.halfCourt || m.practice) return;
    // Stop an opponent run.
    const run = m.streak.team === 1 - this.team ? m.streak.pts : 0;
    const t = sim.teams[this.team];
    if (run >= 8 && t.timeouts > 1 && sim.t - this.lastTimeoutT > 60 && m.phase === 'deadball') {
      this.lastTimeoutT = sim.t;
      m.streak.pts = 0;
      // Called once the stoppage settles into an inbound.
      this.pendingTimeout = true;
    }
    if (this.pendingTimeout && m.canCallTimeout(this.team)) {
      this.pendingTimeout = false;
      m.requestTimeout(this.team);
      this.decideScheme();
      // CPU coach resumes immediately; the UI shows the timeout banner.
      if (!sim.settings.waitOnCpuTimeout) m.autoResumeOnce = true;
    }
  }

  substitutions(periodStart) {
    const sim = this.sim;
    const m = sim.match;
    const team = sim.teams[this.team];
    const bench = () => team.roster.filter((p) => !p.onCourt && p.fouls < 6);
    for (const p of [...team.onCourt]) {
      if (sim.ball.owner === p) continue;
      if (sim.t - (p.subT ?? -999) < 150) continue;
      if (m.inb && m.inb.inbounder === p) continue;
      const foulTrouble = (m.quarter <= 2 && p.fouls >= m.quarter + 2) || (m.quarter === 3 && p.fouls >= 5);
      const tired = p.stamina < 0.5;
      if (!tired && !foulTrouble) continue;
      const cands = bench().filter((q) => q.stamina > 0.75 && sim.t - (q.subT ?? -999) > 90);
      if (!cands.length) continue;
      const samePos = cands.filter((q) => q.pos === p.pos);
      const pool = samePos.length ? samePos : cands.filter((q) => posGroup(q.pos) === posGroup(p.pos));
      const inP = (pool.length ? pool : cands).sort((a, b) => b.def.ovr - a.def.ovr)[0];
      m.swap(team, p, inP);
    }
    // Get rested starters back in, especially late.
    const late = m.quarter >= 4 || (m.clock < m.periodLength() * 0.45);
    for (const st of team.roster.filter((p) => p.starter && !p.onCourt && p.fouls < 6 && p.stamina > (late ? 0.82 : 0.92))) {
      if (sim.t - (st.subT ?? -999) < 120) continue;
      const sub = team.onCourt.find((p) => !p.starter && posGroup(p.pos) === posGroup(st.pos) && sim.ball.owner !== p && !(m.inb && m.inb.inbounder === p) && sim.t - (p.subT ?? -999) > 120);
      if (sub) m.swap(team, sub, st);
    }
  }
}

function posGroup(pos) {
  return pos === 'PG' || pos === 'SG' ? 'G' : pos === 'SF' || pos === 'PF' ? 'F' : 'C';
}

export { clamp };
