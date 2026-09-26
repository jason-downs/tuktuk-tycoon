// Street furniture (docs/3d/world.md §1.6, §2.7): concrete power poles with
// sagging cable bundles (none on the buried-cable roads, which get green PEA
// cabinets), arm street lamps and heritage lanterns, traffic lights at OSM
// signals, bus shelters, moat fountains, spirit houses and parked motorbikes
// at shop fronts, flags and motorbikes at temple gates, market stalls, food
// carts with parasols at soi mouths, and benches. Props are instanced
// (addProp + src/world3d/propModels.ts); the cables are static geometry in
// the structures layer.

import { ringOf, ROAD_FLAG } from '../city';
import { OB, PROP_BLOCK } from './clearance';
import { addProp, type BuildContext } from './context';
import { hash01, hex, type MeshWriter, type RGB } from './mesh';
import { templeHalls } from './scatter';
import { bbox, frameOf, pointInRing, type Ring, type V3 } from './shapes';
import { ccw, nearestStreet, placeEnv, signedArea, strHash, walk, type PlaceEnv, type Street } from './streets';

/** Concrete power pole: height, crossarm height and half-span, cable-bundle heights (m). */
export const POLE = { height: 9.6, arm: 9.1, armHalf: 0.85, bundle: 5.7, bundle2: 6.4 } as const;
/** Arm street lamp: the head hangs `reach` m along the prop's yaw, `height` m up. */
export const STREET_LAMP_HEAD = { reach: 2.3, height: 8.3 } as const;
/** Heritage lantern: the lamp sits on top of the post. */
export const HERITAGE_LAMP_HEAD = { reach: 0, height: 3.75 } as const;
/** Longest cable span between consecutive poles (m). */
export const MAX_SPAN = 60;
/** Poles stand on roads reaching this far beyond the playable area (m). */
const POLE_MARGIN = 100;

const CABLE: RGB = hex('#1b1b1d');
const WIRE: RGB = hex('#2b2b2b');

/** Model-space offset (mx forward, mz right) of a prop at (x, y) with yaw, in sim metres. */
export function local(x: number, y: number, yaw: number, mx: number, mz: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x + mx * c + mz * s, y + mx * s - mz * c];
}

interface PutOpts {
  /** Hard radius in the placement registry. */
  r?: number;
  /** Clearance from obstacles (m). */
  clear?: number;
  /** Obstacle kinds to avoid (default PROP_BLOCK). */
  mask?: number;
  /** Footprint corners in model space [mx, mz] that must also be clear. */
  foot?: [number, number][];
  scale?: number;
}

/** Place a prop if its spot and footprint are clear; returns whether it was placed. */
function put(ctx: BuildContext, env: PlaceEnv, kind: string, x: number, y: number, yaw: number, o: PutOpts = {}): boolean {
  const [kx0, ky0, kx1, ky1] = ctx.keep;
  if (!(x > kx0 && x < kx1 && y > ky0 && y < ky1)) return false;
  const r = o.r ?? 0.5;
  if (!env.placed.free(x, y, r)) return false;
  const mask = o.mask ?? PROP_BLOCK;
  if (env.clear.hit(x, y, o.clear ?? 0.3, mask)) return false;
  for (const [mx, mz] of o.foot ?? []) {
    const [px, py] = local(x, y, yaw, mx, mz);
    if (env.clear.hit(px, py, 0.05, mask)) return false;
  }
  addProp(ctx, kind, x, y, yaw, o.scale ?? 1);
  env.placed.add(x, y, r);
  return true;
}

export function buildProps(ctx: BuildContext): void {
  const env = placeEnv(ctx);
  trafficLights(ctx, env);
  busShelters(ctx, env);
  fountains(ctx, env);
  moatPromenade(ctx, env);
  streetLamps(ctx, env);
  powerLines(ctx, env);
  temples(ctx, env);
  shopFronts(ctx, env);
  markets(ctx, env);
  soiMouths(ctx, env);
  osmExtras(ctx, env);
}

// ------------------------------------------------------------------ OSM points

function osmPoints(ctx: BuildContext, kind: string): [number, number, number][] {
  const { city } = ctx;
  const k = city.propKinds.indexOf(kind);
  const out: [number, number, number][] = [];
  if (k < 0) return out;
  for (let i = 0; i < city.props.length; i += 3) if (city.props[i] === k) out.push([city.props[i + 1] / 10, city.props[i + 2] / 10, i / 3]);
  return out;
}

const nodeGrids = new WeakMap<PlaceEnv, Map<number, { st: Street; k: number }[]>>();
const NODE_CELL = 16;
const nodeKey = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);

/** Street vertices within r of (x, y), with the street each belongs to. */
function nodesNear(env: PlaceEnv, x: number, y: number, r: number): { st: Street; k: number }[] {
  let grid = nodeGrids.get(env);
  if (!grid) {
    grid = new Map();
    for (const st of env.streets) {
      st.pts.forEach(([px, py], k) => {
        const key = nodeKey(Math.floor(px / NODE_CELL), Math.floor(py / NODE_CELL));
        let list = grid!.get(key);
        if (!list) grid!.set(key, (list = []));
        list.push({ st, k });
      });
    }
    nodeGrids.set(env, grid);
  }
  const out: { st: Street; k: number }[] = [];
  for (let i = Math.floor((x - r) / NODE_CELL); i <= Math.floor((x + r) / NODE_CELL); i++) {
    for (let j = Math.floor((y - r) / NODE_CELL); j <= Math.floor((y + r) / NODE_CELL); j++) {
      for (const e of grid.get(nodeKey(i, j)) ?? []) {
        const [px, py] = e.st.pts[e.k];
        if (Math.hypot(px - x, py - y) <= r) out.push(e);
      }
    }
  }
  // Nearest first, so the junction node is the one closest to the signal.
  return out.sort((a, b) => Math.hypot(a.st.pts[a.k][0] - x, a.st.pts[a.k][1] - y) - Math.hypot(b.st.pts[b.k][0] - x, b.st.pts[b.k][1] - y));
}

/**
 * Traffic lights at OSM signals: one pole per approach, on the kerb to the
 * left of arriving traffic (Thailand drives on the left), set back beyond the
 * crossing road, facing the traffic with its arm over the carriageway.
 */
function trafficLights(ctx: BuildContext, env: PlaceEnv): void {
  const placed: [number, number, number][] = [];
  for (const [sx, sy] of osmPoints(ctx, 'traffic_signals')) {
    const at = nodesNear(env, sx, sy, 4);
    const approaches: { dx: number; dy: number; half: number }[] = [];
    let ox = sx;
    let oy = sy;
    if (at.length) {
      [ox, oy] = at[0].st.pts[at[0].k];
      for (const { st, k } of at) {
        if (Math.hypot(st.pts[k][0] - ox, st.pts[k][1] - oy) > 1) continue;
        const oneway = (st.flags & ROAD_FLAG.ONEWAY) !== 0;
        // Traffic arrives from the previous vertex; on two-way roads also from the next.
        const dirs: number[] = [];
        if (k > 0) dirs.push(-1);
        if (k < st.pts.length - 1 && !oneway) dirs.push(1);
        for (const dk of dirs) {
          let j = k + dk;
          while (j > 0 && j < st.pts.length - 1 && Math.hypot(st.pts[j][0] - ox, st.pts[j][1] - oy) < 4) j += dk;
          const dx = st.pts[j][0] - ox;
          const dy = st.pts[j][1] - oy;
          const l = Math.hypot(dx, dy);
          if (l > 0.5) approaches.push({ dx: dx / l, dy: dy / l, half: st.half });
        }
      }
    } else {
      const near = nearestStreet(env, sx, sy, 12);
      if (!near) continue;
      ox = near.px;
      oy = near.py;
      approaches.push({ dx: -near.dx, dy: -near.dy, half: near.st.half });
      if (!(near.st.flags & ROAD_FLAG.ONEWAY)) approaches.push({ dx: near.dx, dy: near.dy, half: near.st.half });
    }
    const cross = Math.max(0, ...approaches.map((a) => a.half));
    for (const a of approaches) {
      const yaw = Math.atan2(a.dy, a.dx);
      // Skip approaches another signal pole already covers.
      if (placed.some(([px, py, pyaw]) => Math.hypot(px - ox - a.dx * 8, py - oy - a.dy * 8) < 14 && Math.cos(pyaw - yaw) > 0.8)) continue;
      for (const back of [cross + 1.5, cross + 3.5, cross + 6]) {
        // Left of arriving traffic, which travels along −dir.
        const x = ox + a.dx * back + a.dy * (a.half + 0.7);
        const y = oy + a.dy * back - a.dx * (a.half + 0.7);
        if (put(ctx, env, 'traffic_light', x, y, yaw, { r: 0.5, clear: 0.3 })) {
          placed.push([x, y, yaw]);
          break;
        }
      }
    }
  }
}

/** Sala-style shelters at OSM bus stops, on the kerb facing the road. */
function busShelters(ctx: BuildContext, env: PlaceEnv): void {
  for (const [sx, sy] of osmPoints(ctx, 'bus_stop')) {
    const near = nearestStreet(env, sx, sy, 25, (st) => st.cls <= 5);
    if (!near) continue;
    const side = near.d < 1 ? 1 : near.side;
    const nx = -near.dy * side;
    const ny = near.dx * side;
    const yaw = Math.atan2(-ny, -nx);
    let done = false;
    for (const off of [1.7, 2.3]) {
      for (const along of [0, 3, -3, 6, -6]) {
        const x = near.px + nx * (near.st.half + off) + near.dx * along;
        const y = near.py + ny * (near.st.half + off) + near.dy * along;
        done = put(ctx, env, 'bus_shelter', x, y, yaw, {
          r: 2,
          clear: 0.3,
          foot: [
            [0.8, 1.8],
            [0.8, -1.8],
            [-0.8, 1.8],
            [-0.8, -1.8],
          ],
        });
        if (done) break;
      }
      if (done) break;
    }
  }
}

// ------------------------------------------------------------------ moat

function ringDist(x: number, y: number, ring: Ring): number {
  let d = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j];
    const [bx, by] = ring[i];
    const vx = bx - ax;
    const vy = by - ay;
    const l2 = vx * vx + vy * vy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2));
    d = Math.min(d, Math.hypot(ax + vx * t - x, ay + vy * t - y));
  }
  return d;
}

/** Points along the middle of a water ring (at least 3 m from its banks), with their bank distance. */
function medial(ring: Ring): [number, number, number][] {
  const [x0, y0, x1, y1] = bbox(ring);
  const pts: [number, number, number][] = [];
  let best = 0;
  for (let y = y0 + 1.5; y < y1; y += 3) {
    for (let x = x0 + 1.5; x < x1; x += 3) {
      if (!pointInRing(x, y, ring)) continue;
      const d = ringDist(x, y, ring);
      best = Math.max(best, d);
      pts.push([x, y, d]);
    }
  }
  return pts.filter((p) => p[2] >= Math.max(3, best - 1.6));
}

/**
 * Moat fountains: a jet every ~100 m along the middle of the water, arrays
 * of five at the four corners of the moat square, and OSM fountains that
 * stand in water.
 */
function fountains(ctx: BuildContext, env: PlaceEnv): void {
  const jet = (x: number, y: number, n: number, scale = 1) =>
    put(ctx, env, 'fountain', x, y, hash01(n, 121) * Math.PI * 2, { r: 2, clear: 0, mask: 0, scale });
  const allMid: [number, number, number, number][] = [];
  env.moatRings.forEach((ring, ri) => {
    const mid = medial(ring);
    if (!mid.length) return;
    // Principal axis of the segment; jets every 100 m along it.
    let mx = 0;
    let my = 0;
    for (const [x, y] of mid) {
      mx += x;
      my += y;
    }
    mx /= mid.length;
    my /= mid.length;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const [x, y] of mid) {
      sxx += (x - mx) ** 2;
      sxy += (x - mx) * (y - my);
      syy += (y - my) ** 2;
    }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ax = Math.cos(ang);
    const ay = Math.sin(ang);
    const proj = mid.map(([x, y, d]) => [x, y, d, (x - mx) * ax + (y - my) * ay] as [number, number, number, number]);
    allMid.push(...proj);
    let t0 = Infinity;
    let t1 = -Infinity;
    for (const p of proj) {
      t0 = Math.min(t0, p[3]);
      t1 = Math.max(t1, p[3]);
    }
    for (let t = t0 + 35 + hash01(ri, 122) * 20; t < t1 - 20; t += 100) {
      let pick: [number, number, number, number] | null = null;
      for (const p of proj) if (Math.abs(p[3] - t) < 12 && (!pick || p[2] > pick[2])) pick = p;
      if (pick) jet(pick[0], pick[1], ri * 100 + Math.round(t));
    }
  });
  // Corner arrays: the medial points nearest the four corners of the moat's bounding square.
  if (allMid.length) {
    const corners: [number, number][] = [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];
    corners.forEach(([cx, cy], ci) => {
      let best: [number, number, number, number] | null = null;
      for (const p of allMid) if (!best || p[0] * cx + p[1] * cy > best[0] * cx + best[1] * cy) best = p;
      if (!best) return;
      const b = best;
      const near = allMid.filter((p) => Math.hypot(p[0] - b[0], p[1] - b[1]) < 40).sort((p, q) => Math.hypot(p[0] - b[0], p[1] - b[1]) - Math.hypot(q[0] - b[0], q[1] - b[1]));
      const chosen: [number, number][] = [];
      for (const p of near) {
        if (chosen.length >= 5) break;
        if (chosen.every(([x, y]) => Math.hypot(x - p[0], y - p[1]) >= 5)) chosen.push([p[0], p[1]]);
      }
      chosen.forEach(([x, y], k) => jet(x, y, 9000 + ci * 10 + k, k === 0 ? 1.45 : 1));
    });
  }
  for (const [x, y, n] of osmPoints(ctx, 'fountain')) {
    if (env.clear.hit(x, y, 0, OB.WATER) && !env.clear.hit(x, y, 2, OB.ROAD | OB.BUILDING) && env.moatRings.some((r) => pointInRing(x, y, r) && ringDist(x, y, r) > 2)) {
      jet(x, y, n);
    }
  }
}

/** Heritage lanterns and benches along both moat banks. */
function moatPromenade(ctx: BuildContext, env: PlaceEnv): void {
  env.moatRings.forEach((ring, ri) => {
    walk(
      ring,
      6 + hash01(ri, 131) * 12,
      () => 24,
      (st) => {
        // Outward (right-hand) normal of a counter-clockwise ring; lanterns and benches face the water.
        put(ctx, env, 'heritage_lamp', st.x + st.dy * 1.3, st.y - st.dx * 1.3, Math.atan2(st.dx, -st.dy), { r: 0.4, clear: 0.3 });
      },
      true,
    );
    walk(
      ring,
      30 + hash01(ri, 132) * 30,
      (n) => 70 + hash01(ri * 100 + n, 133) * 30,
      (st) => {
        put(ctx, env, 'bench', st.x + st.dy * 2.1, st.y - st.dx * 2.1, Math.atan2(st.dx, -st.dy), {
          r: 1,
          clear: 0.3,
          foot: [
            [0, 0.9],
            [0, -0.9],
          ],
        });
      },
      true,
    );
  });
}

// ------------------------------------------------------------------ lamps

/** Arm lamps on primary and lit roads; heritage lanterns on Tha Phae, Ratchadamnoen and Nimman. */
function streetLamps(ctx: BuildContext, env: PlaceEnv): void {
  for (const st of env.streets) {
    if (st.moat || st.flags & (ROAD_FLAG.BRIDGE | ROAD_FLAG.TUNNEL) || st.len < 15) continue;
    const heritage = st.heritage;
    if (!heritage && !(st.cls <= 1 || st.flags & ROAD_FLAG.LIT)) continue;
    const oneway = (st.flags & ROAD_FLAG.ONEWAY) !== 0;
    const both = !oneway && st.half >= 7;
    const kind = heritage ? 'heritage_lamp' : 'street_lamp';
    const off = st.half + (heritage ? 0.7 : 0.5);
    walk(
      st.pts,
      5 + hash01(st.i, 141) * 10,
      () => (heritage ? 20 : 35),
      (p, n) => {
        const sides = both ? [1, -1] : oneway ? [1] : [n % 2 ? -1 : 1];
        for (const side of sides) {
          const nx = -p.dy * side;
          const ny = p.dx * side;
          // The arm reaches back over the carriageway.
          const yaw = Math.atan2(-ny, -nx);
          for (const along of [0, 2, -2, 4, -4]) {
            if (put(ctx, env, kind, p.x + nx * off + p.dx * along, p.y + ny * off + p.dy * along, yaw, { r: 0.4, clear: 0.25 })) break;
          }
        }
      },
    );
  }
}

// ------------------------------------------------------------------ power

/** A pole in a cable chain: position, road direction, side of the road it stands on. */
interface PoleAt {
  x: number;
  y: number;
  dx: number;
  dy: number;
  side: number;
}

/** A pole station: point on the centreline, road direction and the kerb-offset normal (with its mitre factor). */
export interface PoleStation {
  x: number;
  y: number;
  dx: number;
  dy: number;
  nx: number;
  ny: number;
  miter: number;
}

/**
 * Pole stations along a polyline: at bends sharper than 35° and evenly
 * spaced between them, `endGap` m clear of both ends (the junctions). A line
 * shorter than ~0.8 × spacing gets a single station in the middle.
 */
export function poleStations(pts: Ring, spacing: number, endGap = 4): PoleStation[] {
  const dirs: [number, number][] = [];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    const l = Math.hypot(dx, dy);
    dirs.push(l > 1e-9 ? [dx / l, dy / l] : (dirs[dirs.length - 1] ?? [1, 0]));
    cum.push(cum[i - 1] + l);
  }
  const len = cum[cum.length - 1];
  const at = (s: number, vertex = -1): PoleStation => {
    let i = 0;
    while (i < dirs.length - 1 && s > cum[i + 1]) i++;
    const [dx, dy] = dirs[i];
    const t = Math.min(Math.max(s - cum[i], 0), cum[i + 1] - cum[i]);
    let nx = -dy;
    let ny = dx;
    let miter = 1;
    if (vertex > 0) {
      // At a bend the offset follows the bisector so the pole stays on the kerb line.
      const [ax, ay] = dirs[vertex - 1];
      const [bx, by] = dirs[vertex];
      const mx = -(ay + by);
      const my = ax + bx;
      const ml = Math.hypot(mx, my);
      if (ml > 1e-6) {
        nx = mx / ml;
        ny = my / ml;
        miter = 1 / Math.max(0.4, nx * -ay + ny * ax);
      }
      return { x: pts[vertex][0], y: pts[vertex][1], dx: bx, dy: by, nx, ny, miter };
    }
    return { x: pts[i][0] + dx * t, y: pts[i][1] + dy * t, dx, dy, nx, ny, miter };
  };
  if (len < spacing * 0.8 || len < 2 * endGap + 6) return len >= 12 ? [at(len / 2)] : [];
  const anchors: [number, number][] = [[endGap, -1]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = dirs[i - 1];
    const [bx, by] = dirs[i];
    if (ax * bx + ay * by < Math.cos((35 * Math.PI) / 180) && cum[i] > endGap + 3 && cum[i] < len - endGap - 3) anchors.push([cum[i], i]);
  }
  anchors.push([len - endGap, -1]);
  const out: PoleStation[] = [at(anchors[0][0])];
  for (let a = 1; a < anchors.length; a++) {
    const s0 = anchors[a - 1][0];
    const run = anchors[a][0] - s0;
    const n = Math.max(1, Math.round(run / spacing));
    for (let k = 1; k < n; k++) out.push(at(s0 + (run * k) / n));
    out.push(at(anchors[a][0], anchors[a][1]));
  }
  return out;
}

/**
 * Concrete poles every ~35 m on one side of every road whose cables are not
 * buried (half density on roads planned for burial), chained by sagging
 * cable bundles and power lines; PEA ground cabinets every ~60 m on the
 * buried-cable roads.
 */
function powerLines(ctx: BuildContext, env: PlaceEnv): void {
  const w = ctx.w.structures;
  const [px0, py0, px1, py1] = ctx.city.play.map((v, i) => v / 10 + (i < 2 ? -POLE_MARGIN : POLE_MARGIN));
  const buriedBoxes = env.streets.filter((st) => st.buried).map((st) => bbox(st.pts));
  for (const st of env.streets) {
    if (st.flags & (ROAD_FLAG.BRIDGE | ROAD_FLAG.TUNNEL) || st.len < 12) continue;
    if (st.buried) {
      peaCabinets(ctx, env, st);
      continue;
    }
    if (st.cls > 5) continue;
    const [x0, y0, x1, y1] = bbox(st.pts);
    if (x1 < px0 || x0 > px1 || y1 < py0 || y0 > py1) continue;
    const main = st.cls <= 3;
    const spacing = (st.sparsePoles ? 70 : main ? 35 : 50) + (hash01(st.i, 151) - 0.5) * 10;
    // Left (the kerb for left-hand traffic) on one-way roads; on two-way roads one side per street name.
    const side = st.flags & ROAD_FLAG.ONEWAY || hash01(st.name ? strHash(st.name) : st.i, 152) < 0.5 ? 1 : -1;
    const nearBuried = buriedBoxes.some((b) => b[0] < x1 + 12 && b[2] > x0 - 12 && b[1] < y1 + 12 && b[3] > y0 - 12);
    const chain: PoleAt[] = [];
    const flush = () => {
      for (let i = 1; i < chain.length; i++) span(w, chain[i - 1], chain[i], main);
      chain.length = 0;
    };
    for (const s of poleStations(st.pts, spacing)) {
      const off = (st.half + 0.45) * s.miter;
      let placed: PoleAt | null = null;
      for (const along of [0, 2.5, -2.5, 5, -5]) {
        const x = s.x + s.nx * off * side + s.dx * along;
        const y = s.y + s.ny * off * side + s.dy * along;
        // Keep chains off the buried-cable roads and out of their junctions.
        if (nearBuried && env.clear.hit(x, y, 9, OB.BURIED)) continue;
        if (put(ctx, env, 'power_pole', x, y, Math.atan2(s.dy, s.dx), { r: 0.45, clear: 0.3 })) {
          placed = { x, y, dx: s.dx, dy: s.dy, side };
          break;
        }
      }
      if (!placed) continue;
      const last = chain[chain.length - 1];
      if (last && Math.hypot(placed.x - last.x, placed.y - last.y) > MAX_SPAN) flush();
      chain.push(placed);
    }
    flush();
  }
}

/** Ground cabinets on a buried-cable road: the moat side of moat roads, else either side. */
function peaCabinets(ctx: BuildContext, env: PlaceEnv, st: Street): void {
  walk(
    st.pts,
    10 + hash01(st.i, 161) * 30,
    (n) => 52 + hash01(st.i * 100 + n, 162) * 16,
    (p, n) => {
      let side = hash01(st.i * 100 + n, 163) < 0.5 ? 1 : -1;
      if (st.moat) {
        const lx = p.x - p.dy * (st.half + 8);
        const ly = p.y + p.dx * (st.half + 8);
        side = env.clear.hit(lx, ly, 8, OB.WATER) ? 1 : -1;
      }
      const nx = -p.dy * side;
      const ny = p.dx * side;
      const yaw = Math.atan2(-ny, -nx);
      for (const off of [1.0, 1.6, 2.4]) {
        const x = p.x + nx * (st.half + off);
        const y = p.y + ny * (st.half + off);
        if (put(ctx, env, 'pea_cabinet', x, y, yaw, { r: 0.7, clear: 0.2, foot: [[0.3, 0.6], [0.3, -0.6], [-0.3, 0.6], [-0.3, -0.6]] })) break;
      }
    },
  );
}

/** Pole attachment points: cable bundle beside the pole on the road side, lines at the crossarm ends. */
export function attachments(p: PoleAt): { bundle: V3; bundle2: V3; lineL: V3; lineR: V3 } {
  // Unit vector across the road, pointing from the pole towards the carriageway.
  const tx = p.dy * p.side;
  const ty = -p.dx * p.side;
  return {
    bundle: [p.x + tx * 0.15, p.y + ty * 0.15, POLE.bundle],
    bundle2: [p.x - tx * 0.14, p.y - ty * 0.14, POLE.bundle2],
    lineL: [p.x - p.dy * POLE.armHalf, p.y + p.dx * POLE.armHalf, POLE.arm + 0.1],
    lineR: [p.x + p.dy * POLE.armHalf, p.y - p.dx * POLE.armHalf, POLE.arm + 0.1],
  };
}

/**
 * Cables between two consecutive poles: a thick black telecom bundle, and on
 * main roads a second thinner bundle and the two power lines on the crossarm.
 */
function span(w: MeshWriter, a: PoleAt, b: PoleAt, main: boolean): void {
  const pa = attachments(a);
  const pb = attachments(b);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 3) return;
  cableTube(w, pa.bundle, pb.bundle, 0.45 + len * 0.02, 0.1, 3, CABLE);
  if (!main) return;
  cableRidge(w, pa.bundle2, pb.bundle2, 0.3 + len * 0.014, 0.07, 2, CABLE);
  // Pair the crossarm ends that lie on the same side of the road.
  const same = a.dx * b.dx + a.dy * b.dy >= 0;
  cableRidge(w, pa.lineL, same ? pb.lineL : pb.lineR, 0.2 + len * 0.006, 0.05, 2, WIRE);
  cableRidge(w, pa.lineR, same ? pb.lineR : pb.lineL, 0.2 + len * 0.006, 0.05, 2, WIRE);
}

/** Point on a sagging cable from a to b at t in [0, 1] (parabola, lowest by `sag` mid-span). */
export function catenary(a: V3, b: V3, sag: number, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t - 4 * sag * t * (1 - t)];
}

/** Quad p→q→r→s written so that its normal points along `out` (sim x, y, up). */
function faceOut(w: MeshWriter, p: V3, q: V3, r: V3, s: V3, c: RGB, out: V3): void {
  const ax = q[0] - p[0];
  const ay = q[1] - p[1];
  const az = q[2] - p[2];
  const bx = s[0] - p[0];
  const by = s[1] - p[1];
  const bz = s[2] - p[2];
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  if (nx * out[0] + ny * out[1] + nz * out[2] >= 0) w.quad(p, q, r, s, c);
  else w.quad(s, r, q, p, c);
}

/** Triangular-section cable tube (flat bottom, ridge on top), `sub` segments along the sag. */
export function cableTube(w: MeshWriter, a: V3, b: V3, sag: number, radius: number, sub: number, c: RGB): void {
  const hx = b[0] - a[0];
  const hy = b[1] - a[1];
  const hl = Math.hypot(hx, hy) || 1;
  const sx = -hy / hl;
  const sy = hx / hl;
  const angles = [Math.PI / 2, (7 * Math.PI) / 6, (11 * Math.PI) / 6];
  const rings: V3[][] = [];
  const axis: V3[] = [];
  for (let i = 0; i <= sub; i++) {
    const p = catenary(a, b, sag, i / sub);
    axis.push(p);
    rings.push(angles.map((ang): V3 => [p[0] + sx * Math.cos(ang) * radius, p[1] + sy * Math.cos(ang) * radius, p[2] + Math.sin(ang) * radius]));
  }
  for (let i = 0; i < sub; i++) {
    for (let k = 0; k < 3; k++) {
      const k2 = (k + 1) % 3;
      const p = rings[i][k];
      const q = rings[i][k2];
      const r = rings[i + 1][k2];
      const s = rings[i + 1][k];
      const mid: V3 = [(axis[i][0] + axis[i + 1][0]) / 2, (axis[i][1] + axis[i + 1][1]) / 2, (axis[i][2] + axis[i + 1][2]) / 2];
      const out: V3 = [(p[0] + q[0] + r[0] + s[0]) / 4 - mid[0], (p[1] + q[1] + r[1] + s[1]) / 4 - mid[1], (p[2] + q[2] + r[2] + s[2]) / 4 - mid[2]];
      faceOut(w, p, q, r, s, c, out);
    }
  }
}

/** Thin cable as a ridged (Λ) strip: visible from above and the sides at two faces per segment. */
export function cableRidge(w: MeshWriter, a: V3, b: V3, sag: number, width: number, sub: number, c: RGB): void {
  const hx = b[0] - a[0];
  const hy = b[1] - a[1];
  const hl = Math.hypot(hx, hy) || 1;
  const sx = (-hy / hl) * (width / 2);
  const sy = (hx / hl) * (width / 2);
  const pts: V3[] = [];
  for (let i = 0; i <= sub; i++) pts.push(catenary(a, b, sag, i / sub));
  for (let i = 0; i < sub; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    const top = (v: V3): V3 => [v[0], v[1], v[2] + width * 0.3];
    const L = (v: V3): V3 => [v[0] + sx, v[1] + sy, v[2]];
    const R = (v: V3): V3 => [v[0] - sx, v[1] - sy, v[2]];
    faceOut(w, L(p), L(q), top(q), top(p), c, [sx, sy, width]);
    faceOut(w, top(p), top(q), R(q), R(p), c, [-sx, -sy, width]);
  }
}

// ------------------------------------------------------------------ temples

/** Where a temple ground meets the street in front of its main hall, with the edge's direction. */
function templeGate(ctx: BuildContext, env: PlaceEnv, ring: Ring, hall: number | undefined): { x: number; y: number; ex: number; ey: number } | null {
  const { city } = ctx;
  const cands: { x: number; y: number; ex: number; ey: number; score: number }[] = [];
  const edgeAt = (x: number, y: number) => {
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % ring.length];
      const vx = bx - ax;
      const vy = by - ay;
      const l2 = vx * vx + vy * vy || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2));
      const d = Math.hypot(ax + vx * t - x, ay + vy * t - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const [ax, ay] = ring[best];
    const [bx, by] = ring[(best + 1) % ring.length];
    const l = Math.hypot(bx - ax, by - ay) || 1;
    return { ex: (bx - ax) / l, ey: (by - ay) / l };
  };
  const score = (x: number, y: number) => nearestStreet(env, x, y, 40, (st) => st.cls <= 6)?.d ?? 99;
  if (hall !== undefined) {
    const b = city.buildings[hall];
    const f = frameOf(b, ringOf(b.r));
    for (const s of [1, -1]) {
      // March along the hall's long axis to the ground's edge.
      let x = f.cx;
      let y = f.cy;
      for (let d = 0; d < 300 && pointInRing(x, y, ring); d += 1) {
        x = f.cx + f.ux * s * d;
        y = f.cy + f.uy * s * d;
      }
      if (!pointInRing(x, y, ring)) cands.push({ x, y, ...edgeAt(x, y), score: score(x, y) });
    }
  }
  if (!cands.length) {
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % ring.length];
      if (Math.hypot(bx - ax, by - ay) < 8) continue;
      const x = (ax + bx) / 2;
      const y = (ay + by) / 2;
      cands.push({ x, y, ...edgeAt(x, y), score: score(x, y) });
    }
  }
  cands.sort((p, q) => p.score - q.score);
  return cands[0] ?? null;
}

/** Thai and Buddhist flags flanking each temple gate, motorbikes parked outside it. */
function temples(ctx: BuildContext, env: PlaceEnv): void {
  const { city } = ctx;
  const halls = templeHalls(ctx);
  city.areas.forEach((a, ai) => {
    if (city.areaKinds[a.k] !== 'temple') return;
    const ring = ccw(ringOf(a.r));
    const gate = templeGate(ctx, env, ring, a.ti !== undefined ? halls.get(a.ti) : undefined);
    if (!gate) return;
    const { x, y, ex, ey } = gate;
    // Inward normal of a counter-clockwise ring.
    const ix = -ey;
    const iy = ex;
    const outYaw = Math.atan2(-iy, -ix);
    for (const along of [4.5, -4.5, 9, -9]) {
      if (Math.abs(along) > 5 && hash01(ai, 171) < 0.5) continue;
      put(ctx, env, 'flag_pole', x + ex * along + ix * 1.6, y + ey * along + iy * 1.6, outYaw, { r: 0.8, clear: 0.3 });
    }
    const dir = hash01(ai, 172) < 0.5 ? 1 : -1;
    for (let m = 0; m < 2; m++) {
      const along = dir * (4 + m * 2.9);
      bikeModule(ctx, env, x + ex * along - ix * 1.9, y + ey * along - iy * 1.9, Math.atan2(iy, ix));
    }
  });
}

/** A group of three scooters parked at 45°, noses along yaw; ~3.1 m long across the yaw. */
function bikeModule(ctx: BuildContext, env: PlaceEnv, x: number, y: number, yaw: number): boolean {
  return put(ctx, env, 'parked_bike', x, y, yaw, {
    r: 1.3,
    clear: 0.15,
    foot: [
      [0.7, 1.55],
      [0.7, -1.55],
      [-0.7, 1.55],
      [-0.7, -1.55],
    ],
  });
}

// ------------------------------------------------------------------ shop fronts

const COMMERCIAL_USE = /shop|restaurant|cafe|bar|pub|fast_food|hotel|guest_house|hostel|convenience|bank|massage|marketplace|pharmacy|clinic|food_court|jewelry|clothes|motorcycle|car|mall|laundry|bakery|beauty|hairdresser|travel_agency|supermarket|electronics|gift|tattoo|optician|mobile_phone|coffee|beverages|books|hardware|furniture/;
const HOTEL_USE = /hotel|guest_house|hostel/;
const BIKE_DENSITY: Record<string, number> = {
  old_city: 1,
  moat_ring: 1,
  nimman: 1,
  tha_phae: 1,
  night_bazaar: 1,
  chinatown: 1,
  santitham: 1,
  wua_lai: 0.7,
  wat_ket: 0.7,
  suan_dok: 0.7,
  chang_phueak: 0.7,
  riverside: 0.7,
  suburb: 0.4,
  airport: 0,
};

/** Spirit houses at ~40% of commercial fronts (all hotels); motorbike rows in front of shops. */
function shopFronts(ctx: BuildContext, env: PlaceEnv): void {
  const { city, str } = ctx;
  city.buildings.forEach((b) => {
    if (b.f === undefined || b.t !== undefined) return;
    const zone = city.zones[b.z] ?? 'suburb';
    if (zone === 'airport') return;
    const kind = str(b.b);
    const use = str(b.u);
    if (/house|detached|apartments|residential|dormitory|garage|roof|hangar|school|university|hospital|temple|part:/.test(kind) && !COMMERCIAL_USE.test(use)) return;
    const road = b.fr !== undefined ? env.streets[b.fr] : undefined;
    const commercial = COMMERCIAL_USE.test(use) || kind === 'retail' || kind === 'commercial' || kind === 'hotel' || zone !== 'suburb' || (road !== undefined && road.cls <= 3);
    if (!commercial) return;
    const ring = ringOf(b.r);
    const [ax, ay] = ring[b.f];
    const [bx, by] = ring[(b.f + 1) % ring.length];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 3) return;
    const ex = (bx - ax) / len;
    const ey = (by - ay) / len;
    // Outward normal: right of the edge on a counter-clockwise footprint, left on a clockwise one.
    const turn = signedArea(ring) >= 0 ? 1 : -1;
    const ox = ey * turn;
    const oy = -ex * turn;
    const faceStreet = Math.atan2(oy, ox);
    const hotel = HOTEL_USE.test(use) || kind === 'hotel';
    const shrineAtEnd = hash01(b.id, 181) < 0.5;
    if (hotel || hash01(b.id, 182) < 0.4) {
      const t = shrineAtEnd ? len - 0.8 : 0.8;
      for (const out of [1.0, 1.5]) {
        if (put(ctx, env, 'spirit_house', ax + ex * t + ox * out, ay + ey * t + oy * out, faceStreet, { r: 0.6, clear: 0.35 })) break;
      }
    }
    const density = BIKE_DENSITY[zone] ?? 0.5;
    if (len >= 5 && hash01(b.id, 183) < 0.16 * density) {
      const modules = Math.min(3, Math.max(1, Math.floor((len - 3.1) / 2.8)));
      const start = shrineAtEnd ? 1.2 : 1.9;
      for (let m = 0; m < modules; m++) {
        const t = start + 1.35 + m * 2.8;
        if (t > len - 1.2) break;
        bikeModule(ctx, env, ax + ex * t + ox * 1.75, ay + ey * t + oy * 1.75, Math.atan2(-oy, -ox));
      }
    }
  });
}

// ------------------------------------------------------------------ markets & food

/** A food cart with plastic stools on its serving side (+X) and a big parasol beside it. */
function foodCart(ctx: BuildContext, env: PlaceEnv, x: number, y: number, yaw: number, n: number): boolean {
  const ok = put(ctx, env, 'food_cart', x, y, yaw, {
    r: 1.1,
    clear: 0.2,
    foot: [
      [1.5, 0.8],
      [1.5, -0.8],
      [-0.5, 0.8],
      [-0.5, -0.8],
    ],
  });
  if (!ok) return false;
  const [px, py] = local(x, y, yaw, 0.3, 0);
  if (!env.clear.hit(px, py, 1.3, OB.BUILDING | OB.WALL)) addProp(ctx, 'parasol', px, py, hash01(n, 191) * Math.PI * 2, 0.95 + hash01(n, 192) * 0.2);
  return true;
}

/** Stall rows inside market edges that face a road; food carts and parked motorbikes outside on the pavement. */
function markets(ctx: BuildContext, env: PlaceEnv): void {
  const { city } = ctx;
  city.areas.forEach((a, ai) => {
    if (city.areaKinds[a.k] !== 'market') return;
    const ring = ccw(ringOf(a.r));
    let stalls = 0;
    let carts = 0;
    let bikes = 0;
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % ring.length];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 6) continue;
      const ex = (bx - ax) / len;
      const ey = (by - ay) / len;
      const near = nearestStreet(env, (ax + bx) / 2, (ay + by) / 2, 25, (st) => st.cls <= 6);
      if (!near) continue;
      const ix = -ey;
      const iy = ex;
      // Stalls face out of the market towards the road.
      for (let t = 2; t < len - 2 && stalls < 40; t += 2.4) {
        const id = ai * 1000 + i * 50 + Math.round(t);
        if (hash01(id, 201) < 0.2) continue;
        if (put(ctx, env, 'stall', ax + ex * t + ix * 1.8, ay + ey * t + iy * 1.8, Math.atan2(-iy, -ix), { r: 1.1, clear: 0.2, foot: [[0.9, 0.9], [0.9, -0.9], [-0.9, 0.9], [-0.9, -0.9]] })) stalls++;
      }
      for (let t = 3; t < len - 3 && carts < 8; t += 3.2) {
        const id = ai * 1000 + i * 50 + Math.round(t);
        if (hash01(id, 202) < 0.5) continue;
        if (foodCart(ctx, env, ax + ex * t - ix * 1.6, ay + ey * t - iy * 1.6, Math.atan2(iy, ix), id)) carts++;
      }
      // Motorbikes parked along the outside of the market, noses to it.
      for (let t = 2; t < len - 2 && bikes < 10; t += 2.9) {
        const id = ai * 1000 + i * 50 + Math.round(t);
        if (hash01(id, 203) < 0.45) continue;
        if (bikeModule(ctx, env, ax + ex * t - ix * 1.9, ay + ey * t - iy * 1.9, Math.atan2(iy, ix))) bikes++;
      }
    }
  });
}

/** Food carts under parasols on the main-road pavement beside ~30% of soi mouths. */
function soiMouths(ctx: BuildContext, env: PlaceEnv): void {
  const byNode = new Map<number, Street[]>();
  for (const st of env.streets) {
    for (const n of st.nodes) {
      let list = byNode.get(n);
      if (!list) byNode.set(n, (list = []));
      if (!list.includes(st)) list.push(st);
    }
  }
  for (const soi of env.streets) {
    if (soi.cls < 5 || soi.cls > 6 || soi.len < 30) continue;
    for (const end of [0, soi.pts.length - 1]) {
      const node = soi.nodes[end];
      const id = soi.i * 2 + (end ? 1 : 0);
      if (hash01(id, 211) > 0.3) continue;
      const major = (byNode.get(node) ?? []).find((st) => st !== soi && st.cls <= 3 && !(st.flags & ROAD_FLAG.BRIDGE));
      if (!major) continue;
      const k = major.nodes.indexOf(node);
      const [ox, oy] = major.pts[k];
      const nb = hash01(id, 212) < 0.5 && k > 0 ? k - 1 : k < major.pts.length - 1 ? k + 1 : k - 1;
      if (nb < 0) continue;
      const ml = Math.hypot(major.pts[nb][0] - ox, major.pts[nb][1] - oy);
      if (ml < 8) continue;
      const mdx = (major.pts[nb][0] - ox) / ml;
      const mdy = (major.pts[nb][1] - oy) / ml;
      const sn = end ? soi.pts.length - 2 : 1;
      const sdx = soi.pts[sn][0] - ox;
      const sdy = soi.pts[sn][1] - oy;
      const side = mdx * sdy - mdy * sdx >= 0 ? 1 : -1;
      const nx = -mdy * side;
      const ny = mdx * side;
      const count = 1 + Math.floor(hash01(id, 213) * 3);
      let placed = 0;
      for (let j = 0; j < 6 && placed < count; j++) {
        const along = soi.half + 2.5 + j * 2.7;
        if (along > ml - 2) break;
        const off = major.half + 1.1;
        if (foodCart(ctx, env, ox + mdx * along + nx * off, oy + mdy * along + ny * off, Math.atan2(ny, nx), id * 10 + j)) placed++;
      }
    }
  }
}

// ------------------------------------------------------------------ OSM extras

/** OSM benches, flagpoles, cabinets, wayside shrines and motorbike parking; park benches along paths. */
function osmExtras(ctx: BuildContext, env: PlaceEnv): void {
  const { city } = ctx;
  const facing = (x: number, y: number, n: number) => {
    const near = nearestStreet(env, x, y, 30);
    return near ? Math.atan2(near.py - y, near.px - x) : hash01(n, 221) * Math.PI * 2;
  };
  for (const [x, y, n] of osmPoints(ctx, 'bench')) put(ctx, env, 'bench', x, y, facing(x, y, n), { r: 0.9, clear: 0.2 });
  for (const [x, y, n] of osmPoints(ctx, 'flagpole')) put(ctx, env, 'flag_pole', x, y, facing(x, y, n), { r: 0.8, clear: 0.2 });
  for (const [x, y, n] of osmPoints(ctx, 'street_cabinet')) put(ctx, env, 'pea_cabinet', x, y, facing(x, y, n), { r: 0.7, clear: 0.2 });
  for (const [x, y, n] of osmPoints(ctx, 'wayside_shrine')) put(ctx, env, 'spirit_house', x, y, facing(x, y, n), { r: 0.6, clear: 0.2 });
  for (const [x, y, n] of osmPoints(ctx, 'motorcycle_parking')) {
    const near = nearestStreet(env, x, y, 40);
    const yaw = near ? Math.atan2(near.py - y, near.px - x) + Math.PI : hash01(n, 222) * Math.PI * 2;
    for (let m = -1; m <= 1; m++) {
      const [px, py] = local(x, y, yaw, 0, m * 2.8);
      bikeModule(ctx, env, px, py, yaw);
    }
  }
  // Benches beside footpaths in parks and gardens.
  const parks = city.areas
    .filter((a) => ['park', 'garden'].includes(city.areaKinds[a.k]))
    .map((a) => {
      const ring = ringOf(a.r);
      return { ring, box: bbox(ring) };
    });
  city.lines.forEach((l, li) => {
    if (city.lineKinds[l.k] !== 'footway') return;
    walk(
      ringOf(l.p),
      10 + hash01(li, 231) * 20,
      (n) => 40 + hash01(li * 100 + n, 232) * 20,
      (p, n) => {
        const id = li * 100 + n;
        if (hash01(id, 233) < 0.5) return;
        if (!parks.some(({ ring, box }) => p.x >= box[0] && p.x <= box[2] && p.y >= box[1] && p.y <= box[3] && pointInRing(p.x, p.y, ring))) return;
        const side = hash01(id, 234) < 0.5 ? 1 : -1;
        const nx = -p.dy * side;
        const ny = p.dx * side;
        put(ctx, env, 'bench', p.x + nx * 1.6, p.y + ny * 1.6, Math.atan2(-ny, -nx), { r: 0.9, clear: 0.2, mask: PROP_BLOCK | OB.PATH });
      },
    );
  });
}
