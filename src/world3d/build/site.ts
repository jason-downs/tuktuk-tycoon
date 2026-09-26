// Building sites and plans shared by the building, temple and landmark
// builders: a footprint with its measurements (Site), what will be built on it
// (Plan), and the lookups the builders share (BuildEnv).

import { ringOf, type CityBuilding, type CityData } from '../city';
import { centroid, edgeOf, ringArea } from './kit';
import type { RGB } from './mesh';
import type { Ring } from './shapes';
import type { BayUse, RowStyle } from './shophouse';
import type { TempleGround } from './temples';

// ------------------------------------------------------------------ sites

/** A building footprint with the measurements classification needs. */
export interface Site {
  i: number;
  b: CityBuilding;
  /** Counter-clockwise outer ring (m). */
  ring: Ring;
  /** Clockwise hole rings (m). */
  holes: Ring[];
  kind: string;
  use: string;
  name: string;
  zone: string;
  area: number;
  /** Oriented box: long and short side (m). */
  L: number;
  W: number;
  /** Area / oriented-box area. */
  rect: number;
  cx: number;
  cy: number;
  /** Street-front edge index, or -1. */
  front: number;
  frontLen: number;
  /** Depth behind the street front (m). */
  depth: number;
  roadCls: number;
  roadName: string;
  /**
   * Edges shared with a neighbouring footprint: edge index → the neighbour's
   * wall-top height. Walls below it are hidden and not drawn.
   */
  shared: Map<number, number>;
}

export function siteOf(city: CityData, i: number): Site {
  const b = city.buildings[i];
  const str = (k: number | undefined) => (k ? city.strings[k] : '');
  // Baked rings may be either orientation; builders want the outer ring
  // counter-clockwise (walls face out) and holes clockwise. Reversing a ring
  // moves edge i (vertex i → i+1) to index n − 2 − i.
  const ring = ringOf(b.r);
  const n = ring.length;
  let front = b.f ?? -1;
  if (front >= n) front = -1;
  if (ringArea(ring) < 0) {
    ring.reverse();
    if (front >= 0) front = (2 * n - 2 - front) % n;
  }
  const holes = (b.h ?? []).map(ringOf).map((h) => (ringArea(h) > 0 ? h.reverse() : h));
  const [cx, cy] = centroid(ring);
  const L = b.o[0] / 10;
  const W = b.o[1] / 10;
  let frontLen = 0;
  let depth = 0;
  if (front >= 0) {
    const e = edgeOf(ring, front);
    frontLen = e.len;
    for (const [x, y] of ring) depth = Math.max(depth, -((x - e.ax) * e.nx + (y - e.ay) * e.ny));
  }
  const way = b.fr !== undefined ? city.roads.ways[b.fr] : undefined;
  return {
    i,
    b,
    ring,
    holes,
    kind: str(b.b),
    use: str(b.u),
    name: str(b.n),
    zone: city.zones[b.z] ?? 'suburb',
    area: b.a,
    L,
    W,
    rect: L * W > 0 ? Math.min(1, b.a / (L * W)) : 0,
    cx,
    cy,
    front,
    frontLen,
    depth,
    roadCls: way ? way[0] : 9,
    roadName: way ? str(way[4]) : '',
    shared: new Map(),
  };
}

// ------------------------------------------------------------------ plans

export type BuildingClass =
  | 'shophouse'
  | 'house'
  | 'lanna_house'
  | 'block'
  | 'condo'
  | 'hotel'
  | 'office'
  | 'school'
  | 'hospital'
  | 'mall'
  | 'market'
  | 'canopy'
  | 'kiosk'
  | 'shed'
  | 'hangar'
  | 'church'
  | 'mosque'
  | 'shrine'
  | 'chedi'
  | 'skip';

export type RoofKind = 'flat' | 'gable' | 'hip' | 'skillion' | 'kalae';

export interface Plan {
  cls: BuildingClass;
  style: RowStyle;
  levels: number;
  /** Ground-floor and upper-floor heights (m). */
  ground: number;
  floor: number;
  /** Height the building stands on (min_height), and the top of its walls. */
  base: number;
  wallTop: number;
  roof: RoofKind;
  parapet: number;
  /** Ridge rise above the wall top for pitched roofs. */
  rise: number;
  /** Highest point of the main mass (parapet top or ridge). */
  top: number;
  /** Height came from OSM tags (no caps apply). */
  tagged: boolean;
  /** Height cap applied (Infinity when none). */
  cap: number;
  wall: RGB;
  roofC: RGB;
  /** Reduced facade detail (outside the playable area). */
  lean: boolean;
}

/** Context the planner needs besides the footprint. */
export interface PlanEnv {
  nearTemple(x: number, y: number): boolean;
  inMarket(x: number, y: number): boolean;
  inPlay(x: number, y: number): boolean;
  str(i: number | undefined): string;
}

// ------------------------------------------------------------------ environment

/** Shared lookups for the building, temple and landmark builders. */
export interface BuildEnv extends PlanEnv {
  city: CityData;
  grounds: TempleGround[];
  markets: { ring: Ring; name: string; id: number }[];
  /** Building indices replaced by hero models (not drawn generically). */
  hidden: Set<number>;
  /** Building indices already drawn by temples or landmarks. */
  handled: Set<number>;
  /** Snapped shopfront nodes per building: x, y (sim metres) and use. */
  shopsAt: Map<number, [number, number, BayUse][]>;
}


/** A plan with explicit storeys, roof and colours (temple kuti, landmark blocks). */
export function simplePlan(s: Site, cls: BuildingClass, levels: number, roof: RoofKind, wall: RGB, roofC: RGB, lean = false, ground = 3.2, floor = 3.1): Plan {
  const wallTop = ground + (levels - 1) * floor;
  const rise = roof === 'flat' ? 0 : Math.min(3.5, Math.max(1.2, s.W * 0.28));
  const parapet = roof === 'flat' ? 0.8 : 0;
  return {
    cls,
    style: 'concrete',
    levels,
    ground,
    floor,
    base: 0,
    wallTop,
    roof,
    parapet,
    rise,
    top: wallTop + (roof === 'flat' ? parapet : rise),
    tagged: false,
    cap: Infinity,
    wall,
    roofC,
    lean,
  };
}
