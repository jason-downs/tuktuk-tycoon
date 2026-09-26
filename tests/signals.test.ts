import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { calendar } from '../src/sim/clock';
import { makeRequest } from '../src/sim/demand';
import { Game } from '../src/sim/game';
import type { GraphJSON } from '../src/sim/graph';
import { exitsAt, setManual, setPedals } from '../src/sim/manual';
import {
  AMBER_S,
  RINCOME_CYCLE_S,
  SIGNAL_CYCLE_S,
  STOP_BEHIND_LINE_M,
  groupLight,
  lightChangesIn,
  redLightsRun,
  signalCap,
  signalMap,
  type SignalJunction,
} from '../src/sim/signals';
import { installSystems } from '../src/sim/systems';
import type { Vehicle } from '../src/sim/types';
import type { CityData } from '../src/world3d/city';
import { buildRoadNet } from '../src/world3d/build/junctions';
import { SIGNAL_PAINT } from '../src/sim/junctionShape';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));
const graph = world.graph;
const map = signalMap(graph);

function newGame(seed = 9): Game {
  const game = Game.create(world, { seed });
  installSystems(game);
  game.state.requests = [];
  return game;
}

/** A long signalled approach and an exit beyond its junction. */
function approachThrough(): { arc: number; exit: number; junction: SignalJunction; group: number } {
  for (const arc of map.approaches) {
    if (graph.arcLen(arc) < 90) continue;
    const j = map.junctions[map.junctionOf[graph.arcTo(arc)]];
    // An exit leaving the junction for a node outside it.
    const exit = exitsAt(graph, arc).find((e) => map.junctionOf[graph.arcTo(e.arc)] !== j.id && graph.arcLen(e.arc) > 20);
    if (exit) return { arc, exit: exit.arc, junction: j, group: map.arcGroup[arc] };
  }
  throw new Error('no signalled approach found');
}

/** Earliest game time from `t` when the group has at least `hold` seconds of red ahead. */
function redFor(j: SignalJunction, group: number, t: number, hold: number): number {
  for (let k = 0; k < j.cycle * 2; k++) {
    if (groupLight(j, group, t + k) === 'red' && lightChangesIn(j, group, t + k) >= hold) return t + k;
  }
  throw new Error('no red found');
}

function greenFor(j: SignalJunction, group: number, t: number, hold: number): number {
  for (let k = 0; k < j.cycle * 2; k++) {
    if (groupLight(j, group, t + k) === 'green' && lightChangesIn(j, group, t + k) >= hold) return t + k;
  }
  throw new Error('no green found');
}

/** Put the player's tuk-tuk on the approach, `toLine` metres before the stop line, on a GPS route through the junction. */
function onApproach(v: Vehicle, arc: number, exit: number, toLine: number): void {
  v.arc = arc;
  v.s = graph.arcLen(arc) - map.stopAt[arc] - toLine;
  v.speed = 8;
  v.busyUntil = 0;
  v.task = { kind: 'cruise', place: -1 };
  const len = graph.arcLen(arc) - v.s + graph.arcLen(exit);
  v.route = { arcs: [arc, exit], startS: v.s, target: graph.arcTo(exit), length: len, time: len / 8 };
  v.routeIdx = 0;
}

describe('traffic signals', () => {
  it('controls the OSM signal junctions, with the long cycle at Rin Kham', () => {
    expect(graph.signals.length).toBeGreaterThan(60);
    expect(map.junctions.length).toBeGreaterThan(30);
    expect(map.approaches.length).toBeGreaterThan(map.junctions.length);
    for (const arc of map.approaches) expect([0, 1]).toContain(map.arcGroup[arc]);
    const [rx, ry] = graph.projection.toXY(98.96778, 18.80124);
    const rincome = map.junctions.reduce((a, b) => (Math.hypot(b.x - rx, b.y - ry) < Math.hypot(a.x - rx, a.y - ry) ? b : a));
    expect(Math.hypot(rincome.x - rx, rincome.y - ry)).toBeLessThan(80);
    expect(rincome.cycle).toBe(RINCOME_CYCLE_S);
    expect(map.junctions.filter((j) => j.cycle === SIGNAL_CYCLE_S).length).toBe(map.junctions.length - 1);
  });

  it('has deterministic phases: the two groups take turns and never share a green', () => {
    const again = signalMap(new (graph.constructor as new (json: GraphJSON) => typeof graph)(read<GraphJSON>('graph.json')));
    expect(again.junctions.map((j) => [j.offset, j.cycle, j.nodes.join()])).toEqual(map.junctions.map((j) => [j.offset, j.cycle, j.nodes.join()]));
    const j = map.junctions[0];
    let green0 = 0;
    for (let t = 0; t < j.cycle; t++) {
      const a = groupLight(j, 0, t);
      const b = groupLight(j, 1, t);
      expect(a === 'green' && b === 'green').toBe(false);
      expect(groupLight(j, 0, t + 7 * j.cycle)).toBe(a);
      if (a === 'green') green0++;
    }
    expect(green0).toBe(j.cycle / 2 - AMBER_S);
  });

  it('stops traffic at the stop line the 3D streets paint, clear of the junction', () => {
    // Match each approach to the arm of the drawn junction at its node that it arrives along.
    const net = buildRoadNet(read<CityData>('city3d.json'));
    let matched = 0;
    let onLine = 0;
    let clear = 0;
    for (const arc of map.approaches) {
      const node = graph.arcTo(arc);
      const j = net.junctions.find((k) => Math.hypot(k.x - graph.nodeX[node], k.y - graph.nodeY[node]) < 1);
      if (!j || !j.signals) continue;
      const h = graph.arcEndHeading(arc) + Math.PI;
      const arm = j.arms.reduce((a, b) => (b.ux * Math.cos(h) + b.uy * Math.sin(h) > a.ux * Math.cos(h) + a.uy * Math.sin(h) ? b : a));
      if (!arm.inbound || arm.paint < SIGNAL_PAINT.crossing) continue;
      matched++;
      // The far edge of the painted stop line, behind the zebra crossing.
      const painted = arm.setback + SIGNAL_PAINT.line[1];
      if (Math.abs(map.lineAt[arc] - painted) < 1) onLine++;
      // Waiting traffic's front stays out of the junction surface.
      if (map.stopAt[arc] - STOP_BEHIND_LINE_M >= arm.setback) clear++;
    }
    expect(matched).toBeGreaterThan(150);
    expect(onLine / matched).toBeGreaterThan(0.95);
    expect(clear / matched).toBeGreaterThan(0.97);
    for (const arc of map.approaches) expect(map.stopAt[arc]).toBeGreaterThan(0);
  });

  it('stops a GPS-driven tuk-tuk at the line on red and lets it through on green', () => {
    const game = newGame();
    const v = game.playerVehicle()!;
    const { arc, exit, junction, group } = approachThrough();
    game.state.time = redFor(junction, group, game.state.time, 40);
    onApproach(v, arc, exit, 20);
    expect(signalCap(game, v)).toBeLessThan(v.speed);
    for (let t = 0; t < 30; t++) game.step(1);
    expect(v.arc).toBe(arc);
    expect(v.speed).toBe(0);
    const toLine = graph.arcLen(arc) - map.stopAt[arc] - v.s;
    expect(toLine).toBeGreaterThanOrEqual(0);
    expect(toLine).toBeLessThan(2);

    game.state.time = greenFor(junction, group, game.state.time, 30);
    expect(signalCap(game, v)).toBe(Infinity);
    for (let t = 0; t < 25 && v.route; t++) game.step(1);
    expect(v.arc).toBe(exit);
  });

  it('holds at the line even with the longest simulation steps (8× speed)', () => {
    const game = newGame();
    const v = game.playerVehicle()!;
    const { arc, exit, junction, group } = approachThrough();
    game.state.time = redFor(junction, group, game.state.time, 44);
    onApproach(v, arc, exit, 70);
    v.speed = 13;
    for (let t = 0; t < 40; t += 4) game.step(4);
    expect(v.arc).toBe(arc);
    expect(graph.arcLen(arc) - map.stopAt[arc] - v.s).toBeGreaterThanOrEqual(0);
  });

  it('lets the player steer through a red, at a cost to the passenger’s rating', () => {
    const game = newGame();
    const v = game.playerVehicle()!;
    const { arc, exit, junction, group } = approachThrough();
    game.state.time = redFor(junction, group, game.state.time, 20);
    setManual(game, true);
    onApproach(v, arc, exit, 10);
    const req = makeRequest(game, world.places[0], world.places[1], 'tourist_west', 'street', calendar(game.state.time));
    v.task = { kind: 'trip', trip: { request: req, fare: 100, ratio: 1, startedAt: game.state.time, distance: 2000 } };
    expect(signalCap(game, v)).toBe(Infinity);
    setPedals(game, true, false);
    for (let t = 0; t < 10 && v.arc === arc; t++) game.step(1);
    expect(v.arc).not.toBe(arc);
    expect(redLightsRun(game, req.id)).toBe(1);
  });
});
