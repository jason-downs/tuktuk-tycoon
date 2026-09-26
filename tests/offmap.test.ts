import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { makeRequest } from '../src/sim/demand';
import { claimRequest, startTrip } from '../src/sim/dispatch';
import { calendar, HOUR } from '../src/sim/clock';
import type { GraphJSON } from '../src/sim/graph';
import { Game } from '../src/sim/game';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));
const landmark = (id: string) => world.landmarks.find((l) => l.id === id)!;

function tripTo(game: Game, toId: string, fromId = 'tha_phae_gate') {
  const v = game.playerVehicle()!;
  const from = landmark(fromId);
  const to = landmark(toId);
  const req = makeRequest(game, from, to, 'tourist_west', 'street', calendar(game.state.time));
  req.expiresAt = game.state.time + 10 * HOUR;
  game.state.requests.push(req);
  expect(claimRequest(game, v, req.id)).toBe(true);
  for (let t = 0; t < 2 * HOUR && v.task.kind === 'pickup'; t += 2) game.step(2);
  // The player haggles at the kerb; settle at the going rate.
  expect(v.task.kind).toBe('haggle');
  startTrip(game, v, req.fairFare);
  game.resume('haggle');
  return { v, req };
}

describe('out-of-town trips through portals', () => {
  it('places every out-of-town landmark on a portal with a road distance', () => {
    const off = world.landmarks.filter((l) => l.offmap);
    expect(off.map((l) => l.id)).toEqual(expect.arrayContaining(['wat_doi_suthep', 'chiang_mai_zoo', 'night_safari', 'bo_sang']));
    for (const l of off) {
      const portal = world.graph.portals[l.offmap!.portal];
      expect(portal).toBeDefined();
      expect(l.node).toBe(portal.out);
      expect(l.offmap!.extraM).toBeGreaterThan(300);
    }
    // Round trips carry a fixed fare: Doi Suthep 400 return (economics.md).
    expect(landmark('wat_doi_suthep').offmap).toMatchObject({ roundTrip: true, fare: 400 });
  });

  it('every portal can be reached from Tha Phae Gate and back', () => {
    const gate = landmark('tha_phae_gate').node;
    for (const p of world.graph.portals) {
      expect(world.router.route(gate, p.out)).not.toBeNull();
      expect(world.router.route(p.in, gate)).not.toBeNull();
    }
  });

  it('a one-way drop at the Zoo leaves town, pays, and comes back empty', () => {
    const game = Game.create(world, { seed: 3 });
    const cash0 = game.state.cash;
    const { v } = tripTo(game, 'chiang_mai_zoo');
    let sawAway = false;
    for (let t = 0; t < 3 * HOUR; t += 2) {
      game.step(2);
      if (v.task.kind === 'away') sawAway = true;
      if (sawAway && v.task.kind === 'idle') break;
    }
    expect(sawAway).toBe(true);
    expect(v.task.kind).toBe('idle');
    expect(game.state.stats.trips).toBe(1);
    expect(game.state.cash).toBeGreaterThan(cash0);
    // Back on the map at a portal's inbound node.
    expect(world.graph.portals.some((p) => world.graph.arcFrom(v.arc) === p.in)).toBe(true);
  });

  it('a Doi Suthep round trip brings the passenger back to the pickup', () => {
    const game = Game.create(world, { seed: 4 });
    const v = game.playerVehicle()!;
    // Only climbing tuk-tuks can take it; give the player an EV.
    v.model = 'ev_new';
    const { req } = tripTo(game, 'wat_doi_suthep');
    expect(req.fairFare).toBe(400);
    let returned = false;
    for (let t = 0; t < 6 * HOUR && game.state.stats.trips === 0; t += 2) {
      game.step(2);
      if (v.task.kind === 'trip' && v.task.trip.returning) returned = true;
    }
    expect(returned).toBe(true);
    expect(game.state.stats.trips).toBe(1);
    const pose = game.vehiclePose(v);
    const from = landmark('tha_phae_gate');
    expect(Math.hypot(pose.x - world.graph.nodeX[from.node], pose.y - world.graph.nodeY[from.node])).toBeLessThan(60);
  });
});
