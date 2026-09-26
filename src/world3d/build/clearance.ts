// Exact obstacle index for placing trees and street props: road carriageways
// (the same ribbons roads.ts draws, mitres and end caps included), building
// footprints, water, rail and runways, walls and footpaths. Complements the
// coarse Occupancy raster, which also blocks pavements and so cannot place
// kerbside props. Pure TypeScript; built once per BuildContext.

import { ringOf, type CityData } from '../city';
import type { Ring } from './shapes';

/** Obstacle kinds (bit flags) for Clearance queries. */
export const OB = {
  ROAD: 1,
  BUILDING: 2,
  WATER: 4,
  /** Rail, runway, taxiway. */
  TRACK: 8,
  /** City walls, garden walls, fences, hedges. */
  WALL: 16,
  /** Footways and steps. */
  PATH: 32,
  PITCH: 64,
  /** Carriageway of a road whose cables are buried (moat roads, Tha Phae, Chang Klan). */
  BURIED: 128,
  /** Plazas and the airport apron: open paving, no trees. */
  PLAZA: 256,
} as const;

/** Everything a tree trunk must avoid. */
export const TREE_BLOCK = OB.ROAD | OB.BUILDING | OB.WATER | OB.TRACK | OB.WALL | OB.PATH | OB.PITCH | OB.PLAZA;
/** Everything a kerbside prop must avoid. */
export const PROP_BLOCK = OB.ROAD | OB.BUILDING | OB.WATER | OB.TRACK | OB.WALL;

/**
 * Left and right outlines of the ribbon MeshWriter.ribbon draws for a
 * polyline: mitred joins (limit 2.5× half-width) and ends pushed out by
 * capExtend. Quads between consecutive pairs make up the carriageway.
 */
export function ribbonOutline(pts: Ring, half: number, capExtend: number): { left: Ring; right: Ring } {
  const n = pts.length;
  const left: Ring = [];
  const right: Ring = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = pts[i];
    let dx0 = 0;
    let dy0 = 0;
    let dx1 = 0;
    let dy1 = 0;
    if (i > 0) {
      dx0 = x - pts[i - 1][0];
      dy0 = y - pts[i - 1][1];
      const l = Math.hypot(dx0, dy0) || 1;
      dx0 /= l;
      dy0 /= l;
    }
    if (i < n - 1) {
      dx1 = pts[i + 1][0] - x;
      dy1 = pts[i + 1][1] - y;
      const l = Math.hypot(dx1, dy1) || 1;
      dx1 /= l;
      dy1 /= l;
    }
    if (i === 0) {
      dx0 = dx1;
      dy0 = dy1;
    }
    if (i === n - 1) {
      dx1 = dx0;
      dy1 = dy0;
    }
    let tx = dx0 + dx1;
    let ty = dy0 + dy1;
    const tl = Math.hypot(tx, ty);
    if (tl < 1e-6) {
      tx = dx1;
      ty = dy1;
    } else {
      tx /= tl;
      ty /= tl;
    }
    const nx = -ty;
    const ny = tx;
    const cosHalf = nx * -dy1 + ny * dx1;
    const miter = Math.min(2.5, 1 / Math.max(0.2, Math.abs(cosHalf) || 1));
    let ex = 0;
    let ey = 0;
    if (i === 0 && capExtend) {
      ex = -dx1 * capExtend;
      ey = -dy1 * capExtend;
    }
    if (i === n - 1 && capExtend) {
      ex = dx0 * capExtend;
      ey = dy0 * capExtend;
    }
    left.push([x + ex + nx * half * miter, y + ey + ny * half * miter]);
    right.push([x + ex - nx * half * miter, y + ey - ny * half * miter]);
  }
  return { left, right };
}

/** Distance from (x, y) to segment a–b. */
export function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2)) : 0;
  return Math.hypot(ax + vx * t - x, ay + vy * t - y);
}

function inFlatRing(x: number, y: number, r: Float64Array): boolean {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[2 * i];
    const yi = r[2 * i + 1];
    const xj = r[2 * j];
    const yj = r[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function flatRingDist(x: number, y: number, r: Float64Array): number {
  let d = Infinity;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) d = Math.min(d, segDist(x, y, r[2 * j], r[2 * j + 1], r[2 * i], r[2 * i + 1]));
  return d;
}

/** Point-in-polygon test with the edges bucketed into horizontal bands, for rings with many vertices. */
export class RingTest {
  private readonly y0: number;
  private readonly band: number;
  private readonly bands: number[][] = [];
  private readonly r: Float64Array;

  constructor(ring: Ring, band = 8) {
    this.band = band;
    this.r = new Float64Array(ring.length * 2);
    let y0 = Infinity;
    let y1 = -Infinity;
    ring.forEach(([x, y], i) => {
      this.r[2 * i] = x;
      this.r[2 * i + 1] = y;
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    });
    this.y0 = y0;
    const nb = Math.max(1, Math.ceil((y1 - y0) / band) + 1);
    for (let b = 0; b < nb; b++) this.bands.push([]);
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const j = (i + n - 1) % n;
      const a = Math.floor((Math.min(ring[i][1], ring[j][1]) - y0) / band);
      const b = Math.floor((Math.max(ring[i][1], ring[j][1]) - y0) / band);
      for (let k = a; k <= b; k++) this.bands[k].push(i);
    }
  }

  inside(x: number, y: number): boolean {
    const b = Math.floor((y - this.y0) / this.band);
    if (b < 0 || b >= this.bands.length) return false;
    const r = this.r;
    const n = r.length / 2;
    let inside = false;
    for (const i of this.bands[b]) {
      const j = (i + n - 1) % n;
      const xi = r[2 * i];
      const yi = r[2 * i + 1];
      const xj = r[2 * j];
      const yj = r[2 * j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
}

/** Inside test for a ring: banded for large rings, a plain crossing test for small ones. */
export function ringTester(ring: Ring): (x: number, y: number) => boolean {
  if (ring.length > BIG_RING) {
    const t = new RingTest(ring);
    return (x, y) => t.inside(x, y);
  }
  const flat = new Float64Array(ring.flat());
  return (x, y) => inFlatRing(x, y, flat);
}

/** Rings with more vertices than this use banded inside tests and per-edge distance tests. */
const BIG_RING = 16;

/** Road carriageway half-width and end-cap extension as roads.ts draws them. */
export function roadHalf(widthDm: number): { half: number; cap: number } {
  const half = widthDm / 20;
  return { half, cap: half * 0.9 };
}

export class Clearance {
  private readonly cell = 24;
  private readonly gx0: number;
  private readonly gy0: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly cells: (number[] | undefined)[];
  // Primitives: polygons (flat rings) and capsules, with kind flags and bounds.
  private readonly polys: Float64Array[] = [];
  /** Banded inside test for big rings (their edges are also indexed as zero-radius capsules). */
  private readonly polyTest: (RingTest | null)[] = [];
  private readonly polyKind: number[] = [];
  private readonly polyBox: number[] = [];
  private readonly segs: number[] = [];
  private readonly segKind: number[] = [];
  private readonly stamp: Uint32Array[] = [new Uint32Array(0), new Uint32Array(0)];
  private query = 0;

  constructor(x0: number, y0: number, x1: number, y1: number) {
    this.gx0 = x0 - 100;
    this.gy0 = y0 - 100;
    this.nx = Math.ceil((x1 - x0 + 200) / this.cell);
    this.ny = Math.ceil((y1 - y0 + 200) / this.cell);
    this.cells = new Array(this.nx * this.ny);
  }

  private insert(id: number, x0: number, y0: number, x1: number, y1: number): void {
    const i0 = Math.max(0, Math.floor((x0 - this.gx0) / this.cell));
    const i1 = Math.min(this.nx - 1, Math.floor((x1 - this.gx0) / this.cell));
    const j0 = Math.max(0, Math.floor((y0 - this.gy0) / this.cell));
    const j1 = Math.min(this.ny - 1, Math.floor((y1 - this.gy0) / this.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) (this.cells[j * this.nx + i] ??= []).push(id);
    }
  }

  /** Add a polygon obstacle (any orientation). */
  addPoly(ring: Ring, kind: number): void {
    if (ring.length < 3) return;
    const flat = new Float64Array(ring.length * 2);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    ring.forEach(([x, y], i) => {
      flat[2 * i] = x;
      flat[2 * i + 1] = y;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    });
    const id = this.polys.length;
    const big = ring.length > BIG_RING;
    this.polys.push(flat);
    this.polyTest.push(big ? new RingTest(ring) : null);
    this.polyKind.push(kind);
    this.polyBox.push(x0, y0, x1, y1);
    this.insert(id * 2, x0, y0, x1, y1);
    if (big) for (let i = 0; i < ring.length; i++) this.addSeg(...ring[i], ...ring[(i + 1) % ring.length], 0, kind);
  }

  /** Add a capsule obstacle: every point within r of segment a–b. */
  addSeg(ax: number, ay: number, bx: number, by: number, r: number, kind: number): void {
    const id = this.segKind.length;
    this.segs.push(ax, ay, bx, by, r);
    this.segKind.push(kind);
    this.insert(id * 2 + 1, Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r);
  }

  /** Add a polyline as capsules, its ends pushed out by `cap`. */
  addLine(pts: Ring, r: number, kind: number, cap = 0): void {
    const n = pts.length;
    if (n < 2) return;
    for (let i = 1; i < n; i++) {
      let [ax, ay] = pts[i - 1];
      let [bx, by] = pts[i];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-6) continue;
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      if (i === 1) {
        ax -= ux * cap;
        ay -= uy * cap;
      }
      if (i === n - 1) {
        bx += ux * cap;
        by += uy * cap;
      }
      this.addSeg(ax, ay, bx, by, r, kind);
    }
  }

  /** Add a road ribbon exactly as drawn: one quad per segment. */
  addRibbon(pts: Ring, half: number, cap: number, kind: number): void {
    if (pts.length < 2) return;
    const { left, right } = ribbonOutline(pts, half, cap);
    for (let i = 1; i < pts.length; i++) this.addPoly([right[i - 1], right[i], left[i], left[i - 1]], kind);
  }

  /**
   * True when an obstacle of a kind in `mask` lies within r of (x, y): the
   * point is inside a polygon or nearer than r to its edge, or nearer than
   * r + radius to a capsule's spine.
   */
  hit(x: number, y: number, r: number, mask: number): boolean {
    const q = ++this.query;
    if (this.stamp[0].length < this.polys.length) this.stamp[0] = new Uint32Array(this.polys.length + 1024);
    if (this.stamp[1].length < this.segKind.length) this.stamp[1] = new Uint32Array(this.segKind.length + 1024);
    const i0 = Math.max(0, Math.floor((x - r - this.gx0) / this.cell));
    const i1 = Math.min(this.nx - 1, Math.floor((x + r - this.gx0) / this.cell));
    const j0 = Math.max(0, Math.floor((y - r - this.gy0) / this.cell));
    const j1 = Math.min(this.ny - 1, Math.floor((y + r - this.gy0) / this.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const list = this.cells[j * this.nx + i];
        if (!list) continue;
        for (const code of list) {
          const id = code >> 1;
          if (code & 1) {
            if (!(this.segKind[id] & mask) || this.stamp[1][id] === q) continue;
            this.stamp[1][id] = q;
            const s = id * 5;
            if (segDist(x, y, this.segs[s], this.segs[s + 1], this.segs[s + 2], this.segs[s + 3]) < r + this.segs[s + 4]) return true;
          } else {
            if (!(this.polyKind[id] & mask) || this.stamp[0][id] === q) continue;
            this.stamp[0][id] = q;
            const b = id * 4;
            if (x < this.polyBox[b] - r || x > this.polyBox[b + 2] + r || y < this.polyBox[b + 1] - r || y > this.polyBox[b + 3] + r) continue;
            const test = this.polyTest[id];
            if (test) {
              if (test.inside(x, y)) return true;
              continue;
            }
            const ring = this.polys[id];
            if (inFlatRing(x, y, ring)) return true;
            if (r > 0 && flatRingDist(x, y, ring) < r) return true;
          }
        }
      }
    }
    return false;
  }
}

/**
 * Spatial registry of placed trees and props. Each item has a hard radius
 * (trunk, pole, footprint) and an optional crown radius that only other
 * crowns respect, so props may stand under trees but crowns do not merge.
 */
export class Placed {
  private readonly cell = 8;
  private readonly map = new Map<number, number[]>();
  private readonly data: number[] = [];
  private maxR = 0;

  private key(i: number, j: number): number {
    return (i + 4096) * 8192 + (j + 4096);
  }

  add(x: number, y: number, r: number, crown = 0): void {
    const id = this.data.length / 4;
    this.data.push(x, y, r, crown);
    this.maxR = Math.max(this.maxR, r, crown);
    const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell));
    let list = this.map.get(k);
    if (!list) this.map.set(k, (list = []));
    list.push(id);
  }

  free(x: number, y: number, r: number, crown = 0): boolean {
    const reach = Math.max(r, crown) + this.maxR;
    const i0 = Math.floor((x - reach) / this.cell);
    const i1 = Math.floor((x + reach) / this.cell);
    const j0 = Math.floor((y - reach) / this.cell);
    const j1 = Math.floor((y + reach) / this.cell);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const list = this.map.get(this.key(i, j));
        if (!list) continue;
        for (const id of list) {
          const d = Math.hypot(this.data[id * 4] - x, this.data[id * 4 + 1] - y);
          if (d < r + this.data[id * 4 + 2]) return false;
          const c = this.data[id * 4 + 3];
          if (crown > 0 && c > 0 && d < crown + c) return false;
        }
      }
    }
    return true;
  }
}

const WATER_AREAS = new Set(['water', 'moat', 'river', 'pool']);

/** Obstacle index for a city; `buried` marks the ways whose carriageways get OB.BURIED too. */
export function buildClearance(city: CityData, keep: [number, number, number, number], buried: (wayIndex: number) => boolean): Clearance {
  const cl = new Clearance(...keep);
  const rn = city.roads.nodes;
  city.roads.ways.forEach((way, wi) => {
    const pts: Ring = way.slice(7).map((n) => [rn[2 * n] / 10, rn[2 * n + 1] / 10]);
    const { half, cap } = roadHalf(way[2]);
    cl.addRibbon(pts, half, cap, OB.ROAD | (buried(wi) ? OB.BURIED : 0));
  });
  for (const b of city.buildings) cl.addPoly(ringOf(b.r), OB.BUILDING);
  for (const a of city.areas) {
    const kind = city.areaKinds[a.k];
    if (WATER_AREAS.has(kind)) cl.addPoly(ringOf(a.r), OB.WATER);
    else if (kind === 'pitch') cl.addPoly(ringOf(a.r), OB.PITCH);
    else if (kind === 'plaza' || kind === 'apron') cl.addPoly(ringOf(a.r), OB.PLAZA);
  }
  for (const l of city.lines) {
    const kind = city.lineKinds[l.k];
    const pts = ringOf(l.p);
    const w = l.w ? l.w / 10 : 0;
    switch (kind) {
      case 'river':
        cl.addLine(pts, (w || 30) / 2, OB.WATER, 2);
        break;
      case 'canal':
        cl.addLine(pts, (w || 6) / 2, OB.WATER, 1);
        break;
      case 'stream':
      case 'drain':
        cl.addLine(pts, (w || 2.5) / 2, OB.WATER, 0.5);
        break;
      case 'rail':
        cl.addLine(pts, 1.8, OB.TRACK);
        break;
      case 'runway':
        cl.addLine(pts, (w || 45) / 2, OB.TRACK, 10);
        break;
      case 'taxiway':
        cl.addLine(pts, (w || 23) / 2, OB.TRACK, 5);
        break;
      case 'city_wall':
        if (l.closed) cl.addPoly(pts, OB.WALL);
        else cl.addLine(pts, 1.6, OB.WALL, 0.5);
        break;
      case 'wall':
        cl.addLine(pts, 0.2, OB.WALL, 0.1);
        break;
      case 'fence':
        cl.addLine(pts, 0.1, OB.WALL);
        break;
      case 'hedge':
        cl.addLine(pts, 0.45, OB.WALL);
        break;
      case 'footway':
      case 'steps':
        cl.addLine(pts, (w || 1.8) / 2, OB.PATH);
        break;
      default:
        break;
    }
  }
  return cl;
}
