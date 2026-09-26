import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { requestValue } from '../src/sim/ai';
import { makeRequest } from '../src/sim/demand';
import { awaySeconds } from '../src/sim/offmap';
import { claimRequest, inRide, rideFatigue, startTrip, type TripResult } from '../src/sim/dispatch';
import { calendar, HOUR } from '../src/sim/clock';
import { whyCantAssign, whyCantReturn } from '../src/sim/fleet';
import { workshopBlock } from '../src/sim/garage';
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
  req.party = 2;
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

  it('out of town the tuk-tuk can’t be sent elsewhere, serviced or handed over, and the fare still comes in', () => {
    const game = Game.create(world, { seed: 3 });
    const cash0 = game.state.cash;
    const { v } = tripTo(game, 'chiang_mai_zoo');
    for (let t = 0; t < 2 * HOUR && v.task.kind !== 'away'; t += 2) game.step(2);
    expect(v.task.kind).toBe('away');
    const gate = landmark('tha_phae_gate');
    const other = makeRequest(game, gate, landmark('wat_chedi_luang'), 'backpacker', 'app', calendar(game.state.time));
    other.party = 1;
    game.state.requests.push(other);

    expect(game.playerDriveTo(gate.x, gate.y)).toBe(false);
    expect(game.playerRefuel()).toBe(false);
    expect(game.playerClaim(other.id)).toBe(false);
    expect(game.state.notices.at(-1)!.text).toMatch(/out of town/);
    expect(claimRequest(game, v, other.id)).toBe(false);
    expect(workshopBlock(v)).toMatch(/Out of town/);
    expect(whyCantReturn(v)).toMatch(/Out of town/);
    expect(whyCantAssign(game, game.player().id, null)).toMatch(/out of town/);
    expect(inRide(v)).toBe(true);
    expect(v.task.kind).toBe('away');

    for (let t = 0; t < 3 * HOUR && v.task.kind !== 'idle'; t += 2) game.step(2);
    expect(game.state.stats.trips).toBe(1);
    expect(game.state.cash).toBeGreaterThan(cash0);
  });

  it('rates an out-of-town ride by its driving in town, and tires the driver for the whole distance', () => {
    const game = Game.create(world, { seed: 4 });
    const v = game.playerVehicle()!;
    v.model = 'ev_new';
    // Without the random spread, a fair fare and the player's charm put a ride at 4.47 plus its speed term.
    game.rng.gauss = () => 0;
    const player = game.player();
    const fatigue0 = player.fatigue;
    let result: TripResult | null = null;
    let endHour = 0;
    game.on('trip', (r: TripResult) => {
      result = r;
      endHour = calendar(game.state.time).hour;
    });
    const { req } = tripTo(game, 'wat_doi_suthep');
    let inTown = 0;
    for (let t = 0; t < 6 * HOUR && !result; t += 2) {
      if (v.task.kind === 'trip') inTown = v.task.trip.distance;
      game.step(2);
    }
    expect(result).not.toBeNull();
    const r = result as unknown as TripResult;
    // Driven at the GPS's pace in town, the ride is not rated as a slow one.
    expect(r.rating).toBeGreaterThan(4.4);
    // The in-town distance counts both legs: out to the portal and back to the pickup.
    const portal = world.router.route(landmark('tha_phae_gate').node, landmark('wat_doi_suthep').node)!.length;
    expect(inTown).toBeGreaterThan(portal * 1.5);
    const off = landmark('wat_doi_suthep').offmap!;
    const km = (inTown + 2 * off.extraM) / 1000;
    expect(player.fatigue - fatigue0).toBeCloseTo(rideFatigue(player.stamina, km * 1000, endHour), 6);
    expect(req.fairFare).toBe(400);
  });

  it('prices a round trip at its return fare from the moment it is booked', () => {
    const game = Game.create(world, { seed: 5 });
    const cal = calendar(game.state.time);
    for (const id of ['night_safari', 'grand_canyon', 'wat_doi_suthep']) {
      const req = makeRequest(game, landmark('tha_phae_gate'), landmark(id), 'tourist_west', 'regular', cal);
      expect(req.fairFare).toBe(landmark(id).offmap!.fare);
    }
  });

  it('fleet drivers value a round trip by the whole outing, wait and ride back included', () => {
    const game = Game.create(world, { seed: 5 });
    const v = game.playerVehicle()!;
    const cal = calendar(game.state.time);
    const safari = landmark('night_safari');
    const req = makeRequest(game, landmark('tha_phae_gate'), safari, 'tourist_west', 'street', cal);
    req.expiresAt = game.state.time + HOUR;
    const off = safari.offmap!;
    const outing = 2 * (req.distance / 7) + off.waitS;
    expect(requestValue(game, v, req)).toBeLessThan(req.fairFare / outing);
    // A one-way drop out of town counts the empty drive back from beyond the portal.
    const zoo = landmark('chiang_mai_zoo');
    const drop = makeRequest(game, landmark('tha_phae_gate'), zoo, 'tourist_west', 'street', cal);
    drop.expiresAt = game.state.time + HOUR;
    expect(requestValue(game, v, drop)).toBeLessThanOrEqual(drop.fairFare / (drop.distance / 7 + 120 + awaySeconds(game, zoo, zoo.offmap!.extraM)));
  });
});
