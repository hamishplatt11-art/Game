// Simulation-side basketball player: kinematic body with momentum-based
// movement, stamina, balance and the currently executing action.
import { clamp, approachAngle, wrapAngle, lerp } from '../core/math.js';

export class Player {
  constructor(def, team, starter) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.last = def.last;
    this.num = def.num;
    this.pos = def.pos;
    this.team = team;
    this.starter = starter;
    this.heightM = def.heightM;
    this.wingM = def.wingM;
    this.weightKg = def.weightKg;
    this.radius = clamp(0.25 + (def.weightKg - 80) * 0.0018 + (def.heightM - 1.9) * 0.08, 0.26, 0.36);
    this.mass = def.weightKg;
    this.standingReach = def.heightM * 1.31 + (def.wingM - def.heightM) * 0.5;
    this.maxVertical = clamp(0.5 + 0.48 * this.r('vertical') - (def.weightKg - 95) * 0.002, 0.45, 1.05);

    this.x = 0; this.z = 0; this.y = 0;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.facing = 0;
    this.speed = 0;
    this.stamina = 1;
    this.balance = 1;
    this.stumble = 0; // seconds of reduced control
    this.plantTimer = 0;
    this.onCourt = false;
    this.fouls = 0;
    this.slot = 0;
    this.intent = { mx: 0, mz: 0, sprint: false, stance: false, strafe: false, faceX: null, faceZ: null, handsUp: false, walk: false };
    this.action = null;
    this.cooldowns = { steal: 0, block: 0, move: 0, pass: 0 };
    // Ball-handling state.
    this.hand = 1; // +1 right, -1 left
    this.pickedUp = false; // dribble ended; cannot dribble again (double dribble)
    this.tripleThreat = false;
    this.pivotX = 0; this.pivotZ = 0;
    this.lastCatchT = -10;
    this.dribblesSinceCatch = 0;
    this.moveCombo = 0; // chained dribble moves
    this.lastMoveT = -10;
    this.shotReadyT = -10; // stepback/sidestep window for a rhythm jumper
    this.inLaneT = 0;
    this.takeover = { shooting: 0, finishing: 0, playmaking: 0, defense: 0, rebounding: 0 };
    this.takeoverActive = null;
    this.takeoverT = 0;
    this.airborne = false;
    this.ctrl = 'ai';
    this.stats = Player.emptyStats();
    this.prevX = 0; this.prevZ = 0;
  }

  static emptyStats() {
    return { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, min: 0, pm: 0 };
  }

  /** Rating normalised to 0..1 (25..99 -> 0..1). */
  r(attr) {
    return clamp((this.def.ratings[attr] - 25) / 74, 0, 1);
  }
  rating(attr) {
    return this.def.ratings[attr];
  }
  badge(b) {
    return this.def.badges[b] || 0;
  }
  takeoverOn(kind) {
    return this.takeoverActive === kind;
  }

  get fx() { return Math.cos(this.facing); }
  get fz() { return Math.sin(this.facing); }
  /** Unit vector pointing to the player's right. */
  get rx() { return -Math.sin(this.facing); }
  get rz() { return Math.cos(this.facing); }

  setPos(x, z, facing = this.facing) {
    this.x = x; this.z = z; this.prevX = x; this.prevZ = z;
    this.vx = 0; this.vz = 0; this.speed = 0;
    this.facing = facing;
    this.y = 0; this.vy = 0; this.airborne = false;
  }

  jogMax() { return 4.0 + 0.9 * this.r('speed'); }
  sprintMax() { return 6.3 + 2.1 * this.r('speed'); }
  shuffleMax() { return 2.5 + 1.0 * this.r('agility') + 0.4 * this.r('perimeterD'); }
  fatigue() { return 0.8 + 0.2 * clamp(this.stamina / 0.6, 0, 1); }

  /**
   * Momentum-based locomotion. Players accelerate over time, plant before
   * sharp cuts and turn in wider arcs at speed.
   */
  updateMovement(dt, hasBall, dribbling) {
    const it = this.intent;
    if (this.cooldowns) for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    if (this.stumble > 0) this.stumble -= dt;
    const mag = Math.min(1, Math.hypot(it.mx, it.mz));
    let maxSp;
    if (it.stance) maxSp = this.shuffleMax();
    else if (it.strafe) maxSp = this.shuffleMax() * 1.05;
    else if (it.sprint) maxSp = this.sprintMax();
    else if (it.walk) maxSp = 1.6;
    else maxSp = this.jogMax();
    if (hasBall && dribbling) maxSp *= 0.88 + 0.1 * this.r('speedWithBall');
    if (hasBall && !dribbling) maxSp = Math.min(maxSp, 0.01); // no travelling: pivot only
    maxSp *= this.fatigue();
    if (this.stumble > 0) maxSp *= 0.35;
    if (this.takeoverOn('playmaking') && hasBall) maxSp *= 1.04;

    const accel = (3.6 + 5.2 * this.r('accel')) * (hasBall ? 0.93 : 1) * (this.stumble > 0 ? 0.4 : 1);
    const decel = 8 + 5 * this.r('agility');
    const dsx = mag > 0.05 ? (it.mx / mag) * maxSp * mag : 0;
    const dsz = mag > 0.05 ? (it.mz / mag) * maxSp * mag : 0;
    const desiredSp = Math.hypot(dsx, dsz);

    const sp = Math.hypot(this.vx, this.vz);
    if (this.plantTimer > 0) {
      // Planted foot: brake hard along the current direction before pushing off.
      this.plantTimer -= dt;
      const ns = Math.max(0, sp - decel * 1.35 * dt);
      if (sp > 1e-4) { this.vx *= ns / sp; this.vz *= ns / sp; }
    } else if (desiredSp < 0.05) {
      const ns = Math.max(0, sp - decel * dt);
      if (sp > 1e-4) { this.vx *= ns / sp; this.vz *= ns / sp; }
    } else {
      const curDir = Math.atan2(this.vz, this.vx);
      const desDir = Math.atan2(dsz, dsx);
      const turn = Math.abs(wrapAngle(desDir - curDir));
      if (sp > 2.6 && turn > 1.35 && !it.stance && !it.strafe) {
        this.plantTimer = 0.2 - 0.09 * this.r('agility');
        this.planted = { t: 0, angle: turn };
        this.events?.push({ type: 'plant', p: this, speed: sp });
      } else if (sp > 0.4) {
        const lateral = it.stance || it.strafe;
        const turnRate = (3.2 + 4.5 * this.r('agility')) / (1 + sp / (lateral ? 8 : 4.5));
        const nd = approachAngle(curDir, desDir, turnRate * dt * (lateral ? 3 : 1));
        let ns = sp < desiredSp ? Math.min(desiredSp, sp + accel * dt) : Math.max(desiredSp, sp - decel * dt);
        // Cutting hard bleeds speed.
        ns -= Math.min(turn, 1.2) * 0.9 * dt * sp * 0.4;
        this.vx = Math.cos(nd) * ns;
        this.vz = Math.sin(nd) * ns;
      } else {
        const ns = Math.min(desiredSp, sp + accel * dt);
        this.vx = Math.cos(desDir) * ns;
        this.vz = Math.sin(desDir) * ns;
      }
    }
    this.integrate(dt);

    // Facing: toward an explicit target (defence, catching) or the travel direction.
    let face = null;
    if (it.faceX !== null && it.faceZ !== null) face = Math.atan2(it.faceZ - this.z, it.faceX - this.x);
    else if (this.speed > 0.6) face = Math.atan2(this.vz, this.vx);
    if (face !== null) {
      const rate = (it.stance || it.strafe ? 7 : 5.5) + 3 * this.r('agility');
      this.facing = approachAngle(this.facing, face, rate * dt);
    }
    this.updateStamina(dt, it.sprint && this.speed > 4.2, this.liveClock !== false);
  }

  integrate(dt) {
    this.prevX = this.x; this.prevZ = this.z;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.speed = Math.hypot(this.vx, this.vz);
    // Vertical: jumps use simple ballistic motion of the centre of mass.
    if (this.airborne || this.y > 0 || this.vy > 0) {
      this.vy -= 9.81 * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        if (this.airborne) {
          this.airborne = false;
          this.events?.push({ type: 'land', p: this });
        }
      }
    }
  }

  jump(height) {
    if (this.airborne) return false;
    const h = clamp(height, 0.05, this.maxVertical * (0.85 + 0.15 * this.stamina));
    this.vy = Math.sqrt(2 * 9.81 * h);
    this.airborne = true;
    this.stamina = Math.max(0, this.stamina - 0.004);
    return true;
  }

  /**
   * Fatigue. Drain scales with exertion (standing < jogging < sprinting) and
   * with `fatigueScale` (12 / quarter minutes) so shortened games still produce
   * NBA-like rotations. Ratings and Bounce Back slow the drain.
   */
  updateStamina(dt, sprinting, live = true) {
    const F = this.fatigueScale || 1;
    if (!live) {
      this.stamina += dt * 0.0018 * F; // dead balls: catch a breath
    } else {
      let e;
      if (sprinting) e = 1.9;
      else if (this.speed < 0.5) e = 0.22;
      else e = 0.55 + 0.45 * Math.min(1, this.speed / this.jogMax());
      if (this.airborne) e += 0.6;
      const k = (1.3 - 0.6 * this.r('stamina')) * (1 - 0.06 * this.badge('bounceBack'));
      this.stamina -= dt * 0.0016 * e * F * k;
    }
    this.stamina = clamp(this.stamina, 0.05, 1);
  }

  /** Bench recovery. */
  rest(dt) {
    const F = this.fatigueScale || 1;
    this.stamina = Math.min(1, this.stamina + dt * (0.0017 + 0.0004 * this.badge('bounceBack')) * F);
  }

  /** Current hand height (m) for a given dribble style. */
  dribbleHeight(style) {
    const base = this.heightM * 0.48;
    if (style === 'low') return base * 0.72;
    if (style === 'sprint') return base * 1.05;
    return base * 0.92;
  }

  /** Height of the fingertips when standing (or jumping now). */
  reachNow() {
    return this.standingReach + this.y;
  }

  distTo(o) {
    return Math.hypot(this.x - o.x, this.z - o.z);
  }

  lerpPos(alpha) {
    return { x: lerp(this.prevX, this.x, alpha), z: lerp(this.prevZ, this.z, alpha) };
  }
}
