// Roads: pavements, carriageways by class and surface, centre and lane lines.

import { ROAD_FLAG } from '../city';
import type { BuildContext } from './context';
import { P } from './palette';
import { dashes, offset, type Ring } from './shapes';

export function buildRoads(ctx: BuildContext): void {
  const { city, w, occ } = ctx;
  // ---- roads
  const rn = city.roads.nodes;
  const CLASS_Y = [0.13, 0.126, 0.122, 0.118, 0.114, 0.11, 0.106, 0.102];
  const roadPts = ctx.roadPts;
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

}
