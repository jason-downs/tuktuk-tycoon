// Traffic lights for the signalled approaches, driven by src/sim/signals.ts
// each frame. Each is a dark pole on the pavement beside the waiting traffic,
// or across the junction where the static city build found no room there
// (signalSpots.ts, build/anchors.ts), with an arm reaching over the lanes
// and a head facing the traffic: a back plate with one glowing lamp, high
// for red, in the middle for amber and low for green, and beside it a
// countdown box whose two red, amber or green digits show the seconds until
// the light changes. These are the only traffic lights in the 3D world.

import { BoxGeometry, CircleGeometry, Color, InstancedMesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, PlaneGeometry, type Matrix4 } from 'three';
import { arcLight, lightChangesIn, signalMap, type SignalLight } from '../../sim/signals';
import type { SignalSpot } from '../signalSpots';
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
/** Countdown box: width, height, depth (m), and the gap between it and the head's plate. */
const TIMER = [0.56, 0.44, 0.22] as const;
const TIMER_GAP = 0.08;
/** Countdown digits: centre spacing, segment length and thickness (m). */
const DIGIT_PITCH = 0.22;
const SEG_LEN = 0.13;
const SEG_T = 0.035;
/** Seven-segment layout per digit: centre offset (x, y) and whether the segment lies across. Order a–g. */
const SEGMENTS: readonly [number, number, boolean][] = [
  [0, 0.15, true],
  [0.075, 0.075, false],
  [0.075, -0.075, false],
  [0, -0.15, true],
  [-0.075, -0.075, false],
  [-0.075, 0.075, false],
  [0, 0, true],
];
/** Lit segments (bits a = 1 … g = 64) of the digits 0–9. */
const DIGIT_BITS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
/** Segments per head: two digits of seven. */
const SEGS = 14;
/** The lights are hidden when the camera is further than this (m); the digits, which cannot be read from afar, sooner. */
const HIDE_BEYOND = 1600;
const DIGITS_BEYOND = 600;
const COLOURS: Record<SignalLight, Color> = {
  red: new Color('#ff3b2f'),
  amber: new Color('#ffb21c'),
  green: new Color('#34e877'),
};
/** An unlit segment. */
const DARK_SEGMENT = new Color('#2a1714');

/** The countdown shown for a number of seconds: at most two digits. */
export function countdownDigits(seconds: number): [number, number] {
  const n = Math.max(0, Math.min(99, Math.ceil(seconds)));
  return [Math.floor(n / 10), n % 10];
}

/** Whether segment `seg` (0–6, a–g) of a digit is lit. */
export function segmentLit(digit: number, seg: number): boolean {
  return (DIGIT_BITS[digit] & (1 << seg)) !== 0;
}

export class SignalLayer implements WorldLayer {
  readonly id = 'signals';
  private readonly ctx: ViewContext;
  private readonly spots: readonly SignalSpot[];
  private readonly poles: InstancedMesh;
  private readonly arms: InstancedMesh;
  private readonly plates: InstancedMesh;
  private readonly lamps: InstancedMesh;
  private readonly timers: InstancedMesh;
  private readonly segments: InstancedMesh;
  private readonly shown: (SignalLight | null)[];
  /** Light and number each countdown shows, as light + ':' + number. */
  private readonly counted: string[];
  private readonly o = new Object3D();

  /** Draw a light at each spot (the approaches the city build placed; see signalSpots.ts). */
  constructor(ctx: ViewContext, spots: readonly SignalSpot[]) {
    this.ctx = ctx;
    this.spots = spots;
    const n = spots.length;
    const poleGeo = new BoxGeometry(0.2, POLE_TOP, 0.2);
    poleGeo.translate(0, POLE_TOP / 2, 0);
    // Unit length along local +X (from the pole towards the head), scaled per instance.
    const armGeo = new BoxGeometry(1, 0.12, 0.12);
    armGeo.translate(0.5, 0, 0);
    const lampGeo = new CircleGeometry(LAMP_R, 16);
    lampGeo.translate(0, 0, PLATE[2] / 2 + 0.02);
    const segGeo = new PlaneGeometry(1, 1);
    segGeo.translate(0, 0, TIMER[2] / 2 + 0.01);
    const steel = new MeshLambertMaterial({ color: '#3b3f42' });
    const housing = new MeshBasicMaterial({ color: '#1d1a17' });
    this.poles = new InstancedMesh(poleGeo, steel, Math.max(1, n));
    this.arms = new InstancedMesh(armGeo, steel, Math.max(1, n));
    this.plates = new InstancedMesh(new BoxGeometry(...PLATE), housing, Math.max(1, n));
    this.lamps = new InstancedMesh(lampGeo, new MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), Math.max(1, n));
    this.timers = new InstancedMesh(new BoxGeometry(...TIMER), housing, Math.max(1, n));
    this.segments = new InstancedMesh(segGeo, new MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), Math.max(1, n * SEGS));
    this.shown = new Array(n).fill(null);
    this.counted = new Array(n).fill('');
    spots.forEach((s, i) => {
      this.poles.setMatrixAt(i, this.facing(s, s.poleX, s.poleY, 0));
      this.arms.setMatrixAt(i, this.armMatrix(s));
      this.plates.setMatrixAt(i, this.facing(s, s.headX, s.headY, LAMP_HEIGHT));
      const tx = this.timerX(s);
      this.timers.setMatrixAt(i, this.facing(s, s.headX, s.headY, LAMP_HEIGHT, tx));
      for (let d = 0; d < 2; d++) {
        SEGMENTS.forEach(([sx, sy, across], k) => {
          const x = tx + (d === 0 ? -DIGIT_PITCH / 2 : DIGIT_PITCH / 2) + sx;
          this.segments.setMatrixAt(i * SEGS + d * 7 + k, this.facing(s, s.headX, s.headY, LAMP_HEIGHT + sy, x, across ? SEG_LEN : SEG_T, across ? SEG_T : SEG_LEN));
          this.segments.setColorAt(i * SEGS + d * 7 + k, DARK_SEGMENT);
        });
      }
      this.showLight(i, 'red');
    });
    for (const m of this.meshes()) {
      m.count = m === this.segments ? n * SEGS : n;
      m.frustumCulled = false;
    }
    ctx.scene.add(...this.meshes());
  }

  /** The approaches drawn, in instance order. */
  get approaches(): readonly SignalSpot[] {
    return this.spots;
  }

  private meshes(): InstancedMesh[] {
    return [this.poles, this.arms, this.plates, this.lamps, this.timers, this.segments];
  }

  /**
   * Local x (m, towards the traffic's right) of the countdown box's centre
   * from the head: beside the plate on the pole's side where the arm is long
   * enough, else on the far side.
   */
  private timerX(s: SignalSpot): number {
    const off = PLATE[0] / 2 + TIMER_GAP + TIMER[0] / 2;
    // The pole is on the traffic's left (local −x) for side +1, on its right for side −1.
    const towardsPole = -s.side;
    return s.arm >= off + TIMER[0] / 2 + 0.1 ? towardsPole * off : -towardsPole * off;
  }

  /**
   * Matrix for a part facing the approaching traffic (local +Z towards it,
   * +X to its right) at sim (x, y), height h, moved `lx` along local X and
   * scaled (sx, sy) across the face.
   */
  private facing(s: SignalSpot, x: number, y: number, h: number, lx = 0, sx = 1, sy = 1): Matrix4 {
    const o = this.o;
    const c = Math.cos(s.heading);
    const sn = Math.sin(s.heading);
    o.position.set(x + lx * sn, h, -(y - lx * c));
    o.rotation.set(0, Math.atan2(-c, sn), 0);
    o.scale.set(sx, sy, 1);
    o.updateMatrix();
    return o.matrix;
  }

  /** Matrix for the arm: from the top of the pole to over the head, local +X along it. */
  private armMatrix(s: SignalSpot): Matrix4 {
    const o = this.o;
    o.position.set(s.poleX, ARM_Y, -s.poleY);
    o.rotation.set(0, Math.atan2(s.headY - s.poleY, s.headX - s.poleX), 0);
    o.scale.set(s.arm, 1, 1);
    o.updateMatrix();
    return o.matrix;
  }

  private showLight(i: number, light: SignalLight): void {
    const s = this.spots[i];
    this.shown[i] = light;
    this.lamps.setMatrixAt(i, this.facing(s, s.headX, s.headY, LAMP_HEIGHT + LENS_Y[light]));
    this.lamps.setColorAt(i, COLOURS[light]);
  }

  private showCount(i: number, light: SignalLight, seconds: number): boolean {
    const digits = countdownDigits(seconds);
    const key = `${light}:${digits[0]}${digits[1]}`;
    if (key === this.counted[i]) return false;
    this.counted[i] = key;
    digits.forEach((digit, d) => {
      for (let k = 0; k < 7; k++) this.segments.setColorAt(i * SEGS + d * 7 + k, segmentLit(digit, k) ? COLOURS[light] : DARK_SEGMENT);
    });
    return true;
  }

  update(_frame: FrameInfo): void {
    const dist = this.ctx.rig.dist;
    const visible = this.spots.length > 0 && dist < HIDE_BEYOND;
    for (const m of this.meshes()) m.visible = visible;
    this.segments.visible = visible && dist < DIGITS_BEYOND;
    if (!visible) return;
    const game = this.ctx.game;
    const graph = game.world.graph;
    const map = signalMap(graph);
    const time = game.state.time;
    let lit = false;
    let counted = false;
    for (let i = 0; i < this.spots.length; i++) {
      const arc = this.spots[i].arc;
      const light = arcLight(game, arc, time) ?? 'red';
      if (light !== this.shown[i]) {
        this.showLight(i, light);
        lit = true;
      }
      if (!this.segments.visible) continue;
      const group = map.arcGroup[arc];
      const seconds = group < 0 ? 0 : lightChangesIn(map.junctions[map.junctionOf[graph.arcTo(arc)]], group, time);
      if (this.showCount(i, light, seconds)) counted = true;
    }
    if (lit) {
      this.lamps.instanceMatrix.needsUpdate = true;
      if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
    }
    if (counted && this.segments.instanceColor) this.segments.instanceColor.needsUpdate = true;
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
    (this.segments.material as MeshBasicMaterial).dispose();
  }
}
