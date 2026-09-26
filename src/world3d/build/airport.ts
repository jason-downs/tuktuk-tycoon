// CNX airport ground: runway 18/36 with threshold piano keys, designation
// numbers, centreline, aiming-point and touchdown-zone marks and edge lines;
// taxiways with yellow centre and edge lines (docs/3d/world.md §1.8).

import { ringOf } from '../city';
import type { BuildContext } from './context';
import { G } from './groundPalette';
import type { MeshWriter } from './mesh';
import { band, dashRuns, paintText, PAINT_Y, Path } from './paths';

export function buildAirport(ctx: BuildContext): void {
  const { city, w } = ctx;
  const runways: { path: Path; hw: number }[] = [];
  const taxiways: { pts: [number, number][]; hw: number }[] = [];
  for (const l of city.lines) {
    const kind = city.lineKinds[l.k];
    if (kind !== 'runway' && kind !== 'taxiway') continue;
    const pts = ringOf(l.p);
    if (pts.length < 2) continue;
    if (kind === 'runway') runways.push({ path: new Path(pts), hw: (l.w ? l.w / 10 : 45) / 2 });
    else taxiways.push({ pts, hw: (l.w ? l.w / 10 : 18) / 2 });
  }
  for (const t of taxiways) {
    band(w.roads, t.pts, -t.hw, t.hw, PAINT_Y, G.taxiway);
    band(w.roads, t.pts, t.hw - 0.75, t.hw - 0.6, PAINT_Y, G.lineYellow);
    band(w.roads, t.pts, -t.hw + 0.6, -t.hw + 0.75, PAINT_Y, G.lineYellow);
  }
  for (const r of runways) runway(w.roads, r.path, r.hw);
  // Lead-on centrelines continue across the runway edge.
  for (const t of taxiways) band(w.roads, t.pts, -0.15, 0.15, PAINT_Y, G.lineYellow);
}

function runway(w: MeshWriter, path: Path, hw: number): void {
  const pts = path.pts;
  const L = path.length;
  band(w, pts, -hw - 7.5, hw + 7.5, PAINT_Y, G.taxiway);
  band(w, pts, -hw, hw, PAINT_Y, G.runway);
  band(w, pts, hw - 1.4, hw - 0.5, PAINT_Y, G.lineWhite);
  band(w, pts, -hw + 0.5, -hw + 1.4, PAINT_Y, G.lineWhite);
  // Rectangle between arc lengths s0..s1 and lateral offsets o0..o1.
  const rect = (s0: number, s1: number, o0: number, o1: number) => {
    const piece = path.slice(Math.max(0, s0), Math.min(L, s1));
    if (piece.length >= 2) band(w, piece, o0, o1, PAINT_Y, G.lineWhite);
  };
  dashRuns(150, L - 150, 30, 20, (a, b) => rect(a, b, -0.45, 0.45));
  // Heading of each end's landing direction, as runway designators (tens of degrees).
  const [, , ux0, uy0] = path.at(0);
  const [, , ux1, uy1] = path.at(L);
  const heading = (ux: number, uy: number) => {
    const deg = ((Math.atan2(ux, uy) * 180) / Math.PI + 360) % 360;
    const n = Math.round(deg / 10) || 36;
    return String(n > 36 ? n - 36 : n).padStart(2, '0');
  };
  const ends: { s: number; dir: 1 | -1; label: string }[] = [
    { s: 0, dir: 1, label: heading(ux0, uy0) },
    { s: L, dir: -1, label: heading(-ux1, -uy1) },
  ];
  for (const e of ends) {
    const at = (d: number) => e.s + e.dir * d;
    // Threshold piano keys.
    for (let k = 0; k < 6; k++) {
      const o = 3 + k * 3.6;
      rect(Math.min(at(6), at(36)), Math.max(at(6), at(36)), o - 0.9, o + 0.9);
      rect(Math.min(at(6), at(36)), Math.max(at(6), at(36)), -o - 0.9, -o + 0.9);
    }
    // Designation number, upright for an aircraft landing over this threshold.
    const H = 18;
    const [bx, by, tx, ty] = path.at(at(44));
    const ux = tx * e.dir;
    const uy = ty * e.dir;
    // Reading direction: to the pilot's right.
    const rx = uy;
    const ry = -ux;
    const width = e.label.length * H * 0.6 + (e.label.length - 1) * H * 0.25;
    paintText(w, e.label, bx - rx * (width / 2), by - ry * (width / 2), rx, ry, H, 1.6, PAINT_Y, G.lineWhite);
    // Touchdown zone and aiming point marks.
    for (const d of [150, 300]) {
      for (const o of [6, 9.6]) {
        rect(Math.min(at(d), at(d + 22.5)), Math.max(at(d), at(d + 22.5)), o - 0.9, o + 0.9);
        rect(Math.min(at(d), at(d + 22.5)), Math.max(at(d), at(d + 22.5)), -o - 0.9, -o + 0.9);
      }
    }
    rect(Math.min(at(400), at(460)), Math.max(at(400), at(460)), 6, 15);
    rect(Math.min(at(400), at(460)), Math.max(at(400), at(460)), -15, -6);
  }
}
