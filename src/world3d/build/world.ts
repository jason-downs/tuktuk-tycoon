// Generates the static 3D city from CityData: ground and land cover, water,
// roads, buildings (shophouses, houses, temples, chedis), walls, the Doi
// Suthep backdrop and tree placements. Pure: no three.js, no DOM.

import { ringOf, ROAD_FLAG, type CityBuilding, type CityData } from '../city';
import { MeshWriter, hash01, mix, pickWeighted, shade, type PackedMesh, type RGB } from './mesh';
import { MODERN_WALLS, P, PITCHED_ROOFS, SIGNS, WALLS } from './palette';

export type LayerId = 'ground' | 'water' | 'roads' | 'buildings' | 'structures' | 'backdrop';
export const LAYERS: LayerId[] = ['backdrop', 'ground', 'water', 'roads', 'structures', 'buildings'];

/** Tree kinds used by the instanced tree models. */
export const TREE_KINDS = ['rain', 'round', 'palm', 'yang', 'bodhi'] as const;
export type TreeKind = (typeof TREE_KINDS)[number];

export interface BuiltCity {
  layers: Record<LayerId, PackedMesh>;
  /** x, y (sim metres), scale, kind index — one tree per 4 floats. */
  trees: Float32Array;
  stats: { triangles: Record<LayerId, number>; trees: number; buildings: number; ms: number };
}

type V3 = [number, number, number];
type Ring = [number, number][];

// ------------------------------------------------------------------ occupancy
/** Coarse raster of built-up cells (buildings and carriageways) for scattering props. */
class Occupancy {
  readonly cell = 2;
  readonly nx: number;
  readonly ny: number;
  private readonly bits: Uint8Array;
  private readonly x0: number;
  private readonly y0: number;

  constructor(x0: number, y0: number, x1: number, y1: number) {
    this.x0 = x0;
    this.y0 = y0;
    this.nx = Math.ceil((x1 - x0) / this.cell);
    this.ny = Math.ceil((y1 - y0) / this.cell);
    this.bits = new Uint8Array(this.nx * this.ny);
  }

  private idx(x: number, y: number): number {
    const i = Math.floor((x - this.x0) / this.cell);
    const j = Math.floor((y - this.y0) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return -1;
    return j * this.nx + i;
  }

  markDisc(x: number, y: number, r: number): void {
    const c = this.cell;
    for (let yy = y - r; yy <= y + r; yy += c) {
      for (let xx = x - r; xx <= x + r; xx += c) {
        if ((xx - x) ** 2 + (yy - y) ** 2 > r * r) continue;
        const i = this.idx(xx, yy);
        if (i >= 0) this.bits[i] = 1;
      }
    }
  }

  markRing(ring: Ring, pad: number): void {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of ring) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    for (let y = y0 - pad; y <= y1 + pad; y += this.cell) {
      for (let x = x0 - pad; x <= x1 + pad; x += this.cell) {
        if (pad > 0 || pointInRing(x, y, ring)) {
          const i = this.idx(x, y);
          if (i >= 0) this.bits[i] = 1;
        }
      }
    }
  }

  free(x: number, y: number): boolean {
    const i = this.idx(x, y);
    return i >= 0 && this.bits[i] === 0;
  }
}

function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function bbox(ring: Ring): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of ring) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

// ------------------------------------------------------------------ helpers
/** n-sided prism/frustum around (x, y) from h0 (radius r0) to h1 (radius r1), with a top cap. */
function frustum(w: MeshWriter, x: number, y: number, r0: number, r1: number, h0: number, h1: number, n: number, c: RGB, cap = true, rot = 0): void {
  for (let i = 0; i < n; i++) {
    const a0 = rot + (i / n) * Math.PI * 2;
    const a1 = rot + ((i + 1) / n) * Math.PI * 2;
    w.quad(
      [x + Math.cos(a0) * r0, y + Math.sin(a0) * r0, h0],
      [x + Math.cos(a1) * r0, y + Math.sin(a1) * r0, h0],
      [x + Math.cos(a1) * r1, y + Math.sin(a1) * r1, h1],
      [x + Math.cos(a0) * r1, y + Math.sin(a0) * r1, h1],
      c,
    );
  }
  if (cap && r1 > 0.01) {
    const ring: Ring = [];
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      ring.push([x + Math.cos(a) * r1, y + Math.sin(a) * r1]);
    }
    w.polygon(ring, undefined, h1, c);
  }
}

/** Axis-aligned-in-its-own-frame box centred on (x, y), long side along angle ang. */
function box(w: MeshWriter, x: number, y: number, len: number, wid: number, h0: number, h1: number, ang: number, c: RGB, cTop: RGB = c): void {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const hl = len / 2;
  const hw = wid / 2;
  const ring: Ring = [
    [x - ca * hl + sa * hw, y - sa * hl - ca * hw],
    [x + ca * hl + sa * hw, y + sa * hl - ca * hw],
    [x + ca * hl - sa * hw, y + sa * hl + ca * hw],
    [x - ca * hl - sa * hw, y - sa * hl + ca * hw],
  ];
  w.walls(ring, h0, h1, c);
  w.polygon(ring, undefined, h1, cTop);
}

interface Frame {
  cx: number;
  cy: number;
  ux: number;
  uy: number;
  vx: number;
  vy: number;
  L: number;
  W: number;
}

function frameOf(b: CityBuilding, ring: Ring): Frame {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of ring) {
    cx += x;
    cy += y;
  }
  cx /= ring.length;
  cy /= ring.length;
  const ang = b.o[2] / 1000;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  // Re-centre on the oriented box so pitched roofs sit over the footprint.
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const [x, y] of ring) {
    const u = (x - cx) * ux + (y - cy) * uy;
    const v = -(x - cx) * uy + (y - cy) * ux;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const mu = (u0 + u1) / 2;
  const mv = (v0 + v1) / 2;
  return {
    cx: cx + ux * mu - uy * mv,
    cy: cy + uy * mu + ux * mv,
    ux,
    uy,
    vx: -uy,
    vy: ux,
    L: u1 - u0,
    W: v1 - v0,
  };
}

const at = (f: Frame, u: number, v: number, h: number): V3 => [f.cx + f.ux * u + f.vx * v, f.cy + f.uy * u + f.vy * v, h];

/** Gable roof over the frame: ridge along the long axis. */
function gableRoof(w: MeshWriter, f: Frame, eave: number, ridge: number, over: number, roof: RGB, gableC: RGB): void {
  const hl = f.L / 2 + over;
  const hw = f.W / 2 + over;
  const drop = (over / (f.W / 2)) * (ridge - eave);
  const e = eave - drop;
  w.quad(at(f, -hl, -hw, e), at(f, hl, -hw, e), at(f, hl, 0, ridge), at(f, -hl, 0, ridge), roof, shade(roof, 1.05));
  w.quad(at(f, hl, hw, e), at(f, -hl, hw, e), at(f, -hl, 0, ridge), at(f, hl, 0, ridge), roof, shade(roof, 1.05));
  // Gable ends (walls up to the ridge).
  w.tri(at(f, f.L / 2, -f.W / 2, eave), at(f, f.L / 2, f.W / 2, eave), at(f, f.L / 2, 0, ridge), gableC);
  w.tri(at(f, -f.L / 2, f.W / 2, eave), at(f, -f.L / 2, -f.W / 2, eave), at(f, -f.L / 2, 0, ridge), gableC);
}

/** Hip roof over the frame. */
function hipRoof(w: MeshWriter, f: Frame, eave: number, ridge: number, over: number, roof: RGB): void {
  const hl = f.L / 2 + over;
  const hw = f.W / 2 + over;
  const drop = (over / (f.W / 2)) * (ridge - eave);
  const e = eave - drop;
  const rl = Math.max(0, hl - hw);
  const top = shade(roof, 1.06);
  w.quad(at(f, -hl, -hw, e), at(f, hl, -hw, e), at(f, rl, 0, ridge), at(f, -rl, 0, ridge), roof, top);
  w.quad(at(f, hl, hw, e), at(f, -hl, hw, e), at(f, -rl, 0, ridge), at(f, rl, 0, ridge), roof, top);
  w.tri(at(f, hl, -hw, e), at(f, hl, hw, e), at(f, rl, 0, ridge), shade(roof, 0.92), shade(roof, 0.92), top);
  w.tri(at(f, -hl, hw, e), at(f, -hl, -hw, e), at(f, -rl, 0, ridge), shade(roof, 0.92), shade(roof, 0.92), top);
}

// ------------------------------------------------------------------ builder
export function buildCity(city: CityData): BuiltCity {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const w: Record<LayerId, MeshWriter> = {
    backdrop: new MeshWriter(8192),
    ground: new MeshWriter(65536),
    water: new MeshWriter(16384),
    roads: new MeshWriter(262144),
    structures: new MeshWriter(65536),
    buildings: new MeshWriter(524288),
  };
  const [kx0, ky0, kx1, ky1] = city.keep.map((v) => v / 10);
  const occ = new Occupancy(kx0, ky0, kx1, ky1);
  const str = (i: number | undefined) => (i ? city.strings[i] : '');

  // ---- ground: far plain and urban base
  const FAR = 16_000;
  w.ground.polygon(
    [
      [kx0 - FAR, ky0 - FAR],
      [kx1 + FAR, ky0 - FAR],
      [kx1 + FAR, ky1 + FAR],
      [kx0 - FAR, ky1 + FAR],
    ],
    [
      [
        [kx0, ky0],
        [kx0, ky1],
        [kx1, ky1],
        [kx1, ky0],
      ],
    ],
    -0.02,
    P.groundFar,
  );
  w.ground.polygon(
    [
      [kx0, ky0],
      [kx1, ky0],
      [kx1, ky1],
      [kx0, ky1],
    ],
    undefined,
    0,
    P.groundUrban,
  );

  // ---- land cover and water areas
  const AREA_STYLE: Record<string, [RGB, number] | null> = {
    park: [P.grass, 0.03],
    garden: [P.grass, 0.03],
    grass: [P.grass, 0.025],
    golf: [P.grass, 0.03],
    pitch: [P.pitch, 0.035],
    forest: [P.forest, 0.03],
    rural: [P.rural, 0.02],
    cemetery: [P.cemetery, 0.03],
    temple: [P.templeSand, 0.02],
    worship: [P.worship, 0.02],
    campus: [P.campus, 0.015],
    school: [P.campus, 0.017],
    hospital: [P.hospital, 0.015],
    market: [P.market, 0.018],
    parking: [P.parking, 0.04],
    fuel: [P.parking, 0.04],
    plaza: [P.plaza, 0.045],
    apron: [P.apron, 0.035],
    railway: [P.railway, 0.012],
    construction: [P.construction, 0.012],
    playground: [P.playground, 0.04],
    residential: null,
    commercial: null,
    retail: null,
    industrial: null,
  };
  const WATER_STYLE: Record<string, [RGB, number]> = {
    moat: [P.moat, 0.06],
    river: [P.river, 0.055],
    water: [P.pond, 0.06],
    pool: [P.pool, 0.08],
  };
  const parkAreas: { ring: Ring; kind: string }[] = [];
  const moatRings: Ring[] = [];
  for (const a of city.areas) {
    const kind = city.areaKinds[a.k];
    const ring = ringOf(a.r);
    const holes = a.h?.map(ringOf);
    const water = WATER_STYLE[kind];
    if (water) {
      w.water.polygon(ring, holes, water[1], water[0]);
      if (kind === 'moat') moatRings.push(ring);
      continue;
    }
    const style = AREA_STYLE[kind];
    if (!style) continue;
    w.ground.polygon(ring, holes, style[1], style[0]);
    if (['park', 'garden', 'grass', 'golf', 'forest', 'cemetery', 'temple', 'campus', 'school', 'hospital'].includes(kind)) parkAreas.push({ ring, kind });
  }

  // ---- linear features
  for (const l of city.lines) {
    const kind = city.lineKinds[l.k];
    const pts = ringOf(l.p);
    const width = l.w ? l.w / 10 : 0;
    switch (kind) {
      case 'river':
        w.water.ribbon(pts, (width || 30) / 2, 0.055, P.river, 2);
        break;
      case 'canal':
        w.water.ribbon(pts, (width || 6) / 2, 0.058, P.pond, 1);
        break;
      case 'stream':
      case 'drain':
        w.water.ribbon(pts, (width || 2.5) / 2, 0.058, P.pond, 0.5);
        break;
      case 'rail':
        w.ground.ribbon(pts, 1.6, 0.05, P.ballast);
        w.ground.ribbon(offset(pts, 0.72), 0.07, 0.09, P.rail);
        w.ground.ribbon(offset(pts, -0.72), 0.07, 0.09, P.rail);
        break;
      case 'runway':
        w.roads.ribbon(pts, (width || 45) / 2, 0.06, P.runway, 10);
        dashes(w.roads, pts, 0.45, 0.08, P.laneWhite, 30, 20);
        break;
      case 'taxiway':
        w.roads.ribbon(pts, (width || 23) / 2, 0.055, P.runway, 5);
        dashes(w.roads, pts, 0.15, 0.075, P.laneYellow, 1000, 0);
        break;
      case 'city_wall':
        cityWall(w.structures, pts, !!l.closed, occ);
        break;
      case 'wall':
        wallLine(w.structures, pts, 0.3, 2, P.stuccoWhite);
        break;
      case 'fence':
        wallLine(w.structures, pts, 0.08, 1.5, P.fence);
        break;
      case 'hedge':
        wallLine(w.structures, pts, 0.8, 1.2, P.hedge);
        break;
      case 'footway':
      case 'steps':
        w.ground.ribbon(pts, (width || 1.8) / 2, 0.042, P.pavement);
        break;
      default:
        break;
    }
  }

  // ---- roads
  const rn = city.roads.nodes;
  const CLASS_Y = [0.13, 0.126, 0.122, 0.118, 0.114, 0.11, 0.106, 0.102];
  const roadPts: Ring[] = [];
  for (const way of city.roads.ways) {
    const [cls, flags, widthDm, lanes, , surface] = way;
    const refs = way.slice(7);
    const pts: Ring = refs.map((n) => [rn[2 * n] / 10, rn[2 * n + 1] / 10]);
    roadPts.push(pts);
    const half = widthDm / 20;
    const hasWalk = cls <= 3 || (flags & (ROAD_FLAG.SIDEWALK_L | ROAD_FLAG.SIDEWALK_R)) !== 0;
    if (hasWalk && !(flags & ROAD_FLAG.BRIDGE)) w.roads.ribbon(pts, half + 1.8, 0.07, P.pavement, 1);
    const surf = surface === 1 ? P.concreteRoad : surface === 3 ? P.unpaved : cls >= 5 ? P.asphaltOld : P.asphalt;
    w.roads.ribbon(pts, half, CLASS_Y[cls] ?? 0.1, surf, half * 0.9);
    // Centre line on two-way roads wide enough to have one.
    if (!(flags & ROAD_FLAG.ONEWAY) && (lanes >= 2 || cls <= 2) && half >= 3) {
      if (cls <= 1) {
        w.roads.ribbon(offset(pts, 0.12), 0.06, 0.15, P.laneYellow);
        w.roads.ribbon(offset(pts, -0.12), 0.06, 0.15, P.laneYellow);
      } else dashes(w.roads, pts, 0.07, 0.15, P.laneWhite, 3, 6);
    } else if (flags & ROAD_FLAG.ONEWAY && lanes >= 2) {
      dashes(w.roads, pts, 0.06, 0.15, P.laneWhite, 3, 6);
    }
    // Carriageway occupancy for scattering.
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const len = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.ceil(len / 2));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        occ.markDisc(ax + (bx - ax) * t, ay + (by - ay) * t, half + (hasWalk ? 1.5 : 0.5));
      }
    }
  }

  // ---- buildings
  const templeMain = new Map<number, number>();
  city.buildings.forEach((b, i) => {
    if (b.t === undefined) return;
    const L = b.o[0] / 10;
    const W = b.o[1] / 10;
    if (W < 6 || W > 26 || L / W < 1.4) return;
    const prev = templeMain.get(b.t);
    if (prev === undefined || city.buildings[prev].a < b.a) templeMain.set(b.t, i);
  });
  const hasChedi = new Set<number>();
  let built = 0;
  city.buildings.forEach((b, i) => {
    const ring = ringOf(b.r);
    if (ring.length < 3) return;
    occ.markRing(ring, 0.5);
    const kind = str(b.b);
    const use = str(b.u);
    const tower = str(b.tt);
    const L = b.o[0] / 10;
    const W = b.o[1] / 10;
    const isChedi =
      tower === 'pagoda' || use === 'stupa' || (b.t !== undefined && W >= 4 && W <= 62 && L / Math.max(W, 0.1) <= 1.25 && ring.length >= 8);
    if (isChedi) {
      chedi(w.buildings, b, ring, str(b.c));
      if (b.t !== undefined) hasChedi.add(b.t);
      built++;
      return;
    }
    if (b.t !== undefined && templeMain.get(b.t) === i) {
      viharn(w.buildings, b, ring);
      built++;
      return;
    }
    building(w.buildings, b, ring, kind, use, city.zones[b.z] ?? 'suburb', b.t !== undefined, str(b.c), str(b.rc));
    built++;
  });

  // Temples with no mapped chedi get one behind the main hall.
  for (const [ti, bi] of templeMain) {
    if (hasChedi.has(ti)) continue;
    const b = city.buildings[bi];
    const ring = ringOf(b.r);
    const f = frameOf(b, ring);
    // The hall faces its street; place the chedi off the rear gable.
    const back = f.L / 2 + 6 + f.W * 0.35;
    const [x, y] = at(f, -back, 0, 0);
    if (!occ.free(x, y)) continue;
    chedi(w.buildings, { ...b, a: (f.W * 0.7) ** 2 }, [[x, y]], '', f.W * 0.7);
    occ.markDisc(x, y, f.W * 0.4);
  }

  // ---- Doi Suthep and the western hills (backdrop, not drivable)
  mountains(w.backdrop, city);

  // ---- trees
  const trees: number[] = [];
  const addTree = (x: number, y: number, kind: TreeKind, scale: number) => {
    trees.push(x, y, scale, TREE_KINDS.indexOf(kind));
    occ.markDisc(x, y, 2.5);
  };
  for (let i = 0; i < city.trees.length; i += 3) {
    const x = city.trees[i] / 10;
    const y = city.trees[i + 1] / 10;
    const sp = city.species[city.trees[i + 2]] ?? '';
    const kind: TreeKind = /Albizia|Samanea/.test(sp) ? 'rain' : /Dipterocarpus/.test(sp) ? 'yang' : /Ficus/.test(sp) ? 'bodhi' : 'round';
    addTree(x, y, kind, 0.85 + hash01(i, 7) * 0.4);
  }
  for (const l of city.lines) {
    if (city.lineKinds[l.k] !== 'tree_row') continue;
    alongLine(ringOf(l.p), 9, (x, y, n) => {
      if (occ.free(x, y)) addTree(x, y, hash01(n, 3) < 0.3 ? 'palm' : 'rain', 0.8 + hash01(n, 5) * 0.4);
    });
  }
  // Moat banks: a tree every ~12 m just outside the water.
  let seed = 1;
  for (const ring of moatRings) {
    for (const side of [-4.5, 4.5]) {
      alongLine([...ring, ring[0]], 12, (x, y, n, nx, ny) => {
        const px = x + nx * side;
        const py = y + ny * side;
        if (occ.free(px, py) && !moatRings.some((r) => pointInRing(px, py, r))) {
          const u = hash01(n + seed * 7919, 11);
          addTree(px, py, u < 0.35 ? 'rain' : u < 0.55 ? 'palm' : u < 0.7 ? 'bodhi' : 'round', 0.75 + hash01(n, 13) * 0.45);
        }
      });
      seed++;
    }
  }
  // Parks, temple grounds, campuses: jittered grid.
  for (const { ring, kind } of parkAreas) {
    const spacing = kind === 'forest' ? 11 : kind === 'temple' ? 14 : kind === 'campus' || kind === 'school' || kind === 'hospital' ? 20 : kind === 'cemetery' ? 14 : 13;
    const [x0, y0, x1, y1] = bbox(ring);
    if ((x1 - x0) * (y1 - y0) > 4e6) continue;
    let n = 0;
    for (let y = y0; y <= y1; y += spacing) {
      for (let x = x0; x <= x1; x += spacing) {
        n++;
        const jx = x + (hash01(n + Math.round(x0), 17) - 0.5) * spacing * 0.8;
        const jy = y + (hash01(n + Math.round(y0), 19) - 0.5) * spacing * 0.8;
        if (!pointInRing(jx, jy, ring) || !occ.free(jx, jy)) continue;
        if (hash01(n, 23) < (kind === 'forest' ? 0.15 : 0.35)) continue;
        const u = hash01(n + Math.round(x0 * 3), 29);
        const tk: TreeKind = kind === 'temple' ? (u < 0.3 ? 'bodhi' : u < 0.5 ? 'palm' : 'round') : u < 0.45 ? 'rain' : u < 0.6 ? 'palm' : 'round';
        addTree(jx, jy, tk, 0.7 + hash01(n, 31) * 0.5);
      }
    }
  }
  // Street trees on major roads.
  city.roads.ways.forEach((way, wi) => {
    const [cls, flags, widthDm] = way;
    if (cls > 2 || flags & ROAD_FLAG.BRIDGE) return;
    const pts = roadPts[wi];
    const side = widthDm / 20 + 2.6;
    alongLine(pts, 18, (x, y, n, nx, ny) => {
      for (const s of [side, -side]) {
        const px = x + nx * s;
        const py = y + ny * s;
        if (hash01(n * 2 + (s > 0 ? 1 : 0) + wi * 131, 37) < 0.55 && occ.free(px, py)) {
          addTree(px, py, hash01(n + wi, 41) < 0.3 ? 'palm' : 'rain', 0.7 + hash01(n, 43) * 0.35);
        }
      }
    });
  });

  const layers = {} as Record<LayerId, PackedMesh>;
  const triangles = {} as Record<LayerId, number>;
  for (const id of LAYERS) {
    layers[id] = w[id].pack();
    triangles[id] = w[id].triangleCount;
  }
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return { layers, trees: new Float32Array(trees), stats: { triangles, trees: trees.length / 4, buildings: built, ms } };
}

// ------------------------------------------------------------------ pieces
function offset(pts: Ring, d: number): Ring {
  return pts.map(([x, y], i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [x - (dy / l) * d, y + (dx / l) * d];
  });
}

/** Walk a polyline every `step` metres, calling fn with the point and the left normal. */
function alongLine(pts: Ring, step: number, fn: (x: number, y: number, n: number, nx: number, ny: number) => void): void {
  let carry = step / 2;
  let n = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) continue;
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;
    let d = carry;
    while (d < len) {
      fn(ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len, n++, nx, ny);
      d += step;
    }
    carry = d - len;
  }
}

function dashes(w: MeshWriter, pts: Ring, half: number, h: number, c: RGB, dash: number, gap: number): void {
  if (gap <= 0) {
    w.ribbon(pts, half, h, c);
    return;
  }
  let on = true;
  let left = dash;
  let seg: Ring = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    let [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    let len = Math.hypot(bx - ax, by - ay);
    while (len > 1e-6) {
      const take = Math.min(left, len);
      const t = take / len;
      const px = ax + (bx - ax) * t;
      const py = ay + (by - ay) * t;
      if (on) seg.push([px, py]);
      left -= take;
      len -= take;
      ax = px;
      ay = py;
      if (left <= 1e-6) {
        if (on && seg.length >= 2) w.ribbon(seg, half, h, c);
        on = !on;
        left = on ? dash : gap;
        seg = [[ax, ay]];
      }
    }
    if (on) seg.push([bx, by]);
  }
  if (on && seg.length >= 2) w.ribbon(seg, half, h, c);
}

function wallLine(w: MeshWriter, pts: Ring, thick: number, height: number, c: RGB): void {
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 0.3) continue;
    box(w, (ax + bx) / 2, (ay + by) / 2, len + thick * 0.5, thick, 0, height, Math.atan2(by - ay, bx - ax), c, shade(c, 1.05));
  }
}

/** Brick city wall with merlons; polygons are bastions extruded whole. */
function cityWall(w: MeshWriter, pts: Ring, closed: boolean, occ: Occupancy): void {
  if (closed && pts.length >= 3) {
    const ring = pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] ? pts.slice(0, -1) : pts;
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    const ccw = area > 0 ? ring : [...ring].reverse();
    w.walls(ccw, 0, 5.2, shade(P.brickOld, 0.85), P.brickOld);
    w.polygon(ccw, undefined, 5.2, shade(P.brickOld, 1.08));
    occ.markRing(ccw, 1);
    return;
  }
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 0.5) continue;
    const ang = Math.atan2(by - ay, bx - ax);
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    box(w, mx, my, len + 1, 2.8, 0, 4.8, ang, shade(P.brickOld, 0.9), P.brickOld);
    const n = Math.floor(len / 2.2);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      box(w, ax + (bx - ax) * t, ay + (by - ay) * t, 1.1, 2.8, 4.8, 5.7, ang, P.brickOld, shade(P.brickOld, 1.1));
    }
    const steps = Math.ceil(len / 2);
    for (let s = 0; s <= steps; s++) occ.markDisc(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps, 2);
  }
}

/** Storey count for an untagged building (docs/3d/world.md §2.4). */
function storeys(b: CityBuilding, kind: string, use: string, zone: string, shophouse: boolean): number {
  if (b.l) return b.l;
  const u = hash01(b.id, 1);
  if (kind === 'house' || kind === 'detached' || kind === 'bungalow') return u < 0.4 ? 1 : 2;
  if (kind === 'roof') return 1;
  if (kind === 'apartments' || kind === 'dormitory') return b.a > 600 ? 5 + Math.floor(u * 4) : 3 + Math.floor(u * 3);
  if (kind === 'hotel' || use === 'hotel') return b.a > 800 ? 5 + Math.floor(u * 4) : 3 + Math.floor(u * 2);
  if (kind === 'school' || kind === 'university' || kind === 'college') return 2 + Math.floor(u * 2);
  if (kind === 'hospital') return 3 + Math.floor(u * 4);
  if (kind === 'retail' || kind === 'commercial') return b.a > 2500 ? 3 : 2 + Math.floor(u * 2);
  if (b.a > 2500) return 2 + Math.floor(u * 2);
  if (shophouse) {
    if (zone === 'old_city' || zone === 'wua_lai' || zone === 'moat_ring') return u < 0.45 ? 2 : u < 0.85 ? 3 : 4;
    if (zone === 'nimman' || zone === 'night_bazaar' || zone === 'santitham' || zone === 'tha_phae') return u < 0.15 ? 2 : u < 0.65 ? 3 : 4;
    if (zone === 'wat_ket' || zone === 'chinatown') return u < 0.6 ? 2 : 3;
    return u < 0.5 ? 2 : 3;
  }
  if (b.a < 40) return 1;
  if (b.a < 250) return u < 0.4 ? 1 : 2;
  if (b.a < 800) {
    if (zone === 'nimman' || zone === 'santitham' || zone === 'suan_dok') return 3 + Math.floor(u * 3);
    return 2 + Math.floor(u * 2);
  }
  if (zone === 'nimman' || zone === 'night_bazaar' || zone === 'santitham' || zone === 'suan_dok') return 5 + Math.floor(u * 4);
  return 2 + Math.floor(u * 2);
}

function building(w: MeshWriter, b: CityBuilding, ring: Ring, kind: string, use: string, zone: string, inTemple: boolean, colour: string, roofColour: string): void {
  const L = b.o[0] / 10;
  const W = b.o[1] / 10;
  const shophouse = b.f !== undefined && W >= 3 && W <= 30 && L <= 60 && zone !== 'suburb' && zone !== 'airport' && !inTemple && kind !== 'house';
  const canopy = kind === 'roof';
  const n = storeys(b, kind, use, zone, shophouse);
  const commercial = shophouse || kind === 'retail' || kind === 'commercial';
  let h = b.ht ? b.ht / 10 : (commercial ? 4 : 3) + (n - 1) * 3.1;
  // Old City height limits (Citylife "In the zone"): 12 m untagged.
  if (!b.ht && !b.l && (zone === 'old_city' || zone === 'moat_ring')) h = Math.min(h, 12);
  const base = b.mh ? b.mh / 10 : 0;
  const u = hash01(b.id, 2);
  let wall: RGB;
  if (colour && /^#?[0-9a-f]{6}$/i.test(colour)) wall = hexOf(colour);
  else if (inTemple) wall = P.wallCream;
  else if (zone === 'nimman' || zone === 'santitham' || n >= 5) wall = pickWeighted(MODERN_WALLS, u);
  else wall = pickWeighted(WALLS, u);
  const grime = shade(wall, 0.78);
  const topC = shade(wall, 1.04);

  if (canopy) {
    // Open-sided roof on posts.
    const f = frameOf(b, ring);
    const posts = [
      [-0.45, -0.45],
      [0.45, -0.45],
      [0.45, 0.45],
      [-0.45, 0.45],
    ];
    for (const [pu, pv] of posts) {
      const [x, y] = at(f, pu * f.L, pv * f.W, 0);
      box(w, x, y, 0.25, 0.25, 0, 3.2, 0, P.fence);
    }
    gableRoof(w, f, 3.2, 3.2 + Math.min(2.5, f.W * 0.18), 0.3, pickWeighted(PITCHED_ROOFS, u), P.fence);
    return;
  }

  // Walls, with a darker ground-floor shutter band on the street front.
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    if (i === b.f && shophouse && h > 4.5) {
      const shut = hash01(b.id, 5) < 0.3 ? P.shutterBlue : P.shutter;
      w.quad([ax, ay, base], [bx, by, base], [bx, by, base + 3.4], [ax, ay, base + 3.4], shade(shut, 0.8), shut);
      const sign = SIGNS[Math.floor(hash01(b.id, 6) * SIGNS.length)];
      w.quad([ax, ay, base + 3.4], [bx, by, base + 3.4], [bx, by, base + 4.1], [ax, ay, base + 4.1], sign, sign);
      w.quad([ax, ay, base + 4.1], [bx, by, base + 4.1], [bx, by, base + h], [ax, ay, base + h], wall, topC);
    } else {
      w.quad([ax, ay, base], [bx, by, base], [bx, by, base + h], [ax, ay, base + h], grime, topC);
    }
  }

  // Roof.
  const f = frameOf(b, ring);
  const simple = ring.length <= 6 && f.W <= 16 && f.L <= 40;
  const pitched = roofColour || b.rs === 2 || b.rs === 3 || (simple && !shophouse && (zone === 'suburb' || kind === 'house' || inTemple || zone === 'wat_ket' || zone === 'airport') && n <= 3);
  if (pitched && simple) {
    const roof = roofColour && /^#?[0-9a-f]{6}$/i.test(roofColour) ? hexOf(roofColour) : inTemple ? P.templeRoofOrange : pickWeighted(PITCHED_ROOFS, hash01(b.id, 3));
    // Cap the eaves at the footprint so the walls don't poke through.
    w.polygon(ring, undefined, base + h, shade(wall, 0.9));
    const ridge = base + h + Math.min(4, f.W * 0.35);
    if (b.rs === 2 || (b.rs !== 3 && hash01(b.id, 4) < 0.4)) gableRoof(w, f, base + h, ridge, 0.6, roof, wall);
    else hipRoof(w, f, base + h, ridge, 0.6, roof);
    return;
  }
  const roofC = shade(mix(wall, [184, 178, 168], 0.6), 0.95);
  w.polygon(ring, undefined, base + h, roofC);
  // Parapet on flat-roofed shophouses and blocks.
  if (h >= 5 && ring.length <= 12) {
    w.walls(ring, base + h, base + h + 0.8, topC, topC);
  }
  // Rooftop water tank on most shophouses.
  if ((shophouse || n <= 4) && hash01(b.id, 8) < 0.7 && f.W > 3.5 && f.L > 5) {
    const [tx, ty] = at(f, f.L * (hash01(b.id, 9) - 0.5) * 0.5, f.W * (hash01(b.id, 10) - 0.5) * 0.4, 0);
    const tank = hash01(b.id, 11) < 0.5 ? P.tankSteel : P.tankBlue;
    box(w, tx, ty, 1.2, 1.2, base + h, base + h + 0.9, 0, shade(P.fence, 0.8));
    frustum(w, tx, ty, 0.55, 0.55, base + h + 0.9, base + h + 2.1, 8, tank);
  }
}

function hexOf(c: string): RGB {
  const v = parseInt(c.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Lanna assembly hall: low white walls, steep two-tier roof, gold finials. */
function viharn(w: MeshWriter, b: CityBuilding, ring: Ring): void {
  const f = frameOf(b, ring);
  const wallH = 3.6;
  w.walls(ring, 0, 1, shade(P.templeWhite, 0.85), P.templeWhite);
  w.walls(ring, 1, wallH, P.templeWhite, P.templeWhite);
  w.polygon(ring, undefined, wallH, P.templeWhite);
  const roofRed = hash01(b.id, 2) < 0.5 ? P.templeRoofRed : P.templeRoofOrange;
  // Lower sweeping eave skirt.
  const skirt: Frame = { ...f, L: f.L + 1.2, W: f.W + 2.4 };
  hipRoof(w, skirt, wallH - 0.8, wallH + f.W * 0.3, 0.6, shade(roofRed, 0.9));
  // Main tier and a shorter, higher upper tier.
  const main: Frame = { ...f, L: f.L * 0.92, W: f.W * 0.86 };
  gableRoof(w, main, wallH + f.W * 0.18, wallH + f.W * 0.62, 0.4, roofRed, P.lacquerRed);
  const upper: Frame = { ...f, L: f.L * 0.55, W: f.W * 0.62 };
  gableRoof(w, upper, wallH + f.W * 0.42, wallH + f.W * 0.8, 0.3, shade(roofRed, 1.1), P.gold);
  // Gold chofa finials at the gable peaks.
  for (const s of [-1, 1]) {
    const [x, y] = at(f, (s * main.L) / 2 + s * 0.3, 0, 0);
    frustum(w, x, y, 0.25, 0.02, wallH + f.W * 0.62, wallH + f.W * 0.62 + 2.2, 4, P.gold, false);
    const [x2, y2] = at(f, (s * upper.L) / 2 + s * 0.2, 0, 0);
    frustum(w, x2, y2, 0.2, 0.02, wallH + f.W * 0.8, wallH + f.W * 0.8 + 1.8, 4, P.gold, false);
  }
}

/**
 * Chedi (stupa) on a square base: stepped plinth, octagonal drum, bell, and a
 * ringed spire. Finish by hash: white with gold spire, all gold, weathered, or
 * ruined brick (Wat Chedi Luang style for very large, brown-tagged footprints).
 */
function chedi(w: MeshWriter, b: CityBuilding, ring: Ring, colour: string, sizeOverride?: number): void {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of ring) {
    cx += x;
    cy += y;
  }
  cx /= ring.length;
  cy /= ring.length;
  const s = sizeOverride ?? Math.sqrt(Math.max(9, b.a));
  const u = hash01(b.id, 12);
  const ruin = s > 40 || /^#?b79f7b$/i.test(colour) || u > 0.9;
  const finish = ruin ? 'ruin' : u < 0.45 ? 'white' : u < 0.75 ? 'gold' : 'weathered';
  const body = finish === 'gold' ? P.gold : finish === 'ruin' ? hexOf('#9b6b4f') : finish === 'weathered' ? hexOf('#cfcabd') : P.templeWhite;
  const spire = finish === 'ruin' ? hexOf('#8f5d43') : P.gold;
  const ang = b.o ? b.o[2] / 1000 : 0;
  let h = 0;
  const tier = (frac: number, hh: number, c: RGB) => {
    box(w, cx, cy, s * frac, s * frac, h, h + hh, ang, shade(c, 0.9), c);
    h += hh;
  };
  tier(1, s * 0.1, body);
  tier(0.86, s * 0.1, body);
  tier(0.72, s * 0.09, body);
  if (finish === 'ruin' && s > 40) {
    // Wat Chedi Luang: huge truncated brick mass with stepped terraces.
    tier(0.6, s * 0.12, body);
    tier(0.48, s * 0.1, body);
    frustum(w, cx, cy, s * 0.22, s * 0.14, h, h + s * 0.12, 8, shade(body, 1.05), true, Math.PI / 8);
    return;
  }
  frustum(w, cx, cy, s * 0.3, s * 0.3, h, h + s * 0.12, 8, body, false, Math.PI / 8);
  h += s * 0.12;
  // Bell.
  frustum(w, cx, cy, s * 0.3, s * 0.26, h, h + s * 0.14, 8, body, false, Math.PI / 8);
  frustum(w, cx, cy, s * 0.26, s * 0.12, h + s * 0.14, h + s * 0.32, 8, body, false, Math.PI / 8);
  h += s * 0.32;
  box(w, cx, cy, s * 0.2, s * 0.2, h, h + s * 0.06, ang, body, body);
  h += s * 0.06;
  // Ringed spire.
  frustum(w, cx, cy, s * 0.09, s * 0.015, h, h + s * 0.85, 8, spire, false, Math.PI / 8);
  for (let k = 0; k < 5; k++) frustum(w, cx, cy, s * (0.1 - k * 0.014), s * (0.1 - k * 0.014), h + k * s * 0.07, h + k * s * 0.07 + s * 0.025, 8, shade(spire, 1.1), true, Math.PI / 8);
}

/** Procedural Doi Suthep–Doi Pui massif west of the city (docs/3d/world.md §1.8). */
function mountains(w: MeshWriter, city: CityData): void {
  const o = city.origin;
  const mPerLon = 111_320 * Math.cos((o.lat * Math.PI) / 180);
  const xy = (lon: number, lat: number): [number, number] => [(lon - o.lon) * mPerLon, (lat - o.lat) * 110_574];
  // [lon, lat, height above the city (m), sigma (m)]
  const peaks: [number, number, number, number][] = [
    [98.8975, 18.8065, 1366, 2600], // Doi Suthep summit, 1,676 m
    [98.8855, 18.8275, 1375, 2300], // Doi Pui, 1,685 m
    [98.905, 18.772, 950, 2600],
    [98.89, 18.86, 1000, 3000],
    [98.9, 18.74, 700, 3000],
    [98.93, 18.83, 350, 1500],
  ].map(([lon, lat, h, s]) => [...xy(lon, lat), h, s] as [number, number, number, number]);
  const [cityWest] = xy(98.938, 18.79);
  const height = (x: number, y: number) => {
    let h = 0;
    for (const [px, py, ph, s] of peaks) h += ph * Math.exp(-((x - px) ** 2 + (y - py) ** 2) / (2 * s * s));
    // Rolling foothills.
    h += 60 * Math.sin(x / 900) * Math.cos(y / 1100) + 40 * Math.sin((x + y) / 530);
    const fade = Math.min(1, Math.max(0, (cityWest - x) / 1800));
    return Math.max(0, h * fade * fade) - 0.5;
  };
  const x0 = cityWest - 13_000;
  const x1 = cityWest + 400;
  const y0 = -14_000;
  const y1 = 16_000;
  const nx = 60;
  const ny = 120;
  const dx = (x1 - x0) / nx;
  const dy = (y1 - y0) / ny;
  const colour = (h: number): RGB => (h > 700 ? P.mountainHigh : mix(P.groundFar, P.mountain, Math.min(1, h / 250)));
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const ax = x0 + i * dx;
      const ay = y0 + j * dy;
      const p00: V3 = [ax, ay, height(ax, ay)];
      const p10: V3 = [ax + dx, ay, height(ax + dx, ay)];
      const p11: V3 = [ax + dx, ay + dy, height(ax + dx, ay + dy)];
      const p01: V3 = [ax, ay + dy, height(ax, ay + dy)];
      if (p00[2] <= 0 && p10[2] <= 0 && p11[2] <= 0 && p01[2] <= 0) continue;
      const c = colour((p00[2] + p11[2]) / 2);
      w.tri(p00, p10, p11, c);
      w.tri(p00, p11, p01, shade(c, 0.96));
    }
  }
  // Gold glint of Wat Phra That Doi Suthep on its ledge (1,060 m).
  const [tx, ty] = xy(98.9221, 18.80492);
  const th = height(tx, ty);
  frustum(w, tx, ty, 9, 0.5, th, th + 26, 8, P.gold, false);
}
