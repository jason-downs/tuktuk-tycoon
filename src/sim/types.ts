// Serializable game state. Everything reachable from GameState is plain JSON
// (numbers, strings, arrays, plain objects) so a save is JSON.stringify(state).
// Runtime-only helpers (road graph, router, RNG object) live on Game.

import type { Route } from './routing';

export type PlaceCategory =
  | 'gate'
  | 'temple'
  | 'market'
  | 'mall'
  | 'transport'
  | 'university'
  | 'school'
  | 'hospital'
  | 'nightlife'
  | 'attraction'
  | 'museum'
  | 'viewpoint'
  | 'park'
  | 'hotel'
  | 'hostel'
  | 'cafe'
  | 'restaurant'
  | 'shop'
  | 'fuel'
  | 'civic';

/** A named spot on the road network where rides start or end. */
export interface Place {
  /** Index in World.places. */
  idx: number;
  id: string;
  name: string;
  th?: string;
  cat: PlaceCategory;
  x: number;
  y: number;
  /** Graph node where tuk-tuks stop for this place. */
  node: number;
  /** Curated landmark from docs/research/landmarks.json. */
  landmark: boolean;
  /** Relative size as a ride generator/attractor (landmarks are large). */
  weight: number;
  notes?: string;
  lpg?: boolean;
  /** Out of town: reached through a portal at the edge of the play area. */
  offmap?: PlaceOffmap;
}

export interface PlaceOffmap {
  /** Index into World.portals. */
  portal: number;
  /** Road metres beyond the portal. */
  extraM: number;
  roundTrip: boolean;
  /** Game seconds the passenger spends there on a round trip. */
  waitS: number;
  /** Fixed round-trip fare, THB. */
  fare?: number;
}

export type Archetype =
  | 'backpacker'
  | 'tourist_cn'
  | 'tourist_kr'
  | 'tourist_west'
  | 'retiree'
  | 'nomad'
  | 'thai_tourist'
  | 'student'
  | 'vendor'
  | 'monk'
  | 'elder'
  | 'business';

export type RequestChannel = 'street' | 'app' | 'hotel' | 'regular';

export interface RideRequest {
  id: number;
  from: number; // place idx
  to: number; // place idx
  archetype: Archetype;
  party: number;
  channel: RequestChannel;
  spawnedAt: number;
  /** Game time when the passenger gives up (takes a songthaew or Grab). */
  expiresAt: number;
  /** Road distance estimate (metres) from origin to destination. */
  distance: number;
  /** The going street fare for this distance, THB. */
  fairFare: number;
  /** Fixed price for app/hotel bookings; null = negotiated on the street. */
  fixedFare: number | null;
  /** Highest multiple of fairFare this passenger will accept. */
  maxRatio: number;
  /** Line of dialogue shown when hailing. */
  line: string;
  /** Vehicle on its way to pick this passenger up. */
  claimedBy: number | null;
  /** Company service that booked this ride (sim/business.ts): 'app', 'flyers', 'concierge', 'airport', 'hotel:<place id>', 'tour:<tour id>'. */
  source?: string;
}

export type VehicleTask =
  | { kind: 'idle' }
  | { kind: 'pickup'; requestId: number }
  | { kind: 'haggle'; requestId: number }
  | { kind: 'trip'; trip: Trip }
  | { kind: 'refuel'; place: number }
  | { kind: 'cruise'; place: number }
  | { kind: 'depot' }
  /** Off the road until `until`: a breakdown, or planned workshop work when `work` names the job. */
  | { kind: 'broken'; until: number; work?: string }
  | { kind: 'offduty' }
  /** Out of town beyond a portal until `until`; `trip` is set on the way out and cleared for the drive back. */
  | { kind: 'away'; until: number; trip: Trip | null; portal: number };

export interface Trip {
  request: RideRequest;
  fare: number;
  /** Fare / fairFare — how hard the passenger was charged. */
  ratio: number;
  startedAt: number;
  /** Route distance at pickup, metres. */
  distance: number;
  /** On the way back into town from an out-of-town round trip. */
  returning?: boolean;
}

export interface Vehicle {
  id: number;
  name: string;
  model: string;
  paint: string;
  upgrades: string[];
  /** Who a rented vehicle belongs to: Lung Daeng (default) or an idle owner around town. */
  lessor?: 'lung_daeng' | 'owner';
  /** 'rented' vehicles cost rentPerDay and cannot be modified or sold. */
  ownership: 'owned' | 'rented' | 'leased';
  rentPerDay: number;
  driverId: number | null;
  /** 0–1 fraction of tank or battery. */
  fuel: number;
  /** 0–100; low condition raises breakdown risk. */
  condition: number;
  odometer: number;
  arc: number;
  s: number;
  speed: number;
  route: Route | null;
  /** Index into route.arcs of the arc the vehicle is on. */
  routeIdx: number;
  task: VehicleTask;
  /** Game time until which the vehicle is stationary (loading, haggling, refuelling). */
  busyUntil: number;
  /** An idle AI tuk-tuk waits at its rank until this time before cruising on. */
  waitUntil: number;
  purchasePrice: number;
  boughtDay: number;
}

export type PayModel = 'salary' | 'rent';

export interface Driver {
  id: number;
  nickname: string;
  fullName: string;
  gender: 'M' | 'F';
  hook: string;
  isPlayer: boolean;
  /** 0–100 skills. */
  driving: number;
  english: number;
  charm: number;
  honesty: number;
  stamina: number;
  morale: number;
  /** 0 fresh … 100 exhausted. */
  fatigue: number;
  payModel: PayModel;
  /** THB/day: salary paid to the driver, or rent the driver pays you. */
  dailyPay: number;
  /** Share of fares the driver keeps under the salary model (0–1). */
  commission: number;
  vehicleId: number | null;
  shift: 'day' | 'night' | 'long';
  /** Preferred zone id, or null for anywhere. */
  zone: string | null;
  hiredDay: number;
  trips: number;
  earnedToday: number;
  lifetimeFares: number;
  rating: number;
  /** Game time until which a tired driver stays off duty (set by the fleet system). */
  restUntil?: number;
}

export type LedgerCategory =
  | 'fares'
  | 'tips'
  | 'rent_income'
  | 'fuel'
  | 'rent'
  | 'wages'
  | 'commission'
  | 'maintenance'
  | 'vehicles'
  | 'upgrades'
  | 'business'
  | 'marketing'
  | 'loan'
  | 'fees'
  | 'other';

export interface DayBook {
  day: number;
  income: Partial<Record<LedgerCategory, number>>;
  expense: Partial<Record<LedgerCategory, number>>;
  trips: number;
  cashEnd: number;
}

export interface Notice {
  id: number;
  time: number;
  text: string;
  kind: 'info' | 'good' | 'bad' | 'event' | 'goal';
  x?: number;
  y?: number;
}

export interface GameState {
  version: number;
  seed: number;
  rngState: number;
  time: number;
  speed: number;
  /** The player's own tuk-tuk drives itself like a hired driver's. */
  autopilot: boolean;
  /** Company fare policy: quote multiple of the going rate for hired drivers. */
  farePolicy: number;
  cash: number;
  /** Customer rating 1–5 (rolling). */
  reputation: number;
  ratings: number[];
  companyName: string;
  nextId: number;
  vehicles: Vehicle[];
  drivers: Driver[];
  requests: RideRequest[];
  /** Request ids the player has dismissed from the map. */
  hidden: number[];
  books: DayBook[];
  notices: Notice[];
  /** Upgrade/feature ids the company has unlocked (business level, not per vehicle). */
  unlocks: string[];
  /** Completed goal ids. */
  goals: string[];
  stats: {
    trips: number;
    fares: number;
    distance: number;
    passengers: number;
    bestFare: number;
  };
  /** Free-form per-system state (events, weather, loans, contracts, …) keyed by system. */
  systems: Record<string, unknown>;
}
