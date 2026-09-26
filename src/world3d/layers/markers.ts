// In-world markers: the ring under your tuk-tuk, the selection ring, the
// destination and pickup beacons, and the route ribbon on the road. The
// ribbon is one mesh and one material for the life of the layer: each rebuild
// rewrites its vertices in place, so its shader program is compiled once and
// its buffers are only reallocated when a longer route outgrows them.

import { AdditiveBlending, BufferAttribute, BufferGeometry, CylinderGeometry, DoubleSide, DynamicDrawUsage, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import { ARCHETYPES } from '../../content/archetypes';
import type { Pose } from '../../sim/graph';
import type { Vehicle } from '../../sim/types';
import type { FrameInfo, ViewContext, WorldLayer } from './types';

/** Milliseconds between rebuilds of an unchanged route ribbon (it shortens as you drive). */
const ROUTE_REBUILD_MS = 300;
/** Route points the ribbon's buffers hold at first; they double when a route needs more. */
const ROUTE_POINTS = 256;
const PLAYER_ROUTE = '#e0457b';
const SELECTED_ROUTE = '#3d6fb6';

export class MarkerLayer implements WorldLayer {
  readonly id = 'markers';
  private readonly ctx: ViewContext;
  private readonly playerRing: Mesh;
  private readonly selectRing: Mesh;
  private readonly beacon: Mesh;
  private readonly pickupBeacon: Mesh;
  private readonly routeMesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  /** Route points the ribbon's buffers have room for. */
  private routeCap = 0;
  /** Flat x, y list of the ribbon's centre line, reused between rebuilds. */
  private readonly routePts: number[] = [];
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
    const routeMat = new MeshBasicMaterial({
      color: PLAYER_ROUTE,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.routeMesh = new Mesh(this.routeGeometry(ROUTE_POINTS), routeMat);
    this.routeMesh.renderOrder = 4;
    // The ribbon's extent changes with every rebuild; it is drawn whenever it is shown.
    this.routeMesh.frustumCulled = false;
    this.routeMesh.visible = false;
    scene.add(this.routeMesh);
  }

  /** Ribbon geometry with room for `points` route points: a left and a right vertex per point, two triangles between points. */
  private routeGeometry(points: number): BufferGeometry {
    this.routeCap = points;
    const geo = new BufferGeometry();
    const pos = new BufferAttribute(new Float32Array(points * 6), 3);
    pos.setUsage(DynamicDrawUsage);
    geo.setAttribute('position', pos);
    const idx = new Uint32Array((points - 1) * 6);
    for (let i = 1; i < points; i++) idx.set([2 * i - 1, 2 * i + 1, 2 * i, 2 * i - 1, 2 * i, 2 * i - 2], (i - 1) * 6);
    geo.setIndex(new BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    return geo;
  }

  update(frame: FrameInfo): void {
    const { game } = this.ctx;
    const s = frame.ui;
    const player = game.playerVehicle();
    const scale = this.ctx.vehicleScale();
    const dist = this.ctx.rig.dist;
    if (player) {
      const m = this.ctx.vehicleMesh(player.id);
      if (m) this.playerRing.position.set(m.position.x, 0.2, m.position.z);
      this.playerRing.scale.setScalar(scale * (1 + Math.sin(frame.now / 300) * 0.06));
    }
    const sel = s.selectedVehicle !== null ? game.vehicle(s.selectedVehicle) : undefined;
    this.selectRing.visible = !!sel;
    if (sel) {
      const m = this.ctx.vehicleMesh(sel.id);
      if (m) this.selectRing.position.set(m.position.x, 0.2, m.position.z);
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
    const { game } = this.ctx;
    const route = v?.route;
    const key = route && v ? `${v.id}:${route.target}:${route.arcs.length}:${v.routeIdx}` : '';
    if (key === this.routeKey && now - this.routeBuiltAt < ROUTE_REBUILD_MS) return;
    this.routeKey = key;
    this.routeBuiltAt = now;
    const mesh = this.routeMesh;
    mesh.visible = false;
    if (!route || !v) return;
    const g = game.world.graph;
    const pts = this.routePts;
    pts.length = 0;
    const here = g.poseAt(v.arc, v.s, this.pose);
    pts.push(here.x, here.y);
    for (let i = v.routeIdx; i < route.arcs.length; i++) {
      const arc = route.arcs[i];
      const e = g.edges[arc >> 1];
      const rev = (arc & 1) === 1;
      const n = e.pts.length / 2;
      for (let k = 0; k < n; k++) {
        const idx = rev ? n - 1 - k : k;
        const along = rev ? e.len - e.cum[idx] : e.cum[idx];
        if (i === v.routeIdx && along <= v.s) continue;
        const x = e.pts[2 * idx];
        const y = e.pts[2 * idx + 1];
        if (Math.hypot(x - pts[pts.length - 2], y - pts[pts.length - 1]) > 0.5) pts.push(x, y);
      }
    }
    const count = pts.length / 2;
    if (count < 2) return;
    if (count > this.routeCap) {
      let cap = this.routeCap;
      while (cap < count) cap *= 2;
      mesh.geometry.dispose();
      mesh.geometry = this.routeGeometry(cap);
    }
    const attr = mesh.geometry.getAttribute('position') as BufferAttribute;
    const pos = attr.array as Float32Array;
    const half = Math.max(1.1, this.ctx.rig.dist * 0.004);
    for (let i = 0; i < count; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(count - 1, i + 1);
      const dx = pts[2 * b] - pts[2 * a];
      const dy = pts[2 * b + 1] - pts[2 * a + 1];
      const l = Math.hypot(dx, dy) || 1;
      const nx = (-dy / l) * half;
      const ny = (dx / l) * half;
      const x = pts[2 * i];
      const y = pts[2 * i + 1];
      const o = i * 6;
      pos[o] = x + nx;
      pos[o + 1] = 0.25;
      pos[o + 2] = -(y + ny);
      pos[o + 3] = x - nx;
      pos[o + 4] = 0.25;
      pos[o + 5] = -(y - ny);
    }
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, count * 6);
    attr.needsUpdate = true;
    mesh.geometry.setDrawRange(0, (count - 1) * 6);
    mesh.material.color.set(v === game.playerVehicle() ? PLAYER_ROUTE : SELECTED_ROUTE);
    mesh.visible = true;
  }

  dispose(): void {
    const { scene } = this.ctx;
    scene.remove(this.playerRing, this.selectRing, this.beacon, this.pickupBeacon, this.routeMesh);
    // The two rings share a geometry, as do the two beacons.
    this.playerRing.geometry.dispose();
    this.beacon.geometry.dispose();
    this.routeMesh.geometry.dispose();
    for (const m of [this.playerRing, this.selectRing, this.beacon, this.pickupBeacon, this.routeMesh]) (m.material as MeshBasicMaterial).dispose();
  }
}
