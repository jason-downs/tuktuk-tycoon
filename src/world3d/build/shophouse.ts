// Shophouse rows (docs/3d/world.md §1.2, §2.4): the street front is split into
// 3.5–4.8 m bays. Each bay gets a ground floor (roll-up shutter, open lit shop,
// grille, café glass or convenience-store glare), a sign band in its own
// colour with script-like stripes, an awning, upper-floor windows (lit panes in
// the windows layer), sunshades, balconies, AC units, plants and laundry. The
// roof is flat with a parapet and rooftop clutter, or low-pitched tin. Wooden
// rows (Tha Phae, Chinatown, Wat Ket) have teak upper floors with shutters and
// a low gable parallel to the street; Nimman rows are glassy boutiques.

import type { Plan, Site } from './site';
import { AWNINGS, BC, NEON, SIGN_COLOURS, SIGN_INK } from './buildingPalette';
import type { BuildContext } from './context';
import { edgeBasis, edgeOf, ep, face, gable, lathe, obox, SIDE, UP, wallQuad, type Basis, type Edge } from './kit';
import { flatRoof, obbOf, pitchedRoof, rooftop, shellWalls } from './massing';
import { hash01, mix, pickWeighted, shade, type MeshWriter, type RGB } from './mesh';
import { WALLS } from './palette';

export const BAY_MIN = 3.5;
export const BAY_MAX = 4.8;

/** Bay count, width and the leftover end strip for a street front of F metres. */
export function bayLayout(F: number): { n: number; bw: number; start: number } {
  const nMin = Math.ceil(F / BAY_MAX - 1e-9);
  const nMax = Math.floor(F / BAY_MIN + 1e-9);
  let n = Math.max(1, Math.round(F / 4));
  if (nMin <= nMax) n = Math.min(nMax, Math.max(nMin, n));
  else n = Math.max(1, nMax);
  const bw = Math.min(BAY_MAX, F / n);
  return { n, bw, start: (F - n * bw) / 2 };
}

/** Ground-floor uses that change a bay's look. */
export type BayUse = 'shop' | 'home' | 'cafe' | 'restaurant' | 'bar' | 'massage' | 'convenience' | 'hostel' | 'office' | 'moto';

export type RowStyle = 'concrete' | 'wooden' | 'modern';

export interface RowInfo {
  style: RowStyle;
  /** Use per bay (length = bay count). */
  uses: BayUse[];
  /** Share of signs lit at night (glow layer). */
  litSigns: number;
  /** Neon for bars on this street. */
  neon: boolean;
  /** Simplified detail outside the playable area. */
  lean: boolean;
  /** Red lanterns under the signs (Chinatown). */
  lanterns: boolean;
}

interface UpperStyle {
  frac: number;
  height: number;
  twin: boolean;
  ledge: boolean;
  grille: RGB | null;
  glass: RGB;
  balcony: number;
  ac: number;
}

function upperStyle(id: number, style: RowStyle, hostel: boolean): UpperStyle {
  const u = (k: number) => hash01(id, 300 + k);
  if (style === 'modern') {
    return { frac: 0.78, height: 2.1, twin: false, ledge: false, grille: null, glass: u(1) < 0.5 ? BC.glassDark : BC.glassBlue, balcony: 0.2, ac: 0.15 };
  }
  if (style === 'wooden') {
    return { frac: 0.5, height: 1.6, twin: u(2) < 0.5, ledge: false, grille: null, glass: BC.glassNight, balcony: 0.1, ac: 0.1 };
  }
  const g = u(3);
  return {
    frac: 0.45 + u(4) * 0.27,
    height: 1.3 + u(5) * 0.45,
    twin: u(6) < 0.1,
    ledge: u(7) < 0.35,
    grille: g < 0.2 ? BC.grilleWhite : g < 0.32 ? BC.grilleGreen : g < 0.4 ? BC.grilleBrown : null,
    glass: u(8) < 0.6 ? BC.glassDark : BC.glassTeal,
    balcony: hostel ? 0.6 : 0.13,
    ac: 0.2,
  };
}

/** Build one shophouse row on its street-front edge. */
export function shophouse(ctx: BuildContext, s: Site, p: Plan, row: RowInfo): void {
  const w = ctx.w.buildings;
  const ring = s.ring;
  const e = edgeOf(ring, s.front);
  const { n, bw, start } = bayLayout(e.len);
  const id = s.b.id;
  const base = p.base;
  const top = p.wallTop;
  const wooden = row.style === 'wooden';
  // Flat roofs: walls rise through the parapet.
  const crest = p.roof === 'flat' && !wooden ? top + p.parapet : top;

  shellWalls(w, ring, s.holes, base, crest, p.wall, s.front, s.shared);

  // End strips beside the bays.
  const foot = shade(p.wall, 0.8);
  const crown = shade(p.wall, 1.03);
  if (start > 0.01) {
    wallQuad(w, e, 0, start, base, crest, 0, foot, crown);
    wallQuad(w, e, start + n * bw, e.len, base, crest, 0, foot, crown);
  }

  // Bay facades, merged into one quad per run of bays sharing a colour; 30% of bays are repainted.
  const colourOf = (k: number): RGB => (!wooden && hash01(id * 37 + k, 1) < 0.3 ? pickWeighted(WALLS, hash01(id * 37 + k, 2)) : p.wall);
  let runStart = 0;
  for (let k = 1; k <= n; k++) {
    if (k < n && colourOf(k) === colourOf(runStart)) continue;
    const s0 = start + runStart * bw;
    const s1 = start + k * bw;
    const wall = colourOf(runStart);
    if (wooden) {
      // Stucco or teak ground floor under a teak upper floor.
      const gTop = base + p.ground;
      const lower = hash01(id, 3) < 0.5 ? p.wall : BC.teak;
      wallQuad(w, e, s0, s1, base, gTop, 0, shade(lower, 0.8), lower);
      wallQuad(w, e, s0, s1, gTop, crest, 0, shade(BC.teak, 0.92), shade(BC.teak, 1.05));
    } else {
      wallQuad(w, e, s0, s1, base, crest, 0, shade(wall, 0.8), shade(wall, 1.03));
    }
    runStart = k;
  }

  const hostel = row.uses.some((u) => u === 'hostel');
  const up = upperStyle(id, row.style, hostel);
  const eb = edgeBasis(e);
  for (let k = 0; k < n; k++) {
    const s0 = start + k * bw;
    const s1 = s0 + bw;
    const key = id * 37 + k;
    groundFloor(ctx, e, eb, s0, s1, base, p.ground, row.uses[k] ?? 'shop', key, row);
    upperFloors(ctx, e, eb, s0, s1, base, p, up, key, row);
  }

  // Roof.
  const o = obbOf(ring, s.b.o[2]);
  if (wooden) {
    woodenRoof(w, s, p, e);
    return;
  }
  if (p.roof === 'flat') {
    const deck = shade(mix(p.wall, BC.roofConcrete, 0.7), 0.92);
    flatRoof(w, ring, s.holes, top, p.parapet, p.wall, deck, false);
    if (!row.lean) {
      rooftop(w, ring, o, top, id, {
        tanks: 1 + Math.floor((n - 1) / 4),
        shed: 0.2,
        antenna: 0.15,
        dish: 0.08,
        plants: row.style === 'modern' ? 0.5 : 0.1,
        laundry: 0.08,
      });
    }
  } else {
    pitchedRoof(w, o, top, p.rise, 0.4, p.roof === 'skillion' ? 'skillion' : 'gable', p.roofC, p.wall);
  }
}

/** Low tin or tile gable parallel to the street, overhanging the front. */
function woodenRoof(w: MeshWriter, s: Site, p: Plan, e: Edge): void {
  // Depth of the footprint behind the front edge.
  let depth = 0;
  for (const [x, y] of s.ring) depth = Math.max(depth, -((x - e.ax) * e.nx + (y - e.ay) * e.ny));
  depth = Math.max(4, depth);
  w.polygon(s.ring, undefined, p.wallTop, shade(p.wall, 0.8));
  const b: Basis = { ox: e.ax - e.nx * (depth / 2), oy: e.ay - e.ny * (depth / 2), ux: e.tx, uy: e.ty };
  gable(w, b, 0, e.len, depth / 2, p.wallTop, p.wallTop + p.rise, 0.8, 0.15, p.roofC, BC.teak);
}

function groundFloor(ctx: BuildContext, e: Edge, eb: Basis, s0: number, s1: number, base: number, g: number, use: string, key: number, row: RowInfo): void {
  const w = ctx.w.buildings;
  const pier = 0.22;
  const o0 = s0 + pier;
  const o1 = s1 - pier;
  const openTop = base + Math.max(2.4, g - 1.0);
  const wooden = row.style === 'wooden';
  const u = (k: number) => hash01(key, 10 + k);

  // Opening.
  switch (use) {
    case 'convenience': {
      // White glare behind glass with a teal-and-yellow fascia (unbranded).
      wallQuad(ctx.w.glow, e, o0, o1, base, openTop, 0.05, shade(BC.glare, 0.85), BC.glare);
      wallQuad(ctx.w.glow, e, s0 + 0.05, s1 - 0.05, openTop + 0.1, base + g - 0.45, 0.08, BC.mosaicTeal, BC.mosaicTeal);
      wallQuad(ctx.w.glow, e, s0 + 0.05, s1 - 0.05, base + g - 0.45, base + g - 0.2, 0.08, hexY, hexY);
      return;
    }
    case 'cafe':
    case 'office': {
      // Floor-to-ceiling glass, lit inside; slim dark frame.
      wallQuad(w, e, o0 - 0.08, o1 + 0.08, base, openTop + 0.15, 0.04, BC.steelDark, BC.steelDark);
      wallQuad(ctx.w.windows, e, o0, o1, base + 0.05, openTop, 0.06, BC.interiorWarm, shade(BC.interiorWarm, 1.2));
      if (use === 'cafe' && !row.lean) planters(w, eb, o0, o1, base, key);
      break;
    }
    case 'home': {
      // Closed folding grille or shutter; a potted plant by the door.
      const c = u(1) < 0.4 ? BC.shutterMint : u(1) < 0.7 ? BC.grilleWhite : BC.shutterGrey;
      wallQuad(w, e, o0, o1, base, openTop, 0.05, shade(c, 0.75), c);
      if (!row.lean && u(2) < 0.3) planters(w, eb, o0, o0 + 0.9, base, key);
      break;
    }
    default: {
      const open = use === 'bar' || use === 'restaurant' || use === 'massage' || use === 'hostel' || u(3) < 0.7;
      if (open) {
        // Lit interior, cool fluorescent or warm, darker towards the floor.
        const inside = use === 'moto' ? BC.interiorDark : u(4) < 0.5 ? BC.interiorCool : BC.interiorWarm;
        wallQuad(ctx.w.windows, e, o0, o1, base, openTop, 0.05, shade(inside, 0.75), shade(inside, 1.15));
      } else if (wooden) {
        // Folding teak doors.
        wallQuad(w, e, o0, o1, base, openTop, 0.05, shade(BC.teak, 0.8), BC.teak);
        const mid = (o0 + o1) / 2;
        wallQuad(w, e, mid - 0.04, mid + 0.04, base, openTop, 0.08, BC.teakDark, BC.teakDark);
      } else {
        // Roll-up shutter: steel shading lighter towards the drum at the top.
        const sh = u(5) < 0.3 ? BC.shutterBlue : BC.shutterGrey;
        wallQuad(w, e, o0, o1, base, openTop, 0.05, shade(sh, 0.72), shade(sh, 1.12));
      }
    }
  }

  // Sign band.
  const sTop = base + g - 0.2;
  const sBot = base + g - 0.95;
  if (!wooden || u(6) < 0.6) {
    const sc = use === 'bar' ? NEON[Math.floor(u(7) * NEON.length)] : SIGN_COLOURS[Math.floor(u(7) * SIGN_COLOURS.length)];
    const lit = use === 'bar' || use === 'massage' ? true : u(8) < row.litSigns;
    const signW = lit ? ctx.w.glow : w;
    const signC = use === 'bar' && lit ? shade(sc, 0.9) : sc;
    wallQuad(signW, e, s0 + 0.08, s1 - 0.08, sBot, sTop, 0.07, signC, shade(signC, 1.05));
    if (!row.lean) {
      // A script-like stripe of "lettering" on most signs.
      const ink = SIGN_INK[Math.floor(u(9) * SIGN_INK.length)];
      const inkC = ink === signC ? SIGN_INK[(Math.floor(u(9) * SIGN_INK.length) + 1) % SIGN_INK.length] : ink;
      const a = s0 + 0.25 + u(10) * 0.4;
      const b = s1 - 0.25 - u(11) * 0.6;
      if (b - a > 0.6 && u(12) < 0.38) wallQuad(w, e, a, b, sBot + 0.2, sBot + 0.52, 0.1, inkC, inkC);
    }
    if (use === 'bar' && row.neon && !row.lean) {
      // Vertical neon blade sign.
      const nc = NEON[Math.floor(u(13) * NEON.length)];
      const bx = u(14) < 0.5 ? s0 + 0.4 : s1 - 0.4;
      obox(ctx.w.glow, eb, bx - 0.06, bx + 0.06, -1.1, -0.1, sTop + 0.2, sTop + 2.4, nc, nc, nc, SIDE.V0 | SIDE.U0 | SIDE.U1 | SIDE.TOP);
    }
  }

  // Pairs of red lanterns hung in front of the sign.
  if (row.lanterns && !row.lean && u(20) < 0.45) {
    for (const t of [0.28, 0.72]) {
      const [x, y] = ep(e, s0 + (s1 - s0) * t, 0.45, 0);
      lathe(ctx.w.glow, x, y, [
        [0.14, sBot - 0.75],
        [0.26, sBot - 0.55],
        [0.14, sBot - 0.3],
      ], 6, [BC.lanternRed, BC.lanternRed, BC.lanternRed]);
    }
  }

  // Awning below the sign.
  const awnP = use === 'home' ? 0.1 : use === 'convenience' ? 0 : 0.33;
  if (!row.lean && u(15) < awnP) {
    const depth = 1.3 + u(16) * 0.9;
    const drop = 0.4 + u(17) * 0.25;
    const h0 = openTop + 0.02;
    const h1 = h0 - drop;
    const c = pickWeighted(AWNINGS, u(18));
    const striped = u(19) < 0.15 && c[0] + c[1] + c[2] < 600;
    const a0 = s0 + 0.05;
    const a1 = s1 - 0.05;
    if (striped) {
      const k = 4;
      for (let j = 0; j < k; j++) {
        const t0 = a0 + ((a1 - a0) * j) / k;
        const t1 = a0 + ((a1 - a0) * (j + 1)) / k;
        const cc = j % 2 ? BC.grilleWhite : c;
        face(w, ep(e, t0, 0, h0), ep(e, t1, 0, h0), ep(e, t1, depth, h1), ep(e, t0, depth, h1), shade(cc, 0.95), cc, UP);
      }
    } else {
      face(w, ep(e, a0, 0, h0), ep(e, a1, 0, h0), ep(e, a1, depth, h1), ep(e, a0, depth, h1), shade(c, 0.95), c, UP);
    }
    wallQuad(w, e, a0, a1, h1 - 0.25, h1, depth, shade(c, 0.85), c);
  }
}

const hexY: RGB = [240, 195, 48];

function planters(w: MeshWriter, eb: Basis, s0: number, s1: number, base: number, key: number): void {
  const n = Math.max(1, Math.min(3, Math.floor((s1 - s0) / 1.1)));
  for (let j = 0; j < n; j++) {
    const u = s0 + ((s1 - s0) * (j + 0.5)) / n;
    obox(w, eb, u - 0.25, u + 0.25, -0.7, -0.2, base, base + 0.45, BC.pot, BC.pot, BC.pot, SIDE.V0 | SIDE.U0 | SIDE.U1);
    obox(w, eb, u - 0.35, u + 0.35, -0.8, -0.1, base + 0.45, base + 0.45 + 0.5 + hash01(key + j, 20) * 0.6, BC.plant, BC.plantLight);
  }
}

function upperFloors(ctx: BuildContext, e: Edge, eb: Basis, s0: number, s1: number, base: number, p: Plan, up: UpperStyle, key: number, row: RowInfo): void {
  const w = ctx.w.buildings;
  const bw = s1 - s0;
  const sc = (s0 + s1) / 2;
  const u = (k: number) => hash01(key, 40 + k);
  const wooden = row.style === 'wooden';
  const balconyBay = !row.lean && u(1) < up.balcony;
  for (let f = 1; f < p.levels; f++) {
    const hf = base + p.ground + (f - 1) * p.floor;
    const fu = (k: number) => hash01(key * 7 + f, 60 + k);
    const ww = bw * up.frac;
    const sill = hf + (row.style === 'modern' ? 0.35 : 0.85);
    const wTop = Math.min(hf + p.floor - 0.35, sill + up.height);
    const balcony = balconyBay && (f === 1 || fu(1) < 0.5);
    const panes: [number, number][] = up.twin && bw > 4.1 ? [[sc - bw * 0.22 - ww / 4, sc - bw * 0.22 + ww / 4], [sc + bw * 0.22 - ww / 4, sc + bw * 0.22 + ww / 4]] : [[sc - ww / 2, sc + ww / 2]];
    for (let j = 0; j < panes.length; j++) {
      const [a, b] = panes[j];
      const h0 = balcony && j === 0 ? hf + 0.05 : sill;
      const lit = fu(2 + j) < (row.style === 'modern' ? 0.65 : 0.55);
      let glass = up.glass;
      if (up.grille && fu(4) < 0.7) glass = mix(glass, up.grille, 0.4);
      wallQuad(lit ? ctx.w.windows : w, e, a, b, h0, wTop, 0.05, shade(glass, 0.9), shade(glass, 1.12));
      if (wooden) {
        // Folding teak shutters opened either side.
        const sh = fu(6) < 0.5 ? BC.shutterTeal : BC.shutterGreen;
        const sw = Math.min(0.45, (b - a) / 2);
        wallQuad(w, e, a - sw, a, h0, wTop, 0.07, shade(sh, 0.85), sh);
        wallQuad(w, e, b, b + sw, h0, wTop, 0.07, shade(sh, 0.85), sh);
      }
    }
    if (row.lean) continue;
    if (up.ledge && !balcony) {
      // Concrete sunshade over the window.
      const lh = wTop + 0.12;
      const a = sc - ww / 2 - 0.2;
      const b = sc + ww / 2 + 0.2;
      face(w, ep(e, a, 0, lh), ep(e, b, 0, lh), ep(e, b, 0.5, lh - 0.06), ep(e, a, 0.5, lh - 0.06), BC.slab, BC.slab, UP);
    }
    if (balcony) {
      const a = s0 + 0.12;
      const b = s1 - 0.12;
      const d = 0.95;
      face(w, ep(e, a, 0, hf), ep(e, b, 0, hf), ep(e, b, d, hf), ep(e, a, d, hf), BC.slab, BC.slab, UP);
      wallQuad(w, e, a, b, hf - 0.18, hf, d, shade(BC.slab, 0.8), BC.slab);
      const rail = up.grille ?? (fu(7) < 0.5 ? BC.grilleWhite : p.wall);
      wallQuad(w, e, a, b, hf, hf + 1.0, d, shade(rail, 0.85), rail);
      if (fu(8) < 0.3) {
        // Laundry hung over the rail.
        for (let j = 0; j < 3; j++) {
          const c = BC.laundry[Math.floor(fu(9 + j) * BC.laundry.length)];
          const t = a + 0.3 + j * ((b - a - 0.6) / 3);
          wallQuad(w, e, t, t + 0.5, hf + 0.35, hf + 1.0, d + 0.03, shade(c, 0.9), c);
        }
      } else if (fu(12) < 0.35) {
        obox(w, eb, a + 0.2, a + 0.8, -d + 0.05, -d + 0.55, hf, hf + 0.9, BC.plant, BC.plantLight);
      }
    }
    if (fu(13) < up.ac) {
      // Wall-hung AC unit beside the window.
      const left = fu(14) < 0.5;
      let a = left ? sc - ww / 2 - 0.95 : sc + ww / 2 + 0.15;
      if (a < s0 + 0.1) a = sc + ww / 2 + 0.15;
      if (a + 0.8 > s1 - 0.1) a = s0 + 0.12;
      if (a + 0.8 <= s1 - 0.05) {
        const h0 = hf + 0.3;
        obox(w, eb, a, a + 0.8, -0.32, 0, h0, h0 + 0.55, shade(BC.acUnit, 0.85), BC.acUnit, BC.acUnit, SIDE.V0 | (fu(15) < 0.5 ? SIDE.U0 : SIDE.U1) | SIDE.TOP);
      }
    }
  }
}
