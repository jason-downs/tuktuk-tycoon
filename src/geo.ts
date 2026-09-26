// Local planar projection used by the simulation. Positions are metres east
// (x) and north (y) of the map origin; build-map.mjs uses the same constants,
// so graph and POI coordinates line up with the GeoJSON layers.

export interface LatLon {
  lat: number;
  lon: number;
}

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON_EQUATOR = 111_320;

export class Projection {
  readonly origin: LatLon;
  private readonly mPerDegLon: number;

  constructor(origin: LatLon) {
    this.origin = origin;
    this.mPerDegLon = M_PER_DEG_LON_EQUATOR * Math.cos((origin.lat * Math.PI) / 180);
  }

  toLngLat(x: number, y: number): [number, number] {
    return [this.origin.lon + x / this.mPerDegLon, this.origin.lat + y / M_PER_DEG_LAT];
  }

  toXY(lon: number, lat: number): [number, number] {
    return [(lon - this.origin.lon) * this.mPerDegLon, (lat - this.origin.lat) * M_PER_DEG_LAT];
  }
}

export const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(bx - ax, by - ay);

/** Smallest signed difference b − a between two angles, in (−π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  return d;
}
