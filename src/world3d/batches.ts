// Instanced drawing for vehicles and people. Each batch is one InstancedMesh
// whose per-instance attributes are refilled every frame (begin → add… →
// flush), so a whole fleet, the ambient traffic or a crowd costs one draw call
// per model. The materials patch MeshLambertMaterial (so lights, fog and
// shadows keep working) with:
// - vehicles: livery paint per slot, spinning wheels, sprung body roll, pitch
//   and heave, and lamp glow (headlamps, brake lamps, the lit TAXI box, LEDs);
// - people: colours per slot, hidden parts collapsed, limbs posed by the rig.
// Vehicles cast shadow-map shadows. People only receive them: a figure on
// foot, and the riders of a scooter, have a soft blob on the ground for their
// shadow (docs/3d/architecture.md §8); a rider under a roof sits in its
// vehicle's shadow.

import {
  AdditiveBlending,
  BufferGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Material,
  type Scene,
} from 'three';
import { personGeometry, RIG_GLSL, type PersonLook } from './personModels';

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

/** Material for person batches. */
export function personMaterial(): MeshLambertMaterial {
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
  return material;
}

let blobGeo: BufferGeometry | null = null;

/** A unit disc on the ground, dark and opaque-ish at the centre fading to clear at the rim (vertex alpha). */
function blobGeometry(): BufferGeometry {
  if (blobGeo) return blobGeo;
  const SEGMENTS = 10;
  const pos: number[] = [0, 0, 0];
  const col: number[] = [0, 0, 0, 1];
  for (let i = 0; i < SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    pos.push(Math.cos(a), 0, -Math.sin(a));
    col.push(0, 0, 0, 0);
  }
  const idx: number[] = [];
  for (let i = 0; i < SEGMENTS; i++) idx.push(0, 1 + i, 1 + ((i + 1) % SEGMENTS));
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  blobGeo = g;
  return g;
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

/**
 * Distance from the camera (m, per unit of figure scale) beyond which a person
 * is drawn with the distant model: a standing figure is then under about 40 px
 * tall in a 1080 px view.
 */
export const PERSON_DETAIL_SIGHT = 63;

/** Person model for a figure of this scale at this distance (m) from the camera. */
export function personLod(view: number, scale: number): 0 | 1 {
  return view > PERSON_DETAIL_SIGHT * scale ? 1 : 0;
}

const PERSON_LAYOUT = { iColA: 4, iColB: 4, iPoseA: 4, iPoseB: 4, iPoseC: 4, iPoseD: 4 };

/**
 * People drawn from the shared rigged geometry, one draw per model in use: the
 * full figure near the camera, the distant one (made on first use) further
 * off. They receive shadows but cast none. The batch owns (and disposes) the
 * material it is given.
 */
export class PersonBatch {
  private readonly lods: [Batch, Batch | null];
  private readonly scene: Scene;
  private readonly material: MeshLambertMaterial;
  private readonly capacity: number;

  constructor(scene: Scene, material: MeshLambertMaterial, capacity = 64) {
    this.scene = scene;
    this.material = material;
    this.capacity = capacity;
    this.lods = [this.makeBatch(0), null];
  }

  private makeBatch(lod: 0 | 1): Batch {
    return new Batch(this.scene, personGeometry(lod), this.material, PERSON_LAYOUT, this.capacity, (m) => {
      m.castShadow = false;
      m.receiveShadow = true;
    });
  }

  /** People added this frame, both models together. */
  get count(): number {
    return this.lods[0].count + (this.lods[1]?.count ?? 0);
  }

  begin(): void {
    for (const b of this.lods) b?.begin();
  }

  /** Add a person: its transform, look, a pose of POSE_SIZE joint angles (personModels.ts), and the model to draw it with. */
  add(matrix: Matrix4, look: PersonLook, pose: ArrayLike<number>, lod: 0 | 1 = 0): void {
    const batch = lod ? (this.lods[1] ??= this.makeBatch(1)) : this.lods[0];
    const i = batch.next(matrix);
    const a = batch.attr('iColA');
    const b = batch.attr('iColB');
    for (let k = 0; k < 4; k++) {
      a[i * 4 + k] = look.colA[k];
      b[i * 4 + k] = look.colB[k];
    }
    const pa = batch.attr('iPoseA');
    const pb = batch.attr('iPoseB');
    const pc = batch.attr('iPoseC');
    const pd = batch.attr('iPoseD');
    for (let k = 0; k < 4; k++) {
      pa[i * 4 + k] = pose[k];
      pb[i * 4 + k] = pose[4 + k];
      pc[i * 4 + k] = pose[8 + k];
      pd[i * 4 + k] = pose[12 + k];
    }
  }

  flush(): void {
    for (const b of this.lods) b?.flush();
  }

  dispose(): void {
    for (const b of this.lods) b?.dispose();
    this.material.dispose();
  }
}

const _blob = new Matrix4();

/** Blob shadow radius (m) under a standing figure of scale 1. */
export const PERSON_BLOB_RADIUS = 0.36;

/** Darkness at a blob's centre: strongest in daylight, a faint contact shadow at night. */
export function blobOpacity(daylight: number): number {
  return 0.22 + 0.23 * daylight;
}

/** Soft contact shadows under figures on foot and scooter riders: one small dark disc on the ground each, in one draw. */
export class BlobShadows {
  private readonly batch: Batch;
  private readonly material: MeshBasicMaterial;

  constructor(scene: Scene, capacity = 64) {
    this.material = new MeshBasicMaterial({
      color: 0x000000,
      vertexColors: true,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.batch = new Batch(scene, blobGeometry(), this.material, {}, capacity, (m) => {
      m.renderOrder = 2;
    });
  }

  get count(): number {
    return this.batch.count;
  }

  begin(): void {
    this.batch.begin();
  }

  /** A blob of the given radius (m) on the ground at world position (x, y, z), three.js axes. */
  add(x: number, y: number, z: number, radius: number): void {
    this.batch.next(_blob.makeScale(radius, 1, radius).setPosition(x, y, z));
  }

  /** A blob placed by a matrix that takes the unit disc (radius 1, flat on y = 0) to the ground: an ellipse, turned. */
  addShaped(matrix: Matrix4): void {
    this.batch.next(matrix);
  }

  /** Upload this frame's blobs; `opacity` is the darkness at a blob's centre (weaker when the light is flat). */
  flush(opacity: number): void {
    this.material.opacity = opacity;
    this.batch.flush();
  }

  dispose(): void {
    this.batch.dispose();
    this.material.dispose();
  }
}

