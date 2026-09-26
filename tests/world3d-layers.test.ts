// Drives the vehicle, people and crowd layers headlessly (no WebGL): a real
// game on the real map, the real static city build, and a stub view context.
// Checks what each layer would draw and that nothing throws or goes NaN.

import { readFileSync } from 'node:fs';
import { Fog, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, PerspectiveCamera, Scene, Vector3, type BufferGeometry, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { buildWorld, type PoiJSON } from '../src/data/world';
import { calendar, timeOf } from '../src/sim/clock';
import { makeRequest } from '../src/sim/demand';
import { Game } from '../src/sim/game';
import type { GraphJSON } from '../src/sim/graph';
import { rivalsOf } from '../src/sim/rivals';
import { installSystems } from '../src/sim/systems';
import type { RideRequest } from '../src/sim/types';
import { ui } from '../src/ui/store';
import { PERSON_DETAIL_SIGHT, type BlobShadows } from '../src/world3d/batches';
import type { CityData } from '../src/world3d/city';
import { buildCity, tileCity } from '../src/world3d/build/world';
import { festivalsAt } from '../src/world3d/env/festivals';
import { timeOfDay } from '../src/world3d/env/lighting';
import { moonIllumination, moonPhase, moonPosition, solarPosition } from '../src/world3d/env/sun';
import { edgeLanes, ROAD_SURFACE_Y } from '../src/world3d/kinematics';
import { CrowdLayer } from '../src/world3d/layers/crowds';
import type { EnvState } from '../src/world3d/layers/environment';
import { MarkerLayer } from '../src/world3d/layers/markers';
import { PeopleLayer } from '../src/world3d/layers/people';
import type { ViewContext, WorldLayer } from '../src/world3d/layers/types';
import { VehicleLayer } from '../src/world3d/layers/vehicles';
import { personGeometry } from '../src/world3d/personModels';
import { tuktukGeometry } from '../src/world3d/vehicleModels';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));
const built = tileCity(buildCity(read<CityData>('city3d.json')));

/** The darkness the Environment layer publishes for a game time on a clear day: sun and moon for the date. */
function nightAt(time: number): number {
  const sun = solarPosition(calendar(time));
  const phase = moonPhase(time);
  return timeOfDay(sun.elevation, sun.hourAngle < 0, moonPosition(sun, phase).elevation, moonIllumination(phase)).night;
}

/** A view on a real game at `time`; `night` overrides the environment's darkness (e.g. a dark storm). */
function setup(time: number, night?: number) {
  const game = Game.create(world, { seed: 7 });
  game.state.time = time;
  installSystems(game);
  game.step(1);
  const scene = new Scene();
  const player = game.playerVehicle()!;
  const start = game.vehiclePose(player);
  let vehicles: VehicleLayer | null = null;
  const env: EnvState = { night: 0, lamps: 0, rain: 0, storm: 0, wet: 0, haze: 0, mist: 0, flash: 0, festivals: festivalsAt(time) };
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
    envState: () => ({ ...env, night: night ?? nightAt(game.state.time) }),
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
  /** Instanced meshes in the scene, split by kind (vehicle batches carry iPaint, people iColA, blob shadows RGBA colours). */
  const drawn = () => {
    const out = { vehicles: 0, people: 0, blobs: 0, cones: 0, meshes: [] as InstancedMesh[] };
    scene.traverse((o) => {
      const m = o as InstancedMesh;
      if (!m.isInstancedMesh || !m.visible) return;
      out.meshes.push(m);
      if (m.geometry.getAttribute('iPaint')) out.vehicles += m.count;
      else if (m.geometry.getAttribute('iColA')) out.people += m.count;
      else if (m.geometry.getAttribute('color')?.itemSize === 4) out.blobs += m.count;
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

  it('lights headlights by the sun for the date and in a dark storm, not by a November clock', () => {
    // 21 June 2027, 18:15: the sun is still well up, though November would be past sunset.
    const summer = setup(timeOf(2027, 5, 21, 18.25));
    for (let i = 0; i < 60; i++) summer.frame();
    expect(nightAt(summer.game.state.time)).toBe(0);
    expect(summer.drawn().cones).toBe(0);
    // Noon under a storm dark enough to light the lamps.
    const storm = setup(timeOf(2026, 10, 3, 12), 0.55);
    for (let i = 0; i < 60; i++) storm.frame();
    expect(storm.drawn().cones).toBeGreaterThan(0);
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

  it('redraws the route ribbon in place as the tuk-tuk drives, keeping its material and shader', () => {
    const t = setup(timeOf(2026, 10, 3, 10));
    const markers = new MarkerLayer(t.ctx);
    t.layers.push(markers);
    const far = world.landmarks.find((l) => l.id === 'cnx_airport')!;
    expect(t.game.playerDriveTo(far.x, far.y)).toBe(true);
    t.game.setSpeed(5);
    // Every material or geometry the scene holds, and how many of them were disposed.
    const seen = new Set<Material | BufferGeometry>();
    let disposed = 0;
    const watch = () =>
      t.scene.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        for (const r of [m.material as Material, m.geometry]) {
          if (seen.has(r)) continue;
          seen.add(r);
          r.addEventListener('dispose', () => disposed++);
        }
      });
    const ribbon = () => {
      let found: Mesh | undefined;
      t.scene.traverse((o) => {
        if ((o as Mesh).isMesh && o.renderOrder === 4 && o.visible) found = o as Mesh;
      });
      return found;
    };
    const idx0 = t.game.playerVehicle()!.routeIdx;
    t.frame();
    watch();
    const first = ribbon();
    expect(first).toBeDefined();
    const material = first!.material;
    for (let i = 0; i < 90; i++) {
      t.frame();
      watch();
    }
    const v = t.game.playerVehicle()!;
    // The tuk-tuk moved along its route (and is still on it), so the ribbon was rebuilt many times over.
    expect(v.route).not.toBeNull();
    expect(v.routeIdx - idx0).toBeGreaterThan(10);
    expect(ribbon()!.material).toBe(material);
    expect(disposed).toBe(0);
    // It starts at the tuk-tuk and follows the road ahead of it.
    const pos = ribbon()!.geometry.getAttribute('position');
    const pose = t.game.vehiclePose(v);
    expect(Math.hypot((pos.getX(0) + pos.getX(1)) / 2 - pose.x, -(pos.getZ(0) + pos.getZ(1)) / 2 - pose.y)).toBeLessThan(5);
    markers.dispose();
    expect(ribbon()).toBeUndefined();
  });

  it('draws each vehicle and figure in the detail its own distance calls for, and people cast no shadow-map shadows', () => {
    const t = setup(timeOf(2026, 10, 3, 18));
    const fogFar = t.ctx.rig.dist * 4.5 + 1600;
    t.scene.fog = new Fog(0xffffff, 100, fogFar);
    for (let i = 0; i < 120; i++) t.frame();
    const { rig } = t.ctx;
    const scale = t.ctx.vehicleScale();
    const m = new Matrix4();
    const at = new Vector3();
    /** Each instance's distance from the camera (the eye taken as rig.dist above the target) and its scale. */
    const instances = (mesh: InstancedMesh) =>
      Array.from({ length: mesh.count }, (_, i) => {
        mesh.getMatrixAt(i, m);
        at.setFromMatrixPosition(m);
        return { view: Math.hypot(rig.dist, at.x - rig.tx, -at.z - rig.ty), size: new Vector3().setFromMatrixColumn(m, 0).length() };
      });
    const tris = (geo: BufferGeometry) => geo.index!.count / 3;
    type Lods = { lods: ({ mesh: InstancedMesh } | null)[] };
    const meshesOf = (b: Lods) => b.lods.flatMap((l) => (l && l.mesh.visible ? [l.mesh] : []));
    const riders = meshesOf((t.vehicles as unknown as { people: Lods }).people);
    const waiting = meshesOf((t.layers[1] as unknown as { batch: Lods }).batch);
    const walkers = meshesOf((t.layers[2] as unknown as { batch: Lods }).batch);
    const personFar = tris(personGeometry(1));
    expect(personFar).toBeLessThan(tris(personGeometry(0)) * 0.6);
    const tukNear = tris(tuktukGeometry('lpg'));
    const tukFar = tris(tuktukGeometry('lpg', 'none', 1));

    const d = t.drawn();
    let farTuks = 0;
    let beyondRiders = 0;
    let farPeople = 0;
    for (const mesh of d.meshes) {
      if (mesh.geometry.getAttribute('iColA')) {
        // People only receive shadows: blob decals stand in for theirs.
        expect(mesh.castShadow).toBe(false);
        expect(mesh.customDepthMaterial).toBeUndefined();
        // The full figure only while it is big on screen (15 m of slack for riders queued at a rank).
        const far = tris(mesh.geometry) === personFar;
        for (const p of instances(mesh)) {
          if (far) expect(p.view).toBeGreaterThan(PERSON_DETAIL_SIGHT * p.size - 15);
          else expect(p.view).toBeLessThan(PERSON_DETAIL_SIGHT * p.size + 15);
        }
        if (far) farPeople += mesh.count;
      } else if (mesh.geometry.getAttribute('iPaint')) {
        for (const v of instances(mesh)) {
          // Nothing past the fog; the full tuk-tuk only near the camera (100 m of slack for queues).
          expect(v.view).toBeLessThan(fogFar + 100);
          if (tris(mesh.geometry) >= tukNear * 0.9) expect(v.view).toBeLessThan(900 + 100);
          if (v.view > 370 * scale + 100) beyondRiders++;
        }
        if (tris(mesh.geometry) === tukFar) farTuks += mesh.count;
      }
    }
    const blobs = d.blobs;
    console.log(`street level at 18:00: ${d.vehicles} vehicles (${farTuks} simple tuk-tuks), ${d.people} people (${farPeople} simple), ${blobs} blob shadows`);
    // At street level the rival tuk-tuks across town are drawn simple, and so are most figures.
    expect(rivalsOf(t.game)!.count).toBeGreaterThan(0);
    expect(farTuks).toBeGreaterThan(0);
    expect(farPeople).toBeGreaterThan(0);
    // Riders are left out once they would be a few pixels tall, though their vehicles are drawn.
    expect(beyondRiders).toBeGreaterThan(0);
    for (const mesh of riders) for (const p of instances(mesh)) expect(p.view).toBeLessThan(370 * scale + 15);
    // So are waiting passengers; everyone on foot has a blob shadow.
    for (const mesh of waiting) for (const p of instances(mesh)) expect(p.view).toBeLessThan(630 * scale + 5);
    const blobsOf = (layer: WorldLayer) => (layer as unknown as { blobs: BlobShadows }).blobs.count;
    expect(blobsOf(t.layers[1])).toBe(waiting.reduce((n, mesh) => n + mesh.count, 0));
    expect(blobsOf(t.layers[2])).toBe(walkers.reduce((n, mesh) => n + mesh.count, 0));
    expect(blobs).toBe(blobsOf(t.layers[0]) + blobsOf(t.layers[1]) + blobsOf(t.layers[2]));
    // Every fleet vehicle still has its stand-in, drawn or not.
    for (const v of t.game.state.vehicles) if (v.task.kind !== 'away') expect(t.ctx.vehicleMesh(v.id)).toBeDefined();
    // Down at the kerb, the walkers nearby are drawn in full.
    (t.ctx.rig as { dist: number }).dist = 25;
    for (let i = 0; i < 30; i++) t.frame();
    const close = t.drawn().meshes.filter((mesh) => mesh.geometry.getAttribute('iColA') && tris(mesh.geometry) !== personFar);
    expect(close.reduce((n, mesh) => n + mesh.count, 0)).toBeGreaterThan(0);
  });
  it('gives the riders of a scooter a blob shadow on the road beneath it; riders under a roof have none', () => {
    const t = setup(timeOf(2026, 10, 3, 10));
    for (let i = 0; i < 120; i++) t.frame();
    const { rig } = t.ctx;
    const scale = t.ctx.vehicleScale();
    type Meshed = { batch: { mesh: InstancedMesh } };
    const layer = t.vehicles as unknown as { batches: Map<string, Meshed>; blobs: Meshed };
    const m = new Matrix4();
    const placed = (mesh: InstancedMesh) =>
      Array.from({ length: mesh.visible ? mesh.count : 0 }, (_, i) => {
        mesh.getMatrixAt(i, m);
        const at = new Vector3().setFromMatrixPosition(m);
        return { at, view: Math.hypot(rig.dist, at.x - rig.tx, -at.z - rig.ty), long: new Vector3().setFromMatrixColumn(m, 0).length(), wide: new Vector3().setFromMatrixColumn(m, 2).length() };
      });
    const scooters = [...layer.batches].filter(([key]) => key === 'amb:scooter' || key === 'amb:scooterBox').flatMap(([, b]) => placed(b.batch.mesh));
    const tuks = [...layer.batches].filter(([key]) => key.startsWith('tuk')).flatMap(([, b]) => placed(b.batch.mesh));
    const blobs = placed(layer.blobs.batch.mesh);
    const sight = 370 * scale;
    const near = scooters.filter((s) => s.view < sight - 20);
    console.log(`street level at 10:00: ${scooters.length} scooters (${near.length} with riders in sight), ${tuks.length} tuk-tuks, ${blobs.length} rider blobs`);
    expect(near.length).toBeGreaterThan(0);
    expect(tuks.length).toBeGreaterThan(0);
    // One blob per scooter whose riders are drawn, and none for a tuk-tuk's riders.
    expect(blobs.length).toBeGreaterThanOrEqual(near.length);
    expect(blobs.length).toBeLessThanOrEqual(scooters.filter((s) => s.view < sight + 20).length);
    for (const s of near) expect(Math.min(...blobs.map((b) => b.at.distanceTo(s.at)))).toBeLessThan(0.2 * scale);
    for (const b of blobs) {
      // On the road under a scooter, stretched along it.
      expect(Math.min(...scooters.map((s) => b.at.distanceTo(s.at)))).toBeLessThan(0.2 * scale);
      expect(b.at.y).toBeCloseTo(ROAD_SURFACE_Y, 5);
      expect(b.long).toBeGreaterThan(b.wide);
      expect(b.wide).toBeGreaterThan(0.3 * scale);
    }
  });
});
