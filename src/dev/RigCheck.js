// Rig validation for the procedural character (and any PlayerView): bone set
// and hierarchy, skin weights, bind-pose symmetry, and per-clip checks
// (finite rotations, feet not sinking through the floor, bone lengths kept).
import * as THREE from 'three';
import { BONES } from '../render/HumanModel.js';

const PARENT_OF = (n) => ({
  hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  clavicle_L: 'chest', upperArm_L: 'clavicle_L', foreArm_L: 'upperArm_L', hand_L: 'foreArm_L', fingers_L: 'hand_L',
  clavicle_R: 'chest', upperArm_R: 'clavicle_R', foreArm_R: 'upperArm_R', hand_R: 'foreArm_R', fingers_R: 'hand_R',
  thigh_L: 'hips', shin_L: 'thigh_L', foot_L: 'shin_L', toes_L: 'foot_L',
  thigh_R: 'hips', shin_R: 'thigh_R', foot_R: 'shin_R', toes_R: 'foot_R',
}[n]);

export function validateRig(view) {
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail });
  const B = view.bones;
  const missing = BONES.filter((n) => !B[n]);
  add('All 24 bones present', missing.length === 0, missing.join(', '));
  const badParent = BONES.filter((n) => n !== 'root' && B[n] && B[n].parent !== B[PARENT_OF(n)]);
  add('Hierarchy matches spec', badParent.length === 0, badParent.join(', '));

  // Skin weights.
  let verts = 0, badW = 0, badIdx = 0, nan = 0;
  view.root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const g = o.geometry, w = g.attributes.skinWeight, idx = g.attributes.skinIndex, pos = g.attributes.position;
    const nb = o.skeleton.bones.length;
    for (let i = 0; i < w.count; i++) {
      verts++;
      const s = w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i);
      if (Math.abs(s - 1) > 0.01) badW++;
      for (const k of [idx.getX(i), idx.getY(i), idx.getZ(i), idx.getW(i)]) if (k < 0 || k >= nb) badIdx++;
      if (!Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))) nan++;
    }
  });
  add('Skin weights sum to 1', badW === 0, `${badW}/${verts} vertices off`);
  add('Skin indices in range', badIdx === 0, `${badIdx} bad`);
  add('Vertex positions finite', nan === 0, `${nan} NaN`);

  // Bind-pose symmetry (left = +X, right = -X).
  view.mixer.stopAllAction();
  for (const n of BONES) B[n].quaternion.identity();
  view.root.updateMatrixWorld(true);
  let worstSym = 0;
  for (const n of BONES.filter((b) => b.endsWith('_L'))) {
    const a = B[n].getWorldPosition(new THREE.Vector3()), b = B[n.replace(/_L$/, '_R')].getWorldPosition(new THREE.Vector3());
    worstSym = Math.max(worstSym, Math.hypot(a.x + b.x, a.y - b.y, a.z - b.z));
  }
  add('Rest pose left/right symmetric', worstSym < 0.002, `${(worstSym * 1000).toFixed(1)} mm worst`);
  const restLen = {};
  for (const n of BONES) if (n !== 'root') restLen[n] = B[n].position.length();

  // Clips. Floor contact is measured on the skinned shoe/foot vertices. Jump,
  // dunk, layup, block and fall clips get their height from the simulation's
  // root motion, so for those only the take-off/landing frames are checked.
  const footIdx = new Set(['foot_L', 'foot_R', 'toes_L', 'toes_R'].map((n) => BONES.indexOf(n)));
  const samples = [];
  view.root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
    const ids = [];
    for (let i = 0; i < si.count; i++) if (footIdx.has(si.getX(i)) && sw.getX(i) > 0.5) ids.push(i);
    const step = Math.max(1, Math.floor(ids.length / 120));
    for (let k = 0; k < ids.length; k += step) samples.push([o, ids[k]]);
  });
  const _p = new THREE.Vector3();
  const soleMin = () => {
    let m = Infinity;
    for (const [o, i] of samples) { o.getVertexPosition(i, _p); o.localToWorld(_p); m = Math.min(m, _p.y); }
    return m;
  };
  const AIR = /jump|dunk|layup|finger|euro|hop|upAndUnder|block|contest|rebound|fall|tip|fade|hook|freeThrow|celebrate/i;
  const clipReport = [];
  const floorTol = -0.015;
  for (const [name, clip] of Object.entries(view.lib.clips)) {
    let minFoot = Infinity, rawFoot = Infinity, finite = true, lenDrift = 0;
    const act = view.mixer.clipAction(clip);
    act.reset(); act.play(); act.setEffectiveWeight(1); act.paused = true;
    const air = AIR.test(name);
    for (let i = 0; i <= 12; i++) {
      if (air && i > 1 && i < 12) continue;
      act.time = (clip.duration - 1e-3) * (i / 12);
      view.mixer.update(0);
      view.root.updateMatrixWorld(true);
      for (const n of BONES) { const q = B[n].quaternion; if (!Number.isFinite(q.x + q.y + q.z + q.w)) finite = false; }
      for (const n of BONES) if (n !== 'root' && n !== 'hips') lenDrift = Math.max(lenDrift, Math.abs(B[n].position.length() - restLen[n]));
      rawFoot = Math.min(rawFoot, soleMin());
      // As rendered in game: the runtime foot IK grounds both feet.
      if (view.groundFoot) {
        for (const sd of ['L', 'R']) view.groundFoot(sd, B[`foot_${sd}`].getWorldPosition(new THREE.Vector3()), Math.PI / 2);
        view.root.updateMatrixWorld(true);
      }
      minFoot = Math.min(minFoot, soleMin());
    }
    act.stop();
    clipReport.push({ name, air, finite, rawFootMm: Math.round(rawFoot * 1000), minFootMm: Math.round(minFoot * 1000), lenDriftMm: +(lenDrift * 1000).toFixed(2), ok: finite && minFoot > floorTol && lenDrift < 0.001 });
  }
  const badClips = clipReport.filter((c) => !c.ok);
  add(`Clips valid (${clipReport.length})`, badClips.length === 0, badClips.map((c) => `${c.name}: foot ${c.minFootMm}mm${c.finite ? '' : ' NaN'}${c.lenDriftMm >= 1 ? ` len ${c.lenDriftMm}mm` : ''}`).join('; '));
  // Restore the controller's actions.
  for (const a of Object.values(view.actions)) { a.play(); a.paused = true; a.setEffectiveWeight(a.weightNow || 0); }
  return { pass: checks.every((c) => c.ok), checks, clips: clipReport };
}
