// Low-poly people: one rigged geometry holding every body part, hat, hairdo
// and prop, drawn instanced. Each vertex carries aRig = (limb, part, colour
// slot); each instance carries packed colours, a bitmask of the parts it wears
// and twelve joint angles. The vertex shader (batches.ts, RIG_GLSL below)
// collapses the parts an instance does not wear and rotates the limbs, so one
// draw call animates walkers, waiting passengers and seated riders alike.
//
// A person stands about 1.65 m tall at scale 1, faces +X, left side −Z. Looks
// follow docs/3d/world.md §4.3 (the 12 archetypes plus ambient locals); skin
// tones span #8d5a3b–#f0cfb0.

import { BoxGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, type BufferGeometry } from 'three';
import type { Archetype } from '../sim/types';
import { hash01 } from './build/mesh';
import { buildTagged, deformedBox, place, type TaggedPart } from './models';

export const LIMB = {
  root: 0,
  torso: 1,
  head: 2,
  upperArmL: 3,
  forearmL: 4,
  upperArmR: 5,
  forearmR: 6,
  thighL: 7,
  shinL: 8,
  thighR: 9,
  shinR: 10,
} as const;

/** Toggled parts; each is bit `id` of the instance's part mask. Part 0 (the body) is always drawn. */
export const PART = {
  body: 0,
  hairShort: 1,
  hairBun: 2,
  hairLong: 3,
  bucketHat: 4,
  sunHat: 5,
  cap: 6,
  conicalHat: 7,
  helmet: 8,
  backpack: 9,
  bag: 10,
  parasol: 11,
  selfie: 12,
  cup: 13,
  camera: 14,
  headphones: 15,
  pole: 16,
  suitcase: 17,
  bowl: 18,
  mask: 19,
  skirt: 20,
  robe: 21,
  scarf: 22,
  apron: 23,
} as const;
export type PartName = keyof typeof PART;

/** Bit 0 of the part mask: bare shins (shorts). */
export const SHORTS = 1;

/** Colour slots: fixed vertex colour, or one of the instance's colours. Shins take skin with shorts, else bottom. */
export const CSLOT = { fixed: 0, skin: 1, top: 2, bottom: 3, hat: 4, accent: 5, hair: 6, accent2: 7, shin: 8 } as const;

/** Joint positions at scale 1 (m). Arms and legs sit at ±Z (right = +Z). */
export const JOINT = {
  hipY: 0.86,
  hipZ: 0.085,
  kneeY: 0.47,
  shoulderY: 1.38,
  shoulderZ: 0.225,
  elbowY: 1.1,
  neckY: 1.44,
  leanY: 0.9,
} as const;

/** Height of the underside of the thighs above the feet when seated: seat top − this = where the feet stand. */
export const SIT_HIP_Y = 0.79;

// Pose layout: sixteen angles (rad) per person, uploaded as four vec4s.
//   0 shoulder pitch L   1 shoulder pitch R   2 hip pitch L   3 hip pitch R      (forward +)
//   4 elbow L            5 elbow R            6 knee L        7 knee R           (flex +)
//   8 shoulder roll L    9 shoulder roll R   10 head yaw     11 torso lean      (outward +, left +, forward +)
//  12 forearm turn L    13 forearm turn R    14, 15 unused                        (towards the midline +)
export const POSE_SIZE = 16;

type V3 = [number, number, number];

function rotZ(p: V3, cx: number, cy: number, a: number): V3 {
  const x = p[0] - cx;
  const y = p[1] - cy;
  const s = Math.sin(a);
  const c = Math.cos(a);
  return [cx + x * c - y * s, cy + x * s + y * c, p[2]];
}

function rotX(p: V3, cy: number, cz: number, a: number): V3 {
  const y = p[1] - cy;
  const z = p[2] - cz;
  const s = Math.sin(a);
  const c = Math.cos(a);
  return [p[0], cy + y * c - z * s, cz + y * s + z * c];
}

function rotY(p: V3, cx: number, cz: number, a: number): V3 {
  const x = p[0] - cx;
  const z = p[2] - cz;
  const s = Math.sin(a);
  const c = Math.cos(a);
  return [cx + x * c + z * s, p[1], cz - x * s + z * c];
}

/**
 * Where a rest-pose point of a limb ends up under a pose (model space). The
 * GLSL in RIG_GLSL is the same transform; keep them in step.
 */
export function rigPoint(p: readonly number[], limb: number, pose: ArrayLike<number>, o = 0): V3 {
  const J = JOINT;
  let q: V3 = [p[0], p[1], p[2]];
  if (limb === LIMB.thighL || limb === LIMB.shinL) {
    if (limb === LIMB.shinL) q = rotZ(q, 0, J.kneeY, -pose[o + 6]);
    return rotZ(q, 0, J.hipY, pose[o + 2]);
  }
  if (limb === LIMB.thighR || limb === LIMB.shinR) {
    if (limb === LIMB.shinR) q = rotZ(q, 0, J.kneeY, -pose[o + 7]);
    return rotZ(q, 0, J.hipY, pose[o + 3]);
  }
  if (limb === LIMB.upperArmL || limb === LIMB.forearmL) {
    if (limb === LIMB.forearmL) q = rotY(rotZ(q, 0, J.elbowY, pose[o + 4]), 0, -J.shoulderZ, -pose[o + 12]);
    q = rotX(q, J.shoulderY, -J.shoulderZ, pose[o + 8]);
    q = rotZ(q, 0, J.shoulderY, pose[o]);
  } else if (limb === LIMB.upperArmR || limb === LIMB.forearmR) {
    if (limb === LIMB.forearmR) q = rotY(rotZ(q, 0, J.elbowY, pose[o + 5]), 0, J.shoulderZ, pose[o + 13]);
    q = rotX(q, J.shoulderY, J.shoulderZ, -pose[o + 9]);
    q = rotZ(q, 0, J.shoulderY, pose[o + 1]);
  } else if (limb === LIMB.head) q = rotY(q, 0, 0, pose[o + 10]);
  if (limb >= LIMB.torso) q = rotZ(q, 0, J.leanY, -pose[o + 11]);
  return q;
}

const f = (v: number) => v.toFixed(4);

/** GLSL for the rig: rigPoint(position, limb, poseA, poseB, poseC, poseD), matching rigPoint() above. */
export const RIG_GLSL = /* glsl */ `
vec3 rigRotZ(vec3 p, vec2 c, float a) {
  vec2 d = p.xy - c; float s = sin(a); float k = cos(a);
  return vec3(c.x + d.x * k - d.y * s, c.y + d.x * s + d.y * k, p.z);
}
vec3 rigRotX(vec3 p, vec2 c, float a) {
  vec2 d = p.yz - c; float s = sin(a); float k = cos(a);
  return vec3(p.x, c.x + d.x * k - d.y * s, c.y + d.x * s + d.y * k);
}
vec3 rigRotY(vec3 p, vec2 c, float a) {
  vec2 d = p.xz - c; float s = sin(a); float k = cos(a);
  return vec3(c.x + d.x * k + d.y * s, p.y, c.y - d.x * s + d.y * k);
}
vec3 rigPoint(vec3 p, int limb, vec4 A, vec4 B, vec4 C, vec4 D) {
  if (limb == 7 || limb == 8) {
    if (limb == 8) p = rigRotZ(p, vec2(0.0, ${f(JOINT.kneeY)}), -B.z);
    return rigRotZ(p, vec2(0.0, ${f(JOINT.hipY)}), A.z);
  }
  if (limb == 9 || limb == 10) {
    if (limb == 10) p = rigRotZ(p, vec2(0.0, ${f(JOINT.kneeY)}), -B.w);
    return rigRotZ(p, vec2(0.0, ${f(JOINT.hipY)}), A.w);
  }
  if (limb == 3 || limb == 4) {
    if (limb == 4) p = rigRotY(rigRotZ(p, vec2(0.0, ${f(JOINT.elbowY)}), B.x), vec2(0.0, ${f(-JOINT.shoulderZ)}), -D.x);
    p = rigRotX(p, vec2(${f(JOINT.shoulderY)}, ${f(-JOINT.shoulderZ)}), C.x);
    p = rigRotZ(p, vec2(0.0, ${f(JOINT.shoulderY)}), A.x);
  } else if (limb == 5 || limb == 6) {
    if (limb == 6) p = rigRotY(rigRotZ(p, vec2(0.0, ${f(JOINT.elbowY)}), B.y), vec2(0.0, ${f(JOINT.shoulderZ)}), D.y);
    p = rigRotX(p, vec2(${f(JOINT.shoulderY)}, ${f(JOINT.shoulderZ)}), -C.y);
    p = rigRotZ(p, vec2(0.0, ${f(JOINT.shoulderY)}), A.y);
  } else if (limb == 2) {
    p = rigRotY(p, vec2(0.0), C.z);
  }
  if (limb >= 1) p = rigRotZ(p, vec2(0.0, ${f(JOINT.leanY)}), -C.w);
  return p;
}
`;

// ------------------------------------------------------------------- poses

export const ANIM = {
  stand: 0,
  phone: 1,
  fidget: 2,
  watch: 3,
  cross: 4,
  hail: 5,
  walk: 6,
  run: 7,
  sit: 8,
  drive: 9,
  ride: 10,
  pillion: 11,
  wai: 12,
  alms: 13,
} as const;

/** What the left hand holds, which fixes that arm's pose. */
export const HOLD = { none: 0, up: 1, cup: 2, pole: 3 } as const;

/** Arm pose (shoulder pitch, elbow, roll, forearm turn) holding an alms bowl in front with both hands. */
const ALMS_ARM: [number, number, number, number] = [0.3, 1.25, 0, 0.6];

/** Arm poses (shoulder pitch, elbow, shoulder roll) for the left-hand holds. */
const HOLD_POSE: Record<number, [number, number, number]> = {
  [HOLD.up]: [0.3, 1.9, 0.05],
  [HOLD.cup]: [0.25, 1.25, 0],
  [HOLD.pole]: [0.2, 2.5, 0.25],
};

export interface PersonLook {
  /** Packed sRGB colours: skin, top, bottom, hat. */
  colA: [number, number, number, number];
  /** Packed sRGB colours: accent, hair, accent2; then the part mask. */
  colB: [number, number, number, number];
  /** Body size (children < 1). */
  scale: number;
  /** Forward lean (rad), e.g. an elder's stoop. */
  stoop: number;
  /** Walking speed (m/s). */
  speed: number;
  /** HOLD kind of the left hand. */
  hold: number;
  parts: number;
}

export function hasPart(look: PersonLook, part: PartName): boolean {
  return (look.parts & (1 << PART[part])) !== 0;
}

/**
 * Joint angles for an animation at time t (s). For walk, run and alms, phase
 * is the gait phase (rad, one stride per 2π); otherwise a per-person offset.
 */
export function posePerson(anim: number, t: number, phase: number, look: PersonLook, out: Float32Array | number[], o = 0): void {
  let shL = 0;
  let shR = 0;
  let hipL = 0;
  let hipR = 0;
  let elL = 0.12;
  let elR = 0.12;
  let knL = 0;
  let knR = 0;
  let rlL = 0.06;
  let rlR = 0.06;
  let turnL = 0;
  let turnR = 0;
  let head = 0;
  let lean = look.stoop;
  let leftBusy = false;
  let rightBusy = false;
  const idle = anim <= ANIM.hail;
  if (idle) {
    const sway = Math.sin(t * 0.9 + phase);
    hipL = 0.03 * sway;
    hipR = -0.03 * sway;
    head = 0.35 * Math.sin(t * 0.37 + phase * 1.7) + 0.15 * Math.sin(t * 1.1 + phase);
  }
  switch (anim) {
    case ANIM.phone:
      shL = 0.5;
      elL = 1.5;
      rlL = 0;
      turnL = 0.5;
      head *= 0.2;
      lean += 0.1;
      leftBusy = true;
      break;
    case ANIM.fidget: {
      const tap = Math.max(0, Math.sin(t * 9 + phase));
      knR = 0.3 * tap;
      hipR += 0.1 * tap;
      head *= 1.6;
      break;
    }
    case ANIM.watch:
      shL = 0.7;
      elL = 1.7;
      rlL = 0;
      turnL = 0.9;
      head = 0.35;
      lean += 0.12;
      leftBusy = true;
      break;
    case ANIM.cross:
      // Forearms folded across the chest, one just above the other.
      shL = shR = 0.45;
      elL = 1.6;
      elR = 1.45;
      rlL = rlR = 0;
      turnL = turnR = 1.3;
      leftBusy = rightBusy = true;
      break;
    case ANIM.hail:
      // Arm out towards the road, palm down, flapping from the elbow: the Thai beckon.
      shR = 1.35;
      rlR = 0.3;
      elR = 0.2 + 0.45 * (0.5 + 0.5 * Math.sin(t * 14 + phase));
      head = 0;
      rightBusy = true;
      break;
    case ANIM.walk:
    case ANIM.run:
    case ANIM.alms: {
      const run = anim === ANIM.run;
      const amp = run ? 0.7 : anim === ANIM.alms ? 0.28 : 0.42;
      const s = Math.sin(phase);
      const c = Math.cos(phase);
      hipL = amp * s;
      hipR = -amp * s;
      knL = (run ? 1.2 : 0.6) * Math.max(0, c);
      knR = (run ? 1.2 : 0.6) * Math.max(0, -c);
      const arm = run ? 0.6 : 0.35;
      shL = -arm * s;
      shR = arm * s;
      elL = elR = run ? 1.4 : 0.25;
      if (run) lean += 0.15;
      head = 0.15 * Math.sin(t * 0.5 + phase * 0.1);
      if (anim === ANIM.alms) {
        [shL, elL, rlL, turnL] = ALMS_ARM;
        [shR, elR, rlR, turnR] = ALMS_ARM;
        leftBusy = rightBusy = true;
      }
      break;
    }
    case ANIM.sit:
    case ANIM.drive:
    case ANIM.ride:
    case ANIM.pillion: {
      const ride = anim === ANIM.ride;
      hipL = hipR = ride ? 1.15 : anim === ANIM.pillion ? 1.3 : 1.5;
      knL = knR = ride ? 1.25 : anim === ANIM.pillion ? 1.4 : 1.5;
      shL = shR = 0.3;
      elL = elR = 0.8;
      head = 0.4 * Math.sin(t * 0.45 + phase);
      if (anim === ANIM.drive || ride) {
        shL = shR = 0.95;
        elL = elR = ride ? 0.35 : 0.45;
        rlL = rlR = 0.12;
        turnL = turnR = 0.1;
        head *= 0.4;
        if (ride) lean += 0.15;
      }
      leftBusy = rightBusy = true;
      break;
    }
    case ANIM.wai:
      // Palms together in front of the chest, elbows at the sides.
      shL = shR = 0.3;
      elL = elR = 1.9;
      rlL = rlR = 0;
      turnL = turnR = 0.9;
      lean += 0.22;
      head = 0;
      leftBusy = rightBusy = true;
      break;
  }
  const hold = HOLD_POSE[look.hold];
  if (hold && !leftBusy) [shL, elL, rlL] = hold;
  if (!rightBusy && hasPart(look, 'suitcase') && idle) {
    shR = 0.02;
    elR = 0.02;
    rlR = 0.14;
  }
  out[o] = shL;
  out[o + 1] = shR;
  out[o + 2] = hipL;
  out[o + 3] = hipR;
  out[o + 4] = elL;
  out[o + 5] = elR;
  out[o + 6] = knL;
  out[o + 7] = knR;
  out[o + 8] = rlL;
  out[o + 9] = rlR;
  out[o + 10] = head;
  out[o + 11] = lean;
  out[o + 12] = turnL;
  out[o + 13] = turnR;
  out[o + 14] = 0;
  out[o + 15] = 0;
}

// ---------------------------------------------------------------- geometry

const HAND_L: V3 = [0.01, 0.8, -JOINT.shoulderZ];

/** Pose with only the left arm set, for placing held props. */
function leftArmPose(sh: number, el: number, roll: number): number[] {
  const p = new Array(POSE_SIZE).fill(0);
  p[0] = sh;
  p[4] = el;
  p[8] = roll;
  return p;
}

let personGeo: BufferGeometry | null = null;

/** The rigged person geometry with every part (cached; ~1k triangles, a person shows 200–320). */
export function personGeometry(): BufferGeometry {
  if (personGeo) return personGeo;
  const parts: TaggedPart[] = [];
  const add = (geo: BufferGeometry, limb: number, part: number, slot: number, color = '#ffffff') =>
    parts.push({ geo, color, tags: { aRig: [limb, part, slot] } });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, limb: number, part: number, slot: number, color?: string, rx = 0, ry = 0, rz = 0) =>
    add(place(new BoxGeometry(w, h, d), x, y, z, rx, ry, rz), limb, part, slot, color);
  const J = JOINT;
  const P = PART;
  const S = CSLOT;

  // Body: hips, tapered torso, head, arms, legs, shoes.
  box(0.2, 0.14, 0.3, 0, J.hipY, 0, LIMB.root, P.body, S.bottom);
  add(deformedBox((sx, sy, sz) => [sx * (sy < 0 ? 0.1 : 0.11), sy < 0 ? 0.84 : J.neckY, sz * (sy < 0 ? 0.15 : 0.2)]), LIMB.torso, P.body, S.top);
  add(place(new IcosahedronGeometry(0.11, 0).scale(1, 1.1, 0.95), 0.005, 1.56, 0), LIMB.head, P.body, S.skin);
  for (const side of [-1, 1]) {
    const [ua, fa, th, sh] = side < 0 ? [LIMB.upperArmL, LIMB.forearmL, LIMB.thighL, LIMB.shinL] : [LIMB.upperArmR, LIMB.forearmR, LIMB.thighR, LIMB.shinR];
    box(0.09, 0.3, 0.09, 0, 1.24, side * J.shoulderZ, ua, P.body, S.top);
    box(0.08, 0.24, 0.08, 0, 0.98, side * J.shoulderZ, fa, P.body, S.skin);
    box(0.07, 0.09, 0.05, 0.005, 0.815, side * J.shoulderZ, fa, P.body, S.skin);
    box(0.13, 0.42, 0.13, 0, 0.655, side * J.hipZ, th, P.body, S.bottom);
    box(0.11, 0.4, 0.11, 0, 0.27, side * J.hipZ, sh, P.body, S.shin);
    box(0.2, 0.06, 0.1, 0.045, 0.03, side * J.hipZ, sh, P.body, S.fixed, '#2b2b2b');
  }

  // Hair and hats.
  box(0.235, 0.07, 0.225, -0.01, 1.645, 0, LIMB.head, P.hairShort, S.hair);
  box(0.06, 0.14, 0.2, -0.095, 1.57, 0, LIMB.head, P.hairShort, S.hair);
  box(0.23, 0.06, 0.22, -0.01, 1.645, 0, LIMB.head, P.hairBun, S.hair);
  add(place(new IcosahedronGeometry(0.06, 0), -0.1, 1.66, 0), LIMB.head, P.hairBun, S.hair);
  box(0.235, 0.07, 0.225, -0.01, 1.645, 0, LIMB.head, P.hairLong, S.hair);
  box(0.05, 0.3, 0.22, -0.1, 1.5, 0, LIMB.head, P.hairLong, S.hair);
  add(place(new CylinderGeometry(0.105, 0.125, 0.1, 8), 0, 1.69, 0), LIMB.head, P.bucketHat, S.hat);
  add(place(new CylinderGeometry(0.17, 0.19, 0.025, 8), 0, 1.64, 0), LIMB.head, P.bucketHat, S.hat);
  add(place(new CylinderGeometry(0.1, 0.115, 0.1, 8), 0, 1.7, 0), LIMB.head, P.sunHat, S.hat);
  add(place(new CylinderGeometry(0.24, 0.25, 0.018, 10), 0, 1.655, 0), LIMB.head, P.sunHat, S.hat);
  box(0.23, 0.07, 0.22, -0.005, 1.66, 0, LIMB.head, P.cap, S.hat);
  box(0.12, 0.015, 0.16, 0.15, 1.635, 0, LIMB.head, P.cap, S.hat);
  add(place(new ConeGeometry(0.28, 0.17, 10), 0, 1.745, 0), LIMB.head, P.conicalHat, S.hat);
  add(place(new IcosahedronGeometry(0.135, 0).scale(1.05, 0.95, 1), -0.005, 1.6, 0), LIMB.head, P.helmet, S.hat);
  box(0.03, 0.08, 0.2, 0.13, 1.58, 0, LIMB.head, P.helmet, S.fixed, '#22262e');
  box(0.05, 0.03, 0.26, -0.01, 1.69, 0, LIMB.head, P.headphones, S.fixed, '#1e1e1e');
  for (const side of [-1, 1]) box(0.07, 0.08, 0.04, 0, 1.56, side * 0.12, LIMB.head, P.headphones, S.accent2);
  box(0.05, 0.06, 0.13, 0.1, 1.52, 0, LIMB.head, P.mask, S.fixed, '#e8eef2');

  // Worn on the body.
  box(0.22, 0.62, 0.3, -0.2, 1.3, 0, LIMB.torso, P.backpack, S.accent);
  box(0.2, 0.1, 0.34, -0.2, 1.64, 0, LIMB.torso, P.backpack, S.accent2);
  box(0.07, 0.2, 0.24, 0.0, 0.9, 0.2, LIMB.root, P.bag, S.accent2);
  box(0.02, 0.62, 0.05, 0.115, 1.2, 0, LIMB.torso, P.bag, S.accent2, undefined, -0.55);
  box(0.06, 0.08, 0.12, 0.13, 1.2, 0.03, LIMB.torso, P.camera, S.fixed, '#1e1e1e');
  box(0.04, 0.05, 0.05, 0.17, 1.2, 0.03, LIMB.torso, P.camera, S.fixed, '#555555');
  box(0.23, 0.07, 0.3, 0, 1.43, 0, LIMB.torso, P.scarf, S.accent2);
  box(0.03, 0.26, 0.07, 0.115, 1.3, 0.06, LIMB.torso, P.scarf, S.accent2);
  box(0.02, 0.5, 0.26, 0.115, 1.0, 0, LIMB.torso, P.apron, S.accent2);
  add(place(new CylinderGeometry(0.17, 0.21, 0.66, 8, 1, true), 0, 0.55, 0), LIMB.root, P.skirt, S.bottom);
  add(place(new CylinderGeometry(0.213, 0.215, 0.08, 8, 1, true), 0, 0.26, 0), LIMB.root, P.skirt, S.accent2);
  add(deformedBox((sx, sy, sz) => [sx * (sy < 0 ? 0.115 : 0.125), sy < 0 ? 0.83 : 1.46, sz * (sy < 0 ? 0.165 : 0.215)]), LIMB.torso, P.robe, S.top);
  box(0.24, 0.1, 0.3, 0, 1.42, -0.14, LIMB.torso, P.robe, S.top);
  add(place(new CylinderGeometry(0.19, 0.23, 0.72, 8, 1, true), 0, 0.5, 0), LIMB.root, P.robe, S.top);

  // Carried: placed where the hand is in the pose that holds them.
  const handUp = rigPoint(HAND_L, LIMB.forearmL, leftArmPose(...HOLD_POSE[HOLD.up]));
  box(0.02, 2.05 - handUp[1] + 0.1, 0.02, handUp[0], (2.05 + handUp[1] - 0.1) / 2, handUp[2], LIMB.torso, P.parasol, S.fixed, '#5a4632');
  add(place(new ConeGeometry(0.5, 0.22, 10), handUp[0], 2.1, handUp[2]), LIMB.torso, P.parasol, S.accent);
  const dir: V3 = [Math.sin(0.35), Math.cos(0.35), 0];
  box(0.015, 0.8, 0.015, handUp[0] + dir[0] * 0.4, handUp[1] + dir[1] * 0.4, handUp[2], LIMB.torso, P.selfie, S.fixed, '#3a3a3a', 0, 0, -0.35);
  box(0.02, 0.12, 0.07, handUp[0] + dir[0] * 0.82, handUp[1] + dir[1] * 0.82, handUp[2], LIMB.torso, P.selfie, S.fixed, '#1c1c1c', 0, 0, -0.35);
  // The cup is tilted back by the hold's arm angle so it stands upright in the hand.
  const [cupSh, cupEl] = HOLD_POSE[HOLD.cup];
  const cup = new CylinderGeometry(0.035, 0.03, 0.12, 6).translate(0, 0.03, 0).rotateZ(-(cupSh + cupEl));
  add(place(cup, HAND_L[0] + 0.02, HAND_L[1], HAND_L[2]), LIMB.forearmL, P.cup, S.accent);
  const straw = new BoxGeometry(0.008, 0.06, 0.008).translate(0, 0.12, 0).rotateZ(-(cupSh + cupEl));
  add(place(straw, HAND_L[0] + 0.02, HAND_L[1], HAND_L[2]), LIMB.forearmL, P.cup, S.fixed, '#f4f4f4');
  box(1.3, 0.03, 0.03, 0.05, 1.47, -0.2, LIMB.torso, P.pole, S.fixed, '#c8a664');
  for (const end of [-1, 1]) {
    box(0.012, 0.3, 0.012, 0.05 + end * 0.58, 1.31, -0.2, LIMB.torso, P.pole, S.fixed, '#8a7a5a');
    add(place(new CylinderGeometry(0.17, 0.12, 0.2, 8), 0.05 + end * 0.58, 1.06, -0.2), LIMB.torso, P.pole, S.accent);
  }
  box(0.2, 0.46, 0.34, -0.05, 0.28, 0.38, LIMB.root, P.suitcase, S.accent2);
  box(0.02, 0.36, 0.02, -0.05, 0.69, 0.38, LIMB.root, P.suitcase, S.fixed, '#555555');
  const alms = new Array(POSE_SIZE).fill(0);
  [alms[0], alms[4], alms[8], alms[12]] = ALMS_ARM;
  [alms[1], alms[5], alms[9], alms[13]] = ALMS_ARM;
  const hl = rigPoint(HAND_L, LIMB.forearmL, alms);
  const hr = rigPoint([HAND_L[0], HAND_L[1], -HAND_L[2]], LIMB.forearmR, alms);
  add(place(new CylinderGeometry(0.13, 0.09, 0.12, 8), (hl[0] + hr[0]) / 2, (hl[1] + hr[1]) / 2 + 0.08, 0), LIMB.torso, P.bowl, S.fixed, '#1b1b1b');

  personGeo = buildTagged(parts);
  return personGeo;
}

// ------------------------------------------------------------------- looks

export type PersonType = Archetype | 'local' | 'office' | 'schoolkid' | 'jogger' | 'nun' | 'driver' | 'rider';

/** Conditions that change what people wear or carry. */
export interface LookEnv {
  /** Cool season (Nov–Jan): scarves and puffer jackets on Thai visitors. */
  cool?: boolean;
  rain?: boolean;
  /** Smoky season: face masks. */
  haze?: boolean;
  /** Dawn alms round: monks carry bowls. */
  dawn?: boolean;
}

export function packHex(hex: string): number {
  return parseInt(hex.slice(1, 7), 16);
}

const SKIN = ['#8d5a3b', '#9d6a48', '#b07a55', '#c68a62', '#d49a70', '#e0b089', '#ecc6a2', '#f0cfb0'];
const HAIR_DARK = ['#1c1814', '#1c1814', '#2a211b', '#3b2a20'];
const HAIR_ANY = ['#1c1814', '#3b2a20', '#5a3d28', '#8a6a3e', '#c9a45c', '#9a958e'];
const HAIR_GREY = ['#9a958e', '#b8b3aa', '#d8d4cc'];
const PASTEL = ['#f7c6d9', '#bfe3d0', '#d9c8f0', '#fdfdfd', '#fbe3a6', '#c9e4f6'];
const BRIGHT = ['#f4f4f4', '#2e86c1', '#c0392b', '#f1c40f', '#16a085', '#7f8c8d', '#e67e22', '#6c3483', '#2b2b2b'];
const JEANS = ['#2c3e66', '#3b4a6b', '#2b2b2b', '#4a5a78'];
const KHAKI = ['#c8b08a', '#8b7d6b', '#3b4a5a', '#e8dcc8'];
const DARK_BOTTOM = ['#2b2b2b', '#2c3e50', '#3b3b3b'];

const lookCache = new Map<string, PersonLook>();

/**
 * Clothes, hair, hat and props for a person type, chosen deterministically
 * from a seed. `share` (optional) is a seed for the top and accent colours, so
 * a party can dress alike.
 */
export function personLook(type: PersonType, seed: number, env: LookEnv = {}, share?: number): PersonLook {
  const envKey = (env.cool ? 1 : 0) | (env.rain ? 2 : 0) | (env.haze ? 4 : 0) | (env.dawn ? 8 : 0);
  const key = `${type}:${seed}:${envKey}:${share ?? ''}`;
  const hit = lookCache.get(key);
  if (hit) return hit;
  let n = 0;
  const u = () => hash01(seed, 101 + n++);
  const su = (k: number) => (share === undefined ? u() : hash01(share, 900 + k));
  const pick = <T>(list: readonly T[], r = u()) => list[Math.min(list.length - 1, Math.floor(r * list.length))];
  const skinRange = (lo: number, hi: number) => SKIN[lo + Math.floor(u() * (hi - lo + 1))];
  let parts = 0;
  const wear = (...names: PartName[]) => {
    for (const p of names) parts |= 1 << PART[p];
  };
  let skin = skinRange(1, 5);
  let top = pick(BRIGHT);
  let bottom = pick(JEANS);
  let hat = '#f4f4f4';
  let accent = '#e0892b';
  let hair = pick(HAIR_DARK);
  let accent2 = '#2b2b2b';
  let scale = 1;
  let stoop = 0;
  let speed = 1.25 + u() * 0.2;
  const female = u() < 0.5;
  const hairdo = () => wear(female ? (u() < 0.6 ? 'hairLong' : 'hairBun') : 'hairShort');

  switch (type) {
    case 'backpacker':
      skin = skinRange(3, 7);
      hair = pick(HAIR_ANY);
      top = pick(['#f4f4f4', '#2b2b2b', '#7f8c8d', '#e9d8a6', '#3d6fb6']);
      bottom = pick(['#5b3f8c', '#2e7d6b', '#c0392b', '#1f5f99', '#8e44ad']);
      accent = pick(['#e0892b', '#3f7a3a', '#2c6e9b', '#c0392b']);
      accent2 = '#6b705c';
      wear('backpack');
      hairdo();
      if (u() < 0.3) {
        wear('cap');
        hat = pick(['#2b2b2b', '#c0392b', '#e9d8a6']);
      }
      speed = 1.35;
      break;
    case 'tourist_cn':
      skin = skinRange(4, 7);
      top = pick(PASTEL, su(1));
      bottom = pick(['#f4f1ea', '#e8dcc8', '#bcc6d6', '#2b2b2b']);
      accent = pick(['#f9d3e3', '#ffe9a8', '#cde8f6', '#f4f4f4'], su(2));
      hairdo();
      if (u() < 0.5) wear('parasol');
      else {
        wear('sunHat');
        hat = pick(['#f4efe6', '#f9d3e3', '#e8dcc8']);
        if (u() < 0.4) wear('selfie');
      }
      speed = 1.1;
      break;
    case 'tourist_kr':
      skin = skinRange(5, 7);
      top = pick(['#f4efe6', '#e8dcc8', '#d8cbb3', '#fdfdfd', '#c9e4f6', '#2b2b2b'], su(1));
      bottom = pick(['#e8dcc8', '#f4efe6', '#6f7c91', '#2b2b2b']);
      hat = pick(['#e8dcc8', '#f4f4f4', '#2b2b2b', '#b9a88c']);
      accent = '#7b4a2a';
      accent2 = pick(['#2b2b2b', '#8a6a4a', '#d8cbb3']);
      hairdo();
      if (u() < 0.7) wear('bucketHat');
      if (u() < 0.8) wear('bag');
      if (u() < 0.6) wear('cup');
      break;
    case 'tourist_west':
      skin = skinRange(5, 7);
      hair = pick(HAIR_ANY);
      top = pick(['#3d6fb6', '#f4f4f4', '#c0392b', '#2e8b57', '#f28c28', '#6c5b7b', '#e9d8a6'], su(1));
      bottom = pick(KHAKI);
      hairdo();
      if (u() < 0.7) parts |= SHORTS;
      {
        const h = u();
        if (h < 0.45) {
          wear('cap');
          hat = pick(['#2b2b2b', '#3d6fb6', '#f4f4f4', '#8b7d6b']);
        } else if (h < 0.8) {
          wear('sunHat');
          hat = pick(['#e8dcc8', '#f4efe6', '#8b7d6b']);
        }
      }
      if (u() < 0.45) wear('camera');
      break;
    case 'retiree':
      skin = skinRange(5, 7);
      hair = pick(HAIR_GREY);
      top = pick(['#f4efe6', '#cfe3f0', '#f6e3c0', '#e3f0d6', '#f7d6c9']);
      bottom = pick(KHAKI);
      hat = '#e6d8b8';
      wear('sunHat', 'hairShort');
      if (u() < 0.4) parts |= SHORTS;
      stoop = 0.05;
      speed = 0.95;
      break;
    case 'nomad':
      skin = skinRange(2, 7);
      hair = pick(HAIR_ANY);
      top = pick(['#2b2b2b', '#3b4a5a', '#4a4a4a', '#f4f4f4']);
      bottom = pick(['#2b2b2b', '#3b4a5a', '#c8b08a']);
      accent = '#7b4a2a';
      accent2 = pick(['#2b2b2b', '#d8cbb3', '#556b2f']);
      hairdo();
      if (u() < 0.35) parts |= SHORTS;
      if (u() < 0.7) wear('headphones');
      wear('bag');
      if (u() < 0.55) wear('cup');
      break;
    case 'thai_tourist':
      skin = skinRange(2, 6);
      bottom = pick(JEANS);
      hairdo();
      // Families: from the third member of a party on (party seeds count up), some are children.
      if (seed % 7 >= 2 && u() < 0.5) scale = 0.72;
      if (env.cool && u() < 0.75) {
        top = pick(['#2c3e50', '#c0392b', '#f4f4f4', '#16a085', '#e67e22'], su(1));
        accent2 = pick(['#c0392b', '#f1c40f', '#8e44ad', '#2e86c1']);
        wear('scarf');
      } else top = pick(BRIGHT, su(1));
      if (u() < 0.2) {
        wear('cap');
        hat = pick(['#f4f4f4', '#2b2b2b', '#c0392b']);
      }
      if (u() < 0.25) wear('selfie');
      break;
    case 'student':
      skin = skinRange(2, 6);
      top = '#f7f7f5';
      bottom = '#1c1c1c';
      accent2 = female ? '#1c1c1c' : '#2c3e66';
      if (female) wear('skirt', u() < 0.7 ? 'hairLong' : 'hairBun');
      else wear('hairShort');
      if (u() < 0.5) wear('bag');
      if (u() < 0.3) wear('cup');
      accent = '#7b4a2a';
      break;
    case 'vendor':
      skin = skinRange(0, 4);
      top = pick(['#6c5b7b', '#2e86c1', '#c0392b', '#7f8c8d', '#f4f4f4', '#16a085']);
      bottom = pick(['#2b2b2b', '#3b3b5b', '#5b3b6b']);
      hat = '#d9b36b';
      accent = pick(['#b08850', '#8f6e3e', '#a8793f']);
      accent2 = pick(['#c0392b', '#2e86c1', '#16a085', '#f39c12']);
      wear('conicalHat');
      if (u() < 0.7) wear('apron');
      if (u() < 0.65) wear('pole');
      if (female && u() < 0.5) wear('skirt');
      speed = 1.05;
      break;
    case 'monk':
      skin = skinRange(1, 4);
      top = u() < 0.8 ? '#e8871e' : '#9c5a24';
      bottom = top;
      accent = pick(['#e8b923', '#d9a441', '#8a5a2b']);
      wear('robe');
      if (env.dawn) wear('bowl');
      else if (u() < 0.5) wear('parasol');
      speed = 0.85;
      break;
    case 'elder':
      skin = skinRange(1, 5);
      hair = pick(HAIR_GREY);
      top = pick(['#f4f4f4', '#e8dcc8', '#c9e4f6', '#8e6e53', '#6c5b7b']);
      if (female || u() < 0.3) {
        bottom = pick(['#5b3b6b', '#2e5fa8', '#8f1f24', '#1f6b4a', '#6b3a2a']);
        accent2 = pick(['#d4a017', '#2f9e5b', '#c0392b']);
        wear('skirt', 'hairBun');
      } else {
        bottom = pick(DARK_BOTTOM);
        wear('hairShort');
      }
      {
        const r = u();
        if (r < 0.3) {
          wear('parasol');
          accent = pick(['#2b2b2b', '#6c3483', '#8f1f24']);
        } else if (r < 0.7) {
          wear('cup');
          accent = '#b08850';
        }
      }
      stoop = 0.12;
      speed = 0.75;
      break;
    case 'business':
      top = u() < 0.6 ? '#f7f7f5' : pick(['#2c3e50', '#3b3b3b']);
      bottom = pick(DARK_BOTTOM);
      accent2 = pick(['#2b2b2b', '#5d6d7e', '#8e44ad', '#c0392b']);
      hair = pick(HAIR_ANY);
      wear('hairShort');
      if (u() < 0.7) wear('suitcase');
      speed = 1.35;
      break;
    case 'local':
      top = pick(BRIGHT);
      hairdo();
      if (female && u() < 0.25) wear('skirt');
      else if (u() < 0.35) parts |= SHORTS;
      if (u() < 0.2) {
        wear('cap');
        hat = pick(['#2b2b2b', '#f4f4f4', '#c0392b', '#2e86c1']);
      }
      if (u() < 0.2) {
        wear('bag');
        accent2 = '#f4f4f4';
      }
      break;
    case 'office':
      top = pick(['#f7f7f5', '#dfe9f5', '#f5e1e6', '#e8f0e0']);
      bottom = pick(DARK_BOTTOM);
      hairdo();
      if (female && u() < 0.4) wear('skirt');
      if (u() < 0.4) wear('bag');
      break;
    case 'schoolkid':
      scale = 0.72 + u() * 0.1;
      top = '#f7f7f5';
      bottom = '#1f2f5a';
      accent = pick(['#c0392b', '#2e86c1', '#f1c40f', '#16a085']);
      accent2 = '#1f2f5a';
      if (female) wear('skirt', 'hairLong');
      else {
        wear('hairShort');
        parts |= SHORTS;
      }
      if (u() < 0.6) wear('backpack');
      speed = 1.15;
      break;
    case 'jogger':
      top = pick(['#e74c3c', '#f1c40f', '#2ecc71', '#3498db', '#ff6fb5', '#f4f4f4']);
      bottom = '#1c1c1c';
      parts |= SHORTS;
      hairdo();
      if (u() < 0.5) {
        wear('cap');
        hat = pick(['#f4f4f4', '#2b2b2b', '#3498db']);
      }
      if (u() < 0.3) wear('headphones');
      speed = 2.6;
      break;
    case 'nun':
      skin = skinRange(1, 5);
      top = '#f4f4f0';
      bottom = top;
      wear('robe');
      speed = 0.85;
      break;
    case 'driver':
      skin = skinRange(0, 4);
      top = pick(['#2e86c1', '#f4f4f4', '#c0392b', '#1b1b1b', '#f1c40f', '#6d8b5e']);
      bottom = pick(DARK_BOTTOM);
      wear('hairShort');
      if (u() < 0.45) {
        wear('cap');
        hat = pick(['#1b1b1b', '#f4f4f4', '#c0392b', '#2e86c1']);
      }
      break;
    case 'rider':
      top = pick(BRIGHT);
      if (u() < 0.8) {
        wear('helmet');
        hat = pick(['#f4f4f4', '#1b1b1b', '#1b1b1b', '#ff8fb8', '#c0392b', '#2e86c1']);
      } else hairdo();
      break;
  }
  if (env.haze && u() < 0.3) wear('mask');
  const leftHandFree = !(parts & ((1 << PART.parasol) | (1 << PART.selfie) | (1 << PART.cup) | (1 << PART.pole)));
  if (env.rain && leftHandFree && type !== 'rider' && type !== 'driver' && u() < 0.6) {
    wear('parasol');
    accent = pick(['#2b2b2b', '#1f4fa8', '#c0392b', '#f1c40f', '#6c3483']);
  }
  const hold =
    parts & (1 << PART.pole)
      ? HOLD.pole
      : parts & ((1 << PART.parasol) | (1 << PART.selfie))
        ? HOLD.up
        : parts & (1 << PART.cup)
          ? HOLD.cup
          : HOLD.none;
  const look: PersonLook = {
    colA: [packHex(skin), packHex(top), packHex(bottom), packHex(hat)],
    colB: [packHex(accent), packHex(hair), packHex(accent2), parts],
    scale,
    stoop,
    speed,
    hold,
    parts,
  };
  if (lookCache.size > 6000) lookCache.clear();
  lookCache.set(key, look);
  return look;
}

const CARRIED = (1 << PART.parasol) | (1 << PART.selfie) | (1 << PART.pole) | (1 << PART.suitcase) | (1 << PART.backpack);
const seatedCache = new WeakMap<PersonLook, PersonLook>();

/** The look of a person sitting in a vehicle: bulky carried things (umbrellas, poles, luggage) are stowed. */
export function seatedLook(look: PersonLook): PersonLook {
  if (!(look.parts & CARRIED)) return look;
  let hit = seatedCache.get(look);
  if (!hit) {
    const parts = look.parts & ~CARRIED;
    hit = { ...look, parts, colB: [look.colB[0], look.colB[1], look.colB[2], parts], hold: look.hold === HOLD.cup ? HOLD.cup : HOLD.none };
    seatedCache.set(look, hit);
  }
  return hit;
}
