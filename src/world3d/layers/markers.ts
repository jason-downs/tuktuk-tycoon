// In-world markers: the ring under your tuk-tuk, the selection ring, the
// destination and pickup beacons, and the route ribbon on the road.

import { AdditiveBlending, BufferAttribute, BufferGeometry, CylinderGeometry, DoubleSide, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import { ARCHETYPES } from '../../content/archetypes';
import type { Pose } from '../../sim/graph';
import type { Vehicle } from '../../sim/types';
import type { FrameInfo, ViewContext, WorldLayer } from './types';

/** Seconds between rebuilds of an unchanged route ribbon (it shortens as you drive). */
const ROUTE_REBUILD_MS = 300;

export class MarkerLayer implements WorldLayer {
  readonly id = 'markers';
  private readonly ctx: ViewContext;
  private readonly playerRing: Mesh;
  private readonly selectRing: Mesh;
  private readonly beacon: Mesh;
  private readonly pickupBeacon: Mesh;
  private routeMesh: Mesh | null = null;
  private routeKey = '';
  private routeBuiltAt = 0;
  private readonly pose: Pose = { x: 0, y: 0, heading: 0 };

  constructor(ctx: ViewContext) {
    this.ctx = ctx;
    const { scene } = ctx;
    const ringGeo = new RingGeometry(2.4, 3.1, 32);
    ringGeo.rotateX(-Math.PI / 2);
    this.playerRing = new Mesh(ringGeo, new MeshBasicMaterial({ color: '#e0457b', transparent: true, opacity: 0.85, depthWrite: false }));
    this.playerRing.renderOrder = 5;
    scene.add(this.playerRing);
    this.selectRing = new Mesh(ringGeo, new MeshBasicMaterial({ color: '#3d6fb6', transparent: true, opacity: 0.85, depthWrite: false }));
    this.selectRing.visible = false;
    scene.add(this.selectRing);
    const beaconGeo = new CylinderGeometry(2.2, 2.2, 70, 16, 1, true);
    beaconGeo.translate(0, 35, 0);
    const beaconMat = (color: string) =>
      new MeshBasicMaterial({ color, transparent: true, opacity: 0.28, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    this.beacon = new Mesh(beaconGeo, beaconMat('#e0457b'));
    this.beacon.visible = false;
    scene.add(this.beacon);
    this.pickupBeacon = new Mesh(beaconGeo, beaconMat('#3aa35b'));
    this.pickupBeacon.visible = false;
    scene.add(this.pickupBeacon);
  }

  update(frame: FrameInfo): void {
    const { game } = this.ctx;
    const s = frame.ui;
    const player = game.playerVehicle();
    const scale = this.ctx.vehicleScale();
    const dist = this.ctx.rig.dist;
    // The rings sit under the vehicles' stand-ins, and hide while a vehicle has none (out of town).
    const pm = player ? this.ctx.vehicleMesh(player.id) : undefined;
    this.playerRing.visible = !!pm;
    if (pm) {
      this.playerRing.position.set(pm.position.x, 0.2, pm.position.z);
      this.playerRing.scale.setScalar(scale * (1 + Math.sin(frame.now / 300) * 0.06));
    }
    const sel = s.selectedVehicle !== null ? game.vehicle(s.selectedVehicle) : undefined;
    const sm = sel ? this.ctx.vehicleMesh(sel.id) : undefined;
    this.selectRing.visible = !!sm;
    if (sm) {
      this.selectRing.position.set(sm.position.x, 0.2, sm.position.z);
      this.selectRing.scale.setScalar(scale);
    }
    const g = game.world.graph;
    const dest = player?.task.kind === 'trip' ? game.place(player.task.trip.request.to) : null;
    this.beacon.visible = !!dest;
    if (dest) {
      this.beacon.position.set(g.nodeX[dest.node], 0, -g.nodeY[dest.node]);
      this.beacon.scale.set(scale, Math.max(1, dist / 300), scale);
    }
    const selReq = s.selectedRequest !== null ? game.state.requests.find((r) => r.id === s.selectedRequest) : undefined;
    this.pickupBeacon.visible = !!selReq;
    if (selReq) {
      const to = game.place(selReq.to);
      this.pickupBeacon.position.set(g.nodeX[to.node], 0, -g.nodeY[to.node]);
      (this.pickupBeacon.material as MeshBasicMaterial).color.set(ARCHETYPES[selReq.archetype].color);
      this.pickupBeacon.scale.set(scale, Math.max(1, dist / 300), scale);
    }
    this.syncRoute(frame.now, sel ?? player);
  }

  /** Ribbon along the remaining route of the player's (or the selected) tuk-tuk. */
  private syncRoute(now: number, v: Vehicle | undefined): void {
    const { game, scene } = this.ctx;
    const route = v?.route;
    const key = route && v ? `${v.id}:${route.target}:${route.arcs.length}:${v.routeIdx}` : '';
    if (key === this.routeKey && now - this.routeBuiltAt < ROUTE_REBUILD_MS) return;
    this.routeKey = key;
    this.routeBuiltAt = now;
    if (this.routeMesh) {
      scene.remove(this.routeMesh);
      this.routeMesh.geometry.dispose();
      (this.routeMesh.material as MeshBasicMaterial).dispose();
      this.routeMesh = null;
    }
    if (!route || !v) return;
    const g = game.world.graph;
    const pts: [number, number][] = [];
    const here = g.poseAt(v.arc, v.s, this.pose);
    pts.push([here.x, here.y]);
    for (let i = v.routeIdx; i < route.arcs.length; i++) {
      const arc = route.arcs[i];
      const e = g.edges[arc >> 1];
      const rev = (arc & 1) === 1;
      const n = e.pts.length / 2;
      for (let k = 0; k < n; k++) {
        const idx = rev ? n - 1 - k : k;
        const along = rev ? e.len - e.cum[idx] : e.cum[idx];
        if (i === v.routeIdx && along <= v.s) continue;
        const last = pts[pts.length - 1];
        const x = e.pts[2 * idx];
        const y = e.pts[2 * idx + 1];
        if (Math.hypot(x - last[0], y - last[1]) > 0.5) pts.push([x, y]);
      }
    }
    if (pts.length < 2) return;
    const half = Math.max(1.1, this.ctx.rig.dist * 0.004);
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l;
      const ny = dx / l;
      pos.push(pts[i][0] + nx * half, 0.25, -(pts[i][1] + ny * half), pts[i][0] - nx * half, 0.25, -(pts[i][1] - ny * half));
      if (i > 0) {
        const o = (i - 1) * 2;
        idx.push(o + 1, o + 3, o + 2, o + 1, o + 2, o);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setIndex(idx);
    const mat = new MeshBasicMaterial({
      color: v === game.playerVehicle() ? '#e0457b' : '#3d6fb6',
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.routeMesh = new Mesh(geo, mat);
    this.routeMesh.renderOrder = 4;
    scene.add(this.routeMesh);
  }

  dispose(): void {
    const { scene } = this.ctx;
    scene.remove(this.playerRing, this.selectRing, this.beacon, this.pickupBeacon);
    if (this.routeMesh) scene.remove(this.routeMesh);
  }
}
