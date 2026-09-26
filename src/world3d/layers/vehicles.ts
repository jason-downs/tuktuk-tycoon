// Fleet tuk-tuks, the rivals system's traffic (songthaews, rival tuk-tuks,
// cars, motorbikes) and cosmetic street traffic, drawn instanced: one batch
// per model, with drivers, passengers and riders as instanced people and
// headlight pools on the road at night. Poses come from kinematics.ts (lanes,
// smoothed corners, roll, pitch, wheel spin, kerbside queues). Each fleet
// vehicle also has an empty Object3D that follows its rendered pose, for the
// HUD, markers, picking and anything attached to it.

import { Color, Group, InstancedMesh, Matrix4, Quaternion, Vector3, type MeshBasicMaterial, type Object3D } from 'three';
import { PAINTS } from '../../content/paints';
import { VEHICLE_MODELS } from '../../content/vehicles';
import { RIVAL_KINDS, rivalsOf } from '../../sim/rivals';
import { lightPoolMaterial, PersonBatch, personMaterials, VehicleBatch, vehicleMaterial } from '../batches';
import { hash01 } from '../build/mesh';
import { lookEnvAt } from '../crowd';
import { edgeLanes, kerbOffset, newKinState, ROAD_SURFACE_Y, spreadParked, stepKinematics, type KinState, type ParkItem, type PathRef } from '../kinematics';
import { ANIM, packHex, personGeometry, personLook, posePerson, POSE_SIZE, seatedLook, SIT_HIP_Y, type LookEnv, type PersonType } from '../personModels';
import { CosmeticTraffic, trafficLevel } from '../traffic';
import {
  AMBIENT_HALF_WIDTH,
  AMBIENT_WHEEL_R,
  ambientGeometry,
  ambientPaint,
  headlightConeGeometry,
  LIVERY_EXTRA,
  SCOOTER_SEATS,
  TUK_WHEEL_R,
  tukAccessoryGeometry,
  tukKindOf,
  tukSeats,
  tuktukGeometry,
  type AmbientKind,
  type TukAccessory,
  type TukExtra,
  type TukKind,
} from '../vehicleModels';
import { partySeed, partyShare } from './people';
import type { FrameInfo, ViewContext, WorldLayer } from './types';

/** Camera distance (m) beyond which tuk-tuks use the simple model and extras are dropped. */
const LOD_DIST = 900;
/** Camera distance (m) beyond which riders and passengers are not drawn. */
const RIDERS_DIST = 1400;
/** Camera distance (m) beyond which the cosmetic traffic is cleared. */
const TRAFFIC_DIST = 1200;
/** [est] Cosmetic vehicles around the camera at the busiest hours. */
const TRAFFIC_MAX = 48;
/** Gap between queued vehicles at a rank (m, before scaling). */
const QUEUE_GAP = 0.8;

const TUK_LEN: Record<TukKind, number> = { lpg: 3.2, rusty: 3.2, ev: 3.2, ev7: 4.0 };
const AMBIENT_LEN: Record<AmbientKind, number> = { songthaew: 5.3, scooter: 1.9, scooterBox: 1.9, sedan: 4.5, pickup: 5.2, van: 5.0, taxi: 4.5 };
/** The rusty model's paint is faded a quarter of the way to this grey. */
const RUST_GREY = 0x8a8a86;
/** Length of the headlight pool relative to a car's. */
const CONE_SIZE: Record<string, number> = { tuk: 0.8, scooter: 0.55, scooterBox: 0.55 };

interface Rider {
  type: PersonType;
  seed: number;
  share?: number;
  anim: number;
  /** Hip point in model units (x, seat height, z). */
  at: readonly number[];
}

interface Drawn {
  key: number;
  ref: PathRef;
  parked: boolean;
  len: number;
  halfWidth: number;
  /** 0 keeps to the lane; towards 1 hugs the kerb (scooters). */
  kerbward: number;
  geo: string;
  accessories: TukAccessory[];
  tuk: TukKind | null;
  paint: [number, number, number];
  wheelR: number;
  lpg: boolean;
  engineOn: boolean;
  lights: boolean;
  /** Lit roof sign level 0–1, and LED / lantern level 0–1 (before night). */
  sign: number;
  led: number;
  speed?: number;
  riders: Rider[];
  fleetId: number;
}

const _m = new Matrix4();
const _seat = new Matrix4();
const _size = new Matrix4();
const _cone = new Matrix4();
const _q = new Quaternion();
const _up = new Vector3(0, 1, 0);
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();

/** Blend two packed sRGB colours. */
function mixPacked(a: number, b: number, t: number): number {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const ca = (a >> shift) & 255;
    const cb = (b >> shift) & 255;
    out |= Math.round(ca + (cb - ca) * t) << shift;
  }
  return out;
}

/** Livery colours as packed sRGB, body faded for the rusty model. */
function tukPaint(paintId: string, kind: TukKind): [number, number, number] {
  const p = PAINTS[paintId] ?? PAINTS.nakhon_blue;
  const body = packHex(p.body);
  return [kind === 'rusty' ? mixPacked(body, RUST_GREY, 0.25) : body, packHex(p.canopy), packHex(p.trim)];
}

/** Seats taken by a party: the middle for one (a monk takes the far, right-hand end), the ends for two, then fill. */
function seatOrder(n: number, monk: boolean): number[] {
  if (n === 1) return [monk ? 2 : 1];
  if (n === 2) return [0, 2];
  return Array.from({ length: n }, (_, i) => i);
}

export class VehicleLayer implements WorldLayer {
  readonly id = 'vehicles';
  private readonly ctx: ViewContext;
  private readonly material = vehicleMaterial();
  private readonly clearMaterial = vehicleMaterial({ transparent: true });
  private readonly batches = new Map<string, VehicleBatch>();
  private readonly people: PersonBatch;
  private readonly cones: InstancedMesh;
  private readonly kin = new Map<number, KinState>();
  private readonly proxies = new Map<number, Group>();
  private readonly shifts = new Map<number, number>();
  private readonly pose = new Float32Array(POSE_SIZE);
  private traffic: CosmeticTraffic | null = null;
  private lastTime = -1;
  private frameNo = 0;
  // Lateral offset parameters for the next kinematics step (see lateral()).
  private latKerbward = 0;
  private latHalfWidth = 0.7;
  private lanes: ReturnType<typeof edgeLanes> | null = null;
  private readonly lateral = (arc: number): number => {
    const lanes = (this.lanes ??= edgeLanes(this.ctx.game.world.graph));
    const e = arc >> 1;
    const lane = lanes.lane[e];
    return lane + (kerbOffset(lane, lanes.half[e], this.latHalfWidth) - lane) * this.latKerbward;
  };

  constructor(ctx: ViewContext) {
    this.ctx = ctx;
    this.people = new PersonBatch(ctx.scene, personGeometry(), personMaterials(), 128);
    this.cones = new InstancedMesh(headlightConeGeometry(), lightPoolMaterial(), 256);
    this.cones.frustumCulled = false;
    this.cones.count = 0;
    this.cones.renderOrder = 3;
    ctx.scene.add(this.cones);
  }

  /** The object that follows a fleet vehicle's rendered pose. */
  meshOf(id: number): Object3D | undefined {
    return this.proxies.get(id);
  }

  update(frame: FrameInfo): void {
    const { game, rig } = this.ctx;
    const time = game.state.time;
    const dtGame = this.lastTime < 0 ? 0 : Math.max(0, Math.min(3600, time - this.lastTime));
    this.lastTime = time;
    this.frameNo++;
    // The environment's darkness: the real sun for the date, and dark storms.
    const night = this.ctx.envState().night;
    const env = lookEnvAt(game);
    const scale = this.ctx.vehicleScale();
    const lod: 0 | 1 = rig.dist > LOD_DIST ? 1 : 0;

    const items: Drawn[] = [];
    this.collectFleet(items, env.rain === true);
    this.collectRivals(items, time);
    this.collectTraffic(items, frame.hour, dtGame, scale);

    // Stopped vehicles on the same arc queue nose to tail along the kerb.
    const park: ParkItem[] = [];
    for (const it of items) if (it.parked) park.push({ key: it.key, arc: it.ref.arc, s: it.ref.s, len: it.len * scale });
    this.shifts.clear();
    spreadParked(park, QUEUE_GAP * scale, this.shifts);

    for (const b of this.batches.values()) b.begin();
    this.people.begin();
    let cones = 0;
    const graph = game.world.graph;
    const showRiders = rig.dist < RIDERS_DIST;
    const now = frame.now / 1000;
    for (const it of items) {
      let st = this.kin.get(it.key);
      if (!st) this.kin.set(it.key, (st = newKinState(hash01(it.key, 5) * Math.PI * 2)));
      st.seen = this.frameNo;
      this.latKerbward = it.parked ? 1 : it.kerbward;
      this.latHalfWidth = it.halfWidth * scale;
      stepKinematics(graph, st, it.ref, this.lateral, it.parked ? (this.shifts.get(it.key) ?? 0) : 0, {
        dtGame,
        dtReal: frame.dt,
        now,
        wheelR: it.wheelR,
        scale,
        lpg: it.lpg,
        engineOn: it.engineOn,
        speed: it.speed,
      });
      _q.setFromAxisAngle(_up, st.yaw);
      _p.set(st.x, ROAD_SURFACE_Y, -st.y);
      _s.setScalar(scale);
      _m.compose(_p, _q, _s);
      const lit = it.lights && night > 0.25;
      const light = [lit ? 1 : 0, Math.max(lit ? 0.35 : 0, st.brake), it.sign * (0.3 + 0.7 * night), it.led * night];
      const motion = [st.spin, st.roll, st.pitch, st.heave];
      const geoKey = it.tuk && lod ? `tuk-lod1:${it.tuk}` : it.geo;
      this.batch(geoKey, it).add(_m, it.paint, motion, light);
      if (!lod) for (const acc of it.accessories) this.batch(`acc:${acc}:${it.tuk}`, it, acc).add(_m, it.paint, motion, light);
      if (lit && cones < 256) {
        const k = CONE_SIZE[it.tuk ? 'tuk' : it.geo.slice(4)] ?? 1;
        this.cones.setMatrixAt(cones, _cone.copy(_m).multiply(_size.makeScale(k, 1, k)));
        this.cones.setColorAt(cones, _c.setRGB(0.42, 0.36, 0.24).multiplyScalar(Math.min(1, (night - 0.25) * 2)));
        cones++;
      }
      if (showRiders) this.placeRiders(it, env, now);
      if (it.fleetId >= 0) this.syncProxy(it.fleetId, st, scale);
    }
    for (const b of this.batches.values()) b.flush();
    this.people.flush();
    this.cones.count = cones;
    this.cones.visible = cones > 0;
    if (cones) {
      this.cones.instanceMatrix.needsUpdate = true;
      if (this.cones.instanceColor) this.cones.instanceColor.needsUpdate = true;
    }
    for (const [key, st] of this.kin) if (st.seen !== this.frameNo) this.kin.delete(key);
    for (const [id, g] of this.proxies) {
      if (!game.vehicle(id)) {
        this.ctx.scene.remove(g);
        this.proxies.delete(id);
      }
    }
  }

  // ------------------------------------------------------------ sources

  private collectFleet(items: Drawn[], rain: boolean): void {
    const { game } = this.ctx;
    for (const v of game.state.vehicles) {
      // Out of town beyond a portal: not on the map.
      if (v.task.kind === 'away') continue;
      const model = VEHICLE_MODELS[v.model];
      const tuk = tukKindOf(v.model, model?.powertrain);
      const extra: TukExtra = LIVERY_EXTRA[v.paint] ?? 'none';
      const accessories: TukAccessory[] = [];
      if (v.upgrades.includes('malai')) accessories.push('garland');
      if (v.upgrades.includes('led')) accessories.push('party');
      if (rain) accessories.push('curtains');
      const driver = v.driverId !== null;
      const onDuty = driver && v.task.kind !== 'offduty' && v.task.kind !== 'broken';
      const parked = v.route === null && v.speed < 0.1;
      const riders: Rider[] = [];
      const seats = tukSeats(tuk);
      if (driver) riders.push({ type: 'driver', seed: v.driverId! * 31 + 7, anim: ANIM.drive, at: seats.driver });
      if (v.task.kind === 'trip') {
        const req = v.task.trip.request;
        const n = Math.min(req.party, seats.seats.length);
        const share = partyShare(req.archetype, req.id);
        seatOrder(n, req.archetype === 'monk').forEach((seat, k) => riders.push({ type: req.archetype, seed: partySeed(req.id, k), share, anim: ANIM.sit, at: seats.seats[seat] }));
      }
      items.push({
        key: v.id,
        ref: { arcs: v.route ? v.route.arcs : null, idx: v.route ? v.routeIdx : 0, arc: v.arc, s: v.s, prev: -1 },
        parked,
        len: TUK_LEN[tuk],
        halfWidth: 0.72,
        kerbward: 0,
        geo: `tuk:${tuk}:${extra}`,
        accessories,
        tuk,
        paint: tukPaint(v.paint, tuk),
        wheelR: TUK_WHEEL_R,
        lpg: model?.powertrain !== 'ev',
        engineOn: onDuty && !(parked && v.task.kind === 'idle'),
        lights: onDuty && !(parked && v.task.kind === 'idle'),
        sign: onDuty ? 1 : 0.15,
        led: extra === 'ledStrips' || extra === 'lanterns' || v.upgrades.includes('led') ? (onDuty ? 1.2 : 0) : 0,
        speed: v.speed,
        riders,
        fleetId: v.id,
      });
    }
  }

  private collectRivals(items: Drawn[], time: number): void {
    const sys = rivalsOf(this.ctx.game);
    if (!sys) return;
    for (let i = 0; i < sys.count; i++) {
      const route = sys.routes[i];
      let ref: PathRef;
      let parked: boolean;
      if (route) {
        ref = { arcs: route.arcs, idx: sys.idx[i], arc: route.arcs[sys.idx[i]], s: sys.s[i], prev: -1 };
        parked = time < sys.pauseUntil[i];
      } else if (sys.parkArc[i] >= 0) {
        ref = { arcs: null, idx: 0, arc: sys.parkArc[i], s: sys.parkS[i], prev: -1 };
        parked = true;
      } else continue;
      const kind = RIVAL_KINDS[sys.kind[i]];
      const u = hash01(i * 17 + sys.kind[i], 3);
      const busy = time < sys.busyUntil[i];
      const base = { key: -1000 - i, ref, parked, accessories: [] as TukAccessory[], lights: true, fleetId: -1, riders: [] as Rider[] };
      if (kind === 'tuktuk') {
        const tuk: TukKind = u < 0.7 ? 'lpg' : u < 0.9 ? 'rusty' : 'ev';
        const paint = tuk === 'ev' ? 'ev_green' : hash01(i, 4) < 0.85 ? 'nakhon_blue' : 'coop_taxi';
        const extra = LIVERY_EXTRA[paint] ?? 'none';
        const seats = tukSeats(tuk);
        base.riders.push({ type: 'driver', seed: 5000 + i, anim: ANIM.drive, at: seats.driver });
        if (busy) {
          const n = hash01(i, 6) < 0.5 ? 1 : 2;
          const type: PersonType = (['tourist_west', 'tourist_cn', 'backpacker', 'tourist_kr', 'thai_tourist'] as const)[Math.floor(hash01(i, 7) * 5)];
          seatOrder(n, false).forEach((seat, k) => base.riders.push({ type, seed: 7000 + i * 3 + k, share: 7000 + i, anim: ANIM.sit, at: seats.seats[seat] }));
        }
        items.push({ ...base, len: TUK_LEN[tuk], halfWidth: 0.72, kerbward: 0, geo: `tuk:${tuk}:${extra}`, tuk, paint: tukPaint(paint, tuk), wheelR: TUK_WHEEL_R, lpg: tuk !== 'ev', engineOn: true, sign: 1, led: 0 });
        continue;
      }
      const amb: AmbientKind =
        kind === 'songthaew' ? 'songthaew' : kind === 'motorbike' ? (u < 0.9 ? 'scooter' : 'scooterBox') : u < 0.45 ? 'sedan' : u < 0.8 ? 'pickup' : u < 0.92 ? 'van' : 'taxi';
      if (kind === 'motorbike') this.scooterRiders(base.riders, 9000 + i * 2, amb === 'scooterBox');
      items.push({ ...base, ...this.ambientLook(amb, hash01(i, 8)), engineOn: true, kerbward: kind === 'motorbike' ? 0.5 + u * 0.3 : 0 });
    }
  }

  private collectTraffic(items: Drawn[], hour: number, dtGame: number, scale: number): void {
    const { game, rig } = this.ctx;
    const graph = game.world.graph;
    if (rig.dist > TRAFFIC_DIST) {
      if (this.traffic) this.traffic.agents.length = 0;
      return;
    }
    this.traffic ??= new CosmeticTraffic(graph, game.state.seed | 1);
    this.traffic.update({
      x: rig.tx,
      y: rig.ty,
      radius: Math.min(900, Math.max(250, rig.dist * 1.8)),
      target: Math.round(TRAFFIC_MAX * trafficLevel(hour)),
      dt: dtGame,
      speedOf: (e) => graph.speedOf(e) * game.speedFactor(graph.edges[e].cls),
      scale,
    });
    for (const a of this.traffic.agents) {
      const riders: Rider[] = [];
      if (a.kind === 'scooter' || a.kind === 'scooterBox') this.scooterRiders(riders, a.seed, a.kind === 'scooterBox');
      items.push({
        key: -100_000 - a.id,
        ref: { arcs: a.next >= 0 ? [a.arc, a.next] : null, idx: 0, arc: a.arc, s: a.s, prev: a.prev },
        parked: false,
        accessories: [],
        lights: true,
        fleetId: -1,
        riders,
        ...this.ambientLook(a.kind, hash01(a.seed, 1)),
        engineOn: true,
        kerbward: a.kind === 'scooter' || a.kind === 'scooterBox' ? 0.45 + hash01(a.seed, 2) * 0.4 : 0,
      });
    }
  }

  private ambientLook(kind: AmbientKind, u: number) {
    const [body, canopy, trim] = ambientPaint(kind, u);
    return {
      len: AMBIENT_LEN[kind],
      halfWidth: AMBIENT_HALF_WIDTH[kind],
      kerbward: 0,
      geo: `amb:${kind}`,
      tuk: null,
      paint: [packHex(body), packHex(canopy), packHex(trim)] as [number, number, number],
      wheelR: AMBIENT_WHEEL_R[kind],
      lpg: false,
      sign: kind === 'taxi' ? 1 : 0,
      led: 0,
    };
  }

  /** A rider in a helmet (mostly), and sometimes a pillion passenger (not behind a delivery box). */
  private scooterRiders(out: Rider[], seed: number, delivery: boolean): void {
    out.push({ type: 'rider', seed, anim: ANIM.ride, at: SCOOTER_SEATS[0] });
    if (!delivery && hash01(seed, 3) < 0.3) out.push({ type: hash01(seed, 4) < 0.5 ? 'rider' : 'local', seed: seed + 1, anim: ANIM.pillion, at: SCOOTER_SEATS[1] });
  }

  // ------------------------------------------------------------ drawing

  private batch(key: string, it: Drawn, acc?: TukAccessory): VehicleBatch {
    let b = this.batches.get(key);
    if (!b) {
      const tuk = it.tuk ?? 'lpg';
      const geo = acc
        ? tukAccessoryGeometry(acc, tuk)
        : key.startsWith('tuk-lod1:')
          ? tuktukGeometry(tuk, 'none', 1)
          : it.tuk
            ? tuktukGeometry(tuk, key.split(':')[2] as TukExtra)
            : ambientGeometry(key.slice(4) as AmbientKind);
      b = new VehicleBatch(this.ctx.scene, geo, acc === 'curtains' ? this.clearMaterial : this.material, acc !== 'curtains');
      this.batches.set(key, b);
    }
    return b;
  }

  /** Seated figures in the vehicle's frame: the matrix _m holds the vehicle transform. */
  private placeRiders(it: Drawn, env: LookEnv, now: number): void {
    for (const r of it.riders) {
      const look = seatedLook(personLook(r.type, r.seed, env, r.share));
      const ps = look.scale;
      _seat.makeTranslation(r.at[0], r.at[1] - SIT_HIP_Y * ps, r.at[2]);
      if (ps !== 1) _seat.multiply(_size.makeScale(ps, ps, ps));
      _seat.premultiply(_m);
      posePerson(r.anim, now, hash01(r.seed, 9) * 6.28, look, this.pose);
      this.people.add(_seat, look, this.pose);
    }
  }

  private syncProxy(id: number, st: KinState, scale: number): void {
    let g = this.proxies.get(id);
    if (!g) {
      g = new Group();
      g.name = `vehicle-${id}`;
      this.proxies.set(id, g);
      this.ctx.scene.add(g);
    }
    g.position.set(st.x, ROAD_SURFACE_Y, -st.y);
    g.rotation.set(0, st.yaw, 0);
    g.scale.setScalar(scale);
  }

  dispose(): void {
    const { scene } = this.ctx;
    for (const b of this.batches.values()) b.dispose();
    this.batches.clear();
    this.people.dispose();
    scene.remove(this.cones);
    (this.cones.material as MeshBasicMaterial).dispose();
    for (const g of this.proxies.values()) scene.remove(g);
    this.proxies.clear();
    this.material.dispose();
    this.clearMaterial.dispose();
  }
}
