// Road network for the 3D streets: per-way attributes (carriageway and
// pavement widths, lanes, kerbs) and the geometry of every junction where
// three or more road arms meet — how far each arm's plain carriageway is set
// back from the node, the rounded kerb corners between neighbouring arms, and
// the junction surface polygon (docs/3d/architecture.md §5).

import { armSetbacks, giveWayPaint, junctionCorners, PAVEMENT_BY_CLASS, signalPaint, sortArms } from '../../sim/junctionShape';
import { ROAD_FLAG, type CityData } from '../city';
import { convexHull, Path, ringArea2, ringSimple, segDist, subtractIntervals, type Pt } from './paths';
import type { Ring } from './shapes';

export interface RoadWay {
  idx: number;
  cls: number;
  flags: number;
  /** Carriageway half-width, m. */
  hw: number;
  /** Lane count (tagged, else estimated from the width). */
  lanes: number;
  surface: number;
  refs: number[];
  path: Path;
  oneway: boolean;
  bridge: boolean;
  /** Pavement width right and left of the direction of travel, m (0 = none). */
  walkR: number;
  walkL: number;
  /** Arc-length intervals outside junctions, where lines are painted. */
  clear: [number, number][];
  /** Junction vertices on this way with the setbacks of the arms before and after them. */
  stops: { vi: number; back: number; fwd: number }[];
}

export interface Arm {
  way: RoadWay;
  /** Index of the junction node among the way's vertices. */
  vi: number;
  /** +1 when the arm leaves the node along the way's direction, −1 against it. */
  dir: 1 | -1;
  /** Outward unit direction. */
  ux: number;
  uy: number;
  hw: number;
  /** The way's road class. */
  cls: number;
  /** Distance along the way to the next junction or the end of the way. */
  len: number;
  /** Distance from the node at which the plain carriageway resumes. */
  setback: number;
  /** Extra distance past the setback kept free of lane lines (crossing, stop line). */
  paint: number;
  /** Traffic on this arm can flow towards the node. */
  inbound: boolean;
  /** Pavement on the arm's left and right, looking outward. */
  walkL: number;
  walkR: number;
}

export interface Corner {
  /** Fillet from arm k's left kerb to arm k+1's right kerb (empty for straight-through sectors). */
  pts: Ring;
  /** Distance from the node along each arm where the rounded kerb starts. */
  ta: number;
  tb: number;
  /** Both kerbs of the corner exist, so a kerb follows the fillet. */
  kerb: boolean;
}

export interface Junction {
  node: number;
  x: number;
  y: number;
  /** Arms sorted counter-clockwise by direction. */
  arms: Arm[];
  /** corners[k] lies between arms[k] and arms[k + 1]. */
  corners: Corner[];
  /** Junction surface polygon, counter-clockwise. */
  ring: Ring;
  /** The computed polygon was simple (the convex hull stands in otherwise). */
  simple: boolean;
  signals: boolean;
  /** Most important road class among the arms (lowest index). */
  cls: number;
  surface: number;
}

export interface RoadNet {
  ways: RoadWay[];
  junctions: Junction[];
  /** Number of road arms at each node. */
  degree: Uint8Array;
  /** Nearest way (optionally filtered) to a point: arc length along it and the side (+1 left). */
  nearest(x: number, y: number, maxD: number, ok?: (w: RoadWay) => boolean): { way: RoadWay; s: number; d: number; side: 1 | -1 } | null;
}

/** Grid of way segments for nearest-way queries. */
function segmentGrid(ways: RoadWay[]): RoadNet['nearest'] {
  const CELL = 40;
  const grid = new Map<number, number[]>();
  const key = (cx: number, cy: number) => cx * 100_003 + cy;
  ways.forEach((way, wi) => {
    const p = way.path.pts;
    for (let i = 1; i < p.length; i++) {
      for (let cx = Math.floor(Math.min(p[i - 1][0], p[i][0]) / CELL); cx <= Math.floor(Math.max(p[i - 1][0], p[i][0]) / CELL); cx++) {
        for (let cy = Math.floor(Math.min(p[i - 1][1], p[i][1]) / CELL); cy <= Math.floor(Math.max(p[i - 1][1], p[i][1]) / CELL); cy++) {
          const list = grid.get(key(cx, cy));
          if (list) list.push(wi, i);
          else grid.set(key(cx, cy), [wi, i]);
        }
      }
    }
  });
  return (x, y, maxD, ok = () => true) => {
    let best: { way: RoadWay; s: number; d: number; side: 1 | -1 } | null = null;
    const r = Math.ceil(maxD / CELL);
    const cx0 = Math.floor(x / CELL);
    const cy0 = Math.floor(y / CELL);
    for (let cx = cx0 - r; cx <= cx0 + r; cx++) {
      for (let cy = cy0 - r; cy <= cy0 + r; cy++) {
        const list = grid.get(key(cx, cy));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) {
          const way = ways[list[k]];
          if (!ok(way)) continue;
          const i = list[k + 1];
          const [ax, ay] = way.path.pts[i - 1];
          const [bx, by] = way.path.pts[i];
          const { d, t } = segDist(x, y, ax, ay, bx, by);
          if (d < maxD && (!best || d < best.d)) {
            const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
            best = { way, s: way.path.cum[i - 1] + t * (way.path.cum[i] - way.path.cum[i - 1]), d, side: cross >= 0 ? 1 : -1 };
          }
        }
      }
    }
    return best;
  };
}

/** Lane count: the tag when present, else what the carriageway width holds. */
export function lanesOf(tagged: number, width: number, oneway: boolean): number {
  if (tagged > 0) return tagged;
  return Math.max(oneway ? 1 : 2, Math.round(width / 3.2));
}

export function buildRoadNet(city: CityData): RoadNet {
  const rn = city.roads.nodes;
  const nNodes = rn.length / 2;
  const degree = new Uint8Array(nNodes);
  const ways: RoadWay[] = city.roads.ways.map((w, idx) => {
    const [cls, flags, widthDm, lanesTag, , surface] = w;
    const refs = w.slice(7);
    const pts: Ring = refs.map((n) => [rn[2 * n] / 10, rn[2 * n + 1] / 10]);
    const oneway = (flags & ROAD_FLAG.ONEWAY) !== 0;
    const width = widthDm / 10;
    const tagged = flags & (ROAD_FLAG.SIDEWALK_L | ROAD_FLAG.SIDEWALK_R);
    const base = PAVEMENT_BY_CLASS[cls] ?? 0;
    const walkL = tagged ? (flags & ROAD_FLAG.SIDEWALK_L ? Math.max(1.8, base) : 0) : base;
    const walkR = tagged ? (flags & ROAD_FLAG.SIDEWALK_R ? Math.max(1.8, base) : 0) : base;
    for (let i = 0; i < refs.length; i++) degree[refs[i]] = Math.min(255, degree[refs[i]] + (i > 0 ? 1 : 0) + (i < refs.length - 1 ? 1 : 0));
    return {
      idx,
      cls,
      flags,
      hw: width / 2,
      lanes: lanesOf(lanesTag, width, oneway),
      surface,
      refs,
      path: new Path(pts),
      oneway,
      bridge: (flags & ROAD_FLAG.BRIDGE) !== 0,
      walkR,
      walkL,
      clear: [],
      stops: [],
    };
  });

  // Signal-controlled nodes: OSM traffic_signals points sit on road nodes.
  const nodeAt = new Map<string, number>();
  for (let i = 0; i < nNodes; i++) nodeAt.set(`${rn[2 * i]},${rn[2 * i + 1]}`, i);
  const signalPts: Pt[] = [];
  const kSignal = city.propKinds.indexOf('traffic_signals');
  for (let i = 0; i < city.props.length; i += 3) {
    if (city.props[i] === kSignal) signalPts.push([city.props[i + 1], city.props[i + 2]]);
  }

  // Arms of every junction node.
  const armsAt = new Map<number, Arm[]>();
  for (const way of ways) {
    const { refs, path } = way;
    const n = refs.length;
    for (let vi = 0; vi < n; vi++) {
      if (degree[refs[vi]] < 3) continue;
      for (const dir of [-1, 1] as const) {
        if ((dir < 0 && vi === 0) || (dir > 0 && vi === n - 1)) continue;
        let j = vi + dir;
        while (j > 0 && j < n - 1 && degree[refs[j]] < 3) j += dir;
        const s0 = path.cum[vi];
        const len = Math.abs(path.cum[j] - s0);
        if (len < 1e-3) continue;
        const [px, py] = path.at(s0 + dir * Math.min(len, Math.max(3, way.hw)));
        const [nx, ny] = [path.pts[vi][0], path.pts[vi][1]];
        const l = Math.hypot(px - nx, py - ny) || 1;
        const arm: Arm = {
          way,
          vi,
          dir,
          ux: (px - nx) / l,
          uy: (py - ny) / l,
          hw: way.hw,
          cls: way.cls,
          len,
          setback: 0,
          paint: 0,
          inbound: !way.oneway || dir < 0,
          walkL: dir > 0 ? way.walkL : way.walkR,
          walkR: dir > 0 ? way.walkR : way.walkL,
        };
        const list = armsAt.get(refs[vi]);
        if (list) list.push(arm);
        else armsAt.set(refs[vi], [arm]);
      }
    }
  }

  const junctions: Junction[] = [];
  for (const [node, arms] of armsAt) {
    if (arms.length < 3) continue;
    junctions.push(junctionAt(node, rn[2 * node] / 10, rn[2 * node + 1] / 10, arms));
  }

  // Signals: the junction at the signal node, else the nearest one within 35 m.
  if (signalPts.length) {
    const CELL = 50;
    const grid = new Map<string, Junction[]>();
    for (const j of junctions) {
      const k = `${Math.floor(j.x / CELL)},${Math.floor(j.y / CELL)}`;
      const list = grid.get(k);
      if (list) list.push(j);
      else grid.set(k, [j]);
    }
    for (const [xd, yd] of signalPts) {
      const x = xd / 10;
      const y = yd / 10;
      let best: Junction | null = null;
      let bestD = 35;
      const cx = Math.floor(x / CELL);
      const cy = Math.floor(y / CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            const d = nodeAt.get(`${xd},${yd}`) === j.node ? 0 : Math.hypot(j.x - x, j.y - y);
            if (d < bestD) {
              bestD = d;
              best = j;
            }
          }
        }
      }
      if (best) best.signals = true;
    }
  }

  // Paint clearance past the setback: crossings and stop lines at signals,
  // stop lines where a minor road meets a bigger one.
  for (const j of junctions) {
    for (const a of j.arms) {
      if (j.signals && a.hw >= 2.5 && a.way.cls <= 5) a.paint = signalPaint(a, a.setback);
      else if (a.way.cls > j.cls && a.inbound && a.hw >= 2.5) a.paint = giveWayPaint(a, a.setback);
    }
  }

  // Per-way clear intervals and junction stops.
  const stopsOf = new Map<RoadWay, Map<number, { vi: number; back: number; fwd: number }>>();
  for (const j of junctions) {
    for (const a of j.arms) {
      let m = stopsOf.get(a.way);
      if (!m) stopsOf.set(a.way, (m = new Map()));
      let s = m.get(a.vi);
      if (!s) m.set(a.vi, (s = { vi: a.vi, back: 0, fwd: 0 }));
      if (a.dir > 0) s.fwd = a.setback + a.paint;
      else s.back = a.setback + a.paint;
    }
  }
  for (const way of ways) {
    const excl: [number, number][] = [];
    const m = stopsOf.get(way);
    if (m) {
      for (const s of m.values()) {
        way.stops.push(s);
        const c = way.path.cum[s.vi];
        excl.push([c - s.back, c + s.fwd]);
      }
    }
    // Lines stop a metre short of dead ends.
    const last = way.refs.length - 1;
    if (degree[way.refs[0]] === 1) excl.push([-1, 1]);
    if (degree[way.refs[last]] === 1) excl.push([way.path.length - 1, way.path.length + 1]);
    way.clear = subtractIntervals([0, way.path.length], excl);
  }
  return { ways, junctions, degree, nearest: segmentGrid(ways) };
}

function junctionAt(node: number, x: number, y: number, arms: Arm[]): Junction {
  sortArms(arms);
  const m = arms.length;
  const corners: Corner[] = [];
  // Corner geometry between arm k's left kerb line and arm k+1's right kerb line; c is where they meet.
  const raw = junctionCorners(arms).map((r, k) => {
    const a = arms[k];
    return { ...r, c: r.round ? ([x - a.uy * a.hw + a.ux * r.t, y + a.ux * a.hw + a.uy * r.t] as Pt) : null };
  });
  const fil = raw.map((r) => ({ d: r.fillet, kerb: r.kerb }));
  armSetbacks(arms, raw).forEach((setback, k) => (arms[k].setback = setback));
  // Corners, shrunk where the setbacks were capped.
  for (let k = 0; k < m; k++) {
    const a = arms[k];
    const b = arms[(k + 1) % m];
    const r = raw[k];
    if (!r.c) {
      corners.push({ pts: [], ta: r.t, tb: r.s, kerb: fil[k].kerb });
      continue;
    }
    const d = Math.max(0, Math.min(fil[k].d, a.setback - r.t, b.setback - r.s));
    if (d < 0.3 || r.t > a.setback || r.s > b.setback) {
      corners.push({ pts: r.t <= a.setback && r.s <= b.setback ? [r.c] : [], ta: r.t, tb: r.s, kerb: fil[k].kerb });
      continue;
    }
    const half = r.phi / 2;
    const R = d * Math.tan(half);
    // Fillet centre on the bisector, inside the block between the arms.
    let bx = a.ux + b.ux;
    let by = a.uy + b.uy;
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl;
    by /= bl;
    const cx = r.c[0] + (bx * R) / Math.sin(half);
    const cy = r.c[1] + (by * R) / Math.sin(half);
    const S: Pt = [r.c[0] + a.ux * d, r.c[1] + a.uy * d];
    const E: Pt = [x + b.uy * b.hw + b.ux * (r.s + d), y - b.ux * b.hw + b.uy * (r.s + d)];
    const a0 = Math.atan2(S[1] - cy, S[0] - cx);
    // The arc bows towards the corner: take the short way round.
    let da = Math.atan2(E[1] - cy, E[0] - cx) - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    // Chords of about 1.5 m.
    const steps = Math.max(1, Math.min(6, Math.ceil((Math.abs(da) * R) / 1.5)));
    const pts: Ring = [S];
    for (let i = 1; i < steps; i++) {
      const ang = a0 + (da * i) / steps;
      pts.push([cx + Math.cos(ang) * R, cy + Math.sin(ang) * R]);
    }
    pts.push(E);
    corners.push({ pts, ta: r.t + d, tb: r.s + d, kerb: fil[k].kerb });
  }
  // Ring: for each arm its right then left end corner, then the corner towards the next arm.
  const ring: Ring = [];
  for (let k = 0; k < m; k++) {
    const a = arms[k];
    const ex = x + a.ux * a.setback;
    const ey = y + a.uy * a.setback;
    ring.push([ex + a.uy * a.hw, ey - a.ux * a.hw]);
    ring.push([ex - a.uy * a.hw, ey + a.ux * a.hw]);
    for (const p of corners[k].pts) ring.push(p);
  }
  // Drop near-duplicate consecutive points.
  const clean: Ring = [];
  for (const p of ring) {
    const q = clean[clean.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.02) clean.push(p);
  }
  if (clean.length > 2 && Math.hypot(clean[0][0] - clean[clean.length - 1][0], clean[0][1] - clean[clean.length - 1][1]) <= 0.02) clean.pop();
  const simple = clean.length >= 3 && ringSimple(clean) && ringArea2(clean) > 0;
  // A kerb follows a fillet only where the fillet stays out of every arm's carriageway.
  const inCarriageway = (p: Pt) =>
    arms.some((a) => {
      const dx = p[0] - x;
      const dy = p[1] - y;
      const t = dx * a.ux + dy * a.uy;
      return t > 0 && t < a.setback + 2 && Math.abs(dy * a.ux - dx * a.uy) < a.hw - 0.25;
    });
  for (const c of corners) if (!simple || c.pts.some(inCarriageway)) c.kerb = false;
  let cls = 99;
  let surface = 0;
  let widest = -1;
  for (const a of arms) {
    if (a.way.cls < cls || (a.way.cls === cls && a.hw > widest)) {
      cls = a.way.cls;
      surface = a.way.surface;
      widest = a.hw;
    }
  }
  return {
    node,
    x,
    y,
    arms,
    corners,
    ring: simple ? clean : convexHull([...clean, [x, y]]),
    simple,
    signals: false,
    cls,
    surface,
  };
}
