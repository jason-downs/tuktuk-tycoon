import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CityData } from '../src/world3d/city';
import { LAYERS, buildCity } from '../src/world3d/build/world';

const city = JSON.parse(readFileSync(new URL('../public/data/city3d.json', import.meta.url), 'utf8')) as CityData;

describe('3D city generation', () => {
  const built = buildCity(city);

  it('produces every layer with sane buffers', () => {
    for (const id of LAYERS) {
      const m = built.layers[id];
      expect(m.position.length % 3).toBe(0);
      expect(m.index.length % 3).toBe(0);
      const verts = m.position.length / 3;
      if (m.index.length === 0) continue;
      let maxIdx = 0;
      for (let i = 0; i < m.index.length; i++) maxIdx = Math.max(maxIdx, m.index[i]);
      expect(maxIdx).toBeLessThan(verts);
      let bad = 0;
      for (let i = 0; i < m.position.length; i++) if (!Number.isFinite(m.position[i])) bad++;
      expect(bad).toBe(0);
    }
    console.log(`build ${built.stats.ms.toFixed(0)} ms, buildings ${built.stats.buildings}, trees ${built.stats.trees}, triangles`, built.stats.triangles);
  });

  it('stays inside the triangle budget', () => {
    const total = Object.values(built.stats.triangles).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(3_000_000);
    expect(built.stats.buildings).toBeGreaterThan(18_000);
    expect(built.stats.trees).toBeGreaterThan(3_000);
  });

  it('is deterministic', () => {
    const again = buildCity(city);
    expect(again.layers.buildings.position.length).toBe(built.layers.buildings.position.length);
    expect(again.trees.length).toBe(built.trees.length);
  });
});
