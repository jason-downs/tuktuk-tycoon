// Calendar events: festivals, holidays, dry days and weekly walking-street
// closures (content/events.ts). The system turns the events active right now into
// demand, fare, speed and rating modifiers, road closures on the router, extra
// street hails of people heading to the event, and 'event' notices.

import { ORIGIN_MIX } from '../content/archetypes';
import { CITY_EVENTS, ROAD_SETS, type CityEventDef, type EventSite, type EventWindow, type RoadEffect } from '../content/events';
import type { World } from '../data/world';
import { DAY, HOUR, calendar, timeOf, type CalendarInfo } from './clock';
import { edgeMultipliers, roadSetEdges } from './closures';
import { makeRequest } from './demand';
import type { Game, GameSystem } from './game';
import type { Archetype, Place, Trip, Vehicle } from './types';

/** One concrete run of an event: [start, end) in game seconds. */
export interface EventOccurrence {
  event: CityEventDef;
  start: number;
  end: number;
  /** Stable id of this occurrence (event id and start time). */
  key: string;
  /** The dates of this run are inferred or unconfirmed. */
  approx: boolean;
}

interface EventsState {
  /** Occurrence keys already announced (and 'pre:' keys for day-before heads-ups). */
  announced: string[];
}

/** A heads-up notice goes out between 24 and 8 hours before a festival starts. */
const HEADS_UP_HOURS = 24;
const HEADS_UP_MIN_HOURS = 8;
/** Old City centre (moat centroid, calendar.md §7) and the radius that counts as "touching" it for splashes. */
const MOAT_CENTRE = { lat: 18.78716, lon: 98.98645 };
const SPLASH_RADIUS = 1_500;
const MAX_ANNOUNCED = 60;

// ------------------------------------------------------------ occurrences
function dateTime(iso: string, hour: number): number {
  const [y, m, d] = iso.split('-').map(Number);
  return timeOf(y, m - 1, d, hour);
}

/** Daily windows become one occurrence per date; all-day windows become a single run over the whole span. */
function expandWindow(event: CityEventDef, w: EventWindow): EventOccurrence[] {
  const out: EventOccurrence[] = [];
  const first = dateTime(w.from, 0);
  const last = dateTime(w.to, 0);
  const approx = !!(event.approx || w.approx);
  if (w.start === 0 && w.end === 24) return [{ event, start: first, end: last + DAY, key: `${event.id}@${first}`, approx }];
  for (let t = first; t <= last; t += DAY) {
    const start = t + w.start * HOUR;
    out.push({ event, start, end: t + w.end * HOUR, key: `${event.id}@${start}`, approx });
  }
  return out;
}

/** Every dated occurrence, sorted by start. */
const DATED: EventOccurrence[] = CITY_EVENTS.flatMap((e) => (e.windows ?? []).flatMap((w) => expandWindow(e, w))).sort(
  (a, b) => a.start - b.start,
);
const WEEKLY = CITY_EVENTS.filter((e) => e.weekly?.length);

/** Occurrences overlapping [from, to), sorted by start. */
export function occurrencesBetween(from: number, to: number): EventOccurrence[] {
  const out: EventOccurrence[] = [];
  for (const o of DATED) {
    if (o.start >= to) break;
    if (o.end > from) out.push(o);
  }
  const d0 = Math.floor(from / DAY) - 1;
  const d1 = Math.floor(to / DAY);
  for (const e of WEEKLY) {
    for (let d = d0; d <= d1; d++) {
      const weekday = ((d % 7) + 7) % 7;
      for (const w of e.weekly!) {
        if (w.weekday !== weekday) continue;
        const start = d * DAY + w.start * HOUR;
        const end = d * DAY + w.end * HOUR;
        if (end > from && start < to) out.push({ event: e, start, end, key: `${e.id}@${start}`, approx: false });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Events running at a game time. */
export function activeOccurrences(time: number): EventOccurrence[] {
  return occurrencesBetween(time, time + 1);
}

/** Events running now or starting within the next `days` days. */
export function upcomingOccurrences(time: number, days: number): EventOccurrence[] {
  return occurrencesBetween(time, time + days * DAY);
}

export function isFestivalTime(time: number): boolean {
  return activeOccurrences(time).some((o) => o.event.kind === 'festival');
}

// ------------------------------------------------------------------ sites
interface ResolvedSite {
  x: number;
  y: number;
  r: number;
}

const siteCache = new WeakMap<World, Map<EventSite, ResolvedSite | null>>();

function resolveSite(world: World, s: EventSite): ResolvedSite | null {
  let m = siteCache.get(world);
  if (!m) siteCache.set(world, (m = new Map()));
  if (m.has(s)) return m.get(s)!;
  let out: ResolvedSite | null = null;
  if (s.landmark) {
    const p = world.landmarks.find((l) => l.id === s.landmark);
    if (p) out = { x: p.x, y: p.y, r: s.radius };
  } else if (s.lat !== undefined && s.lon !== undefined) {
    const [x, y] = world.graph.projection.toXY(s.lon, s.lat);
    out = { x, y, r: s.radius };
  }
  m.set(s, out);
  return out;
}

/** Map position of an event's main site, destination or closed road (for notices and the calendar). */
export function eventAnchor(world: World, e: CityEventDef): { x: number; y: number } | null {
  const s = e.sites?.[0];
  if (s) return resolveSite(world, s);
  const to = e.inbound?.to?.[0];
  const p = to ? world.landmarks.find((l) => l.id === to) : undefined;
  if (p) return { x: p.x, y: p.y };
  const road = e.roads?.[0];
  const edges = road ? roadSetEdges(world.graph, road.set) : null;
  if (!edges?.length) return null;
  const pts = world.graph.edges[edges[edges.length >> 1]].pts;
  return { x: pts[0], y: pts[1] };
}

// ------------------------------------------------------------- describing
const pct = (m: number): number => Math.round(Math.abs(m - 1) * 100);

export function roadEffectText(eff: RoadEffect): string {
  const name = ROAD_SETS[eff.set]?.name ?? eff.set;
  return eff.closed ? `⛔ ${name} closed` : `🐢 ${name} at ${Math.round((eff.slow ?? 1) * 100)}% speed`;
}

/** Short effect chips for the calendar panel. */
export function eventEffectChips(e: CityEventDef): string[] {
  const chips: string[] = [];
  if (e.siteDemand && e.siteDemand > 1) chips.push(`Hails ×${e.siteDemand} nearby`);
  if (e.siteDemand && e.siteDemand < 1) chips.push(`Hails −${pct(e.siteDemand)}% nearby`);
  if (e.inbound) chips.push(`+${e.inbound.perHour}/h rides there`);
  if (e.siteFare && e.siteFare > 1) chips.push(`Fares +${pct(e.siteFare)}%`);
  if (e.fare && e.fare > 1) chips.push(`Fares +${pct(e.fare)}%`);
  if (e.inbound?.fare && e.inbound.fare > 1) chips.push('Charter fares');
  const c = e.catDemand ?? {};
  if ((c.hotel ?? 1) > 1) chips.push(`Tourists +${pct(c.hotel!)}%`);
  if ((c.transport ?? 1) > 1) chips.push(`Terminals +${pct(c.transport!)}%`);
  if ((c.nightlife ?? 1) > 1) chips.push(`Bars +${pct(c.nightlife!)}%`);
  if ((c.nightlife ?? 1) < 1) chips.push('Bars dry');
  if ((c.temple ?? 1) > 1 && (c.hotel ?? 1) === 1) chips.push(`Temples +${pct(c.temple!)}%`);
  if ((c.university ?? 1) > 1) chips.push(`Students +${pct(c.university!)}%`);
  if ((c.school ?? 1) < 1) chips.push('Schools & offices shut');
  if ((c.viewpoint ?? 1) < 1) chips.push('Fewer viewpoint trips');
  if (e.speed && e.speed < 1) chips.push(`Traffic −${pct(e.speed)}% speed`);
  for (const r of e.roads ?? []) chips.push(roadEffectText(r));
  if (e.splash) chips.push('Wet seats without curtains');
  return chips;
}

// ----------------------------------------------------------------- state
export function eventsState(game: Game): EventsState {
  const raw = (game.state.systems.events ?? {}) as Partial<EventsState>;
  const s: EventsState = { announced: Array.isArray(raw.announced) ? raw.announced : [] };
  game.state.systems.events = s;
  return s;
}

const calTime = (cal: CalendarInfo): number => cal.day * DAY + cal.hour * HOUR;

interface InboundPool {
  from: Place[];
  weights: Float64Array;
  total: number;
  to: Place[];
}

interface Snapshot {
  signature: string;
  active: EventOccurrence[];
  demand: Float32Array;
  fare: Float32Array;
}

// ----------------------------------------------------------------- system
export class EventsSystem implements GameSystem {
  readonly id = 'events';
  private minute = Number.NaN;
  private snap: Snapshot | null = null;
  private roadSignature = '';
  private announcedMinute = -1;
  private readonly pools = new Map<CityEventDef, InboundPool | null>();

  init(game: Game): void {
    eventsState(game);
    game.demandModifiers.push((place, cal) => this.at(game, calTime(cal)).demand[place.idx] ?? 1);
    game.fareModifiers.push((origin, cal) => this.at(game, calTime(cal)).fare[origin.idx] ?? 1);
    game.speedModifiers.push((cls, cal) => {
      let f = 1;
      for (const o of this.at(game, calTime(cal)).active) {
        const s = o.event.speed;
        if (s) f *= cls <= 3 ? s : 1 - (1 - s) / 2;
      }
      return f;
    });
    game.ratingModifiers.push((v, trip) => this.splash(game, v, trip));
    this.applyRoads(game, this.at(game, game.state.time).active);
  }

  update(game: Game, dt: number): void {
    const snap = this.at(game, game.state.time);
    this.applyRoads(game, snap.active);
    const minute = Math.floor(game.state.time / 60);
    if (minute !== this.announcedMinute) {
      this.announcedMinute = minute;
      this.announce(game, snap.active);
    }
    this.spawnInbound(game, snap.active, dt);
  }

  /** Active events and per-place multipliers at a game time, cached by minute and by active set. */
  private at(game: Game, time: number): Snapshot {
    const minute = Math.floor(time / 60);
    if (this.snap && minute === this.minute) return this.snap;
    this.minute = minute;
    const active = activeOccurrences(time);
    const signature = active.map((o) => o.key).join('|');
    if (this.snap && this.snap.signature === signature) return this.snap;
    this.snap = this.build(game, signature, active);
    return this.snap;
  }

  private build(game: Game, signature: string, active: EventOccurrence[]): Snapshot {
    const places = game.world.places;
    const demand = new Float32Array(places.length).fill(1);
    const fare = new Float32Array(places.length).fill(1);
    for (const o of active) {
      const e = o.event;
      const sites = (e.sites ?? []).map((s) => resolveSite(game.world, s)).filter((s): s is ResolvedSite => !!s);
      for (let i = 0; i < places.length; i++) {
        const p = places[i];
        let d = e.catDemand?.[p.cat] ?? 1;
        let f = e.fare ?? 1;
        if ((e.siteDemand || e.siteFare) && sites.some((s) => (p.x - s.x) ** 2 + (p.y - s.y) ** 2 <= s.r * s.r)) {
          d *= e.siteDemand ?? 1;
          f *= e.siteFare ?? 1;
        }
        demand[i] *= d;
        fare[i] *= f;
      }
    }
    return { signature, active, demand, fare };
  }

  /** Put the active closures on the router (and on the game, which re-applies them every step). */
  private applyRoads(game: Game, active: EventOccurrence[]): void {
    const effects = active.flatMap((o) => o.event.roads ?? []);
    const signature = effects.map((r) => `${r.set}:${r.closed ? 'x' : r.slow}`).join('|');
    if (signature === this.roadSignature) return;
    this.roadSignature = signature;
    if (!effects.length) {
      game.edgePenalty = null;
    } else {
      const mul = edgeMultipliers(game.world.graph, effects);
      game.edgePenalty = (edge) => mul[edge];
    }
    game.world.router.edgePenalty = game.edgePenalty;
  }

  private announce(game: Game, active: EventOccurrence[]): void {
    const st = game.state.systems.events as EventsState;
    const seen = new Set(st.announced);
    const remember = (key: string) => {
      st.announced.push(key);
      if (st.announced.length > MAX_ANNOUNCED) st.announced.splice(0, st.announced.length - MAX_ANNOUNCED);
    };
    for (const o of active) {
      if (seen.has(o.key)) continue;
      remember(o.key);
      const at = eventAnchor(game.world, o.event);
      const text = o.event.announce ?? `${o.event.name}: ${o.event.flavour}`;
      game.notify(`${o.event.icon} ${text}`, 'event', at?.x, at?.y);
    }
    const now = game.state.time;
    // Day-before heads-up for festivals, on the first day of a run only.
    for (const o of occurrencesBetween(now + HEADS_UP_MIN_HOURS * HOUR, now + HEADS_UP_HOURS * HOUR)) {
      if (!o.event.headsUp || o.start <= now + HEADS_UP_MIN_HOURS * HOUR) continue;
      const key = `pre:${o.key}`;
      if (seen.has(key)) continue;
      const continues = occurrencesBetween(o.start - 30 * HOUR, o.start).some((p) => p.event === o.event && p.start < o.start);
      if (continues) continue;
      remember(key);
      const c = calendar(o.start);
      const hh = `${String(Math.floor(c.hour)).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
      game.notify(`${o.event.icon} Coming up: ${o.event.name} from ${hh} tomorrow. ${o.event.drivers}`, 'event');
      seen.add(key);
    }
  }

  private pool(game: Game, e: CityEventDef): InboundPool | null {
    if (this.pools.has(e)) return this.pools.get(e)!;
    const inbound = e.inbound!;
    const world = game.world;
    let to: Place[] = [];
    if (inbound.to) to = inbound.to.map((id) => world.landmarks.find((l) => l.id === id)).filter((p): p is Place => !!p);
    else if (inbound.toPoint) {
      const [x, y] = world.graph.projection.toXY(inbound.toPoint.lon, inbound.toPoint.lat);
      let best: Place | null = null;
      let bestD = 5_000;
      for (const p of world.places) {
        if (p.cat === 'fuel') continue;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best) to = [best];
    }
    if (!to.length) {
      this.pools.set(e, null);
      return null;
    }
    const cx = to.reduce((a, p) => a + p.x, 0) / to.length;
    const cy = to.reduce((a, p) => a + p.y, 0) / to.length;
    // Riders come from busy places 1–7 km away, nearer ones more often.
    const minD = inbound.toPoint ? 3_000 : 900;
    const maxD = inbound.toPoint ? 14_000 : 7_000;
    const from: Place[] = [];
    const w: number[] = [];
    for (const p of world.places) {
      if (p.cat === 'fuel' || p.weight <= 0) continue;
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < minD || d > maxD) continue;
      from.push(p);
      w.push(p.weight * Math.exp(-d / 3_500));
    }
    const weights = Float64Array.from(w);
    const pool = from.length ? { from, weights, total: w.reduce((a, b) => a + b, 0), to } : null;
    this.pools.set(e, pool);
    return pool;
  }

  private spawnInbound(game: Game, active: EventOccurrence[], dt: number): void {
    const cal = calendar(game.state.time);
    for (const o of active) {
      const inbound = o.event.inbound;
      if (!inbound) continue;
      const hour = (game.state.time - Math.floor(o.start / DAY) * DAY) / HOUR;
      if (hour < inbound.start || hour >= inbound.end) continue;
      if (!game.rng.chance((inbound.perHour * dt) / HOUR)) continue;
      const pool = this.pool(game, o.event);
      if (!pool) continue;
      const from = pool.from[game.rng.weighted(pool.weights, pool.total)];
      const to = game.rng.pick(pool.to);
      const req = makeRequest(game, from, to, pickArchetype(game, from, inbound.bias), 'street', cal);
      req.line = game.rng.pick(inbound.lines);
      if (inbound.fare) req.maxRatio *= inbound.fare;
      game.state.requests.push(req);
    }
  }

  private splash(game: Game, v: Vehicle, trip: Trip): number {
    let worst = 0;
    for (const o of this.at(game, game.state.time).active) if (o.event.splash) worst = Math.min(worst, o.event.splash);
    if (!worst || v.upgrades.includes('rain_curtains')) return 0;
    const [cx, cy] = game.world.graph.projection.toXY(MOAT_CENTRE.lon, MOAT_CENTRE.lat);
    const a = game.world.places[trip.request.from];
    const b = game.world.places[trip.request.to];
    const near = (p: Place | undefined) => !!p && Math.hypot(p.x - cx, p.y - cy) <= SPLASH_RADIUS;
    return near(a) || near(b) ? worst : 0;
  }
}

function pickArchetype(game: Game, from: Place, bias?: Partial<Record<Archetype, number>>): Archetype {
  const mix = { ...ORIGIN_MIX[from.cat] };
  for (const [k, m] of Object.entries(bias ?? {})) mix[k as Archetype] = (mix[k as Archetype] ?? 0.3) * (m ?? 1);
  const keys = Object.keys(mix) as Archetype[];
  if (!keys.length) return 'thai_tourist';
  return keys[game.rng.weighted(keys.map((k) => mix[k] ?? 0))];
}
