import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GOALS, GOAL_BY_ID, YI_PENG_TRIPS } from '../src/content/goals';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { timeOf } from '../src/sim/clock';
import { makeRequest } from '../src/sim/demand';
import type { TripResult } from '../src/sim/dispatch';
import { currentBook, earn } from '../src/sim/economy';
import { Game } from '../src/sim/game';
import { goalProgress, goalTrack, isComplete } from '../src/sim/goals';
import type { GraphJSON } from '../src/sim/graph';
import { installSystems } from '../src/sim/systems';
import type { Place } from '../src/sim/types';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));
const landmark = (id: string): Place => world.landmarks.find((l) => l.id === id)!;

function gameAt(time = timeOf(2026, 10, 3, 9)): Game {
  const game = Game.create(world, { seed: 21 });
  game.state.time = time;
  installSystems(game);
  game.step(1);
  return game;
}

/** Report a finished trip to the goal counters, as dispatch does. */
function fakeTrip(game: Game, rating: number, source?: string): void {
  const cal = { day: 0, year: 2026, month: 10, date: 1, weekday: 0, hour: 12, minute: 0 };
  const request = makeRequest(game, landmark('tha_phae_gate'), landmark('wat_phra_singh'), 'tourist_west', 'street', cal);
  request.source = source;
  const r: TripResult = { vehicleId: game.playerVehicle()!.id, driverId: null, fare: 100, tip: 0, rating, request, companyTake: 100 };
  game.emit('trip', r);
}

describe('goals', () => {
  it('has unique ids and a detail line for every goal', () => {
    const game = gameAt();
    expect(new Set(GOALS.map((g) => g.id)).size).toBe(GOALS.length);
    expect(GOALS.length).toBeGreaterThanOrEqual(20);
    for (const g of GOALS) {
      const p = goalProgress(game, g);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      expect(g.detail(game, goalTrack(game)).length).toBeGreaterThan(0);
    }
  });

  it('tracks progress and pays each reward exactly once', () => {
    const game = gameAt();
    const tenRides = GOAL_BY_ID.ten_rides;
    game.state.stats.trips = 4;
    expect(goalProgress(game, tenRides)).toBeCloseTo(0.4);
    expect(tenRides.detail(game, goalTrack(game))).toBe('4 / 10 rides');
    expect(isComplete(game, 'first_ride')).toBe(false);

    game.step(10);
    expect(isComplete(game, 'first_ride')).toBe(true);
    expect(currentBook(game).income.other).toBe(GOAL_BY_ID.first_ride.reward.cash);
    expect(game.state.notices.filter((n) => n.kind === 'goal' && n.text.includes('First fare'))).toHaveLength(1);

    const cash = game.state.cash;
    for (let t = 0; t < 120; t += 4) game.step(4);
    expect(game.state.cash).toBe(cash);
    expect(game.state.goals.filter((id) => id === 'first_ride')).toHaveLength(1);

    // Rewards with reviews lift the company's stars.
    const rep = game.state.reputation;
    game.spawnVehicle('lpg_used', landmark('maya').node, { ownership: 'owned' });
    game.step(10);
    expect(isComplete(game, 'own')).toBe(true);
    expect(game.state.reputation).toBeGreaterThan(rep);
  });

  it('counts a good day, not loans or rewards', () => {
    const game = gameAt();
    earn(game, 900, 'fares');
    earn(game, 50_000, 'loan');
    earn(game, 5_000, 'other');
    game.step(10);
    expect(isComplete(game, 'day_1000')).toBe(false);
    expect(goalProgress(game, GOAL_BY_ID.day_1000)).toBeCloseTo(0.9);
    earn(game, 100, 'tips');
    game.step(10);
    expect(isComplete(game, 'day_1000')).toBe(true);
  });

  it('counts five-star rides and tours from finished trips', () => {
    const game = gameAt();
    fakeTrip(game, 4.6);
    expect(goalTrack(game).fiveStars).toBe(0);
    fakeTrip(game, 4.9);
    fakeTrip(game, 4.2, 'tour:temples');
    expect(goalTrack(game).fiveStars).toBe(1);
    expect(goalTrack(game).tours).toBe(1);
    game.step(10);
    expect(isComplete(game, 'five_star')).toBe(true);
    expect(goalProgress(game, GOAL_BY_ID.tours)).toBeCloseTo(0.2);
  });

  it('counts Yi Peng trips per festival night', () => {
    // Before the festival opens (17:00 on 23 Nov 2026) nothing counts.
    const game = gameAt(timeOf(2026, 10, 23, 16));
    fakeTrip(game, 4);
    expect(Object.keys(goalTrack(game).yiPeng)).toHaveLength(0);
    game.state.time = timeOf(2026, 10, 23, 20);
    for (let i = 0; i < YI_PENG_TRIPS - 1; i++) fakeTrip(game, 4);
    // The next night is a separate count.
    game.state.time = timeOf(2026, 10, 24, 18);
    fakeTrip(game, 4);
    expect(Object.values(goalTrack(game).yiPeng).sort((a, b) => a - b)).toEqual([1, YI_PENG_TRIPS - 1]);
    game.step(10);
    expect(isComplete(game, 'yi_peng')).toBe(false);
    // After midnight still belongs to the 24th's night (the festival runs to 01:00).
    game.state.time = timeOf(2026, 10, 25, 0.5);
    for (let i = 0; i < YI_PENG_TRIPS - 1; i++) fakeTrip(game, 4);
    game.step(10);
    expect(isComplete(game, 'yi_peng')).toBe(true);
  });

  it('keeps its counters through a save and load', () => {
    const game = gameAt();
    fakeTrip(game, 5);
    game.step(10);
    const copy = Game.load(world, JSON.parse(game.serialize()));
    installSystems(copy);
    expect(goalTrack(copy)).toEqual(goalTrack(game));
    expect(copy.state.goals).toEqual(game.state.goals);
    expect(copy.state.goals).toContain('five_star');
    // Nothing already won is paid again after loading.
    const cash = copy.state.cash;
    copy.step(10);
    expect(copy.state.goals.filter((id) => id === 'five_star')).toHaveLength(1);
    expect(copy.state.cash).toBe(cash);
  });
});
