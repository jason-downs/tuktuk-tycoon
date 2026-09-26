// Buildings: shophouses, houses, blocks and canopies from OSM footprints, plus
// the temple halls and chedis inside temple grounds (temples.ts).

import { ringOf, type CityBuilding } from '../city';
import type { BuildContext } from './context';
import { hash01, mix, pickWeighted, shade, type MeshWriter, type RGB } from './mesh';
import { MODERN_WALLS, P, PITCHED_ROOFS, SIGNS, WALLS } from './palette';
import { at, box, frameOf, frustum, gableRoof, hexOf, hipRoof, type Ring } from './shapes';
import { chedi, viharn } from './temples';

export function buildBuildings(ctx: BuildContext): number {
  const { city, w, occ, str } = ctx;
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

  return built;
}

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
