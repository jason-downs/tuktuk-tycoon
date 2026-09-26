// Manual driving: the player steers their own tuk-tuk. Throttle and brake set
// the speed, up to MANUAL_SPEED_BONUS × the normal road speed, and at each
// junction the tuk-tuk takes the player's chosen turn, else the GPS route's next
// arc, else the road straight ahead. Leaving the GPS route re-plans it from the
// junction just taken. Passengers who like a thrill rate fast manual driving
// higher; nervous ones rate it lower (ARCHETYPES[…].thrill).
//
// At the kerb the player picks up a waiting passenger by hand (manualPickup:
// stop within PICKUP_RADIUS_M, the passenger walks over, then the haggle
// starts) or fills up at a pump (manualRefuel). On a two-way road the
// tuk-tuk can U-turn from a standstill (uTurn). setAutodrive hands the wheel to
// the GPS and back.
//
// The switch and the controls are runtime-only (not saved): a loaded game
// starts with the GPS driving. A passenger walking over to the tuk-tuk is
// saved in game.state.systems.manual, so the haggle still starts after a load.

import { ARCHETYPES } from '../content/archetypes';
import { VEHICLE_MODELS } from '../content/vehicles';
import { angleDiff } from '../geo';
import { BALANCE } from './balance';
import { findRequest, fitsParty, partyTooBigText, refuel, releaseClaim } from './dispatch';
import type { Game, GameSystem, RatingModifier } from './game';
import { edgeWidth, reverseArc, type RoadGraph } from './graph';
import { beginKerbside } from './kerbside';
import { CLIMB_BLOCKED_TEXT, climbBlocked } from './mountain';
import { accountDistance, targetSpeed } from './movement';
import type { Place, RideRequest, Vehicle } from './types';

/** [pacing] Top speed in manual mode relative to the normal road speed. */
export const MANUAL_SPEED_BONUS = 1.15;
/** m/s² in game time: throttle, rolling without throttle, braking. */
const ACCEL = 2.4;
const COAST = 1.2;
const BRAKE = 5.5;
/** Heading change (radians, ≈20°) within which a road counts as straight on. */
const STRAIGHT_RAD = 0.35;
/** [pacing] Rating change per unit of archetype thrill for a trip driven entirely above road speed. */
const THRILL_RATING = 1.2;
/** Driving this much above the road speed counts as fast. */
const FAST_RATIO = 1.03;
/** [pacing] A waiting passenger this close (m) to the tuk-tuk can be picked up by hand. */
export const PICKUP_RADIUS_M = 25;
/** [pacing] Top speed (m/s) at which a passenger will climb in, and at which the tuk-tuk can refuel or U-turn. */
export const PICKUP_MAX_SPEED = 1.5;
/** [pacing] Game seconds a passenger takes to walk over to the tuk-tuk. */
export const WALK_OVER_S = 20;
/** A pump or charger this close (m) to the tuk-tuk can be used by hand. */
export const PUMP_RADIUS_M = 30;
/** Where a waiting passenger stands: at least this far back from the junction node along the road… */
const KERB_BACK_M = 6;
/** …and this far beyond the edge of any crossing carriageway, clear of the rounded kerb corners (up to 6 m radius). */
const KERB_JUNCTION_CLEAR_M = 4;
/** Distance (m) from the carriageway edge to where the passenger stands: on the pavement, just behind the kerb. */
const KERB_STAND_M = 0.7;
/** Other spots kerbCandidates offers: further from the junction (m, added to the setback; negative is nearer)… */
const KERB_MORE_BACK_M = [-2, 3, 6, 10];
/** …and nearer the kerb (m outside it), where a building is mapped over the back of the pavement. */
const KERB_NEAR_STAND_M = 0.4;
/** Farthest (m) any of those spots lies from kerbPoint, which the pickup distance is measured to (within PICKUP_RADIUS_M). */
const KERB_MAX_SHIFT_M = 20;

export type TurnIntent = 'left' | 'right';
export type TurnKind = 'left' | 'right' | 'straight' | 'uturn';

export interface ManualControl {
  on: boolean;
  vehicleId: number | null;
  throttle: boolean;
  brake: boolean;
  /** Times the throttle or brake has been pressed down, so a press between two frames is not missed. */
  presses: number;
  /** Turn to take at the next junction that offers it; null follows the GPS or goes straight. */
  turn: TurnIntent | null;
  /** Request id of the trip being driven, and metres driven on it (all / above road speed). */
  trip: number;
  tripMetres: number;
  fastMetres: number;
}

/** Saved manual-driving state (game.state.systems.manual). */
interface ManualState {
  /** A passenger walking over to the tuk-tuk: the haggle starts at game time `at`. */
  kerbside: { requestId: number; at: number } | null;
}

const controls = new WeakMap<Game, ManualControl>();

export function manualControl(game: Game): ManualControl {
  let c = controls.get(game);
  if (!c) {
    c = { on: false, vehicleId: null, throttle: false, brake: false, presses: 0, turn: null, trip: -1, tripMetres: 0, fastMetres: 0 };
    controls.set(game, c);
  }
  return c;
}

function manualState(game: Game): ManualState {
  const s = (game.state.systems.manual ??= {}) as Partial<ManualState>;
  s.kerbside ??= null;
  return s as ManualState;
}

export function isManualDriven(game: Game, v: Vehicle): boolean {
  const c = controls.get(game);
  return !!c && c.on && c.vehicleId === v.id;
}

/** Switch manual driving for the player's tuk-tuk. Turns autopilot off. Returns false if there is no tuk-tuk. */
export function setManual(game: Game, on: boolean): boolean {
  const c = manualControl(game);
  const v = game.playerVehicle();
  if (on && !v) return false;
  c.on = on;
  c.vehicleId = on && v ? v.id : null;
  c.throttle = false;
  c.brake = false;
  c.turn = null;
  if (on && game.state.autopilot) game.state.autopilot = false;
  game.emit('manual', on);
  game.emit('change');
  return true;
}

export function setPedals(game: Game, throttle: boolean, brake: boolean): void {
  const c = manualControl(game);
  if ((throttle && !c.throttle) || (brake && !c.brake)) c.presses++;
  c.throttle = throttle;
  c.brake = brake;
}

/** Choose the turn at the next junction; asking for the opposite side cancels the choice. */
export function pickTurn(game: Game, dir: TurnIntent): void {
  const c = manualControl(game);
  c.turn = c.turn && c.turn !== dir ? null : dir;
}

// ------------------------------------------------------------ junctions
export interface Exit {
  arc: number;
  /** Heading change from the arriving arc, radians; positive turns left. */
  delta: number;
  kind: TurnKind;
}

/** The ways on from the end of an arc, excluding turning back. */
export function exitsAt(graph: RoadGraph, inArc: number): Exit[] {
  const out = graph.outgoing(graph.arcTo(inArc));
  const back = reverseArc(inArc);
  const heading = graph.arcEndHeading(inArc);
  const exits: Exit[] = [];
  for (let i = 0; i < out.length; i++) {
    const arc = out[i];
    if (arc === back) continue;
    const delta = angleDiff(heading, graph.arcStartHeading(arc));
    exits.push({ arc, delta, kind: Math.abs(delta) <= STRAIGHT_RAD ? 'straight' : delta > 0 ? 'left' : 'right' });
  }
  return exits;
}

export interface ExitChoice extends Exit {
  /** The player's turn choice was used here. */
  usedTurn: boolean;
}

/**
 * Which arc to take at the end of inArc: the left-most or right-most exit when
 * the player asked for that turn and the junction has one, else the GPS
 * route's next arc, else the straightest road. A dead end turns back.
 */
export function chooseExit(graph: RoadGraph, inArc: number, turn: TurnIntent | null, routeNext: number): ExitChoice | null {
  const exits = exitsAt(graph, inArc);
  if (!exits.length) {
    const back = reverseArc(inArc);
    return graph.arcValid(back) ? { arc: back, delta: Math.PI, kind: 'uturn', usedTurn: false } : null;
  }
  if (turn && exits.length >= 2) {
    const side = exits.reduce((best, e) => ((turn === 'left' ? e.delta > best.delta : e.delta < best.delta) ? e : best));
    if (side.kind === turn) return { ...side, usedTurn: true };
  }
  const onRoute = exits.find((e) => e.arc === routeNext);
  if (onRoute) return { ...onRoute, usedTurn: false };
  const straight = exits.reduce((best, e) => (Math.abs(e.delta) < Math.abs(best.delta) ? e : best));
  return { ...straight, usedTurn: false };
}

function routeNextArc(v: Vehicle, idx: number): number {
  const r = v.route;
  return r && idx + 1 < r.arcs.length && r.arcs[idx] === v.arc ? r.arcs[idx + 1] : -1;
}

// ------------------------------------------------------------ driving
/**
 * Advance a manually driven vehicle by dt game seconds. Returns true on the
 * step it reaches the end of its GPS route (the pickup, drop-off or pump).
 */
export function driveManual(game: Game, v: Vehicle, dt: number): boolean {
  const c = manualControl(game);
  const graph = game.world.graph;
  if (game.state.time < v.busyUntil) {
    v.speed = 0;
    return false;
  }
  if (v.route && v.route.arcs.length === 0) {
    v.route = null;
    v.speed = 0;
    return true;
  }
  const road = targetSpeed(game, v);
  const cap = road * MANUAL_SPEED_BONUS;
  if (c.brake) v.speed = Math.max(0, v.speed - BRAKE * dt);
  else if (c.throttle && v.speed < cap) v.speed = Math.min(cap, v.speed + ACCEL * dt);
  else if (!c.throttle) v.speed = Math.max(0, v.speed - COAST * dt);
  if (v.speed > cap) v.speed = Math.max(cap, v.speed - BRAKE * dt);

  let dist = v.speed * dt;
  const planned = dist;
  let arrived = false;
  while (dist > 0) {
    const len = graph.arcLen(v.arc);
    if (v.s + dist < len) {
      v.s += dist;
      dist = 0;
      break;
    }
    dist -= len - v.s;
    const route = v.route;
    if (route && graph.arcTo(v.arc) === route.target) {
      v.s = len;
      arrived = true;
      break;
    }
    const routeNext = routeNextArc(v, v.routeIdx);
    const exit = chooseExit(graph, v.arc, c.turn, routeNext);
    if (!exit) {
      v.s = len;
      v.speed = 0;
      break;
    }
    if (exit.usedTurn) c.turn = null;
    if (route) {
      if (exit.arc === routeNext) v.routeIdx++;
      else {
        // Off the GPS route: plan again from the junction just taken, without turning back.
        const again = game.world.router.route({ arc: exit.arc, s: 0 }, route.target, false);
        v.route = again;
        v.routeIdx = 0;
      }
    }
    v.arc = exit.arc;
    v.s = 0;
  }
  const metres = planned - dist;
  accountDistance(game, v, metres / 1000);
  recordTrip(c, v, metres, road);
  if (arrived) {
    v.route = null;
    v.speed = 0;
  }
  return arrived;
}

function recordTrip(c: ManualControl, v: Vehicle, metres: number, road: number): void {
  if (v.task.kind !== 'trip') return;
  const id = v.task.trip.request.id;
  if (c.trip !== id) {
    c.trip = id;
    c.tripMetres = 0;
    c.fastMetres = 0;
  }
  c.tripMetres += metres;
  if (v.speed > road * FAST_RATIO) c.fastMetres += metres;
}

/** Rating change for a trip the player drove by hand: thrill-seekers like speed, nervous riders don't. */
export function manualRating(game: Game): RatingModifier {
  return (v, trip) => {
    const c = controls.get(game);
    if (!c || c.vehicleId !== v.id || c.trip !== trip.request.id || c.tripMetres <= 0) return 0;
    const share = Math.min(1, c.fastMetres / Math.max(trip.distance, c.tripMetres));
    const bonus = ARCHETYPES[trip.request.archetype].thrill * share * THRILL_RATING;
    return Math.max(-0.9, Math.min(0.9, bonus));
  };
}

// ------------------------------------------------------------ preview
export interface TurnPreview {
  /** Junction node ahead. */
  node: number;
  /** The way the tuk-tuk will leave it; null when the GPS destination comes first. */
  exit: ExitChoice | null;
  /** Metres to the node. */
  distance: number;
  /** Why this exit: the player's turn, the GPS route, or simply the road ahead. */
  source: 'turn' | 'route' | 'road' | 'arrive';
}

/** The next junction ahead of a manually driven vehicle and the way it will take there. */
export function previewTurn(game: Game, v: Vehicle, maxMetres = 800): TurnPreview | null {
  const graph = game.world.graph;
  const c = manualControl(game);
  let arc = v.arc;
  let idx = v.routeIdx;
  let onRoute = !!v.route && v.route.arcs[idx] === arc;
  let distance = graph.arcLen(arc) - v.s;
  for (let hop = 0; hop < 40 && distance <= maxMetres; hop++) {
    const node = graph.arcTo(arc);
    if (v.route && node === v.route.target) return { node, exit: null, distance, source: 'arrive' };
    const routeNext = onRoute && v.route && idx + 1 < v.route.arcs.length ? v.route.arcs[idx + 1] : -1;
    const exit = chooseExit(graph, arc, c.turn, routeNext);
    if (!exit) return null;
    const junction = exitsAt(graph, arc).length >= 2 || exit.kind === 'uturn';
    if (junction) return { node, exit, distance, source: exit.usedTurn ? 'turn' : exit.arc === routeNext ? 'route' : 'road' };
    if (exit.arc === routeNext) idx++;
    else onRoute = false;
    arc = exit.arc;
    distance += graph.arcLen(arc);
  }
  return null;
}

// ------------------------------------------------------------ system
/** Registers the manual-driving rating rule and keeps manual and autopilot exclusive. */
export class ManualSystem implements GameSystem {
  readonly id = 'manual';

  init(game: Game): void {
    game.ratingModifiers.push(manualRating(game));
  }

  update(game: Game): void {
    const s = manualState(game);
    if (s.kerbside && game.state.time >= s.kerbside.at) {
      const { requestId } = s.kerbside;
      s.kerbside = null;
      const v = game.playerVehicle();
      if (v && v.task.kind === 'pickup' && v.task.requestId === requestId) beginKerbside(game, v, requestId);
    }
    const c = controls.get(game);
    if (!c?.on) return;
    if (game.state.autopilot) {
      setManual(game, false);
      game.notify('Autopilot is driving now — manual driving off.', 'info');
      return;
    }
    const v = game.playerVehicle();
    if (!v) setManual(game, false);
    else if (v.id !== c.vehicleId) c.vehicleId = v.id;
  }
}

// ------------------------------------------------------------ at the kerb
const _kerbPose = { x: 0, y: 0, heading: 0 };

/** Where a waiting passenger stands (sim metres) and the heading (radians) that faces the carriageway. */
export interface KerbPoint {
  x: number;
  y: number;
  face: number;
}

/**
 * Stand points on both pavements of every road at a node: `more` metres
 * further from the junction than the base setback (KERB_BACK_M, or past the
 * widest crossing carriageway by KERB_JUNCTION_CLEAR_M; never beyond half the
 * road), `stand` metres outside the drawn kerb, each facing the carriageway.
 */
function kerbSpots(g: RoadGraph, node: number, more: readonly number[], stand: readonly number[], out: KerbPoint[] = []): KerbPoint[] {
  const edges = g.edgesAt(node);
  for (const ei of edges) {
    const e = g.edges[ei];
    if (e.virtual) continue;
    let cross = 0;
    for (const oi of edges) if (oi !== ei && !g.edges[oi].virtual) cross = Math.max(cross, edgeWidth(g.edges[oi]) / 2);
    const base = Math.max(KERB_BACK_M, cross + KERB_JUNCTION_CLEAR_M);
    for (const m of more) {
      // The arc leaving the node along this edge; its pose gives the road direction there.
      const p = g.poseAt(ei * 2 + (e.a === node ? 0 : 1), Math.min(base + m, e.len / 2), _kerbPose);
      for (const st of stand) {
        const off = edgeWidth(e) / 2 + st;
        const lx = -Math.sin(p.heading) * off;
        const ly = Math.cos(p.heading) * off;
        for (const side of [1, -1]) out.push({ x: p.x + lx * side, y: p.y + ly * side, face: Math.atan2(-ly * side, -lx * side) });
      }
    }
  }
  return out;
}

/**
 * Where a waiting passenger stands: on the pavement of one of the roads that
 * meet at the place's node, set back from the junction beyond the crossing
 * carriageways, KERB_STAND_M outside the drawn kerb, on whichever road and
 * side is nearest the place.
 */
export function kerbPoint(game: Game, place: Place): KerbPoint {
  const g = game.world.graph;
  const node = place.node;
  let best: KerbPoint = { x: g.nodeX[node], y: g.nodeY[node], face: Math.atan2(g.nodeY[node] - place.y, g.nodeX[node] - place.x) || 0 };
  let bestD = Infinity;
  for (const k of kerbSpots(g, node, [0], [KERB_STAND_M])) {
    const d = Math.hypot(k.x - place.x, k.y - place.y);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/**
 * Every spot a waiting passenger at a place may stand, best first: kerbPoint's
 * spots nearest the place first (the first is kerbPoint), then spots further
 * along each pavement (KERB_MORE_BACK_M) and nearer the kerb
 * (KERB_NEAR_STAND_M), nearest the place first, then the kerbs at the far
 * ends of short roads from the place's node; none further than
 * KERB_MAX_SHIFT_M from kerbPoint. The 3D city build takes the first one
 * clear of the buildings, walls and street furniture it draws.
 */
export function kerbCandidates(graph: RoadGraph, place: Place): KerbPoint[] {
  const byDistance = (list: KerbPoint[]) =>
    list
      .map((k) => ({ k, d: Math.hypot(k.x - place.x, k.y - place.y) }))
      .sort((a, b) => a.d - b.d)
      .map((e) => e.k);
  const first = byDistance(kerbSpots(graph, place.node, [0], [KERB_STAND_M]));
  const more = kerbSpots(graph, place.node, KERB_MORE_BACK_M, [KERB_STAND_M]);
  kerbSpots(graph, place.node, [0, ...KERB_MORE_BACK_M], [KERB_NEAR_STAND_M], more);
  // Then the kerbs at the far ends of the place's roads: a dead-end lane under a building leads out to a street.
  const beyond: KerbPoint[] = [];
  for (const ei of graph.edgesAt(place.node)) {
    const e = graph.edges[ei];
    if (!e.virtual && e.len <= KERB_MAX_SHIFT_M) kerbSpots(graph, e.a === place.node ? e.b : e.a, [0], [KERB_STAND_M, KERB_NEAR_STAND_M], beyond);
  }
  const [k] = first;
  const near = (list: KerbPoint[]) => (k ? list.filter((c) => Math.hypot(c.x - k.x, c.y - k.y) <= KERB_MAX_SHIFT_M) : list);
  return first.slice(0, 1).concat(near(first.slice(1)), byDistance(near(more)), byDistance(near(beyond)));
}

/**
 * The nearest passenger the tuk-tuk could pick up here: in sight, not taken by another tuk-tuk, within
 * PICKUP_RADIUS_M, and (unless `anyParty`) with a party that fits in the tuk-tuk.
 */
export function kerbsidePassenger(game: Game, v: Vehicle, anyParty = false): RideRequest | null {
  const pose = game.vehiclePose(v);
  let best: RideRequest | null = null;
  let bestD = PICKUP_RADIUS_M;
  for (const req of game.visibleTo(v)) {
    if (req.claimedBy !== null && req.claimedBy !== v.id) continue;
    if (!anyParty && !fitsParty(v, req)) continue;
    const place = game.place(req.from);
    if (place.offmap) continue;
    const k = kerbPoint(game, place);
    const d = Math.hypot(k.x - pose.x, k.y - pose.y);
    if (d <= bestD) {
      bestD = d;
      best = req;
    }
  }
  return best;
}

export type PickupResult = 'walking' | 'none' | 'moving' | 'busy' | 'climb' | 'seats';

/**
 * Pick up the nearest waiting passenger by hand: the tuk-tuk must be within
 * PICKUP_RADIUS_M and slower than PICKUP_MAX_SPEED, with a seat for everyone
 * in the party. The passenger is claimed and walks over (WALK_OVER_S game
 * seconds while the tuk-tuk waits), then the kerbside haggle starts — or a
 * booking with a fixed fare simply boards. 'seats' means the only parties in
 * reach are too big for the tuk-tuk; like 'moving' and 'none' it posts no
 * notice, so manualInteract can still fill up at a pump first.
 */
export function manualPickup(game: Game): PickupResult {
  const v = game.playerVehicle();
  if (!v) return 'none';
  const kind = v.task.kind;
  if (kind === 'trip' || kind === 'haggle' || kind === 'broken' || kind === 'away' || kind === 'offduty') return 'busy';
  const req = kerbsidePassenger(game, v);
  if (!req && !kerbsidePassenger(game, v, true)) return 'none';
  if (v.speed >= PICKUP_MAX_SPEED) return 'moving';
  if (!req) return 'seats';
  if (climbBlocked(game, v, req)) {
    game.notify(CLIMB_BLOCKED_TEXT, 'bad');
    return 'climb';
  }
  releaseClaim(game, v);
  const now = game.state.time;
  req.claimedBy = v.id;
  req.expiresAt = Math.max(req.expiresAt, now + 5 * 60);
  v.task = { kind: 'pickup', requestId: req.id };
  v.route = null;
  v.routeIdx = 0;
  v.speed = 0;
  v.busyUntil = Math.max(v.busyUntil, now + WALK_OVER_S);
  manualState(game).kerbside = { requestId: req.id, at: now + WALK_OVER_S };
  game.emit('change');
  return 'walking';
}

/** The pump (or, for an electric tuk-tuk, the charger) within PUMP_RADIUS_M of a vehicle, if any. */
export function pumpNearby(game: Game, v: Vehicle): Place | null {
  const pose = game.vehiclePose(v);
  const g = game.world.graph;
  const ev = VEHICLE_MODELS[v.model]?.powertrain === 'ev';
  const stations = ev ? game.chargers() : game.world.lpgStations;
  let best: Place | null = null;
  let bestD = PUMP_RADIUS_M;
  for (const p of stations) {
    const d = Math.min(Math.hypot(p.x - pose.x, p.y - pose.y), Math.hypot(g.nodeX[p.node] - pose.x, g.nodeY[p.node] - pose.y));
    if (d <= bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

export type RefuelResult = 'filling' | 'none' | 'moving' | 'busy' | 'full';

/** Fill up by hand at a pump (or charger) beside the stopped tuk-tuk. */
export function manualRefuel(game: Game): RefuelResult {
  const v = game.playerVehicle();
  if (!v) return 'none';
  const kind = v.task.kind;
  if (kind === 'haggle' || kind === 'broken' || kind === 'away' || game.state.time < v.busyUntil) return 'busy';
  const pump = pumpNearby(game, v);
  if (!pump) return 'none';
  if (v.speed >= PICKUP_MAX_SPEED) return 'moving';
  if (v.fuel >= 0.99) return 'full';
  const model = VEHICLE_MODELS[v.model];
  const ev = model?.powertrain === 'ev';
  refuel(game, v, ev ? game.evChargePerKm(pump) : BALANCE.fuel.lpgPerKm, model?.rangeKm ?? BALANCE.fuel.tankKm);
  v.speed = 0;
  if (kind === 'refuel') {
    v.task = { kind: 'idle' };
    v.route = null;
  }
  game.notify(ev ? `Charging at ${pump.name}.` : `Filling up with LPG at ${pump.name}.`, 'info');
  game.emit('change');
  return 'filling';
}

export type InteractResult = PickupResult | RefuelResult;

/** The E key: pick up a passenger at the kerb, else fill up at a pump, else say what is missing. */
export function manualInteract(game: Game): InteractResult {
  const pickup = manualPickup(game);
  if (pickup === 'walking' || pickup === 'climb') return pickup;
  const fill = manualRefuel(game);
  if (fill === 'filling') return fill;
  if (pickup === 'moving' || fill === 'moving') {
    game.notify('Slow right down and stop at the kerb first.', 'info');
    return 'moving';
  }
  const v = game.playerVehicle();
  const crowd = pickup === 'seats' && v ? kerbsidePassenger(game, v, true) : null;
  if (v && crowd) {
    game.notify(partyTooBigText(v, crowd), 'bad');
    return 'seats';
  }
  if (fill === 'full') {
    game.notify('The tank is already full.', 'info');
    return 'full';
  }
  if (pickup === 'busy' && v?.task.kind === 'trip') {
    game.notify('You already have a passenger aboard.', 'info');
    return 'busy';
  }
  game.notify(`Nobody waiting here. Stop within ${PICKUP_RADIUS_M} m of a waving passenger, or beside a ⛽ pump.`, 'info');
  return 'none';
}

/** Turn round on the spot: stopped, on a two-way road. The GPS route is re-planned from the new heading. */
export function uTurn(game: Game): boolean {
  const v = game.playerVehicle();
  if (!v || !isManualDriven(game, v) || v.speed >= PICKUP_MAX_SPEED || game.state.time < v.busyUntil) return false;
  const graph = game.world.graph;
  const back = reverseArc(v.arc);
  if (!graph.arcValid(back)) return false;
  v.s = Math.max(0, graph.arcLen(v.arc) - v.s);
  v.arc = back;
  v.speed = 0;
  manualControl(game).turn = null;
  if (v.route) {
    const again = game.world.router.route({ arc: v.arc, s: v.s }, v.route.target, false);
    if (again) {
      v.route = again;
      v.routeIdx = 0;
    }
  }
  game.emit('uturn', v.id);
  return true;
}

export type Driving = 'hand' | 'gps' | 'autopilot';

/** Who drives the player's tuk-tuk: the player, the GPS along a route, or autopilot hunting for fares. */
export function whoDrives(game: Game): Driving {
  if (game.state.autopilot) return 'autopilot';
  return manualControl(game).on ? 'hand' : 'gps';
}

/**
 * Hand the wheel to the GPS (on) or take it back (off). The GPS follows the
 * current route; with nowhere to go it looks for passengers by itself
 * (autopilot). Returns who drives afterwards.
 */
export function setAutodrive(game: Game, on: boolean): Driving {
  const v = game.playerVehicle();
  if (!v) return whoDrives(game);
  if (!on) {
    setManual(game, true);
    return whoDrives(game);
  }
  setManual(game, false);
  const errand = v.route !== null || v.task.kind === 'trip' || v.task.kind === 'pickup' || v.task.kind === 'haggle';
  if (!errand) {
    game.state.autopilot = true;
    game.emit('change');
  }
  return whoDrives(game);
}

/** The passenger walking over to the tuk-tuk, if any. */
export function walkingPassenger(game: Game): RideRequest | undefined {
  const k = (game.state.systems.manual as Partial<ManualState> | undefined)?.kerbside;
  return k ? findRequest(game, k.requestId) : undefined;
}
