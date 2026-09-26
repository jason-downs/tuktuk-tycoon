import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CityData } from '../src/world3d/city';
import { splitMesh, type PackedMesh } from '../src/world3d/build/mesh';
import { LAYERS, TILE_SIZE, buildCity, tileCity } from '../src/world3d/build/world';

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

  it('splits the static layers into tiles without losing or moving a triangle', () => {
    const tiled = tileCity(built);
    for (const id of LAYERS) {
      const whole = built.layers[id];
      const pieces = tiled.layers[id];
      if (id === 'ground' || id === 'backdrop') {
        expect(pieces.length).toBe(whole.index.length ? 1 : 0);
        continue;
      }
      expect(pieces.reduce((n, p) => n + p.index.length, 0)).toBe(whole.index.length);
      expect(triangleSet(pieces)).toEqual(triangleSet([whole]));
      for (const p of pieces) {
        // Every triangle of a piece has its centroid in the same tile.
        const tiles = new Set<string>();
        for (let t = 0; t < p.index.length; t += 3) {
          let cx = 0;
          let cz = 0;
          for (let k = 0; k < 3; k++) {
            cx += p.position[p.index[t + k] * 3] / 3;
            cz += p.position[p.index[t + k] * 3 + 2] / 3;
          }
          tiles.add(`${Math.floor(cx / TILE_SIZE)},${Math.floor(cz / TILE_SIZE)}`);
        }
        expect(tiles.size).toBe(1);
      }
    }
  });

  it('keeps only the vertices each tile uses', () => {
    const quad: PackedMesh = {
      position: new Float32Array([0, 0, 0, 10, 0, 0, 0, 0, 10, 1000, 0, 0, 1010, 0, 0, 1000, 0, 10]),
      normal: new Float32Array(18).fill(0),
      color: new Uint8Array([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6]),
      index: new Uint32Array([3, 4, 5, 0, 1, 2]),
    };
    const pieces = splitMesh(quad, 500);
    expect(pieces.map((p) => [...p.index])).toEqual([
      [0, 1, 2],
      [0, 1, 2],
    ]);
    expect([...pieces[0].color]).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
    expect([...pieces[1].position.slice(0, 3)]).toEqual([1000, 0, 0]);
  });
});

/** Every triangle of the meshes as a sorted list of vertex-position keys (order-free). */
function triangleSet(meshes: PackedMesh[]): string[] {
  const out: string[] = [];
  for (const m of meshes) {
    for (let t = 0; t < m.index.length; t += 3) {
      const v: string[] = [];
      for (let k = 0; k < 3; k++) {
        const i = m.index[t + k] * 3;
        v.push(`${m.position[i]},${m.position[i + 1]},${m.position[i + 2]},${m.color[i]},${m.color[i + 1]},${m.color[i + 2]}`);
      }
      out.push(v.join('|'));
    }
  }
  return out.sort();
}
