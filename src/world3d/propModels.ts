// Geometries for instanced street props, keyed by the kind names the
// generator records with addProp(). Each model faces +X at yaw 0 and stands
// on the ground at the origin.

import type { BufferGeometry } from 'three';

/** Factory per prop kind; kinds without a factory are not drawn. */
export const PROP_MODELS: Record<string, () => BufferGeometry> = {};
