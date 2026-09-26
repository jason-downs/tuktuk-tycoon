import { Projection, type LatLon } from '../geo';

/** Road classes in the order build-map.mjs encodes them. */
export const ROAD_CLASSES = [
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
  'service',
] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

/** Free-flow tuk-tuk cruising speed per road class, km/h. */
export const CLASS_SPEED_KMH: readonly number[] = [50, 42, 38, 33, 28, 24, 12, 14];
export const MAX_ROAD_SPEED_MS = Math.max(...CLASS_SPEED_KMH) / 3.6;

export interface GraphJSON {
  origin: LatLon;
  classes: string[];
  names: string[];
  nodes: number[];
  /** [a, b, class, oneway, nameIndex, length, interiorXY[], lanes, virtual] */
  edges: [number, number, number, number, number, number, number[], number?, number?][];
  /** Main roads leaving the play area: out = boundary node where traffic leaves, in = where it returns. */
  portals?: PortalJSON[];
  /** Out-of-town landmarks: the portal to use and the road metres beyond it. */
  offmap?: { id: string; portal: number; extraM: number }[];
  /** Junction nodes controlled by traffic signals (OSM highway=traffic_signals), ascending. */
  signals?: number[];
}

export interface PortalJSON {
  id: string;
  name: string;
  out: number;
  in: number;
  x: number;
  y: number;
}

export interface Edge {
  a: number;
  b: number;
  cls: number;
  oneway: boolean;
  name: number;
  /** Lanes tagged in OSM (0 = untagged). */
  lanes: number;
  /** Hidden turnaround beyond a portal (not a real street). */
  virtual: boolean;
  /** Polyline x0,y0,…,xn,yn including both end nodes. */
  pts: Float64Array;
  /** Cumulative distance at each polyline vertex; cum[last] is the edge length. */
  cum: Float64Array;
  len: number;
}

export interface Pose {
  x: number;
  y: number;
  /** Heading in radians, counter-clockwise from east (Math.atan2 convention). */
  heading: number;
}

/**
 * Directed traversal of an edge. arc = edge * 2 + dir, where dir 0 runs a→b
 * and dir 1 runs b→a (only valid on two-way edges).
 */
export const arcEdge = (arc: number): number => arc >> 1;
export const arcDir = (arc: number): number => arc & 1;
export const reverseArc = (arc: number): number => arc ^ 1;

const GRID_CELL = 150;

export class RoadGraph {
  readonly projection: Projection;
  readonly names: string[];
  readonly nodeX: Float64Array;
  readonly nodeY: Float64Array;
  readonly edges: Edge[];
  /** CSR adjacency: outgoing arcs of node n are outArcs[outStart[n] .. outStart[n + 1]). */
  readonly outStart: Int32Array;
  readonly outArcs: Int32Array;
  readonly nodeCount: number;
  readonly portals: PortalJSON[];
  /** Junction nodes controlled by traffic signals, ascending. */
  readonly signals: number[];
  private readonly edgeGrid = new Map<number, number[]>();
  private readonly nodeGrid = new Map<number, number[]>();

  constructor(json: GraphJSON) {
    this.projection = new Projection(json.origin);
    this.names = json.names;
    this.nodeCount = json.nodes.length / 2;
    this.nodeX = new Float64Array(this.nodeCount);
    this.nodeY = new Float64Array(this.nodeCount);
    for (let i = 0; i < this.nodeCount; i++) {
      this.nodeX[i] = json.nodes[2 * i];
      this.nodeY[i] = json.nodes[2 * i + 1];
    }
    this.portals = json.portals ?? [];
    this.signals = json.signals ?? [];
    this.edges = json.edges.map(([a, b, cls, oneway, name, , inner, lanes, virtual]) => {
      const pts = new Float64Array(inner.length + 4);
      pts[0] = this.nodeX[a];
      pts[1] = this.nodeY[a];
      pts.set(inner, 2);
      pts[pts.length - 2] = this.nodeX[b];
      pts[pts.length - 1] = this.nodeY[b];
      const cum = new Float64Array(pts.length / 2);
      for (let k = 1; k < cum.length; k++) {
        cum[k] = cum[k - 1] + Math.hypot(pts[2 * k] - pts[2 * k - 2], pts[2 * k + 1] - pts[2 * k - 1]);
      }
      return { a, b, cls, oneway: oneway === 1, name, lanes: lanes ?? 0, virtual: virtual === 1, pts, cum, len: Math.max(cum[cum.length - 1], 0.5) };
    });

    const degree = new Int32Array(this.nodeCount + 1);
    this.edges.forEach((e) => {
      degree[e.a]++;
      if (!e.oneway) degree[e.b]++;
    });
    this.outStart = new Int32Array(this.nodeCount + 1);
    for (let i = 0; i < this.nodeCount; i++) this.outStart[i + 1] = this.outStart[i] + degree[i];
    this.outArcs = new Int32Array(this.outStart[this.nodeCount]);
    const fill = this.outStart.slice(0, this.nodeCount);
    this.edges.forEach((e, i) => {
      this.outArcs[fill[e.a]++] = i * 2;
      if (!e.oneway) this.outArcs[fill[e.b]++] = i * 2 + 1;
    });

    for (let i = 0; i < this.nodeCount; i++) this.gridAdd(this.nodeGrid, this.nodeX[i], this.nodeY[i], i);
    this.edges.forEach((e, i) => {
      const seen = new Set<number>();
      for (let k = 0; k < e.pts.length / 2; k++) {
        const key = this.cellKey(e.pts[2 * k], e.pts[2 * k + 1]);
        if (!seen.has(key)) {
          seen.add(key);
          this.gridAddKey(this.edgeGrid, key, i);
        }
      }
      // Long straight segments can skip cells; add midpoints.
      for (let k = 1; k < e.pts.length / 2; k++) {
        const segLen = e.cum[k] - e.cum[k - 1];
        const steps = Math.floor(segLen / GRID_CELL);
        for (let s = 1; s <= steps; s++) {
          const t = s / (steps + 1);
          const key = this.cellKey(
            e.pts[2 * k - 2] + (e.pts[2 * k] - e.pts[2 * k - 2]) * t,
            e.pts[2 * k - 1] + (e.pts[2 * k + 1] - e.pts[2 * k - 1]) * t,
          );
          if (!seen.has(key)) {
            seen.add(key);
            this.gridAddKey(this.edgeGrid, key, i);
          }
        }
      }
    });
  }

  // ------------------------------------------------------------------ arcs
  arcFrom(arc: number): number {
    const e = this.edges[arc >> 1];
    return arc & 1 ? e.b : e.a;
  }

  arcTo(arc: number): number {
    const e = this.edges[arc >> 1];
    return arc & 1 ? e.a : e.b;
  }

  arcLen(arc: number): number {
    return this.edges[arc >> 1].len;
  }

  arcValid(arc: number): boolean {
    return (arc & 1) === 0 || !this.edges[arc >> 1].oneway;
  }

  outgoing(node: number): Int32Array {
    return this.outArcs.subarray(this.outStart[node], this.outStart[node + 1]);
  }

  edgeName(edge: number): string {
    return this.names[this.edges[edge].name] ?? '';
  }

  speedOf(edge: number): number {
    return CLASS_SPEED_KMH[this.edges[edge].cls] / 3.6;
  }

  /** Position and heading at distance s (metres) along an arc. */
  poseAt(arc: number, s: number, out: Pose = { x: 0, y: 0, heading: 0 }): Pose {
    const e = this.edges[arc >> 1];
    const reversed = (arc & 1) === 1;
    let d = reversed ? e.len - s : s;
    d = Math.max(0, Math.min(e.cum[e.cum.length - 1], d));
    // Binary search the polyline segment containing d.
    let lo = 0;
    let hi = e.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (e.cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const segLen = e.cum[hi] - e.cum[lo] || 1e-9;
    const t = (d - e.cum[lo]) / segLen;
    const x0 = e.pts[2 * lo];
    const y0 = e.pts[2 * lo + 1];
    const x1 = e.pts[2 * hi];
    const y1 = e.pts[2 * hi + 1];
    out.x = x0 + (x1 - x0) * t;
    out.y = y0 + (y1 - y0) * t;
    out.heading = reversed ? Math.atan2(y0 - y1, x0 - x1) : Math.atan2(y1 - y0, x1 - x0);
    return out;
  }

  /** Heading when leaving the start node of an arc. */
  arcStartHeading(arc: number): number {
    return this.poseAt(arc, Math.min(8, this.arcLen(arc) / 2)).heading;
  }

  /** Heading when arriving at the end node of an arc. */
  arcEndHeading(arc: number): number {
    const len = this.arcLen(arc);
    return this.poseAt(arc, Math.max(len - 8, len / 2)).heading;
  }

  // --------------------------------------------------------------- spatial
  private cellKey(x: number, y: number): number {
    return (Math.floor(x / GRID_CELL) + 10_000) * 100_000 + (Math.floor(y / GRID_CELL) + 10_000);
  }

  private gridAdd(grid: Map<number, number[]>, x: number, y: number, v: number): void {
    this.gridAddKey(grid, this.cellKey(x, y), v);
  }

  private gridAddKey(grid: Map<number, number[]>, key: number, v: number): void {
    let list = grid.get(key);
    if (!list) grid.set(key, (list = []));
    list.push(v);
  }

  private *cellsAround(x: number, y: number, radius: number): Generator<number> {
    const r = Math.ceil(radius / GRID_CELL);
    const cx = Math.floor(x / GRID_CELL);
    const cy = Math.floor(y / GRID_CELL);
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) yield (cx + dx + 10_000) * 100_000 + (cy + dy + 10_000);
    }
  }

  /** Nearest node within maxDist metres, or -1. */
  nearestNode(x: number, y: number, maxDist = 600): number {
    let best = -1;
    let bestD = maxDist;
    for (const key of this.cellsAround(x, y, maxDist)) {
      for (const n of this.nodeGrid.get(key) ?? []) {
        const d = Math.hypot(this.nodeX[n] - x, this.nodeY[n] - y);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
    }
    return best;
  }

  /** Nearest point on any edge within maxDist metres. s is measured along the edge from node a. */
  nearestEdgePoint(x: number, y: number, maxDist = 300): { edge: number; s: number; dist: number } | null {
    let best: { edge: number; s: number; dist: number } | null = null;
    const seen = new Set<number>();
    for (const key of this.cellsAround(x, y, maxDist)) {
      for (const ei of this.edgeGrid.get(key) ?? []) {
        if (seen.has(ei)) continue;
        seen.add(ei);
        const e = this.edges[ei];
        for (let k = 1; k < e.cum.length; k++) {
          const ax = e.pts[2 * k - 2];
          const ay = e.pts[2 * k - 1];
          const bx = e.pts[2 * k];
          const by = e.pts[2 * k + 1];
          const dx = bx - ax;
          const dy = by - ay;
          const l2 = dx * dx + dy * dy || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
          const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
          if (d < (best?.dist ?? maxDist)) {
            best = { edge: ei, s: e.cum[k - 1] + t * (e.cum[k] - e.cum[k - 1]), dist: d };
          }
        }
      }
    }
    return best;
  }
}
