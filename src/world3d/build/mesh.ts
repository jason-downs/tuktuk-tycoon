// Growable typed-array mesh writer for the procedural world. Pure TypeScript
// (no three.js), so it runs in the build worker and in Vitest. Input positions
// are sim metres (x east, y north) plus a height; output is three.js world
// space (X east, Y up, Z south = −y).

import earcut from 'earcut';

export type RGB = [number, number, number];

export interface PackedMesh {
  position: Float32Array;
  normal: Float32Array;
  color: Uint8Array;
  index: Uint32Array;
}

export class MeshWriter {
  private pos: Float32Array;
  private nrm: Float32Array;
  private col: Uint8Array;
  private idx: Uint32Array;
  private vCount = 0;
  private iCount = 0;

  constructor(initialVertices = 4096) {
    this.pos = new Float32Array(initialVertices * 3);
    this.nrm = new Float32Array(initialVertices * 3);
    this.col = new Uint8Array(initialVertices * 3);
    this.idx = new Uint32Array(initialVertices * 2);
  }

  get vertexCount(): number {
    return this.vCount;
  }

  get triangleCount(): number {
    return this.iCount / 3;
  }

  private growV(n: number): void {
    const need = (this.vCount + n) * 3;
    if (need <= this.pos.length) return;
    const size = Math.max(need, this.pos.length * 2);
    const p = new Float32Array(size);
    p.set(this.pos);
    this.pos = p;
    const q = new Float32Array(size);
    q.set(this.nrm);
    this.nrm = q;
    const c = new Uint8Array(size);
    c.set(this.col);
    this.col = c;
  }

  private growI(n: number): void {
    const need = this.iCount + n;
    if (need <= this.idx.length) return;
    const size = Math.max(need, this.idx.length * 2);
    const a = new Uint32Array(size);
    a.set(this.idx);
    this.idx = a;
  }

  /** Add a vertex at sim (x, y) and height h; returns its index. */
  vertex(x: number, y: number, h: number, nx: number, ny: number, nz: number, c: RGB): number {
    this.growV(1);
    const i = this.vCount++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = h;
    this.pos[i * 3 + 2] = -y;
    this.nrm[i * 3] = nx;
    this.nrm[i * 3 + 1] = ny;
    this.nrm[i * 3 + 2] = nz;
    this.col[i * 3] = c[0];
    this.col[i * 3 + 1] = c[1];
    this.col[i * 3 + 2] = c[2];
    return i;
  }

  triangle(a: number, b: number, c: number): void {
    this.growI(3);
    this.idx[this.iCount++] = a;
    this.idx[this.iCount++] = b;
    this.idx[this.iCount++] = c;
  }

  /**
   * Flat-shaded triangle from three sim-space points (x, y, h), wound
   * counter-clockwise when seen from the side the normal faces.
   */
  tri(p: [number, number, number], q: [number, number, number], r: [number, number, number], c: RGB, c2: RGB = c, c3: RGB = c): void {
    // World-space edge vectors (X = x, Y = h, Z = −y).
    const ax = q[0] - p[0];
    const ay = q[2] - p[2];
    const az = -(q[1] - p[1]);
    const bx = r[0] - p[0];
    const by = r[2] - p[2];
    const bz = -(r[1] - p[1]);
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const i = this.vertex(p[0], p[1], p[2], nx, ny, nz, c);
    const j = this.vertex(q[0], q[1], q[2], nx, ny, nz, c2);
    const k = this.vertex(r[0], r[1], r[2], nx, ny, nz, c3);
    this.triangle(i, j, k);
  }

  /** Flat quad p→q→r→s (counter-clockwise from the visible side). */
  quad(
    p: [number, number, number],
    q: [number, number, number],
    r: [number, number, number],
    s: [number, number, number],
    c: RGB,
    cTop: RGB = c,
  ): void {
    const ax = q[0] - p[0];
    const ay = q[2] - p[2];
    const az = -(q[1] - p[1]);
    const bx = s[0] - p[0];
    const by = s[2] - p[2];
    const bz = -(s[1] - p[1]);
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const i = this.vertex(p[0], p[1], p[2], nx, ny, nz, c);
    const j = this.vertex(q[0], q[1], q[2], nx, ny, nz, c);
    const k = this.vertex(r[0], r[1], r[2], nx, ny, nz, cTop);
    const l = this.vertex(s[0], s[1], s[2], nx, ny, nz, cTop);
    this.triangle(i, j, k);
    this.triangle(i, k, l);
  }

  /** Horizontal polygon (outer ring CCW in sim space) with optional holes, facing up. */
  polygon(outer: [number, number][], holes: [number, number][][] | undefined, h: number, c: RGB): void {
    const coords: number[] = [];
    const holeIdx: number[] = [];
    for (const [x, y] of outer) coords.push(x, y);
    if (holes) {
      for (const hole of holes) {
        holeIdx.push(coords.length / 2);
        for (const [x, y] of hole) coords.push(x, y);
      }
    }
    const tris = earcut(coords, holeIdx.length ? holeIdx : undefined, 2);
    if (!tris.length) return;
    const base = this.vCount;
    const n = coords.length / 2;
    this.growV(n);
    for (let i = 0; i < n; i++) this.vertex(coords[2 * i], coords[2 * i + 1], h, 0, 1, 0, c);
    this.growI(tris.length);
    // Counter-clockwise in sim space (y north) is up-facing in three's X/Z,
    // so each triangle is wound CCW by its signed area.
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i];
      const b = tris[i + 1];
      const c2 = tris[i + 2];
      const area =
        (coords[2 * b] - coords[2 * a]) * (coords[2 * c2 + 1] - coords[2 * a + 1]) -
        (coords[2 * c2] - coords[2 * a]) * (coords[2 * b + 1] - coords[2 * a + 1]);
      if (area >= 0) this.triangle(base + a, base + b, base + c2);
      else this.triangle(base + a, base + c2, base + b);
    }
  }

  /** Vertical walls along a closed CCW ring from h0 to h1, facing outwards. */
  walls(ring: [number, number][], h0: number, h1: number, c: RGB, cTop: RGB = c): void {
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % ring.length];
      this.quad([ax, ay, h0], [bx, by, h0], [bx, by, h1], [ax, ay, h1], c, cTop);
    }
  }

  /**
   * Flat ribbon along a polyline at height h, with mitred joins (bevelled
   * beyond 2.5× half-width). Returns nothing; faces up.
   */
  ribbon(pts: [number, number][], halfWidth: number, h: number, c: RGB, capExtend = 0): void {
    const n = pts.length;
    if (n < 2) return;
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = pts[i];
      let dx0 = 0;
      let dy0 = 0;
      let dx1 = 0;
      let dy1 = 0;
      if (i > 0) {
        dx0 = x - pts[i - 1][0];
        dy0 = y - pts[i - 1][1];
        const l = Math.hypot(dx0, dy0) || 1;
        dx0 /= l;
        dy0 /= l;
      }
      if (i < n - 1) {
        dx1 = pts[i + 1][0] - x;
        dy1 = pts[i + 1][1] - y;
        const l = Math.hypot(dx1, dy1) || 1;
        dx1 /= l;
        dy1 /= l;
      }
      if (i === 0) {
        dx0 = dx1;
        dy0 = dy1;
      }
      if (i === n - 1) {
        dx1 = dx0;
        dy1 = dy0;
      }
      let tx = dx0 + dx1;
      let ty = dy0 + dy1;
      const tl = Math.hypot(tx, ty);
      if (tl < 1e-6) {
        tx = dx1;
        ty = dy1;
      } else {
        tx /= tl;
        ty /= tl;
      }
      // Left normal of the tangent; miter length 1/cos(half-angle).
      const nx = -ty;
      const ny = tx;
      const cosHalf = nx * -dy1 + ny * dx1;
      const miter = Math.min(2.5, 1 / Math.max(0.2, Math.abs(cosHalf) || 1));
      let ex = 0;
      let ey = 0;
      if (i === 0 && capExtend) {
        ex = -dx1 * capExtend;
        ey = -dy1 * capExtend;
      }
      if (i === n - 1 && capExtend) {
        ex = dx0 * capExtend;
        ey = dy0 * capExtend;
      }
      left.push([x + ex + nx * halfWidth * miter, y + ey + ny * halfWidth * miter]);
      right.push([x + ex - nx * halfWidth * miter, y + ey - ny * halfWidth * miter]);
    }
    const base = this.vCount;
    this.growV(n * 2);
    for (let i = 0; i < n; i++) {
      this.vertex(left[i][0], left[i][1], h, 0, 1, 0, c);
      this.vertex(right[i][0], right[i][1], h, 0, 1, 0, c);
    }
    this.growI((n - 1) * 6);
    for (let i = 0; i < n - 1; i++) {
      const l0 = base + 2 * i;
      const r0 = l0 + 1;
      const l1 = l0 + 2;
      const r1 = l0 + 3;
      // r0 → r1 → l1 → l0 is counter-clockwise in sim space, i.e. up-facing.
      this.triangle(r0, r1, l1);
      this.triangle(r0, l1, l0);
    }
  }

  /** Flat disc (up-facing) with the given segment count. */
  disc(x: number, y: number, r: number, h: number, c: RGB, segments = 12): void {
    const base = this.vCount;
    this.vertex(x, y, h, 0, 1, 0, c);
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      this.vertex(x + Math.cos(a) * r, y + Math.sin(a) * r, h, 0, 1, 0, c);
    }
    for (let i = 0; i < segments; i++) this.triangle(base, base + 1 + i, base + 1 + ((i + 1) % segments));
  }

  pack(): PackedMesh {
    return {
      position: this.pos.slice(0, this.vCount * 3),
      normal: this.nrm.slice(0, this.vCount * 3),
      color: this.col.slice(0, this.vCount * 3),
      index: this.idx.slice(0, this.iCount),
    };
  }
}

/**
 * Split a mesh into square tiles of `size` metres on the ground (by triangle
 * centroid), so each tile can be culled on its own. Each piece keeps only the
 * vertices it uses; a vertex shared across a tile edge is copied into both.
 * Pieces come out in tile order (west to east within rows north to south).
 */
export function splitMesh(m: PackedMesh, size: number): PackedMesh[] {
  const tris = m.index.length / 3;
  if (!tris) return [];
  const p = m.position;
  const tileOf = new Int32Array(tris);
  const counts = new Map<number, number>();
  for (let t = 0; t < tris; t++) {
    const a = m.index[t * 3] * 3;
    const b = m.index[t * 3 + 1] * 3;
    const c = m.index[t * 3 + 2] * 3;
    const tx = Math.floor((p[a] + p[b] + p[c]) / 3 / size);
    const tz = Math.floor((p[a + 2] + p[b + 2] + p[c + 2]) / 3 / size);
    const key = (tz + 4096) * 8192 + (tx + 4096);
    tileOf[t] = key;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const keys = [...counts.keys()].sort((x, y) => x - y);
  const slot = new Map<number, number>(keys.map((k, i) => [k, i]));
  // Triangles grouped by tile, in their original order within each tile.
  const start = new Int32Array(keys.length + 1);
  keys.forEach((k, i) => (start[i + 1] = start[i] + counts.get(k)!));
  const fill = start.slice(0, keys.length);
  const order = new Int32Array(tris);
  for (let t = 0; t < tris; t++) order[fill[slot.get(tileOf[t])!]++] = t;

  const remap = new Int32Array(p.length / 3).fill(-1);
  const out: PackedMesh[] = [];
  for (let i = 0; i < keys.length; i++) {
    const used: number[] = [];
    const index = new Uint32Array((start[i + 1] - start[i]) * 3);
    let n = 0;
    for (let j = start[i]; j < start[i + 1]; j++) {
      const t = order[j];
      for (let k = 0; k < 3; k++) {
        const v = m.index[t * 3 + k];
        if (remap[v] < 0) {
          remap[v] = used.length;
          used.push(v);
        }
        index[n++] = remap[v];
      }
    }
    const position = new Float32Array(used.length * 3);
    const normal = new Float32Array(used.length * 3);
    const color = new Uint8Array(used.length * 3);
    used.forEach((v, j) => {
      for (let k = 0; k < 3; k++) {
        position[j * 3 + k] = p[v * 3 + k];
        normal[j * 3 + k] = m.normal[v * 3 + k];
        color[j * 3 + k] = m.color[v * 3 + k];
      }
      remap[v] = -1;
    });
    out.push({ position, normal, color, index });
  }
  return out;
}

/**
 * Split a mesh into tiles like splitMesh, but cut every triangle that crosses
 * a tile edge into the pieces on each side, so no tile reaches into another.
 * Within each tile the triangles keep the source order, which keeps a layer
 * drawn in painter's order (without depth writes) looking the same whichever
 * order the tiles draw in.
 */
export function clipMeshToTiles(m: PackedMesh, size: number): PackedMesh[] {
  interface Tile {
    pos: number[];
    nrm: number[];
    col: number[];
    idx: number[];
    remap: Map<number, number>;
  }
  const tiles = new Map<number, Tile>();
  const tileAt = (tx: number, tz: number): Tile => {
    const key = (tz + 4096) * 8192 + (tx + 4096);
    let t = tiles.get(key);
    if (!t) tiles.set(key, (t = { pos: [], nrm: [], col: [], idx: [], remap: new Map() }));
    return t;
  };
  const P = m.position;
  // A clip polygon vertex: position, normal, colour.
  type V = number[];
  const vert = (i: number): V => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2], m.normal[i * 3], m.normal[i * 3 + 1], m.normal[i * 3 + 2], m.color[i * 3], m.color[i * 3 + 1], m.color[i * 3 + 2]];
  const lerp = (a: V, b: V, t: number): V => a.map((x, k) => x + (b[k] - x) * t);
  /** Keep the part of the polygon where sign * (v[axis] - edge) >= 0. */
  const clip = (poly: V[], axis: number, edge: number, sign: number): V[] => {
    const out: V[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const da = sign * (a[axis] - edge);
      const db = sign * (b[axis] - edge);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) out.push(lerp(a, b, da / (da - db)));
    }
    return out;
  };
  for (let t = 0; t < m.index.length; t += 3) {
    const ids = [m.index[t], m.index[t + 1], m.index[t + 2]];
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const i of ids) {
      x0 = Math.min(x0, P[i * 3]);
      x1 = Math.max(x1, P[i * 3]);
      z0 = Math.min(z0, P[i * 3 + 2]);
      z1 = Math.max(z1, P[i * 3 + 2]);
    }
    const tx0 = Math.floor(x0 / size);
    const tx1 = Math.floor(x1 / size);
    const tz0 = Math.floor(z0 / size);
    const tz1 = Math.floor(z1 / size);
    if (tx0 === tx1 && tz0 === tz1) {
      const tile = tileAt(tx0, tz0);
      for (const i of ids) {
        let j = tile.remap.get(i);
        if (j === undefined) {
          j = tile.pos.length / 3;
          tile.remap.set(i, j);
          const v = vert(i);
          tile.pos.push(v[0], v[1], v[2]);
          tile.nrm.push(v[3], v[4], v[5]);
          tile.col.push(v[6], v[7], v[8]);
        }
        tile.idx.push(j);
      }
      continue;
    }
    const tri = ids.map(vert);
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        let poly = clip(tri, 0, tx * size, 1);
        poly = clip(poly, 0, (tx + 1) * size, -1);
        poly = clip(poly, 2, tz * size, 1);
        poly = clip(poly, 2, (tz + 1) * size, -1);
        if (poly.length < 3) continue;
        // Drop slivers with no area (a triangle that only touches this tile's edge).
        let area = 0;
        for (let i = 1; i + 1 < poly.length; i++) {
          const [ax, , az] = poly[0];
          area += (poly[i][0] - ax) * (poly[i + 1][2] - az) - (poly[i + 1][0] - ax) * (poly[i][2] - az);
        }
        if (Math.abs(area) < 1e-6) continue;
        const tile = tileAt(tx, tz);
        const base = tile.pos.length / 3;
        for (const v of poly) {
          tile.pos.push(v[0], v[1], v[2]);
          const len = Math.hypot(v[3], v[4], v[5]) || 1;
          tile.nrm.push(v[3] / len, v[4] / len, v[5] / len);
          tile.col.push(Math.round(v[6]), Math.round(v[7]), Math.round(v[8]));
        }
        for (let i = 1; i + 1 < poly.length; i++) tile.idx.push(base, base + i, base + i + 1);
      }
    }
  }
  return [...tiles.keys()]
    .sort((a, b) => a - b)
    .map((k) => {
      const t = tiles.get(k)!;
      return { position: new Float32Array(t.pos), normal: new Float32Array(t.nrm), color: new Uint8Array(t.col), index: new Uint32Array(t.idx) };
    });
}

/**
 * A coarser triangle list over a mesh's own vertices, for viewing it from
 * afar. Vertices are grouped by `cell`-metre cube and by facing (normals
 * rounded to steps of 0.5 per axis); each group is stood in for by its member
 * nearest the group's mean. Triangles that collapse, or turn to face away from
 * their normals, are dropped, so parts smaller than a cell disappear. Faces
 * facing different ways never share a stand-in, so flat shading holds, and
 * the result indexes the mesh's existing vertex buffers.
 */
export function simplifyIndex(m: PackedMesh, cell: number): Uint32Array {
  const P = m.position;
  const N = m.normal;
  const n = P.length / 3;
  const groupOf = new Int32Array(n);
  const ids = new Map<number, number>();
  const sums: number[] = [];
  for (let i = 0; i < n; i++) {
    const ix = Math.floor(P[i * 3] / cell) + 8192;
    const iy = Math.floor(P[i * 3 + 1] / cell) + 256;
    const iz = Math.floor(P[i * 3 + 2] / cell) + 8192;
    const facing = (Math.round(N[i * 3] * 2) + 2) * 25 + (Math.round(N[i * 3 + 1] * 2) + 2) * 5 + (Math.round(N[i * 3 + 2] * 2) + 2);
    const key = ((ix * 16384 + iz) * 512 + iy) * 128 + facing;
    let id = ids.get(key);
    if (id === undefined) {
      id = sums.length / 4;
      ids.set(key, id);
      sums.push(0, 0, 0, 0);
    }
    groupOf[i] = id;
    sums[id * 4] += P[i * 3];
    sums[id * 4 + 1] += P[i * 3 + 1];
    sums[id * 4 + 2] += P[i * 3 + 2];
    sums[id * 4 + 3]++;
  }
  // Each group's stand-in: the member nearest the mean.
  const groups = sums.length / 4;
  const rep = new Int32Array(groups).fill(-1);
  const best = new Float64Array(groups).fill(Infinity);
  for (let i = 0; i < n; i++) {
    const g = groupOf[i];
    const c = sums[g * 4 + 3];
    const d = (P[i * 3] - sums[g * 4] / c) ** 2 + (P[i * 3 + 1] - sums[g * 4 + 1] / c) ** 2 + (P[i * 3 + 2] - sums[g * 4 + 2] / c) ** 2;
    if (d < best[g]) {
      best[g] = d;
      rep[g] = i;
    }
  }
  const out: number[] = [];
  for (let t = 0; t < m.index.length; t += 3) {
    const i0 = m.index[t];
    const i1 = m.index[t + 1];
    const i2 = m.index[t + 2];
    const a = rep[groupOf[i0]];
    const b = rep[groupOf[i1]];
    const c = rep[groupOf[i2]];
    if (a === b || b === c || a === c) continue;
    const ux = P[b * 3] - P[a * 3];
    const uy = P[b * 3 + 1] - P[a * 3 + 1];
    const uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3];
    const vy = P[c * 3 + 1] - P[a * 3 + 1];
    const vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = N[i0 * 3] + N[i1 * 3] + N[i2 * 3];
    const ny = N[i0 * 3 + 1] + N[i1 * 3 + 1] + N[i2 * 3 + 1];
    const nz = N[i0 * 3 + 2] + N[i1 * 3 + 2] + N[i2 * 3 + 2];
    if (!((uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz > 1e-9)) continue;
    out.push(a, b, c);
  }
  return new Uint32Array(out);
}

/** A mesh as uploaded to the GPU: normals packed into signed bytes, and 16-bit indices where they fit. */
export interface GpuMesh {
  position: Float32Array;
  normal: Int8Array;
  color: Uint8Array;
  index: Uint16Array | Uint32Array;
}

export function gpuMesh(m: PackedMesh): GpuMesh {
  const normal = new Int8Array(m.normal.length);
  for (let i = 0; i < normal.length; i++) normal[i] = Math.round(Math.max(-1, Math.min(1, m.normal[i])) * 127);
  return { position: m.position, normal, color: m.color, index: gpuIndex(m.index, m.position.length / 3) };
}

/** An index buffer as uploaded to the GPU: 16-bit when the mesh has few enough vertices. */
export function gpuIndex(index: Uint32Array, vertices: number): Uint16Array | Uint32Array {
  return vertices <= 65536 ? Uint16Array.from(index) : index;
}

// ------------------------------------------------------------------ colour
export function hex(h: string): RGB {
  const v = parseInt(h.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function shade(c: RGB, f: number): RGB {
  return [Math.min(255, Math.round(c[0] * f)), Math.min(255, Math.round(c[1] * f)), Math.min(255, Math.round(c[2] * f))];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}

/** Deterministic 32-bit hash of an integer and a salt, in [0, 1). */
export function hash01(n: number, salt = 0): number {
  let h = (n ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Pick from weighted options with a hash value in [0, 1). */
export function pickWeighted<T>(options: readonly [T, number][], u: number): T {
  let total = 0;
  for (const [, w] of options) total += w;
  let r = u * total;
  for (const [v, w] of options) {
    r -= w;
    if (r < 0) return v;
  }
  return options[options.length - 1][0];
}
