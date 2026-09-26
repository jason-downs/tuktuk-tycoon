import { describe, expect, it } from 'vitest';
import {
  graphBounds,
  overviewFrame,
  overviewToScreen,
  radarRim,
  radarToScreen,
  screenToOverview,
  screenToRadar,
  type RadarFrame,
} from '../src/ui/minimapMath';
import { loadGraph } from './helpers';

describe('minimap projections', () => {
  it('turns the radar so the direction of travel points up', () => {
    for (const heading of [0, 0.7, Math.PI / 2, 2.5, -1.2]) {
      const f: RadarFrame = { cx: 90, cy: 90, x: 1_000, y: -400, heading, radiusM: 500, radiusPx: 88 };
      const ahead = radarToScreen(f, f.x + Math.cos(heading) * 250, f.y + Math.sin(heading) * 250);
      expect(ahead.x).toBeCloseTo(90);
      expect(ahead.y).toBeCloseTo(90 - 44);
      expect(ahead.inside).toBe(true);
      // Left of the heading is left on screen.
      const left = radarToScreen(f, f.x - Math.sin(heading) * 100, f.y + Math.cos(heading) * 100);
      expect(left.x).toBeLessThan(90);
      expect(left.y).toBeCloseTo(90);
      const far = radarToScreen(f, f.x + 600, f.y);
      expect(far.inside).toBe(false);
      const rim = radarRim(f, f.x + 600, f.y, 8);
      expect(Math.hypot(rim.x - 90, rim.y - 90)).toBeCloseTo(80);
      const back = screenToRadar(f, 120, 31);
      const again = radarToScreen(f, back.x, back.y);
      expect(again.x).toBeCloseTo(120);
      expect(again.y).toBeCloseTo(31);
    }
  });

  it('fits the whole road network north-up in the overview and maps clicks back', () => {
    const graph = loadGraph();
    const b = graphBounds(graph.nodeX, graph.nodeY);
    for (let i = 0; i < graph.nodeCount; i += 97) {
      expect(graph.nodeX[i]).toBeGreaterThan(b.minX);
      expect(graph.nodeY[i]).toBeLessThan(b.maxY);
    }
    const f = overviewFrame(b, 250, 180);
    const nw = overviewToScreen(f, b.minX, b.maxY);
    const se = overviewToScreen(f, b.maxX, b.minY);
    expect(nw.x).toBeGreaterThanOrEqual(-1e-9);
    expect(nw.y).toBeGreaterThanOrEqual(-1e-9);
    expect(se.x).toBeLessThanOrEqual(250 + 1e-9);
    expect(se.y).toBeLessThanOrEqual(180 + 1e-9);
    // Letterboxed: one axis fills the box.
    expect(Math.max(se.x - nw.x - 250, se.y - nw.y - 180)).toBeCloseTo(0);
    // North is up, east is right.
    expect(overviewToScreen(f, 0, 1000).y).toBeLessThan(overviewToScreen(f, 0, 0).y);
    expect(overviewToScreen(f, 1000, 0).x).toBeGreaterThan(overviewToScreen(f, 0, 0).x);
    const p = screenToOverview(f, 77, 133);
    const q = overviewToScreen(f, p.x, p.y);
    expect(q.x).toBeCloseTo(77);
    expect(q.y).toBeCloseTo(133);
  });
});
