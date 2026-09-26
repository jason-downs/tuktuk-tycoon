import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { DAY, HOUR, calendar, timeOf } from '../src/sim/clock';
import { CLOSED_TIME_FACTOR, roadSetEdges } from '../src/sim/closures';
import { makeRequest } from '../src/sim/demand';
import { activeOccurrences, occurrencesBetween } from '../src/sim/events';
import { Game } from '../src/sim/game';
import type { GraphJSON } from '../src/sim/graph';
import { rivalsOf, takeChance } from '../src/sim/rivals';
import { installSystems } from '../src/sim/systems';
import type { Place, RideRequest, Trip } from '../src/sim/types';
import { hazeLevel, skyAt, temperature, weatherAt, weatherForecast } from '../src/sim/weather';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));
const graph = world.graph;
const landmark = (id: string): Place => world.landmarks.find((l) => l.id === id)!;
const ids = (time: number) => activeOccurrences(time).map((o) => o.event.id);

/** A game at a given time with the world systems installed. */
function gameAt(time: number, seed = 42): Game {
  const game = Game.create(world, { seed });
  game.state.time = time;
  installSystems(game);
  game.step(1);
  return game;
}

function routeNames(game: Game, from: number, to: number): Set<string> {
  const route = game.world.router.route(from, to)!;
  expect(route).not.toBeNull();
  return new Set(route.arcs.map((a) => graph.edgeName(a >> 1)));
}

describe('calendar events', () => {
  it('activate by date and hour', () => {
    // Yi Peng: 23–25 Nov 2026, 17:00–01:00; the grand parade only on the 25th, 19:00–23:00.
    expect(ids(timeOf(2026, 10, 24, 20))).toContain('yi_peng');
    expect(ids(timeOf(2026, 10, 24, 12))).not.toContain('yi_peng');
    expect(ids(timeOf(2026, 10, 26, 0.5))).toContain('yi_peng');
    expect(ids(timeOf(2026, 10, 26, 2))).not.toContain('yi_peng');
    expect(ids(timeOf(2026, 10, 25, 20))).toContain('krathong_parade');
    expect(ids(timeOf(2026, 10, 24, 20))).not.toContain('krathong_parade');
    // Walking streets: Sunday 16–23 on Ratchadamnoen, Saturday 17–23 on Wualai.
    expect(calendar(timeOf(2026, 10, 8)).weekday).toBe(0);
    expect(ids(timeOf(2026, 10, 8, 17))).toContain('sunday_walking_street');
    expect(ids(timeOf(2026, 10, 8, 12))).not.toContain('sunday_walking_street');
    expect(ids(timeOf(2026, 10, 9, 17))).not.toContain('sunday_walking_street');
    expect(ids(timeOf(2026, 10, 7, 18))).toContain('saturday_walking_street');
    // Songkran 2027 and Chinese New Year 2027.
    expect(ids(timeOf(2027, 3, 14, 12))).toContain('songkran');
    expect(ids(timeOf(2027, 3, 14, 23))).not.toContain('songkran');
    expect(ids(timeOf(2027, 1, 6, 12))).toContain('chinese_new_year');
  });

  it('treats an all-day run as one occurrence', () => {
    const runs = occurrencesBetween(timeOf(2026, 11, 1), timeOf(2026, 11, 20)).filter((o) => o.event.id === 'fathers_day_weekend');
    expect(runs).toHaveLength(1);
    expect(runs[0].start).toBe(timeOf(2026, 11, 5));
    expect(runs[0].end).toBe(timeOf(2026, 11, 8));
  });

  it('announces an event when it starts and boosts demand near its sites', () => {
    const game = gameAt(timeOf(2026, 10, 22, 16.8));
    for (let t = 0; t < DAY; t += 4) game.step(4);
    expect(game.state.notices.some((n) => n.kind === 'event' && n.text.includes('Coming up: Yi Peng'))).toBe(true);
    const gate = landmark('tha_phae_gate');
    const demandAt = (p: Place) => game.demandModifiers.reduce((m, f) => m * f(p, calendar(game.state.time)), 1);
    const before = demandAt(gate);
    for (let t = 0; t < 0.5 * HOUR; t += 4) game.step(4);
    const notice = game.state.notices.find((n) => n.kind === 'event' && n.text.includes('Yi Peng begins'));
    expect(notice).toBeDefined();
    expect(notice!.x).toBeCloseTo(gate.x, 0);
    expect(demandAt(gate)).toBeGreaterThan(before * 1.8);
    // Far from any site the festival does not change demand.
    const far = landmark('cnx_airport');
    expect(demandAt(far)).toBeCloseTo(1, 5);
  });

  it('sends festival-goers to the event', () => {
    const game = gameAt(timeOf(2026, 10, 23, 17));
    const targets = new Set([landmark('tha_phae_gate').idx, landmark('nawarat_bridge').idx]);
    let toFestival = 0;
    const seen = new Set<number>();
    for (let t = 0; t < 2 * HOUR; t += 4) {
      game.step(4);
      for (const r of game.state.requests) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        if (targets.has(r.to) && /lantern|krathong|river/i.test(r.line)) toFestival++;
      }
    }
    // ~30 an hour at full strength.
    expect(toFestival).toBeGreaterThan(25);
  });
});

describe('road closures', () => {
  const west = landmark('wat_phra_singh').node;
  const east = landmark('tha_phae_gate').node;

  it('route across the Old City avoids Ratchadamnoen on Sunday evening but may use it on Monday', () => {
    const monday = gameAt(timeOf(2026, 10, 9, 18));
    expect(monday.edgePenalty).toBeNull();
    expect(routeNames(monday, west, east).has('Rachadamnoen Road')).toBe(true);
    expect(routeNames(monday, east, west).has('Rachadamnoen Road')).toBe(true);

    const sunday = gameAt(timeOf(2026, 10, 8, 18));
    expect(sunday.edgePenalty).not.toBeNull();
    expect(routeNames(sunday, west, east).has('Rachadamnoen Road')).toBe(false);
    expect(routeNames(sunday, east, west).has('Rachadamnoen Road')).toBe(false);

    // The same game reopens the road after 23:00.
    for (let t = 0; t < 5.5 * HOUR; t += 4) sunday.step(4);
    expect(calendar(sunday.state.time).hour).toBeGreaterThan(23);
    expect(sunday.edgePenalty).toBeNull();
    expect(routeNames(sunday, west, east).has('Rachadamnoen Road')).toBe(true);
  });

  it('marks closed and slowed edges for routing and movement', () => {
    const ratchadamnoen = roadSetEdges(graph, 'ratchadamnoen');
    expect(ratchadamnoen.length).toBeGreaterThan(10);
    for (const e of ratchadamnoen) expect(graph.edgeName(e)).toBe('Rachadamnoen Road');
    const sunday = gameAt(timeOf(2026, 10, 8, 18));
    expect(sunday.edgePenalty!(ratchadamnoen[0])).toBe(CLOSED_TIME_FACTOR);
    // Songkran: moat roads crawl at 40 % speed.
    const songkran = gameAt(timeOf(2027, 3, 14, 12));
    const moat = roadSetEdges(graph, 'moat');
    expect(moat.length).toBeGreaterThan(20);
    expect(songkran.edgePenalty!(moat[0])).toBeCloseTo(2.5, 5);
    // Wualai closes on Saturday evenings only.
    const wualai = roadSetEdges(graph, 'wualai')[0];
    expect(gameAt(timeOf(2026, 10, 7, 18)).edgePenalty!(wualai)).toBe(CLOSED_TIME_FACTOR);
  });

  it('still reaches a passenger standing on a closed street', () => {
    const sunday = gameAt(timeOf(2026, 10, 8, 18));
    const market = landmark('sunday_walking_street');
    const route = sunday.world.router.route(landmark('chiang_mai_gate').node, market.node);
    expect(route).not.toBeNull();
    expect(graph.arcTo(route!.arcs.at(-1)!)).toBe(market.node);
  });
});

describe('weather', () => {
  const SEEDS = Array.from({ length: 12 }, (_, i) => 1000 + i * 7919);
  const monthHours = (year: number, month: number) => {
    const first = timeOf(year, month, 1) / HOUR;
    const last = timeOf(year, month + 1, 1) / HOUR;
    return { first, last };
  };
  const wetShare = (year: number, month: number) => {
    const { first, last } = monthHours(year, month);
    let wet = 0;
    let n = 0;
    for (const seed of SEEDS) {
      for (let h = first; h < last; h++) {
        const s = skyAt(seed, h);
        if (s === 'rain' || s === 'storm') wet++;
        n++;
      }
    }
    return wet / n;
  };

  it('rains far more in the wet season than the cool season', () => {
    const jan = wetShare(2027, 0);
    const aug = wetShare(2027, 7);
    const dec = wetShare(2026, 11);
    expect(aug).toBeGreaterThan(0.05);
    expect(aug).toBeLessThan(0.4);
    expect(aug).toBeGreaterThan(jan * 5);
    expect(aug).toBeGreaterThan(dec * 5);
  });

  it('weights storms to the afternoon', () => {
    let afternoon = 0;
    let morning = 0;
    for (const month of [5, 6, 7, 8]) {
      const { first, last } = monthHours(2027, month);
      for (const seed of SEEDS) {
        for (let h = first; h < last; h++) {
          if (skyAt(seed, h) !== 'storm' || skyAt(seed, h - 1) === 'storm') continue;
          const hod = h % 24;
          if (hod >= 13 && hod < 18) afternoon++;
          if (hod >= 7 && hod < 12) morning++;
        }
      }
    }
    expect(afternoon).toBeGreaterThan(20);
    expect(afternoon).toBeGreaterThan(morning * 1.5);
  });

  it('brings smoky haze in March and April, not in the green season', () => {
    const hazeShare = (year: number, month: number) => {
      const d0 = timeOf(year, month, 1) / DAY;
      const d1 = timeOf(year, month + 1, 1) / DAY;
      let n = 0;
      let hazy = 0;
      for (const seed of SEEDS) for (let d = d0; d < d1; d++, n++) if (hazeLevel(seed, d) > 0) hazy++;
      return hazy / n;
    };
    expect(hazeShare(2027, 2)).toBeGreaterThan(0.4);
    expect(hazeShare(2027, 3)).toBeGreaterThan(0.3);
    expect(hazeShare(2027, 7)).toBe(0);
    expect(hazeShare(2026, 10)).toBe(0);
  });

  it('keeps fog to cool-season mornings', () => {
    const fogHours = (year: number, month: number) => {
      const { first, last } = monthHours(year, month);
      const hours: number[] = [];
      for (const seed of SEEDS) for (let h = first; h < last; h++) if (skyAt(seed, h) === 'fog') hours.push(h % 24);
      return hours;
    };
    const jan = fogHours(2027, 0);
    expect(jan.length).toBeGreaterThan(0);
    for (const h of jan) expect(h >= 5 && h < 9).toBe(true);
    expect(fogHours(2027, 6)).toHaveLength(0);
  });

  it('is deterministic and the forecast matches what happens', () => {
    const game = gameAt(timeOf(2027, 7, 10, 9), 777);
    const blocks = weatherForecast(game, 24, 1);
    for (const b of blocks) expect(b.sky).toBe(weatherAt(777, b.time).sky);
    expect(weatherAt(777, timeOf(2027, 7, 10, 15)).sky).toBe(skyAt(777, timeOf(2027, 7, 10, 15) / HOUR));
    expect(temperature(3, 15, 'clear')).toBeGreaterThan(temperature(11, 6, 'clear') + 15);
  });

  it('wets riders without rain curtains', () => {
    const seed = 4242;
    const findSky = (sky: string) => {
      for (let h = timeOf(2027, 7, 1) / HOUR; ; h++) if (skyAt(seed, h) === sky) return h * HOUR + 1800;
    };
    const ratingAt = (time: number, curtains: boolean) => {
      const game = gameAt(time, seed);
      const v = game.playerVehicle()!;
      if (curtains) v.upgrades.push('rain_curtains');
      const req = makeRequest(game, landmark('tha_phae_gate'), landmark('maya'), 'backpacker', 'street', calendar(time));
      const trip: Trip = { request: req, fare: 100, ratio: 1, startedAt: time - 600, distance: 4000 };
      return game.ratingModifiers.reduce((sum, m) => sum + m(v, trip), 0);
    };
    const rain = findSky('rain');
    expect(ratingAt(rain, false)).toBeCloseTo(-0.3, 5);
    expect(ratingAt(rain, true)).toBeCloseTo(0, 5);
    const storm = findSky('storm');
    expect(ratingAt(storm, false)).toBeLessThan(-0.5);
    expect(ratingAt(storm, true)).toBeGreaterThan(ratingAt(storm, false));
    const dry = timeOf(2026, 11, 10, 12);
    expect(skyAt(seed, dry / HOUR)).not.toBe('rain');
    expect(ratingAt(dry, false)).toBeCloseTo(0, 5);
  });
});

describe('rivals', () => {
  const baseReq = (arch: RideRequest['archetype'], waited: number, time: number): RideRequest => ({
    id: 1,
    from: 0,
    to: 1,
    archetype: arch,
    party: 1,
    channel: 'street',
    spawnedAt: time - waited * 1200,
    expiresAt: time + (1 - waited) * 1200,
    distance: 3000,
    fairFare: 100,
    fixedFare: null,
    maxRatio: 1.2,
    line: '',
    claimedBy: null,
  });

  it('songthaews win locals, rival tuk-tuks win tourists, and long waits and lean months help them', () => {
    const t = timeOf(2026, 11, 10, 12);
    expect(takeChance('songthaew', baseReq('vendor', 0.5, t), t)).toBeGreaterThan(takeChance('songthaew', baseReq('tourist_west', 0.5, t), t) * 2);
    expect(takeChance('tuktuk', baseReq('tourist_west', 0.5, t), t)).toBeGreaterThan(takeChance('tuktuk', baseReq('vendor', 0.5, t), t) * 2);
    expect(takeChance('songthaew', baseReq('elder', 0.9, t), t)).toBeGreaterThan(takeChance('songthaew', baseReq('elder', 0.05, t), t) * 2);
    const july = timeOf(2027, 6, 10, 12);
    expect(takeChance('songthaew', baseReq('student', 0.5, july), july)).toBeGreaterThan(takeChance('songthaew', baseReq('student', 0.5, t), t));
    expect(takeChance('car', baseReq('vendor', 1, t), t)).toBe(0);
  });

  it('puts 20–40 vehicles on the road and more as the months pass', () => {
    const nov = gameAt(timeOf(2026, 10, 2, 12));
    const sys = rivalsOf(nov)!;
    expect(sys.count).toBeGreaterThanOrEqual(20);
    expect(sys.count).toBeLessThanOrEqual(40);
    for (let t = 0; t < 0.5 * HOUR; t += 4) nov.step(4);
    let routed = 0;
    for (let i = 0; i < sys.count; i++) if (sys.routes[i]) routed++;
    expect(routed).toBeGreaterThan(sys.count * 0.8);
    const later = gameAt(timeOf(2027, 5, 2, 12));
    expect(rivalsOf(later)!.count).toBeGreaterThan(sys.count);
  });

  it('a passing songthaew takes a waiting local but never a claimed passenger', () => {
    const game = gameAt(timeOf(2026, 10, 3, 11));
    for (let t = 0; t < 120; t += 4) game.step(4);
    const sys = rivalsOf(game)!;
    // A place right on the road network, and a rival parked on its node.
    const place = world.places.find((p) => !p.landmark && p.cat === 'market' && Math.hypot(p.x - graph.nodeX[p.node], p.y - graph.nodeY[p.node]) < 15)!;
    const dest = landmark('warorot_market');
    const i = 0;
    sys.kind[i] = 0;
    sys.routes[i] = game.world.router.route(place.node, dest.node);
    sys.idx[i] = 0;
    sys.s[i] = 0;
    sys.pauseUntil[i] = game.state.time + HOUR;
    const time = game.state.time;
    const cal = calendar(time);
    const local = makeRequest(game, place, dest, 'vendor', 'street', cal);
    local.spawnedAt = time - 20 * 60;
    local.expiresAt = time + 5 * 60;
    const claimed = makeRequest(game, place, dest, 'elder', 'street', cal);
    claimed.spawnedAt = time - 20 * 60;
    claimed.expiresAt = time + 5 * 60;
    claimed.claimedBy = game.playerVehicle()!.id;
    game.state.requests = [local, claimed];
    const before = (game.state.systems.rivals as { taken: number }).taken;
    for (let k = 0; k < 30 && game.state.requests.some((r) => r.id === local.id); k++) sys.compete(game);
    expect(game.state.requests.some((r) => r.id === local.id)).toBe(false);
    expect(game.state.requests.some((r) => r.id === claimed.id)).toBe(true);
    expect((game.state.systems.rivals as { taken: number }).taken).toBe(before + 1);
  });

  it('competes for street hails over a day and survives save and load', () => {
    const game = gameAt(timeOf(2026, 10, 4, 6));
    game.state.autopilot = true;
    for (let t = 0; t < 8 * HOUR; t += 4) game.step(4);
    const st = game.state.systems.rivals as { taken: number; fleet: number[] };
    expect(st.taken).toBeGreaterThan(10);
    const copy = Game.load(world, JSON.parse(game.serialize()));
    installSystems(copy);
    const a = rivalsOf(game)!;
    const b = rivalsOf(copy)!;
    expect(b.count).toBe(a.count);
    for (let i = 0; i < a.count; i++) expect(b.kind[i]).toBe(a.kind[i]);
    for (let t = 0; t < 600; t += 4) copy.step(4);
    let routed = 0;
    for (let i = 0; i < b.count; i++) if (b.routes[i]) routed++;
    expect(routed).toBeGreaterThan(b.count * 0.8);
  });
});

describe('world systems', () => {
  it('load old saves without world state and stay fast', () => {
    const game = Game.create(world, { seed: 5 });
    const state = JSON.parse(game.serialize());
    delete state.systems;
    state.systems = {};
    const loaded = Game.load(world, state);
    installSystems(loaded);
    loaded.state.autopilot = true;
    const t0 = performance.now();
    for (let t = 0; t < 12 * HOUR; t += 4) loaded.step(4);
    const ms = performance.now() - t0;
    expect(loaded.state.stats.trips).toBeGreaterThan(5);
    expect(ms).toBeLessThan(6000);
  });
});
