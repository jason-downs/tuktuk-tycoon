// Balance harness: plays a whole business headlessly and checks the pacing of docs/design.md. A "sensible owner" run
// reports milestones in game days; the "typical player" run plays in real minutes at the speeds a player uses and
// asserts the pacing targets, the economics of hired drivers and the weight of goal rewards.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RANKS } from '../src/content/business';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { BALANCE } from '../src/sim/balance';
import {
  activeDepots,
  currentRank,
  depotCheck,
  depotSites,
  hotelSites,
  isActive,
  netWorth,
  openDepot,
  ownedCount,
  partnerHotel,
  serviceCheck,
  startService,
} from '../src/sim/business';
import { BASE_TIME_SCALE, DAY, HOUR } from '../src/sim/clock';
import type { TripResult } from '../src/sim/dispatch';
import { DRIVE_TIME_SCALE } from '../src/sim/driveClock';
import { businessDay } from '../src/sim/economy';
import {
  FLEET,
  buyVehicle,
  fleetState,
  freeVehicles,
  hireCandidate,
  hiredDrivers,
  isResting,
  leaseOf,
  leaseTerms,
  rentedFrom,
  rentVehicle,
  upkeepPerDay,
  whyCantRent,
} from '../src/sim/fleet';
import { installUpgrade } from '../src/sim/garage';
import type { GraphJSON } from '../src/sim/graph';
import { Game } from '../src/sim/game';
import { installSystems } from '../src/sim/systems';
import type { Driver, Vehicle } from '../src/sim/types';
import { VEHICLE_MODELS } from '../src/content/vehicles';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));

interface Milestone {
  label: string;
  day: number;
}

/**
 * A plain owner: autopilot on, cheap upgrades first, rent and hire while tuk-tuks can be rented, then buy, up to
 * `maxFleet` tuk-tuks. With `services`, the owner also signs up to company services as they become affordable.
 */
function playBusiness(days: number, seed: number, services = false, maxFleet = Infinity) {
  const game = Game.create(world, { seed });
  installSystems(game);
  game.state.autopilot = true;
  const miles: Milestone[] = [];
  const start = game.state.time;
  const mark = (label: string) => {
    if (!miles.some((m) => m.label === label)) miles.push({ label, day: (game.state.time - start) / DAY });
  };
  const daily: { day: number; cash: number; fleet: number; trips: number }[] = [];
  for (let t = 0; t < days * DAY; t += 4) {
    game.step(4);
    if (game.state.stats.trips >= 1) mark('first ride');
    if (t % HOUR !== 0) continue;
    const player = game.playerVehicle()!;
    if (game.state.cash > 1_500 && !player.upgrades.includes('malai')) installUpgrade(game, player, 'malai') && mark('first upgrade');
    if (game.state.cash > 4_000 && !player.upgrades.includes('phone_mount')) installUpgrade(game, player, 'phone_mount');
    if (game.state.cash > 6_000 && !player.upgrades.includes('cushions')) installUpgrade(game, player, 'cushions');
    // Hire when there is a tuk-tuk for them: rent one from Lung Daeng, or buy once rentals run out.
    const pool = fleetState(game).candidates;
    if (pool.length && game.state.cash > 3_000) {
      let seat = freeVehicles(game)[0];
      const room = game.state.vehicles.length < maxFleet;
      if (!seat && room && rentedFrom(game, 'lung_daeng') < FLEET.maxRented) seat = rentVehicle(game) ?? undefined!;
      if (!seat && room && !whyCantRent(game, 'owner')) seat = rentVehicle(game, 'owner') ?? undefined!;
      if (!seat && room && game.state.cash > 90_000) seat = buyVehicle(game, 'lpg_used', 'lease') ?? undefined!;
      if (seat) {
        const d = hireCandidate(game, pool[0].roster, 'salary', seat.id);
        if (d) mark(hiredDrivers(game).length === 1 ? 'first hire' : `${hiredDrivers(game).length} drivers`);
      }
    }
    if (services && game.state.cash > 20_000) {
      for (const id of ['app', 'radio', 'flyers', 'social_ads', 'concierge', 'tour_temples', 'airport']) {
        if (!isActive(game, id) && serviceCheck(game, id).ok && game.state.cash > 20_000) startService(game, id).ok && mark(`service ${id}`);
      }
      const hotel = hotelSites(game.world)[0];
      if (hotel && game.state.cash > 60_000) partnerHotel(game, hotel.place.id).ok && mark('hotel partner');
    }
    if (game.state.vehicles.some((v) => v.ownership !== 'rented')) mark('owns a tuk-tuk');
    if (game.state.vehicles.length >= 5) mark('5 tuk-tuks');
    if (game.state.vehicles.length >= 10) mark('10 tuk-tuks');
    if (game.state.vehicles.length >= 15) mark('15 tuk-tuks');
    if (t % DAY === 0) daily.push({ day: t / DAY, cash: Math.round(game.state.cash), fleet: game.state.vehicles.length, trips: game.state.stats.trips });
  }
  return { game, miles, daily };
}

// ------------------------------------------------------------ typical player
/** Speed a typical player manages at once drivers join: the middle of the 2–4× docs/design.md plans for. */
const MANAGE_SPEED = 3;
/** Cash the typical player keeps back when paying a hire-purchase deposit. */
const CUSHION = 10_000;
/** Model the typical player buys on hire-purchase. */
const BUY_MODEL = 'lpg_used';
/** Game seconds between the typical player's looks at the business. */
const LOOK_EVERY = 60;

/** One tuk-tuk's business day with a hired driver at the wheel. */
interface HiredDay {
  shift: Driver['shift'];
  ownership: Vehicle['ownership'];
  trips: number;
  /** Fares the company kept (after commission) less the driver's salary, fuel, rent, upkeep and any instalment. */
  net: number;
  /** The day's hire-purchase instalment (0 unless leased). */
  instalment: number;
  /** Sent home exhausted at some point in the day. */
  exhausted: boolean;
}

interface VehicleTally {
  driverId: number | null;
  shift: Driver['shift'] | null;
  ownership: Vehicle['ownership'];
  trips: number;
  take: number;
  km0: number;
  exhausted: boolean;
  /** On the road since the business day opened. */
  whole: boolean;
}

/**
 * The typical player: hand-drives (DRIVE_TIME_SCALE game seconds per real second) until drivers will join, then
 * manages at MANAGE_SPEED with their own tuk-tuk on autopilot. They hire into a free, rented or (once rentals run out)
 * hire-purchase tuk-tuk whenever an applicant is waiting, sign up for services as cash allows, partner a hotel, open a
 * depot per ten tuk-tuks, and save up instead of buying when net worth is all that stands between them and the next
 * rank. Milestones are in real minutes.
 */
function playTypical(seed: number, realMinutes: number) {
  const game = Game.create(world, { seed });
  installSystems(game);
  game.state.autopilot = true;
  const buyAt = leaseTerms(VEHICLE_MODELS[BUY_MODEL].price).down + CUSHION;
  let real = 0;
  const miles = new Map<string, number>();
  const mark = (label: string) => {
    if (!miles.has(label)) miles.set(label, real / 60);
  };
  const fleetAt = new Map<number, number>();

  // Per-vehicle tallies for the business day in progress, closed into HiredDay rows and company shares at 04:00.
  let tallies = new Map<number, VehicleTally>();
  const hiredDays: HiredDay[] = [];
  const shares: { fleet: number; player: number; total: number }[] = [];
  const tally = (v: Vehicle, whole = false): VehicleTally => {
    let t = tallies.get(v.id);
    if (!t) {
      const d = v.driverId !== null ? game.driver(v.driverId) : undefined;
      const shift = d && !d.isPlayer ? d.shift : null;
      t = { driverId: d?.id ?? null, shift, ownership: v.ownership, trips: 0, take: 0, km0: v.odometer, exhausted: false, whole };
      tallies.set(v.id, t);
    }
    return t;
  };
  const openDay = () => {
    tallies = new Map();
    for (const v of game.state.vehicles) tally(v, true);
  };
  const closeDay = () => {
    const player = game.playerVehicle();
    let playerTake = 0;
    let total = 0;
    for (const [id, t] of tallies) {
      total += t.take;
      if (player && id === player.id) playerTake += t.take;
      const v = game.vehicle(id);
      const d = t.driverId !== null ? game.driver(t.driverId) : undefined;
      // Whole days of one hired driver in one tuk-tuk only.
      if (!t.whole || !v || !d || d.isPlayer || t.shift === null || v.driverId !== d.id || v.ownership !== t.ownership) continue;
      const fuel = (v.odometer - t.km0) * BALANCE.fuel.lpgPerKm;
      const rent = v.ownership === 'rented' ? v.rentPerDay : 0;
      const upkeep = v.ownership === 'rented' ? 0 : upkeepPerDay(v.model);
      const instalment = leaseOf(game, v)?.instalment ?? 0;
      const net = t.take - d.dailyPay - fuel - rent - upkeep - instalment;
      hiredDays.push({ shift: t.shift, ownership: v.ownership, trips: t.trips, net, instalment, exhausted: t.exhausted });
    }
    shares.push({ fleet: game.state.vehicles.length, player: playerTake, total });
  };
  game.on('trip', (r: TripResult) => {
    const v = game.vehicle(r.vehicleId);
    if (!v) return;
    const t = tally(v);
    t.trips++;
    t.take += r.companyTake;
  });
  openDay();
  let day = businessDay(game.state.time);

  while (real < realMinutes * 60) {
    const managing = game.state.stats.trips >= FLEET.ridesBeforeHiring;
    for (let s = 0; s < LOOK_EVERY; s += 4) game.step(4);
    real += LOOK_EVERY / (managing ? MANAGE_SPEED * BASE_TIME_SCALE : DRIVE_TIME_SCALE);
    for (const d of hiredDrivers(game)) {
      const v = d.vehicleId !== null ? game.vehicle(d.vehicleId) : undefined;
      if (v && isResting(game, d)) tally(v).exhausted = true;
    }
    if (businessDay(game.state.time) !== day) {
      closeDay();
      openDay();
      day = businessDay(game.state.time);
    }

    if (game.state.stats.trips >= 1) mark('first ride');
    const player = game.playerVehicle()!;
    if (game.state.cash > 1_500 && !player.upgrades.includes('malai')) installUpgrade(game, player, 'malai');
    const pool = fleetState(game).candidates;
    if (pool.length && game.state.cash > 3_000) {
      const next = RANKS[currentRank(game) + 1];
      const saving = !!next && game.state.vehicles.length >= next.minFleet && ownedCount(game) >= next.minOwned && netWorth(game) < next.minNetWorth;
      let seat: Vehicle | null = freeVehicles(game)[0] ?? null;
      if (!seat && rentedFrom(game, 'lung_daeng') < FLEET.maxRented) seat = rentVehicle(game);
      if (!seat && !whyCantRent(game, 'owner')) seat = rentVehicle(game, 'owner');
      if (!seat && !saving && game.state.cash > buyAt) seat = buyVehicle(game, BUY_MODEL, 'lease');
      if (seat && hireCandidate(game, pool[0].roster, 'salary', seat.id)) mark('first hire');
    }
    if (game.state.cash > 20_000) {
      for (const id of ['app', 'radio', 'flyers', 'social_ads', 'concierge', 'tour_temples', 'tour_food', 'airport']) {
        if (!isActive(game, id) && serviceCheck(game, id).ok && game.state.cash > 20_000) startService(game, id);
      }
      const hotel = hotelSites(game.world)[0];
      if (hotel && game.state.cash > 60_000) partnerHotel(game, hotel.place.id).ok && mark('hotel');
    }
    if (game.state.cash > 80_000 && activeDepots(game).length < Math.floor(game.state.vehicles.length / 10)) {
      const site = depotSites(game.world).find((s) => depotCheck(game, s.zone.id).ok);
      if (site && openDepot(game, site.zone.id).ok) mark('depot');
    }
    if (ownedCount(game) > 0) mark('first owned');
    for (const n of [5, 10, 20, 30]) if (game.state.vehicles.length >= n) mark(`${n} tuk-tuks`);
    for (const m of [60, 120, 180, 240, 300]) if (real >= m * 60 && !fleetAt.has(m)) fleetAt.set(m, game.state.vehicles.length);
  }
  const at = (label: string) => miles.get(label) ?? Infinity;
  /** The player's share of the company's takings on the first whole business day run with at least `n` tuk-tuks. */
  const playerShare = (n: number) => {
    const i = shares.findIndex((s) => s.fleet >= n);
    const s = i >= 0 ? shares[i + 1] : undefined;
    return s && s.total > 0 ? s.player / s.total : NaN;
  };
  return { game, miles, at, fleetAt, hiredDays, playerShare };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('balance harness', () => {
  it('reaches the pacing milestones in a sensible order and time', () => {
    const { game, miles, daily } = playBusiness(12, 11);
    // Real minutes: a game day is DAY / (BASE_TIME_SCALE × speed) seconds; drive mode runs slower by hand.
    const realMin = (day: number, speed: number) => (day * DAY) / (BASE_TIME_SCALE * speed) / 60;
    console.log('milestones (game day → real min at 1× / 4×):');
    for (const m of miles) console.log(`  ${m.label.padEnd(16)} day ${m.day.toFixed(2)} → ${realMin(m.day, 1).toFixed(0)} min / ${realMin(m.day, 4).toFixed(0)} min`);
    console.log('daily:', daily.map((d) => `d${d.day}:฿${d.cash} f${d.fleet} t${d.trips}`).join(' '));
    const at = (label: string) => miles.find((m) => m.label === label)?.day ?? Infinity;
    expect(at('first ride')).toBeLessThan(0.05);
    expect(at('first upgrade')).toBeLessThan(at('first hire'));
    expect(at('first hire')).toBeLessThan(3);
    expect(game.state.vehicles.length).toBeGreaterThanOrEqual(3);
    expect(Number.isFinite(game.state.cash)).toBe(true);
  }, 600_000);

  it('company services lift what a fleet takes in a day', () => {
    // Fleets grow with cash and services cost cash, so both owners stop at the same fleet size. Hired drivers are busy
    // for their whole shift, so bookings mostly take the place of street hails: the lift is a few percent.
    const fleet = 12;
    const plain = playBusiness(11, 12, false, fleet);
    const smart = playBusiness(11, 12, true, fleet);
    /** Trips and fares a day over the last three whole business days, all run with the full fleet. */
    const late = (r: ReturnType<typeof playBusiness>) => {
      const d = r.daily.slice(-4);
      expect(d[0].fleet).toBe(fleet);
      const books = r.game.state.books.slice(-4, -1);
      const fares = books.reduce((sum, b) => sum + (b.income.fares ?? 0) + (b.income.tips ?? 0), 0) / books.length;
      return { trips: (d[3].trips - d[0].trips) / 3, fares };
    };
    const a = late(plain);
    const b = late(smart);
    console.log('services milestones:', smart.miles.filter((m) => m.label.startsWith('service') || m.label === 'hotel partner').map((m) => `${m.label}@d${m.day.toFixed(1)}`).join(' '));
    console.log(`late days with ${fleet} tuk-tuks: plain ${a.trips.toFixed(0)} trips ฿${a.fares.toFixed(0)} vs services ${b.trips.toFixed(0)} trips ฿${b.fares.toFixed(0)}`);
    expect(b.fares).toBeGreaterThan(a.fares);
    expect(b.trips).toBeGreaterThan(a.trips);
  }, 900_000);
});

describe('typical player', () => {
  // docs/design.md "Pacing targets", in real minutes. The fifth tuk-tuk is the first one bought: owners rent a lone
  // Driver only one tuk-tuk, so three of Lung Daeng's and one owner's make four.
  for (const seed of [11, 12]) {
    it(`seed ${seed}: hits the pacing targets, and hired drivers pay their way`, () => {
      const run = playTypical(seed, 180);
      const { at, hiredDays } = run;
      const game = run.game;
      console.log(`typical player, seed ${seed}: ` + [...run.miles].map(([k, v]) => `${k} ${v.toFixed(0)}m`).join(' · '));
      console.log(`  fleet at ${[...run.fleetAt].map(([m, n]) => `${m}m: ${n}`).join(', ')}`);

      expect(at('first ride')).toBeGreaterThan(1);
      expect(at('first ride')).toBeLessThan(6);
      expect(at('first hire')).toBeGreaterThanOrEqual(10);
      expect(at('first hire')).toBeLessThanOrEqual(22);
      expect(at('first owned')).toBeGreaterThanOrEqual(25);
      expect(at('first owned')).toBeLessThanOrEqual(48);
      expect(at('5 tuk-tuks')).toBeGreaterThanOrEqual(at('first owned'));
      expect(at('5 tuk-tuks')).toBeLessThanOrEqual(75);
      expect(at('20 tuk-tuks')).toBeGreaterThanOrEqual(110);
      expect(at('20 tuk-tuks')).toBeLessThanOrEqual(185);
      // Depots and contracts are in play by then, and the fleet keeps growing past 20.
      expect(at('depot')).toBeLessThanOrEqual(185);
      expect(isActive(game, 'airport')).toBe(true);
      expect(run.fleetAt.get(180)).toBeGreaterThanOrEqual(24);

      // A day-shift driver works the whole shift without being sent home exhausted, and each hired tuk-tuk pays its
      // way: rented, on hire-purchase, and more once paid off.
      const day = hiredDays.filter((d) => d.shift === 'day');
      const rented = day.filter((d) => d.ownership === 'rented');
      const leased = day.filter((d) => d.ownership === 'leased');
      const tripsPerDay = mean(day.map((d) => d.trips));
      console.log(
        `  hired day shift: ${tripsPerDay.toFixed(1)} trips/day, exhausted on ${day.filter((d) => d.exhausted).length}/${day.length} days; ` +
          `net/day rented ฿${mean(rented.map((d) => d.net)).toFixed(0)}, hire-purchase ฿${mean(leased.map((d) => d.net)).toFixed(0)}, ` +
          `paid off ฿${mean(leased.map((d) => d.net + d.instalment)).toFixed(0)}`,
      );
      expect(day.length).toBeGreaterThan(50);
      expect(tripsPerDay).toBeGreaterThan(30);
      expect(tripsPerDay).toBeLessThan(70);
      expect(day.filter((d) => d.exhausted).length / day.length).toBeLessThan(0.05);
      expect(mean(rented.map((d) => d.net))).toBeGreaterThan(1_500);
      expect(mean(leased.map((d) => d.net))).toBeGreaterThan(500);

      // The player's own tuk-tuk stops carrying the company once a handful of hired ones are on the road.
      console.log(`  player's share of company takings: ${[5, 10, 20].map((n) => `${n} tuk-tuks ${(run.playerShare(n) * 100).toFixed(0)}%`).join(', ')}`);
      expect(run.playerShare(5)).toBeLessThan(0.5);
      expect(run.playerShare(10)).toBeLessThan(0.3);

      // Goal rewards help, but no business day earns more from rewards than from fares.
      for (const b of game.state.books) expect(b.income.other ?? 0).toBeLessThan((b.income.fares ?? 0) + (b.income.tips ?? 0));
    }, 900_000);
  }
});
