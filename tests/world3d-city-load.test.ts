import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWorld, type PoiJSON } from '../src/data/world';
import type { GraphJSON } from '../src/sim/graph';
import type { CityStatus } from '../src/world3d/hud';

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T;
const world = buildWorld(read<GraphJSON>('graph.json'), read<PoiJSON[]>('pois.json'));

/** Stands in for the city-build worker: records what it was asked and lets the test answer. */
class FakeWorker {
  static made: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  posted: { url: string; anchors?: unknown } | null = null;
  constructor() {
    FakeWorker.made.push(this);
  }
  postMessage(m: { url: string; anchors?: unknown }): void {
    this.posted = m;
  }
  terminate(): void {}
}

async function freshView() {
  FakeWorker.made = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.resetModules();
  return import('../src/world3d/World3DView');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('building the 3D city', () => {
  it('starts while the title screen shows, and the 3D view picks up the same build', async () => {
    const m = await freshView();
    m.preloadCity('http://game/', '?view=map', world);
    expect(FakeWorker.made.length).toBe(0);
    m.preloadCity('http://game/', '', world);
    expect(FakeWorker.made.length).toBe(1);
    expect(FakeWorker.made[0].posted?.url).toBe('http://game/data/city3d.json');
    // The simulation's traffic-light and kerb spots go with it, for the build to settle.
    expect(FakeWorker.made[0].posted?.anchors).toBeDefined();
    const again = m.loadCityMeshes('http://game/');
    expect(FakeWorker.made.length).toBe(1);
    FakeWorker.made[0].onmessage?.({ data: { ok: true, built: { tiles: [] }, play: [0, 0, 1, 1], keep: [0, 0, 1, 1] } });
    await expect(again).resolves.toMatchObject({ play: [0, 0, 1, 1] });
  });

  it('a build that fails during the title screen is retried when the 3D view asks for it', async () => {
    const m = await freshView();
    m.preloadCity('http://game/', '', world);
    FakeWorker.made[0].onerror?.({ message: 'network down' });
    await new Promise((r) => setTimeout(r, 0));
    const retry = m.loadCityMeshes('http://game/');
    expect(FakeWorker.made.length).toBe(2);
    FakeWorker.made[1].onerror?.({ message: 'still down' });
    await expect(retry).rejects.toThrow('still down');
  });

  it('a failed build takes "Building Chiang Mai…" down and says so', async () => {
    const m = await freshView();
    const notices: string[] = [];
    const game = { notify: (text: string) => notices.push(text) } as never;
    const hud: { city: CityStatus } = { city: 'loading' };
    await m.trackCityBuild(Promise.reject(new Error('worker ran out of memory')), hud, game, () => true, () => {});
    expect(hud.city).toBe('failed');
    expect(notices[0]).toContain('worker ran out of memory');

    // So does a city that arrives but cannot be added.
    const hud2: { city: CityStatus } = { city: 'loading' };
    const built = { built: {}, play: [0, 0, 1, 1], keep: [0, 0, 1, 1] } as never;
    await m.trackCityBuild(Promise.resolve(built), hud2, game, () => true, () => {
      throw new Error('bad tile');
    });
    expect(hud2.city).toBe('failed');

    const hud3: { city: CityStatus } = { city: 'loading' };
    let added = 0;
    await m.trackCityBuild(Promise.resolve(built), hud3, game, () => true, () => added++);
    expect(hud3.city).toBe('ready');
    expect(added).toBe(1);

    // A view already gone leaves everything alone.
    const hud4: { city: CityStatus } = { city: 'loading' };
    const before = notices.length;
    await m.trackCityBuild(Promise.reject(new Error('late')), hud4, game, () => false, () => {});
    expect(hud4.city).toBe('loading');
    expect(notices.length).toBe(before);
  });
});
