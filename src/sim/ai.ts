// Behaviour of tuk-tuks that are not steered by the player: hired drivers, and
// the player's own tuk-tuk when autopilot is on.

import { ZONES } from '../content/zones';
import { VEHICLE_MODELS } from '../content/vehicles';
import { BALANCE } from './balance';
import { calendar, type CalendarInfo } from './clock';
import { abandonRequest, claimRequest, measureRequest, quote, startTrip, findRequest } from './dispatch';
import { originWeight } from './demand';
import type { Game } from './game';
import { climbBlocked } from './mountain';
import { sendTo } from './movement';
import { awaySeconds } from './offmap';
import type { Driver, Place, RideRequest, Vehicle } from './types';

/** Game seconds between decisions for one idle vehicle. */
const THINK_INTERVAL = 20;
/** Game seconds an idle driver waits at a rank before cruising elsewhere. */
export const RANK_WAIT = 12 * 60;

export function onShift(driver: Driver, cal: CalendarInfo): boolean {
  const h = cal.hour;
  switch (driver.shift) {
    case 'day':
      return h >= 6 && h < 18;
    case 'night':
      return h >= 16 || h < 3;
    case 'long':
      return h >= 7 && h < 23;
  }
}

export function zoneCentre(game: Game, zoneId: string | null): { x: number; y: number; r: number } | null {
  const z = ZONES.find((zz) => zz.id === zoneId);
  if (!z) return null;
  const [x, y] = game.world.graph.projection.toXY(z.lon, z.lat);
  return { x, y, r: z.radius };
}

/** Rough score of a request for a given vehicle: THB per second of work. */
export function requestValue(game: Game, v: Vehicle, req: RideRequest): number {
  const pos = game.vehiclePose(v);
  const from = game.world.places[req.from];
  const pickup = Math.hypot(from.x - pos.x, from.y - pos.y) * BALANCE.trip.detourFactor;
  const eta = pickup / 6.5;
  if (game.state.time + eta > req.expiresAt + 4 * 60) return 0;
  const ride = req.distance / 7;
  let work = eta + ride + 120;
  // Out of town the tuk-tuk also has to come back: empty after a drop-off, or with the passenger after the wait.
  const to = game.world.places[req.to];
  const off = to.offmap;
  if (off) work += off.roundTrip ? off.waitS + ride : awaySeconds(game, to, off.extraM);
  // What the company keeps: app platforms take their cut of the fixed fare.
  const fare = req.fixedFare === null ? req.fairFare : req.channel === 'app' ? req.fixedFare * (1 - BALANCE.app.platformCut) : req.fixedFare;
  return fare / work;
}

function pickRequest(game: Game, v: Vehicle, driver: Driver): RideRequest | null {
  const zone = zoneCentre(game, driver.zone);
  let best: RideRequest | null = null;
  let bestScore = 0;
  for (const req of game.state.requests) {
    if (req.claimedBy !== null || !game.canSee(v, req)) continue;
    const model = VEHICLE_MODELS[v.model];
    if (model && req.party > model.seats) continue;
    if (climbBlocked(game, v, req)) continue;
    let score = requestValue(game, v, req);
    if (zone) {
      const from = game.world.places[req.from];
      if (Math.hypot(from.x - zone.x, from.y - zone.y) <= zone.r) score *= 1.4;
    }
    if (score > bestScore) {
      bestScore = score;
      best = req;
    }
  }
  return best;
}

function nearestPlace(game: Game, v: Vehicle, places: Place[]): Place | null {
  const pos = game.vehiclePose(v);
  let best: Place | null = null;
  let bestD = Infinity;
  for (const p of places) {
    const d = Math.hypot(p.x - pos.x, p.y - pos.y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Busy spot worth waiting at, preferring the driver's zone. */
function pickRank(game: Game, v: Vehicle, driver: Driver, cal: CalendarInfo): Place | null {
  const zone = zoneCentre(game, driver.zone);
  const pos = game.vehiclePose(v);
  const candidates = game.world.landmarks;
  const weights = candidates.map((p) => {
    let w = originWeight(game, p, cal);
    const d = Math.hypot(p.x - pos.x, p.y - pos.y);
    w *= Math.exp(-d / 2000);
    if (zone) w *= Math.hypot(p.x - zone.x, p.y - zone.y) <= zone.r ? 4 : 0.2;
    return w;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  return candidates[game.rng.weighted(weights, total)];
}

/** AI fare quote: the company fare policy, bent by the driver's honesty. */
export function aiQuoteRatio(game: Game, driver: Driver): number {
  const policy = game.state.farePolicy;
  const greed = (60 - driver.honesty) / 250;
  return Math.max(0.8, policy + greed + game.rng.gauss() * 0.04);
}

/** Resolve the kerbside negotiation for a non-player driver. */
export function aiHaggle(game: Game, v: Vehicle, driver: Driver): void {
  if (v.task.kind !== 'pickup' && v.task.kind !== 'haggle') return;
  const req = findRequest(game, v.task.requestId);
  if (!req) {
    v.task = { kind: 'idle' };
    return;
  }
  measureRequest(game, req);
  if (req.fixedFare !== null) {
    startTrip(game, v, req.fixedFare);
    return;
  }
  const ask = Math.max(10, Math.round((req.fairFare * aiQuoteRatio(game, driver)) / 10) * 10);
  const first = quote(game, v, ask, false);
  if (first.kind === 'accept') startTrip(game, v, first.fare);
  else if (first.kind === 'counter' && first.offer >= req.fairFare * 0.8) startTrip(game, v, first.offer);
  else abandonRequest(game, v);
}

export class FleetAI {
  update(game: Game): void {
    const cal = calendar(game.state.time);
    for (const v of game.state.vehicles) {
      if (v.driverId === null) continue;
      const driver = game.driver(v.driverId);
      if (!driver) continue;
      if (driver.isPlayer && !game.state.autopilot) continue;
      if (game.state.time < v.busyUntil) continue;
      if (v.task.kind === 'broken' || v.task.kind === 'trip' || v.task.kind === 'haggle' || v.task.kind === 'away') continue;
      if (v.task.kind === 'pickup' || v.task.kind === 'refuel' || v.task.kind === 'depot') continue;
      // idle, cruise, offduty: think periodically.
      const slot = (Math.floor(game.state.time / THINK_INTERVAL) + v.id) % 2;
      if (slot !== 0 && v.task.kind !== 'idle') continue;
      this.think(game, v, driver, cal);
    }
  }

  private think(game: Game, v: Vehicle, driver: Driver, cal: CalendarInfo): void {
    if (!driver.isPlayer && (!onShift(driver, cal) || (driver.restUntil ?? 0) > game.state.time)) {
      if (v.task.kind !== 'offduty') {
        v.task = { kind: 'offduty' };
        v.route = null;
      }
      return;
    }
    if (v.task.kind === 'offduty') v.task = { kind: 'idle' };

    if (v.fuel < 0.22) {
      const model = VEHICLE_MODELS[v.model];
      const stations = model?.powertrain === 'ev' ? game.chargers() : game.world.lpgStations;
      const station = nearestPlace(game, v, stations);
      if (station && sendTo(game, v, station.node)) {
        v.task = { kind: 'refuel', place: station.idx };
        return;
      }
    }

    const req = pickRequest(game, v, driver);
    if (req && claimRequest(game, v, req.id)) return;

    if (v.task.kind === 'cruise' && v.route) return;
    if (v.task.kind === 'idle' && v.route === null && game.state.time < v.waitUntil) return;
    const rank = pickRank(game, v, driver, cal);
    if (rank && sendTo(game, v, rank.node)) v.task = { kind: 'cruise', place: rank.idx };
  }
}
