import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VEHICLE_MODELS } from '../src/content/vehicles';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { BALANCE } from '../src/sim/balance';
import { calendar } from '../src/sim/clock';
import { makeRequest } from '../src/sim/demand';
import { currentBook } from '../src/sim/economy';
import { Game } from '../src/sim/game';
import type { GraphJSON } from '../src/sim/graph';
import { chooseExit, exitsAt, manualControl, manualRating, pickTurn, previewTurn, setManual, setPedals } from '../src/sim/manual';
import { sendTo } from '../src/sim/movement';
import { installSystems } from '../src/sim/systems';
import type { Trip } from '../src/sim/types';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));
const graph = world.graph;
const gate = world.landmarks.find((l) => l.id === 'tha_phae_gate')!;

/** An arc arriving at a real junction near Tha Phae Gate with a left, a right and a straight exit. */
function crossroadsNearGate(): number {
  let best = -1;
  let bestD = Infinity;
  for (let arc = 0; arc < graph.edges.length * 2; arc++) {
    if (!graph.arcValid(arc)) continue;
    const node = graph.arcTo(arc);
    const d = Math.hypot(graph.nodeX[node] - gate.x, graph.nodeY[node] - gate.y);
    if (d > 400 || d >= bestD || graph.arcLen(arc) < 30) continue;
    const kinds = new Set(exitsAt(graph, arc).map((e) => e.kind));
    if (kinds.has('left') && kinds.has('right') && kinds.has('straight')) {
      best = arc;
      bestD = d;
    }
  }
  return best;
}

function newGame(seed = 3): Game {
  const game = Game.create(world, { seed });
  installSystems(game);
  return game;
}

describe('manual driving', () => {
  const inArc = crossroadsNearGate();

  it('finds a crossroads by Tha Phae Gate', () => {
    expect(inArc).toBeGreaterThanOrEqual(0);
  });

  it('picks the left-most, right-most, straight or GPS exit at a junction', () => {
    const exits = exitsAt(graph, inArc);
    const maxDelta = Math.max(...exits.map((e) => e.delta));
    const minDelta = Math.min(...exits.map((e) => e.delta));
    const left = chooseExit(graph, inArc, 'left', -1)!;
    const right = chooseExit(graph, inArc, 'right', -1)!;
    const straight = chooseExit(graph, inArc, null, -1)!;
    expect(left.kind).toBe('left');
    expect(left.delta).toBe(maxDelta);
    expect(left.usedTurn).toBe(true);
    expect(right.kind).toBe('right');
    expect(right.delta).toBe(minDelta);
    expect(straight.kind).toBe('straight');
    expect(straight.usedTurn).toBe(false);
    // With no turn chosen, the GPS route's next arc wins over straight on.
    expect(chooseExit(graph, inArc, null, right.arc)!.arc).toBe(right.arc);
    // A chosen turn wins over the GPS route.
    expect(chooseExit(graph, inArc, 'left', right.arc)!.arc).toBe(left.arc);
    // Never back the way we came while there is another road.
    for (const e of exits) expect(e.arc).not.toBe(inArc ^ 1);
  });

  it('drives through the junction on the chosen turn and forgets the choice', () => {
    const game = newGame();
    const v = game.playerVehicle()!;
    expect(setManual(game, true)).toBe(true);
    v.route = null;
    v.task = { kind: 'idle' };
    v.busyUntil = 0;
    v.arc = inArc;
    v.s = graph.arcLen(inArc) - 3;
    v.speed = 8;
    pickTurn(game, 'left');
    const expected = chooseExit(graph, inArc, 'left', -1)!.arc;
    expect(previewTurn(game, v)?.exit?.arc).toBe(expected);
    setPedals(game, true, false);
    game.step(1);
    expect(v.arc).toBe(expected);
    expect(manualControl(game).turn).toBeNull();
    // Picking the other side cancels a choice.
    pickTurn(game, 'left');
    pickTurn(game, 'right');
    expect(manualControl(game).turn).toBeNull();
  });

  it('caps speed at 1.15× the road speed and coasts to a stop without throttle', () => {
    const game = newGame();
    const v = game.playerVehicle()!;
    setManual(game, true);
    setPedals(game, true, false);
    let top = 0;
    for (let i = 0; i < 40; i++) {
      game.step(1);
      top = Math.max(top, v.speed);
    }
    expect(top).toBeGreaterThan(3);
    expect(top).toBeLessThanOrEqual(50 / 3.6 * 1.15 + 1e-6);
    setPedals(game, false, false);
    for (let i = 0; i < 30; i++) game.step(1);
    expect(v.speed).toBe(0);
  });

  it('re-plans the GPS route from the junction when the player leaves it', () => {
    const game = newGame();
    const v = game.playerVehicle()!;
    const target = world.landmarks.find((l) => l.id === 'one_nimman')!.node;
    expect(sendTo(game, v, target)).toBe(true);
    const route = v.route!;
    // Find a junction on the route where a different turn is possible.
    let i = 0;
    let turn: 'left' | 'right' | null = null;
    for (; i < route.arcs.length - 2; i++) {
      const exits = exitsAt(graph, route.arcs[i]);
      if (exits.length < 2) continue;
      const next = route.arcs[i + 1];
      const other = exits.find((e) => e.arc !== next && e.kind !== 'straight');
      if (other && chooseExit(graph, route.arcs[i], other.kind as 'left' | 'right', next)!.arc !== next) {
        turn = other.kind as 'left' | 'right';
        break;
      }
    }
    expect(turn).not.toBeNull();
    setManual(game, true);
    v.arc = route.arcs[i];
    v.routeIdx = i;
    v.s = graph.arcLen(v.arc) - 2;
    v.speed = 6;
    pickTurn(game, turn!);
    setPedals(game, true, false);
    game.step(1);
    expect(v.arc).not.toBe(route.arcs[i + 1]);
    expect(v.route).not.toBeNull();
    expect(v.route!.target).toBe(target);
    expect(v.route!.arcs[0]).toBe(v.arc);
    expect(v.routeIdx).toBe(0);
  });

  it('arrives at a passenger by hand and starts the haggle', () => {
    const game = newGame();
    const v = game.playerVehicle()!;
    const pose = game.vehiclePose(v);
    const from = world.places
      .filter((p) => p.cat !== 'fuel')
      .map((p) => ({ p, d: Math.hypot(p.x - pose.x, p.y - pose.y) }))
      .filter((x) => x.d > 150 && x.d < 600)
      .sort((a, b) => a.d - b.d)[0].p;
    const to = world.landmarks.find((l) => l.id === 'wat_chedi_luang')!;
    const req = makeRequest(game, from, to, 'backpacker', 'street', calendar(game.state.time));
    game.state.requests.push(req);
    expect(game.playerClaim(req.id)).toBe(true);
    setManual(game, true);
    setPedals(game, true, false);
    for (let t = 0; t < 600 && v.task.kind === 'pickup'; t++) game.step(1);
    expect(v.task.kind).toBe('haggle');
  });

  it('turns autopilot off when switched on, and hands back to autopilot', () => {
    const game = newGame();
    game.state.autopilot = true;
    setManual(game, true);
    expect(game.state.autopilot).toBe(false);
    game.state.autopilot = true;
    game.step(1);
    expect(manualControl(game).on).toBe(false);
  });

  it('drives to an LPG pump and fills up when the player right-clicks it', () => {
    const game = newGame();
    const v = game.playerVehicle()!;
    const pose = game.vehiclePose(v);
    const pump = [...world.lpgStations].sort((a, b) => Math.hypot(a.x - pose.x, a.y - pose.y) - Math.hypot(b.x - pose.x, b.y - pose.y))[0];
    v.fuel = 0.3;
    expect(game.playerDriveTo(pump.x + 20, pump.y - 15)).toBe(true);
    expect(v.task).toEqual({ kind: 'refuel', place: pump.idx });
    for (let t = 0; t < 3_600 && v.fuel < 1; t++) game.step(1);
    expect(v.fuel).toBe(1);
    // Anywhere else is just a drive.
    expect(game.playerDriveTo(pump.x + 500, pump.y + 500)).toBe(true);
    expect(v.task).toEqual({ kind: 'cruise', place: -1 });
  });

  it('charges an electric tuk-tuk at a mall at the public DC rate', () => {
    const game = newGame();
    const v = game.playerVehicle()!;
    v.model = 'ev_new';
    v.fuel = 0.3;
    expect(game.playerRefuel()).toBe(true);
    expect(v.task.kind).toBe('refuel');
    const mall = game.place((v.task as { place: number }).place);
    expect(mall.cat).toBe('mall');
    let before = v.fuel;
    let spent = 0;
    for (let t = 0; t < 3_600 && v.fuel < 1; t++) {
      before = v.fuel;
      const expense = currentBook(game).expense.fuel ?? 0;
      game.step(1);
      spent = (currentBook(game).expense.fuel ?? 0) - expense;
    }
    expect(v.fuel).toBe(1);
    const km = (1 - before) * VEHICLE_MODELS.ev_new.rangeKm;
    expect(spent / km).toBeCloseTo(BALANCE.fuel.evPublicPerKm, 1);
  });

  it('rates fast manual driving by the passenger’s taste for thrills', () => {
    const game = newGame();
    const v = game.playerVehicle()!;
    setManual(game, true);
    const cal = calendar(game.state.time);
    const rate = manualRating(game);
    const trip = (arch: 'backpacker' | 'elder'): Trip => {
      const req = makeRequest(game, world.places[0], world.places[1], arch, 'street', cal);
      const c = manualControl(game);
      c.trip = req.id;
      c.tripMetres = 2000;
      c.fastMetres = 2000;
      return { request: req, fare: 100, ratio: 1, startedAt: 0, distance: 2000 };
    };
    expect(rate(v, trip('backpacker'))).toBeGreaterThan(0.5);
    expect(rate(v, trip('elder'))).toBeLessThan(-0.5);
  });
});
