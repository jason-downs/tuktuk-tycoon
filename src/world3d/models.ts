// Low-poly procedural models for moving things and trees, built from three.js
// primitives with vertex colours. Models face +X (the sim heading 0 = east);
// Y is up; the origin is on the ground under the model's centre.

import { BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, Matrix4, SphereGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ARCHETYPES } from '../content/archetypes';
import { PAINTS } from '../content/paints';
import type { Archetype } from '../sim/types';

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

const wheel = (x: number, z: number, r = 0.25, rim = '#c0392b'): Part[] => [
  cylAt(r, 0.18, x, r, z, '#1b1b1b', 'z', 10),
  cylAt(r * 0.55, 0.2, x, r, z, rim, 'z', 8),
];

const tuktukCache = new Map<string, BufferGeometry>();

/** Chiang Mai tuk-tuk (3.2 × 1.4 × 2 m) in a livery from src/content/paints.ts. */
export function tuktukGeometry(paintId: string): BufferGeometry {
  const hit = tuktukCache.get(paintId);
  if (hit) return hit;
  const p = PAINTS[paintId] ?? PAINTS.nakhon_blue;
  const parts: Part[] = [
    // Floor pan and rear passenger tub.
    boxAt(2.3, 0.22, 1.3, -0.25, 0.42, 0, p.body),
    boxAt(1.55, 0.55, 1.42, -0.62, 0.78, 0, p.body),
    boxAt(1.56, 0.06, 1.44, -0.62, 0.92, 0, p.trim),
    // Bench and back rest.
    boxAt(0.55, 0.14, 1.22, -0.72, 0.98, 0, '#7a1c1c'),
    boxAt(0.12, 0.45, 1.22, -1.28, 1.25, 0, '#7a1c1c'),
    // Driver's section and nose over the single front wheel.
    boxAt(0.55, 0.3, 0.8, 0.45, 0.72, 0, p.body),
    boxAt(0.4, 0.14, 0.55, 0.45, 0.95, 0, '#2a2a2a'),
    boxAt(0.8, 0.55, 0.62, 1.05, 0.72, 0, p.body),
    boxAt(0.35, 0.42, 0.5, 1.5, 0.66, 0, p.body),
    boxAt(0.81, 0.05, 0.64, 1.05, 0.92, 0, p.trim),
    // Windscreen and headlight.
    boxAt(0.05, 0.62, 1.12, 0.78, 1.42, 0, '#a9d4ec'),
    cylAt(0.09, 0.08, 1.7, 0.82, 0, '#fdf2c0', 'x', 8),
    // Canopy on four posts, with the lit roof sign.
    boxAt(2.65, 0.1, 1.52, -0.18, 1.86, 0, p.canopy),
    boxAt(2.4, 0.08, 1.4, -0.22, 1.93, 0, p.canopy),
    boxAt(2.66, 0.05, 1.53, -0.18, 1.79, 0, p.trim),
    cylAt(0.03, 0.95, 0.72, 1.32, 0.66, '#d0d0d0'),
    cylAt(0.03, 0.95, 0.72, 1.32, -0.66, '#d0d0d0'),
    cylAt(0.03, 0.95, -1.35, 1.32, 0.68, '#d0d0d0'),
    cylAt(0.03, 0.95, -1.35, 1.32, -0.68, '#d0d0d0'),
    boxAt(0.34, 0.18, 0.22, 0.75, 2.05, 0, '#f4d03f'),
    // Chrome side rails.
    boxAt(1.4, 0.04, 0.04, -0.6, 1.2, 0.72, '#d9d9d9'),
    boxAt(1.4, 0.04, 0.04, -0.6, 1.2, -0.72, '#d9d9d9'),
    ...wheel(1.3, 0),
    ...wheel(-0.85, 0.66),
    ...wheel(-0.85, -0.66),
  ];
  const geo = build(parts);
  tuktukCache.set(paintId, geo);
  return geo;
}

let songthaewGeo: BufferGeometry | null = null;

/** Red songthaew (rot daeng): pickup with a covered, bench-lined bed. */
export function songthaewGeometry(): BufferGeometry {
  if (songthaewGeo) return songthaewGeo;
  const red = '#c8312b';
  songthaewGeo = build([
    boxAt(1.5, 1.0, 1.75, 1.85, 1.0, 0, red),
    boxAt(1.2, 0.55, 1.65, 1.7, 1.75, 0, red),
    boxAt(0.05, 0.5, 1.5, 2.32, 1.72, 0, '#a9d4ec'),
    boxAt(3.4, 0.6, 1.8, -0.6, 0.85, 0, red),
    boxAt(3.6, 0.1, 1.95, -0.6, 2.35, 0, red),
    boxAt(3.4, 0.05, 1.95, -0.6, 2.42, 0, '#f4efe6'),
    cylAt(0.04, 1.2, -2.25, 1.75, 0.9, '#d0d0d0'),
    cylAt(0.04, 1.2, -2.25, 1.75, -0.9, '#d0d0d0'),
    cylAt(0.04, 1.2, 0.9, 1.75, 0.9, '#d0d0d0'),
    cylAt(0.04, 1.2, 0.9, 1.75, -0.9, '#d0d0d0'),
    boxAt(3.2, 0.1, 0.35, -0.6, 1.2, 0.7, '#6b3a2a'),
    boxAt(3.2, 0.1, 0.35, -0.6, 1.2, -0.7, '#6b3a2a'),
    ...wheel(1.7, 0.85, 0.36, '#bbbbbb'),
    ...wheel(1.7, -0.85, 0.36, '#bbbbbb'),
    ...wheel(-1.4, 0.85, 0.36, '#bbbbbb'),
    ...wheel(-1.4, -0.85, 0.36, '#bbbbbb'),
  ]);
  return songthaewGeo;
}

const CAR_COLOURS = ['#f3f3f1', '#c9ccd0', '#2b2d31', '#8a8f96', '#7a1f1f', '#e8e4da'];
const carCache = new Map<number, BufferGeometry>();

/** Pickup or sedan in a common Thai colour, chosen by variant. */
export function carGeometry(variant: number): BufferGeometry {
  const v = variant % CAR_COLOURS.length;
  const hit = carCache.get(v);
  if (hit) return hit;
  const c = CAR_COLOURS[v];
  const pickup = variant % 2 === 0;
  const parts: Part[] = pickup
    ? [
        boxAt(4.9, 0.75, 1.8, 0, 0.75, 0, c),
        boxAt(2.0, 0.65, 1.7, 0.6, 1.45, 0, c),
        boxAt(1.9, 0.5, 1.72, 0.6, 1.45, 0, '#34495e'),
        boxAt(2.1, 0.3, 1.75, -1.35, 1.25, 0, c),
      ]
    : [boxAt(4.5, 0.7, 1.75, 0, 0.7, 0, c), boxAt(2.3, 0.6, 1.62, -0.2, 1.33, 0, c), boxAt(2.2, 0.48, 1.64, -0.2, 1.33, 0, '#34495e')];
  parts.push(...wheel(1.45, 0.82, 0.33, '#9aa0a6'), ...wheel(1.45, -0.82, 0.33, '#9aa0a6'), ...wheel(-1.45, 0.82, 0.33, '#9aa0a6'), ...wheel(-1.45, -0.82, 0.33, '#9aa0a6'));
  const geo = build(parts);
  carCache.set(v, geo);
  return geo;
}

const bikeCache = new Map<number, BufferGeometry>();
const BIKE_COLOURS = ['#c0392b', '#2c3e50', '#ecf0f1', '#27ae60', '#e67e22', '#8e44ad'];
const SHIRTS = ['#f1c40f', '#3498db', '#ecf0f1', '#e74c3c', '#1abc9c', '#34495e'];

/** Scooter with a rider (the most common vehicle in Chiang Mai). */
export function motorbikeGeometry(variant: number): BufferGeometry {
  const v = variant % 12;
  const hit = bikeCache.get(v);
  if (hit) return hit;
  const body = BIKE_COLOURS[v % BIKE_COLOURS.length];
  const geo = build([
    boxAt(1.2, 0.35, 0.38, 0, 0.55, 0, body),
    boxAt(0.35, 0.55, 0.3, 0.55, 0.8, 0, body),
    boxAt(0.55, 0.12, 0.32, -0.2, 0.8, 0, '#222'),
    ...wheel(0.62, 0, 0.26, '#777'),
    ...wheel(-0.6, 0, 0.26, '#777'),
    // Rider: legs, torso, helmet.
    boxAt(0.45, 0.35, 0.36, -0.1, 1.0, 0, '#2d3436'),
    boxAt(0.32, 0.55, 0.4, -0.12, 1.42, 0, SHIRTS[v % SHIRTS.length]),
    { geo: new SphereGeometry(0.15, 8, 6).translate(-0.08, 1.85, 0), color: v % 3 === 0 ? '#f5f5f5' : '#1e1e1e' },
  ]);
  bikeCache.set(v, geo);
  return geo;
}

const personCache = new Map<string, BufferGeometry>();
const SKINS = ['#8d5a3b', '#a8714e', '#c68a62', '#d9a57c', '#f0cfb0'];

/**
 * A standing person (≈1.65 m) dressed for an archetype, without the right arm
 * (drawn separately so it can wave).
 */
export function personGeometry(arch: Archetype, variant: number): BufferGeometry {
  const key = `${arch}:${variant % 5}`;
  const hit = personCache.get(key);
  if (hit) return hit;
  const info = ARCHETYPES[arch];
  const skin = SKINS[variant % SKINS.length];
  const monk = arch === 'monk';
  const top = monk ? '#e8871e' : info.color;
  const legs = monk ? '#e8871e' : arch === 'student' ? '#1e1e1e' : arch === 'elder' ? '#5b3b6b' : '#34495e';
  const parts: Part[] = [
    boxAt(0.3, 0.82, 0.26, 0, 0.41, 0, legs),
    boxAt(0.44, 0.58, 0.28, 0, 1.11, 0, top),
    boxAt(0.1, 0.5, 0.1, 0, 1.12, -0.27, top),
    { geo: new SphereGeometry(0.13, 10, 8).translate(0, 1.55, 0), color: monk ? '#d9a57c' : skin },
  ];
  if (arch === 'backpacker') parts.push(boxAt(0.3, 0.7, 0.34, -0.3, 1.25, 0, '#e0892b'));
  if (arch === 'vendor') parts.push({ geo: new ConeGeometry(0.34, 0.16, 10).translate(0, 1.72, 0), color: '#d9b36b' });
  if (arch === 'tourist_kr' || arch === 'tourist_west' || arch === 'retiree') parts.push(cylAt(0.2, 0.08, 0, 1.68, 0, arch === 'retiree' ? '#e6d8b8' : '#f5f0e6', 'y', 10, 0.14));
  if (arch === 'business') parts.push(boxAt(0.4, 0.45, 0.25, 0.1, 0.25, 0.35, '#2c3e50'));
  const geo = build(parts);
  personCache.set(key, geo);
  return geo;
}

let armGeo: BufferGeometry | null = null;

/** The right arm, pivoting at the shoulder (origin), hanging along −Y. */
export function armGeometry(): BufferGeometry {
  if (!armGeo) armGeo = build([boxAt(0.1, 0.5, 0.1, 0, -0.25, 0, '#ffffff')]);
  return armGeo;
}
