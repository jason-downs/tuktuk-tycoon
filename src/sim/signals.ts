// Traffic signals at the junctions OSM maps with highway=traffic_signals
// (graph.signals). A signal keeps no state: its phase is (time + offset) mod
// cycle, so every view and every save agrees on it. Signal nodes close
// together (the two halves of a dual carriageway) form one junction with one
// cycle, offset and axis. The roads into a junction split into two groups by
// angle — along the main road's axis and across it — which take turns on
// green. Every simulated vehicle stops at the line STOP_LINE_M before the
// junction on red, except the tuk-tuk the player steers by hand: running a red
// with a passenger aboard costs rating, and now and then the police are
// watching.

import { angleDiff } from '../geo';
import { spend } from './economy';
import type { Game, GameSystem } from './game';
import { reverseArc, type RoadGraph } from './graph';
import { chooseExit, isManualDriven, manualControl } from './manual';
import type { Vehicle } from './types';

/** [pacing] Seconds for a full signal cycle (each group gets one green). */
export const SIGNAL_CYCLE_S = 90;
/**
 * [pacing] Cycle at the Rin Kham (Rincome) junction, which calendar.md cites
 * as "the city intersection with the longest wait for a green light".
 */
export const RINCOME_CYCLE_S = 150;
/** Amber at the end of each green, seconds. */
export const AMBER_S = 3;
/** Where vehicles wait: metres before the junction node. */
export const STOP_LINE_M = 6;
/** [research] calendar.md: Rin Kham junction signals at 18.80124 N, 98.96778 E (OSM node 240531057). */
const RINCOME = { lat: 18.80124, lon: 98.96778 };
/** A junction whose centre is this close (m) to the Rin Kham point runs the long cycle. */
const RINCOME_RADIUS_M = 80;
/** Signal nodes this close together (m) are one junction. */
const CLUSTER_M = 45;
/** How far ahead (m) a vehicle looks for a signal. */
const LOOKAHEAD_M = 90;
/** On amber, a vehicle this close to the line (m) carries on through the junction. */
const AMBER_GO_M = 14;
/** Distance to the line (m) at which a vehicle counts as stopped at it. */
const AT_LINE_M = 0.5;
/** A vehicle this far past the line (m) is in the junction and carries on. */
const COMMITTED_M = 1;
/**
 * Seconds of travel a vehicle keeps between itself and the line when braking
 * for a red: the cap is distance ÷ this, so even the longest simulation step
 * (4 game s) cannot carry it across.
 */
const BRAKE_HORIZON_S = 4;
/** [pacing] Rating change per red light run with a passenger aboard, and the most one trip can lose. */
const RED_RUN_RATING = -0.25;
const RED_RUN_RATING_MIN = -0.75;
/** [pacing] Chance a red light run is seen by the police, and the fine (THB). */
export const POLICE_CHANCE = 0.06;
export const POLICE_FINE = 500;

export type SignalLight = 'green' | 'amber' | 'red';

export interface SignalJunction {
  /** Index in SignalMap.junctions. */
  id: number;
  /** Graph nodes of the junction. */
  nodes: number[];
  /** Centre, sim metres. */
  x: number;
  y: number;
  /** Seconds per full cycle. */
  cycle: number;
  /** Seconds added to game time before taking the phase. */
  offset: number;
  /** Heading (radians) of the main road; group 0 runs along it, group 1 across. */
  axis: number;
}

export interface SignalMap {
  junctions: SignalJunction[];
  /** Junction index per graph node, −1 where there is no signal. */
  junctionOf: Int32Array;
  /** Per arc: the light group (0 or 1) controlling entry to the junction at the arc's end; −1 when uncontrolled. */
  arcGroup: Int8Array;
  /** Every controlled arc, ascending. */
  approaches: number[];
}

const maps = new WeakMap<RoadGraph, SignalMap>();

/** The junctions and controlled approaches of a road graph (built once per graph). */
export function signalMap(graph: RoadGraph): SignalMap {
  let map = maps.get(graph);
  if (!map) {
    map = buildSignalMap(graph);
    maps.set(graph, map);
  }
  return map;
}

function buildSignalMap(graph: RoadGraph): SignalMap {
  const nodes = graph.signals.filter((n) => n >= 0 && n < graph.nodeCount);
  // Union nearby signal nodes into junctions.
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = Math.hypot(graph.nodeX[nodes[i]] - graph.nodeX[nodes[j]], graph.nodeY[nodes[i]] - graph.nodeY[nodes[j]]);
      if (d < CLUSTER_M) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, number[]>();
  nodes.forEach((n, i) => {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(n);
    groups.set(root, list);
  });

  const junctionOf = new Int32Array(graph.nodeCount).fill(-1);
  const junctions: SignalJunction[] = [];
  const [rx, ry] = graph.projection.toXY(RINCOME.lon, RINCOME.lat);
  for (const list of [...groups.values()].sort((a, b) => Math.min(...a) - Math.min(...b))) {
    list.sort((a, b) => a - b);
    const id = junctions.length;
    let x = 0;
    let y = 0;
    for (const n of list) {
      junctionOf[n] = id;
      x += graph.nodeX[n] / list.length;
      y += graph.nodeY[n] / list.length;
    }
    const cycle = Math.hypot(x - rx, y - ry) < RINCOME_RADIUS_M ? RINCOME_CYCLE_S : SIGNAL_CYCLE_S;
    // Deterministic spread of phases between junctions.
    const offset = (Math.imul(list[0] + 1, 2654435761) >>> 0) % cycle;
    junctions.push({ id, nodes: list, x, y, cycle, offset, axis: 0 });
  }

  // Approaches: arcs into a junction from outside it.
  const arcGroup = new Int8Array(graph.edges.length * 2).fill(-1);
  const byJunction: number[][] = junctions.map(() => []);
  graph.edges.forEach((e, edge) => {
    if (e.virtual) return;
    for (const arc of e.oneway ? [edge * 2] : [edge * 2, edge * 2 + 1]) {
      const j = junctionOf[graph.arcTo(arc)];
      if (j < 0 || junctionOf[graph.arcFrom(arc)] === j) continue;
      byJunction[j].push(arc);
    }
  });
  const approaches: number[] = [];
  for (const j of junctions) {
    const arcs = byJunction[j.id];
    if (!arcs.length) continue;
    // The main road: the biggest class, then the longest approach.
    const main = arcs.reduce((best, a) => {
      const ea = graph.edges[a >> 1];
      const eb = graph.edges[best >> 1];
      return ea.cls < eb.cls || (ea.cls === eb.cls && ea.len > eb.len) ? a : best;
    });
    j.axis = graph.arcEndHeading(main);
    for (const arc of arcs) {
      let d = Math.abs(angleDiff(j.axis, graph.arcEndHeading(arc)));
      if (d > Math.PI / 2) d = Math.PI - d;
      arcGroup[arc] = d < Math.PI / 4 ? 0 : 1;
      approaches.push(arc);
    }
  }
  approaches.sort((a, b) => a - b);
  return { junctions, junctionOf, arcGroup, approaches };
}

/** The light a group sees at a junction at a game time. Group 0 is green first in each cycle. */
export function groupLight(j: SignalJunction, group: number, time: number): SignalLight {
  const phase = (((time + j.offset) % j.cycle) + j.cycle) % j.cycle;
  const half = j.cycle / 2;
  const local = group === 0 ? phase : (phase + half) % j.cycle;
  if (local < half - AMBER_S) return 'green';
  if (local < half) return 'amber';
  return 'red';
}

/** Seconds until a group's light next changes. */
export function lightChangesIn(j: SignalJunction, group: number, time: number): number {
  const phase = (((time + j.offset) % j.cycle) + j.cycle) % j.cycle;
  const half = j.cycle / 2;
  const local = group === 0 ? phase : (phase + half) % j.cycle;
  if (local < half - AMBER_S) return half - AMBER_S - local;
  if (local < half) return half - local;
  return j.cycle - local;
}

/** The light facing a vehicle at the end of an arc, or null when that junction has no signal for it. */
export function arcLight(game: Game, arc: number, time = game.state.time): SignalLight | null {
  const map = signalMap(game.world.graph);
  const group = map.arcGroup[arc];
  if (group < 0) return null;
  return groupLight(map.junctions[map.junctionOf[game.world.graph.arcTo(arc)]], group, time);
}

export interface SignalAhead {
  /** The controlled approach arc. */
  arc: number;
  junction: SignalJunction;
  group: number;
  light: SignalLight;
  /** Metres to the stop line (negative once past it). */
  toLine: number;
}

/**
 * The next signal a vehicle meets within maxMetres: along its GPS route, or
 * for a tuk-tuk steered by hand, the way it will turn at each junction.
 */
export function signalAhead(game: Game, v: Vehicle, maxMetres = LOOKAHEAD_M): SignalAhead | null {
  const graph = game.world.graph;
  const map = signalMap(graph);
  if (!map.approaches.length) return null;
  const manual = isManualDriven(game, v);
  let turn = manual ? manualControl(game).turn : null;
  const route = v.route;
  let arc = v.arc;
  let idx = v.routeIdx;
  let onRoute = !!route && route.arcs[idx] === arc;
  let ahead = graph.arcLen(arc) - v.s;
  for (let hop = 0; hop < 6; hop++) {
    const group = map.arcGroup[arc];
    if (group >= 0) {
      const junction = map.junctions[map.junctionOf[graph.arcTo(arc)]];
      return { arc, junction, group, light: groupLight(junction, group, game.state.time), toLine: ahead - STOP_LINE_M };
    }
    if (ahead >= maxMetres) return null;
    if (route && graph.arcTo(arc) === route.target) return null;
    const routeNext = onRoute && route && idx + 1 < route.arcs.length ? route.arcs[idx + 1] : -1;
    let next: number;
    if (!manual) {
      if (routeNext < 0) return null;
      next = routeNext;
    } else {
      const exit = chooseExit(graph, arc, turn, routeNext);
      if (!exit) return null;
      if (exit.usedTurn) turn = null;
      next = exit.arc;
    }
    if (next === routeNext) idx++;
    else onRoute = false;
    arc = next;
    ahead += graph.arcLen(arc);
  }
  return null;
}

/**
 * Speed cap (m/s) that brings a vehicle to a stop at the line of a red light
 * ahead. Vehicles past the line, or too close to it when the light turns
 * amber, carry on. The tuk-tuk the player steers by hand is never capped.
 */
export function signalCap(game: Game, v: Vehicle): number {
  if (isManualDriven(game, v) || !v.route) return Infinity;
  const ahead = signalAhead(game, v);
  if (!ahead || ahead.light === 'green' || ahead.toLine < -COMMITTED_M) return Infinity;
  if (ahead.light === 'amber' && ahead.toLine < AMBER_GO_M) return Infinity;
  if (ahead.toLine <= AT_LINE_M) return 0;
  return ahead.toLine / BRAKE_HORIZON_S;
}

// ------------------------------------------------------------ red lights
interface RedRunState {
  vehicleId: number;
  arc: number;
  /** Red lights run per trip (request id), for the rating. */
  trips: Map<number, number>;
}

const runs = new WeakMap<Game, RedRunState>();

function redRunState(game: Game): RedRunState {
  let st = runs.get(game);
  if (!st) runs.set(game, (st = { vehicleId: -1, arc: -1, trips: new Map() }));
  return st;
}

/** Red lights the player has run on a trip so far. */
export function redLightsRun(game: Game, requestId: number): number {
  return runs.get(game)?.trips.get(requestId) ?? 0;
}

/** Stops the fleet at red lights and watches the player's hand-driven tuk-tuk for red light runs. */
export class SignalSystem implements GameSystem {
  readonly id = 'signals';

  init(game: Game): void {
    if (!game.speedCaps.includes(capFor(game))) game.speedCaps.push(capFor(game));
    game.ratingModifiers.push((_vehicle, trip) => {
      const n = redLightsRun(game, trip.request.id);
      return n ? Math.max(RED_RUN_RATING_MIN, n * RED_RUN_RATING) : 0;
    });
  }

  update(game: Game): void {
    const st = redRunState(game);
    const v = game.playerVehicle();
    if (!v || !isManualDriven(game, v)) {
      st.vehicleId = -1;
      st.arc = -1;
      return;
    }
    if (st.vehicleId !== v.id) {
      st.vehicleId = v.id;
      st.arc = v.arc;
      return;
    }
    const prev = st.arc;
    st.arc = v.arc;
    if (prev === v.arc || prev < 0 || v.arc === reverseArc(prev)) return;
    if (arcLight(game, prev) !== 'red') return;
    this.ranRed(game, v);
  }

  private ranRed(game: Game, v: Vehicle): void {
    const st = redRunState(game);
    const pose = game.vehiclePose(v);
    if (v.task.kind === 'trip') {
      const id = v.task.trip.request.id;
      st.trips.set(id, (st.trips.get(id) ?? 0) + 1);
    }
    if (game.rng.chance(POLICE_CHANCE)) {
      spend(game, POLICE_FINE, 'fees');
      game.notify(`Police at the junction! ฿${POLICE_FINE} fine for running a red light.`, 'bad', pose.x, pose.y);
    } else if (v.task.kind === 'trip') {
      game.notify('You ran a red light — your passenger grips the rail.', 'bad', pose.x, pose.y);
    }
  }
}

const caps = new WeakMap<Game, (v: Vehicle) => number>();

/** One cap function per game, so installing twice is harmless. */
function capFor(game: Game): (v: Vehicle) => number {
  let cap = caps.get(game);
  if (!cap) caps.set(game, (cap = (v) => signalCap(game, v)));
  return cap;
}
