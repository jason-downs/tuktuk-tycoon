// Street classification for trees and street furniture (docs/3d/world.md
// §1.6, §2.7): the roads whose cables are buried (the moat roads, Tha Phae,
// Chang Klan), the roads lit by heritage lanterns, and those whose poles are
// thinned out ahead of burial. Also the placement environment the tree
// scatter and the prop builder share: street list, obstacle index and the
// registry of placed items.

import { ringOf } from '../city';
import { buildClearance, Placed, roadHalf, segDist, type Clearance } from './clearance';
import type { BuildContext } from './context';
import type { Ring } from './shapes';

export interface Street {
  /** Way index in city.roads.ways. */
  i: number;
  pts: Ring;
  /** Road node index of each point. */
  nodes: number[];
  /** Road class index: 0 trunk, 1 primary, 2 secondary, 3 tertiary, 4 unclassified, 5 residential, 6 living street, 7 service. */
  cls: number;
  flags: number;
  /** Carriageway half-width (m). */
  half: number;
  lanes: number;
  name: string;
  /** Length (m). */
  len: number;
  /** Runs alongside the moat. */
  moat: boolean;
  /** Cables buried: no poles; PEA ground cabinets instead. */
  buried: boolean;
  /** Dark heritage lanterns instead of arm lamps. */
  heritage: boolean;
  /** Poles at half density (burial planned). */
  sparsePoles: boolean;
}

/** Sois, lanes and bridges carry their parent road's name but not its rules. */
const SIDE_STREET = /\bsoi\b|ซอย|\blane\b|plaza|bridge|สะพาน/i;
/** The eight moat roads (both banks, all four sides). */
export const MOAT_ROAD =
  /moon ?muang|mani ?nopp?h?arat|manee ?nopp?arat|chang ?lor?\b|\barak\b|bun ?rueang ?rit|boon ?ruang ?rit|bu?a?mrung ?buri|sri ?poom|si ?phum|sri ?phum|chay?i?a?ph?oo?m|chaiyaphum|kotchasa?rn|kotchasan/i;
export const THA_PHAE = /tha ?ph?ae|thapae|ท่าแพ/i;
export const CHANG_KLAN = /chang ?kh?lan|changklan|changklang|ช้างคลาน/i;
const RATCHADAMNOEN = /ra?t?chadamn?oen|ราชดำเนิน/i;
const NIMMAN = /nimman|นิมมาน/i;
const SPARSE_POLES = /huay ?kaew|huaykaew|ห้วยแก้ว|suthep|สุเทพ|mahid[oa][nl]|มหิดล/i;

/** Share of a way's length within this distance of moat water that makes it a moat road. */
const MOAT_NEAR = 30;

export interface StreetRules {
  moat: boolean;
  buried: boolean;
  heritage: boolean;
  sparsePoles: boolean;
}

/** Name rules for a road; `nearMoat` is the share of its length beside the moat. */
export function streetRules(name: string, cls: number, nearMoat: number): StreetRules {
  const main = !SIDE_STREET.test(name);
  const moat = cls <= 3 && ((main && MOAT_ROAD.test(name)) || nearMoat >= 0.5);
  const buried = moat || (main && (THA_PHAE.test(name) || CHANG_KLAN.test(name)));
  const heritage = main && (THA_PHAE.test(name) || RATCHADAMNOEN.test(name) || NIMMAN.test(name));
  const sparsePoles = main && (RATCHADAMNOEN.test(name) || NIMMAN.test(name) || SPARSE_POLES.test(name));
  return { moat, buried, heritage, sparsePoles };
}

export function polyLength(pts: Ring): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
}

export interface PlaceEnv {
  streets: Street[];
  clear: Clearance;
  placed: Placed;
  /** Moat water rings, counter-clockwise. */
  moatRings: Ring[];
  /** Road segments bucketed by 40 m cell (street index, segment index pairs), built on first use. */
  segGrid?: Map<number, number[]>;
}

const envs = new WeakMap<BuildContext, PlaceEnv>();

/** Signed area (m²): positive when the ring runs counter-clockwise (x east, y north). */
export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

/** The ring wound counter-clockwise, whatever its stored winding. */
export function ccw(ring: Ring): Ring {
  return signedArea(ring) >= 0 ? ring : [...ring].reverse();
}

/** Streets, obstacle index and placement registry for a build, made once and shared. */
export function placeEnv(ctx: BuildContext): PlaceEnv {
  const hit = envs.get(ctx);
  if (hit) return hit;
  const { city } = ctx;
  const moatRings = city.areas.filter((a) => city.areaKinds[a.k] === 'moat').map((a) => ccw(ringOf(a.r)));
  const moatEdges: number[] = [];
  let mx0 = Infinity;
  let my0 = Infinity;
  let mx1 = -Infinity;
  let my1 = -Infinity;
  for (const r of moatRings) {
    for (let i = 0; i < r.length; i++) {
      const [ax, ay] = r[i];
      const [bx, by] = r[(i + 1) % r.length];
      moatEdges.push(ax, ay, bx, by);
      mx0 = Math.min(mx0, ax);
      my0 = Math.min(my0, ay);
      mx1 = Math.max(mx1, ax);
      my1 = Math.max(my1, ay);
    }
  }
  const moatDist = (x: number, y: number): number => {
    if (x < mx0 - MOAT_NEAR || x > mx1 + MOAT_NEAR || y < my0 - MOAT_NEAR || y > my1 + MOAT_NEAR) return Infinity;
    let d = Infinity;
    for (let k = 0; k < moatEdges.length; k += 4) d = Math.min(d, segDist(x, y, moatEdges[k], moatEdges[k + 1], moatEdges[k + 2], moatEdges[k + 3]));
    return d;
  };
  const rn = city.roads.nodes;
  const streets: Street[] = city.roads.ways.map((way, i) => {
    const [cls, flags, widthDm, lanes, nameIdx] = way;
    const refs = way.slice(7);
    const pts: Ring = refs.map((n) => [rn[2 * n] / 10, rn[2 * n + 1] / 10]);
    const len = polyLength(pts);
    let near = 0;
    if (cls <= 3 && moatEdges.length) {
      for (let k = 1; k < pts.length; k++) {
        const l = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
        if (moatDist((pts[k][0] + pts[k - 1][0]) / 2, (pts[k][1] + pts[k - 1][1]) / 2) < MOAT_NEAR) near += l;
      }
    }
    const name = nameIdx ? city.strings[nameIdx] : '';
    const rules = streetRules(name, cls, len > 0 ? near / len : 0);
    return { i, pts, nodes: refs, cls, flags, half: roadHalf(widthDm).half, lanes, name, len, ...rules };
  });
  const clear = buildClearance(city, ctx.keep, (wi) => streets[wi].buried);
  const env: PlaceEnv = { streets, clear, placed: new Placed(), moatRings };
  envs.set(ctx, env);
  return env;
}

/** FNV-1a hash of a string, for choices that must agree along a whole street. */
export function strHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** A point on a polyline: position, unit direction and left normal. */
export interface Station {
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** Distance along the line (m). */
  s: number;
  /** Index of the segment the point is on. */
  seg: number;
}

/**
 * Walk a polyline, calling fn at distances produced by `next` (given the
 * running count, it returns the gap to the next station). Closed rings wrap.
 */
export function walk(pts: Ring, first: number, next: (n: number) => number, fn: (st: Station, n: number) => void, closed = false): void {
  const line = closed ? [...pts, pts[0]] : pts;
  let target = first;
  let base = 0;
  let n = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) continue;
    const dx = (bx - ax) / len;
    const dy = (by - ay) / len;
    while (target <= base + len) {
      const t = target - base;
      fn({ x: ax + dx * t, y: ay + dy * t, dx, dy, s: target, seg: i - 1 }, n);
      target += Math.max(0.5, next(n));
      n++;
    }
    base += len;
  }
}

/** The nearest point on a street to (x, y). */
export interface NearStreet {
  st: Street;
  seg: number;
  /** Nearest point on the centreline. */
  px: number;
  py: number;
  /** Unit direction of the segment. */
  dx: number;
  dy: number;
  /** Distance from the centreline. */
  d: number;
  /** +1 when (x, y) is left of the direction of travel along the way, −1 when right. */
  side: number;
}

const SEG_CELL = 40;
const segKey = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);

/** Nearest street within maxD of (x, y) that passes `ok`, or null. */
export function nearestStreet(env: PlaceEnv, x: number, y: number, maxD: number, ok: (st: Street) => boolean = () => true): NearStreet | null {
  if (!env.segGrid) {
    const grid = new Map<number, number[]>();
    for (const st of env.streets) {
      for (let k = 1; k < st.pts.length; k++) {
        const [ax, ay] = st.pts[k - 1];
        const [bx, by] = st.pts[k];
        for (let i = Math.floor(Math.min(ax, bx) / SEG_CELL); i <= Math.floor(Math.max(ax, bx) / SEG_CELL); i++) {
          for (let j = Math.floor(Math.min(ay, by) / SEG_CELL); j <= Math.floor(Math.max(ay, by) / SEG_CELL); j++) {
            let list = grid.get(segKey(i, j));
            if (!list) grid.set(segKey(i, j), (list = []));
            list.push(st.i, k - 1);
          }
        }
      }
    }
    env.segGrid = grid;
  }
  let best: NearStreet | null = null;
  const r = Math.ceil(maxD / SEG_CELL);
  const ci = Math.floor(x / SEG_CELL);
  const cj = Math.floor(y / SEG_CELL);
  for (let i = ci - r; i <= ci + r; i++) {
    for (let j = cj - r; j <= cj + r; j++) {
      const list = env.segGrid.get(segKey(i, j));
      if (!list) continue;
      for (let k = 0; k < list.length; k += 2) {
        const st = env.streets[list[k]];
        const seg = list[k + 1];
        const [ax, ay] = st.pts[seg];
        const [bx, by] = st.pts[seg + 1];
        const vx = bx - ax;
        const vy = by - ay;
        const l2 = vx * vx + vy * vy;
        if (l2 < 1e-9) continue;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2));
        const px = ax + vx * t;
        const py = ay + vy * t;
        const d = Math.hypot(px - x, py - y);
        if (d > maxD || (best && d >= best.d) || !ok(st)) continue;
        const l = Math.sqrt(l2);
        const dx = vx / l;
        const dy = vy / l;
        best = { st, seg, px, py, dx, dy, d, side: dx * (y - py) - dy * (x - px) >= 0 ? 1 : -1 };
      }
    }
  }
  return best;
}
