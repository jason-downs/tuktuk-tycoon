// Streets: pavements, kerbs (red and white near Old City junctions and bus
// stops), carriageways by surface, junction surfaces with rounded kerb corners
// and road paint (markings.ts); decks for bridges over water (bridges.ts).
//
// Everything flat here goes into the roads layer, which draws after the
// ground in painter's order without writing depth: later paint covers earlier
// paint, so pavements, kerbs, carriageways of every class, junctions and
// markings never z-fight however far the camera is.

import { ROAD_FLAG } from '../city';
import type { BuildContext } from './context';
import { buildBridges } from './bridges';
import { G } from './groundPalette';
import { buildRoadNet, type RoadWay } from './junctions';
import { buildMarkings, type KerbZone } from './markings';
import type { MeshWriter, RGB } from './mesh';
import { band, ccwRing, convexHull, offsetLine, PAINT_Y, Path, ringArea2, ringSimple, subtractIntervals, type Pt } from './paths';
import { P } from './palette';
import { pointInRing, type Ring } from './shapes';

/** Carriageway colour by surface and class. */
export function surfaceColour(surface: number, cls: number): RGB {
  if (surface === 1) return G.concreteRoad;
  if (surface === 2) return G.pavers;
  if (surface === 3) return G.unpaved;
  return cls >= 5 ? G.asphaltOld : G.asphalt;
}

/** Test for the Old City and its moat roads: the moat's convex hull grown by 40 m. */
function oldCityTest(moatRings: Ring[]): (x: number, y: number) => boolean {
  const pts: Pt[] = moatRings.flat();
  if (pts.length < 3) return () => false;
  const hull = convexHull(pts);
  let cx = 0;
  let cy = 0;
  for (const [x, y] of hull) {
    cx += x;
    cy += y;
  }
  cx /= hull.length;
  cy /= hull.length;
  const grown: Ring = hull.map(([x, y]) => {
    const d = Math.hypot(x - cx, y - cy) || 1;
    return [x + ((x - cx) / d) * 40, y + ((y - cy) / d) * 40];
  });
  return (x, y) => pointInRing(x, y, grown);
}

/** Closed roundabout loops (chains of roundabout ways end to start), counter-clockwise, with their widest half-width. */
export function roundaboutLoops(ways: RoadWay[]): { ring: Ring; hw: number }[] {
  const round = ways.filter((w) => w.flags & ROAD_FLAG.ROUNDABOUT);
  const byStart = new Map<number, RoadWay[]>();
  for (const w of round) {
    const list = byStart.get(w.refs[0]);
    if (list) list.push(w);
    else byStart.set(w.refs[0], [w]);
  }
  const used = new Set<RoadWay>();
  const out: { ring: Ring; hw: number }[] = [];
  for (const first of round) {
    if (used.has(first)) continue;
    used.add(first);
    const chain = [first];
    let end = first.refs[first.refs.length - 1];
    while (end !== first.refs[0] && chain.length < 24) {
      const next = (byStart.get(end) ?? []).find((w) => !used.has(w));
      if (!next) break;
      used.add(next);
      chain.push(next);
      end = next.refs[next.refs.length - 1];
    }
    if (end !== first.refs[0]) continue;
    const pts: Ring = [];
    for (const w of chain) pts.push(...w.path.pts.slice(0, -1));
    if (pts.length >= 3) out.push({ ring: ccwRing(pts), hw: Math.max(...chain.map((w) => w.hw)) });
  }
  return out;
}

/** Red and white stripes (1 m each) along a kerb polyline. */
function paintKerb(w: MeshWriter, path: Path, o0: number, o1: number, s0: number, s1: number, second: RGB): void {
  const a = Math.max(0, s0);
  const b = Math.min(path.length, s1);
  if (b - a < 0.3) return;
  band(w, path.slice(a, b), o0, o1, PAINT_Y, G.kerbWhite);
  for (let s = Math.ceil(a); s + 1 <= b; s += 2) band(w, path.slice(s, s + 1), o0, o1, PAINT_Y, second);
}

export function buildRoads(ctx: BuildContext): void {
  const { city, w, occ } = ctx;
  const net = buildRoadNet(city);
  ctx.roadNet = net;
  for (const way of net.ways) ctx.roadPts.push(way.path.pts);
  const paint = w.roads;
  const oldCity = oldCityTest(ctx.moatRings);

  // ---- pavements
  for (const way of net.ways) {
    if (!way.walkL && !way.walkR) continue;
    band(paint, way.path.pts, way.walkR ? -way.hw - way.walkR : -way.hw, way.walkL ? way.hw + way.walkL : way.hw, PAINT_Y, G.pavement);
  }

  // ---- kerbs, with painted zones near Old City junctions, at bus stops and at the rank
  const zones: KerbZone[] = [];
  const kerbOf = (way: RoadWay, side: 1 | -1): [number, number] => (side > 0 ? [way.hw - 0.05, way.hw + 0.25] : [-way.hw - 0.25, -way.hw + 0.05]);
  for (const way of net.ways) {
    if (way.walkL) band(paint, way.path.pts, ...kerbOf(way, 1), PAINT_Y, G.kerb);
    if (way.walkR) band(paint, way.path.pts, ...kerbOf(way, -1), PAINT_Y, G.kerb);
    for (const st of way.stops) {
      const [x, y] = way.path.pts[st.vi];
      if (!oldCity(x, y)) continue;
      const c = way.path.cum[st.vi];
      for (const side of [1, -1] as const) zones.push({ way: way.idx, side, s0: c - st.back - 12, s1: c + st.fwd + 12, colour: G.kerbRed });
    }
  }
  const kBus = city.propKinds.indexOf('bus_stop');
  for (let i = 0; i < city.props.length; i += 3) {
    if (city.props[i] !== kBus) continue;
    const hit = net.nearest(city.props[i + 1] / 10, city.props[i + 2] / 10, 18, (wy) => wy.cls <= 4 && (wy.walkL > 0 || wy.walkR > 0));
    if (hit) zones.push({ way: hit.way.idx, side: hit.side, s0: hit.s - 9, s1: hit.s + 9, colour: G.kerbRed });
  }

  // ---- grass islands inside closed roundabouts, with a kerb round them
  for (const { ring, hw } of roundaboutLoops(net.ways)) {
    const island = offsetLine(ring, hw + 0.25, true);
    if (ringArea2(island) < 8 || !ringSimple(island)) continue;
    paint.polygon(island, undefined, PAINT_Y, P.grass);
    band(paint, island, -0.3, 0, PAINT_Y, G.kerb, true);
  }

  // ---- carriageways: minor roads first so bigger roads paint over them
  const order = [...net.ways].sort((a, b) => b.cls - a.cls || a.hw - b.hw);
  // Narrowest half-width of the ways meeting end to end at each node.
  const joinR = new Map<number, number>();
  for (const way of net.ways) {
    for (const end of [way.refs[0], way.refs[way.refs.length - 1]]) joinR.set(end, Math.min(joinR.get(end) ?? Infinity, way.hw));
  }
  for (const way of order) {
    const c = surfaceColour(way.surface, way.cls);
    band(paint, way.path.pts, -way.hw, way.hw, PAINT_Y, c);
    // Round off sharp bends so the outside corner is not clipped.
    const pts = way.path.pts;
    for (let i = 1; i < pts.length - 1; i++) {
      const ax = pts[i][0] - pts[i - 1][0];
      const ay = pts[i][1] - pts[i - 1][1];
      const bx = pts[i + 1][0] - pts[i][0];
      const by = pts[i + 1][1] - pts[i][1];
      const cos = (ax * bx + ay * by) / ((Math.hypot(ax, ay) * Math.hypot(bx, by)) || 1);
      if (cos < 0.64) paint.disc(pts[i][0], pts[i][1], way.hw, PAINT_Y, c, 8);
    }
    // Where two ways meet end to end, fill the wedge between their square ends.
    for (const end of [0, pts.length - 1]) {
      if (net.degree[way.refs[end]] === 2) paint.disc(pts[end][0], pts[end][1], joinR.get(way.refs[end]) ?? way.hw, PAINT_Y, c, 8);
    }
  }

  // ---- junction surfaces and kerb corners
  for (const j of net.junctions) paint.polygon(j.ring, undefined, PAINT_Y, surfaceColour(j.surface, j.cls));
  for (const j of net.junctions) {
    const red = oldCity(j.x, j.y);
    for (const c of j.corners) {
      if (!c.kerb || c.pts.length < 2) continue;
      // The block is on the right of the fillet's direction of travel.
      if (red) paintKerb(paint, new Path(c.pts), -0.25, 0.05, 0, Infinity, G.kerbRed);
      else band(paint, c.pts, -0.25, 0.05, PAINT_Y, G.kerb);
    }
  }

  // ---- markings, then kerb paint (the rank zone comes from the markings)
  zones.push(...buildMarkings(ctx, net));
  for (const z of zones) {
    const way = net.ways[z.way];
    if (!(z.side > 0 ? way.walkL : way.walkR)) continue;
    const [o0, o1] = kerbOf(way, z.side);
    // Never across a junction box, where the kerb is interrupted.
    const boxes = way.stops.map((st): [number, number] => [way.path.cum[st.vi] - st.back, way.path.cum[st.vi] + st.fwd]);
    for (const [a, b] of subtractIntervals([z.s0, z.s1], boxes)) paintKerb(paint, way.path, o0, o1, a, b, z.colour);
  }

  buildBridges(ctx, net);

  // ---- carriageway occupancy for scattering
  for (const way of net.ways) {
    const pts = way.path.pts;
    const pad = way.walkL || way.walkR ? 1.5 : 0.5;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2));
      for (let s = 0; s <= steps; s++) occ.markDisc(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps, way.hw + pad);
    }
  }
}
