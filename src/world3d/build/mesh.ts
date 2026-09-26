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
