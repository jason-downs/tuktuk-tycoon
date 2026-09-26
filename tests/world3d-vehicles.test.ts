import { readFileSync } from 'node:fs';
import type { BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { PAINTS } from '../src/content/paints';
import { VEHICLE_MODELS } from '../src/content/vehicles';
import { buildWorld, type PoiJSON } from '../src/data/world';
import type { GraphJSON } from '../src/sim/graph';
import {
  edgeLanes,
  kerbOffset,
  laneOffsetFor,
  newKinState,
  roadWidth,
  samplePath,
  smoothedPose,
  spreadParked,
  stepKinematics,
  wrapAngle,
  type PathRef,
} from '../src/world3d/kinematics';
import { triangles } from '../src/world3d/models';
import { CosmeticTraffic } from '../src/world3d/traffic';
import {
  AMBIENT_KINDS,
  ambientGeometry,
  EMIT,
  LIVERY_EXTRA,
  modelBounds,
  SLOT,
  TUK_ACCESSORIES,
  TUK_EXTRAS,
  TUK_KINDS,
  tukAccessoryGeometry,
  tukKindOf,
  tukSeats,
  tuktukGeometry,
} from '../src/world3d/vehicleModels';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));
const graph = world.graph;
const lanes = edgeLanes(graph);
const lane = (arc: number) => lanes.lane[arc >> 1];

/** Sane buffers: finite positions, indices in range, the aVeh tag on every vertex. */
function checkBuffers(geo: BufferGeometry): void {
  const pos = geo.getAttribute('position');
  const tag = geo.getAttribute('aVeh');
  expect(tag.count).toBe(pos.count);
  expect(geo.getAttribute('color').count).toBe(pos.count);
  for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
  const idx = geo.index!;
  let max = 0;
  for (let i = 0; i < idx.count; i++) max = Math.max(max, idx.getX(i));
  expect(max).toBeLessThan(pos.count);
}

/** Mean position of the vertices whose tag channel c equals v. */
function meanOf(geo: BufferGeometry, c: 'x' | 'y', v: number): [number, number, number] | null {
  const pos = geo.getAttribute('position');
  const tag = geo.getAttribute('aVeh');
  let n = 0;
  const m = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    if ((c === 'x' ? tag.getX(i) : tag.getY(i)) !== v) continue;
    m[0] += pos.getX(i);
    m[1] += pos.getY(i);
    m[2] += pos.getZ(i);
    n++;
  }
  return n ? [m[0] / n, m[1] / n, m[2] / n] : null;
}

describe('vehicle models', () => {
  it('keeps the tuk-tuk within its triangle budget in every variant and livery', () => {
    const counts: Record<string, number> = {};
    for (const kind of TUK_KINDS) {
      for (const extra of TUK_EXTRAS) counts[`${kind}/${extra}`] = triangles(tuktukGeometry(kind, extra));
      counts[`${kind}/lod1`] = triangles(tuktukGeometry(kind, 'none', 1));
      for (const acc of TUK_ACCESSORIES) counts[`${kind}+${acc}`] = triangles(tukAccessoryGeometry(acc, kind));
    }
    console.log(JSON.stringify(counts));
    for (const kind of TUK_KINDS) {
      for (const extra of TUK_EXTRAS) {
        checkBuffers(tuktukGeometry(kind, extra));
        const t = counts[`${kind}/${extra}`];
        expect(t).toBeGreaterThanOrEqual(1000);
        // The hero model is ≈1,000–1,500 triangles; livery decorations add up to ~250.
        expect(t).toBeLessThanOrEqual(extra === 'none' ? 1500 : 1750);
      }
      checkBuffers(tuktukGeometry(kind, 'none', 1));
      expect(counts[`${kind}/lod1`]).toBeLessThanOrEqual(350);
      for (const acc of TUK_ACCESSORIES) expect(counts[`${kind}+${acc}`]).toBeLessThanOrEqual(120);
    }
  });

  it('fits the 2017 size rules and faces +X', () => {
    for (const kind of TUK_KINDS) {
      const g = tuktukGeometry(kind);
      const { min, max } = modelBounds(g);
      expect(max[0] - min[0]).toBeLessThanOrEqual(kind === 'ev7' ? 4.05 : 3.3);
      expect(max[2] - min[2]).toBeLessThanOrEqual(1.5);
      expect(max[1]).toBeLessThanOrEqual(2.0);
      expect(min[1]).toBeGreaterThanOrEqual(-0.01);
      const head = meanOf(g, 'y', EMIT.head)!;
      const tail = meanOf(g, 'y', EMIT.tail)!;
      expect(head[0]).toBeGreaterThan(1.2);
      expect(tail[0]).toBeLessThan(-1.4);
      expect(meanOf(g, 'y', EMIT.sign)).not.toBeNull();
      for (const slot of [SLOT.body, SLOT.canopy, SLOT.trim]) expect(meanOf(g, 'x', slot)).not.toBeNull();
    }
    expect(tukKindOf('rusty')).toBe('rusty');
    expect(tukKindOf('ev_7seat', 'ev')).toBe('ev7');
    for (const id of Object.keys(VEHICLE_MODELS)) expect(TUK_KINDS).toContain(tukKindOf(id, VEHICLE_MODELS[id].powertrain));
    for (const id of Object.keys(LIVERY_EXTRA)) expect(PAINTS[id]).toBeDefined();
  });

  it('spins only wheels about their axles, which touch the ground', () => {
    for (const g of [tuktukGeometry('lpg'), ambientGeometry('scooter'), ambientGeometry('songthaew'), ambientGeometry('sedan')]) {
      const pos = g.getAttribute('position');
      const tag = g.getAttribute('aVeh');
      let lowest = Infinity;
      let wheelVerts = 0;
      for (let i = 0; i < pos.count; i++) {
        const cy = tag.getW(i);
        if (cy <= 0) continue;
        wheelVerts++;
        const d = Math.hypot(pos.getX(i) - tag.getZ(i), pos.getY(i) - cy);
        expect(d).toBeLessThanOrEqual(cy * 1.01 + 1e-6);
        lowest = Math.min(lowest, pos.getY(i));
      }
      expect(wheelVerts).toBeGreaterThan(0);
      expect(lowest).toBeLessThan(0.01);
    }
  });

  it('keeps ambient vehicles within budget', () => {
    const budget: Record<string, number> = { songthaew: 900, scooter: 400, scooterBox: 420, sedan: 600, taxi: 620, pickup: 600, van: 600 };
    for (const kind of AMBIENT_KINDS) {
      const g = ambientGeometry(kind);
      checkBuffers(g);
      expect(triangles(g)).toBeLessThanOrEqual(budget[kind]);
      expect(meanOf(g, 'y', EMIT.head)![0]).toBeGreaterThan(0.3);
    }
  });

  it('seats riders on the benches, three abreast, the 7-seater in two rows', () => {
    expect(tukSeats('lpg').seats).toHaveLength(3);
    const seven = tukSeats('ev7').seats;
    expect(seven).toHaveLength(6);
    expect(seven[0][0]).toBeGreaterThan(seven[3][0]);
    for (const [x, y] of seven) {
      expect(x).toBeLessThan(0);
      expect(y).toBeGreaterThan(0.8);
    }
  });
});

describe('vehicle kinematics', () => {
  it('drives on the left of travel', () => {
    const c = { x: 0, y: 0 };
    let checked = 0;
    for (let e = 0; e < graph.edges.length && checked < 400; e += 37) {
      const edge = graph.edges[e];
      if (edge.len < 10) continue;
      for (const arc of edge.oneway ? [e * 2] : [e * 2, e * 2 + 1]) {
        const off = lane(arc);
        if (off <= 0) continue;
        const ref: PathRef = { arcs: null, idx: 0, arc, s: edge.len / 2, prev: -1 };
        samplePath(graph, ref, 0, lane, c);
        const p = graph.poseAt(arc, edge.len / 2);
        const left = (c.x - p.x) * -Math.sin(p.heading) + (c.y - p.y) * Math.cos(p.heading);
        expect(left).toBeCloseTo(off, 5);
        expect(left).toBeLessThan(roadWidth(edge.cls, edge.oneway) / 2);
        // Stopping at the kerb moves a vehicle further left, never past the road edge when it fits.
        const kerb = kerbOffset(off, lanes.half[e], 1.0);
        expect(kerb).toBeGreaterThanOrEqual(off);
        if (kerb > off) expect(kerb + 1.0).toBeLessThanOrEqual(lanes.half[e]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(laneOffsetFor(1, true)).toBeGreaterThan(laneOffsetFor(5, true));
    expect(laneOffsetFor(3, false)).toBeCloseTo(roadWidth(3, false) / 4);
  });

  it('keeps the heading on a straight road', () => {
    const e = graph.edges.findIndex((ed) => ed.pts.length === 4 && ed.len > 40);
    const out = { x: 0, y: 0, yaw: 0 };
    smoothedPose(graph, { arcs: null, idx: 0, arc: e * 2, s: 20, prev: -1 }, lane, 0, out);
    expect(wrapAngle(out.yaw - graph.poseAt(e * 2, 20).heading)).toBeCloseTo(0, 6);
  });

  it('turns smoothly through a real junction', () => {
    // The first right-angle turn at a junction on routes between Old City landmarks.
    const ids = ['tha_phae_gate', 'wat_phra_singh', 'wat_chedi_luang', 'chang_phueak_gate', 'chiang_mai_gate', 'suan_dok_gate', 'three_kings'];
    const lms = ids.map((id) => world.landmarks.find((l) => l.id === id)).filter((l) => !!l);
    let route: NonNullable<ReturnType<typeof world.router.route>> | null = null;
    let turnAt = -1;
    for (const from of lms) {
      for (const to of lms) {
        if (from === to || turnAt >= 0) continue;
        const r = world.router.route(from.node, to.node);
        if (!r) continue;
        for (let i = 0; i + 1 < r.arcs.length; i++) {
          const a = r.arcs[i];
          const b = r.arcs[i + 1];
          if (graph.arcLen(a) < 16 || graph.arcLen(b) < 16 || graph.outgoing(graph.arcTo(a)).length < 3) continue;
          if (Math.abs(wrapAngle(graph.arcStartHeading(b) - graph.arcEndHeading(a))) > 1.2) {
            route = r;
            turnAt = i;
            break;
          }
        }
      }
    }
    expect(turnAt).toBeGreaterThanOrEqual(0);
    route = route!;
    const a = route.arcs[turnAt];
    const lenA = graph.arcLen(a);
    const raw: number[] = [];
    const yaws: number[] = [];
    const pts: [number, number][] = [];
    const out = { x: 0, y: 0, yaw: 0 };
    for (let d = -15; d <= 15; d += 0.25) {
      const onA = d < 0;
      const ref: PathRef = { arcs: route.arcs, idx: onA ? turnAt : turnAt + 1, arc: route.arcs[onA ? turnAt : turnAt + 1], s: onA ? lenA + d : d, prev: -1 };
      smoothedPose(graph, ref, lane, 0, out);
      yaws.push(out.yaw);
      pts.push([out.x, out.y]);
      raw.push(graph.poseAt(ref.arc, ref.s).heading);
    }
    let maxRaw = 0;
    let maxYaw = 0;
    let maxJump = 0;
    for (let i = 1; i < yaws.length; i++) {
      maxRaw = Math.max(maxRaw, Math.abs(wrapAngle(raw[i] - raw[i - 1])));
      maxYaw = Math.max(maxYaw, Math.abs(wrapAngle(yaws[i] - yaws[i - 1])));
      maxJump = Math.max(maxJump, Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    console.log(`junction turn: raw heading jump ${maxRaw.toFixed(2)} rad, smoothed max step ${maxYaw.toFixed(3)} rad per 0.25 m, max position step ${maxJump.toFixed(2)} m`);
    expect(maxRaw).toBeGreaterThan(1.0);
    expect(maxYaw).toBeLessThan(0.12);
    expect(maxJump).toBeLessThan(0.6);
  });

  it('animates speed, braking, wheels and idle shake', () => {
    const e = graph.edges.findIndex((ed) => ed.len > 120);
    const arc = e * 2;
    const st = newKinState(0);
    const ref = (s: number): PathRef => ({ arcs: null, idx: 0, arc, s, prev: -1 });
    const step = (s: number, speed: number, t: number, lpg = true) =>
      stepKinematics(graph, st, ref(s), lane, 0, { dtGame: 1 / 60, dtReal: 1 / 60, now: t, wheelR: 0.26, scale: 1.4, lpg, engineOn: true, speed });
    let s = 10;
    let v = 10;
    for (let i = 0; i < 60; i++) {
      const spin = st.spin;
      step((s += v / 60), v, i / 60);
      if (i > 0) expect(Math.abs(wrapAngle(st.spin - spin))).toBeLessThanOrEqual(0.9 + 1e-9);
    }
    expect(st.brake).toBeLessThan(0.1);
    for (let i = 0; i < 40; i++) step((s += (v = Math.max(0, v - 4.5 / 60)) / 60), v, 1 + i / 60);
    expect(st.brake).toBeGreaterThan(0.5);
    expect(st.pitch).toBeLessThan(0);
    for (let i = 0; i < 400; i++) step(s, 0, 2 + i / 60);
    const shake = new Set<number>();
    for (let i = 0; i < 30; i++) {
      step(s, 0, 9 + i / 60);
      shake.add(Math.round(st.heave * 1e4));
    }
    expect(shake.size).toBeGreaterThan(3);
    step(s, 0, 10, false);
    expect(st.heave).toBe(0);
  });

  it('queues stopped vehicles nose to tail along the kerb', () => {
    const out = new Map<number, number>();
    const items = [1, 2, 3, 4, 5].map((key) => ({ key, arc: 42, s: 30, len: 4.7 }));
    items.push({ key: 9, arc: 43, s: 30, len: 4.7 }, { key: 10, arc: 42, s: 5, len: 4.7 });
    spreadParked(items, 1, out);
    const pos = [1, 2, 3, 4, 5].map((k) => 30 + out.get(k)!);
    expect(pos[0]).toBe(30);
    for (let i = 1; i < pos.length; i++) expect(pos[i - 1] - pos[i]).toBeGreaterThanOrEqual(5.7 - 1e-9);
    expect(out.get(9)).toBe(0);
    // The one further back queues behind the rest.
    expect(5 + out.get(10)!).toBeLessThanOrEqual(pos[4] - 5.7 + 1e-9);
  });
});

describe('cosmetic traffic', () => {
  it('wanders valid arcs near the camera, keeping gaps', () => {
    const gate = world.landmarks.find((l) => l.id === 'tha_phae_gate')!;
    const t = new CosmeticTraffic(graph, 7);
    const frame = { x: gate.x, y: gate.y, radius: 500, target: 45, dt: 0.5, speedOf: (e: number) => graph.speedOf(e), scale: 1.4 };
    for (let i = 0; i < 400; i++) t.update(frame);
    expect(t.agents.length).toBeGreaterThan(30);
    expect(t.agents.length).toBeLessThanOrEqual(49);
    const scooters = t.agents.filter((a) => a.kind === 'scooter' || a.kind === 'scooterBox').length;
    expect(scooters / t.agents.length).toBeGreaterThan(0.4);
    for (const a of t.agents) {
      expect(graph.arcValid(a.arc)).toBe(true);
      expect(a.s).toBeGreaterThanOrEqual(0);
      expect(a.s).toBeLessThanOrEqual(graph.arcLen(a.arc) + 1e-6);
      if (a.next >= 0) expect(graph.arcFrom(a.next)).toBe(graph.arcTo(a.arc));
      const p = graph.poseAt(a.arc, a.s);
      expect(Math.hypot(p.x - gate.x, p.y - gate.y)).toBeLessThan(500 * 1.25 + 60);
    }
    const byArc = new Map<number, number[]>();
    for (const a of t.agents) byArc.set(a.arc, [...(byArc.get(a.arc) ?? []), a.s]);
    for (const list of byArc.values()) {
      list.sort((p, q) => p - q);
      for (let i = 1; i < list.length; i++) expect(list[i] - list[i - 1]).toBeGreaterThanOrEqual(2.6 * 1.4 - 1e-6);
    }
  });
});
