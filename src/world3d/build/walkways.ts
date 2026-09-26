// Walk runs for the ambient crowds (src/world3d/crowd.ts): lines along the
// pavements of every road up to living streets (the middle of the pavement
// where one is drawn, just off the carriageway edge on sois), loops inside
// pedestrian plazas, and the aisles of the two walking streets (Ratchadamnoen
// on Sunday, Wua Lai on Saturday) which run down the closed carriageway. Runs
// stop wherever they would cross another carriageway, a building, a city wall
// or water; nearby run ends are linked so walkers turn corners and cross side
// sois.
//
// Output goes through addProp as invisible prop kinds (no model is registered
// for them): 'walk', 'walk_sun', 'walk_sat' hold x, y, heading to the next
// vertex and distance to it (0 ends a run); 'walk_link' holds pairs of linked
// run-end indices into 'walk'.

import { ringOf, ROAD_FLAG } from '../city';
import { addProp, type BuildContext } from './context';
import { bbox, offset, pointInRing, type Ring } from './shapes';

/** Longest straight between run vertices (m). */
const MAX_SEG = 15;
/** Spacing of the clearance checks along a run (m). */
const CHECK = 3.5;
/** Clearance kept from other carriageways (m). */
const ROAD_MARGIN = 0.25;
/** Farthest run ends that link up (m). */
const LINK_R = 12;
/** Shortest run kept (m). */
const MIN_RUN = 8;
/** Pavement centre beyond the carriageway edge where a pavement is drawn; path offset on sois. */
const PAVE_MID = 0.9;
const SOI_EDGE = 0.55;
const SEG_CELL = 24;
const BLD_CELL = 32;
const WATER_ROW = 8;
const WATER_CELL = 16;

const WATER = new Set(['water', 'moat', 'river', 'pool']);
const SUNDAY_STREET = /^Ra?t?chadamnoen Road$/i;
const SATURDAY_STREET = /^(Wua ?lai|Wualai) Road$/i;

type Grid = Map<number, number[]>;

const key = (cx: number, cy: number) => (cx + 10_000) * 100_000 + (cy + 10_000);

function gridAdd(grid: Grid, cell: number, x0: number, y0: number, x1: number, y1: number, v: number): void {
  for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++) {
    for (let cy = Math.floor(y0 / cell); cy <= Math.floor(y1 / cell); cy++) {
      const k = key(cx, cy);
      let list = grid.get(k);
      if (!list) grid.set(k, (list = []));
      list.push(v);
    }
  }
}

/** Distance from (px, py) to the segment a–b. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

/** Spatial tests the walk runs must pass: carriageways, buildings and city walls, water. */
export class Clearance {
  private readonly seg: Float64Array;
  private readonly segCls: Uint8Array;
  private readonly segGrid: Grid = new Map();
  /** Building and city-wall outlines as flat x, y metres; outline i spans pairs bldStart[i] … bldStart[i + 1]. */
  private readonly bldPts: Float64Array;
  private readonly bldStart: Int32Array;
  private readonly bldBox: Float64Array;
  private readonly bldGrid: Grid = new Map();
  /** Water ring edges by horizontal band: ring id, x0, y0, x1, y1 per edge. */
  private readonly waterRows = new Map<number, number[]>();
  private readonly waterParity: Uint8Array;
  /** Water state per WATER_CELL cell: 2 where a shore crosses it, else 1 (water) or 0 (land) once tested. */
  private readonly waterCell = new Map<number, number>();

  constructor(ctx: BuildContext) {
    const { city, roadPts } = ctx;
    let n = 0;
    for (const pts of roadPts) n += Math.max(0, pts.length - 1);
    this.seg = new Float64Array(n * 5);
    this.segCls = new Uint8Array(n);
    let s = 0;
    city.roads.ways.forEach((way, wi) => {
      const pts = roadPts[wi];
      const half = way[2] / 20;
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1];
        const [bx, by] = pts[i];
        this.seg.set([ax, ay, bx, by, half], s * 5);
        this.segCls[s] = way[0];
        const pad = half + 1;
        gridAdd(this.segGrid, SEG_CELL, Math.min(ax, bx) - pad, Math.min(ay, by) - pad, Math.max(ax, bx) + pad, Math.max(ay, by) + pad, s);
        s++;
      }
    });
    // Building footprints and the brick city walls, gate towers and bastions: flat x, y rings in decimetres.
    const blds = [...city.buildings.filter((b) => !b.part).map((b) => b.r), ...(city.cityWalls ?? []).map((w) => w.r)];
    let pts = 0;
    for (const r of blds) pts += r.length / 2;
    this.bldPts = new Float64Array(pts * 2);
    this.bldStart = new Int32Array(blds.length + 1);
    this.bldBox = new Float64Array(blds.length * 4);
    let o = 0;
    blds.forEach((r, i) => {
      this.bldStart[i] = o;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let k = 0; k < r.length; k += 2) {
        const x = r[k] / 10;
        const y = r[k + 1] / 10;
        this.bldPts[2 * o] = x;
        this.bldPts[2 * o + 1] = y;
        o++;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      this.bldBox.set([x0, y0, x1, y1], i * 4);
      gridAdd(this.bldGrid, BLD_CELL, x0, y0, x1, y1, i);
    });
    this.bldStart[blds.length] = o;
    let rings = 0;
    for (const a of city.areas) {
      if (!WATER.has(city.areaKinds[a.k])) continue;
      const ring = ringOf(a.r);
      const id = rings++;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x0, y0] = ring[j];
        const [x1, y1] = ring[i];
        if (y0 === y1) continue;
        for (let row = Math.floor(Math.min(y0, y1) / WATER_ROW); row <= Math.floor(Math.max(y0, y1) / WATER_ROW); row++) {
          let list = this.waterRows.get(row);
          if (!list) this.waterRows.set(row, (list = []));
          list.push(id, x0, y0, x1, y1);
        }
        for (let cx = Math.floor(Math.min(x0, x1) / WATER_CELL); cx <= Math.floor(Math.max(x0, x1) / WATER_CELL); cx++) {
          for (let cy = Math.floor(Math.min(y0, y1) / WATER_CELL); cy <= Math.floor(Math.max(y0, y1) / WATER_CELL); cy++) this.waterCell.set(key(cx, cy), 2);
        }
      }
    }
    this.waterParity = new Uint8Array(rings);
  }

  /** Is the point on a carriageway (within its half-width + margin)? Roads of class ≥ minorFrom are ignored. */
  onRoad(x: number, y: number, margin = ROAD_MARGIN, minorFrom = 99): boolean {
    const list = this.segGrid.get(key(Math.floor(x / SEG_CELL), Math.floor(y / SEG_CELL)));
    if (!list) return false;
    const s = this.seg;
    for (const i of list) {
      if (this.segCls[i] >= minorFrom) continue;
      const o = i * 5;
      if (segDist(x, y, s[o], s[o + 1], s[o + 2], s[o + 3]) < s[o + 4] + margin) return true;
    }
    return false;
  }

  inBuilding(x: number, y: number): boolean {
    const list = this.bldGrid.get(key(Math.floor(x / BLD_CELL), Math.floor(y / BLD_CELL)));
    if (!list) return false;
    const box = this.bldBox;
    const p = this.bldPts;
    for (const i of list) {
      if (x < box[i * 4] || x > box[i * 4 + 2] || y < box[i * 4 + 1] || y > box[i * 4 + 3]) continue;
      const a = this.bldStart[i];
      const b = this.bldStart[i + 1];
      let inside = false;
      for (let k = a, j = b - 1; k < b; j = k++) {
        const yi = p[2 * k + 1];
        const yj = p[2 * j + 1];
        if (yi > y !== yj > y && x < ((p[2 * j] - p[2 * k]) * (y - yi)) / (yj - yi) + p[2 * k]) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  }

  /** Is the point in water? Cells no shore crosses are tested once, at their centre. */
  inWater(x: number, y: number): boolean {
    const cx = Math.floor(x / WATER_CELL);
    const cy = Math.floor(y / WATER_CELL);
    const k = key(cx, cy);
    const state = this.waterCell.get(k);
    if (state === 2) return this.waterTest(x, y);
    if (state !== undefined) return state === 1;
    const inside = this.waterTest((cx + 0.5) * WATER_CELL, (cy + 0.5) * WATER_CELL);
    this.waterCell.set(k, inside ? 1 : 0);
    return inside;
  }

  /** Even-odd test against each water ring, using only the edges that span the point's band. */
  private waterTest(x: number, y: number): boolean {
    const list = this.waterRows.get(Math.floor(y / WATER_ROW));
    if (!list) return false;
    const parity = this.waterParity;
    parity.fill(0);
    let any = false;
    for (let k = 0; k < list.length; k += 5) {
      const y0 = list[k + 2];
      const y1 = list[k + 4];
      if (y0 > y !== y1 > y) {
        const x0 = list[k + 1];
        const x1 = list[k + 3];
        if (x < ((x1 - x0) * (y - y0)) / (y1 - y0) + x0) {
          parity[list[k]] ^= 1;
          any = true;
        }
      }
    }
    if (!any) return false;
    for (let i = 0; i < parity.length; i++) if (parity[i]) return true;
    return false;
  }
}

/** Densify a polyline so no straight is longer than MAX_SEG. */
function densify(pts: Ring): Ring {
  const out: Ring = [];
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const n = Math.ceil(Math.hypot(bx - ax, by - ay) / MAX_SEG);
      for (let k = 1; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
    }
    out.push(pts[i]);
  }
  return out;
}

/**
 * Split a line into runs whose every stretch passes `ok` (checked every CHECK
 * metres, ends included), dropping runs shorter than MIN_RUN.
 */
function runsAlong(pts: Ring, ok: (x: number, y: number) => boolean): Ring[] {
  const runs: Ring[] = [];
  let cur: Ring = [];
  let curLen = 0;
  const close = () => {
    if (cur.length >= 2 && curLen >= MIN_RUN) runs.push(cur);
    cur = [];
    curLen = 0;
  };
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    if (!ok(x, y)) {
      close();
      continue;
    }
    if (cur.length) {
      const [ax, ay] = cur[cur.length - 1];
      const len = Math.hypot(x - ax, y - ay);
      if (len < 0.5) continue;
      const n = Math.ceil(len / CHECK);
      let clear = true;
      for (let k = 1; k < n && clear; k++) clear = ok(ax + ((x - ax) * k) / n, ay + ((y - ay) * k) / n);
      if (!clear) {
        close();
        cur.push([x, y]);
        continue;
      }
      curLen += len;
    }
    cur.push([x, y]);
  }
  close();
  return runs;
}

function emit(ctx: BuildContext, kind: string, run: Ring): number {
  const first = (ctx.props[kind]?.length ?? 0) / 4;
  for (let i = 0; i < run.length; i++) {
    const [x, y] = run[i];
    const nxt = run[i + 1];
    const prv = run[i - 1];
    const yaw = nxt ? Math.atan2(nxt[1] - y, nxt[0] - x) : Math.atan2(y - prv[1], x - prv[0]);
    addProp(ctx, kind, x, y, yaw, nxt ? Math.hypot(nxt[0] - x, nxt[1] - y) : 0);
  }
  return first;
}

export function buildWalkways(ctx: BuildContext): void {
  const { city, roadPts } = ctx;
  const [px0, py0, px1, py1] = city.play.map((v) => v / 10);
  const inPlay = (x: number, y: number) => x >= px0 && x <= px1 && y >= py0 && y <= py1;
  const clear = new Clearance(ctx);
  const pavementOk = (x: number, y: number) => inPlay(x, y) && !clear.onRoad(x, y) && !clear.inBuilding(x, y) && !clear.inWater(x, y);
  const ends: { idx: number; x: number; y: number; run: number }[] = [];
  let runId = 0;
  const addRun = (run: Ring) => {
    const first = emit(ctx, 'walk', run);
    ends.push({ idx: first, x: run[0][0], y: run[0][1], run: runId });
    ends.push({ idx: first + run.length - 1, x: run[run.length - 1][0], y: run[run.length - 1][1], run: runId });
    runId++;
  };

  city.roads.ways.forEach((way, wi) => {
    const [cls, flags, widthDm] = way;
    if (cls > 6 || flags & ROAD_FLAG.TUNNEL) return;
    const pts = roadPts[wi];
    if (pts.length < 2) return;
    const [bx0, by0, bx1, by1] = bbox(pts);
    if (bx1 < px0 || bx0 > px1 || by1 < py0 || by0 > py1) return;
    const half = widthDm / 20;
    const name = ctx.str(way[4]);
    const street = SUNDAY_STREET.test(name) ? 'walk_sun' : SATURDAY_STREET.test(name) ? 'walk_sat' : '';
    if (street) {
      // Two aisles down the closed street, between the kerb stalls and the centre row.
      for (const side of [1, -1]) {
        const line = densify(offset(pts, side * half * 0.45));
        for (const run of runsAlong(line, (x, y) => inPlay(x, y) && !clear.inBuilding(x, y))) emit(ctx, street, run);
      }
    }
    const hasWalk = cls <= 3 || (flags & (ROAD_FLAG.SIDEWALK_L | ROAD_FLAG.SIDEWALK_R)) !== 0;
    const d = half + (hasWalk ? PAVE_MID : SOI_EDGE);
    for (const side of [1, -1]) for (const run of runsAlong(densify(offset(pts, side * d)), pavementOk)) addRun(run);
  });

  // Loops just inside pedestrian plazas (the Tha Phae Gate square).
  for (const a of city.areas) {
    if (city.areaKinds[a.k] !== 'plaza') continue;
    const ring = ringOf(a.r);
    const [x0, y0, x1, y1] = bbox(ring);
    if ((x1 - x0) * (y1 - y0) < 400) continue;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const loop: Ring = ring.map(([x, y]) => {
      const dx = cx - x;
      const dy = cy - y;
      const l = Math.hypot(dx, dy) || 1;
      const inset = Math.min(4, l * 0.3);
      return [x + (dx / l) * inset, y + (dy / l) * inset];
    });
    loop.push(loop[0]);
    for (const run of runsAlong(densify(loop), (x, y) => pavementOk(x, y) && pointInRing(x, y, ring))) addRun(run);
  }

  // Link run ends nearest-first, where the way across avoids buildings, water and main roads.
  const endGrid: Grid = new Map();
  ends.forEach((e, i) => gridAdd(endGrid, LINK_R, e.x, e.y, e.x, e.y, i));
  const pairs: [number, number, number][] = [];
  ends.forEach((e, i) => {
    const cx = Math.floor(e.x / LINK_R);
    const cy = Math.floor(e.y / LINK_R);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of endGrid.get(key(cx + dx, cy + dy)) ?? []) {
          if (j <= i || ends[j].run === e.run) continue;
          const d = Math.hypot(ends[j].x - e.x, ends[j].y - e.y);
          if (d <= LINK_R) pairs.push([d, i, j]);
        }
      }
    }
  });
  pairs.sort((p, q) => p[0] - q[0]);
  const linked = new Uint8Array(ends.length);
  for (const [d, i, j] of pairs) {
    if (linked[i] || linked[j]) continue;
    const a = ends[i];
    const b = ends[j];
    const n = Math.max(1, Math.ceil(d));
    let ok = true;
    for (let k = 1; k < n && ok; k++) {
      const x = a.x + ((b.x - a.x) * k) / n;
      const y = a.y + ((b.y - a.y) * k) / n;
      ok = !clear.inBuilding(x, y) && !clear.inWater(x, y) && !clear.onRoad(x, y, 0, 5);
    }
    if (!ok) continue;
    linked[i] = linked[j] = 1;
    addProp(ctx, 'walk_link', a.idx, b.idx, 0, 0);
  }
}
