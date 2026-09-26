// The garage: upgrades, paint jobs, service & repair, the EV conversion kit and the fleet's
// automatic service policy. Work that takes a vehicle off the road is a workshop job: the vehicle
// sits in a 'broken' task carrying a `work` label until the job is done; this system then applies
// the result (condition, part, livery or new model) and puts the vehicle back on the road.
//
// Other systems:
// - The weather and events systems check for the 'rain_curtains' upgrade id to spare riders the
//   rain and Songkran-splash rating penalties.
// - garageRatingBonus is registered as a rating modifier (paint comfort and passenger-specific
//   upgrade effects; dispatch.ts adds each upgrade's flat comfort).
// - The Doi Suthep climb rule lives in mountain.ts.

import { PAINTS } from '../content/paints';
import { VEHICLE_UPGRADES, type VehicleUpgrade } from '../content/upgrades';
import { VEHICLE_MODELS, type VehicleModel } from '../content/vehicles';
import { calendar, HOUR, MINUTE } from './clock';
import { releaseClaim } from './dispatch';
import { spend } from './economy';
import type { Game, GameSystem } from './game';
import type { Archetype, Trip, Vehicle } from './types';

export const GARAGE_ID = 'garage';

/**
 * [pacing] THB per condition point a service restores. Anchored to economics.md §5 maintenance
 * (LPG 12,000–25,000/yr, ≈16,500/yr ≈ 55 per working day): a day's wear (~5 points) costs ~225,
 * higher than real life because a game day holds many more rides. Renters pay for repairs too
 * (economics.md §4: a driver on a yearly lease pays the repairs).
 */
export const SERVICE_THB_PER_POINT = 45;
/** [pacing] Game hours off the road for a service: 1 h for a check-up, up to 3 h for a wreck. */
export const SERVICE_MIN_HOURS = 1;
export const SERVICE_MAX_HOURS = 3;
/** [research] economics.md "Suggested game numbers": EV conversion kit for an owned LPG tuk-tuk. */
export const EV_KIT_PRICE = 200_000;
/** [pacing] A conversion keeps the tuk-tuk in the workshop for a game day. */
export const EV_CONVERSION_HOURS = 24;
/** [pacing] Game hours for a respray to dry. */
export const PAINT_HOURS = 2;
/** [pacing] Labour floor for any respray, including back to the classic Nakhon Blue. */
export const MIN_REPAINT = 1_500;
/** Condition thresholds offered for the fleet's automatic service policy. */
export const AUTO_SERVICE_OPTIONS = [40, 60, 80] as const;
/** [pacing] Upgrades with night effects count trips that start 19:00–04:00. */
export const NIGHT_FROM_HOUR = 19;
export const NIGHT_TO_HOUR = 4;

export type WorkshopJobKind = 'service' | 'fit' | 'paint' | 'ev';

export interface WorkshopJob {
  vehicleId: number;
  kind: WorkshopJobKind;
  /** Upgrade id (fit), paint id (paint) or target model id (ev); empty for a service. */
  item: string;
  start: number;
  until: number;
  cost: number;
}

export interface GarageState {
  jobs: WorkshopJob[];
  /** Hired drivers' tuk-tuks below this condition % go in for a service when their shift ends; null = off. */
  autoService: number | null;
}

/** The garage's saved state, with missing fields defaulted (older saves). */
export function garageState(game: Game): GarageState {
  let s = game.state.systems[GARAGE_ID] as Partial<GarageState> | undefined;
  if (!s || typeof s !== 'object') {
    s = {};
    game.state.systems[GARAGE_ID] = s;
  }
  if (!Array.isArray(s.jobs)) s.jobs = [];
  if (typeof s.autoService !== 'number') s.autoService = null;
  return s as GarageState;
}

/** Is this upgrade fitted (and finished)? */
export function hasUpgrade(v: Vehicle, id: string): boolean {
  return v.upgrades.includes(id);
}

/** Result of a garage check: ok, or the reason the player can't do it (shown in the UI). */
export interface Verdict {
  ok: boolean;
  reason: string;
}

const OK: Verdict = { ok: true, reason: '' };
const no = (reason: string): Verdict => ({ ok: false, reason });
const thb = (n: number): string => `฿${Math.round(n).toLocaleString('en-US')}`;

function afford(game: Game, cost: number): Verdict {
  return game.state.cash >= cost ? OK : no(`Needs ${thb(cost)} — you have ${thb(Math.max(0, game.state.cash))}.`);
}

/** The workshop job this vehicle is in for, if any. */
export function vehicleJob(game: Game, v: Vehicle): WorkshopJob | undefined {
  return garageState(game).jobs.find((j) => j.vehicleId === v.id);
}

/** Why the vehicle can't go into the workshop right now, or null when it can. */
export function workshopBlock(v: Vehicle): string | null {
  switch (v.task.kind) {
    case 'trip':
      return 'Drop off the passenger first.';
    case 'haggle':
      return 'Finish agreeing the fare first.';
    case 'away':
      return 'Out of town — wait for the drive back.';
    case 'broken':
      return v.task.work ? 'Already in the workshop.' : 'Broken down: the mechanic is already on it.';
    default:
      return null;
  }
}

function startJob(game: Game, v: Vehicle, kind: WorkshopJobKind, item: string, hours: number, cost: number, label: string): WorkshopJob {
  releaseClaim(game, v);
  const now = game.state.time;
  const job: WorkshopJob = { vehicleId: v.id, kind, item, start: now, until: now + hours * HOUR, cost };
  v.task = { kind: 'broken', until: job.until, work: label };
  v.route = null;
  v.speed = 0;
  garageState(game).jobs.push(job);
  return job;
}

function notifyAt(game: Game, v: Vehicle, text: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
  const pose = game.vehiclePose(v);
  game.notify(text, kind, pose.x, pose.y);
}

// ------------------------------------------------------------------ upgrades

/** Can this upgrade go on this vehicle now? */
export function canInstall(game: Game, v: Vehicle, id: string): Verdict {
  const up = VEHICLE_UPGRADES[id];
  if (!up) return no('Unknown part.');
  if (hasUpgrade(v, id)) return no('Already fitted.');
  const job = vehicleJob(game, v);
  if (job?.kind === 'fit' && job.item === id) return no('Being fitted now.');
  const model = VEHICLE_MODELS[v.model];
  if (up.powertrain && model && model.powertrain !== up.powertrain) {
    return no(up.powertrain === 'lpg' ? 'Only for LPG engines: an electric tuk-tuk has none.' : 'Only for electric tuk-tuks.');
  }
  if (up.climbs && model?.climbs) return no('This tuk-tuk already climbs Doi Suthep.');
  if (v.ownership === 'rented' && !up.rentable) {
    return no('Lung Daeng won’t let you drill holes in his tuk-tuk. Buy or lease your own to fit this.');
  }
  if (up.hours) {
    const block = workshopBlock(v);
    if (block) return no(block);
  }
  return afford(game, up.price);
}

/** Buy and fit an upgrade. Parts with fitting time send the vehicle to the workshop. */
export function installUpgrade(game: Game, v: Vehicle, id: string): boolean {
  if (!canInstall(game, v, id).ok) return false;
  const up = VEHICLE_UPGRADES[id];
  spend(game, up.price, 'upgrades');
  if (up.hours) {
    startJob(game, v, 'fit', id, up.hours, up.price, up.name);
    notifyAt(game, v, `${v.name} is in the workshop for ${up.name} (${up.hours} h).`);
  } else {
    v.upgrades.push(id);
    notifyAt(game, v, `${up.icon} ${up.name} fitted to ${v.name}.`, 'good');
  }
  game.emit('change');
  return true;
}

// --------------------------------------------------------------- service

/** Price and time to bring the vehicle back to 100 % condition. */
export function serviceQuote(v: Vehicle): { points: number; cost: number; hours: number } {
  const points = Math.max(0, Math.min(100, Math.ceil(100 - v.condition)));
  const cost = Math.round((points * SERVICE_THB_PER_POINT) / 10) * 10;
  const hours = SERVICE_MIN_HOURS + (SERVICE_MAX_HOURS - SERVICE_MIN_HOURS) * (points / 100);
  return { points, cost, hours };
}

export function canService(game: Game, v: Vehicle): Verdict {
  const q = serviceQuote(v);
  if (q.points < 1) return no('In top shape: nothing to fix.');
  const block = workshopBlock(v);
  if (block) return no(block);
  return afford(game, q.cost);
}

/** Book a service & repair: restores condition to 100 when the job is done. */
export function startService(game: Game, v: Vehicle): boolean {
  if (!canService(game, v).ok) return false;
  const q = serviceQuote(v);
  spend(game, q.cost, 'maintenance');
  startJob(game, v, 'service', '', q.hours, q.cost, 'service & repair');
  notifyAt(game, v, `${v.name} is in for a service: ${thb(q.cost)}, back in ${formatHours(q.hours)}.`);
  game.emit('change');
  return true;
}

/** Set the fleet's automatic service threshold (condition %), or null to switch it off. */
export function setAutoService(game: Game, threshold: number | null): void {
  garageState(game).autoService = threshold;
  game.emit('change');
}

// ----------------------------------------------------------------- paint

export function repaintCost(paintId: string): number {
  return Math.max(PAINTS[paintId]?.price ?? 0, MIN_REPAINT);
}

export function canRepaint(game: Game, v: Vehicle, paintId: string): Verdict {
  if (!PAINTS[paintId]) return no('Unknown livery.');
  if (v.paint === paintId) return no('This is its livery already.');
  if (v.ownership === 'rented') return no('Lung Daeng likes his tuk-tuk the colour it is. Buy or lease your own to repaint.');
  const block = workshopBlock(v);
  if (block) return no(block);
  return afford(game, repaintCost(paintId));
}

/** Book a respray; the new livery shows when the paint has dried. */
export function repaint(game: Game, v: Vehicle, paintId: string): boolean {
  if (!canRepaint(game, v, paintId).ok) return false;
  const cost = repaintCost(paintId);
  spend(game, cost, 'upgrades');
  startJob(game, v, 'paint', paintId, PAINT_HOURS, cost, `respray in ${PAINTS[paintId].name}`);
  notifyAt(game, v, `${v.name} is in the paint shop: ${PAINTS[paintId].name}, ready in ${PAINT_HOURS} h.`);
  game.emit('change');
  return true;
}

// -------------------------------------------------------------- EV kit

/** The EV model an LPG vehicle becomes with the conversion kit (same seats). */
export function evConversionModel(v: Vehicle): VehicleModel | undefined {
  const from = VEHICLE_MODELS[v.model];
  if (!from || from.powertrain !== 'lpg') return undefined;
  const models = Object.values(VEHICLE_MODELS).filter((m) => m.convertedFrom);
  return models.find((m) => m.convertedFrom === v.model) ?? models.find((m) => m.seats === from.seats) ?? models[0];
}

export function canConvertToEv(game: Game, v: Vehicle): Verdict {
  const model = VEHICLE_MODELS[v.model];
  if (model?.powertrain === 'ev') return no('Already electric.');
  if (!evConversionModel(v)) return no('No conversion kit fits this model.');
  if (v.ownership === 'rented') return no('Lung Daeng won’t let you pull the engine out of his tuk-tuk.');
  if (v.ownership === 'leased') return no('Pay off the hire-purchase first: the finance company still owns it.');
  const block = workshopBlock(v);
  if (block) return no(block);
  return afford(game, EV_KIT_PRICE);
}

/**
 * Fit the EV conversion kit: a game day in the workshop, then the vehicle becomes the EV variant
 * of its model. It keeps its existing for-hire plate. LPG-only parts come out with the engine.
 */
export function startEvConversion(game: Game, v: Vehicle): boolean {
  if (!canConvertToEv(game, v).ok) return false;
  const target = evConversionModel(v)!;
  spend(game, EV_KIT_PRICE, 'upgrades');
  startJob(game, v, 'ev', target.id, EV_CONVERSION_HOURS, EV_KIT_PRICE, 'EV conversion');
  notifyAt(game, v, `${v.name} is in the workshop for its EV conversion: back in a day.`);
  game.emit('change');
  return true;
}

// --------------------------------------------------------------- ratings

export function isNightHour(hour: number): boolean {
  return hour >= NIGHT_FROM_HOUR || hour < NIGHT_TO_HOUR;
}

export interface TripContext {
  archetype: Archetype;
  night: boolean;
  /** Starts or ends at a nightlife place. */
  nightlife: boolean;
  /** Starts or ends at the airport, a bus or a train station. */
  hub: boolean;
}

/** Passenger- and trip-specific rating change from one upgrade (its flat comfort excluded). */
export function upgradeTripBonus(up: VehicleUpgrade, ctx: TripContext): number {
  let r = up.fans?.[ctx.archetype] ?? 0;
  if (ctx.night) {
    r += up.nightFans?.[ctx.archetype] ?? 0;
    if (ctx.nightlife) r += up.nightlife ?? 0;
  }
  if (ctx.hub) r += up.hubs ?? 0;
  return r;
}

export function tripContext(game: Game, trip: Trip): TripContext {
  const from = game.world.places[trip.request.from];
  const to = game.world.places[trip.request.to];
  return {
    archetype: trip.request.archetype,
    night: isNightHour(calendar(trip.startedAt).hour),
    nightlife: from?.cat === 'nightlife' || to?.cat === 'nightlife',
    hub: from?.cat === 'transport' || to?.cat === 'transport',
  };
}

/** Rating modifier: paint comfort plus passenger-specific upgrade effects. */
export function garageRatingBonus(game: Game, v: Vehicle, trip: Trip): number {
  let r = PAINTS[v.paint]?.comfort ?? 0;
  const ctx = tripContext(game, trip);
  for (const id of v.upgrades) {
    const up = VEHICLE_UPGRADES[id];
    if (up) r += upgradeTripBonus(up, ctx);
  }
  return r;
}

// ---------------------------------------------------------------- system

export function formatHours(h: number): string {
  const m = Math.round(h * 60);
  return m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}

function completeJob(game: Game, job: WorkshopJob): void {
  const v = game.vehicle(job.vehicleId);
  if (!v) return;
  if (v.task.kind === 'broken' && v.task.work) v.task = { kind: 'idle' };
  switch (job.kind) {
    case 'service':
      v.condition = 100;
      notifyAt(game, v, `${v.name} is serviced and back on the road: condition 100 %.`, 'good');
      break;
    case 'fit': {
      const up = VEHICLE_UPGRADES[job.item];
      if (!hasUpgrade(v, job.item)) v.upgrades.push(job.item);
      notifyAt(game, v, `${up?.icon ?? '🔧'} ${up?.name ?? job.item} fitted: ${v.name} is back on the road.`, 'good');
      break;
    }
    case 'paint':
      v.paint = job.item;
      notifyAt(game, v, `${v.name} rolls out in fresh ${PAINTS[job.item]?.name ?? job.item} paint.`, 'good');
      break;
    case 'ev':
      v.model = job.item;
      v.fuel = 1;
      v.condition = 100;
      v.purchasePrice += job.cost;
      v.upgrades = v.upgrades.filter((id) => VEHICLE_UPGRADES[id]?.powertrain !== 'lpg');
      notifyAt(game, v, `⚡ ${v.name} is electric now: quiet, cheap to run, and it climbs Doi Suthep.`, 'good');
      break;
  }
}

/** Send hired drivers' worn tuk-tuks for a service when their shift has ended. */
function autoService(game: Game, threshold: number): void {
  for (const v of game.state.vehicles) {
    if (v.task.kind !== 'offduty' || v.condition >= threshold || v.driverId === null) continue;
    if (game.driver(v.driverId)?.isPlayer !== false) continue;
    if (canService(game, v).ok) startService(game, v);
  }
}

export class GarageSystem implements GameSystem {
  readonly id = GARAGE_ID;

  init(game: Game): void {
    garageState(game);
    game.ratingModifiers.push((v, trip) => garageRatingBonus(game, v, trip));
  }

  update(game: Game, dt: number): void {
    const s = garageState(game);
    const now = game.state.time;
    if (s.jobs.length && s.jobs.some((j) => now >= j.until)) {
      const done = s.jobs.filter((j) => now >= j.until);
      s.jobs = s.jobs.filter((j) => now < j.until);
      for (const job of done) completeJob(game, job);
    }
    // A workshop task whose job is gone (e.g. from a hand-edited save) still ends on time.
    for (const v of game.state.vehicles) {
      if (v.task.kind === 'broken' && v.task.work !== undefined && now >= v.task.until && !vehicleJob(game, v)) {
        v.task = { kind: 'idle' };
      }
    }
    // The policy is checked once per game minute, on minute boundaries so reloaded games match.
    if (s.autoService !== null && Math.floor(now / MINUTE) !== Math.floor((now - dt) / MINUTE)) autoService(game, s.autoService);
  }
}
