import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ringOf, type CityData } from '../src/world3d/city';
import { buildBuildings } from '../src/world3d/build/buildings';
import { mountains } from '../src/world3d/build/backdrop';
import { LAYERS, TREE_KINDS, type BuildContext, type LayerId } from '../src/world3d/build/context';
import { buildGround } from '../src/world3d/build/ground';
import { MeshWriter } from '../src/world3d/build/mesh';
import { Occupancy } from '../src/world3d/build/occupancy';
import { buildProps } from '../src/world3d/build/props';
import { buildRoads } from '../src/world3d/build/roads';
import { scatterTrees } from '../src/world3d/build/scatter';
import { pointInRing, type Ring } from '../src/world3d/build/shapes';
import { placeEnv, streetRules } from '../src/world3d/build/streets';
import { buildCity } from '../src/world3d/build/world';
import { PROP_MODELS, isMarkerKind } from '../src/world3d/propModels';
import { treeGeometry } from '../src/world3d/treeModels';

const city = JSON.parse(readFileSync(new URL('../public/data/city3d.json', import.meta.url), 'utf8')) as CityData;

/** The builders in buildCity's order, keeping the context so the prop pass can be measured on its own. */
function stagedBuild() {
  const keep = city.keep.map((v) => v / 10) as [number, number, number, number];
  const w = {} as Record<LayerId, MeshWriter>;
  for (const id of LAYERS) w[id] = new MeshWriter();
  const ctx: BuildContext = {
    city,
    w,
    occ: new Occupancy(...keep),
    keep,
    str: (i) => (i ? city.strings[i] : ''),
    parkAreas: [],
    moatRings: [],
    roadPts: [],
    trees: [],
    props: {},
  };
  buildGround(ctx);
  buildRoads(ctx);
  buildBuildings(ctx);
  mountains(ctx.w.backdrop, city);
  const t0 = performance.now();
  scatterTrees(ctx);
  const t1 = performance.now();
  const structuresBefore = ctx.w.structures.triangleCount;
  buildProps(ctx);
  const t2 = performance.now();
  return { ctx, cableTriangles: ctx.w.structures.triangleCount - structuresBefore, treeMs: t1 - t0, propMs: t2 - t1 };
}

/** Grid of flat items for "anything near (x, y)" queries in the tests. */
class Grid<T> {
  private readonly map = new Map<string, T[]>();
  constructor(private readonly cell: number) {}
  add(x0: number, y0: number, x1: number, y1: number, v: T): void {
    for (let i = Math.floor(x0 / this.cell); i <= Math.floor(x1 / this.cell); i++) {
      for (let j = Math.floor(y0 / this.cell); j <= Math.floor(y1 / this.cell); j++) {
        const k = `${i},${j}`;
        if (!this.map.has(k)) this.map.set(k, []);
        this.map.get(k)!.push(v);
      }
    }
  }
  at(x: number, y: number): T[] {
    return this.map.get(`${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`) ?? [];
  }
}

// Independent references: building footprints and carriageway rectangles (segment by segment,
// the ends pushed out by the cap roads.ts draws).
const footprints = new Grid<Ring>(30);
for (const b of city.buildings) {
  const r = ringOf(b.r);
  const xs = r.map((p) => p[0]);
  const ys = r.map((p) => p[1]);
  footprints.add(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), r);
}
interface Seg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  half: number;
  way: number;
}
const carriageways = new Grid<Seg>(30);
const rn = city.roads.nodes;
city.roads.ways.forEach((way, wi) => {
  const pts = way.slice(7).map((n) => [rn[2 * n] / 10, rn[2 * n + 1] / 10]);
  const half = way[2] / 20;
  for (let i = 1; i < pts.length; i++) {
    let [ax, ay] = pts[i - 1];
    let [bx, by] = pts[i];
    const l = Math.hypot(bx - ax, by - ay);
    if (l < 1e-6) continue;
    const ux = (bx - ax) / l;
    const uy = (by - ay) / l;
    if (i === 1) [ax, ay] = [ax - ux * half * 0.9, ay - uy * half * 0.9];
    if (i === pts.length - 1) [bx, by] = [bx + ux * half * 0.9, by + uy * half * 0.9];
    carriageways.add(Math.min(ax, bx) - half, Math.min(ay, by) - half, Math.max(ax, bx) + half, Math.max(ay, by) + half, { ax, ay, bx, by, half, way: wi });
  }
});
const inBuilding = (x: number, y: number) => footprints.at(x, y).some((r) => pointInRing(x, y, r));
/** Inside a carriageway rectangle by more than `tol` metres. */
const onCarriageway = (x: number, y: number, tol = 0.05, only?: (way: number) => boolean) =>
  carriageways.at(x, y).some((s) => {
    if (only && !only(s.way)) return false;
    const vx = s.bx - s.ax;
    const vy = s.by - s.ay;
    const l2 = vx * vx + vy * vy;
    const t = ((x - s.ax) * vx + (y - s.ay) * vy) / l2;
    if (t < 0 || t > 1) return false;
    const perp = Math.abs((x - s.ax) * vy - (y - s.ay) * vx) / Math.sqrt(l2);
    return perp < s.half - tol;
  });

const moatRings = city.areas.filter((a) => city.areaKinds[a.k] === 'moat').map((a) => ringOf(a.r));
const distToRing = (x: number, y: number, r: Ring) => {
  let d = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, ay] = r[j];
    const [bx, by] = r[i];
    const vx = bx - ax;
    const vy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)));
    d = Math.min(d, Math.hypot(ax + vx * t - x, ay + vy * t - y));
  }
  return d;
};

describe('trees and street furniture', () => {
  const built = buildCity(city);
  const staged = stagedBuild();
  const trees = built.trees;
  const props = built.props;
  const count = (k: string) => (props[k]?.length ?? 0) / 4;
  const treeTotal = trees.length / 4;

  it('plants 15–25k trees across the species', () => {
    const byKind: Record<string, number> = {};
    for (let i = 0; i < trees.length; i += 4) byKind[TREE_KINDS[trees[i + 3]]] = (byKind[TREE_KINDS[trees[i + 3]]] ?? 0) + 1;
    console.log(`trees ${treeTotal}`, byKind, `scatter ${staged.treeMs.toFixed(0)} ms, props ${staged.propMs.toFixed(0)} ms, whole build ${built.stats.ms.toFixed(0)} ms`);
    expect(treeTotal).toBeGreaterThan(15_000);
    expect(treeTotal).toBeLessThan(25_000);
    for (const k of TREE_KINDS) expect(byKind[k] ?? 0, k).toBeGreaterThan(50);
    for (let i = 0; i < trees.length; i++) expect(Number.isFinite(trees[i])).toBe(true);
  });

  it('keeps OSM tree species', () => {
    const ficus = city.species.indexOf('Ficus religiosa');
    const bodhi = TREE_KINDS.indexOf('bodhi');
    let matched = 0;
    for (let i = 0; i < city.trees.length; i += 3) {
      if (city.trees[i + 2] !== ficus) continue;
      const x = city.trees[i] / 10;
      const y = city.trees[i + 1] / 10;
      for (let j = 0; j < trees.length; j += 4) if (trees[j + 3] === bodhi && Math.hypot(trees[j] - x, trees[j + 1] - y) < 2.5) matched++;
    }
    expect(matched).toBeGreaterThan(0);
  });

  it('plants a bodhi in every temple ground', () => {
    const bodhi = TREE_KINDS.indexOf('bodhi');
    const missing: number[] = [];
    city.areas.forEach((a, ai) => {
      if (city.areaKinds[a.k] !== 'temple') return;
      const ring = ringOf(a.r);
      let has = false;
      for (let j = 0; j < trees.length && !has; j += 4) if (trees[j + 3] === bodhi && pointInRing(trees[j], trees[j + 1], ring)) has = true;
      if (!has) missing.push(ai);
    });
    expect(missing).toEqual([]);
  });

  it('lines both banks of the moat', () => {
    // Inner-bank trees stand inside the convex hull of the moat water, outer-bank trees outside it.
    const hull = convexHull(moatRings.flat());
    let nIn = 0;
    let nOut = 0;
    for (let j = 0; j < trees.length; j += 4) {
      const x = trees[j];
      const y = trees[j + 1];
      if (!moatRings.some((r) => distToRing(x, y, r) < 6)) continue;
      if (pointInRing(x, y, hull)) nIn++;
      else nOut++;
    }
    console.log(`moat bank trees: inner ${nIn}, outer ${nOut}`);
    expect(nIn).toBeGreaterThan(500);
    expect(nOut).toBeGreaterThan(250);
  });

  it('keeps trunks and props out of buildings, carriageways and water', () => {
    const bad: string[] = [];
    for (let j = 0; j < trees.length; j += 4) {
      const [x, y] = [trees[j], trees[j + 1]];
      if (inBuilding(x, y)) bad.push(`tree in building at ${x.toFixed(1)},${y.toFixed(1)}`);
      if (onCarriageway(x, y)) bad.push(`tree on road at ${x.toFixed(1)},${y.toFixed(1)}`);
      if (moatRings.some((r) => pointInRing(x, y, r))) bad.push(`tree in moat at ${x.toFixed(1)},${y.toFixed(1)}`);
    }
    for (const [kind, arr] of Object.entries(props)) {
      if (isMarkerKind(kind)) continue;
      for (let j = 0; j < arr.length; j += 4) {
        const [x, y] = [arr[j], arr[j + 1]];
        if (inBuilding(x, y)) bad.push(`${kind} in building at ${x.toFixed(1)},${y.toFixed(1)}`);
        if (onCarriageway(x, y)) bad.push(`${kind} on road at ${x.toFixed(1)},${y.toFixed(1)}`);
        const inMoat = moatRings.some((r) => pointInRing(x, y, r));
        if (inMoat !== (kind === 'fountain')) bad.push(`${kind} ${inMoat ? 'in' : 'out of'} the moat at ${x.toFixed(1)},${y.toFixed(1)}`);
      }
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it('classifies the buried-cable roads by name', () => {
    for (const name of ['Thapae Road', 'Changklan Road', 'Changklang Road', 'Moon Muang Road', 'Mani Noppharat Road', 'Arak Road', 'Bumrung Buri Road', 'Bun Rueang Rit Road', 'Sri Poom Road', 'Chayiaphoom Road', 'Kotchasarn Road', 'Chang Lo Road']) {
      expect(streetRules(name, 2, 0).buried, name).toBe(true);
    }
    for (const name of ['Moonmuang Road Soi 6', 'Huaykaew Road', 'Nimmanhaeminda Road', 'Suthep Road', 'ถนน ท่าแพ ซอย 1ก']) expect(streetRules(name, 2, 0).buried, name).toBe(false);
    expect(streetRules('Nimmanhaeminda Road', 2, 0).heritage).toBe(true);
    expect(streetRules('Huaykaew Road', 1, 0).sparsePoles).toBe(true);
    // Unnamed roads count as moat roads when most of their length runs beside the water.
    expect(streetRules('', 2, 0.8).buried).toBe(true);
  });

  it('puts no power poles on the buried-cable roads, and PEA cabinets there instead', () => {
    const env = placeEnv(staged.ctx);
    const buried = new Set(env.streets.filter((s) => s.buried).map((s) => s.i));
    expect(buried.size).toBeGreaterThan(50);
    const poles = props.power_pole;
    let near = 0;
    for (let j = 0; j < poles.length; j += 4) {
      const [x, y] = [poles[j], poles[j + 1]];
      // Within 4 m of a buried road's carriageway.
      for (const s of carriageways.at(x, y)) {
        if (!buried.has(s.way)) continue;
        const vx = s.bx - s.ax;
        const vy = s.by - s.ay;
        const l2 = vx * vx + vy * vy;
        const t = Math.max(0, Math.min(1, ((x - s.ax) * vx + (y - s.ay) * vy) / l2));
        if (Math.hypot(s.ax + vx * t - x, s.ay + vy * t - y) < s.half + 4) near++;
      }
    }
    expect(near).toBe(0);
    const cab = props.pea_cabinet;
    let onBuried = 0;
    for (let j = 0; j < cab.length; j += 4) if (onCarriageway(cab[j], cab[j + 1], -3, (w) => buried.has(w))) onBuried++;
    expect(onBuried).toBeGreaterThan(100);
  });

  it('places every kind of street furniture', () => {
    const min: Record<string, number> = {
      street_lamp: 1000,
      heritage_lamp: 300,
      power_pole: 5000,
      traffic_light: 100,
      bus_shelter: 60,
      spirit_house: 1000,
      parked_bike: 400,
      food_cart: 100,
      parasol: 100,
      flag_pole: 80,
      fountain: 40,
      stall: 50,
      pea_cabinet: 100,
      bench: 60,
    };
    const got = Object.fromEntries(Object.keys(min).map((k) => [k, count(k)]));
    console.log('props', got, `cable triangles ${staged.cableTriangles}`);
    for (const [k, n] of Object.entries(min)) expect(count(k), k).toBeGreaterThanOrEqual(n);
    for (const k of Object.keys(props)) if (!isMarkerKind(k)) expect(PROP_MODELS[k], k).toBeDefined();
  });

  it('stays within the triangle and instance budgets', () => {
    const tris = (g: { getAttribute(n: string): { count: number } }) => g.getAttribute('position').count / 3;
    let treeTris = 0;
    for (let i = 0; i < trees.length; i += 4) treeTris += TREE_TRIS[trees[i + 3]];
    let propTris = 0;
    let instances = 0;
    for (const [k, arr] of Object.entries(props)) {
      if (isMarkerKind(k)) continue;
      propTris += tris(PROP_MODELS[k]()) * (arr.length / 4);
      instances += arr.length / 4;
    }
    console.log(`instanced triangles: trees ${treeTris}, props ${propTris} (${instances} props)`);
    expect(treeTris).toBeLessThan(1_400_000);
    expect(propTris).toBeLessThan(1_000_000);
    expect(instances).toBeLessThan(40_000);
    expect(staged.cableTriangles).toBeLessThan(260_000);
    expect(Object.keys(props).length + TREE_KINDS.length).toBeLessThanOrEqual(40);
  });

  it('turns lamps, lights, shrines and shelters towards the street', () => {
    const env = placeEnv(staged.ctx);
    const roadDist = (x: number, y: number) => {
      let d = Infinity;
      for (const s of carriageways.at(x, y)) {
        const vx = s.bx - s.ax;
        const vy = s.by - s.ay;
        const t = Math.max(0, Math.min(1, ((x - s.ax) * vx + (y - s.ay) * vy) / (vx * vx + vy * vy)));
        d = Math.min(d, Math.hypot(s.ax + vx * t - x, s.ay + vy * t - y) - s.half);
      }
      return d;
    };
    for (const kind of ['street_lamp', 'bus_shelter', 'spirit_house']) {
      const arr = props[kind];
      let toward = 0;
      for (let j = 0; j < arr.length; j += 4) {
        const [x, y, yaw] = [arr[j], arr[j + 1], arr[j + 2]];
        if (roadDist(x + Math.cos(yaw) * 1.5, y + Math.sin(yaw) * 1.5) < roadDist(x, y)) toward++;
      }
      expect(toward / (arr.length / 4), kind).toBeGreaterThan(0.9);
    }
    // Signal poles stand beyond the junction on the approach and face back along it.
    const sig: [number, number][] = [];
    const k = city.propKinds.indexOf('traffic_signals');
    for (let i = 0; i < city.props.length; i += 3) if (city.props[i] === k) sig.push([city.props[i + 1] / 10, city.props[i + 2] / 10]);
    const tl = props.traffic_light;
    let facing = 0;
    for (let j = 0; j < tl.length; j += 4) {
      const [x, y, yaw] = [tl[j], tl[j + 1], tl[j + 2]];
      let best = sig[0];
      for (const s of sig) if (Math.hypot(s[0] - x, s[1] - y) < Math.hypot(best[0] - x, best[1] - y)) best = s;
      if ((x - best[0]) * Math.cos(yaw) + (y - best[1]) * Math.sin(yaw) > 0) facing++;
    }
    expect(facing / (tl.length / 4)).toBeGreaterThan(0.9);
    expect(env.streets.length).toBe(city.roads.ways.length);
  });

  it('is deterministic', () => {
    const again = buildCity(city);
    expect(again.trees).toEqual(built.trees);
    expect(Object.keys(again.props).sort()).toEqual(Object.keys(built.props).sort());
    for (const k of Object.keys(built.props)) expect(again.props[k]).toEqual(built.props[k]);
    expect(again.layers.structures.position).toEqual(built.layers.structures.position);
  });
});

const TREE_TRIS = TREE_KINDS.map((k) => treeGeometry(k).getAttribute('position').count / 3);

function convexHull(pts: [number, number][]): Ring {
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Ring = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Ring = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
