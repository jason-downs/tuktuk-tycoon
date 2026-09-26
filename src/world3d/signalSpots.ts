// Where the traffic light of each signalled approach can stand: a pole on the
// pavement beside the waiting traffic, or across the junction, with an arm
// reaching over the lanes to the head. The candidates here come from the road
// graph alone; the static city build (build/anchors.ts) takes the first one
// clear of everything it draws and registers the pole, so street furniture
// keeps off it. Pure (no three.js): sim metres, headings radians
// counter-clockwise from east.

import { reverseArc, type Pose, type RoadGraph } from '../sim/graph';
import { graphJunction, type GraphArm } from '../sim/junctionShape';
import { signalMap, STOP_BEHIND_LINE_M } from '../sim/signals';
import { SPOT_FLOATS } from './build/anchors';
import { edgeLanes } from './kinematics';

/** Pole distance beyond the kerb (m), on the pavement. */
export const POLE_KERB_OUT = 0.6;
/** Longest arm (m). */
export const MAX_ARM = 4;
/** The pole stands at least this far (m) past the end of the rounded kerb corner, on the straight pavement. */
const CORNER_CLEAR = 0.3;
/** Candidate spacing (m) along the kerb. */
const STEP = 1;
/** Farthest (m) behind the front of the waiting traffic a pole may stand, so the head still hangs over the first vehicle. */
const MAX_BEHIND = 2.5;
/** Far-side poles stand within this distance (m) past the far kerb corner. */
const FAR_REACH = 6;
/** The road straight ahead, for a far-side pole, and the road behind a short approach: at most this far off line (cosine). */
const AHEAD_COS = Math.cos((35 * Math.PI) / 180);

/** Where one approach's signal stands (sim metres) and which way it faces. */
export interface SignalSpot {
  arc: number;
  /** Foot of the pole. */
  poleX: number;
  poleY: number;
  /** Centre of the head, under the end of the arm. */
  headX: number;
  headY: number;
  /** Heading (radians) of the approaching traffic; the head faces the opposite way. */
  heading: number;
  /** Arm length (m) from the pole to the head. */
  arm: number;
  /** Side of the approaching traffic the pole stands on: +1 left, −1 right. */
  side: 1 | -1;
  /** True when the pole stands across the junction, beside the road straight ahead; false when it stands beside the waiting traffic. */
  far: boolean;
}

/** A spot beside a road at pose p: the pole `pole` m to one side of the centreline, the head `head` m, facing `heading`. */
function spotAt(arc: number, p: Pose, side: 1 | -1, pole: number, head: number, heading: number, far: boolean): SignalSpot {
  const lx = -Math.sin(p.heading) * side;
  const ly = Math.cos(p.heading) * side;
  return { arc, poleX: p.x + lx * pole, poleY: p.y + ly * pole, headX: p.x + lx * head, headY: p.y + ly * head, heading, arm: pole - head, side, far };
}

/** Offset (m) of the head from the centreline: over the lanes, at most MAX_ARM in from the pole. */
function headOffset(pole: number, lane: number): number {
  return Math.min(pole - 0.5, Math.max(lane, pole - MAX_ARM));
}

/** The arc that runs into the start of `arc` most nearly in line with it, if one does. */
function upstreamArc(graph: RoadGraph, arc: number): number {
  const h = graph.arcStartHeading(arc);
  let best = -1;
  let bestCos = AHEAD_COS;
  for (const e of graph.edgesAt(graph.arcFrom(arc))) {
    const ed = graph.edges[e];
    if (ed.virtual || e === arc >> 1) continue;
    const up = e * 2 + (ed.b === graph.arcFrom(arc) ? 0 : 1);
    if (!graph.arcValid(up)) continue;
    const c = Math.cos(graph.arcEndHeading(up) - h);
    if (c > bestCos) {
      bestCos = c;
      best = up;
    }
  }
  return best;
}

/**
 * Candidate spots for an approach's signal, best first. The pole stands
 * POLE_KERB_OUT beyond the kerb to the left of the waiting traffic, just
 * ahead of the front of the first waiting vehicle (beside the painted stop
 * line), then stepping towards the junction until the rounded kerb corner,
 * then a little behind the front, continuing onto the road behind where the
 * approach is short. One-way approaches then try the right kerb the same way.
 * Next come far-side spots: across the junction, beside the road straight
 * ahead, to the left of the traffic and then to its right, facing it. Last,
 * on two-way roads, the right kerb beyond the oncoming lanes. Each head hangs
 * over the lanes, at most MAX_ARM from its pole.
 */
export function signalCandidates(graph: RoadGraph, arc: number): SignalSpot[] {
  const lanes = edgeLanes(graph);
  const len = graph.arcLen(arc);
  const front = signalMap(graph).stopAt[arc] - STOP_BEHIND_LINE_M;
  const node = graph.arcTo(arc);
  const arms = graphJunction(graph, node);
  const mine = arms.find((a) => a.arc === reverseArc(arc));
  const up = upstreamArc(graph, arc);
  const out: SignalSpot[] = [];
  const pose: Pose = { x: 0, y: 0, heading: 0 };
  const nearSide = (side: 1 | -1) => {
    // Traffic arrives against the arm's outward direction: its left kerb is the arm's right-hand one.
    const kerbFrom = (mine ? (side > 0 ? mine.rightKerb : mine.leftKerb) : 0) + CORNER_CLEAR;
    const backs: number[] = [];
    for (let d = front - STEP / 2; d >= kerbFrom; d -= STEP) backs.push(d);
    for (let d = Math.max(front + STEP / 2, kerbFrom); d <= front + MAX_BEHIND; d += STEP) backs.push(d);
    for (const back of backs) {
      // The station on the approach, or on the road behind it.
      const on = back <= len - STEP / 2 ? arc : up >= 0 && back - len <= graph.arcLen(up) - STEP / 2 ? up : -1;
      if (on < 0) continue;
      const p = graph.poseAt(on, on === arc ? len - back : graph.arcLen(up) - (back - len), pose);
      const e = on >> 1;
      const pole = lanes.half[e] + POLE_KERB_OUT;
      out.push(spotAt(arc, p, side, pole, headOffset(pole, side > 0 ? lanes.lane[e] : 0), p.heading, false));
    }
  };
  const farSide = () => {
    // The arm most nearly straight ahead, first its kerb on the traffic's left (the arm's left, looking out), then its right.
    const arrive = graph.arcEndHeading(arc);
    let ahead: GraphArm | null = null;
    let bestCos = AHEAD_COS;
    for (const a of arms) {
      const c = a.ux * Math.cos(arrive) + a.uy * Math.sin(arrive);
      if (a !== mine && c > bestCos) {
        bestCos = c;
        ahead = a;
      }
    }
    if (!ahead) return;
    const e = ahead.edge;
    const pole = lanes.half[e] + POLE_KERB_OUT;
    for (const side of [1, -1] as const) {
      // Traffic leaving along the arm keeps left; elsewhere the head reaches to the centre.
      const lane = side > 0 && graph.arcValid(ahead.arc) ? lanes.lane[e] : 0;
      const from = (side > 0 ? ahead.leftKerb : ahead.rightKerb) + CORNER_CLEAR;
      for (let d = from; d <= from + FAR_REACH && d <= graph.edges[e].len - STEP / 2; d += STEP) {
        const p = graph.poseAt(ahead.arc, d, pose);
        out.push(spotAt(arc, p, side, pole, headOffset(pole, lane), arrive, true));
      }
    }
  };
  const oneway = graph.edges[arc >> 1].oneway;
  nearSide(1);
  if (oneway) nearSide(-1);
  farSide();
  // Across the oncoming lanes of a two-way road, the head reaching to the centreline.
  if (!oneway) nearSide(-1);
  return out;
}

/** Write a spot into a packed array at spot index i. */
export function packSpot(out: Float32Array, i: number, s: SignalSpot): void {
  const k = i * SPOT_FLOATS;
  out[k] = s.arc;
  out[k + 1] = s.poleX;
  out[k + 2] = s.poleY;
  out[k + 3] = s.headX;
  out[k + 4] = s.headY;
  out[k + 5] = s.heading;
  out[k + 6] = s.arm;
  out[k + 7] = s.side;
  out[k + 8] = s.far ? 1 : 0;
}

/** The spots of a packed array, in order. */
export function unpackSpots(a: ArrayLike<number>): SignalSpot[] {
  return Array.from({ length: Math.floor(a.length / SPOT_FLOATS) }, (_, i) => unpackSpot(a, i));
}

/** Read spot i of a packed array. */
export function unpackSpot(a: ArrayLike<number>, i: number): SignalSpot {
  const k = i * SPOT_FLOATS;
  return { arc: a[k], poleX: a[k + 1], poleY: a[k + 2], headX: a[k + 3], headY: a[k + 4], heading: a[k + 5], arm: a[k + 6], side: a[k + 7] < 0 ? -1 : 1, far: a[k + 8] > 0 };
}
