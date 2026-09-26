// Traffic lights for every signalled approach, driven by src/sim/signals.ts
// each frame. Each is a dark pole on the pavement to the left of the waiting
// traffic, set back from the junction clear of the crossing carriageways,
// with an arm reaching over the lane and a head facing the traffic: a back
// plate with one glowing lamp, high for red, in the middle for amber and low
// for green. These are the only traffic lights in the 3D world.

import { BoxGeometry, CircleGeometry, Color, InstancedMesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, type Matrix4 } from 'three';
import type { RoadGraph } from '../../sim/graph';
import { arcLight, signalMap, STOP_LINE_M, type SignalLight } from '../../sim/signals';
import { edgeLanes } from '../kinematics';
import type { FrameInfo, ViewContext, WorldLayer } from './types';

/** Height (m) of the head's centre above the road. */
export const LAMP_HEIGHT = 4.4;
/** Back plate: width, height, depth (m). */
const PLATE = [0.75, 1.9, 0.28] as const;
/** Lamp radius (m) and its offset up the plate for each colour. */
const LAMP_R = 0.34;
const LENS_Y: Record<SignalLight, number> = { red: 0.55, amber: 0, green: -0.55 };
/** The arm runs just above the plate; the pole rises a little past it. */
export const ARM_Y = LAMP_HEIGHT + PLATE[1] / 2 + 0.07;
const POLE_TOP = ARM_Y + 0.15;
/** Pole distance beyond the kerb (m), on the pavement. */
export const POLE_KERB_OUT = 0.6;
/** Longest arm (m). */
const MAX_ARM = 4;
/** Farthest the pole is set back from the junction node (m). */
const MAX_BACK = 40;
/** Road classes the 3D roads draw with a pavement (junctions.ts); corners between others get a tight 1.2 m kerb radius. */
const HAS_PAVEMENT = (cls: number) => cls <= 4;
/** The lights are hidden when the camera is further than this (m). */
const HIDE_BEYOND = 1600;
const COLOURS: Record<SignalLight, Color> = {
  red: new Color('#ff3b2f'),
  amber: new Color('#ffb21c'),
  green: new Color('#34e877'),
};

/** Where one approach's signal stands (sim metres) and which way it faces. */
export interface SignalSpot {
  arc: number;
  /** Foot of the pole. */
  poleX: number;
  poleY: number;
  /** Centre of the head, under the end of the arm. */
  headX: number;
  headY: number;
  /** Heading (radians) of the approaching traffic; the head faces the opposite way. */
  heading: number;
  /** Arm length (m) from the pole to the head. */
  arm: number;
}

/** Distance (m) from (x, y) to an edge's centreline. */
function edgeDist(graph: RoadGraph, e: number, x: number, y: number): number {
  const p = graph.edges[e].pts;
  let d = Infinity;
  for (let k = 2; k < p.length; k += 2) {
    const ax = p[k - 2];
    const ay = p[k - 1];
    const dx = p[k] - ax;
    const dy = p[k + 1] - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1e-9)));
    d = Math.min(d, Math.hypot(ax + dx * t - x, ay + dy * t - y));
  }
  return d;
}

/**
 * Distance (m) back from a junction node along an arm at which its right-hand
 * kerb (looking out from the node) leaves the junction surface the 3D roads
 * draw: past the rounded kerb corner shared with the next arm clockwise
 * (junctions.ts junctionAt, with its fillet radii and angle limits).
 */
function cornerSetback(graph: RoadGraph, node: number, edge: number): number {
  const lanes = edgeLanes(graph);
  const out = (e: number) => {
    const ed = graph.edges[e];
    const arc = e * 2 + (ed.a === node ? 0 : 1);
    const p = graph.poseAt(arc, Math.min(ed.len, Math.max(3, lanes.half[e])));
    const l = Math.hypot(p.x - graph.nodeX[node], p.y - graph.nodeY[node]) || 1;
    return [(p.x - graph.nodeX[node]) / l, (p.y - graph.nodeY[node]) / l];
  };
  const arms = Array.from(graph.edgesAt(node)).filter((e) => !graph.edges[e].virtual);
  if (arms.length < 3) return 0;
  const [bx, by] = out(edge);
  // The neighbour clockwise from this arm, and the angle between them.
  let nb = -1;
  let phi = Infinity;
  for (const e of arms) {
    if (e === edge) continue;
    const [ax, ay] = out(e);
    let d = Math.atan2(by, bx) - Math.atan2(ay, ax);
    while (d <= 1e-9) d += Math.PI * 2;
    if (d < phi) {
      phi = d;
      nb = e;
    }
  }
  if (nb < 0) return 0;
  const [ax, ay] = out(nb);
  const sin = ax * by - ay * bx;
  if (phi > (175 * Math.PI) / 180 || sin < 1e-6) return 0;
  // Neighbour's left kerb line meets this arm's right kerb line s metres out.
  const ha = lanes.half[nb];
  const hb = lanes.half[edge];
  const dx = by * hb + ay * ha;
  const dy = -bx * hb - ax * ha;
  const s = Math.max(0, (dx * ay - dy * ax) / sin);
  if (phi < (15 * Math.PI) / 180) return Math.min(s, 12) + 0.3;
  const kerb = HAS_PAVEMENT(graph.edges[edge].cls) && HAS_PAVEMENT(graph.edges[nb].cls);
  const R = !kerb ? 1.2 : Math.min(graph.edges[edge].cls, graph.edges[nb].cls) <= 2 ? 6 : 4;
  return s + Math.min(R / Math.tan(phi / 2), 14) + 0.3;
}

/**
 * Pole and head positions for a signalled approach. The pole stands
 * POLE_KERB_OUT beyond the approach's left kerb, at the stop line or, where
 * the junction's rounded kerb corner reaches further, just beyond it, then
 * further back while it would stand on another road. The head hangs over the
 * approach's lane, at most MAX_ARM in from the pole.
 */
export function signalSpot(graph: RoadGraph, arc: number): SignalSpot {
  const lanes = edgeLanes(graph);
  const edge = arc >> 1;
  const node = graph.arcTo(arc);
  const len = graph.arcLen(arc);
  const pole = lanes.half[edge] + POLE_KERB_OUT;
  // Clearance (m) of a pole at (x, y) from every other carriageway; ≥ 0.3 is clear.
  const margin = (x: number, y: number): number => {
    let m = Infinity;
    for (const e of graph.edgesNear(x, y, 20)) {
      if (e !== edge && !graph.edges[e].virtual) m = Math.min(m, edgeDist(graph, e, x, y) - lanes.half[e]);
    }
    return m;
  };
  const at = (back: number) => {
    const p = graph.poseAt(arc, Math.max(0, len - back));
    const lx = -Math.sin(p.heading);
    const ly = Math.cos(p.heading);
    return { p, x: p.x + lx * pole, y: p.y + ly * pole, lx, ly };
  };
  // Traffic arrives against the arm's outward direction, so its left kerb is the arm's right-hand one.
  const first = Math.min(len, Math.max(STOP_LINE_M, cornerSetback(graph, node, edge)));
  let spot = at(first);
  let best = -Infinity;
  for (let back = first; back <= Math.min(len, MAX_BACK); back += 0.5) {
    const s = at(back);
    const m = margin(s.x, s.y);
    if (m > best) {
      best = m;
      spot = s;
    }
    if (m >= 0.3) break;
  }
  const head = Math.min(pole - 0.5, Math.max(lanes.lane[edge], pole - MAX_ARM));
  const { p, lx, ly } = spot;
  return {
    arc,
    poleX: spot.x,
    poleY: spot.y,
    headX: p.x + lx * head,
    headY: p.y + ly * head,
    heading: p.heading,
    arm: pole - head,
  };
}

export class SignalLayer implements WorldLayer {
  readonly id = 'signals';
  private readonly ctx: ViewContext;
  private readonly spots: SignalSpot[];
  private readonly poles: InstancedMesh;
  private readonly arms: InstancedMesh;
  private readonly plates: InstancedMesh;
  private readonly lamps: InstancedMesh;
  private readonly shown: (SignalLight | null)[];
  private readonly o = new Object3D();

  constructor(ctx: ViewContext) {
    this.ctx = ctx;
    const graph = ctx.game.world.graph;
    this.spots = signalMap(graph).approaches.map((arc) => signalSpot(graph, arc));
    const n = this.spots.length;
    const poleGeo = new BoxGeometry(0.2, POLE_TOP, 0.2);
    poleGeo.translate(0, POLE_TOP / 2, 0);
    // Unit length along local +X (towards the road centre), scaled per instance.
    const armGeo = new BoxGeometry(1, 0.12, 0.12);
    armGeo.translate(0.5, 0, 0);
    const lampGeo = new CircleGeometry(LAMP_R, 16);
    lampGeo.translate(0, 0, PLATE[2] / 2 + 0.02);
    const steel = new MeshLambertMaterial({ color: '#3b3f42' });
    this.poles = new InstancedMesh(poleGeo, steel, Math.max(1, n));
    this.arms = new InstancedMesh(armGeo, steel, Math.max(1, n));
    this.plates = new InstancedMesh(new BoxGeometry(...PLATE), new MeshBasicMaterial({ color: '#1d1a17' }), Math.max(1, n));
    this.lamps = new InstancedMesh(lampGeo, new MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), Math.max(1, n));
    this.shown = new Array(n).fill(null);
    this.spots.forEach((s, i) => {
      this.poles.setMatrixAt(i, this.place(s.poleX, 0, s.poleY, s.heading, 1));
      this.arms.setMatrixAt(i, this.place(s.poleX, ARM_Y, s.poleY, s.heading, s.arm));
      this.plates.setMatrixAt(i, this.place(s.headX, LAMP_HEIGHT, s.headY, s.heading, 1));
      this.showLight(i, 'red');
    });
    for (const m of this.meshes()) {
      m.count = n;
      m.frustumCulled = false;
    }
    ctx.scene.add(...this.meshes());
  }

  /** The approaches drawn, in instance order. */
  get approaches(): readonly SignalSpot[] {
    return this.spots;
  }

  private meshes(): InstancedMesh[] {
    return [this.poles, this.arms, this.plates, this.lamps];
  }

  /** Matrix for a part at sim (x, y), height h, facing back along `heading` (local +Z towards the traffic, +X towards the road centre), stretched `sx` along X. */
  private place(x: number, h: number, y: number, heading: number, sx: number): Matrix4 {
    const o = this.o;
    o.position.set(x, h, -y);
    o.rotation.set(0, Math.atan2(-Math.cos(heading), Math.sin(heading)), 0);
    o.scale.set(sx, 1, 1);
    o.updateMatrix();
    return o.matrix;
  }

  private showLight(i: number, light: SignalLight): void {
    const s = this.spots[i];
    this.shown[i] = light;
    this.lamps.setMatrixAt(i, this.place(s.headX, LAMP_HEIGHT + LENS_Y[light], s.headY, s.heading, 1));
    this.lamps.setColorAt(i, COLOURS[light]);
  }

  update(_frame: FrameInfo): void {
    const visible = this.spots.length > 0 && this.ctx.rig.dist < HIDE_BEYOND;
    for (const m of this.meshes()) m.visible = visible;
    if (!visible) return;
    const game = this.ctx.game;
    let changed = false;
    for (let i = 0; i < this.spots.length; i++) {
      const light = arcLight(game, this.spots[i].arc) ?? 'red';
      if (light === this.shown[i]) continue;
      this.showLight(i, light);
      changed = true;
    }
    if (!changed) return;
    this.lamps.instanceMatrix.needsUpdate = true;
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const m of this.meshes()) {
      this.ctx.scene.remove(m);
      m.geometry.dispose();
      m.dispose();
    }
    (this.poles.material as MeshLambertMaterial).dispose();
    (this.plates.material as MeshBasicMaterial).dispose();
    (this.lamps.material as MeshBasicMaterial).dispose();
  }
}
