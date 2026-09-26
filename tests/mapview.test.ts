// MapView's DOM lifecycle with MapLibre and the browser canvas stubbed out:
// the city-map planner builds a MapView in the same host element on every
// open and destroys it on close, so destroy() must leave the host as it found it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../src/sim/game';
import { buildWorld, type PoiJSON } from '../src/data/world';
import type { GraphJSON } from '../src/sim/graph';
import { readFileSync } from 'node:fs';

/** A minimal element: children, remove(), and a fixed size. */
class FakeElement {
  className = '';
  style: Record<string, string> = {};
  width = 0;
  height = 0;
  parent: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  appendChild(c: FakeElement): FakeElement {
    c.remove();
    c.parent = this;
    this.children.push(c);
    return c;
  }
  remove(): void {
    if (!this.parent) return;
    const list = this.parent.children;
    list.splice(list.indexOf(this), 1);
    this.parent = null;
  }
  getContext(): object {
    return {};
  }
  getBoundingClientRect() {
    return { width: 800, height: 600 };
  }
}

vi.mock('maplibre-gl', () => {
  /** Stands in for MapLibre: adds and removes its own canvas container, as Map.remove() does. */
  class Map {
    readonly touchZoomRotate = { disableRotation() {} };
    readonly keyboard = { disable() {} };
    private readonly container: FakeElement;
    private readonly own = new FakeElement();
    constructor(opts: { container: FakeElement }) {
      this.container = opts.container;
      this.own.className = 'maplibregl-canvas-container';
      this.container.appendChild(this.own);
    }
    on() {}
    getContainer() {
      return this.container;
    }
    remove() {
      this.own.remove();
    }
  }
  return { Map, setWorkerUrl() {} };
});
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: 'worker.js' }));

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;

afterEach(() => vi.unstubAllGlobals());

describe('MapView', () => {
  it('leaves nothing behind in its container when destroyed, however often the planner reopens', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() });
    vi.stubGlobal('window', { devicePixelRatio: 2 });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const { MapView } = await import('../src/map/MapView');
    const game = Game.create(buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json')), { seed: 3 });
    const host = new FakeElement();
    for (let open = 0; open < 3; open++) {
      const view = new MapView(host as unknown as HTMLElement, game, { base: 'http://localhost/' });
      expect(host.children.filter((c) => c.className === 'map-overlay')).toHaveLength(1);
      view.destroy();
      expect(host.children).toHaveLength(0);
    }
  });
});
