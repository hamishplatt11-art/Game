// External character path: load a rigged GLB/GLTF (for example a licensed or
// self-made scan exported from Blender), map its skeleton onto this game's
// 24-bone rig and drive it from the game's animation each frame.
//
// Retargeting is done in world space so the two rigs may have different rest
// poses (our rig rests in an A/I pose with identity bone rotations; Mixamo-style
// rigs rest in a T-pose with arbitrary bone frames):
//   targetWorld = sourceWorld * align * targetRestWorld
// where `align` rotates the target bone's rest direction onto the source
// bone's rest direction. Bones are solved parent-first.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BONES } from './HumanModel.js';

/** Common bone naming schemes (Mixamo, Blender Rigify-lite, UE mannequin, generic). */
const ALIASES = {
  hips: ['hips', 'pelvis', 'hip', 'root_hips'],
  spine: ['spine', 'spine1', 'spine_01', 'spine01'],
  chest: ['spine2', 'chest', 'spine_02', 'spine_03', 'upperchest', 'spine02'],
  neck: ['neck', 'neck_01', 'neck1'],
  head: ['head'],
  clavicle_L: ['leftshoulder', 'clavicle_l', 'shoulder_l', 'l_clavicle', 'shoulder.l'],
  upperArm_L: ['leftarm', 'upperarm_l', 'l_upperarm', 'upper_arm.l', 'arm_l'],
  foreArm_L: ['leftforearm', 'lowerarm_l', 'forearm_l', 'l_forearm', 'forearm.l'],
  hand_L: ['lefthand', 'hand_l', 'l_hand', 'hand.l'],
  fingers_L: ['lefthandmiddle1', 'middle_01_l', 'lefthandindex1', 'f_middle.01.l'],
  clavicle_R: ['rightshoulder', 'clavicle_r', 'shoulder_r', 'r_clavicle', 'shoulder.r'],
  upperArm_R: ['rightarm', 'upperarm_r', 'r_upperarm', 'upper_arm.r', 'arm_r'],
  foreArm_R: ['rightforearm', 'lowerarm_r', 'forearm_r', 'r_forearm', 'forearm.r'],
  hand_R: ['righthand', 'hand_r', 'r_hand', 'hand.r'],
  fingers_R: ['righthandmiddle1', 'middle_01_r', 'righthandindex1', 'f_middle.01.r'],
  thigh_L: ['leftupleg', 'thigh_l', 'l_thigh', 'thigh.l', 'upperleg_l'],
  shin_L: ['leftleg', 'calf_l', 'shin_l', 'l_calf', 'shin.l', 'lowerleg_l'],
  foot_L: ['leftfoot', 'foot_l', 'l_foot', 'foot.l'],
  toes_L: ['lefttoebase', 'ball_l', 'toes_l', 'l_toe', 'toe.l'],
  thigh_R: ['rightupleg', 'thigh_r', 'r_thigh', 'thigh.r', 'upperleg_r'],
  shin_R: ['rightleg', 'calf_r', 'shin_r', 'r_calf', 'shin.r', 'lowerleg_r'],
  foot_R: ['rightfoot', 'foot_r', 'r_foot', 'foot.r'],
  toes_R: ['righttoebase', 'ball_r', 'toes_r', 'r_toe', 'toe.r'],
};

const norm = (n) => n.toLowerCase().replace(/^mixamorig[:_]?/, '').replace(/^(armature|rig|def)[|_:.-]?/, '').replace(/[\s]/g, '');

/** Map our bone names to bones of an external skeleton by name. */
export function mapSkeleton(bones) {
  const byName = new Map(bones.map((b) => [norm(b.name), b]));
  const map = {};
  for (const ours of BONES) {
    if (ours === 'root') continue;
    const cands = [norm(ours), ...(ALIASES[ours] || [])];
    for (const c of cands) if (byName.has(c)) { map[ours] = byName.get(c); break; }
  }
  const required = ['hips', 'spine', 'head', 'upperArm_L', 'foreArm_L', 'hand_L', 'upperArm_R', 'foreArm_R', 'hand_R', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R'];
  const missing = required.filter((b) => !map[b]);
  return { map, mapped: Object.keys(map).length, missing, ok: missing.length === 0 };
}

const CHILD = { hips: 'spine', spine: 'chest', chest: 'neck', neck: 'head', clavicle_L: 'upperArm_L', upperArm_L: 'foreArm_L', foreArm_L: 'hand_L', hand_L: 'fingers_L', clavicle_R: 'upperArm_R', upperArm_R: 'foreArm_R', foreArm_R: 'hand_R', hand_R: 'fingers_R', thigh_L: 'shin_L', shin_L: 'foot_L', foot_L: 'toes_L', thigh_R: 'shin_R', shin_R: 'foot_R', foot_R: 'toes_R' };

export class Retargeter {
  /**
   * @param {object} srcBones our rig's bones (name -> THREE.Bone), in rest pose
   * @param {THREE.Object3D} target root of the external model
   * @param {object} mapping result of mapSkeleton()
   */
  constructor(srcBones, target, mapping) {
    this.src = srcBones;
    this.target = target;
    this.map = mapping.map;
    this.order = BONES.filter((n) => this.map[n]);
    target.updateMatrixWorld(true);
    Object.values(srcBones)[0].parent?.updateMatrixWorld(true);
    // Scale external model to our character's height using hip height.
    const hs = this.src.hips.getWorldPosition(new THREE.Vector3()).y;
    const ht = this.map.hips.getWorldPosition(new THREE.Vector3()).y - new THREE.Box3().setFromObject(target).min.y;
    this.scale = ht > 1e-3 ? hs / ht : 1;
    target.scale.multiplyScalar(this.scale);
    target.updateMatrixWorld(true);
    this.rest = {};
    for (const n of this.order) {
      const tb = this.map[n];
      const tRestW = tb.getWorldQuaternion(new THREE.Quaternion());
      const sRestW = this.src[n].getWorldQuaternion(new THREE.Quaternion());
      let align = new THREE.Quaternion();
      const c = CHILD[n];
      if (c && this.map[c] && this.src[c]) {
        const sd = this.src[c].getWorldPosition(new THREE.Vector3()).sub(this.src[n].getWorldPosition(new THREE.Vector3())).normalize();
        const td = this.map[c].getWorldPosition(new THREE.Vector3()).sub(tb.getWorldPosition(new THREE.Vector3())).normalize();
        align = new THREE.Quaternion().setFromUnitVectors(td, sd);
      }
      this.rest[n] = { tRestW, sRestWInv: sRestW.clone().invert(), align, hipPos: n === 'hips' ? tb.position.clone() : null };
    }
    this.hipRestY = this.src.hips.position.y;
  }

  /** Copy the current pose of our rig onto the external skeleton. */
  apply() {
    const q = new THREE.Quaternion(), pw = new THREE.Quaternion();
    for (const n of this.order) {
      const tb = this.map[n], R = this.rest[n];
      const sW = this.src[n].getWorldQuaternion(new THREE.Quaternion());
      // Rotation of our bone relative to its rest, applied in world space.
      const delta = sW.multiply(R.sRestWInv);
      q.copy(delta).multiply(R.align).multiply(R.tRestW);
      tb.parent.getWorldQuaternion(pw).invert();
      tb.quaternion.copy(pw.multiply(q));
      tb.updateMatrixWorld(true);
      if (n === 'hips' && R.hipPos) {
        // Hip height follows ours (crouches, jumps); metres -> parent units.
        const dy = this.src.hips.position.y - this.hipRestY;
        tb.position.copy(R.hipPos);
        tb.position.y += dy / tb.parent.getWorldScale(new THREE.Vector3()).y;
      }
    }
  }
}

/** Load a GLB/GLTF from a URL or File and return { scene, skinned, bones, mapping }. */
export async function loadExternalCharacter(source) {
  const loader = new GLTFLoader();
  let gltf;
  if (source instanceof Blob) {
    const buf = await source.arrayBuffer();
    gltf = await new Promise((res, rej) => loader.parse(buf, '', res, rej));
  } else {
    gltf = await loader.loadAsync(source);
  }
  const scene = gltf.scene;
  let skinned = null;
  scene.traverse((o) => { if (o.isSkinnedMesh && !skinned) skinned = o; if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  if (!skinned) throw new Error('No skinned mesh in this file. Export the character with its armature (glTF 2.0, +Y up).');
  const bones = skinned.skeleton.bones;
  const mapping = mapSkeleton(bones);
  return { scene, skinned, bones, mapping, animations: gltf.animations };
}
