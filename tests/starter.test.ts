// The player's first passengers (sim/starter.ts): one waits near the free
// tuk-tuk from the first moment of a new game, the next arrives soon after each
// ride, none once the player has given FLEET.ridesBeforeHiring rides (when
// hired drivers will join), and rivals leave them alone.
// Also the Drive-mode autodrive that goes on looking for passengers when a GPS
// errand ends (ui/mode.ts keepAutodriveBusy).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { claimRequest, seatsIn } from '../src/sim/dispatch';
import { FLEET } from '../src/sim/fleet';
import { Game } from '../src/sim/game';
import type { GraphJSON } from '../src/sim/graph';
import { setManual, setPedals, whoDrives } from '../src/sim/manual';
import { RIVAL_KINDS, RivalsSystem } from '../src/sim/rivals';
import { STARTER_DELAY_S, STARTER_MAX_M, STARTER_MIN_M, STARTER_NEAR_M } from '../src/sim/starter';
import { installSystems } from '../src/sim/systems';
import type { RideRequest } from '../src/sim/types';
import { applyMode, keepAutodriveBusy } from '../src/ui/mode';
import { ui } from '../src/ui/store';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));

function newGame(seed: number): Game {
  const game = Game.create(world, { seed });
  installSystems(game);
  return game;
}

const starters = (game: Game): RideRequest[] => game.state.requests.filter((r) => r.starter);
const distanceTo = (game: Game, r: RideRequest): number => {
  const p = game.vehiclePose(game.playerVehicle()!);
  const place = game.place(r.from);
  return Math.hypot(place.x - p.x, place.y - p.y);
};

describe("the player's first passengers", () => {
  it('has one waiting near the tuk-tuk from the first step of a new game, on every seed', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const game = newGame(seed);
      expect(game.state.requests.length).toBe(0);
      game.step(1);
      const [r] = starters(game);
      expect(r, `seed ${seed}`).toBeDefined();
      // A short drive ahead, with no U-turn.
      const v = game.playerVehicle()!;
      const drive = world.router.route({ arc: v.arc, s: v.s }, game.place(r.from).node, false)!;
      expect(drive.length).toBeGreaterThanOrEqual(STARTER_MIN_M);
      expect(drive.length).toBeLessThanOrEqual(STARTER_MAX_M);
      expect(distanceTo(game, r)).toBeLessThanOrEqual(STARTER_MAX_M);
      expect(r.claimedBy).toBeNull();
      expect(r.channel).toBe('street');
      expect(r.party).toBeLessThanOrEqual(seatsIn(game.playerVehicle()!));
      expect(game.visibleRequests()).toContain(r);
      // They wait; ordinary passengers give up within minutes.
      for (let t = 0; t < 20 * 60; t += 5) game.step(5);
      expect(game.state.requests).toContain(r);
    }
  });

  it('sends another soon after the player is free again, and none once drivers will join', () => {
    const game = newGame(3);
    game.step(1);
    const v = game.playerVehicle()!;
    // The first one is claimed and ridden away: nobody else near, so a new one appears within the delay.
    const [first] = starters(game);
    expect(claimRequest(game, v, first.id)).toBe(true);
    game.state.requests = game.state.requests.filter((r) => r !== first);
    v.task = { kind: 'idle' };
    v.route = null;
    game.state.stats.trips = 1;
    for (let t = 0; t < STARTER_DELAY_S + 2 && !starters(game).length; t += 1) game.step(1);
    expect(starters(game).length).toBe(1);
    // Past the hiring gate the player finds passengers like everyone else.
    game.state.requests = [];
    game.state.stats.trips = FLEET.ridesBeforeHiring;
    for (let t = 0; t < 60; t += 1) game.step(1);
    expect(starters(game).length).toBe(0);
  });

  it('keeps one waiting at a time: one the player drives on past gives up as the next appears', () => {
    for (const seed of [1, 2, 3]) {
      const game = newGame(seed);
      game.step(1);
      const [first] = starters(game);
      // Drive on by hand, past the first one, for two game minutes.
      setManual(game, true);
      let most = 0;
      for (let t = 0; t < 120; t++) {
        setPedals(game, true, false);
        game.step(1);
        most = Math.max(most, starters(game).filter((r) => r.claimedBy === null).length);
      }
      expect(most, `seed ${seed}`).toBe(1);
      expect(game.state.requests, `seed ${seed}`).not.toContain(first);
    }
  });

  it('adds none while another passenger already waits nearby', () => {
    const game = newGame(4);
    game.step(1);
    const [r] = starters(game);
    r.starter = undefined;
    for (let t = 0; t < 60; t += 1) game.step(1);
    expect(starters(game).length).toBe(0);
    expect(distanceTo(game, r)).toBeLessThanOrEqual(STARTER_NEAR_M);
  });

  it('is left to the player by songthaews and rival tuk-tuks', () => {
    const game = newGame(5);
    game.step(1);
    const [r] = starters(game);
    const graph = world.graph;
    const node = game.place(r.from).node;
    // A songthaew parked right at the passenger's kerb, and the same passenger as an ordinary hail for comparison.
    const arc = Array.from({ length: graph.edges.length * 2 }, (_, a) => a).find((a) => graph.arcValid(a) && graph.arcTo(a) === node && graph.arcLen(a) > 5)!;
    const rivals = game.systems.find((s): s is RivalsSystem => s instanceof RivalsSystem)!;
    rivals.count = 1;
    rivals.kind[0] = RIVAL_KINDS.indexOf('songthaew');
    rivals.routes[0] = null;
    rivals.parkArc[0] = arc;
    rivals.parkS[0] = graph.arcLen(arc) - 1;
    rivals.pauseUntil[0] = 0;
    rivals.busyUntil[0] = 0;
    const ordinary: RideRequest = { ...r, id: game.nextId(), starter: undefined, party: 1, spawnedAt: game.state.time - 3600 };
    r.spawnedAt = game.state.time - 3600;
    game.state.requests.push(ordinary);
    for (let i = 0; i < 200 && game.state.requests.includes(ordinary); i++) rivals.compete(game);
    expect(game.state.requests).not.toContain(ordinary);
    for (let i = 0; i < 200; i++) rivals.compete(game);
    expect(game.state.requests).toContain(r);
  });
});

describe('autodrive in Drive mode', () => {
  it('goes on looking for passengers when the GPS errand ends with nothing left to do', () => {
    const game = newGame(6);
    const off = keepAutodriveBusy(game);
    ui.set({ haggle: null, mode: 'drive' });
    applyMode(game, 'drive');
    const v = game.playerVehicle()!;
    game.step(1);
    // The GPS drives to a passenger (Pick up), who is then taken by someone else.
    const [r] = starters(game);
    expect(claimRequest(game, v, r.id)).toBe(true);
    setManual(game, false);
    expect(whoDrives(game)).toBe('gps');
    game.state.requests = game.state.requests.filter((x) => x !== r);
    v.task = { kind: 'idle' };
    v.route = null;
    game.emit('frame', 1 / 60);
    expect(whoDrives(game)).toBe('autopilot');
    // In Manage mode an idle tuk-tuk with autopilot switched off waits for orders.
    ui.set({ mode: 'manage' });
    game.state.autopilot = false;
    game.emit('frame', 1 / 60);
    expect(whoDrives(game)).toBe('gps');
    off();
    ui.set({ mode: 'drive' });
  });
});
