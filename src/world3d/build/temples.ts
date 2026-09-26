// Temple grounds (docs/3d/world.md §1.3, §2.5): role inference for the
// footprints inside each ground (viharn facing its street, ubosot with sema
// stones, chedi, ho trai, sala, halls, kuti, schools, shrines), synthesis of a
// viharn or chedi where none is mapped, Lanna halls with stepped multi-tier
// roofs, chofa, naga bargeboards and gable faces, the whitewashed compound
// wall with lotus-bud posts, an arch gate with singha lions, tung flags, a
// bell tower, and a bodhi spot left for the tree scatter ('bodhi_spot' prop).

import { ringOf, type CityData } from '../city';
import { BC } from './buildingPalette';
import { chedi, chediStyle, miniChedi, type ChediSpec } from './chedi';
import { addProp, type BuildContext, type TempleInfo } from './context';
import { chediLuang } from './heroChedis';
import { basis, bdir, beam, bp, cbox, centroid, edgeOf, face, insetRing, lathe, obox, ringArea, ringDist, SIDE, tri3, UP, type Basis } from './kit';
import { TEMPLE_HEROES, type Facing, type HallStyleName, type TempleHero } from './landmarks3d';
import { obbOf } from './massing';
import { hash01, mix, shade, type MeshWriter, type RGB } from './mesh';
import { RoadIndex } from './roadIndex';
import { pointInRing, type Ring } from './shapes';
import { siteOf, simplePlan, type BuildEnv, type Site } from './site';
import { chineseShrine, house, school } from './typologies';

// ------------------------------------------------------------------ grounds

export interface TempleGround {
  ti: number;
  ring: Ring;
  name: string;
  id: number;
  rel: string;
  area: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  buddhist: boolean;
}

const NON_BUDDHIST = /shrine|chinese|foundation|association|ศาลเจ้า|สมาคม|มูลนิธิ|church|mosque/i;

/** Temple grounds from the baked areas, indexed by temple index (b.t). */
export function groundsOf(city: CityData): TempleGround[] {
  const out: TempleGround[] = [];
  const str = (i: number | undefined) => (i ? city.strings[i] : '');
  for (const a of city.areas) {
    if (city.areaKinds[a.k] !== 'temple' || a.ti === undefined) continue;
    const ring = ringOf(a.r);
    if (ringArea(ring) < 0) ring.reverse();
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
    const [cx, cy] = centroid(ring);
    const name = str(a.n);
    const rel = str(a.rel);
    out[a.ti] = { ti: a.ti, ring, name, id: a.id ?? 0, rel, area: ringArea(ring), x0, y0, x1, y1, cx, cy, buddhist: (rel === '' || rel === 'buddhist') && !NON_BUDDHIST.test(name) };
  }
  return out.filter(Boolean);
}

/** Grounds sharing a name within 250 m form one temple; the largest leads. */
export function templeGroups(grounds: TempleGround[]): TempleGround[][] {
  const groups: TempleGround[][] = [];
  const used = new Set<number>();
  const sorted = [...grounds].sort((a, b) => b.area - a.area);
  for (const g of sorted) {
    if (used.has(g.ti)) continue;
    used.add(g.ti);
    const group = [g];
    if (g.name) {
      for (const o of sorted) {
        if (used.has(o.ti) || o.name !== g.name) continue;
        if (Math.hypot(o.cx - g.cx, o.cy - g.cy) > 250) continue;
        used.add(o.ti);
        group.push(o);
      }
    }
    groups.push(group);
  }
  return groups;
}

// ------------------------------------------------------------------ roles

export type TempleRole = 'viharn' | 'ubosot' | 'chedi' | 'ho_trai' | 'sala' | 'hall' | 'kuti' | 'school' | 'shrine';

export interface HallPlan {
  /** Centre and axis (u points to the front), length along u, width. */
  b: Basis;
  L: number;
  W: number;
  bi: number | null;
  style: HallStyleName;
}

export interface TemplePlan {
  group: TempleGround[];
  hero: TempleHero | null;
  members: number[];
  roles: Map<number, TempleRole>;
  viharn: HallPlan;
  ubosot: HallPlan | null;
  chedi: ChediSpec & { bi: number | null; luang: boolean };
  /** Unit vector towards the street side. */
  front: [number, number];
  gate: { x: number; y: number; ang: number } | null;
  bodhi: [number, number] | null;
}

const FACING: Record<Facing, [number, number]> = { east: [1, 0], west: [-1, 0], north: [0, 1], south: [0, -1] };

function pinned(s: Site, str: (i: number | undefined) => string): TempleRole | null {
  const n = s.name;
  if (/วิหาร|viharn|wihan|vihara|wiharn/i.test(n)) return 'viharn';
  if (/อุโบสถ|โบสถ์|ubosot|ordination/i.test(n)) return 'ubosot';
  if (/เจดีย์|พระธาตุ|stupa|pagoda|chedi|phra that/i.test(n) || s.use === 'stupa' || /pagoda|stupa/.test(str(s.b.tt))) return 'chedi';
  if (/หอไตร|ho trai|library/i.test(n)) return 'ho_trai';
  if (/ศาลา|sala/i.test(n)) return 'sala';
  if (s.kind === 'school' || /school|kindergarten|college/.test(s.use) || /school|โรงเรียน/i.test(n)) return 'school';
  if (/shrine|ศาล|pillar/i.test(n)) return 'shrine';
  return null;
}

function chediLike(s: Site): boolean {
  const aspect = s.L / Math.max(s.W, 0.1);
  if (aspect > 1.25 || s.W < 4 || s.W > 62) return false;
  let per = 0;
  for (let i = 0; i < s.ring.length; i++) {
    const [ax, ay] = s.ring[i];
    const [bx, by] = s.ring[(i + 1) % s.ring.length];
    per += Math.hypot(bx - ax, by - ay);
  }
  const circ = (4 * Math.PI * s.area) / (per * per);
  return s.ring.length >= 8 || circ > 0.8;
}

const elongated = (s: Site, wMin: number, wMax: number, lMin: number, lMax: number) => {
  const r = s.L / Math.max(s.W, 0.1);
  return r >= 1.6 && r <= 3.5 && s.W >= wMin && s.W <= wMax && s.L >= lMin && s.L <= lMax;
};

/** Street direction for a temple: outward normal of the ground edge nearest a tertiary-or-larger road. */
export function streetSide(ring: Ring, roads: RoadIndex): [number, number] {
  let best = Infinity;
  let dir: [number, number] = [1, 0];
  for (const maxCls of [3, 5]) {
    for (let i = 0; i < ring.length; i++) {
      const e = edgeOf(ring, i);
      if (e.len < 4) continue;
      for (const t of [0.25, 0.5, 0.75]) {
        const x = e.ax + e.tx * e.len * t + e.nx * 2;
        const y = e.ay + e.ty * e.len * t + e.ny * 2;
        const hit = roads.nearest(x, y, maxCls === 3 ? 40 : 30, maxCls);
        if (hit && hit.d < best) {
          best = hit.d;
          dir = [e.nx, e.ny];
        }
      }
    }
    if (best < Infinity) break;
  }
  return dir;
}

/** Hall plan on a mapped footprint, facing the end nearest `front`. */
function hallOn(s: Site, front: [number, number], style: HallStyleName): HallPlan {
  const o = obbOf(s.ring, s.b.o[2]);
  const dot = o.b.ux * front[0] + o.b.uy * front[1];
  const sgn = dot >= 0 ? 1 : -1;
  return { b: { ox: o.b.ox, oy: o.b.oy, ux: o.b.ux * sgn, uy: o.b.uy * sgn }, L: o.L, W: o.W, bi: s.i, style };
}

interface Blocker {
  ring: Ring;
}

/** Is a rectangle (centre, axis, size) inside the ground and clear of buildings and roads? */
function rectFree(b: Basis, L: number, W: number, group: TempleGround[], blockers: Blocker[], roads: RoadIndex, margin: number): boolean {
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      const [x, y] = bp(b, (i / 2) * (L / 2 + margin), (j / 2) * (W / 2 + margin), 0);
      if (!group.some((g) => pointInRing(x, y, g.ring) && ringDist(x, y, g.ring) >= 1)) return false;
      for (const bl of blockers) if (pointInRing(x, y, bl.ring)) return false;
      if (roads.onCarriageway(x, y, 1)) return false;
    }
  }
  return true;
}

function rectRing(b: Basis, L: number, W: number): Ring {
  return [
    [-L / 2, -W / 2],
    [L / 2, -W / 2],
    [L / 2, W / 2],
    [-L / 2, W / 2],
  ].map(([u, v]) => {
    const p = bp(b, u, v, 0);
    return [p[0], p[1]] as [number, number];
  });
}

/** Infer roles and place (or synthesise) the viharn, ubosot, main chedi, gate and bodhi spot. */
export function planTemple(city: CityData, env: BuildEnv, group: TempleGround[], roads: RoadIndex): TemplePlan {
  const g = group[0];
  const tis = new Set(group.map((x) => x.ti));
  const members: number[] = [];
  city.buildings.forEach((b, i) => {
    if (b.t !== undefined && tis.has(b.t) && !b.part) members.push(i);
  });
  const hero = TEMPLE_HEROES.find((h) => group.some((x) => x.id === h.ground)) ?? null;
  const sites = members.map((i) => siteOf(city, i)).filter((s) => s.ring.length >= 3);
  const byId = (id: number | undefined) => (id === undefined ? undefined : sites.find((s) => s.b.id === id));
  const roles = new Map<number, TempleRole>();
  for (const s of sites) {
    const p = pinned(s, env.str);
    if (p) roles.set(s.i, p);
  }
  const front: [number, number] = hero?.front ? FACING[hero.front] : streetSide(g.ring, roads);
  const blockers: Blocker[] = sites.map((s) => ({ ring: s.ring }));

  // Main chedi.
  let chediSite = byId(hero?.chedi);
  if (!chediSite) {
    const cands = sites.filter((s) => roles.get(s.i) === 'chedi' || (!roles.has(s.i) && chediLike(s)));
    cands.sort((a, b) => b.area - a.area);
    chediSite = cands.find((s) => s.W <= 62);
  }
  // Main viharn.
  let viharnSite = byId(hero?.viharn);
  const free = (s: Site) => s !== chediSite && roles.get(s.i) !== 'school' && roles.get(s.i) !== 'chedi' && roles.get(s.i) !== 'shrine';
  if (!viharnSite) {
    const pinnedV = sites.filter((s) => roles.get(s.i) === 'viharn').sort((a, b) => b.area - a.area);
    viharnSite =
      pinnedV[0] ??
      sites.filter((s) => free(s) && elongated(s, 8, 25, 15, 60)).sort((a, b) => b.area - a.area)[0] ??
      sites.filter((s) => free(s) && s.W >= 6 && s.L >= 10 && s.area >= 90 && s.L / s.W <= 4.5 && s.area <= 2500).sort((a, b) => b.area - a.area)[0];
  }
  let viharn: HallPlan;
  const vStyle: HallStyleName = hero?.viharnStyle ?? (hash01(g.ti, 501) < 0.1 ? 'teak' : 'white');
  if (viharnSite) {
    viharn = hallOn(viharnSite, front, vStyle);
    roles.set(viharnSite.i, 'viharn');
  } else {
    viharn = synthHall(g, group, front, blockers, roads, vStyle);
    blockers.push({ ring: rectRing(viharn.b, viharn.L + 2, viharn.W + 3) });
  }

  // Ubosot: next elongated hall.
  let ubosot: HallPlan | null = null;
  const uSite =
    byId(hero?.ubosot) ??
    sites.filter((s) => roles.get(s.i) === 'ubosot' && s !== viharnSite)[0] ??
    sites.filter((s) => s !== viharnSite && s !== chediSite && !roles.has(s.i) && elongated(s, 6, 14, 12, 30)).sort((a, b) => b.area - a.area)[0];
  if (uSite) {
    ubosot = hallOn(uSite, front, hero?.ubosotStyle ?? (hash01(g.ti, 502) < 0.15 ? 'gold' : 'white'));
    roles.set(uSite.i, 'ubosot');
  }

  // Chedi spec (mapped or synthesised behind the viharn).
  let spec: ChediSpec & { bi: number | null; luang: boolean };
  const st = chediStyle(g.ti * 7 + 3);
  if (chediSite) {
    roles.set(chediSite.i, 'chedi');
    const side = hero?.chediSide ?? Math.min(chediSite.L, Math.max(chediSite.W, Math.sqrt(chediSite.area)));
    const H = hero?.chediHeight ?? (chediSite.b.ht ? chediSite.b.ht / 10 : Math.min(55, side * 2.2));
    spec = {
      x: chediSite.cx,
      y: chediSite.cy,
      side,
      height: H,
      ang: chediSite.b.o[2] / 1000,
      type: hero?.chediType ?? st.type,
      finish: hero?.chediFinish ?? st.finish,
      ruined: !hero?.chediFinish && st.finish === 'brick' && hash01(g.ti, 503) < 0.5,
      corners: side >= 12 && !hero?.chediModel,
      elephants: hero?.chediElephants,
      bi: chediSite.i,
      luang: hero?.chediModel === 'luang',
      segments: side > 14 ? 16 : undefined,
    };
  } else {
    const side0 = Math.max(6, Math.min(20, 0.08 * Math.sqrt(g.area)));
    const at = synthChediSpot(viharn, side0, group, blockers, roads);
    spec = {
      x: at[0],
      y: at[1],
      side: at[2],
      height: Math.min(40, at[2] * 2.4),
      ang: Math.atan2(viharn.b.uy, viharn.b.ux),
      type: st.type,
      finish: st.finish,
      ruined: st.finish === 'brick' && hash01(g.ti, 503) < 0.5,
      corners: at[2] >= 10,
      bi: null,
      luang: false,
    };
    blockers.push({ ring: rectRing(basis(spec.x, spec.y, spec.ang), spec.side + 1, spec.side + 1) });
  }

  // Other roles, largest first: at most two more Lanna halls and two salas; the rest are kuti.
  let halls = 0;
  let salas = 0;
  for (const s of [...sites].sort((a, b) => b.area - a.area)) {
    if (roles.has(s.i)) continue;
    const aspect = s.L / Math.max(0.1, s.W);
    const dv = Math.hypot(s.cx - viharn.b.ox, s.cy - viharn.b.oy);
    if (chediLike(s) && s.W <= 20) roles.set(s.i, 'chedi');
    else if (s.area < 30) roles.set(s.i, 'shrine');
    else if (aspect <= 1.35 && s.area >= 16 && s.area <= 64 && dv <= 25 && ![...roles.values()].includes('ho_trai') && hash01(s.b.id, 504) < 0.3) roles.set(s.i, 'ho_trai');
    else if (halls < 2 && s.W >= 7 && s.L >= 12 && aspect <= 4 && s.area <= 900 && s.rect >= 0.8) {
      roles.set(s.i, 'hall');
      halls++;
    } else if (salas < 2 && Math.max(s.L, s.W) >= 8 && Math.max(s.L, s.W) <= 20 && s.rect >= 0.8 && hash01(s.b.id, 505) < 0.5) {
      roles.set(s.i, 'sala');
      salas++;
    } else roles.set(s.i, 'kuti');
  }

  // Gate on the ground edge along the viharn's front axis.
  const gate = gateOn(g, viharn);
  const bodhi = bodhiSpot(group, viharn, blockers, roads, spec);
  return { group, hero, members: sites.map((s) => s.i), roles, viharn, ubosot, chedi: spec, front, gate, bodhi };
}

function synthHall(g: TempleGround, group: TempleGround[], front: [number, number], blockers: Blocker[], roads: RoadIndex, style: HallStyleName): HallPlan {
  const ang = Math.atan2(front[1], front[0]);
  for (let W = Math.max(8, Math.min(14, Math.sqrt(g.area) * 0.1)); W >= 5; W *= 0.8) {
    const L = W * 2.2;
    // Search from the street side inwards on a grid of candidate centres.
    let best: [number, number] | null = null;
    let bestScore = Infinity;
    const step = 3;
    for (let y = g.y0; y <= g.y1; y += step) {
      for (let x = g.x0; x <= g.x1; x += step) {
        const b = basis(x, y, ang);
        if (!rectFree(b, L, W, group, blockers, roads, 1)) continue;
        // Prefer near the street side and near the middle of the ground.
        const along = (x - g.cx) * front[0] + (y - g.cy) * front[1];
        const across = Math.abs(-(x - g.cx) * front[1] + (y - g.cy) * front[0]);
        const score = -along + across * 0.6;
        if (score < bestScore) {
          bestScore = score;
          best = [x, y];
        }
      }
    }
    if (best) return { b: basis(best[0], best[1], ang), L, W, bi: null, style };
  }
  // Last resort: the ground centre.
  const W = Math.max(5, Math.min(10, Math.sqrt(g.area) * 0.08));
  return { b: basis(g.cx, g.cy, ang), L: W * 2, W, bi: null, style };
}

function synthChediSpot(v: HallPlan, side0: number, group: TempleGround[], blockers: Blocker[], roads: RoadIndex): [number, number, number] {
  const ang = Math.atan2(v.b.uy, v.b.ux);
  for (let side = side0; side >= 4; side *= 0.8) {
    const tries: [number, number][] = [
      [-(v.L / 2 + side / 2 + 3), 0],
      [-(v.L / 2 + side / 2 + 8), 0],
      [0, v.W / 2 + side / 2 + 4],
      [0, -(v.W / 2 + side / 2 + 4)],
      [-(v.L / 2), v.W / 2 + side / 2 + 4],
      [-(v.L / 2), -(v.W / 2 + side / 2 + 4)],
    ];
    for (const [u, w] of tries) {
      const [x, y] = bp(v.b, u, w, 0);
      if (rectFree(basis(x, y, ang), side, side, group, blockers, roads, 1)) return [x, y, side];
    }
    // Anywhere free in the ground, nearest the viharn's rear.
    const g = group[0];
    let best: [number, number] | null = null;
    let bestD = Infinity;
    const [rx, ry] = bp(v.b, -v.L, 0, 0);
    for (let y = g.y0; y <= g.y1; y += 3) {
      for (let x = g.x0; x <= g.x1; x += 3) {
        if (!rectFree(basis(x, y, ang), side, side, group, blockers, roads, 1)) continue;
        const d = Math.hypot(x - rx, y - ry);
        if (d < bestD) {
          bestD = d;
          best = [x, y];
        }
      }
    }
    if (best) return [best[0], best[1], side];
  }
  const [x, y] = bp(v.b, -(v.L / 2 + 5), 0, 0);
  return [x, y, 4];
}

function gateOn(g: TempleGround, v: HallPlan): TemplePlan['gate'] {
  const ox = v.b.ox;
  const oy = v.b.oy;
  const dx = v.b.ux;
  const dy = v.b.uy;
  let bestT = Infinity;
  let bestEdge = -1;
  for (let i = 0; i < g.ring.length; i++) {
    const [ax, ay] = g.ring[i];
    const [bx, by] = g.ring[(i + 1) % g.ring.length];
    const ex = bx - ax;
    const ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((ax - ox) * ey - (ay - oy) * ex) / den;
    const s = ((ax - ox) * dy - (ay - oy) * dx) / den;
    if (t > 0 && s >= 0 && s <= 1 && t < bestT) {
      bestT = t;
      bestEdge = i;
    }
  }
  if (bestT > 250 || bestEdge < 0) return null;
  // On the wall line just inside the boundary, facing out across the edge it sits on.
  const e = edgeOf(g.ring, bestEdge);
  const x = ox + dx * bestT - e.nx * 0.5;
  const y = oy + dy * bestT - e.ny * 0.5;
  return { x, y, ang: Math.atan2(e.ny, e.nx) };
}

function bodhiSpot(group: TempleGround[], v: HallPlan, blockers: Blocker[], roads: RoadIndex, c: ChediSpec): [number, number] | null {
  const g = group[0];
  let best: [number, number] | null = null;
  let bestScore = -Infinity;
  for (let y = g.y0 + 3; y <= g.y1; y += 4) {
    for (let x = g.x0 + 3; x <= g.x1; x += 4) {
      if (!pointInRing(x, y, g.ring)) continue;
      const edge = ringDist(x, y, g.ring);
      if (edge < 5) continue;
      if (roads.onCarriageway(x, y, 3)) continue;
      let clear = edge;
      for (const b of blockers) {
        if (pointInRing(x, y, b.ring)) {
          clear = -1;
          break;
        }
        clear = Math.min(clear, ringDist(x, y, b.ring));
      }
      clear = Math.min(clear, Math.hypot(x - c.x, y - c.y) - c.side * 0.7);
      if (clear < 6) continue;
      const score = Math.min(clear, 12) - 0.03 * Math.hypot(x - v.b.ox, y - v.b.oy);
      if (score > bestScore) {
        bestScore = score;
        best = [x, y];
      }
    }
  }
  return best;
}

// ------------------------------------------------------------------ halls

interface HallPalette {
  plinth: RGB;
  walls: RGB;
  roofHi: RGB;
  roofLo: RGB;
  border: RGB;
  gable: RGB;
  gableInner: RGB;
  trim: RGB;
  door: RGB;
  column: RGB;
  naga: RGB;
}

function hallPalette(style: HallStyleName, key: number): HallPalette {
  const red = hash01(key, 511) < 0.5;
  const base: HallPalette = {
    plinth: BC.templePlinth,
    walls: BC.templeWhite,
    roofHi: red ? BC.roofRed : BC.roofOrange,
    roofLo: red ? shade(BC.roofRed, 0.92) : BC.roofRed,
    border: hash01(key, 512) < 0.65 ? BC.borderGreen : BC.gold,
    gable: BC.lacquerRed,
    gableInner: BC.gold,
    trim: BC.gold,
    door: BC.lacquerRed,
    column: BC.lacquerRed,
    naga: hash01(key, 513) < 0.5 ? BC.gold : BC.nagaGreen,
  };
  switch (style) {
    case 'gold':
      return { ...base, gable: BC.gold, gableInner: BC.goldLit, border: BC.gold, column: BC.gold, naga: BC.gold };
    case 'teak':
      return { ...base, plinth: mix(BC.weathered, BC.lichen, 0.3), walls: BC.teakDark, roofHi: mix(BC.tileBrown, BC.lacquerBlack, 0.35), roofLo: mix(BC.tileBrown, BC.lacquerBlack, 0.45), border: BC.goldDark, gable: BC.teakDark, gableInner: BC.gold, door: BC.teak, column: BC.teakDark, naga: BC.gold };
    case 'silver':
      return { ...base, walls: BC.silver, roofHi: BC.silverDark, roofLo: shade(BC.silverDark, 0.9), border: BC.silver, gable: BC.silver, gableInner: BC.templeWhite, trim: BC.silver, door: BC.silverDark, column: BC.silver, naga: BC.silver };
    default:
      return base;
  }
}

export interface HallOpts {
  /** Plinth height (m); default from the width. */
  plinth?: number;
  /** Wall height above the plinth. */
  wallH?: number;
  /** Number of lower tiers at the front and rear. */
  front?: number;
  rear?: number;
  /** Open sides on columns (salas, Wat Suan Dok). */
  open?: boolean;
  /** Front steps with naga balustrades. */
  steps?: boolean;
  /** Wall colour override (ho trai upper storey). */
  walls?: RGB;
}

/**
 * Lanna hall on a local frame (u towards the front): white plinth, low walls,
 * a roof of overlapping tiers stepping down to the front (and rear on long
 * halls), each with a lower sweeping skirt and a steep upper roof, lacquered
 * gable faces, gold bargeboards ending in hang hong, and chofa finials.
 * Returns the highest ridge.
 */
export function lannaHall(ctx: BuildContext, hp: HallPlan, key: number, opts: HallOpts = {}): number {
  const w = ctx.w.buildings;
  const { b, L, W } = hp;
  const pal = hallPalette(hp.style, key);
  const open = opts.open ?? hp.style === 'open';
  const p = opts.plinth ?? Math.max(0.7, Math.min(1.4, 0.06 * W));
  const wallH = opts.wallH ?? Math.max(2.8, Math.min(4.2, 0.24 * W));
  const wt = p + wallH;
  const oS = Math.max(0.9, Math.min(2.2, 0.12 * W));
  const t1 = 0.62;
  const t2 = 1.3;
  const Vout = W / 2 + oS;
  const he = Math.max(p + 2.0, wt - oS * t1);
  const Wi = 0.3 * W;
  const hB = he + (Vout - Wi) * t1;
  const vC = Wi + 0.45;
  const hC = hB + 0.3;
  const ridge = hC + vC * t2;
  const d = 0.085 * W;
  const nFront = opts.front ?? (L >= 24 ? 2 : L >= 14 ? 1 : 0);
  const nRear = opts.rear ?? (L >= 32 ? 1 : 0);
  const fl = 0.13 * L;
  const rl = 0.12 * L;
  const porch = nFront > 0 ? Math.min(fl, 4.5) : 0;

  // Plinth, steps and naga balustrades.
  const pw = W / 2 + 0.5;
  obox(w, b, -L / 2 - 0.5, L / 2 + 0.5, -pw, pw, 0, p, shade(pal.plinth, 0.85), pal.plinth, shade(pal.plinth, 1.03));
  if (opts.steps ?? true) {
    const sw = Math.max(1.2, 0.17 * W);
    const q0 = L / 2 + 0.5;
    const q1 = q0 + p * 1.9 + 0.4;
    face(w, bp(b, q1, -sw, 0.04), bp(b, q1, sw, 0.04), bp(b, q0, sw, p), bp(b, q0, -sw, p), shade(pal.plinth, 0.9), pal.plinth, UP);
    for (const sv of [-1, 1]) {
      const [dx, dy] = bdir(b, 0, sv);
      tri3(w, bp(b, q1, sv * sw, 0.04), bp(b, q0, sv * sw, 0.04), bp(b, q0, sv * sw, p), shade(pal.plinth, 0.85), [dx, dy, 0]);
      // Naga body rising along the stair edge, head raised at the foot.
      const v = sv * (sw + 0.22);
      beam(w, bp(b, q1 - 0.3, v, 0.55), bp(b, q0 - 0.2, v, p + 0.7), 0.2, 0.16, pal.naga, shade(pal.naga, 1.1));
      beam(w, bp(b, q1 - 0.35, v, 0.3), bp(b, q1 + 0.05, v, 1.8), 0.28, 0.12, pal.naga, BC.goldLit);
    }
  }

  // Walls or columns.
  const qw0 = -L / 2 + 0.3;
  const qw1 = L / 2 - porch;
  const vw = W / 2 - 0.3;
  const wallC = opts.walls ?? pal.walls;
  if (open) {
    const n = Math.max(2, Math.round((qw1 - qw0) / 4.5));
    for (let i = 0; i <= n; i++) {
      const q = qw0 + ((qw1 - qw0) * i) / n;
      for (const sv of [-1, 1]) cbox(w, b, q, sv * vw, 0.55, 0.55, p, wt, shade(wallC, 0.9), wallC, wallC, SIDE.SIDES);
    }
    obox(w, b, qw0, qw0 + 0.4, -vw, vw, p, wt, shade(wallC, 0.85), wallC, wallC, SIDE.SIDES);
  } else {
    obox(w, b, qw0, qw1, -vw, vw, p, wt, shade(wallC, 0.82), wallC, wallC, SIDE.SIDES);
    // Tall lacquered shutters along the sides.
    const n = Math.max(1, Math.floor((qw1 - qw0) / 4.2));
    for (let i = 0; i < n; i++) {
      const q = qw0 + ((qw1 - qw0) * (i + 0.5)) / n;
      for (const sv of [-1, 1]) {
        const [dx, dy] = bdir(b, 0, sv);
        const v = sv * (vw + 0.04);
        face(w, bp(b, q - 0.45, v, p + 0.9), bp(b, q + 0.45, v, p + 0.9), bp(b, q + 0.45, v, p + 2.6), bp(b, q - 0.45, v, p + 2.6), shade(pal.door, 0.8), pal.door, [dx, dy, 0]);
      }
    }
    // Carved door on the front wall.
    const [fx, fy] = bdir(b, 1, 0);
    face(w, bp(b, qw1 + 0.04, -1.3, p), bp(b, qw1 + 0.04, 1.3, p), bp(b, qw1 + 0.04, 1.3, p + 3.3), bp(b, qw1 + 0.04, -1.3, p + 3.3), pal.trim, pal.trim, [fx, fy, 0]);
    face(w, bp(b, qw1 + 0.06, -1.05, p), bp(b, qw1 + 0.06, 1.05, p), bp(b, qw1 + 0.06, 1.05, p + 3.05), bp(b, qw1 + 0.06, -1.05, p + 3.05), shade(pal.door, 0.85), pal.door, [fx, fy, 0]);
  }
  if (porch > 0) {
    for (const v of [-(vw - 0.3), -W / 6, W / 6, vw - 0.3]) cbox(w, b, L / 2 - 0.5, v, 0.5, 0.5, p, wt, pal.column, shade(pal.column, 1.1), pal.trim, SIDE.SIDES);
  }

  // Roof tiers from the rear to the front.
  const tiers: { q0: number; q1: number; drop: number; frontEnd: boolean; rearEnd: boolean }[] = [];
  let q = -L / 2;
  for (let k = nRear; k >= 1; k--) {
    tiers.push({ q0: q, q1: q + rl + 0.35, drop: k * d, frontEnd: false, rearEnd: k === nRear });
    q += rl;
  }
  const mainEnd = L / 2 - nFront * fl;
  tiers.push({ q0: q, q1: mainEnd, drop: 0, frontEnd: true, rearEnd: nRear === 0 });
  q = mainEnd;
  for (let k = 1; k <= nFront; k++) {
    tiers.push({ q0: q - 0.35, q1: q + fl, drop: k * d, frontEnd: true, rearEnd: false });
    q += fl;
  }
  const endOver = 0.7;
  // Lower tiers step only the steep upper roof down (flatter, never below the
  // skirt); the lower skirt runs the full length at one height, clear of the walls.
  const profileAt = (drop: number) => ({ he, hB, hC: Math.max(hB + 0.1, hC - drop), ridge: ridge - drop });
  // Tympanum walls: fill between the wall top and the roof of the tier over the hall's front and rear walls.
  const tymp = (qq: number, drop: number, dir: number) => {
    const pr = profileAt(drop);
    const [dx, dy] = bdir(b, dir, 0);
    const pts = [bp(b, qq, -vw, wt), bp(b, qq, vw, wt), bp(b, qq, Wi * 0.95, pr.hB - 0.05), bp(b, qq, 0, pr.ridge - 0.15), bp(b, qq, -Wi * 0.95, pr.hB - 0.05)];
    for (let i = 1; i < pts.length - 1; i++) tri3(w, pts[0], pts[i], pts[i + 1], wallC, [dx, dy, 0]);
  };
  tymp(qw1, nFront * d, 1);
  tymp(qw0, nRear * d, -1);

  let top = 0;
  for (const t of tiers) {
    const pr = profileAt(t.drop);
    const a0 = t.rearEnd ? t.q0 - endOver : t.q0;
    const a1 = t.frontEnd && t.q1 >= L / 2 - 1e-6 ? t.q1 + endOver : t.frontEnd ? t.q1 + 0.35 : t.q1;
    top = Math.max(top, pr.ridge);
    for (const sv of [-1, 1]) {
      // Lower skirt with a border band along the eave.
      const vb = sv * (Vout - 0.7);
      const hb = pr.he + 0.7 * ((pr.hB - pr.he) / (Vout - Wi));
      face(w, bp(b, a0, sv * Vout, pr.he), bp(b, a1, sv * Vout, pr.he), bp(b, a1, vb, hb), bp(b, a0, vb, hb), pal.border, pal.border, UP);
      face(w, bp(b, a0, vb, hb), bp(b, a1, vb, hb), bp(b, a1, sv * Wi, pr.hB), bp(b, a0, sv * Wi, pr.hB), pal.roofLo, shade(pal.roofLo, 1.06), UP);
      // Dark step under the upper eave.
      const [dx, dy] = bdir(b, 0, sv);
      face(w, bp(b, a0, sv * Wi, pr.hB - 0.05), bp(b, a1, sv * Wi, pr.hB - 0.05), bp(b, a1, sv * Wi, pr.hC), bp(b, a0, sv * Wi, pr.hC), BC.lacquerBlack, BC.lacquerBlack, [dx, dy, 0]);
      // Steep upper roof, border band at its eave.
      const ub = sv * (vC - 0.5);
      const hub = pr.hC + 0.5 * ((pr.ridge - pr.hC) / vC);
      face(w, bp(b, a0, sv * vC, pr.hC), bp(b, a1, sv * vC, pr.hC), bp(b, a1, ub, hub), bp(b, a0, ub, hub), pal.border, pal.border, UP);
      face(w, bp(b, a0, ub, hub), bp(b, a1, ub, hub), bp(b, a1, 0, pr.ridge), bp(b, a0, 0, pr.ridge), pal.roofHi, shade(pal.roofHi, 1.08), UP);
    }
    // Gable faces set just inside the roof ends.
    for (const [qq, dir, deco] of [
      [a1 - 0.3, 1, t.frontEnd],
      [a0 + 0.3, -1, t.rearEnd],
    ] as const) {
      const [dx, dy] = bdir(b, dir, 0);
      tri3(w, bp(b, qq, -vC + 0.15, pr.hC), bp(b, qq, vC - 0.15, pr.hC), bp(b, qq, 0, pr.ridge - 0.1), pal.gable, [dx, dy, 0]);
      if (!deco) continue;
      const qi = qq + dir * 0.04;
      tri3(w, bp(b, qi, -vC * 0.55, pr.hC + 0.35), bp(b, qi, vC * 0.55, pr.hC + 0.35), bp(b, qi, 0, pr.ridge - (pr.ridge - pr.hC) * 0.35), pal.gableInner, [dx, dy, 0]);
      const qe = dir > 0 ? a1 : a0;
      const apex = bp(b, qe, 0, pr.ridge + 0.12);
      for (const sv of [-1, 1]) {
        // Naga bargeboard down the gable edge, ending in an upturned hang hong.
        const foot = bp(b, qe, sv * (vC + 0.3), pr.hC - 0.25);
        beam(w, apex, foot, 0.17, 0.13, pal.trim, shade(pal.trim, 1.08));
        beam(w, foot, bp(b, qe + dir * 0.25, sv * (vC + 0.7), pr.hC + 0.45), 0.13, 0, pal.trim, BC.goldLit);
      }
      // Chofa: a slender finial curving up and back from the apex.
      const mid = bp(b, qe + dir * 0.45, 0, pr.ridge + 1.1);
      beam(w, apex, mid, 0.14, 0.08, pal.trim, BC.goldLit);
      beam(w, mid, bp(b, qe + dir * 0.2, 0, pr.ridge + 1.75), 0.08, 0, BC.goldLit, BC.goldLit);
    }
  }
  return top;
}

/** Eight sema boundary stones around a hall at 1.5 m. */
function semaStones(w: MeshWriter, h: HallPlan): void {
  const pu = h.L / 2 + 0.5 + 1.5;
  const pv = h.W / 2 + 0.5 + 1.5;
  for (const [u, v] of [
    [pu, pv],
    [pu, -pv],
    [-pu, pv],
    [-pu, -pv],
    [pu, 0],
    [-pu, 0],
    [0, pv],
    [0, -pv],
  ]) {
    const sb = basis(...(bp(h.b, u + (u === pu ? 2.2 : 0), v, 0).slice(0, 2) as [number, number]), Math.atan2(h.b.uy, h.b.ux));
    cbox(w, sb, 0, 0, 0.7, 0.7, 0, 0.45, shade(BC.templePlinth, 0.85), BC.templePlinth, BC.templePlinth, SIDE.SIDES | SIDE.TOP);
    beam(w, [sb.ox, sb.oy, 0.45], [sb.ox, sb.oy, 1.25], 0.2, 0.06, BC.stucco, BC.gold);
  }
}

/** Ho trai: tall white base with a lacquered red upper storey under a Lanna roof. */
function hoTrai(ctx: BuildContext, s: Site, key: number): void {
  const o = obbOf(s.ring, s.b.o[2]);
  lannaHall(ctx, { b: o.b, L: o.L, W: o.W, bi: s.i, style: 'white' }, key, { plinth: 2.8, wallH: 2.6, front: 0, rear: 0, steps: false, walls: BC.lacquerRed });
}

/** Open sala: low plinth, columns and a single-tier Lanna roof. */
function sala(ctx: BuildContext, s: Site, key: number): void {
  const o = obbOf(s.ring, s.b.o[2]);
  lannaHall(ctx, { b: o.b, L: o.L, W: o.W, bi: s.i, style: 'white' }, key, { plinth: 0.5, wallH: 2.8, front: 0, rear: 0, open: true, steps: false });
}

/** Small shrine (city pillar, spirit shrines): plinth, walls and a tiny Lanna roof. */
function shrine(ctx: BuildContext, s: Site, key: number): void {
  const o = obbOf(s.ring, s.b.o[2]);
  const L = Math.max(o.L, 2.5);
  const W = Math.max(o.W, 2.2);
  lannaHall(ctx, { b: o.b, L, W, bi: s.i, style: 'gold' }, key, { plinth: 1.0, wallH: 2.4, front: 0, rear: 0, steps: false });
}

/** Bell tower (ho rakhang): white base, four posts, small roof and a gold bell. */
function bellTower(ctx: BuildContext, x: number, y: number, ang: number, key: number): void {
  const w = ctx.w.buildings;
  const b = basis(x, y, ang);
  obox(w, b, -1.6, 1.6, -1.6, 1.6, 0, 1.6, shade(BC.templeWhite, 0.85), BC.templeWhite, BC.templePlinth);
  for (const [u, v] of [
    [-1.2, -1.2],
    [1.2, -1.2],
    [1.2, 1.2],
    [-1.2, 1.2],
  ]) cbox(w, b, u, v, 0.3, 0.3, 1.6, 5, BC.lacquerRed, BC.lacquerRed, BC.gold, SIDE.SIDES);
  lathe(w, x, y, [
    [0.45, 3.4],
    [0.4, 3.9],
    [0.2, 4.2],
  ], 6, [BC.goldDark, BC.gold, BC.gold]);
  lannaRoofOnly(ctx, { b, L: 3.2, W: 3.2, bi: null, style: 'white' }, 5, key);
  ctx.occ.markDisc(x, y, 2.5);
}

/** A single-tier Lanna roof sitting at height h (no plinth or walls). */
function lannaRoofOnly(ctx: BuildContext, hp: HallPlan, h: number, key: number): void {
  const w = ctx.w.buildings;
  const pal = hallPalette(hp.style, key);
  const { b, L, W } = hp;
  const hw = W / 2 + 0.6;
  const ridge = h + W * 0.75;
  for (const sv of [-1, 1]) face(w, bp(b, -L / 2 - 0.5, sv * hw, h), bp(b, L / 2 + 0.5, sv * hw, h), bp(b, L / 2 + 0.5, 0, ridge), bp(b, -L / 2 - 0.5, 0, ridge), pal.roofLo, pal.roofHi, UP);
  for (const dir of [-1, 1]) {
    const [dx, dy] = bdir(b, dir, 0);
    tri3(w, bp(b, dir * (L / 2 + 0.2), -hw + 0.3, h), bp(b, dir * (L / 2 + 0.2), hw - 0.3, h), bp(b, dir * (L / 2 + 0.2), 0, ridge - 0.1), pal.gable, [dx, dy, 0]);
    beam(w, bp(b, dir * (L / 2 + 0.5), 0, ridge), bp(b, dir * (L / 2 + 0.8), 0, ridge + 0.8), 0.08, 0.02, BC.gold, BC.goldLit);
  }
}

// ------------------------------------------------------------------ compound

/** Arch gate (Lanna stucco, ~4 m opening) with paired singha lions, facing `ang`. */
function archGate(ctx: BuildContext, x: number, y: number, ang: number, key: number): void {
  const w = ctx.w.structures;
  // Face across the boundary: u along the wall, v outwards.
  const b = basis(x, y, ang - Math.PI / 2);
  const white = BC.templeWhite;
  for (const su of [-1, 1]) {
    const u = su * 2.6;
    obox(w, b, u - 0.6, u + 0.6, -0.7, 0.7, 0, 4.6, shade(white, 0.85), white, white);
    // Pinnacle on each pier.
    lathe(w, ...(bp(b, u, 0, 0).slice(0, 2) as [number, number]), [
      [0.5, 4.6],
      [0.35, 5.3],
      [0, 6.4],
    ], 4, [white, BC.gold, BC.gold], ang);
  }
  // Lintel and a stepped pediment with a gold finial.
  obox(w, b, -2.0, 2.0, -0.6, 0.6, 3.9, 4.6, shade(white, 0.9), white, white);
  obox(w, b, -1.6, 1.6, -0.5, 0.5, 4.6, 5.4, BC.lacquerRed, BC.lacquerRed, white);
  obox(w, b, -1.0, 1.0, -0.45, 0.45, 5.4, 6.1, white, white, BC.gold);
  beam(w, bp(b, 0, 0, 6.1), bp(b, 0, 0, 7.2), 0.2, 0.03, BC.gold, BC.goldLit);
  // Singha lions flanking the gate just inside the wall, facing out.
  for (const su of [-1, 1]) singha(w, bp(b, su * 4.2, -1.3, 0), ang, key + su);
  ctx.occ.markDisc(x + Math.cos(ang - Math.PI / 2) * 2.6, y + Math.sin(ang - Math.PI / 2) * 2.6, 1.2);
  ctx.occ.markDisc(x - Math.cos(ang - Math.PI / 2) * 2.6, y - Math.sin(ang - Math.PI / 2) * 2.6, 1.2);
}

/** Stylised white-and-gold singha lion on a plinth, facing `ang`. */
export function singha(w: MeshWriter, at: [number, number, number], ang: number, key: number): void {
  const b = basis(at[0], at[1], ang);
  const white = BC.templeWhite;
  const trim = hash01(key, 521) < 0.5 ? BC.gold : BC.lacquerRed;
  obox(w, b, -0.9, 0.9, -0.6, 0.6, 0, 0.9, shade(white, 0.85), white, trim);
  // Haunches, raised chest and head, mane crest.
  obox(w, b, -0.7, 0.1, -0.45, 0.45, 0.9, 1.6, shade(white, 0.9), white, white);
  obox(w, b, -0.1, 0.6, -0.4, 0.4, 0.9, 2.3, shade(white, 0.9), white, white);
  obox(w, b, 0.1, 0.85, -0.38, 0.38, 2.1, 2.9, shade(white, 0.92), white, trim);
  beam(w, bp(b, 0.2, 0, 2.9), bp(b, -0.2, 0, 3.4), 0.2, 0.05, trim, trim);
  for (const sv of [-1, 1]) cbox(w, b, 0.45, sv * 0.25, 0.25, 0.22, 0.9, 1.9, white, white, white, SIDE.SIDES);
}

/** Tung flag on a tall pole: a long narrow banner hanging from a gold crook. */
function tungFlag(w: MeshWriter, x: number, y: number, ang: number, key: number): void {
  const b = basis(x, y, ang);
  cbox(w, b, 0, 0, 0.12, 0.12, 0, 7.5, BC.grilleWhite, BC.grilleWhite, BC.gold, SIDE.SIDES | SIDE.TOP);
  beam(w, bp(b, 0, 0, 7.4), bp(b, 0.9, 0, 7.6), 0.05, 0.03, BC.gold);
  const colours = [BC.lanternRed, BC.gold, BC.mosaicBlue, BC.borderGreen, BC.grilleWhite];
  const c = colours[Math.floor(hash01(key, 531) * colours.length)];
  const c2 = colours[Math.floor(hash01(key, 532) * colours.length)];
  const [nx, ny] = bdir(b, 0, 1);
  const p0 = bp(b, 0.75, 0, 7.5);
  const p1 = bp(b, 1.1, 0, 7.5);
  const p2 = bp(b, 1.1, 0, 3.6);
  const p3 = bp(b, 0.75, 0, 3.6);
  face(w, p3, p2, p1, p0, c2, c, [nx, ny, 0]);
  face(w, p2, p3, p0, p1, c2, c, [-nx, -ny, 0]);
}

/** Segments of OSM wall ways near a ground, as ax, ay, bx, by quadruples. */
function osmWallSegments(city: CityData, g: TempleGround): number[] {
  const out: number[] = [];
  const k = city.lineKinds.indexOf('wall');
  for (const l of city.lines) {
    if (l.k !== k) continue;
    for (let i = 2; i < l.p.length; i += 2) {
      const ax = l.p[i - 2] / 10;
      const ay = l.p[i - 1] / 10;
      const bx = l.p[i] / 10;
      const by = l.p[i + 1] / 10;
      if (Math.max(ax, bx) < g.x0 - 5 || Math.min(ax, bx) > g.x1 + 5 || Math.max(ay, by) < g.y0 - 5 || Math.min(ay, by) > g.y1 + 5) continue;
      out.push(ax, ay, bx, by);
    }
  }
  return out;
}

/** Whitewashed compound wall along the ground with lotus-bud posts, gaps at roads and the gate. */
function compoundWall(ctx: BuildContext, g: TempleGround, gate: TemplePlan['gate'], members: Site[], roads: RoadIndex, key: number): void {
  const w = ctx.w.structures;
  const inner = insetRing(g.ring, 0.5) ?? g.ring;
  const osm = osmWallSegments(ctx.city, g);
  const white = BC.templeWhite;
  const foot = shade(white, 0.78);
  const cap = shade(BC.templePlinth, 0.95);
  const H = 1.9 + hash01(key, 541) * 0.3;
  const step = 1.5;
  const skip = (x: number, y: number): boolean => {
    if (gate && Math.hypot(x - gate.x, y - gate.y) < 2.2) return true;
    if (roads.onCarriageway(x, y, 0.6)) return true;
    for (let i = 0; i < osm.length; i += 4) {
      const vx = osm[i + 2] - osm[i];
      const vy = osm[i + 3] - osm[i + 1];
      const l2 = vx * vx + vy * vy || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - osm[i]) * vx + (y - osm[i + 1]) * vy) / l2));
      if (Math.hypot(osm[i] + vx * t - x, osm[i + 1] + vy * t - y) < 3) return true;
    }
    for (const s of members) if (pointInRing(x, y, s.ring)) return true;
    return false;
  };
  for (let i = 0; i < inner.length; i++) {
    const [ax, ay] = inner[i];
    const [bx, by] = inner[(i + 1) % inner.length];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 0.5) continue;
    const n = Math.max(1, Math.round(len / step));
    let run0 = -1;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const on = k < n && !skip(x + ((bx - ax) / n) * 0.5, y + ((by - ay) / n) * 0.5);
      if (on && run0 < 0) run0 = k;
      if ((!on || k === n) && run0 >= 0) {
        const t0 = run0 / n;
        const t1 = k / n;
        const x0 = ax + (bx - ax) * t0;
        const y0 = ay + (by - ay) * t0;
        const x1 = ax + (bx - ax) * t1;
        const y1 = ay + (by - ay) * t1;
        const seg = Math.hypot(x1 - x0, y1 - y0);
        if (seg > 0.8) {
          const b = basis((x0 + x1) / 2, (y0 + y1) / 2, Math.atan2(by - ay, bx - ax));
          obox(w, b, -seg / 2, seg / 2, -0.15, 0.15, 0, H, foot, white, cap, SIDE.V0 | SIDE.V1 | SIDE.TOP);
          const posts = Math.max(1, Math.round(seg / 20));
          for (let j = 0; j <= posts; j++) {
            const u = -seg / 2 + (seg * j) / posts;
            cbox(w, b, u, 0, 0.42, 0.42, 0, H + 0.35, foot, white, white, SIDE.SIDES);
            // Lotus-bud cap.
            const [px, py] = bp(b, u, 0, 0);
            lathe(w, px, py, [
              [0.3, H + 0.35],
              [0, H + 0.95],
            ], 4, [white, BC.gold], Math.atan2(by - ay, bx - ax) + Math.PI / 4);
          }
          for (let j = 0; j <= Math.ceil(seg / 2); j++) {
            const tt = j / Math.max(1, Math.ceil(seg / 2));
            ctx.occ.markDisc(x0 + (x1 - x0) * tt, y0 + (y1 - y0) * tt, 0.8);
          }
        }
        run0 = -1;
      }
    }
  }
}

// ------------------------------------------------------------------ build

/** Build every temple ground; returns the number of footprints drawn. */
export function buildTemples(ctx: BuildContext, env: BuildEnv): number {
  const { city } = ctx;
  const roads = new RoadIndex(city);
  const infos: TempleInfo[] = [];
  let built = 0;
  for (const group of templeGroups(env.grounds)) {
    const g = group[0];
    const key = g.ti * 7919 + 17;
    if (!g.buddhist) {
      // Chinese shrines: the main hall (or one synthesised on an empty ground); other buildings are generic.
      if (chineseGround(ctx, env, group, roads)) built++;
      continue;
    }
    const plan = planTemple(city, env, group, roads);
    const sites = plan.members.map((i) => siteOf(city, i));
    for (const s of sites) {
      env.handled.add(s.i);
      ctx.occ.markRing(s.ring, 0.5);
    }
    // Viharn, ubosot and chedi.
    lannaHall(ctx, plan.viharn, key);
    if (plan.viharn.bi === null) ctx.occ.markRing(rectRing(plan.viharn.b, plan.viharn.L + 1, plan.viharn.W + 1), 0.5);
    if (plan.ubosot) {
      lannaHall(ctx, plan.ubosot, key + 1, { front: plan.ubosot.L >= 18 ? 1 : 0, rear: 0 });
      semaStones(ctx.w.buildings, plan.ubosot);
    }
    if (plan.chedi.luang) chediLuang(ctx, plan.chedi, key);
    else chedi(ctx.w.buildings, plan.chedi, key);
    ctx.occ.markDisc(plan.chedi.x, plan.chedi.y, plan.chedi.side * 0.6);
    if (plan.hero?.royalChedis) royalChedis(ctx, plan, key);
    // Everything else by role.
    for (const s of sites) {
      const role = plan.roles.get(s.i);
      if (s.i === plan.viharn.bi || (plan.ubosot && s.i === plan.ubosot.bi) || s.i === plan.chedi.bi) continue;
      const k = s.b.id;
      switch (role) {
        case 'chedi': {
          const st = chediStyle(k);
          const side = Math.min(s.L, Math.sqrt(s.area));
          chedi(ctx.w.buildings, { x: s.cx, y: s.cy, side, height: s.b.ht ? s.b.ht / 10 : Math.min(30, side * 2.3), ang: s.b.o[2] / 1000, type: st.type, finish: plan.chedi.finish === 'brick' ? 'brick' : st.finish, ruined: st.finish === 'brick' && hash01(k, 506) < 0.5, segments: 8 }, k);
          break;
        }
        case 'viharn':
        case 'ubosot':
        case 'hall': {
          const hp = hallOn(s, plan.front, plan.viharn.style === 'teak' ? 'teak' : 'white');
          lannaHall(ctx, hp, k, { front: hp.L >= 20 ? 1 : 0, rear: 0, steps: role !== 'hall' });
          break;
        }
        case 'ho_trai':
          hoTrai(ctx, s, k);
          break;
        case 'sala':
          sala(ctx, s, k);
          break;
        case 'shrine':
          shrine(ctx, s, k);
          break;
        case 'school':
          school(ctx, s, { ...simplePlan(s, 'school', Math.max(2, Math.min(4, s.b.l ?? 3)), 'hip', [239, 228, 201], BC.tileTerracotta, false, 3.6, 3.5) });
          break;
        default: {
          const levels = s.b.l ? Math.min(3, s.b.l) : s.area > 150 && hash01(k, 507) < 0.5 ? 2 : 1;
          house(ctx, s, simplePlan(s, 'house', levels, s.rect >= 0.75 ? 'gable' : 'hip', hash01(k, 508) < 0.6 ? BC.stucco : BC.templeWhite, hash01(k, 509) < 0.6 ? BC.roofOrange : BC.tileBrown, false, 3.0, 3.0));
        }
      }
      built++;
    }
    // Bell tower at a front corner of the viharn, if there is room.
    const v = plan.viharn;
    const [bx, by] = bp(v.b, v.L / 2 - 2, v.W / 2 + 4.5, 0);
    if (ctx.occ.free(bx, by) && group.some((x) => pointInRing(bx, by, x.ring)) && sites.every((s) => !pointInRing(bx, by, s.ring)) && hash01(key, 551) < 0.6) {
      bellTower(ctx, bx, by, Math.atan2(v.b.uy, v.b.ux), key);
    }
    // Compound walls, gate, singhas and tung flags.
    for (const x of group) compoundWall(ctx, x, x === g ? plan.gate : null, sites, roads, key + x.ti);
    if (plan.gate) {
      archGate(ctx, plan.gate.x, plan.gate.y, plan.gate.ang, key);
      const gb = basis(plan.gate.x, plan.gate.y, plan.gate.ang);
      for (const sv of [-1, 1]) {
        const [fx, fy] = bp(gb, -2.5, sv * 6.5, 0);
        if (group.some((x) => pointInRing(fx, fy, x.ring)) && ctx.occ.free(fx, fy)) {
          tungFlag(ctx.w.structures, fx, fy, plan.gate.ang, key + sv);
          ctx.occ.markDisc(fx, fy, 0.5);
        }
      }
    }
    if (plan.bodhi) addProp(ctx, 'bodhi_spot', plan.bodhi[0], plan.bodhi[1], 0, 1);
    built += 2;
    infos.push({
      ti: g.ti,
      name: g.name,
      viharn: { x: v.b.ox, y: v.b.oy, ang: Math.atan2(v.b.uy, v.b.ux), L: v.L, W: v.W, mapped: v.bi !== null },
      chedi: { x: plan.chedi.x, y: plan.chedi.y, side: plan.chedi.side, height: plan.chedi.height, mapped: plan.chedi.bi !== null },
      gate: plan.gate ? [plan.gate.x, plan.gate.y] : null,
      bodhi: plan.bodhi,
    });
  }
  ctx.temples = infos;
  return built;
}

/** A footprint-less site for a synthesised building on a rectangle (front edge on +u). */
function syntheticSite(b: Basis, L: number, W: number, id: number, zone: string): Site {
  const ring = rectRing(b, L, W);
  return {
    i: -1,
    b: { r: [], b: 0, z: 0, a: L * W, o: [L * 10, W * 10, Math.round(Math.atan2(b.uy, b.ux) * 1000)], id },
    ring,
    holes: [],
    kind: '',
    use: '',
    name: '',
    zone,
    area: L * W,
    L,
    W,
    rect: 1,
    cx: b.ox,
    cy: b.oy,
    front: 1,
    frontLen: W,
    depth: L,
    roadCls: 9,
    roadName: '',
    shared: new Map(),
  };
}

/**
 * Chinese shrine ground: its largest building becomes a red-and-gold shrine
 * hall; an empty ground gets a small shrine facing its street.
 */
function chineseGround(ctx: BuildContext, env: BuildEnv, group: TempleGround[], roads: RoadIndex): boolean {
  if (!/shrine|chinese|ศาลเจ้า|สมาคม|foundation|association|มูลนิธิ/i.test(group[0].name) && group[0].rel !== 'chinese_folk') return false;
  const { city } = ctx;
  const tis = new Set(group.map((x) => x.ti));
  let best = -1;
  city.buildings.forEach((b, i) => {
    if (b.t !== undefined && tis.has(b.t) && !b.part && (best < 0 || b.a > city.buildings[best].a)) best = i;
  });
  const g = group[0];
  let s: Site;
  if (best >= 0) {
    s = siteOf(city, best);
    env.handled.add(best);
  } else {
    const front = streetSide(g.ring, roads);
    const W = Math.max(5, Math.min(10, Math.sqrt(g.area) * 0.3));
    const L = W * 1.3;
    const b = basis(g.cx, g.cy, Math.atan2(front[1], front[0]));
    if (!rectFree(b, L, W, group, [], roads, 0.5)) return false;
    s = syntheticSite(b, L, W, g.id || g.ti, 'chinatown');
  }
  ctx.occ.markRing(s.ring, 0.5);
  chineseShrine(ctx, s, simplePlan(s, 'shrine', 1, 'gable', BC.lacquerRed, BC.tileGreen, false, 4.5));
  return true;
}

/** Wat Suan Dok's cluster of small white royal chedis, north-west of the main chedi. */
function royalChedis(ctx: BuildContext, plan: TemplePlan, key: number): void {
  const c = plan.chedi;
  const g = plan.group[0];
  const b = basis(c.x, c.y, 0);
  let placed = 0;
  for (let j = 0; j < 7 && placed < 28; j++) {
    for (let i = 0; i < 7 && placed < 28; i++) {
      const [x, y] = bp(b, -c.side * 0.8 - 6 - i * 5.5, c.side * 0.4 + 2 + j * 5.5, 0);
      if (!pointInRing(x, y, g.ring) || ringDist(x, y, g.ring) < 2.5 || !ctx.occ.free(x, y)) continue;
      const s = 2.2 + hash01(key + placed, 561) * 1.6;
      miniChedi(ctx.w.buildings, x, y, s, s * 1.9, 0, null, hash01(key + placed, 562), 6);
      ctx.occ.markDisc(x, y, s * 0.6);
      placed++;
    }
  }
}

