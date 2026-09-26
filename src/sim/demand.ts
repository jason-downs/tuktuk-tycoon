// Ride demand: where and when passengers appear, who they are and where they
// want to go. Hour shapes follow docs/research/calendar.md §5 (daily rhythm)
// and landmarks.md demand notes; the month index is MOTS 2025 visitors/day
// relative to the yearly mean (calendar.md §1).

import { ARCHETYPES, DEST_AFFINITY, ORIGIN_MIX } from '../content/archetypes';
import { OFFMAP_DEST_WEIGHT } from '../content/offmap';
import { requestLine } from '../content/dialogue';
import { BALANCE, streetFare } from './balance';
import { calendar, type CalendarInfo } from './clock';
import type { Game } from './game';
import type { Archetype, Place, PlaceCategory, RideRequest } from './types';

/** [research] MOTS 2025 visitors/day index by month (Jan … Dec). */
export const SEASON_INDEX = [1.21, 1.21, 0.95, 0.97, 0.93, 0.89, 0.67, 0.8, 0.78, 1.02, 1.27, 1.31];

type Bump = [center: number, width: number, height: number];

function profile(base: number, ...bumps: Bump[]): number[] {
  return Array.from({ length: 24 }, (_, h) => {
    let v = base;
    for (const [c, w, height] of bumps) {
      let d = Math.abs(h + 0.5 - c);
      d = Math.min(d, 24 - d);
      v += height * Math.exp(-((d / w) ** 2));
    }
    return v;
  });
}

/** Relative ride generation by hour of day for each place category. */
export const HOUR_PROFILE: Record<PlaceCategory, number[]> = {
  gate: profile(0.15, [10, 3, 0.6], [19.5, 3, 1]),
  temple: profile(0.03, [6.5, 1, 0.6], [10, 2.5, 1], [15, 2, 0.8]),
  market: profile(0.08, [6, 1.5, 1], [11, 2, 0.6], [18, 2, 0.5]),
  mall: profile(0.03, [13, 2.5, 0.7], [19.5, 2, 1]),
  transport: profile(0.3, [9, 2, 1], [14, 2, 0.8], [19, 2.5, 1]),
  university: profile(0.03, [8, 1, 0.6], [16.5, 1.5, 1], [20, 2, 0.5]),
  school: profile(0, [7, 0.7, 0.8], [15.5, 0.8, 1]),
  hospital: profile(0.08, [9, 2, 1], [14, 2, 0.7]),
  nightlife: profile(0.03, [21, 2, 0.7], [23.5, 1.8, 1], [1.5, 1.2, 0.6]),
  attraction: profile(0.03, [11, 2.5, 0.8], [16, 2, 1]),
  museum: profile(0, [11, 2, 0.8], [15.5, 1.5, 1]),
  viewpoint: profile(0.05, [18, 1.5, 1], [21, 2, 0.8]),
  park: profile(0.03, [7, 1.5, 0.6], [17.5, 1.5, 1]),
  hotel: profile(0.08, [9, 2, 1], [18.5, 2, 1], [22, 1.5, 0.5]),
  hostel: profile(0.08, [10, 2, 0.8], [19, 2, 1], [23, 1.5, 0.6]),
  cafe: profile(0.03, [10, 2, 1], [15, 2, 0.8]),
  restaurant: profile(0.03, [12.5, 1.2, 0.8], [19.5, 1.5, 1]),
  shop: profile(0.03, [11, 2, 0.8], [17, 2, 1]),
  fuel: profile(0),
  civic: profile(0, [10, 2, 1], [14, 1.5, 0.6]),
};

const inHours = (h: number, from: number, to: number) => (from <= to ? h >= from && h < to : h >= from || h < to);

/**
 * Landmark-specific timetables that replace the category shape. Returns a
 * multiplier on the landmark's weight. Sources: calendar.md §4–5, landmarks.md.
 */
export const LANDMARK_SCHEDULE: Record<string, (c: CalendarInfo) => number> = {
  // Sunday Walking Street, Ratchadamnoen Rd, 16:00–23:00, peak 18–21.
  sunday_walking_street: (c) => (c.weekday === 0 && inHours(c.hour, 16, 23) ? (inHours(c.hour, 18, 21) ? 5 : 3) : 0),
  // Saturday Walking Street, Wua Lai Rd, 17:00–23:00.
  saturday_walking_street: (c) => (c.weekday === 6 && inHours(c.hour, 17, 23) ? 3.5 : 0),
  // Night Bazaar daily 18:00–23:00; pickups peak 21–23.
  night_bazaar: (c) => (inHours(c.hour, 18, 24) ? (inHours(c.hour, 21, 24) ? 3 : 2) : 0.15),
  anusarn_market: (c) => (inHours(c.hour, 17, 24) ? 1.8 : 0.1),
  kalare_night_bazaar: (c) => (inHours(c.hour, 18, 23) ? 1 : 0.05),
  kad_na_mor: (c) => (inHours(c.hour, 17, 22) ? 1.5 : 0.05),
  lang_mor_market: (c) => (inHours(c.hour, 17, 23) ? 1.5 : 0.1),
  chang_phueak_market: (c) => (inHours(c.hour, 17, 24) ? 1.5 : 0.2),
  chiang_mai_gate_market: (c) => (inHours(c.hour, 4, 10) || inHours(c.hour, 17, 24) ? 1.5 : 0.3),
  // Jing Jai (JJ) market: weekend mornings 07:30–10:30 are the draw.
  jing_jai_market: (c) => ((c.weekday === 0 || c.weekday === 6) && inHours(c.hour, 7, 13) ? 3 : 0.2),
  // Closed since 30 Jun 2022 (landmarks.md fact-check #18).
  kad_suan_kaew: () => 0.02,
  // Airport runs 24/7.
  cnx_airport: (c) => (inHours(c.hour, 1, 5) ? 0.3 : 1.3),
};

export type DemandModifier = (place: Place, cal: CalendarInfo) => number;

const CATEGORIES = Object.keys(HOUR_PROFILE) as PlaceCategory[];

function lerpProfile(p: number[], hour: number): number {
  const h0 = Math.floor(hour) % 24;
  const h1 = (h0 + 1) % 24;
  const t = hour - Math.floor(hour);
  return p[h0] * (1 - t) + p[h1] * t;
}

/** Relative strength of a place as a ride origin right now. */
export function originWeight(game: Game, place: Place, cal: CalendarInfo): number {
  if (place.cat === 'fuel' || place.offmap) return 0;
  const sched = LANDMARK_SCHEDULE[place.id];
  let w = place.weight * (sched ? sched(cal) : lerpProfile(HOUR_PROFILE[place.cat], cal.hour));
  for (const m of game.demandModifiers) w *= m(place, cal);
  return w;
}

/** Destination attractiveness kernel over straight-line distance. */
function distanceKernel(d: number): number {
  const { minTripMetres, typicalTripMetres } = BALANCE.demand;
  if (d < minTripMetres) return 0;
  const r = d / typicalTripMetres;
  return r * Math.exp(1 - r);
}

/** Who hails a ride from a place of this category at this hour (ORIGIN_MIX, bent by time of day). */
export function pickArchetype(game: Game, cat: PlaceCategory, cal: CalendarInfo): Archetype {
  const mix = ORIGIN_MIX[cat];
  const keys = Object.keys(mix) as Archetype[];
  if (!keys.length) return 'tourist_west';
  const weights = keys.map((k) => {
    let w = mix[k] ?? 0;
    // Monks travel in the morning; vendors at dawn; students avoid dawn.
    if (k === 'monk') w *= cal.hour >= 5 && cal.hour < 11 ? 2 : 0.2;
    if (k === 'vendor') w *= cal.hour >= 4 && cal.hour < 9 ? 2.5 : 0.5;
    if (k === 'student' && cal.hour < 7) w *= 0.2;
    return w;
  });
  return keys[game.rng.weighted(weights)];
}

/** Where this rider wants to go from `from`: affinity × distance kernel × opening hours; null if nowhere fits. */
export function pickDestination(game: Game, from: Place, arch: Archetype, cal: CalendarInfo): Place | null {
  const places = game.world.places;
  const affinity = DEST_AFFINITY[arch];
  const weights = new Float64Array(places.length);
  let total = 0;
  for (let i = 0; i < places.length; i++) {
    const p = places[i];
    if (p === from) continue;
    const aff = affinity[p.cat];
    if (!aff) continue;
    const k = distanceKernel(Math.hypot(p.x - from.x, p.y - from.y));
    if (!k) continue;
    const sched = LANDMARK_SCHEDULE[p.id];
    const open = sched ? Math.min(1, sched(cal)) : 0.15 + lerpProfile(HOUR_PROFILE[p.cat], (cal.hour + 0.5) % 24);
    const w = aff * p.weight * k * open * (p.offmap ? OFFMAP_DEST_WEIGHT : 1);
    weights[i] = w;
    total += w;
  }
  if (total <= 0) return null;
  return places[game.rng.weighted(weights, total)];
}

/** Build a street/app request between two places. */
export function makeRequest(
  game: Game,
  from: Place,
  to: Place,
  arch: Archetype,
  channel: RideRequest['channel'],
  cal: CalendarInfo,
): RideRequest {
  const info = ARCHETYPES[arch];
  const rng = game.rng;
  const distance = Math.hypot(to.x - from.x, to.y - from.y) * BALANCE.trip.detourFactor;
  let maxRatio = rng.range(info.maxRatio[0], info.maxRatio[1]);
  if (arch !== 'monk' && (cal.hour >= 22 || cal.hour < 4) && (from.cat === 'nightlife' || from.cat === 'market')) {
    maxRatio += BALANCE.fare.lateNightBonus;
  }
  for (const m of game.fareModifiers) maxRatio *= m(from, cal);
  const { patienceMin, patienceMax } = BALANCE.demand;
  return {
    id: game.nextId(),
    from: from.idx,
    to: to.idx,
    archetype: arch,
    party: rng.int(info.party[0], info.party[1]),
    channel,
    spawnedAt: game.state.time,
    expiresAt: game.state.time + rng.range(patienceMin, patienceMax),
    distance,
    fairFare: streetFare(distance),
    fixedFare: null,
    maxRatio,
    line: requestLine(game, from, to, arch, cal),
    claimedBy: null,
  };
}

/** Per-category totals cached per game minute so spawning stays cheap. */
interface OriginCache {
  minute: number;
  weights: Float64Array;
  total: number;
}

/** Number of arrivals in an interval with the given expected count. */
function poisson(game: Game, lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * game.rng.gauss()));
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = game.rng.next();
  while (p > limit) {
    k++;
    p *= game.rng.next();
  }
  return k;
}

export class DemandSystem {
  private cache: OriginCache | null = null;

  update(game: Game, dt: number): void {
    const state = game.state;
    // Expire passengers who gave up.
    if (state.requests.length) {
      const now = state.time;
      const keep: RideRequest[] = [];
      for (const r of state.requests) {
        if (r.claimedBy !== null || r.expiresAt > now) keep.push(r);
      }
      if (keep.length !== state.requests.length) state.requests = keep;
    }

    const cal = calendar(state.time);
    const minute = Math.floor(state.time / 60);
    if (!this.cache || this.cache.minute !== minute) {
      const places = game.world.places;
      const weights = this.cache?.weights ?? new Float64Array(places.length);
      // Weighed at the start of the minute, so a game loaded mid-minute draws the same passengers.
      const atMinute = calendar(minute * 60);
      let total = 0;
      for (let i = 0; i < places.length; i++) {
        const w = originWeight(game, places[i], atMinute);
        weights[i] = w;
        total += w;
      }
      this.cache = { minute, weights, total };
    }
    const base = game.baseOriginTotal();
    const season = SEASON_INDEX[cal.month];
    const rate = (BALANCE.demand.streetPerHour * season * (this.cache.total / base)) / 3600;
    const n = poisson(game, rate * dt);
    for (let i = 0; i < n; i++) this.spawn(game, cal);
  }

  private spawn(game: Game, cal: CalendarInfo): void {
    const cache = this.cache!;
    if (cache.total <= 0) return;
    const from = game.world.places[game.rng.weighted(cache.weights, cache.total)];
    const arch = pickArchetype(game, from.cat, cal);
    const to = pickDestination(game, from, arch, cal);
    if (!to) return;
    game.state.requests.push(makeRequest(game, from, to, arch, 'street', cal));
  }
}

export { CATEGORIES };
