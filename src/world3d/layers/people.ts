// Waiting passengers: figures at the kerb, dressed by archetype, who wave
// when your tuk-tuk comes near or when selected.

import { Group, Mesh, MeshLambertMaterial, type Material, type Object3D } from 'three';
import { ARCHETYPES } from '../../content/archetypes';
import { armGeometry, personGeometry } from '../models';
import type { FrameInfo, ViewContext, WorldLayer } from './types';

/** Distance (m) within which passengers start waving at your tuk-tuk. */
const WAVE_RADIUS = 90;

export class PeopleLayer implements WorldLayer {
  readonly id = 'people';
  private readonly ctx: ViewContext;
  private readonly people = new Map<number, { group: Group; arms: Object3D[] }>();

  constructor(ctx: ViewContext) {
    this.ctx = ctx;
  }

  update(frame: FrameInfo): void {
    const { game, scene, modelMat } = this.ctx;
    const player = game.playerVehicle();
    const pp = player ? game.vehiclePose(player) : null;
    const seen = new Set<number>();
    const scale = this.ctx.vehicleScale();
    for (const r of game.visibleRequests()) {
      if (r.claimedBy !== null && r.claimedBy !== player?.id) continue;
      seen.add(r.id);
      let entry = this.people.get(r.id);
      if (!entry) {
        const group = new Group();
        const arms: Object3D[] = [];
        for (let k = 0; k < r.party; k++) {
          const body = new Mesh(personGeometry(r.archetype, r.id + k), modelMat);
          body.castShadow = true;
          body.position.set(0, 0, (k - (r.party - 1) / 2) * 0.7);
          const arm = new Mesh(armGeometry(), new MeshLambertMaterial({ color: r.archetype === 'monk' ? '#e8871e' : ARCHETYPES[r.archetype].color }));
          arm.position.set(0, 1.38, 0.27);
          body.add(arm);
          arms.push(arm);
          group.add(body);
        }
        scene.add(group);
        entry = { group, arms };
        this.people.set(r.id, entry);
      }
      const k = this.ctx.kerbOf(r);
      entry.group.position.set(k.x, 0, -k.y);
      // Face the road node.
      const place = game.place(r.from);
      const g = game.world.graph;
      entry.group.rotation.y = Math.atan2(g.nodeY[place.node] - k.y, g.nodeX[place.node] - k.x) || 0;
      entry.group.scale.setScalar(scale);
      const near = pp ? Math.hypot(pp.x - k.x, pp.y - k.y) < WAVE_RADIUS : false;
      const waving = near || frame.ui.selectedRequest === r.id || this.ctx.hoverRequest === r.id;
      entry.arms.forEach((arm, i) => {
        arm.rotation.x = waving ? Math.PI * 0.85 + Math.sin(frame.now / 140 + i) * 0.35 : 0.1;
      });
    }
    for (const [id, entry] of this.people) {
      if (!seen.has(id)) this.remove(id, entry.group);
    }
  }

  private remove(id: number, group: Group): void {
    this.ctx.scene.remove(group);
    group.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && m.material !== this.ctx.modelMat) (m.material as Material).dispose();
    });
    this.people.delete(id);
  }

  dispose(): void {
    for (const [id, e] of [...this.people]) this.remove(id, e.group);
  }
}
