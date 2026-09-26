// Trees (docs/3d/world.md §1.7, §2.7): OSM trees and tree rows with their
// species, a bodhi beside the main hall of every temple plus temple garden
// trees, both moat banks, arterial pavements, Poisson-disc parks, forests and
// campuses, house yards, and bougainvillea spilling over walls. Every trunk
// keeps clear of footprints, carriageways, water, rail, walls and paths.

import { ringOf, ROAD_FLAG } from '../city';
import { OB, ringTester, TREE_BLOCK } from './clearance';
import { TREE_KINDS, type BuildContext, type TreeKind } from './context';
import { hash01, pickWeighted } from './mesh';
import { bbox, frameOf, pointInRing, type Ring } from './shapes';
import { placeEnv, strHash, walk, type PlaceEnv } from './streets';

/** Crown radius (m) of each species at scale 1, used for spacing. */
export const CROWN: Record<TreeKind, number> = {
  rain: 8.4,
  round: 3.4,
  palm: 2.8,
  yang: 4.8,
  bodhi: 7.4,
  banyan: 7.4,
  teak: 3.6,
  sugar_palm: 3.4,
  royal_palm: 4.2,
  frangipani: 2.4,
  bougainvillea: 2,
  golden_shower: 3.8,
  banana: 2,
};

type Mix = [TreeKind, number][];

const MOAT_MIX: Mix = [
  ['rain', 35],
  ['sugar_palm', 12],
  ['palm', 8],
  ['bodhi', 8],
  ['banyan', 7],
  ['teak', 15],
  ['golden_shower', 7],
  ['frangipani', 5],
  ['bougainvillea', 3],
];
const STREET_MIX: Mix = [
  ['rain', 40],
  ['golden_shower', 15],
  ['teak', 10],
  ['round', 15],
  ['royal_palm', 10],
  ['palm', 10],
];
const PARK_MIX: Mix = [
  ['rain', 30],
  ['round', 22],
  ['teak', 10],
  ['palm', 8],
  ['sugar_palm', 6],
  ['golden_shower', 8],
  ['banyan', 5],
  ['bodhi', 3],
  ['frangipani', 5],
  ['royal_palm', 3],
];
const FOREST_MIX: Mix = [
  ['rain', 25],
  ['banyan', 15],
  ['teak', 25],
  ['round', 25],
  ['yang', 10],
];
const CAMPUS_MIX: Mix = [
  ['rain', 30],
  ['round', 25],
  ['royal_palm', 12],
  ['palm', 8],
  ['golden_shower', 10],
  ['frangipani', 10],
  ['teak', 5],
];
const TEMPLE_MIX: Mix = [
  ['frangipani', 25],
  ['palm', 20],
  ['sugar_palm', 10],
  ['round', 15],
  ['golden_shower', 10],
  ['bougainvillea', 10],
  ['banyan', 5],
  ['yang', 5],
];
const YARD_MIX: Mix = [
  ['round', 35],
  ['banana', 25],
  ['palm', 20],
  ['frangipani', 15],
  ['bougainvillea', 5],
];
const INFILL_MIX: Mix = [
  ['round', 30],
  ['rain', 18],
  ['palm', 14],
  ['teak', 10],
  ['banana', 10],
  ['golden_shower', 7],
  ['frangipani', 6],
  ['sugar_palm', 5],
];
const OSM_OLD_CITY_MIX: Mix = [
  ['rain', 30],
  ['round', 25],
  ['golden_shower', 10],
  ['frangipani', 10],
  ['teak', 10],
  ['palm', 10],
  ['bodhi', 5],
];
const OSM_MIX: Mix = [
  ['round', 30],
  ['rain', 25],
  ['teak', 10],
  ['palm', 10],
  ['golden_shower', 8],
  ['frangipani', 7],
  ['banana', 5],
  ['sugar_palm', 5],
];
const ROW_MIX: Mix = [
  ['rain', 35],
  ['teak', 15],
  ['palm', 15],
  ['royal_palm', 10],
  ['golden_shower', 10],
  ['round', 15],
];

/** Poisson-disc spacing (m), share of samples kept, species and scale range for green areas. */
const GREEN: Record<string, { r: number; keep: number; mix: Mix; scale: [number, number] }> = {
  park: { r: 11, keep: 0.75, mix: PARK_MIX, scale: [0.8, 1.2] },
  garden: { r: 9, keep: 0.8, mix: PARK_MIX, scale: [0.75, 1.1] },
  forest: { r: 14, keep: 0.3, mix: FOREST_MIX, scale: [1.0, 1.45] },
  grass: { r: 24, keep: 0.3, mix: PARK_MIX, scale: [0.8, 1.2] },
  cemetery: { r: 11, keep: 0.6, mix: [['frangipani', 40], ['round', 30], ['palm', 30]], scale: [0.75, 1.1] },
  golf: { r: 26, keep: 0.45, mix: [['rain', 40], ['palm', 30], ['royal_palm', 30]], scale: [0.9, 1.3] },
  campus: { r: 20, keep: 0.45, mix: CAMPUS_MIX, scale: [0.8, 1.2] },
  school: { r: 20, keep: 0.5, mix: CAMPUS_MIX, scale: [0.8, 1.15] },
  hospital: { r: 20, keep: 0.5, mix: CAMPUS_MIX, scale: [0.8, 1.15] },
  rural: { r: 20, keep: 0.22, mix: [['palm', 30], ['banana', 25], ['round', 30], ['sugar_palm', 15]], scale: [0.8, 1.15] },
};

/** Scale range per placement. */
const scaleOf = (n: number, salt: number, lo: number, hi: number) => lo + hash01(n, salt) * (hi - lo);

export interface PlantOpts {
  /** Clearance from buildings, carriageways and other obstacles (m, default 1). */
  clear?: number;
  /** Extra clearance from buildings (m). */
  building?: number;
  /** Also require a free cell in the coarse occupancy raster (default true). */
  occ?: boolean;
  /** Share of the crown radius other crowns must keep clear (default 0.5). */
  crown?: number;
  /** Obstacle kinds to avoid (default TREE_BLOCK). */
  mask?: number;
}

/** Plant a tree if the spot is clear; returns whether it was placed. */
export function plant(ctx: BuildContext, env: PlaceEnv, x: number, y: number, kind: TreeKind, scale: number, o: PlantOpts = {}): boolean {
  const [kx0, ky0, kx1, ky1] = ctx.keep;
  if (!(x > kx0 && x < kx1 && y > ky0 && y < ky1)) return false;
  if (o.occ !== false && !ctx.occ.free(x, y)) return false;
  const trunk = 0.6 * scale;
  const crown = CROWN[kind] * scale * (o.crown ?? 0.5);
  if (!env.placed.free(x, y, trunk, crown)) return false;
  if (env.clear.hit(x, y, o.clear ?? 1, o.mask ?? TREE_BLOCK)) return false;
  if (o.building && env.clear.hit(x, y, o.building, OB.BUILDING)) return false;
  ctx.trees.push(x, y, scale, TREE_KINDS.indexOf(kind));
  ctx.occ.markDisc(x, y, 2.5);
  env.placed.add(x, y, trunk, crown);
  return true;
}

/**
 * Bridson Poisson-disc sampling where `inside` holds (within `bounds`),
 * seeded from a coarse lattice so obstacle-separated pockets fill too.
 * `accept` decides each candidate (and places whatever it stands for); the
 * accepted samples keep later ones at least r apart. Returns the sample count.
 */
export function poissonFill(
  inside: (x: number, y: number) => boolean,
  bounds: [number, number, number, number],
  r: number,
  seed: number,
  accept: (x: number, y: number, n: number) => boolean,
  maxN = Infinity,
): number {
  const [x0, y0, x1, y1] = bounds;
  if (x1 <= x0 || y1 <= y0) return 0;
  const cell = r / Math.SQRT2;
  const nx = Math.ceil((x1 - x0) / cell) + 1;
  const ny = Math.ceil((y1 - y0) / cell) + 1;
  const grid = new Int32Array(nx * ny).fill(-1);
  const xs: number[] = [];
  const ys: number[] = [];
  const active: number[] = [];
  let tries = 0;
  const near = (x: number, y: number): boolean => {
    const i = Math.floor((x - x0) / cell);
    const j = Math.floor((y - y0) / cell);
    for (let jj = Math.max(0, j - 2); jj <= Math.min(ny - 1, j + 2); jj++) {
      for (let ii = Math.max(0, i - 2); ii <= Math.min(nx - 1, i + 2); ii++) {
        const k = grid[jj * nx + ii];
        if (k >= 0 && (xs[k] - x) ** 2 + (ys[k] - y) ** 2 < r * r) return true;
      }
    }
    return false;
  };
  const tryAdd = (x: number, y: number): boolean => {
    if (x < x0 || x > x1 || y < y0 || y > y1 || near(x, y) || !inside(x, y)) return false;
    if (!accept(x, y, xs.length)) return false;
    const k = xs.length;
    xs.push(x);
    ys.push(y);
    grid[Math.floor((y - y0) / cell) * nx + Math.floor((x - x0) / cell)] = k;
    active.push(k);
    return true;
  };
  const step = r * 2.2;
  for (let y = y0 + step * hash01(seed, 1) * 0.5; y <= y1 && xs.length < maxN; y += step) {
    for (let x = x0 + step * hash01(seed, 2) * 0.5; x <= x1 && xs.length < maxN; x += step) {
      tryAdd(x + (hash01(seed + tries, 3) - 0.5) * r, y + (hash01(seed + tries++, 4) - 0.5) * r);
      while (active.length && xs.length < maxN) {
        const k = active[active.length - 1];
        let grew = false;
        for (let a = 0; a < 8; a++) {
          const ang = hash01(seed * 7 + tries, 5) * Math.PI * 2;
          const d = r * (1 + hash01(seed * 7 + tries++, 6));
          if (tryAdd(xs[k] + Math.cos(ang) * d, ys[k] + Math.sin(ang) * d)) {
            grew = true;
            break;
          }
        }
        if (!grew) active.pop();
      }
    }
  }
  return xs.length;
}

export function scatterTrees(ctx: BuildContext): void {
  const env = placeEnv(ctx);
  osmTrees(ctx, env);
  templeTrees(ctx, env);
  // The temple layouts' bodhi spots are planted now; they are not drawn props.
  delete ctx.props.bodhi_spot;
  moatTrees(ctx, env);
  treeRows(ctx, env);
  streetTrees(ctx, env);
  greenAreas(ctx, env);
  yardTrees(ctx, env);
  wallBushes(ctx, env);
  infillTrees(ctx, env);
}

function speciesOf(sp: string): TreeKind | null {
  if (/Albizia|Samanea/i.test(sp)) return 'rain';
  if (/Ficus religiosa/i.test(sp)) return 'bodhi';
  if (/Ficus/i.test(sp)) return 'banyan';
  if (/Dipterocarpus/i.test(sp)) return 'yang';
  if (/Tectona/i.test(sp)) return 'teak';
  if (/Borassus|Corypha/i.test(sp)) return 'sugar_palm';
  if (/Cocos/i.test(sp)) return 'palm';
  if (/Roystonea/i.test(sp)) return 'royal_palm';
  if (/Plumeria/i.test(sp)) return 'frangipani';
  if (/Cassia/i.test(sp)) return 'golden_shower';
  if (/Bougainvillea/i.test(sp)) return 'bougainvillea';
  if (/Musa/i.test(sp)) return 'banana';
  if (/Mangifera/i.test(sp)) return 'round';
  return null;
}

/** OSM trees keep their species (or take the district mix) and are nudged off obstacles. */
function osmTrees(ctx: BuildContext, env: PlaceEnv): void {
  const { city } = ctx;
  const oldCityRing = moatSquare(env);
  for (let i = 0; i < city.trees.length; i += 3) {
    const x = city.trees[i] / 10;
    const y = city.trees[i + 1] / 10;
    const n = i / 3;
    const known = speciesOf(city.species[city.trees[i + 2]] ?? '');
    const oldCity = oldCityRing !== null && pointInRing(x, y, oldCityRing);
    const kind = known ?? pickWeighted(oldCity ? OSM_OLD_CITY_MIX : OSM_MIX, hash01(n, 7));
    const s = scaleOf(n, 8, 0.8, 1.15);
    const nudges: [number, number][] = [
      [0, 0],
      [1.5, 0],
      [-1.5, 0],
      [0, 1.5],
      [0, -1.5],
    ];
    for (const [dx, dy] of nudges) if (plant(ctx, env, x + dx, y + dy, kind, s, { clear: 0.6, occ: false, crown: 0.3 })) break;
  }
}

/** Convex hull of the moat water, standing in for the Old City outline. */
function moatSquare(env: PlaceEnv): Ring | null {
  const pts = env.moatRings.flat();
  if (pts.length < 3) return null;
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Ring = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Ring = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Main assembly hall of each temple ground, chosen as buildings.ts chooses it. */
export function templeHalls(ctx: BuildContext): Map<number, number> {
  const halls = new Map<number, number>();
  ctx.city.buildings.forEach((b, i) => {
    if (b.t === undefined) return;
    const L = b.o[0] / 10;
    const W = b.o[1] / 10;
    if (W < 6 || W > 26 || L / W < 1.4) return;
    const prev = halls.get(b.t);
    if (prev === undefined || ctx.city.buildings[prev].a < b.a) halls.set(b.t, i);
  });
  return halls;
}

function ringDist(x: number, y: number, ring: Ring): number {
  let d = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j];
    const [bx, by] = ring[i];
    const vx = bx - ax;
    const vy = by - ay;
    const l2 = vx * vx + vy * vy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2));
    d = Math.min(d, Math.hypot(ax + vx * t - x, ay + vy * t - y));
  }
  return d;
}

/** A bodhi beside every temple's main hall, then 2–16 garden trees per ground. */
function templeTrees(ctx: BuildContext, env: PlaceEnv): void {
  const { city } = ctx;
  const halls = templeHalls(ctx);
  city.areas.forEach((a, ai) => {
    if (city.areaKinds[a.k] !== 'temple') return;
    const ring = ringOf(a.r);
    const [x0, y0, x1, y1] = bbox(ring);
    let cx = 0;
    let cy = 0;
    let reach = 0;
    const hi = a.ti !== undefined ? halls.get(a.ti) : undefined;
    if (hi !== undefined) {
      const b = city.buildings[hi];
      const f = frameOf(b, ringOf(b.r));
      cx = f.cx;
      cy = f.cy;
      reach = Math.hypot(f.L, f.W) / 2;
    } else {
      for (const [x, y] of ring) {
        cx += x;
        cy += y;
      }
      cx /= ring.length;
      cy /= ring.length;
    }
    // Bodhi: the spot the temple layout left for it, else the nearest open spot round the hall.
    const a0 = hash01(ai, 51) * Math.PI * 2;
    const s = scaleOf(ai, 52, 0.85, 1.15);
    let done = false;
    const spots = ctx.props.bodhi_spot ?? [];
    for (let i = 0; i < spots.length && !done; i += 4) {
      if (pointInRing(spots[i], spots[i + 1], ring)) done = plant(ctx, env, spots[i], spots[i + 1], 'bodhi', s, { building: 2, crown: 0.3 });
    }
    for (const d of [reach + 5, reach + 8, reach + 12, reach + 17, reach + 23]) {
      for (let k = 0; k < 12 && !done; k++) {
        const ang = a0 + (k * Math.PI) / 6;
        const x = cx + Math.cos(ang) * d;
        const y = cy + Math.sin(ang) * d;
        if (!pointInRing(x, y, ring) || ringDist(x, y, ring) < 2.5) continue;
        done = plant(ctx, env, x, y, 'bodhi', s, { building: 3, crown: 0.35 });
      }
      if (done) break;
    }
    // Small or crowded grounds: any open spot inside.
    for (let k = 0; k < 400 && !done; k++) {
      const x = x0 + hash01(ai * 1000 + k, 53) * (x1 - x0);
      const y = y0 + hash01(ai * 1000 + k, 54) * (y1 - y0);
      if (!pointInRing(x, y, ring) || ringDist(x, y, ring) < 1.5) continue;
      done = plant(ctx, env, x, y, 'bodhi', s * 0.8, { building: 1.5, crown: 0.2 });
    }
    // Garden trees: frangipani, palms, bougainvillea …
    const area = (x1 - x0) * (y1 - y0);
    const want = Math.max(2, Math.min(14, Math.round(area / 1300))) + Math.floor(hash01(ai, 55) * 3);
    let got = 0;
    poissonFill(
      (x, y) => pointInRing(x, y, ring),
      [x0, y0, x1, y1],
      8,
      ai * 131 + 7,
      (x, y, n) => {
        if (got >= want || ringDist(x, y, ring) < 1.5) return false;
        const kind = pickWeighted(TEMPLE_MIX, hash01(ai * 50 + n, 56));
        const ok = plant(ctx, env, x, y, kind, scaleOf(ai * 50 + n, 57, 0.8, 1.1), { building: 1.5 });
        if (ok) got++;
        return ok;
      },
      want * 4,
    );
  });
}

/** Both banks of every moat segment: a tree every 10–14 m in the strip between the water and the road. */
function moatTrees(ctx: BuildContext, env: PlaceEnv): void {
  env.moatRings.forEach((ring, ri) => {
    walk(
      ring,
      4 + hash01(ri, 61) * 6,
      (n) => 10 + hash01(ri * 1000 + n, 62) * 4,
      (st, n) => {
        const id = ri * 1000 + n;
        const kind = pickWeighted(MOAT_MIX, hash01(id, 63));
        const s = scaleOf(id, 64, 0.8, 1.15);
        // Outward (right-hand) normal of a counter-clockwise ring.
        for (const off of [3.0, 2.2, 1.6, 4.2]) {
          if (plant(ctx, env, st.x + st.dy * off, st.y - st.dx * off, kind, s, { clear: 0.6, occ: false, crown: 0.45 })) break;
        }
      },
      true,
    );
  });
}

/** OSM tree rows: one species per row, every 9–11 m. */
function treeRows(ctx: BuildContext, env: PlaceEnv): void {
  const { city } = ctx;
  city.lines.forEach((l, li) => {
    if (city.lineKinds[l.k] !== 'tree_row') return;
    const kind = pickWeighted(ROW_MIX, hash01(li, 71));
    walk(
      ringOf(l.p),
      3,
      (n) => 9 + hash01(li * 1000 + n, 72) * 2,
      (st, n) => plant(ctx, env, st.x, st.y, kind, scaleOf(li * 1000 + n, 73, 0.8, 1.05), { clear: 0.7, occ: false, crown: 0.35 }),
    );
  });
}

/**
 * Arterial pavements: one species per street (mostly), every 13–19 m on both
 * sides with occasional gaps; slim palms where buildings stand too close for a crown.
 */
function streetTrees(ctx: BuildContext, env: PlaceEnv): void {
  for (const st of env.streets) {
    if (st.moat || st.flags & ROAD_FLAG.BRIDGE || st.flags & ROAD_FLAG.TUNNEL) continue;
    const walkable = st.cls <= 2 || (st.cls === 3 && (st.flags & (ROAD_FLAG.SIDEWALK_L | ROAD_FLAG.SIDEWALK_R)) !== 0);
    if (!walkable || st.len < 20) continue;
    const key = st.name ? strHash(st.name) : st.i * 7919;
    const main = pickWeighted(STREET_MIX, hash01(key, 81));
    for (const side of [1, -1]) {
      const off = st.half + 1.35;
      walk(
        st.pts,
        6 + hash01(st.i * 2 + (side > 0 ? 1 : 0), 82) * 8,
        (n) => 13 + hash01(st.i * 3000 + n * 2 + side, 83) * 6,
        (p, n) => {
          const id = st.i * 3000 + n * 2 + (side > 0 ? 1 : 0);
          if (hash01(id, 84) > 0.74) return;
          const kind = hash01(id, 85) < 0.75 ? main : pickWeighted(STREET_MIX, hash01(id, 86));
          const x = p.x - p.dy * off * side;
          const y = p.y + p.dx * off * side;
          const s = scaleOf(id, 87, 0.7, 0.95);
          // Keep broad crowns out of the shopfronts: close to buildings, plant a slim palm instead.
          const roomy = !env.clear.hit(x, y, CROWN[kind] * s * 0.55, OB.BUILDING);
          const slim: TreeKind = hash01(id, 88) < 0.5 ? 'royal_palm' : 'palm';
          if (!roomy && env.clear.hit(x, y, CROWN[slim] * s * 0.5, OB.BUILDING)) return;
          plant(ctx, env, x, y, roomy ? kind : slim, s, { clear: 0.7, occ: false, crown: 0.35 });
        },
      );
    }
  }
}

/** Parks, gardens, forests, campuses, cemeteries, golf and rural land: Poisson-disc fill. */
function greenAreas(ctx: BuildContext, env: PlaceEnv): void {
  const { city } = ctx;
  const [kx0, ky0, kx1, ky1] = ctx.keep;
  city.areas.forEach((a, ai) => {
    const rule = GREEN[city.areaKinds[a.k]];
    if (!rule) return;
    const ring = ringOf(a.r);
    const inRing = ringTester(ring);
    const holes = (a.h ?? []).map((h) => ringTester(ringOf(h)));
    const [x0, y0, x1, y1] = bbox(ring);
    const bounds: [number, number, number, number] = [Math.max(x0, kx0), Math.max(y0, ky0), Math.min(x1, kx1), Math.min(y1, ky1)];
    poissonFill(inRing, bounds, rule.r, ai * 7717 + 3, (x, y, n) => {
      if (holes.some((inHole) => inHole(x, y))) return false;
      const id = ai * 100000 + n;
      if (hash01(id, 91) > rule.keep) return true;
      const kind = pickWeighted(rule.mix, hash01(id, 92));
      plant(ctx, env, x, y, kind, scaleOf(id, 93, rule.scale[0], rule.scale[1]), { clear: 1.2, crown: 0.45 });
      return true;
    });
  });
}

/** Houses with a yard: one or two fruit or flowering trees beside or behind the house. */
function yardTrees(ctx: BuildContext, env: PlaceEnv): void {
  const { city, str } = ctx;
  const homey = new Set(['suburb', 'wat_ket', 'wua_lai', 'chang_phueak', 'suan_dok', 'santitham', 'riverside']);
  city.buildings.forEach((b) => {
    if (b.t !== undefined || b.a < 40 || b.a > 450) return;
    const kind = str(b.b);
    const house = kind === 'house' || kind === 'detached' || kind === 'residential' || kind === 'bungalow';
    if (!house && !(kind === 'yes' && homey.has(city.zones[b.z] ?? 'suburb'))) return;
    if (hash01(b.id, 101) > (house ? 0.55 : 0.3)) return;
    const ring = ringOf(b.r);
    const f = frameOf(b, ring);
    const want = hash01(b.id, 102) < 0.25 ? 2 : 1;
    // Start behind the house: away from its street front when it has one.
    let back = hash01(b.id, 103) * Math.PI * 2;
    if (b.f !== undefined) {
      const [ax, ay] = ring[b.f];
      const [bx, by] = ring[(b.f + 1) % ring.length];
      back = Math.atan2(f.cy - (ay + by) / 2, f.cx - (ax + bx) / 2);
    }
    let got = 0;
    for (let k = 0; k < 8 && got < want; k++) {
      const ang = back + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 4);
      const cu = Math.cos(ang - Math.atan2(f.uy, f.ux));
      const cv = Math.sin(ang - Math.atan2(f.uy, f.ux));
      // Distance from the centre to the footprint's box edge along ang, plus a gap.
      const edge = Math.min(Math.abs(f.L / 2 / (cu || 1e-6)), Math.abs(f.W / 2 / (cv || 1e-6)));
      const d = edge + 2.6 + hash01(b.id + k, 104) * 1.5;
      const id = b.id * 8 + k;
      const tk = pickWeighted(YARD_MIX, hash01(id, 105));
      if (plant(ctx, env, f.cx + Math.cos(ang) * d, f.cy + Math.sin(ang) * d, tk, scaleOf(id, 106, 0.7, 1.0), { clear: 1.0, occ: false, crown: 0.4 })) got++;
    }
  });
}

/** Bougainvillea bushes along garden and compound walls. */
function wallBushes(ctx: BuildContext, env: PlaceEnv): void {
  const { city } = ctx;
  city.lines.forEach((l, li) => {
    if (city.lineKinds[l.k] !== 'wall') return;
    walk(
      ringOf(l.p),
      4 + hash01(li, 111) * 8,
      (n) => 14 + hash01(li * 1000 + n, 112) * 12,
      (st, n) => {
        const id = li * 1000 + n;
        if (hash01(id, 113) > 0.5) return;
        const side = hash01(id, 114) < 0.5 ? 1 : -1;
        plant(ctx, env, st.x - st.dy * 1.4 * side, st.y + st.dx * 1.4 * side, 'bougainvillea', scaleOf(id, 115, 0.8, 1.1), { clear: 0.5, occ: false, crown: 0.3 });
      },
    );
  });
}

/**
 * Open lots, back gardens and compounds: a Poisson-disc scatter at 14 m inside
 * the moat (the Old City is leafy), then 22 m across the playable area,
 * thinner beyond ~2.3 km from the Old City.
 */
function infillTrees(ctx: BuildContext, env: PlaceEnv): void {
  const [px0, py0, px1, py1] = ctx.city.play.map((v) => v / 10);
  const tree = (x: number, y: number, n: number) => {
    const kind = pickWeighted(INFILL_MIX, hash01(n, 122));
    plant(ctx, env, x, y, kind, scaleOf(n, 123, 0.75, 1.1), { clear: 1.5, building: 2.5, crown: 0.45 });
  };
  const hull = moatSquare(env);
  let ox = 0;
  let oy = 0;
  if (hull) {
    for (const [x, y] of hull) {
      ox += x;
      oy += y;
    }
    ox /= hull.length;
    oy /= hull.length;
    const inHull = ringTester(hull);
    poissonFill(inHull, bbox(hull), 14, 515151, (x, y, n) => {
      if (hash01(n, 124) < 0.42) tree(x, y, n + 7_000_000);
      return true;
    });
  }
  poissonFill(
    () => true,
    [px0 - 100, py0 - 100, px1 + 100, py1 + 100],
    22,
    424243,
    (x, y, n) => {
      if (hash01(n, 121) < (Math.hypot(x - ox, y - oy) < 2300 ? 0.16 : 0.05)) tree(x, y, n);
      return true;
    },
  );
}
