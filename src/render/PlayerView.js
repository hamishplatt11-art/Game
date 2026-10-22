// Player view and animation controller. Reads a simulation Player each frame
// and drives a skinned character: a speed/direction locomotion blend tree
// with a shared gait phase (stride-synced to ground speed to avoid foot
// sliding), cross-faded one-shot clips time-locked to the simulation's action
// timers (so releases/slams happen exactly on the animation key), two-bone
// arm IK that puts hands on the simulated ball, and head look-at.
import * as THREE from 'three';
import { buildHuman } from './HumanModel.js';
import { getLibrary } from './AnimationLibrary.js';
import { BALL_R } from '../sim/constants.js';

const LOCO = ['idle', 'triple', 'defIdle', 'handsUp', 'walk', 'jog', 'run', 'dribbleJog', 'shuffleL', 'shuffleR', 'backpedal', 'postUp'];
const GAIT_SPEED = { walk: 1.45, jog: 3.9, run: 7.2, dribbleJog: 3.7, shuffleL: 2.7, shuffleR: 2.7, backpedal: 2.5 };

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();

export class PlayerView {
  constructor(player, uniform, opts = {}) {
    this.p = player;
    const human = buildHuman(player.def, uniform, opts);
    Object.assign(this, human);
    this.root = human.group;
    this.lib = getLibrary(human.J, human.H);
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    for (const [name, clip] of Object.entries(this.lib.clips)) {
      const a = this.mixer.clipAction(clip);
      a.setEffectiveWeight(0);
      a.play();
      if (!clip.userData.loop) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.paused = true; }
      a.weightNow = 0;
      this.actions[name] = a;
    }
    this.actions.idle.weightNow = 1;
    this.gaitPhase = Math.random();
    this.oneShot = null; // { name, a }
    this.ik = { L: 0, R: 0 };
    this.lookYaw = 0;
    this.celebrateT = 0;
    this.prevAction = null;
    this.handLen = human.J.dims.hand;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }

  /**
   * @param {object} sim the Simulation (or a replay frame with the same shape)
   * @param {number} alpha interpolation factor between the last two sim steps
   */
  update(sim, alpha, dt, ballPos) {
    const p = this.p;
    const pos = p.lerpPos(alpha);
    this.root.position.set(pos.x, p.y, pos.z);
    this.root.rotation.y = Math.PI / 2 - p.facing;
    this.root.visible = p.onCourt;
    if (!p.onCourt) return;

    const targets = {};
    for (const n of LOCO) targets[n] = 0;
    const a = p.action;
    const b = sim.ball;
    const hasBall = b.owner === p && (b.state === 'held' || b.state === 'dribble');
    const dribbling = hasBall && b.state === 'dribble';
    // Velocity in the player's frame.
    const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    const rx = -fz, rz = fx;
    const fwd = p.vx * fx + p.vz * fz;
    const right = p.vx * rx + p.vz * rz;
    // Turning in place steps the feet instead of pivoting on frozen feet.
    let dFace = p.facing - (this.lastFacing ?? p.facing);
    while (dFace > Math.PI) dFace -= Math.PI * 2;
    while (dFace < -Math.PI) dFace += Math.PI * 2;
    this.lastFacing = p.facing;
    const turnRate = dt > 0 ? Math.abs(dFace) / dt : 0;
    this.turnStep = (this.turnStep || 0) + (Math.min(1.4, turnRate * 0.35) - (this.turnStep || 0)) * Math.min(1, dt * 10);
    const s = Math.max(p.speed, p.speed < 0.5 ? this.turnStep : 0);
    // Defensive stance, or a strafing protect-dribble facing the rim.
    const stance = (p.intent.stance && !hasBall) || (dribbling && p.intent.strafe);
    this.yawRate = dt > 0 ? dFace / dt : 0;

    let gaitClip = null;
    if (p.posting && hasBall) {
      targets.postUp = 1;
      gaitClip = 'postUp';
    } else if (stance) {
      if (s < 0.45) targets[p.intent.handsUp ? 'handsUp' : 'defIdle'] = 1;
      else {
        const lat = Math.abs(right) / (s || 1);
        const k = Math.min(1, s / 1.2);
        if (fwd < -0.3 * s) { targets.backpedal = k * (1 - lat); gaitClip = 'backpedal'; }
        else if (fwd > 0.5 * s) { targets.jog = k * (1 - lat); gaitClip = 'jog'; }
        const lname = right > 0 ? 'shuffleR' : 'shuffleL';
        targets[lname] = k * lat;
        if (lat > 0.5) gaitClip = lname;
        targets.defIdle = 1 - k;
      }
    } else {
      // 1D blend tree on speed.
      const runName = dribbling ? 'dribbleJog' : 'jog';
      if (fwd < -0.6 && fwd < -0.7 * s && !hasBall) {
        targets.backpedal = Math.min(1, s / 1.5);
        targets.idle = 1 - targets.backpedal;
        gaitClip = 'backpedal';
      } else if (s < 0.3) {
        targets[hasBall && !dribbling ? 'triple' : 'idle'] = 1;
      } else if (s < 1.6) {
        const k = (s - 0.3) / 1.3;
        targets[hasBall && !dribbling ? 'triple' : 'idle'] = 1 - k;
        targets[dribbling ? 'dribbleJog' : 'walk'] = k;
        gaitClip = dribbling ? 'dribbleJog' : 'walk';
      } else if (s < 4.2) {
        const k = (s - 1.6) / 2.6;
        if (dribbling) { targets.dribbleJog = 1; gaitClip = 'dribbleJog'; }
        else { targets.walk = 1 - k; targets.jog = k; gaitClip = k > 0.5 ? 'jog' : 'walk'; }
      } else {
        const k = Math.min(1, (s - 4.2) / 2.3);
        targets[runName] = 1 - k;
        targets.run = k;
        gaitClip = k > 0.5 ? 'run' : runName;
      }
    }
    // Shared gait phase: advance by distance travelled / cycle length.
    if (gaitClip && GAIT_SPEED[gaitClip]) {
      const v = GAIT_SPEED[gaitClip] * (this.H / 2.0);
      const clipDur = this.lib.clips[gaitClip].duration;
      this.gaitPhase = (this.gaitPhase + (dt * Math.max(s, 0.4)) / (v * clipDur)) % 1;
    } else if (gaitClip) {
      this.gaitPhase = (this.gaitPhase + dt / this.lib.clips[gaitClip].duration) % 1;
    } else {
      this.gaitPhase = (this.gaitPhase + dt / 2.4) % 1;
    }

    // One-shot selection.
    let shot = this.selectOneShot(sim, p, a);
    if (!shot && this.celebrateT > 0) {
      this.celebrateT -= dt;
      shot = { name: 'celebrate', time: (1 - this.celebrateT / 1.2) * 1.2 };
    }
    if (!shot && p.airborne && sim.match && sim.match.phase === 'tipoff') {
      shot = { name: 'tipJump', time: Math.min(0.9, 0.2 + Math.max(0, p.y) * 0.8) };
    }
    const fadeRate = dt / 0.12;
    for (const [name, act] of Object.entries(this.actions)) {
      let target = 0;
      const isLoco = LOCO.includes(name);
      if (shot) {
        if (name === shot.name) target = 1;
        else if (isLoco) target = (targets[name] || 0) * (shot.blendLoco || 0);
      } else if (isLoco) target = targets[name] || 0;
      // Fade toward target.
      act.weightNow += Math.max(-fadeRate, Math.min(fadeRate, target - act.weightNow));
      if (act.weightNow < 0.001) act.weightNow = 0;
      act.setEffectiveWeight(act.weightNow);
      if (isLoco) {
        act.paused = true;
        act.time = this.gaitPhase * act.getClip().duration;
      } else if (shot && name === shot.name) {
        act.paused = true;
        act.time = Math.min(shot.time, act.getClip().duration - 1e-3);
        act.enabled = true;
      }
    }
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    this.applyBodyDynamics(p, dt, shot, stance);
    this.applyLegIK(p, dt, shot, s);
    this.applyIK(sim, p, a, hasBall, dribbling, ballPos, dt);
    this.headLook(sim, p, ballPos, dt);
  }

  selectOneShot(sim, p, a) {
    if (!a) return null;
    const d = a.data || {};
    const pw = (t, keys) => {
      // Piecewise-linear map from sim time to clip time: keys = [[simT, clipT], ...].
      for (let i = 0; i < keys.length - 1; i++) {
        const [s0, c0] = keys[i], [s1, c1] = keys[i + 1];
        if (t <= s1) return c0 + (c1 - c0) * Math.max(0, (t - s0) / Math.max(1e-4, s1 - s0));
      }
      return keys[keys.length - 1][1];
    };
    const clip = (n) => this.lib.clips[n].duration;
    switch (a.type) {
      case 'shot': {
        const map = { ft: ['freeThrow', 0.632], fadeaway: ['fadeaway', 0.517], hook: ['hook', 0.52] };
        const [name, rel] = map[d.shotType] || ['jumpShot', 0.536];
        const D = clip(name);
        return { name, time: pw(a.t, [[0, 0], [d.tIdeal, rel * D], [a.dur, D]]) };
      }
      case 'layup': {
        const m = {
          euro: ['eurostep', 0.55, 0.82], hop: ['hopstep', 0.6, 0.8], reverse: ['reverseLayup', 0.42, 0.76],
          fingerRoll: ['fingerRoll', 0.42, 0.72], upAndUnder: ['upAndUnder', 0.58, 0.8], stepThrough: ['upAndUnder', 0.58, 0.8],
        }[d.style] || [d.hand < 0 ? 'layupL' : 'layup', 0.42, 0.76];
        const D = clip(m[0]);
        return { name: m[0], time: pw(a.t, [[0, 0], [d.takeoffT, m[1] * D], [d.releaseT, m[2] * D], [a.dur, D]]) };
      }
      case 'dunk': {
        const m = { windmill: ['dunkWindmill', 0.346, 0.73], reverse: ['dunkReverse', 0.346, 0.73], tomahawk: ['dunkTomahawk', 0.375, 0.69], oneHand: ['dunkOne', 0.375, 0.69] }[d.style] || ['dunkTwo', 0.375, 0.69];
        const D = clip(m[0]);
        return { name: m[0], time: pw(a.t, [[0, 0], [d.takeoffT, m[1] * D], [d.slamT, m[2] * D], [a.dur, D]]) };
      }
      case 'alleyoop': {
        const D = clip('dunkTwo');
        const ct = d.catchT || 0.8;
        return { name: 'dunkTwo', time: pw(a.t, [[0, 0.25 * D], [Math.max(0.01, ct - 0.42), 0.375 * D], [ct + 0.14, 0.69 * D], [a.dur, D]]) };
      }
      case 'pass': {
        const name = d.kind === 'bounce' ? 'passBounce' : d.kind === 'lob' ? 'passLob' : 'passChest';
        return { name, time: (a.t / a.dur) * clip(name), blendLoco: 0.5 };
      }
      case 'move': {
        const mv = d.move;
        let name = 'crossL';
        if (['crossover', 'betweenLegs', 'behindBack', 'inAndOut'].includes(mv)) name = d.sideSign > 0 ? 'crossR' : 'crossL';
        else if (mv === 'hesitation') name = 'hesi';
        else if (mv === 'spin' || mv === 'halfSpin' || mv === 'dropStep') name = 'spin';
        else if (['stepback', 'escape', 'snatchback', 'sidestep'].includes(mv)) name = 'stepback';
        else if (mv === 'sizeup') name = 'sizeup';
        else if (mv === 'jab') name = 'jab';
        return { name, time: (a.t / a.dur) * clip(name), blendLoco: 0.25 };
      }
      case 'steal': return { name: 'steal', time: (a.t / a.dur) * clip('steal'), blendLoco: 0.3 };
      case 'block': return { name: 'block', time: (a.t / a.dur) * clip('block') };
      case 'contest': return { name: 'contest', time: (a.t / a.dur) * clip('contest') };
      case 'rebound': return { name: 'rebound', time: (a.t / a.dur) * clip('rebound') };
      case 'stumble': return { name: 'stumble', time: (a.t / a.dur) * clip('stumble'), blendLoco: 0.3 };
      case 'fall': return { name: 'fall', time: (a.t / a.dur) * clip('fall') };
      case 'bump': return { name: 'bump', time: (a.t / a.dur) * clip('bump'), blendLoco: 0.6 };
      case 'pumpfake': return { name: 'pumpFake', time: (a.t / a.dur) * clip('pumpFake') };
      case 'catch': return { name: 'catch', time: (a.t / a.dur) * clip('catch'), blendLoco: 0.7 };
      default: return null;
    }
  }

  // -------------------------------------------------------------------------
  // Procedural layers on top of the clips
  // -------------------------------------------------------------------------
  /**
   * Momentum layer: the torso pitches with forward acceleration, leans back
   * to brake on a hard plant, banks into turns (lean ∝ speed × yaw rate), and
   * slumps when a player is exhausted. Hips drop during plants so the legs
   * (solved below) visibly load before the push-off.
   */
  applyBodyDynamics(p, dt, shot, stance) {
    if (dt <= 0) return;
    const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    const vF = p.vx * fx + p.vz * fz;
    const aF = this.prevVF === undefined ? 0 : (vF - this.prevVF) / dt;
    this.prevVF = vF;
    const k = Math.min(1, dt * 7);
    const free = !shot ? 1 : (shot.blendLoco || 0) * 0.6;
    const grounded = !p.airborne && p.y < 0.02;
    let pitchT = grounded ? Math.max(-0.22, Math.min(0.28, aF * 0.03 + Math.max(0, vF) * 0.014)) : 0;
    let bankT = grounded && !stance ? Math.max(-0.2, Math.min(0.2, (this.yawRate || 0) * p.speed * 0.028)) : 0;
    let dropT = 0;
    if (p.plantTimer > 0 && grounded) { pitchT = -0.16; dropT = 0.045; }
    const tired = Math.max(0, (0.45 - p.stamina) / 0.4);
    let slumpT = tired > 0 && p.speed < 1.2 && grounded ? 0.22 * Math.min(1, tired) : 0;
    this.leanF = (this.leanF || 0) + (pitchT * free - (this.leanF || 0)) * k;
    this.bank = (this.bank || 0) + (bankT * free - (this.bank || 0)) * k;
    this.drop = (this.drop || 0) + (dropT * free - (this.drop || 0)) * Math.min(1, dt * 14);
    this.slump = (this.slump || 0) + (slumpT * free - (this.slump || 0)) * Math.min(1, dt * 2);
    const B = this.bones;
    if (Math.abs(this.bank) > 1e-4) {
      B.hips.quaternion.premultiply(_q1.setFromAxisAngle(_v1.set(0, 0, 1), this.bank * 0.7));
      B.chest.quaternion.premultiply(_q1.setFromAxisAngle(_v1.set(0, 0, 1), -this.bank * 0.25));
    }
    const pitch = this.leanF + this.slump;
    if (Math.abs(pitch) > 1e-4) {
      B.spine.quaternion.premultiply(_q1.setFromAxisAngle(_v1.set(1, 0, 0), pitch * 0.55));
      B.chest.quaternion.premultiply(_q1.setFromAxisAngle(_v1.set(1, 0, 0), pitch * 0.45));
      B.neck.quaternion.premultiply(_q1.setFromAxisAngle(_v1.set(1, 0, 0), -pitch * 0.4));
    }
    if (this.drop > 1e-4 || this.slump > 1e-3) B.hips.position.y -= (this.drop + this.slump * 0.08) * this.H;
    this.root.updateMatrixWorld(true);
  }

  /**
   * Lightweight foot IK. Keeps ankles above the floor (no sinking when the
   * hips drop or the body leans) and, while standing, pins each foot to its
   * world contact point so idle sway and slow turns don't skate the feet. A
   * pinned foot releases (takes a step) once the pose drifts too far from it.
   */
  applyLegIK(p, dt, shot, s) {
    if (p.airborne || p.y > 0.02 || (shot && !shot.blendLoco)) {
      this.footLock = null;
      return;
    }
    const ankleH = 0.046 * this.H;
    const standing = s < 0.2 && (this.turnStep || 0) < 0.12;
    if (!this.footLock) this.footLock = { L: null, R: null, wL: 0, wR: 0 };
    const FL = this.footLock;
    const fwd = _v4.set(Math.cos(p.facing), 0, Math.sin(p.facing));
    for (const sd of ['L', 'R']) {
      const th = this.bones[`thigh_${sd}`], sh = this.bones[`shin_${sd}`], ft = this.bones[`foot_${sd}`];
      const anim = ft.getWorldPosition(new THREE.Vector3());
      if (standing) {
        if (!FL[sd] || Math.hypot(FL[sd].x - anim.x, FL[sd].z - anim.z) > 0.16) FL[sd] = anim.clone();
        FL[`w${sd}`] = Math.min(1, FL[`w${sd}`] + dt / 0.12);
      } else {
        FL[`w${sd}`] = Math.max(0, FL[`w${sd}`] - dt / 0.12);
        if (FL[`w${sd}`] === 0) FL[sd] = null;
      }
      const target = anim.clone();
      if (FL[sd]) { target.x += (FL[sd].x - target.x) * FL[`w${sd}`]; target.z += (FL[sd].z - target.z) * FL[`w${sd}`]; }
      if (target.y < ankleH) target.y = ankleH;
      if (target.distanceToSquared(anim) < 1e-6) continue;
      const footQ = ft.getWorldQuaternion(new THREE.Quaternion());
      const pole = _v3.copy(fwd).multiplyScalar(1).add(_v2.set(0, 0.15, 0));
      this.solveTwoBone(th, sh, ft, target, pole, 1, 0);
      // Keep the sole's world orientation from the clip (flat on the floor).
      ft.parent.getWorldQuaternion(_q3).invert();
      ft.quaternion.copy(_q3.multiply(footQ));
      ft.updateMatrixWorld(true);
    }
  }

  // -------------------------------------------------------------------------
  // IK
  // -------------------------------------------------------------------------
  applyIK(sim, p, a, hasBall, dribbling, ballPos, dt) {
    const b = sim.ball;
    const up = _v4.set(0, 1, 0);
    const fwd = new THREE.Vector3(Math.cos(p.facing), 0, Math.sin(p.facing));
    const right = new THREE.Vector3(-Math.sin(p.facing), 0, Math.cos(p.facing));
    let tL = null, tR = null, poleL = null, poleR = null;
    const ball = ballPos;
    const shooting = a && (a.type === 'shot' || a.type === 'layup' || a.type === 'dunk' || a.type === 'alleyoop' || a.type === 'pumpfake');
    const released = a && a.data && (a.data.released || a.data.slammed);
    if (hasBall && !released) {
      if (dribbling && !(a && a.type === 'move' && a.data.m && a.data.m.path === 'jab')) {
        const handH = p.dribbleHeight('normal') + p.y;
        const top = new THREE.Vector3(ball.x, Math.max(ball.y + BALL_R * 0.92, handH * 0.6), ball.z);
        // Hand follows the ball; it leads the ball slightly on the way back up.
        const side = b.dribble.side > 0 ? 'R' : 'L';
        const pole = right.clone().multiplyScalar(side === 'R' ? 0.8 : -0.8).addScaledVector(fwd, -0.5).addScaledVector(up, -0.3);
        if (side === 'R') { tR = top; poleR = pole; } else { tL = top; poleL = pole; }
      } else if (shooting && a.type === 'shot') {
        const back = fwd.clone().multiplyScalar(-BALL_R * 0.85);
        tR = ball.clone().add(back).addScaledVector(up, -BALL_R * 0.35);
        tL = ball.clone().addScaledVector(right, -BALL_R * 1.0);
        poleR = fwd.clone().multiplyScalar(0.6).addScaledVector(up, -0.8).addScaledVector(right, 0.3);
        poleL = right.clone().multiplyScalar(-0.8).addScaledVector(up, -0.6);
      } else {
        // Two hands on the sides of the ball.
        tR = ball.clone().addScaledVector(right, BALL_R * 0.98).addScaledVector(fwd, -0.02);
        tL = ball.clone().addScaledVector(right, -BALL_R * 0.98).addScaledVector(fwd, -0.02);
        poleR = right.clone().multiplyScalar(0.9).addScaledVector(up, -0.7).addScaledVector(fwd, -0.3);
        poleL = right.clone().multiplyScalar(-0.9).addScaledVector(up, -0.7).addScaledVector(fwd, -0.3);
      }
    } else if (b.state === 'air' && b.air && b.air.kind === 'pass' && b.air.target === p) {
      const d = Math.hypot(ball.x - p.x, ball.z - p.z);
      if (d < 2.2) {
        tR = ball.clone().addScaledVector(right, BALL_R);
        tL = ball.clone().addScaledVector(right, -BALL_R);
        poleR = right.clone().addScaledVector(up, -0.7);
        poleL = right.clone().multiplyScalar(-1).addScaledVector(up, -0.7);
      }
    }
    const rate = dt / 0.08;
    this.ik.R += Math.max(-rate, Math.min(rate, (tR ? 1 : 0) - this.ik.R));
    this.ik.L += Math.max(-rate, Math.min(rate, (tL ? 1 : 0) - this.ik.L));
    if (tR) this.lastTR = tR, this.lastPoleR = poleR;
    if (tL) this.lastTL = tL, this.lastPoleL = poleL;
    if (this.ik.R > 0.001 && this.lastTR) this.solveArm('R', this.lastTR, this.lastPoleR, this.ik.R);
    if (this.ik.L > 0.001 && this.lastTL) this.solveArm('L', this.lastTL, this.lastPoleL, this.ik.L);
  }

  solveArm(s, target, pole, weight) {
    // Aim the wrist so the palm (not the wrist) meets the target.
    this.solveTwoBone(this.bones[`upperArm_${s}`], this.bones[`foreArm_${s}`], this.bones[`hand_${s}`], target, pole, weight, this.handLen * 0.42);
  }

  /** Analytic two-bone IK (shoulder/elbow/wrist or hip/knee/ankle) with a pole vector. */
  solveTwoBone(ua, fa, hd, target, pole, weight, inset) {
    const A = ua.getWorldPosition(new THREE.Vector3());
    const B = fa.getWorldPosition(new THREE.Vector3());
    const C = hd.getWorldPosition(new THREE.Vector3());
    const la = A.distanceTo(B), lb = B.distanceTo(C);
    const T = target.clone();
    const toT = T.clone().sub(A);
    const dist = toT.length();
    if (dist > 1e-4 && inset) T.addScaledVector(toT, -inset / dist);
    const dv = T.clone().sub(A);
    let d = dv.length();
    d = Math.max(0.05, Math.min(d, la + lb - 0.002));
    const dir = dv.normalize();
    const cosA = Math.max(-1, Math.min(1, (la * la + d * d - lb * lb) / (2 * la * d)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    const pn = pole.clone().addScaledVector(dir, -pole.dot(dir));
    if (pn.lengthSq() < 1e-6) pn.set(0, -1, 0);
    pn.normalize();
    const elbow = A.clone().addScaledVector(dir, cosA * la).addScaledVector(pn, sinA * la);
    const wrist = A.clone().addScaledVector(dir, d);
    // Upper arm.
    const cur1 = B.clone().sub(A).normalize();
    const want1 = elbow.clone().sub(A).normalize();
    _q1.setFromUnitVectors(cur1, want1);
    ua.getWorldQuaternion(_q2);
    _q1.multiply(_q2); // desired world rotation
    ua.parent.getWorldQuaternion(_q3).invert();
    const local1 = _q3.multiply(_q1);
    ua.quaternion.slerp(local1, weight);
    ua.updateMatrixWorld(true);
    // Forearm.
    const B2 = fa.getWorldPosition(new THREE.Vector3());
    const C2 = hd.getWorldPosition(new THREE.Vector3());
    const cur2 = C2.sub(B2).normalize();
    const want2 = wrist.sub(B2).normalize();
    _q1.setFromUnitVectors(cur2, want2);
    fa.getWorldQuaternion(_q2);
    _q1.multiply(_q2);
    fa.parent.getWorldQuaternion(_q3).invert();
    const local2 = _q3.multiply(_q1);
    fa.quaternion.slerp(local2, weight);
    fa.updateMatrixWorld(true);
  }

  headLook(sim, p, ball, dt) {
    const head = this.bones.head;
    const dx = ball.x - p.x, dz = ball.z - p.z;
    const ang = Math.atan2(dz, dx);
    let yaw = ang - p.facing;
    while (yaw > Math.PI) yaw -= Math.PI * 2;
    while (yaw < -Math.PI) yaw += Math.PI * 2;
    yaw = Math.max(-1.0, Math.min(1.0, yaw));
    this.lookYaw += (yaw - this.lookYaw) * Math.min(1, dt * 6);
    // Facing angle grows counter-clockwise viewed from above in sim space (x,z), which maps to
    // a turn to the character's right; the rig's Y+ is a left turn.
    _q1.setFromAxisAngle(_v1.set(0, 1, 0), -this.lookYaw * 0.7);
    head.quaternion.multiply(_q1);
    head.updateMatrixWorld(true);
  }
}
