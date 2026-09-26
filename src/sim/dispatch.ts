// The life of a ride: claim a request, drive to the passenger, agree a fare,
// drive to the destination, get paid and rated.

import { ARCHETYPES } from '../content/archetypes';
import { haggleLine } from '../content/dialogue';
import { BALANCE, appFare, roundFare, streetFare } from './balance';
import { earn, currentBook, spend } from './economy';
import type { Game } from './game';
import { climbBlocked } from './mountain';
import { sendTo } from './movement';
import type { Driver, RideRequest, Trip, Vehicle } from './types';

export type QuoteOutcome =
  | { kind: 'accept'; fare: number; line: string }
  | { kind: 'counter'; offer: number; line: string }
  | { kind: 'leave'; line: string };

export interface TripResult {
  vehicleId: number;
  driverId: number | null;
  fare: number;
  tip: number;
  rating: number;
  request: RideRequest;
  /** What the company kept after the driver's share and platform cut. */
  companyTake: number;
}

export function findRequest(game: Game, id: number): RideRequest | undefined {
  return game.state.requests.find((r) => r.id === id);
}

/** Send a vehicle to pick up a waiting passenger. */
export function claimRequest(game: Game, v: Vehicle, requestId: number): boolean {
  const req = findRequest(game, requestId);
  if (!req || (req.claimedBy !== null && req.claimedBy !== v.id)) return false;
  if (v.task.kind === 'trip' || v.task.kind === 'broken' || v.task.kind === 'haggle') return false;
  if (climbBlocked(game, v, req)) return false;
  releaseClaim(game, v);
  const place = game.world.places[req.from];
  if (!sendTo(game, v, place.node)) return false;
  req.claimedBy = v.id;
  // A claimed passenger waits a little longer once they see you coming.
  req.expiresAt = Math.max(req.expiresAt, game.state.time + 5 * 60);
  v.task = { kind: 'pickup', requestId };
  return true;
}

/** Drop any passenger this vehicle had claimed but not yet picked up. */
export function releaseClaim(game: Game, v: Vehicle): void {
  if (v.task.kind === 'pickup' || v.task.kind === 'haggle') {
    const id = v.task.requestId;
    const req = findRequest(game, id);
    if (req && req.claimedBy === v.id) req.claimedBy = null;
    v.task = { kind: 'idle' };
  }
}

/** Refresh the fair fare with the real road distance once the tuk-tuk is at the kerb. */
export function measureRequest(game: Game, req: RideRequest): void {
  const { places, router } = game.world;
  const route = router.route(places[req.from].node, places[req.to].node);
  if (route) {
    req.distance = route.length;
    req.fairFare = streetFare(route.length);
    if (req.channel === 'app') req.fixedFare = appFare(route.length);
  }
}

/** Probability that a passenger accepts a fare at the given ratio. */
export function acceptChance(req: RideRequest, ratio: number, reputation: number): number {
  const maxRatio = req.maxRatio * (0.9 + reputation / 25);
  return 1 / (1 + Math.exp((ratio - maxRatio) / 0.05));
}

/** The player (or AI) names a price. Passengers counter once, then walk. */
export function quote(game: Game, v: Vehicle, fare: number, countered: boolean): QuoteOutcome {
  if (v.task.kind !== 'haggle' && v.task.kind !== 'pickup') return { kind: 'leave', line: '' };
  const req = findRequest(game, v.task.requestId);
  if (!req) return { kind: 'leave', line: '' };
  const rng = game.rng;
  if (req.archetype === 'monk' && fare === 0) return { kind: 'accept', fare: 0, line: haggleLine(game, req, 'merit') };
  const ratio = fare / req.fairFare;
  if (rng.chance(acceptChance(req, ratio, game.state.reputation))) {
    return { kind: 'accept', fare, line: haggleLine(game, req, 'thanks') };
  }
  if (!countered && req.maxRatio > 0.3) {
    const offer = roundFare(req.fairFare * req.maxRatio * rng.range(0.82, 0.97));
    if (offer < fare) return { kind: 'counter', offer, line: haggleLine(game, req, 'counter', offer) };
  }
  return { kind: 'leave', line: haggleLine(game, req, 'leave') };
}

/** Passenger walks away (declined, or the driver refused). */
export function abandonRequest(game: Game, v: Vehicle): void {
  if (v.task.kind === 'haggle' || v.task.kind === 'pickup') {
    const id = v.task.requestId;
    game.state.requests = game.state.requests.filter((r) => r.id !== id);
    v.task = { kind: 'idle' };
  }
}

/** Load the passenger and set off for the destination at the agreed fare. */
export function startTrip(game: Game, v: Vehicle, fare: number): boolean {
  if (v.task.kind !== 'haggle' && v.task.kind !== 'pickup') return false;
  const id = v.task.requestId;
  const req = findRequest(game, id);
  if (!req) return false;
  const dest = game.world.places[req.to];
  if (!sendTo(game, v, dest.node)) {
    abandonRequest(game, v);
    return false;
  }
  game.state.requests = game.state.requests.filter((r) => r.id !== id);
  const trip: Trip = {
    request: req,
    fare,
    ratio: req.fairFare > 0 ? fare / req.fairFare : 1,
    startedAt: game.state.time,
    distance: v.route?.length ?? req.distance,
  };
  v.task = { kind: 'trip', trip };
  v.busyUntil = game.state.time + BALANCE.trip.boardSeconds;
  return true;
}

function rateTrip(game: Game, v: Vehicle, trip: Trip, driver: Driver | null): number {
  const info = ARCHETYPES[trip.request.archetype];
  const expected = (trip.distance / 1000 / 24) * 3600 + BALANCE.trip.boardSeconds + 60;
  const took = game.state.time - trip.startedAt;
  const speedScore = Math.max(-1, Math.min(1, (expected - took) / expected)) * (0.4 + info.thrill * 0.4);
  const priceScore = trip.request.fixedFare !== null ? 0.2 : (1.1 - trip.ratio) * 2.2;
  const charm = driver ? (driver.charm - 50) / 100 : 0;
  let rating = 4.2 + speedScore + priceScore + charm + game.rng.gauss() * 0.3;
  for (const up of v.upgrades) rating += game.upgradeComfort(up);
  for (const m of game.ratingModifiers) rating += m(v, trip);
  if (v.condition < 30) rating -= 0.4;
  return Math.max(1, Math.min(5, rating));
}

export function completeTrip(game: Game, v: Vehicle): TripResult | null {
  if (v.task.kind !== 'trip') return null;
  const trip = v.task.trip;
  const req = trip.request;
  const driver = (v.driverId !== null ? game.driver(v.driverId) : null) ?? null;
  const info = ARCHETYPES[req.archetype];
  const rating = rateTrip(game, v, trip, driver);
  let tip = 0;
  if (rating >= 4 && game.rng.chance(info.tipChance * (rating - 3))) {
    tip = roundFare(game.rng.range(info.tip[0], info.tip[1]));
  }
  let fare = trip.fare;
  let companyTake = 0;
  const platformCut = req.channel === 'app' ? Math.round(fare * BALANCE.app.platformCut) : 0;
  fare -= platformCut;

  if (!driver || driver.isPlayer) {
    earn(game, fare, 'fares');
    if (tip) earn(game, tip, 'tips');
    companyTake = fare + tip;
  } else if (driver.payModel === 'salary') {
    const share = Math.round(fare * driver.commission);
    // Dishonest drivers pocket some fares.
    const skim = game.rng.chance((100 - driver.honesty) / 400) ? Math.round(fare * 0.3) : 0;
    earn(game, fare - skim, 'fares');
    if (share) spend(game, share, 'commission');
    companyTake = fare - skim - share;
    driver.earnedToday += share + tip + skim;
  } else {
    driver.earnedToday += fare + tip;
  }
  if (driver) {
    driver.trips++;
    driver.lifetimeFares += trip.fare;
    driver.rating = driver.rating * 0.95 + rating * 0.05;
    driver.fatigue = Math.min(100, driver.fatigue + 2 + (trip.distance / 1000) * (1 - driver.stamina / 200));
  }
  const state = game.state;
  state.ratings.push(rating);
  if (state.ratings.length > BALANCE.rating.window) state.ratings.shift();
  state.reputation = state.ratings.reduce((a, b) => a + b, 0) / state.ratings.length;
  state.stats.trips++;
  state.stats.fares += trip.fare;
  state.stats.passengers += req.party;
  state.stats.bestFare = Math.max(state.stats.bestFare, trip.fare);
  currentBook(game).trips++;
  v.task = { kind: 'idle' };
  v.busyUntil = game.state.time + BALANCE.trip.alightSeconds;
  const result: TripResult = { vehicleId: v.id, driverId: driver?.id ?? null, fare: trip.fare, tip, rating, request: req, companyTake };
  game.emit('trip', result);
  return result;
}

/** Fill up at a pump (or charger). Who pays depends on the driver's pay model. */
export function refuel(game: Game, v: Vehicle, perKm: number, rangeKm: number): void {
  const litresKm = (1 - v.fuel) * rangeKm;
  const cost = Math.round(litresKm * perKm);
  const driver = v.driverId !== null ? game.driver(v.driverId) : null;
  if (!driver || driver.isPlayer || driver.payModel === 'salary') spend(game, cost, 'fuel');
  else driver.earnedToday -= cost;
  v.fuel = 1;
  v.busyUntil = game.state.time + BALANCE.fuel.refuelSeconds;
}
