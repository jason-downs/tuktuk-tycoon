import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { BALANCE } from '../src/sim/balance';
import { calendar, HOUR } from '../src/sim/clock';
import { makeRequest } from '../src/sim/demand';
import { claimRequest, seatsIn, startTrip } from '../src/sim/dispatch';
import { Game } from '../src/sim/game';
import type { GraphJSON } from '../src/sim/graph';
import { installSystems } from '../src/sim/systems';
import type { RideRequest } from '../src/sim/types';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));
const landmark = (id: string) => world.landmarks.find((l) => l.id === id)!;

/** A street party of `party` waiting at Tha Phae Gate (where the player starts), going to Wat Chedi Luang. */
function waiting(game: Game, party = 2): RideRequest {
  const req = makeRequest(game, landmark('tha_phae_gate'), landmark('wat_chedi_luang'), 'tourist_west', 'street', calendar(game.state.time));
  req.party = party;
  req.expiresAt = game.state.time + 10 * HOUR;
  game.state.requests.push(req);
  return req;
}

/** The player claims `req` and the GPS drives to the kerb, where the haggle opens. */
function toHaggle(game: Game, req: RideRequest): void {
  const v = game.playerVehicle()!;
  expect(game.playerClaim(req.id)).toBe(true);
  for (let t = 0; t < HOUR && v.task.kind === 'pickup'; t += 2) game.step(2);
  expect(v.task).toEqual({ kind: 'haggle', requestId: req.id });
  expect(game.isPaused('haggle')).toBe(true);
}

/** A copy of the game as Continue loads it from a save. */
function reload(game: Game, edit?: (state: Game['state']) => void): Game {
  const state = JSON.parse(game.serialize()) as Game['state'];
  edit?.(state);
  const loaded = Game.load(world, state);
  installSystems(loaded);
  return loaded;
}

describe('a haggle saved mid-deal', () => {
  it('opens again at the kerb once the loaded game runs, and can be settled', () => {
    const game = Game.create(world, { seed: 3 });
    installSystems(game);
    const req = waiting(game);
    toHaggle(game, req);

    const loaded = reload(game);
    const v = loaded.playerVehicle()!;
    expect(loaded.isPaused('haggle')).toBe(false);
    let opened: unknown = null;
    loaded.on('haggle', (p) => (opened = p));
    loaded.step(1);
    expect(opened).toEqual({ vehicleId: v.id, requestId: req.id });
    expect(loaded.isPaused('haggle')).toBe(true);
    expect(v.task).toEqual({ kind: 'haggle', requestId: req.id });

    loaded.playerStartTrip(req.fairFare);
    expect(v.task.kind).toBe('trip');
    expect(loaded.isPaused('haggle')).toBe(false);
  });

  it('is settled by autopilot when the loaded game is managed', () => {
    const game = Game.create(world, { seed: 3 });
    installSystems(game);
    const req = waiting(game);
    toHaggle(game, req);

    const loaded = reload(game, (s) => (s.autopilot = true));
    const v = loaded.playerVehicle()!;
    loaded.step(1);
    expect(loaded.isPaused('haggle')).toBe(false);
    expect(['trip', 'idle']).toContain(v.task.kind);
    expect(loaded.state.requests.some((r) => r.id === req.id)).toBe(false);
  });

  it('ends when the passenger is gone', () => {
    const game = Game.create(world, { seed: 3 });
    installSystems(game);
    const req = waiting(game);
    toHaggle(game, req);

    const loaded = reload(game, (s) => (s.requests = s.requests.filter((r) => r.id !== req.id)));
    loaded.step(1);
    expect(loaded.playerVehicle()!.task.kind).toBe('idle');
    expect(loaded.isPaused('haggle')).toBe(false);
    expect(loaded.state.notices.at(-1)!.text).toMatch(/gave up waiting/);
  });
});

describe('seats', () => {
  it('turns away a party bigger than the tuk-tuk, for the player as for the fleet', () => {
    const game = Game.create(world, { seed: 7 });
    const v = game.playerVehicle()!;
    const four = waiting(game, 4);
    expect(game.playerClaim(four.id)).toBe(false);
    expect(seatsIn(v)).toBe(3);
    expect(game.state.notices.at(-1)!.text).toBe('A party of 4 won’t fit in a 3-seat tuk-tuk.');
    expect(claimRequest(game, v, four.id)).toBe(false);
    expect(four.claimedBy).toBeNull();
    expect(v.task.kind).toBe('idle');

    // A party that fits is fine, and the 7-seater takes the four.
    const three = waiting(game, 3);
    expect(game.playerClaim(three.id)).toBe(true);
    v.model = 'ev_7seat';
    expect(game.playerClaim(four.id)).toBe(true);
    expect(four.claimedBy).toBe(v.id);
    expect(three.claimedBy).toBeNull();
  });
});

describe('ratings', () => {
  it('a breakdown mid-trip posts one poor review inside the rolling window', () => {
    const game = Game.create(world, { seed: 5 });
    const v = game.playerVehicle()!;
    const window = BALANCE.rating.window;
    game.state.ratings = Array.from({ length: window }, () => 5);
    game.state.reputation = 5;
    const req = waiting(game);
    toHaggle(game, req);
    expect(startTrip(game, v, req.fairFare)).toBe(true);
    game.resume('haggle');
    game.state.time = v.busyUntil;
    // Force the breakdown roll on the next step.
    game.rng.chance = () => true;
    game.step(1);
    expect(v.task.kind).toBe('broken');
    expect(game.state.ratings).toHaveLength(window);
    expect(game.state.ratings.at(-1)).toBe(1.5);
    expect(game.state.reputation).toBeCloseTo((5 * (window - 1) + 1.5) / window, 9);
  });
});
