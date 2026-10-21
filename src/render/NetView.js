// Cloth net: a verlet particle lattice hung from the rim, pushed by the ball
// (so swishes and rattles visibly move the net) and rendered as a mesh with
// an alpha-tested diamond lattice texture.
import * as THREE from 'three';
import { hoopPos, RIM_R, BALL_R } from '../sim/constants.js';
import { makeNetTexture } from './Textures.js';

const COLS = 16, ROWS = 7, DEPTH = 0.45, BOTTOM_R = 0.135;

export class NetView {
  constructor(hoopIdx) {
    this.c = hoopPos(hoopIdx);
    const n = (COLS + 1) * ROWS;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.rest = [];
    for (let i = 0; i < ROWS; i++) {
      const t = i / (ROWS - 1);
      const r = RIM_R + (BOTTOM_R - RIM_R) * Math.pow(t, 0.8);
      for (let j = 0; j <= COLS; j++) {
        const a = (j / COLS) * Math.PI * 2 + (i % 2) * (Math.PI / COLS);
        const k = (i * (COLS + 1) + j) * 3;
        this.pos[k] = this.c.x + Math.cos(a) * r;
        this.pos[k + 1] = this.c.y - t * DEPTH;
        this.pos[k + 2] = this.c.z + Math.sin(a) * r;
      }
    }
    this.prev.set(this.pos);
    this.restPos = this.pos.slice();
    const geo = new THREE.BufferGeometry();
    const uv = [];
    for (let i = 0; i < ROWS; i++) for (let j = 0; j <= COLS; j++) uv.push((j / COLS) * (COLS / 2), 1 - (i / (ROWS - 1)) * 3);
    const idx = [];
    for (let i = 0; i < ROWS - 1; i++) {
      for (let j = 0; j < COLS; j++) {
        const a = i * (COLS + 1) + j, b = a + 1, c = a + COLS + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const tex = makeNetTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, color: '#ffffff' });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    // Constraint rest lengths.
    const L = (k1, k2) => Math.hypot(this.pos[k1] - this.pos[k2], this.pos[k1 + 1] - this.pos[k2 + 1], this.pos[k1 + 2] - this.pos[k2 + 2]);
    this.cons = [];
    for (let i = 0; i < ROWS; i++) {
      for (let j = 0; j < COLS; j++) {
        const a = (i * (COLS + 1) + j) * 3, b = (i * (COLS + 1) + j + 1) * 3;
        this.cons.push([a, b, L(a, b) * 1.02]);
        if (i < ROWS - 1) {
          const c = ((i + 1) * (COLS + 1) + j) * 3, d = ((i + 1) * (COLS + 1) + j + 1) * 3;
          this.cons.push([a, c, L(a, c)]);
          this.cons.push([a, d, L(a, d)]);
        }
      }
    }
  }

  update(dt, ball) {
    if (dt <= 0) return;
    const p = this.pos, q = this.prev;
    const n = p.length / 3;
    const near = ball && Math.hypot(ball.x - this.c.x, ball.z - this.c.z) < 0.7 && ball.y > this.c.y - 0.9 && ball.y < this.c.y + 0.4;
    const h = Math.min(dt, 1 / 30);
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const row = Math.floor(i / (COLS + 1));
      if (row === 0) continue;
      const vx = (p[k] - q[k]) * 0.96, vy = (p[k + 1] - q[k + 1]) * 0.96, vz = (p[k + 2] - q[k + 2]) * 0.96;
      q[k] = p[k]; q[k + 1] = p[k + 1]; q[k + 2] = p[k + 2];
      // Gentle pull back to the hanging shape (net stiffness) plus gravity.
      p[k] += vx + (this.restPos[k] - p[k]) * 0.04;
      p[k + 1] += vy - 9.81 * h * h * 0.6 + (this.restPos[k + 1] - p[k + 1]) * 0.04;
      p[k + 2] += vz + (this.restPos[k + 2] - p[k + 2]) * 0.04;
    }
    for (let it = 0; it < 3; it++) {
      for (const [a, b, rest] of this.cons) {
        const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const diff = (d - rest) / d * 0.5;
        const fa = a < (COLS + 1) * 3 ? 0 : 1, fb = b < (COLS + 1) * 3 ? 0 : 1;
        const sum = fa + fb || 1;
        p[a] += dx * diff * (fa * 2 / sum); p[a + 1] += dy * diff * (fa * 2 / sum); p[a + 2] += dz * diff * (fa * 2 / sum);
        p[b] -= dx * diff * (fb * 2 / sum); p[b + 1] -= dy * diff * (fb * 2 / sum); p[b + 2] -= dz * diff * (fb * 2 / sum);
      }
      if (near) {
        const R = BALL_R + 0.012;
        for (let i = COLS + 1; i < n; i++) {
          const k = i * 3;
          const dx = p[k] - ball.x, dy = p[k + 1] - ball.y, dz = p[k + 2] - ball.z;
          const d = Math.hypot(dx, dy, dz);
          if (d < R && d > 1e-5) { const s = R / d; p[k] = ball.x + dx * s; p[k + 1] = ball.y + dy * s; p[k + 2] = ball.z + dz * s; }
        }
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}
