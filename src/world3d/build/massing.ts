// Building massing shared by the typologies: grimy walls, flat roofs with
// parapets, pitched roofs over the oriented footprint, punched and ribbon
// windows (lit panes go to the windows layer), and rooftop clutter.

import { BC } from './buildingPalette';
import type { BuildContext } from './context';
import { basis, cbox, edgeOf, face, gable, hip, insetRing, lathe, obox, skillion, SIDE, UP, wallQuad, type Basis, type Edge } from './kit';
import { hash01, mix, shade, type MeshWriter, type RGB } from './mesh';
import { pointInRing, type Ring } from './shapes';

/**
 * Walls of a ring (and its holes) from h0 to h1, darker at the foot; skips
 * edge `skip`. Party walls (edge → neighbour's wall top) start above the
 * neighbour, or are left out when it is as tall.
 */
export function shellWalls(w: MeshWriter, ring: Ring, holes: Ring[], h0: number, h1: number, wall: RGB, skip = -1, shared?: Map<number, number>): void {
  const foot = shade(wall, 0.8);
  const top = shade(wall, 1.03);
  for (let i = 0; i < ring.length; i++) {
    if (i === skip) continue;
    const hn = shared?.get(i) ?? -Infinity;
    if (hn >= h1 - 0.05) continue;
    const lo = Math.max(h0, hn);
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    w.quad([ax, ay, lo], [bx, by, lo], [bx, by, h1], [ax, ay, h1], lo > h0 ? shade(wall, 0.95) : foot, top);
  }
  for (const hole of holes) w.walls(hole, h0, h1, foot, top);
}

/**
 * Flat roof deck at h with a parapet of height ph: lighter-topped inner faces
 * make it read from above. The outer faces are drawn here unless the caller's
 * walls already rise to h + ph (`outer` false).
 */
export function flatRoof(w: MeshWriter, ring: Ring, holes: Ring[], h: number, ph: number, wall: RGB, deck: RGB, outer = true): void {
  if (ph <= 0.05) {
    w.polygon(ring, holes.length ? holes : undefined, h, deck);
    return;
  }
  const inner = ring.length <= 24 ? insetRing(ring, 0.22) : null;
  const deckRing = inner ?? ring;
  w.polygon(deckRing, holes.length ? holes : undefined, h, deck);
  const out = shade(wall, 1.02);
  const inside = shade(wall, 0.86);
  if (outer) {
    w.walls(ring, h, h + ph, out, out);
    for (const hole of holes) w.walls(hole, h, h + ph, out, out);
  }
  if (!inner) return;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = inner[i];
    const b = inner[(i + 1) % n];
    // Inner face looks into the roof: wound opposite to the outer walls.
    w.quad([b[0], b[1], h], [a[0], a[1], h], [a[0], a[1], h + ph], [b[0], b[1], h + ph], inside, shade(wall, 1.05));
  }
}

/** Oriented footprint frame: centre, long axis angle and extents. */
export interface Obb {
  b: Basis;
  L: number;
  W: number;
}

export function obbOf(ring: Ring, angMrad: number): Obb {
  const ang = angMrad / 1000;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const [x, y] of ring) {
    const u = x * ux + y * uy;
    const v = -x * uy + y * ux;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const mu = (u0 + u1) / 2;
  const mv = (v0 + v1) / 2;
  let L = u1 - u0;
  let W = v1 - v0;
  let a = ang;
  if (W > L) {
    [L, W] = [W, L];
    a += Math.PI / 2;
  }
  return { b: basis(ux * mu - uy * mv, uy * mu + ux * mv, a), L, W };
}

export type PitchKind = 'gable' | 'hip' | 'skillion';

/**
 * Pitched roof over the oriented footprint; its eaves meet the wall tops at
 * h. Returns the ridge height.
 */
export function pitchedRoof(w: MeshWriter, o: Obb, h: number, rise: number, over: number, kind: PitchKind, roofC: RGB, wall: RGB, border: RGB | null = null): number {
  const hl = o.L / 2;
  const hw = o.W / 2;
  if (kind === 'gable') gable(w, o.b, -hl, hl, hw, h, h + rise, over, over * 0.8, roofC, shade(wall, 0.97), border, border ? 0.45 : 0);
  else if (kind === 'hip') hip(w, o.b, -hl, hl, hw, h, h + rise, over, roofC);
  else skillion(w, o.b, -hl, hl, hw, h + rise, h, over * 0.6, roofC, shade(wall, 0.95));
  return h + rise;
}

/**
 * Hipped roof for any footprint: the eave ring slopes up to an inset ring with
 * a flat top. Used when the footprint is too irregular for a ridge.
 */
export function ringHipRoof(w: MeshWriter, ring: Ring, h: number, rise: number, inset: number, roofC: RGB, wall: RGB): number {
  // Narrow wings limit the inset: halve it (keeping the pitch) until the inner ring is clean.
  let k = 1;
  let inner = insetRing(ring, inset);
  while (!inner && k > 0.2) {
    k /= 2;
    inner = insetRing(ring, inset * k);
  }
  if (!inner) {
    w.polygon(ring, undefined, h, roofC);
    return h;
  }
  rise *= k;
  w.polygon(ring, undefined, h - 0.01, shade(wall, 0.85));
  const top = shade(roofC, 1.06);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ia = inner[i];
    const ib = inner[(i + 1) % ring.length];
    face(w, [a[0], a[1], h], [b[0], b[1], h], [ib[0], ib[1], h + rise], [ia[0], ia[1], h + rise], roofC, top, UP);
  }
  w.polygon(inner, undefined, h + rise, top);
  return h + rise;
}

export interface WindowStyle {
  /** Window width as a fraction of its slot, and height (m). */
  frac: number;
  height: number;
  /** Sill above the floor (m). */
  sill: number;
  /** Slot width (m): windows per edge = floor(len / slot). */
  slot: number;
  /** Share of panes lit at night. */
  lit: number;
  glass: RGB;
  /** Grille colour mixed into half the panes (omit for plain glass). */
  grille?: RGB;
  maxPerEdge?: number;
}

/**
 * Punched windows on every edge of at least `minEdge` metres, one row per
 * floor. Lit panes go to the windows layer; unlit ones to the building layer.
 */
export function punchedWindows(
  ctx: BuildContext,
  ring: Ring,
  seed: number,
  base: number,
  ground: number,
  floor: number,
  levels: number,
  st: WindowStyle,
  skipEdge = -1,
  minEdge = 3,
  fromLevel = 0,
  shared?: Map<number, number>,
): void {
  const off = 0.06;
  for (let i = 0; i < ring.length; i++) {
    if (i === skipEdge) continue;
    const e = edgeOf(ring, i);
    if (e.len < minEdge) continue;
    const hidden = shared?.get(i) ?? -Infinity;
    const n = Math.min(st.maxPerEdge ?? 40, Math.floor(e.len / st.slot));
    if (n < 1) continue;
    const slot = e.len / n;
    const ww = Math.min(slot - 0.5, slot * st.frac);
    for (let k = fromLevel; k < levels; k++) {
      const hf = base + (k === 0 ? 0 : ground + (k - 1) * floor);
      const fh = k === 0 ? ground : floor;
      const sill = hf + Math.min(st.sill, fh * 0.35);
      const top = Math.min(hf + fh - 0.35, sill + st.height);
      if (top - sill < 0.5 || sill < hidden + 0.1) continue;
      for (let j = 0; j < n; j++) {
        const sc = (j + 0.5) * slot;
        paneOn(ctx, e, sc - ww / 2, sc + ww / 2, sill, top, off, st, seed * 131 + i * 977 + k * 31 + j);
      }
    }
  }
}

/** One window pane on an edge; lit panes glow at night. */
export function paneOn(ctx: BuildContext, e: Edge, s0: number, s1: number, h0: number, h1: number, off: number, st: WindowStyle, key: number): void {
  const lit = hash01(key, 71) < st.lit;
  const glass = st.grille && hash01(key, 73) < 0.5 ? mix(st.glass, st.grille, 0.35) : st.glass;
  const w = lit ? ctx.w.windows : ctx.w.buildings;
  wallQuad(w, e, s0, s1, h0, h1, off, shade(glass, 0.9), shade(glass, 1.12));
}

/**
 * Ribbon glazing: per floor and edge, a band of glass split into lit and dark
 * segments of about `seg` metres.
 */
export function ribbonWindows(ctx: BuildContext, ring: Ring, seed: number, base: number, ground: number, floor: number, levels: number, band: number, glass: RGB, lit: number, seg = 7, skipEdge = -1, fromLevel = 0, shared?: Map<number, number>): void {
  const off = 0.06;
  for (let i = 0; i < ring.length; i++) {
    if (i === skipEdge) continue;
    const e = edgeOf(ring, i);
    if (e.len < 2.5) continue;
    const hidden = shared?.get(i) ?? -Infinity;
    const n = Math.max(1, Math.round(e.len / seg));
    const sl = e.len / n;
    for (let k = fromLevel; k < levels; k++) {
      const hf = base + (k === 0 ? 0 : ground + (k - 1) * floor);
      const fh = k === 0 ? ground : floor;
      const h0 = hf + (fh - band) * 0.55;
      const h1 = h0 + band;
      if (h0 < hidden + 0.1) continue;
      for (let j = 0; j < n; j++) {
        const key = seed * 131 + i * 977 + k * 31 + j;
        const on = hash01(key, 75) < lit;
        const w = on ? ctx.w.windows : ctx.w.buildings;
        const s0 = j * sl + (j === 0 ? 0.35 : 0.05);
        const s1 = (j + 1) * sl - (j === n - 1 ? 0.35 : 0.05);
        if (s1 - s0 < 0.4) continue;
        wallQuad(w, e, s0, s1, h0, h1, off, shade(glass, 0.9), shade(glass, 1.1));
      }
    }
  }
}

/** A point on the roof inside the ring, or null. */
function roofSpot(ring: Ring, o: Obb, u: number, v: number, margin: number): [number, number] | null {
  const hl = o.L / 2 - margin;
  const hw = o.W / 2 - margin;
  if (hl <= 0 || hw <= 0) return null;
  const uu = Math.max(-hl, Math.min(hl, u));
  const vv = Math.max(-hw, Math.min(hw, v));
  const x = o.b.ox + o.b.ux * uu - o.b.uy * vv;
  const y = o.b.oy + o.b.uy * uu + o.b.ux * vv;
  if (!pointInRing(x, y, ring)) return null;
  // Keep the whole item inside: test the four corners of its margin square.
  for (const [du, dv] of [
    [-margin, -margin],
    [margin, -margin],
    [margin, margin],
    [-margin, margin],
  ]) {
    const px = x + o.b.ux * du - o.b.uy * dv;
    const py = y + o.b.uy * du + o.b.ux * dv;
    if (!pointInRing(px, py, ring)) return null;
  }
  return [x, y];
}

/** Water tank on a stand at (x, y) on a roof at height h. */
export function waterTank(w: MeshWriter, x: number, y: number, h: number, key: number): void {
  const u = hash01(key, 81);
  const tank = u < 0.45 ? BC.tankSteel : u < 0.8 ? BC.tankBlue : BC.tankBeige;
  const stand = hash01(key, 82) < 0.22;
  const r = 0.5 + hash01(key, 83) * 0.2;
  const b0 = h + (stand ? 0.8 : 0.05);
  if (stand) cbox(w, basis(x, y, hash01(key, 84) * 1.5), 0, 0, r * 1.7, r * 1.7, h, b0, BC.steelDark, BC.steelDark, BC.steelDark, SIDE.SIDES);
  lathe(w, x, y, [
    [r, b0],
    [r, b0 + 1.15],
  ], 5, [shade(tank, 0.92), shade(tank, 1.05)], hash01(key, 85));
}

/**
 * Rooftop clutter on a flat roof at height h: water tanks, a tin shed, an
 * antenna, a dish, a potted plant and laundry, each with a chance from `opts`
 * and placed by hash where it fits inside the footprint.
 */
export function rooftop(w: MeshWriter, ring: Ring, o: Obb, h: number, key: number, opts: { tanks: number; shed: number; antenna: number; dish: number; plants: number; laundry: number }): void {
  const { b } = o;
  let placed = 0;
  for (let t = 0; t < opts.tanks && placed < 3; t++) {
    if (hash01(key + t, 90) > (t === 0 ? 0.62 : 0.35)) continue;
    const s = roofSpot(ring, o, (hash01(key + t, 91) - 0.5) * o.L * 0.7, (hash01(key + t, 92) - 0.3) * o.W * 0.6, 0.9);
    if (!s) continue;
    waterTank(w, s[0], s[1], h, key + t * 7);
    placed++;
  }
  if (hash01(key, 93) < opts.shed && o.W > 5 && o.L > 6) {
    const du = 2 + hash01(key, 94) * 1.5;
    const dv = 1.8 + hash01(key, 95) * 1;
    const s = roofSpot(ring, o, (hash01(key, 96) - 0.5) * o.L * 0.5, o.W / 2 - dv / 2 - 0.4, Math.max(du, dv) / 2 + 0.3);
    if (s) {
      const sb: Basis = { ox: s[0], oy: s[1], ux: b.ux, uy: b.uy };
      const c = hash01(key, 97) < 0.5 ? BC.concrete : BC.slab;
      obox(w, sb, -du / 2, du / 2, -dv / 2, dv / 2, h, h + 2.1, shade(c, 0.85), c, c, SIDE.SIDES);
      skillion(w, sb, -du / 2, du / 2, dv / 2, h + 2.4, h + 2.05, 0.15, hash01(key, 98) < 0.5 ? BC.zinc : BC.rust, shade(c, 0.95));
    }
  }
  if (hash01(key, 99) < opts.antenna) {
    const s = roofSpot(ring, o, (hash01(key, 100) - 0.5) * o.L * 0.6, (hash01(key, 101) - 0.5) * o.W * 0.6, 0.4);
    if (s) {
      const ab = basis(s[0], s[1], hash01(key, 102) * 3);
      cbox(w, ab, 0, 0, 0.07, 0.07, h, h + 3.2, BC.steelDark, BC.steelDark, BC.steelDark, SIDE.SIDES);
      cbox(w, ab, 0, 0, 1.4, 0.05, h + 2.7, h + 2.76, BC.steelDark, BC.steelDark, BC.steelDark, SIDE.V0 | SIDE.V1 | SIDE.TOP);
    }
  }
  if (hash01(key, 103) < opts.dish) {
    const s = roofSpot(ring, o, (hash01(key, 104) - 0.5) * o.L * 0.6, (hash01(key, 105) - 0.5) * o.W * 0.6, 0.5);
    if (s) {
      const db = basis(s[0], s[1], hash01(key, 106) * 6.28);
      cbox(w, db, 0, 0, 0.08, 0.08, h, h + 0.9, BC.steelDark, BC.steelDark, BC.steelDark, SIDE.SIDES);
      face(w, bp4(db, -0.35, -0.35, h + 0.7), bp4(db, -0.35, 0.35, h + 0.7), bp4(db, 0.15, 0.35, h + 1.3), bp4(db, 0.15, -0.35, h + 1.3), BC.grilleWhite, BC.grilleWhite, [...dirOf(db, 1, 0), 0.6]);
    }
  }
  if (hash01(key, 107) < opts.plants) {
    const s = roofSpot(ring, o, (hash01(key, 108) - 0.5) * o.L * 0.8, (hash01(key, 109) - 0.5) * o.W * 0.8, 0.5);
    if (s) cbox(w, basis(s[0], s[1], 0), 0, 0, 0.9, 0.7, h, h + 0.9, BC.pot, BC.plant, BC.plantLight);
  }
  if (hash01(key, 110) < opts.laundry && o.L > 5) {
    const s = roofSpot(ring, o, 0, (hash01(key, 111) - 0.5) * o.W * 0.5, 1.2);
    if (s) {
      const lb: Basis = { ox: s[0], oy: s[1], ux: b.ux, uy: b.uy };
      for (let k = 0; k < 3; k++) {
        const u0 = -1.2 + k * 0.85;
        const c = BC.laundry[Math.floor(hash01(key + k, 112) * BC.laundry.length)];
        const p0 = bp4(lb, u0, 0, h + 1.8);
        const p1 = bp4(lb, u0 + 0.6, 0, h + 1.8);
        const p2 = bp4(lb, u0 + 0.6, 0, h + 1.05);
        const p3 = bp4(lb, u0, 0, h + 1.05);
        const [nx, ny] = dirOf(lb, 0, 1);
        face(w, p3, p2, p1, p0, c, c, [nx, ny, 0]);
        face(w, p2, p3, p0, p1, c, c, [-nx, -ny, 0]);
      }
    }
  }
}

function bp4(b: Basis, u: number, v: number, h: number): [number, number, number] {
  return [b.ox + b.ux * u - b.uy * v, b.oy + b.uy * u + b.ux * v, h];
}

function dirOf(b: Basis, du: number, dv: number): [number, number] {
  return [b.ux * du - b.uy * dv, b.uy * du + b.ux * dv];
}

/** Door on an edge: a darker panel up to 2.3 m. */
export function door(w: MeshWriter, e: Edge, s: number, width: number, base: number, c: RGB): void {
  wallQuad(w, e, s - width / 2, s + width / 2, base, base + 2.3, 0.05, shade(c, 0.85), c);
}

