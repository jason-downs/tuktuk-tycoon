// Grid index of road centreline segments with their class and half-width, for
// finding a site's street side and keeping walls off carriageways.

import type { CityData } from '../city';

export interface RoadHit {
  d: number;
  /** Closest point on the centreline. */
  x: number;
  y: number;
  cls: number;
  half: number;
  way: number;
}

export class RoadIndex {
  private readonly cell = 40;
  private readonly grid = new Map<number, number[]>();
  /** Segments: ax, ay, bx, by, cls, half, way. */
  private readonly seg: number[] = [];

  constructor(city: CityData) {
    const rn = city.roads.nodes;
    city.roads.ways.forEach((way, wi) => {
      const [cls, , widthDm] = way;
      const half = widthDm / 20;
      for (let i = 8; i < way.length; i++) {
        const a = way[i - 1];
        const b = way[i];
        const k = this.seg.length / 7;
        const ax = rn[2 * a] / 10;
        const ay = rn[2 * a + 1] / 10;
        const bx = rn[2 * b] / 10;
        const by = rn[2 * b + 1] / 10;
        this.seg.push(ax, ay, bx, by, cls, half, wi);
        const x0 = Math.floor(Math.min(ax, bx) / this.cell);
        const x1 = Math.floor(Math.max(ax, bx) / this.cell);
        const y0 = Math.floor(Math.min(ay, by) / this.cell);
        const y1 = Math.floor(Math.max(ay, by) / this.cell);
        for (let cx = x0; cx <= x1; cx++) {
          for (let cy = y0; cy <= y1; cy++) {
            const key = this.key(cx, cy);
            let list = this.grid.get(key);
            if (!list) this.grid.set(key, (list = []));
            list.push(k);
          }
        }
      }
    });
  }

  private key(cx: number, cy: number): number {
    return (cx + 4096) * 8192 + (cy + 4096);
  }

  /** Nearest segment within `max` metres of class ≤ maxCls, or null. */
  nearest(x: number, y: number, max: number, maxCls = 99): RoadHit | null {
    const r = Math.ceil(max / this.cell);
    const gx = Math.floor(x / this.cell);
    const gy = Math.floor(y / this.cell);
    let best: RoadHit | null = null;
    const s = this.seg;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const list = this.grid.get(this.key(gx + dx, gy + dy));
        if (!list) continue;
        for (const k of list) {
          const o = k * 7;
          if (s[o + 4] > maxCls) continue;
          const ax = s[o];
          const ay = s[o + 1];
          const vx = s[o + 2] - ax;
          const vy = s[o + 3] - ay;
          const l2 = vx * vx + vy * vy || 1e-12;
          const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2));
          const px = ax + vx * t;
          const py = ay + vy * t;
          const d = Math.hypot(px - x, py - y);
          if (d <= max && (!best || d < best.d)) best = { d, x: px, y: py, cls: s[o + 4], half: s[o + 5], way: s[o + 6] };
        }
      }
    }
    return best;
  }

  /** True when (x, y) lies on a carriageway (within its half-width plus `pad`). */
  onCarriageway(x: number, y: number, pad = 0): boolean {
    const gx = Math.floor(x / this.cell);
    const gy = Math.floor(y / this.cell);
    const s = this.seg;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = this.grid.get(this.key(gx + dx, gy + dy));
        if (!list) continue;
        for (const k of list) {
          const o = k * 7;
          const ax = s[o];
          const ay = s[o + 1];
          const vx = s[o + 2] - ax;
          const vy = s[o + 3] - ay;
          const l2 = vx * vx + vy * vy || 1e-12;
          const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2));
          if (Math.hypot(ax + vx * t - x, ay + vy * t - y) < s[o + 5] + pad) return true;
        }
      }
    }
    return false;
  }
}
