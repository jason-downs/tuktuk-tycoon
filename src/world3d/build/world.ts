// Generates the static 3D city from CityData: ground and land cover, water,
// roads, buildings (shophouses, houses, temples, chedis), walls, the Doi
// Suthep backdrop and tree placements. Pure: no three.js, no DOM.

import type { CityData } from '../city';
import { buildBuildings } from './buildings';
import { mountains } from './backdrop';
import { LAYERS, type BuildContext, type LayerId } from './context';
import { buildEffectAnchors } from './effects';
import { buildGround } from './ground';
import { MeshWriter, type PackedMesh } from './mesh';
import { Occupancy } from './occupancy';
import { buildRoads } from './roads';
import { scatterTrees } from './scatter';

export { LAYERS, TREE_KINDS, addProp, type LayerId, type TreeKind } from './context';

export interface BuiltCity {
  layers: Record<LayerId, PackedMesh>;
  /** x, y (sim metres), scale, kind index — one tree per 4 floats. */
  trees: Float32Array;
  /** Street props by kind: x, y, yaw, scale per instance. */
  props: Record<string, Float32Array>;
  stats: { triangles: Record<LayerId, number>; trees: number; buildings: number; ms: number };
}

export function buildCity(city: CityData): BuiltCity {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const keep = city.keep.map((v) => v / 10) as [number, number, number, number];
  const ctx: BuildContext = {
    city,
    w: {
      backdrop: new MeshWriter(8192),
      ground: new MeshWriter(65536),
      water: new MeshWriter(16384),
      roads: new MeshWriter(262144),
      structures: new MeshWriter(65536),
      buildings: new MeshWriter(524288),
      windows: new MeshWriter(65536),
      glow: new MeshWriter(4096),
    },
    occ: new Occupancy(...keep),
    keep,
    str: (i) => (i ? city.strings[i] : ''),
    parkAreas: [],
    moatRings: [],
    roadPts: [],
    trees: [],
    props: {},
  };
  // Order matters: roads and buildings mark the occupancy raster that tree
  // scattering reads; the ground builder collects parks and moat rings.
  buildGround(ctx);
  buildRoads(ctx);
  const built = buildBuildings(ctx);
  mountains(ctx.w.backdrop, city);
  scatterTrees(ctx);
  buildEffectAnchors(ctx);

  const layers = {} as Record<LayerId, PackedMesh>;
  const triangles = {} as Record<LayerId, number>;
  for (const id of LAYERS) {
    layers[id] = ctx.w[id].pack();
    triangles[id] = ctx.w[id].triangleCount;
  }
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  const props: Record<string, Float32Array> = {};
  for (const [kind, arr] of Object.entries(ctx.props)) props[kind] = new Float32Array(arr);
  return { layers, trees: new Float32Array(ctx.trees), props, stats: { triangles, trees: ctx.trees.length / 4, buildings: built, ms } };
}
