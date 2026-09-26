// Water cut into the ground: the moat 1.6 m below the street between brick
// bank walls with a low parapet and a grass strip, the Ping River 3.5 m down
// between sloped grassy banks, canals in concrete channels and ponds with
// stone edges. The ground base leaves holes over these bodies (ground.ts).
// Also the flat water beyond the kept area and painted channels for canal and
// stream lines (docs/3d/world.md §1.4, §2.6).

import { ringOf, type CityData } from '../city';
import type { BuildContext } from './context';
import type { Occupancy } from './occupancy';
import { G } from './groundPalette';
import { shade, type MeshWriter, type RGB } from './mesh';
import {
  band,
  ccwRing,
  clipHalf,
  clipRect,
  lineCrossings,
  offsetLine,
  PAINT_Y,
  Path,
  ringArea2,
  ringBBox,
  ringFrame,
  ringSimple,
  segCross,
  wallBand,
} from './paths';
import { box, pointInRing, type Ring } from './shapes';

export type WaterKind = 'moat' | 'river' | 'canal' | 'pond';

/** Water surface height below the street, m (docs/3d/world.md §2.6). */
export const WATER_LEVEL: Record<WaterKind, number> = { moat: -1.6, river: -3.5, canal: -2.0, pond: -0.8 };

const WATER_COLOUR: Record<WaterKind, RGB> = { moat: G.moat, river: G.river, canal: G.canal, pond: G.pond };

/** A body of water sunk below the street. */
export interface WaterBody {
  kind: WaterKind;
  /** Outline at street level, counter-clockwise. */
  ring: Ring;
  /** Islands, counter-clockwise. */
  islands: Ring[];
  /** Surface height, m. */
  level: number;
  /** Per outline edge (i → i + 1): true where the kept-area boundary cut the body, so it has no bank there. */
  cut: boolean[];
}

export interface WaterPlan {
  bodies: WaterBody[];
  /** Water drawn flat at street level (parts outside the kept area, bodies that could not be sunk). */
  flat: { ring: Ring; kind: WaterKind }[];
  /** Outlines of every river area, sunk or not. */
  riverRings: Ring[];
}

/** Point lookup of the sunken bodies. */
export class WaterIndex<B extends { ring: Ring; islands: Ring[]; level: number } = { ring: Ring; islands: Ring[]; level: number }> {
  private readonly cell = 100;
  private readonly grid = new Map<number, number[]>();
  readonly bodies: B[];
  private readonly boxes: [number, number, number, number][];

  constructor(bodies: B[]) {
    this.bodies = bodies;
    this.boxes = bodies.map((b) => ringBBox(b.ring));
    this.boxes.forEach(([x0, y0, x1, y1], i) => {
      for (let cx = Math.floor(x0 / this.cell); cx <= Math.floor(x1 / this.cell); cx++) {
        for (let cy = Math.floor(y0 / this.cell); cy <= Math.floor(y1 / this.cell); cy++) {
          const k = cx * 100_003 + cy;
          const list = this.grid.get(k);
          if (list) list.push(i);
          else this.grid.set(k, [i]);
        }
      }
    });
  }

  /** The body whose water covers (x, y), if any. */
  at(x: number, y: number): B | null {
    const list = this.grid.get(Math.floor(x / this.cell) * 100_003 + Math.floor(y / this.cell));
    if (!list) return null;
    for (const i of list) {
      const [x0, y0, x1, y1] = this.boxes[i];
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const b = this.bodies[i];
      if (pointInRing(x, y, b.ring) && !b.islands.some((r) => pointInRing(x, y, r))) return b;
    }
    return null;
  }
}

/** Is a water area a canal (long and narrow) rather than a pond? */
function isCanal(ring: Ring): boolean {
  const f = ringFrame(ring);
  const L = f.u1 - f.u0;
  const W = f.v1 - f.v0;
  const fill = Math.abs(ringArea2(ring)) / 2 / Math.max(1, L * W);
  return (L / Math.max(W, 0.1) >= 4 && W <= 40) || (fill < 0.3 && L > 150);
}

function overlaps(a: Ring, ab: [number, number, number, number], b: Ring, bb: [number, number, number, number]): boolean {
  if (ab[0] > bb[2] || bb[0] > ab[2] || ab[1] > bb[3] || bb[1] > ab[3]) return false;
  if (pointInRing(a[0][0], a[0][1], b) || pointInRing(b[0][0], b[0][1], a)) return true;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = a[(i + 1) % a.length];
    const x0 = Math.min(p[0], q[0]);
    const x1 = Math.max(p[0], q[0]);
    const y0 = Math.min(p[1], q[1]);
    const y1 = Math.max(p[1], q[1]);
    if (x1 < bb[0] || x0 > bb[2] || y1 < bb[1] || y0 > bb[3]) continue;
    for (let j = 0; j < b.length; j++) if (segCross(p, q, b[j], b[(j + 1) % b.length])) return true;
  }
  return false;
}

function dedupe(r: Ring): Ring {
  const out: Ring = [];
  for (const p of r) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.01) out.push(p);
  }
  while (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 0.01) out.pop();
  return out;
}

/** Decide which water areas are sunk, clipped to the kept area; the rest is drawn flat. */
export function planWater(city: CityData, keep: [number, number, number, number]): WaterPlan {
  const [kx0, ky0, kx1, ky1] = keep;
  // Sunken bodies stay just inside the kept area so the ground around them is closed.
  const ix0 = kx0 + 0.5;
  const iy0 = ky0 + 0.5;
  const ix1 = kx1 - 0.5;
  const iy1 = ky1 - 0.5;
  const PRIORITY: Record<WaterKind, number> = { moat: 0, river: 1, canal: 2, pond: 3 };
  const cands: { kind: WaterKind; ring: Ring; holes: Ring[]; area: number }[] = [];
  const riverRings: Ring[] = [];
  for (const a of city.areas) {
    const k = city.areaKinds[a.k];
    if (k !== 'moat' && k !== 'river' && k !== 'water') continue;
    const ring = dedupe(ccwRing(ringOf(a.r)));
    if (ring.length < 3) continue;
    const kind: WaterKind = k === 'moat' ? 'moat' : k === 'river' ? 'river' : isCanal(ring) ? 'canal' : 'pond';
    if (kind === 'river') riverRings.push(ring);
    cands.push({ kind, ring, holes: (a.h ?? []).map((h) => dedupe(ccwRing(ringOf(h)))).filter((h) => h.length >= 3), area: Math.abs(ringArea2(ring)) / 2 });
  }
  cands.sort((p, q) => PRIORITY[p.kind] - PRIORITY[q.kind] || q.area - p.area);
  const bodies: WaterBody[] = [];
  const boxes: [number, number, number, number][] = [];
  const flat: WaterPlan['flat'] = [];
  const onEdge = (p: [number, number], q: [number, number]) =>
    (Math.abs(p[0] - ix0) < 1e-6 && Math.abs(q[0] - ix0) < 1e-6) ||
    (Math.abs(p[0] - ix1) < 1e-6 && Math.abs(q[0] - ix1) < 1e-6) ||
    (Math.abs(p[1] - iy0) < 1e-6 && Math.abs(q[1] - iy0) < 1e-6) ||
    (Math.abs(p[1] - iy1) < 1e-6 && Math.abs(q[1] - iy1) < 1e-6);
  for (const c of cands) {
    if (c.area < 12) continue;
    const [bx0, by0, bx1, by1] = ringBBox(c.ring);
    const crosses = bx0 < ix0 || by0 < iy0 || bx1 > ix1 || by1 > iy1;
    const inside = crosses ? dedupe(clipRect(c.ring, ix0, iy0, ix1, iy1)) : c.ring;
    if (crosses) {
      // Parts beyond the kept area are drawn flat.
      const outside = [
        clipHalf(c.ring, 1, 0, ix0),
        clipHalf(c.ring, -1, 0, -ix1),
        clipHalf(clipHalf(clipHalf(c.ring, -1, 0, -ix0), 1, 0, ix1), 0, 1, iy0),
        clipHalf(clipHalf(clipHalf(c.ring, -1, 0, -ix0), 1, 0, ix1), 0, -1, -iy1),
      ];
      for (const o of outside) if (o.length >= 3 && Math.abs(ringArea2(o)) > 2) flat.push({ ring: o, kind: c.kind });
    }
    if (inside.length < 3 || Math.abs(ringArea2(inside)) < 8) continue;
    const ib = ringBBox(inside);
    if (bodies.some((b, i) => overlaps(inside, ib, b.ring, boxes[i]))) continue;
    if (!ringSimple(inside)) {
      flat.push({ ring: inside, kind: c.kind });
      continue;
    }
    const islands = c.holes.filter((h) => {
      const [hx0, hy0, hx1, hy1] = ringBBox(h);
      return hx0 > ix0 && hy0 > iy0 && hx1 < ix1 && hy1 < iy1 && pointInRing(h[0][0], h[0][1], inside);
    });
    const cut = inside.map((p, i) => crosses && onEdge(p, inside[(i + 1) % inside.length]));
    bodies.push({ kind: c.kind, ring: inside, islands, level: WATER_LEVEL[c.kind], cut });
    boxes.push(ib);
  }
  return { bodies, flat, riverRings };
}

/** Mark every 2 m cell under sunken water as occupied, so nothing is scattered into it. */
export function markWater(occ: Occupancy, bodies: WaterBody[]): void {
  for (const b of bodies) {
    const [x0, y0, , y1] = ringBBox(b.ring);
    for (let y = Math.floor(y0 / occ.cell) * occ.cell + occ.cell / 2; y < y1; y += occ.cell) {
      const xs = lineCrossings(b.ring, x0 - 1, y, 1, 0);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const a = x0 - 1 + xs[i];
        const e = x0 - 1 + xs[i + 1];
        for (let x = Math.floor(a / occ.cell) * occ.cell + occ.cell / 2; x < e; x += occ.cell) if (x > a) occ.markDisc(x, y, 0);
      }
    }
  }
}

/** Runs of consecutive uncut edges of a body, as open polylines (or the closed ring when nothing was cut). */
function bankRuns(b: WaterBody): { pts: Ring; closed: boolean }[] {
  const n = b.ring.length;
  if (!b.cut.some(Boolean)) return [{ pts: b.ring, closed: true }];
  const start = b.cut.findIndex((c) => c);
  const runs: { pts: Ring; closed: boolean }[] = [];
  let cur: Ring = [];
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    if (b.cut[i]) {
      if (cur.length >= 2) runs.push({ pts: cur, closed: false });
      cur = [];
      continue;
    }
    if (!cur.length) cur.push(b.ring[i]);
    cur.push(b.ring[(i + 1) % n]);
  }
  if (cur.length >= 2) runs.push({ pts: cur, closed: false });
  return runs;
}

/** Vertical wall down from the street along ring edge a → b, facing the ring's inside (left of travel). */
function wallIn(w: MeshWriter, a: [number, number], b: [number, number], h0: number, h1: number, bottom: RGB, top: RGB): void {
  w.quad([b[0], b[1], h0], [a[0], a[1], h0], [a[0], a[1], h1], [b[0], b[1], h1], bottom, top);
}

/** Vertical wall along edge a → b facing outwards (right of travel), e.g. round an island. */
function wallOut(w: MeshWriter, a: [number, number], b: [number, number], h0: number, h1: number, bottom: RGB, top: RGB): void {
  w.quad([a[0], a[1], h0], [b[0], b[1], h0], [b[0], b[1], h1], [a[0], a[1], h1], bottom, top);
}

/** Water surfaces, banks, parapets and grass strips of the sunken bodies, plus flat water. */
export function buildWater(ctx: BuildContext, plan: WaterPlan): void {
  const { w } = ctx;
  for (const b of plan.bodies) {
    const { ring, level } = b;
    const n = ring.length;
    w.water.polygon(ring, b.islands.length ? b.islands : undefined, level, WATER_COLOUR[b.kind]);
    const floor = level - 0.4;
    for (const isl of b.islands) {
      w.ground.polygon(isl, undefined, 0, G.grassBank);
      for (let i = 0; i < isl.length; i++) wallOut(w.water, isl[i], isl[(i + 1) % isl.length], floor, 0, G.concreteWet, G.stone);
    }
    if (b.kind === 'river') {
      // Sloped banks from the street down to below the waterline.
      const inset = offsetLine(ring, 7, true);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (b.cut[i]) {
          // The river runs on past the kept area: a water-coloured drop instead of a bank.
          wallIn(w.water, ring[i], ring[j], floor, 0, shade(G.river, 0.8), G.river);
          continue;
        }
        w.water.quad([ring[i][0], ring[i][1], 0], [ring[j][0], ring[j][1], 0], [inset[j][0], inset[j][1], floor], [inset[i][0], inset[i][1], floor], G.grassBank, G.mud);
      }
      continue;
    }
    const [bottom, top] = b.kind === 'moat' ? [G.brickWet, G.brick] : b.kind === 'canal' ? [G.concreteWet, G.concrete] : [G.concreteWet, G.stone];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (b.cut[i]) wallIn(w.water, ring[i], ring[j], floor, 0, shade(WATER_COLOUR[b.kind], 0.8), WATER_COLOUR[b.kind]);
      else wallIn(w.water, ring[i], ring[j], floor, 0, bottom, top);
    }
    for (const run of bankRuns(b)) {
      if (b.kind === 'moat') {
        // Grass strip beyond the parapet (the land is right of travel), then a low brick parapet with posts.
        band(w.roads, run.pts, -3.8, -0.3, PAINT_Y, G.grassStrip, run.closed);
        wallBand(w.structures, run.pts, -0.35, 0, 0, 0.55, G.brick, G.brickCap, run.closed);
        const path = new Path(run.closed ? [...run.pts, run.pts[0]] : run.pts);
        for (let s = 2.5; s < path.length - 1; s += 6) {
          const [x, y, ux, uy] = path.at(s);
          box(w.structures, x + uy * 0.175, y - ux * 0.175, 0.45, 0.45, 0, 0.85, Math.atan2(uy, ux), G.brick, G.brickCap);
        }
      } else if (b.kind === 'canal') {
        band(w.roads, run.pts, -0.7, 0, PAINT_Y, G.concrete, run.closed);
        wallBand(w.structures, run.pts, -0.22, 0, 0, 0.75, G.concrete, shade(G.concrete, 1.08), run.closed);
      } else {
        band(w.roads, run.pts, -0.6, 0, PAINT_Y, G.stone, run.closed);
      }
    }
  }
  for (const f of plan.flat) w.roads.polygon(f.ring, undefined, PAINT_Y, WATER_COLOUR[f.kind]);
}

/** Canal, stream and drain lines as painted channels, and river centrelines beyond the river areas. */
export function buildChannels(ctx: BuildContext, plan: WaterPlan, index: WaterIndex<WaterBody>): void {
  const { city, w } = ctx;
  const riverBoxes = plan.riverRings.map(ringBBox);
  const inRiver = (x: number, y: number) =>
    plan.riverRings.some((r, i) => x >= riverBoxes[i][0] && x <= riverBoxes[i][2] && y >= riverBoxes[i][1] && y <= riverBoxes[i][3] && pointInRing(x, y, r));
  for (const l of city.lines) {
    const kind = city.lineKinds[l.k];
    if (kind !== 'canal' && kind !== 'stream' && kind !== 'drain' && kind !== 'river') continue;
    const pts = ringOf(l.p);
    if (pts.length < 2) continue;
    const width = l.w ? l.w / 10 : kind === 'canal' ? 6 : kind === 'stream' ? 3 : kind === 'drain' ? 1.6 : 40;
    const hw = (kind === 'river' ? Math.max(width, 30) : width) / 2;
    // Runs of segments whose middle is not already water.
    let run: Ring = [];
    const flush = () => {
      if (run.length >= 2) channel(w.roads, run, hw, kind);
      run = [];
    };
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i - 1][0] + pts[i][0]) / 2;
      const my = (pts[i - 1][1] + pts[i][1]) / 2;
      const wet = index.at(mx, my) !== null || (kind === 'river' && inRiver(mx, my));
      if (wet) {
        flush();
        continue;
      }
      if (!run.length) run.push(pts[i - 1]);
      run.push(pts[i]);
    }
    flush();
  }
}

function channel(w: MeshWriter, pts: Ring, hw: number, kind: string): void {
  if (kind === 'canal' && hw >= 1.5) {
    // Concrete channel: coping, the shadowed inner walls, then the water.
    band(w, pts, -hw - 0.4, hw + 0.4, PAINT_Y, G.concrete);
    band(w, pts, -hw, hw, PAINT_Y, G.concreteWet);
    band(w, pts, -hw + 0.7, hw - 0.7, PAINT_Y, G.canal);
    return;
  }
  if (kind === 'river') {
    band(w, pts, -hw - 4, hw + 4, PAINT_Y, G.grassBank);
    band(w, pts, -hw, hw, PAINT_Y, G.river);
    return;
  }
  band(w, pts, -hw - 0.7, hw + 0.7, PAINT_Y, G.grassBank);
  band(w, pts, -hw, hw, PAINT_Y, kind === 'canal' ? G.canal : G.pond);
}
