// Team AI: one instance per team. Handles offensive spacing, play execution
// (pick-and-roll, isolation, post-ups, motion cuts, transition), ball-handler
// decisions via utility scoring, man/zone defence with help and rotations,
// contests, steals, box-outs and rebounding. CPU-controlled teammates of the
// user use the same logic, only without the difficulty modifiers.
import { clamp, lerp } from '../../core/math.js';
import {
  HALF_L, HALF_W, RIM_H, hoopPos, hoopSign, distToHoop, isThreePoint, inPaint, THREE_R, LANE_W,
} from '../constants.js';
import { evaluateContest, baseMakeProbability, shotRatingKey } from '../Shooting.js';
import { Coach } from './Coach.js';

const HOOP_U = 1.6;
export const SLOTS = {
  TOP: [9.6, 0], LW: [6.6, -6.0], RW: [6.6, 6.0], LC: [1.25, -6.85], RC: [1.25, 6.85],
  LB: [2.5, -2.95], RB: [2.5, 2.95], LE: [5.9, -2.7], RE: [5.9, 2.7], LS: [8.9, -3.4], RS: [8.9, 3.4],
  DL: [1.2, -3.5], DR: [1.2, 3.5],
};
export const FORMATIONS = {
  fiveOut: ['TOP', 'LW', 'RW', 'LC', 'RC'],
  fourOut: ['TOP', 'LW', 'RW', 'RC', 'LB'],
  horns: ['TOP', 'LE', 'RE', 'LC', 'RC'],
  spread: ['TOP', 'LS', 'RS', 'LC', 'RC'],
  threeOut: ['TOP', 'LW', 'RW'],
  twoOut: ['TOP', 'RW'],
};

export class TeamAI {
  constructor(sim, team) {
    this.sim = sim;
    this.team = team;
    this.coach = new Coach(this);
    this.assign = new Map(); // defender -> offensive player
    this.offSlots = new Map();
    this.play = null;
    this.lastPossTeam = null;
    this.lastPhase = null;
    for (const p of sim.teams[team].roster) {
      p.ai = { nextThink: 0, target: null, mode: 'idle', screening: false, expectPass: -10, alleyOop: null, cutUntil: 0, lastDecision: 0, plan: null, closeT: 0 };
    }
  }

  get players() { return this.sim.teams[this.team].onCourt; }
  get opp() { return this.sim.teams[1 - this.team].onCourt; }
  get isCpu() { return this.team !== this.sim.user.team; }

  reaction() {
    const base = this.isCpu ? this.sim.diff.cpuReact : 0.3;
    return base * (0.8 + 0.4 * this.sim.rng.next());
  }

  toWorld(hoop, u, v) {
    const s = hoopSign(hoop);
    return { x: s * (HALF_L - u), z: v };
  }

  toLocal(hoop, x, z) {
    const s = hoopSign(hoop);
    return { u: HALF_L - x * s, v: z };
  }

  /** A teammate the ball can legally be passed to (in bounds, not inbounding). */
  inPlay(q) {
    return !q.inbounding && Math.abs(q.x) < HALF_L - 0.3 && Math.abs(q.z) < HALF_W - 0.3;
  }

  opennessOf(m) {
    let best = 9;
    for (const d of this.sim.teams[1 - m.team].onCourt) best = Math.min(best, d.distTo(m));
    return clamp(best / 4, 0, 1);
  }

  onBallDefender() {
    const h = this.sim.holder();
    if (!h) return null;
    for (const [d, o] of this.assign) if (o === h && d.onCourt) return d;
    let best = null, bd = 9;
    for (const d of this.players) { const dd = d.distTo(h); if (dd < bd) { bd = dd; best = d; } }
    return best;
  }

  // ---------------------------------------------------------------------
  update(dt) {
    const sim = this.sim;
    const m = sim.match;
    const phase = m.phase;
    if (m.possTeam !== this.lastPossTeam) {
      this.lastPossTeam = m.possTeam;
      this.onPossessionChange();
    }
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      if (phase === 'live' || phase === 'inbound') this.assignMatchups();
    }
    for (const p of this.players) {
      if (sim.isUser(p)) continue;
      if (p.action && p.action.lock) continue;
      const it = p.intent;
      it.walk = false; it.stance = false; it.handsUp = false; it.faceX = null; it.faceZ = null; it.sprint = false;
      if (p.ai.screening && sim.t > p.ai.screenUntil) p.ai.screening = false;
      if (phase === 'live' && this.avoidLaneViolations(p)) continue;
      switch (phase) {
        case 'tipoff':
          it.mx = 0; it.mz = 0; it.faceX = 0; it.faceZ = 0;
          break;
        case 'deadball':
          this.deadBallMove(p);
          break;
        case 'inbound':
        case 'check':
          this.inboundMove(p, dt);
          break;
        case 'freethrow':
          it.mx = 0; it.mz = 0;
          break;
        case 'live':
          this.liveMove(p, dt);
          break;
        default:
          it.mx = 0; it.mz = 0;
      }
    }
  }

  /** Step out of the lane before a three-second violation (offence or defence). */
  avoidLaneViolations(p) {
    const m = this.sim.match;
    const offense = m.possTeam === this.team;
    const t = offense ? p.inLaneT : p.defLaneT || 0;
    if (t < 2.0 || this.sim.ball.owner === p) return false;
    const hoop = offense ? m.attackHoop(this.team) : m.defendHoop(this.team);
    if (!inPaint(p.x, p.z, hoop)) return false;
    const side = p.z >= 0 ? 1 : -1;
    const tgt = this.toWorld(hoop, 2.4, side * 3.4);
    this.moveTo(p, tgt.x, tgt.z, 'sprint', 0.2);
    return true;
  }

  onPossessionChange() {
    const m = this.sim.match;
    if (m.possTeam === this.team) {
      this.play = this.coach.callPlay();
      this.assignSlots();
    }
    this.assignMatchups();
    for (const p of this.players) { p.ai.screening = false; p.ai.cutUntil = 0; p.ai.plan = null; p.posting = false; }
  }

  assignSlots() {
    const n = this.players.length;
    const form = this.play && this.play.formation ? this.play.formation : n === 5 ? 'fiveOut' : n === 3 ? 'threeOut' : 'twoOut';
    const slots = FORMATIONS[form] || FORMATIONS.fiveOut;
    const order = [...this.players].sort((a, b) => a.slot - b.slot);
    this.offSlots.clear();
    // PG at the top; bigs that can't shoot take inside slots; shooters to corners/wings.
    const remaining = [...slots];
    const take = (p, pref) => {
      for (const s of pref) {
        const i = remaining.indexOf(s);
        if (i >= 0) { remaining.splice(i, 1); this.offSlots.set(p, s); return; }
      }
      this.offSlots.set(p, remaining.shift() || 'TOP');
    };
    const pg = order.find((p) => p.pos === 'PG') || order[0];
    take(pg, ['TOP']);
    for (const p of order) {
      if (p === pg) continue;
      const big = p.pos === 'C' || p.pos === 'PF';
      const shooter = p.rating('threeShot') >= 74;
      if (big && !shooter) take(p, ['LB', 'RB', 'LE', 'RE', 'DL', 'DR', 'LC', 'RC', 'LW', 'RW', 'LS', 'RS']);
      else if (shooter) take(p, ['LC', 'RC', 'LW', 'RW', 'LS', 'RS', 'LE', 'RE', 'LB', 'RB']);
      else take(p, ['LW', 'RW', 'LS', 'RS', 'LC', 'RC', 'LE', 'RE', 'LB', 'RB']);
    }
  }

  /** Man-to-man matchups: position for position, then nearest-available fallback. */
  assignMatchups() {
    this.assign.clear();
    const defs = [...this.players];
    const offs = [...this.opp];
    const used = new Set();
    for (const d of defs) {
      let o = offs.find((q) => q.pos === d.pos && !used.has(q));
      if (!o) {
        let best = null, bd = 1e9;
        for (const q of offs) if (!used.has(q)) { const dd = Math.abs(q.heightM - d.heightM) * 10 + d.distTo(q) * 0.1; if (dd < bd) { bd = dd; best = q; } }
        o = best;
      }
      if (o) { used.add(o); this.assign.set(d, o); }
    }
  }

  manOf(d) {
    const o = this.assign.get(d);
    if (o && o.onCourt) return o;
    this.assignMatchups();
    return this.assign.get(d) || this.opp[0];
  }

  moveTo(p, x, z, mode = 'jog', arrive = 0.35) {
    const it = p.intent;
    if (this.sim.match.phase === 'live' || this.sim.ball.owner === p) {
      // Stay in bounds during live play (the ball handler keeps a bigger margin).
      const mg = this.sim.ball.owner === p ? 0.9 : 0.4;
      x = clamp(x, -HALF_L + mg, HALF_L - mg);
      z = clamp(z, -HALF_W + mg, HALF_W - mg);
      // Once the ball has crossed half court, don't bring it back.
      const m = this.sim.match;
      if (this.sim.ball.owner === p && m.frontcourt && !m.halfCourt) {
        const s = hoopSign(m.attackHoop(p.team));
        if (x * s < 1.5) x = s * 1.5;
      }
    }
    const dx = x - p.x, dz = z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < arrive) { it.mx = 0; it.mz = 0; return d; }
    // Brake in time to arrive (no overshooting spots or running out of bounds).
    const vmax = mode === 'sprint' ? p.sprintMax() : mode === 'walk' ? 1.6 : p.jogMax();
    const k = clamp(Math.min(d / 0.8, Math.sqrt(2 * 7 * d) / vmax), 0.2, 1);
    it.mx = (dx / d) * k; it.mz = (dz / d) * k;
    it.sprint = mode === 'sprint' && d > 1.5;
    it.walk = mode === 'walk';
    return d;
  }

  // ---------------------------------------------------------------------
  // Dead balls and inbounds
  // ---------------------------------------------------------------------
  deadBallMove(p) {
    const it = p.intent;
    // Drift toward your end of the floor at a walk.
    const m = this.sim.match;
    const offense = m.possTeam === this.team;
    const hoop = offense ? m.attackHoop(this.team) : m.defendHoop(this.team);
    const slot = offense ? (SLOTS[this.offSlots.get(p) || 'TOP']) : null;
    if (slot) {
      const w = this.toWorld(hoop, slot[0] + 6, slot[1] * 0.7);
      this.moveTo(p, w.x, w.z, 'walk', 1.5);
    } else {
      const o = this.manOf(p);
      const h = hoopPos(hoop);
      this.moveTo(p, lerp(o.x, h.x, 0.4), lerp(o.z, h.z, 0.4), 'walk', 1.5);
    }
    const b = this.sim.ball;
    it.faceX = b.p.x; it.faceZ = b.p.z;
  }

  inboundMove(p, dt) {
    const sim = this.sim;
    const inb = sim.match.inb;
    if (!inb) return;
    const it = p.intent;
    const offense = inb.team === this.team;
    const b = sim.ball;
    if (b.state === 'air' && b.air && b.air.kind === 'pass' && b.air.target === p) { this.receivePass(p); return; }
    if (p === inb.inbounder) {
      if (!inb.ready) { this.moveTo(p, inb.spot.x, inb.spot.z, 'sprint', 0.3); return; }
      it.mx = 0; it.mz = 0;
      if (sim.ball.owner === p && p.inbounding && !p.action) {
        const wait = this.isCpu ? 0.9 : 0.6;
        if (inb.heldT > wait) {
          const target = this.bestInboundReceiver(p);
          if (target && (this.laneSafety(p, target) > 0.45 || inb.heldT > 3.5)) sim.attemptPass(p, 'chest', target, { inbound: true });
        }
      }
      return;
    }
    if (offense) {
      // Get open for the inbound: the point guard flashes toward the ball.
      const s = inb.spot;
      const into = { x: clamp(s.x, -HALF_L + 2, HALF_L - 2), z: clamp(s.z, -HALF_W + 2, HALF_W + -2) };
      const idx = this.players.filter((q) => q !== inb.inbounder).indexOf(p);
      const hoop = sim.match.attackHoop(this.team);
      const sgn = hoopSign(hoop);
      let tx, tz;
      if (inb.check) {
        const slot = SLOTS[this.offSlots.get(p) || 'LW'];
        const w = this.toWorld(hoop, slot[0], slot[1]);
        tx = w.x; tz = w.z;
      } else if (idx === 0) {
        const away = Math.sign(s.x) === sgn && Math.abs(s.x) > HALF_L - 1 ? 1 : 0;
        tx = into.x - Math.sign(s.x || 1) * (away ? 0 : 3.5) * (Math.abs(s.x) > HALF_L - 1 ? 1 : 0);
        tz = into.z * 0.6 + (Math.abs(s.x) > HALF_L - 1 ? (s.z > 0 ? -2.5 : 2.5) : -Math.sign(s.z) * 3.2);
        const t = sim.t;
        tz += Math.sin(t * 2.2 + p.slot) * 1.2;
      } else {
        const slot = SLOTS[this.offSlots.get(p) || 'LW'];
        const near = Math.abs(s.x) > HALF_L - 1 && Math.sign(s.x) === -sgn;
        const w = this.toWorld(hoop, near ? slot[0] + 10 + idx * 2 : slot[0], slot[1]);
        tx = w.x; tz = w.z;
      }
      this.moveTo(p, tx, tz, 'jog', 0.5);
      it.faceX = inb.spot.x; it.faceZ = inb.spot.z;
    } else {
      // Defence: pick up your man, sagging toward your basket (no full-court press).
      const o = this.manOf(p);
      const hoop = sim.match.defendHoop(this.team);
      const h = hoopPos(hoop);
      const s = hoopSign(hoop);
      let tx = lerp(o.x, h.x, 0.25), tz = lerp(o.z, h.z, 0.25);
      if (tx * s < -2 && !inb.check) tx = -2 * s + (o.x * s < -2 ? 0 : 0);
      if (tx * s < -1) tx = s * Math.max(Math.abs(tx), 1) * (tx * s < 0 ? -1 : 1);
      this.moveTo(p, tx, tz, 'jog', 0.4);
      it.faceX = o.x; it.faceZ = o.z;
    }
  }

  bestInboundReceiver(p) {
    let best = null, bs = -1e9;
    for (const m of this.players) {
      if (m === p) continue;
      if (Math.abs(m.x) > HALF_L - 0.3 || Math.abs(m.z) > HALF_W - 0.3) continue;
      const d = m.distTo(p);
      const s = this.opennessOf(m) * 3 - Math.abs(d - 5) * 0.2 + (m.pos === 'PG' ? 0.8 : 0) + m.r('ballHandle');
      if (s > bs) { bs = s; best = m; }
    }
    return best;
  }

  // ---------------------------------------------------------------------
  // Live play
  // ---------------------------------------------------------------------
  liveMove(p, dt) {
    const sim = this.sim;
    const b = sim.ball;
    const m = sim.match;
    const holder = sim.holder();
    const air = b.state === 'air' ? b.air : null;
    // Pass in flight to this player: go get it.
    if (air && air.kind === 'pass' && air.target === p) {
      this.receivePass(p);
      return;
    }
    if (air && (air.kind === 'loose' || air.kind === 'tip' || (air.kind === 'shot' && (air.touchedRim || air.touchedBoard || air.t > 0.9)))) {
      this.reboundMove(p, air);
      return;
    }
    if (air && air.kind === 'shot') {
      this.shotInAirMove(p, air);
      return;
    }
    const offense = (holder && holder.team === this.team) || (air && air.kind === 'pass' && air.passer && air.passer.team === this.team);
    if (offense) {
      if (holder === p) this.ballHandler(p, dt);
      else this.offBall(p, dt);
    } else if (holder || (air && air.kind === 'pass')) {
      this.defend(p, dt);
    } else {
      this.reboundMove(p, air || { kind: 'loose' });
    }
  }

  receivePass(p) {
    const b = this.sim.ball;
    const it = p.intent;
    // Meet the ball: move toward where the ball will be in ~0.25 s.
    const tx = clamp(b.p.x + b.v.x * 0.2, -HALF_L + 0.4, HALF_L - 0.4), tz = clamp(b.p.z + b.v.z * 0.2, -HALF_W + 0.4, HALF_W - 0.4);
    const d = Math.hypot(tx - p.x, tz - p.z);
    if (d > 0.6) this.moveTo(p, tx, tz, d > 3 ? 'sprint' : 'jog', 0.3);
    else { it.mx = 0; it.mz = 0; }
    it.faceX = b.p.x; it.faceZ = b.p.z;
  }

  predictLanding() {
    // Simulate the ball forward (no players) until it comes down to grabbing height.
    const b = this.sim.ball;
    let px = b.p.x, py = b.p.y, pz = b.p.z, vx = b.v.x, vy = b.v.y, vz = b.v.z;
    const h = 1 / 60;
    for (let i = 0; i < 150; i++) {
      vy -= 9.81 * h;
      px += vx * h; py += vy * h; pz += vz * h;
      if (vy < 0 && py < 2.4) break;
    }
    return { x: px, z: pz };
  }

  reboundMove(p, air) {
    const sim = this.sim;
    const b = sim.ball;
    const it = p.intent;
    const land = this.predictLanding();
    // The two closest teammates chase the ball; others box out or get back.
    const mates = [...this.players].sort((a, c) => Math.hypot(a.x - land.x, a.z - land.z) - Math.hypot(c.x - land.x, c.z - land.z));
    const rank = mates.indexOf(p);
    const d = Math.hypot(p.x - land.x, p.z - land.z);
    if (rank <= 1 || d < 3) {
      this.moveTo(p, land.x, land.z, 'sprint', 0.15);
      it.faceX = b.p.x; it.faceZ = b.p.z;
      const hd = Math.hypot(b.p.x - p.x, b.p.z - p.z);
      if (hd < 1.4 && b.v.y < 0 && b.p.y < p.reachNow() + p.maxVertical + 0.1 && b.p.y > p.reachNow() - 0.1 && !p.airborne) {
        sim.attemptBlock(p, 'rebound');
      }
    } else {
      const m = sim.match;
      const defending = m.possTeam !== this.team;
      const hoop = defending ? m.defendHoop(this.team) : m.attackHoop(this.team);
      const h = hoopPos(hoop);
      if (defending) {
        const o = this.manOf(p);
        const bx = o.x + (h.x - o.x) * 0.25, bz = o.z + (h.z - o.z) * 0.25;
        this.moveTo(p, bx, bz, 'jog', 0.2);
        it.faceX = h.x; it.faceZ = h.z;
      } else {
        // Guards retreat for transition defence.
        const back = this.toWorld(m.defendHoop(this.team), 9, p.slot % 2 ? -3 : 3);
        this.moveTo(p, back.x, back.z, 'jog', 0.5);
      }
    }
  }

  shotInAirMove(p, air) {
    const sim = this.sim;
    const m = sim.match;
    const it = p.intent;
    const shot = air.shot;
    const offense = shot && shot.team === this.team;
    const hoop = shot ? shot.hoop : m.attackHoop(this.team);
    const h = hoopPos(hoop);
    if (offense) {
      const big = p.pos === 'C' || p.pos === 'PF' || p.r('offReb') > 0.6;
      if (big) {
        const a = Math.atan2(p.z - h.z, p.x - h.x);
        this.moveTo(p, h.x + Math.cos(a) * 1.6, h.z + Math.sin(a) * 1.6, 'sprint', 0.2);
      } else {
        const back = this.toWorld(m.defendHoop(this.team), 10, p.slot % 2 ? -4 : 4);
        this.moveTo(p, back.x, back.z, 'jog', 0.5);
      }
      it.faceX = h.x; it.faceZ = h.z;
      return;
    }
    // Defence: contest late if close, then box out your man.
    const o = this.manOf(p);
    const tx = o.x + (h.x - o.x) / (Math.hypot(h.x - o.x, h.z - o.z) || 1) * 0.55;
    const tz = o.z + (h.z - o.z) / (Math.hypot(h.x - o.x, h.z - o.z) || 1) * 0.55;
    this.moveTo(p, tx, tz, 'jog', 0.1);
    it.faceX = o.x; it.faceZ = o.z;
    it.stance = true;
  }

  // ---------------------------------------------------------------------
  // Offence
  // ---------------------------------------------------------------------
  slotPos(p, hoop) {
    const name = this.offSlots.get(p) || 'TOP';
    const s = SLOTS[name];
    return this.toWorld(hoop, s[0], s[1]);
  }

  offBall(p, dt) {
    const sim = this.sim;
    const m = sim.match;
    const it = p.intent;
    const hoop = m.attackHoop(this.team);
    const h = hoopPos(hoop);
    const holder = sim.holder();
    const s = hoopSign(hoop);
    const ballX = holder ? holder.x : sim.ball.p.x;
    const inBackcourt = (holder ? holder.x : sim.ball.p.x) * s < 0;
    const play = this.play || { type: 'motion' };
    let target = this.slotPos(p, hoop);
    let mode = 'jog';
    // Transition: run the floor; sprint ahead of the ball.
    if (inBackcourt && !m.halfCourt) {
      mode = 'sprint';
      if (p.pos === 'C' || p.pos === 'PF') target = this.toWorld(hoop, 2.6, p.slot % 2 ? 2.9 : -2.9);
    }
    // Pick-and-roll screener.
    if (play.type === 'pnr' && play.screener === p && holder && !inBackcourt) {
      const pr = play;
      const def = this.sim.ai[1 - this.team].onBallDefender();
      if (!pr.screenDone) {
        if (def) {
          const toHoopX = h.x - holder.x, toHoopZ = h.z - holder.z;
          const l = Math.hypot(toHoopX, toHoopZ) || 1;
          const side = pr.side;
          // Screen on the defender's side opposite the drive.
          const sx = def.x + (-toHoopZ / l) * 0.55 * side + (toHoopX / l) * 0.15;
          const sz = def.z + (toHoopX / l) * 0.55 * side + (toHoopZ / l) * 0.15;
          const d = this.moveTo(p, sx, sz, 'sprint', 0.3);
          if (d < 0.6 && !p.ai.screening) {
            p.ai.screening = true;
            p.ai.screenUntil = sim.t + 1.1;
            pr.screenSetT = sim.t;
            it.mx = 0; it.mz = 0;
            sim.emit('screenSet', { player: p });
          }
          if (p.ai.screening) { it.mx = 0; it.mz = 0; p.vx *= 0.5; p.vz *= 0.5; }
          it.faceX = def.x; it.faceZ = def.z;
          if (pr.screenSetT && sim.t > pr.screenSetT + 1.0) pr.screenDone = true;
          if (sim.t - pr.start > 7) pr.screenDone = true;
          return;
        }
      } else {
        // Roll to the rim or pop to the arc.
        const pop = p.rating('threeShot') >= 72;
        if (!pr.rollSide) pr.rollSide = p.z >= 0 ? 1 : -1;
        target = pop ? this.toWorld(hoop, 7.5, pr.rollSide * 4.5) : this.toWorld(hoop, 1.9, pr.rollSide * 0.9);
        mode = 'sprint';
        if (sim.t - pr.screenSetT > 3.5) target = this.slotPos(p, hoop);
      }
    }
    // Post-up target: seal on the block.
    if (play.type === 'post' && play.poster === p && !inBackcourt) {
      if (!play.postSide) play.postSide = p.z >= 0 ? 1 : -1;
      target = this.toWorld(hoop, 2.6, play.postSide * 2.6);
      const d = Math.hypot(target.x - p.x, target.z - p.z);
      if (d < 0.8) { it.faceX = holder ? holder.x : 0; it.faceZ = holder ? holder.z : 0; }
    }
    // Motion offence: periodic basket cuts, especially when overplayed (backdoor).
    if (!inBackcourt && sim.t > p.ai.cutUntil + 2.5) {
      const myDef = this.defenderOf(p);
      const denied = myDef && holder && this.isDenying(myDef, p, holder);
      const motion = play.type === 'motion' ? 0.012 : 0.004;
      if ((denied && sim.rng.chance(0.05)) || sim.rng.chance(motion)) {
        if (p.pos !== 'C' || play.type === 'motion') {
          p.ai.cutUntil = sim.t + 1.6;
          p.ai.cutTarget = this.toWorld(hoop, 1.4, (p.z > 0 ? 0.6 : -0.6));
          if (denied) sim.emit('backdoor', { player: p });
        }
      }
    }
    if (sim.t < p.ai.cutUntil && p.ai.cutTarget) {
      target = p.ai.cutTarget;
      mode = 'sprint';
    }
    // User called for a screen: nearest big comes to set one.
    const req = sim.user.requests;
    if (req.screen && sim.t - req.screen < 4 && holder && sim.isUser(holder) && (p.pos === 'C' || p.pos === 'PF')) {
      const near = [...this.players].filter((q) => !sim.isUser(q) && (q.pos === 'C' || q.pos === 'PF')).sort((a, c) => a.distTo(holder) - c.distTo(holder))[0];
      if (near === p) {
        if (!this.play || this.play.type !== 'pnr' || this.play.screener !== p) {
          this.play = { type: 'pnr', screener: p, handler: holder, side: sim.rng.chance(0.5) ? 1 : -1, start: sim.t, formation: this.play?.formation };
          req.screen = 0;
        }
      }
    }
    // Spacing: don't stand on top of the ball handler or another teammate.
    if (holder) {
      const dh = Math.hypot(target.x - holder.x, target.z - holder.z);
      if (dh < 3.2 && sim.t > p.ai.cutUntil) {
        const alt = this.alternateSlot(p, hoop, holder);
        if (alt) target = alt;
      }
    }
    // Offensive 3 seconds: step out of the lane.
    if (p.inLaneT > 1.4) {
      if (!p.ai.exitSide || sim.t - p.ai.exitT > 4) { p.ai.exitSide = p.z >= 0 ? 1 : -1; p.ai.exitT = sim.t; }
      target = this.toWorld(hoop, 2.4, p.ai.exitSide * 3.6);
      mode = 'sprint';
    }
    this.moveTo(p, target.x, target.z, mode, 0.4);
    if (Math.hypot(target.x - p.x, target.z - p.z) < 0.6) {
      const b = sim.ball;
      it.faceX = b.p.x; it.faceZ = b.p.z;
    }
    // Floor balance in the backcourt: keep the ball handler's lane clear.
    if (inBackcourt && Math.abs(ballX - p.x) < 1.5 && Math.abs(p.z - (holder ? holder.z : 0)) < 2) it.mz += p.z > 0 ? 0.5 : -0.5;
  }

  alternateSlot(p, hoop, holder) {
    let best = null, bd = -1;
    const taken = new Set(this.offSlots.values());
    for (const [name, s] of Object.entries(SLOTS)) {
      if (name === this.offSlots.get(p)) continue;
      const w = this.toWorld(hoop, s[0], s[1]);
      let minD = Math.hypot(w.x - holder.x, w.z - holder.z);
      for (const q of this.players) if (q !== p && q !== holder) minD = Math.min(minD, Math.hypot(w.x - q.x, w.z - q.z) * 1.2);
      const pen = taken.has(name) ? 0.8 : 1;
      const score = minD * pen - Math.hypot(w.x - p.x, w.z - p.z) * 0.15;
      if (score > bd) { bd = score; best = w; }
    }
    return best;
  }

  defenderOf(o) {
    const dai = this.sim.ai[1 - this.team];
    for (const [d, m] of dai.assign) if (m === o) return d;
    return null;
  }

  isDenying(d, o, holder) {
    // Defender is between his man and the ball (passing lane) and close.
    const ox = holder.x - o.x, oz = holder.z - o.z;
    const dx = d.x - o.x, dz = d.z - o.z;
    const l = Math.hypot(ox, oz) || 1;
    return (dx * ox + dz * oz) / l > 0.4 && Math.hypot(dx, dz) < 1.6;
  }

  /** Estimated expected points of a shot by player q from where he stands. */
  shotEV(q, contestOverride = null) {
    const sim = this.sim;
    const hoop = sim.match.attackHoop(q.team);
    const dist = distToHoop(q.x, q.z, hoop);
    const three = isThreePoint(q.x, q.z, hoop);
    const finish = dist < 2.4;
    const kind = finish ? 'layup' : 'jumper';
    const rk = shotRatingKey(kind, dist, three);
    const c = contestOverride ?? evaluateContest(q, sim.teams[1 - q.team].onCourt, hoop, q.standingReach + 0.2).value;
    const prob = baseMakeProbability(q, { kind, ratingKey: rk, dist, three, contest: c, moving: q.speed > 3.5, rhythm: false });
    const pts = sim.match.halfCourt && sim.settings.ones ? (three ? 2 : 1) : three ? 3 : 2;
    return { ev: prob * pts, prob, contest: c, dist, three };
  }

  laneSafety(from, to) {
    // Closest defender to the pass segment, scaled by their reach and anticipation.
    const sx = to.x - from.x, sz = to.z - from.z;
    const L = Math.hypot(sx, sz) || 1;
    let worst = 1;
    for (const d of this.opp) {
      const t = clamp(((d.x - from.x) * sx + (d.z - from.z) * sz) / (L * L), 0, 1);
      const px = from.x + sx * t, pz = from.z + sz * t;
      const dd = Math.hypot(d.x - px, d.z - pz);
      const reach = 0.7 + d.r('steal') * 0.5 + (d.wingM - 1.9);
      const risk = clamp(1 - (dd - 0.3) / (reach + 0.6), 0, 1) * (0.4 + t * 0.6);
      worst = Math.min(worst, 1 - risk);
    }
    // Long passes give defenders time to read them.
    return worst * clamp(1.25 - L / 16, 0.4, 1);
  }

  ballHandler(p, dt) {
    const sim = this.sim;
    const m = sim.match;
    const it = p.intent;
    const hoop = m.attackHoop(this.team);
    const h = hoopPos(hoop);
    const s = hoopSign(hoop);
    const dist = distToHoop(p.x, p.z, hoop);
    const b = sim.ball;
    const plan = p.ai.plan || (p.ai.plan = { type: 'setup', t: sim.t, target: null });
    // Post-up entry: the post player backs his man down.
    const play = this.play;
    if (!p.posting && play && play.type === 'post' && play.poster === p && dist < 4.6 && !p.action) {
      p.posting = true;
      p.ai.postStart = sim.t;
      if (b.state === 'held') sim.startDribble(p);
    }
    // About to run out of bounds with the ball: plant and come back in.
    const stopD = (p.speed * p.speed) / 16 + 0.4;
    const nx = p.x + (p.speed > 0.5 ? (p.vx / p.speed) * stopD : 0), nz = p.z + (p.speed > 0.5 ? (p.vz / p.speed) * stopD : 0);
    if (!p.action && (Math.abs(nx) > HALF_L - 0.25 || Math.abs(nz) > HALF_W - 0.25)) {
      it.mx = -p.x / (Math.hypot(p.x, p.z) || 1); it.mz = -p.z / (Math.hypot(p.x, p.z) || 1);
      it.sprint = false;
      return;
    }
    if (p.posting) {
      const tx = h.x - p.x, tz = h.z - p.z, l = Math.hypot(tx, tz) || 1;
      it.mx = (tx / l) * 0.45; it.mz = (tz / l) * 0.45;
      it.faceX = p.x - tx; it.faceZ = p.z - tz;
      if (dist > 5.5) p.posting = false;
    } else {
      // Execute the current plan every tick.
      this.executePlan(p, plan, hoop);
    }
    if (p.action && p.action.type !== 'catch' && !(p.action.type === 'move' && p.action.t > p.action.dur * 0.6)) return;
    if (sim.t < p.ai.nextThink) return;
    p.ai.nextThink = sim.t + this.reaction() * (0.6 + 0.4 * (1 - p.r('passIQ')));
    if (p.posting) return this.postDecision(p, hoop);

    const inBackcourt = p.x * s < 0 && !m.halfCourt;
    const clock = Math.min(m.shotClock, m.halfCourt ? 99 : m.clock + (m.quarter >= 4 ? 0 : 99));
    const sinceCatch = sim.t - p.lastCatchT;
    // Streetball: clear the ball beyond the arc after a change of possession.
    if (m.halfCourt && m.needClear) {
      const top = this.toWorld(hoop, 9.8, p.z * 0.5);
      plan.type = 'clear'; plan.target = top;
      if (isThreePoint(p.x, p.z, hoop) && dist > THREE_R + 0.4) m.needClear = false;
      return;
    }
    // Late-clock end-of-quarter hold.
    if (!m.halfCourt && m.quarter >= 4 && m.clock < 24 && m.clock > 7 && m.shotClock > m.clock && m.score[this.team] >= m.score[1 - this.team]) {
      plan.type = 'hold';
      plan.target = this.toWorld(hoop, 9.5, p.z);
      return;
    }
    if (inBackcourt) {
      // Bring it up; push in transition when the defence isn't back.
      const ahead = this.opp.filter((d) => d.x * s > p.x * s).length;
      plan.type = ahead <= 2 && sim.match.possStartHow !== 'inbound' ? 'push' : 'bringUp';
      plan.target = plan.type === 'push' ? { x: h.x - s * 2, z: h.z } : this.toWorld(hoop, 9.5, p.z * 0.4);
      return;
    }
    const shot = this.shotEV(p);
    const reqBall = sim.user.requests.callForBall && sim.t - sim.user.requests.callForBall < 1.5;
    const reqLob = sim.user.requests.alleyOop && sim.t - sim.user.requests.alleyOop < 1.5;
    const iq = 0.5 * p.r('passIQ') + 0.5 * p.r('shotIQ');
    const noise = (this.isCpu ? sim.diff.cpuNoise : 0.18) * (1.3 - iq) * 0.8;
    // Quality bar: early in the clock only good looks are taken; it drops as the clock runs down.
    const bar = lerp(0.55, 1.28, clamp((clock - 3) / 14, 0, 1));
    const options = [];
    const shotTend = 0.75 + p.def.tend.shot * 0.4 + (shot.three ? p.def.tend.three * 0.2 - 0.16 : 0.04);
    let shootScore = shot.ev * shotTend - bar - (sinceCatch < 0.25 ? 0.15 : 0);
    if (shot.dist > THREE_R + 2.2 && clock > 3) shootScore -= 1.0;
    options.push(['shoot', shootScore]);
    // Drive.
    const lane = this.laneOpenness(p, hoop);
    const finishR = Math.max(p.r('layup'), p.r('drivingDunk'));
    const driveEV = (0.75 + finishR * 0.75) * lane * (0.65 + p.def.tend.drive * 0.6) - (p.stamina < 0.3 ? 0.2 : 0);
    options.push(['drive', driveEV - bar + (dist < 6 ? 0.08 : 0)]);
    // Pass.
    let bestPass = null, bestPassScore = -9;
    for (const q of this.players) {
      if (q === p || !this.inPlay(q)) continue;
      if (!m.halfCourt && m.frontcourt && q.x * s < 0.5) continue;
      const ev = this.shotEV(q);
      const safety = this.laneSafety(p, q);
      if (safety < 0.4) continue;
      const cutting = sim.velTowardHoop(q, hoop) > 3 && distToHoop(q.x, q.z, hoop) < 5 ? 0.3 : 0;
      const rolling = this.play && this.play.type === 'pnr' && this.play.screener === q && this.play.screenDone ? 0.12 : 0;
      let sc = (ev.ev * (0.9 + p.r('passVision') * 0.2) + cutting + rolling) * (0.55 + 0.45 * safety) - bar * 0.85 + p.def.tend.pass * 0.12;
      if (sim.isUser(q) && reqBall) sc += 0.6;
      if (this.play && this.play.type === 'post' && this.play.poster === q && distToHoop(q.x, q.z, hoop) < 4) sc += 0.25;
      if (this.play && this.play.type === 'iso' && this.play.star === q && this.play.star !== p) sc += 0.35;
      if (sc > bestPassScore) { bestPassScore = sc; bestPass = q; }
    }
    if (bestPass && sinceCatch > 0.35) options.push(['pass', bestPassScore]);
    // Dribble move to shake the on-ball defender.
    const def = sim.ai[1 - this.team].onBallDefender();
    const defD = def ? def.distTo(p) : 9;
    if (defD < 1.7 && p.r('ballHandle') > 0.45 && b.state === 'dribble') options.push(['move', -0.15 + p.r('ballHandle') * 0.3 - shot.ev * 0.1]);
    // Keep running the play.
    options.push(['continue', this.play && this.play.type === 'pnr' && !this.play.screenDone ? 0.1 : 0]);

    // Pick with noise (higher difficulty / IQ = sharper decisions).
    let choice = null, best = -1e9;
    for (const [k, v] of options) {
      const val = v + sim.rng.gauss() * noise;
      if (val > best) { best = val; choice = k; }
    }
    if (clock < 2.5 && choice !== 'shoot') choice = dist < 4 ? 'drive' : 'shoot';
    if (reqLob && bestPass && sim.isUser(bestPass) === false) {
      const u = sim.user.player;
      if (u && u.team === this.team && sim.isAlleyOopCandidate(u)) { sim.attemptPass(p, 'lob', u, { alleyOop: true }); sim.user.requests.alleyOop = 0; return; }
    }
    switch (choice) {
      case 'shoot':
        if (dist < 3.2) sim.startFinish(p, {});
        else sim.attemptShot(p, {});
        break;
      case 'drive': {
        plan.type = 'drive';
        plan.t = sim.t;
        const latSide = def ? Math.sign(((p.x - def.x) * -(h.z - p.z) + (p.z - def.z) * (h.x - p.x)) || 1) : 1;
        plan.side = latSide;
        break;
      }
      case 'pass': {
        const alley = bestPass && sim.isAlleyOopCandidate(bestPass) && distToHoop(bestPass.x, bestPass.z, hoop) < 4 && sim.rng.chance(0.4 * p.r('passVision'));
        const kind = alley ? 'lob' : this.laneSafety(p, bestPass) < 0.65 && bestPass.distTo(p) < 7 ? 'bounce' : 'chest';
        sim.attemptPass(p, kind, bestPass, { alleyOop: alley });
        plan.type = 'setup';
        break;
      }
      case 'move': {
        const mv = this.pickMove(p, def, shot);
        sim.attemptMove(p, mv, { checkBounds: true });
        if (mv === 'stepback' || mv === 'sidestep') p.ai.nextThink = sim.t + 0.5;
        break;
      }
      default:
        if (plan.type === 'drive' && sim.t - plan.t > 2.5) plan.type = 'setup';
    }
  }

  pickMove(p, def, shot) {
    const sim = this.sim;
    const r = sim.rng;
    const shooter = p.r('midShot') > 0.6 || p.r('threeShot') > 0.6;
    const opts = [['crossover', 1], ['betweenLegs', 0.8], ['behindBack', 0.6 * p.r('ballHandle')], ['hesitation', 0.8], ['inAndOut', 0.6], ['spin', 0.5 * p.r('ballHandle')]];
    if (shooter) opts.push(['stepback', 1.0 * p.r('threeShot') + 0.2], ['sidestep', 0.5]);
    if (p.r('ballHandle') > 0.75) opts.push(['sizeup', 0.6]);
    return r.weighted(opts);
  }

  laneOpenness(p, hoop) {
    const h = hoopPos(hoop);
    const sx = h.x - p.x, sz = h.z - p.z;
    const L = Math.hypot(sx, sz) || 1;
    let open = 1;
    for (const d of this.opp) {
      const t = ((d.x - p.x) * sx + (d.z - p.z) * sz) / (L * L);
      if (t < 0 || t > 1.05) continue;
      const px = p.x + sx * t, pz = p.z + sz * t;
      const dd = Math.hypot(d.x - px, d.z - pz);
      const block = clamp(1 - (dd - 0.3) / 1.4, 0, 1) * (t * L < 3 ? 1 : 0.6) * (0.5 + 0.5 * Math.max(d.r('interiorD'), d.r('perimeterD')));
      open *= 1 - block * 0.75;
    }
    return open;
  }

  executePlan(p, plan, hoop) {
    const sim = this.sim;
    const it = p.intent;
    const h = hoopPos(hoop);
    const b = sim.ball;
    b.dribble.style = 'normal';
    switch (plan.type) {
      case 'push':
      case 'bringUp':
      case 'hold':
      case 'clear': {
        const t = plan.target || h;
        this.moveTo(p, t.x, t.z, plan.type === 'push' ? 'sprint' : plan.type === 'hold' ? 'walk' : 'jog', 0.6);
        if (plan.type === 'push' && distToHoop(p.x, p.z, hoop) < 4.2 && !p.action) sim.startFinish(p, {});
        if (plan.type === 'hold') b.dribble.style = 'low';
        break;
      }
      case 'drive': {
        const dist = distToHoop(p.x, p.z, hoop);
        // Attack the rim, angling away from the on-ball defender.
        const lx = -(h.z - p.z), lz = h.x - p.x;
        const ll = Math.hypot(lx, lz) || 1;
        const off = clamp(dist / 6, 0, 1) * 1.2 * (plan.side || 1);
        const tx = h.x + (lx / ll) * off, tz = h.z + (lz / ll) * off;
        this.moveTo(p, tx, tz, 'sprint', 0.2);
        if (!p.action) {
          const pressure = sim.finishPressure(p, hoop);
          if (dist < 3.6 || (dist < 4.4 && pressure < 0.3)) {
            sim.startFinish(p, {});
          } else if (pressure > 0.55 && dist < 6) {
            // Help arrived: kick out to an open shooter, or pull up.
            let kick = null, ks = 0.45;
            for (const q of this.players) {
              if (q === p || !this.inPlay(q)) continue;
              const o = this.opennessOf(q);
              const s = o * this.laneSafety(p, q);
              if (s > ks) { ks = s; kick = q; }
            }
            if (kick && sim.rng.chance(0.4 + 0.5 * p.r('passVision'))) {
              sim.attemptPass(p, 'chest', kick);
              plan.type = 'setup';
              sim.emit('driveAndKick', { player: p, to: kick });
            } else if (dist > 3.4 && p.r('midShot') > 0.45) {
              sim.attemptShot(p, { forceJumper: true });
            }
          }
        }
        if (sim.t - plan.t > 3.2) plan.type = 'setup';
        break;
      }
      default: {
        // Set up: run the called play from a spot near the top/wing.
        const play = this.play;
        let t = this.slotPos(p, hoop);
        if (play && play.type === 'pnr' && play.handler === p && play.screenSetT) {
          // Come off the screen.
          const sc = play.screener;
          const away = { x: sc.x + (h.x - sc.x) * 0.45 + (sc.x - p.x) * 0.6, z: sc.z + (h.z - sc.z) * 0.45 + (sc.z - p.z) * 0.6 };
          t = away;
          this.moveTo(p, t.x, t.z, 'sprint', 0.3);
          break;
        }
        const d = Math.hypot(t.x - p.x, t.z - p.z);
        if (d > 1.0) this.moveTo(p, t.x, t.z, 'jog', 0.6);
        else {
          // Probe with a live dribble: small lateral moves.
          it.mx = Math.sin(sim.t * 1.3 + p.slot) * 0.25; it.mz = Math.cos(sim.t * 0.9) * 0.25;
        }
        if (play && play.type === 'iso' && play.star === p) b.dribble.style = 'low';
      }
    }
    // Face the hoop when not travelling quickly.
    if (p.speed < 2) { it.faceX = h.x; it.faceZ = h.z; }
  }

  postDecision(p, hoop) {
    const sim = this.sim;
    const it = p.intent;
    const h = hoopPos(hoop);
    const dist = distToHoop(p.x, p.z, hoop);
    const t = sim.t - (p.ai.postStart || sim.t);
    // Double team? Kick it out.
    let near = 0;
    for (const d of this.opp) if (d.distTo(p) < 1.6) near++;
    if (near >= 2 && sim.rng.chance(0.6 * p.r('passVision') + 0.2)) {
      let best = null, bs = 0;
      for (const q of this.players) { if (q === p || !this.inPlay(q)) continue; const o = this.opennessOf(q) * this.laneSafety(p, q); if (o > bs) { bs = o; best = q; } }
      if (best) { p.posting = false; sim.attemptPass(p, 'chest', best); return; }
    }
    if (t > 1.2 + sim.rng.next() * 1.5 || dist < 2.2) {
      const r = sim.rng.next();
      if (r < 0.3 * p.r('postControl') + 0.1) sim.attemptMove(p, 'dropStep', { checkBounds: true });
      else { sim.attemptShot(p, {}); p.posting = false; }
    }
  }

  // ---------------------------------------------------------------------
  // Defence
  // ---------------------------------------------------------------------
  defend(p, dt) {
    const sim = this.sim;
    const m = sim.match;
    const it = p.intent;
    const hoop = m.defendHoop(this.team);
    const h = hoopPos(hoop);
    const holder = sim.holder();
    const b = sim.ball;
    const ballPos = holder || b.p;
    const s = hoopSign(hoop);
    const zone = this.coach.scheme === 'zone' && this.players.length === 5;
    let o = this.manOf(p);
    const isCpu = this.isCpu;
    const quality = isCpu ? sim.diff.cpuDef : 1.0;

    // Transition: sprint back if behind the play.
    const myU = this.toLocal(hoop, p.x, p.z).u;
    const ballU = this.toLocal(hoop, ballPos.x, ballPos.z).u;
    if (myU > ballU + 2.5 && ballU < 14) {
      const back = this.toWorld(hoop, Math.max(2, ballU - 2), lerp(p.z, 0, 0.5));
      this.moveTo(p, back.x, back.z, 'sprint', 0.5);
      it.faceX = ballPos.x; it.faceZ = ballPos.z;
      return;
    }

    let target;
    const onBall = holder && o === holder;
    // Help defence: a driver has beaten his man near the rim.
    const helpInfo = this.helpSituation(hoop);
    if (helpInfo && helpInfo.helper === p) {
      const dr = helpInfo.driver;
      const k = clamp(1.3 / (distToHoop(dr.x, dr.z, hoop) || 1), 0.2, 0.7);
      target = { x: h.x + (dr.x - h.x) * (1 - k), z: h.z + (dr.z - h.z) * (1 - k) };
      this.moveTo(p, target.x, target.z, 'sprint', 0.15);
      it.stance = Math.hypot(target.x - p.x, target.z - p.z) < 1.5;
      it.faceX = dr.x; it.faceZ = dr.z;
      this.considerContest(p, dr, quality);
      return;
    }

    if (zone && !onBall) {
      target = this.zoneSpot(p, hoop, ballPos);
      const nearest = this.opp.reduce((a, c) => (Math.hypot(c.x - target.x, c.z - target.z) < Math.hypot(a.x - target.x, a.z - target.z) ? c : a));
      if (holder && Math.hypot(holder.x - target.x, holder.z - target.z) < 2.8) o = holder;
      else if (Math.hypot(nearest.x - target.x, nearest.z - target.z) < 2.2) target = { x: lerp(target.x, nearest.x, 0.3), z: lerp(target.z, nearest.z, 0.3) };
    }

    if (holder && o === holder) {
      // On-ball: stay between the ball and the basket, sag off weak shooters.
      const dist = distToHoop(holder.x, holder.z, hoop);
      const shooter = Math.max(holder.r('threeShot'), holder.r('midShot'));
      let gap = 1.05 + (1 - shooter) * 0.9 * clamp((dist - 5) / 4, 0, 1) - 0.25 * p.r('perimeterD');
      if (dist < 4) gap = 0.75;
      if (holder.posting) gap = 0.55;
      const dx = h.x - holder.x, dz = h.z - holder.z, l = Math.hypot(dx, dz) || 1;
      // Anticipate the dribbler's movement (cutoff).
      const lead = 0.18 * (0.5 + p.r('defAwareness'));
      target = { x: holder.x + holder.vx * lead + (dx / l) * gap, z: holder.z + holder.vz * lead + (dz / l) * gap };
      const d = Math.hypot(target.x - p.x, target.z - p.z);
      this.moveTo(p, target.x, target.z, d > 2.5 ? 'sprint' : 'jog', 0.08);
      it.stance = d < 2.5;
      it.faceX = holder.x; it.faceZ = holder.z;
      it.handsUp = dist < 8;
      // Steal attempts on exposed dribbles.
      const exposed = holder.action && holder.action.type === 'move' ? holder.action.data.m.exposure : b.state === 'dribble' ? 0.1 : 0;
      const agg = (0.0006 + exposed * 0.012) * (0.4 + p.r('steal')) * (isCpu ? sim.diff.cpuSteal : 0.7);
      if (holder.distTo(p) < 1.3 && !p.action && sim.rng.chance(agg)) sim.attemptSteal(p);
      this.considerContest(p, holder, quality);
      if (holder.posting && sim.t - (holder.ai.postStart || 0) > 0) { /* body up */ }
      return;
    }

    // Off-ball: positioned between man and basket, shading toward the ball.
    if (!zone || !target) {
      const ballD = Math.hypot(o.x - ballPos.x, o.z - ballPos.z);
      const oneAway = ballD < 7.5;
      const sag = clamp(0.18 + ballD * 0.035, 0.18, 0.5) * (1 - 0.3 * o.r('threeShot') * (isThreePoint(o.x, o.z, hoop) ? 1 : 0));
      const help = oneAway ? 0.08 : 0.22;
      target = {
        x: o.x + (h.x - o.x) * sag + (ballPos.x - o.x) * help,
        z: o.z + (h.z - o.z) * sag + (ballPos.z - o.z) * help,
      };
      // Deny one pass away against good shooters.
      if (oneAway && o.r('threeShot') > 0.6 && p.r('perimeterD') > 0.5) {
        target.x = lerp(target.x, o.x + (ballPos.x - o.x) * 0.25, 0.5);
        target.z = lerp(target.z, o.z + (ballPos.z - o.z) * 0.25, 0.5);
      }
      // Closeout after the catch.
      if (sim.t - o.lastCatchT < 1.2 && b.owner === o) {
        target = { x: o.x + (h.x - o.x) * 0.12, z: o.z + (h.z - o.z) * 0.12 };
      }
    }
    // Defensive 3 seconds: don't camp in the paint.
    if (inPaint(target.x, target.z, hoop) && (p.defLaneT || 0) > 2.2) {
      target = { x: target.x - s * 1.5, z: target.z + (target.z >= 0 ? 1.5 : -1.5) };
    }
    const d = Math.hypot(target.x - p.x, target.z - p.z);
    this.moveTo(p, target.x, target.z, d > 3 ? 'sprint' : 'jog', 0.25);
    it.stance = d < 1.5 && Math.hypot(o.x - p.x, o.z - p.z) < 3;
    it.faceX = ballPos.x; it.faceZ = ballPos.z;
    // Read the passing lane.
    if (b.state === 'air' && b.air.kind === 'pass' && b.air.target === o) {
      const tx = b.p.x + b.v.x * 0.25, tz = b.p.z + b.v.z * 0.25;
      if (Math.hypot(tx - p.x, tz - p.z) < 2.5 * p.r('steal') + 0.6) this.moveTo(p, tx, tz, 'sprint', 0.1);
    }
    // Switch onto the screener's man when caught on a screen.
    if (holder && this.coach.switching && p.stumble > 0 && o === holder) this.trySwitch(p);
  }

  helpSituation(hoop) {
    const sim = this.sim;
    const holder = sim.holder();
    if (!holder || holder.team === this.team) return null;
    const dist = distToHoop(holder.x, holder.z, hoop);
    if (dist > 5.2) return null;
    const onBall = this.onBallDefender();
    const beaten = !onBall || distToHoop(onBall.x, onBall.z, hoop) > dist - 0.2 || onBall.stumble > 0;
    if (!beaten) return null;
    // Best helper: nearest to the driver's path, rim protectors preferred.
    let best = null, bs = -1e9;
    for (const d of this.players) {
      if (d === onBall || sim.isUser(d)) continue;
      const dd = d.distTo(holder);
      const s = -dd + d.r('block') * 1.5 + d.r('helpD') * 1.2 + (inPaint(d.x, d.z, hoop) ? 1 : 0);
      if (s > bs) { bs = s; best = d; }
    }
    const quality = this.isCpu ? sim.diff.cpuDef : 1;
    if (best && best.r('helpD') * quality < 0.25 && sim.rng.chance(0.5)) return null;
    return best ? { helper: best, driver: holder } : null;
  }

  trySwitch(p) {
    // Swap assignments with the defender closest to the ball handler.
    const holder = this.sim.holder();
    let best = null, bd = 9;
    for (const d of this.players) {
      if (d === p) continue;
      const dd = d.distTo(holder);
      if (dd < bd) { bd = dd; best = d; }
    }
    if (best && bd < 2.2) {
      const a = this.assign.get(p), c = this.assign.get(best);
      this.assign.set(p, c);
      this.assign.set(best, a);
      this.sim.emit('defSwitch', { a: p, b: best });
    }
  }

  zoneSpot(p, hoop, ball) {
    const idx = [...this.players].sort((a, c) => a.slot - c.slot).indexOf(p);
    const bl = this.toLocal(hoop, ball.x, ball.z);
    const shift = clamp(bl.v / 7, -1, 1);
    const spots = [[6.6, -2.4], [6.6, 2.4], [2.6, -4.6], [2.6, 4.6], [2.0, 0]];
    const s = spots[idx] || spots[4];
    return this.toWorld(hoop, s[0] - (bl.u < 4 ? 1.2 : 0), s[1] + shift * 1.8);
  }

  considerContest(p, shooter, quality) {
    const sim = this.sim;
    const a = shooter.action;
    if (!a || p.airborne || p.action) return;
    const type = a.type;
    if (!['shot', 'layup', 'dunk'].includes(type)) return;
    if (type === 'shot' && a.data.shotType === 'ft') return;
    const d = p.distTo(shooter);
    if (d > 2.6) return;
    a.data.reacted = a.data.reacted || new Set();
    if (a.data.reacted.has(p)) return;
    // React after a delay; better defenders time it closer to the release.
    const react = (this.isCpu ? sim.diff.cpuReact : 0.3) * (1.2 - p.r('defAwareness') * 0.5);
    if (a.t < react) return;
    if (type === 'shot') {
      const rel = a.data.tIdeal;
      const jumpLead = 0.28;
      if (a.t >= rel - jumpLead - 0.05) {
        const rimProtect = p.r('block') > 0.6 && d < 1.2 && distToHoop(shooter.x, shooter.z, a.data.hoop) < 5;
        a.data.reacted.add(p);
        if (rimProtect && sim.rng.chance(0.5 * quality)) sim.attemptBlock(p, 'block');
        else if (d < 1.9 && sim.rng.chance(0.75 * quality)) sim.attemptBlock(p, 'contest');
        else p.intent.handsUp = true;
      }
    } else {
      const toff = a.data.takeoffT;
      if (a.t >= toff - 0.1 && d < 2.2) {
        a.data.reacted.add(p);
        if (sim.rng.chance((0.35 + 0.45 * p.r('block')) * quality)) sim.attemptBlock(p, 'block');
        else p.intent.handsUp = true;
      }
    }
  }
}
