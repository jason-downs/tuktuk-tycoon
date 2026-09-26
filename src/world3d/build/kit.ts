// Geometry kit for buildings, temples and landmarks: local frames on the
// ground, self-orienting faces, oriented boxes, prisms, lathes, pitched roofs
// and wall-edge frames for facade detail. Positions are sim metres (x east,
// y north) plus a height; everything is written through MeshWriter.

import type { MeshWriter, RGB } from './mesh';
import { shade } from './mesh';
import type { Ring, V3 } from './shapes';

// ------------------------------------------------------------------ frames

/** Local ground frame: origin (ox, oy), unit axis u = (ux, uy); v is u rotated 90° anticlockwise. */
export interface Basis {
  ox: number;
  oy: number;
  ux: number;
  uy: number;
}

export function basis(ox: number, oy: number, ang: number): Basis {
  return { ox, oy, ux: Math.cos(ang), uy: Math.sin(ang) };
}

/** Point at local (u, v) and height h. */
export function bp(b: Basis, u: number, v: number, h: number): V3 {
  return [b.ox + b.ux * u - b.uy * v, b.oy + b.uy * u + b.ux * v, h];
}

/** Direction (sim dx, dy) of local (du, dv). */
export function bdir(b: Basis, du: number, dv: number): [number, number] {
  return [b.ux * du - b.uy * dv, b.uy * du + b.ux * dv];
}

/**
 * Frame of one edge A→B of a counter-clockwise ring: t runs along the edge,
 * n points out of the building (to the right of t).
 */
export interface Edge {
  ax: number;
  ay: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  len: number;
}

export function edgeOf(ring: Ring, i: number): Edge {
  const [ax, ay] = ring[i];
  const [bx, by] = ring[(i + 1) % ring.length];
  const len = Math.hypot(bx - ax, by - ay) || 1e-6;
  const tx = (bx - ax) / len;
  const ty = (by - ay) / len;
  return { ax, ay, tx, ty, nx: ty, ny: -tx, len };
}

/** Point s metres along the edge, `off` metres out from the wall, at height h. */
export function ep(e: Edge, s: number, off: number, h: number): V3 {
  return [e.ax + e.tx * s + e.nx * off, e.ay + e.ty * s + e.ny * off, h];
}

/** Basis whose u runs along the edge and whose v points into the building. */
export function edgeBasis(e: Edge): Basis {
  return { ox: e.ax, oy: e.ay, ux: e.tx, uy: e.ty };
}

// ------------------------------------------------------------------ faces

/**
 * Quad p→q→r→s wound so its normal points along `hint` (sim dx, dy, dh). p and
 * q take colour c, r and s take cTop. Degenerate quads are skipped.
 */
export function face(w: MeshWriter, p: V3, q: V3, r: V3, s: V3, c: RGB, cTop: RGB, hint: V3): void {
  const ax = q[0] - p[0];
  const ay = q[2] - p[2];
  const az = -(q[1] - p[1]);
  const bx = s[0] - p[0];
  const by = s[2] - p[2];
  const bz = -(s[1] - p[1]);
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  if (nx * nx + ny * ny + nz * nz < 1e-12) return;
  if (nx * hint[0] + ny * hint[2] - nz * hint[1] >= 0) w.quad(p, q, r, s, c, cTop);
  else w.quad(q, p, s, r, c, cTop);
}

/** Triangle wound so its normal points along `hint` (sim dx, dy, dh); degenerate ones are skipped. */
export function tri3(w: MeshWriter, p: V3, q: V3, r: V3, c: RGB, hint: V3, c2: RGB = c, c3: RGB = c): void {
  const ax = q[0] - p[0];
  const ay = q[2] - p[2];
  const az = -(q[1] - p[1]);
  const bx = r[0] - p[0];
  const by = r[2] - p[2];
  const bz = -(r[1] - p[1]);
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  if (nx * nx + ny * ny + nz * nz < 1e-12) return;
  if (nx * hint[0] + ny * hint[2] - nz * hint[1] >= 0) w.tri(p, q, r, c, c2, c3);
  else w.tri(p, r, q, c, c3, c2);
}

export const UP: V3 = [0, 0, 1];

/** Vertical quad on an edge frame, facing out, from s0 to s1 and h0 to h1 (skipped when empty). */
export function wallQuad(w: MeshWriter, e: Edge, s0: number, s1: number, h0: number, h1: number, off: number, c: RGB, cTop: RGB = c): void {
  if (s1 - s0 < 1e-3 || h1 - h0 < 1e-3) return;
  w.quad(ep(e, s0, off, h0), ep(e, s1, off, h0), ep(e, s1, off, h1), ep(e, s0, off, h1), c, cTop);
}

// ------------------------------------------------------------------ solids

/** Face mask bits for obox: sides by their outward direction, and the top. */
export const SIDE = { V0: 1, U1: 2, V1: 4, U0: 8, TOP: 16, ALL: 31, SIDES: 15 } as const;

/**
 * Box over local u0..u1 × v0..v1 from h0 to h1 (no bottom). Sides shade from c
 * at the foot to cTop; the top uses cCap.
 */
export function obox(
  w: MeshWriter,
  b: Basis,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  h0: number,
  h1: number,
  c: RGB,
  cTop: RGB = c,
  cCap: RGB = cTop,
  mask: number = SIDE.ALL,
): void {
  const p00 = (h: number) => bp(b, u0, v0, h);
  const p10 = (h: number) => bp(b, u1, v0, h);
  const p11 = (h: number) => bp(b, u1, v1, h);
  const p01 = (h: number) => bp(b, u0, v1, h);
  if (mask & SIDE.V0) w.quad(p00(h0), p10(h0), p10(h1), p00(h1), c, cTop);
  if (mask & SIDE.U1) w.quad(p10(h0), p11(h0), p11(h1), p10(h1), c, cTop);
  if (mask & SIDE.V1) w.quad(p11(h0), p01(h0), p01(h1), p11(h1), c, cTop);
  if (mask & SIDE.U0) w.quad(p01(h0), p00(h0), p00(h1), p01(h1), c, cTop);
  if (mask & SIDE.TOP) w.quad(p00(h1), p10(h1), p11(h1), p01(h1), cCap, cCap);
}

/** Axis-aligned-in-frame box centred at local (u, v) with size du × dv. */
export function cbox(w: MeshWriter, b: Basis, u: number, v: number, du: number, dv: number, h0: number, h1: number, c: RGB, cTop: RGB = c, cCap: RGB = cTop, mask: number = SIDE.ALL): void {
  obox(w, b, u - du / 2, u + du / 2, v - dv / 2, v + dv / 2, h0, h1, c, cTop, cCap, mask);
}

/** Extrude a counter-clockwise ring from h0 to h1 with an optional cap. */
export function prism(w: MeshWriter, ring: Ring, h0: number, h1: number, c: RGB, cTop: RGB = c, cap: RGB | null = cTop): void {
  w.walls(ring, h0, h1, c, cTop);
  if (cap) w.polygon(ring, undefined, h1, cap);
}

/** Regular n-gon ring around (x, y), counter-clockwise, first vertex at angle rot. */
export function ngon(x: number, y: number, r: number, n: number, rot = 0): Ring {
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    out.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  return out;
}

/**
 * Redented ("indented-corner") square: a square of half-side r whose corners
 * are notched by `notch`, as on Lanna chedi bases. 12 vertices, counter-clockwise.
 */
export function redented(b: Basis, r: number, notch: number): Ring {
  const a = r - notch;
  const local: [number, number][] = [
    [a, -r],
    [a, -a],
    [r, -a],
    [r, a],
    [a, a],
    [a, r],
    [-a, r],
    [-a, a],
    [-r, a],
    [-r, -a],
    [-a, -a],
    [-a, -r],
  ];
  return local.map(([u, v]) => {
    const p = bp(b, u, v, 0);
    return [p[0], p[1]] as [number, number];
  });
}

/** Scale a ring about (x, y). */
export function scaleRing(ring: Ring, x: number, y: number, k: number): Ring {
  return ring.map(([px, py]) => [x + (px - x) * k, y + (py - y) * k]);
}

/**
 * Solid of revolution around (x, y): profile is [radius, height] from bottom
 * to top; colours per profile point. Closed with a cap when the last radius > 0.
 */
export function lathe(w: MeshWriter, x: number, y: number, profile: [number, number][], n: number, colours: RGB[], rot = 0): void {
  for (let k = 1; k < profile.length; k++) {
    const [r0, h0] = profile[k - 1];
    const [r1, h1] = profile[k];
    const c0 = colours[Math.min(k - 1, colours.length - 1)];
    const c1 = colours[Math.min(k, colours.length - 1)];
    if (h1 === h0 && r1 < r0) {
      // A horizontal ledge (shelf) facing up.
      for (let i = 0; i < n; i++) {
        const a0 = rot + (i / n) * Math.PI * 2;
        const a1 = rot + ((i + 1) / n) * Math.PI * 2;
        face(
          w,
          [x + Math.cos(a0) * r0, y + Math.sin(a0) * r0, h0],
          [x + Math.cos(a1) * r0, y + Math.sin(a1) * r0, h0],
          [x + Math.cos(a1) * r1, y + Math.sin(a1) * r1, h1],
          [x + Math.cos(a0) * r1, y + Math.sin(a0) * r1, h1],
          c0,
          c0,
          UP,
        );
      }
      continue;
    }
    if (h1 <= h0) continue;
    for (let i = 0; i < n; i++) {
      const a0 = rot + (i / n) * Math.PI * 2;
      const a1 = rot + ((i + 1) / n) * Math.PI * 2;
      const p: V3 = [x + Math.cos(a0) * r0, y + Math.sin(a0) * r0, h0];
      const q: V3 = [x + Math.cos(a1) * r0, y + Math.sin(a1) * r0, h0];
      const r: V3 = [x + Math.cos(a1) * r1, y + Math.sin(a1) * r1, h1];
      const s: V3 = [x + Math.cos(a0) * r1, y + Math.sin(a0) * r1, h1];
      if (r1 < 1e-3) w.tri(p, q, r, c0, c0, c1);
      else w.quad(p, q, r, s, c0, c1);
    }
  }
  const [rTop, hTop] = profile[profile.length - 1];
  if (rTop > 1e-3) w.polygon(ngon(x, y, rTop, n, rot), undefined, hTop, colours[colours.length - 1]);
}

// ------------------------------------------------------------------ roofs

/**
 * Gable roof over local u0..u1 with the ridge along u at v = 0, walls at
 * v = ±hw. Eaves overhang the side walls by `side` and the gable ends by
 * `end`; wall-top height `eave`, ridge height `ridge`. Draws the two slopes and
 * the gable triangles (in gableC); an optional border colour paints the lowest
 * `band` metres of each slope.
 */
export function gable(
  w: MeshWriter,
  b: Basis,
  u0: number,
  u1: number,
  hw: number,
  eave: number,
  ridge: number,
  side: number,
  end: number,
  roofC: RGB,
  gableC: RGB | null,
  border: RGB | null = null,
  band = 0,
): void {
  const rise = ridge - eave;
  const slope = rise / Math.max(hw, 0.1);
  const eOut = eave - side * slope;
  const a0 = u0 - end;
  const a1 = u1 + end;
  const top = shade(roofC, 1.06);
  for (const s of [-1, 1]) {
    const vo = s * (hw + side);
    if (border && band > 0) {
      const f = Math.min(0.9, band / (hw + side));
      const vb = vo * (1 - f);
      const hb = eOut + (ridge - eOut) * f;
      face(w, bp(b, a0, vo, eOut), bp(b, a1, vo, eOut), bp(b, a1, vb, hb), bp(b, a0, vb, hb), border, border, UP);
      face(w, bp(b, a0, vb, hb), bp(b, a1, vb, hb), bp(b, a1, 0, ridge), bp(b, a0, 0, ridge), roofC, top, UP);
    } else {
      face(w, bp(b, a0, vo, eOut), bp(b, a1, vo, eOut), bp(b, a1, 0, ridge), bp(b, a0, 0, ridge), roofC, top, UP);
    }
  }
  if (gableC) {
    for (const [u, du] of [
      [u0, -1],
      [u1, 1],
    ] as const) {
      const [dx, dy] = bdir(b, du, 0);
      tri3(w, bp(b, u, -hw, eave), bp(b, u, hw, eave), bp(b, u, 0, ridge), gableC, [dx, dy, 0]);
    }
  }
}

/** Hip roof over local u0..u1 × ±hw with overhang `over`. */
export function hip(w: MeshWriter, b: Basis, u0: number, u1: number, hw: number, eave: number, ridge: number, over: number, roofC: RGB): void {
  const rise = ridge - eave;
  const slope = rise / Math.max(hw, 0.1);
  const e = eave - over * slope;
  const hl = (u1 - u0) / 2;
  const um = (u0 + u1) / 2;
  const rl = Math.max(0, hl - hw);
  const hwO = hw + over;
  const hlO = hl + over;
  const top = shade(roofC, 1.06);
  const end = shade(roofC, 0.93);
  face(w, bp(b, um - hlO, -hwO, e), bp(b, um + hlO, -hwO, e), bp(b, um + rl, 0, ridge), bp(b, um - rl, 0, ridge), roofC, top, UP);
  face(w, bp(b, um + hlO, hwO, e), bp(b, um - hlO, hwO, e), bp(b, um - rl, 0, ridge), bp(b, um + rl, 0, ridge), roofC, top, UP);
  tri3(w, bp(b, um + hlO, -hwO, e), bp(b, um + hlO, hwO, e), bp(b, um + rl, 0, ridge), end, UP, end, top);
  tri3(w, bp(b, um - hlO, hwO, e), bp(b, um - hlO, -hwO, e), bp(b, um - rl, 0, ridge), end, UP, end, top);
}

/** Single-pitch (skillion) roof falling from v = -hw (high) to v = +hw (low). */
export function skillion(w: MeshWriter, b: Basis, u0: number, u1: number, hw: number, hHigh: number, hLow: number, over: number, roofC: RGB, sideC: RGB | null): void {
  const slope = (hHigh - hLow) / Math.max(2 * hw, 0.1);
  face(
    w,
    bp(b, u0 - over, hw + over, hLow - over * slope),
    bp(b, u1 + over, hw + over, hLow - over * slope),
    bp(b, u1 + over, -hw - over, hHigh + over * slope),
    bp(b, u0 - over, -hw - over, hHigh + over * slope),
    roofC,
    shade(roofC, 1.05),
    UP,
  );
  if (sideC) {
    // Triangular infill on the two ends and the raised back wall strip.
    for (const [u, du] of [
      [u0, -1],
      [u1, 1],
    ] as const) {
      const [dx, dy] = bdir(b, du, 0);
      tri3(w, bp(b, u, -hw, hLow), bp(b, u, hw, hLow), bp(b, u, -hw, hHigh), sideC, [dx, dy, 0]);
    }
    const [dx, dy] = bdir(b, 0, -1);
    face(w, bp(b, u0, -hw, hLow), bp(b, u1, -hw, hLow), bp(b, u1, -hw, hHigh), bp(b, u0, -hw, hHigh), sideC, sideC, [dx, dy, 0]);
  }
}

// ------------------------------------------------------------------ rings

/** Signed area (shoelace): positive for counter-clockwise rings (x east, y north). */
export function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

export function centroid(ring: Ring): [number, number] {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of ring) {
    cx += x;
    cy += y;
  }
  return [cx / ring.length, cy / ring.length];
}

/**
 * Inset a counter-clockwise ring by d metres (mitred, clamped). Returns null
 * when the result is degenerate: flipped, poking outside the original, or
 * self-intersecting (narrow wings of concave footprints).
 */
export function insetRing(ring: Ring, d: number): Ring | null {
  const out = insetRaw(ring, d);
  if (!out) return null;
  for (const [x, y] of out) if (!pointInRingLocal(x, y, ring)) return null;
  if (selfIntersects(out)) return null;
  return out;
}

function pointInRingLocal(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when two non-adjacent edges of a closed ring cross. */
export function selfIntersects(ring: Ring): boolean {
  const n = ring.length;
  const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  for (let i = 0; i < n; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [cx, cy] = ring[j];
      const [dx, dy] = ring[(j + 1) % n];
      const d1 = cross(ax, ay, bx, by, cx, cy);
      const d2 = cross(ax, ay, bx, by, dx, dy);
      const d3 = cross(cx, cy, dx, dy, ax, ay);
      const d4 = cross(cx, cy, dx, dy, bx, by);
      if (d1 * d2 < 0 && d3 * d4 < 0) return true;
    }
  }
  return false;
}

function insetRaw(ring: Ring, d: number): Ring | null {
  const n = ring.length;
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const [px, py] = ring[(i + n - 1) % n];
    const [x, y] = ring[i];
    const [qx, qy] = ring[(i + 1) % n];
    const la = Math.hypot(x - px, y - py) || 1;
    const ax = (x - px) / la;
    const ay = (y - py) / la;
    const lb = Math.hypot(qx - x, qy - y) || 1;
    const bx = (qx - x) / lb;
    const by = (qy - y) / lb;
    // Inward normals (left of each edge for a CCW ring).
    const n1x = -ay;
    const n1y = ax;
    const n2x = -by;
    const n2y = bx;
    let mx = n1x + n2x;
    let my = n1y + n2y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) {
      mx = n1x;
      my = n1y;
    } else {
      mx /= ml;
      my /= ml;
    }
    const cos = mx * n1x + my * n1y;
    const k = Math.min(3, 1 / Math.max(0.3, cos));
    out.push([x + mx * d * k, y + my * d * k]);
  }
  if (ringArea(out) <= 0.5) return null;
  return out;
}

/** Distance from (x, y) to segment a→b. */
export function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy || 1e-12;
  const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2));
  return Math.hypot(ax + vx * t - x, ay + vy * t - y);
}

/** Distance from (x, y) to a closed ring's boundary. */
export function ringDist(x: number, y: number, ring: Ring): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    d = Math.min(d, segDist(x, y, ax, ay, bx, by));
  }
  return d;
}

// ------------------------------------------------------------------ beams

/**
 * Prism beam from a to b (sim x, y, h) with `sides` faces, tapering from
 * radius r0 to r1, capped at b when r1 > 0. Used for finials, bargeboards,
 * naga bodies and poles.
 */
export function beam(w: MeshWriter, a: V3, b: V3, r0: number, r1: number, c: RGB, c1: RGB = c, sides = 3): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dh = b[2] - a[2];
  const len = Math.hypot(dx, dy, dh);
  if (len < 1e-6) return;
  const ax = dx / len;
  const ay = dy / len;
  const ah = dh / len;
  // Frame (p, q) perpendicular to the axis, from a helper axis away from it.
  const hx = Math.abs(ah) > 0.9 ? 1 : 0;
  const hh = Math.abs(ah) > 0.9 ? 0 : 1;
  let px = ay * hh;
  let py = ah * hx - ax * hh;
  let ph = -ay * hx;
  const pl = Math.hypot(px, py, ph) || 1;
  px /= pl;
  py /= pl;
  ph /= pl;
  const qx = ay * ph - ah * py;
  const qy = ah * px - ax * ph;
  const qh = ax * py - ay * px;
  const corner = (o: V3, r: number, k: number): V3 => {
    const t = (k / sides) * Math.PI * 2;
    const cs = Math.cos(t) * r;
    const sn = Math.sin(t) * r;
    return [o[0] + px * cs + qx * sn, o[1] + py * cs + qy * sn, o[2] + ph * cs + qh * sn];
  };
  for (let k = 0; k < sides; k++) {
    const p0 = corner(a, r0, k);
    const p1 = corner(a, r0, k + 1);
    const p2 = corner(b, r1, k + 1);
    const p3 = corner(b, r1, k);
    const hint: V3 = [(p0[0] + p1[0]) / 2 - a[0], (p0[1] + p1[1]) / 2 - a[1], (p0[2] + p1[2]) / 2 - a[2]];
    if (r1 < 1e-4) tri3(w, p0, p1, p2, c, hint, c, c1);
    else face(w, p0, p1, p2, p3, c, c1, hint);
  }
  if (r1 >= 1e-4) {
    const c0 = corner(b, r1, 0);
    for (let k = 1; k < sides - 1; k++) tri3(w, c0, corner(b, r1, k), corner(b, r1, k + 1), c1, [ax, ay, ah]);
  }
}
