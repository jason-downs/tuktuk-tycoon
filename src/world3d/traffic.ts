// Cosmetic street traffic around the camera: scooters (the bulk of Chiang Mai
// traffic, docs/3d/world.md §4.2), cars, pickups, tour vans and meter taxis
// wandering the road graph on game time. Purely visual: they are not in
// game.state, nothing in the simulation sees them, and they respawn near the
// camera as it moves. Vehicles on the same arc keep a gap (simple
// car-following). Pure: no three.js.

import { hash01 } from './build/mesh';
import type { RoadGraph } from '../sim/graph';
import type { AmbientKind } from './vehicleModels';

export type TrafficKind = Extract<AmbientKind, 'scooter' | 'scooterBox' | 'sedan' | 'pickup' | 'van' | 'taxi'>;

/** [est] Mix of the cosmetic stream: scooters dominate; songthaews and tuk-tuks come from the rivals system. */
const KIND_MIX: [TrafficKind, number][] = [
  ['scooter', 0.6],
  ['scooterBox', 0.07],
  ['sedan', 0.1],
  ['pickup', 0.12],
  ['van', 0.07],
  ['taxi', 0.04],
];

/** Traffic weight by road class (trunk … service). */
const CLASS_WEIGHT = [4, 4, 3, 2.2, 1, 0.55, 0.2, 0.15];
/** Gap kept to the vehicle ahead on the same arc (m, before scaling). */
const GAP: Record<TrafficKind, number> = { scooter: 2.6, scooterBox: 2.8, sedan: 6.5, pickup: 7, van: 7, taxi: 6.5 };
const CELL = 120;

export interface TrafficAgent {
  id: number;
  kind: TrafficKind;
  arc: number;
  /** The arc it will take next (chosen ahead so the render smoothing can look past the junction). */
  next: number;
  /** Arc it came from, or −1. */
  prev: number;
  s: number;
  /** Current and cruising speed factor. */
  v: number;
  cruise: number;
  /** Seed for paint and rider looks. */
  seed: number;
}

export interface TrafficFrame {
  /** Camera target (sim metres). */
  x: number;
  y: number;
  /** Radius (m) to keep traffic within. */
  radius: number;
  /** How many agents to aim for. */
  target: number;
  /** Game seconds to advance. */
  dt: number;
  /** Cruising speed (m/s) on an edge right now. */
  speedOf(edge: number): number;
  /** Gap multiplier (vehicles are drawn enlarged when zoomed out). */
  scale: number;
}

export class CosmeticTraffic {
  readonly agents: TrafficAgent[] = [];
  private readonly graph: RoadGraph;
  private readonly grid = new Map<number, number[]>();
  private nextId = 1;
  private n = 0;
  private readonly seed: number;

  constructor(graph: RoadGraph, seed = 1) {
    this.graph = graph;
    this.seed = seed;
    graph.edges.forEach((e, i) => {
      const seen = new Set<number>();
      for (let k = 0; k < e.pts.length / 2; k++) {
        const key = this.key(e.pts[2 * k], e.pts[2 * k + 1]);
        if (!seen.has(key)) {
          seen.add(key);
          let list = this.grid.get(key);
          if (!list) this.grid.set(key, (list = []));
          list.push(i);
        }
      }
    });
  }

  private key(x: number, y: number): number {
    return (Math.floor(x / CELL) + 10_000) * 100_000 + (Math.floor(y / CELL) + 10_000);
  }

  private rand(salt: number): number {
    return hash01(this.seed * 7919 + this.n++, salt);
  }

  update(f: TrafficFrame): void {
    const g = this.graph;
    const keep = f.radius * 1.25;
    // Drop agents that wandered out of range; trim down to the target.
    for (let i = this.agents.length - 1; i >= 0; i--) {
      const a = this.agents[i];
      const p = g.poseAt(a.arc, a.s);
      if (Math.hypot(p.x - f.x, p.y - f.y) > keep || this.agents.length > f.target + 4) this.agents.splice(i, 1);
    }
    for (let tries = 0; this.agents.length < f.target && tries < 8; tries++) this.spawn(f);
    for (const a of this.agents) this.drive(a, f);
    this.follow(f.scale);
  }

  private spawn(f: TrafficFrame): void {
    const g = this.graph;
    const ang = this.rand(1) * Math.PI * 2;
    const r = Math.sqrt(this.rand(2)) * f.radius;
    const cands = this.grid.get(this.key(f.x + Math.cos(ang) * r, f.y + Math.sin(ang) * r));
    if (!cands?.length) return;
    let total = 0;
    for (const e of cands) total += CLASS_WEIGHT[g.edges[e].cls] ?? 0.1;
    let pickW = this.rand(3) * total;
    let edge = cands[0];
    for (const e of cands) {
      pickW -= CLASS_WEIGHT[g.edges[e].cls] ?? 0.1;
      if (pickW < 0) {
        edge = e;
        break;
      }
    }
    const e = g.edges[edge];
    const arc = edge * 2 + (!e.oneway && this.rand(4) < 0.5 ? 1 : 0);
    const s = this.rand(5) * g.arcLen(arc);
    const kr = this.rand(6);
    let acc = 0;
    let kind: TrafficKind = 'scooter';
    for (const [k, w] of KIND_MIX) {
      acc += w;
      if (kr < acc) {
        kind = k;
        break;
      }
    }
    for (const o of this.agents) if (o.arc === arc && Math.abs(o.s - s) < 12 * f.scale) return;
    const cruise = (kind === 'scooter' || kind === 'scooterBox' ? 0.88 : 0.95) + this.rand(7) * 0.18;
    this.agents.push({ id: this.nextId++, kind, arc, next: this.pickNext(arc), prev: -1, s, v: cruise, cruise, seed: Math.floor(this.rand(8) * 1e9) });
  }

  /** Next arc at the end of `arc`: busier and straighter roads preferred, no U-turn unless it is a dead end. */
  private pickNext(arc: number): number {
    const g = this.graph;
    const outs = g.outgoing(g.arcTo(arc));
    if (!outs.length) return -1;
    const inH = g.arcEndHeading(arc);
    let total = 0;
    const w: number[] = [];
    for (const o of outs) {
      let wt = 0;
      if (o !== (arc ^ 1) || outs.length === 1) {
        const turn = Math.cos(g.arcStartHeading(o) - inH);
        wt = (CLASS_WEIGHT[g.edges[o >> 1].cls] ?? 0.1) * (0.2 + (1 + turn) * (1 + turn));
      }
      w.push(wt);
      total += wt;
    }
    if (total <= 0) return -1;
    let r = this.rand(9) * total;
    for (let i = 0; i < outs.length; i++) {
      r -= w[i];
      if (r < 0) return outs[i];
    }
    return outs[outs.length - 1];
  }

  private drive(a: TrafficAgent, f: TrafficFrame): void {
    const g = this.graph;
    const target = f.speedOf(a.arc >> 1) * a.cruise;
    a.v += (target - a.v) * Math.min(1, f.dt * 0.8);
    let dist = a.v * f.dt;
    for (let guard = 0; dist > 0 && guard < 16; guard++) {
      const len = g.arcLen(a.arc);
      if (a.s + dist < len) {
        a.s += dist;
        break;
      }
      dist -= len - a.s;
      if (a.next < 0) {
        // Dead end: turn round if the road allows it, else stop at the end.
        const back = a.arc ^ 1;
        if (g.arcValid(back)) {
          a.prev = -1;
          a.arc = back;
          a.s = 0;
          a.next = this.pickNext(back);
        } else {
          a.s = len;
          break;
        }
        continue;
      }
      a.prev = a.arc;
      a.arc = a.next;
      a.s = 0;
      a.next = this.pickNext(a.arc);
    }
  }

  /** Keep a gap to the vehicle ahead on the same arc. */
  private follow(scale: number): void {
    const byArc = new Map<number, TrafficAgent[]>();
    for (const a of this.agents) {
      let list = byArc.get(a.arc);
      if (!list) byArc.set(a.arc, (list = []));
      list.push(a);
    }
    for (const list of byArc.values()) {
      if (list.length < 2) continue;
      list.sort((p, q) => q.s - p.s);
      for (let i = 1; i < list.length; i++) {
        const ahead = list[i - 1];
        const me = list[i];
        const gap = GAP[me.kind] * scale;
        if (ahead.s - me.s < gap) {
          me.s = Math.max(0, ahead.s - gap);
          me.v = Math.min(me.v, ahead.v);
        }
      }
    }
  }
}

/** [est] Share of the cosmetic traffic on the road by hour: quiet small hours, busy commutes. */
export function trafficLevel(hour: number): number {
  if (hour < 5) return 0.15;
  if (hour < 7) return 0.15 + ((hour - 5) / 2) * 0.6;
  if (hour < 9.5) return 1;
  if (hour < 16) return 0.8;
  if (hour < 19.5) return 1;
  if (hour < 22) return 0.7;
  return 0.35;
}
