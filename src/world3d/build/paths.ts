// Geometry helpers for the ground and road builders: arc-length paths,
// offset bands and walls along polylines, ring orientation, clipping,
// simplicity tests, hulls and a stroke font for painted lettering. Pure;
// coordinates are sim metres (x east, y north).

import type { MeshWriter, RGB } from './mesh';
import type { Ring } from './shapes';

export type Pt = [number, number];

/**
 * Height of all flat ground paint (land cover, pavements, carriageways,
 * markings). The paint layer draws in painter's order without writing depth,
 * so everything in it shares this lift above the street.
 */
export const PAINT_Y = 0.05;

// ------------------------------------------------------------------ rings

/** Twice the signed area of a ring: positive when counter-clockwise. */
export function ringArea2(r: Ring): number {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const j = (i + 1) % n;
    a += r[i][0] * r[j][1] - r[j][0] * r[i][1];
  }
  return a;
}

/** The ring without a closing duplicate of its first vertex, wound counter-clockwise. */
export function ccwRing(r: Ring): Ring {
  let out = r;
  const n = r.length;
  if (n > 1 && r[0][0] === r[n - 1][0] && r[0][1] === r[n - 1][1]) out = r.slice(0, -1);
  return ringArea2(out) < 0 ? [...out].reverse() : out;
}

export function ringBBox(r: Ring): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of r) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** Sutherland–Hodgman: the part of a ring on the side a·x + b·y ≤ c. */
export function clipHalf(r: Ring, a: number, b: number, c: number): Ring {
  const out: Ring = [];
  const n = r.length;
  for (let i = 0; i < n; i++) {
    const p = r[i];
    const q = r[(i + 1) % n];
    const dp = a * p[0] + b * p[1] - c;
    const dq = a * q[0] + b * q[1] - c;
    if (dp <= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/** The part of a ring inside an axis-aligned rectangle (may contain zero-width slivers along its edges). */
export function clipRect(r: Ring, x0: number, y0: number, x1: number, y1: number): Ring {
  let out = clipHalf(r, -1, 0, -x0);
  out = clipHalf(out, 1, 0, x1);
  out = clipHalf(out, 0, -1, -y0);
  return clipHalf(out, 0, 1, y1);
}

/** Do segments ab and cd cross (touching endpoints excluded)? */
export function segCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = (d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (a[0] - c[0]);
  const d2 = (d[0] - c[0]) * (b[1] - c[1]) - (d[1] - c[1]) * (b[0] - c[0]);
  const d3 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d4 = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when no two non-adjacent edges of the ring cross. */
export function ringSimple(r: Ring): boolean {
  const n = r.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = r[i];
    const b = r[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segCross(a, b, r[j], r[(j + 1) % n])) return false;
    }
  }
  return true;
}

/** Convex hull (Andrew's monotone chain), counter-clockwise. */
export function convexHull(points: Pt[]): Ring {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Distance from (x, y) to segment ab, and the parameter t of the closest point. */
export function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): { d: number; t: number } {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy;
  const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2)) : 0;
  return { d: Math.hypot(ax + vx * t - x, ay + vy * t - y), t };
}

/**
 * Crossings of the line through (px, py) with direction (ux, uy) and a ring, as
 * sorted line parameters; consecutive pairs bound the parts inside the ring.
 */
export function lineCrossings(r: Ring, px: number, py: number, ux: number, uy: number): number[] {
  const out: number[] = [];
  const n = r.length;
  for (let i = 0; i < n; i++) {
    const a = r[i];
    const b = r[(i + 1) % n];
    // Side of each endpoint relative to the line.
    const sa = (a[0] - px) * uy - (a[1] - py) * ux;
    const sb = (b[0] - px) * uy - (b[1] - py) * ux;
    if (sa > 0 === sb > 0) continue;
    const t = sa / (sa - sb);
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    out.push((x - px) * ux + (y - py) * uy);
  }
  return out.sort((a, b) => a - b);
}

/** Oriented frame of a ring along its longest edge: origin, axes, and extents along them. */
export function ringFrame(r: Ring): { ux: number; uy: number; u0: number; u1: number; v0: number; v1: number } {
  let best = 0;
  let ux = 1;
  let uy = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > best) {
      best = l;
      ux = (b[0] - a[0]) / l;
      uy = (b[1] - a[1]) / l;
    }
  }
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const [x, y] of r) {
    const u = x * ux + y * uy;
    const v = -x * uy + y * ux;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  return { ux, uy, u0, u1, v0, v1 };
}

// ------------------------------------------------------------------ paths

/** A polyline with cumulative arc length, for slicing and sampling by distance. */
export class Path {
  readonly pts: Ring;
  readonly cum: number[];
  readonly length: number;

  constructor(pts: Ring) {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.length = this.cum[this.cum.length - 1];
  }

  /** Index i of the segment [i, i + 1] containing arc length s. */
  private seg(s: number): number {
    let lo = 0;
    let hi = this.pts.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(0, lo);
  }

  /** Point and unit tangent at arc length s (clamped to the path). */
  at(s: number): [number, number, number, number] {
    const n = this.pts.length;
    if (n < 2) return [this.pts[0][0], this.pts[0][1], 1, 0];
    const c = Math.max(0, Math.min(this.length, s));
    let i = this.seg(c);
    // Skip zero-length segments for the tangent.
    while (i < n - 2 && this.cum[i + 1] - this.cum[i] < 1e-9) i++;
    const a = this.pts[i];
    const b = this.pts[i + 1];
    const l = this.cum[i + 1] - this.cum[i];
    const t = l > 1e-9 ? (c - this.cum[i]) / l : 0;
    const ux = l > 1e-9 ? (b[0] - a[0]) / l : 1;
    const uy = l > 1e-9 ? (b[1] - a[1]) / l : 0;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, ux, uy];
  }

  /** The sub-polyline between arc lengths s0 < s1. */
  slice(s0: number, s1: number): Ring {
    const a = Math.max(0, s0);
    const b = Math.min(this.length, s1);
    if (b - a < 1e-6) return [];
    const [x0, y0] = this.at(a);
    const out: Ring = [[x0, y0]];
    for (let i = this.seg(a) + 1; i < this.pts.length - 1 && this.cum[i] < b - 1e-6; i++) {
      if (this.cum[i] > a + 1e-6) out.push(this.pts[i]);
    }
    const [x1, y1] = this.at(b);
    out.push([x1, y1]);
    return out;
  }
}

/** Intervals [a, b] of `span` that lie outside every exclusion interval. */
export function subtractIntervals(span: [number, number], excl: [number, number][]): [number, number][] {
  const ex = excl.filter(([a, b]) => b > span[0] && a < span[1]).sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let cur = span[0];
  for (const [a, b] of ex) {
    if (a > cur) out.push([cur, Math.min(a, span[1])]);
    cur = Math.max(cur, b);
    if (cur >= span[1]) break;
  }
  if (cur < span[1]) out.push([cur, span[1]]);
  return out.filter(([a, b]) => b - a > 1e-3);
}

/** Calls fn for each dash [s, s + dash] of a dash/gap pattern aligned to arc length 0, clipped to [a, b]. */
export function dashRuns(a: number, b: number, dash: number, gap: number, fn: (s0: number, s1: number) => void, phase = 0): void {
  const period = dash + gap;
  let s = Math.floor((a - phase) / period) * period + phase;
  for (; s < b; s += period) {
    const s0 = Math.max(a, s);
    const s1 = Math.min(b, s + dash);
    if (s1 - s0 > dash * 0.25) fn(s0, s1);
  }
}

/** Per-vertex mitre offset directions (left normals scaled by the mitre length, capped). */
function mitres(pts: Ring, closed: boolean): Pt[] {
  const n = pts.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? pts[i - 1] : closed ? pts[n - 1] : null;
    const next = i < n - 1 ? pts[i + 1] : closed ? pts[0] : null;
    let ax = 0;
    let ay = 0;
    let bx = 0;
    let by = 0;
    if (prev) {
      const l = Math.hypot(pts[i][0] - prev[0], pts[i][1] - prev[1]);
      if (l > 1e-9) {
        ax = (pts[i][0] - prev[0]) / l;
        ay = (pts[i][1] - prev[1]) / l;
      }
    }
    if (next) {
      const l = Math.hypot(next[0] - pts[i][0], next[1] - pts[i][1]);
      if (l > 1e-9) {
        bx = (next[0] - pts[i][0]) / l;
        by = (next[1] - pts[i][1]) / l;
      }
    }
    if (ax === 0 && ay === 0) {
      ax = bx;
      ay = by;
    }
    if (bx === 0 && by === 0) {
      bx = ax;
      by = ay;
    }
    let tx = ax + bx;
    let ty = ay + by;
    const tl = Math.hypot(tx, ty);
    if (tl < 1e-6) {
      tx = bx;
      ty = by;
    } else {
      tx /= tl;
      ty /= tl;
    }
    // Left normal of the mean tangent, lengthened so the offset lines stay parallel.
    const nx = -ty;
    const ny = tx;
    const cos = nx * -by + ny * bx;
    const k = Math.min(2.5, 1 / Math.max(0.4, Math.abs(cos) || 1));
    out.push([nx * k, ny * k]);
  }
  return out;
}

/** The polyline offset sideways by d (positive: left of travel), mitred at the vertices. */
export function offsetLine(pts: Ring, d: number, closed = false): Ring {
  const m = mitres(pts, closed);
  return pts.map(([x, y], i) => [x + m[i][0] * d, y + m[i][1] * d]);
}

/**
 * Up-facing strip along a polyline between lateral offsets o0 < o1 (positive
 * is left of the direction of travel), mitred at the vertices.
 */
export function band(w: MeshWriter, pts: Ring, o0: number, o1: number, h: number, c: RGB, closed = false): void {
  const n = pts.length;
  if (n < 2) return;
  const m = mitres(pts, closed);
  const base = w.vertexCount;
  const xy: Pt[] = [];
  for (let i = 0; i < n; i++) {
    xy.push([pts[i][0] + m[i][0] * o0, pts[i][1] + m[i][1] * o0], [pts[i][0] + m[i][0] * o1, pts[i][1] + m[i][1] * o1]);
    w.vertex(xy[2 * i][0], xy[2 * i][1], h, 0, 1, 0, c);
    w.vertex(xy[2 * i + 1][0], xy[2 * i + 1][1], h, 0, 1, 0, c);
  }
  // Counter-clockwise in sim space is up-facing; a strip folded at a very sharp
  // bend is rewound so its lobes still face up.
  const tri = (a: number, b: number, d: number) => {
    const [ax, ay] = xy[a];
    const cross = (xy[b][0] - ax) * (xy[d][1] - ay) - (xy[d][0] - ax) * (xy[b][1] - ay);
    if (cross >= 0) w.triangle(base + a, base + b, base + d);
    else w.triangle(base + a, base + d, base + b);
  };
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const r0 = 2 * i;
    const l0 = r0 + 1;
    const r1 = 2 * ((i + 1) % n);
    const l1 = r1 + 1;
    // r0 → r1 → l1 → l0 runs counter-clockwise for a straight strip.
    tri(r0, r1, l1);
    tri(r0, l1, l0);
  }
}

/**
 * Solid wall along a polyline between lateral offsets o0 < o1 from height h0
 * to h1: top face plus both side faces (and end faces when open).
 */
export function wallBand(w: MeshWriter, pts: Ring, o0: number, o1: number, h0: number, h1: number, side: RGB, top: RGB, closed = false): void {
  const n = pts.length;
  if (n < 2) return;
  band(w, pts, o0, o1, h1, top, closed);
  const m = mitres(pts, closed);
  const off = (i: number, o: number): Pt => [pts[i][0] + m[i][0] * o, pts[i][1] + m[i][1] * o];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    const [ax, ay] = off(i, o0);
    const [bx, by] = off(j, o0);
    // Right-hand face (offset o0) faces right of travel.
    w.quad([ax, ay, h0], [bx, by, h0], [bx, by, h1], [ax, ay, h1], side);
    const [cx, cy] = off(i, o1);
    const [dx, dy] = off(j, o1);
    // Left-hand face (offset o1) faces left of travel.
    w.quad([dx, dy, h0], [cx, cy, h0], [cx, cy, h1], [dx, dy, h1], side);
  }
  if (!closed) {
    const [ax, ay] = off(0, o0);
    const [bx, by] = off(0, o1);
    w.quad([bx, by, h0], [ax, ay, h0], [ax, ay, h1], [bx, by, h1], side);
    const [cx, cy] = off(n - 1, o0);
    const [dx, dy] = off(n - 1, o1);
    w.quad([cx, cy, h0], [dx, dy, h0], [dx, dy, h1], [cx, cy, h1], side);
  }
}

/** Square-section beam between two 3D points (sim x, y, height), four side faces. */
export function beam(w: MeshWriter, p: [number, number, number], q: [number, number, number], size: number, c: RGB): void {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const dz = q[2] - p[2];
  const l = Math.hypot(dx, dy, dz);
  if (l < 1e-6) return;
  const ax = dx / l;
  const ay = dy / l;
  const az = dz / l;
  // Two unit vectors perpendicular to the beam axis.
  let sx = -ay;
  let sy = ax;
  let sz = 0;
  let sl = Math.hypot(sx, sy);
  if (sl < 1e-6) {
    sx = 1;
    sy = 0;
    sl = 1;
  }
  sx /= sl;
  sy /= sl;
  sz /= sl;
  const tx = ay * sz - az * sy;
  const ty = az * sx - ax * sz;
  const tz = ax * sy - ay * sx;
  const r = size / 2;
  const corner = (o: [number, number, number], a: number, b: number): [number, number, number] => [
    o[0] + (sx * a + tx * b) * r,
    o[1] + (sy * a + ty * b) * r,
    o[2] + (sz * a + tz * b) * r,
  ];
  const ring: [number, number][] = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ];
  for (let i = 0; i < 4; i++) {
    const [a0, b0] = ring[i];
    const [a1, b1] = ring[(i + 1) % 4];
    w.quad(corner(p, a0, b0), corner(p, a1, b1), corner(q, a1, b1), corner(q, a0, b0), c);
  }
}

// ------------------------------------------------------------------ lettering

/** Stroke glyphs on a unit box (x right, y up), as polylines. */
const GLYPHS: Record<string, [number, number][][]> = {
  T: [
    [
      [0, 1],
      [1, 1],
    ],
    [
      [0.5, 1],
      [0.5, 0],
    ],
  ],
  U: [
    [
      [0, 1],
      [0, 0],
      [1, 0],
      [1, 1],
    ],
  ],
  K: [
    [
      [0, 1],
      [0, 0],
    ],
    [
      [1, 1],
      [0, 0.45],
    ],
    [
      [0.35, 0.62],
      [1, 0],
    ],
  ],
  '-': [
    [
      [0.15, 0.5],
      [0.85, 0.5],
    ],
  ],
  '1': [
    [
      [0.25, 0.8],
      [0.55, 1],
      [0.55, 0],
    ],
  ],
  '3': [
    [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
    [
      [0.25, 0.5],
      [1, 0.5],
    ],
  ],
  '6': [
    [
      [1, 1],
      [0, 1],
      [0, 0],
      [1, 0],
      [1, 0.5],
      [0, 0.5],
    ],
  ],
  '8': [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
    [
      [0, 0.5],
      [1, 0.5],
    ],
  ],
};

/**
 * Paint text on the ground: glyph baseline starts at (x, y), reading along
 * (ux, uy), letters `height` tall with their tops towards the left of the
 * reading direction.
 */
export function paintText(w: MeshWriter, text: string, x: number, y: number, ux: number, uy: number, height: number, stroke: number, h: number, c: RGB): number {
  const gw = height * 0.6;
  const vx = -uy;
  const vy = ux;
  let cursor = 0;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (g) {
      for (const line of g) {
        for (let i = 1; i < line.length; i++) {
          const pa: Pt = [x + ux * (cursor + line[i - 1][0] * gw) + vx * line[i - 1][1] * height, y + uy * (cursor + line[i - 1][0] * gw) + vy * line[i - 1][1] * height];
          const pb: Pt = [x + ux * (cursor + line[i][0] * gw) + vx * line[i][1] * height, y + uy * (cursor + line[i][0] * gw) + vy * line[i][1] * height];
          const l = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
          if (l < 1e-6) continue;
          // Square caps close the corners between strokes.
          const ex = ((pb[0] - pa[0]) / l) * stroke * 0.5;
          const ey = ((pb[1] - pa[1]) / l) * stroke * 0.5;
          band(
            w,
            [
              [pa[0] - ex, pa[1] - ey],
              [pb[0] + ex, pb[1] + ey],
            ],
            -stroke / 2,
            stroke / 2,
            h,
            c,
          );
        }
      }
    }
    cursor += gw + height * 0.25;
  }
  return cursor - height * 0.25;
}
