// Anchor points for festival, market and weather effects, computed once in the
// build worker from the city data and handed to the environment layers as
// instanced-prop arrays whose kinds start with 'fx_' (no prop model draws
// them; src/world3d/layers/festivals.ts and effects.ts turn them into
// lanterns, candles, stalls, mist and splashes when the calendar calls for it).
//
// Every anchor is x, y (sim metres), yaw (radians, sim heading), scale:
// - fx_lantern_yipeng / fx_lantern_cny: centre of a lantern string hung across
//   the road; yaw = road direction, scale = half the span across the road.
// - fx_candle: a clay oil lamp; scale = height above the ground.
// - fx_river: krathong drift path on the Ping, downstream order from Nawarat
//   Bridge to the Iron Bridge; yaw = flow direction, scale = half the drift band.
// - fx_stall_sun / fx_stall_sat / fx_stall_bazaar: a market stall; yaw = the
//   direction its front faces, scale = canopy size.
// - fx_moat: a point on the moat bank; yaw = away from the water.
// - fx_mist: a mist puff over the moat or the Ping; scale = puff radius.

import landmarks from '../../content/landmarks.json';
import { ROAD_SETS, type RoadSetDef } from '../../content/events';
import { Projection } from '../../geo';
import { ringOf, ROAD_FLAG } from '../city';
import { addProp, type BuildContext } from './context';
import { hash01 } from './mesh';
import { alongLine, pointInRing, type Ring } from './shapes';

export const FX = {
  lanternYiPeng: 'fx_lantern_yipeng',
  lanternCny: 'fx_lantern_cny',
  candle: 'fx_candle',
  river: 'fx_river',
  stallSunday: 'fx_stall_sun',
  stallSaturday: 'fx_stall_sat',
  stallBazaar: 'fx_stall_bazaar',
  moat: 'fx_moat',
  mist: 'fx_mist',
} as const;

/** Lantern strings every 10 m along the street (world.md §3.5). */
const LANTERN_STRING_STEP = 10;
/** Temples whose grounds get candles: centroid within this distance of Tha Phae Gate. */
const CANDLE_RADIUS = 750;
const CANDLE_STEP = 1.6;
/** Stalls: 2 × 2 m canopies (world.md §3.5), a little gap between neighbours. */
const STALL_STEP = 2.4;
const STALL_SIZE = 2;
/** No stall this close to a junction node, so cross streets stay open. */
const STALL_JUNCTION_GAP = 7;
/** Night Bazaar stalls line Chang Klan Rd this far either side of the Night Bazaar. */
const BAZAAR_RADIUS = 420;
/** Chinese New Year lanterns hang in streets this close to Warorot. */
const CNY_RADIUS = 260;

/** Moon Muang Rd inside the moat's east side (names as in the OSM data). */
const MOON_MUANG: RoadSetDef = { name: 'Moon Muang Rd', roads: ['Moon Muang Road', 'Moonmuang Road'], box: ROAD_SETS.moat.box };
/** Chang Klan Rd through the Night Bazaar (OSM spells it both ways). */
const CHANG_KLAN_NAMES = new Set(['Changklang Road', 'Changklan Road']);

interface Way {
  cls: number;
  flags: number;
  half: number;
  name: string;
  pts: Ring;
  nodes: number[];
}

function landmarkXY(proj: Projection, id: string): [number, number] {
  const l = (landmarks as { id: string; lat: number; lon: number }[]).find((m) => m.id === id);
  if (!l) throw new Error(`landmark ${id} missing`);
  return proj.toXY(l.lon, l.lat);
}

/** Signed area (positive = counter-clockwise in sim space, y north). */
export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2;
}

/** The ring wound counter-clockwise, without a repeated closing vertex. */
export function ccw(ring: Ring): Ring {
  const last = ring[ring.length - 1];
  const r = ring.length > 1 && ring[0][0] === last[0] && ring[0][1] === last[1] ? ring.slice(0, -1) : ring;
  return signedArea(r) >= 0 ? r : [...r].reverse();
}

/** Distance from a point to segment a→b. */
export function segDist(x: number, y: number, a: [number, number], b: [number, number]): number {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const l2 = ex * ex + ey * ey || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / l2));
  return Math.hypot(a[0] + ex * t - x, a[1] + ey * t - y);
}

/** The two end caps of an elongated water piece: centres of the vertices at either extreme of its long axis. */
export function pieceEnds(ring: Ring): [[number, number], [number, number]] {
  let mx = 0;
  let my = 0;
  for (const [x, y] of ring) {
    mx += x;
    my += y;
  }
  mx /= ring.length;
  my /= ring.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of ring) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
    syy += (y - my) ** 2;
  }
  // Principal axis of the vertex spread.
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ax = Math.cos(ang);
  const ay = Math.sin(ang);
  const proj = ring.map(([x, y]) => (x - mx) * ax + (y - my) * ay);
  const lo = Math.min(...proj);
  const hi = Math.max(...proj);
  const cap = (near: (p: number) => boolean): [number, number] => {
    let cx = 0;
    let cy = 0;
    let n = 0;
    ring.forEach(([x, y], i) => {
      if (!near(proj[i])) return;
      cx += x;
      cy += y;
      n++;
    });
    return [cx / n, cy / n];
  };
  return [cap((p) => p < lo + 5), cap((p) => p > hi - 5)];
}

/** Longest gap between two moat pieces that still counts as a crossing (Tha Phae Gate's plaza is ~190 m). */
const MAX_GAP = 260;

/**
 * Causeways and gate plazas: segments joining facing ends of neighbouring
 * moat pieces (OSM splits the moat water at every road crossing).
 */
export function moatGaps(moat: Ring[]): [[number, number], [number, number]][] {
  const ends = moat.flatMap((r, piece) => pieceEnds(r).map((p) => ({ piece, p })));
  const nearest = (i: number): number => {
    let best = -1;
    let bd = Infinity;
    ends.forEach((e, j) => {
      if (e.piece === ends[i].piece) return;
      const d = Math.hypot(e.p[0] - ends[i].p[0], e.p[1] - ends[i].p[1]);
      if (d < bd) {
        bd = d;
        best = j;
      }
    });
    return bd <= MAX_GAP ? best : -1;
  };
  const out: [[number, number], [number, number]][] = [];
  ends.forEach((e, i) => {
    const j = nearest(i);
    // Mutual nearest ends form a gap; keep each pair once.
    if (j > i && nearest(j) === i) out.push([e.p, ends[j].p]);
  });
  return out;
}

/** Half-width of the causeway strip around a gap's centreline (the moat is ~16 m wide, world.md §0). */
const CAUSEWAY_HALF = 11;
/** Gaps longer than this are gate plazas; shorter ones are a single road's causeway. */
const PLAZA_GAP = 40;

/** Keeps anchors of one kind at least `gap` metres apart (a coarse grid). */
class Spacer {
  private readonly cells = new Map<number, [number, number][]>();
  constructor(private readonly gap: number) {}
  take(x: number, y: number): boolean {
    const c = this.gap;
    const cx = Math.floor(x / c);
    const cy = Math.floor(y / c);
    for (let j = cy - 1; j <= cy + 1; j++) {
      for (let i = cx - 1; i <= cx + 1; i++) {
        for (const [px, py] of this.cells.get(j * 100_003 + i) ?? []) if ((px - x) ** 2 + (py - y) ** 2 < c * c) return false;
      }
    }
    const key = cy * 100_003 + cx;
    const list = this.cells.get(key);
    if (list) list.push([x, y]);
    else this.cells.set(key, [[x, y]]);
    return true;
  }
}

function inSet(proj: Projection, def: RoadSetDef, w: Way): boolean {
  if (def.roads && !def.roads.includes(w.name)) return false;
  if (!def.box) return true;
  const [s, west, n, e] = def.box;
  const [x0, y0] = proj.toXY(west, s);
  const [x1, y1] = proj.toXY(e, n);
  const m = w.pts[w.pts.length >> 1];
  const mx = (w.pts[0][0] + w.pts[w.pts.length - 1][0] + m[0]) / 3;
  const my = (w.pts[0][1] + w.pts[w.pts.length - 1][1] + m[1]) / 3;
  return mx >= x0 && mx <= x1 && my >= y0 && my <= y1;
}

/** Walkway half-width either side of the carriageway, as the roads builder draws it. */
const walkOf = (w: Way): number => (w.cls <= 3 || (w.flags & (ROAD_FLAG.SIDEWALK_L | ROAD_FLAG.SIDEWALK_R)) !== 0 ? 1.8 : 0.4);

export function buildEffectAnchors(ctx: BuildContext): void {
  const { city } = ctx;
  const proj = new Projection(city.origin);
  const rn = city.roads.nodes;
  const ways: Way[] = city.roads.ways.map((w) => {
    const nodes = w.slice(7);
    const pts: Ring = nodes.map((n) => [rn[2 * n] / 10, rn[2 * n + 1] / 10]);
    return { cls: w[0], flags: w[1], half: w[2] / 20, name: city.strings[w[4]] ?? '', pts, nodes };
  });
  const nodeUse = new Map<number, number>();
  for (const w of ways) for (const n of w.nodes) nodeUse.set(n, (nodeUse.get(n) ?? 0) + 1);
  const moat = city.areas.filter((a) => city.areaKinds[a.k] === 'moat').map((a) => ccw(ringOf(a.r)));
  const riverAreas = city.areas.filter((a) => city.areaKinds[a.k] === 'river').map((a) => ringOf(a.r));
  const inMoat = (x: number, y: number) => moat.some((r) => pointInRing(x, y, r));

  // ---- Yi Peng lantern strings: named streets, then the moat causeways.
  const lanternGap = new Spacer(4);
  const string = (kind: string, x: number, y: number, heading: number, half: number) => {
    if (lanternGap.take(x, y)) addProp(ctx, kind, x, y, heading, half);
  };
  for (const w of ways) {
    if (!(inSet(proj, ROAD_SETS.tha_phae_rd, w) || inSet(proj, ROAD_SETS.ratchadamnoen, w) || inSet(proj, MOON_MUANG, w))) continue;
    const half = w.half + walkOf(w) * 0.6;
    alongLine(w.pts, LANTERN_STRING_STEP, (x, y, _n, nx, ny) => string(FX.lanternYiPeng, x, y, Math.atan2(-nx, ny), half));
  }
  // Causeways and gate plazas: roads through the gaps between moat pieces.
  const gaps = moatGaps(moat);
  const onGap = new Array<number>(gaps.length).fill(0);
  let gx0 = Infinity;
  let gy0 = Infinity;
  let gx1 = -Infinity;
  let gy1 = -Infinity;
  for (const [a, b] of gaps) {
    gx0 = Math.min(gx0, a[0], b[0]) - CAUSEWAY_HALF;
    gy0 = Math.min(gy0, a[1], b[1]) - CAUSEWAY_HALF;
    gx1 = Math.max(gx1, a[0], b[0]) + CAUSEWAY_HALF;
    gy1 = Math.max(gy1, a[1], b[1]) + CAUSEWAY_HALF;
  }
  for (const w of ways) {
    if (w.cls > 5 || !w.pts.some(([x, y]) => x >= gx0 && x <= gx1 && y >= gy0 && y <= gy1)) continue;
    alongLine(w.pts, 7, (x, y, _n, nx, ny) => {
      const g = gaps.findIndex(([a, b]) => segDist(x, y, a, b) < CAUSEWAY_HALF);
      if (g < 0) return;
      onGap[g]++;
      string(FX.lanternYiPeng, x, y, Math.atan2(-nx, ny), w.half + 1);
    });
  }
  // Crossings without a mapped road still get strings. A narrow causeway gets three strings across its
  // width (parallel to the moat); a wide gate plaza gets strings every 10 m spanning it from bank to bank.
  gaps.forEach(([a, b], g) => {
    if (onGap[g] >= 2) return;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1) return;
    const ex = (b[0] - a[0]) / len;
    const ey = (b[1] - a[1]) / len;
    if (len <= PLAZA_GAP) {
      for (const across of [-6, 0, 6]) {
        const x = (a[0] + b[0]) / 2 - ey * across;
        const y = (a[1] + b[1]) / 2 + ex * across;
        string(FX.lanternYiPeng, x, y, Math.atan2(ex, -ey), Math.min(8, len / 2));
      }
      return;
    }
    const n = Math.max(1, Math.floor(len / LANTERN_STRING_STEP));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      string(FX.lanternYiPeng, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(ey, ex), CAUSEWAY_HALF);
    }
  });

  // ---- Chinese New Year: red lanterns in the streets around Warorot.
  const [wx, wy] = landmarkXY(proj, 'warorot_market');
  for (const w of ways) {
    if (w.cls > 5) continue;
    alongLine(w.pts, 12, (x, y, _n, nx, ny) => {
      if (Math.hypot(x - wx, y - wy) < CNY_RADIUS) string(FX.lanternCny, x, y, Math.atan2(-nx, ny), w.half + walkOf(w) * 0.6);
    });
  }

  // ---- Candles inside the walls of temples near Tha Phae Gate, and along the gate's city walls.
  const [gx, gy] = landmarkXY(proj, 'tha_phae_gate');
  let candleN = 0;
  for (const a of city.areas) {
    if (city.areaKinds[a.k] !== 'temple') continue;
    const ring = ccw(ringOf(a.r));
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    if (Math.hypot(sx / ring.length - gx, sy / ring.length - gy) > CANDLE_RADIUS) continue;
    // Counter-clockwise ring: the left normal points into the grounds.
    alongLine([...ring, ring[0]], CANDLE_STEP, (x, y, _n, nx, ny) => {
      const px = x + nx * 0.7;
      const py = y + ny * 0.7;
      if (!ctx.occ.free(px, py) || !pointInRing(px, py, ring)) return;
      addProp(ctx, FX.candle, px, py, Math.atan2(-nx, ny), 0.06 + hash01(candleN++, 61) * 0.04);
    });
  }
  for (const l of city.lines) {
    if (city.lineKinds[l.k] !== 'city_wall') continue;
    const pts = ringOf(l.p);
    alongLine(pts, 1.3, (x, y, _n, nx, ny) => {
      if (Math.hypot(x - gx, y - gy) > 220) return;
      for (const side of [-1.9, 1.9]) {
        const px = x + nx * side;
        const py = y + ny * side;
        if (!inMoat(px, py)) addProp(ctx, FX.candle, px, py, Math.atan2(-nx, ny), 0.06);
      }
    });
  }

  // ---- Krathong path on the Ping, Nawarat Bridge → Iron Bridge.
  const [nbx, nby] = landmarkXY(proj, 'nawarat_bridge');
  const [ibx, iby] = landmarkXY(proj, 'iron_bridge');
  let ping: Ring | null = null;
  let pingBest = Infinity;
  for (const l of city.lines) {
    if (city.lineKinds[l.k] !== 'river') continue;
    const pts = ringOf(l.p);
    let dn = Infinity;
    for (const [x, y] of pts) dn = Math.min(dn, Math.hypot(x - nbx, y - nby));
    if (dn < pingBest) {
      pingBest = dn;
      ping = pts;
    }
  }
  const halfBand = (x: number, y: number, nx: number, ny: number) => {
    for (const d of [24, 18, 12, 6]) {
      const ok = (px: number, py: number) => riverAreas.some((r) => pointInRing(px, py, r));
      if (ok(x + nx * d, y + ny * d) && ok(x - nx * d, y - ny * d)) return d;
    }
    return 4;
  };
  if (ping && pingBest < 200) {
    const nearest = (px: number, py: number) => {
      let bi = 0;
      let bd = Infinity;
      ping!.forEach(([x, y], i) => {
        const d = Math.hypot(x - px, y - py);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      return bi;
    };
    const i0 = nearest(nbx, nby);
    const i1 = nearest(ibx, iby);
    const step = i1 >= i0 ? 1 : -1;
    const path: Ring = [];
    for (let i = i0 - step; i !== i1 + 2 * step; i += step) if (ping[i]) path.push(ping[i]);
    alongLine(path, 10, (x, y, _n, nx, ny) => addProp(ctx, FX.river, x, y, Math.atan2(-nx, ny), halfBand(x, y, nx, ny)));
  }

  // ---- Market stalls.
  type Row = { off: number; face: number };
  const stalls = (kind: string, w: Way, offsets: Row[], size: number, keep = (_x: number, _y: number) => true) => {
    const ends = w.nodes.filter((n) => (nodeUse.get(n) ?? 0) > 1).map((n) => [rn[2 * n] / 10, rn[2 * n + 1] / 10] as [number, number]);
    alongLine(w.pts, STALL_STEP, (x, y, n, nx, ny) => {
      if (!keep(x, y) || ends.some(([ex, ey]) => Math.hypot(ex - x, ey - y) < STALL_JUNCTION_GAP)) return;
      for (const { off, face } of offsets) {
        const f = face === 0 ? (n % 2 === 0 ? 1 : -1) : face;
        addProp(ctx, kind, x + nx * off, y + ny * off, Math.atan2(ny * f, nx * f), size);
      }
    });
  };
  for (const w of ways) {
    if (inSet(proj, ROAD_SETS.ratchadamnoen, w)) {
      // Three rows: along both kerbs facing the middle, and one down the centre facing alternate sides.
      const k = w.half + 0.3;
      stalls(FX.stallSunday, w, [{ off: k, face: -1 }, { off: -k, face: 1 }, { off: 0, face: 0 }], STALL_SIZE);
    } else if (inSet(proj, ROAD_SETS.wualai, w)) {
      const k = w.half + 0.3;
      stalls(FX.stallSaturday, w, [{ off: k, face: -1 }, { off: -k, face: 1 }], STALL_SIZE);
    }
  }
  const [bzx, bzy] = landmarkXY(proj, 'night_bazaar');
  for (const w of ways) {
    if (!CHANG_KLAN_NAMES.has(w.name)) continue;
    // Pavement rows facing the road, which stays open to traffic.
    const k = w.half + 1.2;
    stalls(FX.stallBazaar, w, [{ off: k, face: -1 }, { off: -k, face: 1 }], 1.8, (x, y) => Math.hypot(x - bzx, y - bzy) < BAZAAR_RADIUS);
  }

  // ---- Moat banks (Songkran splashes) and mist over the moat and the Ping.
  for (const ring of moat) {
    alongLine([...ring, ring[0]], 8, (x, y, _n, nx, ny) => {
      // Left normal of a counter-clockwise ring points into the water.
      const px = x - nx * 2.5;
      const py = y - ny * 2.5;
      if (!inMoat(px, py)) addProp(ctx, FX.moat, px, py, Math.atan2(-ny, -nx), 1);
    });
    alongLine([...ring, ring[0]], 18, (x, y, n, nx, ny) => {
      const px = x + nx * 6;
      const py = y + ny * 6;
      if (pointInRing(px, py, ring)) addProp(ctx, FX.mist, px, py, 0, 12 + hash01(n + Math.round(x), 67) * 8);
    });
  }
  if (ping) {
    const [kx0, ky0, kx1, ky1] = ctx.keep;
    alongLine(ping, 30, (x, y, n, nx, ny) => {
      if (x < kx0 || x > kx1 || y < ky0 || y > ky1) return;
      const band = halfBand(x, y, nx, ny);
      for (const s of [-0.5, 0.5]) addProp(ctx, FX.mist, x + nx * band * s, y + ny * band * s, 0, 16 + hash01(n, 71) * 10);
    });
  }
}
