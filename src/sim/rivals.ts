// Ambient traffic and rivals: red songthaews (rot daeng), rival tuk-tuks, cars
// and motorbikes driving between busy spots. They are not fleet vehicles: each
// keeps a compact record in game.state.systems.rivals and drives routes shared
// through a cache (one A* per new hub pair, a few per step at most).
//
// Songthaews and rival tuk-tuks compete for street hails: when one passes
// within ~40 m of a waiting, unclaimed passenger it may pick them up. The longer
// the passenger has waited, and the leaner the season, the likelier that is.
// Songthaews win locals (฿30 a head, economics.md §3); rival tuk-tuks win tourists.

import { calendar } from './clock';
import { SEASON_INDEX } from './demand';
import { inRide } from './dispatch';
import { businessDay } from './economy';
import { isFestivalTime } from './events';
import type { Game, GameSystem } from './game';
import type { Pose } from './graph';
import { MAX_EDGE_SLOWDOWN } from './movement';
import { Rng } from './rng';
import type { Route } from './routing';
import type { Archetype, RideRequest } from './types';

export type RivalKind = 'songthaew' | 'tuktuk' | 'car' | 'motorbike';
export const RIVAL_KINDS: readonly RivalKind[] = ['songthaew', 'tuktuk', 'car', 'motorbike'];

/**
 * [pacing] Traffic mix drawn on the map. Red songthaews dominate Chiang Mai's for-hire traffic (~2,100 vs ~100
 * working tuk-tuks in 2024, economics.md §9); the mix is tilted towards tuk-tuks so rivals are visible.
 */
const KIND_SHARE = [0.5, 0.22, 0.17, 0.11];
/** [pacing] Cruising speed relative to the road's tuk-tuk speed. */
const KIND_SPEED = [0.8, 0.92, 1.0, 1.05];
/** Kinds that pick up street hails. */
const COMPETES = [true, true, false, false];
/** [pacing] Chance per check (every COMPETE_INTERVAL) that a passing rival takes a passenger, before modifiers. */
const TAKE_BASE = [0.22, 0.18, 0, 0];

/** Metres from a waiting passenger within which a passing rival can pick them up. */
export const TAKE_RADIUS = 40;
/** Game seconds between competition checks. */
const COMPETE_INTERVAL = 5;
/** Largest number of rivals on the road. */
const MAX_RIVALS = 40;
/** Route searches allowed per step (the rest wait a step). */
const ROUTE_BUDGET = 2;
/** Game seconds between notices about rivals taking your passengers. */
const NOTICE_GAP = 90 * 60;
/** Metres from the player's tuk-tuk within which a lost passenger is worth a notice. */
const NOTICE_RADIUS = 800;
/** Values per rival in the saved record. */
const REC = 10;
/** Values per rival in records saved without the route position (the `rec` field is missing). */
const REC_SHORT = 6;

/** Songthaews: locals ride for ฿30 a head (economics.md §3), tourists lean towards tuk-tuks [pacing]. */
const SONGTHAEW_PREF: Partial<Record<Archetype, number>> = {
  vendor: 2,
  student: 2,
  elder: 2,
  monk: 1.6,
  thai_tourist: 1.2,
  backpacker: 1,
  retiree: 0.9,
  nomad: 0.8,
  tourist_west: 0.5,
  tourist_cn: 0.6,
  tourist_kr: 0.6,
  business: 0.4,
};
const TUKTUK_PREF: Partial<Record<Archetype, number>> = {
  vendor: 0.4,
  student: 0.5,
  elder: 0.5,
  monk: 0.3,
  thai_tourist: 1,
  backpacker: 1.2,
  retiree: 1,
  nomad: 1,
  tourist_west: 1.3,
  tourist_cn: 1.3,
  tourist_kr: 1.3,
  business: 1,
};

/**
 * Busy spots rivals drive between, with a weight. Songthaews work the moat–Nimman–Night Bazaar triangle and the
 * airport (economics.md §3); the terminals and markets are where for-hire traffic gathers (economics.md §9).
 */
const HUBS: [id: string, weight: number][] = [
  ['tha_phae_gate', 5],
  ['warorot_market', 4],
  ['night_bazaar', 4],
  ['chiang_mai_gate', 3],
  ['maya', 4],
  ['one_nimman', 2],
  ['chang_phueak_bus', 3],
  ['arcade_2', 3],
  ['cnx_airport', 3],
  ['central_airport', 2],
  ['railway_station', 2],
  ['cmu_main_gate', 3],
  ['central_festival', 2],
  ['wat_phra_singh', 2],
  ['three_kings', 1.5],
  ['maharaj_hospital', 2],
  ['chang_phueak_gate', 2],
  ['suan_dok_gate', 1.5],
  ['somphet_market', 2],
  ['muang_mai_market', 2],
  ['nawarat_bridge', 1.5],
  ['kad_na_mor', 1],
  ['think_park', 1],
  ['promenada', 1],
];

/** Chance that a rival passing a waiting passenger picks them up on one check. */
export function takeChance(kind: RivalKind, req: RideRequest, time: number): number {
  const k = RIVAL_KINDS.indexOf(kind);
  if (!COMPETES[k]) return 0;
  const patience = Math.max(60, req.expiresAt - req.spawnedAt);
  const waited = Math.max(0, Math.min(1, (time - req.spawnedAt) / patience));
  // Fresh hails often wave a songthaew past; someone who has waited ages takes whatever stops.
  const wait = 0.35 + 1.3 * waited;
  // Lean months leave more empty songthaews hunting for fares.
  const season = Math.max(0.6, Math.min(1.4, 2 - SEASON_INDEX[calendar(time).month]));
  const pref = (kind === 'songthaew' ? SONGTHAEW_PREF : TUKTUK_PREF)[req.archetype] ?? 1;
  return Math.min(0.9, TAKE_BASE[k] * wait * season * pref);
}

/**
 * [pacing] How many rivals are on the road: 22 in Nov 2026, one more each month up to 40, eight more during
 * festivals, and about half as many late at night.
 */
export function rivalTarget(time: number): number {
  const cal = calendar(time);
  const months = Math.max(0, (cal.year - 2026) * 12 + cal.month - 10);
  let n = 22 + Math.min(16, months);
  if (isFestivalTime(time)) n += 8;
  if (cal.hour < 5 || cal.hour >= 23.5) n *= 0.55;
  return Math.max(12, Math.min(MAX_RIVALS, Math.round(n)));
}

interface RivalsState {
  /**
   * Flat records of `rec` values: kind, from hub, to hub, metres along the leg,
   * pause-until time, carrying-until time, then the route position (arc index
   * on the leg, or -1 while the leg is unplanned, and metres along that arc)
   * and where the rival waits between legs (arc or -1, metres along it).
   */
  fleet: number[];
  /** Values per record in `fleet`. */
  rec: number;
  rng: number;
  /** Street hails taken by rivals, all time and today. */
  taken: number;
  takenToday: number;
  day: number;
  lastNotice: number;
  /** Game seconds since the last competition check. */
  sinceCompete: number;
  /** Minute of the last rival-count check (-1 before the first), and the count wanted then. */
  targetMinute: number;
  target: number;
}

export function rivalsState(game: Game): RivalsState {
  const raw = (game.state.systems.rivals ?? {}) as Partial<RivalsState>;
  const s: RivalsState = {
    fleet: Array.isArray(raw.fleet) ? raw.fleet : [],
    rec: raw.rec ?? REC_SHORT,
    rng: raw.rng ?? (game.state.seed ^ 0x51d7a1) >>> 0,
    taken: raw.taken ?? 0,
    takenToday: raw.takenToday ?? 0,
    day: raw.day ?? -1,
    lastNotice: raw.lastNotice ?? -Infinity,
    sinceCompete: raw.sinceCompete ?? 0,
    targetMinute: raw.targetMinute ?? -1,
    target: raw.target ?? 0,
  };
  game.state.systems.rivals = s;
  return s;
}

export class RivalsSystem implements GameSystem {
  readonly id = 'rivals';
  count = 0;
  readonly kind = new Uint8Array(MAX_RIVALS);
  readonly from = new Int16Array(MAX_RIVALS);
  readonly to = new Int16Array(MAX_RIVALS);
  readonly routes: (Route | null)[] = new Array(MAX_RIVALS).fill(null);
  /** Index into the route's arcs of the arc the rival is on. */
  readonly idx = new Int32Array(MAX_RIVALS);
  /** Metres along the current arc. */
  readonly s = new Float64Array(MAX_RIVALS);
  /** Metres along the whole leg (saved). */
  readonly along = new Float64Array(MAX_RIVALS);
  readonly pauseUntil = new Float64Array(MAX_RIVALS);
  /** A rival carrying a passenger until this time (drawn with a passenger; tuk-tuks cannot take another). */
  readonly busyUntil = new Float64Array(MAX_RIVALS);
  /** Where a rival waits between legs (end of its last leg), or -1. */
  readonly parkArc = new Int32Array(MAX_RIVALS).fill(-1);
  readonly parkS = new Float64Array(MAX_RIVALS);
  hubNodes: number[] = [];
  private hubWeights: number[] = [];
  private hubNext: Float64Array[] = [];
  private cache = new Map<number, Route | null>();
  private cachePenalty: unknown = undefined;
  private rng = new Rng(1);
  private sinceCompete = 0;
  private lastTargetMinute = -1;
  private target = 0;
  private readonly pose: Pose = { x: 0, y: 0, heading: 0 };
  private readonly taken: number[] = [];

  init(game: Game): void {
    const st = rivalsState(game);
    this.rng = new Rng(st.rng);
    const world = game.world;
    const hubs = HUBS.map(([id, w]) => [world.landmarks.find((l) => l.id === id), w] as const).filter(([p]) => !!p);
    this.hubNodes = hubs.map(([p]) => p!.node);
    this.hubWeights = hubs.map(([, w]) => w);
    // Next-hub weights: busy hubs 1.5–6 km away are favourite legs.
    this.hubNext = hubs.map(([a]) =>
      Float64Array.from(
        hubs.map(([b, w]) => {
          if (a === b) return 0;
          const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
          return w * (d < 1_000 ? 0.3 : d > 7_000 ? 0.25 : 1);
        }),
      ),
    );
    this.count = 0;
    this.sinceCompete = st.sinceCompete;
    this.lastTargetMinute = st.targetMinute;
    this.target = st.target;
    const f = st.fleet;
    const rec = st.rec >= REC ? st.rec : REC_SHORT;
    const graph = world.graph;
    const arcCount = graph.edges.length * 2;
    for (let r = 0; r + rec <= f.length && this.count < MAX_RIVALS; r += rec) {
      const i = this.count++;
      this.kind[i] = Math.min(RIVAL_KINDS.length - 1, Math.max(0, f[r] | 0));
      this.from[i] = Math.min(f[r + 1], this.hubNodes.length - 1);
      this.to[i] = Math.min(f[r + 2], this.hubNodes.length - 1);
      this.along[i] = f[r + 3];
      this.pauseUntil[i] = f[r + 4];
      this.busyUntil[i] = f[r + 5];
      this.routes[i] = null;
      const park = rec >= REC ? f[r + 8] : -1;
      this.parkArc[i] = park >= 0 && park < arcCount ? park : -1;
      this.parkS[i] = rec >= REC ? f[r + 9] : 0;
      // A leg that was under way when saved carries on from the same arc and metre.
      const at = rec >= REC ? f[r + 6] : -1;
      if (at >= 0) this.resume(game, i, at, f[r + 7]);
    }
    if (!f.length) {
      const n = rivalTarget(game.state.time);
      for (let k = 0; k < n; k++) this.spawn(game, true);
    }
  }

  update(game: Game, dt: number): void {
    const st = game.state.systems.rivals as RivalsState;
    const time = game.state.time;
    const day = businessDay(time);
    if (day !== st.day) {
      st.day = day;
      st.takenToday = 0;
    }
    if (game.edgePenalty !== this.cachePenalty) {
      this.cachePenalty = game.edgePenalty;
      this.cache.clear();
    }
    const minute = Math.floor(time / 60);
    if (minute !== this.lastTargetMinute) {
      this.lastTargetMinute = minute;
      this.target = rivalTarget(time);
      if (this.count < this.target) this.spawn(game, false);
    }

    let budget = ROUTE_BUDGET;
    const graph = game.world.graph;
    for (let i = 0; i < this.count; i++) {
      let route = this.routes[i];
      if (!route) {
        // Every leg planned counts against the budget, cached or not, so a loaded game plans legs on the same steps.
        if (budget <= 0) continue;
        budget--;
        route = this.resolve(game, i);
        if (!route) continue;
      }
      if (time < this.pauseUntil[i]) continue;
      let dist = 0;
      {
        const arc = route.arcs[this.idx[i]];
        const edge = arc >> 1;
        let v = graph.speedOf(edge) * KIND_SPEED[this.kind[i]] * game.speedFactor(graph.edges[edge].cls);
        if (game.edgePenalty) v /= Math.min(MAX_EDGE_SLOWDOWN, Math.max(1, game.edgePenalty(edge)));
        dist = v * dt;
      }
      this.along[i] += dist;
      while (dist > 0) {
        const len = graph.arcLen(route.arcs[this.idx[i]]);
        if (this.s[i] + dist < len) {
          this.s[i] += dist;
          dist = 0;
        } else if (this.idx[i] + 1 < route.arcs.length) {
          dist -= len - this.s[i];
          this.idx[i]++;
          this.s[i] = 0;
        } else {
          // A removed rival's slot now holds the last rival, which has not moved yet this step.
          if (this.arrive(game, i)) i--;
          break;
        }
      }
    }

    this.sinceCompete += dt;
    if (this.sinceCompete >= COMPETE_INTERVAL) {
      this.sinceCompete = 0;
      this.compete(game);
    }
    this.save(st);
  }

  /** Map pose of rival i: on its route, parked where its last leg ended, or null before its first route. */
  poseOf(game: Game, i: number, out: Pose): Pose | null {
    const route = this.routes[i];
    if (route) return game.world.graph.poseAt(route.arcs[this.idx[i]], this.s[i], out);
    return this.parkArc[i] >= 0 ? game.world.graph.poseAt(this.parkArc[i], this.parkS[i], out) : null;
  }

  /** Let every competing rival near a waiting passenger try to take them. */
  compete(game: Game): void {
    const requests = game.state.requests;
    if (!requests.length) return;
    const time = game.state.time;
    const places = game.world.places;
    const r2 = TAKE_RADIUS * TAKE_RADIUS;
    this.taken.length = 0;
    for (let i = 0; i < this.count; i++) {
      const k = this.kind[i];
      if (!COMPETES[k]) continue;
      const pose = this.poseOf(game, i, this.pose);
      if (!pose) continue;
      for (const req of requests) {
        if (req.channel !== 'street' || req.claimedBy !== null) continue;
        const p = places[req.from];
        const dx = p.x - pose.x;
        const dy = p.y - pose.y;
        if (dx * dx + dy * dy > r2) continue;
        if (RIVAL_KINDS[k] === 'tuktuk' && (time < this.busyUntil[i] || req.party > 3)) continue;
        if (this.taken.includes(req.id)) continue;
        if (!this.rng.chance(takeChance(RIVAL_KINDS[k], req, time))) continue;
        this.taken.push(req.id);
        this.pauseUntil[i] = Math.max(this.pauseUntil[i], time + (k === 0 ? 40 : 25));
        this.busyUntil[i] = time + 12 * 60;
        this.onTaken(game, k, req);
        if (RIVAL_KINDS[k] === 'tuktuk') break;
      }
    }
    if (this.taken.length) game.state.requests = requests.filter((r) => !this.taken.includes(r.id));
  }

  private onTaken(game: Game, k: number, req: RideRequest): void {
    const st = game.state.systems.rivals as RivalsState;
    st.taken++;
    st.takenToday++;
    const time = game.state.time;
    if (time - st.lastNotice < NOTICE_GAP || game.state.autopilot) return;
    // Only tell the player about passengers they could have had: close to their idle or cruising tuk-tuk.
    const v = game.playerVehicle();
    if (!v || inRide(v) || v.task.kind === 'broken') return;
    const place = game.world.places[req.from];
    const pose = game.vehiclePose(v);
    if (Math.hypot(place.x - pose.x, place.y - pose.y) > NOTICE_RADIUS) return;
    st.lastNotice = time;
    const who = RIVAL_KINDS[k] === 'songthaew' ? '🚐 A red songthaew' : '🛺 A rival tuk-tuk';
    const why = RIVAL_KINDS[k] === 'songthaew' ? ' — ฿30 a head is hard to beat.' : '. Be quicker next time!';
    game.notify(`${who} picked up the passenger waiting at ${place.name}${why}`, 'bad', place.x, place.y);
  }

  private key(i: number): number {
    return this.from[i] * 1024 + this.to[i];
  }

  /** Plan rival i's current leg and put it at a saved arc index and metre, if they still fit the route. */
  private resume(game: Game, i: number, idx: number, s: number): void {
    const route = this.resolve(game, i);
    if (!route || idx >= route.arcs.length) return;
    this.idx[i] = idx;
    this.s[i] = Math.max(0, Math.min(s, game.world.graph.arcLen(route.arcs[idx])));
  }

  /** Find (or plan) rival i's route and place it `along` metres into it. */
  private resolve(game: Game, i: number): Route | null {
    const key = this.key(i);
    let route = this.cache.get(key);
    if (route === undefined) {
      route = this.from[i] === this.to[i] ? null : game.world.router.route(this.hubNodes[this.from[i]], this.hubNodes[this.to[i]]);
      if (route && route.arcs.length === 0) route = null;
      this.cache.set(key, route);
    }
    if (!route) {
      // Unreachable or degenerate leg: pick another destination.
      this.to[i] = this.pickNext(this.from[i]);
      this.along[i] = 0;
      return null;
    }
    this.routes[i] = route;
    let rest = Math.min(this.along[i], Math.max(0, route.length - 1));
    const graph = game.world.graph;
    let k = 0;
    while (k < route.arcs.length - 1 && rest >= graph.arcLen(route.arcs[k])) {
      rest -= graph.arcLen(route.arcs[k]);
      k++;
    }
    this.idx[i] = k;
    this.s[i] = Math.min(rest, graph.arcLen(route.arcs[k]));
    return route;
  }

  private pickNext(from: number): number {
    const w = this.hubNext[from];
    return w ? this.rng.weighted(w) : 0;
  }

  /** Rival i reached the end of its leg: start the next one, or leave the road. Returns true when removed. */
  private arrive(game: Game, i: number): boolean {
    if (this.count > this.target) {
      this.remove(i);
      return true;
    }
    const time = game.state.time;
    const route = this.routes[i];
    if (route) {
      this.parkArc[i] = route.arcs[route.arcs.length - 1];
      this.parkS[i] = game.world.graph.arcLen(this.parkArc[i]);
    }
    this.from[i] = this.to[i];
    this.to[i] = this.pickNext(this.from[i]);
    this.along[i] = 0;
    this.routes[i] = null;
    // Songthaews wait at the stand to fill up; others just turn around [pacing].
    const k = this.kind[i];
    this.pauseUntil[i] = time + (k === 0 ? this.rng.range(30, 150) : k === 1 ? this.rng.range(20, 90) : this.rng.range(0, 20));
    return false;
  }

  private remove(i: number): void {
    const last = --this.count;
    if (i !== last) {
      this.kind[i] = this.kind[last];
      this.from[i] = this.from[last];
      this.to[i] = this.to[last];
      this.routes[i] = this.routes[last];
      this.idx[i] = this.idx[last];
      this.s[i] = this.s[last];
      this.along[i] = this.along[last];
      this.pauseUntil[i] = this.pauseUntil[last];
      this.busyUntil[i] = this.busyUntil[last];
      this.parkArc[i] = this.parkArc[last];
      this.parkS[i] = this.parkS[last];
    }
    this.routes[last] = null;
    this.parkArc[last] = -1;
  }

  /** Add a rival at a hub; `scatter` starts it partway along its first leg (new games). */
  private spawn(game: Game, scatter: boolean): void {
    if (this.count >= MAX_RIVALS || !this.hubNodes.length) return;
    const i = this.count++;
    const r = this.rng.next();
    let k = 0;
    for (let acc = KIND_SHARE[0]; k < KIND_SHARE.length - 1 && r >= acc; ) acc += KIND_SHARE[++k];
    this.kind[i] = k;
    this.from[i] = this.rng.weighted(this.hubWeights);
    this.to[i] = this.pickNext(this.from[i]);
    this.along[i] = scatter ? this.rng.range(0, 4_000) : 0;
    this.pauseUntil[i] = scatter ? 0 : game.state.time + this.rng.range(0, 60);
    this.busyUntil[i] = 0;
    this.routes[i] = null;
    this.parkArc[i] = -1;
  }

  private save(st: RivalsState): void {
    const f = st.fleet;
    st.rec = REC;
    f.length = this.count * REC;
    for (let i = 0; i < this.count; i++) {
      const r = i * REC;
      f[r] = this.kind[i];
      f[r + 1] = this.from[i];
      f[r + 2] = this.to[i];
      f[r + 3] = this.along[i];
      f[r + 4] = this.pauseUntil[i];
      f[r + 5] = this.busyUntil[i];
      f[r + 6] = this.routes[i] ? this.idx[i] : -1;
      f[r + 7] = this.s[i];
      f[r + 8] = this.parkArc[i];
      f[r + 9] = this.parkS[i];
    }
    st.rng = this.rng.state;
    st.sinceCompete = this.sinceCompete;
    st.targetMinute = this.lastTargetMinute;
    st.target = this.target;
  }
}

/** The rivals system installed on a game, if any. */
export function rivalsOf(game: Game): RivalsSystem | undefined {
  return game.systems.find((s) => s.id === 'rivals') as RivalsSystem | undefined;
}
