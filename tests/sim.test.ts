import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildWorld, type PoiJSON } from '../src/data/world';
import type { GraphJSON } from '../src/sim/graph';
import { Game } from '../src/sim/game';
import { HOUR } from '../src/sim/clock';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));

describe('headless simulation', () => {
  it('builds places from landmarks and POIs', () => {
    expect(world.landmarks.length).toBeGreaterThan(70);
    expect(world.places.length).toBeGreaterThan(3000);
    expect(world.lpgStations.length).toBeGreaterThan(5);
  });

  it('runs a day on autopilot: passengers appear, trips complete, cash moves', () => {
    const game = Game.create(world, { seed: 42 });
    game.state.autopilot = true;
    // CPU time rather than wall time: the suite runs files in parallel, often on a busy machine.
    const cpu0 = process.cpuUsage();
    for (let t = 0; t < 24 * HOUR; t += 4) game.step(4);
    const cpu = process.cpuUsage(cpu0);
    const ms = (cpu.user + cpu.system) / 1000;
    expect(game.state.stats.trips).toBeGreaterThan(10);
    expect(game.state.books.length).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(game.state.cash)).toBe(true);
    // A simulated day stays under 4 s of CPU (about 2 s on a laptop).
    expect(ms).toBeLessThan(4000);
    console.log(`day sim: ${ms.toFixed(0)} ms CPU, trips ${game.state.stats.trips}, cash ${game.state.cash}, rep ${game.state.reputation.toFixed(2)}, requests alive ${game.state.requests.length}`);
  });

  it('round-trips through JSON', () => {
    const game = Game.create(world, { seed: 7 });
    game.state.autopilot = true;
    for (let t = 0; t < 2 * HOUR; t += 4) game.step(4);
    const copy = Game.load(world, JSON.parse(game.serialize()));
    for (let t = 0; t < HOUR; t += 4) {
      game.step(4);
      copy.step(4);
    }
    expect(copy.state.cash).toBe(game.state.cash);
    expect(copy.state.stats.trips).toBe(game.state.stats.trips);
  });
});
