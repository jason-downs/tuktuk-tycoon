// Low-poly procedural model kit, built from three.js primitives with vertex
// colours. Models face +X (the sim heading 0 = east); Y is up; the origin is
// on the ground under the model's centre, so the model's left side is −Z.
//
// Two flavours:
// - build(parts): plain vertex-coloured geometry for the shared model material
//   (trees, street props).
// - buildTagged(parts): indexed geometry that also carries constant per-part
//   attributes ("tags"), read by the vehicle and people shaders in batches.ts
//   (paint slots, lamps, spinning wheels, limbs, toggled accessories).

import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Euler, Float32BufferAttribute, Matrix4 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Part = { geo: BufferGeometry; color: string };

function painted(geo: BufferGeometry, color: string): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

export function boxAt(w: number, h: number, d: number, x: number, y: number, z: number, color: string, rotY = 0): Part {
  const g = new BoxGeometry(w, h, d);
  g.applyMatrix4(new Matrix4().makeRotationY(rotY).setPosition(x, y, z));
  return { geo: g, color };
}

export function cylAt(r: number, h: number, x: number, y: number, z: number, color: string, axis: 'x' | 'y' | 'z' = 'y', seg = 8, rTop = r): Part {
  const g = new CylinderGeometry(rTop, r, h, seg);
  const m = new Matrix4();
  if (axis === 'z') m.makeRotationX(Math.PI / 2);
  if (axis === 'x') m.makeRotationZ(Math.PI / 2);
  g.applyMatrix4(m);
  g.translate(x, y, z);
  return { geo: g, color };
}

export function build(parts: Part[]): BufferGeometry {
  const merged = mergeGeometries(parts.map((p) => painted(p.geo, p.color)));
  merged.computeBoundingSphere();
  return merged;
}

// ------------------------------------------------------------ tagged parts

/** A model part with a base colour and constant per-vertex attributes (name → values). */
export interface TaggedPart {
  geo: BufferGeometry;
  color: string;
  tags: Record<string, readonly number[]>;
}

/**
 * Merge tagged parts into one indexed geometry with position, normal, linear
 * vertex colour and one attribute per tag name. Every part must carry the same
 * tag names with the same sizes.
 */
export function buildTagged(parts: TaggedPart[]): BufferGeometry {
  const geos = parts.map(({ geo, color, tags }) => {
    const g = geo.clone();
    g.deleteAttribute('uv');
    const n = g.getAttribute('position').count;
    if (!g.index) {
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new BufferAttribute(idx, 1));
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const c = new Color(color);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    for (const [name, values] of Object.entries(tags)) {
      const k = values.length;
      const arr = new Float32Array(n * k);
      for (let i = 0; i < n; i++) arr.set(values, i * k);
      g.setAttribute(name, new Float32BufferAttribute(arr, k));
    }
    return g;
  });
  const merged = mergeGeometries(geos);
  if (!merged) throw new Error('buildTagged: parts have mismatched attributes');
  merged.computeBoundingSphere();
  return merged;
}

/** Transform a geometry in place: rotation (Euler XYZ, radians) then translation. */
export function place(geo: BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): BufferGeometry {
  if (rx || ry || rz) geo.applyMatrix4(new Matrix4().makeRotationFromEuler(new Euler(rx, ry, rz)));
  geo.translate(x, y, z);
  return geo;
}

/** A box whose eight corners are placed by fn(sx, sy, sz), each s being −1 or +1 (face winding is kept). */
export function deformedBox(fn: (sx: number, sy: number, sz: number) => [number, number, number]): BufferGeometry {
  const g = new BoxGeometry(2, 2, 2);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = fn(Math.sign(pos.getX(i)), Math.sign(pos.getY(i)), Math.sign(pos.getZ(i)));
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A box tapering along X: at x0 its section spans heights ya0..yb0 and ±hw0
 * across; at x1 heights ya1..yb1 and ±hw1. Good for noses, bonnets and tubs.
 */
export function taperedBox(x0: number, x1: number, ya0: number, yb0: number, hw0: number, ya1: number, yb1: number, hw1: number): BufferGeometry {
  return deformedBox((sx, sy, sz) => {
    const front = sx > 0;
    const x = front ? x1 : x0;
    const y = sy < 0 ? (front ? ya1 : ya0) : front ? yb1 : yb0;
    return [x, y, sz * (front ? hw1 : hw0)];
  });
}

/** Triangle count of an indexed or non-indexed geometry. */
export function triangles(geo: BufferGeometry): number {
  return (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
}
