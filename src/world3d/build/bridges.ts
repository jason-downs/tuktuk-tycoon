// Bridges (docs/3d/world.md §2.8 #13). A road way flagged as a bridge over
// sunken water gets a concrete deck at street level with slab sides, parapets
// and piers standing in the water; the Iron Bridge (Khua Lek) gets its dark
// steel through truss with a curved top chord and 7 panels per span. Bridges
// over painted canal channels keep to grade with low parapets; other bridges
// (flyovers) are drawn at grade like any road.

import { ringOf } from '../city';
import type { BuildContext } from './context';
import { G } from './groundPalette';
import type { RoadNet, RoadWay } from './junctions';
import { landmarkXY } from './markings';
import { shade, type MeshWriter } from './mesh';
import { band, beam, offsetLine, Path, segCross, wallBand } from './paths';
import { box, type Ring } from './shapes';
import { WaterIndex } from './water';

/** Height of bridge deck tops, m (below the paint at PAINT_Y). */
export const DECK_Y = 0.015;

function distToPath(path: Path, x: number, y: number): number {
  let best = Infinity;
  const p = path.pts;
  for (let i = 1; i < p.length; i++) {
    const vx = p[i][0] - p[i - 1][0];
    const vy = p[i][1] - p[i - 1][1];
    const l2 = vx * vx + vy * vy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - p[i - 1][0]) * vx + (y - p[i - 1][1]) * vy) / l2));
    best = Math.min(best, Math.hypot(p[i - 1][0] + vx * t - x, p[i - 1][1] + vy * t - y));
  }
  return best;
}

export function buildBridges(ctx: BuildContext, net: RoadNet): void {
  const index = new WaterIndex(ctx.waterBodies ?? []);
  const iron = landmarkXY(ctx.city, 'iron_bridge');
  // Channel lines, for bridges over painted canals and streams.
  const channels: Ring[] = [];
  for (const l of ctx.city.lines) {
    const k = ctx.city.lineKinds[l.k];
    if (k === 'canal' || k === 'stream' || k === 'drain') channels.push(ringOf(l.p));
  }
  for (const way of net.ways) {
    if (!way.bridge) continue;
    const { path } = way;
    // Wet stretch: first and last sample over sunken water, and the water level there.
    let sa = -1;
    let sb = -1;
    let level = 0;
    for (let s = 0; s <= path.length; s += 2) {
      const [x, y] = path.at(s);
      const body = index.at(x, y);
      if (!body) continue;
      if (sa < 0) sa = s;
      sb = s;
      level = Math.min(level, body.level);
    }
    if (sa < 0) {
      if (overChannel(path, channels)) lowParapets(ctx.w.structures, way);
      continue;
    }
    const isIron = iron !== null && way.hw < 4 && distToPath(path, iron[0], iron[1]) < 60;
    deck(ctx, way, index, sa, sb, level, isIron);
  }
}

function overChannel(path: Path, channels: Ring[]): boolean {
  const p = path.pts;
  for (const c of channels) {
    for (let i = 1; i < p.length; i++) {
      for (let j = 1; j < c.length; j++) if (segCross(p[i - 1], p[i], c[j - 1], c[j])) return true;
    }
  }
  return false;
}

/** Low concrete parapets on both sides of a short bridge at grade. */
function lowParapets(w: MeshWriter, way: RoadWay): void {
  const e = way.hw + Math.max(way.walkL, way.walkR, 0.3);
  wallBand(w, way.path.pts, e, e + 0.3, 0, 0.8, G.bridgeConcrete, shade(G.bridgeConcrete, 1.06));
  wallBand(w, way.path.pts, -e - 0.3, -e, 0, 0.8, G.bridgeConcrete, shade(G.bridgeConcrete, 1.06));
}

function deck(ctx: BuildContext, way: RoadWay, index: WaterIndex, sa: number, sb: number, level: number, iron: boolean): void {
  const { w } = ctx;
  const pts = way.path.pts;
  const walk = Math.max(way.walkL, way.walkR, iron ? 1.6 : 0.6);
  const e = way.hw + walk;
  const edge = e + 0.35;
  // Deck top a hair above the street and under the paint: it hides the water, and the
  // tops of the banks, beneath the road. The paint and parapets cover all of it.
  const top = DECK_Y;
  band(w.ground, pts, -edge, edge, top, G.bridgeConcrete);
  // Slab sides.
  const L = offsetLine(pts, edge);
  const R = offsetLine(pts, -edge);
  const under = -1.2;
  for (let i = 1; i < pts.length; i++) {
    w.structures.quad([R[i - 1][0], R[i - 1][1], under], [R[i][0], R[i][1], under], [R[i][0], R[i][1], top], [R[i - 1][0], R[i - 1][1], top], G.bridgeShadow, G.bridgeConcrete);
    w.structures.quad([L[i][0], L[i][1], under], [L[i - 1][0], L[i - 1][1], under], [L[i - 1][0], L[i - 1][1], top], [L[i][0], L[i][1], top], G.bridgeShadow, G.bridgeConcrete);
  }
  // Piers in the water every ~22 m, clear of the banks.
  const span = sb - sa;
  const n = Math.max(0, Math.round(span / 22) - 1);
  for (let k = 1; k <= n; k++) {
    const s = sa + (span * k) / (n + 1);
    const [x, y, ux, uy] = way.path.at(s);
    if (!index.at(x + ux * 3, y + uy * 3) || !index.at(x - ux * 3, y - uy * 3)) continue;
    const ang = Math.atan2(uy, ux) + Math.PI / 2;
    box(w.structures, x, y, 2 * edge - 0.8, 1.4, level - 0.5, under, ang, G.concreteWet, G.concrete);
    box(w.structures, x, y, 2 * edge + 0.2, 1.9, under - 0.35, under, ang, G.concrete, G.concrete);
  }
  if (!iron) {
    wallBand(w.structures, pts, e, edge, 0, 1.1, G.bridgeConcrete, shade(G.bridgeConcrete, 1.08));
    wallBand(w.structures, pts, -edge, -e, 0, 1.1, G.bridgeConcrete, shade(G.bridgeConcrete, 1.08));
    return;
  }
  // Iron Bridge: walkway railings at the deck edges and a steel through truss at the kerbs.
  wallBand(w.structures, pts, edge - 0.08, edge, 0, 1.0, G.steel, G.steel);
  wallBand(w.structures, pts, -edge, -edge + 0.08, 0, 1.0, G.steel, G.steel);
  truss(w.structures, way.path, Math.max(0, sa - 3), Math.min(way.path.length, sb + 3), way.hw + 0.3);
}

/** Parker through truss on both sides (offset ±o) between arc lengths s0..s1: 7 panels per span, curved top chord. */
function truss(w: MeshWriter, path: Path, s0: number, s1: number, o: number): void {
  const spans = Math.max(1, Math.ceil((s1 - s0) / 75));
  const len = (s1 - s0) / spans;
  const c = G.steel;
  for (let sp = 0; sp < spans; sp++) {
    const start = s0 + sp * len;
    const tops: [number, number, number][][] = [];
    for (const side of [1, -1]) {
      const B: [number, number, number][] = [];
      const T: [number, number, number][] = [];
      for (let k = 0; k <= 7; k++) {
        const [x, y, ux, uy] = path.at(start + (len * k) / 7);
        const px = x - uy * o * side;
        const py = y + ux * o * side;
        B.push([px, py, 0.3]);
        T.push([px, py, k === 0 || k === 7 ? 0.3 : 3.8 + 3.2 * Math.sin((Math.PI * k) / 7)]);
      }
      for (let k = 0; k < 7; k++) beam(w, B[k], B[k + 1], 0.5, c);
      for (let k = 1; k < 6; k++) beam(w, T[k], T[k + 1], 0.45, c);
      beam(w, B[0], T[1], 0.45, c);
      beam(w, B[7], T[6], 0.45, c);
      for (let k = 1; k <= 6; k++) beam(w, B[k], T[k], 0.28, c);
      for (let k = 1; k <= 3; k++) beam(w, T[k], B[k + 1], 0.2, c);
      for (let k = 4; k <= 6; k++) beam(w, T[k], B[k - 1], 0.2, c);
      tops.push(T);
    }
    // Lateral bracing across the top.
    for (let k = 1; k <= 6; k++) beam(w, tops[0][k], tops[1][k], 0.25, c);
  }
}
