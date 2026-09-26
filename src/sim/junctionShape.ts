// The shape of a road junction where three or more arms meet, as the 3D
// streets draw it (docs/3d/architecture.md §5): the rounded kerb corners
// between neighbouring arms, how far back from the node each arm's plain
// carriageway resumes, and where a signalised arm's zebra crossing and stop
// line are painted. The 3D road builder (src/world3d/build/junctions.ts)
// draws junctions from these rules and the signals (signals.ts) stop traffic
// at the painted line, so the two agree. Pure geometry, sim metres.

import { edgeWidth, type RoadGraph } from './graph';

/** Pavement width (m) by road class when a road has no sidewalk tags. */
export const PAVEMENT_BY_CLASS: readonly number[] = [3.0, 2.8, 2.4, 2.0, 1.2, 0, 0, 0];

/** One road arm leaving a junction node. */
export interface ArmShape {
  /** Outward unit direction. */
  ux: number;
  uy: number;
  /** Carriageway half-width (m). */
  hw: number;
  /** Distance (m) along the road to the next junction or the end of the road. */
  len: number;
  /** Road class index (0 trunk … 7 service). */
  cls: number;
  /** Pavement width (m) on the arm's left and right, looking outward (0 = none). */
  walkL: number;
  walkR: number;
}

/** The corner between an arm and the next arm counter-clockwise. */
export interface CornerShape {
  /** Distances (m) from the node, along the first arm and along the second, to where the first arm's left kerb line meets the second arm's right kerb line. */
  t: number;
  s: number;
  /** Angle (radians) from the first arm to the second, counter-clockwise, in (0, 2π]. */
  phi: number;
  /** The kerb lines meet at a corner that is rounded off (not straight through, not nearly parallel). */
  round: boolean;
  /** Extra distance (m) along each arm taken by the rounded kerb. */
  fillet: number;
  /** Both arms have a pavement at the corner, so a kerb follows it. */
  kerb: boolean;
}

/** Arms this close in angle are merging carriageways: no kerb corner between them. */
const PARALLEL = (15 * Math.PI) / 180;
/** Arms this far apart in angle run straight through: no corner. */
const STRAIGHT = (175 * Math.PI) / 180;
/** Longest reach (m) of the kerb-line meeting point between nearly parallel arms. */
const PARALLEL_REACH = 12;
/** Longest fillet (m) along an arm. */
const MAX_FILLET = 14;
/** Setback limits: at most this far (m), at most this share of the arm's length, and this much past the corners. */
const MAX_SETBACK = 30;
const SETBACK_SHARE = 0.45;
const SETBACK_PAD = 0.3;

/**
 * Paint on a signalised arm, measured outward from its setback (m): a zebra
 * crossing, then the stop line across the inbound lanes. Arms without room
 * for the crossing get only a thin stop line.
 */
export const SIGNAL_PAINT = {
  /** Longest stretch past the setback kept free of lane lines. */
  max: 6.5,
  /** Shortest stretch that holds the crossing and its stop line. */
  crossing: 5,
  /** Centre of the zebra crossing. */
  zebra: 2,
  /** Stop line behind the crossing. */
  line: [4.2, 4.65],
  /** Stop line on an arm too short for a crossing. */
  shortLine: [0.5, 0.9],
  /** Paint shorter than this is not drawn. */
  min: 0.5,
} as const;

/** Kerb fillet radius (m) between two arms. */
export function filletRadius(clsA: number, clsB: number, kerb: boolean): number {
  if (!kerb) return 1.2;
  return Math.min(clsA, clsB) <= 2 ? 6 : 4;
}

/** Sort arms counter-clockwise by direction, in place. */
export function sortArms<T extends ArmShape>(arms: T[]): T[] {
  return arms.sort((p, q) => Math.atan2(p.uy, p.ux) - Math.atan2(q.uy, q.ux));
}

/** The corner between each arm and the next counter-clockwise (arms sorted by sortArms). */
export function junctionCorners(arms: readonly ArmShape[]): CornerShape[] {
  const m = arms.length;
  const out: CornerShape[] = [];
  for (let k = 0; k < m; k++) {
    const a = arms[k];
    const b = arms[(k + 1) % m];
    let phi = Math.atan2(b.uy, b.ux) - Math.atan2(a.uy, a.ux);
    while (phi <= 1e-9) phi += Math.PI * 2;
    const kerb = a.walkL > 0 && b.walkR > 0;
    // Left kerb line of a: node + nL·hw + t·u; right kerb line of b: node + nR·hw + s·u.
    const sin = a.ux * b.uy - a.uy * b.ux;
    if (phi > STRAIGHT || sin < 1e-6) {
      out.push({ t: 0, s: 0, phi, round: false, fillet: 0, kerb });
      continue;
    }
    const dx = b.uy * b.hw + a.uy * a.hw;
    const dy = -b.ux * b.hw - a.ux * a.hw;
    const t = (dx * b.uy - dy * b.ux) / sin;
    const s = (dx * a.uy - dy * a.ux) / sin;
    if (phi < PARALLEL) {
      out.push({ t: Math.min(Math.max(t, 0), PARALLEL_REACH), s: Math.min(Math.max(s, 0), PARALLEL_REACH), phi, round: false, fillet: 0, kerb });
      continue;
    }
    const R = filletRadius(a.cls, b.cls, kerb);
    out.push({ t: Math.max(0, t), s: Math.max(0, s), phi, round: true, fillet: Math.min(R / Math.tan(phi / 2), MAX_FILLET), kerb });
  }
  return out;
}

/** Distance (m) from the node at which each arm's plain carriageway resumes: past both its corners, fillets included. */
export function armSetbacks(arms: readonly ArmShape[], corners: readonly CornerShape[]): number[] {
  const m = arms.length;
  return arms.map((a, k) => {
    const left = corners[k].t + corners[k].fillet;
    const prev = corners[(k + m - 1) % m];
    const right = prev.s + prev.fillet;
    return Math.min(MAX_SETBACK, a.len * SETBACK_SHARE, Math.max(left, right) + SETBACK_PAD);
  });
}

/** Length (m) past the setback painted with a signalised arm's crossing and stop line; 0 on arms too narrow or minor for paint. */
export function signalPaint(arm: ArmShape, setback: number): number {
  if (arm.hw < 2.5 || arm.cls > 5) return 0;
  return Math.min(SIGNAL_PAINT.max, Math.max(0, arm.len * SETBACK_SHARE - setback));
}

/** Length (m) past the setback painted where a minor road's inbound arm meets a bigger road. */
export function giveWayPaint(arm: ArmShape, setback: number): number {
  return Math.min(1.6, Math.max(0, arm.len * SETBACK_SHARE - setback));
}

/** Distance (m) from the node to the far edge of an inbound arm's painted stop line, or to its setback where none is painted. */
export function stopLineBack(setback: number, paint: number, signals: boolean): number {
  if (paint <= SIGNAL_PAINT.min) return setback;
  if (signals && paint >= SIGNAL_PAINT.crossing) return setback + SIGNAL_PAINT.line[1];
  return setback + SIGNAL_PAINT.shortLine[1];
}

/** An arm of a road-graph junction, with the setbacks the 3D streets draw it with. */
export interface GraphArm extends ArmShape {
  /** The graph edge the arm follows. */
  edge: number;
  /** The arc leaving the node along the edge (a geometric direction; it may run against a one-way). */
  arc: number;
  /** Distance (m) from the node at which the plain carriageway resumes. */
  setback: number;
  /** Distance (m) from the node at which the kerb on the arm's left, looking out, leaves the rounded corner. */
  leftKerb: number;
  /** The same for the kerb on the arm's right. */
  rightKerb: number;
}

/** Farthest (m) an arm's length is followed through nodes where only two roads meet. */
const ARM_REACH = 120;

/** Real (not virtual) roads at a node. */
function realEdges(graph: RoadGraph, node: number): number[] {
  return Array.from(graph.edgesAt(node)).filter((e) => !graph.edges[e].virtual);
}

/** Distance (m) along a road from a node to the next junction or dead end, through nodes where only two roads meet. */
function armLength(graph: RoadGraph, node: number, edge: number): number {
  let len = 0;
  let at = node;
  let e = edge;
  for (let hop = 0; hop < 64 && len < ARM_REACH; hop++) {
    const ed = graph.edges[e];
    len += ed.len;
    const next = ed.a === at ? ed.b : ed.a;
    const out = realEdges(graph, next).filter((o) => o !== e);
    if (out.length !== 1 || next === node) break;
    at = next;
    e = out[0];
  }
  return len;
}

/**
 * The arms of the junction at a road-graph node, counter-clockwise, shaped as
 * the 3D streets draw them: carriageway half-widths from the baked edge
 * widths and pavements by road class. Nodes where fewer than three roads meet
 * are not junctions; their arms have no setback.
 */
export function graphJunction(graph: RoadGraph, node: number): GraphArm[] {
  const arms: GraphArm[] = [];
  const nx = graph.nodeX[node];
  const ny = graph.nodeY[node];
  for (const edge of realEdges(graph, node)) {
    const e = graph.edges[edge];
    const hw = edgeWidth(e) / 2;
    const len = armLength(graph, node, edge);
    const walk = PAVEMENT_BY_CLASS[e.cls] ?? 0;
    // A loop leaves the node twice, once along each direction.
    const arcs = [...(e.a === node ? [edge * 2] : []), ...(e.b === node ? [edge * 2 + 1] : [])];
    for (const arc of arcs) {
      const p = graph.poseAt(arc, Math.min(e.len, Math.max(3, hw)));
      const l = Math.hypot(p.x - nx, p.y - ny) || 1;
      arms.push({ edge, arc, ux: (p.x - nx) / l, uy: (p.y - ny) / l, hw, len, cls: e.cls, walkL: walk, walkR: walk, setback: 0, leftKerb: 0, rightKerb: 0 });
    }
  }
  if (arms.length < 3) return arms;
  sortArms(arms);
  const corners = junctionCorners(arms);
  const setbacks = armSetbacks(arms, corners);
  const m = arms.length;
  arms.forEach((a, k) => {
    const prev = corners[(k + m - 1) % m];
    a.setback = setbacks[k];
    a.leftKerb = Math.min(a.setback, corners[k].t + corners[k].fillet);
    a.rightKerb = Math.min(a.setback, prev.s + prev.fillet);
  });
  return arms;
}
