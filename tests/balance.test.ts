// Balance harness: plays a whole business headlessly with a simple "sensible
// owner" policy and reports when the pacing milestones of docs/design.md are
// reached, in game days and in real minutes at the speeds a player would use.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { BASE_TIME_SCALE, DAY, HOUR } from '../src/sim/clock';
import { buyVehicle, fleetState, freeVehicles, hireCandidate, hiredDrivers, rentedFrom, rentVehicle } from '../src/sim/fleet';
import { installUpgrade } from '../src/sim/garage';
import type { GraphJSON } from '../src/sim/graph';
import { Game } from '../src/sim/game';
import { installSystems } from '../src/sim/systems';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));

interface Milestone {
  label: string;
  day: number;
}

/** A plain owner: autopilot on, cheap upgrades first, rent+hire while Lung Daeng has tuk-tuks, then buy. */
function playBusiness(days: number, seed: number) {
  const game = Game.create(world, { seed });
  installSystems(game);
  game.state.autopilot = true;
  const miles: Milestone[] = [];
  const start = game.state.time;
  const mark = (label: string) => {
    if (!miles.some((m) => m.label === label)) miles.push({ label, day: (game.state.time - start) / DAY });
  };
  const daily: { day: number; cash: number; fleet: number; trips: number }[] = [];
  for (let t = 0; t < days * DAY; t += 4) {
    game.step(4);
    if (game.state.stats.trips >= 1) mark('first ride');
    if (t % HOUR !== 0) continue;
    const player = game.playerVehicle()!;
    if (game.state.cash > 1_500 && !player.upgrades.includes('malai')) installUpgrade(game, player, 'malai') && mark('first upgrade');
    if (game.state.cash > 4_000 && !player.upgrades.includes('phone_mount')) installUpgrade(game, player, 'phone_mount');
    if (game.state.cash > 6_000 && !player.upgrades.includes('cushions')) installUpgrade(game, player, 'cushions');
    // Hire when there is a tuk-tuk for them: rent one from Lung Daeng, or buy once rentals run out.
    const pool = fleetState(game).candidates;
    if (pool.length && game.state.cash > 3_000) {
      let seat = freeVehicles(game)[0];
      if (!seat && rentedFrom(game, 'lung_daeng') < 3) seat = rentVehicle(game) ?? undefined!;
      if (!seat && rentedFrom(game, 'owner') < 12) seat = rentVehicle(game, 'owner') ?? undefined!;
      if (!seat && game.state.cash > 90_000) seat = buyVehicle(game, 'lpg_used', 'lease') ?? undefined!;
      if (seat) {
        const d = hireCandidate(game, pool[0].roster, 'salary', seat.id);
        if (d) mark(hiredDrivers(game).length === 1 ? 'first hire' : `${hiredDrivers(game).length} drivers`);
      }
    }
    if (game.state.vehicles.some((v) => v.ownership !== 'rented')) mark('owns a tuk-tuk');
    if (game.state.vehicles.length >= 5) mark('5 tuk-tuks');
    if (game.state.vehicles.length >= 10) mark('10 tuk-tuks');
    if (game.state.vehicles.length >= 15) mark('15 tuk-tuks');
    if (t % DAY === 0) daily.push({ day: t / DAY, cash: Math.round(game.state.cash), fleet: game.state.vehicles.length, trips: game.state.stats.trips });
  }
  return { game, miles, daily };
}

describe('balance harness', () => {
  it('reaches the pacing milestones in a sensible order and time', () => {
    const { game, miles, daily } = playBusiness(12, 11);
    // Real minutes: a game day is DAY / (BASE_TIME_SCALE × speed) seconds; drive mode runs slower by hand.
    const realMin = (day: number, speed: number) => (day * DAY) / (BASE_TIME_SCALE * speed) / 60;
    console.log('milestones (game day → real min at 1× / 4×):');
    for (const m of miles) console.log(`  ${m.label.padEnd(16)} day ${m.day.toFixed(2)} → ${realMin(m.day, 1).toFixed(0)} min / ${realMin(m.day, 4).toFixed(0)} min`);
    console.log('daily:', daily.map((d) => `d${d.day}:฿${d.cash} f${d.fleet} t${d.trips}`).join(' '));
    const at = (label: string) => miles.find((m) => m.label === label)?.day ?? Infinity;
    expect(at('first ride')).toBeLessThan(0.05);
    expect(at('first upgrade')).toBeLessThan(at('first hire'));
    expect(at('first hire')).toBeLessThan(3);
    expect(game.state.vehicles.length).toBeGreaterThanOrEqual(3);
    expect(Number.isFinite(game.state.cash)).toBe(true);
  }, 120_000);
});
