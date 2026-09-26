// Instanced drawing for vehicles and people. Each batch is one InstancedMesh
// whose per-instance attributes are refilled every frame (begin → add… →
// flush), so a whole fleet, the ambient traffic or a crowd costs one draw call
// per model. The materials patch MeshLambertMaterial (so lights, fog and
// shadows keep working) with:
// - vehicles: livery paint per slot, spinning wheels, sprung body roll, pitch
//   and heave, and lamp glow (headlamps, brake lamps, the lit TAXI box, LEDs);
// - people: colours per slot, hidden parts collapsed, limbs posed by the rig.

import {
  AdditiveBlending,
  BufferGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshLambertMaterial,
  type Material,
  type Matrix4,
  type Scene,
} from 'three';
import { RIG_GLSL, type PersonLook } from './personModels';

/** Colours travel as packed 24-bit sRGB integers in a float; this decodes one to linear RGB. */
const UNPACK_GLSL = /* glsl */ `
vec3 unpackRGB(float v) {
  float r = floor(v / 65536.0);
  float g = floor((v - r * 65536.0) / 256.0);
  float b = v - r * 65536.0 - g * 256.0;
  return pow(vec3(r, g, b) / 255.0, vec3(2.2));
}
`;

/** Material for vehicle batches (geometry from vehicleModels.ts). */
export function vehicleMaterial(opts: { transparent?: boolean } = {}): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  if (opts.transparent) {
    m.transparent = true;
    m.opacity = 0.35;
    m.depthWrite = false;
  }
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aVeh;
attribute vec3 iPaint;
attribute vec4 iMotion;
attribute vec4 iLight;
varying vec3 vEmit;
${UNPACK_GLSL}`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
	if (aVeh.x > 0.5) vColor.rgb *= aVeh.x < 1.5 ? unpackRGB(iPaint.x) : aVeh.x < 2.5 ? unpackRGB(iPaint.y) : unpackRGB(iPaint.z);
	float lampLevel = aVeh.y < 0.5 ? 0.0 : aVeh.y < 1.5 ? iLight.x : aVeh.y < 2.5 ? iLight.y : aVeh.y < 3.5 ? iLight.z : iLight.w;
	vEmit = vColor.rgb * lampLevel;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
	if (aVeh.w > 0.0) {
		vec2 d = transformed.xy - aVeh.zw;
		float s = sin(-iMotion.x);
		float c = cos(-iMotion.x);
		transformed.xy = aVeh.zw + vec2(d.x * c - d.y * s, d.x * s + d.y * c);
	} else {
		vec3 q = transformed - vec3(0.0, 0.35, 0.0);
		float cr = cos(iMotion.y);
		float sr = sin(iMotion.y);
		q = vec3(q.x, q.y * cr - q.z * sr, q.y * sr + q.z * cr);
		float cp = cos(iMotion.z);
		float sp = sin(iMotion.z);
		q = vec3(q.x * cp - q.y * sp, q.x * sp + q.y * cp, q.z);
		transformed = q + vec3(0.0, 0.35 + iMotion.w, 0.0);
	}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEmit;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vEmit;');
  };
  return m;
}

const PERSON_PARS = /* glsl */ `
attribute vec3 aRig;
attribute vec4 iColA;
attribute vec4 iColB;
attribute vec4 iPoseA;
attribute vec4 iPoseB;
attribute vec4 iPoseC;
attribute vec4 iPoseD;
${UNPACK_GLSL}
${RIG_GLSL}
bool rigHidden() {
  int part = int(aRig.y + 0.5);
  int bits = int(iColB.w + 0.5);
  return part > 0 && ((bits >> part) & 1) == 0;
}
`;

const PERSON_POSE = /* glsl */ `#include <begin_vertex>
	transformed = rigHidden() ? vec3(0.0) : rigPoint(transformed, int(aRig.x + 0.5), iPoseA, iPoseB, iPoseC, iPoseD);`;

/** Material (and matching shadow-depth material) for person batches. */
export function personMaterials(): { material: MeshLambertMaterial; depth: MeshDepthMaterial } {
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PERSON_PARS}`)
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
	{
		int slot = int(aRig.z + 0.5);
		int bits = int(iColB.w + 0.5);
		vec3 c = vec3(1.0);
		if (slot == 1) c = unpackRGB(iColA.x);
		else if (slot == 2) c = unpackRGB(iColA.y);
		else if (slot == 3) c = unpackRGB(iColA.z);
		else if (slot == 4) c = unpackRGB(iColA.w);
		else if (slot == 5) c = unpackRGB(iColB.x);
		else if (slot == 6) c = unpackRGB(iColB.y);
		else if (slot == 7) c = unpackRGB(iColB.z);
		else if (slot == 8) c = (bits & 1) == 1 ? unpackRGB(iColA.x) : unpackRGB(iColA.z);
		vColor.rgb *= c;
	}`,
      )
      .replace('#include <begin_vertex>', PERSON_POSE);
  };
  const depth = new MeshDepthMaterial();
  depth.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${PERSON_PARS}`).replace('#include <begin_vertex>', PERSON_POSE);
  };
  return { material, depth };
}

/** Additive material for headlight pools on the road (vertex colour × instance colour). */
export function lightPoolMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

function dynamicAttribute(count: number, size: number): InstancedBufferAttribute {
  const attr = new InstancedBufferAttribute(new Float32Array(count * size), size);
  attr.setUsage(DynamicDrawUsage);
  return attr;
}

/** A geometry sharing a base geometry's vertex attributes and index, ready for instanced attributes. */
function shareGeometry(base: BufferGeometry): BufferGeometry {
  const g = new BufferGeometry();
  for (const [name, attr] of Object.entries(base.attributes)) g.setAttribute(name, attr);
  g.setIndex(base.index);
  if (!base.boundingSphere) base.computeBoundingSphere();
  g.boundingSphere = base.boundingSphere;
  return g;
}

/**
 * Growable instanced batch with named per-instance float attributes. Its
 * geometry shares the base model's vertex buffers with every other batch of
 * that model, so it grows by swapping in larger instance buffers on the same
 * mesh; disposing it (which frees the shared buffers too) is for teardown only.
 */
class Batch {
  readonly mesh: InstancedMesh;
  count = 0;
  private capacity: number;
  private readonly attrs: Record<string, InstancedBufferAttribute> = {};
  private readonly scene: Scene;
  private readonly layout: Record<string, number>;

  constructor(scene: Scene, base: BufferGeometry, material: Material, layout: Record<string, number>, capacity: number, setup: (m: InstancedMesh) => void) {
    this.scene = scene;
    this.layout = layout;
    this.capacity = capacity;
    const geo = shareGeometry(base);
    for (const [name, size] of Object.entries(layout)) {
      this.attrs[name] = dynamicAttribute(capacity, size);
      geo.setAttribute(name, this.attrs[name]);
    }
    this.mesh = new InstancedMesh(geo, material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    setup(this.mesh);
    scene.add(this.mesh);
  }

  /** Start a frame: forget last frame's instances. */
  begin(): void {
    this.count = 0;
  }

  /** Reserve the next instance slot (growing the batch when full) and set its matrix. */
  next(matrix: Matrix4): number {
    if (this.count >= this.capacity) this.grow(this.capacity * 2);
    const i = this.count++;
    this.mesh.setMatrixAt(i, matrix);
    return i;
  }

  private grow(capacity: number): void {
    this.capacity = capacity;
    const matrices = dynamicAttribute(capacity, 16);
    matrices.array.set(this.mesh.instanceMatrix.array);
    this.mesh.instanceMatrix = matrices;
    for (const [name, size] of Object.entries(this.layout)) {
      const attr = dynamicAttribute(capacity, size);
      attr.array.set(this.attrs[name].array);
      this.attrs[name] = attr;
      this.mesh.geometry.setAttribute(name, attr);
    }
  }

  attr(name: string): Float32Array {
    return this.attrs[name].array as Float32Array;
  }

  /** Upload this frame's instances. */
  flush(): void {
    const n = this.count;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const [name, size] of Object.entries(this.layout)) {
      const a = this.attrs[name];
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * size);
      a.needsUpdate = true;
    }
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
  }
}

/** One vehicle model drawn for many vehicles. */
export class VehicleBatch {
  private readonly batch: Batch;

  constructor(scene: Scene, base: BufferGeometry, material: Material, shadows = true, capacity = 16) {
    this.batch = new Batch(scene, base, material, { iPaint: 3, iMotion: 4, iLight: 4 }, capacity, (m) => {
      m.castShadow = shadows;
      m.receiveShadow = true;
    });
  }

  get count(): number {
    return this.batch.count;
  }

  begin(): void {
    this.batch.begin();
  }

  /** paint: packed body, canopy, trim; motion: spin, roll, pitch, heave; light: head, tail/brake, sign, LED levels. */
  add(matrix: Matrix4, paint: ArrayLike<number>, motion: ArrayLike<number>, light: ArrayLike<number>): void {
    const i = this.batch.next(matrix);
    const p = this.batch.attr('iPaint');
    p[i * 3] = paint[0];
    p[i * 3 + 1] = paint[1];
    p[i * 3 + 2] = paint[2];
    const m = this.batch.attr('iMotion');
    const l = this.batch.attr('iLight');
    for (let k = 0; k < 4; k++) {
      m[i * 4 + k] = motion[k];
      l[i * 4 + k] = light[k];
    }
  }

  flush(): void {
    this.batch.flush();
  }

  dispose(): void {
    this.batch.dispose();
  }
}

/** People drawn from the shared rigged geometry. The batch owns (and disposes) the materials it is given. */
export class PersonBatch {
  private readonly batch: Batch;
  private readonly mats: { material: MeshLambertMaterial; depth: MeshDepthMaterial };

  constructor(scene: Scene, base: BufferGeometry, mats: { material: MeshLambertMaterial; depth: MeshDepthMaterial }, capacity = 64) {
    this.mats = mats;
    this.batch = new Batch(scene, base, mats.material, { iColA: 4, iColB: 4, iPoseA: 4, iPoseB: 4, iPoseC: 4, iPoseD: 4 }, capacity, (m) => {
      m.castShadow = true;
      m.receiveShadow = true;
      m.customDepthMaterial = mats.depth;
    });
  }

  get count(): number {
    return this.batch.count;
  }

  begin(): void {
    this.batch.begin();
  }

  /** Add a person: its transform, look and a pose of POSE_SIZE joint angles starting at pose[o] (personModels.ts). */
  add(matrix: Matrix4, look: PersonLook, pose: ArrayLike<number>, o = 0): void {
    const i = this.batch.next(matrix);
    const a = this.batch.attr('iColA');
    const b = this.batch.attr('iColB');
    for (let k = 0; k < 4; k++) {
      a[i * 4 + k] = look.colA[k];
      b[i * 4 + k] = look.colB[k];
    }
    const pa = this.batch.attr('iPoseA');
    const pb = this.batch.attr('iPoseB');
    const pc = this.batch.attr('iPoseC');
    const pd = this.batch.attr('iPoseD');
    for (let k = 0; k < 4; k++) {
      pa[i * 4 + k] = pose[o + k];
      pb[i * 4 + k] = pose[o + 4 + k];
      pc[i * 4 + k] = pose[o + 8 + k];
      pd[i * 4 + k] = pose[o + 12 + k];
    }
  }

  flush(): void {
    this.batch.flush();
  }

  dispose(): void {
    this.batch.dispose();
    this.mats.material.dispose();
    this.mats.depth.dispose();
  }
}

