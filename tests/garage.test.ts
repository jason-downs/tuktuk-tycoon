import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PAINTS } from '../src/content/paints';
import { VEHICLE_UPGRADES } from '../src/content/upgrades';
import { VEHICLE_MODELS } from '../src/content/vehicles';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { HOUR, MINUTE, calendar, timeOf } from '../src/sim/clock';
import { makeRequest } from '../src/sim/demand';
import { currentBook } from '../src/sim/economy';
import { Game } from '../src/sim/game';
import {
  EV_CONVERSION_HOURS,
  EV_KIT_PRICE,
  GARAGE_ID,
  GarageSystem,
  PAINT_HOURS,
  SERVICE_THB_PER_POINT,
  WORN_WARNING,
  canConvertToEv,
  canInstall,
  canRepaint,
  canService,
  evConversionModel,
  garageRatingBonus,
  garageState,
  installUpgrade,
  repaint,
  repaintCost,
  serviceQuote,
  setAutoService,
  startEvConversion,
  startService,
  vehicleJob,
} from '../src/sim/garage';
import type { GraphJSON } from '../src/sim/graph';
import { CLIMB_BLOCKED_TEXT, climbBlocked, isUpDoiSuthep, requestClimbs, vehicleClimbs } from '../src/sim/mountain';
import { installSystems } from '../src/sim/systems';
import type { Archetype, Driver, Place, RideRequest, Trip, Vehicle } from '../src/sim/types';
import { breakdownPerDay } from '../src/sim/vehicles';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));
const landmark = (id: string): Place => {
  const p = world.landmarks.find((l) => l.id === id);
  if (!p) throw new Error(`no landmark ${id}`);
  return p;
};

/** A new game with only the garage installed and no passengers spawning, with plenty of cash. */
function garageGame(seed = 42, cash = 1_000_000): Game {
  const game = Game.create(world, { seed });
  game.demandModifiers.push(() => 0);
  game.addSystem(new GarageSystem());
  game.state.cash = cash;
  return game;
}

/** Give the player a new tuk-tuk of this model at Tha Phae Gate; Lung Daeng's stays parked. */
function playerTukTuk(game: Game, model: string, ownership: Vehicle['ownership'] = 'owned'): Vehicle {
  const player = game.player();
  const old = game.playerVehicle();
  if (old) old.driverId = null;
  const v = game.spawnVehicle(model, landmark('tha_phae_gate').node, { ownership, purchasePrice: VEHICLE_MODELS[model].price });
  v.driverId = player.id;
  player.vehicleId = v.id;
  return v;
}

/** A hired driver for a vehicle, on a given shift. */
function hire(game: Game, v: Vehicle, shift: Driver['shift']): Driver {
  const d: Driver = {
    ...game.player(),
    id: game.nextId(),
    nickname: 'Noi',
    fullName: 'Noi Test',
    isPlayer: false,
    payModel: 'salary',
    dailyPay: 400,
    commission: 0.1,
    vehicleId: v.id,
    shift,
  };
  game.state.drivers.push(d);
  v.driverId = d.id;
  return d;
}

function run(game: Game, seconds: number, dt = 4): void {
  for (let t = 0; t < seconds; t += dt) game.step(Math.min(dt, seconds - t));
}

/** A finished trip between two places that started at the given game time. */
function tripAt(game: Game, from: Place, to: Place, arch: Archetype, startedAt: number): Trip {
  const req = makeRequest(game, from, to, arch, 'street', calendar(startedAt));
  return { request: req, fare: req.fairFare, ratio: 1, startedAt, distance: req.distance };
}

/** A waiting app passenger (visible to every tuk-tuk) who will wait for hours. */
function waitingRide(game: Game, from: Place, to: Place, patience = 2 * HOUR): RideRequest {
  const req = makeRequest(game, from, to, 'thai_tourist', 'app', calendar(game.state.time));
  req.party = 1;
  req.expiresAt = game.state.time + patience;
  game.state.requests.push(req);
  return req;
}

const DAY2_NOON = timeOf(2026, 10, 2, 12);
const DAY2_NIGHT = timeOf(2026, 10, 2, 21);

describe('upgrade catalogue', () => {
  it('has 8–14 upgrades, rain curtains under the id the weather system checks', () => {
    const ids = Object.keys(VEHICLE_UPGRADES);
    expect(ids.length).toBeGreaterThanOrEqual(8);
    expect(ids.length).toBeLessThanOrEqual(14);
    expect(VEHICLE_UPGRADES.rain_curtains.rainproof).toBe(true);
    for (const [id, up] of Object.entries(VEHICLE_UPGRADES)) {
      expect(up.id).toBe(id);
      expect(up.price).toBeGreaterThan(0);
    }
    expect(VEHICLE_UPGRADES.mountain_gear.climbs).toBe(true);
  });
});

describe('fitting upgrades', () => {
  it('lets only cheap non-invasive parts onto Lung Daeng’s rented tuk-tuk', () => {
    const game = garageGame();
    const v = game.playerVehicle()!;
    expect(v.ownership).toBe('rented');
    for (const up of Object.values(VEHICLE_UPGRADES)) {
      const verdict = canInstall(game, v, up.id);
      if (up.powertrain === 'ev') continue;
      expect(verdict.ok, up.id).toBe(!!up.rentable);
      if (!up.rentable) expect(verdict.reason).toContain('Lung Daeng won’t let you drill holes in his tuk-tuk');
      if (up.rentable) expect(up.price).toBeLessThanOrEqual(1_500);
    }
  });

  it('fits on-the-spot parts at once and books the cost under upgrades', () => {
    const game = garageGame(42, 3_000);
    const v = game.playerVehicle()!;
    expect(installUpgrade(game, v, 'malai')).toBe(true);
    expect(v.upgrades).toContain('malai');
    expect(game.state.cash).toBe(3_000 - VEHICLE_UPGRADES.malai.price);
    expect(currentBook(game).expense.upgrades).toBe(VEHICLE_UPGRADES.malai.price);
    expect(canInstall(game, v, 'malai')).toEqual({ ok: false, reason: 'Already fitted.' });
    expect(v.task.kind).not.toBe('broken');
  });

  it('sends an owned tuk-tuk to the workshop for parts that take time', () => {
    const game = garageGame();
    const v = playerTukTuk(game, 'lpg_used');
    const up = VEHICLE_UPGRADES.led;
    expect(canInstall(game, v, 'led').ok).toBe(true);
    expect(installUpgrade(game, v, 'led')).toBe(true);
    expect(v.upgrades).not.toContain('led');
    expect(v.task).toMatchObject({ kind: 'broken', work: up.name });
    expect(vehicleJob(game, v)).toMatchObject({ kind: 'fit', item: 'led' });
    expect(canInstall(game, v, 'led').reason).toBe('Being fitted now.');
    expect(canInstall(game, v, 'tyres').reason).toBe('Already in the workshop.');
    // Garlands still go on while it waits.
    expect(canInstall(game, v, 'malai').ok).toBe(true);
    run(game, up.hours! * HOUR - 60, 30);
    expect(v.upgrades).not.toContain('led');
    run(game, 120, 30);
    expect(v.upgrades).toContain('led');
    expect(v.task.kind).toBe('idle');
    expect(garageState(game).jobs).toHaveLength(0);
  });

  it('explains every other refusal', () => {
    const game = garageGame(42, 100);
    const v = playerTukTuk(game, 'lpg_used');
    expect(canInstall(game, v, 'tyres').reason).toBe('Needs ฿3,200 — you have ฿100.');
    expect(canInstall(game, v, 'nope').reason).toBe('Unknown part.');
    const ev = playerTukTuk(game, 'ev_new');
    game.state.cash = 1_000_000;
    expect(canInstall(game, ev, 'tune').reason).toContain('Only for LPG engines');
    expect(canInstall(game, ev, 'mountain_gear').ok).toBe(false);
    // A passenger on board: finish the ride before the workshop.
    const leased = playerTukTuk(game, 'lpg_used', 'leased');
    const req = makeRequest(game, landmark('tha_phae_gate'), landmark('maya'), 'backpacker', 'street', calendar(game.state.time));
    leased.task = { kind: 'trip', trip: { request: req, fare: 100, ratio: 1, startedAt: game.state.time, distance: req.distance } };
    expect(canInstall(game, leased, 'tyres').reason).toBe('Drop off the passenger first.');
    expect(canInstall(game, leased, 'malai').ok).toBe(true);
  });

  it('makes upgrades change speed, sight and breakdowns', () => {
    const game = garageGame();
    const v = playerTukTuk(game, 'lpg_used');
    const before = breakdownPerDay(game, v);
    const sight = game.sightRadius(v);
    v.upgrades.push('tune', 'phone_mount');
    expect(breakdownPerDay(game, v)).toBeCloseTo(before * VEHICLE_UPGRADES.tune.reliability!, 10);
    expect(game.sightRadius(v)).toBeCloseTo(sight * VEHICLE_UPGRADES.phone_mount.sight!, 6);
  });
});

describe('rating modifiers', () => {
  const gate = landmark('tha_phae_gate');
  const maya = landmark('maya');
  const nightlife = world.places.find((p) => p.cat === 'nightlife' && Math.hypot(p.x - gate.x, p.y - gate.y) > 1_500)!;
  const airport = landmark('cnx_airport');

  it('rates upgrades per passenger archetype', () => {
    const game = garageGame();
    const v = playerTukTuk(game, 'lpg_used');
    const bonus = (arch: Archetype, at = DAY2_NOON) => garageRatingBonus(game, v, tripAt(game, gate, maya, arch, at));
    expect(bonus('backpacker')).toBe(0);
    v.upgrades.push('speaker');
    expect(bonus('backpacker')).toBeCloseTo(VEHICLE_UPGRADES.speaker.fans!.backpacker!, 10);
    expect(bonus('retiree')).toBeLessThan(0);
    expect(bonus('monk')).toBeLessThan(bonus('retiree'));
    v.upgrades = ['qr_pay'];
    expect(bonus('tourist_cn')).toBeGreaterThan(bonus('tourist_west'));
  });

  it('counts night effects only after dark, and nightlife and hub runs only on those trips', () => {
    const game = garageGame();
    const v = playerTukTuk(game, 'lpg_used');
    v.upgrades.push('led');
    const led = VEHICLE_UPGRADES.led;
    expect(garageRatingBonus(game, v, tripAt(game, gate, maya, 'student', DAY2_NOON))).toBe(0);
    expect(garageRatingBonus(game, v, tripAt(game, gate, maya, 'student', DAY2_NIGHT))).toBeCloseTo(led.nightFans!.student!, 10);
    expect(garageRatingBonus(game, v, tripAt(game, gate, nightlife, 'student', DAY2_NIGHT))).toBeCloseTo(
      led.nightFans!.student! + led.nightlife!,
      10,
    );
    v.upgrades = ['luggage_rack'];
    const rack = VEHICLE_UPGRADES.luggage_rack;
    expect(garageRatingBonus(game, v, tripAt(game, airport, gate, 'business', DAY2_NOON))).toBeCloseTo(rack.hubs!, 10);
    expect(garageRatingBonus(game, v, tripAt(game, maya, gate, 'business', DAY2_NOON))).toBe(0);
  });

  it('adds the livery’s comfort, and reaches trips through game.ratingModifiers', () => {
    const game = garageGame();
    const v = playerTukTuk(game, 'lpg_used');
    const trip = tripAt(game, gate, maya, 'backpacker', DAY2_NOON);
    const total = () => game.ratingModifiers.reduce((sum, m) => sum + m(v, trip), 0);
    expect(total()).toBe(0);
    v.paint = 'khom_loi';
    expect(total()).toBeCloseTo(PAINTS.khom_loi.comfort, 10);
    v.upgrades.push('speaker');
    expect(total()).toBeCloseTo(PAINTS.khom_loi.comfort + VEHICLE_UPGRADES.speaker.fans!.backpacker!, 10);
  });
});

describe('service & repair', () => {
  it('costs (100 − condition) × 45 and takes 1–3 hours', () => {
    const at = (condition: number) => serviceQuote({ condition } as Vehicle);
    expect(at(62)).toMatchObject({ points: 38, cost: 38 * SERVICE_THB_PER_POINT });
    expect(at(62).hours).toBeCloseTo(1.76, 10);
    expect(at(0)).toEqual({ points: 100, cost: 100 * SERVICE_THB_PER_POINT, hours: 3 });
    expect(at(99.5).points).toBe(1);
    expect(at(99.5).hours).toBeCloseTo(1.02, 10);
    expect(at(100)).toEqual({ points: 0, cost: 0, hours: 1 });
  });

  it('takes the tuk-tuk off the road, then brings it back at 100 %', () => {
    const game = garageGame(42, 5_000);
    const v = game.playerVehicle()!;
    expect(v.condition).toBe(62);
    const q = serviceQuote(v);
    expect(canService(game, v).ok).toBe(true);
    expect(startService(game, v)).toBe(true);
    expect(game.state.cash).toBe(5_000 - q.cost);
    expect(currentBook(game).expense.maintenance).toBe(q.cost);
    expect(v.task).toMatchObject({ kind: 'broken', work: 'service & repair' });
    expect(game.playerDriveTo(0, 0)).toBe(false);
    expect(canService(game, v).reason).toBe('Already in the workshop.');
    run(game, q.hours * HOUR - 60, 30);
    expect(v.condition).toBe(62);
    const noticesBefore = game.state.notices.length;
    run(game, 120, 30);
    expect(v.condition).toBe(100);
    expect(v.task.kind).toBe('idle');
    const fresh = game.state.notices.slice(noticesBefore).map((n) => n.text);
    expect(fresh.some((t) => t.includes('serviced'))).toBe(true);
    expect(fresh.some((t) => t.includes('fixed and back on the road'))).toBe(false);
    expect(canService(game, v).reason).toBe('In top shape: nothing to fix.');
  });

  it('won’t start when the tuk-tuk is broken down or money is short', () => {
    const game = garageGame(42, 100);
    const v = game.playerVehicle()!;
    expect(canService(game, v).reason).toMatch(/^Needs ฿1,710/);
    game.state.cash = 10_000;
    v.task = { kind: 'broken', until: game.state.time + HOUR };
    expect(canService(game, v).reason).toBe('Broken down: the mechanic is already on it.');
    expect(startService(game, v)).toBe(false);
  });

  it('services hired drivers’ worn tuk-tuks after their shift when the policy is on', () => {
    const game = garageGame();
    const worn = game.spawnVehicle('lpg_used', landmark('maya').node, { condition: 50 });
    const fine = game.spawnVehicle('lpg_used', landmark('maya').node, { condition: 90 });
    // 06:30: a night-shift driver is off duty.
    hire(game, worn, 'night');
    hire(game, fine, 'night');
    game.playerVehicle()!.condition = 10;
    run(game, 2 * MINUTE);
    expect(worn.task.kind).toBe('offduty');
    expect(vehicleJob(game, worn)).toBeUndefined();
    setAutoService(game, 60);
    run(game, 2 * MINUTE);
    expect(vehicleJob(game, worn)?.kind).toBe('service');
    expect(vehicleJob(game, fine)).toBeUndefined();
    // The player's own tuk-tuk is theirs to look after.
    expect(vehicleJob(game, game.playerVehicle()!)).toBeUndefined();
    run(game, 3 * HOUR);
    expect(worn.condition).toBe(100);
    expect(worn.task.kind).toBe('offduty');
  });

  it('warns once when a tuk-tuk wears out, unless the service policy will send it in', () => {
    const game = garageGame();
    const warnings = () => game.state.notices.filter((n) => n.text.includes('worn out')).map((n) => n.text);
    const own = game.playerVehicle()!;
    const hired = game.spawnVehicle('lpg_used', landmark('maya').node, { condition: 90 });
    hire(game, hired, 'night');
    own.condition = WORN_WARNING + 1;
    run(game, 2 * MINUTE);
    expect(warnings()).toEqual([]);
    own.condition = WORN_WARNING - 1;
    hired.condition = WORN_WARNING - 1;
    run(game, 5 * MINUTE);
    // Both warn (the policy is off), each once.
    expect(warnings().length).toBe(2);
    expect(warnings()[0]).toContain(own.name);
    // Serviced back up, then worn down again: a fresh warning for the player's own tuk-tuk only,
    // since the hired one is now covered by the policy.
    setAutoService(game, 40);
    own.condition = 100;
    hired.condition = 100;
    run(game, 2 * MINUTE);
    own.condition = WORN_WARNING - 5;
    hired.condition = WORN_WARNING - 5;
    run(game, 2 * MINUTE);
    expect(warnings().length).toBe(3);
    expect(warnings()[2]).toContain(own.name);
  });
});

describe('paint shop', () => {
  it('repaints owned tuk-tuks after the paint dries; the rented one stays blue', () => {
    const game = garageGame();
    const rented = game.playerVehicle()!;
    expect(canRepaint(game, rented, 'khao_soi').reason).toContain('Lung Daeng');
    const v = playerTukTuk(game, 'lpg_used');
    expect(canRepaint(game, v, 'nakhon_blue').reason).toBe('This is its livery already.');
    const cash = game.state.cash;
    expect(repaint(game, v, 'songkran_splash')).toBe(true);
    expect(game.state.cash).toBe(cash - repaintCost('songkran_splash'));
    expect(v.paint).toBe('nakhon_blue');
    run(game, PAINT_HOURS * HOUR + 60, 30);
    expect(v.paint).toBe('songkran_splash');
    expect(repaintCost('nakhon_blue')).toBeGreaterThan(0);
  });
});

describe('EV conversion kit', () => {
  it('turns an owned LPG tuk-tuk electric after a day in the workshop', () => {
    const game = garageGame();
    const v = playerTukTuk(game, 'lpg_used');
    v.upgrades.push('tune', 'mountain_gear', 'cushions');
    v.fuel = 0.4;
    v.condition = 70;
    const target = evConversionModel(v)!;
    expect(target.powertrain).toBe('ev');
    expect(target.convertedFrom).toBe('lpg_used');
    expect(target.seats).toBe(VEHICLE_MODELS.lpg_used.seats);
    const cash = game.state.cash;
    expect(startEvConversion(game, v)).toBe(true);
    expect(game.state.cash).toBe(cash - EV_KIT_PRICE);
    expect(v.task).toMatchObject({ kind: 'broken', work: 'EV conversion' });
    run(game, (EV_CONVERSION_HOURS - 1) * HOUR, 60);
    expect(v.model).toBe('lpg_used');
    run(game, 2 * HOUR, 60);
    expect(v.model).toBe(target.id);
    expect(v.fuel).toBe(1);
    expect(v.condition).toBe(100);
    expect(v.purchasePrice).toBe(VEHICLE_MODELS.lpg_used.price + EV_KIT_PRICE);
    expect(v.upgrades).toEqual(['cushions']);
    expect(vehicleClimbs(v)).toBe(true);
    expect(canConvertToEv(game, v).reason).toBe('Already electric.');
  });

  it('has a conversion for every LPG model, and none for rented or leased tuk-tuks', () => {
    const game = garageGame();
    for (const m of Object.values(VEHICLE_MODELS)) {
      if (m.powertrain !== 'lpg') continue;
      expect(evConversionModel({ model: m.id } as Vehicle)?.convertedFrom).toBe(m.id);
    }
    expect(canConvertToEv(game, game.playerVehicle()!).reason).toContain('Lung Daeng');
    expect(canConvertToEv(game, playerTukTuk(game, 'lpg_used', 'leased')).reason).toContain('hire-purchase');
    game.state.cash = 1_000;
    expect(canConvertToEv(game, playerTukTuk(game, 'rusty')).reason).toMatch(/^Needs ฿200,000/);
  });
});

describe('the Doi Suthep climb', () => {
  it('knows which places are up the mountain', () => {
    for (const id of ['wat_doi_suthep', 'bhubing_palace', 'wat_pha_lat']) expect(isUpDoiSuthep(world, landmark(id)), id).toBe(true);
    for (const id of ['chiang_mai_zoo', 'huay_kaew_waterfall', 'cmu_main_gate', 'night_safari', 'tha_phae_gate', 'cnx_airport']) {
      expect(isUpDoiSuthep(world, landmark(id)), id).toBe(false);
    }
  });

  it('lets EVs and rebuilt LPG tuk-tuks climb, not plain LPG ones', () => {
    const game = garageGame();
    const req = makeRequest(game, landmark('tha_phae_gate'), landmark('wat_doi_suthep'), 'thai_tourist', 'street', calendar(game.state.time));
    const town = makeRequest(game, landmark('tha_phae_gate'), landmark('maya'), 'thai_tourist', 'street', calendar(game.state.time));
    expect(requestClimbs(world, req)).toBe(true);
    expect(requestClimbs(world, town)).toBe(false);
    const rusty = game.playerVehicle()!;
    expect(climbBlocked(game, rusty, req)).toBe(true);
    expect(climbBlocked(game, rusty, town)).toBe(false);
    expect(climbBlocked(game, playerTukTuk(game, 'ev_used'), req)).toBe(false);
    const rebuilt = playerTukTuk(game, 'lpg_used');
    expect(climbBlocked(game, rebuilt, req)).toBe(true);
    rebuilt.upgrades.push('mountain_gear');
    expect(climbBlocked(game, rebuilt, req)).toBe(false);
  });

  it('keeps AI drivers off rides their tuk-tuk can’t climb', () => {
    const game = garageGame();
    game.state.autopilot = true;
    const rusty = game.playerVehicle()!;
    const ride = waitingRide(game, landmark('tha_phae_gate'), landmark('wat_doi_suthep'));
    run(game, 2 * MINUTE);
    expect(ride.claimedBy).toBeNull();
    expect(rusty.task.kind).not.toBe('pickup');
    // The same ride in town gets taken at once.
    const town = waitingRide(game, landmark('tha_phae_gate'), landmark('maya'));
    run(game, 2 * MINUTE);
    expect(town.claimedBy).toBe(rusty.id);
  });

  it('lets AI drivers take the climb once the mountain rebuild is fitted, and in an EV', () => {
    const game = garageGame();
    game.state.autopilot = true;
    const v = playerTukTuk(game, 'lpg_used');
    expect(installUpgrade(game, v, 'mountain_gear')).toBe(true);
    const ride = waitingRide(game, landmark('tha_phae_gate'), landmark('wat_doi_suthep'), 10 * HOUR);
    run(game, VEHICLE_UPGRADES.mountain_gear.hours! * HOUR - MINUTE, 30);
    expect(ride.claimedBy).toBeNull();
    run(game, 3 * MINUTE);
    expect(v.upgrades).toContain('mountain_gear');
    expect(ride.claimedBy).toBe(v.id);

    const evGame = garageGame(7);
    evGame.state.autopilot = true;
    const ev = playerTukTuk(evGame, 'ev_used');
    const evRide = waitingRide(evGame, landmark('tha_phae_gate'), landmark('bhubing_palace'));
    run(evGame, 2 * MINUTE);
    expect(evRide.claimedBy).toBe(ev.id);
  });

  it('refuses the player’s claim with the reason', () => {
    const game = garageGame();
    const ride = waitingRide(game, landmark('wat_pha_lat'), landmark('tha_phae_gate'));
    expect(game.playerClaim(ride.id)).toBe(false);
    expect(game.state.notices.at(-1)?.text).toBe(CLIMB_BLOCKED_TEXT);
    expect(ride.claimedBy).toBeNull();
    expect(game.playerVehicle()!.task.kind).toBe('idle');
  });
});

describe('saves', () => {
  it('loads a save made before the garage existed', () => {
    const game = Game.create(world, { seed: 3 });
    const state = JSON.parse(game.serialize());
    delete state.systems[GARAGE_ID];
    const loaded = Game.load(world, state);
    installSystems(loaded);
    // The same defaults a brand-new game starts with.
    expect(garageState(loaded)).toEqual(garageState(garageGame()));
    run(loaded, 10 * MINUTE);
    expect(loaded.state.time).toBeGreaterThan(game.state.time);
  });

  it('round-trips a game with a job in the workshop', () => {
    const game = Game.create(world, { seed: 11 });
    installSystems(game);
    game.state.autopilot = true;
    run(game, HOUR);
    const v = game.playerVehicle()!;
    // Wait for a moment between rides.
    for (let i = 0; i < 120 && (v.task.kind === 'trip' || v.task.kind === 'haggle' || v.task.kind === 'broken'); i++) run(game, MINUTE);
    game.state.cash = Math.max(game.state.cash, 10_000);
    v.condition = 40;
    expect(startService(game, v)).toBe(true);
    setAutoService(game, 80);
    const copy = Game.load(world, JSON.parse(game.serialize()));
    installSystems(copy);
    expect(garageState(copy)).toEqual(garageState(game));
    run(game, 3 * HOUR);
    run(copy, 3 * HOUR);
    expect(copy.playerVehicle()!.condition).toBe(game.playerVehicle()!.condition);
    expect(game.playerVehicle()!.task.kind).not.toBe('broken');
    expect(copy.state.cash).toBe(game.state.cash);
    expect(copy.state.stats.trips).toBe(game.state.stats.trips);
  });
});
