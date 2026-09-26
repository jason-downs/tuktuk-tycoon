// Low-poly festival and market models, built triangle by triangle with flat
// normals and linear vertex colours (for the shared model material or the
// lantern material). Models face +X at yaw 0; Y is up.
// - Lanterns (khom khwaen): hang from the origin (the string) down to ≈ −1 m.
// - Stall canopy and stall base: a 1 × 1 m footprint at scale 1, centred on
//   the origin, front towards +X; scale the instance to the canopy size.
// - Krathong: a 0.3 m banana-leaf float with a lotus of petals and a candle.

import { BufferGeometry, Color, Float32BufferAttribute } from 'three';

type P3 = [number, number, number];

/** Collects flat-shaded, vertex-coloured triangles. */
export class TriBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly col: number[] = [];

  /** Triangle a → b → c, counter-clockwise seen from the side it faces. */
  tri(a: P3, b: P3, c: P3, colour: Color): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(nx, ny, nz);
      this.col.push(colour.r, colour.g, colour.b);
    }
  }

  quad(a: P3, b: P3, c: P3, d: P3, colour: Color): void {
    this.tri(a, b, c, colour);
    this.tri(a, c, d, colour);
  }

  /** n-sided prism (or frustum) around the Y axis from y0 (radius r0) to y1 (radius r1), sides only. */
  ring(r0: number, r1: number, y0: number, y1: number, n: number, colour: Color, rot = 0): void {
    for (let i = 0; i < n; i++) {
      const a0 = rot + (i / n) * Math.PI * 2;
      const a1 = rot + ((i + 1) / n) * Math.PI * 2;
      // Angles run from +X towards −Z (counter-clockwise seen from above); a0 → a1 along the bottom faces outwards.
      const p = (r: number, a: number, y: number): P3 => [Math.cos(a) * r, y, -Math.sin(a) * r];
      this.quad(p(r0, a0, y0), p(r0, a1, y0), p(r1, a1, y1), p(r1, a0, y1), colour);
    }
  }

  /** n-sided cone around the Y axis: base ring of radius r at yBase, apex at yTip (above or below), sides facing out. */
  cone(r: number, yBase: number, yTip: number, n: number, colour: Color, rot = 0): void {
    const p = (a: number): P3 => [Math.cos(a) * r, yBase, -Math.sin(a) * r];
    const apex: P3 = [0, yTip, 0];
    for (let i = 0; i < n; i++) {
      const a0 = p(rot + (i / n) * Math.PI * 2);
      const a1 = p(rot + ((i + 1) / n) * Math.PI * 2);
      if (yTip > yBase) this.tri(a0, a1, apex, colour);
      else this.tri(apex, a1, a0, colour);
    }
  }

  /** Flat n-gon cap at height y, facing up (or down). */
  cap(r: number, y: number, n: number, colour: Color, up: boolean, rot = 0): void {
    const p = (a: number): P3 => [Math.cos(a) * r, y, -Math.sin(a) * r];
    for (let i = 1; i < n - 1; i++) {
      const a = p(rot);
      const b = p(rot + (i / n) * Math.PI * 2);
      const c = p(rot + ((i + 1) / n) * Math.PI * 2);
      if (up) this.tri(a, b, c, colour);
      else this.tri(a, c, b, colour);
    }
  }

  /** Axis-aligned box from (x0, y0, z0) to (x1, y1, z1); `bottom` adds the underside. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, colour: Color, bottom = false): void {
    // +Y
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], colour);
    // +X, −X
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], colour);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], colour);
    // +Z, −Z
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], colour);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], colour);
    if (bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], colour);
  }

  /** Move the last n triangles by (x, 0, z). */
  translateLast(n: number, x: number, z: number): void {
    for (let i = this.pos.length - n * 9; i < this.pos.length; i += 3) {
      this.pos[i] += x;
      this.pos[i + 2] += z;
    }
  }

  get triangleCount(): number {
    return this.pos.length / 9;
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const c = (h: string) => new Color(h);

/**
 * Khom khwaen hanging lantern: a hexagonal paper drum with pointed caps and a
 * tassel, hung from the origin. White parts take the instance colour.
 */
export function lanternGeometry(): BufferGeometry {
  const b = new TriBuilder();
  const paper = c('#ffffff');
  const trim = c('#f3d58a');
  const tassel = c('#fff4dc');
  // Upper cone (its tip touches the string), drum, lower cone, tassel.
  b.cone(0.23, -0.26, 0, 6, trim);
  b.ring(0.23, 0.23, -0.66, -0.26, 6, paper);
  b.cone(0.23, -0.66, -0.84, 6, trim);
  b.ring(0.035, 0.012, -1.12, -0.8, 3, tassel);
  return b.geometry();
}

/** Canopy of a market stall: a shallow square pyramid with a valance, 1 m square at scale 1. White takes the instance colour. */
export function stallCanopyGeometry(): BufferGeometry {
  const b = new TriBuilder();
  const cloth = c('#ffffff');
  const h = 0.5;
  const eave = 1.12;
  const peak = 1.34;
  const corners: P3[] = [
    [h, eave, h],
    [h, eave, -h],
    [-h, eave, -h],
    [-h, eave, h],
  ];
  const top: P3 = [0, peak, 0];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const d = corners[(i + 1) % 4];
    // Roof face (outwards and up), then the valance hanging below the eave.
    b.tri(a, d, top, cloth);
    b.quad([a[0], eave - 0.12, a[2]], [d[0], eave - 0.12, d[2]], d, a, cloth);
  }
  return b.geometry();
}

/** Stall base: four poles, a table with a cloth skirt and a row of goods, 1 m square at scale 1. */
export function stallBaseGeometry(): BufferGeometry {
  const b = new TriBuilder();
  const pole = c('#8a8f96');
  const table = c('#c9b79a');
  const skirt = c('#e9e2d4');
  const goods = [c('#e05a47'), c('#f2c230'), c('#5aa06a')];
  const p = 0.02;
  for (const [x, z] of [
    [0.48, 0.48],
    [0.48, -0.48],
    [-0.48, -0.48],
    [-0.48, 0.48],
  ]) {
    b.ring(p * 1.41, p * 1.41, 0, 1.12, 4, pole, Math.PI / 4);
    b.translateLast(8, x, z);
  }
  b.box(-0.05, 0.36, -0.47, 0.45, 0.39, 0.47, table);
  b.quad([0.45, 0.05, 0.47], [0.45, 0.05, -0.47], [0.45, 0.36, -0.47], [0.45, 0.36, 0.47], skirt);
  for (let i = 0; i < 3; i++) {
    const z0 = -0.44 + i * 0.3;
    b.box(0.05, 0.39, z0, 0.38, 0.43 + (i % 2) * 0.03, z0 + 0.26, goods[i]);
  }
  return b.geometry();
}

/** Krathong: a green banana-leaf ring, a cone of cream petals and a candle, ≈ 0.3 m across. */
export function krathongGeometry(): BufferGeometry {
  const b = new TriBuilder();
  b.ring(0.15, 0.16, 0, 0.06, 8, c('#4f8a3a'));
  b.cap(0.16, 0.06, 8, c('#5f9a44'), true);
  b.ring(0.11, 0.03, 0.06, 0.2, 8, c('#f4e7d0'), Math.PI / 8);
  b.box(-0.01, 0.2, -0.01, 0.01, 0.27, 0.01, c('#fff3c4'));
  return b.geometry();
}
