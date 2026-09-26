// Server-renders the Fleet and Hire panels over a mixed fleet, so every row,
// detail view and tab is exercised without a browser.

import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { VEHICLE_MODELS } from '../src/content/vehicles';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { earn } from '../src/sim/economy';
import { FLEET, FleetSystem, MARKET_MODELS, buyVehicle, fleetState, hireCandidate, rentVehicle, severance } from '../src/sim/fleet';
import { Game } from '../src/sim/game';
import type { GraphJSON } from '../src/sim/graph';
import { DriverDetail, FleetPanel, PlayerDetail, VehicleDetail } from '../src/ui/panels/FleetPanel';
import { HirePanel, hireView } from '../src/ui/panels/HirePanel';
import { ui } from '../src/ui/store';

// The panels subscribe to the UI tick; on the server they read the game directly.
vi.mock('../src/ui/store', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/ui/store')>();
  return {
    ...mod,
    useGame: <T>(game: Game, select: (g: Game) => T): T => select(game),
    useUI: <T>(select: (s: ReturnType<typeof mod.ui.get>) => T): T => select(mod.ui.get()),
  };
});

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));

function mixedFleet(): Game {
  const game = Game.create(world, { seed: 21 });
  game.addSystem(new FleetSystem());
  game.state.stats.trips = 5;
  earn(game, 600_000, 'other');
  const spare = rentVehicle(game)!;
  const leased = buyVehicle(game, 'lpg_used', 'lease')!;
  buyVehicle(game, 'ev_new', 'cash');
  const pool = fleetState(game).candidates;
  hireCandidate(game, pool[0].roster, 'salary', spare.id);
  hireCandidate(game, pool[1].roster, 'rent', leased.id);
  hireCandidate(game, pool[2].roster, 'salary', null);
  return game;
}

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('fleet panel', () => {
  it('lists every tuk-tuk and driver, and opens the tuk-tuk selected on the map', () => {
    const game = mixedFleet();
    const leased = game.state.vehicles.find((v) => v.ownership === 'leased')!;
    ui.set({ selectedVehicle: leased.id });
    const out = html(createElement(FleetPanel, { game, view: null }));
    for (const v of game.state.vehicles) expect(out).toContain(v.name);
    for (const d of game.state.drivers.filter((x) => !x.isPlayer)) expect(out).toContain(d.nickname);
    expect(out).toContain('Parked — no driver');
    expect(out).toContain('No tuk-tuk');
    // The selected leased tuk-tuk's detail is open.
    expect(out).toContain('still owed');
    expect(out).toMatch(/Due at 04:00/);
    ui.set({ selectedVehicle: null });
  });

  it('renders each tuk-tuk’s detail with the actions its ownership allows', () => {
    const game = mixedFleet();
    const byOwnership = (o: string) => game.state.vehicles.find((v) => v.ownership === o)!;
    expect(html(createElement(VehicleDetail, { game, v: byOwnership('rented') }))).toContain('Return to Lung Daeng');
    expect(html(createElement(VehicleDetail, { game, v: byOwnership('leased') }))).toMatch(/Pay off ฿/);
    expect(html(createElement(VehicleDetail, { game, v: byOwnership('owned') }))).toMatch(/Sell for ฿/);
  });

  it('renders driver detail with skills, pay terms within bounds and severance', () => {
    const game = mixedFleet();
    for (const d of game.state.drivers) {
      if (d.isPlayer) {
        expect(html(createElement(PlayerDetail, { game, d }))).toContain('Your tuk-tuk');
        continue;
      }
      const out = html(createElement(DriverDetail, { game, d }));
      for (const skill of ['Driving', 'English', 'Charm', 'Honesty', 'Stamina']) expect(out).toContain(skill);
      expect(out).toContain(d.payModel === 'salary' ? 'Daily wage' : 'Daily rent');
      expect(out).toContain(`severance`);
      expect(out).toContain(severance(d).toLocaleString('en-US'));
      if (d.vehicleId === null) expect(out).toContain('still drawing a wage');
    }
  });
});

describe('hire panel', () => {
  it('shows today’s applicants with both offers and the hiring fee', () => {
    const game = Game.create(world, { seed: 4 });
    game.addSystem(new FleetSystem());
    hireView.set({ tab: 'drivers' });
    const out = html(createElement(HirePanel, { game, view: null }));
    for (const c of fleetState(game).candidates) expect(out).toContain(`${c.salaryAsk}`);
    expect(out).toContain('Hire on salary');
    expect(out).toContain('Hire on rent-out');
    expect(out).toContain(FLEET.hiringFee.toLocaleString('en-US'));
  });

  it('lists only the showroom models and explains blocked purchases', () => {
    const game = Game.create(world, { seed: 4 });
    game.addSystem(new FleetSystem());
    hireView.set({ tab: 'vehicles' });
    VEHICLE_MODELS.test_conversion_ev = { ...VEHICLE_MODELS.rusty, id: 'test_conversion_ev', name: 'Test conversion EV', powertrain: 'ev' };
    try {
      const out = html(createElement(HirePanel, { game, view: null }));
      for (const id of MARKET_MODELS) expect(out).toContain(VEHICLE_MODELS[id].name);
      expect(out).not.toContain('Test conversion EV');
      expect(out).toContain('Rent from Lung Daeng');
      expect(out).toMatch(/You need ฿[\d,]+ more/);
    } finally {
      delete VEHICLE_MODELS.test_conversion_ev;
      hireView.set({ tab: 'drivers' });
    }
  });
});
