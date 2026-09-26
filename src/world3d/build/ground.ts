// Ground, land cover, water and linear features (rail, runway, walls, fences,
// footpaths).

import { ringOf } from '../city';
import type { BuildContext } from './context';
import { shade, type MeshWriter, type RGB } from './mesh';
import type { Occupancy } from './occupancy';
import { P } from './palette';
import { box, dashes, offset, type Ring } from './shapes';

export function buildGround(ctx: BuildContext): void {
  const { city, w, occ } = ctx;
  const [kx0, ky0, kx1, ky1] = ctx.keep;
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
  const parkAreas = ctx.parkAreas;
  const moatRings = ctx.moatRings;
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