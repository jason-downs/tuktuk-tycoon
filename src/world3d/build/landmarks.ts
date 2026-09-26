// Hero landmarks (docs/3d/world.md §2.8) fitted to their OSM footprints and
// anchors (definitions in landmarks3d.ts): the brick city gates (Tha Phae with
// its timber doors and uplights) and corner bastions, the Three Kings
// Monument and the Arts & Cultural Centre, Warorot and Ton Lamyai markets, the
// Night Bazaar building and the Loi Kroh boxing ring, MAYA's lattice cube,
// One Nimman's brick arcades and clock tower, and the CNX terminal with jet
// bridges. Footprints a hero replaces are hidden from the generic pass.

import { ringOf, type CityData } from '../city';
import { BC } from './buildingPalette';
import type { BuildContext, LandmarkInfo } from './context';
import { basis, bdir, beam, bp, cbox, centroid, edgeOf, ep, face, gable, insetRing, lathe, obox, ringArea, SIDE, tri3, wallQuad, type Basis, type Edge } from './kit';
import { HEROES, type Hero } from './landmarks3d';
import { flatRoof, obbOf, punchedWindows, ribbonWindows, rooftop, shellWalls } from './massing';
import { hash01, mix, shade, type MeshWriter, type RGB } from './mesh';
import { RoadIndex } from './roadIndex';
import { pointInRing, type Ring, type V3 } from './shapes';
import { siteOf, type BuildEnv, type Site } from './site';

const toSim = (city: CityData, lat: number, lon: number): [number, number] => {
  const o = city.origin;
  const mPerLon = 111_320 * Math.cos((o.lat * Math.PI) / 180);
  return [(lon - o.lon) * mPerLon, (lat - o.lat) * 110_574];
};

/** Build all hero landmarks; returns the number drawn. */
export function buildLandmarks(ctx: BuildContext, env: BuildEnv): number {
  const { city } = ctx;
  const walls = new Map<number, Ring>();
  for (const cw of city.cityWalls ?? []) {
    const r = ringOf(cw.r);
    walls.set(cw.id, ringArea(r) < 0 ? r.reverse() : r);
  }
  const byId = new Map<number, number>();
  city.buildings.forEach((b, i) => {
    if (!byId.has(b.id)) byId.set(b.id, i);
  });
  const roads = new RoadIndex(city);
  // Old City centre from the bastions (doors swing inwards).
  const bastions = HEROES.filter((h) => h.kind === 'bastion').flatMap((h) => (h.walls ?? []).map((id) => walls.get(id)).filter((r): r is Ring => !!r));
  const oldCity: [number, number] = bastions.length ? avg(bastions.map(centroid)) : [870, -180];
  const infos: LandmarkInfo[] = [];
  let built = 0;
  for (const h of HEROES) {
    const at = placeHero(ctx, env, h, walls, byId, roads, oldCity);
    if (!at) continue;
    infos.push({ id: h.id, x: at[0], y: at[1] });
    built++;
  }
  ctx.landmarks = infos;
  return built;
}

function avg(pts: [number, number][]): [number, number] {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

/** Building index nearest (x, y) within r metres (by footprint centroid), or -1. */
function nearestBuilding(city: CityData, x: number, y: number, r: number, env: BuildEnv): number {
  let best = -1;
  let bestD = r;
  city.buildings.forEach((b, i) => {
    if (b.t !== undefined || env.hidden.has(i) || b.a < 150) return;
    const n = b.r.length / 2;
    let cx = 0;
    let cy = 0;
    for (let k = 0; k < b.r.length; k += 2) {
      cx += b.r[k];
      cy += b.r[k + 1];
    }
    cx /= n * 10;
    cy /= n * 10;
    const ring = ringOf(b.r);
    const d = pointInRing(x, y, ring) ? 0 : Math.hypot(cx - x, cy - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function placeHero(ctx: BuildContext, env: BuildEnv, h: Hero, walls: Map<number, Ring>, byId: Map<number, number>, roads: RoadIndex, oldCity: [number, number]): [number, number] | null {
  const { city } = ctx;
  const anchor = h.at ? toSim(city, h.at[0], h.at[1]) : null;
  const hide = (i: number) => {
    env.hidden.add(i);
    ctx.occ.markRing(ringOf(city.buildings[i].r), 0.5);
  };
  const buildingSite = (): Site | null => {
    let i = -1;
    if (h.buildings) i = byId.get(h.buildings[0]) ?? -1;
    else if (anchor && h.nearest) i = nearestBuilding(city, anchor[0], anchor[1], h.nearest, env);
    if (i < 0) return null;
    hide(i);
    return siteOf(city, i);
  };
  switch (h.kind) {
    case 'gate':
    case 'bastion': {
      const rings = (h.walls ?? []).map((id) => walls.get(id)).filter((r): r is Ring => !!r);
      if (!rings.length) return null;
      const H = h.kind === 'bastion' ? 5.4 : h.ruined ? 4.4 : 5.2;
      rings.forEach((r, k) => brickMass(ctx, r, H, { ruined: !!h.ruined, key: hash01(k, 1) * 1e6 + (h.walls?.[k] ?? 0), moss: h.kind === 'bastion' }));
      if (h.doors && rings.length === 2 && anchor) thaPhaeGate(ctx, rings, anchor, H, oldCity);
      return anchor ?? avg(rings.map(centroid));
    }
    case 'monument': {
      if (!anchor) return null;
      threeKings(ctx, anchor[0], anchor[1], h.facing === 'east' ? 0 : Math.PI);
      return anchor;
    }
    case 'hall': {
      const s = buildingSite();
      if (!s) return null;
      colonialHall(ctx, s);
      return [s.cx, s.cy];
    }
    case 'market': {
      const a = city.areas.find((x) => x.id === h.area);
      if (!a) return null;
      let ring = ringOf(a.r);
      if (ringArea(ring) < 0) ring.reverse();
      ring = insetRing(ring, 1.5) ?? ring;
      // Hide any mapped footprints inside the market; they become the hall.
      city.buildings.forEach((b, i) => {
        if (b.t !== undefined) return;
        const r = ringOf(b.r);
        const [cx, cy] = centroid(r);
        if (pointInRing(cx, cy, ring)) hide(i);
      });
      marketHall(ctx, ring, h.id === 'warorot_market' ? 3 : 2, hash01(h.area ?? 0, 3) * 1e6);
      ctx.occ.markRing(ring, 0.5);
      return centroid(ring);
    }
    case 'bazaar': {
      const s = buildingSite();
      if (!s) return null;
      nightBazaar(ctx, s);
      return [s.cx, s.cy];
    }
    case 'boxing': {
      if (!anchor) return null;
      return boxingRing(ctx, anchor, roads);
    }
    case 'maya': {
      const s = buildingSite();
      if (!s) return null;
      maya(ctx, s);
      return [s.cx, s.cy];
    }
    case 'one_nimman': {
      const s = buildingSite();
      if (!s) return null;
      oneNimman(ctx, s, roads);
      return [s.cx, s.cy];
    }
    case 'terminal': {
      const s = buildingSite();
      if (!s) return null;
      terminal(ctx, s);
      return [s.cx, s.cy];
    }
    default:
      return null;
  }
}

// ------------------------------------------------------------------ walls and gates

interface MassOpts {
  ruined: boolean;
  key: number;
  moss: boolean;
}

/**
 * Brick wall mass on a footprint: battered faces in mortar-banded courses,
 * a flat top (mossy on bastions, left clear for trees) and merlons along the
 * outer edges (missing and broken on ruins).
 */
function brickMass(ctx: BuildContext, ring: Ring, H: number, o: MassOpts): void {
  const w = ctx.w.structures;
  const top = insetRing(ring, 0.25) ?? ring;
  const brick = o.ruined ? BC.brickOld : mix(BC.brickNew, BC.brickOld, 0.35);
  const bands: [number, RGB][] = [
    [0, shade(brick, 0.8)],
    [0.34, shade(brick, 0.95)],
    [0.36, mix(brick, BC.mortar, 0.35)],
    [0.68, brick],
    [0.7, mix(brick, BC.mortar, 0.3)],
    [1, shade(brick, 1.06)],
  ];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ta = top[i];
    const tb = top[(i + 1) % ring.length];
    const e = edgeOf(ring, i);
    for (let k = 1; k < bands.length; k++) {
      const f0 = bands[k - 1][0];
      const f1 = bands[k][0];
      const lerp = (p: [number, number], q: [number, number], f: number): V3 => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, H * f];
      face(w, lerp(a, ta, f0), lerp(b, tb, f0), lerp(b, tb, f1), lerp(a, ta, f1), bands[k - 1][1], bands[k][1], [e.nx, e.ny, 0.1]);
    }
  }
  w.polygon(top, undefined, H, o.moss ? mix(BC.moss, brick, 0.3) : shade(brick, 1.02));
  // Merlons along each edge of the top.
  for (let i = 0; i < top.length; i++) {
    const e = edgeOf(top, i);
    if (e.len < 1.4) continue;
    const n = Math.floor(e.len / 2.2);
    const eb: Basis = { ox: e.ax, oy: e.ay, ux: e.tx, uy: e.ty };
    for (let k = 0; k < n; k++) {
      const key = o.key + i * 101 + k;
      if (o.ruined && hash01(key, 11) < 0.35) continue;
      const mh = o.ruined ? 0.3 + hash01(key, 12) * 0.6 : 0.9;
      const s = (e.len * (k + 0.5)) / n;
      obox(w, eb, s - 0.55, s + 0.55, 0, 0.7, H, H + mh, shade(brick, 0.95), brick, shade(brick, 1.08));
    }
  }
  ctx.occ.markRing(ring, 0.8);
}

/**
 * Tha Phae Gate: the brick span over the opening between the two wall
 * polygons, a timber lintel, two weathered leaf doors swung inwards, and warm
 * uplights along the outer (plaza) face.
 */
function thaPhaeGate(ctx: BuildContext, rings: Ring[], anchor: [number, number], H: number, oldCity: [number, number]): void {
  const w = ctx.w.structures;
  const [ca, cb] = rings.map(centroid);
  let dx = cb[0] - ca[0];
  let dy = cb[1] - ca[1];
  const dl = Math.hypot(dx, dy) || 1;
  dx /= dl;
  dy /= dl;
  // Opening: from the end of the first wall to the start of the second along the axis.
  let s0 = -Infinity;
  let s1 = Infinity;
  for (const [x, y] of rings[0]) s0 = Math.max(s0, (x - anchor[0]) * dx + (y - anchor[1]) * dy);
  for (const [x, y] of rings[1]) s1 = Math.min(s1, (x - anchor[0]) * dx + (y - anchor[1]) * dy);
  if (!(s1 > s0) || s1 - s0 > 12) {
    s0 = -2.25;
    s1 = 2.25;
  }
  // Wall thickness from the first polygon across the axis.
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const [x, y] of rings[0]) {
    const v = -(x - anchor[0]) * dy + (y - anchor[1]) * dx;
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const T = Math.max(2.4, Math.min(4, v1 - v0));
  const b: Basis = { ox: anchor[0], oy: anchor[1], ux: dx, uy: dy };
  // Which side of the wall is the city (v > 0 or v < 0)?
  const inSign = -(oldCity[0] - anchor[0]) * dy + (oldCity[1] - anchor[1]) * dx >= 0 ? 1 : -1;
  const brick = mix(BC.brickNew, BC.brickOld, 0.35);
  const hOpen = Math.min(4.5, H - 0.8);
  obox(w, b, s0 - 0.1, s1 + 0.1, -T / 2, T / 2, hOpen, H, shade(brick, 0.9), brick, shade(brick, 1.04));
  obox(w, b, s0, s1, -T / 2 - 0.05, T / 2 + 0.05, hOpen - 0.35, hOpen, BC.teakDark, BC.teakDark, BC.teakDark, SIDE.V0 | SIDE.V1);
  for (let k = 0; k < Math.floor((s1 - s0) / 2.2); k++) {
    const s = s0 + 1.1 + k * 2.2;
    obox(w, b, s - 0.55, s + 0.55, -T / 2 + 0.2, -T / 2 + 0.9, H, H + 0.9, brick, brick, shade(brick, 1.08));
    obox(w, b, s - 0.55, s + 0.55, T / 2 - 0.9, T / 2 - 0.2, H, H + 0.9, brick, brick, shade(brick, 1.08));
  }
  // Doors hinged at the jambs, opened ~70° into the city.
  const leaf = (s1 - s0) / 2;
  for (const [hs, dir] of [
    [s0, 1],
    [s1, -1],
  ] as const) {
    const ang = Math.atan2(dy, dx) + (dir > 0 ? 0 : Math.PI) + dir * inSign * 1.22;
    const [hx, hy] = bp(b, hs, inSign * 0.3, 0);
    const lb = basis(hx, hy, ang);
    obox(w, lb, 0, leaf, -0.08, 0.08, 0.05, hOpen - 0.4, shade(BC.doorGrey, 0.8), BC.doorGrey, BC.doorGrey);
    // Iron straps.
    for (const hh of [1.0, 2.6]) obox(w, lb, 0.05, leaf - 0.05, -0.1, 0.1, hh, hh + 0.12, BC.steelDark, BC.steelDark, BC.steelDark, SIDE.V0 | SIDE.V1);
  }
  // Uplights at the foot of the plaza face.
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const e = edgeOf(r, i);
      if (e.len < 8) continue;
      // Only the face looking away from the city.
      if ((e.nx * -dy + e.ny * dx) * inSign > -0.5) continue;
      const n = Math.floor(e.len / 10);
      for (let k = 0; k < n; k++) {
        const [x, y] = ep(e, (e.len * (k + 0.5)) / n, 0.5, 0);
        cbox(ctx.w.glow, basis(x, y, Math.atan2(e.ty, e.tx)), 0, 0, 0.4, 0.25, 0.05, 0.3, BC.lampWarm, BC.lampWarm, BC.lampWarm);
      }
    }
  }
}

// ------------------------------------------------------------------ monuments

/** Three bronze kings on a plinth, facing `ang` (0 = east). */
function threeKings(ctx: BuildContext, x: number, y: number, ang: number): void {
  const w = ctx.w.structures;
  const b = basis(x, y, ang);
  obox(w, b, -2.2, 2.2, -6.5, 6.5, 0, 0.5, shade(BC.templePlinth, 0.85), BC.templePlinth, BC.templePlinth);
  obox(w, b, -1.6, 1.6, -5.5, 5.5, 0.5, 2.1, shade(BC.stucco, 0.85), BC.stucco, BC.weathered);
  // Bronze plaque on the front face.
  wallQuadOn(w, b, 1.62, -1.6, 1.6, 0.9, 1.8, BC.bronze);
  const bronze = BC.bronze;
  const hi = shade(bronze, 1.25);
  for (const [v, pose] of [
    [-3.2, 0],
    [0, 1],
    [3.2, 2],
  ] as const) {
    const [fx, fy] = bp(b, 0, v, 0);
    const base = 2.1;
    // Robe, torso, head with a pointed crown.
    lathe(w, fx, fy, [
      [0.55, base],
      [0.42, base + 1.3],
      [0.36, base + 2.0],
      [0.2, base + 2.1],
    ], 8, [bronze, bronze, hi, hi], ang);
    lathe(w, fx, fy, [
      [0.17, base + 2.1],
      [0.2, base + 2.35],
      [0.12, base + 2.55],
      [0, base + 2.95],
    ], 6, [hi, hi, bronze, bronze], ang);
    // Arms: the middle king gestures forward, the outer kings hold a sword or rest a hand.
    const fb = basis(fx, fy, ang);
    const reach = pose === 1 ? 0.75 : 0.35;
    for (const sv of [-1, 1]) beam(w, bp(fb, 0, sv * 0.42, base + 1.95), bp(fb, sv > 0 && pose !== 0 ? reach : 0.2, sv * 0.5, base + (pose === 1 && sv > 0 ? 1.6 : 1.2)), 0.09, 0.07, bronze, hi);
    if (pose === 2) beam(w, bp(fb, 0.3, 0.55, base + 1.2), bp(fb, 0.3, 0.55, base + 0.1), 0.05, 0.03, hi, hi);
  }
  // Marigold offerings at the plinth foot.
  for (let k = 0; k < 6; k++) {
    const v = -4.5 + k * 1.8;
    cbox(w, b, 1.9, v, 0.8, 0.6, 0.5, 0.75, BC.gold, [240, 140, 40], [240, 140, 40]);
  }
  ctx.occ.markRing(
    [
      [-2.2, -6.5],
      [2.2, -6.5],
      [2.2, 6.5],
      [-2.2, 6.5],
    ].map(([u, v]) => bp(b, u, v, 0).slice(0, 2) as [number, number]),
    1,
  );
}

function wallQuadOn(w: MeshWriter, b: Basis, u: number, v0: number, v1: number, h0: number, h1: number, c: RGB): void {
  const [dx, dy] = bdir(b, 1, 0);
  face(w, bp(b, u, v0, h0), bp(b, u, v1, h0), bp(b, u, v1, h1), bp(b, u, v0, h1), shade(c, 0.9), c, [dx, dy, 0]);
}

/** White colonial hall: two storeys of tall windows, flat roof behind a parapet, pedimented portico. */
function colonialHall(ctx: BuildContext, s: Site): void {
  const w = ctx.w.buildings;
  const white = BC.templeWhite;
  const H = 9.5;
  shellWalls(w, s.ring, s.holes, 0, H + 1.1, white);
  punchedWindows(ctx, s.ring, s.b.id, 0, 4.6, 4.4, 2, { frac: 0.45, height: 2.4, sill: 0.9, slot: 3.4, lit: 0.45, glass: BC.glassDark, maxPerEdge: 20 });
  flatRoof(w, s.ring, s.holes, H, 1.1, white, shade(BC.roofConcrete, 0.95), false);
  // Portico on the edge facing east (the monument side).
  let best = 0;
  let score = -Infinity;
  for (let i = 0; i < s.ring.length; i++) {
    const e = edgeOf(s.ring, i);
    const sc = e.nx * Math.min(e.len, 30);
    if (sc > score) {
      score = sc;
      best = i;
    }
  }
  const e = edgeOf(s.ring, best);
  const mid = e.len / 2;
  const pw = Math.min(14, e.len * 0.4);
  const eb: Basis = { ox: e.ax, oy: e.ay, ux: e.tx, uy: e.ty };
  obox(w, eb, mid - pw / 2, mid + pw / 2, -4, 0, 0, 0.8, shade(white, 0.85), white, BC.templePlinth);
  for (let k = 0; k < 4; k++) cbox(w, eb, mid - pw / 2 + 0.6 + (k * (pw - 1.2)) / 3, -3.4, 0.7, 0.7, 0.8, H - 0.6, shade(white, 0.9), white, white, SIDE.SIDES);
  obox(w, eb, mid - pw / 2, mid + pw / 2, -4, 0, H - 0.6, H + 0.2, shade(white, 0.9), white, white);
  const pb: Basis = { ox: e.ax + e.tx * mid - e.nx * 2, oy: e.ay + e.ty * mid - e.ny * 2, ux: -e.ny, uy: e.nx };
  gable(w, pb, -2.2, 2.2, pw / 2, H + 0.2, H + 2.6, 0.3, 0.2, BC.tileBrick, white);
}

// ------------------------------------------------------------------ markets

/** Multi-storey market hall fitted to a ring: open lit ground floor, concrete bands, atrium skylight, lanterns. */
function marketHall(ctx: BuildContext, ring: Ring, storeys: number, key: number): void {
  const w = ctx.w.buildings;
  const g = 4.6;
  const f = 4.0;
  const H = g + (storeys - 1) * f;
  const cream = [226, 218, 196] as RGB;
  const band = [168, 164, 156] as RGB;
  for (let i = 0; i < ring.length; i++) {
    const e = edgeOf(ring, i);
    if (e.len < 0.5) continue;
    // Open, lit ground floor behind square piers.
    wallQuad(ctx.w.windows, e, 0, e.len, 0, g - 0.6, -0.8, BC.interiorWarm, shade(BC.interiorWarm, 1.2));
    const np = Math.max(1, Math.round(e.len / 6));
    const eb: Basis = { ox: e.ax, oy: e.ay, ux: e.tx, uy: e.ty };
    for (let k = 0; k <= np; k++) cbox(w, eb, (e.len * k) / np, 0.2, 0.6, 0.6, 0, g, shade(cream, 0.8), cream, cream, SIDE.SIDES);
    wallQuad(w, e, 0, e.len, g - 0.6, H, 0, shade(cream, 0.85), cream);
    for (let k = 0; k < storeys; k++) wallQuad(w, e, 0, e.len, g - 0.6 + k * f, g - 0.1 + k * f, 0.08, shade(band, 0.9), band);
    // Red lanterns strung under the first band.
    const nl = Math.floor(e.len / 3);
    for (let k = 0; k < nl; k++) {
      const [x, y] = ep(e, (e.len * (k + 0.5)) / nl, 0.7, 0);
      lathe(ctx.w.glow, x, y, [
        [0.18, g - 1.3],
        [0.3, g - 1.05],
        [0.18, g - 0.8],
      ], 6, [BC.lanternRed, BC.lanternRed, BC.lanternRed]);
    }
  }
  ribbonWindows(ctx, ring, key, 0, g, f, storeys, 1.6, BC.glassDark, 0.5, 8, -1, 1);
  const ceiling = insetRing(ring, 0.8);
  w.polygon(ceiling ?? ring, undefined, g - 0.6, shade(BC.interiorDark, 1.2));
  flatRoof(w, ring, [], H, 0.9, cream, shade(BC.roofConcrete, 0.95));
  // Atrium skylight: a raised glazed box with a metal ridge roof.
  const o = obbOf(ring, 0);
  const ow = Math.min(o.W * 0.35, 18);
  const ol = Math.min(o.L * 0.45, 40);
  obox(w, o.b, -ol / 2, ol / 2, -ow / 2, ow / 2, H, H + 1.5, BC.glassTeal, shade(BC.glassTeal, 1.2), BC.glassTeal, SIDE.SIDES);
  gable(w, o.b, -ol / 2, ol / 2, ow / 2, H + 1.5, H + 1.5 + ow * 0.25, 0.4, 0.3, BC.zinc, BC.glassTeal);
  rooftop(w, ring, o, H, key, { tanks: 3, shed: 0.8, antenna: 0.5, dish: 0.3, plants: 0, laundry: 0 });
}

/** Night Bazaar building: arcaded lit ground floor, lit stall signs, long illuminated sign band. */
function nightBazaar(ctx: BuildContext, s: Site): void {
  const w = ctx.w.buildings;
  const wall = [232, 222, 200] as RGB;
  const g = 4.5;
  const f = 3.6;
  const levels = 3;
  const H = g + (levels - 1) * f;
  shellWalls(w, s.ring, s.holes, 0, H + 1.0, wall);
  for (let i = 0; i < s.ring.length; i++) {
    const e = edgeOf(s.ring, i);
    if (e.len < 3) continue;
    wallQuad(ctx.w.windows, e, 0.4, e.len - 0.4, 0.05, g - 0.9, 0.05, BC.interiorWarm, BC.bulb);
    const n = Math.max(1, Math.floor(e.len / 5));
    const eb: Basis = { ox: e.ax, oy: e.ay, ux: e.tx, uy: e.ty };
    for (let k = 0; k <= n; k++) cbox(w, eb, 0.3 + ((e.len - 0.6) * k) / n, -0.25, 0.5, 0.5, 0, g, shade(wall, 0.85), wall, wall, SIDE.SIDES);
    // Sign band of alternating lit panels.
    const np = Math.max(1, Math.floor(e.len / 2.5));
    const cols = [BC.lanternRed, BC.gold, BC.grilleWhite, BC.mosaicBlue];
    for (let k = 0; k < np; k++) {
      const c = cols[(k + i) % cols.length];
      wallQuad(ctx.w.glow, e, (e.len * k) / np + 0.1, (e.len * (k + 1)) / np - 0.1, g - 0.8, g - 0.1, 0.1, c, c);
    }
  }
  punchedWindows(ctx, s.ring, s.b.id, 0, g, f, levels, { frac: 0.55, height: 1.7, sill: 0.8, slot: 3.2, lit: 0.6, glass: BC.glassDark, maxPerEdge: 30 }, -1, 3, 1);
  flatRoof(w, s.ring, s.holes, H, 1.0, wall, BC.roofConcrete, false);
  rooftop(w, s.ring, obbOf(s.ring, s.b.o[2]), H, s.b.id, { tanks: 3, shed: 0.8, antenna: 0.8, dish: 0.5, plants: 0, laundry: 0 });
}

/** Boxing ring under an open metal roof, near the anchor where there is room. */
function boxingRing(ctx: BuildContext, anchor: [number, number], roads: RoadIndex): [number, number] | null {
  const w = ctx.w.structures;
  let spot: [number, number] | null = null;
  for (let r = 0; r <= 30 && !spot; r += 3) {
    for (let k = 0; k < 8 && !spot; k++) {
      const x = anchor[0] + Math.cos((k * Math.PI) / 4) * r;
      const y = anchor[1] + Math.sin((k * Math.PI) / 4) * r;
      let ok = true;
      for (let i = -2; i <= 2 && ok; i++) for (let j = -2; j <= 2 && ok; j++) ok = ctx.occ.free(x + i * 3, y + j * 3) && !roads.onCarriageway(x + i * 3, y + j * 3, 1);
      if (ok) spot = [x, y];
    }
  }
  if (!spot) return null;
  const b = basis(spot[0], spot[1], 0);
  obox(w, b, -3.2, 3.2, -3.2, 3.2, 0, 1.2, BC.mosaicBlue, shade(BC.mosaicBlue, 1.1), BC.mosaicBlue, SIDE.SIDES);
  obox(ctx.w.glow, b, -3.0, 3.0, -3.0, 3.0, 1.2, 1.25, BC.glare, BC.glare, [220, 232, 245], SIDE.TOP);
  const corner: RGB[] = [BC.lanternRed, BC.grilleWhite, BC.mosaicBlue, BC.grilleWhite];
  [
    [-3, -3],
    [3, -3],
    [3, 3],
    [-3, 3],
  ].forEach(([u, v], k) => cbox(w, b, u, v, 0.2, 0.2, 1.2, 2.6, corner[k], corner[k], corner[k]));
  for (const hh of [1.7, 2.1, 2.5]) {
    for (const sv of [-1, 1]) {
      obox(w, b, -3, 3, sv * 3 - 0.03, sv * 3 + 0.03, hh, hh + 0.05, BC.grilleWhite, BC.grilleWhite, BC.grilleWhite);
      obox(w, b, sv * 3 - 0.03, sv * 3 + 0.03, -3, 3, hh, hh + 0.05, BC.grilleWhite, BC.grilleWhite, BC.grilleWhite);
    }
  }
  for (const [u, v] of [
    [-7, -7],
    [7, -7],
    [7, 7],
    [-7, 7],
  ]) cbox(w, b, u, v, 0.3, 0.3, 0, 6, BC.steelDark, BC.concreteDark, BC.concreteDark, SIDE.SIDES);
  gable(w, b, -7.5, 7.5, 7.5, 6, 8, 0.5, 0.4, BC.zinc, null);
  ctx.occ.markDisc(spot[0], spot[1], 8);
  return spot;
}

// ------------------------------------------------------------------ Nimman

/**
 * MAYA: a ~6-floor cube of dark glass behind a diagonal Lanna-textile lattice
 * (warm-lit at night), glazed entrance and a roof garden.
 */
function maya(ctx: BuildContext, s: Site): void {
  const w = ctx.w.buildings;
  const H = 30;
  const wall = [110, 108, 104] as RGB;
  shellWalls(w, s.ring, s.holes, 0, H + 1.2, wall);
  ribbonWindows(ctx, s.ring, s.b.id, 0, 5, 4.5, 6, 2.2, BC.glassDark, 0.55, 10);
  const lattice: RGB = [201, 185, 154];
  for (let i = 0; i < s.ring.length; i++) {
    const e = edgeOf(s.ring, i);
    if (e.len < 15) continue;
    latticeOn(ctx.w.glow, e, 5, H - 0.5, 6.5, 0.7, 0.3, lattice);
    wallQuad(ctx.w.windows, e, e.len * 0.3, e.len * 0.7, 0.05, 4.4, 0.05, BC.interiorWarm, BC.glare);
  }
  flatRoof(w, s.ring, s.holes, H, 1.2, wall, BC.roofConcrete, false);
  const inner = insetRing(s.ring, 8);
  if (inner) w.polygon(inner, undefined, H + 0.15, BC.plant);
}

/** Diagonal lattice strips on a facade between h0 and h1, clipped to the edge. */
function latticeOn(w: MeshWriter, e: Edge, h0: number, h1: number, pitch: number, width: number, off: number, c: RGB): void {
  const H = h1 - h0;
  for (const dir of [1, -1]) {
    for (let c0 = -H; c0 < e.len + H; c0 += pitch) {
      // Strip between s - dir*(h - h0) = c0 and c0 + width, in (s, h) space.
      const quad: [number, number][] = [
        [c0, h0],
        [c0 + width, h0],
        [c0 + width + dir * H, h1],
        [c0 + dir * H, h1],
      ];
      const poly = clipRect(quad, 0, e.len, h0, h1);
      if (poly.length < 3) continue;
      const pts = poly.map(([s, h]) => ep(e, s, off, h));
      for (let k = 1; k < pts.length - 1; k++) tri3(w, pts[0], pts[k], pts[k + 1], c, [e.nx, e.ny, 0]);
    }
  }
}

/** Sutherland–Hodgman clip of a polygon to s0..s1 × h0..h1. */
function clipRect(poly: [number, number][], s0: number, s1: number, h0: number, h1: number): [number, number][] {
  const clip = (pts: [number, number][], inside: (p: [number, number]) => boolean, cut: (a: [number, number], b: [number, number]) => [number, number]) => {
    const out: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ia = inside(a);
      const ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    return out;
  };
  const atS = (s: number) => (a: [number, number], b: [number, number]): [number, number] => [s, a[1] + ((b[1] - a[1]) * (s - a[0])) / (b[0] - a[0] || 1e-9)];
  const atH = (h: number) => (a: [number, number], b: [number, number]): [number, number] => [a[0] + ((b[0] - a[0]) * (h - a[1])) / (b[1] - a[1] || 1e-9), h];
  let p = clip(poly, (q) => q[0] >= s0, atS(s0));
  p = clip(p, (q) => q[0] <= s1, atS(s1));
  p = clip(p, (q) => q[1] >= h0, atH(h0));
  p = clip(p, (q) => q[1] <= h1, atH(h1));
  return p;
}

/** One Nimman: red-brick arcades round the block and a clock tower on the street corner. */
function oneNimman(ctx: BuildContext, s: Site, roads: RoadIndex): void {
  const w = ctx.w.buildings;
  const brick: RGB = [168, 87, 58];
  const g = 4.4;
  const f = 3.6;
  const levels = 3;
  const H = g + (levels - 1) * f;
  shellWalls(w, s.ring, s.holes, 0, H + 1.0, brick);
  for (let i = 0; i < s.ring.length; i++) {
    const e = edgeOf(s.ring, i);
    if (e.len < 6) continue;
    const n = Math.floor(e.len / 4);
    for (let k = 0; k < n; k++) {
      const sc = (e.len * (k + 0.5)) / n;
      archOn(ctx, e, sc, 2.6, 0, 3.6, 0.05, k % 3 !== 1);
      archOn(ctx, e, sc, 1.4, g + 0.8, g + 2.8, 0.05, hash01(s.b.id * 13 + i * 31 + k, 5) < 0.55);
      archOn(ctx, e, sc, 1.4, g + f + 0.8, g + f + 2.8, 0.05, hash01(s.b.id * 17 + i * 31 + k, 6) < 0.5);
    }
    // White cornice.
    wallQuad(w, e, 0, e.len, H - 0.5, H, 0.08, BC.templeWhite, BC.templeWhite);
  }
  flatRoof(w, s.ring, s.holes, H, 1.0, brick, shade(BC.roofConcrete, 0.95), false);
  // Clock tower at the corner nearest a main road.
  let best = 0;
  let bd = Infinity;
  s.ring.forEach(([x, y], i) => {
    const hit = roads.nearest(x, y, 80, 3);
    if (hit && hit.d < bd) {
      bd = hit.d;
      best = i;
    }
  });
  const [cx, cy] = centroid(s.ring);
  const [vx, vy] = s.ring[best];
  const dl = Math.hypot(cx - vx, cy - vy) || 1;
  const tx = vx + ((cx - vx) / dl) * 3.5;
  const ty = vy + ((cy - vy) / dl) * 3.5;
  const tb = basis(tx, ty, s.b.o[2] / 1000);
  obox(w, tb, -2.6, 2.6, -2.6, 2.6, 0, 20, shade(brick, 0.85), brick, brick, SIDE.SIDES);
  for (let k = 0; k < 4; k++) wallQuadOn(w, basis(tx, ty, s.b.o[2] / 1000 + (k * Math.PI) / 2), 2.62, -0.6, 0.6, 6 + k * 0.01, 14, BC.lacquerBlack);
  obox(w, tb, -3.0, 3.0, -3.0, 3.0, 20, 23.2, BC.templeWhite, BC.templeWhite, BC.templeWhite);
  for (let k = 0; k < 4; k++) clockFace(ctx.w.glow, basis(tx, ty, s.b.o[2] / 1000 + (k * Math.PI) / 2), 3.02, 21.6, 1.2);
  lathe(w, tx, ty, [
    [3.4, 23.2],
    [0, 26.5],
  ], 4, [BC.tileGrey, shade(BC.tileGrey, 1.1)], s.b.o[2] / 1000 + Math.PI / 4);
  beam(w, [tx, ty, 26.3], [tx, ty, 27.8], 0.1, 0.02, BC.gold, BC.goldLit);
  ctx.occ.markDisc(tx, ty, 3.5);
}

/** Round-headed arch on a facade: a dark (or lit) opening with a semicircular head. */
function archOn(ctx: BuildContext, e: Edge, sc: number, width: number, h0: number, h1: number, off: number, lit: boolean): void {
  const w = lit ? ctx.w.windows : ctx.w.buildings;
  const c = lit ? BC.interiorWarm : BC.glassDark;
  const hw = width / 2;
  wallQuad(w, e, sc - hw, sc + hw, h0, h1, off, shade(c, 0.85), c);
  // Semicircular head as a fan.
  const centre = ep(e, sc, off, h1);
  const seg = 5;
  for (let k = 0; k < seg; k++) {
    const a0 = Math.PI - (k / seg) * Math.PI;
    const a1 = Math.PI - ((k + 1) / seg) * Math.PI;
    tri3(w, centre, ep(e, sc + Math.cos(a0) * hw, off, h1 + Math.sin(a0) * hw), ep(e, sc + Math.cos(a1) * hw, off, h1 + Math.sin(a1) * hw), c, [e.nx, e.ny, 0]);
  }
}

/** Lit clock face (a flat 12-gon) on the +u face of a basis at distance u. */
function clockFace(w: MeshWriter, b: Basis, u: number, h: number, r: number): void {
  const [dx, dy] = bdir(b, 1, 0);
  const n = 12;
  const centre = bp(b, u, 0, h);
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2;
    const a1 = ((k + 1) / n) * Math.PI * 2;
    tri3(w, centre, bp(b, u, Math.cos(a0) * r, h + Math.sin(a0) * r), bp(b, u, Math.cos(a1) * r, h + Math.sin(a1) * r), [245, 240, 225], [dx, dy, 0]);
  }
  beam(w, bp(b, u + 0.03, 0, h), bp(b, u + 0.03, 0, h + r * 0.8), 0.04, 0.03, BC.lacquerBlack);
  beam(w, bp(b, u + 0.03, 0, h), bp(b, u + 0.03, r * 0.55, h), 0.04, 0.03, BC.lacquerBlack);
}

// ------------------------------------------------------------------ airport

/**
 * CNX terminal: glazed two-storey hall under a long dark roof with a raised
 * clerestory and gold gable trim, jet bridges on the airside (the long face
 * nearest the runway, west) and a control tower [est].
 */
function terminal(ctx: BuildContext, s: Site): void {
  const w = ctx.w.buildings;
  const wall: RGB = [214, 210, 202];
  const H = 13;
  shellWalls(w, s.ring, s.holes, 0, H, wall);
  ribbonWindows(ctx, s.ring, s.b.id, 0, 6.5, 6.5, 2, 4.2, BC.glassBlue, 0.7, 12);
  const o = obbOf(s.ring, s.b.o[2]);
  const roofC: RGB = [58, 56, 60];
  w.polygon(s.ring, undefined, H, shade(wall, 0.8));
  gable(w, o.b, -o.L / 2, o.L / 2, o.W / 2, H, H + 7, 3.5, 2.5, roofC, shade(roofC, 1.2), BC.goldDark, 0.6);
  gable(w, o.b, -o.L / 2 + 10, o.L / 2 - 10, o.W * 0.16, H + 7 * 0.68 + 1.6, H + 7 + 2.6, 1.2, 0.8, shade(roofC, 1.1), BC.glassTeal);
  for (const su of [-1, 1]) {
    const [dx, dy] = bdir(o.b, su, 0);
    face(w, bp(o.b, su * (o.L / 2 - 10), -o.W * 0.16, H + 7 * 0.68), bp(o.b, su * (o.L / 2 - 10), o.W * 0.16, H + 7 * 0.68), bp(o.b, su * (o.L / 2 - 10), o.W * 0.16, H + 7 * 0.68 + 1.6), bp(o.b, su * (o.L / 2 - 10), -o.W * 0.16, H + 7 * 0.68 + 1.6), BC.glassTeal, BC.glassTeal, [dx, dy, 0]);
  }
  // Jet bridges from the airside face (outward normal pointing west).
  let best = -1;
  let score = 0.3;
  for (let i = 0; i < s.ring.length; i++) {
    const e = edgeOf(s.ring, i);
    const sc = -e.nx * Math.min(1, e.len / 100);
    if (e.len > 60 && sc > score) {
      score = sc;
      best = i;
    }
  }
  if (best >= 0) {
    const e = edgeOf(s.ring, best);
    const eb: Basis = { ox: e.ax, oy: e.ay, ux: e.tx, uy: e.ty };
    const n = Math.min(8, Math.max(4, Math.floor(e.len / 45)));
    for (let k = 0; k < n; k++) {
      const sc = (e.len * (k + 0.5)) / n;
      obox(w, eb, sc - 1.4, sc + 1.4, -24, 0, 4.2, 6.8, shade(BC.slab, 0.85), BC.slab, BC.zinc);
      obox(w, eb, sc - 1.45, sc + 1.45, -24, -1, 5.0, 6.2, BC.glassDark, BC.glassDark, BC.glassDark, SIDE.U0 | SIDE.U1);
      cbox(w, eb, sc, -20, 0.8, 0.8, 0, 4.2, BC.steelDark, BC.steelDark, BC.steelDark, SIDE.SIDES);
      cbox(w, eb, sc, -25.5, 3.6, 3.6, 3.8, 7.2, shade(BC.slab, 0.85), BC.slab, BC.zinc);
    }
  }
  // Control tower beside the south end, landside [est].
  const [tx, ty] = bp(o.b, (o.b.uy >= 0 ? -1 : 1) * (o.L / 2 + 30), o.W / 2 + 25, 0);
  if (ctx.occ.free(tx, ty)) {
    lathe(w, tx, ty, [
      [3.2, 0],
      [2.6, 34],
      [4.8, 35],
      [4.8, 35.3],
    ], 8, [wall, wall, wall, wall]);
    lathe(ctx.w.windows, tx, ty, [
      [4.6, 35.3],
      [5.0, 39],
    ], 8, [BC.glassTeal, BC.glassTeal]);
    lathe(w, tx, ty, [
      [5.2, 39],
      [4.5, 40],
      [0.3, 41],
      [0.1, 45],
    ], 8, [BC.slab, BC.slab, BC.steelDark, BC.steelDark]);
    ctx.occ.markDisc(tx, ty, 5);
  }
}

