// Geometries for instanced street props, keyed by the kind names the
// generator records with addProp(). Each model faces +X at yaw 0 and stands
// on the ground at the origin.

import type { BufferGeometry } from 'three';

/**
 * Factory per prop kind; kinds without a factory are not drawn. Kind names in
 * use: street_lamp, heritage_lamp, power_pole, traffic_light, spirit_house,
 * parked_bike, food_cart, parasol, bus_shelter, flag_pole, fountain, stall,
 * pea_cabinet, bench. Lighting reads street_lamp / heritage_lamp positions for
 * night light pools.
 */
export const PROP_MODELS: Record<string, () => BufferGeometry> = {};
