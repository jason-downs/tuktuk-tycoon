import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { DAY, HOUR } from '../src/sim/clock';
import { VEHICLE_MODELS } from '../src/content/vehicles';
import { businessDay, earn } from '../src/sim/economy';
import {
  FLEET,
  FleetSystem,
  MARKET_MODELS,
  assignDriver,
  buyVehicle,
  dailyBills,
  driverRecord,
  fireDriver,
  fleetState,
  hireCandidate,
  leaseTerms,
  payOffLease,
  rentVehicle,
  resaleValue,
  returnVehicle,
  sellVehicle,
  upkeepPerDay,
  whyCantBuy,
  whyCantHire,
  whyCantRent,
  whyCantSell,
} from '../src/sim/fleet';
import { Game } from '../src/sim/game';
import type { GraphJSON } from '../src/sim/graph';
import { installSystems } from '../src/sim/systems';
import type { Archetype, DayBook, Trip } from '../src/sim/types';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));
const thaPhae = world.landmarks.find((l) => l.id === 'tha_phae_gate')!;

function newGame(seed = 11, extraCash = 0): Game {
  const game = Game.create(world, { seed });
  game.addSystem(new FleetSystem());
  if (extraCash) earn(game, extraCash, 'other');
  return game;
}

/** Game time of the next 04:00 settlement. */
function nextRollover(game: Game): number {
  return (businessDay(game.state.time) + 1) * DAY + 4 * HOUR;
}

/** Skip ahead to just before 04:00 and step across the settlement. */
function jumpPastSettlement(game: Game): DayBook {
  // The first step only records the current business day.
  game.step(1);
  game.state.time = nextRollover(game) - 1;
  game.step(2);
  return game.state.books[game.state.books.length - 1];
}

/** A finished trip carrying one passenger of the given archetype. */
function tripFor(archetype: Archetype): Trip {
  return { request: { archetype } } as Trip;
}

function hireFirst(game: Game, model: 'salary' | 'rent' = 'salary', vehicleId: number | null = null) {
  const c = fleetState(game).candidates[0];
  const d = hireCandidate(game, c.roster, model, vehicleId);
  expect(d).not.toBeNull();
  return d!;
}

describe('vehicle market', () => {
  it('rents up to three of Lung Daeng’s tuk-tuks at ฿350/day, settled at 04:00', () => {
    const game = newGame();
    expect(game.state.vehicles.filter((v) => v.ownership === 'rented')).toHaveLength(1);
    const a = rentVehicle(game)!;
    const b = rentVehicle(game)!;
    expect(a.model).toBe('rusty');
    expect(b.rentPerDay).toBe(350);
    expect(a.driverId).toBeNull();
    expect(a.task.kind).toBe('offduty');
    expect(rentVehicle(game)).toBeNull();
    expect(whyCantRent(game)).toMatch(/only has 3/);

    const book = jumpPastSettlement(game);
    expect(book.expense.rent).toBe(3 * FLEET.rentPerDay);

    const cash = game.state.cash;
    expect(returnVehicle(game, a.id)).toBe(true);
    expect(game.state.cash).toBe(cash - FLEET.rentPerDay);
    expect(game.vehicle(a.id)).toBeUndefined();
    expect(whyCantRent(game)).toBeNull();
  });

  it('buys outright at list price and sells for 60 % less 5 % a year', () => {
    const game = newGame(11, 300_000);
    const cash = game.state.cash;
    const v = buyVehicle(game, 'lpg_used')!;
    expect(v).not.toBeNull();
    expect(game.state.cash).toBe(cash - 200_000);
    expect(game.state.books.at(-1)!.expense.vehicles).toBe(200_000);
    expect(v.ownership).toBe('owned');
    expect(v.purchasePrice).toBe(200_000);
    expect(v.name).toBe('Nong Daeng');
    expect(game.world.graph.outgoing(thaPhae.node)).toContain(v.arc);

    expect(resaleValue(game, v)).toBe(120_000);
    v.boughtDay -= 365;
    expect(resaleValue(game, v)).toBe(110_000);
    v.boughtDay += 365;

    // Not while a passenger is at the kerb or aboard.
    v.task = { kind: 'haggle', requestId: -1 };
    expect(whyCantSell(game, v)).toMatch(/passenger/);
    v.task = { kind: 'idle' };

    const before = game.state.cash;
    expect(sellVehicle(game, v.id)).toBe(120_000);
    expect(game.state.cash).toBe(before + 120_000);
    expect(game.state.books.at(-1)!.income.vehicles).toBe(120_000);
    expect(game.vehicle(v.id)).toBeUndefined();

    expect(whyCantSell(game, game.playerVehicle()!)).toMatch(/Lung Daeng/);
  });

  it('hire-purchase: 25 % down, daily instalments at 04:00, owned once paid off', () => {
    const game = newGame(11, 60_000);
    const terms = leaseTerms(200_000);
    expect(terms.down).toBe(50_000);
    expect(terms.financed).toBe(172_500);
    expect(terms.instalment).toBe(Math.ceil(172_500 / 120));

    const cash = game.state.cash;
    const v = buyVehicle(game, 'lpg_used', 'lease')!;
    expect(v.ownership).toBe('leased');
    expect(game.state.cash).toBe(cash - 50_000);
    expect(whyCantSell(game, v)).toMatch(/pay it off/);

    const book = jumpPastSettlement(game);
    const lease = fleetState(game).leases[v.id];
    expect(book.expense.vehicles).toBe(terms.instalment);
    expect(lease.remaining).toBe(terms.financed - terms.instalment);
    expect(lease.daysLeft).toBe(119);

    // The last instalment is only what is left, and the vehicle becomes the player's.
    lease.remaining = 500;
    const last = jumpPastSettlement(game);
    expect(last.expense.vehicles).toBe(500);
    expect(v.ownership).toBe('owned');
    expect(fleetState(game).leases[v.id]).toBeUndefined();
    // Resale is based on the list price, less a sliver for two days of age.
    expect(resaleValue(game, v)).toBeGreaterThan(119_000);
    expect(resaleValue(game, v)).toBeLessThanOrEqual(120_000);
  });

  it('pays off a lease early', () => {
    const game = newGame(11, 400_000);
    const v = buyVehicle(game, 'ev_new', 'lease')!;
    const owed = fleetState(game).leases[v.id].remaining;
    const cash = game.state.cash;
    expect(payOffLease(game, v.id)).toBe(true);
    expect(game.state.cash).toBe(cash - owed);
    expect(v.ownership).toBe('owned');
  });

  it('enforces the one-EV-plate-per-person rule', () => {
    const game = newGame(11, 2_000_000);
    expect(buyVehicle(game, 'ev_new')).not.toBeNull();
    expect(whyCantBuy(game, 'ev_used', 'cash')).toMatch(/one per person/);
    expect(whyCantBuy(game, 'ev_used', 'lease')).toMatch(/one per person/);
    expect(buyVehicle(game, 'ev_used')).toBeNull();
    expect(whyCantBuy(game, 'lpg_used', 'cash')).toBeNull();
    hireFirst(game);
    expect(whyCantBuy(game, 'ev_used', 'cash')).toBeNull();
    expect(buyVehicle(game, 'ev_used')).not.toBeNull();
    expect(whyCantBuy(game, 'ev_7seat', 'cash')).toMatch(/one per person/);
  });

  it('explains when cash is short', () => {
    const game = newGame();
    expect(whyCantBuy(game, 'rusty', 'cash')).toMatch(/need ฿147,000 more/);
  });

  it('sells only the showroom models, never garage conversion variants', () => {
    for (const id of MARKET_MODELS) expect(VEHICLE_MODELS[id]).toBeDefined();
    const game = newGame(11, 2_000_000);
    VEHICLE_MODELS.test_conversion_ev = { ...VEHICLE_MODELS.rusty, id: 'test_conversion_ev', powertrain: 'ev' };
    try {
      expect(whyCantBuy(game, 'test_conversion_ev', 'cash')).toMatch(/doesn’t sell/);
      expect(buyVehicle(game, 'test_conversion_ev', 'lease')).toBeNull();
    } finally {
      delete VEHICLE_MODELS.test_conversion_ev;
    }
    for (const id of MARKET_MODELS) expect(whyCantBuy(game, id, 'cash')).toBeNull();
  });

  it('forecasts the 04:00 bills exactly as the settlement charges them', () => {
    const game = newGame(11, 400_000);
    const spare = rentVehicle(game)!;
    const leased = buyVehicle(game, 'lpg_used', 'lease')!;
    buyVehicle(game, 'ev_new');
    hireFirst(game, 'salary', spare.id);
    hireFirst(game, 'rent', leased.id);
    hireFirst(game, 'salary');
    hireFirst(game, 'rent');
    const bills = dailyBills(game);
    expect(bills.rent).toBe(2 * FLEET.rentPerDay);
    expect(bills.upkeep).toBe(upkeepPerDay('lpg_used') + upkeepPerDay('ev_new'));
    expect(bills.instalments).toBe(leaseTerms(200_000).instalment);

    const book = jumpPastSettlement(game);
    expect(book.expense.rent).toBe(bills.rent);
    expect(book.expense.wages).toBe(bills.wages);
    expect(book.expense.vehicles).toBe(bills.instalments);
    expect(book.expense.maintenance).toBe(bills.upkeep);
    // The rent-out driver without a tuk-tuk pays nothing.
    expect(book.income.rent_income).toBe(bills.rentIncome);
    expect(bills.rentIncome).toBe(game.state.drivers.find((d) => d.vehicleId === leased.id)!.dailyPay);
  });
});

describe('drivers', () => {
  it('draws a deterministic pool of 3–5 applicants that refreshes each day', () => {
    const a = newGame(5);
    const b = newGame(5);
    const poolA = fleetState(a).candidates;
    expect(poolA.length).toBeGreaterThanOrEqual(3);
    expect(poolA.length).toBeLessThanOrEqual(5);
    expect(JSON.stringify(poolA)).toBe(JSON.stringify(fleetState(b).candidates));
    for (const c of poolA) {
      expect(c.salaryAsk).toBeGreaterThanOrEqual(380);
      expect(c.salaryAsk).toBeLessThanOrEqual(600);
      expect(c.commissionAsk).toBeGreaterThanOrEqual(0.1);
      expect(c.commissionAsk).toBeLessThanOrEqual(0.2);
      expect(c.rentOffer).toBeGreaterThanOrEqual(300);
      expect(c.rentOffer).toBeLessThanOrEqual(400);
    }
    const hired = hireFirst(a);
    const day0 = fleetState(a).poolDay;
    jumpPastSettlement(a);
    const s = fleetState(a);
    expect(s.poolDay).toBe(day0 + 1);
    expect(JSON.stringify(s.candidates)).not.toBe(JSON.stringify(poolA));
    expect(s.candidates.some((c) => c.roster === driverRecord(a, hired).roster)).toBe(false);
  });

  it('charges the ฿1,000 hiring fee and can seat the new driver at once', () => {
    const game = newGame();
    const v = rentVehicle(game)!;
    const cash = game.state.cash;
    const c = fleetState(game).candidates[0];
    const d = hireCandidate(game, c.roster, 'salary', v.id)!;
    expect(game.state.cash).toBe(cash - FLEET.hiringFee);
    expect(game.state.books.at(-1)!.expense.fees).toBe(FLEET.hiringFee);
    expect(d.isPlayer).toBe(false);
    expect(d.dailyPay).toBe(c.salaryAsk);
    expect(d.commission).toBe(c.commissionAsk);
    expect(d.vehicleId).toBe(v.id);
    expect(v.driverId).toBe(d.id);
    expect(v.task.kind).toBe('idle');
    expect(fleetState(game).candidates.some((x) => x.roster === c.roster)).toBe(false);

    game.state.cash = 500;
    expect(whyCantHire(game, fleetState(game).candidates[0].roster)).toMatch(/hiring fee/);
  });

  it('swaps tuk-tuks between the player and a hired driver', () => {
    const game = newGame();
    const starter = game.playerVehicle()!;
    const spare = rentVehicle(game)!;
    const d = hireFirst(game, 'salary', spare.id);
    expect(assignDriver(game, game.player().id, spare.id)).toBe(true);
    expect(game.playerVehicle()).toBe(spare);
    expect(d.vehicleId).toBe(starter.id);
    expect(starter.driverId).toBe(d.id);
    expect(assignDriver(game, d.id, null)).toBe(true);
    expect(starter.driverId).toBeNull();
    expect(starter.task.kind).toBe('offduty');
  });

  it('fires with one day’s pay as severance and parks the tuk-tuk', () => {
    const game = newGame();
    const v = rentVehicle(game)!;
    const salaried = hireFirst(game, 'salary', v.id);
    const renter = hireFirst(game, 'rent');
    const cash = game.state.cash;
    expect(fireDriver(game, salaried.id)).toBe(true);
    expect(game.state.cash).toBe(cash - salaried.dailyPay);
    expect(game.driver(salaried.id)).toBeUndefined();
    expect(v.driverId).toBeNull();
    expect(v.task.kind).toBe('offduty');
    expect(fireDriver(game, renter.id)).toBe(true);
    expect(game.state.cash).toBe(cash - salaried.dailyPay - FLEET.minWage);
    expect(fireDriver(game, game.player().id)).toBe(false);
  });

  it('a driver whose morale stays below 15 for two day-ends quits', () => {
    const game = newGame();
    const d = hireFirst(game, 'rent');
    driverRecord(game, d).hiredAt = -DAY;
    d.morale = 14;
    jumpPastSettlement(game);
    expect(driverRecord(game, d).lowDays).toBe(1);
    expect(game.driver(d.id)).toBeDefined();
    // Idle rent-out drivers earn nothing, so morale keeps falling.
    expect(driverRecord(game, d).lastNet).toBe(0);
    jumpPastSettlement(game);
    game.step(1);
    expect(game.driver(d.id)).toBeUndefined();
    expect(game.state.notices.some((n) => n.text.includes(`${d.nickname} quit`))).toBe(true);
  });

  it('morale follows take-home pay against the ~฿500/day comfort line', () => {
    const game = newGame();
    const d = hireFirst(game, 'salary');
    driverRecord(game, d).hiredAt = -DAY;
    d.morale = 50;
    d.dailyPay = 400;
    d.earnedToday = 350; // 750 take-home → +10
    jumpPastSettlement(game);
    expect(driverRecord(game, d).lastNet).toBe(750);
    expect(d.morale).toBe(60 - FLEET.morale.shiftCost[d.shift]);
    expect(d.honesty).toBe(Math.min(100, driverRecord(game, d).honestyBase + 1));
  });

  it('rates trips up to ±0.3 by the driver’s morale', () => {
    const game = newGame();
    const v = rentVehicle(game)!;
    const d = hireFirst(game, 'salary', v.id);
    const trip = tripFor('vendor');
    const bonus = () => game.ratingModifiers.reduce((sum, m) => sum + m(v, trip), 0);
    d.morale = 100;
    expect(bonus()).toBeCloseTo(0.3);
    d.morale = 0;
    expect(bonus()).toBeCloseTo(-0.3);
    expect(game.ratingModifiers.reduce((sum, m) => sum + m(game.playerVehicle()!, trip), 0)).toBe(0);
  });

  it('English moves foreign visitors’ ratings by up to ±0.2, locals’ not at all', () => {
    const game = newGame();
    const v = rentVehicle(game)!;
    const d = hireFirst(game, 'salary', v.id);
    d.morale = 50;
    const bonus = (trip: Trip) => game.ratingModifiers.reduce((sum, m) => sum + m(v, trip), 0);
    d.english = 100;
    expect(bonus(tripFor('tourist_kr'))).toBeCloseTo(FLEET.englishSwing);
    expect(bonus(tripFor('vendor'))).toBe(0);
    d.english = 0;
    expect(bonus(tripFor('backpacker'))).toBeCloseTo(-FLEET.englishSwing);
    expect(bonus(tripFor('elder'))).toBe(0);
  });

  it('sends an exhausted driver home until the next shift', () => {
    const game = newGame();
    const v = rentVehicle(game)!;
    const d = hireFirst(game, 'salary', v.id);
    d.shift = 'day';
    game.state.time = 10 * HOUR;
    d.fatigue = 90;
    for (let i = 0; i < 30; i++) game.step(4);
    expect(d.restUntil).toBe(DAY + 6 * HOUR);
    expect(v.task.kind).toBe('offduty');
    expect(v.route).toBeNull();
  });

  it('loads an old save without fleet state', () => {
    const game = Game.create(world, { seed: 3 });
    const state = JSON.parse(game.serialize());
    delete state.systems.fleet;
    const loaded = Game.load(world, state);
    loaded.addSystem(new FleetSystem());
    const s = fleetState(loaded);
    expect(s.candidates.length).toBeGreaterThanOrEqual(3);
    expect(s.leases).toEqual({});
    loaded.step(4);
  });
});

describe('headless fleet', () => {
  it('runs alongside the world systems and survives a save round trip', { timeout: 60_000 }, () => {
    const game = Game.create(world, { seed: 9 });
    installSystems(game);
    earn(game, 300_000, 'other');
    game.state.autopilot = true;
    const spare = rentVehicle(game)!;
    const ev = buyVehicle(game, 'ev_used', 'lease')!;
    const d = hireFirst(game, 'salary', spare.id);
    const r = hireFirst(game, 'rent', ev.id);
    const t0 = game.state.time;
    while (game.state.time < t0 + DAY) game.step(4);
    expect(d.trips + r.trips).toBeGreaterThan(0);

    const loaded = Game.load(world, JSON.parse(game.serialize()));
    installSystems(loaded);
    expect(fleetState(loaded).leases[ev.id].daysLeft).toBe(FLEET.lease.days - 1);
    expect(driverRecord(loaded, loaded.driver(r.id)!).ask.rent).toBe(driverRecord(game, r).ask.rent);
    for (let i = 0; i < 900; i++) loaded.step(4);
  });


  it('runs two days with three hired drivers: trips, wages and rents hit the ledger', { timeout: 60_000 }, () => {
    const game = newGame(42, 400_000);
    game.state.autopilot = true;
    const r1 = rentVehicle(game)!;
    const r2 = rentVehicle(game)!;
    const own = buyVehicle(game, 'lpg_used')!;
    const pool = fleetState(game).candidates;
    const drivers = [
      hireCandidate(game, pool[0].roster, 'salary', r1.id)!,
      hireCandidate(game, pool[1].roster, 'rent', r2.id)!,
      hireCandidate(game, pool[2].roster, 'salary', own.id)!,
    ];
    for (const d of drivers) d.shift = 'long';
    const t0 = game.state.time;
    while (game.state.time < t0 + 2 * DAY) game.step(4);

    for (const d of drivers) {
      expect(game.driver(d.id)).toBeDefined();
      expect(d.trips).toBeGreaterThan(0);
      expect(driverRecord(game, d).lastNet).not.toBeNull();
    }
    const settled = game.state.books.filter((b) => (b.expense.wages ?? 0) > 0);
    expect(settled.length).toBe(2);
    for (const b of settled) {
      expect(b.expense.wages).toBe(drivers[0].dailyPay + drivers[2].dailyPay);
      expect(b.income.rent_income).toBe(drivers[1].dailyPay);
      expect(b.expense.rent).toBe(3 * FLEET.rentPerDay);
    }
    const commission = game.state.books.reduce((sum, b) => sum + (b.expense.commission ?? 0), 0);
    expect(commission).toBeGreaterThan(0);
    const total = drivers.reduce((sum, d) => sum + d.trips, 0);
    console.log(
      `fleet sim: hired trips ${drivers.map((d) => d.trips).join('/')} (${total}), morale ${drivers.map((d) => d.morale).join('/')}, cash ${Math.round(game.state.cash)}`,
    );
  });
});
