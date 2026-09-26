// Traffic lights: a small glowing red, amber or green lamp on a dark back plate
// at the stop line of every signalled approach, on the kerb side, facing the
// traffic that waits there. Colours follow src/sim/signals.ts each frame.

import { BoxGeometry, CircleGeometry, Color, InstancedMesh, MeshBasicMaterial, Object3D } from 'three';
import { arcLight, signalMap, STOP_LINE_M, type SignalLight } from '../../sim/signals';
import type { FrameInfo, ViewContext, WorldLayer } from './types';

/** Lamp height above the road and distance beyond the lane centre towards the kerb, metres. */
const LAMP_HEIGHT = 4.4;
const KERB_OUT = 2.8;
/** The lights are hidden when the camera is further than this (m). */
const HIDE_BEYOND = 1600;
const COLOURS: Record<SignalLight, Color> = {
  red: new Color('#ff3b2f'),
  amber: new Color('#ffb21c'),
  green: new Color('#34e877'),
};

export class SignalLayer implements WorldLayer {
  readonly id = 'signals';
  private readonly ctx: ViewContext;
  private readonly arcs: number[];
  private readonly lamps: InstancedMesh;
  private readonly plates: InstancedMesh;
  private readonly shown: (SignalLight | null)[];

  constructor(ctx: ViewContext) {
    this.ctx = ctx;
    const graph = ctx.game.world.graph;
    this.arcs = signalMap(graph).approaches;
    const n = this.arcs.length;
    const lampGeo = new CircleGeometry(0.42, 16);
    lampGeo.translate(0, 0, 0.16);
    this.lamps = new InstancedMesh(lampGeo, new MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), Math.max(1, n));
    this.plates = new InstancedMesh(new BoxGeometry(0.75, 1.9, 0.28), new MeshBasicMaterial({ color: '#1d1a17' }), Math.max(1, n));
    this.lamps.count = n;
    this.plates.count = n;
    this.shown = new Array(n).fill(null);
    const o = new Object3D();
    this.arcs.forEach((arc, i) => {
      const len = graph.arcLen(arc);
      const p = graph.poseAt(arc, Math.max(0, len - STOP_LINE_M));
      const side = ctx.laneOffset(arc) + KERB_OUT;
      const x = p.x - Math.sin(p.heading) * side;
      const y = p.y + Math.cos(p.heading) * side;
      o.position.set(x, LAMP_HEIGHT, -y);
      // Face back along the approach, towards the waiting traffic.
      o.rotation.set(0, Math.atan2(-Math.cos(p.heading), Math.sin(p.heading)), 0);
      o.updateMatrix();
      this.lamps.setMatrixAt(i, o.matrix);
      this.plates.setMatrixAt(i, o.matrix);
      this.lamps.setColorAt(i, COLOURS.red);
    });
    this.lamps.frustumCulled = false;
    this.plates.frustumCulled = false;
    ctx.scene.add(this.plates, this.lamps);
  }

  update(_frame: FrameInfo): void {
    const visible = this.arcs.length > 0 && this.ctx.rig.dist < HIDE_BEYOND;
    this.lamps.visible = visible;
    this.plates.visible = visible;
    if (!visible) return;
    const game = this.ctx.game;
    let changed = false;
    for (let i = 0; i < this.arcs.length; i++) {
      const light = arcLight(game, this.arcs[i]) ?? 'red';
      if (light === this.shown[i]) continue;
      this.shown[i] = light;
      this.lamps.setColorAt(i, COLOURS[light]);
      changed = true;
    }
    if (changed && this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.ctx.scene.remove(this.plates, this.lamps);
    this.lamps.geometry.dispose();
    this.plates.geometry.dispose();
    (this.lamps.material as MeshBasicMaterial).dispose();
    (this.plates.material as MeshBasicMaterial).dispose();
  }
}
