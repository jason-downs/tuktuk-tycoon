// Drives the vehicle, people and crowd layers headlessly (no WebGL): a real
// game on the real map, the real static city build, and a stub view context.
// Checks what each layer would draw and that nothing throws or goes NaN.

import { readFileSync } from 'node:fs';
import { InstancedMesh, MeshLambertMaterial, PerspectiveCamera, Scene, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { calendar, timeOf } from '../src/sim/clock';
import { makeRequest } from '../src/sim/demand';
import { Game } from '../src/sim/game';
import type { GraphJSON } from '../src/sim/graph';
import { installSystems } from '../src/sim/systems';
import type { RideRequest } from '../src/sim/types';
import { ui } from '../src/ui/store';
import type { CityData } from '../src/world3d/city';
import { buildCity, tileCity } from '../src/world3d/build/world';
import { edgeLanes } from '../src/world3d/kinematics';
import { CrowdLayer } from '../src/world3d/layers/crowds';
import { PeopleLayer } from '../src/world3d/layers/people';
import { MarkerLayer } from '../src/world3d/layers/markers';
import type { ViewContext, WorldLayer } from '../src/world3d/layers/types';
import { VehicleLayer } from '../src/world3d/layers/vehicles';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));
const built = tileCity(buildCity(read<CityData>('city3d.json')));

function setup(time: number) {
  const game = Game.create(world, { seed: 7 });
  game.state.time = time;
  installSystems(game);
  game.step(1);
  const scene = new Scene();
  const player = game.playerVehicle()!;
  const start = game.vehiclePose(player);
  let vehicles: VehicleLayer | null = null;
  const ctx: ViewContext = {
    game,
    scene,
    camera: new PerspectiveCamera(),
    renderer: undefined as never,
    modelMat: new MeshLambertMaterial(),
    rig: { tx: start.x, ty: start.y, dist: 220, yaw: 0 },
    vehicleScale: () => Math.max(1.3, ctx.rig.dist / 150),
    laneOffset: (arc) => edgeLanes(world.graph).lane[arc >> 1],
    placeVehicle: () => {},
    screenOf: () => null,
    kerbOf: (req: RideRequest) => {
      const place = game.place(req.from);
      return { x: world.graph.nodeX[place.node] + 3, y: world.graph.nodeY[place.node] };
    },
    vehicleMesh: (id) => vehicles?.meshOf(id),
    hoverRequest: null,
    city: () => built,
    addLayer: () => {},
  };
  vehicles = new VehicleLayer(ctx);
  const layers: WorldLayer[] = [vehicles, new PeopleLayer(ctx), new CrowdLayer(ctx)];
  let now = 0;
  const frame = (dt = 1 / 60) => {
    game.update(dt);
    now += dt * 1000;
    const info = { now, dt, hour: calendar(game.state.time).hour, ui: ui.get() };
    for (const l of layers) l.update(info);
  };
  /** Instanced meshes in the scene, split by kind (vehicle batches carry iPaint, people iColA). */
  const drawn = () => {
    const out = { vehicles: 0, people: 0, cones: 0, meshes: [] as InstancedMesh[] };
    scene.traverse((o) => {
      const m = o as InstancedMesh;
      if (!m.isInstancedMesh || !m.visible) return;
      out.meshes.push(m);
      if (m.geometry.getAttribute('iPaint')) out.vehicles += m.count;
      else if (m.geometry.getAttribute('iColA')) out.people += m.count;
      else out.cones += m.count;
    });
    return out;
  };
  return { game, ctx, vehicles, layers, frame, drawn, scene };
}

function finiteMatrices(meshes: InstancedMesh[]): boolean {
  for (const m of meshes) {
    const a = m.instanceMatrix.array;
    for (let i = 0; i < m.count * 16; i++) if (!Number.isFinite(a[i])) return false;
  }
  return true;
}

describe('3D layers, headless', () => {
  it('draws the fleet, rival and street traffic, riders and a pavement crowd by day', () => {
    const t = setup(timeOf(2026, 10, 3, 10));
    for (let i = 0; i < 240; i++) t.frame();
    const d = t.drawn();
    console.log(`day: ${d.vehicles} vehicles, ${d.people} people in ${d.meshes.length} instanced meshes`);
    expect(d.vehicles).toBeGreaterThan(40);
    expect(d.people).toBeGreaterThan(40);
    expect(d.cones).toBe(0);
    expect(d.meshes.length).toBeLessThan(30);
    expect(finiteMatrices(d.meshes)).toBe(true);
    // The fleet vehicle's stand-in follows its rendered pose near the sim position.
    const v = t.game.playerVehicle()!;
    const proxy = t.ctx.vehicleMesh(v.id)!;
    expect(proxy).toBeDefined();
    const pose = t.game.vehiclePose(v);
    expect(Math.hypot(proxy.position.x - pose.x, -proxy.position.z - pose.y)).toBeLessThan(12);
  });

  it('seats a party in the tuk-tuk on a trip, and lights up at night', () => {
    const t = setup(timeOf(2026, 10, 3, 21));
    for (let i = 0; i < 30; i++) t.frame();
    const before = t.drawn().people;
    const v = t.game.playerVehicle()!;
    const req: RideRequest = {
      id: 991,
      from: 0,
      to: 1,
      archetype: 'tourist_cn',
      party: 3,
      channel: 'street',
      spawnedAt: t.game.state.time,
      expiresAt: t.game.state.time + 600,
      distance: 2000,
      fairFare: 80,
      fixedFare: null,
      maxRatio: 1.3,
      line: '',
      claimedBy: v.id,
    };
    v.task = { kind: 'trip', trip: { request: req, fare: 80, ratio: 1, startedAt: t.game.state.time, distance: 2000 } };
    t.game.setSpeed(0);
    t.frame();
    const after = t.drawn();
    expect(after.people - before).toBeGreaterThanOrEqual(3);
    expect(after.cones).toBeGreaterThan(0);
    expect(finiteMatrices(after.meshes)).toBe(true);
    // At the drop-off the party steps out beside the tuk-tuk for a moment.
    const waiting = () => (t.layers[1] as unknown as { batch: { count: number } }).batch.count;
    const standing = waiting();
    v.task = { kind: 'idle' };
    t.game.emit('trip', { vehicleId: v.id, driverId: null, fare: 80, tip: 0, rating: 5, request: req, companyTake: 80 });
    t.frame();
    expect(waiting()).toBe(standing + 3);
    for (let i = 0; i < 260; i++) t.frame();
    expect(waiting()).toBe(standing);
  });

  it('drops the stand-in, rings and drop-off party of a tuk-tuk that is out of town', () => {
    const t = setup(timeOf(2026, 10, 3, 10));
    const markers = new MarkerLayer(t.ctx);
    t.layers.push(markers);
    const rings = markers as unknown as { playerRing: Mesh; selectRing: Mesh };
    const v = t.game.playerVehicle()!;
    ui.set({ selectedVehicle: v.id });
    for (let i = 0; i < 5; i++) t.frame();
    expect(t.ctx.vehicleMesh(v.id)).toBeDefined();
    expect(rings.playerRing.visible).toBe(true);
    expect(rings.selectRing.visible).toBe(true);

    const req = makeRequest(t.game, world.landmarks.find((l) => l.id === 'tha_phae_gate')!, world.landmarks.find((l) => l.id === 'bo_sang')!, 'thai_tourist', 'street', calendar(t.game.state.time));
    const trip = { request: req, fare: 300, ratio: 1, startedAt: t.game.state.time, distance: 4_000 };
    v.task = { kind: 'away', until: t.game.state.time + 3_600, trip, portal: 0 };
    t.frame();
    expect(t.ctx.vehicleMesh(v.id)).toBeUndefined();
    expect(rings.playerRing.visible).toBe(false);
    expect(rings.selectRing.visible).toBe(false);
    // Paid for a drop-off beyond the portal: nobody steps out on the map.
    const alighting = () => (t.layers[1] as unknown as { alighting: unknown[] }).alighting.length;
    const before = alighting();
    t.game.emit('trip', { vehicleId: v.id, driverId: null, fare: 300, tip: 0, rating: 5, request: req, companyTake: 300 });
    t.frame();
    expect(alighting()).toBe(before);

    // Back in town, it is drawn and ringed again.
    v.task = { kind: 'idle' };
    t.frame();
    expect(t.ctx.vehicleMesh(v.id)).toBeDefined();
    expect(rings.playerRing.visible).toBe(true);
    ui.set({ selectedVehicle: null });
  });

  it('stays cheap per frame in a busy evening street scene', () => {
    const t = setup(timeOf(2026, 10, 6, 20));
    const bazaar = world.landmarks.find((l) => l.id === 'night_bazaar')!;
    Object.assign(t.ctx.rig, { tx: bazaar.x, ty: bazaar.y });
    for (let i = 0; i < 300; i++) t.frame();
    const info = () => ({ now: performance.now(), dt: 1 / 60, hour: calendar(t.game.state.time).hour, ui: ui.get() });
    const t0 = performance.now();
    const n = 120;
    for (let i = 0; i < n; i++) {
      t.game.update(1 / 60);
      const f = info();
      for (const l of t.layers) l.update(f);
    }
    const ms = (performance.now() - t0) / n;
    const d = t.drawn();
    console.log(`evening at the Night Bazaar: ${d.vehicles} vehicles, ${d.people} people, ${d.cones} light pools; ${ms.toFixed(2)} ms per frame (sim + layers)`);
    expect(d.people).toBeGreaterThan(100);
    expect(ms).toBeLessThan(12);
  });

  it('thins out and hides street life when zoomed out, and cleans up', () => {
    const t = setup(timeOf(2026, 10, 3, 18));
    for (let i = 0; i < 120; i++) t.frame();
    const near = t.drawn();
    (t.ctx.rig as { dist: number }).dist = 3000;
    for (let i = 0; i < 90; i++) t.frame();
    const far = t.drawn();
    expect(far.people).toBeLessThan(near.people);
    expect(far.vehicles).toBeLessThan(near.vehicles);
    for (const l of t.layers) l.dispose();
    let left = 0;
    t.scene.traverse((o) => {
      if ((o as InstancedMesh).isInstancedMesh) left++;
    });
    expect(left).toBe(0);
  });
});
