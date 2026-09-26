// Render-side vehicle motion on the road graph: lane offsets for left-hand
// traffic, a wheelbase-smoothed pose through polyline corners and junctions,
// wheel spin, body roll and pitch, brake lamps, LPG idle shake, and queuing of
// stopped vehicles along the kerb. Pure (no three.js): positions are sim metres
// (x east, y north) and headings radians counter-clockwise from east. Nothing
// here touches game.state.

import type { RoadGraph } from '../sim/graph';

/**
 * Typical carriageway width (m) by road class, [two-way, one-way]: medians of
 * the widths baked into public/data/city3d.json (lanes × lane width + 0.6 m, or
 * the class default), so traffic sits in the lanes the 3D roads draw.
 */
export const ROAD_WIDTH: readonly (readonly [number, number])[] = [
  [14, 10.4],
  [7.1, 10.4],
  [12.6, 6.6],
  [6.6, 6.6],
  [6.1, 6.1],
  [5.5, 5.5],
  [4.5, 4.5],
  [4, 4],
];

/** Lane width (m) on one-way roads; the leftmost lane's centre is half of this in from the kerb. */
const LANE = 3.2;

/** Height (m) of the drawn carriageway above the ground plane (the road ribbons of build/roads.ts): wheels sit here. */
export const ROAD_SURFACE_Y = 0.12;
/** Height (m) of the drawn pavements: pedestrians stand here. */
export const PAVEMENT_Y = 0.07;

export function roadWidth(cls: number, oneway: boolean): number {
  const w = ROAD_WIDTH[cls] ?? ROAD_WIDTH[ROAD_WIDTH.length - 1];
  return w[oneway ? 1 : 0];
}

/**
 * Sideways offset (m, positive = left of travel) of the lane traffic keeps to:
 * the middle of the left half on two-way roads, the leftmost lane on one-way roads.
 */
export function laneOffsetFor(cls: number, oneway: boolean): number {
  const w = roadWidth(cls, oneway);
  return oneway ? Math.max(0, w / 2 - LANE / 2) : w / 4;
}

/**
 * Offset (m, left of travel) where a vehicle of the given half-width stops
 * against the left kerb of a road with this lane offset and half-width.
 */
export function kerbOffset(lane: number, halfRoad: number, halfWidth: number): number {
  return Math.max(lane, halfRoad - halfWidth - 0.1);
}

const laneCache = new WeakMap<RoadGraph, { lane: Float32Array; half: Float32Array }>();

/** Per-edge lane offset and half carriageway width for a graph (cached). */
export function edgeLanes(graph: RoadGraph): { lane: Float32Array; half: Float32Array } {
  let hit = laneCache.get(graph);
  if (!hit) {
    const n = graph.edges.length;
    hit = { lane: new Float32Array(n), half: new Float32Array(n) };
    for (let i = 0; i < n; i++) {
      const e = graph.edges[i];
      hit.lane[i] = laneOffsetFor(e.cls, e.oneway);
      hit.half[i] = roadWidth(e.cls, e.oneway) / 2;
    }
    laneCache.set(graph, hit);
  }
  return hit;
}

export interface XY {
  x: number;
  y: number;
}

/** Where a vehicle is on the graph: its route (if any) and position on the current arc. */
export interface PathRef {
  /** Route arcs, or null when the vehicle has no route (parked, or a single arc). */
  arcs: readonly number[] | null;
  /** Index into arcs of the current arc. */
  idx: number;
  /** Current arc (arcs[idx] when on a route). */
  arc: number;
  /** Metres along the current arc. */
  s: number;
  /** Arc driven before the current one, or −1; used behind the start of a route. */
  prev: number;
}

const _pose = { x: 0, y: 0, heading: 0 };

/** A point on the road centreline, the arc it lies on and the heading there. */
interface Sample extends XY {
  arc: number;
  heading: number;
}

/**
 * Point on the centreline at signed distance d (m) from the vehicle's position:
 * forward along the route, backward through earlier route arcs (or the previous
 * arc), extrapolated straight past either end.
 */
function sampleCentre(graph: RoadGraph, ref: PathRef, d: number, out: Sample): Sample {
  const arcs = ref.arcs;
  let i = ref.idx;
  let a = arcs ? arcs[i] : ref.arc;
  let pos = ref.s + d;
  if (pos > 0) {
    let len = graph.arcLen(a);
    while (pos > len && arcs && i + 1 < arcs.length) {
      pos -= len;
      i++;
      a = arcs[i];
      len = graph.arcLen(a);
    }
  } else if (pos < 0) {
    let usedPrev = false;
    for (let guard = 0; pos < 0 && guard < 64; guard++) {
      let prev = -1;
      const inRoute = !!arcs && i > 0;
      if (inRoute) prev = arcs![i - 1];
      else if (!usedPrev) {
        prev = ref.prev;
        usedPrev = true;
      }
      // Stop at gaps and at U-turns, whose previous arc runs back over the same road.
      if (prev < 0 || prev === (a ^ 1) || graph.arcTo(prev) !== graph.arcFrom(a)) break;
      if (inRoute) i--;
      a = prev;
      pos += graph.arcLen(a);
    }
  }
  const len = graph.arcLen(a);
  const p = graph.poseAt(a, Math.max(0, Math.min(len, pos)), _pose);
  const ex = pos > len ? pos - len : pos < 0 ? pos : 0;
  out.x = p.x + Math.cos(p.heading) * ex;
  out.y = p.y + Math.sin(p.heading) * ex;
  out.arc = a;
  out.heading = p.heading;
  return out;
}

const _one: Sample = { x: 0, y: 0, arc: 0, heading: 0 };

/**
 * Point on the vehicle's lane at signed distance d (m) from its position,
 * without smoothing: the centreline point shifted lateral(arc) metres to the
 * left of travel.
 */
export function samplePath(graph: RoadGraph, ref: PathRef, d: number, lateral: (arc: number) => number, out: XY): XY {
  const c = sampleCentre(graph, ref, d, _one);
  const off = lateral(c.arc);
  out.x = c.x - Math.sin(c.heading) * off;
  out.y = c.y + Math.cos(c.heading) * off;
  return out;
}

/** Triangle weights over 7 taps (sum 16). */
const WEIGHTS = [1, 2, 3, 4, 3, 2, 1];
const _q: Sample[] = Array.from({ length: 9 }, () => ({ x: 0, y: 0, arc: 0, heading: 0 }));
const _lat = new Float64Array(9);

/**
 * Target pose on the lane, smoothed over a wheelbase-sized window: the
 * centreline is averaged over ±3 taps (so polyline corners and junction turns
 * become curves), its direction gives the heading, and the lane offset — also
 * averaged, so it eases between roads — is applied along that smoothed
 * direction, which keeps the offset path continuous through junctions. The
 * window widens with the offset so turns from outer lanes stay round. `shift`
 * moves the sample point along the path (a queue position behind the real s).
 */
export function smoothedPose(graph: RoadGraph, ref: PathRef, lateral: (arc: number) => number, shift: number, out: { x: number; y: number; yaw: number }): boolean {
  const tap = 1 + 0.35 * Math.max(0, lateral(ref.arc));
  for (let k = 0; k < 9; k++) {
    sampleCentre(graph, ref, (k - 4) * tap + shift, _q[k]);
    _lat[k] = lateral(_q[k].arc);
  }
  let x0 = 0;
  let y0 = 0;
  let off = 0;
  let dx = 0;
  let dy = 0;
  for (let j = 0; j < 7; j++) {
    const w = WEIGHTS[j] / 16;
    x0 += _q[j + 1].x * w;
    y0 += _q[j + 1].y * w;
    off += _lat[j + 1] * w;
    dx += (_q[j + 2].x - _q[j].x) * w;
    dy += (_q[j + 2].y - _q[j].y) * w;
  }
  const ok = dx * dx + dy * dy > 1e-8;
  if (ok) out.yaw = Math.atan2(dy, dx);
  const yaw = ok ? out.yaw : _q[4].heading;
  out.x = x0 - Math.sin(yaw) * off;
  out.y = y0 + Math.cos(yaw) * off;
  return ok;
}

/** Wrap an angle to (−π, π]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

/** Rendered motion of one vehicle, kept between frames (never saved). */
export interface KinState {
  x: number;
  y: number;
  yaw: number;
  /** Body roll (rad, positive = right side down), pitch (rad, positive = nose up), heave (m). */
  roll: number;
  pitch: number;
  heave: number;
  /** Wheel rotation angle (rad). */
  spin: number;
  /** Speed (m/s) and acceleration (m/s²) in game time. */
  speed: number;
  accel: number;
  /** Brake-lamp level 0–1. */
  brake: number;
  /** Arc before the current one, for smoothing behind the start of a route. */
  prev: number;
  arc: number;
  /** Target position last frame, for speed and wheel spin. */
  tx: number;
  ty: number;
  /** Real seconds since the vehicle last moved. */
  stopped: number;
  /** Per-vehicle phase (rad) so idle shakes are not in step. */
  phase: number;
  init: boolean;
  /** Frame stamp of the last update (for dropping vehicles that disappeared). */
  seen: number;
}

export function newKinState(phase = 0): KinState {
  return {
    x: 0,
    y: 0,
    yaw: 0,
    roll: 0,
    pitch: 0,
    heave: 0,
    spin: 0,
    speed: 0,
    accel: 0,
    brake: 0,
    prev: -1,
    arc: -1,
    tx: 0,
    ty: 0,
    stopped: 0,
    phase,
    init: false,
    seen: 0,
  };
}

export interface KinStep {
  /** Game seconds since the last frame (0 while paused). */
  dtGame: number;
  /** Real seconds since the last frame. */
  dtReal: number;
  /** Real clock (s) for the idle shake. */
  now: number;
  /** Wheel radius (m, model units) for the spin. */
  wheelR: number;
  /** Render scale of the model; the spin and teleport threshold use world metres. */
  scale: number;
  /** LPG engine running (shakes when idling); false for EVs and parked vehicles with the engine off. */
  lpg: boolean;
  engineOn: boolean;
  /** Known speed (m/s, game time) from the simulation, if any. */
  speed?: number;
}

const ROLL_PER_ACCEL = 0.012;
const PITCH_PER_ACCEL = 0.008;
const MAX_ROLL = 0.07;
const MAX_PITCH = 0.045;
/** Largest wheel turn per frame (rad); faster spins would strobe. */
const MAX_SPIN_STEP = 0.9;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const _target = { x: 0, y: 0, yaw: 0 };

/**
 * Advance a vehicle's rendered state to its current place on the graph. The
 * along-track position follows the target exactly; sideways jumps (U-turns,
 * pulling in to the kerb) and heading changes ease in over a few metres of
 * travel or a fraction of a second. A ref without a previous arc gets the one
 * remembered in the state.
 */
export function stepKinematics(graph: RoadGraph, st: KinState, ref: PathRef, lateral: (arc: number) => number, shift: number, step: KinStep): void {
  if (ref.arc !== st.arc) {
    if (st.arc >= 0 && graph.arcTo(st.arc) === graph.arcFrom(ref.arc)) st.prev = st.arc;
    else if (st.arc >= 0) st.prev = -1;
    st.arc = ref.arc;
  }
  if (ref.prev < 0) ref.prev = st.prev;
  const ok = smoothedPose(graph, ref, lateral, shift, _target);
  if (!ok) _target.yaw = st.init ? st.yaw : graph.poseAt(ref.arc, ref.s).heading;
  const moved = Math.hypot(_target.x - st.tx, _target.y - st.ty);
  if (!st.init || moved > 60 * step.scale) {
    st.x = _target.x;
    st.y = _target.y;
    st.yaw = _target.yaw;
    st.tx = _target.x;
    st.ty = _target.y;
    st.speed = step.speed ?? 0;
    st.accel = 0;
    st.roll = 0;
    st.pitch = 0;
    st.init = true;
    return;
  }
  st.tx = _target.x;
  st.ty = _target.y;
  const fx = Math.cos(_target.yaw);
  const fy = Math.sin(_target.yaw);
  const ex = _target.x - st.x;
  const ey = _target.y - st.y;
  const along = ex * fx + ey * fy;
  const cross = -ex * fy + ey * fx;
  const kCross = 1 - Math.exp(-(moved / 3 + step.dtReal / 0.25));
  st.x += fx * along - fy * cross * kCross;
  st.y += fy * along + fx * cross * kCross;
  const lastYaw = st.yaw;
  const kYaw = 1 - Math.exp(-(moved / 2.5 + step.dtReal / 0.15));
  st.yaw = wrapAngle(st.yaw + wrapAngle(_target.yaw - st.yaw) * kYaw);

  if (step.dtGame > 0) {
    const v = step.speed ?? moved / step.dtGame;
    const a = (v - st.speed) / step.dtGame;
    const kA = 1 - Math.exp(-step.dtReal / 0.3);
    st.accel += (clamp(a, -8, 8) - st.accel) * kA;
    st.speed = v;
    const yawRate = wrapAngle(st.yaw - lastYaw) / step.dtGame;
    const rollT = clamp(ROLL_PER_ACCEL * v * yawRate, -MAX_ROLL, MAX_ROLL);
    const pitchT = clamp(PITCH_PER_ACCEL * st.accel, -MAX_PITCH, MAX_PITCH);
    const kR = 1 - Math.exp(-step.dtReal / 0.2);
    st.roll += (rollT - st.roll) * kR;
    st.pitch += (pitchT - st.pitch) * kR;
  }
  st.stopped = st.speed > 0.3 ? 0 : st.stopped + step.dtReal;
  const braking = step.engineOn && (st.accel < -0.6 || (st.speed <= 0.3 && st.stopped < 2.5));
  const kB = 1 - Math.exp(-step.dtReal / 0.08);
  st.brake += ((braking ? 1 : 0) - st.brake) * kB;

  const dSpin = Math.min(MAX_SPIN_STEP, moved / Math.max(0.05, step.wheelR * step.scale));
  st.spin = (st.spin + dSpin) % (Math.PI * 2);

  const t = step.now;
  if (step.lpg && step.engineOn && st.speed <= 0.3) {
    st.heave = 0.01 * Math.sin(t * Math.PI * 4.2 + st.phase) + 0.003 * Math.sin(t * Math.PI * 14.6 + st.phase * 2);
  } else if (st.speed > 0.3) {
    st.heave = 0.004 * Math.min(1, st.speed / 6) * Math.sin(t * Math.PI * 9 + st.phase);
  } else st.heave = 0;
}

/** A stopped vehicle, to be queued nose to tail along the kerb. */
export interface ParkItem {
  key: number;
  arc: number;
  s: number;
  /** Drawn length (m). */
  len: number;
}

/**
 * Queue positions for vehicles stopped on the same arc: sorted from the front
 * (largest s, then key), each one keeps at least `gap` metres behind the one
 * ahead, bumper to bumper. Writes the shift (m, ≤ 0) to add to each s.
 */
export function spreadParked(items: ParkItem[], gap: number, out: Map<number, number>): void {
  const byArc = new Map<number, ParkItem[]>();
  for (const it of items) {
    let list = byArc.get(it.arc);
    if (!list) byArc.set(it.arc, (list = []));
    list.push(it);
  }
  for (const list of byArc.values()) {
    list.sort((a, b) => b.s - a.s || a.key - b.key);
    let prev = Infinity;
    let prevLen = 0;
    for (const it of list) {
      const pos = Math.min(it.s, prev - (prevLen + it.len) / 2 - gap);
      out.set(it.key, pos - it.s);
      prev = pos;
      prevLen = it.len;
    }
  }
}
