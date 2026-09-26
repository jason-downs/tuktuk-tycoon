import { describe, expect, it } from 'vitest';
import { Router } from '../src/sim/routing';
import { loadGraph } from './helpers';

const THA_PHAE_GATE = { lon: 98.9934, lat: 18.7877 };
const ONE_NIMMAN = { lon: 98.9681, lat: 18.8003 };

describe('Router on the Chiang Mai graph', () => {
  const graph = loadGraph();
  const router = new Router(graph);
  const nodeAt = (p: { lon: number; lat: number }) => {
    const [x, y] = graph.projection.toXY(p.lon, p.lat);
    return graph.nearestNode(x, y);
  };

  it('finds a connected, plausible route from Tha Phae Gate to One Nimman', () => {
    const a = nodeAt(THA_PHAE_GATE);
    const b = nodeAt(ONE_NIMMAN);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
    const t0 = performance.now();
    const route = router.route(a, b)!;
    const ms = performance.now() - t0;
    expect(route).not.toBeNull();
    for (let i = 1; i < route.arcs.length; i++) {
      expect(graph.arcFrom(route.arcs[i])).toBe(graph.arcTo(route.arcs[i - 1]));
    }
    expect(graph.arcFrom(route.arcs[0])).toBe(a);
    expect(graph.arcTo(route.arcs.at(-1)!)).toBe(b);
    // ~3 km as the crow flies; real driving distance 3–5.5 km.
    expect(route.length).toBeGreaterThan(3000);
    expect(route.length).toBeLessThan(5500);
    expect(ms).toBeLessThan(200);
  });

  it('routes from mid-arc and honours one-way streets', () => {
    const a = nodeAt(THA_PHAE_GATE);
    const b = nodeAt(ONE_NIMMAN);
    const first = router.route(a, b)!;
    const pos = { arc: first.arcs[2], s: graph.arcLen(first.arcs[2]) / 2 };
    const r = router.route(pos, a)!;
    expect(r).not.toBeNull();
    for (const arc of r.arcs) expect(graph.arcValid(arc)).toBe(true);
    expect(graph.arcTo(r.arcs.at(-1)!)).toBe(a);
  });

  it('reaches every sampled node pair (graph is strongly connected)', () => {
    let failures = 0;
    for (let i = 0; i < 40; i++) {
      const a = (i * 7919) % graph.nodeCount;
      const b = (i * 104729 + 13) % graph.nodeCount;
      if (!router.route(a, b)) failures++;
    }
    expect(failures).toBe(0);
  });
});
