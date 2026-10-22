// Match engine: game state machine, game/shot clocks, possession, scoring,
// fouls, violations, free throws, inbounds, timeouts, substitutions and
// statistics. Every stoppage here is triggered by a simulated event.
import { clamp } from '../core/math.js';
import {
  HALF_L, HALF_W, RIM_H, hoopPos, hoopSign, inPaint, isThreePoint, distToHoop, FT_LINE_FROM_BASELINE, LANE_W, BALL_R,
} from './constants.js';
import { solveTimed } from './ShotSolver.js';

const ACTIVE = new Set(['tipoff', 'live', 'deadball', 'inbound', 'freethrow', 'check']);

export class Match {
  constructor(sim) {
    this.sim = sim;
    const s = sim.settings;
    this.halfCourt = s.mode === 'blacktop';
    this.practice = s.mode === 'practice';
    this.phase = 'pregame';
    this.phaseT = 0;
    this.quarter = 1;
    this.clock = this.periodLength();
    this.shotClock = 24;
    this.shotClockOn = false;
    this.possTeam = null;
    this.score = [0, 0];
    this.periodScores = [[], []];
    this.tipWinner = null;
    this.rimTouched = false;
    this.frontcourt = false;
    this.backcourtT = 0;
    this.runAfterMake = false;
    this.deadDur = 1.2;
    this.next = null;
    this.whistle = null;
    this.inb = null;
    this.ft = null;
    this.tip = null;
    this.pendingShootingFoul = null;
    this.buzzerPending = false;
    this.possStartT = 0;
    this.possStartHow = 'tip';
    this.subQueue = [[], []];
    this.forcedOut = [];
    this.teamStats = [Match.emptyTeamStats(), Match.emptyTeamStats()];
    this.log = [];
    this.lastScorers = [];
    this.needClear = false;
    this.autoResume = false;
    this.gameOver = false;
    this.winner = null;
    this.streak = { team: null, pts: 0 };
  }

  static emptyTeamStats() {
    return { paint: 0, fastBreak: 0, bench: 0, secondChance: 0, turnovers: 0, biggestLead: 0, timeoutsUsed: 0 };
  }

  periodLength() {
    const q = this.sim.settings.quarterMin * 60;
    if (this.quarter <= 4) return q;
    return Math.max(60, Math.round((q * 5) / 12));
  }

  isActive() {
    return ACTIVE.has(this.phase);
  }

  attackHoop(team) {
    if (this.halfCourt || this.practice) return 1;
    const secondHalf = this.quarter >= 3;
    const base = team === 0 ? 1 : 0;
    return secondHalf ? 1 - base : base;
  }

  defendHoop(team) {
    return this.attackHoop(1 - team);
  }

  isClutch() {
    return this.quarter >= 4 && this.clock <= 120;
  }

  setPhase(p) {
    this.phase = p;
    this.phaseT = 0;
    this.sim.emit('phase', { phase: p });
  }

  // ---------------------------------------------------------------------
  // Start / tip-off
  // ---------------------------------------------------------------------
  beginGame() {
    if (this.practice) {
      this.possTeam = this.sim.user.team ?? 0;
      this.placeForPractice();
      this.setPhase('live');
      return;
    }
    if (this.halfCourt) {
      this.possTeam = this.sim.rng.chance(0.5) ? 0 : 1;
      this.setupCheck(this.possTeam);
      return;
    }
    this.setupTipoff();
  }

  placeForPractice() {
    const sim = this.sim;
    const team = sim.teams[this.possTeam];
    const p = team.onCourt[0];
    const h = hoopPos(1);
    p.setPos(h.x - 7.5, 0, 0);
    sim.giveBall(p, 'inbound');
    if (sim.user.team !== null) sim.setUserPlayer(p);
    // Defenders (if any) line up; other teammates stand at the slots.
    team.onCourt.slice(1).forEach((q, i) => q.setPos(h.x - 5 + i, -5 + i * 3, 0));
    sim.teams[1 - this.possTeam].onCourt.forEach((q, i) => q.setPos(h.x - 3 - i * 0.6, -1 + i * 1.2, Math.PI));
  }

  setupTipoff() {
    const sim = this.sim;
    const jumpers = [];
    for (const team of sim.teams) {
      const c = [...team.onCourt].sort((a, b) => (b.heightM + b.maxVertical * 0.5) - (a.heightM + a.maxVertical * 0.5))[0];
      jumpers.push(c);
    }
    // Teams line up around the centre circle facing their attacking hoop.
    for (const team of sim.teams) {
      const s = hoopSign(this.attackHoop(team.idx));
      const others = team.onCourt.filter((p) => !jumpers.includes(p));
      const spots = [[-1.8, -3.4], [-1.8, 3.4], [-4.5, -1.6], [-4.5, 1.6]];
      others.forEach((p, i) => {
        const sp = spots[i % spots.length];
        p.setPos(sp[0] * s, sp[1], s > 0 ? 0 : Math.PI);
      });
    }
    jumpers.forEach((p) => {
      const s = hoopSign(this.attackHoop(p.team));
      p.setPos(-0.42 * s, 0, s > 0 ? 0 : Math.PI);
    });
    const b = sim.ball;
    b.state = 'dead'; b.owner = null; b.air = null;
    b.p.x = 0; b.p.y = 1.2; b.p.z = 0.3; b.v.x = 0; b.v.y = 0; b.v.z = 0;
    this.tip = { jumpers, tossed: false, tapped: false, userJumped: false };
    this.clock = this.periodLength();
    this.shotClock = 24;
    this.shotClockOn = false;
    this.setPhase('tipoff');
    if (sim.user.team !== null && !sim.user.player) {
      const mine = jumpers.find((p) => p.team === sim.user.team);
      sim.setUserPlayer(mine);
    }
  }

  userTipJump(p) {
    if (!this.tip || this.tip.userJumped || p.airborne) return;
    this.tip.userJumped = true;
    p.jump(p.maxVertical);
  }

  updateTip(dt) {
    const sim = this.sim;
    const tip = this.tip;
    const b = sim.ball;
    if (!tip.tossed && this.phaseT > 1.0) {
      tip.tossed = true;
      tip.tossT = sim.t;
      b.state = 'dead';
      b.p.x = 0; b.p.y = 1.9; b.p.z = 0;
      b.v.x = 0; b.v.y = 6.9; b.v.z = 0;
      sim.emit('whistle', { kind: 'tip' });
    }
    if (!tip.tossed) {
      b.p.x = 0; b.p.y = 1.3; b.p.z = 0.25;
      return;
    }
    // CPU jumpers time their jump so their fingertips meet the ball as it drops.
    for (const p of tip.jumpers) {
      if (p.airborne || p.y > 0) continue;
      if (sim.isUser(p)) continue;
      const apexT = 6.9 / 9.81;
      const tSince = sim.t - tip.tossT;
      const jumpDur = Math.sqrt((2 * p.maxVertical) / 9.81);
      const noise = (p.team === sim.user.team ? 0.06 : sim.diff.cpuNoise * 0.25) * ((p.id.charCodeAt(0) % 7) / 7 - 0.5);
      if (tSince >= apexT - jumpDur + 0.1 + noise) p.jump(p.maxVertical);
    }
    if (!tip.tapped) {
      let winner = null, best = -1;
      for (const p of tip.jumpers) {
        if (!p.airborne) continue;
        const reach = p.reachNow() + 0.1;
        const d = Math.hypot(b.p.x - p.x, b.p.z - p.z);
        if (d < 0.7 && reach >= b.p.y - 0.05 && b.p.y > 2.4) {
          const score = reach - b.p.y + p.r('vertical') * 0.1;
          if (score > best) { best = score; winner = p; }
        }
      }
      if (winner) {
        tip.tapped = true;
        const mates = sim.teams[winner.team].onCourt.filter((q) => q !== winner);
        const s = hoopSign(this.attackHoop(winner.team));
        // Tap back toward a teammate behind the jumper.
        const target = mates.sort((a, c) => (a.x * s) - (c.x * s))[0];
        const v = solveTimed(b.p, { x: target.x, y: 1.4, z: target.z }, 0.85);
        b.state = 'air';
        b.v.x = v.x; b.v.y = v.y; b.v.z = v.z;
        b.air = { kind: 'tip', t: 0, from: winner, touchedRim: false, touchedBoard: false };
        b.lastTouch = winner;
        this.tipWinner = winner.team;
        this.possTeam = winner.team;
        this.setPhase('live');
        this.shotClockOn = false;
        sim.emit('tipWon', { player: winner });
      } else if (b.p.y < 1.4 && b.v.y < 0) {
        // Nobody touched it: re-toss.
        tip.tossed = false;
        this.phaseT = 0.4;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Per-step updates
  // ---------------------------------------------------------------------
  update(dt) {
    this.phaseT += dt;
    switch (this.phase) {
      case 'tipoff':
        this.updateTip(dt);
        break;
      case 'deadball':
        if (this.phaseT >= this.deadDur && this.next) {
          const n = this.next;
          this.next = null;
          n();
        }
        break;
      case 'inbound':
      case 'check':
        this.updateInbound(dt);
        break;
      case 'freethrow':
        this.updateFreeThrow(dt);
        break;
      case 'timeout':
        if ((this.autoResume && this.phaseT > 0.5) || (this.autoResumeOnce && this.phaseT > 3)) {
          this.autoResumeOnce = false;
          this.resumeFromTimeout();
        }
        break;
      case 'periodEnd':
        if (this.phaseT > 2.5) this.startNextPeriod();
        break;
      case 'halftime':
        if (this.autoResume && this.phaseT > 0.5) this.startNextPeriod();
        break;
      default:
        break;
    }
  }

  postUpdate(dt) {
    const sim = this.sim;
    if (this.phase === 'final') return;
    const running = !this.buzzerPending && this.phase === 'live' || ((this.phase === 'deadball' || this.phase === 'inbound') && this.runAfterMake);
    if (running && !this.halfCourt && !this.practice) {
      this.clock -= dt;
      for (const p of sim.players) p.stats.min += dt;
      if (this.clock <= 0) {
        this.clock = 0;
        this.onClockExpired();
        if (this.phase !== 'live') return;
      }
    }
    if (this.phase !== 'live') return;
    const b = sim.ball;
    const holder = sim.holder();
    if (this.practice) {
      this.practiceUpdate(dt);
      return;
    }
    // Shot clock.
    if (this.shotClockOn && this.possTeam !== null) {
      this.shotClock -= dt;
      if (this.shotClock <= 0) {
        this.shotClock = 0;
        const shotUp = b.state === 'air' && b.air && b.air.kind === 'shot';
        if (!shotUp) {
          this.violation('shot clock', this.possTeam, holder ? { x: holder.x, z: holder.z } : { x: b.p.x, z: b.p.z });
          return;
        }
        this.shotClockOn = false;
        this.expiredWithShotUp = true;
      }
    }
    if (holder && holder.team === this.possTeam && !holder.inbounding) {
      const s = hoopSign(this.attackHoop(holder.team));
      const inFront = holder.x * s > 0.6;
      // Out of bounds with the ball.
      if (Math.abs(holder.x) > HALF_L || Math.abs(holder.z) > HALF_W) {
        this.violation('out of bounds', holder.team, { x: holder.x, z: holder.z });
        return;
      }
      if (!this.halfCourt) {
        if (inFront && !this.frontcourt) this.frontcourt = true;
        if (!this.frontcourt) {
          this.backcourtT += dt;
          if (this.backcourtT > 8) { this.violation('8 seconds', holder.team, { x: holder.x, z: holder.z }); return; }
        } else if (holder.x * s < -0.3 && b.state === 'dribble') {
          this.violation('backcourt', holder.team, { x: holder.x, z: holder.z });
          return;
        }
      }
    }
    // Three seconds (offence in the lane while the team controls the ball in the frontcourt).
    if (this.possTeam !== null && (this.frontcourt || this.halfCourt) && holder && holder.team === this.possTeam) {
      const hoop = this.attackHoop(this.possTeam);
      for (const p of sim.teams[this.possTeam].onCourt) {
        const shooting = p.action && ['shot', 'layup', 'dunk'].includes(p.action.type);
        if (inPaint(p.x, p.z, hoop) && !shooting) {
          // The count pauses while the player is clearly leaving the lane.
          const s = hoopSign(hoop);
          const leaving = p.speed > 1.0 && (p.vx * -s > 0.6 || Math.abs(p.vz) > 0.8 && Math.abs(p.z) > 1.2);
          if (!leaving) p.inLaneT += dt;
          if (p.inLaneT > 3 && !(holder === p && sim.velTowardHoop(p, hoop) > 1)) {
            p.inLaneT = 0;
            this.violation('3 seconds', p.team, { x: p.x, z: p.z }, p);
            return;
          }
        } else p.inLaneT = 0;
      }
      // Defensive three seconds: in the lane without guarding anyone within arm's length.
      const dteam = sim.teams[1 - this.possTeam];
      for (const d of dteam.onCourt) {
        if (inPaint(d.x, d.z, hoop)) {
          // Guarding = within arm's length of an opponent, or actively helping on the ball handler.
          let guarding = holder.distTo(d) < 4.5;
          for (const o of sim.teams[this.possTeam].onCourt) if (o.distTo(d) < 2.0) guarding = true;
          d.defLaneT = guarding ? 0 : (d.defLaneT || 0) + dt;
          if (d.defLaneT > 3) {
            d.defLaneT = 0;
            this.technical(d, 'defensive 3 seconds');
            return;
          }
        } else d.defLaneT = 0;
      }
    }
    // Shooting foul pending: resolve when the shot has clearly missed.
    const pf = this.pendingShootingFoul;
    if (pf) {
      const shotInAir = b.state === 'air' && b.air && b.air.shot === pf.shot && pf.shot;
      if (pf.shot && shotInAir && b.p.y < RIM_H - 0.6 && (b.air.touchedRim || b.air.touchedBoard || b.v.y < 0)) {
        this.awardShootingFouls(pf, false);
      } else if (!pf.shot && sim.t - pf.t > 1.6) {
        this.awardShootingFouls(pf, false);
      } else if (pf.shot && !shotInAir && b.state !== 'dead') {
        this.awardShootingFouls(pf, false);
      }
    }
    // Lead tracking.
    for (let i = 0; i < 2; i++) {
      this.teamStats[i].biggestLead = Math.max(this.teamStats[i].biggestLead, this.score[i] - this.score[1 - i]);
    }
    if (this.buzzerPending && (b.state !== 'air' || (b.air && b.air.kind !== 'shot') || (b.air && b.air.touchedRim && b.p.y < RIM_H - 0.7) || b.p.y < 0.5)) {
      this.buzzerPending = false;
      this.endPeriod();
    }
  }

  practiceUpdate() {
    const sim = this.sim;
    const b = sim.ball;
    // Ball returns to the shooter after it settles.
    if (b.state === 'air' && b.air.t > 2.4 && (b.air.kind === 'shot' || b.air.kind === 'loose')) {
      const p = sim.user.player || sim.teams[this.possTeam].onCourt[0];
      sim.giveBall(p, 'inbound');
    }
    if (b.state === 'dead' && this.phaseT > 1) {
      const p = sim.user.player || sim.teams[this.possTeam].onCourt[0];
      sim.giveBall(p, 'inbound');
    }
  }

  // ---------------------------------------------------------------------
  // Clock / periods
  // ---------------------------------------------------------------------
  onClockExpired() {
    const sim = this.sim;
    const b = sim.ball;
    if (b.state === 'air' && b.air && b.air.kind === 'shot' && b.air.shot && b.air.shot.kind !== 'ft') {
      this.buzzerPending = true;
      sim.emit('buzzer', { shotUp: true });
      return;
    }
    if (this.phase === 'live' || this.phase === 'deadball' || this.phase === 'inbound') {
      sim.emit('buzzer', { shotUp: false });
      this.endPeriod();
    }
  }

  endPeriod() {
    const sim = this.sim;
    this.runAfterMake = false;
    this.pendingShootingFoul = null;
    const b = sim.ball;
    if (b.state !== 'air') { b.state = 'dead'; b.owner = null; }
    this.periodScores[0].push(this.score[0] - this.periodScores[0].reduce((a, c) => a + c, 0));
    this.periodScores[1].push(this.score[1] - this.periodScores[1].reduce((a, c) => a + c, 0));
    if (this.quarter >= 4 && this.score[0] !== this.score[1]) {
      this.finish();
      return;
    }
    sim.emit('periodEnd', { quarter: this.quarter });
    this.setPhase(this.quarter === 2 ? 'halftime' : 'periodEnd');
  }

  startNextPeriod() {
    const sim = this.sim;
    this.quarter++;
    this.clock = this.periodLength();
    for (const t of sim.teams) { t.fouls = 0; t.foulsLast2 = 0; }
    // Break between periods (halftime is longer).
    const brk = this.quarter === 3 ? 0.22 : 0.08;
    for (const t of sim.teams) for (const p of t.roster) p.stamina = Math.min(1, p.stamina + (p.onCourt ? brk : brk * 1.5));
    this.processSubs(true);
    sim.emit('periodStart', { quarter: this.quarter });
    if (this.quarter > 4) {
      this.setupTipoff();
      return;
    }
    // Alternating possession: loser of the opening tip gets Q2/Q3, winner Q4.
    const winner = this.tipWinner ?? 0;
    const team = this.quarter === 4 ? winner : 1 - winner;
    this.resetFormation(team);
    const s = hoopSign(this.attackHoop(team));
    this.setupInbound(team, { x: -s * (HALF_L + 0.35), z: 2.2 }, 'period');
  }

  finish() {
    const sim = this.sim;
    this.gameOver = true;
    this.winner = this.score[0] > this.score[1] ? 0 : 1;
    this.setPhase('final');
    sim.emit('final', { winner: this.winner, score: [...this.score] });
  }

  resetFormation(team) {
    const sim = this.sim;
    const s = hoopSign(this.attackHoop(team));
    sim.teams[team].onCourt.forEach((p, i) => p.setPos(-s * (HALF_L - 3 - i * 2.2), -4 + i * 2, s > 0 ? 0 : Math.PI));
    sim.teams[1 - team].onCourt.forEach((p, i) => p.setPos(-s * (HALF_L - 9 - i * 1.6), -3.5 + i * 1.8, s > 0 ? Math.PI : 0));
  }

  // ---------------------------------------------------------------------
  // Possession and scoring
  // ---------------------------------------------------------------------
  onSecure(p, how, air, prevTeam) {
    const sim = this.sim;
    if (this.phase === 'freethrow') {
      // Rebound of the last missed free throw starts live play.
      this.ft = null;
      this.setPhase('live');
    }
    if ((this.phase === 'inbound' || this.phase === 'check') && how !== 'inbound-hand') {
      if (how === 'inbound' || how === 'pass') {
        if (sim.user.team === p.team && sim.settings.autoSwitch) sim.setUserPlayer(p);
        this.setPhase('live');
        this.runAfterMake = false;
        this.shotClockOn = true;
        if (this.inb && this.inb.resetShot) this.shotClock = this.inb.resetShot;
        this.inb = null;
      } else if (how === 'interception' || how === 'steal' || how === 'loose' || how === 'rebound') {
        this.setPhase('live');
        this.runAfterMake = false;
        this.inb = null;
      }
    }
    const wasShot = air && (air.kind === 'shot' || air.blockedShot);
    const shot = air ? air.shot || air.blockedShot : null;
    if (wasShot && shot && shot.kind !== 'ft' || (shot && shot.kind === 'ft' && air && air.kind === 'shot')) {
      const off = p.team === shot.team;
      if (off) { p.stats.oreb++; this.secondChance = { team: p.team, t: sim.t }; } else p.stats.dreb++;
      sim.emit('rebound', { player: p, offensive: off });
      sim.takeover.add(p, 'rebounding', off ? 9 : 5);
    }
    // Steals are credited only when the defence actually gains possession.
    const ps = sim.pendingSteal;
    if (ps && sim.t - ps.t < 3) {
      if (ps.player.team === p.team) {
        ps.player.stats.stl++;
        if (ps.from) { ps.from.stats.tov++; this.teamStats[ps.from.team].turnovers++; }
        sim.emit('steal', { player: ps.player, from: ps.from });
        sim.takeover.add(ps.player, 'defense', 12);
      }
      sim.pendingSteal = null;
    }
    if (this.phase === 'tipoff') this.setPhase('live');
    if (p.team !== this.possTeam || how === 'tip') {
      if (how === 'tip') {
        this.possTeam = p.team;
        this.shotClock = 24;
        this.shotClockOn = true;
        this.possStartT = sim.t;
        this.possStartHow = 'tip';
        this.frontcourt = false;
        this.backcourtT = 0;
        sim.emit('possession', { team: p.team, how });
      } else this.changePossession(p.team, how);
    } else if (this.rimTouched && !this.halfCourt) {
      this.shotClock = 14;
      this.shotClockOn = true;
    } else if (this.phase === 'live') {
      this.shotClockOn = true;
      // Backcourt: offence regains it in the backcourt after the ball reached the frontcourt.
      const s = hoopSign(this.attackHoop(p.team));
      if (!this.halfCourt && this.frontcourt && p.x * s < -0.25 && prevTeam === p.team && how === 'pass' && air && air.passer && air.passer.x * s > 0) {
        this.violation('backcourt', p.team, { x: p.x, z: p.z });
        return;
      }
    }
    if (this.halfCourt && how !== 'inbound' && how !== 'pass') {
      // Must clear beyond the arc after a change of possession.
      if (p.team !== this.clearTeam) this.needClear = true;
    }
    this.rimTouched = false;
    this.expiredWithShotUp = false;
    if (this.expiredCheck) this.expiredCheck = false;
    if (this.buzzerPending) {
      this.buzzerPending = false;
      this.endPeriod();
    }
  }

  changePossession(team, how) {
    const sim = this.sim;
    this.possTeam = team;
    this.shotClock = 24;
    this.shotClockOn = this.phase === 'live';
    this.frontcourt = false;
    this.backcourtT = 0;
    this.possStartT = sim.t;
    this.possStartHow = how;
    this.secondChance = null;
    this.clearTeam = null;
    if (this.halfCourt) this.needClear = how !== 'inbound';
    for (const p of sim.players) p.inLaneT = 0;
    sim.emit('possession', { team, how });
    // Offensive auto-switch to the ball handler.
    if (sim.user.team === team && sim.settings.autoSwitch) {
      const h = sim.holder();
      if (h && h.team === team && !h.inbounding) sim.setUserPlayer(h);
    }
  }

  onShotRelease(p, shot) {
    const sim = this.sim;
    // A shot attempt resets every three-second count.
    for (const q of sim.players) { q.inLaneT = 0; q.defLaneT = 0; }
    if (shot.kind === 'ft') {
      p.stats.fta++;
      if (this.ft) this.ft.inFlight = true;
    } else {
      p.stats.fga++;
      if (shot.three) p.stats.tpa++;
      if (this.halfCourt && this.needClear) {
        // Shooting before clearing the ball: violation (streetball rule).
        this.violation('did not clear', p.team, { x: p.x, z: p.z });
      }
    }
    if (this.pendingShootingFoul && this.pendingShootingFoul.shooter === p && !this.pendingShootingFoul.shot) {
      this.pendingShootingFoul.shot = shot;
      this.pendingShootingFoul.three = shot.three;
    }
    sim.takeover.onShot(p, shot);
  }

  onRimTouch(air) {
    if (!air || air.kind !== 'shot') return;
    this.rimTouched = true;
    this.shotClockOn = false;
    if (this.ft && air.shot && air.shot.kind === 'ft' && this.ft.n + 1 >= this.ft.total && this.phase === 'freethrow') {
      // Live ball on the last free throw once it hits the rim.
      this.ftLastLive = true;
    }
  }

  onBlock(blocker, shooter, shot) {
    blocker.stats.blk++;
    if (shot && shot.type === 'blocked') {
      shooter.stats.fga++;
      if (shot.three) shooter.stats.tpa++;
    }
    this.rimTouched = false;
  }

  onBasket(hoopIdx, air) {
    const sim = this.sim;
    const b = sim.ball;
    const shot = air.shot;
    let team = this.halfCourt || this.practice ? (shot ? shot.team : b.lastTouch ? b.lastTouch.team : this.possTeam) : (this.attackHoop(0) === hoopIdx ? 0 : 1);
    let pts = shot ? shot.pts : 2;
    if (this.halfCourt) {
      if (shot && shot.kind === 'ft') pts = 1;
      else pts = sim.settings.ones ? (shot && shot.three ? 2 : 1) : (shot && shot.three ? 3 : 2);
    }
    const scorer = shot && shot.team === team ? shot.shooter : b.lastTouch && b.lastTouch.team === team ? b.lastTouch : null;
    b.state = 'dead';
    b.owner = null;
    this.addPoints(team, pts, scorer, shot, air);
    if (this.practice) {
      this.phaseT = 0;
      return;
    }
    // Free throw sequence.
    if (shot && shot.kind === 'ft') {
      this.afterFreeThrow(true);
      return;
    }
    const pf = this.pendingShootingFoul;
    if (pf && pf.shooter === scorer) {
      this.awardShootingFouls(pf, true);
      return;
    }
    if (this.halfCourt) {
      if (this.checkHalfCourtWin()) return;
      const nextTeam = sim.settings.makeItTakeIt ? team : 1 - team;
      this.dead(0.9, () => this.setupCheck(nextTeam), null);
      return;
    }
    if (this.buzzerPending) {
      this.buzzerPending = false;
      this.endPeriod();
      return;
    }
    // Clock keeps running after a made basket except in the last 2 minutes of Q4/OT.
    this.runAfterMake = !this.isClutch();
    const other = 1 - team;
    const s = hoopSign(hoopIdx);
    this.dead(1.1, () => this.setupInbound(other, { x: s * (HALF_L + 0.35), z: sim.rng.range(-2.2, 2.2) }, 'made basket', { afterMake: true }), null, true);
  }

  addPoints(team, pts, scorer, shot, air) {
    const sim = this.sim;
    this.score[team] += pts;
    if (this.streak.team === team) this.streak.pts += pts;
    else this.streak = { team, pts };
    for (const p of sim.teams[team].onCourt) p.stats.pm += pts;
    for (const p of sim.teams[1 - team].onCourt) p.stats.pm -= pts;
    let assist = null;
    if (scorer) {
      scorer.stats.pts += pts;
      if (shot && shot.kind === 'ft') scorer.stats.ftm++;
      else {
        scorer.stats.fgm++;
        if (shot && shot.three) scorer.stats.tpm++;
        const passer = scorer.lastPasser;
        if (passer && passer.team === team && passer !== scorer && sim.t - scorer.lastPassT < 4.5 && scorer.dribblesSinceCatch <= 3) {
          passer.stats.ast++;
          assist = passer;
          sim.takeover.add(passer, 'playmaking', 10);
        }
        const ts = this.teamStats[team];
        if (shot && shot.paint) ts.paint += pts;
        if (['rebound', 'steal', 'interception', 'loose'].includes(this.possStartHow) && sim.t - this.possStartT < 7) ts.fastBreak += pts;
        if (this.secondChance && this.secondChance.team === team) ts.secondChance += pts;
      }
      if (shot && shot.kind !== 'ft') {
        const fin = shot.kind === 'layup' || shot.kind === 'dunk';
        sim.takeover.add(scorer, fin ? 'finishing' : 'shooting', shot.three || shot.kind === 'dunk' ? 14 : 9);
      }
      if (!scorer.starter) this.teamStats[team].bench += pts;
      scorer.lastPasser = null;
    }
    const event = { team, pts, scorer, assist, shot, three: shot && shot.three, kind: shot ? shot.kind : 'tip', grade: shot && shot.grade };
    this.log.push({ q: this.quarter, clock: this.clock, ...event, score: [...this.score] });
    sim.emit('score', event);
  }

  checkHalfCourtWin() {
    const sim = this.sim;
    const target = sim.settings.targetScore;
    for (let t = 0; t < 2; t++) {
      if (this.score[t] >= target && this.score[t] - this.score[1 - t] >= (sim.settings.winBy2 ? 2 : 1)) {
        this.dead(1.5, () => this.finish());
        return true;
      }
    }
    return false;
  }

  goaltend(defender, shot) {
    const sim = this.sim;
    sim.emit('whistle', { kind: 'goaltending' });
    sim.emit('violationCalled', { label: 'Goaltending', team: defender.team });
    const scorer = shot.shooter;
    sim.ball.state = 'dead';
    sim.ball.owner = null;
    this.addPoints(shot.team, shot.pts, scorer, shot, null);
    const other = 1 - shot.team;
    const s = hoopSign(shot.hoop);
    if (this.halfCourt) { this.dead(1.2, () => this.setupCheck(other)); return; }
    this.dead(1.4, () => this.setupInbound(other, { x: s * (HALF_L + 0.35), z: 1.5 }, 'goaltending', { afterMake: true }), 'Goaltending');
  }

  // ---------------------------------------------------------------------
  // Stoppages
  // ---------------------------------------------------------------------
  dead(dur, next, label = null, keepBall = false) {
    const sim = this.sim;
    const b = sim.ball;
    if (!keepBall && (b.state === 'held' || b.state === 'dribble')) {
      const owner = b.owner;
      if (owner) owner.inbounding = false;
      b.state = 'dead';
      b.owner = null;
      b.v.x = 0; b.v.y = 0; b.v.z = 0;
    } else if (!keepBall && b.state === 'air') {
      b.state = 'dead';
    }
    for (const p of sim.players) {
      if (p.action && !['fall', 'stumble'].includes(p.action.type) && !p.airborne) sim.endAction(p, true);
      p.queueShot = false;
    }
    this.whistle = label;
    this.deadDur = dur;
    this.next = next;
    this.setPhase('deadball');
    this.sim.ai.forEach((ai) => ai.coach.onDeadBall());
  }

  violation(type, team, spot, who = null) {
    const sim = this.sim;
    if (this.phase !== 'live' && this.phase !== 'inbound' && this.phase !== 'check') return;
    const holder = sim.holder();
    const culprit = who || (holder && holder.team === team ? holder : sim.ball.lastTouch && sim.ball.lastTouch.team === team ? sim.ball.lastTouch : null);
    if (culprit) culprit.stats.tov++;
    this.teamStats[team].turnovers++;
    sim.emit('whistle', { kind: 'violation' });
    sim.emit('violationCalled', { label: titleCase(type), team, player: culprit });
    sim.emit('turnover', { team, player: culprit, kind: type });
    this.pendingShootingFoul = null;
    const other = 1 - team;
    if (this.halfCourt) {
      this.dead(1.4, () => this.setupCheck(other), titleCase(type));
      return;
    }
    const ip = this.inboundSpot(spot, other, type === 'backcourt' || type === '8 seconds');
    this.dead(1.4, () => this.setupInbound(other, ip, type), titleCase(type));
  }

  outOfBounds(lastTeam, spot) {
    if (this.phase === 'freethrow') {
      this.afterFreeThrow(false);
      return;
    }
    const b = this.sim.ball;
    if (b.air && b.air.kind === 'shot' && b.air.shot && b.lastTouch === b.air.shot.shooter && this.phase === 'live') {
      // Missed shot out of bounds untouched: a team rebound for the defence, not a turnover.
      const team = 1 - b.air.shot.team;
      this.sim.emit('whistle', { kind: 'oob' });
      this.sim.emit('violationCalled', { label: 'Out Of Bounds', team: b.air.shot.team });
      if (this.halfCourt) { this.dead(1.2, () => this.setupCheck(team)); return; }
      this.dead(1.2, () => this.setupInbound(team, this.inboundSpot(spot, team), 'out of bounds'));
      return;
    }
    const last = lastTeam ?? this.possTeam;
    if (this.phase === 'live' && last !== this.possTeam && this.possTeam !== null) {
      // Defence touched it last (block, deflection, strip): offence keeps the ball, no turnover.
      const team = this.possTeam;
      this.sim.emit('whistle', { kind: 'oob' });
      this.sim.emit('violationCalled', { label: 'Out Of Bounds', team: last });
      this.pendingShootingFoul = null;
      if (this.halfCourt) { this.dead(1.2, () => this.setupCheck(team)); return; }
      const resetShot = Math.max(this.shotClock, 0);
      this.dead(1.2, () => this.setupInbound(team, this.inboundSpot(spot, team), 'out of bounds', { resetShot: resetShot < 1 ? 1 : resetShot }));
      return;
    }
    this.violation('out of bounds', last, spot);
    b.state = 'dead';
  }

  technical(player, label) {
    const sim = this.sim;
    sim.emit('whistle', { kind: 'foul' });
    sim.emit('foulCalled', { label: titleCase(label), player, kind: 'technical' });
    const other = 1 - player.team;
    const shooter = [...sim.teams[other].onCourt].sort((a, c) => c.rating('freeThrow') - a.rating('freeThrow'))[0];
    const poss = this.possTeam;
    this.dead(1.6, () => this.setupFreeThrows(shooter, 1, { thenInbound: poss, technical: true }), titleCase(label));
  }

  foul(fouler, victim, kind, act, label) {
    const sim = this.sim;
    if (this.phase !== 'live' && this.phase !== 'inbound') return;
    fouler.fouls++;
    fouler.stats.pf++;
    const team = sim.teams[fouler.team];
    if (kind !== 'offensive') {
      team.fouls++;
      if (this.isClutch() || this.clock <= 120) team.foulsLast2++;
    }
    sim.emit('whistle', { kind: 'foul' });
    sim.emit('foulCalled', { label: titleCase(label), player: fouler, victim, kind });
    if (fouler.fouls >= (this.halfCourt ? 99 : 6)) {
      this.forcedOut.push(fouler);
      sim.emit('foulOut', { player: fouler });
    }
    if (this.halfCourt) {
      // Streetball: no free throws, the fouled team checks it up.
      if (kind === 'shooting' && act) { this.pendingShootingFoul = { shooter: victim, fouler, t: sim.t, shot: null, streetball: true }; return; }
      this.dead(1.2, () => this.setupCheck(kind === 'offensive' ? fouler.team === 0 ? 1 : 0 : victim.team), titleCase(label));
      return;
    }
    if (kind === 'offensive') {
      fouler.stats.tov++;
      this.teamStats[fouler.team].turnovers++;
      sim.emit('turnover', { team: fouler.team, player: fouler, kind: 'offensive foul' });
      const other = 1 - fouler.team;
      this.dead(1.6, () => this.setupInbound(other, this.inboundSpot({ x: fouler.x, z: fouler.z }, other), 'offensive foul'), titleCase(label));
      return;
    }
    if (kind === 'shooting') {
      const shotInAir = sim.ball.state === 'air' && sim.ball.air && sim.ball.air.shot && sim.ball.air.shot.shooter === victim ? sim.ball.air.shot : null;
      this.pendingShootingFoul = { shooter: victim, fouler, t: sim.t, shot: shotInAir, three: shotInAir ? shotInAir.three : isThreePoint(victim.x, victim.z, this.attackHoop(victim.team)) };
      return;
    }
    // Personal foul away from the shot: penalty free throws or a side inbound.
    const inPenalty = team.fouls >= 5 || (this.clock <= 120 && team.foulsLast2 >= 2);
    if (inPenalty) {
      this.dead(1.6, () => this.setupFreeThrows(victim, 2, {}), titleCase(label));
    } else {
      const spot = this.inboundSpot({ x: victim.x, z: victim.z }, victim.team, false, true);
      const resetShot = Math.max(14, this.shotClock);
      this.dead(1.6, () => this.setupInbound(victim.team, spot, 'foul', { resetShot }), titleCase(label));
    }
  }

  awardShootingFouls(pf, made) {
    this.pendingShootingFoul = null;
    if (pf.streetball) {
      this.dead(1.2, () => this.setupCheck(pf.shooter.team), 'Foul');
      return;
    }
    const n = made ? 1 : pf.three ? 3 : 2;
    if (made) this.sim.emit('andOne', { player: pf.shooter });
    this.dead(made ? 1.4 : 1.6, () => this.setupFreeThrows(pf.shooter, n, {}), made ? 'And One' : 'Shooting Foul');
    if (!made) {
      // The missed attempt does not count as a field goal attempt.
      const s = pf.shooter.stats;
      if (pf.shot && pf.shot.kind !== 'ft' && s.fga > 0) { s.fga--; if (pf.three && s.tpa > 0) s.tpa--; }
      else if (!pf.shot && s.fga > 0) { /* shot never released */ }
    }
  }

  inboundSpot(spot, team, backcourt = false, sideline = false) {
    const s = hoopSign(this.attackHoop(team));
    let x = clamp(spot.x, -HALF_L + 1, HALF_L - 1);
    let z = spot.z;
    if (!sideline && Math.abs(spot.x) > HALF_L - 0.5) {
      return { x: Math.sign(spot.x) * (HALF_L + 0.35), z: clamp(z, -5, 5) };
    }
    if (backcourt) x = -s * Math.max(2, Math.abs(x));
    return { x, z: (z >= 0 ? 1 : -1) * (HALF_W + 0.35) };
  }

  // ---------------------------------------------------------------------
  // Inbounds
  // ---------------------------------------------------------------------
  setupInbound(team, spot, reason, opts = {}) {
    const sim = this.sim;
    this.inb = { team, spot, reason, inbounder: null, t: 0, ready: false, heldT: 0, afterMake: !!opts.afterMake, resetShot: opts.resetShot || null };
    const b = sim.ball;
    if (b.state !== 'dead') { b.state = 'dead'; b.owner = null; }
    if (this.possTeam !== team) {
      this.changePossession(team, 'inbound');
      this.shotClockOn = false;
    } else if (!opts.resetShot && reason !== 'foul' && reason !== 'timeout') {
      this.shotClock = reason === 'period' ? 24 : this.shotClock;
    }
    if (opts.afterMake) this.shotClock = 24;
    this.shotClockOn = false;
    // Frontcourt status restarts from the inbound spot.
    const sgn = hoopSign(this.attackHoop(team));
    this.frontcourt = spot.x * sgn > 0.6 && Math.abs(spot.x) < HALF_L;
    this.backcourtT = 0;
    this.processSubs(false);
    // Pick the inbounder: a big after made baskets, else the nearest player. Avoid the user.
    const cands = sim.teams[team].onCourt.filter((p) => !sim.isUser(p) || sim.teams[team].onCourt.length === 1);
    let inbounder;
    if (opts.afterMake) inbounder = cands.find((p) => p.pos === 'C' || p.pos === 'PF') || cands[cands.length - 1];
    else inbounder = cands.sort((a, c) => Math.hypot(a.x - spot.x, a.z - spot.z) - Math.hypot(c.x - spot.x, c.z - spot.z))[0];
    this.inb.inbounder = inbounder;
    this.setPhase('inbound');
  }

  setupCheck(team) {
    // Streetball "check ball" at the top of the key.
    const sim = this.sim;
    const h = hoopPos(1);
    this.inb = { team, spot: { x: h.x - 9.8, z: 0 }, reason: 'check', inbounder: null, t: 0, ready: false, heldT: 0, check: true };
    if (this.possTeam !== team) this.changePossession(team, 'inbound');
    this.needClear = false;
    this.clearTeam = team;
    const cands = sim.teams[team].onCourt;
    const user = cands.find((p) => sim.isUser(p));
    this.inb.inbounder = user || cands[0];
    const b = sim.ball;
    b.state = 'dead'; b.owner = null;
    this.setPhase('check');
  }

  updateInbound(dt) {
    const sim = this.sim;
    const inb = this.inb;
    if (!inb) return;
    inb.t += dt;
    const p = inb.inbounder;
    const b = sim.ball;
    if (!p.onCourt) inb.inbounder = sim.teams[inb.team].onCourt[0];
    if (!inb.ready) {
      const d = Math.hypot(p.x - inb.spot.x, p.z - inb.spot.z);
      if (d < 0.6 || inb.t > 3.2) {
        inb.ready = true;
        p.setPos(inb.spot.x, inb.spot.z, Math.atan2(-inb.spot.z, -inb.spot.x * 0.4));
        if (inb.check) {
          // Check ball: the ball handler starts live play at the top.
          sim.giveBall(p, 'inbound-hand');
          p.inbounding = false;
          this.setPhase('live');
          this.shotClock = 24;
          this.shotClockOn = true;
          this.needClear = false;
          this.inb = null;
          if (sim.user.team === p.team && sim.settings.autoSwitch) sim.setUserPlayer(p);
          return;
        }
        sim.giveBall(p, 'inbound-hand');
        p.inbounding = true;
        p.tripleThreat = false;
        p.pickedUp = true;
      } else if (inb.t > 0.6 && b.state === 'dead' && b.p.y < 0.3) {
        // Ball rolls to the inbounder; keep it near the spot.
      }
      return;
    }
    if (b.owner === p && p.inbounding) {
      inb.heldT += dt;
      if (inb.heldT > 5) {
        p.inbounding = false;
        this.violation('5 seconds', p.team, inb.spot);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Free throws
  // ---------------------------------------------------------------------
  setupFreeThrows(shooter, total, opts) {
    const sim = this.sim;
    if (!shooter.onCourt) shooter = sim.teams[shooter.team].onCourt[0];
    const hoop = this.attackHoop(shooter.team);
    const s = hoopSign(hoop);
    const ftX = s * (HALF_L - FT_LINE_FROM_BASELINE - 0.25);
    this.ft = { shooter, total, n: 0, made: 0, hoop, t: 0, inFlight: false, waiting: true, opts };
    this.ftLastLive = false;
    shooter.setPos(ftX, 0, s > 0 ? 0 : Math.PI);
    // Lane spaces: defence gets the spots nearest the basket.
    const laneZ = LANE_W / 2 + 0.45;
    const laneX = [HALF_L - 2.3, HALF_L - 3.4, HALF_L - 4.4];
    const def = sim.teams[1 - shooter.team].onCourt;
    const off = sim.teams[shooter.team].onCourt.filter((p) => p !== shooter);
    const spots = [
      [laneX[0], -laneZ, 1], [laneX[0], laneZ, 1], [laneX[1], -laneZ, 0], [laneX[1], laneZ, 0], [laneX[2], -laneZ, 1],
    ];
    def.forEach((p, i) => {
      if (i < 3) {
        const sp = spots[[0, 1, 4][i]];
        p.setPos(s * sp[0], sp[1], s > 0 ? Math.PI / 2 * (sp[1] > 0 ? -1 : 1) : Math.PI / 2 * (sp[1] > 0 ? -1 : 1));
      } else p.setPos(s * (HALF_L - 9.3), (i === 3 ? -1 : 1) * 3.5, s > 0 ? 0 : Math.PI);
    });
    off.forEach((p, i) => {
      if (i < 2) {
        const sp = spots[2 + i];
        p.setPos(s * sp[0], sp[1], s > 0 ? Math.PI / 2 * (sp[1] > 0 ? -1 : 1) : Math.PI / 2 * (sp[1] > 0 ? -1 : 1));
      } else p.setPos(s * (HALF_L - 10.2), (i - 2.5) * 4, s > 0 ? 0 : Math.PI);
    });
    for (const p of sim.players) {
      p.facing = Math.atan2(-p.z, s * (HALF_L - 1.6) - p.x);
      if (p === shooter) p.facing = s > 0 ? 0 : Math.PI;
    }
    sim.giveBall(shooter, 'inbound-hand');
    shooter.pickedUp = false;
    shooter.tripleThreat = false;
    this.runAfterMake = false;
    this.setPhase('freethrow');
    if (sim.user.team === shooter.team && sim.settings.userFreeThrows !== false) sim.setUserPlayer(shooter);
    sim.emit('freeThrows', { shooter, total });
  }

  updateFreeThrow(dt) {
    const sim = this.sim;
    const ft = this.ft;
    if (!ft) return;
    ft.t += dt;
    const b = sim.ball;
    const p = ft.shooter;
    // Everyone else holds their lane spot.
    for (const q of sim.players) {
      if (q === p || this.ftLastLive) continue;
      q.intent.mx = 0; q.intent.mz = 0;
      q.vx = 0; q.vz = 0;
    }
    if (ft.waiting) {
      if (b.owner !== p) {
        if (ft.t > 0.3) {
          const s = hoopSign(ft.hoop);
          p.setPos(s * (HALF_L - FT_LINE_FROM_BASELINE - 0.25), 0, s > 0 ? 0 : Math.PI);
          sim.giveBall(p, 'inbound-hand');
          p.pickedUp = false;
        }
        return;
      }
      if (!sim.isUser(p) && ft.t > 1.3 && !p.action) {
        ft.waiting = false;
        sim.attemptShot(p, {});
      }
      if (sim.isUser(p) && p.action && p.action.type === 'shot') ft.waiting = false;
      return;
    }
    if (ft.inFlight && b.state === 'air' && b.air && b.air.kind === 'shot') {
      const last = ft.n + 1 >= ft.total;
      if (last && b.air.touchedRim && !this.ftLastLive) this.ftLastLive = true;
      if (last && this.ftLastLive && b.p.y < RIM_H - 0.3) {
        // Live rebound.
        ft.n++;
        this.ft = null;
        this.setPhase('live');
        this.shotClockOn = false;
        this.rimTouched = true;
        sim.emit('ftResult', { made: false });
        return;
      }
      if (b.air.t > 2.2 || (b.p.y < 1.0 && !last)) {
        this.afterFreeThrow(false);
      }
    }
  }

  afterFreeThrow(made) {
    const sim = this.sim;
    const ft = this.ft;
    if (!ft) return;
    ft.n++;
    if (made) ft.made++;
    sim.emit('ftResult', { made });
    sim.ball.state = 'dead';
    sim.ball.owner = null;
    if (ft.n < ft.total) {
      ft.waiting = true;
      ft.inFlight = false;
      ft.t = -0.6;
      return;
    }
    this.ft = null;
    if (ft.opts.technical) {
      const team = ft.opts.thenInbound ?? 1 - ft.shooter.team;
      this.dead(0.8, () => this.setupInbound(team, { x: 0, z: HALF_W + 0.35 }, 'technical'));
      return;
    }
    // Last free throw: made (or an air ball) -> the other team inbounds.
    const other = 1 - ft.shooter.team;
    const s = hoopSign(ft.hoop);
    if (!made && !this.ftLastLive) {
      this.setPhase('live');
      this.violation('free throw violation', ft.shooter.team, { x: s * HALF_L, z: 0 });
      return;
    }
    this.phase = 'live';
    this.dead(0.9, () => this.setupInbound(other, { x: s * (HALF_L + 0.35), z: 1.8 }, 'free throw', { afterMake: true }));
  }

  // ---------------------------------------------------------------------
  // Timeouts and substitutions
  // ---------------------------------------------------------------------
  canCallTimeout(team) {
    const sim = this.sim;
    if (this.halfCourt || this.practice) return false;
    if (sim.teams[team].timeouts <= 0) return false;
    if (this.phase === 'deadball' || this.phase === 'inbound') return true;
    if (this.phase === 'live') {
      const h = sim.holder();
      return h && h.team === team;
    }
    return false;
  }

  requestTimeout(team) {
    const sim = this.sim;
    if (!this.canCallTimeout(team)) return false;
    sim.teams[team].timeouts--;
    this.teamStats[team].timeoutsUsed++;
    const h = sim.holder();
    const spot = h ? { x: h.x, z: h.z } : { x: sim.ball.p.x, z: sim.ball.p.z };
    this.timeoutResume = { team: this.possTeam ?? team, spot };
    if (this.inb) this.timeoutResume.spot = this.inb.spot;
    const b = sim.ball;
    b.state = 'dead'; b.owner = null;
    for (const p of sim.players) {
      p.stamina = Math.min(1, p.stamina + 0.15);
      p.inbounding = false;
      if (p.action) sim.endAction(p, true);
    }
    this.runAfterMake = false;
    this.inb = null;
    this.next = null;
    sim.emit('timeout', { team });
    this.setPhase('timeout');
    return true;
  }

  resumeFromTimeout() {
    if (this.phase !== 'timeout') return;
    const r = this.timeoutResume || { team: this.possTeam ?? 0, spot: { x: 0, z: 0 } };
    this.processSubs(false);
    const resetShot = this.shotClock;
    this.setupInbound(r.team, this.inboundSpot(r.spot, r.team, false, true), 'timeout', { resetShot });
  }

  requestSub(team, outP, inP) {
    this.subQueue[team].push({ outP, inP });
  }

  /** Swap players at a dead ball: forced (foul-outs), user requests, then coach decisions. */
  processSubs(periodStart) {
    const sim = this.sim;
    for (const fo of this.forcedOut) {
      if (!fo.onCourt) continue;
      const team = sim.teams[fo.team];
      const bench = team.roster.filter((p) => !p.onCourt && p.fouls < 6);
      if (!bench.length) continue;
      const inP = bench.find((p) => p.pos === fo.pos) || bench[0];
      this.swap(team, fo, inP);
    }
    this.forcedOut = this.forcedOut.filter((p) => p.onCourt);
    for (let t = 0; t < 2; t++) {
      const q = this.subQueue[t];
      while (q.length) {
        const { outP, inP } = q.shift();
        if (outP.onCourt && !inP.onCourt && inP.fouls < 6) this.swap(sim.teams[t], outP, inP);
      }
      const auto = t !== sim.user.team || sim.settings.autoSubs !== false;
      if (auto && !this.halfCourt && !this.practice) sim.ai[t].coach.substitutions(periodStart);
    }
  }

  swap(team, outP, inP) {
    const sim = this.sim;
    const idx = team.onCourt.indexOf(outP);
    if (idx < 0) return;
    team.onCourt[idx] = inP;
    outP.onCourt = false;
    inP.onCourt = true;
    inP.slot = outP.slot;
    inP.subT = sim.t;
    outP.subT = sim.t;
    inP.setPos(outP.x, outP.z, outP.facing);
    inP.action = null;
    inP.inbounding = false;
    if (this.inb && this.inb.inbounder === outP) this.inb.inbounder = inP;
    if (sim.ball.owner === outP) { sim.ball.owner = inP; }
    if (sim.isUser(outP)) sim.setUserPlayer(inP);
    sim.emit('substitution', { team: team.idx, out: outP, in: inP });
  }
}

function titleCase(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
