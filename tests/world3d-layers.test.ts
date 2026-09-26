// Drives the vehicle, people and crowd layers headlessly (no WebGL): a real
// game on the real map, the real static city build, and a stub view context.
// Checks what each layer would draw and that nothing throws or goes NaN.

import { readFileSync } from 'node:fs';
import { Color, Fog, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, PerspectiveCamera, Scene, Vector3, type BufferGeometry, type Material } from 'three';
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
import { KERB_FLOATS } from '../src/world3d/build/anchors';
import { buildClearance, OB, PROP_BLOCK } from '../src/world3d/build/clearance';
import { festivalsAt } from '../src/world3d/env/festivals';
import { timeOfDay } from '../src/world3d/env/lighting';
import { moonIllumination, moonPhase, moonPosition, solarPosition } from '../src/world3d/env/sun';
import { edgeLanes, ROAD_SURFACE_Y } from '../src/world3d/kinematics';
import { CrowdLayer } from '../src/world3d/layers/crowds';
import type { EnvState } from '../src/world3d/layers/environment';
import { MarkerLayer } from '../src/world3d/layers/markers';
import { PeopleLayer } from '../src/world3d/layers/people';
import { ARM_Y, countdownDigits, LAMP_HEIGHT, segmentLit, SignalLayer } from '../src/world3d/layers/signals';
import { arcLight, lightChangesIn, signalMap, STOP_BEHIND_LINE_M } from '../src/sim/signals';
import { kerbPoint, PICKUP_RADIUS_M } from '../src/sim/manual';
import { simAnchors } from '../src/world3d/simAnchors';
import { unpackSpots } from '../src/world3d/signalSpots';
import { buildRoadNet } from '../src/world3d/build/junctions';
import { pointInRing } from '../src/world3d/build/shapes';
import type { ViewContext, WorldLayer } from '../src/world3d/layers/types';
import { VehicleLayer } from '../src/world3d/layers/vehicles';
import { personGeometry } from '../src/world3d/personModels';
import { tuktukGeometry } from '../src/world3d/vehicleModels';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));
const city = read<CityData>('city3d.json');
// Built with the simulation's anchors, as the view's worker does: traffic lights and waiting passengers settled against the city.
const built = tileCity(buildCity(city, simAnchors(world)));

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
      return { x: world.graph.nodeX[place.node] + 3, y: world.graph.nodeY[place.node], face: Math.PI };
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

describe('traffic lights', () => {
  const graph = world.graph;
  const map = signalMap(graph);
  const spots = unpackSpots(built.signals);
  const keep = city.keep.map((v) => v / 10) as [number, number, number, number];
  const net = buildRoadNet(city);
  // Everything a pole may not stand in: carriageways and junction surfaces as drawn, buildings, walls, water, rail.
  const clear = buildClearance(city, keep, () => false);
  for (const j of net.junctions) clear.addPoly(j.ring, OB.ROAD);
  const onRoad = (x: number, y: number) => {
    const near = net.nearest(x, y, 30);
    if (near && near.d < near.way.hw) return true;
    return net.junctions.some((j) => j.simple && Math.hypot(j.x - x, j.y - y) < 40 && pointInRing(x, y, j.ring));
  };
  /** Metres back from the junction node along an approach to the point of it nearest (x, y), and how far off it (x, y) lies. */
  const along = (arc: number, x: number, y: number) => {
    const e = graph.edges[arc >> 1];
    let off = Infinity;
    let s = 0;
    for (let k = 1; k < e.cum.length; k++) {
      const [ax, ay, bx, by] = [e.pts[2 * k - 2], e.pts[2 * k - 1], e.pts[2 * k], e.pts[2 * k + 1]];
      const l2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1e-9;
      const u = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2));
      const d = Math.hypot(ax + (bx - ax) * u - x, ay + (by - ay) * u - y);
      if (d < off) {
        off = d;
        s = e.cum[k - 1] + u * Math.sqrt(l2);
      }
    }
    return { back: arc & 1 ? s : e.len - s, off };
  };

  it('stands a light for every signalled approach where the city leaves room: off every road, building and other prop', () => {
    const n = map.approaches.length;
    expect(n).toBeGreaterThan(150);
    // The static city has no signal props of its own, so no second, unsynchronised set.
    expect(built.props.traffic_light).toBeUndefined();
    const arcs = spots.map((s) => s.arc);
    expect(new Set(arcs).size).toBe(arcs.length);
    for (const arc of arcs) expect(map.arcGroup[arc]).toBeGreaterThanOrEqual(0);
    console.log(`signals: ${spots.length} of ${n} approaches have a light, ${spots.filter((s) => s.far).length} across the junction`);
    expect(spots.length).toBe(n);
    let headOverRoad = 0;
    for (const s of spots) {
      expect(clear.hit(s.poleX, s.poleY, 0.25, PROP_BLOCK)).toBe(false);
      expect(Math.hypot(s.headX - s.poleX, s.headY - s.poleY)).toBeCloseTo(s.arm, 3);
      if (onRoad(s.headX, s.headY)) headOverRoad++;
    }
    expect(headOverRoad / spots.length).toBeGreaterThan(0.97);
    // No lamp, power pole, shelter, cart or market stall stands on a signal pole, and no two poles share a spot.
    // Reach (m) of a prop around its anchor: a bus shelter's roof, a stall's canopy (its size), a cart and its stools.
    const reach = (kind: string, size: number) => (kind === 'bus_shelter' ? 1.9 : kind.startsWith('fx_stall') ? size / 2 : kind === 'food_cart' ? 0.9 : 0.5);
    const crowded: string[] = [];
    for (const [kind, a] of Object.entries(built.props)) {
      if (kind.startsWith('walk')) continue;
      for (let i = 0; i < a.length; i += 4) {
        const r = reach(kind, a[i + 3]);
        for (const s of spots) if (Math.abs(a[i] - s.poleX) < r && Math.hypot(a[i] - s.poleX, a[i + 1] - s.poleY) < r) crowded.push(`${kind} at ${s.arc}`);
      }
    }
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) if (Math.hypot(spots[i].poleX - spots[j].poleX, spots[i].poleY - spots[j].poleY) < 0.5) crowded.push(`poles ${spots[i].arc}, ${spots[j].arc}`);
    }
    expect(crowded).toEqual([]);
  });

  it('hangs each near-side head over the front of the traffic waiting at the stop line, not behind the queue', () => {
    let near = 0;
    for (const s of spots) {
      if (s.far) continue;
      const { back, off } = along(s.arc, s.headX, s.headY);
      // Heads on the road behind a short approach project onto its far end; the approach itself holds the rest.
      if (off > 8 || back >= graph.arcLen(s.arc) - 0.01) continue;
      near++;
      const front = map.stopAt[s.arc] - STOP_BEHIND_LINE_M;
      expect(back - front).toBeLessThan(2.6);
    }
    expect(near).toBeGreaterThan(200);
  });

  it('shows each approach its light and a countdown to the change, and cleans up', () => {
    const t = setup(timeOf(2026, 10, 3, 10));
    const instanced = () => {
      const out: InstancedMesh[] = [];
      t.scene.traverse((o) => {
        if ((o as InstancedMesh).isInstancedMesh) out.push(o as InstancedMesh);
      });
      return out;
    };
    const before = new Set(instanced());
    const layer = new SignalLayer(t.ctx, spots);
    const n = spots.length;
    expect(layer.approaches.length).toBe(n);
    const meshes = instanced().filter((m) => !before.has(m));
    // Poles, arms, plates, lamps, countdown boxes and countdown segments.
    expect(meshes.length).toBe(6);
    expect(meshes.map((m) => m.count)).toEqual([n, n, n, n, n, n * 14]);
    expect(finiteMatrices(meshes)).toBe(true);
    // Each arm runs from the top of its pole to over the head, and each head faces back along the approach.
    const [, arms, , lampMesh, , segs] = meshes;
    const m = new Matrix4();
    for (let i = 0; i < n; i += 7) {
      const s = layer.approaches[i];
      arms.getMatrixAt(i, m);
      const start = new Vector3(0, 0, 0).applyMatrix4(m);
      const end = new Vector3(1, 0, 0).applyMatrix4(m);
      expect(Math.hypot(start.x - s.poleX, -start.z - s.poleY)).toBeLessThan(1e-3);
      expect(Math.hypot(end.x - s.headX, -end.z - s.headY)).toBeLessThan(1e-3);
      expect(end.y).toBeCloseTo(ARM_Y, 5);
      lampMesh.getMatrixAt(i, m);
      const facing = new Vector3(0, 0, 1).transformDirection(m);
      expect(facing.x * Math.cos(s.heading) - facing.z * Math.sin(s.heading)).toBeLessThan(-0.99);
    }
    expect(ARM_Y).toBeGreaterThan(LAMP_HEIGHT + 0.95);
    // The lit lamp shows each approach's current light: high on the plate for red, low for green.
    const colour = new Color();
    const lit = (i: number, d: number) =>
      Array.from({ length: 7 }, (_, k) => {
        segs.getColorAt(i * 14 + d * 7 + k, colour);
        return colour.r + colour.g > 0.5;
      });
    let seen = 0;
    for (let k = 0; k < 90 && seen < 2; k++) {
      t.game.state.time += 7;
      layer.update({ now: 0, dt: 1 / 60, hour: 10, ui: ui.get() });
      const lights = layer.approaches.map((s) => arcLight(t.game, s.arc) ?? 'red');
      const red = lights.indexOf('red');
      const green = lights.indexOf('green');
      if (red < 0 || green < 0) continue;
      const y = (i: number) => lampMesh.instanceMatrix.array[i * 16 + 13];
      expect(y(red)).toBeGreaterThan(LAMP_HEIGHT + 0.3);
      expect(y(green)).toBeLessThan(LAMP_HEIGHT - 0.3);
      // The countdown's digits read the seconds until the light changes.
      for (const i of [red, green]) {
        const arc = layer.approaches[i].arc;
        const j = map.junctions[map.junctionOf[graph.arcTo(arc)]];
        const digits = countdownDigits(lightChangesIn(j, map.arcGroup[arc], t.game.state.time));
        digits.forEach((digit, d) => expect(lit(i, d)).toEqual(Array.from({ length: 7 }, (_, seg) => segmentLit(digit, seg))));
      }
      seen++;
    }
    expect(seen).toBe(2);
    // Zoomed out, the lights hide.
    (t.ctx.rig as { dist: number }).dist = 5000;
    layer.update({ now: 0, dt: 1 / 60, hour: 10, ui: ui.get() });
    for (const mesh of meshes) expect(mesh.visible).toBe(false);
    layer.dispose();
    expect(instanced().filter((mesh) => !before.has(mesh)).length).toBe(0);
  });

  it('draws the digits 0 to 9 on seven segments and counts down whole seconds', () => {
    expect(countdownDigits(42.2)).toEqual([4, 3]);
    expect(countdownDigits(0)).toEqual([0, 0]);
    expect(countdownDigits(140)).toEqual([9, 9]);
    const lit = (d: number) => Array.from({ length: 7 }, (_, k) => segmentLit(d, k)).filter(Boolean).length;
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(lit)).toEqual([6, 2, 5, 5, 4, 5, 6, 3, 7, 6]);
  });
});

describe('waiting passengers', () => {
  it('stand where the city build settled them: clear of buildings, walls, water and carriageways', () => {
    const keep = city.keep.map((v) => v / 10) as [number, number, number, number];
    const blocks = buildClearance(city, keep, () => false);
    const net = buildRoadNet(city);
    for (const j of net.junctions) blocks.addPoly(j.ring, OB.ROAD);
    const inKeep = (x: number, y: number) => x > keep[0] && x < keep[2] && y > keep[1] && y < keep[3];
    let onMap = 0;
    let settled = 0;
    let moved = 0;
    let onRoad = 0;
    for (const place of world.places) {
      if (place.offmap) continue;
      const sim = kerbPoint({ world } as Game, place);
      if (!inKeep(sim.x, sim.y)) continue;
      onMap++;
      const k = place.idx * KERB_FLOATS;
      if (Number.isNaN(built.kerbs[k])) continue;
      settled++;
      const [x, y, face] = [built.kerbs[k], built.kerbs[k + 1], built.kerbs[k + 2]];
      expect(blocks.hit(x, y, 0.1, OB.BUILDING | OB.WALL | OB.BASTION | OB.WATER | OB.TRACK)).toBe(false);
      // Only where buildings cover every pavement nearby does a passenger wait at the edge of a road.
      if (blocks.hit(x, y, 0.15, OB.ROAD)) onRoad++;
      // Near enough the kerb point the pickup is judged from that a tuk-tuk drawn up beside the passenger can take them.
      expect(Math.hypot(x - sim.x, y - sim.y) + 4.5).toBeLessThan(PICKUP_RADIUS_M);
      const road = net.nearest(x, y, 12);
      expect(road).not.toBeNull();
      if (Math.hypot(x - sim.x, y - sim.y) > 0.01) moved++;
      expect(Number.isFinite(face)).toBe(true);
    }
    console.log(`waiting passengers: ${settled} of ${onMap} places settled, ${moved} moved off the simulation's kerb point, ${onRoad} at a road's edge`);
    expect(settled).toBe(onMap);
    expect(onRoad / settled).toBeLessThan(0.01);
    expect(moved).toBeGreaterThan(100);
  });
});
