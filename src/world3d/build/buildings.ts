// Buildings from OSM footprints (docs/3d/world.md §1.2, §2.4). Every footprint
// is classified (tags first, then size, street front and district), given a
// storey count and height (tags win; untagged buildings respect the Old City
// 12 m and near-temple 9 m caps) and drawn by its typology: shophouse rows,
// houses, Lanna houses, blocks, condos, schools, hospitals, malls, markets,
// canopies, kiosks, sheds, churches, mosques and shrines. Temple grounds
// (temples.ts) and hero landmarks (landmarks.ts) are built first; the
// footprints they replace are skipped here.

import { ringOf, type CityData } from '../city';
import { BC, HOUSE_ROOFS, HOUSE_WALLS, METAL_ROOFS } from './buildingPalette';
import { chediAt } from './chedi';
import type { BuildContext } from './context';
import { edgeOf, segDist } from './kit';
import { buildLandmarks } from './landmarks';
import { BAZAAR_AREAS } from './landmarks3d';
import { hash01, pickWeighted, type RGB } from './mesh';
import { MODERN_WALLS, WALLS } from './palette';
import { pointInRing } from './shapes';
import { BAY_MIN, bayLayout, shophouse, type BayUse, type RowInfo, type RowStyle } from './shophouse';
import { siteOf, type BuildEnv, type BuildingClass, type Plan, type PlanEnv, type RoofKind, type Site } from './site';
import { buildTemples, groundsOf } from './temples';
import { block, canopy, chineseShrine, church, condo, hospital, house, kiosk, lannaHouse, mall, mosque, school, shed } from './typologies';

export type { BuildEnv, Plan, Site } from './site';

/** Height caps for untagged buildings [research: Citylife "In the zone"]. */
export const OLD_CITY_CAP = 12;
export const TEMPLE_CAP = 9;
export const TEMPLE_CAP_RADIUS = 100;

const URBAN_ZONES = new Set(['old_city', 'moat_ring', 'tha_phae', 'night_bazaar', 'chinatown', 'riverside', 'wat_ket', 'nimman', 'santitham', 'suan_dok', 'chang_phueak', 'wua_lai']);

function colourTag(v: string): RGB | null {
  if (/^#?[0-9a-f]{6}$/i.test(v)) {
    const n = parseInt(v.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const named: Record<string, string> = { white: '#f3f0e8', grey: '#a9a9a4', gray: '#a9a9a4', maroon: '#7a2f2a', olive: '#8a8a4a', brown: '#7a5a40', 'sage green': '#a7b89a', red: '#b8322a', yellow: '#efd48a', blue: '#6a8fb5', green: '#6f9a6a', black: '#2a2a2a' };
  const hexv = named[v.toLowerCase()];
  return hexv ? colourTag(hexv) : null;
}

/** Classify a footprint (first match wins, docs/3d/world.md §2.4). */
export function classify(s: Site, env: PlanEnv): BuildingClass {
  const { kind, use, zone, area } = s;
  if (s.b.part) return 'skip';
  const rel = env.str(s.b.rel);
  const tower = env.str(s.b.tt);
  if (kind === 'roof' || kind === 'carport' || kind === 'transportation' || kind === 'bus_station' || use === 'fuel') return 'canopy';
  if (kind === 'church' || kind === 'chapel' || kind === 'cathedral' || (rel === 'christian' && use === 'place_of_worship')) return 'church';
  if (kind === 'mosque' || (rel === 'muslim' && (use === 'place_of_worship' || kind === 'yes' || kind === 'church'))) return 'mosque';
  if (rel === 'chinese_folk' || rel === 'taoist' || /shrine|ศาลเจ้า|chinese temple/i.test(s.name)) return 'shrine';
  if (use === 'stupa' || tower === 'pagoda' || tower === 'stupa') return 'chedi';
  if (kind === 'hospital' || use === 'hospital') return 'hospital';
  if (['school', 'university', 'college', 'kindergarten', 'train_station'].includes(kind) || ['school', 'university', 'college', 'kindergarten'].includes(use)) return 'school';
  if (kind === 'hangar') return 'hangar';
  if (['industrial', 'warehouse', 'stadium', 'sports_hall', 'fire_station'].includes(kind)) return 'shed';
  if (kind === 'kiosk' || kind === 'toilets' || kind === 'garage' || kind === 'garages' || kind === 'outbuilding' || kind === 'service') return area < 60 ? 'kiosk' : 'shed';
  if (use === 'mall' || kind === 'mall' || ((kind === 'retail' || kind === 'commercial') && area >= 2500)) return 'mall';
  if (env.inMarket(s.cx, s.cy) || use === 'marketplace') return area > 150 ? 'market' : 'kiosk';
  if ((kind === 'apartments' || kind === 'dormitory' || kind === 'residential' || kind === 'apartments;yes') && ((s.b.l ?? 0) >= 5 || area >= 600)) return 'condo';
  if (kind === 'hotel' || use === 'hotel') {
    if (area < 800 && (s.b.l ?? 0) < 5 && (zone === 'old_city' || zone === 'riverside' || zone === 'wat_ket')) return 'block';
    return area >= 300 || (s.b.l ?? 0) >= 4 ? 'hotel' : 'block';
  }
  if (kind === 'office' || kind === 'civic' || kind === 'public' || kind === 'government') return area > 400 ? 'office' : 'block';
  if (['house', 'detached', 'bungalow', 'semidetached_house'].includes(kind)) return lannaChance(s) ? 'lanna_house' : 'house';
  const urban = URBAN_ZONES.has(zone) || (zone === 'suburb' && s.roadCls <= 3);
  if (kind === 'terrace' && s.front >= 0 && s.frontLen >= BAY_MIN) return 'shophouse';
  // Untagged (or generic) footprints by size and street front.
  if (area < 40) return 'kiosk';
  if (s.front >= 0 && s.frontLen >= BAY_MIN && s.rect >= 0.8 && s.depth >= 6 && s.depth <= 32 && urban && zone !== 'airport' && s.frontLen <= 90) return 'shophouse';
  if (area < 250) return lannaChance(s) ? 'lanna_house' : 'house';
  // House compounds in the suburbs; guesthouse and apartment blocks in town.
  if (area < 800 && (zone === 'suburb' || zone === 'airport')) return 'house';
  if (area < 2500) return 'block';
  if (zone === 'airport') return 'hangar';
  return zone === 'suburb' ? 'shed' : 'mall';
}

function lannaChance(s: Site): boolean {
  return (s.zone === 'wat_ket' || s.zone === 'wua_lai') && hash01(s.b.id, 13) < 0.08 && s.rect >= 0.75 && s.area < 250;
}

/** Storey count for an untagged building of a class (docs/3d/world.md §2.4). */
function storeys(s: Site, cls: BuildingClass): number {
  const u = hash01(s.b.id, 1);
  const z = s.zone;
  switch (cls) {
    case 'shophouse':
      if (z === 'old_city' || z === 'wua_lai' || z === 'moat_ring') return u < 0.45 ? 2 : u < 0.85 ? 3 : 4;
      if (z === 'nimman' || z === 'night_bazaar' || z === 'santitham') return u < 0.15 ? 2 : u < 0.65 ? 3 : 4;
      if (z === 'wat_ket' || z === 'chinatown') return u < 0.6 ? 2 : 3;
      return u < 0.5 ? 2 : u < 0.9 ? 3 : 4;
    case 'house':
      return u < 0.4 ? 1 : 2;
    case 'lanna_house':
    case 'kiosk':
    case 'canopy':
    case 'market':
    case 'church':
    case 'mosque':
    case 'shrine':
    case 'hangar':
      return 1;
    case 'shed':
      return 1;
    case 'block':
      if (s.area < 800) {
        if (z === 'old_city' || z === 'moat_ring') return 3 + Math.floor(u * 2);
        if (z === 'nimman' || z === 'santitham' || z === 'suan_dok') return 3 + Math.floor(u * 3);
        return 2 + Math.floor(u * 2);
      }
      if (z === 'nimman' || z === 'night_bazaar' || z === 'santitham' || z === 'suan_dok') return 5 + Math.floor(u * 4);
      return 2 + Math.floor(u * 2);
    case 'condo':
      return z === 'nimman' || z === 'santitham' ? 6 + Math.floor(u * 7) : 5 + Math.floor(u * 4);
    case 'hotel':
      return s.area > 800 ? 5 + Math.floor(u * 4) : 4 + Math.floor(u * 3);
    case 'office':
      return 3 + Math.floor(u * 3);
    case 'school':
      return 2 + Math.floor(u * 2);
    case 'hospital':
      return 3 + Math.floor(u * 4);
    case 'mall':
      return 2 + Math.floor(u * 2);
    default:
      return 1;
  }
}

/** Full plan: class, storeys, heights (tags win; caps for untagged), roof and colours. */
export function planBuilding(s: Site, env: PlanEnv): Plan {
  let cls = classify(s, env);
  const b = s.b;
  const u = (k: number) => hash01(b.id, 20 + k);
  // Blocks of 800+ m² in the busy districts are mid-rise condos.
  if (cls === 'block' && s.area >= 800 && ['nimman', 'night_bazaar', 'santitham', 'suan_dok'].includes(s.zone)) cls = 'condo';
  let style: RowStyle = 'concrete';
  if (cls === 'shophouse') {
    if ((s.zone === 'tha_phae' || s.zone === 'chinatown' || s.zone === 'wat_ket') && s.rect >= 0.85 && u(1) < 0.3) style = 'wooden';
    else if (s.zone === 'nimman' && u(1) < 0.5) style = 'modern';
  }
  const commercial = cls === 'shophouse' || cls === 'office' || cls === 'mall' || cls === 'block' || cls === 'hotel';
  let ground = cls === 'mall' ? 5.5 : cls === 'hangar' ? 12 : cls === 'shed' ? 6 : cls === 'school' ? 3.6 : cls === 'hospital' ? 4.2 : commercial ? 4.0 : cls === 'church' ? 7 : cls === 'kiosk' ? 2.8 : cls === 'canopy' || cls === 'market' ? 5.5 : 3.0;
  const floor = cls === 'mall' ? 5 : cls === 'condo' || cls === 'hotel' ? 3.0 : cls === 'school' ? 3.5 : cls === 'hospital' ? 3.8 : 3.1;
  if (cls === 'condo') ground = 4.0;
  if (cls === 'shed' && s.area > 2000) ground = 8;

  // Roof.
  let roof: RoofKind = 'flat';
  const rs = b.rs ?? 0;
  if (cls === 'house') {
    const r = u(2);
    roof = r < 0.6 ? 'hip' : r < 0.9 ? 'gable' : r < 0.95 ? 'kalae' : 'flat';
  } else if (cls === 'lanna_house') roof = 'kalae';
  else if (cls === 'school') roof = 'hip';
  else if (cls === 'shophouse') roof = style === 'wooden' ? 'gable' : u(3) < 0.85 ? 'flat' : u(4) < 0.5 ? 'skillion' : 'gable';
  else if (cls === 'block') roof = s.zone === 'suburb' || s.zone === 'wat_ket' || s.zone === 'wua_lai' ? (u(5) < 0.55 ? 'hip' : 'flat') : u(5) < 0.2 ? 'hip' : 'flat';
  else if (cls === 'shed' || cls === 'kiosk' || cls === 'church' || cls === 'shrine' || cls === 'hangar') roof = 'gable';
  if (rs === 1) roof = 'flat';
  else if (rs === 2) roof = 'gable';
  else if (rs === 3 || rs === 4 || rs === 9) roof = 'hip';
  else if (rs === 5) roof = 'skillion';

  // Colours.
  const tagWall = colourTag(env.str(b.c));
  const tagRoof = colourTag(env.str(b.rc));
  let wall: RGB;
  if (tagWall) wall = tagWall;
  else if (cls === 'house' || cls === 'block') wall = pickWeighted(s.zone === 'nimman' ? MODERN_WALLS : cls === 'house' ? HOUSE_WALLS : WALLS, u(6));
  else if (cls === 'condo' || cls === 'hotel' || cls === 'office' || cls === 'mall') wall = pickWeighted(MODERN_WALLS, u(6));
  else if (cls === 'school') wall = u(6) < 0.6 ? [239, 228, 201] : [242, 214, 138];
  else if (cls === 'hospital' || cls === 'church' || cls === 'mosque') wall = [243, 240, 232];
  else if (cls === 'shed' || cls === 'hangar' || cls === 'canopy' || cls === 'market') wall = u(6) < 0.5 ? BC.zinc : [190, 196, 200];
  else if (cls === 'kiosk') wall = pickWeighted(WALLS, u(6));
  else if (style === 'modern') wall = pickWeighted(MODERN_WALLS, u(6));
  else wall = pickWeighted(WALLS, u(6));
  let roofC: RGB;
  if (tagRoof) roofC = tagRoof;
  else if (cls === 'school') roofC = BC.tileTerracotta;
  else if (cls === 'lanna_house') roofC = u(7) < 0.5 ? BC.tileBrown : BC.tileGrey;
  else if (cls === 'shed' || cls === 'hangar' || cls === 'canopy' || cls === 'market' || cls === 'kiosk' || cls === 'shophouse') roofC = pickWeighted(METAL_ROOFS, u(7));
  else if (cls === 'church') roofC = BC.tileBrick;
  else roofC = pickWeighted(HOUSE_ROOFS, u(7));

  // Storeys and heights.
  const tagged = !!(b.ht || b.l);
  let levels = b.l ? Math.max(1, Math.round(b.l)) : storeys(s, cls);
  if (style === 'wooden' && !b.l) levels = 2;
  const base = b.mh ? b.mh / 10 : b.ml ? b.ml * floor : 0;
  let parapet = roof === 'flat' ? (cls === 'shophouse' ? 0.8 + u(8) * 0.4 : cls === 'house' ? 0.6 : 1.0) : 0;
  if (cls === 'canopy' || cls === 'market') parapet = 0;
  const riseOf = (): number => {
    if (roof === 'flat') return 0;
    if (cls === 'lanna_house') return Math.max(2.2, s.W * 0.6);
    if (cls === 'church') return s.W * 0.55;
    if (cls === 'school') return Math.min(4, Math.max(1.5, s.W * 0.25));
    if (cls === 'shophouse') return style === 'wooden' ? Math.min(2.6, s.depth * 0.18) : Math.min(1.6, s.W * 0.12);
    if (cls === 'shed' || cls === 'hangar') return Math.min(3, s.W * 0.15);
    if (cls === 'kiosk') return Math.min(0.8, s.W * 0.15);
    return Math.min(3.5, Math.max(1.2, s.W * 0.28));
  };
  let rise = riseOf();
  let wallTop: number;
  if (cls === 'lanna_house') wallTop = base + 4.7;
  else if (b.ht) wallTop = base + Math.max(2.5, b.ht / 10 - (roof === 'flat' ? parapet : rise) - base);
  else wallTop = base + ground + (levels - 1) * floor;
  if (b.ht && !b.l) levels = Math.max(1, Math.round((wallTop - base - ground) / floor) + 1);

  // Caps for untagged buildings: lower a pitched roof, drop storeys, then trim what is left.
  let cap = Infinity;
  if (!tagged && cls !== 'chedi' && cls !== 'church' && cls !== 'mosque' && cls !== 'hangar') {
    if (s.zone === 'old_city' || s.zone === 'moat_ring') cap = OLD_CITY_CAP;
    if (env.nearTemple(s.cx, s.cy)) cap = Math.min(cap, TEMPLE_CAP);
  }
  const topOf = () => wallTop + (roof === 'flat' ? parapet : rise);
  if (cap < Infinity) {
    if (roof !== 'flat' && topOf() > cap) rise = Math.max(Math.min(rise, 0.8), cap - wallTop);
    while (topOf() > cap && levels > 1 && cls !== 'lanna_house') {
      levels--;
      wallTop = base + ground + (levels - 1) * floor;
    }
    if (topOf() > cap) {
      if (roof === 'flat') parapet = Math.max(0.3, cap - wallTop);
      else rise = Math.max(0.5, cap - wallTop);
      if (topOf() > cap) {
        wallTop = Math.max(2.4, cap - (roof === 'flat' ? parapet : rise));
        if (cls === 'shophouse' || commercial) ground = Math.min(ground, wallTop - base);
      }
    }
  }
  return {
    cls,
    style,
    levels,
    ground,
    floor,
    base,
    wallTop,
    roof,
    parapet,
    rise,
    top: topOf(),
    tagged,
    cap,
    wall,
    roofC,
    lean: !env.inPlay(s.cx, s.cy),
  };
}

const SHOP_USES: [BayUse, string[]][] = [
  ['convenience', ['convenience', 'supermarket']],
  ['cafe', ['cafe', 'coffee', 'bakery', 'ice_cream', 'tea']],
  ['restaurant', ['restaurant', 'fast_food', 'food_court']],
  ['bar', ['bar', 'pub', 'nightclub', 'biergarten']],
  ['massage', ['massage', 'beauty', 'spa']],
  ['hostel', ['hotel', 'guest_house', 'hostel', 'motel']],
  ['office', ['bank', 'pharmacy', 'clinic', 'dentist', 'doctors', 'optician', 'mobile_phone', 'travel_agency', 'hairdresser', 'laundry', 'chemist']],
  ['moto', ['motorcycle', 'motorcycle_rental', 'motorcycle_repair', 'car', 'car_repair', 'bicycle', 'rental']],
];

/** Look of a bay from a shopfront kind ("shop:massage", "cafe", "craft"…). */
function useOfShop(k: string): BayUse | null {
  const v = k.replace(/^shop:/, '');
  for (const [use, values] of SHOP_USES) if (values.includes(v)) return use;
  if (k.startsWith('shop:') || k === 'craft') return 'shop';
  return null;
}

export function makeEnv(ctx: BuildContext): BuildEnv {
  const { city } = ctx;
  const str = (i: number | undefined) => (i ? city.strings[i] : '');
  const grounds = groundsOf(city);
  const markets: BuildEnv['markets'] = [];
  for (const a of city.areas) {
    if (city.areaKinds[a.k] !== 'market' && !BAZAAR_AREAS.includes(a.id ?? -1)) continue;
    markets.push({ ring: ringOf(a.r), name: str(a.n), id: a.id ?? 0 });
  }
  const [px0, py0, px1, py1] = city.play.map((v) => v / 10);
  const M = 60;
  const R = TEMPLE_CAP_RADIUS;
  const env: BuildEnv = {
    city,
    str,
    grounds,
    markets,
    hidden: new Set(),
    handled: new Set(),
    shopsAt: new Map(),
    inPlay: (x, y) => x >= px0 - M && x <= px1 + M && y >= py0 - M && y <= py1 + M,
    inMarket: (x, y) => markets.some((m) => pointInRing(x, y, m.ring)),
    nearTemple: (x, y) => {
      for (const g of grounds) {
        if (x < g.x0 - R || x > g.x1 + R || y < g.y0 - R || y > g.y1 + R) continue;
        if (pointInRing(x, y, g.ring)) return true;
        for (let i = 0; i < g.ring.length; i++) {
          const [ax, ay] = g.ring[i];
          const [bx, by] = g.ring[(i + 1) % g.ring.length];
          if (segDist(x, y, ax, ay, bx, by) <= R) return true;
        }
      }
      return false;
    },
  };
  snapShops(city, env);
  return env;
}

/** Snap shopfront nodes to the nearest building street front within 12 m. */
function snapShops(city: CityData, env: BuildEnv): void {
  const CELL = 24;
  const grid = new Map<string, number[]>();
  city.buildings.forEach((b, i) => {
    if (b.f === undefined || b.t !== undefined) return;
    const n = b.r.length / 2;
    const j = (b.f + 1) % n;
    const mx = (b.r[2 * b.f] + b.r[2 * j]) / 20;
    const my = (b.r[2 * b.f + 1] + b.r[2 * j + 1]) / 20;
    const key = `${Math.floor(mx / CELL)},${Math.floor(my / CELL)}`;
    let list = grid.get(key);
    if (!list) grid.set(key, (list = []));
    list.push(i);
  });
  const sh = city.shops;
  for (let k = 0; k < sh.length; k += 4) {
    const use = useOfShop(city.shopKinds[sh[k]] ?? '');
    if (!use) continue;
    const x = sh[k + 1] / 10;
    const y = sh[k + 2] / 10;
    const gx = Math.floor(x / CELL);
    const gy = Math.floor(y / CELL);
    let best = -1;
    let bestD = 12;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const i of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          const b = city.buildings[i];
          const n = b.r.length / 2;
          const f = b.f!;
          const j = (f + 1) % n;
          const ax = b.r[2 * f] / 10;
          const ay = b.r[2 * f + 1] / 10;
          const bx = b.r[2 * j] / 10;
          const by = b.r[2 * j + 1] / 10;
          const d = segDist(x, y, ax, ay, bx, by);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    }
    if (best < 0) continue;
    let list = env.shopsAt.get(best);
    if (!list) env.shopsAt.set(best, (list = []));
    list.push([x, y, use]);
  }
}

// ------------------------------------------------------------------ rows

const ROAD_FLAVOUR: [RegExp, BayUse, number][] = [
  [/loi ?kr[oa]h/i, 'bar', 0.45],
  [/moon ?muang|ratchadamnoen|rachadamnoen|ratchawithi|ratvithi/i, 'massage', 0.15],
  [/nimman/i, 'cafe', 0.3],
  [/chang ?klan|tha ?phae|thapae/i, 'restaurant', 0.2],
];

/** Uses per bay, lit-sign share and neon for a shophouse row. */
export function rowInfo(s: Site, p: Plan, env: BuildEnv, bays: { n: number; bw: number; start: number }): RowInfo {
  const uses: BayUse[] = [];
  const e = edgeOf(s.ring, s.front);
  const snapped = (env.shopsAt.get(s.i) ?? []).map(([x, y, use]) => [(x - e.ax) * e.tx + (y - e.ay) * e.ty, use] as const);
  const bUse = useOfShop(s.use === 'hotel' || s.use === 'guest_house' || s.use === 'hostel' ? 'hotel' : s.use ? `shop:${s.use}` : '');
  const flavour = ROAD_FLAVOUR.find(([re]) => re.test(s.roadName));
  for (let k = 0; k < bays.n; k++) {
    const s0 = bays.start + k * bays.bw;
    const s1 = s0 + bays.bw;
    const hit = snapped.find(([sAt]) => sAt >= s0 - 0.5 && sAt <= s1 + 0.5);
    const u = hash01(s.b.id * 37 + k, 200);
    let use: BayUse;
    if (hit) use = hit[1];
    else if (bUse === 'hostel') use = 'hostel';
    else if (bUse && k === 0) use = bUse === 'shop' ? 'shop' : bUse;
    else if (flavour && u < flavour[2]) use = flavour[1];
    else if (s.roadCls <= 3) use = u < 0.9 ? 'shop' : 'home';
    else use = u < 0.5 ? 'shop' : 'home';
    uses.push(use);
  }
  const busy = ['night_bazaar', 'tha_phae', 'nimman'].includes(s.zone) || /loi ?kr[oa]h|chang ?klan|moon ?muang|nimman/i.test(s.roadName);
  return {
    style: p.style,
    uses,
    litSigns: busy ? 0.45 : s.zone === 'old_city' ? 0.25 : 0.12,
    neon: /loi ?kr[oa]h|nimman/i.test(s.roadName) || s.zone === 'night_bazaar',
    lean: p.lean,
    lanterns: s.zone === 'chinatown' || /chang ?moi|wichayanon|khuang/i.test(s.roadName),
  };
}

// ------------------------------------------------------------------ build

/** Build every building, temple and landmark; returns the number of footprints drawn. */
export function buildBuildings(ctx: BuildContext): number {
  const { city, occ } = ctx;
  const env = makeEnv(ctx);
  let built = buildLandmarks(ctx, env);
  built += buildTemples(ctx, env);
  const plans: { s: Site; p: Plan }[] = [];
  for (let i = 0; i < city.buildings.length; i++) {
    if (env.hidden.has(i) || env.handled.has(i)) continue;
    const s = siteOf(city, i);
    if (s.ring.length < 3) continue;
    const p = planBuilding(s, env);
    if (p.cls === 'skip') continue;
    plans.push({ s, p });
  }
  markPartyWalls(plans);
  for (const { s, p } of plans) {
    occ.markRing(s.ring, 0.5);
    drawBuilding(ctx, env, s, p);
    built++;
  }
  return built;
}

/** Height of a planned building's walls, parapet included. */
const crestOf = (p: Plan) => p.wallTop + (p.roof === 'flat' ? p.parapet : 0);

/**
 * Find party walls: an edge lying along a neighbour's edge (anti-parallel,
 * within 0.3 m, and covered end to end by it). Records on the site how high
 * the neighbour's wall rises there.
 */
export function markPartyWalls(plans: { s: Site; p: Plan }[]): void {
  const CELL = 8;
  const grid = new Map<number, [number, number][]>();
  const cellKey = (x: number, y: number) => (Math.floor(x / CELL) + 4096) * 8192 + Math.floor(y / CELL) + 4096;
  plans.forEach(({ s }, k) => {
    for (let i = 0; i < s.ring.length; i++) {
      const [ax, ay] = s.ring[i];
      const [bx, by] = s.ring[(i + 1) % s.ring.length];
      const len = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.ceil(len / CELL));
      const seen = new Set<number>();
      for (let j = 0; j <= n; j++) {
        const id = cellKey(ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n);
        if (seen.has(id)) continue;
        seen.add(id);
        let list = grid.get(id);
        if (!list) grid.set(id, (list = []));
        list.push([k, i]);
      }
    }
  });
  const TOL = 0.3;
  plans.forEach(({ s, p }, k) => {
    for (let i = 0; i < s.ring.length; i++) {
      const [ax, ay] = s.ring[i];
      const [bx, by] = s.ring[(i + 1) % s.ring.length];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1) continue;
      const tx = (bx - ax) / len;
      const ty = (by - ay) / len;
      let top = -Infinity;
      for (const [k2, i2] of grid.get(cellKey((ax + bx) / 2, (ay + by) / 2)) ?? []) {
        // Open canopies and market roofs hide nothing.
        if (k2 === k || plans[k2].p.base > p.base + 0.1 || plans[k2].p.cls === 'canopy' || plans[k2].p.cls === 'market') continue;
        const r = plans[k2].s.ring;
        const [cx, cy] = r[i2];
        const [dx, dy] = r[(i2 + 1) % r.length];
        const l2 = Math.hypot(dx - cx, dy - cy);
        if (l2 < 1) continue;
        const ux = (dx - cx) / l2;
        const uy = (dy - cy) / l2;
        if (tx * ux + ty * uy > -0.995) continue;
        // Both end points on the neighbour's edge line and within its extent.
        const onLine = (x: number, y: number) => {
          const along = (x - cx) * ux + (y - cy) * uy;
          const off = Math.abs(-(x - cx) * uy + (y - cy) * ux);
          return off < TOL && along > -TOL && along < l2 + TOL;
        };
        if (onLine(ax, ay) && onLine(bx, by)) top = Math.max(top, crestOf(plans[k2].p));
      }
      if (top > p.base + 0.5) s.shared.set(i, top);
    }
  });
}

export function drawBuilding(ctx: BuildContext, env: BuildEnv, s: Site, p: Plan): void {
  switch (p.cls) {
    case 'shophouse':
      shophouse(ctx, s, p, rowInfo(s, p, env, bayLayout(edgeOf(s.ring, s.front).len)));
      break;
    case 'house':
      house(ctx, s, p);
      break;
    case 'lanna_house':
      lannaHouse(ctx, s, p);
      break;
    case 'block':
      block(ctx, s, p);
      break;
    case 'condo':
    case 'hotel':
    case 'office':
      condo(ctx, s, p);
      break;
    case 'school':
      school(ctx, s, p);
      break;
    case 'hospital':
      hospital(ctx, s, p);
      break;
    case 'mall':
      mall(ctx, s, p);
      break;
    case 'market':
      canopy(ctx, s, p, true);
      break;
    case 'canopy':
      canopy(ctx, s, p, false);
      break;
    case 'kiosk':
      kiosk(ctx, s, p);
      break;
    case 'shed':
      shed(ctx, s, p, false);
      break;
    case 'hangar':
      shed(ctx, s, p, true);
      break;
    case 'church':
      church(ctx, s, p);
      break;
    case 'mosque':
      mosque(ctx, s, p);
      break;
    case 'shrine':
      chineseShrine(ctx, s, p);
      break;
    case 'chedi':
      chediAt(ctx, s.cx, s.cy, Math.sqrt(Math.max(9, s.area)), s.b.o[2] / 1000, s.b.id, s.b.ht ? s.b.ht / 10 : undefined);
      break;
    default:
      break;
  }
}
