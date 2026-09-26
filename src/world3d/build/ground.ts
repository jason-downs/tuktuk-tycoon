// Ground: the far plain, the street-level base with holes where water is sunk
// (water.ts), painted land cover (surfaces.ts), channels, footpaths, rail, the
// airport, and walls, fences and hedges.

import { ringOf } from '../city';
import { buildAirport } from './airport';
import type { BuildContext } from './context';
import { shade, type MeshWriter, type RGB } from './mesh';
import type { Occupancy } from './occupancy';
import { P } from './palette';
import { box, type Ring } from './shapes';
import { buildPaths, buildRail, buildSurfaces } from './surfaces';
import { buildChannels, buildWater, markWater, planWater, WaterIndex } from './water';

export function buildGround(ctx: BuildContext): void {
  const { city, w, occ } = ctx;
  const [kx0, ky0, kx1, ky1] = ctx.keep;
  // ---- ground: far plain and the street-level base, open over sunken water
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
  const water = planWater(city, ctx.keep);
  ctx.waterBodies = water.bodies;
  for (const b of water.bodies) if (b.kind === 'moat') ctx.moatRings.push(b.ring);
  markWater(occ, water.bodies);
  w.ground.polygon(
    [
      [kx0, ky0],
      [kx1, ky0],
      [kx1, ky1],
      [kx0, ky1],
    ],
    water.bodies.map((b) => b.ring),
    0,
    P.groundUrban,
  );

  // ---- painted ground, in order: land cover, water edges, channels, paths, rail, airport
  buildSurfaces(ctx);
  buildWater(ctx, water);
  buildChannels(ctx, water, new WaterIndex(water.bodies));
  buildPaths(ctx);
  buildRail(ctx);
  buildAirport(ctx);

  // ---- walls, fences and hedges
  for (const l of city.lines) {
    const kind = city.lineKinds[l.k];
    const pts = ringOf(l.p);
    switch (kind) {
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
      default:
        break;
    }
  }
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