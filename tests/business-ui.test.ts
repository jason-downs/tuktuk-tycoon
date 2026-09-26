// Server-renders the Business, Goals and Finance panels against real game states, so a panel that throws or
// loses its reasons fails here. useGame is replaced by a direct read: the node test runner has no DOM to subscribe to.
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GOALS } from '../src/content/goals';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { openDepot, partnerHotel, startService, takeLoan } from '../src/sim/business';
import { HOUR, timeOf } from '../src/sim/clock';
import { Game } from '../src/sim/game';
import type { GraphJSON } from '../src/sim/graph';
import { installSystems } from '../src/sim/systems';
import type { Driver } from '../src/sim/types';
import { Bank, BusinessPanel, Depots, Hotels } from '../src/ui/panels/BusinessPanel';
import { FinancePanel } from '../src/ui/panels/FinancePanel';
import { GoalsPanel } from '../src/ui/panels/GoalsPanel';

vi.mock('../src/ui/store', () => ({
  useGame: <T>(game: Game, select: (g: Game) => T): T => select(game),
  useUI: <T>(select: (s: object) => T): T => select({}),
  ui: { get: () => ({}), set: () => {}, subscribe: () => () => {} },
}));

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));

function newGame(): Game {
  const game = Game.create(world, { seed: 31 });
  game.state.time = timeOf(2026, 10, 3, 9);
  installSystems(game);
  game.step(1);
  return game;
}

/** A Fleet boss company with a hired driver in each extra tuk-tuk. */
function fleetBoss(): Game {
  const game = newGame();
  const at = world.landmarks.find((l) => l.id === 'tha_phae_gate')!.node;
  for (const model of ['ev_new', 'lpg_used', 'lpg_used']) {
    const v = game.spawnVehicle(model, at, { ownership: 'owned', purchasePrice: 250_000 });
    const d: Driver = { ...game.player(), id: game.nextId(), isPlayer: false, vehicleId: v.id, nickname: `D${v.id}` };
    game.state.drivers.push(d);
    v.driverId = d.id;
  }
  game.state.ratings = [4.6];
  game.state.reputation = 4.6;
  game.state.cash = 400_000;
  game.step(60);
  return game;
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('business UI', () => {
  it('renders a new company: rank ladder, locked services and why', () => {
    const game = newGame();
    const out = text(renderToStaticMarkup(h(BusinessPanel, { game, view: null })));
    expect(out).toContain('Driver');
    expect(out).toContain('Next: Owner-driver');
    expect(out).toContain('Needs the Owner-driver rank.');
    expect(out).toContain('Start · ฿');
    const bank = text(renderToStaticMarkup(h(Bank, { game })));
    expect(bank).toContain('Credit limit');
  });

  it('renders running services, partners, depots and a loan', () => {
    const game = fleetBoss();
    expect(startService(game, 'app').ok).toBe(true);
    expect(partnerHotel(game, 'shangri_la').ok).toBe(true);
    expect(openDepot(game, 'old_city').ok).toBe(true);
    expect(takeLoan(game, 20_000).ok).toBe(true);
    for (let t = 0; t < HOUR; t += 4) game.step(4);
    const panel = text(renderToStaticMarkup(h(BusinessPanel, { game, view: null })));
    expect(panel).toContain('Fleet boss');
    expect(panel).toContain('● Running');
    expect(panel).toContain('Cancel…');
    expect(text(renderToStaticMarkup(h(Hotels, { game, view: null })))).toContain('Shangri-La Chiang Mai');
    expect(text(renderToStaticMarkup(h(Depots, { game, view: null })))).toContain('Open since day');
    const bank = text(renderToStaticMarkup(h(Bank, { game })));
    expect(bank).toContain('Still owed');
    expect(bank).toContain('Repay all');
  });

  it('renders the goal list and the finance chart', () => {
    const game = newGame();
    game.state.autopilot = true;
    for (let t = 0; t < 30 * HOUR; t += 4) game.step(4);
    const goals = text(renderToStaticMarkup(h(GoalsPanel, { game, view: null })));
    expect(goals).toContain(`/ ${GOALS.length}`);
    expect(goals).toContain('Next up');
    expect(goals).toContain('Survive Yi Peng');
    const finance = renderToStaticMarkup(h(FinancePanel, { game, view: null }));
    expect(finance).toContain('<svg');
    // One hover target per business day the company has traded.
    const days = new Set(game.state.books.map((b) => b.day)).size;
    expect(days).toBeGreaterThan(1);
    expect(text(finance)).toContain(`Last ${days} days`);
    expect(text(finance)).toContain('Today so far');
    expect(finance.match(/class="fc-hit"/g)).toHaveLength(days);
  });
});
