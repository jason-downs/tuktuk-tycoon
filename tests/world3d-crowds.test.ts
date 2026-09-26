import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { calendar, timeOf } from '../src/sim/clock';
import type { GraphJSON } from '../src/sim/graph';
import type { Place } from '../src/sim/types';
import { ROAD_FLAG, ringOf, type CityData } from '../src/world3d/city';
import { buildCity } from '../src/world3d/build/world';
import { CrowdSim, WALK_KIND, WalkNet, isAlmsTime, walkingStreetOpen, type CrowdFrame } from '../src/world3d/crowd';
import { pointInRing } from '../src/world3d/build/shapes';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const city = read<CityData>('city3d.json');
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));
const built = buildCity(city);
const net = WalkNet.fromProps(built.props)!;

/** Distance from a point to the nearest carriageway edge of the given ways (negative = on the road). */
function roadClearance(x: number, y: number, wayFilter: (way: number[]) => boolean): number {
  let best = Infinity;
  const rn = city.roads.nodes;
  for (const way of city.roads.ways) {
    if (!wayFilter(way)) continue;
    const refs = way.slice(7);
    const half = way[2] / 20;
    for (let i = 1; i < refs.length; i++) {
      const ax = rn[2 * refs[i - 1]] / 10;
      const ay = rn[2 * refs[i - 1] + 1] / 10;
      const bx = rn[2 * refs[i]] / 10;
      const by = rn[2 * refs[i] + 1] / 10;
      if (Math.min(ax, bx) - 30 > x || Math.max(ax, bx) + 30 < x || Math.min(ay, by) - 30 > y || Math.max(ay, by) + 30 < y) continue;
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t) - half);
    }
  }
  return best;
}

const landmark = (id: string): Place => world.landmarks.find((l) => l.id === id)!;

/** A frame around a place at a game time, with demand-like activity (landmarks strong, others by weight). */
function frameAt(p: Place, time: number, radius = 400): CrowdFrame {
  const cal = calendar(time);
  return {
    x: p.x,
    y: p.y,
    radius,
    cap: 300,
    cal,
    activity: (q) => (q.id === 'night_bazaar' && cal.hour >= 18 ? q.weight * 2.5 : q.weight * (cal.hour > 6 && cal.hour < 23 ? 0.5 : 0.05)),
    walkDt: 0.25,
    realDt: 1 / 60,
  };
}

describe('walkways for the crowds', () => {
  it('bakes pavement runs, walking-street aisles and corner links', () => {
    const walk = built.props.walk;
    const links = built.props.walk_link;
    console.log(
      `walk vertices ${walk.length / 4}, sunday ${(built.props.walk_sun?.length ?? 0) / 4}, saturday ${(built.props.walk_sat?.length ?? 0) / 4}, links ${(links?.length ?? 0) / 4}, build ${built.stats.ms.toFixed(0)} ms`,
    );
    expect(walk.length / 4).toBeGreaterThan(5_000);
    expect(walk.length / 4).toBeLessThan(150_000);
    expect(built.props.walk_sun?.length).toBeGreaterThan(0);
    expect(built.props.walk_sat?.length).toBeGreaterThan(0);
    expect(links.length / 4).toBeGreaterThan(500);
    for (let i = 0; i < walk.length; i++) expect(Number.isFinite(walk[i])).toBe(true);
  });

  it('keeps pavement walks off every carriageway and out of buildings', () => {
    const walk = built.props.walk;
    const n = walk.length / 4;
    const blds = city.buildings.filter((b) => !b.part).map((b) => ringOf(b.r));
    let checked = 0;
    for (let i = 0; i < n; i += 37) {
      const x = walk[i * 4];
      const y = walk[i * 4 + 1];
      expect(roadClearance(x, y, () => true)).toBeGreaterThan(0.2);
      // Midpoint of the stretch to the next vertex too.
      const len = walk[i * 4 + 3];
      if (len > 0) {
        const mx = (x + walk[(i + 1) * 4]) / 2;
        const my = (y + walk[(i + 1) * 4 + 1]) / 2;
        expect(roadClearance(mx, my, () => true)).toBeGreaterThan(0.2);
      }
      checked++;
    }
    let inside = 0;
    for (let i = 0; i < n; i += 211) {
      const x = walk[i * 4];
      const y = walk[i * 4 + 1];
      if (blds.some((r) => pointInRing(x, y, r))) inside++;
    }
    expect(checked).toBeGreaterThan(100);
    expect(inside).toBe(0);
  });

  it('crosses only minor roads at links', () => {
    const links = built.props.walk_link;
    const walk = built.props.walk;
    for (let i = 0; i < links.length; i += 4 * 7) {
      const a = links[i];
      const b = links[i + 1];
      const ax = walk[a * 4];
      const ay = walk[a * 4 + 1];
      const bx = walk[b * 4];
      const by = walk[b * 4 + 1];
      expect(Math.hypot(bx - ax, by - ay)).toBeLessThanOrEqual(12.01);
      expect(walk[a * 4 + 3] === 0 || a === 0 || walk[(a - 1) * 4 + 3] === 0).toBe(true);
      expect(roadClearance((ax + bx) / 2, (ay + by) / 2, (w) => w[0] <= 4)).toBeGreaterThan(-0.01);
    }
  });

  it('puts the walking-street aisles on the named streets only', () => {
    for (const [kind, re] of [
      ['walk_sun', /^Ra?t?chadamnoen Road$/i],
      ['walk_sat', /^(Wua ?lai|Wualai) Road$/i],
    ] as const) {
      const arr = built.props[kind];
      for (let i = 0; i < arr.length; i += 4 * 5) {
        const d = roadClearance(arr[i], arr[i + 1], (w) => re.test(city.strings[w[4]] ?? ''));
        expect(d).toBeLessThan(0);
      }
    }
    // And the walking streets open on schedule.
    expect(walkingStreetOpen(WALK_KIND.sunday, calendar(timeOf(2026, 10, 1, 19)))).toBe(true);
    expect(walkingStreetOpen(WALK_KIND.sunday, calendar(timeOf(2026, 10, 2, 19)))).toBe(false);
    expect(walkingStreetOpen(WALK_KIND.saturday, calendar(timeOf(2026, 10, 7, 18)))).toBe(true);
    expect(walkingStreetOpen(WALK_KIND.saturday, calendar(timeOf(2026, 10, 7, 12)))).toBe(false);
  });
});

describe('crowd simulation', () => {
  it('fills busy places at night and empties the small hours, within the cap', () => {
    const bazaar = landmark('night_bazaar');
    const evening = new CrowdSim(net, world.places, 3);
    const lateNight = new CrowdSim(net, world.places, 3);
    const eveningFrame = frameAt(bazaar, timeOf(2026, 10, 3, 20.5));
    const nightFrame = frameAt(bazaar, timeOf(2026, 10, 3, 3));
    for (let i = 0; i < 240; i++) {
      evening.update(eveningFrame);
      lateNight.update(nightFrame);
    }
    const alive = (s: CrowdSim) => s.walkers.filter((w) => !w.dying).length;
    console.log(`Night Bazaar walkers at 20:30: ${alive(evening)} (demand ${evening.demand().toFixed(0)}), at 03:00: ${alive(lateNight)}`);
    expect(alive(evening)).toBeGreaterThan(120);
    expect(evening.walkers.length).toBeLessThanOrEqual(300 + 12);
    expect(alive(lateNight)).toBeLessThan(alive(evening) / 4);
  });

  it('keeps walkers on the pavement network and off main carriageways as they walk', () => {
    const gate = landmark('tha_phae_gate');
    const sim = new CrowdSim(net, world.places, 5);
    const f = frameAt(gate, timeOf(2026, 10, 4, 11), 300);
    let worst = Infinity;
    let finite = true;
    for (let step = 0; step < 400; step++) {
      sim.update(f);
      if (step % 40 !== 39) continue;
      for (const w of sim.walkers.slice(0, 40)) {
        finite &&= Number.isFinite(w.x) && Number.isFinite(w.y) && Number.isFinite(w.yaw);
        if (w.leader) continue;
        worst = Math.min(worst, roadClearance(w.x, w.y, (way) => way[0] <= 4 && !(way[1] & ROAD_FLAG.TUNNEL)));
      }
    }
    expect(finite).toBe(true);
    // Walkers stay on pavements; the 0.35 m sideways spread and link hops over minor roads are the slack.
    expect(worst).toBeGreaterThan(-0.2);
  });

  it('sends monks out in single file at dawn', () => {
    const temple = landmark('wat_chedi_luang') ?? world.places.find((p) => p.cat === 'temple')!;
    const dawn = timeOf(2026, 10, 5, 6.2);
    expect(isAlmsTime(calendar(dawn))).toBe(true);
    const sim = new CrowdSim(net, world.places, 11);
    const f = frameAt(temple, dawn, 400);
    for (let i = 0; i < 300; i++) sim.update(f);
    const monks = sim.walkers.filter((w) => w.alms && !w.dying);
    expect(monks.length).toBeGreaterThanOrEqual(3);
    const file = monks.filter((w) => w.leader);
    expect(file.length).toBeGreaterThan(0);
    for (const m of file) {
      expect(m.lat).toBe(0);
      expect(Math.hypot(m.x - m.leader!.x, m.y - m.leader!.y)).toBeLessThan(m.slot * 1.5 + 0.5);
    }
  });

  it('is deterministic for a seed', () => {
    const gate = landmark('tha_phae_gate');
    const run = () => {
      const sim = new CrowdSim(net, world.places, 9);
      const f = frameAt(gate, timeOf(2026, 10, 4, 17));
      for (let i = 0; i < 60; i++) sim.update(f);
      return sim.walkers.map((w) => `${w.type}:${w.x.toFixed(2)},${w.y.toFixed(2)}`).join('|');
    };
    expect(run()).toBe(run());
  });
});
