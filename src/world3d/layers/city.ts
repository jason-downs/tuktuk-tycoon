// The static city: generated layer meshes from the build worker, one mesh per
// tile so off-screen and fogged-out tiles are culled, plus the instanced trees
// and street props, drawn only from the grid cells in view. Buildings tiles
// far from the camera draw a coarser triangle list over the same vertices.

import { BufferAttribute, BufferGeometry, Color, Fog, Frustum, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, Quaternion, Sphere, Vector3 } from 'three';
import type { GpuMesh } from '../build/mesh';
import { LAYERS, TREE_KINDS, type LayerId, type TiledCity } from '../build/world';
import { CulledInstances } from '../instanceCull';
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

export function geometryOf(m: GpuMesh): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.position, 3));
  g.setAttribute('normal', new BufferAttribute(m.normal, 3, true));
  g.setAttribute('color', new BufferAttribute(m.color, 3, true));
  g.setIndex(new BufferAttribute(m.index, 1));
  g.computeBoundingSphere();
  return g;
}

/** Metres beyond which window and sign tiles are not drawn (a few pixels each by then). */
const DETAIL_RANGE = 1800;
/** Metres beyond which a buildings tile draws its coarse triangles (a merged cell is then two or three pixels across). */
const FAR_BUILDINGS_RANGE = 1800;

const _proj = new Matrix4();
const _sphere = new Sphere();

export class CityLayer implements WorldLayer {
  readonly id = 'city';
  readonly built: TiledCity;
  readonly materials: Partial<Record<LayerId, MeshLambertMaterial>> = {};
  private readonly ctx: ViewContext;
  private readonly meshes: Mesh[] = [];
  /** Tile meshes hidden once their bounds lie wholly beyond the fog. */
  private readonly tiles: Mesh[] = [];
  /** Window and sign tiles, which also go beyond DETAIL_RANGE. */
  private readonly detail = new Set<Mesh>();
  /** Buildings tiles, and the same tiles drawn with their coarse triangles. */
  private readonly buildings: { near: Mesh; far: Mesh }[] = [];
  private readonly instances: CulledInstances[] = [];
  private readonly frustum = new Frustum();

  constructor(ctx: ViewContext, built: TiledCity) {
    this.ctx = ctx;
    this.built = built;
    const { scene } = ctx;
    for (const id of LAYERS) {
      const pieces = built.layers[id];
      if (!pieces.length) continue;
      const mat = cityMaterial({ polygonOffset: id === 'roads' ? -2 : id === 'water' ? -1 : id === 'windows' ? -1 : 0, emissiveFromColour: id === 'glow' });
      if (id === 'backdrop') mat.fog = false;
      if (id === 'windows') mat.emissive.set('#ffd28a');
      if (id === 'glow') mat.emissive.set('#ffffff');
      // The roads layer is the ground paint: it draws in painter's order without depth
      // writes, so its overlapping flat pieces never z-fight. Sunken water draws after it
      // and shows through the ground's holes, over any paint that strays across them; its
      // steep banks take no polygon offset, which would pull their top edges up through
      // bridge decks.
      if (id === 'roads') mat.depthWrite = false;
      if (id === 'water') mat.polygonOffset = false;
      this.materials[id] = mat;
      const tile = (packed: GpuMesh): Mesh => {
        const m = new Mesh(geometryOf(packed), mat);
        m.frustumCulled = id !== 'ground';
        m.receiveShadow = id !== 'backdrop';
        m.castShadow = id === 'buildings' || id === 'structures';
        m.renderOrder = id === 'ground' ? -3 : id === 'water' ? -0.5 : id === 'roads' ? -1 : 0;
        scene.add(m);
        this.meshes.push(m);
        return m;
      };
      pieces.forEach((packed, i) => {
        const m = tile(packed);
        if (id === 'buildings') this.buildings.push({ near: m, far: this.coarse(m, built.farBuildings[i]) });
        else if (id !== 'ground' && id !== 'backdrop') this.tiles.push(m);
        if (id === 'windows' || id === 'glow') this.detail.add(m);
      });
    }
    this.addTrees(built.trees);
    this.addProps(built.props);
  }

  /** A second mesh for a tile that draws `index` over the tile's own vertex buffers. */
  private coarse(tile: Mesh, index: Uint16Array | Uint32Array): Mesh {
    const g = new BufferGeometry();
    for (const [name, attr] of Object.entries(tile.geometry.attributes)) g.setAttribute(name, attr);
    g.setIndex(new BufferAttribute(index, 1));
    g.boundingSphere = tile.geometry.boundingSphere;
    const m = new Mesh(g, tile.material);
    m.frustumCulled = tile.frustumCulled;
    m.receiveShadow = tile.receiveShadow;
    m.castShadow = tile.castShadow;
    m.renderOrder = tile.renderOrder;
    m.visible = false;
    this.ctx.scene.add(m);
    this.meshes.push(m);
    return m;
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
      im.castShadow = false;
      im.receiveShadow = true;
      this.instances.push(new CulledInstances(im));
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
    for (const im of inst.values()) this.instances.push(new CulledInstances(im));
  }

  update(_frame: FrameInfo): void {
    const { camera, scene } = this.ctx;
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(_proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const eye = camera.position;
    const far = scene.fog instanceof Fog ? scene.fog.far : Infinity;
    for (const m of this.tiles) {
      _sphere.copy(m.geometry.boundingSphere!);
      m.visible = _sphere.distanceToPoint(eye) < (this.detail.has(m) ? Math.min(far, DETAIL_RANGE) : far);
    }
    for (const b of this.buildings) {
      _sphere.copy(b.near.geometry.boundingSphere!);
      const d = _sphere.distanceToPoint(eye);
      b.near.visible = d < Math.min(far, FAR_BUILDINGS_RANGE);
      b.far.visible = d >= FAR_BUILDINGS_RANGE && d < far;
    }
    for (const c of this.instances) c.update(this.frustum, eye, far);
  }

  dispose(): void {
    for (const m of this.meshes) {
      this.ctx.scene.remove(m);
      m.geometry.dispose();
    }
    for (const mat of Object.values(this.materials)) mat?.dispose();
  }
}
