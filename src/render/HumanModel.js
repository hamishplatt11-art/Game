// Procedural, original human athlete generator. Builds a rigged SkinnedMesh
// (pelvis/spine/chest/neck/head, clavicles, arms, hands with a finger bone,
// legs, feet, toes) from anthropometric proportions scaled per player
// (height, wingspan, weight), with muscle shaping (pecs, lats, glutes, quads,
// hamstrings, calves, deltoids, biceps/triceps, forearms), a sculpted head
// with eyelids, hair grown from the head surface, and a uniform (jersey,
// shorts, socks, shoes, accessories) that shares the skeleton.
//
// This is an engineering stand-in for licensed scanned/sculpted character
// assets; the asset pipeline can swap in a GLB that uses the same bone names.
import * as THREE from 'three';
import { makeJerseyTexture, makeShortsTexture, makeSkinTexture, makeFaceTexture, makeHairTexture, makeOfficialTexture } from './Textures.js';

export const BONES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head',
  'clavicle_L', 'upperArm_L', 'foreArm_L', 'hand_L', 'fingers_L',
  'clavicle_R', 'upperArm_R', 'foreArm_R', 'hand_R', 'fingers_R',
  'thigh_L', 'shin_L', 'foot_L', 'toes_L',
  'thigh_R', 'shin_R', 'foot_R', 'toes_R',
];
const PARENT = {
  hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  clavicle_L: 'chest', upperArm_L: 'clavicle_L', foreArm_L: 'upperArm_L', hand_L: 'foreArm_L', fingers_L: 'hand_L',
  clavicle_R: 'chest', upperArm_R: 'clavicle_R', foreArm_R: 'upperArm_R', hand_R: 'foreArm_R', fingers_R: 'hand_R',
  thigh_L: 'hips', shin_L: 'thigh_L', foot_L: 'shin_L', toes_L: 'foot_L',
  thigh_R: 'hips', shin_R: 'thigh_R', foot_R: 'shin_R', toes_R: 'foot_R',
};
const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));

export const SKIN_TONES = ['#f1c9a5', '#e0ac85', '#c68863', '#a0663f', '#7a4a2a', '#4f2f1c'];

/** Rest-pose joint positions (metres, character facing +Z, left = +X). */
export function computeJoints(H, wing) {
  const sw = 0.112 * H; // shoulder joint half-width
  const armLen = (wing - 2 * sw) / 2; // shoulder joint to fingertip
  const ua = armLen * 0.405, fa = armLen * 0.335, hand = armLen * 0.26;
  const J = {
    root: [0, 0, 0],
    hips: [0, 0.55 * H, 0],
    spine: [0, 0.63 * H, 0.004 * H],
    chest: [0, 0.715 * H, 0.002 * H],
    neck: [0, 0.83 * H, -0.006 * H],
    head: [0, 0.876 * H, 0.0],
  };
  for (const [s, k] of [['L', 1], ['R', -1]]) {
    const sy = 0.806 * H;
    J[`clavicle_${s}`] = [k * 0.02 * H, sy - 0.004 * H, 0.004 * H];
    J[`upperArm_${s}`] = [k * sw, sy, -0.006 * H];
    J[`foreArm_${s}`] = [k * (sw + ua * 0.1), sy - ua, -0.012 * H];
    J[`hand_${s}`] = [k * (sw + (ua + fa) * 0.12), sy - ua - fa, -0.002 * H];
    J[`fingers_${s}`] = [k * (sw + (ua + fa) * 0.12 + 0.002 * H), sy - ua - fa - hand * 0.46, 0.004 * H];
    J[`thigh_${s}`] = [k * 0.05 * H, 0.53 * H, 0];
    J[`shin_${s}`] = [k * 0.053 * H, 0.286 * H, 0.004 * H];
    J[`foot_${s}`] = [k * 0.055 * H, 0.046 * H, -0.006 * H];
    J[`toes_${s}`] = [k * 0.056 * H, 0.014 * H, 0.083 * H];
  }
  J.dims = { sw, ua, fa, hand, armLen };
  return J;
}

// ---------------------------------------------------------------------------
// Geometry builder for skinned lofts
// ---------------------------------------------------------------------------
class SkinGeo {
  constructor() {
    this.pos = []; this.uv = []; this.si = []; this.sw = []; this.idx = []; this.col = [];
    this.seams = [];
  }
  vert(p, uv, weights, color) {
    this.pos.push(p[0], p[1], p[2]);
    this.uv.push(uv[0], uv[1]);
    const w = weights.filter((x) => x[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    let tot = 0;
    for (const x of w) tot += x[1];
    for (let i = 0; i < 4; i++) {
      this.si.push(w[i] ? BI[w[i][0]] : 0);
      this.sw.push(w[i] ? w[i][1] / tot : 0);
    }
    if (color) this.col.push(color[0], color[1], color[2]);
    return this.pos.length / 3 - 1;
  }
  /**
   * rings: [{ c:[x,y,z], u:[lateral], w:[front], rx, rz, n, wts:[[bone,w]...] | fn(p,a), mod?: fn(a), color? }]
   * Angle a: 0 = +u (lateral +X), PI/2 = +w (front), PI = -u, 3PI/2 = back.
   */
  loft(rings, segs, { capStart = false, capEnd = false, vRange = [0, 1], uFlip = true } = {}) {
    const start = this.pos.length / 3;
    rings.forEach((r, i) => {
      const v = vRange[0] + (vRange[1] - vRange[0]) * (i / (rings.length - 1));
      const n = r.n || 2;
      for (let j = 0; j <= segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const m = r.mod ? r.mod(a) : 1;
        const ex = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / n) * r.rx * m;
        const ez = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / n) * r.rz * m;
        const p = [r.c[0] + r.u[0] * ex + r.w[0] * ez, r.c[1] + r.u[1] * ex + r.w[1] * ez, r.c[2] + r.u[2] * ex + r.w[2] * ez];
        const wts = typeof r.wts === 'function' ? r.wts(p, a) : r.wts;
        this.vert(p, [uFlip ? 1 - j / segs : j / segs, v], wts, r.color);
      }
      this.seams.push([start + i * (segs + 1), start + i * (segs + 1) + segs]);
    });
    const row = segs + 1;
    // Winding: faces point outward when (loft axis x w) is along u. Lofts that run
    // downward (limbs) or along +z with an upward w (shoes) need the opposite order.
    const f = rings[0], l = rings[rings.length - 1];
    const ax = [l.c[0] - f.c[0], l.c[1] - f.c[1], l.c[2] - f.c[2]];
    const cw = [ax[1] * f.w[2] - ax[2] * f.w[1], ax[2] * f.w[0] - ax[0] * f.w[2], ax[0] * f.w[1] - ax[1] * f.w[0]];
    const inv = cw[0] * f.u[0] + cw[1] * f.u[1] + cw[2] * f.u[2] < 0;
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < segs; j++) {
        const a = start + i * row + j, b = a + 1, c = a + row, d = c + 1;
        if (inv) this.idx.push(a, b, c, b, d, c);
        else this.idx.push(a, c, b, b, c, d);
      }
    }
    const cap = (ri, flip) => {
      const r = rings[ri];
      const wts = typeof r.wts === 'function' ? r.wts(r.c, 0) : r.wts;
      const ci = this.vert(r.c, [0.5, ri === 0 ? vRange[0] : vRange[1]], wts, r.color);
      for (let j = 0; j < segs; j++) {
        const a = start + ri * row + j, b = a + 1;
        if (flip !== inv) this.idx.push(ci, a, b); else this.idx.push(ci, b, a);
      }
    };
    if (capStart) cap(0, false);
    if (capEnd) cap(rings.length - 1, true);
  }
  mesh(geo, weightFn, transform, colorFn) {
    const start = this.pos.length / 3;
    const p = geo.attributes.position, uv = geo.attributes.uv;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      if (transform) transform(v, i);
      this.vert([v.x, v.y, v.z], uv ? [uv.getX(i), uv.getY(i)] : [0, 0], weightFn(v), colorFn ? colorFn(v) : null);
    }
    const index = geo.index;
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(start + index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(start + i);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    // Weld normals across UV seams so lofts shade smoothly.
    const n = g.attributes.normal;
    for (const [a, b] of this.seams) {
      const x = (n.getX(a) + n.getX(b)) / 2, y = (n.getY(a) + n.getY(b)) / 2, z = (n.getZ(a) + n.getZ(b)) / 2;
      const l = Math.hypot(x, y, z) || 1;
      n.setXYZ(a, x / l, y / l, z / l);
      n.setXYZ(b, x / l, y / l, z / l);
    }
    g.computeBoundingSphere();
    return g;
  }
}

const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const bump = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
const X = [1, 0, 0], Z = [0, 0, 1];

function frameFor(dir) {
  const d = new THREE.Vector3(...dir).normalize();
  const u = new THREE.Vector3(1, 0, 0);
  u.sub(d.clone().multiplyScalar(u.dot(d))).normalize();
  const w = new THREE.Vector3().crossVectors(u, d).normalize();
  if (w.z < 0) w.negate();
  return { u: u.toArray(), w: w.toArray() };
}

// ---------------------------------------------------------------------------
// Torso
// ---------------------------------------------------------------------------
// [y/H, halfWidth/H, halfDepth/H, zOffset/H, superellipse n]
const TORSO = [
  [0.47, 0.042, 0.038, 0.0, 2.0],
  [0.49, 0.078, 0.058, -0.003, 2.2],
  [0.515, 0.09, 0.064, -0.006, 2.3],
  [0.55, 0.093, 0.064, -0.006, 2.3],
  [0.585, 0.085, 0.057, -0.001, 2.2],
  [0.625, 0.075, 0.052, 0.002, 2.2],
  [0.665, 0.08, 0.056, 0.004, 2.3],
  [0.705, 0.09, 0.062, 0.007, 2.4],
  [0.745, 0.098, 0.066, 0.007, 2.5],
  [0.775, 0.104, 0.063, 0.004, 2.6],
  [0.797, 0.103, 0.056, -0.001, 2.6],
  [0.814, 0.084, 0.051, -0.004, 2.4],
  [0.829, 0.062, 0.047, -0.006, 2.2],
  [0.845, 0.046, 0.044, -0.006, 2.0],
];

function torsoProfile(H, g) {
  return TORSO.map(([y, hw, hd, zo, n]) => ({ y: y * H, hw: hw * H * g, hd: hd * H * g, zo: zo * H, n }));
}

/** Muscle relief on the torso as a radius multiplier by angle and height. */
function torsoMod(yh, g) {
  const m = Math.min(1.25, Math.max(0.8, 1 + (1.05 - g) * 1.2)); // leaner players show more definition
  return (a) => {
    const ca = Math.cos(a), sa = Math.sin(a);
    const front = Math.max(0, sa), back = Math.max(0, -sa);
    let k = 1;
    // Pectorals: two masses either side of the sternum.
    k += 0.085 * m * front * front * bump(Math.abs(ca), 0.45, 0.3) * bump(yh, 0.74, 0.035);
    k -= 0.03 * front * bump(ca, 0, 0.12) * bump(yh, 0.73, 0.06);
    // Abdominal flattening and obliques taper.
    k -= 0.025 * front * bump(yh, 0.63, 0.05);
    // Lats: wide V on the back/sides below the armpit.
    k += 0.06 * m * bump(Math.abs(ca), 0.75, 0.3) * back * bump(yh, 0.73, 0.05);
    // Spine groove.
    k -= 0.03 * back * bump(ca, 0, 0.12) * sstep(0.55, 0.62, yh);
    // Glutes.
    k += 0.1 * back * back * bump(Math.abs(ca), 0.42, 0.32) * bump(yh, 0.525, 0.03);
    // Trapezius slope.
    k += 0.04 * back * bump(yh, 0.82, 0.02);
    return k;
  };
}

function torsoWeights(H) {
  return (p) => {
    const yh = p[1] / H;
    let w;
    if (yh < 0.56) w = [['hips', 1]];
    else if (yh < 0.64) { const t = sstep(0.56, 0.64, yh); w = [['hips', 1 - t], ['spine', t]]; }
    else if (yh < 0.72) { const t = sstep(0.64, 0.72, yh); w = [['spine', 1 - t], ['chest', t]]; }
    else if (yh < 0.825) w = [['chest', 1]];
    else { const t = sstep(0.825, 0.85, yh); w = [['chest', 1 - t * 0.6], ['neck', t * 0.6]]; }
    // Shoulders follow the arm/clavicle so raising the arms deforms them.
    const ax = Math.abs(p[0]) / H;
    if (yh > 0.74 && ax > 0.075) {
      const s = p[0] > 0 ? 'L' : 'R';
      const k = sstep(0.075, 0.115, ax) * sstep(0.74, 0.79, yh);
      w = w.map(([b, v]) => [b, v * (1 - k * 0.65)]);
      w.push([`clavicle_${s}`, k * 0.3], [`upperArm_${s}`, k * 0.35]);
    }
    // Upper thigh/glute area follows the legs a little.
    if (yh < 0.53) {
      const s = p[0] > 0 ? 'L' : 'R';
      const k = sstep(0.53, 0.47, yh) * sstep(0.01, 0.05, Math.abs(p[0]) / H);
      w = w.map(([b, v]) => [b, v * (1 - k * 0.5)]);
      w.push([`thigh_${s}`, k * 0.5]);
    }
    return w;
  };
}

function torsoRings(H, g, { scale = 1, extra = 0, yMin = 0, yMax = 99, sculpt = true } = {}) {
  const wf = torsoWeights(H);
  return torsoProfile(H, g).filter((r) => r.y >= yMin - 1e-6 && r.y <= yMax + 1e-6).map((r) => ({
    c: [0, r.y, r.zo], u: X, w: Z, rx: r.hw * scale + extra, rz: r.hd * scale + extra, n: r.n,
    mod: sculpt ? torsoMod(r.y / H, g) : null, wts: wf,
  }));
}

function sampleTorso(H, g, y) {
  const prof = torsoProfile(H, g);
  for (let i = 0; i < prof.length - 1; i++) {
    if (y >= prof[i].y && y <= prof[i + 1].y) {
      const t = (y - prof[i].y) / (prof[i + 1].y - prof[i].y);
      return { hw: lerp(prof[i].hw, prof[i + 1].hw, t), hd: lerp(prof[i].hd, prof[i + 1].hd, t), zo: lerp(prof[i].zo, prof[i + 1].zo, t), n: lerp(prof[i].n, prof[i + 1].n, t) };
    }
  }
  return prof[prof.length - 1];
}

// ---------------------------------------------------------------------------
// Limbs
// ---------------------------------------------------------------------------
function legRings(J, side, H, g, { from = 0, to = 1, scale = 1, extra = 0, sculpt = true } = {}) {
  const hip = J[`thigh_${side}`], knee = J[`shin_${side}`], ankle = J[`foot_${side}`];
  const top = [hip[0] * 0.9, hip[1] + 0.035 * H, hip[2]];
  const k = side === 'L' ? 1 : -1;
  // [t along hip->ankle, rx, rz, zOff]
  const prof = [
    [0.0, 0.06, 0.064, -0.004], [0.07, 0.064, 0.068, -0.004], [0.18, 0.06, 0.063, 0.001], [0.3, 0.054, 0.057, 0.003], [0.42, 0.047, 0.05, 0.004],
    [0.52, 0.039, 0.042, 0.005], [0.575, 0.035, 0.038, 0.006], [0.62, 0.034, 0.037, 0.002], [0.67, 0.037, 0.042, -0.006], [0.73, 0.04, 0.045, -0.011],
    [0.8, 0.036, 0.04, -0.009], [0.87, 0.029, 0.031, -0.004], [0.94, 0.023, 0.025, -0.001], [1.0, 0.021, 0.023, 0.0],
  ];
  const kneeT = (top[1] - knee[1]) / (top[1] - ankle[1]);
  const rings = [];
  for (const [t0, rx, rz, zo] of prof) {
    if (t0 < from - 1e-6 || t0 > to + 1e-6) continue;
    let c, dir;
    if (t0 <= kneeT) { c = lerp3(top, knee, t0 / kneeT); dir = [knee[0] - top[0], knee[1] - top[1], knee[2] - top[2]]; }
    else { c = lerp3(knee, ankle, (t0 - kneeT) / (1 - kneeT)); dir = [ankle[0] - knee[0], ankle[1] - knee[1], ankle[2] - knee[2]]; }
    const f = frameFor(dir);
    const kb = sstep(kneeT - 0.05, kneeT + 0.05, t0);
    let wts = [[`thigh_${side}`, 1 - kb], [`shin_${side}`, kb]];
    if (t0 < 0.1) { const hb = 1 - sstep(0, 0.1, t0); wts = [[`thigh_${side}`, 1 - hb * 0.45], ['hips', hb * 0.45]]; }
    const gg = t0 < 0.5 ? g : lerp(g, 1, 0.5);
    const mod = sculpt ? (a) => {
      const ca = Math.cos(a), sa = Math.sin(a);
      const front = Math.max(0, sa), back = Math.max(0, -sa);
      const medial = Math.max(0, -ca * k);
      let m = 1;
      m += 0.07 * front * bump(t0, 0.3, 0.12); // quadriceps
      m += 0.05 * front * medial * bump(t0, 0.5, 0.05); // teardrop (VMO)
      m += 0.04 * back * bump(t0, 0.28, 0.12); // hamstrings
      m += 0.035 * front * bump(t0, kneeT, 0.025); // kneecap
      m += 0.13 * back * (0.6 + 0.4 * medial) * bump(t0, kneeT + 0.1, 0.06); // calves
      m -= 0.03 * front * bump(t0, kneeT + 0.15, 0.1); // shin
      return m;
    } : null;
    rings.push({ c: [c[0], c[1], c[2] + zo * H], u: f.u, w: f.w, rx: rx * H * gg * scale + extra, rz: rz * H * gg * scale + extra, n: 2.1, wts, mod });
  }
  return rings;
}

function armRings(J, side, H, g, { from = 0, to = 1, scale = 1, extra = 0, sculpt = true } = {}) {
  const sh = J[`upperArm_${side}`], el = J[`foreArm_${side}`], wr = J[`hand_${side}`];
  const k = side === 'L' ? 1 : -1;
  // Start inside the shoulder so the arm grows out of the torso.
  const top = [sh[0] - k * 0.026 * H, sh[1] + 0.012 * H, sh[2]];
  const prof = [
    [0.0, 0.03, 0.034, 0], [0.06, 0.043, 0.046, 0], [0.13, 0.044, 0.043, 0.001], [0.24, 0.039, 0.039, 0.002],
    [0.36, 0.035, 0.037, 0.003], [0.47, 0.029, 0.03, -0.001], [0.53, 0.027, 0.028, -0.002], [0.62, 0.031, 0.029, 0.002],
    [0.74, 0.027, 0.024, 0.001], [0.9, 0.021, 0.017, 0], [1.0, 0.019, 0.015, 0],
  ];
  const upLen = Math.hypot(el[0] - top[0], el[1] - top[1], el[2] - top[2]);
  const loLen = Math.hypot(wr[0] - el[0], wr[1] - el[1], wr[2] - el[2]);
  const elbowT = upLen / (upLen + loLen);
  const rings = [];
  for (const [t0, rx, rz, zo] of prof) {
    if (t0 < from - 1e-6 || t0 > to + 1e-6) continue;
    let c, dir;
    if (t0 <= elbowT) { c = lerp3(top, el, t0 / elbowT); dir = [el[0] - top[0], el[1] - top[1], el[2] - top[2]]; }
    else { c = lerp3(el, wr, (t0 - elbowT) / (1 - elbowT)); dir = [wr[0] - el[0], wr[1] - el[1], wr[2] - el[2]]; }
    const f = frameFor(dir);
    const eb = sstep(elbowT - 0.04, elbowT + 0.04, t0);
    let wts = [[`upperArm_${side}`, 1 - eb], [`foreArm_${side}`, eb]];
    if (t0 < 0.06) wts = [[`upperArm_${side}`, 0.65], [`clavicle_${side}`, 0.35]];
    if (t0 > 0.95) wts = [[`foreArm_${side}`, 0.7], [`hand_${side}`, 0.3]];
    const mod = sculpt ? (a) => {
      const ca = Math.cos(a), sa = Math.sin(a);
      const front = Math.max(0, sa), back = Math.max(0, -sa), lateral = Math.max(0, ca * k);
      let m = 1;
      m += 0.1 * front * bump(t0, 0.3, 0.09); // biceps
      m += 0.08 * back * bump(t0, 0.26, 0.11); // triceps
      m += 0.05 * lateral * bump(t0, 0.1, 0.07); // lateral deltoid
      m += 0.07 * (1 - lateral) * front * bump(t0, elbowT + 0.08, 0.06); // forearm flexors
      return m;
    } : null;
    rings.push({ c: [c[0], c[1], c[2] + zo * H], u: f.u, w: f.w, rx: rx * H * g * scale + extra, rz: rz * H * g * scale + extra, n: 2.1, wts, mod });
  }
  return rings;
}

function buildHand(sg, J, side, H) {
  const k = side === 'L' ? 1 : -1;
  const w = J[`hand_${side}`];
  const fj = J[`fingers_${side}`];
  const palmLen = w[1] - fj[1];
  const rings = [];
  const steps = [[0, 0.011, 0.016], [0.3, 0.0125, 0.023], [0.7, 0.012, 0.025], [1.0, 0.0105, 0.023]];
  for (const [t, rx, rz] of steps) {
    rings.push({ c: [lerp(w[0], fj[0], t), w[1] - palmLen * t, lerp(w[2], fj[2], t)], u: X, w: Z, rx: rx * H, rz: rz * H, n: 2.6, wts: [[`hand_${side}`, 1]] });
  }
  sg.loft(rings, 12, { capEnd: true });
  const fl = 0.045 * H;
  for (let i = 0; i < 4; i++) {
    const zz = fj[2] + (-0.0155 + i * 0.0105) * H;
    const len = fl * [0.88, 1.0, 0.95, 0.76][i];
    const fr = [];
    for (let s = 0; s <= 4; s++) {
      const t = s / 4;
      fr.push({ c: [fj[0] + k * 0.0012 * H, fj[1] - len * t, zz], u: X, w: Z, rx: 0.005 * H * (1 - t * 0.22), rz: 0.0052 * H * (1 - t * 0.22), n: 2, wts: [[`fingers_${side}`, 1]] });
    }
    sg.loft(fr, 6, { capEnd: true });
  }
  const tb = [w[0] + k * 0.006 * H, w[1] - palmLen * 0.32, w[2] + 0.02 * H];
  const tr = [];
  for (let s = 0; s <= 4; s++) {
    const t = s / 4;
    tr.push({ c: [tb[0] + k * 0.004 * H * t, tb[1] - 0.032 * H * t, tb[2] + 0.012 * H * t], u: X, w: Z, rx: 0.0062 * H * (1 - t * 0.3), rz: 0.006 * H * (1 - t * 0.3), n: 2, wts: [[`hand_${side}`, 1]] });
  }
  sg.loft(tr, 6, { capEnd: true });
}

// ---------------------------------------------------------------------------
// Head
// ---------------------------------------------------------------------------
function makeSculptor(H, variant) {
  const hx = 0.041 * H * variant.width, hy = 0.062 * H, hz = 0.052 * H;
  const d = 0.001 * H;
  const G = (x, y, cx, cy, sx, sy) => Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));
  /** Unit-sphere direction -> sculpted head point (head-local, centred). */
  const sculpt = (nx, ny, nz) => {
    let x = nx, y = ny, z = nz;
    const front = Math.max(0, z);
    if (y < 0) {
      const t = Math.min(1, -y / 0.95);
      x *= 1 - 0.3 * t * t * variant.jaw;
      z *= 1 - 0.1 * t;
      if (z > 0) z += 0.06 * t * front;
    }
    if (y > 0.6) y = 0.6 + (y - 0.6) * 0.9; // slightly flatter crown
    if (z < 0) z *= 1.07;
    if (z > 0.6) z = 0.6 + (z - 0.6) * 0.72;
    let X = x * hx, Y = y * hy, Zz = z * hz;
    Zz += 5 * d * G(x, y, 0, 0.25, 0.55, 0.07) * front; // brow ridge
    Zz -= 6.5 * d * (G(x, y, 0.31, 0.12, 0.15, 0.09) + G(x, y, -0.31, 0.12, 0.15, 0.09)) * front; // eye sockets
    Zz += 3.5 * d * (G(x, y, 0.5, -0.06, 0.2, 0.13) + G(x, y, -0.5, -0.06, 0.2, 0.13)) * front; // cheekbones
    X += Math.sign(x) * 2.2 * d * G(Math.abs(x), y, 0.78, -0.08, 0.2, 0.18);
    const nose = G(x, y, 0, -0.06, 0.085 * variant.nose, 0.22) * front;
    Zz += 18 * d * nose * variant.noseLen; // nose bridge and tip
    Zz += 5 * d * G(x, y, 0, -0.23, 0.2 * variant.nose, 0.06) * front; // nostrils
    Zz += 5 * d * G(x, y, 0, -0.41, 0.28, 0.06) * front * variant.lips; // upper lip
    Zz += 4 * d * G(x, y, 0, -0.5, 0.26, 0.05) * front * variant.lips; // lower lip
    Zz -= 2.5 * d * G(x, y, 0, -0.455, 0.27, 0.015) * front; // mouth line
    Zz += 6 * d * G(x, y, 0, -0.8, 0.26, 0.11) * front; // chin
    Zz -= 2 * d * (G(x, y, 0.42, -0.35, 0.12, 0.15) + G(x, y, -0.42, -0.35, 0.12, 0.15)) * front; // under cheekbones
    return [X, Y, Zz];
  };
  return { sculpt, hx, hy, hz };
}

function sculptedSphere(sc, segW = 48, segH = 36, scaleFn = null) {
  const geo = new THREE.SphereGeometry(1, segW, segH);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const s = sc.sculpt(v.x, v.y, v.z);
    const k = scaleFn ? scaleFn(v.x, v.y, v.z) : 1;
    p.setXYZ(i, s[0] * k, s[1] * k, s[2] * k);
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------
const matCache = new Map();

export function buildHuman(def, uniform, opts = {}) {
  const H = def.heightM;
  const wing = def.wingM;
  const bmi = def.weightKg / (H * H);
  const g = Math.max(0.9, Math.min(1.2, Math.sqrt(bmi / 25)));
  const J = computeJoints(H, wing);
  const quality = opts.quality || 'high';
  const segs = quality === 'low' ? 12 : quality === 'medium' ? 16 : 22;

  const bones = {};
  for (const name of BONES) {
    const b = new THREE.Bone();
    b.name = name;
    bones[name] = b;
  }
  for (const name of BONES) {
    const pa = PARENT[name];
    const pos = J[name];
    if (pa) {
      const pp = J[pa];
      bones[name].position.set(pos[0] - pp[0], pos[1] - pp[1], pos[2] - pp[2]);
      bones[pa].add(bones[name]);
    } else bones[name].position.set(pos[0], pos[1], pos[2]);
  }
  const group = new THREE.Group();
  group.add(bones.root);
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(BONES.map((n) => bones[n]));

  const skinTone = SKIN_TONES[def.skin ?? 2];
  const seed = hashStr(def.id || def.name);
  const variant = {
    width: 0.97 + (seed % 7) * 0.01,
    jaw: 0.75 + ((seed >> 3) % 5) * 0.08,
    nose: 0.9 + ((seed >> 5) % 5) * 0.07,
    noseLen: 0.85 + ((seed >> 7) % 5) * 0.06,
    lips: 0.85 + ((seed >> 9) % 5) * 0.09,
  };

  // --- Skin body ---------------------------------------------------------
  const body = new SkinGeo();
  body.loft(torsoRings(H, g, { scale: 0.99 }), segs + 6, { capStart: true });
  for (const s of ['L', 'R']) {
    body.loft(legRings(J, s, H, g), segs);
    body.loft(armRings(J, s, H, g), segs, { capStart: true });
    buildHand(body, J, s, H);
  }
  const neckRings = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    const y = lerp(0.815 * H, 0.9 * H, t);
    const r = (0.046 - 0.008 * t) * H * Math.min(1.12, g);
    neckRings.push({
      c: [0, y, lerp(-0.008, 0.0, t) * H], u: X, w: Z, rx: r, rz: r * 0.86, n: 2,
      mod: (a) => 1 + 0.06 * Math.max(0, Math.sin(a)) * bump(Math.abs(Math.cos(a)), 0.55, 0.25) * (1 - t), // sternocleidomastoid
      wts: t < 0.25 ? [['chest', 0.5], ['neck', 0.5]] : t > 0.8 ? [['neck', 0.4], ['head', 0.6]] : [['neck', 1]],
    });
  }
  body.loft(neckRings, segs);

  // Head (own UV space for the face texture).
  const sc = makeSculptor(H, variant);
  const headC = [0, 0.926 * H, 0.006 * H];
  const headSG = new SkinGeo();
  headSG.mesh(sculptedSphere(sc), () => [['head', 1]], (v) => v.set(v.x + headC[0], v.y + headC[1], v.z + headC[2]));
  // Ears: flattened shells set against the skull.
  for (const k of [1, -1]) {
    const ear = new THREE.SphereGeometry(1, 12, 10);
    headSG.mesh(ear, () => [['head', 1]], (v) => v.set(k * sc.hx * 0.96 + v.x * 0.0065 * H + k * 0.002 * H, headC[1] - 0.004 * H + v.y * 0.026 * H, headC[2] - 0.008 * H + v.z * 0.016 * H));
  }
  // Eyelids (skin) partly covering the eyeballs.
  const eyeR = 0.0062 * H;
  const eyeCenters = [1, -1].map((k) => {
    const s = sc.sculpt(k * 0.31, 0.12, Math.sqrt(1 - 0.31 * 0.31 - 0.12 * 0.12));
    return [s[0] + headC[0], s[1] + headC[1], s[2] + headC[2] - eyeR * 0.4];
  });
  for (const c of eyeCenters) {
    const lid = new THREE.SphereGeometry(eyeR * 1.08, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.36);
    headSG.mesh(lid, () => [['head', 1]], (v) => { v.applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.12); v.set(v.x + c[0], v.y + c[1], v.z + c[2]); });
    const low = new THREE.SphereGeometry(eyeR * 1.08, 14, 6, 0, Math.PI * 2, Math.PI * 0.74, Math.PI * 0.26);
    headSG.mesh(low, () => [['head', 1]], (v) => { v.applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.2); v.set(v.x + c[0], v.y + c[1], v.z + c[2]); });
  }
  const skinTex = makeSkinTexture(skinTone, seed);
  const skinMat = cachedMat(`skin-${skinTone}-${quality}`, () => (quality === 'low'
    ? new THREE.MeshLambertMaterial({ color: 0xffffff, map: skinTex })
    : new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: skinTex, roughness: 0.5, metalness: 0, clearcoat: 0.18, clearcoatRoughness: 0.42, sheen: 0.3, sheenColor: new THREE.Color(skinTone).lerp(new THREE.Color('#ff8866'), 0.3), sheenRoughness: 0.55 })));
  const faceTex = makeFaceTexture(skinTone, def, seed);
  const faceMat = quality === 'low'
    ? new THREE.MeshLambertMaterial({ map: faceTex })
    : new THREE.MeshPhysicalMaterial({ map: faceTex, roughness: 0.5, clearcoat: 0.18, clearcoatRoughness: 0.45, sheen: 0.3, sheenColor: new THREE.Color(skinTone).lerp(new THREE.Color('#ff8866'), 0.3) });

  const meshes = [];
  const addMesh = (geo, mat, name) => {
    const m = new THREE.SkinnedMesh(geo, mat);
    m.name = name;
    m.castShadow = true;
    m.frustumCulled = false;
    group.add(m);
    m.bind(skeleton);
    meshes.push(m);
    return m;
  };
  addMesh(body.build(), skinMat, 'body');
  addMesh(headSG.build(), faceMat, 'head');
  const eyeSG = new SkinGeo();
  for (const c of eyeCenters) {
    const eg = new THREE.SphereGeometry(eyeR, 14, 10);
    eyeSG.mesh(eg, () => [['head', 1]], (v) => v.set(v.x + c[0], v.y + c[1], v.z + c[2]));
  }
  addMesh(eyeSG.build(), cachedMat('eye', () => new THREE.MeshPhysicalMaterial({ map: eyeTexture(), roughness: 0.08, clearcoat: 1 })), 'eyes');

  // --- Hair and facial hair grown from the sculpted head surface ------------
  const hair = buildHair(def.hair, sc, headC);
  if (hair) addMesh(hair, cachedMat(`hair-${def.hair}-${quality}`, () => new THREE.MeshStandardMaterial({ color: 0xffffff, map: makeHairTexture(def.hair), roughness: 0.85, alphaTest: 0.3, side: THREE.DoubleSide })), 'hair');
  if (def.beard === 'full' || def.beard === 'short') {
    addMesh(buildBeard(def.beard, sc, headC), cachedMat(`beard-${quality}`, () => new THREE.MeshStandardMaterial({ color: 0xffffff, map: makeHairTexture('beard'), roughness: 0.9, alphaTest: 0.3, side: THREE.DoubleSide })), 'beard');
  }

  // --- Uniform -------------------------------------------------------------
  const colors = uniform.colors;
  const jersey = new SkinGeo();
  const jr = torsoRings(H, g, { scale: 1.04, extra: 0.0045 * H, yMin: 0.49 * H, yMax: 0.818 * H, sculpt: false }).map((r) => {
    const yh = r.c[1] / H;
    const loose = yh < 0.6 ? lerp(1.06, 1.0, (yh - 0.49) / 0.11) : 1;
    // Fabric drapes over the chest: smoothed pec relief, no glutes/spine detail.
    return { ...r, rx: r.rx * loose, rz: r.rz * loose, n: Math.min(2.4, r.n), mod: (a) => 1 + 0.05 * Math.max(0, Math.sin(a)) ** 2 * bump(yh, 0.74, 0.04) };
  });
  jr.unshift({ ...jr[0], c: [0, 0.46 * H, jr[0].c[2]], rx: jr[0].rx * 1.02, rz: jr[0].rz * 1.04, mod: null });
  jersey.loft(jr, segs + 8);
  const jerseyTex = uniform.official ? makeOfficialTexture(def.num) : makeJerseyTexture(colors, def.num, def.last, opts.teamName || '');
  const clothMat = (tex, rough = 0.78) => (quality === 'low'
    ? new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide })
    : new THREE.MeshPhysicalMaterial({ map: tex, roughness: rough, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(colors[0]).lerp(new THREE.Color('#ffffff'), 0.4), alphaTest: 0.5, side: THREE.DoubleSide }));
  addMesh(jersey.build(), clothMat(jerseyTex, 0.72), 'jersey');

  if (uniform.official) {
    // Referee: full-length slacks instead of shorts.
    const pants = new SkinGeo();
    const wbp = [];
    for (const y of [0.6, 0.57, 0.54, 0.51]) {
      const t = sampleTorso(H, g, y * H);
      wbp.push({ c: [0, y * H, t.zo], u: X, w: Z, rx: t.hw * 1.05 + 0.005 * H, rz: t.hd * 1.08 + 0.006 * H, n: 2.3, wts: torsoWeights(H) });
    }
    pants.loft(wbp, segs + 8);
    for (const s of ['L', 'R']) pants.loft(legRings(J, s, H, g, { from: 0, to: 0.97, scale: 1.26, extra: 0.008 * H, sculpt: false }), segs);
    addMesh(pants.build(), cachedMat('ref-pants', () => new THREE.MeshStandardMaterial({ color: '#15161a', roughness: 0.8 })), 'pants');
    addMesh(buildShoes(J, H, '#101010', '#202020'), cachedMat(`shoe-${quality}`, () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.05 })), 'shoes');
    return { group, skeleton, bones, meshes, H, J, g, headC };
  }
  const shorts = new SkinGeo();
  const wb = [];
  for (const y of [0.605, 0.575, 0.545, 0.52, 0.5]) {
    const t = sampleTorso(H, g, y * H);
    wb.push({ c: [0, y * H, t.zo], u: X, w: Z, rx: t.hw * 1.08 + 0.006 * H, rz: t.hd * 1.12 + 0.008 * H, n: 2.3, wts: torsoWeights(H) });
  }
  shorts.loft(wb, segs + 8, { vRange: [0, 0.3] });
  for (const s of ['L', 'R']) {
    const lr = legRings(J, s, H, g, { from: 0, to: 0.5, scale: 1.3, extra: 0.008 * H, sculpt: false }).map((r, i, arr) => {
      const t = i / (arr.length - 1);
      return { ...r, rx: r.rx * (1 + 0.1 * t), rz: r.rz * (1 + 0.12 * t), wts: t < 0.25 ? [['hips', 0.45], [`thigh_${s}`, 0.55]] : [['hips', 0.08], [`thigh_${s}`, 0.92]] };
    });
    shorts.loft(lr, segs, { vRange: [0.3, 1] });
  }
  addMesh(shorts.build(), clothMat(makeShortsTexture(colors, opts.teamName || ''), 0.8), 'shorts');

  const sockColor = uniform.socks || '#f2f2f2';
  const socks = new SkinGeo();
  for (const s of ['L', 'R']) socks.loft(legRings(J, s, H, g, { from: 0.84, to: 1.0, scale: 1.06, extra: 0.002 * H }), segs);
  addMesh(socks.build(), cachedMat(`sock-${sockColor}-${quality}`, () => new THREE.MeshStandardMaterial({ color: sockColor, roughness: 0.95 })), 'socks');

  addMesh(buildShoes(J, H, uniform.shoe || colors[0], uniform.shoeAccent || colors[1]), cachedMat(`shoe-${quality}`, () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.05 })), 'shoes');

  const acc = def.acc || [];
  if (acc.includes('sleeveR') || acc.includes('sleeveL')) {
    const sl = new SkinGeo();
    for (const s of ['L', 'R']) if (acc.includes(`sleeve${s}`)) sl.loft(armRings(J, s, H, g, { from: 0.13, to: 0.96, scale: 1.04, extra: 0.0015 * H }), segs);
    addMesh(sl.build(), cachedMat(`sleeve-${quality}`, () => new THREE.MeshPhysicalMaterial({ color: '#141414', roughness: 0.5, sheen: 0.4 })), 'sleeve');
  }
  if (acc.includes('headband')) {
    const hb = new SkinGeo();
    const tor = new THREE.TorusGeometry(1, 0.12, 8, 40);
    hb.mesh(tor, () => [['head', 1]], (v) => {
      const x = v.x, y = v.y;
      v.set(x * sc.hx * 1.04, headC[1] + 0.36 * sc.hy + v.z * 0.011 * H, y * sc.hz * 1.08 + headC[2] - 0.002 * H);
    });
    addMesh(hb.build(), cachedMat('headband', () => new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: 0.9 })), 'headband');
  }

  return { group, skeleton, bones, meshes, H, J, g, headC };
}

function buildHair(style, sc, headC) {
  if (!style || style === 'bald') return null;
  const P = {
    buzz: { s: 1.012, top: 1.02, line: 0.36 },
    short: { s: 1.025, top: 1.05, line: 0.4 },
    fade: { s: 1.01, top: 1.08, line: 0.4, fade: true },
    afro: { s: 1.16, top: 1.34, line: 0.32 },
    twists: { s: 1.07, top: 1.2, line: 0.34, bumps: true },
    braids: { s: 1.025, top: 1.04, line: 0.34 },
    long: { s: 1.05, top: 1.1, line: 0.34, long: true },
  }[style] || { s: 1.03, top: 1.08, line: 0.38 };
  const geo = sculptedSphere(sc, 44, 32, (x, y, z) => {
    // Hairline: forehead, temples, around the ears, nape.
    const front = z > 0;
    const lim = front ? P.line - 0.35 * (1 - Math.min(1, z * 1.2)) * (Math.abs(x) > 0.55 ? 1 : 0.5) : -0.55 + Math.max(0, -z) * 0.05;
    const earZone = Math.abs(x) > 0.8 && y < 0.25 && y > -0.35 && z > -0.45;
    if (earZone) return 0.85;
    // Soft hairline: the shell rises out of the scalp over a short band.
    const edge = sstep(lim - 0.06, lim + 0.06, y);
    if (edge <= 0) return 0.85; // tucked inside the head
    let s = P.s;
    if (y > 0.25) s *= lerp(1, P.top, Math.min(1, (y - 0.25) / 0.75));
    if (P.fade && y < 0.5) s = lerp(1.004, s, Math.max(0, Math.min(1, (y - lim) / 0.35)));
    if (P.bumps) s += 0.03 * Math.sin(x * 23) * Math.sin(z * 19) * Math.max(0, y);
    return lerp(0.97, s, edge);
  });
  if (P.long) {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getZ(i) < 0 && p.getY(i) < 0) p.setY(i, p.getY(i) * 1.6);
    geo.computeVertexNormals();
  }
  const sg = new SkinGeo();
  sg.mesh(geo, () => [['head', 1]], (v) => v.set(v.x + headC[0], v.y + headC[1], v.z + headC[2]));
  return sg.build();
}

function buildBeard(style, sc, headC) {
  const k = style === 'full' ? 1.05 : 1.025;
  const geo = sculptedSphere(sc, 44, 32, (x, y, z) => {
    if (z < -0.35 || y > -0.1) return 0.85;
    // Keep the lips, nose and upper cheeks clear.
    if (Math.abs(x) < 0.3 && y > -0.56 && y < -0.33 && z > 0.6) return 0.85;
    if (y > -0.3 && Math.abs(x) < 0.55) return 0.85;
    return k;
  });
  const sg = new SkinGeo();
  sg.mesh(geo, () => [['head', 1]], (v) => v.set(v.x + headC[0], v.y + headC[1], v.z + headC[2]));
  return sg.build();
}

function buildShoes(J, H, color, accent) {
  const sg = new SkinGeo();
  const base = new THREE.Color(color), acc = new THREE.Color(accent), sole = new THREE.Color('#f4f4f4');
  for (const s of ['L', 'R']) {
    const a = J[`foot_${s}`];
    const toeZ = 0.118 * H, heelZ = -0.034 * H;
    const rings = [];
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const z = lerp(heelZ, toeZ, t);
      const height = (t < 0.5 ? lerp(0.078, 0.064, t / 0.5) : lerp(0.064, 0.026, (t - 0.5) / 0.5)) * H;
      const width = (t < 0.15 ? lerp(0.021, 0.029, t / 0.15) : t < 0.7 ? lerp(0.029, 0.034, (t - 0.15) / 0.55) : lerp(0.034, 0.016, (t - 0.7) / 0.3)) * H;
      const wts = t < 0.68 ? [[`foot_${s}`, 1]] : [[`toes_${s}`, sstep(0.68, 0.8, t)], [`foot_${s}`, 1 - sstep(0.68, 0.8, t)]];
      rings.push({ c: [a[0], height / 2, a[2] + z], u: X, w: [0, 1, 0], rx: width, rz: height / 2, n: 3, wts, color: [0, 0, 0] });
    }
    const start = sg.pos.length / 3;
    sg.loft(rings, 16, { capStart: true, capEnd: true, uFlip: false });
    for (let i = start; i < sg.pos.length / 3; i++) {
      const y = sg.pos[i * 3 + 1];
      const z = sg.pos[i * 3 + 2] - a[2];
      let c = base;
      if (y < 0.013 * H) c = sole;
      else if (y < 0.019 * H) c = acc;
      else if (z < -0.02 * H && y > 0.035 * H) c = acc;
      sg.col[i * 3] = c.r; sg.col[i * 3 + 1] = c.g; sg.col[i * 3 + 2] = c.b;
    }
  }
  return sg.build();
}

let eyeTex = null;
function eyeTexture() {
  if (eyeTex) return eyeTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#ece6dc';
  x.fillRect(0, 0, 128, 64);
  // SphereGeometry: +Z (looking forward) is u = 0.25.
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 13);
  g.addColorStop(0, '#120a06'); g.addColorStop(0.35, '#2b170c'); g.addColorStop(0.75, '#4a2a16'); g.addColorStop(1, '#1c100a');
  x.fillStyle = g;
  x.beginPath(); x.arc(32, 32, 12, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#050505';
  x.beginPath(); x.arc(32, 32, 5, 0, Math.PI * 2); x.fill();
  x.fillStyle = 'rgba(255,255,255,0.85)';
  x.beginPath(); x.arc(28, 28, 2, 0, Math.PI * 2); x.fill();
  eyeTex = new THREE.CanvasTexture(c);
  eyeTex.colorSpace = THREE.SRGBColorSpace;
  return eyeTex;
}

function cachedMat(key, fn) {
  if (!matCache.has(key)) matCache.set(key, fn());
  return matCache.get(key);
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
