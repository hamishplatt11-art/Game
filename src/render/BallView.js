// Basketball mesh: pebbled leather map, spin integrated from the simulated
// angular velocity, and a contact shadow blob for readability.
import * as THREE from 'three';
import { BALL_R } from '../sim/constants.js';
import { makeBallTexture } from './Textures.js';

export class BallView {
  constructor(scene, quality) {
    const geo = new THREE.SphereGeometry(BALL_R, quality === 'low' ? 20 : 36, quality === 'low' ? 14 : 24);
    const mat = new THREE.MeshPhysicalMaterial({ map: makeBallTexture(), roughness: 0.62, clearcoat: 0.15, clearcoatRoughness: 0.6, sheen: 0.3, sheenColor: new THREE.Color('#ff9a5a') });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    scene.add(this.mesh);
    const sc = document.createElement('canvas');
    sc.width = sc.height = 64;
    const x = sc.getContext('2d');
    const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    const st = new THREE.CanvasTexture(sc);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.004;
    scene.add(this.shadow);
    this.pos = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._axis = new THREE.Vector3();
  }

  update(ball, alpha, dt) {
    const p = this.pos.set(
      ball.prevP.x + (ball.p.x - ball.prevP.x) * alpha,
      ball.prevP.y + (ball.p.y - ball.prevP.y) * alpha,
      ball.prevP.z + (ball.p.z - ball.prevP.z) * alpha,
    );
    this.mesh.position.copy(p);
    const w = ball.w;
    const wl = Math.hypot(w.x, w.y, w.z);
    if (wl > 1e-3) {
      this._axis.set(w.x / wl, w.y / wl, w.z / wl);
      this._q.setFromAxisAngle(this._axis, wl * dt);
      this.mesh.quaternion.premultiply(this._q);
    }
    this.shadow.position.set(p.x, 0.004, p.z);
    const s = Math.max(0.3, 1.2 - p.y * 0.25);
    this.shadow.scale.set(s, s, s);
    this.shadow.material.opacity = Math.max(0.1, 0.9 - p.y * 0.18);
    return p;
  }
}
