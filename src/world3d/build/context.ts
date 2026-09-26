import type { CityData } from '../city';
import type { MeshWriter } from './mesh';
import type { Occupancy } from './occupancy';
import type { Ring } from './shapes';

/**
 * Static mesh layers, each drawn with its own material:
 * - windows: window panes and shopfront glass; lit from inside at night.
 * - glow: always-bright surfaces (neon, lanterns, lit signs), unlit by the sun.
 */
export type LayerId = 'ground' | 'water' | 'roads' | 'buildings' | 'structures' | 'backdrop' | 'windows' | 'glow';
export const LAYERS: LayerId[] = ['backdrop', 'ground', 'water', 'roads', 'structures', 'buildings', 'windows', 'glow'];

/** Tree kinds used by the instanced tree models. */
export const TREE_KINDS = ['rain', 'round', 'palm', 'yang', 'bodhi'] as const;
export type TreeKind = (typeof TREE_KINDS)[number];

/** Shared state threaded through the builders, in the order world.ts runs them. */
export interface BuildContext {
  city: CityData;
  w: Record<LayerId, MeshWriter>;
  /** Built-up cells (buildings, carriageways, walls) that props must avoid. */
  occ: Occupancy;
  /** Kept area [x0, y0, x1, y1] in metres. */
  keep: [number, number, number, number];
  str(i: number | undefined): string;
  /** Green areas trees may be scattered in (filled by the ground builder). */
  parkAreas: { ring: Ring; kind: string }[];
  /** Moat water rings (ground builder), for bank trees and the sunken moat. */
  moatRings: Ring[];
  /** Road polylines in way order (roads builder). */
  roadPts: Ring[];
  /** Tree instances: x, y, scale, kind index. */
  trees: number[];
  /**
   * Instanced street props by kind (models in src/world3d/propModels.ts):
   * x, y (sim metres), yaw (radians, sim heading convention), scale per instance.
   */
  props: Record<string, number[]>;
}

/** Record one instance of a prop kind. */
export function addProp(ctx: BuildContext, kind: string, x: number, y: number, yaw: number, scale = 1): void {
  (ctx.props[kind] ??= []).push(x, y, yaw, scale);
}
