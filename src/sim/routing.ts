import { MAX_ROAD_SPEED_MS, RoadGraph, reverseArc } from './graph';

/** Where a vehicle is: s metres along an arc. */
export interface ArcPosition {
  arc: number;
  s: number;
}

export interface Route {
  /** Arcs to drive in order. The first is the one the vehicle is on (or starts). */
  arcs: number[];
  /** Distance already covered on arcs[0] when the route starts. */
  startS: number;
  target: number;
  /** Metres still to drive. */
  length: number;
  /** Estimated seconds, free-flow. */
  time: number;
}

/** Extra seconds charged for turning around on a two-way street. */
const UTURN_PENALTY_S = 12;

/** Multiplier on travel time per road class (service roads cut through car parks). */
const CLASS_TIME_FACTOR = [1, 1, 1, 1, 1, 1, 1.3, 1.6];

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  clear(): void {
    this.ids.length = 0;
    this.keys.length = 0;
  }

  push(id: number, key: number): void {
    const ids = this.ids;
    const keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }

  pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}

export class Router {
  private readonly g: Float64Array;
  private readonly cameFrom: Int32Array;
  private readonly isStart: Uint8Array;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private generation = 0;
  private readonly heap = new MinHeap();
  readonly graph: RoadGraph;
  /** Optional per-class slowdown (e.g. rush hour); 1 = free flow. */
  congestion: (cls: number) => number = () => 1;

  constructor(graph: RoadGraph) {
    this.graph = graph;
    const n = graph.nodeCount;
    this.g = new Float64Array(n);
    this.cameFrom = new Int32Array(n);
    this.isStart = new Uint8Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
  }

  arcTime(arc: number, metres?: number): number {
    const e = this.graph.edges[arc >> 1];
    return ((metres ?? e.len) / this.graph.speedOf(arc >> 1)) * CLASS_TIME_FACTOR[e.cls] * this.congestion(e.cls);
  }

  /** Route from a node or a point on an arc to a target node. */
  route(from: ArcPosition | number, target: number, allowUTurn = true): Route | null {
    const graph = this.graph;
    const gen = ++this.generation;
    const { g, cameFrom, isStart, stamp, closed, heap } = this;
    heap.clear();
    const tx = graph.nodeX[target];
    const ty = graph.nodeY[target];
    const h = (n: number) => Math.hypot(graph.nodeX[n] - tx, graph.nodeY[n] - ty) / MAX_ROAD_SPEED_MS;

    const seed = (node: number, cost: number, arc: number) => {
      if (stamp[node] === gen && g[node] <= cost) return;
      stamp[node] = gen;
      g[node] = cost;
      cameFrom[node] = arc;
      isStart[node] = 1;
      heap.push(node, cost + h(node));
    };

    let startNode = -1;
    if (typeof from === 'number') {
      startNode = from;
      seed(from, 0, -1);
    } else {
      const len = graph.arcLen(from.arc);
      seed(graph.arcTo(from.arc), this.arcTime(from.arc, Math.max(0, len - from.s)), from.arc);
      const rev = reverseArc(from.arc);
      if (allowUTurn && graph.arcValid(rev)) {
        seed(graph.arcFrom(from.arc), this.arcTime(rev, from.s) + UTURN_PENALTY_S, rev);
      }
    }

    let found = false;
    while (heap.size) {
      const v = heap.pop();
      if (closed[v] === gen) continue;
      closed[v] = gen;
      if (v === target) {
        found = true;
        break;
      }
      const gv = g[v];
      const out = graph.outgoing(v);
      for (let i = 0; i < out.length; i++) {
        const arc = out[i];
        const w = graph.arcTo(arc);
        if (closed[w] === gen) continue;
        const cost = gv + this.arcTime(arc);
        if (stamp[w] !== gen || cost < g[w]) {
          stamp[w] = gen;
          g[w] = cost;
          cameFrom[w] = arc;
          isStart[w] = 0;
          heap.push(w, cost + h(w));
        }
      }
    }
    if (!found) return null;

    const arcs: number[] = [];
    let v = target;
    for (let guard = 0; guard < graph.nodeCount; guard++) {
      if (v === startNode && cameFrom[v] === -1) break;
      const arc = cameFrom[v];
      arcs.push(arc);
      if (isStart[v]) break;
      v = graph.arcFrom(arc);
    }
    arcs.reverse();

    let startS = 0;
    if (typeof from !== 'number' && arcs.length) {
      startS = arcs[0] === from.arc ? from.s : graph.arcLen(from.arc) - from.s;
    }
    let length = -startS;
    for (const a of arcs) length += graph.arcLen(a);
    return { arcs, startS, target, length: Math.max(0, length), time: g[target] };
  }
}

/** Straight-line distance between two nodes, metres. */
export function nodeDistance(graph: RoadGraph, a: number, b: number): number {
  return Math.hypot(graph.nodeX[a] - graph.nodeX[b], graph.nodeY[a] - graph.nodeY[b]);
}
