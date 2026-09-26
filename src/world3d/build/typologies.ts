// Non-shophouse building types (docs/3d/world.md §1.2, §2.4): modern Thai
// houses with hip roofs, Lanna teak houses with kalae, guesthouse and
// apartment blocks, condos and hotels with glass and balcony bands, schools
// with corridor balconies, hospitals, malls, market halls and open roofs,
// kiosks, warehouses, hangars, churches, mosques and Chinese shrines.

import type { Plan, Site } from './site';
import { BC } from './buildingPalette';
import type { BuildContext } from './context';
import { basis, bdir, bp, cbox, edgeOf, ep, face, gable, lathe, obox, SIDE, UP, wallQuad } from './kit';
import { door, flatRoof, obbOf, pitchedRoof, punchedWindows, ribbonWindows, ringHipRoof, rooftop, shellWalls, type Obb } from './massing';
import { hash01, mix, shade, type MeshWriter, type RGB } from './mesh';

const rect = (s: Site) => s.rect >= 0.82 && s.ring.length <= 10;

/** Roof over a house-like building; returns the highest point. */
function houseRoof(w: MeshWriter, s: Site, p: Plan, o: Obb, over: number, border: RGB | null = null): number {
  const rise = p.rise;
  if (p.roof === 'flat' || rise <= 0.2) {
    flatRoof(w, s.ring, s.holes, p.wallTop, 0.6, p.wall, shade(mix(p.wall, BC.roofConcrete, 0.6), 0.92));
    return p.wallTop + 0.6;
  }
  if (!rect(s) || s.holes.length) return ringHipRoof(w, s.ring, p.wallTop, rise, Math.min(o.W * 0.3, 3), p.roofC, p.wall);
  if (p.roof === 'kalae') {
    const top = pitchedRoof(w, o, p.wallTop, rise, over, 'gable', p.roofC, p.wall);
    kalae(w, o, top);
    return top;
  }
  return pitchedRoof(w, o, p.wallTop, rise, over, p.roof === 'gable' ? 'gable' : p.roof === 'skillion' ? 'skillion' : 'hip', p.roofC, p.wall, border);
}

/** Crossed V-shaped kalae boards above both gable apexes. */
export function kalae(w: MeshWriter, o: Obb, ridge: number): void {
  for (const su of [-1, 1]) {
    const u = su * (o.L / 2 + 0.5);
    for (const sv of [-1, 1]) {
      // Board rising from the apex outwards and upwards, crossing its twin.
      const p0 = bp(o.b, u, -sv * 0.25, ridge - 0.3);
      const p1 = bp(o.b, u, sv * 0.9, ridge + 1.3);
      const [dx, dy] = bdir(o.b, su, 0);
      const t = 0.14;
      const q0: [number, number, number] = [p0[0], p0[1], p0[2]];
      const q1: [number, number, number] = [p1[0], p1[1], p1[2]];
      const q2: [number, number, number] = [p1[0], p1[1], p1[2] + t * 2];
      const q3: [number, number, number] = [p0[0], p0[1], p0[2] + t * 2];
      face(w, q0, q1, q2, q3, BC.teakDark, BC.teak, [dx, dy, 0]);
      face(w, q1, q0, q3, q2, BC.teakDark, BC.teak, [-dx, -dy, 0]);
    }
  }
}

// ------------------------------------------------------------------ houses

export function house(ctx: BuildContext, s: Site, p: Plan): void {
  const w = ctx.w.buildings;
  const o = obbOf(s.ring, s.b.o[2]);
  shellWalls(w, s.ring, s.holes, p.base, p.wallTop, p.wall, -1, s.shared);
  if (!p.lean) {
    punchedWindows(ctx, s.ring, s.b.id, p.base, p.ground, p.floor, p.levels, {
      frac: 0.3,
      height: 1.35,
      sill: 0.9,
      slot: 6,
      lit: 0.4,
      glass: BC.glassDark,
      grille: hash01(s.b.id, 5) < 0.5 ? BC.grilleWhite : BC.grilleBrown,
      maxPerEdge: 2,
    }, s.front, Math.max(5.5, s.L * 0.8), 0, s.shared);
    if (s.front >= 0 && hash01(s.b.id, 7) < 0.6) {
      const e = edgeOf(s.ring, s.front);
      if (e.len > 3) door(w, e, e.len * (0.3 + hash01(s.b.id, 6) * 0.4), 1.0, p.base, BC.teak);
    }
  }
  houseRoof(w, s, p, o, 0.9);
}

/** Lanna teak house raised on posts, steep gable with kalae. */
export function lannaHouse(ctx: BuildContext, s: Site, p: Plan): void {
  const w = ctx.w.buildings;
  const o = obbOf(s.ring, s.b.o[2]);
  const lift = 2.0;
  const hl = o.L / 2;
  const hw = o.W / 2;
  // Posts under the raised floor and a low brick storeroom at one end.
  const nu = Math.max(2, Math.round(o.L / 3));
  for (let i = 0; i <= nu; i++) {
    for (const v of [-hw + 0.2, hw - 0.2]) cbox(w, o.b, -hl + 0.2 + ((o.L - 0.4) * i) / nu, v, 0.28, 0.28, 0, lift, BC.teakDark, BC.teak, BC.teak, SIDE.SIDES);
  }
  obox(w, o.b, -hl + 0.3, -hl + o.L * 0.35, -hw + 0.3, hw - 0.3, 0, lift, shade(BC.brickOld, 0.85), BC.stucco, BC.stucco, SIDE.SIDES);
  // Floor slab and teak walls.
  obox(w, o.b, -hl, hl, -hw, hw, lift - 0.25, lift, BC.teakDark, BC.teakDark, BC.teakDark, SIDE.SIDES);
  const top = lift + 2.7;
  obox(w, o.b, -hl, hl, -hw, hw, lift, top, shade(BC.teak, 0.85), BC.teak, BC.teak, SIDE.SIDES);
  // Shuttered windows along the long sides.
  const n = Math.max(1, Math.floor(o.L / 3));
  for (let i = 0; i < n; i++) {
    const u = -hl + (o.L * (i + 0.5)) / n;
    for (const sv of [-1, 1]) {
      const [dx, dy] = bdir(o.b, 0, sv);
      const v = sv * (hw + 0.04);
      const lit = hash01(s.b.id * 11 + i * 2 + (sv > 0 ? 1 : 0), 9) < 0.35;
      face(lit ? ctx.w.windows : w, bp(o.b, u - 0.45, v, lift + 0.8), bp(o.b, u + 0.45, v, lift + 0.8), bp(o.b, u + 0.45, v, lift + 2.1), bp(o.b, u - 0.45, v, lift + 2.1), BC.glassNight, BC.interiorDark, [dx, dy, 0]);
    }
  }
  const rise = p.rise;
  gable(w, o.b, -hl, hl, hw, top, top + rise, 1.1, 0.6, p.roofC, BC.teakDark);
  kalae(w, o, top + rise);
}

// ------------------------------------------------------------------ blocks

/** Guesthouse / apartment / house-compound block (2–5 storeys). */
export function block(ctx: BuildContext, s: Site, p: Plan): void {
  const w = ctx.w.buildings;
  const o = obbOf(s.ring, s.b.o[2]);
  shellWalls(w, s.ring, s.holes, p.base, p.wallTop + (p.roof === 'flat' ? p.parapet : 0), p.wall, -1, s.shared);
  if (!p.lean) {
    punchedWindows(ctx, s.ring, s.b.id, p.base, p.ground, p.floor, p.levels, {
      frac: 0.42,
      height: 1.45,
      sill: 0.9,
      slot: 5.5,
      lit: 0.55,
      glass: hash01(s.b.id, 5) < 0.6 ? BC.glassDark : BC.glassTeal,
      grille: hash01(s.b.id, 6) < 0.3 ? BC.grilleWhite : undefined,
      maxPerEdge: 5,
    }, -1, 4.5, 1, s.shared);
    if (s.front >= 0) {
      const e = edgeOf(s.ring, s.front);
      // Glass lobby on the ground floor and balcony bands up the front.
      const a = Math.min(1.5, e.len * 0.15);
      wallQuad(ctx.w.windows, e, a, e.len - a, p.base + 0.05, p.base + p.ground - 0.6, 0.05, BC.interiorWarm, shade(BC.interiorWarm, 1.2));
      if (p.cls === 'block' && hash01(s.b.id, 7) < 0.28) balconyBands(w, e, p, 0.25, BC.slab, hash01(s.b.id, 8) < 0.5 ? BC.grilleWhite : p.wall);
    } else {
      punchedWindows(ctx, s.ring, s.b.id + 1, p.base, p.ground, p.floor, 1, { frac: 0.4, height: 1.6, sill: 0.8, slot: 5, lit: 0.5, glass: BC.glassDark, maxPerEdge: 5 }, -1, 5, 0, s.shared);
    }
  }
  if (p.roof === 'flat') {
    flatRoof(w, s.ring, s.holes, p.wallTop, p.parapet, p.wall, shade(mix(p.wall, BC.roofConcrete, 0.7), 0.92), false);
    if (!p.lean) rooftop(w, s.ring, o, p.wallTop, s.b.id, { tanks: 2, shed: 0.25, antenna: 0.2, dish: 0.15, plants: 0.1, laundry: 0.12 });
  } else {
    houseRoof(w, s, p, o, 0.9);
  }
}

/** Slab-and-rail balcony bands across an edge on every upper floor. */
function balconyBands(w: MeshWriter, e: ReturnType<typeof edgeOf>, p: Plan, inset: number, slab: RGB, rail: RGB, glassRail = false): void {
  const a = inset;
  const b = e.len - inset;
  if (b - a < 1) return;
  const d = 1.2;
  for (let f = 1; f < p.levels; f++) {
    const hf = p.base + p.ground + (f - 1) * p.floor;
    face(w, ep(e, a, 0, hf), ep(e, b, 0, hf), ep(e, b, d, hf), ep(e, a, d, hf), slab, slab, UP);
    wallQuad(w, e, a, b, hf - 0.22, hf, d, shade(slab, 0.82), slab);
    wallQuad(w, e, a, b, hf, hf + 1.05, d, glassRail ? shade(BC.glassTeal, 1.1) : shade(rail, 0.9), glassRail ? BC.glassTeal : rail);
  }
}

/** Condo or mid-rise hotel: glass ribbons, balcony bands, lift box, pool deck. */
export function condo(ctx: BuildContext, s: Site, p: Plan): void {
  const w = ctx.w.buildings;
  const o = obbOf(s.ring, s.b.o[2]);
  const ph = p.parapet || 1.0;
  shellWalls(w, s.ring, s.holes, p.base, p.wallTop + ph, p.wall, -1, s.shared);
  const glass = hash01(s.b.id, 5) < 0.5 ? BC.glassDark : BC.glassBlue;
  ribbonWindows(ctx, s.ring, s.b.id, p.base, p.ground, p.floor, p.levels, Math.min(1.9, p.floor - 0.9), glass, p.cls === 'hotel' ? 0.7 : 0.55, 12, -1, 1, s.shared);
  // Lobby and balcony bands on the longest edge (or the street front).
  let best = s.front;
  if (best < 0) {
    let len = 0;
    for (let i = 0; i < s.ring.length; i++) {
      const e = edgeOf(s.ring, i);
      if (e.len > len) {
        len = e.len;
        best = i;
      }
    }
  }
  const e = edgeOf(s.ring, best);
  wallQuad(ctx.w.windows, e, Math.min(2, e.len * 0.2), e.len - Math.min(2, e.len * 0.2), p.base + 0.05, p.base + p.ground - 0.5, 0.05, BC.interiorWarm, shade(BC.interiorWarm, 1.25));
  if (!p.lean && hash01(s.b.id, 6) < 0.45) balconyBands(w, e, p, 0.6, BC.slab, BC.glassTeal, true);
  flatRoof(w, s.ring, s.holes, p.wallTop, ph, p.wall, shade(BC.roofConcrete, 0.95), false);
  if (p.lean) return;
  // Lift and stair box, and a rooftop pool deck on some.
  if (o.L > 12 && o.W > 9) {
    cbox(w, o.b, -o.L * 0.2, 0, Math.min(6, o.L * 0.25), Math.min(5, o.W * 0.4), p.wallTop, p.wallTop + 3.2, shade(p.wall, 0.9), p.wall, shade(p.wall, 0.95));
    if (hash01(s.b.id, 7) < 0.2) {
      const du = Math.min(12, o.L * 0.35);
      const dv = Math.min(5, o.W * 0.35);
      obox(w, o.b, o.L * 0.08, o.L * 0.08 + du, -dv / 2, dv / 2, p.wallTop, p.wallTop + 0.3, BC.slab, BC.slab, BC.pool);
    } else {
      rooftop(w, s.ring, o, p.wallTop, s.b.id, { tanks: 2, shed: 0, antenna: 0.4, dish: 0.3, plants: 0.2, laundry: 0 });
    }
  }
}

// ------------------------------------------------------------------ institutions

/** School or college: long block with an open corridor balcony, orange hip roof. */
export function school(ctx: BuildContext, s: Site, p: Plan): void {
  const w = ctx.w.buildings;
  const o = obbOf(s.ring, s.b.o[2]);
  shellWalls(w, s.ring, s.holes, p.base, p.wallTop, p.wall, -1, s.shared);
  // Corridor on the longest side: slab, rail and dark doorways every 8 m.
  let best = 0;
  let len = 0;
  for (let i = 0; i < s.ring.length; i++) {
    const e = edgeOf(s.ring, i);
    if (e.len > len) {
      len = e.len;
      best = i;
    }
  }
  const e = edgeOf(s.ring, best);
  if (!p.lean) {
    punchedWindows(ctx, s.ring, s.b.id, p.base, p.ground, p.floor, p.levels, { frac: 0.55, height: 1.5, sill: 0.9, slot: 4.5, lit: 0.25, glass: BC.glassTeal, maxPerEdge: 14 }, best, 3, 0, s.shared);
    for (let f = 0; f < p.levels; f++) {
      const hf = p.base + (f === 0 ? 0 : p.ground + (f - 1) * p.floor);
      const d = 1.8;
      if (f > 0) {
        face(w, ep(e, 0, 0, hf), ep(e, e.len, 0, hf), ep(e, e.len, d, hf), ep(e, 0, d, hf), BC.slab, BC.slab, UP);
        wallQuad(w, e, 0, e.len, hf - 0.25, hf, d, shade(BC.slab, 0.8), BC.slab);
        wallQuad(w, e, 0, e.len, hf, hf + 1.0, d, shade(p.wall, 0.9), p.wall);
      }
      const nd = Math.max(1, Math.floor(e.len / 8));
      for (let j = 0; j < nd; j++) {
        const sc = (e.len * (j + 0.5)) / nd;
        wallQuad(w, e, sc - 0.5, sc + 0.5, hf + 0.02, hf + 2.3, 0.04, BC.teakDark, BC.teak);
      }
    }
  }
  houseRoof(w, s, p, o, 1.0, BC.tileBrick);
}

/** Hospital: white block with teal glass ribbons and a flat roof. */
export function hospital(ctx: BuildContext, s: Site, p: Plan): void {
  const w = ctx.w.buildings;
  const o = obbOf(s.ring, s.b.o[2]);
  const ph = p.parapet || 1.0;
  shellWalls(w, s.ring, s.holes, p.base, p.wallTop + ph, p.wall, -1, s.shared);
  ribbonWindows(ctx, s.ring, s.b.id, p.base, p.ground, p.floor, p.levels, 1.4, BC.glassTeal, 0.6, 8, -1, 0, s.shared);
  flatRoof(w, s.ring, s.holes, p.wallTop, ph, p.wall, BC.roofConcrete, false);
  if (!p.lean) rooftop(w, s.ring, o, p.wallTop, s.b.id, { tanks: 2, shed: 0.6, antenna: 0.5, dish: 0.3, plants: 0, laundry: 0 });
}

// ------------------------------------------------------------------ commerce

/** Mall or big box: tall floors, glass entrance, lit fascia, rooftop air-handling units. */
export function mall(ctx: BuildContext, s: Site, p: Plan): void {
  const w = ctx.w.buildings;
  const o = obbOf(s.ring, s.b.o[2]);
  const ph = p.parapet || 1.0;
  shellWalls(w, s.ring, s.holes, p.base, p.wallTop + ph, p.wall, -1, s.shared);
  ribbonWindows(ctx, s.ring, s.b.id, p.base, p.ground, p.floor, p.levels, 1.2, BC.glassBlue, 0.5, 14, s.front, 1, s.shared);
  if (s.front >= 0) {
    const e = edgeOf(s.ring, s.front);
    const a = e.len * 0.2;
    const b = e.len * 0.8;
    wallQuad(ctx.w.windows, e, a, b, p.base + 0.05, p.base + p.ground * 0.85, 0.06, BC.interiorWarm, shade(BC.glare, 0.9));
    const fascia = [BC.lanternRed, BC.mosaicBlue, BC.gold, BC.borderGreen][Math.floor(hash01(s.b.id, 5) * 4)];
    wallQuad(ctx.w.glow, e, a, b, p.base + p.ground * 0.9, p.base + p.ground * 0.9 + 1.2, 0.1, fascia, fascia);
  }
  flatRoof(w, s.ring, s.holes, p.wallTop, ph, p.wall, BC.roofConcrete, false);
  if (p.lean) return;
  // Rooftop air-handling units.
  const n = Math.min(10, Math.floor((o.L * o.W) / 400));
  for (let i = 0; i < n; i++) {
    const u = (hash01(s.b.id + i, 6) - 0.5) * o.L * 0.7;
    const v = (hash01(s.b.id + i, 7) - 0.5) * o.W * 0.7;
    const [x, y] = [o.b.ox + o.b.ux * u - o.b.uy * v, o.b.oy + o.b.uy * u + o.b.ux * v];
    if (!inRing(x, y, s)) continue;
    cbox(w, o.b, u, v, 3, 2, p.wallTop, p.wallTop + 1.6, BC.concreteDark, BC.tankSteel, BC.tankSteel);
  }
}

function inRing(x: number, y: number, s: Site): boolean {
  let inside = false;
  const r = s.ring;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Open roof on posts: market halls get a big metal gable with a raised
 * clerestory and stall counters underneath; small canopies are four posts
 * and a light roof.
 */
export function canopy(ctx: BuildContext, s: Site, p: Plan, market: boolean): void {
  const w = ctx.w.buildings;
  const o = obbOf(s.ring, s.b.o[2]);
  const big = market || s.area > 300;
  // Heights stay under the plan's cap (Old City and near temples).
  const h = Math.min(big ? 5.5 : 3.0, p.cap - 1.0);
  const hl = o.L / 2;
  const hw = o.W / 2;
  const step = big ? 8 : Math.max(2.5, o.L / 2);
  const nu = Math.max(1, Math.round(o.L / step));
  const nv = big ? Math.max(1, Math.round(o.W / 8)) : 1;
  const post = big ? 0.3 : 0.16;
  // Irregular footprints get a roof that follows the ring, so the posts follow it too.
  const ringRoof = !rect(s) && s.ring.length > 10;
  if (ringRoof) ringPosts(w, s.ring, step, post, h);
  else {
    for (let i = 0; i <= nu; i++) {
      const u = -hl + 0.3 + ((o.L - 0.6) * i) / nu;
      for (let j = 0; j <= nv; j++) {
        if (j > 0 && j < nv && i > 0 && i < nu) continue;
        const v = -hw + 0.3 + ((o.W - 0.6) * j) / nv;
        cbox(w, o.b, u, v, post, post, 0, h, BC.steelDark, BC.concreteDark, BC.concreteDark, SIDE.SIDES);
      }
    }
  }
  const roofC = p.roofC;
  if (ringRoof) {
    // Irregular roofs: a shallow hipped cover over the footprint.
    ringHipRoof(w, s.ring, h, Math.min(2.5, o.W * 0.15, p.cap - h), Math.min(o.W * 0.25, 4), roofC, BC.concreteDark);
  } else {
    const rise = Math.min(big ? 4 : 1.2, o.W * (big ? 0.2 : 0.15), p.cap - h);
    gable(w, o.b, -hl, hl, hw, h, h + rise, 0.6, 0.4, roofC, null);
    if (big && o.W > 10 && h + rise + 1.4 <= p.cap) {
      // Raised clerestory over the ridge with a dark vent band.
      const cw = o.W * 0.18;
      const lift = 1.1;
      const hc = h + rise * (1 - cw / hw);
      for (const sv of [-1, 1]) {
        const [dx, dy] = bdir(o.b, 0, sv);
        face(w, bp(o.b, -hl * 0.9, sv * cw, hc), bp(o.b, hl * 0.9, sv * cw, hc), bp(o.b, hl * 0.9, sv * cw, hc + lift), bp(o.b, -hl * 0.9, sv * cw, hc + lift), BC.steelDark, BC.steelDark, [dx, dy, 0]);
      }
      gable(w, o.b, -hl * 0.9, hl * 0.9, cw, hc + lift, h + rise + lift + 0.3, 0.5, 0.2, shade(roofC, 1.05), BC.steelDark);
    }
  }
  if (big && !p.lean) {
    // Stall counters and a few coloured stall roofs under the hall.
    const n = Math.min(6, Math.floor((o.L * o.W) / 120));
    for (let i = 0; i < n; i++) {
      const u = (hash01(s.b.id + i, 11) - 0.5) * (o.L - 4);
      const v = (hash01(s.b.id + i, 12) - 0.5) * (o.W - 4);
      const c = [BC.stoolRed, BC.mosaicBlue, BC.gold, BC.grilleWhite, BC.borderGreen][Math.floor(hash01(s.b.id + i, 13) * 5)];
      const ang = hash01(s.b.id + i, 14) < 0.5 ? 0 : Math.PI / 2;
      const sb = basis(o.b.ox + o.b.ux * u - o.b.uy * v, o.b.oy + o.b.uy * u + o.b.ux * v, Math.atan2(o.b.uy, o.b.ux) + ang);
      cbox(w, sb, 0, 0, 2.2, 1.0, 0, 0.9, BC.teak, shade(BC.teak, 1.1), c);
    }
  }
}

/** Posts round a counter-clockwise ring, about `step` m apart and set 0.3 m in from its edges and corners, skipping any closer than 40% of a step to the last. */
function ringPosts(w: MeshWriter, ring: [number, number][], step: number, post: number, h: number): void {
  let lx = Infinity;
  let ly = Infinity;
  const first = ring.length > 1 ? inset(ring[0], ring[1], 0.3) : null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.01) continue;
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      const [x, y, ang] = inset(a, b, Math.min(0.3, len / 2) + (k / n) * len);
      if (Math.hypot(x - lx, y - ly) < step * 0.4) continue;
      // The last post of the loop also keeps clear of the first.
      if (i === ring.length - 1 && k > 0 && first && Math.hypot(x - first[0], y - first[1]) < step * 0.4) continue;
      cbox(w, basis(x, y, ang), 0, 0, post, post, 0, h, BC.steelDark, BC.concreteDark, BC.concreteDark, SIDE.SIDES);
      lx = x;
      ly = y;
    }
  }
}

/** Point `t` m along edge a→b, 0.3 m to its left (inside a counter-clockwise ring), and the edge's angle. */
function inset(a: [number, number], b: [number, number], t: number): [number, number, number] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const dx = (b[0] - a[0]) / len;
  const dy = (b[1] - a[1]) / len;
  return [a[0] + dx * t - dy * 0.3, a[1] + dy * t + dx * 0.3, Math.atan2(dy, dx)];
}

/** Kiosk or roadside shed: a small box with a tin skillion. */
export function kiosk(ctx: BuildContext, s: Site, p: Plan): void {
  const w = ctx.w.buildings;
  const o = obbOf(s.ring, s.b.o[2]);
  shellWalls(w, s.ring, s.holes, p.base, p.wallTop, p.wall, -1, s.shared);
  if (s.front >= 0 && !p.lean) {
    const e = edgeOf(s.ring, s.front);
    if (e.len > 1.6) wallQuad(ctx.w.windows, e, 0.3, e.len - 0.3, p.base + 0.8, p.wallTop - 0.4, 0.05, BC.interiorWarm, shade(BC.interiorWarm, 1.2));
  }
  if (rect(s)) pitchedRoof(w, o, p.wallTop, p.rise, 0.4, 'skillion', p.roofC, p.wall);
  else w.polygon(s.ring, undefined, p.wallTop, p.roofC);
}

/** Warehouse / workshop / hangar: tall corrugated walls, metal gable, big door. */
export function shed(ctx: BuildContext, s: Site, p: Plan, hangar: boolean): void {
  const w = ctx.w.buildings;
  const o = obbOf(s.ring, s.b.o[2]);
  shellWalls(w, s.ring, s.holes, p.base, p.wallTop, p.wall, -1, s.shared);
  if (s.front >= 0) {
    const e = edgeOf(s.ring, s.front);
    const dw = Math.min(e.len * (hangar ? 0.8 : 0.35), hangar ? 60 : 6);
    wallQuad(w, e, (e.len - dw) / 2, (e.len + dw) / 2, p.base, p.base + Math.min(p.wallTop - p.base - 0.8, hangar ? 12 : 4.5), 0.05, BC.steelDark, shade(BC.steelDark, 1.2));
  }
  if (!rect(s)) {
    flatRoof(w, s.ring, s.holes, p.wallTop, 0.3, p.wall, p.roofC);
    return;
  }
  if (hangar) {
    // Barrel roof in four facets.
    const hl = o.L / 2;
    const hw = o.W / 2;
    const rise = o.W * 0.18;
    const k = 4;
    let pv = -hw - 0.3;
    let ph = p.wallTop;
    for (let i = 1; i <= k; i++) {
      const t = i / k;
      const a = Math.PI * t;
      const v = -Math.cos(a) * (hw + 0.3);
      const hh = p.wallTop + Math.sin(a) * rise;
      face(w, bp(o.b, -hl, pv, ph), bp(o.b, hl, pv, ph), bp(o.b, hl, v, hh), bp(o.b, -hl, v, hh), p.roofC, shade(p.roofC, 1.05), UP);
      pv = v;
      ph = hh;
    }
    w.polygon(s.ring, undefined, p.wallTop, p.wall);
    return;
  }
  pitchedRoof(w, o, p.wallTop, p.rise, 0.4, 'gable', p.roofC, p.wall);
}

// ------------------------------------------------------------------ worship

/** Church: white nave with a steep roof and a steeple at the street end. */
export function church(ctx: BuildContext, s: Site, p: Plan): void {
  const w = ctx.w.buildings;
  const o = obbOf(s.ring, s.b.o[2]);
  shellWalls(w, s.ring, s.holes, p.base, p.wallTop, p.wall, -1, s.shared);
  punchedWindows(ctx, s.ring, s.b.id, p.base, p.wallTop - p.base, p.floor, 1, { frac: 0.3, height: 2.6, sill: 1.4, slot: 3.5, lit: 0.5, glass: BC.mosaicBlue, maxPerEdge: 10 });
  const ridge = pitchedRoof(w, o, p.wallTop, p.rise, 0.5, 'gable', p.roofC, p.wall);
  // Steeple at the end nearest the street front.
  let su = 1;
  if (s.front >= 0) {
    const e = edgeOf(s.ring, s.front);
    const mx = e.ax + e.tx * e.len * 0.5 - o.b.ox;
    const my = e.ay + e.ty * e.len * 0.5 - o.b.oy;
    su = mx * o.b.ux + my * o.b.uy >= 0 ? 1 : -1;
  }
  const u = su * (o.L / 2 - 1.8);
  const tw = Math.min(3.6, o.W * 0.4);
  const tt = ridge + 3;
  cbox(w, o.b, u, 0, tw, tw, 0, tt, shade(p.wall, 0.85), p.wall, p.wall);
  const [x, y] = bp(o.b, u, 0, 0);
  lathe(w, x, y, [
    [tw * 0.72, tt],
    [0, tt + tw * 2.2],
  ], 4, [p.roofC, shade(p.roofC, 1.1)], Math.atan2(o.b.uy, o.b.ux) + Math.PI / 4);
  const cb = basis(x, y, Math.atan2(o.b.uy, o.b.ux));
  cbox(w, cb, 0, 0, 0.12, 0.12, tt + tw * 2.2 - 0.2, tt + tw * 2.2 + 1.6, BC.goldDark);
  cbox(w, cb, 0, 0, 0.12, 0.9, tt + tw * 2.2 + 0.9, tt + tw * 2.2 + 1.05, BC.goldDark);
}

/** Mosque: white hall, green dome and a slender minaret. */
export function mosque(ctx: BuildContext, s: Site, p: Plan): void {
  const w = ctx.w.buildings;
  const o = obbOf(s.ring, s.b.o[2]);
  shellWalls(w, s.ring, s.holes, p.base, p.wallTop, p.wall, -1, s.shared);
  punchedWindows(ctx, s.ring, s.b.id, p.base, p.wallTop - p.base, p.floor, 1, { frac: 0.35, height: 2.2, sill: 1.2, slot: 3, lit: 0.5, glass: BC.glassTeal, maxPerEdge: 10 });
  flatRoof(w, s.ring, s.holes, p.wallTop, 0.8, p.wall, shade(p.wall, 0.95));
  const r = Math.min(o.W, o.L) * 0.3;
  const green = BC.tileGreen;
  const prof: [number, number][] = [];
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    prof.push([r * Math.cos(a), p.wallTop + 1.2 + r * Math.sin(a) * 1.15]);
  }
  obox(w, o.b, -r, r, -r, r, p.wallTop, p.wallTop + 1.2, p.wall, p.wall, p.wall, SIDE.SIDES);
  lathe(w, o.b.ox, o.b.oy, [[r, p.wallTop + 1.2], ...prof.slice(1)], 10, [green, shade(green, 1.1)]);
  const [mx, my] = bp(o.b, o.L / 2 - 1.2, o.W / 2 - 1.2, 0);
  lathe(w, mx, my, [
    [1.0, 0],
    [0.8, p.wallTop + 10],
    [1.1, p.wallTop + 10],
    [0.8, p.wallTop + 11],
    [0.8, p.wallTop + 11.5],
    [0, p.wallTop + 13],
  ], 8, [p.wall, p.wall, p.wall, p.wall, green, green]);
}

/** Chinese shrine: red walls, green-tile roof with upswept ridge ends, lanterns. */
export function chineseShrine(ctx: BuildContext, s: Site, p: Plan): void {
  const w = ctx.w.buildings;
  const o = obbOf(s.ring, s.b.o[2]);
  const red = BC.lacquerRed;
  shellWalls(w, s.ring, s.holes, p.base, p.wallTop, red, -1, s.shared);
  const ridge = rect(s) ? pitchedRoof(w, o, p.wallTop, p.rise, 0.8, 'gable', BC.tileGreen, red, BC.gold) : ringHipRoof(w, s.ring, p.wallTop, p.rise, Math.min(o.W * 0.3, 3), BC.tileGreen, red);
  if (rect(s)) {
    // Ridge beam with upswept gold ends.
    obox(w, o.b, -o.L / 2 - 0.3, o.L / 2 + 0.3, -0.2, 0.2, ridge - 0.1, ridge + 0.35, BC.tileGreen, BC.tileGreen, BC.gold);
    for (const su of [-1, 1]) cbox(w, o.b, su * (o.L / 2 + 0.3), 0, 0.5, 0.4, ridge, ridge + 1.0, BC.gold, BC.goldLit);
  }
  // Red lanterns at the entrance.
  if (s.front >= 0) {
    const e = edgeOf(s.ring, s.front);
    for (const t of [0.3, 0.7]) {
      const [x, y] = ep(e, e.len * t, 0.9, 0);
      lathe(ctx.w.glow, x, y, [
        [0.2, p.wallTop - 1.4],
        [0.35, p.wallTop - 1.1],
        [0.2, p.wallTop - 0.8],
      ], 6, [BC.lanternRed, BC.lanternRed, BC.lanternRed]);
    }
  }
}
