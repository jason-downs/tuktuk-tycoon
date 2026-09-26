// Small flat-shaded geometry kit for the instanced tree and street-prop models:
// triangles, quads, boxes, prisms and faceted "lumps" with per-face vertex
// colours. Coordinates are three.js model space (X forward, Y up, Z to the
// model's right). Faces are wound outwards (counter-clockwise seen from
// outside) by testing each face against a point inside its part.

import { BufferGeometry, Color, Float32BufferAttribute } from 'three';
import { hash01 } from './build/mesh';

export type V = [number, number, number];
/** A colour as a CSS hex string (sRGB); stored as linear vertex colours. */
export type Paint = string;

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V): V => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Scale an sRGB hex colour's brightness by f (clamped), returning hex. */
export function tone(hex: Paint, f: number): Paint {
  const v = parseInt(hex.replace('#', ''), 16);
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((v >> s) & 255) * f)));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

export interface PrismOpts {
  /** Close the top end with a fan. */
  capTop?: boolean;
  /** Close the bottom end with a fan. */
  capBottom?: boolean;
  /** Rotation of the first ring vertex about the axis (radians). */
  rot?: number;
  /** Colour of the bottom ring vertices (a vertical gradient, e.g. grime at the base). */
  base?: Paint;
}

export interface LumpOpts {
  /** Depth of the underside below the rim, as a fraction of ry (default 0.55). */
  under?: number;
  /** Height of the upper ring above the rim, as a fraction of ry (default 0.55). */
  upperH?: number;
  /** Radius of the upper ring relative to the rim (default 0.72). */
  upperR?: number;
  /** Random radial jitter of the rings, fraction of the radius (default 0.16). */
  jitter?: number;
  /** Rotation of the rim (radians). */
  rot?: number;
}

/** Which part of a lump a face belongs to, for colouring. */
export type LumpBand = 'under' | 'side' | 'top';

export class Kit {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly c = new Color();

  get triangles(): number {
    return this.pos.length / 9;
  }

  private push(p: V, paint: Paint): void {
    this.c.set(paint);
    this.pos.push(p[0], p[1], p[2]);
    this.col.push(this.c.r, this.c.g, this.c.b);
  }

  /**
   * Triangle a→b→c. With `inside`, it is flipped if needed so that its normal
   * points away from that point. `paint` may give one colour per vertex.
   */
  tri(a: V, b: V, c: V, paint: Paint | [Paint, Paint, Paint], inside?: V): void {
    let pa: Paint;
    let pb: Paint;
    let pc: Paint;
    if (Array.isArray(paint)) [pa, pb, pc] = paint;
    else pa = pb = pc = paint;
    if (inside) {
      const n = cross(sub(b, a), sub(c, a));
      const g: V = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      if (dot(n, sub(g, inside)) < 0) {
        [b, c] = [c, b];
        [pb, pc] = [pc, pb];
      }
    }
    this.push(a, pa);
    this.push(b, pb);
    this.push(c, pc);
  }

  /** Planar quad a→b→c→d (in order round its edge), oriented away from `inside`. */
  quad(a: V, b: V, c: V, d: V, paint: Paint | [Paint, Paint, Paint, Paint], inside?: V): void {
    let p: [Paint, Paint, Paint, Paint] = Array.isArray(paint) ? paint : [paint, paint, paint, paint];
    if (inside) {
      const n = cross(sub(b, a), sub(d, a));
      const g: V = [(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4, (a[2] + b[2] + c[2] + d[2]) / 4];
      if (dot(n, sub(g, inside)) < 0) {
        [b, d] = [d, b];
        p = [p[0], p[3], p[2], p[1]];
      }
    }
    this.tri(a, b, c, [p[0], p[1], p[2]]);
    this.tri(a, c, d, [p[0], p[2], p[3]]);
  }

  /** A thin two-sided panel (flags, leaves seen from both sides). */
  panel(a: V, b: V, c: V, d: V, front: Paint, back: Paint = front): void {
    this.tri(a, b, c, front);
    this.tri(a, c, d, front);
    this.tri(a, c, b, back);
    this.tri(a, d, c, back);
  }

  /**
   * Box centred at (x, y, z) with size (sx, sy, sz), rotated rotY about Y.
   * The bottom face is left out unless `bottom` is set (props stand on the
   * ground). `top` / `side` colour those faces.
   */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, side: Paint, top: Paint = side, opts: { bottom?: Paint; rotY?: number } = {}): void {
    const r = opts.rotY ?? 0;
    const cr = Math.cos(r);
    const sr = Math.sin(r);
    // Rotation about +Y maps (u, w) to (u cos + w sin, −u sin + w cos).
    const P = (u: number, v: number, w: number): V => [x + u * cr + w * sr, y + v, z - u * sr + w * cr];
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const c: V = [x, y, z];
    const corners = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(-hx, hy, hz)];
    const [a0, a1, a2, a3, b0, b1, b2, b3] = corners;
    this.quad(b0, b1, b2, b3, top, c);
    this.quad(a0, a1, b1, b0, side, c);
    this.quad(a1, a2, b2, b1, side, c);
    this.quad(a2, a3, b3, b2, side, c);
    this.quad(a3, a0, b0, b3, side, c);
    if (opts.bottom) this.quad(a0, a1, a2, a3, opts.bottom, c);
  }

  /**
   * n-sided prism or frustum along the segment p0 → p1 with radii r0 → r1
   * (a cone when r1 is 0). Sides face away from the axis.
   */
  prism(p0: V, p1: V, r0: number, r1: number, sides: number, paint: Paint, opts: PrismOpts = {}): void {
    const axis = sub(p1, p0);
    const t = norm(axis);
    // A unit vector perpendicular to the axis, then the third basis vector.
    const ref: V = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(t, ref));
    const w = cross(t, u);
    const rot = opts.rot ?? 0;
    const ring = (p: V, r: number): V[] => {
      const out: V[] = [];
      for (let i = 0; i < sides; i++) {
        const a = rot + (i / sides) * Math.PI * 2;
        const ca = Math.cos(a) * r;
        const sa = Math.sin(a) * r;
        out.push([p[0] + u[0] * ca + w[0] * sa, p[1] + u[1] * ca + w[1] * sa, p[2] + u[2] * ca + w[2] * sa]);
      }
      return out;
    };
    const lo = ring(p0, r0);
    const hi = ring(p1, r1);
    const mid: V = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
    const low = opts.base ?? paint;
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      if (r1 < 1e-4) this.tri(lo[i], lo[j], p1, [low, low, paint], mid);
      else if (r0 < 1e-4) this.tri(p0, hi[j], hi[i], [low, paint, paint], mid);
      else this.quad(lo[i], lo[j], hi[j], hi[i], [low, low, paint, paint], mid);
    }
    if (opts.capTop && r1 >= 1e-4) {
      const inside: V = [p1[0] - t[0] * 0.01, p1[1] - t[1] * 0.01, p1[2] - t[2] * 0.01];
      for (let i = 1; i < sides - 1; i++) this.tri(hi[0], hi[i], hi[i + 1], paint, inside);
    }
    if (opts.capBottom && r0 >= 1e-4) {
      const inside: V = [p0[0] + t[0] * 0.01, p0[1] + t[1] * 0.01, p0[2] + t[2] * 0.01];
      for (let i = 1; i < sides - 1; i++) this.tri(lo[0], lo[i], lo[i + 1], low, inside);
    }
  }

  /**
   * Closed faceted blob (a foliage clump): an underside apex, a rim ring, a
   * staggered upper ring and a top apex — 4n triangles. `paint` colours each
   * face by band and index; `seed` makes the jitter repeatable.
   */
  lump(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, n: number, paint: (band: LumpBand, i: number) => Paint, seed: number, opts: LumpOpts = {}): void {
    const under = opts.under ?? 0.55;
    const upperH = opts.upperH ?? 0.55;
    const upperR = opts.upperR ?? 0.72;
    const jit = opts.jitter ?? 0.16;
    const rot = opts.rot ?? 0;
    const j = (k: number) => 1 + (hash01(seed * 97 + k, 71) - 0.5) * 2 * jit;
    const rim: V[] = [];
    const up: V[] = [];
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      const f = j(i);
      rim.push([cx + Math.cos(a) * rx * f, cy + (hash01(seed * 131 + i, 73) - 0.5) * ry * jit, cz + Math.sin(a) * rz * f]);
      const b = a + Math.PI / n;
      const g = j(i + 50) * upperR;
      up.push([cx + Math.cos(b) * rx * g, cy + ry * upperH, cz + Math.sin(b) * rz * g]);
    }
    const bottom: V = [cx, cy - ry * under, cz];
    const top: V = [cx, cy + ry, cz];
    const c: V = [cx, cy + ry * 0.1, cz];
    for (let i = 0; i < n; i++) {
      const k = (i + 1) % n;
      this.tri(bottom, rim[k], rim[i], paint('under', i), c);
      this.tri(rim[i], rim[k], up[i], paint('side', 2 * i), c);
      this.tri(up[i], rim[k], up[k], paint('side', 2 * i + 1), c);
      this.tri(up[i], up[k], top, paint('top', i), c);
    }
  }

  /** Non-indexed geometry with flat face normals and linear vertex colours. */
  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** Face colouring for foliage: darker underside, lighter top, hashed facet variation. */
export function foliage(base: Paint, seed: number, accents: [Paint, number][] = []): (band: LumpBand, i: number) => Paint {
  return (band, i) => {
    const u = hash01(seed * 31 + i + (band === 'top' ? 1000 : band === 'under' ? 2000 : 0), 5);
    let acc = 0;
    for (const [p, share] of accents) {
      acc += share;
      if (band !== 'under' && u < acc) return p;
    }
    const f = band === 'under' ? 0.72 : band === 'top' ? 1.1 : 0.94 + hash01(seed * 17 + i, 9) * 0.14;
    return tone(base, f);
  };
}
