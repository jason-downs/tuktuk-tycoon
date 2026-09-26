// Fleet management (system id 'fleet'): the vehicle market (renting more of
// Lung Daeng's tuk-tuks, buying, hire-purchase, selling), the daily pool of
// driver applicants, hiring and firing, and the daily morale, fatigue and
// quitting of hired drivers. State lives in game.state.systems.fleet.

import { RANKS } from '../content/business';
import { DRIVER_ROSTER, QUIT_LINES, type DriverSkill, type RosterDriver } from '../content/drivers';
import { RENTAL_NAMES, TUKTUK_NAMES } from '../content/tuktukNames';
import { VEHICLE_MODELS, type VehicleModel } from '../content/vehicles';
import { ZONES } from '../content/zones';
import { BALANCE } from './balance';
import { currentRank } from './business';
import { DAY, HOUR } from './clock';
import { inRide, releaseClaim, type TripResult } from './dispatch';
import { businessDay, canAfford, earn, spend } from './economy';
import type { Game, GameSystem } from './game';
import { Rng } from './rng';
import type { Archetype, Driver, PayModel, Vehicle } from './types';

export const FLEET_ID = 'fleet';

export const FLEET = {
  /** [research] economics.md "Suggested game numbers": Lung Daeng's tired LPG tuk-tuk rents for 350/day. */
  rentPerDay: BALANCE.startRentPerDay,
  /** [pacing] Lung Daeng has three tuk-tuks to rent out, the starter included. */
  maxRented: 3,
  /**
   * Idle owners around town rent out their plated tuk-tuks. [research] economics.md §9: ~1,040 for-hire tuk-tuks
   * are registered in Chiang Mai (DLT, Aug 2026) but only ~100 work the streets (TCIJ 2024), so most sit idle.
   * They rent only to a Fleet boss or above with a hired driver, and how many depends on the company's rank (RANKS
   * ownerRentals); the day rate is [pacing].
   */
  owners: { rentPerDay: 400, model: 'lpg_used' },
  /**
   * [pacing] Hire-purchase: 10 % down, the rest plus 15 % repaid daily over 120 game days. The real 2015 Bangkok
   * offer in economics.md §4 was 50,000 down + ~11,000/month × 60 months. The small deposit puts a first tuk-tuk of
   * your own within reach of a driver with Lung Daeng's three tuk-tuks at work (~36 real minutes in), and a second
   * one about half an hour later.
   */
  lease: { downShare: 0.1, markup: 1.15, days: 120 },
  /** [research] economics.md "Suggested game numbers": resale 60 % of purchase, falling 5 % a year. */
  resale: { share: 0.6, perYear: 0.05 },
  /** [research] economics.md "Hiring and fleet": hiring fee 1,000. */
  hiringFee: 1_000,
  /** [pacing] Drivers join an operator with a track record: rides the player must complete first. */
  ridesBeforeHiring: 5,
  /** [research] economics.md §7: Mueang Chiang Mai minimum wage, 380 THB/day since 1 Jan 2025. */
  minWage: 380,
  /**
   * Pay terms. [research] economics.md §7 and "Hiring and fleet": salaried drivers ask 400/day (above the 380
   * minimum) + 10–20 % of fares; rent-out drivers pay 300–350/day (§4 "Renting") and keep the fares.
   * Asks span 380–600 and 300–400; the adjustable maxima are [pacing].
   */
  salary: { askMin: 380, askMax: 600, max: 1_000, step: 10 },
  commission: { askMin: 0.1, askMax: 0.2, max: 0.3, step: 0.01 },
  rent: { offerMin: 300, offerMax: 400, min: 200, max: 500, step: 10 },
  morale: {
    /** [research] economics.md "Hiring and fleet": morale drops if net driver pay falls below ~500/day. */
    comfortablePay: 500,
    /** [pacing] Morale points per THB of take-home above/below the comfortable level, and the daily caps. */
    perBaht: 1 / 25,
    maxGain: 10,
    maxLoss: 15,
    /** [pacing] Daily morale cost of a long (07–23) or night shift. */
    shiftCost: { day: 0, night: 1, long: 3 },
    /** [pacing] Daily morale cost of ending the day tired (fatigue > 65) or exhausted (> 85). */
    tiredCost: 3,
    exhaustedCost: 6,
    /** [pacing] Starting morale, and the bonus for being hired on the pay model the driver prefers. */
    start: 65,
    preferredBonus: 10,
    /** [pacing] A driver whose day ends below this morale twice running quits. */
    quitBelow: 15,
    quitAfterDays: 2,
    /** [pacing] Morale moves trip ratings by up to ±0.3 and honesty by up to ±5. */
    ratingSwing: 0.3,
    honestySwing: 5,
    /** [pacing] Morale at which the player is warned. */
    warnBelow: 25,
    /** [pacing] A driver's first day-end counts toward morale only after this many hours on the books. */
    settleInHours: 12,
  },
  /**
   * [pacing] A hired driver's English moves trip ratings from foreign visitors by up to ±0.2. [research] culture.md §4:
   * backpackers, Chinese, Korean and Western tourists, retirees and digital nomads are the foreign riders.
   */
  englishSwing: 0.2,
  /** [pacing] Fatigue above which a hired driver knocks off until the next shift. */
  exhausted: 85,
  /** [pacing] Applicants on offer each day. */
  pool: { min: 3, max: 5 },
};

/** Clock hours of each shift, [start, end); matches onShift in ai.ts. */
export const SHIFT_HOURS: Record<Driver['shift'], [number, number]> = { day: [6, 18], night: [16, 3], long: [7, 23] };

/**
 * Models the dealer sells, in showroom order: the vehicle table of economics.md "Suggested game numbers".
 * VEHICLE_MODELS can hold other entries (garage conversions of owned tuk-tuks) that are never for sale.
 */
export const MARKET_MODELS: readonly string[] = ['rusty', 'lpg_used', 'ev_used', 'ev_new', 'ev_7seat'];

/** [pacing] Condition (0–100) a bought tuk-tuk is delivered in; new models arrive at 100. */
const DELIVERY_CONDITION: Record<string, number> = { rusty: 70, lpg_used: 88, ev_used: 92 };

/** Passengers who rate a hired driver's English (see FLEET.englishSwing). */
const FOREIGN_RIDERS: ReadonlySet<Archetype> = new Set<Archetype>(['backpacker', 'tourist_cn', 'tourist_kr', 'tourist_west', 'retiree', 'nomad']);
/** Where new and rented tuk-tuks are handed over: Lung Daeng's rank. */
const HANDOVER_LANDMARK = 'tha_phae_gate';

// ------------------------------------------------------------------ state
/** A job applicant in today's hiring pool. */
export interface Candidate {
  /** Index into DRIVER_ROSTER. */
  roster: number;
  driving: number;
  english: number;
  charm: number;
  honesty: number;
  stamina: number;
  /** Daily salary asked under the salary model, THB. */
  salaryAsk: number;
  /** Share of fares asked under the salary model (0–1). */
  commissionAsk: number;
  /** Daily rent offered under the rent-out model, THB. */
  rentOffer: number;
  prefers: PayModel;
}

/** Hire-purchase agreement on a leased vehicle. */
export interface Lease {
  /** List price: the basis for resale once paid off. */
  price: number;
  instalment: number;
  /** THB still owed. */
  remaining: number;
  /** Instalments still due. */
  daysLeft: number;
}

/** Fleet bookkeeping for one hired driver. */
export interface DriverRecord {
  /** Index into DRIVER_ROSTER, or null for drivers from elsewhere. */
  roster: number | null;
  /** Terms the driver asked for at hiring; switching pay model restores them. */
  ask: { salary: number; commission: number; rent: number };
  /** Game time of hiring. */
  hiredAt: number;
  /** Honesty before the morale adjustment. */
  honestyBase: number;
  /** Consecutive day-ends with morale below the quit threshold. */
  lowDays: number;
  /** Take-home pay on the last closed day, THB, or null before the first. */
  lastNet: number | null;
  /** Morale change at the last day close. */
  lastMoraleDelta: number;
  /** Handed in notice: leaves as soon as no passenger is aboard. */
  leaving: boolean;
}

/** Trips and gross fares of one vehicle in the current business day. */
export interface VehicleDay {
  day: number;
  trips: number;
  fares: number;
}

export interface FleetState {
  /** Business day the applicant pool was drawn for. */
  poolDay: number;
  candidates: Candidate[];
  /** Hire-purchase agreements keyed by vehicle id. */
  leases: Record<number, Lease>;
  /** Hired-driver records keyed by driver id. */
  drivers: Record<number, DriverRecord>;
  /** Today's trips per vehicle id. */
  today: Record<number, VehicleDay>;
  /** Next index into TUKTUK_NAMES. */
  nextName: number;
}

/** The fleet state, with any fields missing from older saves filled in. */
export function fleetState(game: Game): FleetState {
  const systems = game.state.systems;
  const s = (systems[FLEET_ID] ??= {}) as Partial<FleetState>;
  s.poolDay ??= -1;
  s.candidates ??= [];
  s.leases ??= {};
  s.drivers ??= {};
  s.today ??= {};
  s.nextName ??= 0;
  return s as FleetState;
}

/** Fleet record of a hired driver, created with defaults for drivers that predate it. */
export function driverRecord(game: Game, d: Driver): DriverRecord {
  const s = fleetState(game);
  let rec = s.drivers[d.id];
  if (!rec) {
    const roster = DRIVER_ROSTER.findIndex((r) => r.fullName === d.fullName);
    rec = {
      roster: roster >= 0 ? roster : null,
      ask: {
        salary: d.payModel === 'salary' ? Math.max(FLEET.minWage, d.dailyPay) : 400,
        commission: d.payModel === 'salary' ? d.commission : 0.15,
        rent: d.payModel === 'rent' ? d.dailyPay : 350,
      },
      hiredAt: d.hiredDay * DAY,
      honestyBase: d.honesty,
      lowDays: 0,
      lastNet: null,
      lastMoraleDelta: 0,
      leaving: false,
    };
    s.drivers[d.id] = rec;
  }
  return rec;
}

// ---------------------------------------------------------------- helpers
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round10 = (v: number) => Math.round(v / 10) * 10;
const thb = (v: number) => `฿${Math.round(v).toLocaleString('en-US')}`;

export function isEV(v: Vehicle): boolean {
  return VEHICLE_MODELS[v.model]?.powertrain === 'ev';
}

/**
 * Why a vehicle can't change hands right now (a passenger aboard or at the kerb, or out of town; see inRide), or
 * null when it can. `who` names the vehicle or its driver in the sentence.
 */
export function rideLock(v: Vehicle, who?: string): string | null {
  if (!inRide(v)) return null;
  if (v.task.kind === 'away') return who ? `${who} is out of town — wait for the drive back.` : 'Out of town — wait for the drive back.';
  return who ? `${who} has a passenger aboard — wait for the drop-off.` : 'A passenger is aboard — wait for the drop-off.';
}

export function rentedCount(game: Game): number {
  return game.state.vehicles.filter((v) => v.ownership === 'rented').length;
}

/** EV plates in use and available: Chiang Mai EV quota plates are one per person (economics.md §6). */
export function evPlates(game: Game): { used: number; people: number } {
  return { used: game.state.vehicles.filter(isEV).length, people: game.state.drivers.length };
}

export function hiredDrivers(game: Game): Driver[] {
  return game.state.drivers.filter((d) => !d.isPlayer);
}

export function leaseTerms(price: number): { down: number; financed: number; instalment: number; total: number } {
  const { downShare, markup, days } = FLEET.lease;
  const down = Math.round(price * downShare);
  const financed = Math.round((price - down) * markup);
  const instalment = Math.ceil(financed / days);
  return { down, financed, instalment, total: down + financed };
}

export function leaseOf(game: Game, v: Vehicle): Lease | undefined {
  return fleetState(game).leases[v.id];
}

/** What a buyer pays for an owned vehicle: 60 % of its price, less 5 % for each year of age. */
export function resaleValue(game: Game, v: Vehicle): number {
  const years = Math.max(0, game.state.time / DAY - v.boughtDay) / 365;
  const share = Math.max(0, FLEET.resale.share - FLEET.resale.perYear * years);
  return Math.round((v.purchasePrice * share) / 100) * 100;
}

export function vehicleToday(game: Game, v: Vehicle): { trips: number; fares: number } {
  const rec = fleetState(game).today[v.id];
  return rec && rec.day === businessDay(game.state.time) ? { trips: rec.trips, fares: rec.fares } : { trips: 0, fares: 0 };
}

/** Game time of the next start of a shift after `now`. */
export function nextShiftStart(shift: Driver['shift'], now: number): number {
  let t = Math.floor(now / DAY) * DAY + SHIFT_HOURS[shift][0] * HOUR;
  while (t <= now) t += DAY;
  return t;
}

/** A tired driver sent home until their next shift. */
export function isResting(game: Game, d: Driver): boolean {
  return (d.restUntil ?? 0) > game.state.time;
}

/** Driver pay a hired driver takes home for a day: salary + commission and tips, or fares after rent and fuel. */
export function takeHome(d: Driver, earned: number, hasVehicle: boolean): number {
  if (d.payModel === 'salary') return d.dailyPay + earned;
  return hasVehicle ? earned - d.dailyPay : 0;
}

/** Severance on firing: one day's pay (the minimum wage for rent-out drivers, who draw no salary). */
export function severance(d: Driver): number {
  return d.payModel === 'salary' ? d.dailyPay : FLEET.minWage;
}

export function deliveryCondition(modelId: string): number {
  return DELIVERY_CONDITION[modelId] ?? 100;
}

/** Daily upkeep of an owned or leased vehicle, settled at 04:00: maintenance plus insurance and tax. */
export function upkeepPerDay(modelId: string): number {
  const ev = VEHICLE_MODELS[modelId]?.powertrain === 'ev';
  return (ev ? BALANCE.upkeep.evPerDay : BALANCE.upkeep.lpgPerDay) + BALANCE.upkeep.insurancePerDay;
}

/** What the fleet owes (and is owed) at the next 04:00 settlement. */
export interface DailyBills {
  /** Lung Daeng's rent on rented tuk-tuks. */
  rent: number;
  /** Salaries of salaried drivers, with or without a tuk-tuk. */
  wages: number;
  /** Hire-purchase instalments. */
  instalments: number;
  /** Maintenance, insurance and tax on owned and leased tuk-tuks. */
  upkeep: number;
  /** Rent paid in by rent-out drivers who have a tuk-tuk. */
  rentIncome: number;
}

export function dailyBills(game: Game): DailyBills {
  const leases = fleetState(game).leases;
  const bills: DailyBills = { rent: 0, wages: 0, instalments: 0, upkeep: 0, rentIncome: 0 };
  for (const v of game.state.vehicles) {
    if (v.ownership === 'rented' || v.ownership === 'leased') bills.rent += v.rentPerDay;
    if (v.ownership !== 'rented') bills.upkeep += upkeepPerDay(v.model);
    const lease = leases[v.id];
    if (lease) bills.instalments += Math.min(lease.instalment, lease.remaining);
  }
  for (const d of hiredDrivers(game)) {
    if (d.payModel === 'salary') bills.wages += d.dailyPay;
    else if (d.vehicleId !== null) bills.rentIncome += d.dailyPay;
  }
  return bills;
}

/** Tuk-tuks nobody drives, where a new hire can start. */
export function freeVehicles(game: Game): Vehicle[] {
  return game.state.vehicles.filter((v) => v.driverId === null);
}

export function payBounds(model: PayModel): { min: number; max: number; step: number } {
  return model === 'salary'
    ? { min: FLEET.minWage, max: FLEET.salary.max, step: FLEET.salary.step }
    : { min: FLEET.rent.min, max: FLEET.rent.max, step: FLEET.rent.step };
}

function handoverNode(game: Game): number {
  const place = game.world.landmarks.find((l) => l.id === HANDOVER_LANDMARK) ?? game.world.places[0];
  return place.node;
}

function nextTukTukName(game: Game): string {
  const s = fleetState(game);
  const used = new Set(game.state.vehicles.map((v) => v.name));
  const n = TUKTUK_NAMES.length;
  for (let k = 0; k < n * 4; k++) {
    const i = s.nextName++;
    const base = TUKTUK_NAMES[i % n];
    const name = i < n ? base : `${base} ${Math.floor(i / n) + 1}`;
    if (!used.has(name)) return name;
  }
  return `Tuk-tuk #${game.state.vehicles.length + 1}`;
}

/** Stop a driverless vehicle where it is. */
function park(game: Game, v: Vehicle): void {
  releaseClaim(game, v);
  if (v.task.kind === 'broken') return;
  v.task = { kind: 'offduty' };
  v.route = null;
  v.speed = 0;
}

/** A hired driver waiting without a tuk-tuk takes the wheel of a newly acquired one; returns the sentence saying so, or ''. */
function seatWaitingDriver(game: Game, v: Vehicle): string {
  const d = hiredDrivers(game).find((x) => x.vehicleId === null && !fleetState(game).drivers[x.id]?.leaving);
  if (!d || !assignDriver(game, d.id, v.id)) return '';
  return ` ${d.nickname} takes the wheel.`;
}

/** Settle a vehicle after its driver changed: park it if nobody drives it, otherwise let the new driver think afresh. */
function handOver(game: Game, v: Vehicle): void {
  releaseClaim(game, v);
  if (v.driverId === null) park(game, v);
  else if (v.task.kind === 'offduty') v.task = { kind: 'idle' };
}

function removeVehicle(game: Game, v: Vehicle): void {
  if (v.driverId !== null) {
    const d = game.driver(v.driverId);
    if (d) d.vehicleId = null;
  }
  releaseClaim(game, v);
  game.state.vehicles = game.state.vehicles.filter((x) => x !== v);
  const s = fleetState(game);
  delete s.leases[v.id];
  delete s.today[v.id];
}

// ---------------------------------------------------------- vehicle market
export type BuyMode = 'cash' | 'lease';

export type RentalSource = 'lung_daeng' | 'owner';

/** Rented tuk-tuks from one source (vehicles rented before owners existed count as Lung Daeng's). */
export function rentedFrom(game: Game, source: RentalSource): number {
  return game.state.vehicles.filter((v) => v.ownership === 'rented' && (v.lessor ?? 'lung_daeng') === source).length;
}

/** Tuk-tuks idle owners will rent to the company at its current rank. */
export function ownerRentalCap(game: Game): number {
  return RANKS[currentRank(game)].ownerRentals;
}

export function whyCantRent(game: Game, source: RentalSource = 'lung_daeng'): string | null {
  if (source === 'owner') {
    if (hiredDrivers(game).length === 0) return 'Owners only rent to an operator with a hired driver on the books.';
    const cap = ownerRentalCap(game);
    if (cap === 0) return `Owners around town only rent to a ${RANKS.find((r) => r.ownerRentals > 0)!.name} or above.`;
    if (rentedFrom(game, 'owner') >= cap) {
      const rank = currentRank(game);
      const next = RANKS[rank + 1];
      const more = next ? ` As ${next.name} you can rent ${next.ownerRentals} — or buy your own.` : '';
      return `Owners rent ${cap === 1 ? 'one tuk-tuk' : `${cap} tuk-tuks`} to a company of your rank (${RANKS[rank].name}), and you have ${cap === 1 ? 'it' : 'them all'}.${more}`;
    }
    if (!canAfford(game, FLEET.owners.rentPerDay)) return `The owner wants to see ${thb(FLEET.owners.rentPerDay)} before handing over the keys.`;
    return null;
  }
  if (rentedFrom(game, 'lung_daeng') >= FLEET.maxRented) return `Lung Daeng only has ${FLEET.maxRented} tuk-tuks to rent out, and you have them all.`;
  if (!canAfford(game, FLEET.rentPerDay)) return `Lung Daeng wants to see ${thb(FLEET.rentPerDay)} before he hands over the keys.`;
  return null;
}

/** Rent another of Lung Daeng's tired tuk-tuks; the rent is settled each day at 04:00. */
export function rentVehicle(game: Game, source: RentalSource = 'lung_daeng'): Vehicle | null {
  const reason = whyCantRent(game, source);
  if (reason) {
    game.notify(reason, 'bad');
    return null;
  }
  const taken = new Set(game.state.vehicles.map((v) => v.name));
  if (source === 'owner') {
    const name = TUKTUK_NAMES.find((n) => !taken.has(n)) ?? `Rented tuk-tuk #${rentedFrom(game, 'owner') + 1}`;
    const v = game.spawnVehicle(FLEET.owners.model, handoverNode(game), {
      name,
      ownership: 'rented',
      rentPerDay: FLEET.owners.rentPerDay,
      paint: game.rng.pick(['nakhon_blue', 'coop_taxi', 'rot_daeng']),
      condition: Math.round(game.rng.range(60, 80)),
    });
    v.lessor = 'owner';
    park(game, v);
    const seated = seatWaitingDriver(game, v);
    game.notify(`An owner at the Tha Phae Gate rank rents you ${v.name}: ${thb(FLEET.owners.rentPerDay)}/day.${seated}`, 'good');
    game.emit('change');
    return v;
  }
  const name = RENTAL_NAMES.find((n) => !taken.has(n)) ?? `Lung Daeng’s tuk-tuk #${rentedCount(game) + 1}`;
  const v = game.spawnVehicle('rusty', handoverNode(game), {
    name,
    ownership: 'rented',
    rentPerDay: FLEET.rentPerDay,
    paint: 'nakhon_blue',
    condition: Math.round(game.rng.range(55, 70)),
  });
  park(game, v);
  const seated = seatWaitingDriver(game, v);
  game.notify(`Lung Daeng hands over the keys to ${v.name}: ${thb(FLEET.rentPerDay)}/day. It's parked at Tha Phae Gate.${seated}`, 'good');
  game.emit('change');
  return v;
}

export function whyCantReturn(v: Vehicle): string | null {
  if (v.ownership !== 'rented') return 'Only rented tuk-tuks go back to Lung Daeng.';
  return rideLock(v);
}

/** Hand a rented tuk-tuk back to Lung Daeng, paying today's rent. */
export function returnVehicle(game: Game, vehicleId: number): boolean {
  const v = game.vehicle(vehicleId);
  if (!v) return false;
  const reason = whyCantReturn(v);
  if (reason) {
    game.notify(reason, 'bad');
    return false;
  }
  spend(game, v.rentPerDay, 'rent');
  removeVehicle(game, v);
  game.notify(`${v.name} is back with Lung Daeng. You paid today's ${thb(v.rentPerDay)} rent.`, 'info');
  game.emit('change');
  return true;
}

/** Up-front cost of buying a model outright or on hire-purchase. */
export function upfrontCost(model: VehicleModel, mode: BuyMode): number {
  return mode === 'cash' ? model.price : leaseTerms(model.price).down;
}

export function whyCantBuy(game: Game, modelId: string, mode: BuyMode): string | null {
  const model = VEHICLE_MODELS[modelId];
  if (!model || !MARKET_MODELS.includes(modelId)) return 'The dealer doesn’t sell that model.';
  const cost = upfrontCost(model, mode);
  if (!canAfford(game, cost)) return `You need ${thb(cost - game.state.cash)} more.`;
  if (model.powertrain === 'ev') {
    const { used, people } = evPlates(game);
    if (used >= people) {
      return `Chiang Mai EV plates are one per person: ${people} ${people === 1 ? 'person' : 'people'}, ${used} EV${used === 1 ? '' : 's'}. Hire another driver first.`;
    }
  }
  return null;
}

/** Buy a model outright, or on hire-purchase (a deposit, then daily instalments at 04:00; see FLEET.lease). */
export function buyVehicle(game: Game, modelId: string, mode: BuyMode = 'cash'): Vehicle | null {
  const reason = whyCantBuy(game, modelId, mode);
  if (reason) {
    game.notify(reason, 'bad');
    return null;
  }
  const model = VEHICLE_MODELS[modelId];
  const terms = leaseTerms(model.price);
  spend(game, mode === 'cash' ? model.price : terms.down, 'vehicles');
  const v = game.spawnVehicle(model.id, handoverNode(game), {
    name: nextTukTukName(game),
    ownership: mode === 'cash' ? 'owned' : 'leased',
    rentPerDay: 0,
    paint: model.powertrain === 'ev' ? 'ev_green' : 'nakhon_blue',
    condition: deliveryCondition(model.id),
    purchasePrice: model.price,
  });
  park(game, v);
  if (mode === 'lease') fleetState(game).leases[v.id] = { price: model.price, instalment: terms.instalment, remaining: terms.financed, daysLeft: FLEET.lease.days };
  const seated = seatWaitingDriver(game, v);
  if (mode === 'lease') game.notify(`${v.name} (${model.name}) is yours on hire-purchase: ${thb(terms.instalment)}/day for ${FLEET.lease.days} days.${seated}`, 'good');
  else game.notify(`You bought ${v.name}, a ${model.name.toLowerCase()}, for ${thb(model.price)}. It's parked at Tha Phae Gate.${seated}`, 'good');
  game.emit('change');
  return v;
}

export function whyCantPayOff(game: Game, v: Vehicle): string | null {
  const lease = leaseOf(game, v);
  if (!lease) return 'Not on hire-purchase.';
  if (!canAfford(game, lease.remaining)) return `You need ${thb(lease.remaining - game.state.cash)} more.`;
  return null;
}

/** Settle the rest of a hire-purchase at once. */
export function payOffLease(game: Game, vehicleId: number): boolean {
  const v = game.vehicle(vehicleId);
  if (!v) return false;
  const reason = whyCantPayOff(game, v);
  if (reason) {
    game.notify(reason, 'bad');
    return false;
  }
  const lease = leaseOf(game, v)!;
  spend(game, lease.remaining, 'vehicles');
  ownOutright(game, v, lease);
  game.emit('change');
  return true;
}

function ownOutright(game: Game, v: Vehicle, lease: Lease): void {
  v.ownership = 'owned';
  v.rentPerDay = 0;
  v.purchasePrice = lease.price;
  delete fleetState(game).leases[v.id];
  game.notify(`${v.name} is paid off — it’s yours outright!`, 'good');
}

export function whyCantSell(game: Game, v: Vehicle): string | null {
  if (v.ownership === 'rented') return 'It belongs to Lung Daeng — return it instead.';
  if (v.ownership === 'leased') return 'Still on hire-purchase — pay it off first.';
  const lock = rideLock(v);
  if (lock) return lock;
  if (resaleValue(game, v) <= 0) return 'Nobody will pay anything for it.';
  return null;
}

/** Sell an owned vehicle for its resale value. Its driver is left without a tuk-tuk. */
export function sellVehicle(game: Game, vehicleId: number): number {
  const v = game.vehicle(vehicleId);
  if (!v) return 0;
  const reason = whyCantSell(game, v);
  if (reason) {
    game.notify(reason, 'bad');
    return 0;
  }
  const value = resaleValue(game, v);
  earn(game, value, 'vehicles');
  removeVehicle(game, v);
  game.notify(`Sold ${v.name} for ${thb(value)}.`, 'info');
  game.emit('change');
  return value;
}

export function renameVehicle(game: Game, vehicleId: number, name: string): boolean {
  const v = game.vehicle(vehicleId);
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 28);
  if (!v || !clean) return false;
  v.name = clean;
  game.emit('change');
  return true;
}

// ------------------------------------------------------------------ drivers
export function whyCantAssign(game: Game, driverId: number, vehicleId: number | null): string | null {
  const d = game.driver(driverId);
  if (!d) return 'No such driver.';
  const target = vehicleId !== null ? game.vehicle(vehicleId) : null;
  if (vehicleId !== null && !target) return 'No such tuk-tuk.';
  if (target && target.driverId === d.id) return null;
  const current = d.vehicleId !== null ? game.vehicle(d.vehicleId) : undefined;
  return (current && rideLock(current, current.name)) || (target && rideLock(target, target.name)) || null;
}

/**
 * Put a driver in a tuk-tuk (or take them out with null). A vehicle has at most
 * one driver: whoever drove the target moves into the driver's old tuk-tuk, so
 * the player can swap vehicles with a hired driver.
 */
export function assignDriver(game: Game, driverId: number, vehicleId: number | null): boolean {
  const reason = whyCantAssign(game, driverId, vehicleId);
  if (reason) {
    game.notify(reason, 'bad');
    return false;
  }
  const d = game.driver(driverId)!;
  const target = vehicleId !== null ? (game.vehicle(vehicleId) ?? null) : null;
  const prev = d.vehicleId !== null ? (game.vehicle(d.vehicleId) ?? null) : null;
  if (prev === target) return true;
  const displaced = target && target.driverId !== null ? (game.driver(target.driverId) ?? null) : null;
  if (displaced) displaced.vehicleId = prev ? prev.id : null;
  if (prev) {
    prev.driverId = displaced ? displaced.id : null;
    handOver(game, prev);
  }
  d.vehicleId = target ? target.id : null;
  if (target) {
    target.driverId = d.id;
    handOver(game, target);
  }
  game.emit('change');
  return true;
}

export function setShift(game: Game, driverId: number, shift: Driver['shift']): void {
  const d = game.driver(driverId);
  if (!d || d.isPlayer) return;
  d.shift = shift;
  if (isResting(game, d)) d.restUntil = nextShiftStart(shift, game.state.time);
  game.emit('change');
}

export function setZone(game: Game, driverId: number, zone: string | null): void {
  const d = game.driver(driverId);
  if (!d || d.isPlayer) return;
  d.zone = zone && ZONES.some((z) => z.id === zone) ? zone : null;
  game.emit('change');
}

/** Switch pay model, restoring the terms the driver asked for under it. */
export function setPayModel(game: Game, driverId: number, model: PayModel): void {
  const d = game.driver(driverId);
  if (!d || d.isPlayer || d.payModel === model) return;
  const rec = driverRecord(game, d);
  d.payModel = model;
  if (model === 'salary') {
    d.dailyPay = rec.ask.salary;
    d.commission = rec.ask.commission;
  } else {
    d.dailyPay = rec.ask.rent;
  }
  game.emit('change');
}

/** Daily salary (salary model) or daily rent (rent-out model), kept within legal and sensible bounds. */
export function setDailyPay(game: Game, driverId: number, amount: number): void {
  const d = game.driver(driverId);
  if (!d || d.isPlayer) return;
  const { min, max } = payBounds(d.payModel);
  d.dailyPay = clamp(Math.round(amount), min, max);
  game.emit('change');
}

export function setCommission(game: Game, driverId: number, share: number): void {
  const d = game.driver(driverId);
  if (!d || d.isPlayer) return;
  d.commission = clamp(Math.round(share * 100) / 100, 0, FLEET.commission.max);
  game.emit('change');
}

// ------------------------------------------------------------------ hiring
function hash32(a: number, b: number): number {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

function rollSkill(rng: Rng, r: RosterDriver, skill: DriverSkill): number {
  return Math.round(clamp(rng.range(30, 70) + (r.lean[skill] ?? 0), 5, 98));
}

function makeCandidate(rng: Rng, roster: number): Candidate {
  const r = DRIVER_ROSTER[roster];
  const driving = rollSkill(rng, r, 'driving');
  const english = rollSkill(rng, r, 'english');
  const charm = rollSkill(rng, r, 'charm');
  const honesty = rollSkill(rng, r, 'honesty');
  const stamina = rollSkill(rng, r, 'stamina');
  // Better drivers ask more; the rent they offer tracks how much they expect to take in fares.
  const skill = driving * 0.4 + english * 0.3 + charm * 0.3;
  const salaryAsk = clamp(round10(FLEET.salary.askMin + (skill - 35) * 5 + rng.range(-20, 40)), FLEET.salary.askMin, FLEET.salary.askMax);
  const commissionAsk = clamp(Math.round((0.1 + (skill - 35) / 350 + rng.range(0, 0.04)) * 100) / 100, FLEET.commission.askMin, FLEET.commission.askMax);
  const rentOffer = clamp(round10(FLEET.rent.offerMin + (driving - 35) * 1.5 + rng.range(0, 50)), FLEET.rent.offerMin, FLEET.rent.offerMax);
  // [research] economics.md §7: renting the tuk-tuk and keeping the fares is the dominant arrangement; old hands prefer it.
  const prefers: PayModel = rng.chance(driving >= 60 ? 0.7 : 0.45) ? 'rent' : 'salary';
  return { roster, driving, english, charm, honesty, stamina, salaryAsk, commissionAsk, rentOffer, prefers };
}

/** Applicants for a business day: deterministic for a seed, day and the set of people already hired. */
export function drawPool(game: Game, day: number): Candidate[] {
  const rng = new Rng(hash32(game.state.seed, day + 1));
  const s = fleetState(game);
  const employed = new Set<number>();
  for (const d of game.state.drivers) {
    const rec = s.drivers[d.id];
    if (rec?.roster !== undefined && rec.roster !== null) employed.add(rec.roster);
    const idx = DRIVER_ROSTER.findIndex((r) => r.fullName === d.fullName);
    if (idx >= 0) employed.add(idx);
  }
  const free = DRIVER_ROSTER.map((_, i) => i).filter((i) => !employed.has(i));
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  const count = Math.min(free.length, rng.int(FLEET.pool.min, FLEET.pool.max));
  return free.slice(0, count).map((roster) => makeCandidate(rng, roster));
}

function refreshPool(game: Game): void {
  const s = fleetState(game);
  const day = businessDay(game.state.time);
  s.poolDay = day;
  s.candidates = drawPool(game, day);
}

export function whyCantHire(game: Game, roster: number): string | null {
  if (!fleetState(game).candidates.some((c) => c.roster === roster)) return 'That applicant has moved on.';
  const rides = game.state.stats.trips;
  if (rides < FLEET.ridesBeforeHiring) {
    return `Drivers want to see you have customers first: complete ${FLEET.ridesBeforeHiring} rides yourself (${rides}/${FLEET.ridesBeforeHiring}).`;
  }
  if (!canAfford(game, FLEET.hiringFee)) return `The hiring fee is ${thb(FLEET.hiringFee)} — you need ${thb(FLEET.hiringFee - game.state.cash)} more.`;
  return null;
}

/** Hire an applicant on the chosen pay model, optionally straight into a tuk-tuk. */
export function hireCandidate(game: Game, roster: number, model: PayModel, vehicleId: number | null = null): Driver | null {
  const reason = whyCantHire(game, roster);
  if (reason) {
    game.notify(reason, 'bad');
    return null;
  }
  const s = fleetState(game);
  const c = s.candidates.find((x) => x.roster === roster)!;
  const r = DRIVER_ROSTER[roster];
  spend(game, FLEET.hiringFee, 'fees');
  s.candidates = s.candidates.filter((x) => x !== c);
  const d: Driver = {
    id: game.nextId(),
    nickname: r.nickname,
    fullName: r.fullName,
    gender: r.gender,
    hook: r.hook,
    isPlayer: false,
    driving: c.driving,
    english: c.english,
    charm: c.charm,
    honesty: c.honesty,
    stamina: c.stamina,
    morale: FLEET.morale.start + (model === c.prefers ? FLEET.morale.preferredBonus : 0),
    fatigue: 0,
    payModel: model,
    dailyPay: model === 'salary' ? c.salaryAsk : c.rentOffer,
    commission: model === 'salary' ? c.commissionAsk : 0,
    vehicleId: null,
    shift: r.shift ?? 'day',
    zone: r.zone ?? null,
    hiredDay: Math.floor(game.state.time / DAY),
    trips: 0,
    earnedToday: 0,
    lifetimeFares: 0,
    rating: BALANCE.rating.start,
  };
  game.state.drivers.push(d);
  s.drivers[d.id] = {
    roster,
    ask: { salary: c.salaryAsk, commission: c.commissionAsk, rent: c.rentOffer },
    hiredAt: game.state.time,
    honestyBase: c.honesty,
    lowDays: 0,
    lastNet: null,
    lastMoraleDelta: 0,
    leaving: false,
  };
  const target = vehicleId !== null ? game.vehicle(vehicleId) : undefined;
  if (target && target.driverId === null && !inRide(target)) assignDriver(game, d.id, target.id);
  const where = d.vehicleId !== null ? ` and takes the wheel of ${game.vehicle(d.vehicleId)!.name}` : '';
  const joins = `${d.nickname} (${d.fullName}) joins ${game.state.companyName}${where}`;
  // A company name such as "Lucky Tuk-Tuk Co." already ends the sentence.
  game.notify(/[.!?]$/.test(joins) ? joins : `${joins}.`, 'good');
  game.emit('change');
  return d;
}

export function whyCantFire(game: Game, driverId: number): string | null {
  const d = game.driver(driverId);
  if (!d) return 'No such driver.';
  if (d.isPlayer) return 'You can’t fire yourself.';
  const v = d.vehicleId !== null ? game.vehicle(d.vehicleId) : undefined;
  return (v && rideLock(v, d.nickname)) || null;
}

/** Let a driver go, paying one day's pay as severance; their tuk-tuk is parked. */
export function fireDriver(game: Game, driverId: number): boolean {
  const reason = whyCantFire(game, driverId);
  if (reason) {
    game.notify(reason, 'bad');
    return false;
  }
  const d = game.driver(driverId)!;
  const pay = severance(d);
  spend(game, pay, 'wages');
  removeDriver(game, d);
  game.notify(`${d.nickname} has been let go with ${thb(pay)} severance.`, 'info');
  game.emit('change');
  return true;
}

function removeDriver(game: Game, d: Driver): void {
  if (d.vehicleId !== null) assignDriver(game, d.id, null);
  game.state.drivers = game.state.drivers.filter((x) => x !== d);
  delete fleetState(game).drivers[d.id];
}

// ------------------------------------------------------------------ system
interface DaySnapshot {
  earned: number;
  fatigue: number;
}

export class FleetSystem implements GameSystem {
  readonly id = FLEET_ID;
  private lastDay: number | null = null;
  /** Driver earnings and fatigue captured just before the 04:00 settlement resets them. */
  private snapshot: Map<number, DaySnapshot> | null = null;

  init(game: Game): void {
    const s = fleetState(game);
    for (const d of hiredDrivers(game)) driverRecord(game, d);
    if (s.poolDay !== businessDay(game.state.time)) refreshPool(game);
    game.ratingModifiers.push((v, trip) => {
      const d = v.driverId !== null ? game.driver(v.driverId) : undefined;
      if (!d || d.isPlayer) return 0;
      const morale = ((d.morale - 50) / 50) * FLEET.morale.ratingSwing;
      const english = FOREIGN_RIDERS.has(trip.request.archetype) ? ((d.english - 50) / 50) * FLEET.englishSwing : 0;
      return morale + english;
    });
    game.on('trip', (r: TripResult) => this.countTrip(game, r));
    // Settlement (economy.ts) emits 'day' after paying wages and rents.
    game.on('day', () => this.closeDay(game));
  }

  update(game: Game): void {
    // Systems step before the economy, so a business-day change is seen here before the settlement resets pay.
    const day = businessDay(game.state.time);
    if (this.lastDay === null) this.lastDay = day;
    else if (day !== this.lastDay) {
      this.lastDay = day;
      this.snapshot = new Map(game.state.drivers.map((d) => [d.id, { earned: d.earnedToday, fatigue: d.fatigue }]));
    }
    this.sendTiredHome(game);
    this.processLeavers(game);
  }

  private countTrip(game: Game, r: TripResult): void {
    const s = fleetState(game);
    const day = businessDay(game.state.time);
    let rec = s.today[r.vehicleId];
    if (!rec || rec.day !== day) rec = s.today[r.vehicleId] = { day, trips: 0, fares: 0 };
    rec.trips++;
    rec.fares += r.fare + r.tip;
  }

  /** Exhausted drivers finish any ride or refill, drop any pickup, then go off duty until their next shift. */
  private sendTiredHome(game: Game): void {
    const now = game.state.time;
    for (const d of game.state.drivers) {
      if (d.isPlayer || d.vehicleId === null || d.fatigue <= FLEET.exhausted || isResting(game, d)) continue;
      const v = game.vehicle(d.vehicleId);
      if (!v || !['idle', 'cruise', 'pickup', 'offduty'].includes(v.task.kind)) continue;
      d.restUntil = nextShiftStart(d.shift, now);
      releaseClaim(game, v);
      if (v.task.kind !== 'offduty') {
        v.task = { kind: 'offduty' };
        v.route = null;
        v.speed = 0;
        const pose = game.vehiclePose(v);
        game.notify(`${d.nickname} is exhausted and parks ${v.name} until the next shift.`, 'info', pose.x, pose.y);
      }
    }
  }

  /** Drivers who handed in notice leave once no passenger is aboard. */
  private processLeavers(game: Game): void {
    const s = fleetState(game);
    for (const d of [...game.state.drivers]) {
      if (d.isPlayer || !s.drivers[d.id]?.leaving) continue;
      const v = d.vehicleId !== null ? game.vehicle(d.vehicleId) : undefined;
      if (v && inRide(v)) continue;
      removeDriver(game, d);
      game.notify(`${d.nickname} quit: “${QUIT_LINES[d.id % QUIT_LINES.length]}”`, 'bad');
      game.emit('change');
    }
  }

  /** After the 04:00 settlement: morale from the day's take-home pay, hire-purchase instalments, fresh applicants. */
  private closeDay(game: Game): void {
    const snap = this.snapshot;
    this.snapshot = null;
    const m = FLEET.morale;
    for (const d of hiredDrivers(game)) {
      const rec = driverRecord(game, d);
      const day = snap?.get(d.id) ?? { earned: d.earnedToday, fatigue: d.fatigue };
      const net = Math.round(takeHome(d, day.earned, d.vehicleId !== null));
      rec.lastNet = net;
      if (game.state.time - rec.hiredAt < m.settleInHours * HOUR) {
        rec.lastMoraleDelta = 0;
        continue;
      }
      const pay = clamp((net - m.comfortablePay) * m.perBaht, -m.maxLoss, m.maxGain);
      const tired = day.fatigue > FLEET.exhausted ? m.exhaustedCost : day.fatigue > 65 ? m.tiredCost : 0;
      const delta = Math.round(pay - tired - m.shiftCost[d.shift]);
      const before = d.morale;
      d.morale = clamp(d.morale + delta, 0, 100);
      d.honesty = clamp(rec.honestyBase + Math.round(((d.morale - 50) / 50) * m.honestySwing), 0, 100);
      rec.lastMoraleDelta = d.morale - before;
      rec.lowDays = d.morale < m.quitBelow ? rec.lowDays + 1 : 0;
      if (rec.lowDays >= m.quitAfterDays) rec.leaving = true;
      else if (d.morale < m.warnBelow && before >= m.warnBelow) {
        game.notify(`${d.nickname} is unhappy (morale ${Math.round(d.morale)}): take-home was ${thb(net)} yesterday. Raise pay or shorten shifts.`, 'bad');
      }
    }
    this.chargeInstalments(game);
    refreshPool(game);
  }

  private chargeInstalments(game: Game): void {
    const s = fleetState(game);
    for (const key of Object.keys(s.leases)) {
      const id = Number(key);
      const lease = s.leases[id];
      const v = game.vehicle(id);
      if (!v) {
        delete s.leases[id];
        continue;
      }
      const pay = Math.min(lease.instalment, lease.remaining);
      spend(game, pay, 'vehicles');
      lease.remaining -= pay;
      lease.daysLeft = Math.max(0, lease.daysLeft - 1);
      if (lease.remaining <= 0) ownOutright(game, v, lease);
    }
  }
}
