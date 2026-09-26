import { readFileSync } from 'node:fs';
import earcut from 'earcut';
import { describe, expect, it } from 'vitest';
import landmarks from '../src/content/landmarks.json';
import { ROAD_FLAG, type CityData } from '../src/world3d/city';
import type { BuildContext, LayerId } from '../src/world3d/build/context';
import { buildGround } from '../src/world3d/build/ground';
import { G } from '../src/world3d/build/groundPalette';
import { buildRoadNet } from '../src/world3d/build/junctions';
import { MeshWriter, type PackedMesh, type RGB } from '../src/world3d/build/mesh';
import { Occupancy } from '../src/world3d/build/occupancy';
import { P } from '../src/world3d/build/palette';
import { band, beam, ccwRing, paintText, PAINT_Y, ringArea2, segDist, wallBand } from '../src/world3d/build/paths';
import { buildRoads } from '../src/world3d/build/roads';
import { pointInRing, type Ring } from '../src/world3d/build/shapes';
import { buildWater, planWater, WATER_LEVEL } from '../src/world3d/build/water';
import { buildCity } from '../src/world3d/build/world';

const city = JSON.parse(readFileSync(new URL('../public/data/city3d.json', import.meta.url), 'utf8')) as CityData;

type V3 = [number, number, number];

/** Triangles of a packed mesh: world-space corners and the stored normal of the first corner. */
function* triangles(m: PackedMesh): Generator<{ p: V3[]; n: V3; c: RGB }> {
  for (let t = 0; t < m.index.length; t += 3) {
    const ids = [m.index[t], m.index[t + 1], m.index[t + 2]];
    const p = ids.map((i) => [m.position[3 * i], m.position[3 * i + 1], m.position[3 * i + 2]] as V3);
    const i0 = ids[0];
    yield { p, n: [m.normal[3 * i0], m.normal[3 * i0 + 1], m.normal[3 * i0 + 2]], c: [m.color[3 * i0], m.color[3 * i0 + 1], m.color[3 * i0 + 2]] };
  }
}

/** Geometric normal (world space, unnormalised) from the winding. */
function windingNormal(p: V3[]): V3 {
  const a = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
  const b = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

const same = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Sim-space (x, y) of every vertex with the given colour. */
function verticesOf(m: PackedMesh, c: RGB): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < m.color.length / 3; i++) {
    if (m.color[3 * i] === c[0] && m.color[3 * i + 1] === c[1] && m.color[3 * i + 2] === c[2]) out.push([m.position[3 * i], -m.position[3 * i + 2]]);
  }
  return out;
}

function contextFor(data: CityData): BuildContext {
  const keep = data.keep.map((v) => v / 10) as [number, number, number, number];
  const w = {} as Record<LayerId, MeshWriter>;
  for (const id of ['backdrop', 'ground', 'water', 'roads', 'structures', 'buildings', 'windows', 'glow'] as LayerId[]) w[id] = new MeshWriter();
  return {
    city: data,
    w,
    occ: new Occupancy(...keep),
    keep,
    str: (i) => (i ? data.strings[i] : ''),
    parkAreas: [],
    moatRings: [],
    roadPts: [],
    trees: [],
    props: {},
  };
}

interface SynthWay {
  cls: number;
  flags?: number;
  width: number;
  lanes?: number;
  surface?: number;
  pts: [number, number][];
}

/** A small city with only the given roads (sim metres) and optional props. */
function synthCity(ways: SynthWay[], props: [string, number, number][] = []): CityData {
  const nodes: number[] = [];
  const nodeIdx = new Map<string, number>();
  const ref = ([x, y]: [number, number]) => {
    const k = `${Math.round(x * 10)},${Math.round(y * 10)}`;
    let n = nodeIdx.get(k);
    if (n === undefined) {
      n = nodes.length / 2;
      nodeIdx.set(k, n);
      nodes.push(Math.round(x * 10), Math.round(y * 10));
    }
    return n;
  };
  const propKinds: string[] = [];
  const propArr: number[] = [];
  for (const [k, x, y] of props) {
    if (!propKinds.includes(k)) propKinds.push(k);
    propArr.push(propKinds.indexOf(k), Math.round(x * 10), Math.round(y * 10));
  }
  return {
    ...city,
    keep: [-20_000, -20_000, 20_000, 20_000],
    play: [-10_000, -10_000, 10_000, 10_000],
    roads: {
      nodes,
      ways: ways.map((w) => [w.cls, w.flags ?? 0, Math.round(w.width * 10), w.lanes ?? 0, 0, w.surface ?? 0, 0, ...w.pts.map(ref)]),
      classes: city.roads.classes,
      surfaces: city.roads.surfaces,
    },
    areas: [],
    lines: [],
    buildings: [],
    trees: [],
    props: propArr,
    propKinds,
    shops: [],
  };
}

describe('paint and structure primitives', () => {
  it('bands face up and span their offsets, even round a hairpin', () => {
    const w = new MeshWriter();
    band(w, [[0, 0], [10, 0], [10.5, 0.3], [0, 1]], 0.5, 1.5, PAINT_Y, [255, 255, 255]);
    band(w, [[0, 10], [20, 10]], -1, 2, PAINT_Y, [255, 255, 255]);
    const m = w.pack();
    for (const t of triangles(m)) {
      expect(windingNormal(t.p)[1]).toBeGreaterThanOrEqual(0);
      expect(t.n).toEqual([0, 1, 0]);
    }
    const ys = verticesOf(m, [255, 255, 255]).filter(([, y]) => y > 5).map(([, y]) => y);
    expect(Math.min(...ys)).toBeCloseTo(9);
    expect(Math.max(...ys)).toBeCloseTo(12);
  });

  it('wall bands show their side faces away from the strip', () => {
    const w = new MeshWriter();
    wallBand(w, [[0, 0], [10, 0]], 1, 1.5, 0, 1, [200, 0, 0], [0, 200, 0]);
    let sides = 0;
    for (const t of triangles(w.pack())) {
      const n = windingNormal(t.p);
      const l = Math.hypot(...n);
      if (Math.abs(n[1] / l) > 0.5) {
        expect(n[1]).toBeGreaterThan(0);
        continue;
      }
      sides++;
      // A point just outside the face along its normal lies outside the strip (1–1.5 m left of the line).
      const cx = (t.p[0][0] + t.p[1][0] + t.p[2][0]) / 3 + (n[0] / l) * 0.05;
      const cy = -((t.p[0][2] + t.p[1][2] + t.p[2][2]) / 3 + (n[2] / l) * 0.05);
      expect(cx >= 0 && cx <= 10 && cy >= 1 && cy <= 1.5).toBe(false);
      expect(n[0] * t.n[0] + n[2] * t.n[2]).toBeGreaterThan(0);
    }
    expect(sides).toBe(8);
  });

  it('beams face outwards from their axis', () => {
    const w = new MeshWriter();
    beam(w, [0, 0, 0], [5, 2, 3], 0.4, [80, 80, 80]);
    for (const t of triangles(w.pack())) {
      const n = windingNormal(t.p);
      // Axis point nearest the face centroid (sim x, y, height → world x, height, −y).
      const c = [0, 1, 2].map((k) => (t.p[0][k] + t.p[1][k] + t.p[2][k]) / 3);
      const d = [5, 3, -2];
      const s = (c[0] * d[0] + c[1] * d[1] + c[2] * d[2]) / (d[0] ** 2 + d[1] ** 2 + d[2] ** 2);
      const out = [c[0] - d[0] * s, c[1] - d[1] * s, c[2] - d[2] * s];
      expect(out[0] * n[0] + out[1] * n[1] + out[2] * n[2]).toBeGreaterThan(0);
    }
  });

  it('paints upright lettering that faces up', () => {
    const w = new MeshWriter();
    const width = paintText(w, 'TUK-TUK', 0, 0, 1, 0, 1.5, 0.16, PAINT_Y, [240, 195, 48]);
    expect(width).toBeCloseTo(7 * 0.9 + 6 * 0.375, 5);
    const m = w.pack();
    expect(m.index.length).toBeGreaterThan(0);
    for (const t of triangles(m)) expect(windingNormal(t.p)[1]).toBeGreaterThanOrEqual(0);
    // Letters rise to the left of the reading direction (north for text reading east).
    const ys = verticesOf(m, [240, 195, 48]).map(([, y]) => y);
    expect(Math.max(...ys)).toBeGreaterThan(1.4);
    expect(Math.min(...ys)).toBeGreaterThan(-0.2);
  });
});

describe('junctions on the real map', () => {
  const net = buildRoadNet(city);

  it('builds valid, simple junction polygons for at least 99% of junctions', () => {
    expect(net.junctions.length).toBeGreaterThan(5000);
    const simple = net.junctions.filter((j) => j.simple).length;
    expect(simple / net.junctions.length).toBeGreaterThanOrEqual(0.99);
    let outside = 0;
    let broken = 0;
    for (const j of net.junctions) {
      const ok =
        j.arms.length >= 3 &&
        ringArea2(j.ring) > 0 &&
        j.ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && Math.hypot(x - j.x, y - j.y) < 80);
      if (!ok) broken++;
      if (!pointInRing(j.x, j.y, j.ring)) outside++;
    }
    expect(broken).toBe(0);
    expect(outside / net.junctions.length).toBeLessThan(0.01);
  });

  it('keeps lane lines out of the junction boxes', () => {
    let overlaps = 0;
    for (const way of net.ways) {
      for (const st of way.stops) {
        const c = way.path.cum[st.vi];
        for (const [a, b] of way.clear) if (!(b <= c - st.back + 1e-6 || a >= c + st.fwd - 1e-6)) overlaps++;
      }
    }
    expect(overlaps).toBe(0);
    let badSetback = 0;
    for (const j of net.junctions) for (const arm of j.arms) if (!(arm.setback >= 0 && arm.setback <= arm.len * 0.45 + 1e-9)) badSetback++;
    expect(badSetback).toBe(0);
  });

  it('flags the OSM traffic signals', () => {
    expect(net.junctions.filter((j) => j.signals).length).toBeGreaterThan(80);
  });
});

describe('road paint rules', () => {
  // Five straight roads, 100 m apart, far from the Tha Phae Gate rank.
  const ways: SynthWay[] = [
    { cls: 1, width: 10.6, lanes: 2, pts: [[-5000, 0], [-4800, 0]] },
    { cls: 5, width: 5.5, pts: [[-5000, 100], [-4800, 100]] },
    { cls: 2, flags: ROAD_FLAG.ONEWAY, width: 9.6, lanes: 3, pts: [[-5000, 200], [-4800, 200]] },
    { cls: 7, width: 4, pts: [[-5000, 300], [-4800, 300]] },
    { cls: 3, width: 8, lanes: 2, surface: 3, pts: [[-5000, 400], [-4800, 400]] },
  ];
  const ctx = contextFor(synthCity(ways));
  buildRoads(ctx);
  const paint = ctx.w.roads.pack();
  const near = (pts: [number, number][], y: number) => pts.filter(([, py]) => Math.abs(py - y) < 20);
  const yellow = verticesOf(paint, G.lineYellow);
  const white = verticesOf(paint, G.lineWhite);

  it('paints the double yellow centre line only on the two-way primary road', () => {
    expect(near(yellow, 0).length).toBeGreaterThan(0);
    expect(yellow.length).toBe(near(yellow, 0).length);
    for (const [, y] of yellow) expect(Math.abs(y)).toBeLessThan(0.25);
    // Its white paint is the edge lines, nothing at the centre.
    for (const [, y] of near(white, 0)) expect(Math.abs(y)).toBeGreaterThan(4);
  });

  it('leaves narrow sois, service roads and dirt roads unmarked', () => {
    expect(near(white, 100)).toEqual([]);
    expect(near(white, 300)).toEqual([]);
    expect(near(white, 400)).toEqual([]);
  });

  it('paints lane lines and an arrow per lane on one-way roads, pointing the way traffic flows', () => {
    // Arrow heads: white triangles whose corners sit at lane offset o and o ± 0.6 m.
    const heads = new Map<number, number>();
    for (const t of triangles(paint)) {
      if (!same(t.c, G.lineWhite)) continue;
      const pts = t.p.map((p) => [p[0], -p[2] - 200] as [number, number]).sort((a, b) => a[1] - b[1]);
      const mid = pts[1][1];
      if (Math.abs(pts[0][1] - (mid - 0.6)) > 0.01 || Math.abs(pts[2][1] - (mid + 0.6)) > 0.01) continue;
      // The tip (middle offset) lies ahead, east, of both base corners.
      expect(pts[1][0]).toBeGreaterThan(pts[0][0] + 1);
      expect(pts[1][0]).toBeGreaterThan(pts[2][0] + 1);
      const lane = Math.round(mid * 10) / 10;
      heads.set(lane, (heads.get(lane) ?? 0) + 1);
    }
    expect([...heads.keys()].sort((a, b) => a - b)).toEqual([-3.2, 0, 3.2]);
    // Dashed lines between the lanes.
    const dividers = near(white, 200).filter(([, y]) => Math.abs(Math.abs(y - 200) - 1.6) < 0.08);
    expect(dividers.length).toBeGreaterThan(20);
  });

  it('grasses the island of a roundabout drawn as two ways', () => {
    const circle = (a0: number, a1: number): [number, number][] => {
      const pts: [number, number][] = [];
      // Clockwise, as traffic runs round Thai roundabouts.
      for (let k = 0; k <= 8; k++) {
        const a = a0 - ((a1 - a0) * k) / 8;
        pts.push([3000 + Math.cos(a) * 18, Math.sin(a) * 18]);
      }
      return pts;
    };
    const flags = ROAD_FLAG.ONEWAY | ROAD_FLAG.ROUNDABOUT;
    const c = contextFor(synthCity([
      { cls: 3, flags, width: 7, lanes: 1, pts: circle(0, Math.PI) },
      { cls: 3, flags, width: 7, lanes: 1, pts: circle(-Math.PI, 0) },
    ]));
    buildRoads(c);
    const grass = verticesOf(c.w.roads.pack(), P.grass);
    expect(grass.length).toBeGreaterThan(8);
    for (const [x, y] of grass) expect(Math.hypot(x - 3000, y)).toBeLessThan(18 - 3.5 + 0.01);
    // A single-lane ring gets no one-way arrows.
    expect(verticesOf(c.w.roads.pack(), G.lineWhite)).toEqual([]);
  });

  it('puts crossings and stop lines on every arm of a signalised junction, stop lines on the inbound left half', () => {
    const cross: SynthWay[] = [
      { cls: 1, width: 10.6, lanes: 2, pts: [[-100, 0], [0, 0], [100, 0]] },
      { cls: 2, width: 8, lanes: 2, pts: [[0, -100], [0, 0], [0, 100]] },
    ];
    const data = synthCity(cross, [['traffic_signals', 0, 0]]);
    const net = buildRoadNet(data);
    expect(net.junctions.length).toBe(1);
    const j = net.junctions[0];
    expect(j.signals).toBe(true);
    expect(j.simple).toBe(true);
    const c = contextFor(data);
    buildRoads(c);
    const wv = verticesOf(c.w.roads.pack(), G.lineWhite);
    const east = j.arms.find((a) => a.ux > 0.9)!;
    // Zebra stripes between setback+0.4 and setback+3.6 on the east arm.
    const zebra = wv.filter(([x, y]) => x > east.setback + 0.3 && x < east.setback + 3.7 && Math.abs(y) < 5);
    expect(zebra.length).toBeGreaterThan(20);
    // Stop line 4.2–4.65 m past the setback, only where westbound traffic drives: the south half.
    const stop = wv.filter(([x]) => x > east.setback + 4.1 && x < east.setback + 4.7);
    expect(stop.length).toBeGreaterThan(0);
    for (const [, y] of stop) expect(y).toBeLessThanOrEqual(0.01);
  });
});

describe('sunken water', () => {
  const plan = planWater(city, city.keep.map((v) => v / 10) as [number, number, number, number]);
  const moats = plan.bodies.filter((b) => b.kind === 'moat');

  it('sinks all 19 moat pieces 1.6 m and the Ping 3.5 m below the street', () => {
    expect(moats.length).toBe(19);
    for (const b of moats) expect(b.level).toBe(WATER_LEVEL.moat);
    expect(WATER_LEVEL.moat).toBeCloseTo(-1.6);
    const river = plan.bodies.filter((b) => b.kind === 'river');
    expect(river.length).toBeGreaterThan(0);
    for (const b of river) expect(b.level).toBeLessThanOrEqual(-3);
    for (const b of plan.bodies) expect(ringArea2(b.ring)).toBeGreaterThan(0);
  });

  it('lines the moat with brick walls that face the water', () => {
    const ctx = contextFor(city);
    buildWater(ctx, { ...plan, bodies: moats, flat: [] });
    let walls = 0;
    for (const t of triangles(ctx.w.water.pack())) {
      const n = windingNormal(t.p);
      const l = Math.hypot(...n);
      const cx = (t.p[0][0] + t.p[1][0] + t.p[2][0]) / 3;
      const cy = -(t.p[0][2] + t.p[1][2] + t.p[2][2]) / 3;
      if (Math.abs(n[1] / l) > 0.1) {
        // Water surface.
        expect(t.p.every((p) => Math.abs(p[1] - WATER_LEVEL.moat) < 1e-4)).toBe(true);
        continue;
      }
      walls++;
      // From the street down past the waterline.
      expect(Math.max(...t.p.map((p) => p[1]))).toBeLessThanOrEqual(0);
      expect(Math.min(...t.p.map((p) => p[1]))).toBeLessThan(WATER_LEVEL.moat);
      const px = cx + (n[0] / l) * 0.3;
      const py = cy - (n[2] / l) * 0.3;
      expect(moats.some((b) => pointInRing(px, py, b.ring))).toBe(true);
    }
    expect(walls).toBeGreaterThan(19 * 8);
    // A parapet stands on every bank.
    expect(ctx.w.structures.triangleCount).toBeGreaterThan(moats.length * 20);
  });

  it('covers exactly the kept area, less the sunken water, with the street-level ground', () => {
    const ctx = contextFor(city);
    buildGround(ctx);
    let area = 0;
    for (const t of triangles(ctx.w.ground.pack())) {
      if (!same(t.c, P.groundUrban) || !t.p.every((p) => p[1] === 0)) continue;
      area += Math.abs(windingNormal(t.p)[1]) / 2;
    }
    const [x0, y0, x1, y1] = ctx.keep;
    const water = (ctx.waterBodies ?? []).reduce((s, b) => s + ringArea2(b.ring) / 2, 0);
    expect(Math.abs(area - ((x1 - x0) * (y1 - y0) - water)) / area).toBeLessThan(1e-4);
  });

  it('leaves the ground open over the moat', () => {
    const ctx = contextFor(city);
    buildGround(ctx);
    // Street-level ground only (bridge decks sit a hair above it).
    const ground = [...triangles(ctx.w.ground.pack())].filter((t) => t.p.every((p) => Math.abs(p[1]) < 0.005));
    for (const b of moats) {
      const flat = b.ring.flat();
      const tri = earcut(flat);
      // Centroids of the water's triangles that lie at least 3 m inside the banks.
      const inner: [number, number][] = [];
      for (let i = 0; i < tri.length; i += 3) {
        const [x, y] = [0, 1].map((k) => (flat[2 * tri[i] + k] + flat[2 * tri[i + 1] + k] + flat[2 * tri[i + 2] + k]) / 3);
        const edge = Math.min(...b.ring.map((p, j) => segDist(x, y, p[0], p[1], b.ring[(j + 1) % b.ring.length][0], b.ring[(j + 1) % b.ring.length][1]).d));
        if (edge > 3) inner.push([x, y]);
      }
      expect(inner.length).toBeGreaterThan(0);
      for (const [x, y] of inner) {
        expect(ground.some((t) => pointInRing(x, y, t.p.map((p) => [p[0], -p[2]]) as Ring))).toBe(false);
        // Nothing gets scattered into the water either.
        expect(ctx.occ.free(x, y)).toBe(false);
      }
    }
  });
});

describe('ground layers of the whole city', () => {
  const built = buildCity(city);
  const again = buildCity(city);
  const o = city.origin;
  const at = (id: string): [number, number] => {
    const l = (landmarks as { id: string; lat: number; lon: number }[]).find((m) => m.id === id)!;
    return [(l.lon - o.lon) * 111_320 * Math.cos((o.lat * Math.PI) / 180), (l.lat - o.lat) * 110_574];
  };

  it('stays inside the triangle budget', () => {
    const t = built.stats.triangles;
    console.log(`ground ${t.ground}, water ${t.water}, roads ${t.roads}, structures ${t.structures} triangles; build ${built.stats.ms.toFixed(0)} ms`);
    expect(t.roads).toBeLessThan(600_000);
    expect(t.water).toBeLessThan(40_000);
    expect(t.ground).toBeLessThan(20_000);
  });

  it('is deterministic', () => {
    const hash = (a: Float32Array | Uint8Array | Uint32Array) => {
      const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      let h = 2166136261;
      for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619) >>> 0;
      return h;
    };
    for (const id of ['ground', 'water', 'roads', 'structures'] as const) {
      expect(hash(again.layers[id].position)).toBe(hash(built.layers[id].position));
      expect(hash(again.layers[id].color)).toBe(hash(built.layers[id].color));
      expect(hash(again.layers[id].index)).toBe(hash(built.layers[id].index));
    }
  });

  it('winds all ground paint to face up', () => {
    let down = 0;
    let total = 0;
    for (const t of triangles(built.layers.roads)) {
      const n = windingNormal(t.p);
      // Slivers under 50 cm² can flip sign when stored as 32-bit floats.
      if (Math.hypot(...n) < 0.01) continue;
      total++;
      if (n[1] < 0) down++;
    }
    expect(down).toBe(0);
    expect(total).toBeGreaterThan(100_000);
  });

  it('paints the tuk-tuk rank by Tha Phae Gate', () => {
    const [gx, gy] = at('tha_phae_gate');
    const rank = verticesOf(built.layers.roads, G.rankYellow);
    expect(rank.length).toBeGreaterThan(50);
    for (const [x, y] of rank) expect(Math.hypot(x - gx, y - gy)).toBeLessThan(120);
  });

  it('puts the Nawarat Bridge on piers and the Iron Bridge in a truss', () => {
    const [nx, ny] = at('nawarat_bridge');
    const [ix, iy] = at('iron_bridge');
    const s = built.layers.structures;
    let piers = 0;
    let truss = 0;
    for (let i = 0; i < s.position.length / 3; i++) {
      const x = s.position[3 * i];
      const h = s.position[3 * i + 1];
      const y = -s.position[3 * i + 2];
      if (h < -2 && Math.hypot(x - nx, y - ny) < 120) piers++;
      if (h > 5 && Math.hypot(x - ix, y - iy) < 80) truss++;
    }
    expect(piers).toBeGreaterThan(0);
    expect(truss).toBeGreaterThan(0);
  });

  it('hands the green areas, moat rings and water levels on to the later builders', () => {
    const ctx = contextFor(city);
    buildGround(ctx);
    expect(ctx.moatRings.length).toBe(19);
    for (const r of ctx.moatRings) expect(ccwRing(r)).toBe(r);
    expect(ctx.parkAreas.length).toBeGreaterThan(300);
    expect(ctx.parkAreas.some((a) => a.kind === 'temple')).toBe(true);
    expect(ctx.waterBodies?.every((b) => b.level < 0)).toBe(true);
  });
});
