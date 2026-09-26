// Road closures and local slowdowns on the road graph. Road sets (content/events.ts)
// are resolved to edge lists once per graph; active effects are folded into a
// per-edge travel-time multiplier that the router (Router.edgePenalty) and vehicle
// movement both read.

import { ROAD_SETS, type RoadEffect, type RoadSetDef } from '../content/events';
import type { RoadGraph } from './graph';

/**
 * [pacing] Routing cost multiplier for a closed street. Large enough that routes detour around it, finite so a
 * passenger standing on the closed street can still be reached from the nearest barrier; vehicles on it crawl.
 */
export const CLOSED_TIME_FACTOR = 40;

const edgeCache = new WeakMap<RoadGraph, Map<string, Int32Array>>();

function matchEdges(graph: RoadGraph, def: RoadSetDef): Int32Array {
  const names = def.roads ? new Set(def.roads) : null;
  const nameIdx = new Set<number>();
  if (names) graph.names.forEach((n, i) => names.has(n) && nameIdx.add(i));
  let box: [number, number, number, number] | null = null;
  if (def.box) {
    const [s, w, n, e] = def.box;
    const [x0, y0] = graph.projection.toXY(w, s);
    const [x1, y1] = graph.projection.toXY(e, n);
    box = [x0, y0, x1, y1];
  }
  let circle: [number, number, number] | null = null;
  if (def.circle) {
    const [cx, cy] = graph.projection.toXY(def.circle.lon, def.circle.lat);
    circle = [cx, cy, def.circle.radius];
  }
  const out: number[] = [];
  graph.edges.forEach((e, i) => {
    if (names && !nameIdx.has(e.name)) return;
    const k = (e.pts.length / 2) >> 1;
    const mx = (e.pts[0] + e.pts[e.pts.length - 2] + e.pts[2 * k]) / 3;
    const my = (e.pts[1] + e.pts[e.pts.length - 1] + e.pts[2 * k + 1]) / 3;
    if (box && (mx < box[0] || mx > box[2] || my < box[1] || my > box[3])) return;
    if (circle && Math.hypot(mx - circle[0], my - circle[1]) > circle[2]) return;
    out.push(i);
  });
  return Int32Array.from(out);
}

/** Edge indices of a road set (see ROAD_SETS), computed once per graph. */
export function roadSetEdges(graph: RoadGraph, id: string): Int32Array {
  let byId = edgeCache.get(graph);
  if (!byId) edgeCache.set(graph, (byId = new Map()));
  let edges = byId.get(id);
  if (!edges) {
    const def = ROAD_SETS[id];
    edges = def ? matchEdges(graph, def) : new Int32Array(0);
    byId.set(id, edges);
  }
  return edges;
}

/** Travel-time multiplier of one road effect: closed streets cost CLOSED_TIME_FACTOR, slowed ones 1/slow. */
export function effectFactor(effect: RoadEffect): number {
  if (effect.closed) return CLOSED_TIME_FACTOR;
  return effect.slow && effect.slow > 0 ? 1 / effect.slow : 1;
}

/** Per-edge multiplier array for a set of road effects (the strongest effect wins on shared edges). */
export function edgeMultipliers(graph: RoadGraph, effects: readonly RoadEffect[]): Float32Array {
  const mul = new Float32Array(graph.edges.length).fill(1);
  for (const eff of effects) {
    const f = effectFactor(eff);
    for (const e of roadSetEdges(graph, eff.set)) if (f > mul[e]) mul[e] = f;
  }
  return mul;
}
