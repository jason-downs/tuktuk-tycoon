// Shape of public/data/city3d.json (written by scripts/build-city3d.mjs).
// Coordinates are integer decimetres in sim space (x east, y north). Polygon
// rings are clockwise (holes counter-clockwise) and do not repeat the first
// vertex.

export interface CityRoads {
  /** x0,y0,x1,y1,… decimetres. */
  nodes: number[];
  /** [class, flags, widthDm, lanes, nameIdx, surface, layer, ...nodeIdx] */
  ways: number[][];
  classes: string[];
  surfaces: string[];
}

export interface CityArea {
  k: number;
  r: number[];
  h?: number[][];
  n?: number;
  /** Index into the temple-ground list for temple areas. */
  ti?: number;
  /** OSM id (temple, worship, market, retail and plaza areas). */
  id?: number;
  /** String index of the religion tag (temple and worship areas). */
  rel?: number;
}

/** City-wall remnant, gate tower or bastion footprint (closed ring, same orientation as other baked rings). */
export interface CityWall {
  r: number[];
  id: number;
  n?: number;
}

export interface CityLine {
  k: number;
  p: number[];
  w?: number;
  closed?: number;
}

export interface CityBuilding {
  r: number[];
  h?: number[][];
  /** String index of the building=* value ("yes", "house", "part:…"). */
  b: number;
  /** Zone index into CityData.zones. */
  z: number;
  /** Footprint area, m². */
  a: number;
  /** Oriented box: long side dm, short side dm, angle mrad. */
  o: [number, number, number];
  l?: number;
  ml?: number;
  ht?: number;
  mh?: number;
  rs?: number;
  rc?: number;
  c?: number;
  m?: number;
  /** Street-front edge index (edge i runs from vertex i to i+1). */
  f?: number;
  /** Road way index of the street front. */
  fr?: number;
  /** Temple-ground index. */
  t?: number;
  u?: number;
  rel?: number;
  tt?: number;
  n?: number;
  part?: 1;
  id: number;
}

export interface CityData {
  version: number;
  origin: { lat: number; lon: number };
  /** Playable area and kept area, [x0, y0, x1, y1] dm. */
  play: [number, number, number, number];
  keep: [number, number, number, number];
  strings: string[];
  zones: string[];
  areaKinds: string[];
  lineKinds: string[];
  roofShapes: string[];
  roads: CityRoads;
  areas: CityArea[];
  lines: CityLine[];
  cityWalls?: CityWall[];
  buildings: CityBuilding[];
  /** x,y dm, speciesIdx triples. */
  trees: number[];
  species: string[];
  /** kindIdx, x, y dm triples. */
  props: number[];
  propKinds: string[];
  /** kindIdx, x, y dm, nameIdx quadruples. */
  shops: number[];
  shopKinds: string[];
}

export const ROAD_FLAG = {
  ONEWAY: 1,
  BRIDGE: 2,
  TUNNEL: 4,
  ROUNDABOUT: 8,
  LINK: 16,
  SIDEWALK_L: 32,
  SIDEWALK_R: 64,
  LIT: 128,
} as const;

/** Decimetre flat array → [x, y] metre pairs. */
export function ringOf(flat: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i] / 10, flat[i + 1] / 10]);
  return out;
}

export async function loadCity(url: string): Promise<CityData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as CityData;
}
