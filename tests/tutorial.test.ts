import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { calendar } from '../src/sim/clock';
import { makeRequest } from '../src/sim/demand';
import { Game } from '../src/sim/game';
import type { GraphJSON } from '../src/sim/graph';
import { setManual, setPedals } from '../src/sim/manual';
import { installSystems } from '../src/sim/systems';
import { PANEL_TOUR_GOAL, tutorialSignal, tutorialState } from '../src/sim/tutorial';
import type { RideRequest } from '../src/sim/types';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));

function newGame(seed = 21): Game {
  const game = Game.create(world, { seed });
  installSystems(game);
  return game;
}

/** A street passenger a few hundred metres from the player, going to Wat Chedi Luang. */
function nearbyRequest(game: Game): RideRequest {
  const pose = game.vehiclePose(game.playerVehicle()!);
  const from = world.places
    .filter((p) => p.cat !== 'fuel')
    .map((p) => ({ p, d: Math.hypot(p.x - pose.x, p.y - pose.y) }))
    .filter((x) => x.d > 200 && x.d < 700)
    .sort((a, b) => a.d - b.d)[0].p;
  const to = world.landmarks.find((l) => l.id === 'wat_chedi_luang')!;
  const req = makeRequest(game, from, to, 'tourist_west', 'street', calendar(game.state.time));
  game.state.requests.push(req);
  return req;
}

function stepUntil(game: Game, done: () => boolean, limit = 3_600): void {
  for (let t = 0; t < limit && !done(); t += 2) game.step(2);
}

describe('tutorial', () => {
  it('coaches a new game through driving, a whole ride and the switch to managing', () => {
    const game = newGame();
    const st = () => tutorialState(game);
    expect(st().step).toBe('welcome');
    expect(st().done).toBe(false);

    tutorialSignal(game, { kind: 'next' });
    expect(st().step).toBe('drive');
    setManual(game, true);
    setPedals(game, true, false);
    stepUntil(game, () => st().step !== 'drive', 120);
    expect(st().step).toBe('find');
    setPedals(game, false, false);
    // Let the GPS drive to the passenger.
    setManual(game, false);

    const req = nearbyRequest(game);
    expect(game.playerClaim(req.id)).toBe(true);
    game.step(1);
    expect(st().step).toBe('approach');

    stepUntil(game, () => st().step !== 'approach');
    expect(st().step).toBe('haggle');
    expect(game.playerVehicle()!.task.kind).toBe('haggle');

    game.playerStartTrip(req.fairFare);
    game.step(1);
    expect(st().step).toBe('dropoff');

    stepUntil(game, () => st().step !== 'dropoff');
    expect(st().step).toBe('paid');
    expect(st().fare).toBe(req.fairFare);
    expect(st().rating).toBeGreaterThanOrEqual(1);

    tutorialSignal(game, { kind: 'next' });
    expect(st().step).toBe('manage');
    tutorialSignal(game, { kind: 'mode', mode: 'drive' });
    expect(st().step).toBe('manage');
    tutorialSignal(game, { kind: 'mode', mode: 'manage' });
    expect(st().step).toBe('panels');

    for (const id of ['fleet', 'fleet', 'hire', 'garage', 'business'].slice(0, PANEL_TOUR_GOAL + 1)) tutorialSignal(game, { kind: 'panel', id });
    expect(st().step).toBe('finish');
    tutorialSignal(game, { kind: 'next' });
    expect(st().done).toBe(true);
  });

  it('sends the player back to find another passenger when one walks away', () => {
    const game = newGame(4);
    const req = nearbyRequest(game);
    game.playerClaim(req.id);
    game.step(1);
    expect(tutorialState(game).step).toBe('approach');
    stepUntil(game, () => game.playerVehicle()!.task.kind === 'haggle');
    game.playerAbandon();
    game.step(1);
    expect(tutorialState(game).step).toBe('find');
    expect(tutorialState(game).lost).toBe(true);
  });

  it('can be skipped and replayed', () => {
    const game = newGame(5);
    tutorialSignal(game, { kind: 'skip' });
    expect(tutorialState(game).done).toBe(true);
    tutorialSignal(game, { kind: 'next' });
    expect(tutorialState(game).done).toBe(true);
    tutorialSignal(game, { kind: 'restart' });
    expect(tutorialState(game)).toMatchObject({ step: 'welcome', done: false });
  });

  it('survives a save and skips itself for games that started before it existed', () => {
    const game = newGame(6);
    tutorialSignal(game, { kind: 'next' });
    const resumed = Game.load(world, JSON.parse(game.serialize()));
    installSystems(resumed);
    expect(tutorialState(resumed).step).toBe('drive');

    const old = JSON.parse(game.serialize());
    delete old.systems.tutorial;
    old.stats.trips = 12;
    const loaded = Game.load(world, old);
    installSystems(loaded);
    expect(tutorialState(loaded).done).toBe(true);
  });
});
