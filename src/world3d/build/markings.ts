// Road paint (docs/3d/world.md §2.6): double yellow centre lines on two-way
// trunk and primary roads, white dashed centre and lane lines by lane count,
// edge lines on big roads, zebra crossings at OSM crossings and at signalised
// junctions, stop lines, one-way arrows every ~60 m in each lane, and the
// painted tuk-tuk rank at Tha Phae Gate. Lines stop at junction setbacks.

import { SIGNAL_PAINT } from '../../sim/junctionShape';
import { ROAD_FLAG, type CityData } from '../city';
import landmarks from '../../content/landmarks.json';
import type { BuildContext } from './context';
import { G } from './groundPalette';
import type { MeshWriter, RGB } from './mesh';
import type { Arm, RoadNet, RoadWay } from './junctions';
import { band, dashRuns, paintText, PAINT_Y, subtractIntervals } from './paths';

/** A painted zone along one kerb of a way: arc-length interval and paint. */
export interface KerbZone {
  way: number;
  /** +1 left kerb, −1 right kerb (relative to the way's direction). */
  side: 1 | -1;
  s0: number;
  s1: number;
  colour: RGB;
}

/** Sim position of a landmark from content/landmarks.json. */
export function landmarkXY(city: CityData, id: string): [number, number] | null {
  const l = (landmarks as { id: string; lat: number; lon: number }[]).find((m) => m.id === id);
  if (!l) return null;
  const o = city.origin;
  return [(l.lon - o.lon) * 111_320 * Math.cos((o.lat * Math.PI) / 180), (l.lat - o.lat) * 110_574];
}

/** Paint a straight-ish strip along a way between arc lengths s0..s1 and offsets o0..o1. */
function strip(w: MeshWriter, way: RoadWay, s0: number, s1: number, o0: number, o1: number, c: RGB): void {
  const piece = way.path.slice(s0, s1);
  if (piece.length >= 2) band(w, piece, o0, o1, PAINT_Y, c);
}

/** Zebra crossing centred at arc length s: 0.5 m stripes along the road across its width. */
function zebra(w: MeshWriter, way: RoadWay, s: number): void {
  const piece = way.path.slice(s - 1.6, s + 1.6);
  if (piece.length < 2) return;
  const span = way.hw - 0.45;
  for (let o = -span; o + 0.5 <= span + 1e-6; o += 1) band(w, piece, o, o + 0.5, PAINT_Y, G.lineWhite);
}

/** Arc length along the arm's way at distance d from the junction node. */
const armS = (a: Arm, d: number) => a.way.path.cum[a.vi] + a.dir * d;

/** Lateral span (way offsets) of traffic heading into the junction on this arm. */
function inboundSpan(a: Arm): [number, number] {
  const e = a.hw - 0.3;
  if (a.way.oneway) return [-e, e];
  // Inbound traffic keeps left, which is the arm's right-hand side looking outward.
  return a.dir > 0 ? [-e, 0] : [0, e];
}

export function buildMarkings(ctx: BuildContext, net: RoadNet): KerbZone[] {
  const { city } = ctx;
  const w = ctx.w.roads;
  const zones: KerbZone[] = [];

  // ---- zebra positions: every signalised junction arm, then OSM crossing nodes elsewhere
  const zebras = new Map<RoadWay, number[]>();
  const armZebras = new Map<RoadWay, number[]>();
  for (const j of net.junctions) {
    if (!j.signals) continue;
    for (const a of j.arms) {
      if (a.paint < SIGNAL_PAINT.crossing) continue;
      const list = armZebras.get(a.way) ?? [];
      list.push(armS(a, a.setback + SIGNAL_PAINT.zebra));
      armZebras.set(a.way, list);
    }
  }
  const nodeWays = new Map<number, RoadWay[]>();
  for (const way of net.ways) {
    for (const n of way.refs) {
      const list = nodeWays.get(n);
      if (list) list.push(way);
      else nodeWays.set(n, [way]);
    }
  }
  const nodeAt = new Map<string, number>();
  const rn = city.roads.nodes;
  for (let i = 0; i < rn.length / 2; i++) nodeAt.set(`${rn[2 * i]},${rn[2 * i + 1]}`, i);
  const kCrossing = city.propKinds.indexOf('crossing');
  for (let i = 0; i < city.props.length; i += 3) {
    if (city.props[i] !== kCrossing) continue;
    const node = nodeAt.get(`${city.props[i + 1]},${city.props[i + 2]}`);
    let way: RoadWay | undefined;
    let s = 0;
    if (node !== undefined) {
      // The biggest carriageway through the node.
      for (const cand of nodeWays.get(node) ?? []) if (!way || cand.cls < way.cls) way = cand;
      if (way) s = way.path.cum[way.refs.indexOf(node)];
    } else {
      const hit = net.nearest(city.props[i + 1] / 10, city.props[i + 2] / 10, 3);
      if (hit) {
        way = hit.way;
        s = hit.s;
      }
    }
    if (!way || way.hw < 2.4 || way.cls > 5 || way.surface === 3) continue;
    // A signalised arm already has its crossing.
    if ((armZebras.get(way) ?? []).some((t) => Math.abs(t - s) < 14)) continue;
    // Keep crossings clear of the junction boxes.
    const inside = way.clear.find(([a, b]) => s >= a && s <= b);
    if (!inside) {
      let bestS = -1;
      for (const [a, b] of way.clear) {
        for (const cand of [a + 2.2, b - 2.2]) if (cand >= a && cand <= b && (bestS < 0 || Math.abs(cand - s) < Math.abs(bestS - s))) bestS = cand;
      }
      if (bestS < 0 || Math.abs(bestS - s) > 12) continue;
      s = bestS;
    } else s = Math.min(Math.max(s, inside[0] + 2.2), inside[1] - 2.2);
    const list = zebras.get(way) ?? [];
    if (list.some((t) => Math.abs(t - s) < 8)) continue;
    list.push(s);
    zebras.set(way, list);
  }
  for (const [way, list] of zebras) way.clear = subtractIntervals([0, way.path.length], [...list.map((s): [number, number] => [s - 2.4, s + 2.4]), ...complement(way)]);

  // ---- lines
  for (const way of net.ways) lines(w, way);

  // ---- crossings and stop lines at junctions
  for (const j of net.junctions) {
    for (const a of j.arms) {
      if (a.paint <= SIGNAL_PAINT.min || !a.inbound) continue;
      const [d0, d1] = j.signals && a.paint >= SIGNAL_PAINT.crossing ? SIGNAL_PAINT.line : SIGNAL_PAINT.shortLine;
      const [o0, o1] = inboundSpan(a);
      strip(w, a.way, Math.min(armS(a, a.setback + d0), armS(a, a.setback + d1)), Math.max(armS(a, a.setback + d0), armS(a, a.setback + d1)), o0, o1, G.lineWhite);
    }
  }
  for (const [way, list] of [...zebras, ...armZebras]) for (const s of list) zebra(w, way, s);

  // ---- one-way arrows in every lane
  for (const way of net.ways) {
    if (!way.oneway || way.cls > 5 || way.hw < 1.5 || way.flags & ROAD_FLAG.ROUNDABOUT || way.surface === 3) continue;
    const lanes = Math.max(1, Math.min(way.lanes, Math.floor((2 * way.hw) / 2.6)));
    const lw = (2 * way.hw) / lanes;
    for (const [a, b] of way.clear) {
      if (b - a < 12) continue;
      for (let s = a + 7; s + 4 < b; s += 60) {
        for (let k = 0; k < lanes; k++) arrow(w, way, s, -way.hw + (k + 0.5) * lw);
      }
    }
  }

  // ---- tuk-tuk rank at Tha Phae Gate
  const rank = thaPhaeRank(ctx, net);
  if (rank) zones.push(rank);
  return zones;
}

/** The junction boxes of a way (the complement of its clear intervals). */
function complement(way: RoadWay): [number, number][] {
  const out: [number, number][] = [];
  let cur = 0;
  for (const [a, b] of way.clear) {
    if (a > cur) out.push([cur, a]);
    cur = b;
  }
  if (cur < way.path.length) out.push([cur, way.path.length]);
  return out;
}

/** Centre, lane and edge lines of one way, over its clear intervals. */
function lines(w: MeshWriter, way: RoadWay): void {
  const { hw, cls, lanes } = way;
  if (cls > 5 || hw < 2.6 || way.surface === 3 || lanes < 2) return;
  const solid = (o0: number, o1: number, c: RGB) => {
    for (const [a, b] of way.clear) strip(w, way, a, b, o0, o1, c);
  };
  const dashed = (o: number) => {
    for (const [a, b] of way.clear) dashRuns(a, b, 3, 6, (s0, s1) => strip(w, way, s0, s1, o - 0.075, o + 0.075, G.lineWhite));
  };
  if (!way.oneway) {
    if (cls <= 1) {
      solid(0.06, 0.2, G.lineYellow);
      solid(-0.2, -0.06, G.lineYellow);
    } else if (cls <= 4 || hw >= 3.5) dashed(0);
    const perDir = Math.floor(lanes / 2);
    for (let k = 1; k < perDir; k++) {
      dashed((k * hw) / perDir);
      dashed((-k * hw) / perDir);
    }
  } else {
    for (let k = 1; k < lanes; k++) dashed(-hw + (k * 2 * hw) / lanes);
  }
  if (cls <= 2 && hw >= 4) {
    solid(hw - 0.55, hw - 0.37, G.lineWhite);
    solid(-hw + 0.37, -hw + 0.55, G.lineWhite);
  }
}

/** Straight-ahead arrow centred at arc length s in the lane at offset o. */
function arrow(w: MeshWriter, way: RoadWay, s: number, o: number): void {
  const [x, y, ux, uy] = way.path.at(s);
  const nx = -uy;
  const ny = ux;
  const cx = x + nx * o;
  const cy = y + ny * o;
  const at = (d: number, l: number): [number, number, number] => [cx + ux * d + nx * l, cy + uy * d + ny * l, PAINT_Y];
  // Shaft, then the head (right base corner → tip → left base corner is counter-clockwise).
  w.quad(at(-2.6, -0.14), at(0.9, -0.14), at(0.9, 0.14), at(-2.6, 0.14), G.lineWhite);
  w.tri(at(0.8, -0.6), at(2.6, 0), at(0.8, 0.6), G.lineWhite);
}

/** Painted rank box with "TUK-TUK" lettering by the kerb nearest Tha Phae Gate. */
function thaPhaeRank(ctx: BuildContext, net: RoadNet): KerbZone | null {
  const gate = landmarkXY(ctx.city, 'tha_phae_gate');
  if (!gate) return null;
  const [gx, gy] = gate;
  const hit = net.nearest(gx, gy, 80, (wy) => wy.cls <= 3 && wy.hw >= 3 && !wy.bridge);
  if (!hit) return null;
  const { way } = hit;
  const LEN = 30;
  // The clear stretch closest to the gate that fits the box.
  let best = -1;
  for (const [a, b] of way.clear) {
    if (b - a < LEN + 4) continue;
    const s = Math.min(Math.max(hit.s - LEN / 2, a + 2), b - LEN - 2);
    if (best < 0 || Math.abs(s + LEN / 2 - hit.s) < Math.abs(best + LEN / 2 - hit.s)) best = s;
  }
  if (best < 0) return null;
  const w = ctx.w.roads;
  const side = hit.side;
  // Box between 0.25 m and 2.75 m in from the kerb on the gate's side.
  const [i0, i1] = side > 0 ? [way.hw - 2.75, way.hw - 0.25] : [-way.hw + 0.25, -way.hw + 2.75];
  const s0 = best;
  const s1 = best + LEN;
  strip(w, way, s0, s1, i0, i0 + 0.15, G.rankYellow);
  strip(w, way, s0, s1, i1 - 0.15, i1, G.rankYellow);
  strip(w, way, s0, s0 + 0.15, i0, i1, G.rankYellow);
  strip(w, way, s1 - 0.15, s1, i0, i1, G.rankYellow);
  // Hatched ends.
  for (let d = 0.6; d < 3; d += 0.8) {
    strip(w, way, s0 + d, s0 + d + 0.2, i0, i1, G.rankYellow);
    strip(w, way, s1 - d - 0.2, s1 - d, i0, i1, G.rankYellow);
  }
  // Lettering reads along the kerb, tops towards the kerb.
  const mid = (s0 + s1) / 2;
  const [x, y, ux, uy] = way.path.at(mid);
  const H = 1.5;
  const text = 'TUK-TUK';
  const width = text.length * H * 0.6 + (text.length - 1) * H * 0.25;
  const rx = side > 0 ? ux : -ux;
  const ry = side > 0 ? uy : -uy;
  const oc = (i0 + i1) / 2 - side * (H / 2);
  const bx = x - uy * oc - rx * (width / 2);
  const by = y + ux * oc - ry * (width / 2);
  paintText(w, text, bx, by, rx, ry, H, 0.16, PAINT_Y, G.rankYellow);
  return { way: way.idx, side, s0: s0 - 1, s1: s1 + 1, colour: G.kerbYellow };
}
