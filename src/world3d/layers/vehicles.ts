// Fleet tuk-tuks and the rival/ambient traffic from the rivals system.

import { Mesh } from 'three';
import { RIVAL_KINDS, rivalsOf } from '../../sim/rivals';
import type { Pose } from '../../sim/graph';
import { carGeometry, motorbikeGeometry, songthaewGeometry, tuktukGeometry } from '../models';
import type { FrameInfo, ViewContext, WorldLayer } from './types';

/** Extra sideways pull towards the kerb for a parked tuk-tuk, metres. */
const KERB_PULL = 1.6;

export class VehicleLayer implements WorldLayer {
  readonly id = 'vehicles';
  private readonly ctx: ViewContext;
  private readonly fleet = new Map<number, Mesh>();
  private readonly fleetPaint = new Map<number, string>();
  private readonly rivals: Mesh[] = [];
  private readonly pose: Pose = { x: 0, y: 0, heading: 0 };

  constructor(ctx: ViewContext) {
    this.ctx = ctx;
  }

  meshOf(id: number): Mesh | undefined {
    return this.fleet.get(id);
  }

  update(_frame: FrameInfo): void {
    this.syncFleet();
    this.syncRivals();
  }

  private syncFleet(): void {
    const { game, scene, modelMat } = this.ctx;
    const seen = new Set<number>();
    const scale = this.ctx.vehicleScale();
    for (const v of game.state.vehicles) {
      seen.add(v.id);
      let mesh = this.fleet.get(v.id);
      if (!mesh || this.fleetPaint.get(v.id) !== v.paint) {
        if (mesh) scene.remove(mesh);
        mesh = new Mesh(tuktukGeometry(v.paint), modelMat);
        mesh.castShadow = true;
        this.fleet.set(v.id, mesh);
        this.fleetPaint.set(v.id, v.paint);
        scene.add(mesh);
      }
      this.ctx.placeVehicle(mesh, v.arc, v.s, scale);
      if (v.route === null && v.speed < 0.1) {
        const p = game.world.graph.poseAt(v.arc, v.s, this.pose);
        const off = this.ctx.laneOffset(v.arc) + KERB_PULL;
        mesh.position.set(p.x - Math.sin(p.heading) * off, 0, -(p.y + Math.cos(p.heading) * off));
      }
    }
    for (const [id, mesh] of this.fleet) {
      if (!seen.has(id)) {
        scene.remove(mesh);
        this.fleet.delete(id);
        this.fleetPaint.delete(id);
      }
    }
  }

  private syncRivals(): void {
    const { game, scene, modelMat } = this.ctx;
    const sys = rivalsOf(game);
    const n = sys?.count ?? 0;
    const scale = this.ctx.vehicleScale();
    for (let i = 0; i < Math.max(n, this.rivals.length); i++) {
      if (i >= n || !sys) {
        if (this.rivals[i]) this.rivals[i].visible = false;
        continue;
      }
      const kind = RIVAL_KINDS[sys.kind[i]];
      const want =
        kind === 'songthaew'
          ? songthaewGeometry()
          : kind === 'car'
            ? carGeometry(i)
            : kind === 'motorbike'
              ? motorbikeGeometry(i)
              : tuktukGeometry(i % 3 === 0 ? 'coop_taxi' : 'nakhon_blue');
      let mesh = this.rivals[i];
      if (!mesh) {
        mesh = new Mesh(want, modelMat);
        mesh.castShadow = true;
        this.rivals[i] = mesh;
        scene.add(mesh);
      } else if (mesh.geometry !== want) mesh.geometry = want;
      const route = sys.routes[i];
      if (route) {
        mesh.visible = true;
        this.ctx.placeVehicle(mesh, route.arcs[sys.idx[i]], sys.s[i], scale);
      } else {
        const pose = sys.poseOf(game, i, this.pose);
        mesh.visible = !!pose;
        if (pose) {
          mesh.position.set(pose.x, 0, -pose.y);
          mesh.rotation.set(0, pose.heading, 0);
          mesh.scale.setScalar(scale);
        }
      }
    }
  }

  dispose(): void {
    for (const m of this.fleet.values()) this.ctx.scene.remove(m);
    for (const m of this.rivals) this.ctx.scene.remove(m);
    this.fleet.clear();
  }
}
