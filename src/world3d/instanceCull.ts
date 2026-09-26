// Culling for city-wide instanced meshes (trees, street props). The instances
// are sorted into square grid cells once; each frame the InstancedMesh draws
// only the cells that are inside the view frustum and within range, so the GPU
// never processes the tens of thousands of instances behind the camera or lost
// in the fog. The instance buffers are rewritten only when the set of drawn
// cells changes.

import { Box3, Vector3, type Frustum, type InstancedMesh } from 'three';

/** Side (m) of the culling cells. */
const CELL = 200;
/** Metres of screen-visible range per metre of model radius (about 2 px on a 900 px tall 40° view). */
const RANGE_PER_RADIUS = 650;
/** Nearest range cap (m), however small the model. */
const MIN_RANGE = 250;

interface Cell {
  box: Box3;
  start: number;
  end: number;
}

export class CulledInstances {
  readonly mesh: InstancedMesh;
  /** Farthest distance (m) this model is drawn at, from its size. */
  readonly range: number;
  private readonly cells: Cell[] = [];
  private readonly matrices: Float32Array;
  private readonly colors: Float32Array | null;
  /** Indices of the cells drawn now. */
  private drawn: number[] | null = null;

  /** Takes over a filled InstancedMesh (all `mesh.count` instances set). */
  constructor(mesh: InstancedMesh) {
    this.mesh = mesh;
    const n = mesh.count;
    const src = mesh.instanceMatrix.array as Float32Array;
    const srcColor = mesh.instanceColor ? (mesh.instanceColor.array as Float32Array) : null;
    mesh.geometry.computeBoundingSphere();
    const sphere = mesh.geometry.boundingSphere!;
    // Group instance indices by cell, and find the largest instance scale for the range.
    const byCell = new Map<number, number[]>();
    let maxScale = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 16;
      maxScale = Math.max(maxScale, Math.hypot(src[o], src[o + 1], src[o + 2]), Math.hypot(src[o + 4], src[o + 5], src[o + 6]));
      const key = Math.floor(src[o + 14] / CELL) * 65536 + Math.floor(src[o + 12] / CELL);
      let list = byCell.get(key);
      if (!list) byCell.set(key, (list = []));
      list.push(i);
    }
    const reach = (sphere.radius + sphere.center.length()) * (maxScale || 1);
    this.range = Math.max(MIN_RANGE, RANGE_PER_RADIUS * sphere.radius * (maxScale || 1));
    this.matrices = new Float32Array(n * 16);
    this.colors = srcColor ? new Float32Array(n * 3) : null;
    let k = 0;
    for (const key of [...byCell.keys()].sort((a, b) => a - b)) {
      const box = new Box3(new Vector3(Infinity, Infinity, Infinity), new Vector3(-Infinity, -Infinity, -Infinity));
      const start = k;
      for (const i of byCell.get(key)!) {
        this.matrices.set(src.subarray(i * 16, i * 16 + 16), k * 16);
        if (srcColor) this.colors!.set(srcColor.subarray(i * 3, i * 3 + 3), k * 3);
        box.expandByPoint(new Vector3(src[i * 16 + 12], src[i * 16 + 13], src[i * 16 + 14]));
        k++;
      }
      box.expandByScalar(reach);
      this.cells.push({ box, start, end: k });
    }
    mesh.frustumCulled = false;
  }

  /** Draw only the cells in view and within `far` (m) of the eye (and within this model's range). */
  update(frustum: Frustum, eye: Vector3, far: number): void {
    const range = Math.min(far, this.range);
    const r2 = range * range;
    const dst = this.mesh.instanceMatrix.array as Float32Array;
    const dstColor = this.mesh.instanceColor ? (this.mesh.instanceColor.array as Float32Array) : null;
    const visible: number[] = [];
    let n = 0;
    for (let c = 0; c < this.cells.length; c++) {
      const cell = this.cells[c];
      if (cell.box.distanceToPoint(eye) ** 2 > r2 || !frustum.intersectsBox(cell.box)) continue;
      visible.push(c);
      n += cell.end - cell.start;
    }
    const drawn = this.drawn;
    if (drawn && visible.length === drawn.length && visible.every((c, i) => c === drawn[i])) return;
    this.drawn = visible;
    let k = 0;
    for (const c of visible) {
      const cell = this.cells[c];
      dst.set(this.matrices.subarray(cell.start * 16, cell.end * 16), k * 16);
      if (dstColor && this.colors) dstColor.set(this.colors.subarray(cell.start * 3, cell.end * 3), k * 3);
      k += cell.end - cell.start;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.clearUpdateRanges();
      this.mesh.instanceColor.addUpdateRange(0, n * 3);
      this.mesh.instanceColor.needsUpdate = true;
    }
  }
}
