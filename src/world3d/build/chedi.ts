// Chedis (docs/3d/world.md §1.3, §2.5): bell-shaped (Sri Lankan-derived),
// Lanna redented square, octagonal, and ruined brick; finished white with a
// gold spire, all gold, weathered grey-white or bare brick. Main chedis get
// four corner chedis; some get elephant foreparts round the base.

import { BC } from './buildingPalette';
import type { BuildContext } from './context';
import { basis, beam, bp, cbox, lathe, ngon, obox, prism, redented, SIDE, type Basis } from './kit';
import { hash01, mix, pickWeighted, shade, type MeshWriter, type RGB } from './mesh';

export type ChediType = 'bell' | 'redented' | 'octagonal';
export type ChediFinish = 'white' | 'gold' | 'weathered' | 'brick';

export interface ChediSpec {
  x: number;
  y: number;
  /** Side of the square base (m). */
  side: number;
  /** Total height to the finial tip (m). */
  height: number;
  /** Orientation of the base square (radians). */
  ang: number;
  type: ChediType;
  finish: ChediFinish;
  /** Broken-off top (bare-brick ruins). */
  ruined?: boolean;
  /** Four small chedis at the base corners. */
  corners?: boolean;
  /** Elephant foreparts per side on the lowest terrace. */
  elephants?: number;
  /** Lathe segments for round parts. */
  segments?: number;
}

/** Type and finish by hash (world.md §2.5: bell 55%, redented 30%, octagonal 15%). */
export function chediStyle(key: number): { type: ChediType; finish: ChediFinish } {
  const type = pickWeighted<ChediType>([
    ['bell', 55],
    ['redented', 30],
    ['octagonal', 15],
  ], hash01(key, 401));
  const finish = pickWeighted<ChediFinish>([
    ['white', 45],
    ['gold', 30],
    ['weathered', 15],
    ['brick', 10],
  ], hash01(key, 402));
  return { type, finish };
}

export interface ChediColours {
  base: RGB;
  body: RGB;
  bell: RGB;
  spire: RGB;
  band: RGB;
}

export function chediColours(f: ChediFinish, key: number): ChediColours {
  switch (f) {
    case 'gold':
      return { base: BC.goldDark, body: BC.gold, bell: BC.gold, spire: BC.gold, band: BC.goldLit };
    case 'weathered': {
      const grey = mix(BC.weathered, BC.lichen, hash01(key, 403) * 0.25);
      return { base: shade(grey, 0.9), body: grey, bell: grey, spire: mix(BC.goldDark, grey, 0.5), band: shade(grey, 1.08) };
    }
    case 'brick': {
      const brick = mix(BC.brickRuin, BC.laterite, hash01(key, 404));
      return { base: shade(brick, 0.9), body: brick, bell: shade(brick, 1.05), spire: shade(brick, 0.95), band: mix(brick, BC.lichen, 0.35) };
    }
    default:
      return { base: BC.templePlinth, body: BC.templeWhite, bell: BC.templeWhite, spire: BC.gold, band: BC.gold };
  }
}

/** Build a chedi from a spec into w. */
export function chedi(w: MeshWriter, spec: ChediSpec, key: number): void {
  const { x, y, side: S, height: H, ang, type, finish } = spec;
  const n = type === 'octagonal' ? 8 : (spec.segments ?? (S > 10 ? 10 : 8));
  const c = chediColours(finish, key);
  const b = basis(x, y, ang);
  const rot = ang + Math.PI / n;
  let h = 0;
  const tierBox = (frac: number, hh: number, col: RGB) => {
    const r = (S * frac) / 2;
    obox(w, b, -r, r, -r, r, h, h + hh, shade(col, 0.88), col, shade(col, 1.04));
    h += hh;
  };
  const tierPoly = (ring: [number, number][], hh: number, col: RGB) => {
    prism(w, ring, h, h + hh, shade(col, 0.88), col, shade(col, 1.04));
    h += hh;
  };

  // Stepped base.
  if (type === 'redented') {
    tierPoly(redented(b, S / 2, S * 0.08), H * 0.07, c.base);
    tierPoly(redented(b, S * 0.42, S * 0.07), H * 0.07, c.body);
    tierPoly(redented(b, S * 0.35, S * 0.06), H * 0.08, c.body);
    tierPoly(redented(b, S * 0.28, S * 0.05), H * 0.1, c.body);
  } else if (type === 'octagonal') {
    tierPoly(ngon(x, y, S * 0.54, 8, rot), H * 0.06, c.base);
    tierPoly(ngon(x, y, S * 0.46, 8, rot), H * 0.06, c.body);
    tierPoly(ngon(x, y, S * 0.39, 8, rot), H * 0.06, c.body);
    tierPoly(ngon(x, y, S * 0.32, 8, rot), H * 0.1, c.body);
  } else {
    tierBox(1, H * 0.06, c.base);
    tierBox(0.86, H * 0.05, c.body);
    tierBox(0.72, H * 0.05, c.body);
  }
  const baseTop = h;

  // Mouldings, bell, harmika and ringed spire.
  const r0 = type === 'bell' ? S * 0.33 : S * 0.26;
  const prof: [number, number][] = [];
  const cols: RGB[] = [];
  const push = (r: number, hh: number, col: RGB) => {
    prof.push([r, hh]);
    cols.push(col);
  };
  if (type === 'bell') {
    push(r0, h, c.body);
    push(r0, h + H * 0.025, c.band);
    push(r0 * 0.92, h + H * 0.025, c.body);
    push(r0 * 0.92, h + H * 0.05, c.band);
    push(r0 * 0.84, h + H * 0.05, c.body);
    push(r0 * 0.84, h + H * 0.075, c.body);
    h += H * 0.075;
    // Bell dome.
    const rb = r0 * 0.84;
    push(rb * 1.02, h + H * 0.05, c.bell);
    push(rb * 0.96, h + H * 0.11, c.bell);
    push(rb * 0.78, h + H * 0.17, c.bell);
    push(rb * 0.5, h + H * 0.21, c.bell);
    push(rb * 0.3, h + H * 0.225, c.bell);
    h += H * 0.225;
  } else {
    // Drum (octagonal feel from the lathe count) and a small bell.
    push(r0, h, c.body);
    push(r0, h + H * 0.08, c.body);
    push(r0 * 0.88, h + H * 0.08, c.band);
    push(r0 * 0.88, h + H * 0.1, c.band);
    h += H * 0.1;
    const rb = r0 * 0.8;
    push(rb, h + H * 0.02, c.bell);
    push(rb * 0.95, h + H * 0.07, c.bell);
    push(rb * 0.6, h + H * 0.12, c.bell);
    push(rb * 0.32, h + H * 0.14, c.bell);
    h += H * 0.14;
  }
  if (spec.ruined) {
    // Broken top: stop part-way up the bell with a rough stub.
    lathe(w, x, y, prof.slice(0, Math.max(3, prof.length - 2)), n, cols, rot);
    const top = prof[Math.max(2, prof.length - 3)];
    lathe(w, x, y, [
      [top[0] * 0.8, top[1]],
      [top[0] * 0.45, top[1] + H * 0.05],
      [top[0] * 0.2, top[1] + H * 0.07],
    ], 5, [c.bell, mix(c.bell, BC.moss, 0.4), mix(c.bell, BC.moss, 0.5)], rot + 0.3);
    return;
  }
  lathe(w, x, y, prof, n, cols, rot);
  // Harmika box.
  const hr = r0 * 0.34;
  obox(w, b, -hr, hr, -hr, hr, h, h + H * 0.045, shade(c.spire, 0.9), c.spire, c.spire);
  h += H * 0.045;
  // Ringed spire (rings stacked as a stepped cone), then the plain spire and umbrella finial.
  const sr = r0 * 0.26;
  const rings = 4;
  const spireTop = H;
  const ringZone = (spireTop - h) * 0.45;
  const sp: [number, number][] = [];
  const sc: RGB[] = [];
  for (let k = 0; k < rings; k++) {
    const t = k / rings;
    const r = sr * (1 - t * 0.55);
    const hh = h + ringZone * t;
    sp.push([r, hh], [r * 0.8, hh + ringZone / rings]);
    sc.push(c.spire, shade(c.spire, 0.88));
  }
  h += ringZone;
  sp.push([sr * 0.35, h], [sr * 0.14, h + (spireTop - h) * 0.55], [sr * 0.45, h + (spireTop - h) * 0.6], [0, spireTop]);
  sc.push(c.spire, c.spire, BC.goldLit, BC.goldLit);
  lathe(w, x, y, sp, Math.min(n, 6), sc, rot);

  if (spec.corners && S >= 8) {
    // Four small chedis on the corners of the lowest terrace.
    const r = S * 0.4;
    for (const [du, dv] of [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ]) {
      const [cx, cy] = bp(b, du * r, dv * r, 0);
      miniChedi(w, cx, cy, S * 0.1, H * 0.06, baseTop * 0.25, c, rot);
    }
  }
  if (spec.elephants) elephantBase(w, b, S * 0.43, spec.elephants, H * 0.06, finish === 'gold' ? BC.templeWhite : c.body);
}

/** Small bell chedi (corner piece or cluster member). */
export function miniChedi(w: MeshWriter, x: number, y: number, side: number, height: number, h0: number, c: ChediColours | null, rot = 0, n = 5): void {
  const col = c ?? chediColours('white', 0);
  const r = side / 2;
  lathe(w, x, y, [
    [r, h0],
    [r * 0.85, h0 + height * 0.2],
    [r * 0.75, h0 + height * 0.42],
    [r * 0.18, h0 + height * 0.58],
    [0, h0 + height],
  ], n, [col.base, col.body, col.bell, col.spire, col.spire], rot);
}

/** Elephant foreparts emerging from a square terrace of half-side r at height h. */
export function elephantBase(w: MeshWriter, b: Basis, r: number, perSide: number, h: number, colour: RGB): void {
  const grey = colour;
  for (let side = 0; side < 4; side++) {
    const ang = Math.atan2(b.uy, b.ux) + (side * Math.PI) / 2;
    const sb = basis(b.ox, b.oy, ang);
    for (let k = 0; k < perSide; k++) {
      const v = -r * 0.8 + ((2 * r * 0.8) * (k + 0.5)) / perSide;
      const u = r;
      // Chest and head, trunk down to the ground, ears, two front legs.
      obox(w, sb, u - 0.2, u + 1.1, v - 0.75, v + 0.75, h + 0.6, h + 2.3, shade(grey, 0.85), grey, grey, SIDE.V0 | SIDE.U1 | SIDE.V1 | SIDE.TOP);
      obox(w, sb, u + 1.0, u + 1.7, v - 0.5, v + 0.5, h + 1.4, h + 2.5, shade(grey, 0.9), grey, grey, SIDE.V0 | SIDE.U1 | SIDE.V1 | SIDE.TOP);
      beam(w, bp(sb, u + 1.6, v, h + 1.6), bp(sb, u + 1.85, v, h + 0.1), 0.18, 0.12, shade(grey, 0.92));
      obox(w, sb, u + 0.9, u + 1.05, v - 1.05, v + 1.05, h + 1.3, h + 2.6, shade(grey, 0.95), grey, grey, SIDE.U1 | SIDE.U0 | SIDE.TOP);
      for (const dv of [-0.45, 0.45]) cbox(w, sb, u + 0.7, v + dv, 0.45, 0.45, h, h + 0.8, shade(grey, 0.8), grey, grey, SIDE.SIDES);
    }
  }
}

/**
 * A chedi at a footprint centre with style by hash; height from tags or
 * ~2.2× the base side. Draws into the buildings layer and marks occupancy.
 */
export function chediAt(ctx: BuildContext, x: number, y: number, side: number, ang: number, key: number, height?: number): void {
  const st = chediStyle(key);
  const H = height ?? Math.min(60, side * 2.2);
  chedi(ctx.w.buildings, { x, y, side, height: H, ang, type: st.type, finish: st.finish, ruined: st.finish === 'brick' && hash01(key, 405) < 0.6, corners: side >= 10 }, key);
  ctx.occ.markDisc(x, y, side * 0.6);
}

