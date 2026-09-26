// Buildings, temples and landmarks of the 3D city: geometry kit orientation,
// footprint normalisation, shophouse bays, height caps, temple inference
// (every ground gets a viharn facing its street and a chedi), hero landmarks
// at their anchors, roofs on walls, triangle budget and determinism.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CityData } from '../src/world3d/city';
import { ringOf } from '../src/world3d/city';
import { BC } from '../src/world3d/build/buildingPalette';
import { buildBuildings, drawBuilding, makeEnv, markPartyWalls, planBuilding, OLD_CITY_CAP, TEMPLE_CAP } from '../src/world3d/build/buildings';
import { chedi, type ChediSpec } from '../src/world3d/build/chedi';
import type { BuildContext } from '../src/world3d/build/context';
import { buildGround } from '../src/world3d/build/ground';
import { basis, beam, bp, edgeOf, face, gable, insetRing, lathe, obox, ringArea, UP } from '../src/world3d/build/kit';
import { HEROES, TEMPLE_HEROES } from '../src/world3d/build/landmarks3d';
import { MeshWriter, type PackedMesh } from '../src/world3d/build/mesh';
import { Occupancy } from '../src/world3d/build/occupancy';
import { RoadIndex } from '../src/world3d/build/roadIndex';
import { buildRoads } from '../src/world3d/build/roads';
import { BAY_MAX, BAY_MIN, bayLayout } from '../src/world3d/build/shophouse';
import { siteOf, simplePlan, type Plan } from '../src/world3d/build/site';
import { lannaHall, templeGroups } from '../src/world3d/build/temples';
import { canopy, house } from '../src/world3d/build/typologies';
import { buildCity } from '../src/world3d/build/world';
import { pointInRing } from '../src/world3d/build/shapes';

const city = JSON.parse(readFileSync(new URL('../public/data/city3d.json', import.meta.url), 'utf8')) as CityData;

function makeCtx(c: CityData): BuildContext {
  const keep = c.keep.map((v) => v / 10) as [number, number, number, number];
  return {
    city: c,
    w: {
      backdrop: new MeshWriter(),
      ground: new MeshWriter(),
      water: new MeshWriter(),
      roads: new MeshWriter(),
      structures: new MeshWriter(),
      buildings: new MeshWriter(),
      windows: new MeshWriter(),
      glow: new MeshWriter(),
    },
    occ: new Occupancy(...keep),
    keep,
    str: (i) => (i ? c.strings[i] : ''),
    parkAreas: [],
    moatRings: [],
    roadPts: [],
    trees: [],
    props: {},
  };
}

/** Triangles of a packed mesh: world-space corners and the flat normal. */
function* triangles(m: PackedMesh): Generator<{ p: number[][]; n: number[] }> {
  for (let t = 0; t < m.index.length; t += 3) {
    const p = [0, 1, 2].map((k) => {
      const i = m.index[t + k];
      return [m.position[i * 3], m.position[i * 3 + 1], m.position[i * 3 + 2]];
    });
    const i0 = m.index[t];
    yield { p, n: [m.normal[i0 * 3], m.normal[i0 * 3 + 1], m.normal[i0 * 3 + 2]] };
  }
}

/** Highest up-facing surface over world (x, z), from the triangles covering that point. */
function roofHeightAt(tris: { p: number[][]; n: number[] }[], x: number, z: number): number {
  let best = -Infinity;
  for (const { p, n } of tris) {
    if (n[1] <= 0.05) continue;
    const [a, b, c] = p;
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
    const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    best = Math.max(best, l1 * a[1] + l2 * b[1] + l3 * c[1]);
  }
  return best;
}

/** Geometric normal from the winding (world space). */
function windingNormal(p: number[][]): number[] {
  const a = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
  const b = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** A minimal city holding the given footprints (rings in metres, as baked: clockwise). */
function synthCity(rings: [number, number][][], extra: Partial<CityData['buildings'][number]>[] = []): CityData {
  return {
    ...city,
    strings: ['', 'yes'],
    roads: { nodes: [], ways: [], classes: city.roads.classes, surfaces: city.roads.surfaces },
    areas: [],
    lines: [],
    cityWalls: [],
    buildings: rings.map((r, k) => {
      const cw = ringArea(r) > 0 ? [...r].reverse() : r;
      let L = 0;
      let W = 0;
      const xs = cw.map((p) => p[0]);
      const ys = cw.map((p) => p[1]);
      L = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      W = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      const ang = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys) ? 0 : 1571;
      return { r: cw.flatMap(([x, y]) => [Math.round(x * 10), Math.round(y * 10)]), b: 1, z: city.zones.indexOf('old_city'), a: Math.round(Math.abs(ringArea(r))), o: [L * 10, W * 10, ang], id: 1000 + k, ...extra[k] };
    }),
    trees: [],
    props: [],
    shops: [],
  };
}

describe('geometry kit', () => {
  it('orients faces along their hint and boxes outwards', () => {
    const w = new MeshWriter();
    // A quad listed clockwise from above still faces up.
    face(w, [0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1], BC.gold, BC.gold, UP);
    const m = w.pack();
    expect(m.normal[1]).toBeCloseTo(1);
    const wn = windingNormal([...triangles(m)][0].p);
    expect(wn[1]).toBeGreaterThan(0);

    const w2 = new MeshWriter();
    const b = basis(10, 20, 0.7);
    obox(w2, b, -2, 3, -1, 1.5, 0, 4, BC.gold);
    const [cx, cy] = [bp(b, 0.5, 0.25, 0)[0], bp(b, 0.5, 0.25, 0)[1]];
    for (const { p, n } of triangles(w2.pack())) {
      const wn2 = windingNormal(p);
      // Winding agrees with the stored normal.
      expect(wn2[0] * n[0] + wn2[1] * n[1] + wn2[2] * n[2]).toBeGreaterThan(0);
      const mid = [(p[0][0] + p[1][0] + p[2][0]) / 3, (p[0][1] + p[1][1] + p[2][1]) / 3, (p[0][2] + p[1][2] + p[2][2]) / 3];
      if (Math.abs(n[1]) > 0.9) {
        expect(n[1]).toBeGreaterThan(0);
        expect(mid[1]).toBeCloseTo(4);
      } else {
        // Side faces point away from the box centre (world z = −sim y).
        const out = (mid[0] - cx) * n[0] + (mid[2] + cy) * n[2];
        expect(out).toBeGreaterThan(0);
      }
    }
  });

  it('frames ring edges with the outward normal on the right of counter-clockwise rings', () => {
    const sq: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
    ];
    expect(ringArea(sq)).toBeCloseTo(50);
    expect(ringArea([...sq].reverse())).toBeCloseTo(-50);
    const e = edgeOf(sq, 0);
    expect(e.nx).toBeCloseTo(0);
    expect(e.ny).toBeCloseTo(-1);
    const inner = insetRing(sq, 1)!;
    expect(ringArea(inner)).toBeCloseTo(8 * 3);
    for (const [x, y] of inner) expect(pointInRing(x, y, sq)).toBe(true);
  });

  it('builds beams and lathes with outward normals', () => {
    const w = new MeshWriter();
    beam(w, [0, 0, 0], [0, 0, 5], 0.5, 0.2, BC.gold);
    lathe(w, 20, 0, [
      [2, 0],
      [1.5, 3],
      [0, 5],
    ], 8, [BC.gold, BC.gold, BC.gold]);
    for (const { p, n } of triangles(w.pack())) {
      const mid = [(p[0][0] + p[1][0] + p[2][0]) / 3, (p[0][2] + p[1][2] + p[2][2]) / 3];
      const cx = mid[0] > 10 ? 20 : 0;
      const radial = (mid[0] - cx) * n[0] + mid[1] * n[2];
      if (Math.abs(n[1]) < 0.99) expect(radial).toBeGreaterThan(-1e-6);
    }
  });

  it('puts gable slopes facing up with the ridge on top', () => {
    const w = new MeshWriter();
    gable(w, basis(0, 0, 0), -5, 5, 4, 3, 6, 0.8, 0.5, BC.roofRed, BC.templeWhite);
    let maxH = -Infinity;
    for (const { p, n } of triangles(w.pack())) {
      for (const q of p) maxH = Math.max(maxH, q[1]);
      // Slopes face up; gable ends are vertical and face ±x.
      if (Math.abs(n[0]) > 0.99) continue;
      expect(n[1]).toBeGreaterThan(0.3);
    }
    expect(maxH).toBeCloseTo(6);
  });
});

describe('building footprints and plans', () => {
  const env = makeEnv(makeCtx(city));

  it('normalises baked rings: outer counter-clockwise, holes clockwise, same street front', () => {
    for (let i = 0; i < city.buildings.length; i += 3) {
      const b = city.buildings[i];
      const s = siteOf(city, i);
      expect(ringArea(s.ring)).toBeGreaterThan(0);
      for (const h of s.holes) expect(ringArea(h)).toBeLessThan(0);
      if (b.f === undefined) continue;
      // The front edge joins the same two points as the baked edge.
      const raw = ringOf(b.r);
      const a0 = raw[b.f];
      const a1 = raw[(b.f + 1) % raw.length];
      const e = s.ring[s.front];
      const f = s.ring[(s.front + 1) % s.ring.length];
      const same = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;
      expect((same(e, a0) && same(f, a1)) || (same(e, a1) && same(f, a0))).toBe(true);
    }
  });

  it('splits street fronts into 3.5–4.8 m bays', () => {
    for (let F = BAY_MIN; F <= 90; F += 0.05) {
      const { n, bw, start } = bayLayout(F);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(bw).toBeGreaterThanOrEqual(BAY_MIN - 1e-9);
      expect(bw).toBeLessThanOrEqual(BAY_MAX + 1e-9);
      expect(start).toBeGreaterThanOrEqual(-1e-9);
      expect(n * bw + 2 * start).toBeCloseTo(F, 6);
    }
  });

  it('classifies a sea of shophouses with real bays and respects the height caps', () => {
    const counts: Record<string, number> = {};
    let capped = 0;
    for (let i = 0; i < city.buildings.length; i++) {
      const b = city.buildings[i];
      if (b.t !== undefined) continue;
      const s = siteOf(city, i);
      const p = planBuilding(s, env);
      counts[p.cls] = (counts[p.cls] ?? 0) + 1;
      if (p.cls === 'shophouse') {
        const { bw } = bayLayout(s.frontLen);
        expect(bw).toBeGreaterThanOrEqual(BAY_MIN - 1e-9);
        expect(bw).toBeLessThanOrEqual(BAY_MAX + 1e-9);
      }
      if (b.ht) expect(p.wallTop + (p.roof === 'flat' ? p.parapet : p.rise)).toBeCloseTo(Math.max(p.base + 2.5 + (p.roof === 'flat' ? p.parapet : p.rise), b.ht / 10), 1);
      if (b.l) expect(p.levels).toBe(Math.round(b.l));
      if (p.tagged || ['chedi', 'church', 'mosque', 'hangar', 'skip'].includes(p.cls)) continue;
      if (s.zone === 'old_city' || s.zone === 'moat_ring') {
        expect(p.top).toBeLessThanOrEqual(OLD_CITY_CAP + 1e-6);
        capped++;
      }
      if (env.nearTemple(s.cx, s.cy)) expect(p.top).toBeLessThanOrEqual(TEMPLE_CAP + 1e-6);
      expect(p.wallTop).toBeGreaterThan(p.base);
    }
    expect(counts.shophouse).toBeGreaterThan(5000);
    expect(counts.house).toBeGreaterThan(3000);
    expect(counts.condo).toBeGreaterThan(100);
    expect(capped).toBeGreaterThan(3000);
  });

  it('draws every capped building under its cap (rooftop clutter aside)', () => {
    const ctx = makeCtx(city);
    let checked = 0;
    for (let i = 0; i < city.buildings.length; i++) {
      if (city.buildings[i].t !== undefined) continue;
      const s = siteOf(city, i);
      const p = planBuilding(s, env);
      if (!(p.cap < Infinity) || p.cls === 'skip') continue;
      ctx.w.buildings = new MeshWriter(256);
      ctx.w.windows = new MeshWriter(64);
      ctx.w.glow = new MeshWriter(16);
      drawBuilding(ctx, env, s, { ...p, lean: true });
      let maxH = 0;
      for (const m of [ctx.w.buildings.pack(), ctx.w.windows.pack(), ctx.w.glow.pack()]) for (let k = 1; k < m.position.length; k += 3) maxH = Math.max(maxH, m.position[k]);
      // Kalae boards and shrine ridge ornaments rise above the ridge.
      const ornament = p.roof === 'kalae' ? 1.7 : p.cls === 'shrine' ? 1.1 : 0.01;
      expect(maxH, `${s.b.id} ${p.cls}`).toBeLessThanOrEqual(p.cap + ornament);
      checked++;
    }
    expect(checked).toBeGreaterThan(4000);
  });

  it('turns every shophouse front towards its street', () => {
    const roads = new RoadIndex(city);
    let rows = 0;
    let facing = 0;
    for (let i = 0; i < city.buildings.length; i++) {
      if (city.buildings[i].t !== undefined) continue;
      const s = siteOf(city, i);
      if (s.front < 0 || planBuilding(s, env).cls !== 'shophouse') continue;
      const e = edgeOf(s.ring, s.front);
      const mx = e.ax + e.tx * e.len * 0.5;
      const my = e.ay + e.ty * e.len * 0.5;
      const hit = roads.nearest(mx, my, 20);
      if (!hit || hit.d < 0.5) continue;
      rows++;
      if ((hit.x - mx) * e.nx + (hit.y - my) * e.ny > 0) facing++;
    }
    expect(rows).toBeGreaterThan(5000);
    expect(facing / rows).toBeGreaterThan(0.97);
  });

  it('skips party walls hidden by an equally tall neighbour', () => {
    const c = synthCity([
      [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ],
      [
        [10, 0],
        [20, 0],
        [20, 8],
        [10, 8],
      ],
    ]);
    const plans = [0, 1].map((i) => {
      const s = siteOf(c, i);
      return { s, p: simplePlan(s, 'block', 3, 'flat', BC.concrete, BC.roofConcrete) };
    });
    markPartyWalls(plans);
    expect(plans[0].s.shared.size).toBe(1);
    expect(plans[1].s.shared.size).toBe(1);
    const [i0] = [...plans[0].s.shared.keys()];
    const e = edgeOf(plans[0].s.ring, i0);
    expect(e.ax).toBeCloseTo(10);
  });
});

describe('roofs sit on their walls', () => {
  it('an irregular canopy: every post stands inside the footprint its roof covers', () => {
    // A 12-corner staircase, far from its bounding box: the roof follows the ring.
    const stair: [number, number][] = [
      [0, 0],
      [50, 0],
      [50, 10],
      [40, 10],
      [40, 20],
      [30, 20],
      [30, 30],
      [20, 30],
      [20, 40],
      [10, 40],
      [10, 50],
      [0, 50],
    ];
    const c = synthCity([stair]);
    const ctx = makeCtx(c);
    const s = siteOf(c, 0);
    expect(s.ring.length).toBeGreaterThan(10);
    const p: Plan = { ...simplePlan(s, 'canopy', 1, 'gable', BC.zinc, BC.roofConcrete), lean: true };
    canopy(ctx, s, p, false);
    let posts = 0;
    for (const { p: tri, n } of triangles(ctx.w.buildings.pack())) {
      if (Math.abs(n[1]) > 0.05) continue;
      posts++;
      for (const q of tri) expect(pointInRing(q[0], -q[2], s.ring)).toBe(true);
    }
    expect(posts).toBeGreaterThan(0);
  });

  it('a hip-roofed house: eaves at the wall top minus the overhang drop, ridge at the planned rise', () => {
    const c = synthCity([
      [
        [0, 0],
        [12, 0],
        [12, 8],
        [0, 8],
      ],
    ]);
    const ctx = makeCtx(c);
    const s = siteOf(c, 0);
    const p: Plan = { ...simplePlan(s, 'house', 2, 'hip', BC.stucco, BC.tileTerracotta), lean: true };
    house(ctx, s, p);
    let wallTop = -Infinity;
    let roofMin = Infinity;
    let roofMax = -Infinity;
    for (const { p: tri, n } of triangles(ctx.w.buildings.pack())) {
      const vertical = Math.abs(n[1]) < 0.05;
      for (const q of tri) {
        if (vertical && Math.abs(q[0] - 6) > 6.5) continue;
        if (vertical) wallTop = Math.max(wallTop, q[1]);
        else {
          roofMin = Math.min(roofMin, q[1]);
          roofMax = Math.max(roofMax, q[1]);
          // Roof stays within the footprint plus its overhang.
          expect(q[0]).toBeGreaterThan(-1.5);
          expect(q[0]).toBeLessThan(13.5);
        }
      }
    }
    expect(wallTop).toBeCloseTo(p.wallTop, 5);
    expect(roofMax).toBeCloseTo(p.wallTop + p.rise, 5);
    expect(roofMin).toBeLessThan(p.wallTop);
    expect(roofMin).toBeGreaterThan(p.wallTop - 1.5);
  });

  it('a Lanna hall steps its roof down towards the front with finials above the ridge', () => {
    const w = new MeshWriter();
    const ctx = makeCtx(city);
    ctx.w.buildings = w;
    const top = lannaHall(ctx, { b: basis(0, 0, 0), L: 32, W: 14, bi: null, style: 'white' }, 7);
    const tris = [...triangles(w.pack())];
    let overall = -Infinity;
    for (const { p } of tris) for (const q of p) overall = Math.max(overall, q[1]);
    const mid = roofHeightAt(tris, 0, 0.3);
    const front = roofHeightAt(tris, 14.5, 0.3);
    const rear = roofHeightAt(tris, -15, 0.3);
    expect(mid).toBeCloseTo(top, 0);
    expect(front).toBeLessThan(mid - 1);
    expect(rear).toBeLessThan(mid - 0.5);
    // The roof covers the side walls (top 4.2 m for a 14 m hall) along the whole length.
    for (let q = -15.5; q <= 15.5; q += 0.5) {
      for (const v of [-6.7, 6.7]) expect(roofHeightAt(tris, q, v), `q ${q}`).toBeGreaterThan(4.25);
    }
    // No white wall or tympanum vertex pokes out above the roof over it, short hall or long.
    for (const L of [32, 64]) {
      const hw = new MeshWriter();
      ctx.w.buildings = hw;
      lannaHall(ctx, { b: basis(0, 0, 0), L, W: 14, bi: null, style: 'white' }, 7);
      const m = hw.pack();
      const ht = [...triangles(m)];
      const white = BC.templeWhite;
      for (let i = 0; i < m.position.length / 3; i++) {
        if (m.color[i * 3] !== white[0] || m.color[i * 3 + 1] !== white[1] || m.color[i * 3 + 2] !== white[2]) continue;
        const [x, h, z] = [m.position[i * 3], m.position[i * 3 + 1], m.position[i * 3 + 2]];
        const roof = roofHeightAt(ht, Math.max(-L / 2 + 0.1, Math.min(L / 2 - 0.1, x)), Math.max(-6.9, Math.min(6.9, z)));
        expect(h, `L ${L}: wall vertex at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBeLessThanOrEqual(roof + 0.05);
      }
    }
    // Chofa rise above the ridge line; ridge about 0.8–1.1 × the width.
    expect(overall).toBeGreaterThan(top + 1);
    expect(top).toBeGreaterThan(14 * 0.75);
    expect(top).toBeLessThan(14 * 1.2);
  });

  it('chedis reach their specified height (ruins stop short)', () => {
    for (const type of ['bell', 'redented', 'octagonal'] as const) {
      const w = new MeshWriter();
      const spec: ChediSpec = { x: 0, y: 0, side: 10, height: 24, ang: 0.3, type, finish: 'white', corners: true };
      chedi(w, spec, 1);
      let maxH = 0;
      const m = w.pack();
      for (let i = 1; i < m.position.length; i += 3) maxH = Math.max(maxH, m.position[i]);
      expect(maxH).toBeCloseTo(24, 1);
      const r = new MeshWriter();
      chedi(r, { ...spec, finish: 'brick', ruined: true }, 1);
      let rMax = 0;
      const rm = r.pack();
      for (let i = 1; i < rm.position.length; i += 3) rMax = Math.max(rMax, rm.position[i]);
      expect(rMax).toBeLessThan(24 * 0.8);
    }
  });
});

describe('temples and landmarks in the real city', () => {
  const ctx = makeCtx(city);
  buildGround(ctx);
  buildRoads(ctx);
  const built = buildBuildings(ctx);
  const env = makeEnv(makeCtx(city));
  const groups = templeGroups(env.grounds).filter((g) => g[0].buddhist);

  it('gives every Buddhist temple ground a viharn and a chedi inside it', () => {
    expect(built).toBeGreaterThan(18_000);
    expect(groups.length).toBeGreaterThanOrEqual(80);
    const temples = ctx.temples ?? [];
    expect(temples.length).toBe(groups.length);
    for (const g of groups) {
      const t = temples.find((x) => x.ti === g[0].ti);
      expect(t, g[0].name).toBeDefined();
      const inside = (x: number, y: number) => g.some((gg) => pointInRing(x, y, gg.ring));
      expect(inside(t!.viharn.x, t!.viharn.y), `${g[0].name} viharn`).toBe(true);
      expect(inside(t!.chedi.x, t!.chedi.y), `${g[0].name} chedi`).toBe(true);
      expect(t!.viharn.L).toBeGreaterThan(t!.viharn.W - 1e-6);
      expect(t!.chedi.height).toBeGreaterThan(t!.chedi.side * 0.9);
    }
    // Most grounds have room for a gate and a bodhi tree.
    expect(temples.filter((t) => t.gate).length).toBeGreaterThan(groups.length * 0.9);
    expect((ctx.props.bodhi_spot ?? []).length / 4).toBeGreaterThan(groups.length * 0.8);
  });

  it('faces hero viharns their documented way and builds the 55 m Wat Chedi Luang', () => {
    const temples = ctx.temples ?? [];
    const dirs: Record<string, [number, number]> = { east: [1, 0], west: [-1, 0], north: [0, 1], south: [0, -1] };
    for (const h of TEMPLE_HEROES) {
      const g = groups.find((gg) => gg.some((x) => x.id === h.ground));
      expect(g, h.id).toBeDefined();
      const t = temples.find((x) => x.ti === g![0].ti)!;
      if (h.viharn) expect(t.viharn.mapped).toBe(true);
      if (h.front) {
        const [dx, dy] = dirs[h.front];
        expect(Math.cos(t.viharn.ang) * dx + Math.sin(t.viharn.ang) * dy, h.id).toBeGreaterThan(0.7);
      }
      if (h.chediHeight) expect(t.chedi.height).toBe(h.chediHeight);
    }
    const luang = temples.find((t) => /Chedi Luang/.test(t.name))!;
    expect(luang.chedi.height).toBe(55);
    expect(luang.chedi.side).toBeGreaterThan(50);
  });

  it('places every hero landmark at its anchor', () => {
    const placed = new Map((ctx.landmarks ?? []).map((l) => [l.id, l]));
    const o = city.origin;
    const mPerLon = 111_320 * Math.cos((o.lat * Math.PI) / 180);
    for (const h of HEROES) {
      const l = placed.get(h.id);
      expect(l, h.id).toBeDefined();
      if (h.at) {
        const x = (h.at[1] - o.lon) * mPerLon;
        const y = (h.at[0] - o.lat) * 110_574;
        expect(Math.hypot(l!.x - x, l!.y - y), h.id).toBeLessThan(h.nearest ?? 35);
      }
    }
  });

  it('lights windows and signs for the night', () => {
    expect(ctx.w.windows.triangleCount).toBeGreaterThan(100_000);
    expect(ctx.w.glow.triangleCount).toBeGreaterThan(5_000);
  });
});

describe('whole-city build', () => {
  // CPU time rather than wall time: the suite runs files in parallel, often on a busy machine. The budget holds the
  // faster of two builds, since the first also pays for compiling the builder.
  const cpuMs = (since: NodeJS.CpuUsage) => {
    const cpu = process.cpuUsage(since);
    return (cpu.user + cpu.system) / 1000;
  };
  const cpuA = process.cpuUsage();
  const a = buildCity(city);
  const msA = cpuMs(cpuA);
  const cpuB = process.cpuUsage();
  const b = buildCity(city);
  const ms = Math.min(msA, cpuMs(cpuB));

  it('stays inside the building triangle budget and time', () => {
    const t = a.stats.triangles;
    const mine = t.buildings + t.windows + t.glow;
    console.log(`buildings ${t.buildings}, windows ${t.windows}, glow ${t.glow}, structures ${t.structures}, total ${mine}, build ${ms.toFixed(0)} ms CPU`);
    expect(mine).toBeLessThan(1_600_000);
    // Structures also hold the moat parapets, bridges, platforms and the power-line cables.
    expect(t.structures).toBeLessThan(400_000);
    expect(ms).toBeLessThan(4000);
  });

  it('keeps every building vertex finite and above the ground', () => {
    for (const id of ['buildings', 'windows', 'glow', 'structures'] as const) {
      const m = a.layers[id];
      let minY = Infinity;
      let maxY = -Infinity;
      let nonFinite = 0;
      let badNormals = 0;
      for (let i = 0; i < m.position.length; i++) if (!Number.isFinite(m.position[i])) nonFinite++;
      for (let i = 1; i < m.position.length; i += 3) {
        minY = Math.min(minY, m.position[i]);
        maxY = Math.max(maxY, m.position[i]);
      }
      for (let i = 0; i < m.normal.length; i += 3) if (Math.abs(Math.hypot(m.normal[i], m.normal[i + 1], m.normal[i + 2]) - 1) > 1e-3) badNormals++;
      expect(nonFinite, id).toBe(0);
      expect(badNormals, id).toBe(0);
      // Structures include moat and river bank walls and bridge piers, which go down to the water.
      expect(minY, id).toBeGreaterThan(id === 'structures' ? -5 : -0.05);
      expect(maxY, id).toBeLessThan(160);
    }
  });

  it('is deterministic', () => {
    for (const id of ['buildings', 'windows', 'glow', 'structures'] as const) {
      const x = a.layers[id];
      const y = b.layers[id];
      expect(y.position.length).toBe(x.position.length);
      let h1 = 0;
      let h2 = 0;
      for (let i = 0; i < x.position.length; i += 7) {
        h1 = (h1 * 31 + Math.round(x.position[i] * 100)) | 0;
        h2 = (h2 * 31 + Math.round(y.position[i] * 100)) | 0;
      }
      expect(h2).toBe(h1);
    }
  });
});
