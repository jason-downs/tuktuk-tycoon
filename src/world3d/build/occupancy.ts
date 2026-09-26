import { pointInRing, type Ring } from './shapes';

/** Coarse raster of built-up cells (buildings and carriageways) for scattering props. */
export class Occupancy {
  readonly cell = 2;
  readonly nx: number;
  readonly ny: number;
  private readonly bits: Uint8Array;
  private readonly x0: number;
  private readonly y0: number;

  constructor(x0: number, y0: number, x1: number, y1: number) {
    this.x0 = x0;
    this.y0 = y0;
    this.nx = Math.ceil((x1 - x0) / this.cell);
    this.ny = Math.ceil((y1 - y0) / this.cell);
    this.bits = new Uint8Array(this.nx * this.ny);
  }

  private idx(x: number, y: number): number {
    const i = Math.floor((x - this.x0) / this.cell);
    const j = Math.floor((y - this.y0) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return -1;
    return j * this.nx + i;
  }

  markDisc(x: number, y: number, r: number): void {
    const c = this.cell;
    for (let yy = y - r; yy <= y + r; yy += c) {
      for (let xx = x - r; xx <= x + r; xx += c) {
        if ((xx - x) ** 2 + (yy - y) ** 2 > r * r) continue;
        const i = this.idx(xx, yy);
        if (i >= 0) this.bits[i] = 1;
      }
    }
  }

  markRing(ring: Ring, pad: number): void {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of ring) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    for (let y = y0 - pad; y <= y1 + pad; y += this.cell) {
      for (let x = x0 - pad; x <= x1 + pad; x += this.cell) {
        if (pad > 0 || pointInRing(x, y, ring)) {
          const i = this.idx(x, y);
          if (i >= 0) this.bits[i] = 1;
        }
      }
    }
  }

  free(x: number, y: number): boolean {
    const i = this.idx(x, y);
    return i >= 0 && this.bits[i] === 0;
  }
}
