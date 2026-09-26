import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { calendar } from '../src/sim/clock';
import { makeRequest } from '../src/sim/demand';
import { Game } from '../src/sim/game';
import type { GraphJSON } from '../src/sim/graph';
import { RIVAL_KINDS, RivalsSystem, TAKE_RADIUS } from '../src/sim/rivals';
import { installSystems } from '../src/sim/systems';
import type { Place, RideRequest } from '../src/sim/types';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));
const graph = world.graph;
const landmark = (id: string): Place => world.landmarks.find((l) => l.id === id)!;

/**
 * A game whose only rival is a red songthaew parked beside the player's idle tuk-tuk at Tha Phae Gate, with a
 * passenger of the given party size waiting there for `to`. Returns the game, the rivals system and the passenger.
 */
function songthaewBeside(party: number, to = landmark('wat_chedi_luang')) {
  const game = Game.create(world, { seed: 7 });
  installSystems(game);
  game.state.requests = [];
  const gate = landmark('tha_phae_gate');
  const v = game.playerVehicle()!;
  const arc = Array.from({ length: graph.edges.length * 2 }, (_, a) => a).find(
    (a) => graph.arcValid(a) && graph.arcTo(a) === gate.node && graph.arcLen(a) > 10 && !graph.edges[a >> 1].virtual,
  )!;
  v.arc = arc;
  v.s = graph.arcLen(arc) - 2;
  v.speed = 0;
  v.route = null;
  v.task = { kind: 'idle' };
  const rivals = game.systems.find((s): s is RivalsSystem => s instanceof RivalsSystem)!;
  rivals.count = 1;
  rivals.kind[0] = RIVAL_KINDS.indexOf('songthaew');
  rivals.routes[0] = null;
  rivals.parkArc[0] = arc;
  rivals.parkS[0] = v.s;
  rivals.pauseUntil[0] = 0;
  rivals.busyUntil[0] = 0;
  const pose = game.vehiclePose(v);
  expect(Math.hypot(gate.x - pose.x, gate.y - pose.y)).toBeLessThan(TAKE_RADIUS);
  // A vendor who has waited a long while takes the first songthaew that stops.
  const req: RideRequest = makeRequest(game, gate, to, 'vendor', 'street', calendar(game.state.time));
  req.party = party;
  req.spawnedAt = game.state.time - 3600;
  game.state.requests.push(req);
  return { game, rivals, req };
}

/** Let the songthaew try for the passenger until it has them; returns the notices posted meanwhile. */
function lose(party: number, to?: Place): string[] {
  const { game, rivals, req } = songthaewBeside(party, to);
  const before = game.state.notices.length;
  for (let i = 0; i < 100 && game.state.requests.includes(req); i++) rivals.compete(game);
  expect(game.state.requests.includes(req)).toBe(false);
  return game.state.notices.slice(before).map((n) => n.text);
}

describe('rival pickups', () => {
  it('tells the player about a passenger their tuk-tuk could have taken', () => {
    expect(lose(2)).toEqual([expect.stringMatching(/songthaew picked up the passenger waiting at Tha Phae Gate/)]);
  });

  it('says nothing about a party too big for the player’s tuk-tuk', () => {
    expect(lose(4)).toEqual([]);
  });

  it('says nothing about a ride up Doi Suthep the player’s tuk-tuk can’t climb', () => {
    expect(lose(2, landmark('wat_doi_suthep'))).toEqual([]);
  });
});
