import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CityData } from '../src/world3d/city';
import { clipMeshToTiles, splitMesh, type PackedMesh } from '../src/world3d/build/mesh';
import { LAYERS, TILE_SIZE, buildCity, tileCity } from '../src/world3d/build/world';
import { PAVEMENT_Y, ROAD_SURFACE_Y } from '../src/world3d/kinematics';

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

  it('paints the roads at the height vehicles drive and people stand on', () => {
    const pos = built.layers.roads.position;
    let off = 0;
    for (let i = 1; i < pos.length; i += 3) if (Math.abs(pos[i] - ROAD_SURFACE_Y) > 1e-4) off++;
    expect(pos.length).toBeGreaterThan(0);
    expect(off).toBe(0);
    expect(PAVEMENT_Y).toBe(ROAD_SURFACE_Y);
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
      if (id === 'roads') continue;
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

  it('cuts the painter-ordered roads layer at tile edges: no tile reaches into another, and no area is lost', () => {
    const pieces = tileCity(built).layers.roads;
    const eps = 1e-3;
    let area = 0;
    for (const p of pieces) {
      // The tile a piece covers, from its first triangle's centroid.
      const c = (axis: number) => (p.position[p.index[0] * 3 + axis] + p.position[p.index[1] * 3 + axis] + p.position[p.index[2] * 3 + axis]) / 3;
      const tx = Math.floor(c(0) / TILE_SIZE);
      const tz = Math.floor(c(2) / TILE_SIZE);
      for (let i = 0; i < p.position.length; i += 3) {
        expect(p.position[i]).toBeGreaterThanOrEqual(tx * TILE_SIZE - eps);
        expect(p.position[i]).toBeLessThanOrEqual((tx + 1) * TILE_SIZE + eps);
        expect(p.position[i + 2]).toBeGreaterThanOrEqual(tz * TILE_SIZE - eps);
        expect(p.position[i + 2]).toBeLessThanOrEqual((tz + 1) * TILE_SIZE + eps);
      }
      area += groundArea(p);
    }
    expect(area).toBeCloseTo(groundArea(built.layers.roads), -1);
  });

  it('keeps each clipped tile in the source draw order', () => {
    // Two overlapping quads straddling a tile edge: the later one must still come later on both sides.
    const quad = (y: number, c: number) => ({ p: [-10, y, 5, 10, y, 5, 10, y, 15, -10, y, 15], c });
    const q = [quad(0, 1), quad(0, 2)];
    const m: PackedMesh = {
      position: new Float32Array(q.flatMap((x) => x.p)),
      normal: new Float32Array(24).map((_, i) => (i % 3 === 1 ? 1 : 0)),
      color: new Uint8Array(q.flatMap((x) => Array(12).fill(x.c))),
      index: new Uint32Array([0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6]),
    };
    const pieces = clipMeshToTiles(m, 100);
    expect(pieces.length).toBe(2);
    for (const p of pieces) {
      const firstColour = p.color[p.index[0] * 3];
      const lastColour = p.color[p.index[p.index.length - 1] * 3];
      expect([firstColour, lastColour]).toEqual([1, 2]);
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

interface MeshLike {
  position: Float32Array;
  color: Uint8Array;
  index: ArrayLike<number>;
}

/** Area of the mesh's triangles projected onto the ground (m²). */
function groundArea(m: MeshLike): number {
  let a = 0;
  const P = m.position;
  for (let t = 0; t < m.index.length; t += 3) {
    const [i, j, k] = [m.index[t] * 3, m.index[t + 1] * 3, m.index[t + 2] * 3];
    a += Math.abs((P[j] - P[i]) * (P[k + 2] - P[i + 2]) - (P[k] - P[i]) * (P[j + 2] - P[i + 2])) / 2;
  }
  return a;
}

/** Every triangle of the meshes as a sorted list of vertex-position keys (order-free). */
function triangleSet(meshes: MeshLike[]): string[] {
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
