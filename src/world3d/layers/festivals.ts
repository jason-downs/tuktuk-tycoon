// Festival and market set dressing, built from the fx_* anchors of the city
// build (src/world3d/build/effects.ts) the first time each is needed and shown
// only while the calendar says so (src/world3d/env/festivals.ts):
// - Yi Peng: strings of khom khwaen lanterns swaying over the streets and
//   causeways, glowing at night; clay-lamp candles on temple walls; krathongs
//   drifting down the Ping with their candles reflected on the water.
// - Chinese New Year: bigger red lanterns around Warorot.
// - Walking streets and the Night Bazaar: rows of stalls with bulb strings.

import {
  Color,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { FX } from '../build/effects';
import { hash01 } from '../build/mesh';
import { WATER_LEVEL } from '../build/water';
import type { FestivalState } from '../env/festivals';
import { krathongGeometry, lanternGeometry, stallBaseGeometry, stallCanopyGeometry } from '../festivalModels';
import { GlowSprites, LightPools, lineGeometry, type GlowFrame } from './glow';
import { linearRGB } from './nightLights';

/** Where a krathong floats: 1 cm above the Ping's surface, which is sunk below the street (the fx_river path lies on it). */
const RIVER_WATER_Y = WATER_LEVEL.river + 0.01;
/** Lantern strings: anchored at 6.3 m, sagging 0.55 m mid-span; a lantern every 1.5 m (world.md §3.5). */
const STRING_HEIGHT = 6.3;
const STRING_SAG = 0.55;
const LANTERN_SPACING = 1.5;

/** Khom khwaen colours: red, yellow, white, blue, orange (culture.md §10). */
const YI_PENG_COLOURS = ['#d8342c', '#f2c230', '#f4efe6', '#3f6fb8', '#f08a2c'];
const CNY_COLOURS = ['#d42a1f', '#c8201a', '#e0392a'];
/** Stall canopies: mostly white, blue and red (world.md §2.8, Night Bazaar). */
const CANOPY_COLOURS: [string, number][] = [
  ['#f4f1ea', 40],
  ['#2f6db5', 25],
  ['#c8312b', 20],
  ['#2e8b57', 10],
  ['#f28c28', 5],
];

function pickColour(options: [string, number][], u: number): string {
  let total = 0;
  for (const [, w] of options) total += w;
  let r = u * total;
  for (const [v, w] of options) if ((r -= w) < 0) return v;
  return options[options.length - 1][0];
}

const up = new Vector3(0, 1, 0);
/** Fragment patch: the surface glows in its own (vertex and instance) colour, scaled by uGlow. */
const SELF_GLOW = '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * uGlow;';

/** Market stalls at night: vertex colours plus a glow in their own colour, as if lit by the bulbs under the canopy. */
function marketMaterial(uGlow: { value: number }): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = uGlow;
    shader.fragmentShader =
      'uniform float uGlow;\n' +
      shader.fragmentShader.replace('#include <emissivemap_fragment>', SELF_GLOW);
  };
  m.customProgramCacheKey = () => 'market-stall-glow';
  return m;
}

/** Lantern material: vertex colours, a gentle sway about the string, and a self-glow in the lantern's own colour. */
function lanternMaterial(uTime: { value: number }, uGlow: { value: number }): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uGlow = uGlow;
    shader.vertexShader =
      'uniform float uTime;\n' +
      shader.vertexShader
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
  float swayPh = 0.0;
  #ifdef USE_INSTANCING
    swayPh = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.61;
  #endif
  // Swing about the string (local X), in a slow irregular breeze.
  float swayA = 0.09 * sin(uTime * 1.3 + swayPh) + 0.035 * sin(uTime * 2.7 + swayPh * 1.7);
  float swayC = cos(swayA);
  float swayS = sin(swayA);
  objectNormal = vec3(objectNormal.x, objectNormal.y * swayC - objectNormal.z * swayS, objectNormal.y * swayS + objectNormal.z * swayC);`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
  transformed = vec3(transformed.x, transformed.y * swayC - transformed.z * swayS, transformed.y * swayS + transformed.z * swayC);`,
        );
    shader.fragmentShader =
      'uniform float uGlow;\n' +
      shader.fragmentShader.replace('#include <emissivemap_fragment>', SELF_GLOW);
  };
  m.customProgramCacheKey = () => 'khom-khwaen-lantern';
  return m;
}

/** Strings of lanterns across streets. */
class LanternStrings {
  private readonly mesh: InstancedMesh;
  private readonly wires: LineSegments;
  private readonly glows: GlowSprites;
  private readonly uTime = { value: 0 };
  private readonly uGlow = { value: 0 };
  readonly lanterns: number;

  constructor(scene: Scene, anchors: Float32Array, colours: string[], scale: number, geo: BufferGeometry) {
    const lanterns: { x: number; h: number; z: number; yaw: number; colour: string }[] = [];
    const wire: number[] = [];
    for (let i = 0; i < anchors.length; i += 4) {
      const [x, y, heading, half] = [anchors[i], anchors[i + 1], anchors[i + 2], anchors[i + 3]];
      // Strings run across the street.
      const along = heading + Math.PI / 2;
      const sx = Math.cos(along);
      const sy = Math.sin(along);
      const at = (t: number) => {
        const u = 2 * t - 1;
        return { x: x + sx * half * u, y: y + sy * half * u, h: STRING_HEIGHT - STRING_SAG * (1 - u * u) };
      };
      for (let k = 0; k < 6; k++) {
        const a = at(k / 6);
        const b = at((k + 1) / 6);
        wire.push(a.x, a.h, -a.y, b.x, b.h, -b.y);
      }
      const n = Math.max(1, Math.floor((2 * half) / LANTERN_SPACING));
      for (let k = 0; k < n; k++) {
        const p = at((k + 0.5) / n);
        const colour = colours[Math.floor(hash01(i * 16 + k, 151) * colours.length)];
        lanterns.push({ x: p.x, h: p.h - 0.02, z: -p.y, yaw: along, colour });
      }
    }
    this.lanterns = lanterns.length;
    const mat = lanternMaterial(this.uTime, this.uGlow);
    this.mesh = new InstancedMesh(geo, mat, Math.max(1, lanterns.length));
    this.glows = new GlowSprites(Math.max(1, lanterns.length), { minPx: 1.3 });
    const m = new Matrix4();
    const q = new Quaternion();
    const pos = new Vector3();
    const scl = new Vector3(scale, scale, scale);
    const col = new Color();
    lanterns.forEach((l, i) => {
      q.setFromAxisAngle(up, l.yaw);
      m.compose(pos.set(l.x, l.h, l.z), q, scl);
      this.mesh.setMatrixAt(i, m);
      this.mesh.setColorAt(i, col.set(l.colour));
      const [r, g, b] = linearRGB(l.colour);
      this.glows.set(i, l.x, l.h - 0.46 * scale, l.z, 0.85 * scale, r * 1.3 + 0.15, g * 1.3 + 0.1, b * 1.3 + 0.05, hash01(i, 157));
    });
    this.mesh.count = lanterns.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    this.glows.count = lanterns.length;
    this.glows.commit();
    this.wires = new LineSegments(lineGeometry(wire), new LineBasicMaterial({ color: '#2b231d' }));
    scene.add(this.mesh, this.wires, this.glows.mesh);
  }

  update(on: boolean, f: GlowFrame, glow: number): void {
    this.mesh.visible = on;
    this.wires.visible = on;
    this.uTime.value = f.time;
    this.uGlow.value = 0.85 * glow;
    this.glows.frame(f, on ? glow : 0);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    (this.mesh.material as MeshLambertMaterial).dispose();
    this.wires.removeFromParent();
    this.wires.geometry.dispose();
    (this.wires.material as LineBasicMaterial).dispose();
    this.glows.dispose();
  }
}

/** Rows of market stalls with bulb strings along their fronts and warm light on the street. */
class Market {
  private readonly canopies: InstancedMesh;
  private readonly bases: InstancedMesh;
  private readonly bulbs: GlowSprites;
  private readonly pools: LightPools;

  constructor(
    scene: Scene,
    anchors: Float32Array,
    mat: MeshLambertMaterial,
    canopyGeo: BufferGeometry,
    baseGeo: BufferGeometry,
    seed: number,
  ) {
    const n = anchors.length / 4;
    this.canopies = new InstancedMesh(canopyGeo, mat, Math.max(1, n));
    this.bases = new InstancedMesh(baseGeo, mat, Math.max(1, n));
    this.bulbs = new GlowSprites(Math.max(1, n * 3), { minPx: 1.1 });
    this.pools = new LightPools(Math.max(1, n));
    const m = new Matrix4();
    const q = new Quaternion();
    const pos = new Vector3();
    const scl = new Vector3();
    const col = new Color();
    const [br, bg, bb] = linearRGB('#ffcf7a');
    for (let i = 0; i < n; i++) {
      const [x, y, yaw, s] = [anchors[i * 4], anchors[i * 4 + 1], anchors[i * 4 + 2], anchors[i * 4 + 3]];
      q.setFromAxisAngle(up, yaw);
      m.compose(pos.set(x, 0, -y), q, scl.set(s, s, s));
      this.canopies.setMatrixAt(i, m);
      this.bases.setMatrixAt(i, m);
      this.canopies.setColorAt(i, col.set(pickColour(CANOPY_COLOURS, hash01(i + seed, 163))));
      // Bulbs hang along the front edge of the canopy (local +X), rotated into the stall's heading.
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      for (let k = 0; k < 3; k++) {
        const lx = 0.52 * s;
        const lz = (k - 1) * 0.33 * s;
        const bx = x + lx * c + lz * sn;
        const bz = -y - lx * sn + lz * c;
        this.bulbs.set(i * 3 + k, bx, 1.05 * s, bz, 0.3, br * 1.5, bg * 1.5, bb * 1.5, hash01(i * 3 + k, 167));
      }
      this.pools.set(i, x + 0.3 * s * c, 0.25, -y - 0.3 * s * sn, 1.9 * s, br * 0.3, bg * 0.3, bb * 0.3);
    }
    for (const im of [this.canopies, this.bases]) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = false;
      im.receiveShadow = true;
    }
    if (this.canopies.instanceColor) this.canopies.instanceColor.needsUpdate = true;
    this.bulbs.count = n * 3;
    this.bulbs.commit();
    this.pools.count = n;
    this.pools.commit();
    scene.add(this.canopies, this.bases, this.pools.mesh, this.bulbs.mesh);
  }

  /** @param night 0–1: bulbs and the light they throw */
  update(on: boolean, f: GlowFrame, bulbs: number, night: number): void {
    this.canopies.visible = on;
    this.bases.visible = on;
    this.bulbs.frame(f, on ? bulbs : 0);
    this.pools.frame(on ? night : 0);
  }

  dispose(): void {
    for (const im of [this.canopies, this.bases]) {
      im.removeFromParent();
      im.dispose();
    }
    this.bulbs.dispose();
    this.pools.dispose();
  }
}

/** Krathongs drifting downstream on the Ping, each with a candle and its reflection. */
class Krathongs {
  private readonly mesh: InstancedMesh;
  private readonly flames: GlowSprites;
  private readonly pools: LightPools;
  private readonly path: { x: number; y: number; nx: number; ny: number; band: number; s: number }[] = [];
  private readonly length: number;
  private readonly boats: { s0: number; speed: number; side: number; bob: number }[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly pos = new Vector3();
  private readonly scl = new Vector3(1, 1, 1);

  constructor(scene: Scene, anchors: Float32Array, count: number, modelMat: MeshLambertMaterial) {
    let s = 0;
    for (let i = 0; i < anchors.length; i += 4) {
      const [x, y, heading, band] = [anchors[i], anchors[i + 1], anchors[i + 2], anchors[i + 3]];
      if (this.path.length) {
        const p = this.path[this.path.length - 1];
        s += Math.hypot(x - p.x, y - p.y);
      }
      this.path.push({ x, y, nx: -Math.sin(heading), ny: Math.cos(heading), band, s });
    }
    this.length = Math.max(1, s);
    for (let i = 0; i < count; i++) {
      this.boats.push({
        s0: hash01(i, 171) * this.length,
        speed: 0.25 + hash01(i, 173) * 0.35,
        side: (hash01(i, 179) - 0.5) * 1.5,
        bob: hash01(i, 181) * 6.28,
      });
    }
    this.mesh = new InstancedMesh(krathongGeometry(), modelMat, Math.max(1, count));
    this.mesh.frustumCulled = false;
    this.flames = new GlowSprites(Math.max(1, count), { minPx: 1.2, flicker: 0.6 });
    this.pools = new LightPools(Math.max(1, count));
    const [r, g, b] = linearRGB('#ffae42');
    for (let i = 0; i < count; i++) {
      this.flames.set(i, 0, 0, 0, 0.35, r * 1.8, g * 1.8, b * 1.8, hash01(i, 191));
      this.pools.set(i, 0, 0, 0, 1.8, r * 0.28, g * 0.28, b * 0.28);
    }
    this.mesh.count = count;
    this.flames.count = count;
    this.pools.count = count;
    this.flames.commit();
    this.pools.commit();
    scene.add(this.mesh, this.pools.mesh, this.flames.mesh);
  }

  private at(s: number): { x: number; y: number; nx: number; ny: number; band: number; dir: number } {
    const p = this.path;
    let i = 1;
    while (i < p.length - 1 && p[i].s < s) i++;
    const a = p[i - 1] ?? p[0];
    const b = p[i] ?? a;
    const t = b.s > a.s ? Math.min(1, Math.max(0, (s - a.s) / (b.s - a.s))) : 0;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      nx: a.nx + (b.nx - a.nx) * t,
      ny: a.ny + (b.ny - a.ny) * t,
      band: a.band + (b.band - a.band) * t,
      dir: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }

  update(on: boolean, f: GlowFrame, light: number): void {
    this.mesh.visible = on;
    this.flames.frame(f, on ? light : 0);
    this.pools.frame(on ? light : 0);
    if (!on || this.path.length < 2) return;
    this.boats.forEach((k, i) => {
      const s = (k.s0 + k.speed * f.time) % this.length;
      const p = this.at(s);
      const off = k.side * p.band * 0.5;
      const x = p.x + p.nx * off;
      const y = p.y + p.ny * off;
      const h = RIVER_WATER_Y + 0.015 * Math.sin(f.time * 1.7 + k.bob);
      this.q.setFromAxisAngle(up, p.dir + k.bob);
      this.m.compose(this.pos.set(x, h, -y), this.q, this.scl);
      this.mesh.setMatrixAt(i, this.m);
      this.flames.move(i, x, h + 0.3, -y);
      this.pools.move(i, x, RIVER_WATER_Y + 0.02, -y);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.flames.commit(false);
    this.pools.commit();
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.dispose();
    this.flames.dispose();
    this.pools.dispose();
  }
}

/** Candles: tiny flickering flames on temple walls. */
function candleSprites(anchors: Float32Array): GlowSprites {
  const n = anchors.length / 4;
  const g = new GlowSprites(Math.max(1, n), { minPx: 1.0, flicker: 0.7 });
  const [r, gr, b] = linearRGB('#ffae42');
  for (let i = 0; i < n; i++) {
    const [x, y, , h] = anchors.subarray(i * 4, i * 4 + 4);
    g.set(i, x, h + 0.06, -y, 0.3, r * 1.7, gr * 1.7, b * 1.7, hash01(i, 197));
  }
  g.count = n;
  g.commit();
  return g;
}

/** Scene inputs the festival decor needs each frame. */
export interface FestivalFrame {
  glow: GlowFrame;
  state: FestivalState;
  /** Night factor 0–1 (lanterns and bulbs glow). */
  night: number;
  krathongs: number;
}

export class FestivalDecor {
  private readonly scene: Scene;
  private readonly modelMat: MeshLambertMaterial;
  private readonly props: Record<string, Float32Array>;
  private yiPeng: LanternStrings | null = null;
  private cny: LanternStrings | null = null;
  private candles: GlowSprites | null = null;
  private krathongs: Krathongs | null = null;
  private readonly markets = new Map<string, Market>();
  private lanternGeo: BufferGeometry | null = null;
  private canopyGeo: BufferGeometry | null = null;
  private baseGeo: BufferGeometry | null = null;
  private readonly marketGlow = { value: 0 };
  private marketMat: MeshLambertMaterial | null = null;

  constructor(scene: Scene, modelMat: MeshLambertMaterial, props: Record<string, Float32Array>) {
    this.scene = scene;
    this.modelMat = modelMat;
    this.props = props;
  }

  private anchors(kind: string): Float32Array | null {
    const a = this.props[kind];
    return a && a.length >= 4 ? a : null;
  }

  private market(kind: string, on: boolean, f: FestivalFrame, bulbs: number, seed: number): void {
    let m = this.markets.get(kind);
    if (!m && on) {
      const a = this.anchors(kind);
      if (!a) return;
      this.canopyGeo ??= stallCanopyGeometry();
      this.baseGeo ??= stallBaseGeometry();
      this.marketMat ??= marketMaterial(this.marketGlow);
      m = new Market(this.scene, a, this.marketMat, this.canopyGeo, this.baseGeo, seed);
      this.markets.set(kind, m);
    }
    m?.update(on, f.glow, bulbs, f.night);
  }

  update(f: FestivalFrame): void {
    const s = f.state;
    const glow = f.night;
    if (s.yiPengLanterns && !this.yiPeng) {
      const a = this.anchors(FX.lanternYiPeng);
      if (a) this.yiPeng = new LanternStrings(this.scene, a, YI_PENG_COLOURS, 1, (this.lanternGeo ??= lanternGeometry()));
    }
    this.yiPeng?.update(s.yiPengLanterns, f.glow, glow);
    if (s.chineseNewYear && !this.cny) {
      const a = this.anchors(FX.lanternCny);
      if (a) this.cny = new LanternStrings(this.scene, a, CNY_COLOURS, 1.35, (this.lanternGeo ??= lanternGeometry()));
    }
    this.cny?.update(s.chineseNewYear, f.glow, glow);
    if (s.yiPengEvening && !this.candles) {
      const a = this.anchors(FX.candle);
      if (a) {
        this.candles = candleSprites(a);
        this.scene.add(this.candles.mesh);
      }
    }
    this.candles?.frame(f.glow, s.yiPengEvening ? 0.3 + 0.9 * glow : 0);
    if (s.yiPengEvening && !this.krathongs) {
      const a = this.anchors(FX.river);
      if (a) this.krathongs = new Krathongs(this.scene, a, f.krathongs, this.modelMat);
    }
    this.krathongs?.update(s.yiPengEvening, f.glow, 0.3 + 0.9 * glow);
    const bulbs = 0.25 + 0.95 * glow;
    this.marketGlow.value = 0.3 * glow;
    this.market(FX.stallSunday, s.sundayMarket, f, bulbs, 0);
    this.market(FX.stallSaturday, s.saturdayMarket, f, bulbs, 5000);
    this.market(FX.stallBazaar, s.nightBazaar, f, bulbs, 9000);
  }

  dispose(): void {
    this.yiPeng?.dispose();
    this.cny?.dispose();
    this.candles?.dispose();
    this.krathongs?.dispose();
    for (const m of this.markets.values()) m.dispose();
    this.lanternGeo?.dispose();
    this.canopyGeo?.dispose();
    this.baseGeo?.dispose();
    this.marketMat?.dispose();
  }
}
