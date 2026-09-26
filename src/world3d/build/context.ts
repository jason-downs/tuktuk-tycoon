import type { CityData } from '../city';
import type { RoadNet } from './junctions';
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

/** Tree kinds used by the instanced tree models (src/world3d/treeModels.ts); 'round' is a generic yard tree, 'palm' a coconut. */
export const TREE_KINDS = [
  'rain',
  'round',
  'palm',
  'yang',
  'bodhi',
  'banyan',
  'teak',
  'sugar_palm',
  'royal_palm',
  'frangipani',
  'bougainvillea',
  'golden_shower',
  'banana',
] as const;
export type TreeKind = (typeof TREE_KINDS)[number];

/** A temple ground as built: where its viharn, main chedi, gate and bodhi spot are (sim metres). */
export interface TempleInfo {
  ti: number;
  name: string;
  viharn: { x: number; y: number; ang: number; L: number; W: number; mapped: boolean };
  chedi: { x: number; y: number; side: number; height: number; mapped: boolean };
  gate: [number, number] | null;
  bodhi: [number, number] | null;
}

/** A hero landmark as built: its landmarks.json id and anchor (sim metres). */
export interface LandmarkInfo {
  id: string;
  x: number;
  y: number;
}

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
  /**
   * Water sunk below the street (ground builder): outline, islands and surface
   * height in metres (negative), e.g. the moat at −1.6 and the Ping at −3.5.
   */
  waterBodies?: { kind: string; ring: Ring; islands: Ring[]; level: number; cut: boolean[] }[];
  /** Road polylines in way order (roads builder). */
  roadPts: Ring[];
  /** Ways and junction surfaces as the roads builder draws them. */
  roadNet?: RoadNet;
  /** Tree instances: x, y, scale, kind index. */
  trees: number[];
  /**
   * Instanced street props by kind (models in src/world3d/propModels.ts):
   * x, y (sim metres), yaw (radians, sim heading convention), scale per instance.
   */
  props: Record<string, number[]>;
  /** Temple grounds as built (buildings builder). */
  temples?: TempleInfo[];
  /** Hero landmarks as built (buildings builder). */
  landmarks?: LandmarkInfo[];
}

/** Record one instance of a prop kind. */
export function addProp(ctx: BuildContext, kind: string, x: number, y: number, yaw: number, scale = 1): void {
  (ctx.props[kind] ??= []).push(x, y, yaw, scale);
}
