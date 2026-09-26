// Land cover painted on the ground: parks, temple sand, plazas with brick
// pavers, parking lots with painted bays, sports pitches with their lines,
// pools with coping, footpaths, and the railway (ballast, sleepers, rails and
// station platforms) (docs/3d/world.md §2.6).

import { ringOf } from '../city';
import type { BuildContext } from './context';
import { G } from './groundPalette';
import { hash01, shade, type MeshWriter, type RGB } from './mesh';
import { P } from './palette';
import { band, ccwRing, lineCrossings, offsetLine, PAINT_Y, Path, ringArea2, ringBBox, ringFrame } from './paths';
import { pointInRing, type Ring } from './shapes';

/** Fill colour and paint order (later tiers paint over earlier ones) by area kind. */
const AREA_STYLE: Record<string, [RGB, number]> = {
  railway: [G.railYard, 0],
  construction: [P.construction, 0],
  campus: [P.campus, 1],
  hospital: [P.hospital, 1],
  school: [P.campus, 2],
  market: [P.market, 3],
  rural: [P.rural, 4],
  temple: [P.templeSand, 4],
  worship: [P.worship, 4],
  grass: [P.grass, 5],
  park: [P.grass, 6],
  garden: [P.grass, 6],
  golf: [P.grass, 6],
  forest: [P.forest, 6],
  cemetery: [P.cemetery, 6],
  apron: [P.apron, 7],
  pitch: [G.pitch, 7],
  parking: [G.parking, 8],
  fuel: [G.parking, 8],
  playground: [P.playground, 8],
  plaza: [G.plaza, 9],
  pool: [G.pool, 10],
};

/** Area kinds trees may be scattered in (read by the scatter builder). */
const GREEN = new Set(['park', 'garden', 'grass', 'golf', 'forest', 'cemetery', 'temple', 'campus', 'school', 'hospital']);

export function buildSurfaces(ctx: BuildContext): void {
  const { city, w } = ctx;
  const list: { kind: string; ring: Ring; holes?: Ring[]; tier: number; area: number; i: number }[] = [];
  city.areas.forEach((a, i) => {
    const kind = city.areaKinds[a.k];
    const style = AREA_STYLE[kind];
    if (!style) return;
    const ring = ccwRing(ringOf(a.r));
    if (ring.length < 3) return;
    list.push({ kind, ring, holes: a.h?.map((h) => ccwRing(ringOf(h))), tier: style[1], area: Math.abs(ringArea2(ring)) / 2, i });
    if (GREEN.has(kind)) ctx.parkAreas.push({ ring, kind });
  });
  // Paint broad land use first, details last; within a tier, big areas under small ones.
  list.sort((p, q) => p.tier - q.tier || q.area - p.area);
  for (const a of list) {
    w.roads.polygon(a.ring, a.holes, PAINT_Y, AREA_STYLE[a.kind][0]);
    if (a.kind === 'plaza') pavers(w.roads, a.ring, a.area);
    else if (a.kind === 'parking') parkingBays(w.roads, a.ring, a.area);
    else if (a.kind === 'pitch') pitchLines(w.roads, a.ring, a.area, a.i);
    else if (a.kind === 'pool') band(w.roads, a.ring, 0, 0.5, PAINT_Y, G.poolCoping, true);
  }
}

/** Point at frame coordinates (u along the axis, v to its left). */
const fp = (ux: number, uy: number, u: number, v: number): [number, number] => [u * ux - v * uy, u * uy + v * ux];

/** Straight painted stripe from frame point (ua, va) to (ub, vb). */
function stripe(w: MeshWriter, ux: number, uy: number, ua: number, va: number, ub: number, vb: number, half: number, c: RGB): void {
  band(w, [fp(ux, uy, ua, va), fp(ux, uy, ub, vb)], -half, half, PAINT_Y, c);
}

/** Brick paver joints on a grid, and a darker border course. */
function pavers(w: MeshWriter, ring: Ring, area: number): void {
  const f = ringFrame(ring);
  const step = area > 40_000 ? 6 : 3;
  for (const along of [true, false]) {
    const [a0, a1] = along ? [f.v0, f.v1] : [f.u0, f.u1];
    for (let t = a0 + step / 2; t < a1; t += step) {
      // Grid line: along u at v = t, or along v at u = t.
      const [px, py] = along ? fp(f.ux, f.uy, 0, t) : fp(f.ux, f.uy, t, 0);
      const [dx, dy] = along ? [f.ux, f.uy] : [-f.uy, f.ux];
      const xs = lineCrossings(ring, px, py, dx, dy);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        if (xs[i + 1] - xs[i] < 0.5) continue;
        band(
          w,
          [
            [px + dx * xs[i], py + dy * xs[i]],
            [px + dx * xs[i + 1], py + dy * xs[i + 1]],
          ],
          -0.07,
          0.07,
          PAINT_Y,
          G.plazaJoint,
        );
      }
    }
  }
  band(w, ring, 0, 0.6, PAINT_Y, G.plazaBorder, true);
}

/** Rows of 2.5 × 5 m bays across the lot, facing 6 m aisles. */
function parkingBays(w: MeshWriter, ring: Ring, area: number): void {
  if (area < 150 || area > 60_000) return;
  const f = ringFrame(ring);
  const inside = (u: number, v: number) => {
    const [x, y] = fp(f.ux, f.uy, u, v);
    return pointInRing(x, y, ring);
  };
  let lines = 0;
  for (let v = f.v0 + 1; v + 5 <= f.v1 - 0.5 && lines < 500; v += 16) {
    for (const [va, vb] of [
      [v, v + 5],
      [v + 11, v + 16],
    ]) {
      if (vb > f.v1 - 0.5) continue;
      for (let u = f.u0 + 1.5; u <= f.u1 - 1.5; u += 2.5) {
        if (!inside(u, va) || !inside(u, vb) || !inside(u, (va + vb) / 2)) continue;
        stripe(w, f.ux, f.uy, u, va, u, vb, 0.06, G.lineWhite);
        lines++;
      }
    }
  }
}

/** Pitch markings: football lines on big grass pitches, courts on small ones. */
function pitchLines(w: MeshWriter, ring: Ring, area: number, id: number): void {
  const f = ringFrame(ring);
  const L = f.u1 - f.u0;
  const W = f.v1 - f.v0;
  if (L < 14 || W < 7 || area / (L * W) < 0.8) return;
  const line = (ua: number, va: number, ub: number, vb: number) => stripe(w, f.ux, f.uy, ua, va, ub, vb, 0.06, G.lineWhite);
  const rect = (u0: number, v0: number, u1: number, v1: number) => {
    line(u0, v0, u1, v0);
    line(u1, v0, u1, v1);
    line(u1, v1, u0, v1);
    line(u0, v1, u0, v0);
  };
  const um = (f.u0 + f.u1) / 2;
  const vm = (f.v0 + f.v1) / 2;
  if (L < 40) {
    // Hard court.
    const court = hash01(id, 71) < 0.5 ? G.courtTeal : G.courtRed;
    const corners: Ring = [fp(f.ux, f.uy, f.u0 + 0.6, f.v0 + 0.6), fp(f.ux, f.uy, f.u1 - 0.6, f.v0 + 0.6), fp(f.ux, f.uy, f.u1 - 0.6, f.v1 - 0.6), fp(f.ux, f.uy, f.u0 + 0.6, f.v1 - 0.6)];
    w.polygon(corners, undefined, PAINT_Y, court);
    rect(f.u0 + 1.2, f.v0 + 1.2, f.u1 - 1.2, f.v1 - 1.2);
    line(um, f.v0 + 1.2, um, f.v1 - 1.2);
    return;
  }
  // Mowing stripes across the pitch.
  for (let u = f.u0 + 1; u + 6 <= f.u1 - 1; u += 12) {
    const q: Ring = [fp(f.ux, f.uy, u, f.v0 + 1), fp(f.ux, f.uy, u + 6, f.v0 + 1), fp(f.ux, f.uy, u + 6, f.v1 - 1), fp(f.ux, f.uy, u, f.v1 - 1)];
    w.polygon(q, undefined, PAINT_Y, G.pitchStripe);
  }
  const m = 1.5;
  rect(f.u0 + m, f.v0 + m, f.u1 - m, f.v1 - m);
  line(um, f.v0 + m, um, f.v1 - m);
  const r = Math.min(9.15, W / 6);
  const circle: Ring = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    circle.push(fp(f.ux, f.uy, um + Math.cos(a) * r, vm + Math.sin(a) * r));
  }
  band(w, circle, -0.06, 0.06, PAINT_Y, G.lineWhite, true);
  if (L >= 70) {
    const bw = Math.min(40.3, W - 2 * m - 4) / 2;
    const bd = Math.min(16.5, L * 0.16);
    rect(f.u0 + m, vm - bw, f.u0 + m + bd, vm + bw);
    rect(f.u1 - m - bd, vm - bw, f.u1 - m, vm + bw);
  }
}

/** Footpaths and steps. */
export function buildPaths(ctx: BuildContext): void {
  const { city, w } = ctx;
  for (const l of city.lines) {
    const kind = city.lineKinds[l.k];
    if (kind !== 'footway' && kind !== 'steps') continue;
    const hw = (l.w ? l.w / 10 : kind === 'steps' ? 2 : 1.8) / 2;
    band(w.roads, ringOf(l.p), -hw, hw, PAINT_Y, kind === 'steps' ? G.stone : G.path);
  }
}

/** Railway: ballast bed, sleepers and rails; platforms under the station's platform canopies. */
export function buildRail(ctx: BuildContext): void {
  const { city, w } = ctx;
  const tracks: Path[] = [];
  for (const l of city.lines) {
    if (city.lineKinds[l.k] !== 'rail') continue;
    const pts = ringOf(l.p);
    if (pts.length < 2) continue;
    const path = new Path(pts);
    tracks.push(path);
    band(w.roads, pts, -1.7, 1.7, PAINT_Y, G.ballast);
    // Sleepers every 0.8 m.
    for (let s = 0.4; s < path.length; s += 0.8) {
      const [x, y, ux, uy] = path.at(s);
      band(
        w.roads,
        [
          [x - ux * 0.13, y - uy * 0.13],
          [x + ux * 0.13, y + uy * 0.13],
        ],
        -1.25,
        1.25,
        PAINT_Y,
        G.sleeper,
      );
    }
    band(w.roads, pts, 0.68, 0.78, PAINT_Y, G.rail);
    band(w.roads, pts, -0.78, -0.68, PAINT_Y, G.rail);
  }
  if (!tracks.length) return;
  // Platforms: long narrow canopies (building=roof) standing between or beside the tracks.
  const trackBoxes = tracks.map((t) => ringBBox(t.pts));
  const kRoof = city.strings.indexOf('roof');
  for (const b of city.buildings) {
    if (b.b !== kRoof) continue;
    const L = b.o[0] / 10;
    const Wd = b.o[1] / 10;
    if (L < 40 || Wd < 3 || Wd > 14) continue;
    const ring = ccwRing(ringOf(b.r));
    const [x0, y0, x1, y1] = ringBBox(ring);
    const core = offsetLine(ring, 1.2, true);
    // Near a track (within 12 m), but no track through the canopy's middle.
    let near = false;
    let through = false;
    tracks.forEach((t, i) => {
      const tb = trackBoxes[i];
      if (tb[0] > x1 + 12 || tb[2] < x0 - 12 || tb[1] > y1 + 12 || tb[3] < y0 - 12) return;
      for (let s = 0; s < t.length; s += 4) {
        const [x, y] = t.at(s);
        if (x < x0 - 12 || x > x1 + 12 || y < y0 - 12 || y > y1 + 12) continue;
        near = true;
        if (pointInRing(x, y, core)) through = true;
      }
    });
    if (!near || through) continue;
    const slab = offsetLine(ring, 0.3, true);
    w.structures.walls(slab, 0, 0.9, shade(G.platform, 0.72), shade(G.platform, 0.9));
    w.structures.polygon(offsetLine(slab, 0.45, true), undefined, 0.9, G.platform);
    band(w.structures, slab, 0.01, 0.45, 0.9, G.kerbYellow, true);
  }
}
