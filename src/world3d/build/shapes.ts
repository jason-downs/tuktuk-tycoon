// Shared geometry helpers for the city builders: rings, oriented frames,
// prisms, boxes, roofs and polyline walkers.

import type { CityBuilding } from '../city';
import { shade, type MeshWriter, type RGB } from './mesh';

export type V3 = [number, number, number];
export type Ring = [number, number][];

export function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function bbox(ring: Ring): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of ring) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

/** n-sided prism/frustum around (x, y) from h0 (radius r0) to h1 (radius r1), with a top cap. */
export function frustum(w: MeshWriter, x: number, y: number, r0: number, r1: number, h0: number, h1: number, n: number, c: RGB, cap = true, rot = 0): void {
  for (let i = 0; i < n; i++) {
    const a0 = rot + (i / n) * Math.PI * 2;
    const a1 = rot + ((i + 1) / n) * Math.PI * 2;
    w.quad(
      [x + Math.cos(a0) * r0, y + Math.sin(a0) * r0, h0],
      [x + Math.cos(a1) * r0, y + Math.sin(a1) * r0, h0],
      [x + Math.cos(a1) * r1, y + Math.sin(a1) * r1, h1],
      [x + Math.cos(a0) * r1, y + Math.sin(a0) * r1, h1],
      c,
    );
  }
  if (cap && r1 > 0.01) {
    const ring: Ring = [];
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      ring.push([x + Math.cos(a) * r1, y + Math.sin(a) * r1]);
    }
    w.polygon(ring, undefined, h1, c);
  }
}

/** Axis-aligned-in-its-own-frame box centred on (x, y), long side along angle ang. */
export function box(w: MeshWriter, x: number, y: number, len: number, wid: number, h0: number, h1: number, ang: number, c: RGB, cTop: RGB = c): void {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const hl = len / 2;
  const hw = wid / 2;
  const ring: Ring = [
    [x - ca * hl + sa * hw, y - sa * hl - ca * hw],
    [x + ca * hl + sa * hw, y + sa * hl - ca * hw],
    [x + ca * hl - sa * hw, y + sa * hl + ca * hw],
    [x - ca * hl - sa * hw, y - sa * hl + ca * hw],
  ];
  w.walls(ring, h0, h1, c);
  w.polygon(ring, undefined, h1, cTop);
}

export interface Frame {
  cx: number;
  cy: number;
  ux: number;
  uy: number;
  vx: number;
  vy: number;
  L: number;
  W: number;
}

export function frameOf(b: CityBuilding, ring: Ring): Frame {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of ring) {
    cx += x;
    cy += y;
  }
  cx /= ring.length;
  cy /= ring.length;
  const ang = b.o[2] / 1000;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  // Re-centre on the oriented box so pitched roofs sit over the footprint.
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const [x, y] of ring) {
    const u = (x - cx) * ux + (y - cy) * uy;
    const v = -(x - cx) * uy + (y - cy) * ux;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const mu = (u0 + u1) / 2;
  const mv = (v0 + v1) / 2;
  return {
    cx: cx + ux * mu - uy * mv,
    cy: cy + uy * mu + ux * mv,
    ux,
    uy,
    vx: -uy,
    vy: ux,
    L: u1 - u0,
    W: v1 - v0,
  };
}

export const at = (f: Frame, u: number, v: number, h: number): V3 => [f.cx + f.ux * u + f.vx * v, f.cy + f.uy * u + f.vy * v, h];

/** Gable roof over the frame: ridge along the long axis. */
export function gableRoof(w: MeshWriter, f: Frame, eave: number, ridge: number, over: number, roof: RGB, gableC: RGB): void {
  const hl = f.L / 2 + over;
  const hw = f.W / 2 + over;
  const drop = (over / (f.W / 2)) * (ridge - eave);
  const e = eave - drop;
  w.quad(at(f, -hl, -hw, e), at(f, hl, -hw, e), at(f, hl, 0, ridge), at(f, -hl, 0, ridge), roof, shade(roof, 1.05));
  w.quad(at(f, hl, hw, e), at(f, -hl, hw, e), at(f, -hl, 0, ridge), at(f, hl, 0, ridge), roof, shade(roof, 1.05));
  // Gable ends (walls up to the ridge).
  w.tri(at(f, f.L / 2, -f.W / 2, eave), at(f, f.L / 2, f.W / 2, eave), at(f, f.L / 2, 0, ridge), gableC);
  w.tri(at(f, -f.L / 2, f.W / 2, eave), at(f, -f.L / 2, -f.W / 2, eave), at(f, -f.L / 2, 0, ridge), gableC);
}

/** Hip roof over the frame. */
export function hipRoof(w: MeshWriter, f: Frame, eave: number, ridge: number, over: number, roof: RGB): void {
  const hl = f.L / 2 + over;
  const hw = f.W / 2 + over;
  const drop = (over / (f.W / 2)) * (ridge - eave);
  const e = eave - drop;
  const rl = Math.max(0, hl - hw);
  const top = shade(roof, 1.06);
  w.quad(at(f, -hl, -hw, e), at(f, hl, -hw, e), at(f, rl, 0, ridge), at(f, -rl, 0, ridge), roof, top);
  w.quad(at(f, hl, hw, e), at(f, -hl, hw, e), at(f, -rl, 0, ridge), at(f, rl, 0, ridge), roof, top);
  w.tri(at(f, hl, -hw, e), at(f, hl, hw, e), at(f, rl, 0, ridge), shade(roof, 0.92), shade(roof, 0.92), top);
  w.tri(at(f, -hl, hw, e), at(f, -hl, -hw, e), at(f, -rl, 0, ridge), shade(roof, 0.92), shade(roof, 0.92), top);
}

export function offset(pts: Ring, d: number): Ring {
  return pts.map(([x, y], i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [x - (dy / l) * d, y + (dx / l) * d];
  });
}

/** Walk a polyline every `step` metres, calling fn with the point and the left normal. */
export function alongLine(pts: Ring, step: number, fn: (x: number, y: number, n: number, nx: number, ny: number) => void): void {
  let carry = step / 2;
  let n = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) continue;
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;
    let d = carry;
    while (d < len) {
      fn(ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len, n++, nx, ny);
      d += step;
    }
    carry = d - len;
  }
}

export function dashes(w: MeshWriter, pts: Ring, half: number, h: number, c: RGB, dash: number, gap: number): void {
  if (gap <= 0) {
    w.ribbon(pts, half, h, c);
    return;
  }
  let on = true;
  let left = dash;
  let seg: Ring = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    let [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    let len = Math.hypot(bx - ax, by - ay);
    while (len > 1e-6) {
      const take = Math.min(left, len);
      const t = take / len;
      const px = ax + (bx - ax) * t;
      const py = ay + (by - ay) * t;
      if (on) seg.push([px, py]);
      left -= take;
      len -= take;
      ax = px;
      ay = py;
      if (left <= 1e-6) {
        if (on && seg.length >= 2) w.ribbon(seg, half, h, c);
        on = !on;
        left = on ? dash : gap;
        seg = [[ax, ay]];
      }
    }
    if (on) seg.push([bx, by]);
  }
  if (on && seg.length >= 2) w.ribbon(seg, half, h, c);
}

export function hexOf(c: string): RGB {
  const v = parseInt(c.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Lanna assembly hall: low white walls, steep two-tier roof, gold finials. */