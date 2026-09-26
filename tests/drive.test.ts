import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VEHICLE_MODELS } from '../src/content/vehicles';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { BALANCE } from '../src/sim/balance';
import { BASE_TIME_SCALE, calendar } from '../src/sim/clock';
import { makeRequest } from '../src/sim/demand';
import {
  AUTODRIVE_TIME_SCALE,
  AWAY_TIME_SCALE,
  DRIVE_IDLE_TIME_SCALE,
  DRIVE_TIME_SCALE,
  DriveClock,
  clockLabel,
  driveClockTarget,
  type PlayMode,
} from '../src/sim/driveClock';
import { fleetState, hireCandidate, rentVehicle } from '../src/sim/fleet';
import { Game } from '../src/sim/game';
import type { GraphJSON } from '../src/sim/graph';
import { dispatchNearest } from '../src/sim/manage';
import {
  PICKUP_RADIUS_M,
  WALK_OVER_S,
  kerbPoint,
  kerbsidePassenger,
  manualControl,
  manualInteract,
  manualPickup,
  manualRefuel,
  pumpNearby,
  setAutodrive,
  setManual,
  setPedals,
  uTurn,
  whoDrives,
} from '../src/sim/manual';
import { installSystems } from '../src/sim/systems';
import type { Place, RideRequest, Vehicle } from '../src/sim/types';
import { applyMode, initialMode } from '../src/ui/mode';
import { ui } from '../src/ui/store';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));
const graph = world.graph;
const landmark = (id: string): Place => world.landmarks.find((l) => l.id === id)!;

function newGame(seed = 7): Game {
  const game = Game.create(world, { seed });
  installSystems(game);
  game.state.requests = [];
  return game;
}

/** Park a vehicle `back` metres before a node, on an arc that ends there, stopped. */
function parkBefore(v: Vehicle, node: number, back = 5): void {
  let arc = -1;
  for (let a = 0; a < graph.edges.length * 2; a++) {
    if (graph.arcValid(a) && graph.arcTo(a) === node && graph.arcLen(a) > back + 2 && !graph.edges[a >> 1].virtual) {
      arc = a;
      break;
    }
  }
  expect(arc).toBeGreaterThanOrEqual(0);
  v.arc = arc;
  v.s = graph.arcLen(arc) - back;
  v.speed = 0;
  v.route = null;
  v.busyUntil = 0;
}

/** A street passenger waiting at a place near Tha Phae Gate, going to Wat Chedi Luang. */
function waitingAt(game: Game, from: Place, channel: RideRequest['channel'] = 'street'): RideRequest {
  const req = makeRequest(game, from, landmark('wat_chedi_luang'), 'tourist_west', channel, calendar(game.state.time));
  game.state.requests.push(req);
  return req;
}

/** A place a few hundred metres from the gate whose kerb is right beside its road node. */
function kerbPlace(): Place {
  const gate = landmark('tha_phae_gate');
  return world.places.find(
    (p) =>
      !p.landmark &&
      !p.offmap &&
      p.cat !== 'fuel' &&
      Math.hypot(p.x - gate.x, p.y - gate.y) < 700 &&
      Math.hypot(p.x - graph.nodeX[p.node], p.y - graph.nodeY[p.node]) < 30,
  )!;
}

describe('drive clock', () => {
  it('runs at the driving pace while steering, 1× when parked, loading or on GPS, and fast out of town', () => {
    const game = newGame();
    const v = game.playerVehicle()!;
    setManual(game, true);
    const at = (mode: PlayMode = 'drive', pace?: number) => driveClockTarget(game, mode, pace);
    // Stopped, nothing to do and nobody in sight: waiting at 1×.
    expect(at()).toBe(DRIVE_IDLE_TIME_SCALE);
    // A passenger in sight: the street-level pace, or the chosen one.
    const place = kerbPlace();
    waitingAt(game, place);
    expect(at()).toBe(DRIVE_TIME_SCALE);
    expect(at('drive', 5)).toBe(5);
    // Throttle with nobody in sight still drives at the street-level pace.
    game.state.requests = [];
    setPedals(game, true, false);
    expect(at()).toBe(DRIVE_TIME_SCALE);
    setPedals(game, false, false);
    // Loading passengers or fuel.
    v.busyUntil = game.state.time + 60;
    expect(at()).toBe(DRIVE_IDLE_TIME_SCALE);
    v.busyUntil = 0;
    // Out of town, or off the road for repairs.
    v.task = { kind: 'away', until: game.state.time + 3600, trip: null, portal: 0 };
    expect(at()).toBe(AWAY_TIME_SCALE);
    v.task = { kind: 'broken', until: game.state.time + 3600 };
    expect(at()).toBe(AWAY_TIME_SCALE);
    v.task = { kind: 'idle' };
    // The GPS drives at 1×.
    setManual(game, false);
    expect(at()).toBe(AUTODRIVE_TIME_SCALE);
    // Manage mode: the speed buttons rule.
    expect(at('manage')).toBeNull();
  });

  it('eases to the target and still stops for the pause button and the haggle', () => {
    const game = newGame();
    setManual(game, true);
    waitingAt(game, kerbPlace());
    let mode: PlayMode = 'drive';
    const clock = new DriveClock(game, { mode: () => mode, pace: () => DRIVE_TIME_SCALE });
    const off = clock.install();
    game.setSpeed(2);
    expect(game.timeScale).toBe(DRIVE_TIME_SCALE);
    // The first tick starts from the speed buttons' pace (1× here) and glides down.
    clock.tick(0.05);
    expect(clock.current!).toBeLessThan(BASE_TIME_SCALE);
    expect(clock.current!).toBeGreaterThan(DRIVE_TIME_SCALE * 1.5);
    for (let t = 0; t < 0.35; t += 0.05) clock.tick(0.05);
    expect(clock.current!).toBeLessThan(DRIVE_TIME_SCALE * 1.15);
    for (let t = 0; t < 1; t += 0.05) clock.tick(0.05);
    expect(game.timeScale).toBe(DRIVE_TIME_SCALE);
    game.setSpeed(0);
    expect(game.timeScale).toBe(0);
    game.setSpeed(2);
    game.pause('haggle');
    expect(game.timeScale).toBe(0);
    game.resume('haggle');
    expect(game.timeScale).toBe(DRIVE_TIME_SCALE);
    mode = 'manage';
    expect(game.timeScale).toBe(BASE_TIME_SCALE);
    off();
    expect(game.clockOverride).toBeNull();
  });

  it('labels paces as fractions of 1×', () => {
    expect(clockLabel(4)).toBe('⅛×');
    expect(clockLabel(3)).toBe('⅒×');
    expect(clockLabel(5)).toBe('⅙×');
    expect(clockLabel(30)).toBe('1×');
    expect(clockLabel(240)).toBe('8×');
  });
});

describe('picking up by hand', () => {
  it('stops within reach, the passenger walks over and the haggle starts', () => {
    const game = newGame();
    const v = game.playerVehicle()!;
    setManual(game, true);
    const place = kerbPlace();
    const req = waitingAt(game, place);
    parkBefore(v, place.node);
    const k = kerbPoint(game, place);
    const pose = game.vehiclePose(v);
    expect(Math.hypot(k.x - pose.x, k.y - pose.y)).toBeLessThan(PICKUP_RADIUS_M);
    let haggle: { requestId: number } | null = null;
    game.on('haggle', (p: { requestId: number }) => (haggle = p));
    expect(manualPickup(game)).toBe('walking');
    expect(req.claimedBy).toBe(v.id);
    expect(v.task).toEqual({ kind: 'pickup', requestId: req.id });
    game.step(WALK_OVER_S / 2);
    expect(haggle).toBeNull();
    game.step(WALK_OVER_S / 2 + 1);
    expect(haggle).toEqual({ vehicleId: v.id, requestId: req.id });
    expect(v.task.kind).toBe('haggle');
    expect(game.isPaused('haggle')).toBe(true);
  });

  it('boards a fixed-fare booking without haggling', () => {
    const game = newGame();
    const v = game.playerVehicle()!;
    setManual(game, true);
    const place = kerbPlace();
    const req = waitingAt(game, place, 'hotel');
    req.fixedFare = 150;
    parkBefore(v, place.node);
    let haggled = false;
    game.on('haggle', () => (haggled = true));
    expect(manualInteract(game)).toBe('walking');
    game.step(WALK_OVER_S + 1);
    expect(haggled).toBe(false);
    expect(v.task.kind).toBe('trip');
    expect(v.task.kind === 'trip' && v.task.trip.fare).toBe(150);
  });

  it('needs the tuk-tuk slow, close and free, and leaves other tuk-tuks’ passengers alone', () => {
    const game = newGame();
    const v = game.playerVehicle()!;
    setManual(game, true);
    const place = kerbPlace();
    const req = waitingAt(game, place);
    parkBefore(v, place.node);
    v.speed = 5;
    expect(manualPickup(game)).toBe('moving');
    v.speed = 0;
    req.claimedBy = 9_999;
    expect(manualPickup(game)).toBe('none');
    req.claimedBy = null;
    parkBefore(v, landmark('wat_chedi_luang').node);
    const far = game.vehiclePose(v);
    const k = kerbPoint(game, place);
    expect(Math.hypot(k.x - far.x, k.y - far.y)).toBeGreaterThan(PICKUP_RADIUS_M);
    expect(manualPickup(game)).toBe('none');
    parkBefore(v, place.node);
    v.task = { kind: 'broken', until: game.state.time + 3600 };
    expect(manualPickup(game)).toBe('busy');
  });

  it('leaves a party too big for the tuk-tuk at the kerb and takes one that fits', () => {
    const game = newGame();
    const v = game.playerVehicle()!;
    setManual(game, true);
    const place = kerbPlace();
    const four = waitingAt(game, place);
    four.party = 4;
    parkBefore(v, place.node);
    // Rolling past, the first thing to do is stop.
    v.speed = 5;
    expect(manualInteract(game)).toBe('moving');
    expect(game.state.notices.at(-1)!.text).toBe('Slow right down and stop at the kerb first.');
    v.speed = 0;
    expect(manualInteract(game)).toBe('seats');
    expect(game.state.notices.at(-1)!.text).toBe('A party of 4 won’t fit in a 3-seat tuk-tuk.');
    expect(four.claimedBy).toBeNull();
    expect(v.task.kind).toBe('idle');
    const pair = waitingAt(game, place);
    pair.party = 2;
    expect(manualPickup(game)).toBe('walking');
    expect(pair.claimedBy).toBe(v.id);
    expect(four.claimedBy).toBeNull();
  });

  it('a passenger walking over when the game is saved reaches the haggle after loading', () => {
    const game = newGame();
    const v = game.playerVehicle()!;
    setManual(game, true);
    const place = kerbPlace();
    const req = waitingAt(game, place);
    req.party = 2;
    parkBefore(v, place.node);
    expect(manualPickup(game)).toBe('walking');
    game.step(WALK_OVER_S / 2);

    const loaded = Game.load(world, JSON.parse(game.serialize()));
    installSystems(loaded);
    let haggle: { requestId: number } | null = null;
    loaded.on('haggle', (p: { requestId: number }) => (haggle = p));
    loaded.step(WALK_OVER_S / 2 - 1);
    expect(haggle).toBeNull();
    loaded.step(2);
    expect(haggle).toEqual({ vehicleId: v.id, requestId: req.id });
    expect(loaded.playerVehicle()!.task.kind).toBe('haggle');
    expect(loaded.isPaused('haggle')).toBe(true);
  });

  it('fills up at a pump with a party too big to carry waiting beside it, as the prompt says', () => {
    const game = newGame();
    const v = game.playerVehicle()!;
    setManual(game, true);
    // A pump with a place's kerb in reach of a tuk-tuk stopped at it.
    let crowdAt: Place | undefined;
    const pump = world.lpgStations.find((s) => {
      parkBefore(v, s.node, 1);
      const pose = game.vehiclePose(v);
      crowdAt = world.places.find((p) => {
        const k = kerbPoint(game, p);
        return !p.offmap && !p.lpg && Math.hypot(k.x - pose.x, k.y - pose.y) < PICKUP_RADIUS_M - 5;
      });
      return !!crowdAt;
    });
    expect(pump).toBeDefined();
    const four = waitingAt(game, crowdAt!);
    four.party = 4;
    v.fuel = 0.4;
    // The drive HUD offers "E  fill up": nobody it could pick up, a pump beside it.
    expect(kerbsidePassenger(game, v)).toBeNull();
    expect(kerbsidePassenger(game, v, true)).toBe(four);
    expect(pumpNearby(game, v)).not.toBeNull();
    expect(manualInteract(game)).toBe('filling');
    expect(v.fuel).toBe(1);
    expect(four.claimedBy).toBeNull();
  });

  it('fills up when stopped beside a pump', () => {
    const game = newGame();
    const v = game.playerVehicle()!;
    setManual(game, true);
    const pump = world.lpgStations[0];
    parkBefore(v, pump.node, 3);
    v.fuel = 0.3;
    const cash = game.state.cash;
    expect(manualRefuel(game)).toBe('filling');
    expect(v.fuel).toBe(1);
    expect(game.state.cash).toBeLessThan(cash);
    expect(v.busyUntil).toBeGreaterThan(game.state.time);
  });

  it('charges an electric tuk-tuk by hand at a mall charger at the public DC rate', () => {
    const game = newGame();
    const v = game.playerVehicle()!;
    v.model = 'ev_new';
    setManual(game, true);
    const mall = landmark('central_airport');
    expect(game.chargers()).toContain(mall);
    parkBefore(v, mall.node, 3);
    v.fuel = 0.3;
    const cash = game.state.cash;
    expect(manualRefuel(game)).toBe('filling');
    expect(v.fuel).toBe(1);
    const km = 0.7 * VEHICLE_MODELS.ev_new.rangeKm;
    expect(game.state.cash).toBe(cash - Math.round(km * BALANCE.fuel.evPublicPerKm));
  });

  it('U-turns from a standstill on two-way roads only', () => {
    const game = newGame();
    const v = game.playerVehicle()!;
    setManual(game, true);
    const twoWay = graph.edges.findIndex((e) => !e.oneway && !e.virtual && e.len > 60);
    v.arc = twoWay * 2;
    v.s = 20;
    v.speed = 0;
    v.busyUntil = 0;
    expect(uTurn(game)).toBe(true);
    expect(v.arc).toBe(twoWay * 2 + 1);
    expect(v.s).toBeCloseTo(graph.edges[twoWay].len - 20);
    const oneWay = graph.edges.findIndex((e) => e.oneway && !e.virtual && e.len > 60);
    v.arc = oneWay * 2;
    v.s = 20;
    expect(uTurn(game)).toBe(false);
    v.arc = twoWay * 2;
    v.speed = 8;
    expect(uTurn(game)).toBe(false);
  });

  it('counts each press of the throttle or brake', () => {
    const game = newGame();
    setManual(game, true);
    const c = manualControl(game);
    const start = c.presses;
    setPedals(game, true, false);
    setPedals(game, true, false);
    expect(c.presses).toBe(start + 1);
    setPedals(game, true, true);
    setPedals(game, false, false);
    setPedals(game, true, false);
    expect(c.presses).toBe(start + 3);
  });

  it('G hands the wheel to the GPS, or to autopilot with nowhere to go, and takes it back', () => {
    const game = newGame();
    setManual(game, true);
    expect(whoDrives(game)).toBe('hand');
    expect(setAutodrive(game, true)).toBe('autopilot');
    expect(manualControl(game).on).toBe(false);
    expect(setAutodrive(game, false)).toBe('hand');
    expect(game.state.autopilot).toBe(false);
    const req = waitingAt(game, kerbPlace());
    expect(game.playerClaim(req.id)).toBe(true);
    expect(setAutodrive(game, true)).toBe('gps');
    expect(game.state.autopilot).toBe(false);
  });
});

describe('drive and manage modes', () => {
  it('opens in Drive with one tuk-tuk and in Manage with a fleet', () => {
    const game = newGame();
    expect(initialMode(game)).toBe('drive');
    rentVehicle(game);
    expect(initialMode(game)).toBe('manage');
  });

  it('Manage hands your tuk-tuk to autopilot; Drive puts it back in your hands; neither during a haggle', () => {
    const game = newGame();
    ui.set({ haggle: null, mode: 'drive' });
    expect(applyMode(game, 'drive')).toBe(true);
    expect(manualControl(game).on).toBe(true);
    expect(game.state.autopilot).toBe(false);
    expect(applyMode(game, 'manage')).toBe(true);
    expect(ui.get().mode).toBe('manage');
    expect(game.state.autopilot).toBe(true);
    expect(manualControl(game).on).toBe(false);
    expect(applyMode(game, 'drive')).toBe(true);
    expect(ui.get().mode).toBe('drive');
    expect(game.state.autopilot).toBe(false);
    expect(manualControl(game).on).toBe(true);
    ui.set({ haggle: { vehicleId: game.playerVehicle()!.id, requestId: 1 } });
    expect(applyMode(game, 'manage')).toBe(false);
    expect(ui.get().mode).toBe('drive');
    ui.set({ haggle: null });
  });
});

describe('dispatching the fleet', () => {
  it('sends the nearest free hired tuk-tuk to a waiting passenger', () => {
    const game = newGame();
    // Past the rides drivers want to see before they join.
    game.state.stats.trips = 5;
    const near = rentVehicle(game)!;
    const far = rentVehicle(game)!;
    const roster = fleetState(game).candidates.map((c) => c.roster);
    expect(hireCandidate(game, roster[0], 'salary', near.id)).not.toBeNull();
    expect(hireCandidate(game, roster[1], 'salary', far.id)).not.toBeNull();
    const place = kerbPlace();
    parkBefore(near, place.node, 40);
    parkBefore(far, landmark('wat_chedi_luang').node, 40);
    const req = waitingAt(game, place);
    expect(dispatchNearest(game, req.id)).toBe(near);
    expect(req.claimedBy).toBe(near.id);
    expect(near.task).toEqual({ kind: 'pickup', requestId: req.id });
    expect(dispatchNearest(game, req.id)).toBeNull();
  });
});
