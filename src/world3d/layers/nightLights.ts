// Street lighting at night (docs/3d/world.md §3.3): a warm glow at every lamp
// head and a pool of light on the road beneath it, for the street_lamp and
// heritage_lamp props placed by the street-furniture builder. No real light
// sources: additive sprites and ground discs that fade in with the lamps.

import type { Scene } from 'three';
import { hash01 } from '../build/mesh';
import { GlowSprites, LightPools, type GlowFrame } from './glow';

/**
 * Where the light comes from on each lamp model (metres at scale 1, model
 * facing +X at yaw 0): arm lamps reach out over the road, heritage lanterns
 * sit on top of their post.
 */
export interface LampSpec {
  /** Head offset along the lamp's facing (m) and height (m). */
  reach: number;
  height: number;
  /** Glow radius (m). */
  glow: number;
  /** Light pool radius on the ground (m) and its offset along the facing. */
  pool: number;
  poolReach: number;
  colours: string[];
}

export const LAMP_SPECS: Record<string, LampSpec> = {
  // Sodium on most roads, white LED on some main roads (world.md §3.3).
  street_lamp: {
    reach: 1.8,
    height: 7.4,
    glow: 1.5,
    pool: 10,
    poolReach: 2.6,
    colours: ['#ffb45c', '#ffb45c', '#ffb45c', '#f3f1ea', '#f3f1ea'],
  },
  heritage_lamp: { reach: 0, height: 3.7, glow: 1.0, pool: 5.5, poolReach: 0, colours: ['#ffcf7a'] },
};

/** Pool brightness relative to the head colour (additive on the road). */
const POOL_GAIN = 0.24;
const POOL_HEIGHT = 0.22;

const srgbToLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** Linear RGB of a #rrggbb colour. */
export function linearRGB(h: string): [number, number, number] {
  const v = parseInt(h.replace('#', ''), 16);
  return [srgbToLinear(((v >> 16) & 255) / 255), srgbToLinear(((v >> 8) & 255) / 255), srgbToLinear((v & 255) / 255)];
}

export interface LampLayout {
  /** Per lamp head: world x, y, z, radius, r, g, b, flicker phase. */
  heads: Float32Array;
  /** Per pool: world x, y, z, radius, r, g, b. */
  pools: Float32Array;
}

/** Light positions for the lamp props (x, y, yaw, scale per instance, sim metres). */
export function lampLayout(props: Record<string, Float32Array | undefined>): LampLayout {
  const heads: number[] = [];
  const pools: number[] = [];
  let n = 0;
  for (const [kind, spec] of Object.entries(LAMP_SPECS)) {
    const arr = props[kind];
    if (!arr) continue;
    for (let i = 0; i < arr.length; i += 4) {
      const [x, y, yaw, s] = [arr[i], arr[i + 1], arr[i + 2], arr[i + 3] || 1];
      const c = linearRGB(spec.colours[Math.floor(hash01(n++, 131) * spec.colours.length)]);
      const cx = Math.cos(yaw);
      const cy = Math.sin(yaw);
      heads.push(x + cx * spec.reach * s, spec.height * s, -(y + cy * spec.reach * s), spec.glow * s, c[0], c[1], c[2], hash01(n, 137));
      const px = x + cx * spec.poolReach * s;
      const pz = -(y + cy * spec.poolReach * s);
      pools.push(px, POOL_HEIGHT, pz, spec.pool * s, c[0] * POOL_GAIN, c[1] * POOL_GAIN, c[2] * POOL_GAIN);
    }
  }
  return { heads: new Float32Array(heads), pools: new Float32Array(pools) };
}

export class NightLights {
  private readonly heads: GlowSprites;
  private readonly pools: LightPools;
  readonly lampCount: number;

  constructor(scene: Scene, props: Record<string, Float32Array | undefined>) {
    const layout = lampLayout(props);
    const n = layout.heads.length / 8;
    this.lampCount = n;
    this.heads = new GlowSprites(Math.max(1, n), { minPx: 1.4 });
    this.pools = new LightPools(Math.max(1, n));
    for (let i = 0; i < n; i++) {
      const h = layout.heads.subarray(i * 8, i * 8 + 8);
      this.heads.set(i, h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]);
      const p = layout.pools.subarray(i * 7, i * 7 + 7);
      this.pools.set(i, p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
    }
    this.heads.count = n;
    this.pools.count = n;
    this.heads.commit();
    this.pools.commit();
    scene.add(this.pools.mesh, this.heads.mesh);
  }

  /**
   * @param lamps 0 off … 1 fully on
   * @param poolGain extra brightness of the pools (wet roads reflect more)
   */
  update(f: GlowFrame, lamps: number, poolGain = 1): void {
    this.heads.frame(f, lamps * 1.2);
    this.pools.frame(lamps * poolGain);
  }

  dispose(): void {
    this.heads.dispose();
    this.pools.dispose();
  }
}
