import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AIRPORT_FARE, AIRPORT_LANDMARK, AIRPORT_MAX_TRIP, DEPOT, HOTEL_FARE_PREMIUM, LOAN, RANKS, RATES, SERVICE_BY_ID, TOUR_BY_ID } from '../src/content/business';
import { GOALS } from '../src/content/goals';
import { VEHICLE_MODELS } from '../src/content/vehicles';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { BALANCE, appFare, roundFare } from '../src/sim/balance';
import {
  activeDepots,
  businessOf,
  businessState,
  canClimb,
  closeDepot,
  creditLimit,
  depotSites,
  fleetValue,
  hotelSites,
  instalmentFor,
  netWorth,
  openDepot,
  partnerHotel,
  rankFor,
  repairDiscount,
  repayLoan,
  serviceCheck,
  startService,
  stopService,
  takeLoan,
  tourDwellText,
} from '../src/sim/business';
import { DAY, HOUR, calendar, timeOf } from '../src/sim/clock';
import { makeRequest } from '../src/sim/demand';
import { completeTrip, startTrip } from '../src/sim/dispatch';
import { businessDay, currentBook } from '../src/sim/economy';
import { Game } from '../src/sim/game';
import type { GraphJSON } from '../src/sim/graph';
import { installSystems } from '../src/sim/systems';
import type { DayBook, Driver, Place, RideRequest, Vehicle } from '../src/sim/types';
import { settledLines } from './helpers';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));
const landmark = (id: string): Place => world.landmarks.find((l) => l.id === id)!;

/** A new game at a given time with every optional system installed; goals are marked done so rewards stay out of the way. */
function gameAt(time = timeOf(2026, 10, 3, 9), seed = 11): Game {
  const game = Game.create(world, { seed });
  game.state.time = time;
  game.state.goals = GOALS.map((g) => g.id);
  installSystems(game);
  game.step(1);
  return game;
}

/** Add a tuk-tuk at a landmark, with a hired driver on the long shift unless `driver` is false. */
function addTukTuk(game: Game, model = 'ev_new', at = 'tha_phae_gate', ownership: Vehicle['ownership'] = 'owned', driver = true): Vehicle {
  const v = game.spawnVehicle(model, landmark(at).node, { ownership, purchasePrice: VEHICLE_MODELS[model].price });
  if (driver) {
    const d: Driver = {
      ...game.player(),
      id: game.nextId(),
      nickname: `Driver ${v.id}`,
      fullName: `Driver ${v.id}`,
      isPlayer: false,
      payModel: 'salary',
      dailyPay: 400,
      commission: 0.1,
      vehicleId: v.id,
      shift: 'long',
      trips: 0,
      earnedToday: 0,
      lifetimeFares: 0,
    };
    game.state.drivers.push(d);
    v.driverId = d.id;
  }
  return v;
}

/** Run the game to just past the next 04:00 rollover (billing happens there); returns what it booked to the day that closed. */
function nextRollover(game: Game): DayBook {
  const day = businessDay(game.state.time) + 1;
  game.state.time = day * DAY + 4 * HOUR - 1;
  return settledLines(game, () => game.step(2));
}

function setReputation(game: Game, rep: number): void {
  game.state.ratings = [rep];
  game.state.reputation = rep;
}

/** Enough fleet, owned tuk-tuks and net worth for the Fleet boss rank. */
function makeFleetBoss(game: Game): void {
  addTukTuk(game, 'ev_new');
  addTukTuk(game, 'lpg_used');
  game.state.cash = 200_000;
  game.step(60);
}

function bookings(game: Game, source: string | ((s: string) => boolean)): RideRequest[] {
  const test = typeof source === 'string' ? (s: string) => s === source : source;
  return game.state.requests.filter((r) => r.source !== undefined && test(r.source));
}

describe('business services', () => {
  it('charges unlock costs through the ledger and explains refusals', () => {
    const app = SERVICE_BY_ID.app;
    const baht = (v: number) => `฿${v.toLocaleString('en-US')}`;
    const game = gameAt();
    game.state.cash = 50_000;
    expect(serviceCheck(game, 'app')).toEqual({ ok: false, reason: `Needs the ${RANKS[app.minRank!].name} rank.` });
    addTukTuk(game, 'ev_new', 'tha_phae_gate', 'owned', false);
    expect(serviceCheck(game, 'app').reason).toBe(`Needs ${app.minFleet} tuk-tuks (you run 2).`);
    while (game.state.vehicles.length < app.minFleet!) addTukTuk(game, 'lpg_used', 'tha_phae_gate', 'rented', false);
    setReputation(game, 3.5);
    expect(serviceCheck(game, 'app').reason).toBe(`Needs a ${app.minRep!.toFixed(1)}★ rating (you have 3.5★).`);
    setReputation(game, 4.3);
    game.state.cash = 1_000;
    expect(serviceCheck(game, 'app').reason).toBe(`Needs ${baht(app.cost)} (you have ฿1,000).`);
    expect(serviceCheck(game, 'social_ads').reason).toBe(`Needs ${app.name} first.`);

    game.state.cash = 50_000;
    const before = currentBook(game).expense.business ?? 0;
    expect(startService(game, 'app').ok).toBe(true);
    expect(game.state.cash).toBe(50_000 - app.cost);
    expect(currentBook(game).expense.business).toBe(before + app.cost);
    expect(game.state.unlocks).toContain('app');
    expect(serviceCheck(game, 'app').reason).toBe('Already running.');

    // Stopping a service stops the ones that depend on it.
    expect(startService(game, 'social_ads').ok).toBe(true);
    expect(currentBook(game).expense.marketing).toBe(SERVICE_BY_ID.social_ads.cost);
    stopService(game, 'app');
    expect(businessState(game).services).toEqual({});
    expect(game.state.unlocks).not.toContain('social_ads');
  });

  it('bills running costs at the rollover and ends contracts it cannot pay', () => {
    const game = gameAt();
    addTukTuk(game);
    game.state.cash = 100_000;
    expect(startService(game, 'flyers').ok).toBe(true);
    const flyerBill = SERVICE_BY_ID.flyers.running!.amount;
    let spentOnMarketing = 0;
    for (let d = 1; d <= 7; d++) spentOnMarketing += nextRollover(game).expense.marketing ?? 0;
    // Paid at signing, then once more on the seventh day.
    expect(spentOnMarketing).toBe(flyerBill);
    game.state.cash = 100;
    for (let d = 1; d <= 7; d++) nextRollover(game);
    expect(businessState(game).services.flyers).toBeUndefined();
    expect(game.state.notices.some((n) => n.kind === 'bad' && n.text.includes('Hostel flyers stopped'))).toBe(true);
  });

  it('spawns app bookings at fixed app fares, more with a bigger fleet and better stars', () => {
    const game = gameAt(timeOf(2026, 10, 3, 10));
    addTukTuk(game);
    addTukTuk(game);
    setReputation(game, 4.5);
    game.state.cash = 100_000;
    expect(startService(game, 'app').ok).toBe(true);
    game.step(60);
    const sys = businessOf(game)!;
    const small = sys.currentRates().app;
    for (let i = 0; i < 3; i++) addTukTuk(game);
    game.emit('change');
    game.step(60);
    const big = sys.currentRates().app;
    expect(big / small).toBeCloseTo(6 / 3, 1);
    // Tuk-tuks parked without a driver take no bookings, so they bring none.
    for (let i = 0; i < 3; i++) addTukTuk(game, 'lpg_used', 'tha_phae_gate', 'rented', false).task = { kind: 'offduty' };
    game.emit('change');
    game.step(60);
    expect(sys.currentRates().app / big).toBeCloseTo(1, 1);
    setReputation(game, 3.6);
    game.emit('change');
    game.step(60);
    expect(sys.currentRates().app).toBeLessThan(big * 0.5);

    setReputation(game, 4.5);
    for (let t = 0; t < 2 * HOUR; t += 4) game.step(4);
    const apps = [...bookings(game, 'app'), ...game.state.vehicles.flatMap((v) => (v.task.kind === 'trip' && v.task.trip.request.source === 'app' ? [v.task.trip.request] : []))];
    expect(apps.length + (businessState(game).stats.app?.trips ?? 0)).toBeGreaterThan(5);
    for (const r of bookings(game, 'app')) {
      expect(r.channel).toBe('app');
      expect(r.fixedFare).toBe(appFare(r.distance));
      expect(['monk', 'vendor', 'elder']).not.toContain(r.archetype);
    }
  });

  it('never sells an out-of-town round trip through the app', () => {
    const game = gameAt(timeOf(2026, 10, 3, 10));
    for (let i = 0; i < 3; i++) addTukTuk(game, 'ev_new', 'maya');
    setReputation(game, 4.5);
    game.state.cash = 100_000;
    expect(startService(game, 'app').ok).toBe(true);
    // A booking nearly every step, so the channel sees a few hundred riders.
    const rate = RATES.appPerVehicle;
    RATES.appPerVehicle = 300;
    const seen = new Set<number>();
    let roundTrips = 0;
    try {
      for (let t = 0; t < HOUR; t += 4) {
        game.step(4);
        for (const r of game.state.requests) {
          if (r.channel !== 'app' || seen.has(r.id)) continue;
          seen.add(r.id);
          if (game.place(r.to).offmap?.roundTrip) roundTrips++;
        }
      }
    } finally {
      RATES.appPerVehicle = rate;
    }
    expect(seen.size).toBeGreaterThan(300);
    expect(roundTrips).toBe(0);
  });

  it('shares street sightings across the fleet with the dispatch radio', () => {
    const game = gameAt();
    const near = addTukTuk(game, 'lpg_used', 'maya');
    const far = addTukTuk(game, 'lpg_used', 'cnx_airport');
    const player = game.playerVehicle()!;
    const cal = { day: 2, year: 2026, month: 10, date: 3, weekday: 2, hour: 9, minute: 0 };
    const req = makeRequest(game, landmark('one_nimman'), landmark('wat_phra_singh'), 'tourist_west', 'street', cal);
    req.expiresAt = game.state.time + HOUR;
    game.state.requests.push(req);
    expect(game.canSee(near, req)).toBe(true);
    expect(game.canSee(far, req)).toBe(false);
    expect(game.canSee(player, req)).toBe(false);
    game.state.cash = 100_000;
    expect(startService(game, 'radio').ok).toBe(true);
    game.step(5);
    expect(game.canSee(far, req)).toBe(true);
    expect(game.canSee(player, req)).toBe(true);
    // A driver who is off duty is not on the radio.
    game.driver(near.driverId!)!.shift = 'night';
    near.task = { kind: 'offduty' };
    near.route = null;
    game.step(5);
    expect(near.task.kind).toBe('offduty');
    expect(game.canSee(far, req)).toBe(false);
  });

  it('books hotel guests at a premium fixed fare from the partner hotel', () => {
    const game = gameAt(timeOf(2026, 10, 3, 8));
    makeFleetBoss(game);
    setReputation(game, 4.3);
    const shangri = hotelSites(world).find((s) => s.place.id === 'shangri_la')!;
    expect(partnerHotel(game, 'shangri_la').reason).toBe('Needs a 4.4★ rating (you have 4.3★).');
    setReputation(game, 4.6);
    const cash = game.state.cash;
    expect(partnerHotel(game, 'shangri_la').ok).toBe(true);
    expect(game.state.cash).toBe(cash - shangri.tier.monthly);
    expect(game.state.unlocks).toContain('hotel:shangri_la');
    // Snapshot each booking as it appears: the fair fare is re-measured once a tuk-tuk reaches the kerb.
    const seen = new Map<number, RideRequest>();
    for (let t = 0; t < 4 * HOUR && seen.size < 3; t += 4) {
      game.step(4);
      for (const r of bookings(game, 'hotel:shangri_la')) if (!seen.has(r.id)) seen.set(r.id, { ...r });
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
    for (const r of seen.values()) {
      expect(r.channel).toBe('hotel');
      expect(r.from).toBe(shangri.place.idx);
      expect(r.fixedFare).toBe(roundFare(r.fairFare * HOTEL_FARE_PREMIUM));
    }
  });

  it('runs tours: fixed fare, and the driver waits with the group', () => {
    const game = gameAt(timeOf(2026, 10, 3, 8));
    makeFleetBoss(game);
    expect(startService(game, 'tour_temples').ok).toBe(true);
    for (let t = 0; t < 3 * HOUR && !bookings(game, 'tour:temples').length; t += 4) game.step(4);
    const [req] = bookings(game, 'tour:temples');
    expect(req).toBeDefined();
    expect(req.fixedFare).toBe(600);
    expect(TOUR_BY_ID.temples.stops.map((id) => landmark(id).idx)).toContain(req.to);
    // Complete it with a fleet tuk-tuk and check the dwell.
    const v = game.state.vehicles[1];
    game.state.requests = game.state.requests.filter((r) => r.id !== req.id);
    game.state.requests.push({ ...req, claimedBy: null });
    v.task = { kind: 'pickup', requestId: req.id };
    expect(startTrip(game, v, req.fixedFare!)).toBe(true);
    completeTrip(game, v);
    expect(v.busyUntil).toBeGreaterThanOrEqual(game.state.time + TOUR_BY_ID.temples.dwellHours * HOUR - 1);
    expect(tourDwellText(game, v)).toContain('Temple loop group at');
    expect(businessState(game).stats['tour:temples']).toEqual({ trips: 1, fares: 600 });
  });

  it('does not hold a sunset-run tuk-tuk again once it has brought the group back down', () => {
    const game = gameAt(timeOf(2026, 10, 3, 15));
    const v = game.playerVehicle()!;
    v.model = 'ev_new';
    const req = makeRequest(game, landmark('tha_phae_gate'), landmark('wat_doi_suthep'), 'tourist_west', 'regular', calendar(game.state.time));
    req.source = 'tour:suthep';
    req.fixedFare = TOUR_BY_ID.suthep.fare;
    game.state.requests.push(req);
    v.task = { kind: 'pickup', requestId: req.id };
    expect(startTrip(game, v, req.fixedFare)).toBe(true);
    // Back at the pickup after the wait at the top, which the time away already covered.
    const task = v.task as Vehicle['task'];
    if (task.kind === 'trip') task.trip.returning = true;
    completeTrip(game, v);
    expect(businessState(game).stats['tour:suthep']).toEqual({ trips: 1, fares: TOUR_BY_ID.suthep.fare });
    expect(businessState(game).dwell[String(v.id)]).toBeUndefined();
    expect(v.busyUntil).toBe(game.state.time + BALANCE.trip.alightSeconds);
    expect(tourDwellText(game, v)).toBeNull();
    expect(game.state.notices.some((n) => n.text.includes('heads off at'))).toBe(false);
  });

  it('sends Doi Suthep tours only to tuk-tuks that can climb', () => {
    const game = gameAt(timeOf(2026, 10, 3, 15));
    const lpg = addTukTuk(game, 'lpg_used');
    addTukTuk(game, 'lpg_used');
    game.state.cash = 400_000;
    game.step(60);
    expect(canClimb(lpg)).toBe(false);
    expect(serviceCheck(game, 'tour_suthep').reason).toBe('Needs a tuk-tuk that can climb Doi Suthep (an electric one).');
    const ev = addTukTuk(game, 'ev_new');
    expect(canClimb(ev)).toBe(true);
    expect(startService(game, 'tour_suthep').ok).toBe(true);
    // Book groups quickly so the test sees several offers in the 15:00–17:00 window.
    const tour = TOUR_BY_ID.suthep;
    const rate = tour.rate;
    tour.rate = 40;
    const takers = new Set<number>();
    try {
      for (let t = 0; t < 2 * HOUR; t += 4) {
        game.step(4);
        for (const r of bookings(game, 'tour:suthep')) if (r.claimedBy !== null) takers.add(r.claimedBy);
        for (const v of game.state.vehicles) {
          if (v.task.kind === 'trip' && v.task.trip.request.source === 'tour:suthep') takers.add(v.id);
        }
      }
    } finally {
      tour.rate = rate;
    }
    expect([...takers]).toEqual([ev.id]);
  });
});

describe('airport counter', () => {
  it('turns terminal hails into ฿160 counter bookings that rivals cannot take', () => {
    const game = gameAt(timeOf(2026, 10, 3, 10));
    makeFleetBoss(game);
    for (let i = 0; i < 2; i++) addTukTuk(game, 'lpg_used', 'maya');
    expect(startService(game, 'airport').ok).toBe(true);
    const airport = landmark(AIRPORT_LANDMARK);
    const seen = new Map<number, RideRequest>();
    let street = 0;
    // Hails convert at random (AIRPORT_COUNTER_SHARE): run until both kinds have turned up.
    for (let t = 0; t < 8 * HOUR && (seen.size <= 3 || street === 0); t += 4) {
      game.step(4);
      for (const r of game.state.requests) {
        if (r.from !== airport.idx || seen.has(r.id)) continue;
        if (r.source === 'airport') seen.set(r.id, { ...r });
        else if (r.channel === 'street' && r.spawnedAt === game.state.time) street++;
      }
    }
    expect(seen.size).toBeGreaterThan(3);
    for (const r of seen.values()) {
      expect(r.channel).toBe('regular');
      expect(r.fixedFare).toBe(AIRPORT_FARE);
      expect(r.distance).toBeLessThanOrEqual(AIRPORT_MAX_TRIP);
    }
    // Longer runs and the other fifth stay on the kerb.
    expect(street).toBeGreaterThan(0);
  });

  it('leaves out-of-town round trips from the terminal on the kerb', () => {
    const game = gameAt(timeOf(2026, 10, 3, 10));
    makeFleetBoss(game);
    for (let i = 0; i < 2; i++) addTukTuk(game, 'lpg_used', 'maya');
    expect(startService(game, 'airport').ok).toBe(true);
    game.step(4);
    const airport = landmark(AIRPORT_LANDMARK);
    const cal = calendar(game.state.time);
    const hail = (to: string) =>
      Array.from({ length: 10 }, () => {
        const r = makeRequest(game, airport, landmark(to), 'tourist_west', 'street', cal);
        // Hailed during the next step, which the counter scans.
        r.spawnedAt = game.state.time + 1;
        r.expiresAt = game.state.time + HOUR;
        game.state.requests.push(r);
        return r;
      });
    const roundTrips = [...hail('night_safari'), ...hail('wat_pha_lat')];
    const intoTown = hail('tha_phae_gate');
    for (const r of roundTrips) expect(r.distance).toBeLessThanOrEqual(AIRPORT_MAX_TRIP);
    game.step(4);
    expect(intoTown.filter((r) => r.source === 'airport').length).toBeGreaterThan(3);
    expect(roundTrips.filter((r) => r.source === 'airport')).toEqual([]);
  });
});

describe('depots', () => {
  it('rents a depot: charging point, cheaper repairs, off-duty parking and daily rent', () => {
    const game = gameAt(timeOf(2026, 10, 3, 12));
    expect(repairDiscount(game)).toBe(1);
    const site = depotSites(world).find((d) => d.zone.id === 'old_city')!;
    expect(openDepot(game, 'old_city').reason).toBe(`Needs the ${RANKS[DEPOT.minRank].name} rank.`);
    makeFleetBoss(game);
    const cash = game.state.cash;
    expect(openDepot(game, 'old_city').ok).toBe(true);
    expect(game.state.cash).toBe(cash - DEPOT.deposit - DEPOT.rentPerDay);
    expect(activeDepots(game)).toEqual([site]);
    expect(game.chargers()).toContain(site.place);
    // The depot charges at the home rate; the malls' public chargers cost more.
    expect(game.evChargePerKm(site.place)).toBe(BALANCE.fuel.evHomePerKm);
    expect(game.evChargePerKm(landmark('maya'))).toBe(BALANCE.fuel.evPublicPerKm);
    expect(repairDiscount(game)).toBe(DEPOT.repairDiscount);

    const v = addTukTuk(game, 'ev_used', 'chiang_mai_gate');
    const d = game.driver(v.driverId!)!;
    d.shift = 'day';
    v.fuel = 0.4;
    game.state.time = timeOf(2026, 10, 3, 19);
    for (let t = 0; t < HOUR && !(v.task.kind === 'offduty' && Math.hypot(game.vehiclePose(v).x - site.x, game.vehiclePose(v).y - site.y) < DEPOT.parkedRadius); t += 4) game.step(4);
    expect(v.task.kind).toBe('offduty');
    const pose = game.vehiclePose(v);
    expect(Math.hypot(pose.x - site.x, pose.y - site.y)).toBeLessThan(DEPOT.parkedRadius);
    for (let t = 0; t < 120; t += 4) game.step(4);
    expect(v.fuel).toBe(1);

    const before = game.state.cash;
    expect(nextRollover(game).expense.business).toBe(DEPOT.rentPerDay);
    expect(game.state.cash).toBeLessThan(before);
    closeDepot(game, 'old_city');
    expect(repairDiscount(game)).toBe(1);
    expect(game.chargers()).not.toContain(site.place);
  });
});

describe('bank loan', () => {
  it('accrues interest, takes daily instalments and can be repaid early', () => {
    const game = gameAt();
    setReputation(game, 4.5);
    addTukTuk(game, 'ev_new', 'tha_phae_gate', 'owned', false);
    const limit = creditLimit(game);
    // 1.5★ above 3★ unsecured, plus half the owned fleet's resale value (60 % of the new EV's price).
    expect(fleetValue(game)).toBeCloseTo(0.6 * VEHICLE_MODELS.ev_new.price, -2);
    expect(limit).toBe(Math.floor((LOAN.unsecuredPerStar * 1.5 + LOAN.collateralShare * fleetValue(game)) / 1000) * 1000);
    expect(takeLoan(game, limit + 1000).reason).toBe(`Your limit is ฿${limit.toLocaleString('en-US')}.`);
    const cash = game.state.cash;
    const worth = netWorth(game);
    expect(takeLoan(game, 50_000).ok).toBe(true);
    expect(game.state.cash).toBe(cash + 50_000);
    expect(currentBook(game).income.loan).toBe(50_000);
    // Borrowing adds cash and debt alike.
    expect(netWorth(game)).toBe(worth);
    expect(takeLoan(game, 5_000).reason).toBe('Repay your current loan first.');

    const instalment = instalmentFor(50_000);
    game.state.cash = 100_000;
    const settled = nextRollover(game);
    const loan = businessState(game).loan!;
    expect(settled.expense.loan).toBe(instalment);
    expect(loan.balance).toBeCloseTo(50_000 * (1 + LOAN.dailyRate) - instalment, 6);

    // A missed payment: late fee and a knock to the company's stars.
    game.state.cash = 10;
    const rep = game.state.reputation;
    const balance = loan.balance;
    nextRollover(game);
    expect(loan.missed).toBe(1);
    expect(loan.balance).toBeCloseTo(balance * (1 + LOAN.dailyRate) + Math.round(instalment * LOAN.lateFee), 6);
    expect(game.state.reputation).toBeLessThan(rep);

    game.state.cash = 100_000;
    expect(repayLoan(game, loan.balance + 10).ok).toBe(true);
    expect(businessState(game).loan).toBeNull();
    expect(game.state.cash).toBeCloseTo(100_000 - Math.ceil(balance * (1 + LOAN.dailyRate) + Math.round(instalment * LOAN.lateFee)), 0);
  });

  it('repays a whole loan over its term', () => {
    let balance = 30_000;
    const pay = instalmentFor(balance);
    for (let d = 0; d < LOAN.termDays; d++) balance = balance * (1 + LOAN.dailyRate) - pay;
    expect(balance).toBeLessThanOrEqual(0);
    expect(balance).toBeGreaterThan(-pay);
  });
});

describe('ranks', () => {
  it('computes rank from fleet, ownership and net worth', () => {
    expect(rankFor(1, 0, 0)).toBe(0);
    expect(rankFor(1, 1, 0)).toBe(1);
    expect(rankFor(3, 1, 149_999)).toBe(1);
    expect(rankFor(3, 1, 150_000)).toBe(2);
    expect(rankFor(8, 3, 600_000)).toBe(3);
    expect(rankFor(8, 2, 5_000_000)).toBe(2);
    expect(rankFor(20, 10, 2_000_000)).toBe(4);
  });

  it('promotes once, announces it, and keeps the title', () => {
    const game = gameAt();
    const ranks: number[] = [];
    game.on('rank', (r: number) => ranks.push(r));
    makeFleetBoss(game);
    expect(ranks).toEqual([2]);
    expect(game.state.notices.some((n) => n.kind === 'goal' && n.text.includes('Promoted to Fleet boss'))).toBe(true);
    game.state.cash = 0;
    game.step(60);
    expect(businessState(game).rank).toBe(2);
    expect(ranks).toEqual([2]);
  });
});

describe('business state', () => {
  it('survives a save and load, and old saves without it', () => {
    const game = gameAt();
    makeFleetBoss(game);
    setReputation(game, 4.5);
    startService(game, 'radio');
    partnerHotel(game, 'anantara');
    openDepot(game, 'riverside');
    takeLoan(game, 20_000);
    const copy = Game.load(world, JSON.parse(game.serialize()));
    installSystems(copy);
    expect(businessState(copy)).toEqual(businessState(game));
    expect(copy.chargers().length).toBe(game.chargers().length);

    const old = JSON.parse(Game.create(world, { seed: 3 }).serialize());
    delete old.systems.business;
    delete old.systems.goals;
    const loaded = Game.load(world, old);
    installSystems(loaded);
    loaded.step(60);
    expect(businessState(loaded).services).toEqual({});
  });
});
