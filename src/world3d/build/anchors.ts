// Positions the simulation hands the static city build to settle against
// what it draws: candidate spots for the traffic light of every signalled
// approach and for the waiting passenger of every place (generated from the
// road graph by src/world3d/simAnchors.ts). The build takes each one's first
// candidate clear of buildings, walls, water, carriageways, junction
// surfaces, trees and street furniture. Traffic-light poles are placed
// before the other props and registered, so lamps, poles, shelters and stalls
// keep off them. Pure: no three.js, no DOM.

import { OB, PROP_BLOCK } from './clearance';
import type { BuildContext } from './context';
import type { PlaceEnv } from './streets';

/** Candidate spots in CSR form: item k's candidates are spots start[k] .. start[k + 1], best first. */
export interface AnchorList {
  start: Int32Array;
  spots: Float32Array;
}

export interface SimAnchors {
  /** Traffic lights, one item per signalled approach; SPOT_FLOATS per spot. */
  signals: AnchorList;
  /** Waiting passengers, one item per place index; KERB_FLOATS per spot. */
  kerbs: AnchorList;
}

/** Floats per traffic-light spot: arc, pole x, y, head x, y, heading of the approaching traffic, arm length, side, far side (signalSpots.ts). */
export const SPOT_FLOATS = 9;
/** Floats per waiting-passenger spot: x, y, and the heading that faces the road. */
export const KERB_FLOATS = 3;
/** Clearance (m) of a traffic-light pole from obstacles, and its radius in the placement registry. */
const POLE_CLEAR = 0.3;
const POLE_R = 0.3;
/** Clearance (m) of a waiting passenger from buildings, walls and water; from carriageways; radius against trunks and street furniture. */
const PERSON_CLEAR = 0.3;
const PERSON_ROAD_CLEAR = 0.2;
const PERSON_R = 0.3;
/** Where every candidate is inside a building: search rings this far apart (m), out to this reach, in this many directions. */
const RESCUE_STEP = 0.5;
const RESCUE_REACH = 12;
const RESCUE_DIRS = 16;
/** What a waiting passenger may not stand in or against. */
const PERSON_BLOCK = OB.BUILDING | OB.WALL | OB.BASTION | OB.WATER | OB.TRACK;

/** The buffers of a set of anchors, for transferring them to the build worker. */
export function anchorBuffers(a: SimAnchors): ArrayBuffer[] {
  return [a.signals.start.buffer, a.signals.spots.buffer, a.kerbs.start.buffer, a.kerbs.spots.buffer] as ArrayBuffer[];
}

function inKeep(ctx: BuildContext, x: number, y: number): boolean {
  const [x0, y0, x1, y1] = ctx.keep;
  return x > x0 && x < x1 && y > y0 && y < y1;
}

/**
 * Stand each signalled approach's traffic light on its first candidate spot
 * whose pole is clear of carriageways, junction surfaces, buildings, walls,
 * water, rail, tree trunks and other poles, and register the pole. An
 * approach whose candidates are all blocked gets no light drawn (the
 * simulation still runs it).
 */
export function placeSignals(ctx: BuildContext, env: PlaceEnv): void {
  const list = ctx.anchors?.signals;
  if (!list) return;
  const { start, spots } = list;
  for (let k = 0; k + 1 < start.length; k++) {
    for (let i = start[k]; i < start[k + 1]; i++) {
      const o = i * SPOT_FLOATS;
      const x = spots[o + 1];
      const y = spots[o + 2];
      if (!inKeep(ctx, x, y) || env.clear.hit(x, y, POLE_CLEAR, PROP_BLOCK) || !env.placed.free(x, y, POLE_R)) continue;
      env.placed.add(x, y, POLE_R);
      const out = (ctx.signals ??= []);
      for (let f = 0; f < SPOT_FLOATS; f++) out.push(spots[o + f]);
      break;
    }
  }
}

/**
 * Settle each place's waiting passenger on its first candidate clear of
 * buildings, walls, water and carriageways and of tree trunks and street
 * furniture; failing that, the first clear of all but the trunks and
 * furniture; failing that (buildings mapped over every pavement nearby), the
 * nearest such spot within RESCUE_REACH of the first candidate. Places
 * outside the built area, or with nowhere clear, keep NaN: the view then uses
 * the simulation's own kerb point.
 */
export function settleKerbs(ctx: BuildContext, env: PlaceEnv): Float32Array {
  const list = ctx.anchors?.kerbs;
  const n = list ? list.start.length - 1 : 0;
  const out = new Float32Array(n * KERB_FLOATS).fill(NaN);
  if (!list) return out;
  const { start, spots } = list;
  const open = (i: number) => {
    const x = spots[i * KERB_FLOATS];
    const y = spots[i * KERB_FLOATS + 1];
    return inKeep(ctx, x, y) && !env.clear.hit(x, y, PERSON_CLEAR, PERSON_BLOCK) && !env.clear.hit(x, y, PERSON_ROAD_CLEAR, OB.ROAD);
  };
  for (let k = 0; k < n; k++) {
    let pick = -1;
    for (let i = start[k]; i < start[k + 1] && pick < 0; i++) {
      if (open(i) && env.placed.free(spots[i * KERB_FLOATS], spots[i * KERB_FLOATS + 1], PERSON_R)) pick = i;
    }
    for (let i = start[k]; i < start[k + 1] && pick < 0; i++) if (open(i)) pick = i;
    if (pick >= 0) {
      out.set(spots.subarray(pick * KERB_FLOATS, (pick + 1) * KERB_FLOATS), k * KERB_FLOATS);
      continue;
    }
    // Every candidate is inside a building: the nearest clear spot around the first, which is where the pickup is judged from.
    const i0 = start[k];
    if (i0 >= start[k + 1]) continue;
    const [x0, y0, face] = [spots[i0 * KERB_FLOATS], spots[i0 * KERB_FLOATS + 1], spots[i0 * KERB_FLOATS + 2]];
    search: for (let r = RESCUE_STEP; r <= RESCUE_REACH; r += RESCUE_STEP) {
      for (let a = 0; a < RESCUE_DIRS; a++) {
        const x = x0 + Math.cos((a / RESCUE_DIRS) * Math.PI * 2) * r;
        const y = y0 + Math.sin((a / RESCUE_DIRS) * Math.PI * 2) * r;
        if (inKeep(ctx, x, y) && !env.clear.hit(x, y, PERSON_CLEAR, PERSON_BLOCK) && !env.clear.hit(x, y, PERSON_ROAD_CLEAR, OB.ROAD)) {
          out.set([x, y, face], k * KERB_FLOATS);
          break search;
        }
      }
    }
  }
  return out;
}
