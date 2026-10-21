// Keyframed skeletal animation clips, authored in code for the procedural
// rig (an original, hand-keyed library — not motion capture). Poses are
// Euler angles in degrees per bone. Conventions for this rig (facing +Z,
// left = +X, identity rest rotations):
//   limbs pointing down (arms, legs): X- swings forward, X+ swings back
//   spine/neck/head: X+ leans forward;  Y+ turns left
//   left limbs: Z+ abducts outward; right limbs: Z- abducts outward
//   knee bend: shin X+;  elbow bend: forearm X-;  foot X+ points the toes
// Hip height is solved from the leg angles so a planted foot stays on the
// floor; feet are kept flat unless a pose overrides them.
import * as THREE from 'three';

const DEG = Math.PI / 180;
const BONE_KEYS = {
  hips: 'hips', spine: 'spine', chest: 'chest', neck: 'neck', head: 'head',
  clavL: 'clavicle_L', clavR: 'clavicle_R', uaL: 'upperArm_L', uaR: 'upperArm_R', faL: 'foreArm_L', faR: 'foreArm_R',
  hL: 'hand_L', hR: 'hand_R', fgL: 'fingers_L', fgR: 'fingers_R',
  thL: 'thigh_L', thR: 'thigh_R', shL: 'shin_L', shR: 'shin_R', ftL: 'foot_L', ftR: 'foot_R', toeL: 'toes_L', toeR: 'toes_R',
};
const BASE = {
  hips: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
  clavL: [0, 0, 0], clavR: [0, 0, 0],
  uaL: [4, 0, 7], uaR: [4, 0, -7], faL: [-12, 0, 0], faR: [-12, 0, 0], hL: [0, 0, 0], hR: [0, 0, 0], fgL: [-15, 0, 0], fgR: [-15, 0, 0],
  thL: [0, 0, 1], thR: [0, 0, -1], shL: [3, 0, 0], shR: [3, 0, 0], ftL: [0, 0, 0], ftR: [0, 0, 0], toeL: [0, 0, 0], toeR: [0, 0, 0],
};

const P = (o) => {
  const out = {};
  for (const k in BASE) out[k] = (o[k] || BASE[k]).slice();
  out.bob = o.bob || 0;
  out.drop = o.drop ?? null; // explicit hip height override (fraction of H above floor)
  out.flat = o.flat ?? true;
  out.ftAddL = o.ftAddL || 0; out.ftAddR = o.ftAddR || 0;
  out.shift = o.shift || 0; // hip lateral shift (fraction of H)
  out.fwd = o.fwd || 0;
  return out;
};

/** Mirror a pose across the sagittal plane (swap left/right, flip Y/Z rotations). */
export function mirror(p) {
  const o = P({});
  const sw = { L: 'R', R: 'L' };
  for (const k in BASE) {
    const m = k.replace(/(L|R)$/, (c) => sw[c]);
    const src = p[m] || BASE[m];
    o[k] = [src[0], -src[1], -src[2]];
  }
  o.bob = p.bob; o.drop = p.drop; o.flat = p.flat; o.ftAddL = p.ftAddR; o.ftAddR = p.ftAddL; o.shift = -p.shift; o.fwd = p.fwd;
  return o;
}

function lerpPose(a, b, t) {
  const o = P({});
  for (const k in BASE) o[k] = [0, 1, 2].map((i) => a[k][i] + (b[k][i] - a[k][i]) * t);
  o.bob = a.bob + (b.bob - a.bob) * t;
  o.shift = a.shift + (b.shift - a.shift) * t;
  o.fwd = a.fwd + (b.fwd - a.fwd) * t;
  o.drop = a.drop !== null && b.drop !== null ? a.drop + (b.drop - a.drop) * t : (t < 0.5 ? a.drop : b.drop);
  o.flat = t < 0.5 ? a.flat : b.flat;
  o.ftAddL = a.ftAddL + (b.ftAddL - a.ftAddL) * t;
  o.ftAddR = a.ftAddR + (b.ftAddR - a.ftAddR) * t;
  return o;
}

/** Hip height from leg angles: the longer (stance) leg reaches the floor. */
function solveHips(pose, J, H) {
  const hipY = J.hips[1];
  const leg = (s) => {
    const th = J[`thigh_${s}`], sh = J[`shin_${s}`], ft = J[`foot_${s}`];
    const T = th[1] - sh[1], S = sh[1] - ft[1], A = ft[1];
    const hx = pose.hips[0] * DEG;
    const a1 = hx + pose[`th${s}`][0] * DEG;
    const a2 = a1 + pose[`sh${s}`][0] * DEG;
    const ab = pose[`th${s}`][2] * DEG;
    return (T * Math.cos(a1) + S * Math.cos(a2)) * Math.cos(ab) + A + (hipY - th[1]);
  };
  const reach = Math.max(leg('L'), leg('R'));
  return reach;
}

export class AnimationLibrary {
  constructor(J, H) {
    this.J = J;
    this.H = H;
    this.clips = {};
    this.build();
  }

  makeClip(name, dur, keys, loop = true) {
    const J = this.J, H = this.H;
    const times = keys.map((k) => k.t * dur);
    const tracks = [];
    const poses = keys.map((k) => k.p);
    // Feet flat: foot = -(hips + thigh + shin) about X (plus additive toe point).
    for (const p of poses) {
      if (p.flat) {
        p.ftL[0] = -(p.hips[0] + p.thL[0] + p.shL[0]) + p.ftAddL;
        p.ftR[0] = -(p.hips[0] + p.thR[0] + p.shR[0]) + p.ftAddR;
      }
    }
    for (const k in BASE) {
      const bone = BONE_KEYS[k];
      const vals = [];
      for (const p of poses) {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p[k][0] * DEG, p[k][1] * DEG, p[k][2] * DEG, 'XYZ'));
        vals.push(q.x, q.y, q.z, q.w);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, vals));
    }
    const hp = [];
    for (const p of poses) {
      const y = p.drop !== null ? p.drop * H : solveHips(p, J, H) + p.bob * H;
      hp.push(p.shift * H, y, p.fwd * H);
    }
    tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, hp));
    const clip = new THREE.AnimationClip(name, dur, tracks);
    clip.userData = { loop };
    this.clips[name] = clip;
    return clip;
  }

  /** Gait cycle from a contact pose and a passing pose (second half mirrored). */
  gait(name, dur, contact, passing) {
    return this.makeClip(name, dur, [
      { t: 0, p: contact }, { t: 0.25, p: passing }, { t: 0.5, p: mirror(contact) }, { t: 0.75, p: mirror(passing) }, { t: 1, p: contact },
    ]);
  }

  build() {
    // ---------------- Idles ----------------
    const idle = P({ spine: [3, 0, 0], thL: [-8, 0, 3], thR: [-6, 0, -3], shL: [12, 0, 0], shR: [10, 0, 0], uaL: [3, 0, 9], uaR: [3, 0, -9], faL: [-18, 0, 0], faR: [-18, 0, 0], head: [-2, 0, 0] });
    const idle2 = P({ ...idle, spine: [4, 2, 1], chest: [-1, 0, 0], thL: [-6, 0, 3], thR: [-9, 0, -3], shL: [9, 0, 0], shR: [14, 0, 0], shift: 0.004 });
    this.makeClip('idle', 2.4, [{ t: 0, p: idle }, { t: 0.5, p: idle2 }, { t: 1, p: idle }]);

    const triple = P({ spine: [16, 0, 0], chest: [6, 0, 0], head: [-14, 0, 0], thL: [-30, 0, 6], thR: [-22, 10, -6], shL: [44, 0, 0], shR: [36, 0, 0], uaL: [-35, 0, 12], uaR: [-35, 0, -12], faL: [-80, 0, 0], faR: [-80, 0, 0] });
    this.makeClip('triple', 1.6, [{ t: 0, p: triple }, { t: 0.5, p: P({ ...triple, bob: -0.004 }) }, { t: 1, p: triple }]);

    const dstance = P({ spine: [22, 0, 0], chest: [8, 0, 0], head: [-22, 0, 0], thL: [-42, 0, 16], thR: [-42, 0, -16], shL: [70, 0, 0], shR: [70, 0, 0], uaL: [-20, 0, 52], uaR: [-20, 0, -52], faL: [-40, 20, 0], faR: [-40, -20, 0], hL: [0, 0, -20], hR: [0, 0, 20] });
    this.makeClip('defIdle', 0.8, [{ t: 0, p: dstance }, { t: 0.5, p: P({ ...dstance, bob: -0.006, shL: [74, 0, 0], shR: [74, 0, 0] }) }, { t: 1, p: dstance }]);
    const handsUp = P({ ...dstance, uaL: [-150, 0, 20], uaR: [-150, 0, -20], faL: [-15, 0, 0], faR: [-15, 0, 0], spine: [12, 0, 0] });
    this.makeClip('handsUp', 0.8, [{ t: 0, p: handsUp }, { t: 0.5, p: P({ ...handsUp, bob: -0.005 }) }, { t: 1, p: handsUp }]);

    // ---------------- Locomotion ----------------
    this.gait('walk', 1.1,
      P({ spine: [3, -4, 0], thL: [-22, 0, 2], shL: [4, 0, 0], thR: [14, 0, -2], shR: [14, 0, 0], ftAddR: 18, uaL: [16, 0, 8], uaR: [-16, 0, -8], faL: [-12, 0, 0], faR: [-22, 0, 0], bob: -0.004 }),
      P({ spine: [3, 0, 0], thL: [-2, 0, 2], shL: [6, 0, 0], thR: [-18, 0, -2], shR: [46, 0, 0], uaL: [2, 0, 8], uaR: [2, 0, -8], faL: [-15, 0, 0], faR: [-15, 0, 0], bob: 0.004 }));
    this.gait('jog', 0.7,
      P({ spine: [8, -7, 0], chest: [2, 0, 0], thL: [-30, 0, 2], shL: [14, 0, 0], thR: [22, 0, -2], shR: [40, 0, 0], ftAddR: 25, uaL: [28, 0, 10], uaR: [-34, 0, -10], faL: [-55, 0, 0], faR: [-85, 0, 0], head: [-6, 0, 0], bob: -0.012 }),
      P({ spine: [8, 0, 0], chest: [2, 0, 0], thL: [-4, 0, 2], shL: [18, 0, 0], thR: [-38, 0, -2], shR: [92, 0, 0], uaL: [0, 0, 10], uaR: [0, 0, -10], faL: [-70, 0, 0], faR: [-70, 0, 0], head: [-6, 0, 0], bob: 0.012 }));
    this.gait('run', 0.6,
      P({ spine: [14, -9, 0], chest: [4, 0, 0], thL: [-48, 0, 2], shL: [22, 0, 0], thR: [30, 0, -2], shR: [62, 0, 0], ftAddR: 30, uaL: [42, 0, 10], uaR: [-58, 0, -10], faL: [-70, 0, 0], faR: [-100, 0, 0], head: [-10, 0, 0], bob: -0.015 }),
      P({ spine: [14, 0, 0], chest: [4, 0, 0], thL: [-6, 0, 2], shL: [28, 0, 0], thR: [-62, 0, -2], shR: [118, 0, 0], uaL: [0, 0, 10], uaR: [0, 0, -10], faL: [-85, 0, 0], faR: [-85, 0, 0], head: [-10, 0, 0], bob: 0.02 }));
    // Dribbling locomotion: lower centre, off arm guarding.
    this.gait('dribbleJog', 0.66,
      P({ spine: [16, -6, 0], chest: [4, 0, 0], thL: [-34, 0, 3], shL: [24, 0, 0], thR: [18, 0, -3], shR: [46, 0, 0], ftAddR: 22, uaL: [-30, 0, 30], faL: [-70, 0, 0], uaR: [-10, 0, -15], faR: [-50, 0, 0], head: [-12, 0, 0], bob: -0.014 }),
      P({ spine: [16, 0, 0], chest: [4, 0, 0], thL: [-8, 0, 3], shL: [26, 0, 0], thR: [-42, 0, -3], shR: [96, 0, 0], uaL: [-35, 0, 30], faL: [-70, 0, 0], uaR: [-10, 0, -15], faR: [-50, 0, 0], head: [-12, 0, 0], bob: 0.01 }));

    // Defensive slides (to the character's left = +X; right is mirrored).
    const slideA = P({ ...dstance, thL: [-40, 0, 30], thR: [-40, 0, -12], shL: [62, 0, 0], shR: [72, 0, 0], shift: 0.01 });
    const slideB = P({ ...dstance, thL: [-42, 0, 14], thR: [-42, 0, -22], shL: [70, 0, 0], shR: [66, 0, 0], shift: -0.004, bob: 0.004 });
    this.makeClip('shuffleL', 0.46, [{ t: 0, p: slideA }, { t: 0.5, p: slideB }, { t: 1, p: slideA }]);
    this.makeClip('shuffleR', 0.46, [{ t: 0, p: mirror(slideA) }, { t: 0.5, p: mirror(slideB) }, { t: 1, p: mirror(slideA) }]);
    this.gait('backpedal', 0.56,
      P({ ...dstance, thL: [-48, 0, 12], shL: [66, 0, 0], thR: [-22, 0, -12], shR: [80, 0, 0], ftAddR: 15 }),
      P({ ...dstance, thL: [-36, 0, 12], shL: [72, 0, 0], thR: [-56, 0, -12], shR: [96, 0, 0] }));

    // ---------------- Shooting ----------------
    const gather = P({ spine: [10, 0, 0], thL: [-26, 0, 4], thR: [-22, 0, -4], shL: [40, 0, 0], shR: [36, 0, 0], uaR: [-38, 0, -8], faR: [-105, 0, 0], uaL: [-34, 0, 14], faL: [-95, 0, 0], head: [-8, 0, 0] });
    const dip = P({ spine: [14, 0, 0], thL: [-50, 0, 5], thR: [-46, 0, -5], shL: [78, 0, 0], shR: [74, 0, 0], uaR: [-70, 0, -10], faR: [-120, 0, 0], uaL: [-62, 0, 16], faL: [-100, 0, 0], head: [-12, 0, 0] });
    const rise = P({ spine: [4, 0, 0], thL: [-12, 0, 3], thR: [-10, 0, -3], shL: [16, 0, 0], shR: [14, 0, 0], ftAddL: 18, ftAddR: 18, uaR: [-132, 0, -8], faR: [-96, 0, 0], hR: [38, 0, 0], uaL: [-118, 0, 22], faL: [-80, 0, 0], head: [-6, 0, 0] });
    const release = P({ spine: [0, 0, 0], thL: [-4, 0, 3], thR: [-3, 0, -3], shL: [6, 0, 0], shR: [6, 0, 0], ftAddL: 40, ftAddR: 40, uaR: [-168, 0, -5], faR: [-14, 0, 0], hR: [-10, 0, 0], uaL: [-140, 0, 26], faL: [-50, 0, 0], head: [-10, 0, 0] });
    const follow = P({ ...release, hR: [-62, 0, 0], fgR: [-35, 0, 0], uaL: [-120, 0, 34], faL: [-40, 0, 0], thL: [-16, 0, 3], thR: [-14, 0, -3], shL: [30, 0, 0], shR: [28, 0, 0], ftAddL: 45, ftAddR: 45 });
    const land = P({ spine: [10, 0, 0], thL: [-34, 0, 4], thR: [-30, 0, -4], shL: [56, 0, 0], shR: [52, 0, 0], uaR: [-110, 0, -8], faR: [-35, 0, 0], hR: [-40, 0, 0], uaL: [-50, 0, 18], faL: [-40, 0, 0] });
    const recover = P({ ...idle, thL: [-14, 0, 3], thR: [-12, 0, -3], shL: [22, 0, 0], shR: [20, 0, 0] });
    // Release key sits at the clip's "ideal" fraction; the view maps sim time piecewise onto it.
    this.makeClip('jumpShot', 1.12, [{ t: 0, p: gather }, { t: 0.22, p: dip }, { t: 0.38, p: rise }, { t: 0.536, p: release }, { t: 0.68, p: follow }, { t: 0.86, p: land }, { t: 1, p: recover }], false);
    const fadeRise = P({ ...rise, spine: [-12, 0, 0], chest: [-6, 0, 0] });
    const fadeRel = P({ ...release, spine: [-18, 0, 0], chest: [-8, 0, 0], thL: [-20, 0, 3], thR: [8, 0, -3], shR: [30, 0, 0] });
    this.makeClip('fadeaway', 1.2, [{ t: 0, p: gather }, { t: 0.2, p: dip }, { t: 0.36, p: fadeRise }, { t: 0.517, p: fadeRel }, { t: 0.66, p: P({ ...fadeRel, hR: [-60, 0, 0] }) }, { t: 0.86, p: land }, { t: 1, p: recover }], false);
    const ftSet = P({ spine: [6, 0, 0], thL: [-14, 0, 6], thR: [-14, 0, -6], shL: [24, 0, 0], shR: [24, 0, 0], uaR: [-40, 0, -8], faR: [-105, 0, 0], uaL: [-36, 0, 14], faL: [-95, 0, 0] });
    const ftDip = P({ ...ftSet, thL: [-32, 0, 6], thR: [-32, 0, -6], shL: [56, 0, 0], shR: [56, 0, 0], spine: [10, 0, 0], uaR: [-90, 0, -8], faR: [-120, 0, 0] });
    const ftRel = P({ ...release, ftAddL: 22, ftAddR: 22 });
    this.makeClip('freeThrow', 1.55, [{ t: 0, p: ftSet }, { t: 0.38, p: ftDip }, { t: 0.632, p: ftRel }, { t: 0.8, p: P({ ...ftRel, hR: [-62, 0, 0] }) }, { t: 1, p: recover }], false);
    const hookUp = P({ ...rise, uaR: [-30, 0, -150], faR: [-20, 0, 0], uaL: [-60, 0, 50], faL: [-80, 0, 0], spine: [4, 30, 8] });
    this.makeClip('hook', 1.0, [{ t: 0, p: gather }, { t: 0.25, p: dip }, { t: 0.52, p: hookUp }, { t: 0.7, p: P({ ...hookUp, hR: [-40, 0, 0] }) }, { t: 0.88, p: land }, { t: 1, p: recover }], false);

    // ---------------- Finishing ----------------
    const run1 = P({ spine: [12, 0, 0], thL: [-36, 0, 2], shL: [20, 0, 0], thR: [24, 0, -2], shR: [54, 0, 0], uaR: [-40, 0, -10], faR: [-100, 0, 0], uaL: [-36, 0, 14], faL: [-96, 0, 0] });
    const plant = P({ spine: [16, 0, 0], thL: [-30, 0, 2], shL: [38, 0, 0], thR: [-20, 0, -2], shR: [80, 0, 0], uaR: [-60, 0, -10], faR: [-110, 0, 0], uaL: [-54, 0, 14], faL: [-100, 0, 0] });
    const takeoff = P({ spine: [6, 0, 0], thL: [6, 0, 2], shL: [8, 0, 0], ftAddL: 35, thR: [-92, 0, -4], shR: [100, 0, 0], uaR: [-130, 0, -8], faR: [-60, 0, 0], uaL: [-90, 0, 20], faL: [-70, 0, 0], flat: true });
    const lay = P({ spine: [0, 0, 0], thL: [10, 0, 2], shL: [30, 0, 0], ftAddL: 35, thR: [-88, 0, -4], shR: [92, 0, 0], uaR: [-172, 0, -8], faR: [-10, 0, 0], hR: [-30, 0, 0], uaL: [-70, 0, 40], faL: [-60, 0, 0] });
    const layLand = P({ spine: [12, 0, 0], thL: [-40, 0, 4], thR: [-34, 0, -4], shL: [64, 0, 0], shR: [58, 0, 0], uaR: [-60, 0, -8], faR: [-30, 0, 0], uaL: [-30, 0, 20], faL: [-40, 0, 0] });
    this.makeClip('layup', 1.0, [{ t: 0, p: run1 }, { t: 0.22, p: plant }, { t: 0.42, p: takeoff }, { t: 0.76, p: lay }, { t: 0.9, p: layLand }, { t: 1, p: recover }], false);
    this.makeClip('layupL', 1.0, [{ t: 0, p: mirror(run1) }, { t: 0.22, p: mirror(plant) }, { t: 0.42, p: mirror(takeoff) }, { t: 0.76, p: mirror(lay) }, { t: 0.9, p: mirror(layLand) }, { t: 1, p: recover }], false);
    const scoop = P({ ...lay, uaR: [-110, 0, -10], faR: [-30, 0, 0], hR: [30, 0, 0] });
    this.makeClip('fingerRoll', 1.0, [{ t: 0, p: run1 }, { t: 0.22, p: plant }, { t: 0.42, p: takeoff }, { t: 0.72, p: scoop }, { t: 0.9, p: layLand }, { t: 1, p: recover }], false);
    const reverse = P({ ...lay, spine: [-6, 40, 0], head: [-20, 30, 0], uaR: [-150, 0, 30] });
    this.makeClip('reverseLayup', 1.0, [{ t: 0, p: run1 }, { t: 0.22, p: plant }, { t: 0.42, p: takeoff }, { t: 0.76, p: reverse }, { t: 0.9, p: layLand }, { t: 1, p: recover }], false);
    const euro1 = P({ ...plant, spine: [16, 0, -12], shift: 0.03, thL: [-20, 0, 26], shL: [50, 0, 0] });
    const euro2 = P({ ...plant, spine: [16, 0, 12], shift: -0.03, thR: [-26, 0, -28], shR: [60, 0, 0] });
    this.makeClip('eurostep', 1.0, [{ t: 0, p: run1 }, { t: 0.25, p: euro1 }, { t: 0.45, p: euro2 }, { t: 0.55, p: takeoff }, { t: 0.82, p: lay }, { t: 0.93, p: layLand }, { t: 1, p: recover }], false);
    const hop = P({ ...dip, thL: [-30, 0, 8], thR: [-30, 0, -8] });
    this.makeClip('hopstep', 1.0, [{ t: 0, p: run1 }, { t: 0.25, p: P({ ...run1, bob: 0.06 }) }, { t: 0.45, p: hop }, { t: 0.6, p: P({ ...release, ftAddL: 30, ftAddR: 30, uaR: [-160, 0, -6] }) }, { t: 0.8, p: lay }, { t: 0.92, p: layLand }, { t: 1, p: recover }], false);
    const underArm = P({ ...lay, uaR: [-150, 0, -40], spine: [6, -25, -10], uaL: [-120, 0, 30] });
    this.makeClip('upAndUnder', 1.0, [{ t: 0, p: gather }, { t: 0.2, p: P({ ...release, ftAddL: 0, ftAddR: 0, thL: [-30, 0, 4], shL: [40, 0, 0], thR: [-20, 0, -4], shR: [30, 0, 0] }) }, { t: 0.42, p: P({ ...plant, spine: [26, -20, 0] }) }, { t: 0.58, p: takeoff }, { t: 0.8, p: underArm }, { t: 0.92, p: layLand }, { t: 1, p: recover }], false);

    const dunkGather = P({ ...plant, uaR: [-80, 0, -12], faR: [-100, 0, 0], uaL: [-80, 0, 12], faL: [-100, 0, 0] });
    const dunkLoad = P({ ...dip, spine: [24, 0, 0], uaR: [10, 0, -20], faR: [-30, 0, 0], uaL: [10, 0, 20], faL: [-30, 0, 0] });
    const dunkAir = P({ spine: [-8, 0, 0], thL: [-30, 0, 6], thR: [-60, 0, -6], shL: [70, 0, 0], shR: [90, 0, 0], ftAddL: 30, ftAddR: 30, uaR: [-178, 0, -8], faR: [-60, 0, 0], uaL: [-178, 0, 8], faL: [-60, 0, 0], flat: true });
    const slam = P({ ...dunkAir, spine: [18, 0, 0], uaR: [-130, 0, -10], faR: [-10, 0, 0], hR: [-40, 0, 0], uaL: [-130, 0, 10], faL: [-10, 0, 0], hL: [-40, 0, 0] });
    const hang = P({ ...slam, spine: [6, 0, 0], thL: [-20, 0, 8], thR: [-35, 0, -8], shL: [40, 0, 0], shR: [60, 0, 0], uaR: [-170, 0, -10], faR: [-5, 0, 0], uaL: [-170, 0, 10], faL: [-5, 0, 0] });
    // Takeoff fraction 0.375, slam 0.69 (matches sim timing via piecewise mapping).
    this.makeClip('dunkTwo', 1.2, [{ t: 0, p: dunkGather }, { t: 0.25, p: dunkLoad }, { t: 0.375, p: P({ ...takeoff, uaR: [-140, 0, -10], uaL: [-140, 0, 10] }) }, { t: 0.55, p: dunkAir }, { t: 0.69, p: slam }, { t: 0.82, p: hang }, { t: 0.92, p: layLand }, { t: 1, p: recover }], false);
    const oneAir = P({ ...dunkAir, uaL: [-60, 0, 40], faL: [-60, 0, 0] });
    const oneSlam = P({ ...slam, uaL: [-50, 0, 45], faL: [-50, 0, 0], hL: [0, 0, 0] });
    this.makeClip('dunkOne', 1.2, [{ t: 0, p: dunkGather }, { t: 0.25, p: dunkLoad }, { t: 0.375, p: takeoff }, { t: 0.55, p: oneAir }, { t: 0.69, p: oneSlam }, { t: 0.82, p: P({ ...hang, uaL: [-40, 0, 40] }) }, { t: 0.92, p: layLand }, { t: 1, p: recover }], false);
    const wind1 = P({ ...oneAir, uaR: [-60, 0, -20], faR: [-5, 0, 0] });
    const wind2 = P({ ...oneAir, uaR: [30, 0, -30], faR: [-5, 0, 0] });
    const wind3 = P({ ...oneAir, uaR: [-200, 0, -15], faR: [-5, 0, 0] });
    this.makeClip('dunkWindmill', 1.3, [{ t: 0, p: dunkGather }, { t: 0.23, p: dunkLoad }, { t: 0.346, p: takeoff }, { t: 0.45, p: wind1 }, { t: 0.55, p: wind2 }, { t: 0.63, p: wind3 }, { t: 0.73, p: oneSlam }, { t: 0.84, p: hang }, { t: 0.93, p: layLand }, { t: 1, p: recover }], false);
    const tomahawk = P({ ...oneAir, uaR: [-200, 0, -5], faR: [-110, 0, 0], spine: [-15, 0, 0] });
    this.makeClip('dunkTomahawk', 1.2, [{ t: 0, p: dunkGather }, { t: 0.25, p: dunkLoad }, { t: 0.375, p: takeoff }, { t: 0.56, p: tomahawk }, { t: 0.69, p: P({ ...oneSlam, spine: [25, 0, 0] }) }, { t: 0.82, p: hang }, { t: 0.92, p: layLand }, { t: 1, p: recover }], false);
    const revAir = P({ ...dunkAir, spine: [-15, 0, 0], head: [-25, 0, 0] });
    this.makeClip('dunkReverse', 1.3, [{ t: 0, p: dunkGather }, { t: 0.23, p: dunkLoad }, { t: 0.346, p: takeoff }, { t: 0.55, p: revAir }, { t: 0.73, p: P({ ...slam, spine: [-20, 0, 0], uaR: [-200, 0, -10], uaL: [-200, 0, 10] }) }, { t: 0.84, p: hang }, { t: 0.93, p: layLand }, { t: 1, p: recover }], false);

    // ---------------- Passing / catching ----------------
    const chestBall = P({ spine: [10, 0, 0], thL: [-24, 0, 6], thR: [-14, 0, -6], shL: [36, 0, 0], shR: [26, 0, 0], uaR: [-40, 0, -12], faR: [-110, 0, 0], uaL: [-40, 0, 12], faL: [-110, 0, 0] });
    const chestPush = P({ ...chestBall, spine: [16, 0, 0], thL: [-36, 0, 6], shL: [40, 0, 0], uaR: [-82, 0, -6], faR: [-8, 0, 0], hR: [-30, 0, 0], uaL: [-82, 0, 6], faL: [-8, 0, 0], hL: [-30, 0, 0] });
    this.makeClip('passChest', 0.4, [{ t: 0, p: chestBall }, { t: 0.35, p: chestPush }, { t: 1, p: P({ ...chestPush, uaR: [-50, 0, -10], uaL: [-50, 0, 10], faR: [-30, 0, 0], faL: [-30, 0, 0] }) }], false);
    const bouncePush = P({ ...chestPush, uaR: [-48, 0, -6], uaL: [-48, 0, 6], spine: [24, 0, 0] });
    this.makeClip('passBounce', 0.45, [{ t: 0, p: chestBall }, { t: 0.4, p: bouncePush }, { t: 1, p: P({ ...bouncePush, faR: [-30, 0, 0], faL: [-30, 0, 0] }) }], false);
    const overhead = P({ ...chestBall, spine: [-6, 0, 0], uaR: [-170, 0, -10], faR: [-80, 0, 0], uaL: [-170, 0, 10], faL: [-80, 0, 0] });
    const lobPush = P({ ...overhead, spine: [8, 0, 0], uaR: [-150, 0, -8], faR: [-10, 0, 0], uaL: [-150, 0, 8], faL: [-10, 0, 0] });
    this.makeClip('passLob', 0.5, [{ t: 0, p: chestBall }, { t: 0.25, p: overhead }, { t: 0.45, p: lobPush }, { t: 1, p: P({ ...lobPush, uaR: [-110, 0, -8], uaL: [-110, 0, 8] }) }], false);
    const catchP = P({ ...chestBall, uaR: [-62, 0, -12], faR: [-50, 0, 0], uaL: [-62, 0, 12], faL: [-50, 0, 0] });
    this.makeClip('catch', 0.3, [{ t: 0, p: catchP }, { t: 1, p: chestBall }], false);

    // ---------------- Dribble moves ----------------
    const lungeL = P({ spine: [18, 12, -10], chest: [4, 0, 0], thL: [-40, 0, 28], thR: [-30, 0, -16], shL: [64, 0, 0], shR: [56, 0, 0], shift: 0.03, uaR: [-30, 0, -40], faR: [-70, 0, 0], head: [-12, 0, 0] });
    const mid = P({ ...triple, spine: [20, 0, 0] });
    this.makeClip('crossL', 0.45, [{ t: 0, p: mid }, { t: 0.5, p: lungeL }, { t: 1, p: P({ ...lungeL, thL: [-46, 0, 18], shL: [70, 0, 0] }) }], false);
    this.makeClip('crossR', 0.45, [{ t: 0, p: mid }, { t: 0.5, p: mirror(lungeL) }, { t: 1, p: mirror(P({ ...lungeL, thL: [-46, 0, 18], shL: [70, 0, 0] })) }], false);
    const hesiUp = P({ ...idle, spine: [2, 0, 0], thL: [-14, 0, 4], thR: [-10, 0, -4], shL: [24, 0, 0], shR: [18, 0, 0], head: [-4, 0, 0] });
    const burst = P({ spine: [26, 0, 0], thL: [-52, 0, 3], shL: [40, 0, 0], thR: [26, 0, -3], shR: [50, 0, 0], ftAddR: 30, uaL: [-40, 0, 30], faL: [-70, 0, 0] });
    this.makeClip('hesi', 0.55, [{ t: 0, p: mid }, { t: 0.4, p: hesiUp }, { t: 0.6, p: hesiUp }, { t: 1, p: burst }], false);
    const crouchSpin = P({ ...triple, spine: [28, 0, 0], thL: [-46, 0, 10], thR: [-30, 0, -10], shL: [70, 0, 0], shR: [50, 0, 0], uaL: [-60, 0, 50], faL: [-80, 0, 0] });
    this.makeClip('spin', 0.62, [{ t: 0, p: mid }, { t: 0.3, p: crouchSpin }, { t: 0.7, p: mirror(crouchSpin) }, { t: 1, p: burst }], false);
    const hopBack = P({ ...dip, spine: [8, 0, 0], thL: [-34, 0, 6], thR: [-30, 0, -6], shL: [60, 0, 0], shR: [56, 0, 0] });
    const stepLand = P({ ...dip, spine: [6, 0, 0] });
    this.makeClip('stepback', 0.5, [{ t: 0, p: P({ ...mid, spine: [24, 0, 0], thR: [-50, 0, -4], shR: [60, 0, 0] }) }, { t: 0.35, p: hopBack }, { t: 0.7, p: stepLand }, { t: 1, p: P({ ...triple, spine: [10, 0, 0] }) }], false);
    this.makeClip('sizeup', 0.9, [{ t: 0, p: mid }, { t: 0.25, p: P({ ...mid, thL: [-46, 0, 14], shL: [70, 0, 0], spine: [24, 8, -4] }) }, { t: 0.5, p: mid }, { t: 0.75, p: P({ ...mid, thR: [-46, 0, -14], shR: [70, 0, 0], spine: [24, -8, 4] }) }, { t: 1, p: mid }], false);
    const jab = P({ ...triple, thR: [-44, 0, -6], shR: [40, 0, 0], spine: [24, 0, 0] });
    this.makeClip('jab', 0.4, [{ t: 0, p: triple }, { t: 0.45, p: jab }, { t: 1, p: triple }], false);
    const post = P({ spine: [22, 0, 0], chest: [6, 0, 0], thL: [-40, 0, 20], thR: [-40, 0, -20], shL: [66, 0, 0], shR: [66, 0, 0], uaL: [-70, 0, 70], faL: [-90, 0, 0], head: [-10, 40, 0] });
    this.makeClip('postUp', 0.9, [{ t: 0, p: post }, { t: 0.5, p: P({ ...post, bob: -0.005, shift: 0.006 }) }, { t: 1, p: post }]);
    const pumpUp = P({ ...rise, ftAddL: 0, ftAddR: 0, thL: [-16, 0, 4], thR: [-14, 0, -4], shL: [24, 0, 0], shR: [22, 0, 0] });
    this.makeClip('pumpFake', 0.45, [{ t: 0, p: gather }, { t: 0.45, p: pumpUp }, { t: 1, p: gather }], false);

    // ---------------- Defence / reactions ----------------
    const swipe1 = P({ ...dstance, spine: [32, 10, 0], uaR: [-90, 20, -20], faR: [-10, 0, 0] });
    const swipe2 = P({ ...dstance, spine: [34, -12, 0], uaR: [-60, -30, -5], faR: [-5, 0, 0] });
    this.makeClip('steal', 0.42, [{ t: 0, p: dstance }, { t: 0.3, p: swipe1 }, { t: 0.6, p: swipe2 }, { t: 1, p: dstance }], false);
    const blockLoad = P({ ...dip, uaR: [-60, 0, -20], uaL: [-60, 0, 20], faR: [-60, 0, 0], faL: [-60, 0, 0] });
    const blockUp = P({ spine: [2, 0, 0], thL: [-10, 0, 4], thR: [-10, 0, -4], shL: [20, 0, 0], shR: [20, 0, 0], ftAddL: 35, ftAddR: 35, uaR: [-176, 0, -6], faR: [-4, 0, 0], uaL: [-176, 0, 6], faL: [-4, 0, 0], hR: [-10, 0, 0], hL: [-10, 0, 0] });
    this.makeClip('block', 0.95, [{ t: 0, p: blockLoad }, { t: 0.12, p: blockUp }, { t: 0.55, p: P({ ...blockUp, thL: [-30, 0, 4], thR: [-30, 0, -4], shL: [50, 0, 0], shR: [50, 0, 0] }) }, { t: 0.85, p: layLand }, { t: 1, p: dstance }], false);
    const contestUp = P({ ...blockUp, uaL: [-110, 0, 30], faL: [-30, 0, 0] });
    this.makeClip('contest', 0.75, [{ t: 0, p: dstance }, { t: 0.15, p: contestUp }, { t: 0.65, p: contestUp }, { t: 1, p: dstance }], false);
    this.makeClip('rebound', 0.95, [{ t: 0, p: blockLoad }, { t: 0.15, p: P({ ...blockUp, uaR: [-170, 0, -20], uaL: [-170, 0, 20], faR: [-25, 0, 0], faL: [-25, 0, 0] }) }, { t: 0.6, p: P({ ...blockUp, thL: [-40, 0, 10], thR: [-40, 0, -10], shL: [70, 0, 0], shR: [70, 0, 0], uaR: [-100, 0, -10], uaL: [-100, 0, 10] }) }, { t: 1, p: layLand }], false);
    const stagger = P({ spine: [-14, 0, 6], chest: [-6, 0, 0], thL: [-30, 0, 18], thR: [-10, 0, -8], shL: [50, 0, 0], shR: [20, 0, 0], uaL: [-30, 0, 70], uaR: [-60, 0, -50], faL: [-30, 0, 0], faR: [-40, 0, 0] });
    this.makeClip('stumble', 0.55, [{ t: 0, p: dstance }, { t: 0.35, p: stagger }, { t: 1, p: dstance }], false);
    const sitting = P({ spine: [-16, 0, 0], chest: [-6, 0, 0], thL: [-82, 0, 12], thR: [-74, 0, -12], shL: [20, 0, 0], shR: [30, 0, 0], uaL: [40, 0, 30], uaR: [40, 0, -30], faL: [-20, 0, 0], faR: [-20, 0, 0], drop: 0.13, flat: false });
    const getUp = P({ ...dip, spine: [30, 0, 0], uaL: [-20, 0, 20], uaR: [-20, 0, -20] });
    this.makeClip('fall', 1.7, [{ t: 0, p: stagger }, { t: 0.18, p: P({ ...stagger, spine: [-25, 0, 0], drop: 0.38, flat: false, thL: [-60, 0, 14], thR: [-40, 0, -10], shL: [60, 0, 0], shR: [40, 0, 0] }) }, { t: 0.3, p: sitting }, { t: 0.62, p: sitting }, { t: 0.82, p: getUp }, { t: 1, p: dstance }], false);
    this.makeClip('bump', 0.3, [{ t: 0, p: triple }, { t: 0.4, p: P({ ...triple, spine: [4, 0, 0], chest: [-4, 0, 0] }) }, { t: 1, p: triple }], false);
    const jump2 = P({ ...blockUp, uaL: [-60, 0, 30] });
    this.makeClip('tipJump', 0.9, [{ t: 0, p: dip }, { t: 0.2, p: jump2 }, { t: 0.7, p: jump2 }, { t: 1, p: layLand }], false);
    const celebrate = P({ ...idle, uaR: [-150, 0, -30], faR: [-100, 0, 0], spine: [-4, 0, 0] });
    this.makeClip('celebrate', 1.2, [{ t: 0, p: idle }, { t: 0.3, p: celebrate }, { t: 0.6, p: P({ ...celebrate, faR: [-60, 0, 0] }) }, { t: 1, p: idle }], false);
  }
}

const libCache = new Map();
export function getLibrary(J, H) {
  const key = Math.round(H * 100) + ':' + Math.round(J.dims.armLen * 100);
  if (!libCache.has(key)) libCache.set(key, new AnimationLibrary(J, H));
  return libCache.get(key);
}
