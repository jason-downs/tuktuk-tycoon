// The static city: generated layer meshes from the build worker, plus the
// instanced trees.

import { BufferAttribute, BufferGeometry, Color, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, Quaternion, Vector3 } from 'three';
import type { PackedMesh } from '../build/mesh';
import { LAYERS, TREE_KINDS, type BuiltCity, type LayerId } from '../build/world';
import { treeGeometry } from '../treeModels';
import { PROP_MODELS } from '../propModels';
import type { FrameInfo, ViewContext, WorldLayer } from './types';

/**
 * City vertex colours are sRGB bytes; convert to linear in the shader. With
 * `emissiveFromColour` the emissive term is tinted by the vertex colour, so
 * glowing surfaces keep their own colour.
 */
export function cityMaterial(opts: { polygonOffset?: number; emissiveFromColour?: boolean } = {}): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ vertexColors: true });
  const tint = !!opts.emissiveFromColour;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n\tvColor.rgb = pow(vColor.rgb, vec3(2.2));');
    if (tint) shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;');
  };
  // Same onBeforeCompile source for every city material: key the tinted variant separately.
  if (tint) m.customProgramCacheKey = () => 'city-emissive-colour';
  if (opts.polygonOffset) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = opts.polygonOffset;
    m.polygonOffsetUnits = opts.polygonOffset;
  }
  return m;
}

export function geometryOf(m: PackedMesh): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.position, 3));
  g.setAttribute('normal', new BufferAttribute(m.normal, 3));
  g.setAttribute('color', new BufferAttribute(m.color, 3, true));
  g.setIndex(new BufferAttribute(m.index, 1));
  g.computeBoundingSphere();
  return g;
}

export class CityLayer implements WorldLayer {
  readonly id = 'city';
  readonly built: BuiltCity;
  readonly materials: Partial<Record<LayerId, MeshLambertMaterial>> = {};
  private readonly ctx: ViewContext;
  private readonly meshes: Mesh[] = [];

  constructor(ctx: ViewContext, built: BuiltCity) {
    this.ctx = ctx;
    this.built = built;
    const { scene } = ctx;
    for (const id of LAYERS) {
      const packed = built.layers[id];
      if (!packed.index.length) continue;
      const mat = cityMaterial({ polygonOffset: id === 'roads' ? -2 : id === 'water' ? -1 : id === 'windows' ? -1 : 0, emissiveFromColour: id === 'glow' });
      if (id === 'backdrop') mat.fog = false;
      if (id === 'windows') mat.emissive.set('#ffd28a');
      if (id === 'glow') mat.emissive.set('#ffffff');
      this.materials[id] = mat;
      const m = new Mesh(geometryOf(packed), mat);
      m.frustumCulled = id !== 'ground';
      m.receiveShadow = id !== 'backdrop';
      m.castShadow = id === 'buildings' || id === 'structures';
      m.renderOrder = id === 'ground' ? -3 : id === 'water' ? -2 : id === 'roads' ? -1 : 0;
      scene.add(m);
      this.meshes.push(m);
    }
    this.addTrees(built.trees);
    this.addProps(built.props);
  }

  /** Night factor 0 (day) … 1 (night): windows light up from inside. */
  setNight(night: number): void {
    const w = this.materials.windows;
    if (w) w.emissiveIntensity = 0.05 + 0.95 * night;
    const g = this.materials.glow;
    if (g) g.emissiveIntensity = 0.35 + 0.65 * night;
  }

  private addProps(props: Record<string, Float32Array>): void {
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const pos = new Vector3();
    const scl = new Vector3();
    for (const [kind, arr] of Object.entries(props)) {
      const factory = PROP_MODELS[kind];
      if (!factory || !arr.length) continue;
      const n = arr.length / 4;
      const im = new InstancedMesh(factory(), this.ctx.modelMat, n);
      for (let i = 0; i < n; i++) {
        q.setFromAxisAngle(up, arr[i * 4 + 2]);
        pos.set(arr[i * 4], 0, -arr[i * 4 + 1]);
        scl.setScalar(arr[i * 4 + 3]);
        m.compose(pos, q, scl);
        im.setMatrixAt(i, m);
      }
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = false;
      im.receiveShadow = true;
      this.ctx.scene.add(im);
      this.meshes.push(im);
    }
  }

  private addTrees(t: Float32Array): void {
    const counts = new Map<number, number>();
    for (let i = 0; i < t.length; i += 4) counts.set(t[i + 3], (counts.get(t[i + 3]) ?? 0) + 1);
    const inst = new Map<number, InstancedMesh>();
    for (const [k, n] of counts) {
      const im = new InstancedMesh(treeGeometry(TREE_KINDS[k]), this.ctx.modelMat, n);
      im.count = 0;
      im.receiveShadow = true;
      inst.set(k, im);
      this.ctx.scene.add(im);
      this.meshes.push(im);
    }
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const pos = new Vector3();
    const scl = new Vector3();
    const tint = new Color();
    for (let i = 0; i < t.length; i += 4) {
      const im = inst.get(t[i + 3])!;
      const s = t[i + 2];
      q.setFromAxisAngle(up, (i * 2.399) % (Math.PI * 2));
      pos.set(t[i], 0, -t[i + 1]);
      scl.set(s, s * (0.9 + ((i * 7) % 5) * 0.05), s);
      m.compose(pos, q, scl);
      im.setMatrixAt(im.count, m);
      tint.setRGB(0.85 + ((i * 13) % 7) * 0.03, 0.9 + ((i * 17) % 5) * 0.03, 0.85 + ((i * 11) % 6) * 0.025);
      im.setColorAt(im.count, tint);
      im.count++;
    }
    for (const im of inst.values()) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
    }
  }

  update(_frame: FrameInfo): void {}

  dispose(): void {
    for (const m of this.meshes) {
      this.ctx.scene.remove(m);
      m.geometry.dispose();
    }
    for (const mat of Object.values(this.materials)) mat?.dispose();
  }
}
