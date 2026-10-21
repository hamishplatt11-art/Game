// Gameplay cameras. The default "2K" camera sits high on the near sideline,
// tracks the ball with critically damped springs, leads toward the attacking
// basket and never rolls. Other modes: broadcast (long lens), sideline (low),
// high, player-follow, plus cinematic orbits for presentation and replays.
import * as THREE from 'three';
import { HALF_L, HALF_W, hoopPos } from '../sim/constants.js';

export const CAMERA_MODES = ['2k', 'broadcast', 'sideline', 'high', 'follow'];
export const CAMERA_LABELS = { '2k': '2K Elevated', broadcast: 'Broadcast', sideline: 'Sideline', high: 'High', follow: 'Player Follow' };

function spring(cur, vel, target, k, dt) {
  // Critically damped spring (k = stiffness ~ 1/response time).
  const w = k;
  const x = cur - target;
  const f = 1 + 2 * dt * w;
  const oo = w * w;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const det = 1 / (f + hhoo);
  const detX = f * x + dt * vel;
  const detV = vel - hoo * x;
  return [target + detX * det, detV * det];
}

export class CameraSystem {
  constructor(camera) {
    this.camera = camera;
    this.mode = '2k';
    this.settings = { height: 1, zoom: 1, tracking: 1 };
    this.fx = 0; this.fz = 0; this.vfx = 0; this.vfz = 0;
    this.px = 0; this.py = 8; this.pz = 20; this.vpx = 0; this.vpy = 0; this.vpz = 0;
    this.lx = 0; this.ly = 1; this.lz = 0; this.vlx = 0; this.vly = 0; this.vlz = 0;
    this.fov = 38;
    this.cinematic = null;
  }

  setMode(m) { this.mode = m; }

  /** Yaw of the camera's forward vector on the floor (for screen-relative controls). */
  groundBasis() {
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    return { f, r };
  }

  startCinematic(kind, opts) {
    this.cinematic = { kind, t: 0, ...opts };
  }

  stopCinematic() { this.cinematic = null; }

  update(dt, ctx) {
    if (this.cinematic) return this.updateCinematic(dt, ctx);
    const s = this.settings;
    const ball = ctx.ball;
    const attackDir = ctx.attackDir || 0; // +1/-1 direction the offence is going
    const k = 2.2 * s.tracking;
    // Focus: the ball, led toward the attacking basket; bounded to the court.
    let tx = ball.x + attackDir * 2.6;
    tx = Math.max(-HALF_L + 4, Math.min(HALF_L - 4, tx));
    const tz = Math.max(-HALF_W, Math.min(HALF_W, ball.z));
    [this.fx, this.vfx] = spring(this.fx, this.vfx, tx, k, dt);
    [this.fz, this.vfz] = spring(this.fz, this.vfz, tz, k * 0.7, dt);
    let pos, look, fov;
    const H = s.height, Z = s.zoom;
    switch (this.mode) {
      case 'broadcast':
        pos = [this.fx * 0.8, 11 * H, HALF_W + 20 * Z]; look = [this.fx * 0.95, 0.8, this.fz * 0.25 - 1]; fov = 26; break;
      case 'sideline':
        pos = [this.fx * 0.9, 3.4 * H, HALF_W + 5.5 * Z]; look = [this.fx, 1.4, this.fz * 0.4 - 1.5]; fov = 52; break;
      case 'high':
        pos = [this.fx * 0.7, 17 * H, HALF_W + 9 * Z]; look = [this.fx * 0.9, 0, this.fz * 0.3 - 1]; fov = 42; break;
      case 'follow': {
        const u = ctx.user || ball;
        const ax = attackDir || 1;
        pos = [u.x - ax * 7.5 * Z, 4.2 * H, u.z * 0.8];
        look = [u.x + ax * 4, 1.3, u.z * 0.6];
        fov = 50;
        break;
      }
      default:
        // NBA 2K-style elevated sideline view.
        pos = [this.fx * 0.86, 8.2 * H, HALF_W + 11.5 * Z]; look = [this.fx * 0.96, 0.9, this.fz * 0.3 - 0.9]; fov = 37;
    }
    const pk = 3.0;
    [this.px, this.vpx] = spring(this.px, this.vpx, pos[0], pk, dt);
    [this.py, this.vpy] = spring(this.py, this.vpy, pos[1], pk, dt);
    [this.pz, this.vpz] = spring(this.pz, this.vpz, pos[2], pk, dt);
    [this.lx, this.vlx] = spring(this.lx, this.vlx, look[0], pk * 1.3, dt);
    [this.ly, this.vly] = spring(this.ly, this.vly, look[1], pk * 1.3, dt);
    [this.lz, this.vlz] = spring(this.lz, this.vlz, look[2], pk * 1.3, dt);
    this.fov += (fov - this.fov) * Math.min(1, dt * 3);
    this.apply();
  }

  snap() {
    this.px = this.camera.position.x; this.py = this.camera.position.y; this.pz = this.camera.position.z;
    this.vpx = this.vpy = this.vpz = 0;
  }

  apply() {
    const c = this.camera;
    c.position.set(this.px, this.py, this.pz);
    c.lookAt(this.lx, this.ly, this.lz);
    if (Math.abs(c.fov - this.fov) > 0.01) { c.fov = this.fov; c.updateProjectionMatrix(); }
  }

  updateCinematic(dt, ctx) {
    const cin = this.cinematic;
    cin.t += dt;
    const c = this.camera;
    if (cin.kind === 'establish') {
      // Pregame: sweeping orbit of the arena, then down to the centre circle.
      const a = 0.15 + cin.t * 0.12;
      const r = 30 - Math.min(14, cin.t * 1.6);
      c.position.set(Math.cos(a) * r, 14 - Math.min(8, cin.t * 0.8), Math.sin(a) * r + 4);
      c.lookAt(0, 1.5, 0);
      if (c.fov !== 45) { c.fov = 45; c.updateProjectionMatrix(); }
    } else if (cin.kind === 'menu') {
      const a = cin.t * 0.05;
      c.position.set(Math.cos(a) * 24, 9 + Math.sin(cin.t * 0.1) * 2, Math.sin(a) * 18);
      c.lookAt(0, 2, 0);
      if (c.fov !== 42) { c.fov = 42; c.updateProjectionMatrix(); }
    } else if (cin.kind === 'preview') {
      const a = 0.3 + cin.t * 0.25;
      const h = cin.height || 2;
      c.position.set(Math.sin(a) * 4.2, h * 0.6 + 0.4, Math.cos(a) * 4.2);
      c.lookAt(0, h * 0.5, 0);
      if (c.fov !== 38) { c.fov = 38; c.updateProjectionMatrix(); }
    } else if (cin.kind === 'replay') {
      // Low orbit around the highlight player toward the rim.
      const tgt = cin.target ? cin.target() : ctx.ball;
      const h = hoopPos(cin.hoop ?? 1);
      const a = cin.angle0 + cin.t * 0.35;
      const mx = (tgt.x + h.x) / 2, mz = (tgt.z + h.z) / 2;
      c.position.set(mx + Math.cos(a) * 7, 2.4 + Math.sin(cin.t * 0.5) * 0.4, mz + Math.sin(a) * 7);
      c.lookAt(tgt.x * 0.6 + h.x * 0.4, 2.0, tgt.z * 0.6 + h.z * 0.4);
      if (c.fov !== 40) { c.fov = 40; c.updateProjectionMatrix(); }
    } else if (cin.kind === 'freethrow') {
      const h = hoopPos(cin.hoop);
      const s = Math.sign(h.x);
      c.position.set(h.x - s * 10.5, 3.2, 0.6);
      c.lookAt(h.x, 2.6, 0);
      if (c.fov !== 40) { c.fov = 40; c.updateProjectionMatrix(); }
    }
    this.px = c.position.x; this.py = c.position.y; this.pz = c.position.z;
  }
}
