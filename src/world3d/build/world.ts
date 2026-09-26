// Generates the static 3D city from CityData: ground and land cover, water,
// roads, buildings (shophouses, houses, temples, chedis), walls, the Doi
// Suthep backdrop and tree placements. Pure: no three.js, no DOM.

import type { CityData } from '../city';
import { buildBuildings } from './buildings';
import { mountains } from './backdrop';
import { LAYERS, type BuildContext, type LayerId } from './context';
import { buildEffectAnchors } from './effects';
import { buildGround } from './ground';
import { clipMeshToTiles, gpuIndex, gpuMesh, MeshWriter, simplifyIndex, splitMesh, type GpuMesh, type PackedMesh } from './mesh';
import { Occupancy } from './occupancy';
import { buildProps } from './props';
import { buildRoads } from './roads';
import { scatterTrees } from './scatter';
import { buildWalkways } from './walkways';

export { LAYERS, TREE_KINDS, addProp, type LayerId, type TreeKind } from './context';

export interface BuiltCity {
  layers: Record<LayerId, PackedMesh>;
  /** x, y (sim metres), scale, kind index — one tree per 4 floats. */
  trees: Float32Array;
  /** Street props by kind: x, y, yaw, scale per instance. */
  props: Record<string, Float32Array>;
  stats: { triangles: Record<LayerId, number>; trees: number; buildings: number; ms: number };
}

/** Side (m) of the square tiles the static layers are split into for culling. */
export const TILE_SIZE = 800;
/** Layers kept whole: each is small and spans the map, so tiles would only add draw calls. */
export const WHOLE_LAYERS: readonly LayerId[] = ['ground', 'backdrop', 'water'];
/** Cell (m) the distant buildings are simplified to: two or three pixels across where they are drawn (layers/city.ts). */
export const FAR_BUILDING_CELL = 3;

/** The city as the view holds it: each static layer split into tiles the renderer can cull one by one, packed for the GPU. */
export interface TiledCity extends Omit<BuiltCity, 'layers'> {
  layers: Record<LayerId, GpuMesh[]>;
  /** For each buildings tile (same order), a coarser triangle list over its vertices, drawn in its place when the tile is far from the camera. */
  farBuildings: (Uint16Array | Uint32Array)[];
}

/**
 * Split the static layers into tiles, apart from WHOLE_LAYERS. The roads
 * layer is drawn in painter's order, so its triangles are cut at the tile
 * edges rather than handed whole to one tile, which would let a neighbouring
 * tile's paint cover or show through it depending on which tile draws last.
 * Each buildings tile also gets a coarse triangle list for distant views.
 */
export function tileCity(built: BuiltCity, size = TILE_SIZE): TiledCity {
  const layers = {} as Record<LayerId, GpuMesh[]>;
  let farBuildings: (Uint16Array | Uint32Array)[] = [];
  for (const id of LAYERS) {
    const m = built.layers[id];
    const pieces = WHOLE_LAYERS.includes(id) ? (m.index.length ? [m] : []) : id === 'roads' ? clipMeshToTiles(m, size) : splitMesh(m, size);
    layers[id] = pieces.map(gpuMesh);
    if (id === 'buildings') farBuildings = pieces.map((p) => gpuIndex(simplifyIndex(p, FAR_BUILDING_CELL), p.position.length / 3));
  }
  return { ...built, layers, farBuildings };
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
  buildProps(ctx);
  buildWalkways(ctx);
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
