// The company side of the game: services (app partnership, dispatch radio,
// marketing, tours, the airport permit), hotel partnerships, depots, the bank
// loan and company ranks. Prices and rates live in content/business.ts.
//
// Services spawn company bookings: requests on the 'app', 'hotel' and 'regular'
// channels, which every fleet tuk-tuk can see; the airport permit turns hails at
// the terminal into counter bookings. Each booking carries a `source` so trips
// can be counted per service, the concierge paid per guest, and tour groups
// given time at their last stop. The dispatch radio is a sight rule, depots are
// extra EV chargers and overnight parking. Recurring charges are billed on the
// 'day' event after the 04:00 settlement; a charge the company cannot pay ends
// that contract. All money moves through earn()/spend().

import {
  AIRPORT_COUNTER_SHARE,
  AIRPORT_FARE,
  AIRPORT_LANDMARK,
  AIRPORT_MAX_TRIP,
  APP_BRAND,
  APP_FLEET_CAP,
  BOOKING_PATIENCE_MIN,
  CONCIERGE_TRUST,
  DEPOT,
  HOTEL_BILLING_DAYS,
  HOTEL_FARE_PREMIUM,
  HOTEL_MIN_RANK,
  HOTEL_TIERS,
  LOAN,
  LUXURY_HOTELS,
  RANKS,
  RATES,
  RESALE,
  SERVICES,
  SERVICE_BY_ID,
  SOCIAL_ADS_BOOST,
  TOURS,
  TOUR_BY_ID,
  type HotelTier,
  type TourDef,
} from '../content/business';
import { VEHICLE_UPGRADES } from '../content/upgrades';
import { VEHICLE_MODELS } from '../content/vehicles';
import { ZONES, type Zone } from '../content/zones';
import type { World } from '../data/world';
import { onShift } from './ai';
import { BALANCE, appFare, roundFare } from './balance';
import { DAY, HOUR, MINUTE, calendar, formatClock, type CalendarInfo } from './clock';
import { HOUR_PROFILE, LANDMARK_SCHEDULE, SEASON_INDEX, makeRequest, originWeight, pickArchetype, pickDestination } from './demand';
import { claimRequest, refuel, type TripResult } from './dispatch';
import { businessDay, canAfford, earn, spend } from './economy';
import type { Game, GameSystem } from './game';
import { sendTo } from './movement';
import type { Archetype, LedgerCategory, Place, PlaceCategory, RideRequest, Vehicle } from './types';

// ------------------------------------------------------------------- state
export interface LoanState {
  /** Amount first borrowed, THB. */
  borrowed: number;
  /** Outstanding balance, THB. */
  balance: number;
  /** Daily instalment fixed when the loan was written. */
  instalment: number;
  /** Business day the loan was taken. */
  takenDay: number;
  interestPaid: number;
  missed: number;
}

export interface BusinessState {
  /** Active services by id, with the business day each started. */
  services: Record<string, { since: number }>;
  /** Partner hotels by place id. */
  hotels: Record<string, { since: number }>;
  /** Rented depots by zone id. */
  depots: Record<string, { since: number }>;
  loan: LoanState | null;
  /** Highest rank reached (index into RANKS). */
  rank: number;
  /** Completed trips and fares per booking source. */
  stats: Record<string, { trips: number; fares: number }>;
  /** Tour groups being waited for, by vehicle id. */
  dwell: Record<string, { until: number; tour: string; place: number }>;
}

/** The business state, with missing fields filled in (older saves). */
export function businessState(game: Game): BusinessState {
  const st = (game.state.systems.business ??= {}) as Partial<BusinessState>;
  st.services ??= {};
  st.hotels ??= {};
  st.depots ??= {};
  st.loan ??= null;
  st.rank ??= 0;
  st.stats ??= {};
  st.dwell ??= {};
  return st as BusinessState;
}

/** Result of an availability check or an action. `reason` explains a refusal. */
export interface Check {
  ok: boolean;
  reason: string;
}

const OK: Check = { ok: true, reason: '' };
const no = (reason: string): Check => ({ ok: false, reason });
const thb = (v: number): string => `฿${Math.round(v).toLocaleString('en-US')}`;

// ----------------------------------------------------------------- queries
export function isActive(game: Game, serviceId: string): boolean {
  return serviceId in businessState(game).services;
}

export function fleetSize(game: Game): number {
  return game.state.vehicles.length;
}

/** Tuk-tuks the company owns outright or is buying on hire-purchase. */
export function ownedCount(game: Game): number {
  return game.state.vehicles.filter((v) => v.ownership !== 'rented').length;
}

/**
 * Resale value of an owned tuk-tuk. Rented ones are Lung Daeng's, and hire-purchase ones still belong to the finance
 * company until paid off, so both count as 0.
 */
export function vehicleValue(game: Game, v: Vehicle): number {
  if (v.ownership !== 'owned') return 0;
  const price = v.purchasePrice || VEHICLE_MODELS[v.model]?.price || 0;
  const years = Math.max(0, (game.state.time / DAY - v.boughtDay) / 365);
  return Math.round(price * Math.max(RESALE.floor, RESALE.share - RESALE.perYear * years));
}

export function fleetValue(game: Game): number {
  return game.state.vehicles.reduce((sum, v) => sum + vehicleValue(game, v), 0);
}

export function loanBalance(game: Game): number {
  return businessState(game).loan?.balance ?? 0;
}

/** Cash + resale value of owned tuk-tuks − bank debt. */
export function netWorth(game: Game): number {
  return game.state.cash + fleetValue(game) - loanBalance(game);
}

/** Highest rank whose fleet, ownership and net-worth thresholds are all met. */
export function rankFor(fleet: number, owned: number, worth: number): number {
  let r = 0;
  for (let i = 1; i < RANKS.length; i++) {
    const k = RANKS[i];
    if (fleet >= k.minFleet && owned >= k.minOwned && worth >= k.minNetWorth) r = i;
    else break;
  }
  return r;
}

export function computeRank(game: Game): number {
  return rankFor(fleetSize(game), ownedCount(game), netWorth(game));
}

/** The company's rank: the highest reached, so selling a tuk-tuk never takes a title away. */
export function currentRank(game: Game): number {
  return Math.max(businessState(game).rank, computeRank(game));
}

/** Can this tuk-tuk make the Doi Suthep climb? Electric models can, and so can any upgrade marked `climbs`. */
export function canClimb(v: Vehicle): boolean {
  if (VEHICLE_MODELS[v.model]?.climbs) return true;
  return v.upgrades.some((u) => (VEHICLE_UPGRADES[u] as { climbs?: boolean } | undefined)?.climbs === true);
}

/** Share of the normal price the company pays for repairs: depots have their own workshop bay. */
export function repairDiscount(game: Game): number {
  const depots = (game.state.systems.business as Partial<BusinessState> | undefined)?.depots;
  const n = depots ? Object.keys(depots).length : 0;
  if (n >= DEPOT.manyDepots) return DEPOT.repairDiscountMany;
  return n > 0 ? DEPOT.repairDiscount : 1;
}

/** Push `n` reviews of `stars` into the rolling reputation window (goal rewards, missed loan payments). */
export function addReviews(game: Game, stars: number, n: number): void {
  const state = game.state;
  for (let i = 0; i < n; i++) state.ratings.push(Math.max(1, Math.min(5, stars)));
  if (state.ratings.length > BALANCE.rating.window) state.ratings.splice(0, state.ratings.length - BALANCE.rating.window);
  state.reputation = state.ratings.reduce((a, b) => a + b, 0) / state.ratings.length;
}

/** Keep game.state.unlocks in step with the active services, hotels ('hotel:<id>') and depots ('depot:<zone>'). */
function syncUnlocks(game: Game): void {
  const st = businessState(game);
  const mine = (u: string) => u in SERVICE_BY_ID || u.startsWith('hotel:') || u.startsWith('depot:');
  const others = game.state.unlocks.filter((u) => !mine(u));
  game.state.unlocks = [
    ...others,
    ...Object.keys(st.services),
    ...Object.keys(st.hotels).map((id) => `hotel:${id}`),
    ...Object.keys(st.depots).map((id) => `depot:${id}`),
  ];
}

function changed(game: Game): void {
  syncUnlocks(game);
  game.emit('change');
}

// ---------------------------------------------------------------- services
/** Can the company start this service now? */
export function serviceCheck(game: Game, id: string): Check {
  const def = SERVICE_BY_ID[id];
  if (!def) return no('Unknown service.');
  if (isActive(game, id)) return no('Already running.');
  const rank = currentRank(game);
  if (def.minRank !== undefined && rank < def.minRank) return no(`Needs the ${RANKS[def.minRank].name} rank.`);
  const fleet = fleetSize(game);
  if (def.minFleet !== undefined && fleet < def.minFleet) return no(`Needs ${def.minFleet} tuk-tuks (you run ${fleet}).`);
  const rep = game.state.reputation;
  if (def.minRep !== undefined && rep < def.minRep) return no(`Needs a ${def.minRep.toFixed(1)}★ rating (you have ${rep.toFixed(1)}★).`);
  for (const req of def.requires ?? []) {
    if (!isActive(game, req)) return no(`Needs ${SERVICE_BY_ID[req]?.name ?? req} first.`);
  }
  if (def.climbing && !game.state.vehicles.some(canClimb)) return no('Needs a tuk-tuk that can climb Doi Suthep (an electric one).');
  if (!canAfford(game, def.cost)) return no(`Needs ${thb(def.cost)} (you have ${thb(game.state.cash)}).`);
  return OK;
}

export function startService(game: Game, id: string): Check {
  const check = serviceCheck(game, id);
  if (!check.ok) return check;
  const def = SERVICE_BY_ID[id];
  spend(game, def.cost, def.ledger);
  businessState(game).services[id] = { since: businessDay(game.state.time) };
  game.notify(`${def.icon} ${def.name} started. ${def.effect}`, 'good');
  changed(game);
  return OK;
}

/** End a service, and any service that depends on it. */
export function stopService(game: Game, id: string, why?: string): Check {
  const st = businessState(game);
  if (!(id in st.services)) return no('Not running.');
  delete st.services[id];
  const def = SERVICE_BY_ID[id];
  game.notify(why ?? `${def?.icon ?? ''} ${def?.name ?? id} cancelled.`, why ? 'bad' : 'info');
  for (const other of SERVICES) {
    if (other.id in st.services && other.requires?.includes(id)) stopService(game, other.id);
  }
  changed(game);
  return OK;
}

/** Business day of the next bill for a charge every `every` days that started on day `since`. */
export function nextBillDay(since: number, every: number, today: number): number {
  const elapsed = today - since;
  return today + (every - (elapsed % every));
}

// ------------------------------------------------------------------ hotels
export interface HotelSite {
  place: Place;
  tier: HotelTier;
}

const hotelCache = new WeakMap<World, HotelSite[]>();

/**
 * Hotels that will sign a partnership: the curated landmark hotels (luxury) and the 4–5★ hotels from OSM, whose
 * place weight carries their stars (world.ts: 1 + stars / 5).
 */
export function hotelSites(world: World): HotelSite[] {
  const hit = hotelCache.get(world);
  if (hit) return hit;
  const sites: HotelSite[] = [];
  for (const id of LUXURY_HOTELS) {
    const place = world.landmarks.find((l) => l.id === id);
    if (place) sites.push({ place, tier: HOTEL_TIERS.luxury });
  }
  for (const p of world.places) {
    if (p.landmark || p.cat !== 'hotel') continue;
    if (p.weight >= 1.99) sites.push({ place: p, tier: HOTEL_TIERS.five });
    else if (p.weight >= 1.79) sites.push({ place: p, tier: HOTEL_TIERS.four });
  }
  hotelCache.set(world, sites);
  return sites;
}

export function hotelSite(world: World, placeId: string): HotelSite | undefined {
  return hotelSites(world).find((s) => s.place.id === placeId);
}

export function hotelCheck(game: Game, placeId: string): Check {
  const site = hotelSite(game.world, placeId);
  if (!site) return no('Unknown hotel.');
  if (placeId in businessState(game).hotels) return no('Already a partner.');
  if (currentRank(game) < HOTEL_MIN_RANK) return no(`Hotels sign with a ${RANKS[HOTEL_MIN_RANK].name} or above.`);
  const rep = game.state.reputation;
  if (rep < site.tier.minRep) return no(`Needs a ${site.tier.minRep.toFixed(1)}★ rating (you have ${rep.toFixed(1)}★).`);
  if (!canAfford(game, site.tier.monthly)) return no(`Needs ${thb(site.tier.monthly)} for the first month.`);
  return OK;
}

export function partnerHotel(game: Game, placeId: string): Check {
  const check = hotelCheck(game, placeId);
  if (!check.ok) return check;
  const site = hotelSite(game.world, placeId)!;
  spend(game, site.tier.monthly, 'business');
  businessState(game).hotels[placeId] = { since: businessDay(game.state.time) };
  game.notify(`🛎️ ${site.place.name} now books its guests with you, at ${Math.round((HOTEL_FARE_PREMIUM - 1) * 100)} % over the street rate.`, 'good', site.place.x, site.place.y);
  changed(game);
  return OK;
}

export function endHotel(game: Game, placeId: string, why?: string): Check {
  const st = businessState(game);
  if (!(placeId in st.hotels)) return no('Not a partner.');
  delete st.hotels[placeId];
  const name = hotelSite(game.world, placeId)?.place.name ?? placeId;
  game.notify(why ?? `🛎️ Partnership with ${name} ended.`, why ? 'bad' : 'info');
  changed(game);
  return OK;
}

// ------------------------------------------------------------------ depots
export interface DepotSite {
  zone: Zone;
  /** Where the depot stands: a filling station with a shophouse garage behind it, so EVs can charge there. */
  place: Place;
  /** Kerbside parking spot on the road graph (the place's node). */
  x: number;
  y: number;
}

const depotCache = new WeakMap<World, DepotSite[]>();

/** One depot site per operating zone: the filling station nearest the zone centre (not an LPG pump). */
export function depotSites(world: World): DepotSite[] {
  const hit = depotCache.get(world);
  if (hit) return hit;
  const used = new Set<number>();
  const sites: DepotSite[] = [];
  const fuel = world.places.filter((p) => p.cat === 'fuel' && !p.lpg);
  const pool = fuel.length ? fuel : world.places.filter((p) => p.cat === 'fuel');
  for (const zone of ZONES) {
    const [x, y] = world.graph.projection.toXY(zone.lon, zone.lat);
    let best: Place | null = null;
    let bestD = Infinity;
    for (const p of pool) {
      if (used.has(p.idx)) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) continue;
    used.add(best.idx);
    sites.push({ zone, place: best, x: world.graph.nodeX[best.node], y: world.graph.nodeY[best.node] });
  }
  depotCache.set(world, sites);
  return sites;
}

/** Tuk-tuks parked at a depot site right now. */
export function parkedAt(game: Game, site: DepotSite): number {
  let n = 0;
  for (const v of game.state.vehicles) {
    if (v.task.kind !== 'offduty' || v.route) continue;
    const pose = game.vehiclePose(v);
    if (Math.hypot(pose.x - site.x, pose.y - site.y) <= DEPOT.parkedRadius) n++;
  }
  return n;
}

export function activeDepots(game: Game): DepotSite[] {
  const st = businessState(game);
  return depotSites(game.world).filter((d) => d.zone.id in st.depots);
}

export function depotCheck(game: Game, zoneId: string): Check {
  if (!depotSites(game.world).some((d) => d.zone.id === zoneId)) return no('No site in that zone.');
  if (zoneId in businessState(game).depots) return no('Already open.');
  if (currentRank(game) < DEPOT.minRank) return no(`Needs the ${RANKS[DEPOT.minRank].name} rank.`);
  const first = DEPOT.deposit + DEPOT.rentPerDay;
  if (!canAfford(game, first)) return no(`Needs ${thb(first)} for the deposit and first day.`);
  return OK;
}

export function openDepot(game: Game, zoneId: string): Check {
  const check = depotCheck(game, zoneId);
  if (!check.ok) return check;
  const site = depotSites(game.world).find((d) => d.zone.id === zoneId)!;
  spend(game, DEPOT.deposit + DEPOT.rentPerDay, 'business');
  businessState(game).depots[zoneId] = { since: businessDay(game.state.time) };
  game.notify(`🏠 Depot opened in ${site.zone.name}, by ${site.place.name}. Off-duty tuk-tuks park and charge here.`, 'good', site.place.x, site.place.y);
  changed(game);
  return OK;
}

export function closeDepot(game: Game, zoneId: string, why?: string): Check {
  const st = businessState(game);
  if (!(zoneId in st.depots)) return no('Not open.');
  delete st.depots[zoneId];
  const name = ZONES.find((z) => z.id === zoneId)?.name ?? zoneId;
  game.notify(why ?? `🏠 ${name} depot handed back to the landlord.`, why ? 'bad' : 'info');
  changed(game);
  return OK;
}

function nearestDepot(game: Game, x: number, y: number): { site: DepotSite; d: number } | null {
  let best: DepotSite | null = null;
  let bestD = Infinity;
  for (const s of activeDepots(game)) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best ? { site: best, d: bestD } : null;
}

// ------------------------------------------------------------------- loans
/** Total the bank will lend: unsecured credit for each star above 3★, plus half the owned fleet's resale value. */
export function creditLimit(game: Game): number {
  const unsecured = LOAN.unsecuredPerStar * Math.max(0, game.state.reputation - 3);
  return Math.floor((unsecured + LOAN.collateralShare * fleetValue(game)) / 1000) * 1000;
}

/** Largest new loan on offer right now (0 while a loan is outstanding). */
export function loanOffer(game: Game): number {
  if (businessState(game).loan) return 0;
  return creditLimit(game);
}

/** Daily instalment that repays `amount` over the loan term at the daily rate. */
export function instalmentFor(amount: number): number {
  const r = LOAN.dailyRate;
  return Math.ceil((amount * r) / (1 - (1 + r) ** -LOAN.termDays));
}

export function loanCheck(game: Game, amount: number): Check {
  if (businessState(game).loan) return no('Repay your current loan first.');
  const offer = loanOffer(game);
  if (offer < LOAN.minAmount) return no(`The bank lends from ${thb(LOAN.minAmount)}. Better stars and owned tuk-tuks raise your limit.`);
  if (amount < LOAN.minAmount) return no(`The smallest loan is ${thb(LOAN.minAmount)}.`);
  if (amount > offer) return no(`Your limit is ${thb(offer)}.`);
  return OK;
}

export function takeLoan(game: Game, amount: number): Check {
  amount = Math.round(amount / 1000) * 1000;
  const check = loanCheck(game, amount);
  if (!check.ok) return check;
  const instalment = instalmentFor(amount);
  businessState(game).loan = { borrowed: amount, balance: amount, instalment, takenDay: businessDay(game.state.time), interestPaid: 0, missed: 0 };
  earn(game, amount, 'loan');
  game.notify(`🏦 Loan of ${thb(amount)} paid in. ${thb(instalment)} a day for ${LOAN.termDays} days, from tomorrow's 04:00.`, 'good');
  changed(game);
  return OK;
}

/** Pay off part or all of the loan early (no penalty). */
export function repayLoan(game: Game, amount: number): Check {
  const st = businessState(game);
  const loan = st.loan;
  if (!loan) return no('No loan to repay.');
  const pay = Math.min(Math.round(amount), Math.ceil(loan.balance));
  if (pay <= 0) return no('Nothing to pay.');
  if (!canAfford(game, pay)) return no(`Needs ${thb(pay)} (you have ${thb(game.state.cash)}).`);
  spend(game, pay, 'loan');
  loan.balance -= pay;
  if (loan.balance < 1) {
    st.loan = null;
    game.notify('🏦 Loan repaid in full. The bank manager shakes your hand.', 'good');
  } else {
    loan.instalment = Math.min(loan.instalment, Math.ceil(loan.balance * (1 + LOAN.dailyRate)));
  }
  changed(game);
  return OK;
}

// ---------------------------------------------------------------- bookings
/** Categories app riders book from (street origins minus places where nobody opens an app). */
const APP_CATEGORIES: PlaceCategory[] = [
  'gate',
  'market',
  'mall',
  'transport',
  'university',
  'hospital',
  'nightlife',
  'attraction',
  'museum',
  'hotel',
  'hostel',
  'cafe',
  'restaurant',
];
/** Game minutes between refreshes of the booking rates and origin weights (they drift slowly with the hour). */
const RATE_MINUTES = 5;
/** Metres from a working fleet tuk-tuk within which the app offers it riders [pacing]. */
const APP_MATCH_RADIUS = 2_000;
/** The company dispatcher sends a new booking to the nearest free driver within this many metres [pacing]. */
const DISPATCH_RADIUS = 2_500;

/** Riders who do not book through an app: they wave down whatever passes. */
const NO_APP: Archetype[] = ['monk', 'vendor', 'elder'];

/** Fleet tuk-tuks the app can offer riders to: with a driver, and not off duty, broken down or parked at a depot. */
function appTukTuks(game: Game): Vehicle[] {
  return game.state.vehicles.filter((v) => v.driverId !== null && v.task.kind !== 'offduty' && v.task.kind !== 'broken' && v.task.kind !== 'depot');
}

type PoolId = 'app' | 'hotel' | 'hostel';

interface PoolDef {
  places: Place[];
  /** Mean raw origin weight over a weekday, to normalise the time-of-day factor. */
  base: number;
}

const poolCache = new WeakMap<World, Record<PoolId, PoolDef>>();

function lerpProfile(p: number[], hour: number): number {
  const h0 = Math.floor(hour) % 24;
  const t = hour - Math.floor(hour);
  return p[h0] * (1 - t) + p[(h0 + 1) % 24] * t;
}

/** Origin weight from the hour profile and landmark timetable alone (no events or weather). */
function rawWeight(p: Place, cal: CalendarInfo): number {
  const sched = LANDMARK_SCHEDULE[p.id];
  return p.weight * (sched ? sched(cal) : lerpProfile(HOUR_PROFILE[p.cat], cal.hour));
}

function pools(world: World): Record<PoolId, PoolDef> {
  const hit = poolCache.get(world);
  if (hit) return hit;
  const make = (places: Place[]): PoolDef => {
    let total = 0;
    // A weekday (Tue 3 Nov 2026), sampled at half past each hour.
    for (let h = 0; h < 24; h++) {
      const cal = calendar(2 * DAY + h * HOUR + 30 * MINUTE);
      for (const p of places) total += rawWeight(p, cal);
    }
    return { places, base: total / 24 || 1 };
  };
  const cats = new Set(APP_CATEGORIES);
  const out: Record<PoolId, PoolDef> = {
    app: make(world.places.filter((p) => cats.has(p.cat))),
    hotel: make(world.places.filter((p) => p.cat === 'hotel')),
    hostel: make(world.places.filter((p) => p.cat === 'hostel')),
  };
  poolCache.set(world, out);
  return out;
}

interface LivePool {
  def: PoolDef;
  weights: Float64Array;
  total: number;
}

/** Booking rates in rides per game hour, refreshed every RATE_MINUTES. */
interface Rates {
  app: number;
  flyers: number;
  concierge: number;
  hotels: { site: HotelSite; rate: number }[];
  tours: { tour: TourDef; rate: number }[];
}

const NO_RATES: Rates = { app: 0, flyers: 0, concierge: 0, hotels: [], tours: [] };

/** App bookings follow the company's stars: 0.2× at 3.3★, 0.8× at 4.2★, 1× at 4.5★, 1.3× at 5★ [pacing]. */
export function appRatingFactor(reputation: number): number {
  return Math.max(0.2, Math.min(1.3, (reputation - 3) / 1.5));
}

// ------------------------------------------------------------------ system
export class BusinessSystem implements GameSystem {
  readonly id = 'business';
  private minute = Number.NaN;
  private rates: Rates = NO_RATES;
  private live: Partial<Record<PoolId, LivePool>> = {};
  private radioBucket = Number.NaN;
  private readonly radioSeen = new Set<number>();
  /** Some mountain tour is held for a tuk-tuk that is still busy (checked every step until it is sent). */
  private holding = true;
  /** Rates need recomputing at the next minute (a service, hotel or the fleet changed). */
  private dirty = true;
  /** The airport counter permit is active. */
  private counter = false;
  /** The dispatch radio is active (read by the sight rule, which runs for every vehicle and hail). */
  private radio = false;
  /** Game time of the last scan for new terminal hails. */
  private counterScan = Number.NaN;

  init(game: Game): void {
    businessState(game);
    syncUnlocks(game);
    const refresh = () => {
      const st = businessState(game);
      this.dirty = true;
      this.radio = 'radio' in st.services;
      this.counter = 'airport' in st.services;
    };
    refresh();
    game.on('change', refresh);
    game.on('day', () => this.bill(game));
    game.on('trip', (r: TripResult) => this.onTrip(game, r));
    game.sightRules.push((_v, req) => this.radioSees(game, req));
    game.extraChargers.push(() => activeDepots(game).map((d) => d.place));
  }

  update(game: Game, dt: number): void {
    const minute = Math.floor(game.state.time / MINUTE);
    if (minute !== this.minute) {
      this.minute = minute;
      this.everyMinute(game, minute);
    }
    if (this.holding) this.dispatchHeld(game);
    if (this.counter) this.airportCounter(game);
    else this.counterScan = Number.NaN;
    const r = this.rates;
    if (r === NO_RATES) return;
    const cal = calendar(game.state.time);
    const rng = game.rng;
    const due = (perHour: number) => perHour > 0 && rng.chance((perHour * dt) / HOUR);
    if (due(r.app)) this.spawnApp(game, cal);
    if (due(r.flyers)) this.spawnFromPool(game, cal, 'hostel', 'flyers');
    if (due(r.concierge)) this.spawnFromPool(game, cal, 'hotel', 'concierge');
    for (const h of r.hotels) if (due(h.rate)) this.spawnHotel(game, cal, h.site);
    for (const t of r.tours) if (due(t.rate)) this.spawnTour(game, cal, t.tour);
  }

  /** Bookings per game hour for each active channel right now (for tests and the panel). */
  currentRates(): Readonly<Rates> {
    return this.rates;
  }

  // ------------------------------------------------------------ per minute
  private everyMinute(game: Game, minute: number): void {
    const st = businessState(game);
    if (minute % RATE_MINUTES === 0 || this.dirty) {
      this.dirty = false;
      this.rates = this.computeRates(game, st);
    }
    this.releaseStale(game);
    this.parkOffDuty(game);
    for (const [id, d] of Object.entries(st.dwell)) if (game.state.time >= d.until) delete st.dwell[id];
    const rank = computeRank(game);
    if (rank > st.rank) {
      st.rank = rank;
      const k = RANKS[rank];
      game.notify(`${k.icon} Promoted to ${k.name}! ${k.blurb}`, 'goal');
      game.emit('rank', rank);
      game.emit('change');
    }
  }

  private pool(game: Game, id: PoolId, cal: CalendarInfo): LivePool {
    let live = this.live[id];
    const def = pools(game.world)[id];
    if (!live || live.def !== def) live = this.live[id] = { def, weights: new Float64Array(def.places.length), total: 0 };
    let total = 0;
    for (let i = 0; i < def.places.length; i++) {
      const w = originWeight(game, def.places[i], cal);
      live.weights[i] = w;
      total += w;
    }
    live.total = total;
    return live;
  }

  private computeRates(game: Game, st: BusinessState): Rates {
    const hotels = Object.keys(st.hotels);
    const tours = TOURS.filter((t) => t.service in st.services);
    const on = (id: string) => id in st.services;
    if (!on('app') && !on('flyers') && !on('concierge') && !hotels.length && !tours.length) return NO_RATES;
    const cal = calendar(game.state.time);
    const season = SEASON_INDEX[cal.month];
    // Time-of-day factor of each origin pool: its origin weight now (events and weather included) over its weekday mean.
    const factor: Record<PoolId, number> = { app: 0, hotel: 0, hostel: 0 };
    const need: Record<PoolId, boolean> = {
      app: on('app'),
      hostel: on('flyers') || tours.length > 0,
      hotel: on('concierge') || hotels.length > 0 || tours.length > 0,
    };
    for (const id of Object.keys(need) as PoolId[]) {
      if (!need[id]) continue;
      const live = this.pool(game, id, cal);
      factor[id] = live.total / live.def.base;
    }
    const rates: Rates = { app: 0, flyers: 0, concierge: 0, hotels: [], tours: [] };
    if (on('app')) {
      const fleet = Math.min(APP_FLEET_CAP, appTukTuks(game).length);
      const ads = on('social_ads') ? SOCIAL_ADS_BOOST : 1;
      rates.app = RATES.appPerVehicle * fleet * appRatingFactor(game.state.reputation) * factor.app * season * ads;
    }
    if (on('flyers')) rates.flyers = RATES.flyers * factor.hostel * season;
    if (on('concierge')) rates.concierge = RATES.concierge * factor.hotel * season;
    for (const id of hotels) {
      const site = hotelSite(game.world, id);
      if (site) rates.hotels.push({ site, rate: site.tier.rate * factor.hotel * season });
    }
    for (const tour of tours) {
      const open = cal.hour >= tour.from && cal.hour < tour.to;
      rates.tours.push({ tour, rate: open ? tour.rate * season : 0 });
    }
    return rates;
  }

  // -------------------------------------------------------------- spawning
  private pick(game: Game, id: PoolId): Place | null {
    const live = this.live[id];
    if (!live || live.total <= 0) return null;
    return live.def.places[game.rng.weighted(live.weights, live.total)];
  }

  /** Add a booking; the dispatcher phones the nearest free driver unless `dispatch` is false. */
  private push(game: Game, req: RideRequest, source: string, fixedFare: number | null, dispatch = true): RideRequest {
    req.source = source;
    req.fixedFare = fixedFare;
    req.expiresAt = game.state.time + BOOKING_PATIENCE_MIN * MINUTE;
    game.state.requests.push(req);
    if (dispatch) {
      const from = game.place(req.from);
      const v = this.nearestFree(game, from.x, from.y, DISPATCH_RADIUS, req.party, (x) => this.working(game, x));
      if (v) claimRequest(game, v, req.id);
    }
    return req;
  }

  /** A fleet tuk-tuk driven by the AI (a hired driver, or the player on autopilot) that is on shift and working. */
  private working(game: Game, v: Vehicle): boolean {
    if (v.driverId === null) return false;
    const d = game.driver(v.driverId);
    if (!d || (d.isPlayer && !game.state.autopilot)) return false;
    if (!d.isPlayer && !onShift(d, calendar(game.state.time))) return false;
    return v.task.kind !== 'broken' && v.task.kind !== 'offduty' && v.task.kind !== 'depot';
  }

  /** Nearest tuk-tuk passing `test` that is free now and has room for `party`, within `radius` metres. */
  private nearestFree(game: Game, x: number, y: number, radius: number, party: number, test: (v: Vehicle) => boolean): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = radius;
    for (const v of game.state.vehicles) {
      if (game.state.time < v.busyUntil || !this.isFree(game, v) || !test(v)) continue;
      if (party > (VEHICLE_MODELS[v.model]?.seats ?? 3)) continue;
      const pose = game.vehiclePose(v);
      const d = Math.hypot(pose.x - x, pose.y - y);
      if (d <= bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  /**
   * The app matches riders to drivers nearby: a booking comes from a busy spot within APP_MATCH_RADIUS of one of the
   * company's working tuk-tuks, picked at random.
   */
  private spawnApp(game: Game, cal: CalendarInfo): void {
    const live = this.live.app;
    if (!live || live.total <= 0) return;
    const working = appTukTuks(game);
    if (!working.length) return;
    const pose = game.vehiclePose(game.rng.pick(working));
    const places = live.def.places;
    const near = new Float64Array(places.length);
    let total = 0;
    for (let i = 0; i < places.length; i++) {
      const p = places[i];
      if (Math.abs(p.x - pose.x) > APP_MATCH_RADIUS || Math.abs(p.y - pose.y) > APP_MATCH_RADIUS) continue;
      if (Math.hypot(p.x - pose.x, p.y - pose.y) > APP_MATCH_RADIUS) continue;
      near[i] = live.weights[i];
      total += near[i];
    }
    if (total <= 0) return;
    const from = places[game.rng.weighted(near, total)];
    const arch = pickArchetype(game, from.cat, cal);
    if (NO_APP.includes(arch)) return;
    const to = pickDestination(game, from, arch, cal);
    // The app sells one-way rides at its per-km fare, not an out-of-town round trip with a wait.
    if (!to || to.offmap?.roundTrip) return;
    const req = makeRequest(game, from, to, arch, 'app', cal);
    this.push(game, req, 'app', appFare(req.distance));
  }

  /** Flyer calls from hostels (fixed at the going rate) and concierge calls from hotels (haggled at the kerb). */
  private spawnFromPool(game: Game, cal: CalendarInfo, pool: 'hostel' | 'hotel', source: 'flyers' | 'concierge'): void {
    const from = this.pick(game, pool);
    if (!from) return;
    const arch = pickArchetype(game, from.cat, cal);
    const to = pickDestination(game, from, arch, cal);
    if (!to) return;
    const req = makeRequest(game, from, to, arch, 'regular', cal);
    if (source === 'concierge') req.maxRatio *= CONCIERGE_TRUST;
    this.push(game, req, source, source === 'flyers' ? req.fairFare : null);
  }

  private spawnHotel(game: Game, cal: CalendarInfo, site: HotelSite): void {
    const arch = pickArchetype(game, 'hotel', cal);
    const to = pickDestination(game, site.place, arch, cal);
    if (!to) return;
    const req = makeRequest(game, site.place, to, arch, 'hotel', cal);
    this.push(game, req, `hotel:${site.place.id}`, roundFare(req.fairFare * HOTEL_FARE_PREMIUM));
  }

  /**
   * With the counter permit, a share of the passengers hailing at the terminal kerb buy a counter ticket instead: the
   * ride becomes a company booking at the set fare, which rivals cannot take and every fleet tuk-tuk can see. Long
   * runs and out-of-town round trips stay on the kerb.
   */
  private airportCounter(game: Game): void {
    const since = this.counterScan;
    this.counterScan = game.state.time;
    const airport = this.airport(game);
    if (!airport || !(since <= game.state.time)) return;
    for (const r of game.state.requests) {
      if (r.channel !== 'street' || r.from !== airport.idx || r.spawnedAt <= since || r.claimedBy !== null) continue;
      if (r.distance > AIRPORT_MAX_TRIP || game.place(r.to).offmap?.roundTrip || !game.rng.chance(AIRPORT_COUNTER_SHARE)) continue;
      r.channel = 'regular';
      r.source = 'airport';
      r.fixedFare = AIRPORT_FARE;
      r.expiresAt = Math.max(r.expiresAt, game.state.time + BOOKING_PATIENCE_MIN * MINUTE);
    }
  }

  private airport(game: Game): Place | undefined {
    return game.world.landmarks.find((l) => l.id === AIRPORT_LANDMARK);
  }

  private spawnTour(game: Game, cal: CalendarInfo, tour: TourDef): void {
    const hotels = this.live.hotel;
    const hostels = this.live.hostel;
    const ht = hotels?.total ?? 0;
    const hs = hostels?.total ?? 0;
    if (ht + hs <= 0) return;
    const from = this.pick(game, game.rng.next() * (ht + hs) < ht ? 'hotel' : 'hostel');
    if (!from) return;
    const stops = tour.stops
      .map((id) => game.world.landmarks.find((l) => l.id === id))
      .filter((p): p is Place => !!p && Math.hypot(p.x - from.x, p.y - from.y) >= BALANCE.demand.minTripMetres);
    if (!stops.length) return;
    const to = game.rng.pick(stops);
    const arch = game.rng.pick(tour.archetypes);
    const req = makeRequest(game, from, to, arch, 'regular', cal);
    req.line = game.rng.pick(tour.lines);
    if (!tour.climbs) {
      this.push(game, req, `tour:${tour.id}`, tour.fare);
      return;
    }
    this.offerClimb(game, req, tour);
  }

  /**
   * A mountain tour goes to one tuk-tuk that can climb. The nearest free one with a driver is sent straight away;
   * failing that, the booking is held for the nearest busy one (it goes after its current fare), or for the player's
   * own tuk-tuk if that one climbs. With no climber at all, the group books a songthaew instead.
   */
  private offerClimb(game: Game, req: RideRequest, tour: TourDef): void {
    this.push(game, req, `tour:${tour.id}`, tour.fare, false);
    this.assignClimber(game, req);
  }

  private assignClimber(game: Game, req: RideRequest): void {
    const from = game.place(req.from);
    let free: Vehicle | null = null;
    let freeD = Infinity;
    let busy: Vehicle | null = null;
    let busyD = Infinity;
    for (const v of game.state.vehicles) {
      if (!this.climberReady(game, v, req)) continue;
      const pose = game.vehiclePose(v);
      const dist = Math.hypot(pose.x - from.x, pose.y - from.y);
      if (this.isFree(game, v)) {
        if (dist < freeD) [free, freeD] = [v, dist];
      } else if (dist < busyD) [busy, busyD] = [v, dist];
    }
    req.claimedBy = null;
    if (free && claimRequest(game, free, req.id)) return;
    if (busy) {
      req.claimedBy = busy.id;
      this.holding = true;
      return;
    }
    const player = game.playerVehicle();
    if (player && canClimb(player) && !game.state.autopilot) {
      req.claimedBy = player.id;
      const tour = TOUR_BY_ID[req.source?.slice(5) ?? ''];
      game.notify(`${SERVICE_BY_ID[tour?.service ?? '']?.icon ?? '🌄'} Sunset charter booked for you at ${from.name}: ${thb(req.fixedFare ?? 0)} up Doi Suthep. Tap the group to pick them up.`, 'good', from.x, from.y);
      return;
    }
    game.state.requests = game.state.requests.filter((r) => r.id !== req.id);
  }

  /** A climbing tuk-tuk whose driver (hired, or the player on autopilot) is working and has room for the group. */
  private climberReady(game: Game, v: Vehicle, req: RideRequest): boolean {
    return canClimb(v) && this.working(game, v) && req.party <= (VEHICLE_MODELS[v.model]?.seats ?? 3);
  }

  /** Between fares (alighting counts) and not waiting for a tour group. */
  private isFree(game: Game, v: Vehicle): boolean {
    if (v.task.kind !== 'idle' && v.task.kind !== 'cruise') return false;
    const dwell = businessState(game).dwell[String(v.id)];
    return !dwell || game.state.time >= dwell.until;
  }

  /** Send each held mountain tour to its tuk-tuk the moment that tuk-tuk is free; re-offer it if the driver went home. */
  private dispatchHeld(game: Game): void {
    let held = false;
    for (const r of [...game.state.requests]) {
      if (!r.source?.startsWith('tour:') || r.claimedBy === null) continue;
      const v = game.vehicle(r.claimedBy);
      if (v && (v.task.kind === 'pickup' || v.task.kind === 'haggle') && v.task.requestId === r.id) continue;
      if (v && v === game.playerVehicle() && !game.state.autopilot) continue;
      if (!v || !this.climberReady(game, v, r)) {
        this.assignClimber(game, r);
        held ||= r.claimedBy !== null;
        continue;
      }
      if (this.isFree(game, v) && claimRequest(game, v, r.id)) continue;
      held = true;
    }
    this.holding = held;
  }

  /** Bookings held for a tuk-tuk that never came drop out once their patience runs out. */
  private releaseStale(game: Game): void {
    const now = game.state.time;
    const reqs = game.state.requests;
    if (!reqs.some((r) => r.source && r.claimedBy !== null && r.expiresAt < now)) return;
    game.state.requests = reqs.filter((r) => {
      if (!r.source || r.claimedBy === null || r.expiresAt >= now) return true;
      const v = game.vehicle(r.claimedBy);
      return !!v && (v.task.kind === 'pickup' || v.task.kind === 'haggle') && v.task.requestId === r.id;
    });
  }

  // ------------------------------------------------------------- depots
  /** Off-duty tuk-tuks drive back to the nearest depot; parked EVs charge overnight at the depot. */
  private parkOffDuty(game: Game): void {
    const st = businessState(game);
    if (!Object.keys(st.depots).length) return;
    for (const v of game.state.vehicles) {
      if (v.task.kind !== 'offduty' || v.route || game.state.time < v.busyUntil) continue;
      const driver = v.driverId !== null ? game.driver(v.driverId) : undefined;
      if (!driver || driver.isPlayer) continue;
      const pose = game.vehiclePose(v);
      const near = nearestDepot(game, pose.x, pose.y);
      if (!near || near.d > DEPOT.parkingRange) continue;
      if (near.d > DEPOT.parkedRadius) {
        if (sendTo(game, v, near.site.place.node)) v.task = { kind: 'depot' };
        continue;
      }
      const model = VEHICLE_MODELS[v.model];
      if (model?.powertrain === 'ev' && v.fuel < 0.9) refuel(game, v, BALANCE.fuel.evHomePerKm, model.rangeKm);
    }
  }

  // -------------------------------------------------------------- sightings
  /** With the dispatch radio, a street hail any on-duty fleet tuk-tuk can see is visible to all of them. */
  private radioSees(game: Game, req: RideRequest): boolean {
    if (!this.radio || req.channel !== 'street') return false;
    const bucket = Math.floor(game.state.time / 5);
    if (bucket !== this.radioBucket) {
      this.radioBucket = bucket;
      this.radioSeen.clear();
      const eyes: { x: number; y: number; r: number }[] = [];
      for (const v of game.state.vehicles) {
        if (v.driverId === null || v.task.kind === 'offduty' || v.task.kind === 'broken') continue;
        const pose = game.vehiclePose(v);
        eyes.push({ x: pose.x, y: pose.y, r: game.sightRadius(v) });
      }
      for (const r of game.state.requests) {
        if (r.channel !== 'street') continue;
        const from = game.world.places[r.from];
        if (eyes.some((e) => Math.hypot(from.x - e.x, from.y - e.y) <= e.r)) this.radioSeen.add(r.id);
      }
    }
    return this.radioSeen.has(req.id);
  }

  // ---------------------------------------------------------------- trips
  private onTrip(game: Game, r: TripResult): void {
    const source = r.request.source;
    if (!source) return;
    const st = businessState(game);
    const s = (st.stats[source] ??= { trips: 0, fares: 0 });
    s.trips++;
    s.fares += r.fare;
    const service = SERVICE_BY_ID[source];
    if (service?.perRide) spend(game, service.perRide, service.ledger);
    if (!source.startsWith('tour:')) return;
    const tour = TOUR_BY_ID[source.slice(5)];
    const v = game.vehicle(r.vehicleId);
    // An out-of-town round trip ends back at the pickup, and its wait at the stop was part of the time away.
    if (!tour || !v || game.place(r.request.to).offmap?.roundTrip) return;
    const until = game.state.time + tour.dwellHours * HOUR;
    v.busyUntil = Math.max(v.busyUntil, until);
    st.dwell[String(v.id)] = { until, tour: tour.id, place: r.request.to };
    if (v === game.playerVehicle() && !game.state.autopilot) {
      game.notify(`${SERVICE_BY_ID[tour.service]?.icon ?? ''} The ${tour.name.toLowerCase()} group heads off at ${game.place(r.request.to).name}. You wait with the tuk-tuk until ${formatClock(until)}.`, 'info');
    }
  }

  // --------------------------------------------------------------- billing
  /** Recurring charges at the 04:00 rollover (after the settlement). */
  private bill(game: Game): void {
    const st = businessState(game);
    const today = businessDay(game.state.time);
    for (const def of SERVICES) {
      const on = st.services[def.id];
      if (!on || !def.running) continue;
      const elapsed = today - on.since;
      if (elapsed <= 0 || elapsed % def.running.every !== 0) continue;
      if (!this.charge(game, def.running.amount, def.ledger)) {
        stopService(game, def.id, `${def.icon} ${def.name} stopped: the ${thb(def.running.amount)} bill could not be paid.`);
      }
    }
    for (const [id, on] of Object.entries(st.hotels)) {
      const site = hotelSite(game.world, id);
      const elapsed = today - on.since;
      if (!site || elapsed <= 0 || elapsed % HOTEL_BILLING_DAYS !== 0) continue;
      if (!this.charge(game, site.tier.monthly, 'business')) endHotel(game, id, `🛎️ ${site.place.name} ended the partnership: the ${thb(site.tier.monthly)} fee went unpaid.`);
    }
    for (const [zone, on] of Object.entries(st.depots)) {
      if (today <= on.since) continue;
      if (!this.charge(game, DEPOT.rentPerDay, 'business')) {
        const name = ZONES.find((z) => z.id === zone)?.name ?? zone;
        closeDepot(game, zone, `🏠 The ${name} depot is gone: the landlord kept the deposit when the rent went unpaid.`);
      }
    }
    this.payLoan(game, st, today);
  }

  private charge(game: Game, amount: number, cat: LedgerCategory): boolean {
    if (!canAfford(game, amount)) return false;
    spend(game, amount, cat);
    return true;
  }

  private payLoan(game: Game, st: BusinessState, today: number): void {
    const loan = st.loan;
    if (!loan || today <= loan.takenDay) return;
    const interest = loan.balance * LOAN.dailyRate;
    const due = Math.min(loan.instalment, Math.ceil(loan.balance + interest));
    if (canAfford(game, due)) {
      spend(game, due, 'loan');
      loan.balance = loan.balance + interest - due;
      loan.interestPaid += interest;
      if (loan.balance < 1) {
        st.loan = null;
        game.notify('🏦 Final instalment paid. The loan is cleared.', 'good');
      }
    } else {
      const fee = Math.round(loan.instalment * LOAN.lateFee);
      loan.balance += interest + fee;
      loan.missed++;
      addReviews(game, 1, LOAN.missedReviews);
      game.notify(`🏦 Missed a ${thb(due)} loan instalment: a ${thb(fee)} late fee, and word gets round that you don't pay your debts.`, 'bad');
    }
    game.emit('change');
  }
}

// -------------------------------------------------------------- UI helpers
export function businessOf(game: Game): BusinessSystem | undefined {
  return game.systems.find((s): s is BusinessSystem => s instanceof BusinessSystem);
}

/** What a waiting tour group means for its tuk-tuk, e.g. "Temple loop group at Wat Umong · back 10:45". */
export function tourDwellText(game: Game, v: Vehicle): string | null {
  const d = (game.state.systems.business as BusinessState | undefined)?.dwell?.[String(v.id)];
  if (!d || game.state.time >= d.until) return null;
  const tour = TOUR_BY_ID[d.tour];
  return `${tour?.name ?? 'Tour'} group at ${game.place(d.place).name} · back ${formatClock(d.until)}`;
}

/** Icon and label of a company booking, or null for a street hail. */
export function bookingTag(game: Game, req: RideRequest): { icon: string; label: string } | null {
  const src = req.source;
  if (!src) return req.channel === 'app' ? { icon: '📱', label: `${APP_BRAND} booking` } : null;
  if (src === 'app') return { icon: '📱', label: `${APP_BRAND} booking` };
  if (src === 'flyers') return { icon: '📄', label: 'Hostel flyer call' };
  if (src === 'concierge') return { icon: '🛎️', label: 'Concierge call' };
  if (src === 'airport') return { icon: '✈️', label: 'Airport counter' };
  if (src.startsWith('hotel:')) return { icon: '🏨', label: `${hotelSite(game.world, src.slice(6))?.place.name ?? 'Hotel'} booking` };
  if (src.startsWith('tour:')) {
    const tour = TOUR_BY_ID[src.slice(5)];
    return { icon: SERVICE_BY_ID[tour?.service ?? '']?.icon ?? '🎫', label: tour?.name ?? 'Tour' };
  }
  return null;
}
