import { VEHICLE_UPGRADES } from '../content/upgrades';
import { VEHICLE_MODELS } from '../content/vehicles';
import type { World } from '../data/world';
import { FleetAI } from './ai';
import { BALANCE } from './balance';
import { BASE_TIME_SCALE, HOUR, SPEED_STEPS, calendar, type CalendarInfo } from './clock';
import { DemandSystem, originWeight, type DemandModifier } from './demand';
import { abandonRequest, claimRequest, findRequest, fitsParty, inRide, partyTooBigText, quote, releaseClaim, startTrip, type QuoteOutcome } from './dispatch';
import { EconomySystem } from './economy';
import type { Pose } from './graph';
import { CLIMB_BLOCKED_TEXT, climbBlocked } from './mountain';
import { sendTo } from './movement';
import { OffmapSystem } from './offmap';
import { Rng } from './rng';
import type { Driver, GameState, Notice, Place, RideRequest, Trip, Vehicle } from './types';
import { VehicleSystem } from './vehicles';

/** Version 2: the central Chiang Mai map with portals (graph indices differ from version 1). */
export const SAVE_VERSION = 2;

/** A simulation subsystem stepped every tick (events, weather, business, …). */
export interface GameSystem {
  id: string;
  update(game: Game, dt: number): void;
  /** Called once after a game is created or loaded. */
  init?(game: Game): void;
}

export type SpeedModifier = (roadClass: number, cal: CalendarInfo) => number;
export type FareModifier = (origin: Place, cal: CalendarInfo) => number;
/** Added to a finished trip's 1–5 rating (paint jobs, events, weather…). */
export type RatingModifier = (vehicle: Vehicle, trip: Trip) => number;
/** Extra reasons a vehicle may notice a request (dispatch radio, hotel desks…); return true to reveal it. */
export type SightRule = (vehicle: Vehicle, req: RideRequest) => boolean;

type Listener = (payload: any) => void;

/** Largest slice of game time simulated in one step. */
const MAX_STEP = 4;
/** Start: the Tha Phae Gate rank, where Lung Daeng keeps his tuk-tuks. */
const START_LANDMARK = 'tha_phae_gate';
/** A drive-to point this close to an LPG pump (metres) means "go and fill up there". */
const PUMP_CLICK_M = 60;

export interface NewGameOptions {
  seed?: number;
  playerName?: string;
  companyName?: string;
}

export class Game {
  readonly world: World;
  state: GameState;
  rng: Rng;
  readonly demandModifiers: DemandModifier[] = [];
  readonly fareModifiers: FareModifier[] = [];
  readonly speedModifiers: SpeedModifier[] = [];
  readonly ratingModifiers: RatingModifier[] = [];
  /**
   * Upper bounds on a vehicle's speed right now, m/s (a red light ahead, a slow
   * car in front). The lowest applies; return Infinity for no limit.
   */
  readonly speedCaps: ((v: Vehicle) => number)[] = [];
  /**
   * Replaces the speed buttons' time scale while set (e.g. a slower clock while
   * the player steers by hand). Return null to use the speed buttons. Pauses
   * and the pause button still stop time.
   */
  clockOverride: ((g: Game) => number | null) | null = null;
  readonly sightRules: SightRule[] = [];
  /** Extra EV charging places (e.g. company depots) beyond the public mall chargers. */
  readonly extraChargers: (() => Place[])[] = [];
  /** Per-edge routing time multiplier (road closures); applied to the shared router each step. See Router.edgePenalty. */
  edgePenalty: ((edge: number) => number) | null = null;
  readonly systems: GameSystem[] = [];
  private readonly demand = new DemandSystem();
  private readonly vehicleSystem = new VehicleSystem();
  private readonly offmap = new OffmapSystem();
  private readonly ai = new FleetAI();
  private readonly economy = new EconomySystem();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly pauses = new Set<string>();
  private speedCache: { minute: number; factors: number[] } | null = null;
  private originBase = 0;

  constructor(world: World, state: GameState) {
    this.world = world;
    this.state = state;
    this.rng = new Rng(state.rngState);
  }

  static create(world: World, opts: NewGameOptions = {}): Game {
    const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    const state: GameState = {
      version: SAVE_VERSION,
      seed,
      rngState: seed,
      time: 6.5 * HOUR,
      speed: 2,
      autopilot: false,
      farePolicy: 1.1,
      cash: BALANCE.startCash,
      reputation: BALANCE.rating.start,
      ratings: [BALANCE.rating.start],
      companyName: opts.companyName ?? 'Lucky Tuk-Tuk',
      nextId: 1,
      vehicles: [],
      drivers: [],
      requests: [],
      hidden: [],
      books: [],
      notices: [],
      unlocks: [],
      goals: [],
      stats: { trips: 0, fares: 0, distance: 0, passengers: 0, bestFare: 0 },
      systems: {},
    };
    const game = new Game(world, state);
    const player: Driver = {
      id: game.nextId(),
      nickname: opts.playerName ?? 'You',
      fullName: opts.playerName ?? 'You',
      gender: 'M',
      hook: 'Humble beginnings at the Tha Phae Gate rank.',
      isPlayer: true,
      driving: 55,
      english: 40,
      charm: 55,
      honesty: 80,
      stamina: 70,
      morale: 80,
      fatigue: 0,
      payModel: 'salary',
      dailyPay: 0,
      commission: 0,
      vehicleId: null,
      shift: 'long',
      zone: null,
      hiredDay: 0,
      trips: 0,
      earnedToday: 0,
      lifetimeFares: 0,
      rating: BALANCE.rating.start,
    };
    state.drivers.push(player);
    const start = world.landmarks.find((l) => l.id === START_LANDMARK) ?? world.places[0];
    const vehicle = game.spawnVehicle('rusty', start.node, {
      name: 'Lung Daeng’s tuk-tuk',
      ownership: 'rented',
      rentPerDay: BALANCE.startRentPerDay,
      paint: 'nakhon_blue',
      condition: 62,
    });
    vehicle.driverId = player.id;
    player.vehicleId = vehicle.id;
    game.init();
    game.notify(`Sawatdee! You rent a tired tuk-tuk from Lung Daeng at Tha Phae Gate for ฿${BALANCE.startRentPerDay}/day. Find passengers and make your fortune.`, 'goal');
    return game;
  }

  static load(world: World, state: GameState): Game {
    const game = new Game(world, state);
    game.init();
    return game;
  }

  private init(): void {
    this.speedModifiers.push(rushHour);
    // Average hourly origin weight over a weekday, used to normalise demand.
    let total = 0;
    for (let h = 0; h < 24; h++) {
      const cal = calendar(2 * 86_400 + h * HOUR + 1800);
      for (const p of this.world.places) total += originWeight(this, p, cal);
    }
    this.originBase = total / 24;
    for (const s of this.systems) s.init?.(this);
  }

  /** Register an extra subsystem (events, weather, business…). */
  addSystem(system: GameSystem): void {
    this.systems.push(system);
    system.init?.(this);
  }

  // ------------------------------------------------------------- lifecycle
  nextId(): number {
    return this.state.nextId++;
  }

  get timeScale(): number {
    if (this.pauses.size || this.state.speed === 0) return 0;
    const override = this.clockOverride?.(this);
    if (override !== null && override !== undefined) return override;
    return SPEED_STEPS[this.state.speed] * BASE_TIME_SCALE;
  }

  pause(reason: string): void {
    this.pauses.add(reason);
    this.emit('pause', [...this.pauses]);
  }

  resume(reason: string): void {
    this.pauses.delete(reason);
    this.emit('pause', [...this.pauses]);
  }

  isPaused(reason?: string): boolean {
    return reason ? this.pauses.has(reason) : this.pauses.size > 0 || this.state.speed === 0;
  }

  setSpeed(step: number): void {
    this.state.speed = Math.max(0, Math.min(SPEED_STEPS.length - 1, step));
    this.emit('speed', this.state.speed);
  }

  /** Advance by a real-time interval (seconds). */
  update(realDt: number): void {
    let dt = Math.min(realDt, 0.25) * this.timeScale;
    while (dt > 0) {
      const step = Math.min(dt, MAX_STEP);
      this.step(step);
      dt -= step;
    }
    this.emit('frame', realDt);
  }

  /** Advance the simulation by dt game seconds. */
  step(dt: number): void {
    this.world.router.edgePenalty = this.edgePenalty;
    this.state.time += dt;
    this.demand.update(this, dt);
    this.vehicleSystem.update(this, dt);
    this.offmap.update(this);
    this.ai.update(this);
    for (const s of this.systems) s.update(this, dt);
    this.economy.update(this);
    this.state.rngState = this.rng.state;
  }

  serialize(): string {
    this.state.rngState = this.rng.state;
    return JSON.stringify(this.state);
  }

  // ---------------------------------------------------------------- events
  on(event: string, fn: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit(event: string, payload?: unknown): void {
    this.listeners.get(event)?.forEach((fn) => fn(payload));
  }

  notify(text: string, kind: Notice['kind'] = 'info', x?: number, y?: number): Notice {
    const n: Notice = { id: this.nextId(), time: this.state.time, text, kind, x, y };
    this.state.notices.push(n);
    if (this.state.notices.length > 60) this.state.notices.shift();
    this.emit('notice', n);
    return n;
  }

  // --------------------------------------------------------------- lookups
  driver(id: number): Driver | undefined {
    return this.state.drivers.find((d) => d.id === id);
  }

  vehicle(id: number): Vehicle | undefined {
    return this.state.vehicles.find((v) => v.id === id);
  }

  player(): Driver {
    return this.state.drivers.find((d) => d.isPlayer)!;
  }

  playerVehicle(): Vehicle | undefined {
    const p = this.player();
    return p.vehicleId !== null ? this.vehicle(p.vehicleId) : undefined;
  }

  vehiclePose(v: Vehicle, out?: Pose): Pose {
    return this.world.graph.poseAt(v.arc, v.s, out);
  }

  place(idx: number): Place {
    return this.world.places[idx];
  }

  /** Public chargers for EVs: the big malls (Central, Maya, Promenada…). */
  chargers(): Place[] {
    const extra = this.extraChargers.flatMap((f) => f());
    return [...this.world.places.filter((p) => p.cat === 'mall' && p.landmark && !p.offmap && p.id !== 'kad_suan_kaew'), ...extra];
  }

  baseOriginTotal(): number {
    return this.originBase || 1;
  }

  // -------------------------------------------------------------- modifiers
  /** Travel-speed multiplier for a road class right now (rush hour, events, weather). */
  speedFactor(roadClass: number): number {
    const minute = Math.floor(this.state.time / 60);
    if (!this.speedCache || this.speedCache.minute !== minute) {
      const cal = calendar(this.state.time);
      const factors = Array.from({ length: 8 }, (_, cls) => this.speedModifiers.reduce((f, m) => f * m(cls, cal), 1));
      this.speedCache = { minute, factors };
    }
    return this.speedCache.factors[roadClass] ?? 1;
  }

  upgradeSpeed(id: string): number {
    return VEHICLE_UPGRADES[id]?.speed ?? 1;
  }

  upgradeComfort(id: string): number {
    return VEHICLE_UPGRADES[id]?.comfort ?? 0;
  }

  upgradeReliability(id: string): number {
    return VEHICLE_UPGRADES[id]?.reliability ?? 1;
  }

  sightRadius(v: Vehicle): number {
    let r = BALANCE.demand.sightRadius;
    for (const up of v.upgrades) r *= VEHICLE_UPGRADES[up]?.sight ?? 1;
    return r;
  }

  /** Can this vehicle's driver see (or be told about) a waiting passenger? */
  canSee(v: Vehicle, req: RideRequest): boolean {
    if (req.channel !== 'street') return true;
    const from = this.world.places[req.from];
    const pose = this.vehiclePose(v);
    if (Math.hypot(from.x - pose.x, from.y - pose.y) <= this.sightRadius(v)) return true;
    return this.sightRules.some((rule) => rule(v, req));
  }

  /** Requests one vehicle's driver can see or has been told about. */
  visibleTo(v: Vehicle): RideRequest[] {
    const hidden = new Set(this.state.hidden);
    return this.state.requests.filter((r) => !hidden.has(r.id) && this.canSee(v, r));
  }

  /** Requests the player can see on the map: anything any fleet tuk-tuk can see. */
  visibleRequests(): RideRequest[] {
    const hidden = new Set(this.state.hidden);
    return this.state.requests.filter((r) => !hidden.has(r.id) && this.state.vehicles.some((v) => this.canSee(v, r)));
  }

  // ------------------------------------------------------- vehicles & trips
  spawnVehicle(
    model: string,
    node: number,
    opts: Partial<Pick<Vehicle, 'name' | 'ownership' | 'rentPerDay' | 'paint' | 'condition' | 'purchasePrice'>> = {},
  ): Vehicle {
    const graph = this.world.graph;
    const out = graph.outgoing(node);
    const arc = out.length ? out[0] : 0;
    const v: Vehicle = {
      id: this.nextId(),
      name: opts.name ?? `Tuk-tuk #${this.state.vehicles.length + 1}`,
      model,
      paint: opts.paint ?? 'nakhon_blue',
      upgrades: [],
      ownership: opts.ownership ?? 'owned',
      rentPerDay: opts.rentPerDay ?? 0,
      driverId: null,
      fuel: 1,
      condition: opts.condition ?? 100,
      odometer: 0,
      arc,
      s: 0,
      speed: 0,
      route: null,
      routeIdx: 0,
      task: { kind: 'idle' },
      busyUntil: 0,
      waitUntil: 0,
      purchasePrice: opts.purchasePrice ?? 0,
      boughtDay: Math.floor(this.state.time / 86_400),
    };
    this.state.vehicles.push(v);
    return v;
  }

  /** Player accepts a waiting passenger. */
  playerClaim(requestId: number): boolean {
    const v = this.playerVehicle();
    if (!v) return false;
    const kind = v.task.kind;
    if (kind === 'trip' || kind === 'away' || kind === 'broken') {
      this.notify(kind === 'trip' ? 'Finish your current trip first.' : kind === 'away' ? 'You’re out of town — back soon.' : 'Your tuk-tuk is off the road.', 'bad');
      return false;
    }
    const req = findRequest(this, requestId);
    if (req && climbBlocked(this, v, req)) {
      this.notify(CLIMB_BLOCKED_TEXT, 'bad');
      return false;
    }
    if (req && !fitsParty(v, req)) {
      this.notify(partyTooBigText(v, req), 'bad');
      return false;
    }
    if (!claimRequest(this, v, requestId)) {
      this.notify('Can’t reach that passenger.', 'bad');
      return false;
    }
    return true;
  }

  /** Player names a price at the kerb. */
  playerQuote(fare: number, countered: boolean): QuoteOutcome {
    const v = this.playerVehicle();
    if (!v) return { kind: 'leave', line: '' };
    return quote(this, v, fare, countered);
  }

  /** Player seals the deal at the given fare. */
  playerStartTrip(fare: number): void {
    const v = this.playerVehicle();
    if (v) startTrip(this, v, fare);
    this.resume('haggle');
  }

  /** Player lets the passenger go (or the passenger walked). */
  playerAbandon(): void {
    const v = this.playerVehicle();
    if (v) abandonRequest(this, v);
    this.resume('haggle');
  }

  playerRequest(): RideRequest | undefined {
    const v = this.playerVehicle();
    if (!v || (v.task.kind !== 'haggle' && v.task.kind !== 'pickup')) return undefined;
    return findRequest(this, v.task.requestId);
  }

  /** Drive the player's tuk-tuk to the road nearest a map point; at an LPG pump, fill up. */
  playerDriveTo(x: number, y: number): boolean {
    const v = this.playerVehicle();
    if (!v || inRide(v) || v.task.kind === 'broken') return false;
    const node = this.world.graph.nearestNode(x, y, 400);
    if (node < 0) return false;
    const lpg = VEHICLE_MODELS[v.model]?.powertrain !== 'ev';
    const pump = lpg ? this.world.lpgStations.find((p) => Math.hypot(p.x - x, p.y - y) < PUMP_CLICK_M) : undefined;
    releaseClaim(this, v);
    if (!sendTo(this, v, pump ? pump.node : node)) return false;
    v.task = pump ? { kind: 'refuel', place: pump.idx } : { kind: 'cruise', place: -1 };
    return true;
  }

  /** Send the player's tuk-tuk to the nearest LPG pump, or the nearest charger for an electric one. */
  playerRefuel(): boolean {
    const v = this.playerVehicle();
    if (!v || inRide(v) || v.task.kind === 'broken') return false;
    const pose = this.vehiclePose(v);
    const stations = VEHICLE_MODELS[v.model]?.powertrain === 'ev' ? this.chargers() : this.world.lpgStations;
    let best: Place | null = null;
    let bestD = Infinity;
    for (const p of stations) {
      const d = Math.hypot(p.x - pose.x, p.y - pose.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) return false;
    releaseClaim(this, v);
    if (!sendTo(this, v, best.node)) return false;
    v.task = { kind: 'refuel', place: best.idx };
    return true;
  }
}

/**
 * [research] calendar.md "Weekday rush": Mon–Fri 07:00–09:00 and 16:00–18:00,
 * speed ×0.6 on arterials; Saturday 11:00–15:00 crawl ×0.65. Side streets suffer less.
 */
export const rushHour: SpeedModifier = (cls, cal) => {
  const arterial = cls <= 3;
  const h = cal.hour;
  const weekday = cal.weekday >= 1 && cal.weekday <= 5;
  if (weekday && ((h >= 7 && h < 9) || (h >= 16 && h < 18.5))) return arterial ? 0.6 : 0.85;
  if (cal.weekday === 6 && h >= 11 && h < 15) return arterial ? 0.65 : 0.9;
  if (h >= 22 || h < 6) return 1.1;
  return 1;
};
