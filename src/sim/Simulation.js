// Headless basketball simulation: ten players, one ball, rules and AI. The
// renderer only reads from this; nothing here depends on Three.js so the
// whole match can be run and tested in Node.
import { Random } from '../core/Random.js';
import { clamp, wrapAngle, approachAngle, smoothstep, lerp } from '../core/math.js';
import {
  SIM_DT, BALL_R, RIM_H, HALF_L, HALF_W, hoopPos, hoopSign, distToHoop, isThreePoint,
  inPaint, inRestrictedArea, HOOP_X,
} from './constants.js';
import { stepFreeBall } from './BallPhysics.js';
import { solveShot, solveTimed, solveTimedDrag } from './ShotSolver.js';
import { Player } from './Player.js';
import { buildPlayerDef } from './Attributes.js';
import {
  SHOT_TYPES, DIFFICULTY, shotRatingKey, releaseWindow, timingGrade, evaluateContest,
  baseMakeProbability, finalMakeProbability, aimPoint, contestLabel,
} from './Shooting.js';
import { MOVES, classifyFlick } from './DribbleMoves.js';
import { Match } from './Match.js';
import { TeamAI } from './ai/TeamAI.js';
import { Takeover } from './Takeover.js';

export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

export class Simulation {
  /**
   * @param {object} o
   * @param {Array} o.teams two raw team objects from rosters.json
   * @param {object} o.settings { quarterMin, difficulty, userTeam, autoSwitch, layupTiming, mode, playersPerSide, targetScore }
   */
  constructor(o) {
    this.settings = Object.assign({
      quarterMin: 5, difficulty: 'allstar', userTeam: 0, autoSwitch: true, layupTiming: true, mode: 'playnow',
      playersPerSide: 5, targetScore: 21, uniforms: ['home', 'away'],
    }, o.settings || {});
    this.rng = new Random(o.seed ?? 12345);
    this.diff = DIFFICULTY[this.settings.difficulty] || DIFFICULTY.allstar;
    this.t = 0;
    this.events = [];
    this.n = this.settings.playersPerSide;
    this.teams = o.teams.map((raw, ti) => {
      const defs = raw.players.map((pr) => buildPlayerDef(pr, raw.id));
      const roster = defs.map((d, i) => new Player(d, ti, i < this.n));
      roster.forEach((p) => { p.events = this.events; });
      return {
        idx: ti, raw, roster, onCourt: [], timeouts: 7, fouls: 0, foulsLast2: 0,
        uniform: this.settings.uniforms[ti],
        run: 0,
      };
    });
    for (const team of this.teams) this.pickStarters(team);
    // Fatigue is scaled to the game length so short quarters still rotate players.
    const mode = this.settings.mode;
    this.fatigueScale = mode === 'practice' ? 0.5 : mode === 'blacktop' ? 1.5 : Math.max(1, Math.min(4, 12 / this.settings.quarterMin));
    for (const t of this.teams) for (const p of t.roster) p.fatigueScale = this.fatigueScale;
    this.ball = {
      p: { x: 0, y: 1, z: 0 }, v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 },
      state: 'dead', owner: null, air: null, lastTouch: null,
      dribble: { phase: 0, period: 0.55, side: 1, fromSide: 1, cross: 1, style: 'normal' },
      prevP: { x: 0, y: 1, z: 0 },
    };
    this.user = { team: this.settings.userTeam, player: null, requests: {} };
    this.match = new Match(this);
    this.takeover = new Takeover(this);
    this.ai = [new TeamAI(this, 0), new TeamAI(this, 1)];
    this.pendingFoul = null;
    this.pendingSteal = null;
    this.replayHighlight = null;
    this.contactCooldown = new Map();
    this.lastShotFeedback = null;
    this.paused = false;
  }

  pickStarters(team) {
    const used = new Set();
    const order = POSITIONS.slice(0, this.n === 5 ? 5 : this.n);
    const lineup = [];
    if (this.n === 5) {
      for (const pos of order) {
        const my = team.roster.find((q) => q.def.my && q.pos === pos && !used.has(q));
        const p = my || team.roster.find((q) => q.pos === pos && !used.has(q)) || team.roster.find((q) => !used.has(q));
        used.add(p);
        lineup.push(p);
      }
    } else {
      // Small-sided: best overall players.
      const sorted = [...team.roster].sort((a, b) => (b.def.my - a.def.my) || (b.def.ovr - a.def.ovr));
      for (let i = 0; i < this.n; i++) lineup.push(sorted[i]);
    }
    lineup.forEach((p, i) => { p.onCourt = true; p.slot = i; p.starter = true; });
    team.roster.forEach((p) => { if (!lineup.includes(p)) { p.onCourt = false; p.starter = false; } });
    team.onCourt = lineup;
  }

  get players() {
    return [...this.teams[0].onCourt, ...this.teams[1].onCourt];
  }

  emit(type, data = {}) {
    this.events.push({ type, t: this.t, ...data });
  }

  drainEvents() {
    const e = this.events.splice(0, this.events.length);
    return e;
  }

  attackHoop(team) {
    return this.match.attackHoop(team);
  }

  opponents(p) {
    return this.teams[1 - p.team].onCourt;
  }

  teammates(p) {
    return this.teams[p.team].onCourt.filter((q) => q !== p);
  }

  isUser(p) {
    return this.user.player === p;
  }

  setUserPlayer(p) {
    if (this.user.player) this.user.player.ctrl = 'ai';
    this.user.player = p;
    if (p) p.ctrl = 'user';
    this.emit('controlSwitch', { player: p });
  }

  // ---------------------------------------------------------------------
  // Main step
  // ---------------------------------------------------------------------
  step(input) {
    const dt = SIM_DT;
    this.t += dt;
    this.match.update(dt);
    if (!this.match.isActive()) return;
    if (this.user.player && !this.user.player.onCourt) {
      this.setUserPlayer(this.teams[this.user.team].onCourt[0]);
    }
    if (this.user.player && input) this.applyUserInput(this.user.player, input);
    this.ai[0].update(dt);
    this.ai[1].update(dt);
    const live = this.match.phase === 'live';
    for (const p of this.players) { p.liveClock = live; this.updatePlayer(p, dt); }
    for (const t of this.teams) for (const p of t.roster) if (!p.onCourt) p.rest(dt);
    this.resolveCollisions(dt);
    this.updateBall(dt);
    this.match.postUpdate(dt);
    this.takeover.update(dt);
    for (const [k, v] of this.contactCooldown) {
      if (v <= this.t) this.contactCooldown.delete(k);
    }
  }

  // ---------------------------------------------------------------------
  // Ball ownership
  // ---------------------------------------------------------------------
  holder() {
    const b = this.ball;
    return b.state === 'held' || b.state === 'dribble' ? b.owner : null;
  }

  giveBall(p, how = 'catch') {
    const b = this.ball;
    const prevTeam = b.lastTouch ? b.lastTouch.team : null;
    const air = b.state === 'air' ? b.air : null;
    b.state = 'held';
    b.owner = p;
    b.air = null;
    b.lastTouch = p;
    p.tripleThreat = true;
    p.pickedUp = false;
    p.dribblesSinceCatch = 0;
    p.lastCatchT = this.t;
    p.pivotX = p.x; p.pivotZ = p.z;
    p.posting = false;
    if (how !== 'inbound' && how !== 'tip') this.emit('catch', { player: p, how });
    this.match.onSecure(p, how, air, prevTeam);
  }

  startDribble(p) {
    const b = this.ball;
    if (b.owner !== p || b.state !== 'held') return false;
    if (p.pickedUp) return false;
    b.state = 'dribble';
    b.dribble.phase = 0.05;
    b.dribble.side = p.hand;
    b.dribble.fromSide = p.hand;
    b.dribble.cross = 1;
    p.tripleThreat = false;
    return true;
  }

  pickUpDribble(p) {
    const b = this.ball;
    if (b.owner === p && b.state === 'dribble') {
      b.state = 'held';
      p.pickedUp = true;
      p.pivotX = p.x; p.pivotZ = p.z;
    } else if (b.owner === p) {
      p.pickedUp = true;
    }
    p.tripleThreat = false;
  }

  releaseBall(kind, v, extra = {}) {
    const b = this.ball;
    const owner = b.owner;
    b.state = 'air';
    b.owner = null;
    b.v.x = v.x; b.v.y = v.y; b.v.z = v.z;
    b.air = { kind, t: 0, from: owner, touchedRim: false, touchedBoard: false, ...extra };
    if (owner) b.lastTouch = owner;
  }

  looseBall(v, from) {
    const b = this.ball;
    if (b.state === 'held' || b.state === 'dribble') {
      const owner = b.owner;
      if (owner) owner.pickedUp = false;
    }
    b.state = 'air';
    b.owner = null;
    b.v.x = v.x; b.v.y = v.y; b.v.z = v.z;
    b.air = { kind: 'loose', t: 0, from, touchedRim: false, touchedBoard: false };
    if (from) b.lastTouch = from;
  }

  /** Ball position while held, following the action the holder is performing. */
  heldBallPos(p) {
    const H = p.heightM;
    const a = p.action;
    let fwd = 0.3, side = 0.05 * p.hand, y = H * 0.6 + p.y;
    if (p.posting) { fwd = -0.1; side = 0.25 * p.hand; y = H * 0.55; }
    if (a) {
      if (a.type === 'shot') {
        const d = a.data;
        const u = clamp(a.t / d.tIdeal, 0, 1);
        const set = smoothstep(0.15, 0.7, u);
        const rise = smoothstep(0.6, 1.0, u);
        fwd = lerp(0.3, 0.2, set);
        side = lerp(0.05, 0.12, set) * p.hand;
        y = lerp(H * 0.55, H * 1.02, set) + rise * (p.standingReach - 0.1 - H * 1.02) + p.y;
        if (d.shotType === 'ft') y = lerp(H * 0.5, p.standingReach - 0.15, smoothstep(0.2, 1, u));
        if (d.shotType === 'hook') { side = lerp(0.2, 0.45, set) * p.hand; fwd = 0.05; }
      } else if (a.type === 'layup' || a.type === 'dunk' || a.type === 'alleyoop') {
        const d = a.data;
        const end = a.type === 'layup' ? d.releaseT : d.slamT;
        const u = clamp(a.t / end, 0, 1);
        const up = smoothstep(0.5, 1, u);
        side = (0.2 * (1 - up) + 0.1) * (d.hand || p.hand);
        fwd = lerp(0.25, 0.42, up);
        y = lerp(H * 0.6, p.standingReach + (a.type === 'layup' ? -0.08 : 0.05), up) + p.y;
        if (a.type !== 'layup' && a.t > d.slamT) { y = RIM_H + 0.1; }
      } else if (a.type === 'pass') {
        fwd = 0.35; y = H * 0.62 + p.y; side = 0;
        if (a.data.kind === 'lob') y = H * 0.95 + p.y;
        if (a.data.kind === 'bounce') { y = H * 0.48 + p.y; side = 0.15 * p.hand; }
      } else if (a.type === 'pumpfake') {
        const u = Math.sin(clamp(a.t / a.dur, 0, 1) * Math.PI);
        y = lerp(H * 0.58, H * 0.95, u) + p.y;
        fwd = 0.22;
      } else if (a.type === 'move' && a.data.move === 'jab') {
        fwd = 0.25; y = H * 0.5;
      }
    }
    return {
      x: p.x + p.fx * fwd + p.rx * side,
      y,
      z: p.z + p.fz * fwd + p.rz * side,
    };
  }

  // ---------------------------------------------------------------------
  // Player update and actions
  // ---------------------------------------------------------------------
  updatePlayer(p, dt) {
    const a = p.action;
    const hasBall = this.ball.owner === p && (this.ball.state === 'held' || this.ball.state === 'dribble');
    if (a) {
      a.t += dt;
      const h = ACTIONS[a.type];
      if (h && h.update) h.update(this, p, a, dt);
      if (p.action === a && a.t >= a.dur) this.endAction(p);
    }
    const act = p.action;
    if (!act || !act.lock) {
      // A player holding the ball after picking up the dribble can only pivot.
      if (hasBall && this.ball.state === 'held' && !p.tripleThreat && !p.posting) {
        p.intent.faceX = p.x + p.intent.mx;
        p.intent.faceZ = p.z + p.intent.mz;
        if (Math.hypot(p.intent.mx, p.intent.mz) < 0.1) { p.intent.faceX = null; p.intent.faceZ = null; }
      }
      if (hasBall && this.ball.state === 'held' && p.tripleThreat && Math.hypot(p.intent.mx, p.intent.mz) > 0.25 && !p.posting) {
        this.startDribble(p);
      }
      const dribbling = this.ball.state === 'dribble' && this.ball.owner === p;
      if (p.posting && hasBall) {
        p.updateMovement(dt, true, true);
        const sp = Math.hypot(p.vx, p.vz);
        const cap = 1.4;
        if (sp > cap) { p.vx *= cap / sp; p.vz *= cap / sp; }
      } else {
        p.updateMovement(dt, hasBall, dribbling || (hasBall && p.tripleThreat));
      }
      if (act && act.slow) {
        p.vx *= 1 - act.slow * dt * 6;
        p.vz *= 1 - act.slow * dt * 6;
      }
    } else {
      p.integrate(dt);
      if (act.face !== undefined && act.face !== null) {
        p.facing = approachAngle(p.facing, act.face, (act.faceRate || 12) * dt);
      }
      p.updateStamina(dt, false, p.liveClock !== false);
    }
    // CPU ball handlers stop on the line instead of drifting out of bounds.
    if (hasBall && p.ctrl !== 'user' && !p.inbounding && this.match.phase === 'live') {
      const lx = HALF_L - 0.06, lz = HALF_W - 0.06;
      if (Math.abs(p.x) > lx) { p.x = Math.sign(p.x) * lx; if (p.vx * Math.sign(p.x) > 0) p.vx = 0; }
      if (Math.abs(p.z) > lz) { p.z = Math.sign(p.z) * lz; if (p.vz * Math.sign(p.z) > 0) p.vz = 0; }
    }
    p.balance = Math.min(1, p.balance + dt * 0.5);
    // Keep players inside the arena floor.
    p.x = clamp(p.x, -HALF_L - 1.8, HALF_L + 1.8);
    p.z = clamp(p.z, -HALF_W - 1.8, HALF_W + 1.8);
  }

  setAction(p, type, dur, data = {}, opts = {}) {
    if (p.action) this.endAction(p, true);
    p.action = { type, t: 0, dur, data, lock: !!opts.lock, slow: opts.slow || 0, face: opts.face ?? null, faceRate: opts.faceRate };
    const h = ACTIONS[type];
    if (h && h.start) h.start(this, p, p.action);
    return p.action;
  }

  endAction(p, interrupted = false) {
    const a = p.action;
    if (!a) return;
    p.action = null;
    const h = ACTIONS[a.type];
    if (h && h.end) h.end(this, p, a, interrupted);
  }

  canAct(p) {
    if (!p.action) return true;
    const t = p.action.type;
    if (t === 'catch' || t === 'contest' && !p.airborne) return true;
    if (t === 'move' && p.action.t > p.action.dur * 0.6) return true;
    return false;
  }

  // ----- Shooting ------------------------------------------------------
  attemptShot(p, opts = {}) {
    const b = this.ball;
    if (b.owner !== p || !this.canAct(p)) return false;
    if (p.inbounding) return false;
    const hoop = this.attackHoop(p.team);
    const dist = distToHoop(p.x, p.z, hoop);
    const towardHoop = this.velTowardHoop(p, hoop);
    const isFT = this.match.phase === 'freethrow';
    if (isFT) return this.startJumper(p, 'ft', opts);
    if (p.posting) {
      return this.startJumper(p, dist < 3.6 ? 'hook' : 'fadeaway', opts);
    }
    const drive = (dist < 4.4 && (towardHoop > 1.6 || dist < 2.3)) || (dist < 5.2 && towardHoop > 4.2);
    if (drive && !opts.forceJumper) return this.startFinish(p, opts);
    if (dist < 4.8 && towardHoop > 2.5) return this.startJumper(p, 'floater', opts);
    let type = 'jumper';
    if (this.t - p.lastCatchT < 0.9 && p.dribblesSinceCatch === 0 && b.state === 'held' && !p.pickedUp) type = 'catchShoot';
    else if (this.t - p.shotReadyT < 0.55) type = 'stepbackJ';
    else if (towardHoop < -1.4 || opts.fade) type = 'fadeaway';
    else if (p.speed > 2.4) type = 'pullup';
    return this.startJumper(p, type, opts);
  }

  velTowardHoop(p, hoop) {
    const h = hoopPos(hoop);
    const dx = h.x - p.x, dz = h.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    return (p.vx * dx + p.vz * dz) / l;
  }

  startJumper(p, type, opts) {
    const st = SHOT_TYPES[type];
    const sp = type === 'ft' ? 1 : p.def.jumper.speed;
    const scale = 1 / sp;
    const hoop = this.attackHoop(p.team);
    const h = hoopPos(hoop);
    const user = !!opts.user;
    const wasMovingSpeed = p.speed;
    this.pickUpDribble(p);
    const data = {
      shotType: type,
      tIdeal: st.ideal * scale,
      jumpT: st.jumpT * scale,
      jumpH: st.jumpH,
      user,
      released: false,
      releaseT: null,
      hoop,
      startSpeed: wasMovingSpeed,
      rhythm: this.t - p.shotReadyT < 0.55,
      catchAndShoot: type === 'catchShoot',
      drift: type === 'fadeaway' ? -1.0 : type === 'stepbackJ' ? -0.3 : 0,
    };
    {
      // Uncontested release window, shown on the shot meter while the shot rises.
      const rk0 = shotRatingKey(type === 'ft' ? 'ft' : 'jumper', distToHoop(p.x, p.z, hoop), type !== 'ft' && isThreePoint(p.x, p.z, hoop));
      data.window = releaseWindow(p, type === 'ft' ? 'ft' : 'jumper', rk0, 0, this.diff, data.catchAndShoot);
    }
    if (!user) {
      // CPU release timing error depends on rating and difficulty.
      const rk = shotRatingKey(type === 'ft' ? 'ft' : 'jumper', distToHoop(p.x, p.z, hoop), isThreePoint(p.x, p.z, hoop));
      const isCpu = p.team !== this.user.team;
      const noise = isCpu ? this.diff.cpuNoise : 0.18;
      const sigma = (0.03 + 0.05 * (1 - p.r(rk))) * (0.7 + noise * 1.5);
      data.aiReleaseT = data.tIdeal + this.rng.gauss() * sigma;
    }
    const face = Math.atan2(h.z - p.z, h.x - p.x);
    this.setAction(p, 'shot', st.dur * scale, data, { lock: true, face, faceRate: type === 'ft' ? 20 : 10 });
    this.emit('shotStart', { player: p, shotType: type, user });
    return true;
  }

  /** Called on release (user or AI). Builds the trajectory from timing, contest and ratings. */
  releaseShot(p, a) {
    const d = a.data;
    if (d.released) return;
    d.released = true;
    const hoop = d.hoop;
    const relT = d.releaseT ?? a.t;
    const err = relT - d.tIdeal;
    const pos = this.heldBallPos(p);
    const dist = distToHoop(p.x, p.z, hoop);
    const three = d.shotType !== 'ft' && isThreePoint(p.x, p.z, hoop);
    const kind = d.shotType === 'ft' ? 'ft' : 'jumper';
    const ratingKey = shotRatingKey(kind, dist, three);
    const contest = d.shotType === 'ft' ? { value: 0, label: 'Open', dir: null } : evaluateContest(p, this.opponents(p), hoop, pos.y);
    const window = releaseWindow(p, kind, ratingKey, contest.value, this.diff, d.catchAndShoot);
    const grade = timingGrade(err, window);
    const assistBoost = this.t - p.lastCatchT < 2 && p.lastPasser ? 0.02 * p.lastPasser.badge('setupArtist') : 0;
    const info = {
      kind, type: d.shotType, ratingKey, dist, three, contest: contest.value,
      moving: d.startSpeed > 3.0 && d.shotType !== 'catchShoot', rhythm: d.rhythm, catchAndShoot: d.catchAndShoot, assistBoost,
    };
    const base = baseMakeProbability(p, info) * (p.team !== this.user.team ? this.diff.cpuShot : 1);
    const prob = finalMakeProbability(base, grade, contest.value, d.user, kind);
    const made = this.rng.chance(prob);
    const target = aimPoint(hoop, made, grade, pos, this.rng);
    const st = SHOT_TYPES[d.shotType];
    const arc = (d.shotType === 'ft' ? 51 : p.def.jumper.arc) + st.arcAdd;
    const sol = solveShot(pos, target, arc, 40);
    this.ball.p.x = pos.x; this.ball.p.y = pos.y; this.ball.p.z = pos.z;
    // Backspin from the wrist flick.
    const fx = sol.v.x, fz = sol.v.z, fl = Math.hypot(fx, fz) || 1;
    this.ball.w.x = (fz / fl) * -18; this.ball.w.y = 0; this.ball.w.z = (fx / fl) * 18;
    const shotInfo = {
      shooter: p, team: p.team, hoop, pts: d.shotType === 'ft' ? 1 : three ? 3 : 2, three, dist,
      intended: made, prob, grade, err, window, contest, type: d.shotType, kind, releaseT: this.t,
      releaseX: p.x, releaseZ: p.z, paint: inPaint(p.x, p.z, hoop), user: d.user,
    };
    this.releaseBall('shot', sol.v, { shot: shotInfo });
    p.inLaneT = 0;
    // Close-outs that fly into the shooter's landing space or hit the arm.
    if (d.shotType !== 'ft' && contest.by && contest.by.distTo(p) < 1.1 && (contest.by.airborne || contest.by.speed > 2.5)) {
      const pf = 0.1 * (1.2 - 0.5 * contest.by.r('defAwareness'));
      if (this.rng.chance(pf)) this.match.foul(contest.by, p, 'shooting', a, 'shooting foul');
    }
    this.lastShotFeedback = shotInfo;
    this.emit('shotRelease', { player: p, shot: shotInfo });
    this.match.onShotRelease(p, shotInfo);
  }

  startFinish(p, opts = {}) {
    const hoop = this.attackHoop(p.team);
    const h = hoopPos(hoop);
    const dist = distToHoop(p.x, p.z, hoop);
    const dunkR = Math.max(p.r('drivingDunk'), p.r('standingDunk'));
    const canDunk = p.maxVertical + p.standingReach > RIM_H + 0.22 && dunkR > 0.45;
    // Defender between finisher and rim.
    let blocker = null, blockerD = 9;
    for (const d of this.opponents(p)) {
      const dd = d.distTo(p);
      const toH = distToHoop(d.x, d.z, hoop);
      if (toH < dist + 0.3 && dd < 2.4 && dd < blockerD) { blocker = d; blockerD = dd; }
    }
    const fromSide = Math.sign((p.z - h.z) || 0.01);
    const baseline = Math.abs(p.x - h.x) < 1.2 && Math.abs(p.z) > 1.0;
    let style = 'standard';
    const wantDunk = opts.dunk ?? (opts.sprint || !opts.user);
    let isDunk = canDunk && dist < 3.9 && (wantDunk || (opts.user && opts.dir === 'up'));
    if (!opts.user && isDunk) {
      const pressure = blocker ? clamp(1 - blockerD / 2.4, 0, 1) : 0;
      isDunk = this.rng.chance(clamp(dunkR * 1.1 - pressure * 0.3 + (p.def.tend.drive - 0.4) * 0.3, 0.1, 0.95));
    }
    if (opts.dir === 'down') isDunk = false;
    if (isDunk) {
      const open = !blocker || blockerD > 1.6;
      const flashy = open && dunkR > 0.8 && p.speed > 4 && this.rng.chance(0.5);
      style = flashy ? this.rng.pick(['windmill', 'tomahawk', 'reverse']) : (blocker && blockerD < 1.4 ? 'power' : p.speed < 2 ? 'standing' : this.rng.pick(['oneHand', 'twoHand']));
      return this.startDunk(p, style, opts);
    }
    if (opts.dir === 'left' || opts.dir === 'right') style = 'euro';
    else if (opts.dir === 'down') style = 'hop';
    else if (p.pickedUp && p.action === null && opts.stepThrough) style = 'stepThrough';
    else if (blocker && blockerD < 1.3 && blocker.airborne) style = 'upAndUnder';
    else if (blocker && blockerD < 1.8) style = this.rng.pick(['euro', 'hop', 'spinLayup', 'euro']);
    else if (baseline) style = 'reverse';
    else if (dist > 3.2) style = 'fingerRoll';
    if (!opts.user && blocker && blockerD < 1.5 && p.r('layup') > 0.6 && this.rng.chance(0.4)) style = 'euro';
    return this.startLayup(p, style, { ...opts, blocker, fromSide });
  }

  startLayup(p, style, opts) {
    const hoop = this.attackHoop(p.team);
    const h = hoopPos(hoop);
    const dist = distToHoop(p.x, p.z, hoop);
    this.pickUpDribble(p);
    // Hand: finish with the hand away from the help / on the approach side.
    let hand = p.hand;
    const sideOfHoop = Math.sign(p.z - h.z) || 1;
    const towardBaseline = hoopSign(hoop);
    hand = sideOfHoop * -towardBaseline > 0 ? 1 : -1;
    if (opts.blocker) {
      const bx = opts.blocker.x - p.x, bz = opts.blocker.z - p.z;
      const cross = p.fx * bz - p.fz * bx;
      hand = cross > 0 ? 1 : -1;
    }
    const gather = style === 'hop' ? 0.5 : style === 'euro' ? 0.55 : style === 'spinLayup' ? 0.6 : 0.42;
    const takeoffT = gather;
    const releaseT = takeoffT + (style === 'fingerRoll' ? 0.28 : style === 'upAndUnder' || style === 'stepThrough' ? 0.42 : 0.34);
    // Takeoff spot: ~1.1 m from the rim along the approach (further for floater-style finger roll).
    const dirx = (h.x - p.x) / (dist || 1), dirz = (h.z - p.z) / (dist || 1);
    const stopD = style === 'fingerRoll' ? Math.max(1.6, dist - 1.6) : clamp(dist - 1.7, 0.7, 2.0);
    const travel = Math.max(0.2, dist - stopD);
    const takeoff = { x: p.x + dirx * travel, z: p.z + dirz * travel };
    const latX = -dirz, latZ = dirx;
    let latAmt = 0;
    if (style === 'euro') latAmt = (opts.dir === 'left' ? 1 : opts.dir === 'right' ? -1 : hand) * 0.85;
    if (style === 'spinLayup') latAmt = hand * 0.5;
    const data = {
      style, hand, takeoffT, releaseT, hoop, start: { x: p.x, z: p.z }, takeoff, latX, latZ, latAmt,
      user: !!opts.user, held: !!opts.user, releaseUserT: null, adjusted: false, entrySpeed: p.speed,
      meter: opts.user && this.settings.layupTiming,
    };
    data.timingCenter = takeoffT + 0.12;
    data.timingWindow = 0.05 + 0.04 * p.r('layup');
    const dur = releaseT + 0.55;
    this.setAction(p, 'layup', dur, data, { lock: true, face: Math.atan2(dirz, dirx), faceRate: 8 });
    this.emit('finishStart', { player: p, style, dunk: false });
    return true;
  }

  startDunk(p, style, opts) {
    const hoop = this.attackHoop(p.team);
    const h = hoopPos(hoop);
    const dist = distToHoop(p.x, p.z, hoop);
    this.pickUpDribble(p);
    const standing = style === 'standing' || dist < 1.4;
    const takeoffT = standing ? 0.35 : 0.45;
    const slamT = takeoffT + 0.38 + (style === 'windmill' || style === 'reverse' ? 0.12 : 0);
    const dirx = (h.x - p.x) / (dist || 1), dirz = (h.z - p.z) / (dist || 1);
    const takeoffDist = standing ? Math.min(dist, 0.9) : clamp(dist - 1.4, 0.4, 2.6);
    const takeoff = { x: p.x + dirx * Math.max(0, dist - (standing ? 0.7 : 1.35)), z: p.z + dirz * Math.max(0, dist - (standing ? 0.7 : 1.35)) };
    const data = {
      style, takeoffT, slamT, hoop, start: { x: p.x, z: p.z }, takeoff, takeoffDist, hand: p.hand,
      user: !!opts.user, held: !!opts.user, releaseUserT: null, decided: false, success: true, hang: 0,
      meterCenter: takeoffT - 0.06, meterWindow: 0.06, pressure: 0,
    };
    this.setAction(p, 'dunk', slamT + 0.65, data, { lock: true, face: Math.atan2(dirz, dirx), faceRate: 10 });
    this.emit('finishStart', { player: p, style, dunk: true });
    return true;
  }

  finishPressure(p, hoop) {
    // Logic-driven dunk/layup pressure: rim protectors near the finisher and the rim.
    let pr = 0;
    const h = hoopPos(hoop);
    for (const d of this.opponents(p)) {
      const dd = d.distTo(p);
      const dr = Math.hypot(d.x - h.x, d.z - h.z);
      if (dd > 3) continue;
      let c = clamp((2.6 - dd) / 2.0, 0, 1) * (dr < 2.5 ? 1 : 0.6);
      c *= 0.6 + 0.4 * Math.max(d.r('block'), d.r('interiorD'));
      c *= 1 + (d.heightM - p.heightM) * 0.8;
      if (d.airborne) c *= 1.2;
      if (d.stumble > 0) c *= 0.2;
      pr = Math.max(pr, c);
    }
    return clamp(pr, 0, 1);
  }

  // ----- Passing -------------------------------------------------------
  /** Pick a receiver from a world-space direction (or best option when no direction). */
  pickReceiver(p, dirX, dirZ) {
    const mates = this.teammates(p);
    const has = Math.hypot(dirX, dirZ) > 0.2;
    let best = null, bestS = -1e9;
    for (const m of mates) {
      const dx = m.x - p.x, dz = m.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      let s;
      if (has) {
        const cos = (dx * dirX + dz * dirZ) / (d * Math.hypot(dirX, dirZ));
        s = cos * 3 - d * 0.05;
      } else {
        s = this.ai[p.team].opennessOf(m) * 2 - d * 0.04;
      }
      if (s > bestS) { bestS = s; best = m; }
    }
    return best;
  }

  attemptPass(p, kind, target, opts = {}) {
    const b = this.ball;
    if (b.owner !== p || !target || target === p) return false;
    if (!this.canAct(p) && !(p.action && p.action.type === 'shot' && !p.action.data.released && p.action.t < p.action.data.tIdeal * 0.8)) return false;
    if (p.action && p.action.type === 'shot') {
      // Pass out of a shot (pass fake/jump pass).
      p.action = null;
    }
    const windup = kind === 'lob' ? 0.22 : kind === 'bounce' ? 0.18 : 0.14;
    this.setAction(p, 'pass', windup + 0.25, { kind, target, windup, released: false, alleyOop: !!opts.alleyOop, inbound: !!opts.inbound }, { slow: 0.6 });
    target.ai.expectPass = this.t;
    this.emit('passStart', { player: p, target, kind });
    return true;
  }

  releasePass(p, a) {
    const d = a.data;
    const target = d.target;
    const from = this.heldBallPos(p);
    const dist = Math.hypot(target.x - from.x, target.z - from.z);
    const acc = p.r('passAccuracy') * (p.takeoverOn('playmaking') ? 1.1 : 1);
    let T, aim;
    const lead = (tt) => {
      let lx = target.vx * tt * 0.6, lz = target.vz * tt * 0.6;
      const ll = Math.hypot(lx, lz);
      if (ll > 1.4) { lx *= 1.4 / ll; lz *= 1.4 / ll; }
      return { x: target.x + lx, z: target.z + lz };
    };
    if (d.alleyOop) {
      const hoop = this.attackHoop(p.team);
      const h = hoopPos(hoop);
      T = clamp(0.75 + dist / 22, 0.8, 1.35);
      const dx = target.x - h.x, dz = target.z - h.z;
      const l = Math.hypot(dx, dz) || 1;
      aim = { x: h.x + (dx / l) * 0.55, y: RIM_H + 0.42, z: h.z + (dz / l) * 0.55 };
      target.ai.alleyOop = { t: this.t + T, x: aim.x, z: aim.z, y: aim.y };
    } else if (d.kind === 'lob') {
      T = 0.75 + dist / 24;
      const L = lead(T);
      aim = { x: L.x, y: target.standingReach - 0.25, z: L.z };
    } else if (d.kind === 'bounce') {
      T = dist / 11 + 0.08;
      const L = lead(T);
      aim = { x: L.x, y: target.heightM * 0.5, z: L.z };
    } else {
      const speed = 11 + 4 * p.r('passAccuracy');
      T = dist / speed + 0.05;
      const L = lead(T);
      aim = { x: L.x, y: target.heightM * 0.62, z: L.z };
    }
    const err = (1 - acc) * dist * 0.05;
    aim.x += this.rng.gauss() * err;
    aim.z += this.rng.gauss() * err;
    let v;
    if (d.kind === 'bounce' && !d.alleyOop) {
      // First leg hits the floor 62% of the way, the bounce carries it to the hands.
      const bx = from.x + (aim.x - from.x) * 0.62, bz = from.z + (aim.z - from.z) * 0.62;
      const T1 = T * 0.55;
      v = solveTimedDrag(from, { x: bx, y: BALL_R, z: bz }, T1);
    } else {
      v = solveTimedDrag(from, aim, T);
    }
    this.ball.p.x = from.x; this.ball.p.y = from.y; this.ball.p.z = from.z;
    this.ball.w.x = 0; this.ball.w.y = 0; this.ball.w.z = 0;
    this.releaseBall('pass', v, { passer: p, target, passKind: d.kind, eta: this.t + T, intercepts: new Set(), alleyOop: d.alleyOop, inbound: d.inbound });
    p.inbounding = false;
    this.emit('pass', { player: p, target, kind: d.kind, alleyOop: d.alleyOop });
    if (d.alleyOop) this.setAction(target, 'alleyoop', T + 0.9, { catchT: T, aim: target.ai.alleyOop, caught: false, hoop: this.attackHoop(p.team) }, { lock: true });
  }

  // ----- Dribble moves -------------------------------------------------
  attemptMove(p, move, opts = {}) {
    const b = this.ball;
    const m = MOVES[move];
    if (!m || b.owner !== p) return false;
    if (p.action && !(p.action.type === 'move' && p.action.t > p.action.dur * 0.55)) return false;
    if (m.triple) {
      if (!p.tripleThreat) return false;
    } else if (m.post) {
      if (!p.posting) return false;
      if (b.state !== 'dribble') this.startDribble(p);
    } else {
      if (b.state === 'held') {
        if (p.pickedUp) {
          // Trying to dribble again after picking up the ball.
          this.match.violation('double dribble', p.team, { x: p.x, z: p.z });
          return false;
        }
        this.startDribble(p);
      }
    }
    if (opts.checkBounds) {
      // AI sanity check: don't dribble out of bounds or back over half court.
      const prevHandC = p.hand;
      const sideC = m.side === 'new' ? -prevHandC : m.side === 'ball' ? prevHandC : 0;
      const ex = p.x + p.fx * m.fwd + p.rx * m.lat * sideC + p.vx * m.dur * 0.7;
      const ez = p.z + p.fz * m.fwd + p.rz * m.lat * sideC + p.vz * m.dur * 0.7;
      if (Math.abs(ex) > HALF_L - 0.7 || Math.abs(ez) > HALF_W - 0.7) return false;
      const s = hoopSign(this.attackHoop(p.team));
      if (this.match.frontcourt && !this.match.halfCourt && ex * s < 1.0) return false;
    }
    const chained = p.action && p.action.type === 'move';
    const combo = chained || this.t - p.lastMoveT < 0.35 ? p.moveCombo + 1 : 0;
    // Ball-handling rating (and Tight Handles) speeds the move up; long combos tire you out.
    let speed = 0.86 + 0.28 * p.r('ballHandle') + 0.03 * p.badge('tightHandles');
    if (p.takeoverOn('playmaking')) speed *= 1.06;
    if (p.stamina < 0.4) speed *= 0.9;
    if (this.t - p.lastSizeupT < 1.0 && move !== 'sizeup') speed *= 1.1;
    const dur = m.dur / speed;
    const prevHand = p.hand;
    const sideSign = m.side === 'new' ? -prevHand : m.side === 'ball' ? prevHand : 0;
    let hoopSide = 0;
    if (m.post) {
      const h = hoopPos(this.attackHoop(p.team));
      hoopSide = Math.atan2(h.z - p.z, h.x - p.x);
    }
    const entry = Math.hypot(p.vx, p.vz);
    const data = {
      move, m, prevHand, sideSign, startFacing: p.facing, entry, entryDir: Math.atan2(p.vz, p.vx), combo, hoopSide,
      handSwitched: false,
    };
    if (p.action) p.action = null;
    this.setAction(p, 'move', dur, data, { lock: true });
    p.moveCombo = combo;
    p.lastMoveT = this.t;
    if (move === 'sizeup') p.lastSizeupT = this.t;
    p.stamina = Math.max(0.05, p.stamina - m.cost * (1.2 - 0.6 * p.r('stamina')) * (1 - 0.08 * p.badge('tightHandles')));
    this.emit('dribbleMove', { player: p, move, label: m.label, combo });
    // Defender reaction: moves against a committed defender cost him balance.
    const def = this.ai[1 - p.team].onBallDefender();
    if (def && def.distTo(p) < 2.6) this.applyMoveToDefender(p, def, m, sideSign);
    return true;
  }

  applyMoveToDefender(p, d, m, sideSign) {
    let lx = 0, lz = 0;
    if (sideSign !== 0) { lx = p.rx * sideSign; lz = p.rz * sideSign; }
    else if (m.fwd < 0) { lx = -p.fx; lz = -p.fz; }
    else { lx = p.fx; lz = p.fz; }
    const committed = -(d.vx * lx + d.vz * lz); // defender moving the opposite way
    const handle = p.r('ballHandle');
    let hit = 0;
    if (committed > 0.6) hit = m.quality * (0.3 + 0.7 * handle) * (committed / 3.2);
    if (m.path === 'hesi' && Math.hypot(d.vx, d.vz) > 2.4) hit = Math.max(hit, 0.35 * m.quality * handle);
    if (m.path === 'stepback' && (d.vx * p.fx + d.vz * p.fz) < -1.5) hit = Math.max(hit, 0.3 * handle);
    hit *= 1 - 0.55 * d.r('agility') - 0.15 * d.r('perimeterD');
    hit *= 1 + 0.12 * p.badge('ankleBreaker');
    if (d.intent.stance) hit *= 0.7;
    hit *= 1 - 0.04 * d.badge('lockdown');
    if (hit <= 0) return;
    d.balance -= hit;
    if (d.balance < 0 && !d.airborne) {
      this.setAction(d, 'fall', 1.7, { fromX: lx, fromZ: lz }, { lock: true });
      d.vx *= 0.3; d.vz *= 0.3;
      d.stumble = 1.7;
      this.emit('ankleBreaker', { player: p, defender: d, move: m.label });
      this.replayHighlight = { kind: 'Ankle Breaker', t: this.t, player: p };
      this.takeover.add(p, 'playmaking', 14);
    } else if (d.balance < 0.32 && !d.airborne) {
      d.stumble = 0.55;
      this.setAction(d, 'stumble', 0.55, { fromX: lx, fromZ: lz }, { slow: 0.8 });
      this.emit('stagger', { player: p, defender: d });
      this.takeover.add(p, 'playmaking', 5);
    }
  }

  // ----- Defence actions ----------------------------------------------
  attemptSteal(p) {
    if (p.cooldowns.steal > 0 || !this.canAct(p)) return false;
    p.cooldowns.steal = 0.75;
    this.setAction(p, 'steal', 0.42, { resolved: false }, { slow: 0.4 });
    return true;
  }

  attemptBlock(p, kind = 'block') {
    if (p.airborne || p.cooldowns.block > 0) return false;
    if (p.action && p.action.lock) return false;
    p.cooldowns.block = 1.0;
    const h = kind === 'block' ? p.maxVertical : kind === 'rebound' ? p.maxVertical * 0.95 : p.maxVertical * 0.55;
    this.setAction(p, kind, kind === 'contest' ? 0.75 : 0.95, { jumpH: h, blocked: false }, { lock: false, slow: 0.5 });
    p.jump(h);
    return true;
  }

  // ---------------------------------------------------------------------
  // User input
  // ---------------------------------------------------------------------
  applyUserInput(p, inp) {
    const it = p.intent;
    it.mx = inp.moveX; it.mz = inp.moveZ;
    it.sprint = inp.sprint;
    it.walk = false;
    it.handsUp = !!inp.handsUp;
    it.faceX = null; it.faceZ = null;
    const b = this.ball;
    const hasBall = b.owner === p && (b.state === 'held' || b.state === 'dribble');
    const phase = this.match.phase;
    const myTeamHasBall = this.match.possTeam === p.team && (b.state === 'held' || b.state === 'dribble' || (b.air && b.air.kind === 'pass' && b.air.passer && b.air.passer.team === p.team));
    it.stance = !!inp.stance && !hasBall;

    if (inp.switchPlayer) this.switchUserPlayer();
    if (inp.timeout) this.match.requestTimeout(p.team);

    if (phase === 'tipoff') {
      if (inp.jump && this.match.tip && this.match.tip.jumpers.includes(p)) this.match.userTipJump(p);
      it.mx = 0; it.mz = 0;
      return;
    }
    if (phase === 'freethrow') {
      it.mx = 0; it.mz = 0;
      if (hasBall && this.match.ft && this.match.ft.shooter === p) {
        if (inp.shootPressed && !p.action) this.attemptShot(p, { user: true });
      }
      this.handleShotRelease(p, inp);
      return;
    }

    if (hasBall) {
      if (p.inbounding) {
        it.mx = 0; it.mz = 0;
        const kind = inp.lob ? 'lob' : inp.bounce ? 'bounce' : inp.pass ? 'chest' : null;
        if (kind) {
          const target = this.pickReceiver(p, inp.moveX, inp.moveZ);
          this.attemptPass(p, kind, target, { inbound: true });
        }
        return;
      }
      // Post up toggle near the paint.
      const hoop = this.attackHoop(p.team);
      const dist = distToHoop(p.x, p.z, hoop);
      if (inp.post && dist < 6.2 && !p.action) {
        p.posting = !p.posting;
        if (p.posting && b.state === 'held' && !p.pickedUp) this.startDribble(p);
      }
      if (dist > 7.5) p.posting = false;
      if (p.posting) {
        // Back down: face away from the hoop while moving.
        const h = hoopPos(hoop);
        it.faceX = p.x - (h.x - p.x);
        it.faceZ = p.z - (h.z - p.z);
        it.sprint = false;
      }
      // Low protective dribble while holding stance with the ball.
      b.dribble.style = inp.stance ? 'low' : (inp.sprint && p.speed > 4 ? 'sprint' : 'normal');

      if (inp.shootPressed) {
        let dir = null;
        if (inp.rs && Math.hypot(inp.rs.x, inp.rs.z) > 0.5) dir = this.localDir(p, inp.rs.x, inp.rs.z);
        if (p.pickedUp && !p.action && dist < 4.5) {
          this.startFinish(p, { user: true, stepThrough: true, sprint: inp.sprint, dir });
        } else {
          this.attemptShot(p, { user: true, sprint: inp.sprint, dir, fade: inp.stance });
        }
      }
      this.handleShotRelease(p, inp);
      const passKind = inp.lob ? 'lob' : inp.bounce ? 'bounce' : inp.pass ? 'chest' : null;
      if (passKind || inp.icon !== null) {
        let target;
        if (inp.icon !== null && inp.icon !== undefined) {
          const mates = this.teammates(p);
          target = mates[inp.icon];
        } else {
          target = this.pickReceiver(p, inp.moveX, inp.moveZ);
        }
        const alley = passKind === 'lob' && target && this.isAlleyOopCandidate(target);
        if (target) this.attemptPass(p, passKind || 'chest', target, { alleyOop: alley });
      }
      if (inp.flick && !p.pickedUp) {
        const l = this.localDir(p, inp.flick.x, inp.flick.z, true);
        const mv = classifyFlick(l.r, l.f, p.hand, { triple: p.tripleThreat && b.state === 'held', posting: p.posting, speed: p.speed, sprint: inp.sprint });
        if (mv) this.attemptMove(p, mv);
      } else if (inp.flick && p.pickedUp) {
        this.match.violation('double dribble', p.team, { x: p.x, z: p.z });
      }
      if (inp.sizeup) this.attemptMove(p, 'sizeup');
      if (inp.spin) this.attemptMove(p, inp.stance ? 'halfSpin' : 'spin');
      // Travelling: running with a picked-up ball.
      if (b.state === 'held' && p.pickedUp && inp.sprint && Math.hypot(inp.moveX, inp.moveZ) > 0.6 && !p.action) {
        p.travelT = (p.travelT || 0) + SIM_DT;
        if (p.travelT > 0.45) { p.travelT = 0; this.match.violation('traveling', p.team, { x: p.x, z: p.z }); }
      } else p.travelT = 0;
      return;
    }

    if (myTeamHasBall) {
      // Off-ball offence.
      if (inp.pass) this.user.requests.callForBall = this.t;
      if (inp.callScreen) this.user.requests.screen = this.t;
      if (inp.lob) this.user.requests.alleyOop = this.t;
      if (inp.shootPressed && b.air && b.air.kind === 'pass' && b.air.target === p) p.queueShot = true;
      if (inp.post) this.user.requests.postUp = this.t;
      return;
    }

    // Defence / loose ball.
    const handler = this.holder();
    if (it.stance) {
      const tgt = handler || b.p;
      it.faceX = tgt.x; it.faceZ = tgt.z;
    }
    if (inp.steal) {
      this.attemptSteal(p);
    }
    if (inp.jump) {
      const loose = b.state === 'air' && (b.air.kind !== 'pass');
      const shooter = handler && handler.action && ['shot', 'layup', 'dunk'].includes(handler.action.type) ? handler : null;
      if (shooter && shooter.distTo(p) < 2.6) this.attemptBlock(p, 'block');
      else if (loose) this.attemptBlock(p, 'rebound');
      else this.attemptBlock(p, handler && handler.distTo(p) < 2.2 ? 'contest' : 'block');
    }
    if (inp.takeCharge && !p.action) {
      it.mx = 0; it.mz = 0;
      p.vx *= 0.5; p.vz *= 0.5;
      p.chargeT = this.t;
    }
  }

  handleShotRelease(p, inp) {
    const a = p.action;
    if (!a || !a.data || !a.data.user) return;
    if (a.type === 'shot' && !a.data.released && a.data.releaseT === null && !inp.shootDown) {
      if (a.t < 0.14 * (a.dur / 1.1) && a.data.shotType !== 'ft') {
        // Quick tap: pump fake.
        p.action = null;
        this.setAction(p, 'pumpfake', 0.45, {}, { lock: true });
        this.emit('pumpFake', { player: p });
        return;
      }
      a.data.releaseT = a.t;
    }
    if ((a.type === 'dunk' || a.type === 'layup') && a.data.held && !inp.shootDown) {
      a.data.held = false;
      a.data.releaseUserT = a.t;
    }
  }

  isAlleyOopCandidate(t) {
    const hoop = this.attackHoop(t.team);
    const d = distToHoop(t.x, t.z, hoop);
    return d < 7 && d > 1.2 && this.velTowardHoop(t, hoop) > 1.5 && t.maxVertical + t.standingReach > RIM_H + 0.35;
  }

  localDir(p, x, z, raw = false) {
    const f = x * p.fx + z * p.fz;
    const r = x * p.rx + z * p.rz;
    if (raw) return { f, r };
    if (Math.abs(f) > Math.abs(r)) return f > 0 ? 'up' : 'down';
    // r>0 means player's right; map to screen-agnostic euro direction.
    return r > 0 ? 'right' : 'left';
  }

  switchUserPlayer(target = null) {
    const team = this.teams[this.user.team];
    if (!target) {
      const bp = this.ball.owner || this.ball.p;
      let best = null, bd = 1e9;
      for (const q of team.onCourt) {
        if (q === this.user.player) continue;
        const d = Math.hypot(q.x - bp.x, q.z - bp.z);
        if (d < bd) { bd = d; best = q; }
      }
      target = best;
    }
    if (target) this.setUserPlayer(target);
  }

  // ---------------------------------------------------------------------
  // Collisions and contact
  // ---------------------------------------------------------------------
  resolveCollisions() {
    const ps = this.players;
    // A ball handler standing in bounds can't be shoved out by contact alone.
    const h = this.holder();
    const hin = h && !h.inbounding && Math.abs(h.x) <= HALF_L - 0.02 && Math.abs(h.z) <= HALF_W - 0.02;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], c = ps[j];
        const dx = c.x - a.x, dz = c.z - a.z;
        const d = Math.hypot(dx, dz);
        const minD = a.radius + c.radius;
        if (d >= minD || d < 1e-5) continue;
        // Airborne players only collide with others near their height.
        if (Math.abs(a.y - c.y) > 0.9) continue;
        const nx = dx / d, nz = dz / d;
        const overlap = minD - d;
        const sa = a.mass * (0.6 + 0.8 * a.r('strength') + 0.05 * a.badge('brickWall'));
        const sc = c.mass * (0.6 + 0.8 * c.r('strength') + 0.05 * c.badge('brickWall'));
        const wa = sc / (sa + sc);
        a.x -= nx * overlap * wa; a.z -= nz * overlap * wa;
        c.x += nx * overlap * (1 - wa); c.z += nz * overlap * (1 - wa);
        const rel = (c.vx - a.vx) * nx + (c.vz - a.vz) * nz;
        if (rel < 0) {
          // Inelastic body contact: each player loses the velocity component driving into the
          // other (the stronger/heavier one keeps more of it); overlap resolution does the pushing.
          const van = a.vx * nx + a.vz * nz;
          const vcn = c.vx * nx + c.vz * nz;
          if (van > 0) { const k = van * (0.55 + 0.45 * wa); a.vx -= nx * k; a.vz -= nz * k; }
          if (vcn < 0) { const k = vcn * (0.55 + 0.45 * (1 - wa)); c.vx -= nx * k; c.vz -= nz * k; }
        }
        if (a.team !== c.team) this.onContact(a, c, nx, nz, -rel);
        else this.onScreenContact(a, c);
      }
    }
    if (hin && this.holder() === h) this.clampHolderInBounds(h);
  }

  clampHolderInBounds(h) {
    h.x = clamp(h.x, -HALF_L + 0.03, HALF_L - 0.03);
    h.z = clamp(h.z, -HALF_W + 0.03, HALF_W - 0.03);
  }

  onScreenContact() {}

  onContact(a, c, nx, nz, closing) {
    const key = a.id < c.id ? `${a.id}|${c.id}` : `${c.id}|${a.id}`;
    if (this.contactCooldown.has(key)) return;
    const b = this.ball;
    const off = a.team === this.match.possTeam ? a : c;
    const def = off === a ? c : a;
    // Screens: a defender running into a set screener is slowed.
    if (off.ai && off.ai.screening && b.owner !== off) {
      this.contactCooldown.set(key, this.t + 0.5);
      def.vx *= 0.25; def.vz *= 0.25;
      def.stumble = Math.max(def.stumble, 0.25 + 0.05 * off.badge('brickWall'));
      this.emit('screenContact', { screener: off, defender: def });
      if (off.speed > 1.4 && this.rng.chance(0.35)) {
        this.match.foul(off, def, 'offensive', null, 'moving screen');
      }
      return;
    }
    const shooterAct = off.action && ['shot', 'layup', 'dunk', 'alleyoop'].includes(off.action.type) ? off.action : null;
    if (shooterAct && (off.airborne || def.airborne) && closing > 0.4) {
      this.contactCooldown.set(key, this.t + 1.0);
      this.shootingContact(off, def, closing, shooterAct);
      return;
    }
    if (b.owner === off && closing > 1.2) {
      this.contactCooldown.set(key, this.t + 0.7);
      this.driveContact(off, def, closing, nx, nz);
    }
  }

  shootingContact(off, def, closing, act) {
    const defMovingIn = Math.hypot(def.vx, def.vz) > 1.3;
    const vertical = def.airborne && !defMovingIn;
    let p = vertical ? 0.1 : defMovingIn ? 0.55 : 0.32;
    p *= clamp(closing / 2.2, 0.4, 1.3);
    if (act.type === 'dunk' && off.badge('posterThreat') >= 3) p *= 0.8;
    p *= 1 - 0.3 * def.r('defAwareness');
    if (this.rng.chance(p)) {
      this.match.foul(def, off, 'shooting', act, 'shooting foul');
    } else {
      this.emit('bodyContact', { a: off, b: def, strength: closing });
    }
  }

  driveContact(off, def, closing, nx, nz) {
    const hoop = this.attackHoop(off.team);
    const defSet = def.speed < 1.0 && ((off.x - def.x) * def.fx + (off.z - def.z) * def.fz) > 0;
    const inRA = inRestrictedArea(def.x, def.z, hoop);
    const charging = def.chargeT && this.t - def.chargeT < 1.2;
    if (defSet && !inRA && closing > 2.8) {
      const pc = (charging ? 0.75 : 0.42) * (1 - 0.05 * off.badge('strongFinisher'));
      if (this.rng.chance(pc)) { this.match.foul(off, def, 'offensive', null, 'charge'); return; }
    } else if (!defSet && (def.vx * (off.x - def.x) + def.vz * (off.z - def.z)) / (def.distTo(off) || 1) > 1.6 && closing > 2.4) {
      // Defender still moving into the driver's path: blocking foul.
      if (this.rng.chance(0.3 * (1 - 0.4 * def.r('defAwareness')))) { this.match.foul(def, off, 'personal', null, 'blocking foul'); return; }
    }
    // Hand-check / body foul on a hard drive.
    if (closing > 2.0 && this.rng.chance(0.09 * (1.2 - 0.6 * def.r('perimeterD')))) {
      this.match.foul(def, off, 'personal', null, 'blocking foul');
      return;
    }
    // No call: a cutoff. Ratings decide whether the contact jars the ball loose.
    off.vx *= 0.45; off.vz *= 0.45;
    if (!off.action) this.setAction(off, 'bump', 0.3, { nx, nz }, { slow: 0.7 });
    const pLoose = clamp(0.012 + (def.r('strength') - off.r('ballHandle')) * 0.08 + 0.015 * def.badge('lockdown') - 0.01 * off.badge('tightHandles') + closing * 0.008, 0.005, 0.12);
    if (this.ball.state === 'dribble' && this.rng.chance(pLoose)) {
      const b = this.ball;
      this.looseBall({ x: off.vx * 0.5 - nx * 1.5 + this.rng.range(-1, 1), y: 1.2, z: off.vz * 0.5 - nz * 1.5 + this.rng.range(-1, 1) }, def);
      b.air.strippedFrom = off;
      this.pendingSteal = { player: def, t: this.t, from: off };
      this.emit('strip', { player: def, from: off });
    } else {
      this.emit('cutoff', { player: def, from: off });
    }
  }

  // ---------------------------------------------------------------------
  // Ball update
  // ---------------------------------------------------------------------
  updateBall(dt) {
    const b = this.ball;
    b.prevP.x = b.p.x; b.prevP.y = b.p.y; b.prevP.z = b.p.z;
    if (b.state === 'held') {
      const pos = this.heldBallPos(b.owner);
      b.v.x = (pos.x - b.p.x) / dt; b.v.y = (pos.y - b.p.y) / dt; b.v.z = (pos.z - b.p.z) / dt;
      b.p.x = pos.x; b.p.y = pos.y; b.p.z = pos.z;
      b.w.x *= 0.9; b.w.z *= 0.9;
      this.checkHeldBlocks(dt);
    } else if (b.state === 'dribble') {
      this.updateDribble(b.owner, dt);
    } else if (b.state === 'air') {
      b.air.t += dt;
      this.checkBlocksInFlight();
      if (b.state !== 'air') return;
      const out = stepFreeBall(b, dt);
      this.handleContacts(out);
      if (b.state !== 'air') return;
      this.checkCatches(dt);
    } else if (b.state === 'dead') {
      stepFreeBall(b, dt);
    }
  }

  updateDribble(p, dt) {
    const b = this.ball;
    const d = b.dribble;
    const a = p.action;
    const style = d.style || 'normal';
    let period = clamp(0.62 - p.speed * 0.032, 0.4, 0.62);
    if (style === 'low') period *= 0.78;
    let targetSide = p.hand;
    let fwd = 0.2 + Math.min(p.speed, 8) * 0.055;
    let lat = 0.3;
    let handH = p.dribbleHeight(p.speed > 5 ? 'sprint' : style);
    if (a && a.type === 'move') {
      const m = a.data.m;
      const u = clamp(a.t / a.dur, 0, 1);
      period = a.dur / (m.path === 'sizeup' ? 2 : 1);
      if (m.switchHand) {
        if (m.path === 'behind') { fwd = lerp(0.2, -0.25, Math.sin(u * Math.PI)); }
        if (m.path === 'legs') { fwd = lerp(0.2, 0.05, Math.sin(u * Math.PI)); lat = 0.3; }
      }
      if (m.path === 'sizeup') {
        // Between-the-legs rhythm: ball crosses twice.
        targetSide = u < 0.5 ? -a.data.prevHand : a.data.prevHand;
        fwd = 0.08;
      }
      if (m.path === 'inout') { lat = 0.3 + 0.25 * Math.sin(u * Math.PI); }
      if (m.path === 'hesi') { handH *= 1.1; }
      if (m.path === 'jab') { handH = p.heightM * 0.5; }
    }
    if (p.posting) { fwd = -0.15; lat = 0.35; period = 0.55; }
    const prevPhase = d.phase;
    d.phase += dt / period;
    if (prevPhase < 0.5 && d.phase >= 0.5) {
      this.emit('dribbleBounce', { player: p, x: b.p.x, z: b.p.z, strength: handH });
      p.dribblesSinceCatch++;
    }
    if (d.phase >= 1) {
      d.phase -= 1;
      // A new bounce cycle starts from the hand that now holds the ball.
      d.fromSide = d.side;
      d.cross = 0;
    }
    if (targetSide !== d.side) {
      d.fromSide = d.side;
      d.side = targetSide;
      d.cross = 0;
    }
    d.cross = Math.min(1, d.cross + dt / (period * 0.95));
    const sideNow = lerp(d.fromSide, d.side, smoothstep(0, 1, d.cross));
    const ph = d.phase;
    const y = BALL_R + (handH - BALL_R) * Math.abs(Math.cos(Math.PI * ph));
    const nx = p.x + p.fx * fwd + p.rx * sideNow * lat;
    const nz = p.z + p.fz * fwd + p.rz * sideNow * lat;
    b.v.x = (nx - b.p.x) / dt; b.v.y = (y - b.p.y) / dt; b.v.z = (nz - b.p.z) / dt;
    b.p.x = nx; b.p.y = y; b.p.z = nz;
    // Roll the ball forward visually.
    b.w.x = p.vz / BALL_R * 0.5; b.w.z = -p.vx / BALL_R * 0.5;
  }

  /** Blocks on finishers before release (ball still in hands) — stuffs and strips at the rim. */
  checkHeldBlocks() {
    const b = this.ball;
    const p = b.owner;
    if (!p || !p.action) return;
    const t = p.action.type;
    if (t !== 'layup' && t !== 'dunk' && t !== 'shot' && t !== 'alleyoop') return;
    if (t === 'shot' && p.action.data.shotType === 'ft') return;
    for (const d of this.opponents(p)) {
      if (!d.action || d.action.type !== 'block' || d.action.data.blocked) continue;
      const hx = d.x + (b.p.x - d.x) * 0.5, hz = d.z + (b.p.z - d.z) * 0.5;
      const hy = d.reachNow();
      const dist = Math.hypot(b.p.x - hx, b.p.z - hz);
      if (dist > 0.55 + (d.wingM - d.heightM) * 0.5 || hy < b.p.y - 0.1 || d.y < 0.12) continue;
      d.action.data.blocked = true;
      const skill = 0.25 + 0.45 * d.r('block') + 0.05 * d.badge('paintWall') + (d.takeoverOn('defense') ? 0.08 : 0);
      const protect = t === 'dunk' ? 0.25 + 0.4 * p.r('drivingDunk') + 0.04 * p.badge('posterThreat') : t === 'layup' ? 0.15 + 0.35 * p.r('layup') + 0.04 * p.badge('bodyControl') : 0.1;
      const adjusted = p.action.data && p.action.data.adjusted ? 0.25 : 0;
      if (this.rng.chance(clamp(skill - protect * 0.6 - adjusted, 0.05, 0.85))) {
        this.blockBall(d, p, true);
        return;
      }
      // Missed the ball: contact on the arm/body is a shooting foul.
      const contact = (t === 'shot' ? 0.18 : 0.42) * (1.15 - 0.5 * d.r('defAwareness')) * (1 + 0.05 * p.badge('strongFinisher'));
      if (this.rng.chance(contact)) { this.match.foul(d, p, 'shooting', p.action, 'shooting foul'); return; }
    }
  }

  blockBall(d, shooter, held) {
    const b = this.ball;
    const hoop = this.attackHoop(shooter.team);
    const h = hoopPos(hoop);
    const ax = shooter.x - h.x, az = shooter.z - h.z;
    const al = Math.hypot(ax, az) || 1;
    const sp = this.rng.range(3, 7);
    const shot = b.air && b.air.shot ? b.air.shot : this.makeBlockedShotInfo(shooter, hoop);
    if (held && shooter.action) {
      shooter.action.data.blockedHeld = true;
    }
    b.state = 'air';
    b.owner = null;
    b.v.x = (ax / al) * sp + this.rng.range(-2, 2);
    b.v.y = this.rng.range(-1, 2.5);
    b.v.z = (az / al) * sp + this.rng.range(-2, 2);
    b.air = { kind: 'loose', t: 0, from: d, touchedRim: false, touchedBoard: false, blockedShot: shot };
    b.lastTouch = d;
    this.emit('block', { player: d, shooter });
    this.match.onBlock(d, shooter, shot);
    this.replayHighlight = { kind: 'Block', t: this.t, player: d };
    this.takeover.add(d, 'defense', 16);
  }

  makeBlockedShotInfo(p, hoop) {
    const three = isThreePoint(p.x, p.z, hoop);
    return { shooter: p, team: p.team, hoop, pts: three ? 3 : 2, three, dist: distToHoop(p.x, p.z, hoop), type: 'blocked', paint: inPaint(p.x, p.z, hoop), releaseT: this.t };
  }

  /** Blocks and goaltending once the ball has left the shooter's hand. */
  checkBlocksInFlight() {
    const b = this.ball;
    if (b.air.kind !== 'shot' || b.air.touchedRim || b.air.touchedBoard) return;
    const shot = b.air.shot;
    if (!shot || shot.kind === 'ft') return;
    for (const d of this.teams[1 - shot.team].onCourt) {
      if (!d.action || (d.action.type !== 'block' && d.action.type !== 'contest') || d.action.data.blocked) continue;
      const hy = d.reachNow() + 0.08;
      const dist = Math.hypot(b.p.x - d.x, b.p.z - d.z);
      const reachR = 0.55 + (d.wingM - d.heightM) * 0.6;
      if (dist > reachR || b.p.y > hy || b.p.y < hy - 0.7) continue;
      d.action.data.blocked = true;
      if (b.v.y < 0 && b.p.y > RIM_H + 0.05 && distToHoop(b.p.x, b.p.z, shot.hoop) < 1.4) {
        // Ball on its way down toward the basket: goaltending.
        this.match.goaltend(d, shot);
        return;
      }
      const early = b.air.t < 0.3;
      const skill = (d.action.type === 'block' ? 0.35 : 0.15) + 0.4 * d.r('block') + 0.04 * d.badge('paintWall');
      const p = clamp(skill * (early ? 1 : 0.6) - (shot.type === 'fadeaway' ? 0.15 : 0), 0.04, 0.8);
      if (this.rng.chance(p)) {
        this.blockBall(d, shot.shooter, false);
        return;
      }
    }
  }

  handleContacts(out) {
    const b = this.ball;
    const air = b.air;
    if (out.rim) {
      air.touchedRim = true;
      this.emit('rim', { strength: out.rim, hoop: out.rimHoop });
      this.match.onRimTouch(air);
    }
    if (out.board) {
      air.touchedBoard = true;
      this.emit('backboard', { strength: out.board, hoop: out.boardHoop });
      if (out.boardOut) {
        this.match.outOfBounds(b.lastTouch ? b.lastTouch.team : this.match.possTeam, { x: b.p.x, z: b.p.z });
        return;
      }
    }
    if (out.net) this.emit('net', { hoop: out.netHoop, speed: Math.hypot(b.v.x, b.v.y, b.v.z) });
    if (out.floor > 0.3) this.emit('ballBounce', { strength: out.floor, x: b.p.x, z: b.p.z });
    if (out.scored >= 0) {
      this.match.onBasket(out.scored, air);
      return;
    }
    if (out.outOfBounds) {
      this.match.outOfBounds(b.lastTouch ? b.lastTouch.team : this.match.possTeam, { x: b.p.x, z: b.p.z });
    }
  }

  checkCatches(dt) {
    const b = this.ball;
    const air = b.air;
    if (!air) return;
    const speed = Math.hypot(b.v.x, b.v.y, b.v.z);
    if (air.kind === 'pass') {
      // Interceptions: a defender whose hands are in the lane gets one read per pass.
      for (const d of this.teams[1 - air.passer.team].onCourt) {
        if (air.intercepts.has(d) || d.stumble > 0) continue;
        const dist = Math.hypot(b.p.x - d.x, b.p.z - d.z);
        const reach = 0.5 + (d.wingM - 1.9) * 0.4;
        if (dist > reach || b.p.y > d.reachNow() + 0.05 || b.p.y < 0.15) continue;
        air.intercepts.add(d);
        const lob = air.passKind === 'lob' || air.alleyOop;
        let pi = 0.04 + 0.22 * d.r('steal') + 0.05 * d.badge('laneThief') + (d.takeoverOn('defense') ? 0.08 : 0);
        pi *= (d.team !== this.user.team ? this.diff.cpuSteal : 1);
        if (lob) pi *= 0.6;
        pi *= clamp(1.3 - speed / 18, 0.5, 1.2) * clamp(air.t * 1.8, 0.35, 1.1);
        if (this.rng.chance(pi)) {
          if (this.rng.chance(0.6)) {
            this.pendingSteal = { player: d, t: this.t, from: air.passer, intercept: true };
            this.giveBall(d, 'interception');
          } else {
            this.looseBall({ x: b.v.x * -0.2 + this.rng.range(-2, 2), y: 1.5, z: b.v.z * -0.2 + this.rng.range(-2, 2) }, d);
            this.pendingSteal = { player: d, t: this.t, from: air.passer, deflect: true };
            this.emit('deflection', { player: d });
          }
          return;
        }
      }
      // Receivers.
      for (const m of this.teams[air.passer.team].onCourt) {
        if (m === air.passer && air.t < 0.4) continue;
        if (m.action && m.action.type === 'alleyoop') continue;
        const isT = m === air.target;
        const dist = Math.hypot(b.p.x - m.x, b.p.z - m.z);
        const r = isT ? 1.05 : 0.6;
        if (dist > r || b.p.y > m.reachNow() + 0.15 || b.p.y < 0.2) continue;
        if (!isT && air.t < 0.25) continue;
        const prevPasser = air.passer;
        this.giveBall(m, air.inbound ? 'inbound' : 'pass');
        m.lastPasser = prevPasser;
        m.lastPassT = this.t;
        if (m.queueShot) {
          m.queueShot = false;
          this.attemptShot(m, { user: this.isUser(m) });
        }
        return;
      }
      // Pass sailed past everyone: it's now a loose ball.
      if (this.t > air.eta + 0.6) {
        air.kind = 'loose';
      }
      return;
    }
    if (air.kind === 'tip') {
      for (const m of this.players) {
        const dist = Math.hypot(b.p.x - m.x, b.p.z - m.z);
        if (dist < 0.8 && b.p.y < m.reachNow() + 0.1 && air.t > 0.25) {
          this.giveBall(m, 'tip');
          return;
        }
      }
    }
    if (air.kind === 'shot' || air.kind === 'loose' || air.kind === 'tip') {
      const shot = air.shot;
      if (air.kind === 'shot') {
        const settled = air.touchedRim || air.touchedBoard || (b.v.y < 0 && b.p.y < RIM_H - 0.4) || b.p.y < 1.0;
        if (!settled || air.t < 0.35) return;
        if (shot && shot.kind === 'ft' && !air.touchedRim && !air.touchedBoard && b.p.y > 1.0) return;
      }
      if (speed > 11) return;
      const cands = [];
      for (const m of this.players) {
        if (m.action && (m.action.lock && m.action.type !== 'rebound')) continue;
        if (m.stumble > 0.4) continue;
        if (this.match.phase === 'freethrow' && air.kind === 'shot' && !air.touchedRim) continue;
        const dist = Math.hypot(b.p.x - m.x, b.p.z - m.z);
        const r = 0.5 + (m.wingM - 1.9) * 0.45 + (b.p.y < 1.2 ? 0.25 : 0);
        if (dist > r) continue;
        if (b.p.y > m.reachNow() + 0.12) continue;
        const offensive = shot ? m.team === shot.team : m.team === this.match.possTeam;
        const rk = offensive ? 'offReb' : 'defReb';
        let w = 0.4 + m.r(rk) + 0.12 * m.badge('glassCleaner');
        if (m.airborne) w *= 1.25;
        if (m.takeoverOn('rebounding')) w *= 1.3;
        w *= 1 - dist / (r + 0.2);
        cands.push([m, w]);
      }
      if (!cands.length) return;
      const winner = cands.length === 1 ? cands[0][0] : this.rng.weighted(cands);
      if (cands.length > 1) {
        this.emit('contestedRebound', { winner });
        const loser = cands.find(([m]) => m !== winner && m.team !== winner.team);
        if (loser && this.match.phase === 'live' && this.rng.chance(0.06)) {
          this.match.foul(loser[0], winner, 'personal', null, 'loose ball foul');
          return;
        }
      }
      this.giveBall(winner, air.kind === 'shot' || air.blockedShot || this.match.reboundable ? 'rebound' : 'loose');
    }
  }
}

// -------------------------------------------------------------------------
// Action handlers (timing, root motion and ball events per action type)
// -------------------------------------------------------------------------
const ACTIONS = {
  shot: {
    update(sim, p, a, dt) {
      const d = a.data;
      const decay = Math.exp(-7 * dt);
      p.vx *= decay; p.vz *= decay;
      if (d.drift) {
        p.vx += -p.fx * -d.drift * dt * 2.2 * (a.t < d.tIdeal ? 1 : 0);
        p.vz += -p.fz * -d.drift * dt * 2.2 * (a.t < d.tIdeal ? 1 : 0);
      }
      if (!d.jumped && a.t >= d.jumpT && d.shotType !== 'ft') {
        d.jumped = true;
        p.jump(d.jumpH * (0.8 + 0.4 * p.r('vertical')));
      }
      if (d.released) return;
      if (sim.ball.owner !== p) { p.action = null; return; }
      if (d.user) {
        if (d.releaseT !== null) sim.releaseShot(p, a);
        else if (a.t > d.tIdeal + 0.3) { d.releaseT = a.t; sim.releaseShot(p, a); }
      } else if (a.t >= d.aiReleaseT) {
        d.releaseT = a.t;
        sim.releaseShot(p, a);
      }
    },
    end(sim, p, a) {
      if (!a.data.released && sim.ball.owner === p) {
        // Shot was interrupted (e.g. foul whistle) — keep the ball.
        sim.ball.state = 'held';
      }
    },
  },

  pumpfake: {
    start(sim, p) {
      p.pickedUp = true;
      // Defenders may bite on the fake.
      for (const d of sim.opponents(p)) {
        if (d.distTo(p) > 2.6 || d.ctrl === 'user' || d.airborne) continue;
        const bite = 0.55 * (1 - d.r('defAwareness')) * (d.team !== sim.user.team ? 1.2 - sim.diff.cpuDef * 0.5 : 0.7);
        if (sim.rng.chance(bite)) {
          sim.setAction(d, 'contest', 0.8, { jumpH: d.maxVertical * 0.7, blocked: false, bit: true }, { slow: 0.6 });
          d.jump(d.maxVertical * 0.7);
          sim.emit('biteFake', { player: d });
        }
      }
    },
    update(sim, p, a, dt) {
      p.vx *= Math.exp(-10 * dt); p.vz *= Math.exp(-10 * dt);
    },
  },

  layup: {
    update(sim, p, a, dt) {
      const d = a.data;
      const b = sim.ball;
      if (a.t < d.takeoffT) {
        // Gather steps toward the takeoff spot; euro/hop add lateral steps.
        const u = a.t / d.takeoffT;
        const k = smoothstep(0, 1, u);
        let lat = 0;
        if (d.style === 'euro') lat = d.latAmt * (u < 0.5 ? -0.4 * Math.sin(u * 2 * Math.PI) : smoothstep(0.5, 1, u));
        else if (d.style === 'spinLayup') lat = d.latAmt * Math.sin(u * Math.PI);
        const tx = lerp(d.start.x, d.takeoff.x, k) + d.latX * lat;
        const tz = lerp(d.start.z, d.takeoff.z, k) + d.latZ * lat;
        p.vx = (tx - p.x) / dt; p.vz = (tz - p.z) / dt;
        if (d.style === 'spinLayup') { a.face = p.facing + 12 * dt; }
      } else {
        if (!d.jumped) {
          d.jumped = true;
          const h = hoopPos(d.hoop);
          p.jump(0.35 + 0.4 * p.r('vertical'));
          const dist = Math.hypot(h.x - p.x, h.z - p.z);
          const T = 0.6;
          const travel = Math.max(0, dist - 0.65);
          p.vx = ((h.x - p.x) / (dist || 1)) * travel / T;
          p.vz = ((h.z - p.z) / (dist || 1)) * travel / T;
          if (d.meter && d.held) { d.releaseUserT = a.t + 0.15; d.held = false; }
          // Mid-air adjustment against a shot blocker.
          const pressure = sim.finishPressure(p, d.hoop);
          if (pressure > 0.45) {
            const pAdj = 0.25 + 0.4 * p.r('layup') + 0.06 * p.badge('bodyControl');
            if (sim.rng.chance(pAdj)) {
              d.adjusted = true;
              d.hand = -d.hand;
              d.releaseT += 0.08;
              a.dur += 0.08;
              sim.emit('midairAdjust', { player: p });
            }
          }
        }
        p.vx *= Math.exp(-1.5 * dt); p.vz *= Math.exp(-1.5 * dt);
      }
      if (!d.released && a.t >= d.releaseT && b.owner === p) {
        d.released = true;
        ACTIONS.layup.release(sim, p, a);
      }
    },
    release(sim, p, a) {
      const d = a.data;
      const hoop = d.hoop;
      const pos = sim.heldBallPos(p);
      const dist = distToHoop(p.x, p.z, hoop);
      const contest = evaluateContest(p, sim.opponents(p), hoop, pos.y);
      let c = Math.max(contest.value, sim.finishPressure(p, hoop) * 0.9);
      if (d.style === 'euro' || d.style === 'hop') c *= 0.75;
      if (d.style === 'upAndUnder' || d.style === 'stepThrough') c *= 0.55;
      if (d.adjusted) c *= 0.65;
      let grade = 'Slightly Early';
      if (d.meter) {
        const err = (d.releaseUserT ?? a.t) - d.timingCenter;
        grade = timingGrade(err, d.timingWindow);
      } else if (!d.user) {
        grade = sim.rng.chance(0.25 + 0.4 * p.r('layup')) ? 'Excellent' : 'Slightly Late';
      }
      const info = { kind: 'layup', ratingKey: 'layup', dist, three: false, contest: c, moving: false, rhythm: true, type: d.style };
      let base = baseMakeProbability(p, info);
      if (p.team !== sim.user.team) base *= sim.diff.cpuShot;
      base *= 1 + 0.04 * p.badge('bodyControl') * (c > 0.4 ? 1 : 0);
      const timingMul = grade === 'Excellent' ? 1.12 : grade.startsWith('Slightly') ? 1.0 : grade.startsWith('Very') ? 0.55 : 0.82;
      const prob = clamp(base * timingMul, 0.03, 0.97);
      const made = sim.rng.chance(prob);
      const target = aimPoint(hoop, made, made ? grade : 'Slightly', pos, sim.rng);
      const arc = d.style === 'fingerRoll' ? 64 : d.style === 'reverse' ? 66 : 60;
      const sol = solveShot(pos, target, arc, 45);
      sim.ball.p.x = pos.x; sim.ball.p.y = pos.y; sim.ball.p.z = pos.z;
      const shotInfo = {
        shooter: p, team: p.team, hoop, pts: 2, three: false, dist, intended: made, prob, grade,
        contest: { value: c, label: contestLabel(c), dir: contest.dir }, type: d.style, kind: 'layup', releaseT: sim.t,
        releaseX: p.x, releaseZ: p.z, paint: true, user: d.user, layup: true,
      };
      sim.releaseBall('shot', sol.v, { shot: shotInfo });
      sim.lastShotFeedback = shotInfo;
      sim.emit('shotRelease', { player: p, shot: shotInfo });
      sim.match.onShotRelease(p, shotInfo);
    },
  },

  dunk: {
    update(sim, p, a, dt) {
      const d = a.data;
      const b = sim.ball;
      const h = hoopPos(d.hoop);
      if (a.t < d.takeoffT) {
        const k = smoothstep(0, 1, a.t / d.takeoffT);
        const tx = lerp(d.start.x, d.takeoff.x, k), tz = lerp(d.start.z, d.takeoff.z, k);
        p.vx = (tx - p.x) / dt; p.vz = (tz - p.z) / dt;
        // Dynamic dunk meter: the window narrows as defensive pressure rises.
        d.pressure = sim.finishPressure(p, d.hoop);
        d.meterWindow = (0.075 + 0.035 * p.r('drivingDunk')) * (1 - 0.6 * d.pressure) * sim.diff.window;
      } else if (!d.jumped) {
        d.jumped = true;
        const need = RIM_H + 0.25 - p.standingReach;
        p.jump(clamp(need + 0.12, 0.3, p.maxVertical));
        const dist = Math.hypot(h.x - p.x, h.z - p.z);
        const T = d.slamT - d.takeoffT;
        const travel = Math.max(0, dist - 0.45);
        p.vx = ((h.x - p.x) / (dist || 1)) * travel / T;
        p.vz = ((h.z - p.z) / (dist || 1)) * travel / T;
        // Resolve the dunk outcome at takeoff from timing, rating and pressure.
        let grade = 'Excellent';
        if (d.user) {
          const rel = d.releaseUserT ?? a.t;
          grade = timingGrade(rel - d.meterCenter, d.meterWindow);
          if (d.held) grade = 'Late';
        }
        const rating = Math.max(p.r('drivingDunk'), p.r('standingDunk'));
        let pSucc = 0.75 + 0.22 * rating - d.pressure * 0.35 + 0.03 * p.badge('posterThreat');
        if (!d.user && p.team !== sim.user.team) pSucc *= sim.diff.cpuShot;
        if (grade.startsWith('Slightly')) pSucc *= 0.92;
        else if (grade === 'Early' || grade === 'Late') pSucc *= 0.6;
        else if (grade.startsWith('Very')) pSucc *= 0.3;
        d.grade = grade;
        d.success = sim.rng.chance(clamp(pSucc, 0.05, 0.99));
        d.held = false;
      } else {
        // In the air: freeze at the rim for the slam, then hang briefly.
        if (a.t >= d.slamT - 0.08 && a.t < d.slamT + 0.25 && d.success && p.y > 0.3) {
          p.vy = Math.max(p.vy, 0);
          p.vx *= 0.5; p.vz *= 0.5;
        }
      }
      if (!d.slammed && a.t >= d.slamT && b.owner === p) {
        d.slammed = true;
        const dunkInfo = {
          shooter: p, team: p.team, hoop: d.hoop, pts: 2, three: false, dist: distToHoop(d.start.x, d.start.z, d.hoop), intended: d.success,
          grade: d.grade, contest: { value: d.pressure, label: contestLabel(d.pressure), dir: null }, type: d.style, kind: 'dunk', releaseT: sim.t,
          releaseX: p.x, releaseZ: p.z, paint: true, user: d.user, dunk: true,
        };
        if (d.success) {
          b.p.x = h.x + (p.x - h.x) * 0.15; b.p.y = RIM_H + 0.16; b.p.z = h.z + (p.z - h.z) * 0.15;
          sim.releaseBall('shot', { x: (h.x - b.p.x) * 2, y: -4.5, z: (h.z - b.p.z) * 2 }, { shot: dunkInfo });
          sim.emit('dunk', { player: p, style: d.style });
          sim.replayHighlight = { kind: 'Dunk', t: sim.t, player: p };
          // Contact dunk over a rim protector.
          for (const def of sim.opponents(p)) {
            if (def.distTo(p) < 1.0 && def.airborne && sim.rng.chance(0.4 + 0.1 * p.badge('posterThreat'))) {
              sim.setAction(def, 'stumble', 0.8, { fromX: p.fx, fromZ: p.fz }, { slow: 0.9 });
              sim.emit('poster', { player: p, defender: def });
            }
          }
        } else {
          const dx = h.x - p.x, dz = h.z - p.z, l = Math.hypot(dx, dz) || 1;
          b.p.x = h.x - (dx / l) * 0.32; b.p.y = RIM_H + 0.18; b.p.z = h.z - (dz / l) * 0.32;
          sim.releaseBall('shot', { x: (dx / l) * 2.5, y: 0.5, z: (dz / l) * 2.5 }, { shot: dunkInfo });
          sim.emit('missedDunk', { player: p });
        }
        sim.lastShotFeedback = dunkInfo;
        sim.emit('shotRelease', { player: p, shot: dunkInfo });
        sim.match.onShotRelease(p, dunkInfo);
      }
    },
  },

  alleyoop: {
    update(sim, p, a, dt) {
      const d = a.data;
      const b = sim.ball;
      const aim = d.aim;
      if (!aim) { p.action = null; return; }
      const tToCatch = d.catchT - a.t;
      if (!d.caught) {
        // Run to the spot under the catch point and leave the floor on time.
        const jumpDur = 0.42;
        const tx = aim.x, tz = aim.z;
        const dx = tx - p.x, dz = tz - p.z, dist = Math.hypot(dx, dz);
        if (!d.jumped) {
          const sp = Math.min(8, dist / Math.max(0.15, tToCatch));
          p.vx = (dx / (dist || 1)) * sp; p.vz = (dz / (dist || 1)) * sp;
          a.face = Math.atan2(dz, dx);
          if (tToCatch <= jumpDur) {
            d.jumped = true;
            p.jump(clamp(aim.y - p.standingReach + 0.1, 0.3, p.maxVertical));
          }
        }
        if (b.state === 'air' && b.air && b.air.kind === 'pass') {
          const hd = Math.hypot(b.p.x - p.x, b.p.z - p.z);
          if (hd < 0.9 && Math.abs(b.p.y - (p.reachNow() - 0.1)) < 0.6 && p.airborne) {
            d.caught = true;
            const passer = b.air.passer;
            sim.giveBall(p, 'alleyoop');
            p.lastPasser = passer;
            p.lastPassT = sim.t;
            const contest = sim.finishPressure(p, d.hoop);
            const pSucc = clamp(0.62 + 0.3 * Math.max(p.r('drivingDunk'), p.r('standingDunk')) - contest * 0.35, 0.1, 0.97);
            d.success = sim.rng.chance(pSucc);
            d.slamT = a.t + 0.14;
            sim.emit('alleyOopCatch', { player: p, passer });
          }
        }
        if (a.t > d.catchT + 0.5 && !d.caught) p.action = null;
      } else {
        const h = hoopPos(d.hoop);
        p.vx *= 0.8; p.vz *= 0.8;
        if (!d.slammed && a.t >= d.slamT && b.owner === p) {
          d.slammed = true;
          const info = {
            shooter: p, team: p.team, hoop: d.hoop, pts: 2, three: false, dist: 0.5, intended: d.success, grade: 'Excellent',
            contest: { value: 0, label: 'Open', dir: null }, type: 'alleyOop', kind: 'dunk', releaseT: sim.t, releaseX: p.x, releaseZ: p.z,
            paint: true, user: sim.isUser(p), dunk: true,
          };
          if (d.success) {
            b.p.x = h.x + (p.x - h.x) * 0.15; b.p.y = RIM_H + 0.16; b.p.z = h.z + (p.z - h.z) * 0.15;
            sim.releaseBall('shot', { x: (h.x - b.p.x) * 2, y: -4.5, z: (h.z - b.p.z) * 2 }, { shot: info });
            sim.emit('dunk', { player: p, style: 'alleyOop' });
            sim.replayHighlight = { kind: 'Alley-Oop', t: sim.t, player: p };
          } else {
            const dx = h.x - p.x, dz = h.z - p.z, l = Math.hypot(dx, dz) || 1;
            b.p.x = h.x - (dx / l) * 0.3; b.p.y = RIM_H + 0.2; b.p.z = h.z - (dz / l) * 0.3;
            sim.releaseBall('shot', { x: (dx / l) * 2, y: 0.8, z: (dz / l) * 2 }, { shot: info });
          }
          sim.emit('shotRelease', { player: p, shot: info });
          sim.match.onShotRelease(p, info);
        }
      }
    },
  },

  pass: {
    update(sim, p, a) {
      const d = a.data;
      if (!d.released && a.t >= d.windup) {
        d.released = true;
        if (sim.ball.owner === p) sim.releasePass(p, a);
      }
    },
  },

  move: {
    update(sim, p, a, dt) {
      const d = a.data;
      const m = d.m;
      const u = clamp(a.t / a.dur, 0, 1);
      const prevU = clamp((a.t - dt) / a.dur, 0, 1);
      const k = 6 * u * (1 - u); // derivative of smoothstep
      const sf = Math.cos(d.startFacing), sz = Math.sin(d.startFacing);
      const rx = -sz, rz = sf;
      let latV = (m.lat * d.sideSign * k) / a.dur;
      let fwdV = (m.fwd * k) / a.dur;
      // Keep part of the entry momentum (moving crossovers, momentum crosses).
      const carry = m.fwd < 0 ? 0.15 : m.path === 'hesi' ? (u < 0.55 ? 0.35 : 1.25) : 0.75;
      const ex = Math.cos(d.entryDir) * d.entry * carry, ez = Math.sin(d.entryDir) * d.entry * carry;
      if (m.path === 'inout') latV = (m.lat * d.sideSign * Math.cos(u * Math.PI) * Math.PI) / (2 * a.dur);
      if (m.post) {
        // Drop step: swing around the defender toward the rim.
        const hx = Math.cos(d.hoopSide), hz = Math.sin(d.hoopSide);
        p.vx = hx * (1.6 * k) / a.dur; p.vz = hz * (1.6 * k) / a.dur;
        a.face = d.hoopSide;
      } else {
        p.vx = ex + sf * fwdV + rx * latV;
        p.vz = ez + sz * fwdV + rz * latV;
        a.face = m.spin ? d.startFacing + d.sideSign * -Math.PI * 2 * smoothstep(0, 1, u) : d.startFacing;
        if (m.path === 'halfspin') a.face = d.startFacing + d.sideSign * -Math.PI * Math.sin(u * Math.PI) * 0.9;
      }
      a.faceRate = 40;
      if (m.switchHand && !d.handSwitched && u >= 0.45) {
        d.handSwitched = true;
        p.hand = -d.prevHand;
      }
      if (m.path === 'hesi' && prevU < 0.55 && u >= 0.55) sim.emit('hesiBurst', { player: p });
    },
    end(sim, p, a) {
      if (a.data.m.shotReady) p.shotReadyT = sim.t;
      if (a.data.m.switchHand) p.hand = -a.data.prevHand;
      p.facing = wrapAngle(p.facing);
      if (a.data.m.burst) {
        p.vx *= 1.15; p.vz *= 1.15;
      }
    },
  },

  steal: {
    update(sim, p, a) {
      const d = a.data;
      if (d.resolved || a.t < 0.13) return;
      d.resolved = true;
      const b = sim.ball;
      const h = sim.holder();
      if (!h || h.team === p.team) {
        // Swipe at a loose ball / pass.
        return;
      }
      const reach = 0.95 + (p.wingM - 1.9) * 0.5;
      const dBall = Math.hypot(b.p.x - p.x, b.p.z - p.z);
      if (dBall > reach || h.distTo(p) > 1.6) {
        sim.emit('stealMiss', { player: p });
        p.balance -= 0.15;
        return;
      }
      const dBody = h.distTo(p);
      const shielded = dBall > dBody + 0.05;
      const exposure = h.action && h.action.type === 'move' ? h.action.data.m.exposure : b.state === 'dribble' ? 0.12 : 0.04;
      let ps = 0.015 + 0.15 * p.r('steal') + exposure * 0.4 - 0.12 * h.r('ballHandle') - 0.02 * h.badge('tightHandles');
      ps *= 1 + 0.08 * p.badge('ballHawk');
      if (p.takeoverOn('defense')) ps *= 1.15;
      if (p.team !== sim.user.team) ps *= sim.diff.cpuSteal;
      if (shielded) ps *= 0.3;
      if (sim.rng.chance(clamp(ps, 0.01, 0.6))) {
        if (sim.rng.chance(0.5)) {
          sim.pendingSteal = { player: p, t: sim.t, from: h };
          sim.giveBall(p, 'steal');
        } else {
          sim.looseBall({ x: (p.x - h.x) * 1.5 + sim.rng.range(-1.5, 1.5), y: 1.0, z: (p.z - h.z) * 1.5 + sim.rng.range(-1.5, 1.5) }, p);
          sim.pendingSteal = { player: p, t: sim.t, from: h };
          sim.emit('poke', { player: p, from: h });
        }
        return;
      }
      // Reach-in foul when swiping through the body.
      const pf = (shielded ? 0.14 : 0.04) * (1.2 - p.r('defAwareness'));
      if (sim.rng.chance(pf)) {
        sim.match.foul(p, h, 'personal', null, 'reach-in');
        return;
      }
      p.balance -= 0.2;
      sim.emit('stealMiss', { player: p });
    },
  },

  block: {},
  contest: {},
  rebound: {},
  bump: {},
  catch: {},
  stumble: {},
  fall: {
    update(sim, p, a, dt) {
      p.vx *= Math.exp(-6 * dt); p.vz *= Math.exp(-6 * dt);
    },
  },
};

export { ACTIONS };
