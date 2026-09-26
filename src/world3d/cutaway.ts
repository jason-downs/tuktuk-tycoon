// Drive-mode cutaway: buildings, trees and props standing between the camera
// and the player's tuk-tuk dissolve in a dithered tube along the line of
// sight, so the tuk-tuk stays in view behind tall buildings. Only what rises
// above the tuk-tuk's wheels is cut, so roads, pavements and bridge decks stay
// whole; shadows are untouched (shadow maps render with their own depth
// materials). The cut is compiled in only while it can run (USE_CUTAWAY), so
// outside Drive mode the city draws with shaders that never discard and keep
// the GPU's early depth rejection.

import { Vector3, type Camera, type Material } from 'three';
import { patchMaterial } from './materialPatch';

/** Radius (m) of the see-through tube at the tuk-tuk, per unit of vehicle scale. */
const RADIUS_PER_SCALE = 3.2;
/** Metres in front of the tuk-tuk, per unit of vehicle scale, where the cut stops. */
const MARGIN_PER_SCALE = 2.2;
/** Height (m) above the road below which nothing is cut. */
const FLOOR = 0.4;

export interface Cutaway {
  /** Target in view space (the camera sits at the origin). */
  uCutAt: { value: Vector3 };
  /** World up in view space, and the camera's world height. */
  uCutUp: { value: Vector3 };
  uCutCamY: { value: number };
  /** World height below which nothing is cut. */
  uCutFloor: { value: number };
  uCutRadius: { value: number };
  uCutMargin: { value: number };
  uCutOn: { value: number };
  /** Materials carrying the cut, and whether their shaders have it compiled in. */
  materials: Material[];
  compiled: boolean;
}

export function createCutaway(): Cutaway {
  return {
    materials: [],
    compiled: false,
    uCutAt: { value: new Vector3() },
    uCutUp: { value: new Vector3(0, 1, 0) },
    uCutCamY: { value: 0 },
    uCutFloor: { value: 0 },
    uCutRadius: { value: 0 },
    uCutMargin: { value: 0 },
    uCutOn: { value: 0 },
  };
}

const PARS = /* glsl */ `
uniform vec3 uCutAt;
uniform vec3 uCutUp;
uniform float uCutCamY;
uniform float uCutFloor;
uniform float uCutRadius;
uniform float uCutMargin;
uniform float uCutOn;
float cutDither(vec2 p) {
  const float bayer[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  ivec2 i = ivec2(mod(p, 4.0));
  return (bayer[i.x + i.y * 4] + 0.5) / 16.0;
}
`;

const CUT = /* glsl */ `
#ifdef USE_CUTAWAY
if (uCutOn > 0.5) {
  vec3 cutP = -vViewPosition;
  float cutLen = length(uCutAt);
  vec3 cutDir = uCutAt / cutLen;
  float cutAlong = dot(cutP, cutDir);
  float cutOff = length(cutP - cutDir * cutAlong);
  float cutY = uCutCamY + dot(cutP, uCutUp);
  float cut = smoothstep(uCutRadius, uCutRadius * 0.55, cutOff)
    * smoothstep(cutLen - uCutMargin, cutLen - uCutMargin - 3.0, cutAlong)
    * smoothstep(uCutFloor, uCutFloor + 0.3, cutY);
  if (cut > cutDither(gl_FragCoord.xy)) discard;
}
#endif
`;

/** Make a Lambert material honour the cutaway. */
export function applyCutaway(mat: Material, cut: Cutaway): void {
  cut.materials.push(mat);
  if (cut.compiled) setDefine(mat, true);
  const { uCutAt, uCutUp, uCutCamY, uCutFloor, uCutRadius, uCutMargin, uCutOn } = cut;
  patchMaterial(mat, 'cutaway', (shader) => {
    Object.assign(shader.uniforms, { uCutAt, uCutUp, uCutCamY, uCutFloor, uCutRadius, uCutMargin, uCutOn });
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${PARS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${CUT}`);
  });
}

function setDefine(mat: Material, on: boolean): void {
  const defines = ((mat as Material & { defines?: Record<string, string> }).defines ??= {});
  if (on) defines.USE_CUTAWAY = '';
  else delete defines.USE_CUTAWAY;
  mat.needsUpdate = true;
}

/** Compile the cut into the materials' shaders (Drive mode) or out of them; both programs stay cached. */
export function compileCutaway(cut: Cutaway, on: boolean): void {
  if (cut.compiled === on) return;
  cut.compiled = on;
  for (const mat of cut.materials) setDefine(mat, on);
}

const _v = new Vector3();

/**
 * Aim the cutaway at a world point (the tuk-tuk's roof line) for this frame's
 * camera, or switch it off with `at` null. `groundY` is the road height under
 * the tuk-tuk; `scale` its drawing scale.
 */
export function aimCutaway(cut: Cutaway, camera: Camera, at: Vector3 | null, groundY: number, scale: number): void {
  if (!at) {
    cut.uCutOn.value = 0;
    return;
  }
  camera.updateMatrixWorld();
  cut.uCutAt.value.copy(at).applyMatrix4(camera.matrixWorldInverse);
  cut.uCutUp.value.copy(_v.set(0, 1, 0)).transformDirection(camera.matrixWorldInverse);
  cut.uCutCamY.value = camera.position.y;
  cut.uCutFloor.value = groundY + FLOOR;
  cut.uCutRadius.value = RADIUS_PER_SCALE * scale;
  cut.uCutMargin.value = MARGIN_PER_SCALE * scale;
  cut.uCutOn.value = 1;
}
