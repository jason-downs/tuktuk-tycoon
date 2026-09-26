// Procedural vehicles: the Chiang Mai tuk-tuk in its model variants and
// livery extras, upgrade accessories, and the ambient traffic (red songthaew,
// scooters, sedans, pickups, tour vans, meter taxis). Each geometry carries
// the aVeh attribute read by the vehicle shader (batches.ts):
//   x paint slot (SLOT: fixed colour, or the instance's body / canopy / trim paint)
//   y lamp kind (EMIT: headlamp, tail/brake lamp, lit sign, LED/lantern glow)
//   z, w wheel centre (x, height) for parts that spin with the wheel; w = 0 elsewhere.
// Painted parts use white as their base colour; the shader multiplies in the
// livery. Models face +X, left side −Z, origin on the ground under the centre.
// Dimensions follow docs/3d/world.md §4.1–4.2 (tuk-tuk 3.2 × 1.4 × 1.85 m,
// the 2017 cap being 4 × 1.5 × 2 m).

import { BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, Float32BufferAttribute, OctahedronGeometry, TorusGeometry } from 'three';
import { hash01 } from './build/mesh';
import { buildTagged, deformedBox, place, taperedBox, type TaggedPart } from './models';

/** Paint slots: which instance colour a part takes. */
export const SLOT = { fixed: 0, body: 1, canopy: 2, trim: 3 } as const;
/** Lamp kinds: what drives a part's glow. */
export const EMIT = { none: 0, head: 1, tail: 2, sign: 3, led: 4 } as const;

type V3 = [number, number, number];

interface PartOpts {
  slot?: number;
  emit?: number;
  wheel?: [number, number];
}

const PAINT = '#ffffff';
const CHROME = '#d4d7da';
const TYRE = '#1c1c1c';
const DARK = '#2b2b2b';
const GLASS = '#9fc9dc';
const TINT = '#2f3d45';
const VINYL = '#a31d1d';
const VINYL_DARK = '#6b1414';
const PLATE = '#f2cf1d';
const PLATE_TEXT = '#1d6b3a';
const LAMP = '#fff1c4';
const TAIL = '#e0241b';
const AMBER = '#f39c12';
const SIGN = '#f4d03f';

/** Collects tagged parts for one model. */
class Kit {
  readonly parts: TaggedPart[] = [];

  add(geo: BufferGeometry, color: string, o: PartOpts = {}): void {
    this.parts.push({ geo, color, tags: { aVeh: [o.slot ?? SLOT.fixed, o.emit ?? EMIT.none, o.wheel?.[0] ?? 0, o.wheel?.[1] ?? 0] } });
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, color: string, o?: PartOpts, rx = 0, ry = 0, rz = 0): void {
    this.add(place(new BoxGeometry(w, h, d), x, y, z, rx, ry, rz), color, o);
  }

  /** Cylinder of radius r and length len along an axis, centred at (x, y, z). */
  cyl(r: number, len: number, x: number, y: number, z: number, color: string, axis: 'x' | 'y' | 'z', seg: number, o?: PartOpts, rEnd = r): void {
    const g = new CylinderGeometry(rEnd, r, len, seg);
    if (axis === 'x') g.rotateZ(-Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    this.add(g, color, o);
  }

  geometry(): BufferGeometry {
    return buildTagged(this.parts);
  }
}

/** A wheel whose tyre, rim, hub and spokes spin together about the axle at (x, r) along Z. */
function wheel(k: Kit, x: number, z: number, r: number, w: number, rim: string, detailed: boolean): void {
  const o: PartOpts = { wheel: [x, r] };
  k.cyl(r, w, x, r, z, TYRE, 'z', 10, o);
  k.cyl(r * 0.62, w + 0.012, x, r, z, rim, 'z', 8, o);
  if (detailed) {
    k.cyl(r * 0.2, w + 0.03, x, r, z, CHROME, 'z', 6, o);
    k.box(r * 1.12, r * 0.14, w + 0.022, x, r, z, CHROME, o);
    k.box(r * 0.14, r * 1.12, w + 0.022, x, r, z, CHROME, o);
  }
}

// ------------------------------------------------------------------ tuk-tuk

/** Body variants, from the vehicle model (src/content/vehicles.ts). */
export type TukKind = 'lpg' | 'rusty' | 'ev' | 'ev7';
export const TUK_KINDS: readonly TukKind[] = ['lpg', 'rusty', 'ev', 'ev7'];

/** Livery-specific decoration (src/content/paints.ts ids). */
export type TukExtra = 'none' | 'lanterns' | 'parasol' | 'horns' | 'ledStrips' | 'split';
export const TUK_EXTRAS: readonly TukExtra[] = ['none', 'lanterns', 'parasol', 'horns', 'ledStrips', 'split'];

export const LIVERY_EXTRA: Record<string, TukExtra> = {
  tung_lanna: 'lanterns',
  bo_sang: 'parasol',
  kalae_teak: 'horns',
  khom_loi: 'ledStrips',
  coop_taxi: 'split',
};

export function tukKindOf(modelId: string, powertrain?: string): TukKind {
  if (modelId === 'rusty') return 'rusty';
  if (modelId === 'ev_7seat') return 'ev7';
  return powertrain === 'ev' || modelId.startsWith('ev') ? 'ev' : 'lpg';
}

export const TUK_WHEEL_R = 0.26;

interface TukDims {
  /** Extra length of the passenger section (the 7-seater). */
  ext: number;
  /** Back of the tub. */
  rear: number;
  rearAxle: number;
  /** Bench seat spans [x0 (back), x1 (front)]. */
  benches: [number, number][];
  canopyRear: number;
}

function tukDims(kind: TukKind): TukDims {
  const ext = kind === 'ev7' ? 0.8 : 0;
  return {
    ext,
    rear: -1.52 - ext,
    rearAxle: -0.8 - ext * 0.9,
    benches: kind === 'ev7' ? [[-2.28, -1.66], [-1.2, -0.58]] : [[-1.48, -0.62]],
    canopyRear: -1.6 - ext,
  };
}

/** Seat heights and positions (model units) for figures riding in a tuk-tuk. */
export interface SeatLayout {
  /** Driver's hip point: x, seat-top height, z. */
  driver: V3;
  /** Passenger hip points, front row first; three across each bench, left to right. */
  seats: V3[];
}

const seatCache = new Map<TukKind, SeatLayout>();

export function tukSeats(kind: TukKind): SeatLayout {
  let hit = seatCache.get(kind);
  if (!hit) {
    const d = tukDims(kind);
    const seats: V3[] = [];
    for (const [x0] of [...d.benches].reverse()) for (const z of [-0.4, 0, 0.4]) seats.push([x0 + 0.3, 0.88, z]);
    hit = { driver: [0.1, 0.82, 0], seats };
    seatCache.set(kind, hit);
  }
  return hit;
}

const B: PartOpts = { slot: SLOT.body };
const C: PartOpts = { slot: SLOT.canopy };
const T: PartOpts = { slot: SLOT.trim };

/** The canopy: a shallow arch across the width, lofted through stations along the length. */
function canopy(k: Kit, stations: { x: number; y: number; hw: number }[], rise: number, thick: number, o: PartOpts): void {
  const segs = 3;
  for (let i = 0; i + 1 < stations.length; i++) {
    const front = stations[i];
    const back = stations[i + 1];
    for (let j = 0; j < segs; j++) {
      const u0 = -1 + (2 * j) / segs;
      const u1 = -1 + (2 * (j + 1)) / segs;
      k.add(
        deformedBox((sx, sy, sz) => {
          const st = sx > 0 ? front : back;
          const u = sz > 0 ? u1 : u0;
          const top = st.y - rise * u * u;
          return [st.x, sy > 0 ? top : top - thick, u * st.hw];
        }),
        PAINT,
        o,
      );
    }
  }
}

function tuktukParts(kind: TukKind, extra: TukExtra): Kit {
  const k = new Kit();
  const d = tukDims(kind);
  const ev = kind === 'ev' || kind === 'ev7';
  const rusty = kind === 'rusty';

  // Chassis, bench blocks and the passenger tub.
  k.box(1.05 - d.rear, 0.1, 1.16, (1.05 + d.rear) / 2, 0.39, 0, '#3a3a3a');
  for (const [x0, x1] of d.benches) k.box(x1 - x0, 0.34, 1.28, (x0 + x1) / 2, 0.61, 0, '#3a2c2c');
  const tubLen = -0.18 - d.rear;
  const tubX = (-0.18 + d.rear) / 2;
  for (const side of [-1, 1]) {
    k.box(tubLen, 0.56, 0.05, tubX, 0.72, side * 0.655, PAINT, B);
    k.cyl(0.032, tubLen, tubX, 1.0, side * 0.655, PAINT, 'x', 4, T);
    k.box(tubLen - 0.1, 0.035, 0.012, tubX, 0.8, side * 0.682, PAINT, T);
  }
  k.box(0.05, 0.62, 1.3, d.rear, 0.75, 0, PAINT, B);
  k.cyl(0.032, 1.3, d.rear, 1.04, 0, PAINT, 'z', 4, T);
  k.box(0.012, 0.035, 1.2, d.rear - 0.03, 0.8, 0, PAINT, T);

  // Benches: red vinyl cushion, raked backrest and a rolled top.
  for (const [x0, x1] of d.benches) {
    k.box(x1 - x0 - 0.06, 0.1, 1.22, (x0 + x1) / 2 + 0.03, 0.83, 0, VINYL);
    k.box(0.1, 0.46, 1.22, x0 + 0.06, 1.1, 0, VINYL, undefined, 0, 0, 0.12);
    k.cyl(0.05, 1.22, x0 + 0.03, 1.33, 0, VINYL_DARK, 'z', 4);
  }

  // Driver's section: low side panels, engine cover, seat.
  for (const side of [-1, 1]) k.box(0.8, 0.36, 0.04, 0.22, 0.62, side * 0.5, PAINT, B);
  k.box(0.5, 0.3, 0.56, 0.16, 0.59, 0, '#4a4a4a');
  k.box(0.46, 0.08, 0.52, 0.12, 0.78, 0, TYRE);
  k.box(0.06, 0.3, 0.46, -0.12, 0.95, 0, TYRE);

  // Nose over the single front wheel.
  if (ev) {
    k.add(taperedBox(0.6, 1.38, 0.44, 1.0, 0.5, 0.52, 0.92, 0.3), PAINT, B);
    const cap = new CylinderGeometry(0.3, 0.3, 0.4, 10, 1, false, 0, Math.PI);
    cap.scale(0.55, 1, 1);
    k.add(place(cap, 1.38, 0.72, 0), PAINT, B);
    k.box(0.03, 0.05, 0.36, 1.545, 0.8, 0, LAMP, { emit: EMIT.head });
    for (const side of [-1, 1]) k.box(0.1, 0.06, 0.012, 1.02, 0.78, side * 0.415, '#27ae60');
    k.box(0.012, 0.06, 0.12, d.rear - 0.034, 0.62, 0.35, '#27ae60');
  } else {
    k.add(taperedBox(0.6, 1.55, 0.44, 1.02, 0.5, 0.56, 0.9, 0.2), PAINT, B);
    k.box(0.9, 0.012, 0.07, 1.08, 0.965, 0, PAINT, T, 0, 0, -0.126);
    k.cyl(0.1, 0.14, 1.45, 0.98, 0, CHROME, 'x', 8);
    k.cyl(0.085, 0.02, 1.525, 0.98, 0, LAMP, 'x', 8, { emit: EMIT.head });
    k.box(0.06, 0.1, 0.4, 1.56, 0.62, 0, CHROME);
    k.cyl(0.03, 0.36, d.rear + 0.05, 0.3, 0.45, CHROME, 'x', 4);
  }
  for (const side of [-1, 1]) k.box(0.03, 0.05, 0.06, ev ? 1.36 : 1.47, 0.84, side * (ev ? 0.3 : 0.22), AMBER);
  k.box(0.02, 0.1, 0.24, ev ? 1.56 : 1.575, 0.68, 0, PLATE);
  k.box(0.022, 0.035, 0.18, ev ? 1.561 : 1.576, 0.68, 0, PLATE_TEXT);

  // Wheels, fork, mudflaps.
  wheel(k, 1.22, 0, TUK_WHEEL_R, 0.15, '#c0392b', true);
  for (const side of [-1, 1]) {
    wheel(k, d.rearAxle, side * 0.6, TUK_WHEEL_R, 0.15, '#c0392b', true);
    k.box(0.02, 0.2, 0.16, d.rearAxle - 0.32, 0.22, side * 0.6, TYRE);
    k.box(0.05, 0.42, 0.04, 1.22, 0.45, side * 0.1, CHROME);
  }

  // Handlebars, dash, windscreen with chrome frame, visor.
  k.cyl(0.018, 0.86, 0.62, 1.1, 0, CHROME, 'z', 4);
  for (const side of [-1, 1]) k.box(0.05, 0.05, 0.12, 0.62, 1.1, side * 0.42, TYRE);
  k.box(0.14, 0.08, 0.9, 0.7, 1.02, 0, DARK);
  k.add(
    deformedBox((sx, sy, sz) => [(sy > 0 ? 0.72 : 0.84) + sx * 0.01, sy > 0 ? 1.62 : 1.04, sz * 0.5]),
    GLASS,
  );
  for (const side of [-1, 1]) k.box(0.03, 0.62, 0.03, 0.78, 1.32, side * 0.515, CHROME, undefined, 0, 0, 0.197);
  k.cyl(0.02, 1.06, 0.72, 1.635, 0, CHROME, 'z', 4);
  k.box(0.2, 0.035, 1.24, 0.8, 1.68, 0, PAINT, C, 0, 0, -0.25);

  // Mirrors (the rusty one has lost its left mirror).
  for (const side of rusty ? [1] : [-1, 1]) {
    k.box(0.02, 0.22, 0.02, 0.6, 1.2, side * 0.46, CHROME, undefined, side * -0.35);
    k.box(0.03, 0.1, 0.15, 0.6, 1.32, side * 0.52, DARK);
  }

  // Canopy on posts, rear wall with a small window, TAXI roof box.
  const cr = d.canopyRear;
  canopy(
    k,
    [
      { x: 0.92, y: 1.74, hw: 0.64 },
      { x: 0.62, y: 1.84, hw: 0.72 },
      { x: cr + 0.28, y: 1.86, hw: 0.72 },
      { x: cr, y: 1.77, hw: 0.72 },
    ],
    0.1,
    0.05,
    C,
  );
  for (const side of [-1, 1]) {
    k.box(0.62 - cr, 0.06, 0.02, (0.62 + cr) / 2, 1.69, side * 0.725, PAINT, T);
    k.cyl(0.022, 0.96, -0.2, 1.28, side * 0.6, CHROME, 'y', 4);
    k.cyl(0.022, 0.78, d.rear + 0.07, 1.39, side * 0.64, CHROME, 'y', 4);
    if (kind === 'ev7') k.cyl(0.022, 0.78, -1.42, 1.39, side * 0.66, CHROME, 'y', 4);
    k.cyl(0.02, -0.28 - d.rear, (d.rear - 0.18) / 2, 1.18, side * 0.68, CHROME, 'x', 4);
    k.box(0.6 - cr - 0.3, 0.06, 0.06, (0.6 + cr + 0.3) / 2, 1.64, side * 0.7, '#dfe6e8');
    k.box(0.03, 0.08, 0.1, d.rear - 0.02, 0.9, side * 0.55, TAIL, { emit: EMIT.tail });
    const hoop = new TorusGeometry(0.14, 0.016, 3, 4, Math.PI);
    hoop.rotateY(Math.PI / 2);
    k.add(place(hoop, d.rear - 0.04, 1.02, side * 0.47), CHROME);
  }
  k.box(0.04, 0.8, 1.36, cr + 0.03, 1.38, 0, PAINT, C);
  k.box(0.02, 0.22, 0.6, cr + 0.005, 1.5, 0, '#39505c');
  k.box(0.3, 0.02, 0.58, 0.52, 1.855, 0, DARK);
  k.box(0.28, 0.13, 0.56, 0.52, 1.93, 0, SIGN, { emit: EMIT.sign });
  k.box(0.285, 0.035, 0.4, 0.52, 1.93, 0, '#1f5f2f');

  // Plates: yellow with green text at the back, the number on both sides.
  k.box(0.02, 0.13, 0.3, d.rear - 0.03, 0.6, 0, PLATE);
  k.box(0.022, 0.04, 0.22, d.rear - 0.031, 0.6, 0, PLATE_TEXT);
  for (const side of [-1, 1]) k.box(0.3, 0.05, 0.012, d.rear + 0.45, 0.66, side * 0.686, PLATE_TEXT);

  if (rusty) {
    const rust = '#8a4a26';
    k.box(0.28, 0.14, 0.012, -0.95, 0.56, 0.686, rust);
    k.box(0.2, 0.1, 0.012, -0.5, 0.9, -0.686, rust);
    k.box(0.16, 0.1, 0.012, -1.2, 0.54, -0.686, rust);
    k.box(0.012, 0.12, 0.25, d.rear - 0.034, 0.92, -0.3, rust);
    k.box(0.22, 0.012, 0.12, 1.2, 0.935, 0.05, rust, undefined, 0, 0, -0.126);
    k.box(0.55, 0.012, 0.4, -0.55, 1.865, 0.22, '#6b6f5a', undefined, 0, 0.2);
  }

  addLiveryExtra(k, extra, d);
  return k;
}

function addLiveryExtra(k: Kit, extra: TukExtra, d: TukDims): void {
  const cr = d.canopyRear;
  switch (extra) {
    case 'lanterns': {
      const n = d.ext > 0 ? 4 : 3;
      const colours = ['#d23c2a', '#f2c14e', '#e8871e'];
      for (const side of [-1, 1]) {
        for (let i = 0; i < n; i++) {
          const x = 0.4 + ((cr + 0.35 - 0.4) * i) / (n - 1);
          k.add(place(new OctahedronGeometry(0.075).scale(1, 1.15, 1), x, 1.56, side * 0.74), colours[(i + (side > 0 ? 1 : 0)) % 3], { emit: EMIT.led });
          k.box(0.02, 0.07, 0.02, x, 1.46, side * 0.74, '#d23c2a');
        }
        k.cyl(0.012, 0.7, cr + 0.1, 2.12, side * 0.62, '#8a6a3a', 'y', 4);
        k.box(0.1, 0.42, 0.012, cr + 0.04, 2.2, side * 0.62, side > 0 ? '#e74c3c' : '#f1c40f');
      }
      break;
    }
    case 'parasol': {
      const x = cr + 0.7;
      k.cyl(0.012, 0.5, x, 2.08, 0, '#6b4428', 'y', 4);
      k.add(place(new ConeGeometry(0.44, 0.18, 10), x, 2.3, 0), PAINT, T);
      k.add(place(new ConeGeometry(0.03, 0.06, 4), x, 2.42, 0), '#6b4428');
      break;
    }
    case 'horns': {
      k.box(0.12, 0.06, 0.2, 0.74, 1.87, 0, '#6b4428');
      for (const side of [-1, 1]) k.box(0.04, 0.46, 0.07, 0.74, 2.06, side * 0.08, PAINT, T, side * 0.6);
      break;
    }
    case 'ledStrips': {
      const led: PartOpts = { slot: SLOT.trim, emit: EMIT.led };
      for (const side of [-1, 1]) {
        k.box(0.62 - cr, 0.025, 0.025, (0.62 + cr) / 2, 1.655, side * 0.738, PAINT, led);
        k.box(-0.24 - d.rear, 0.025, 0.025, (d.rear - 0.18) / 2, 1.035, side * 0.67, PAINT, led);
      }
      k.box(0.025, 0.025, 1.25, d.rear - 0.035, 1.07, 0, PAINT, led);
      k.box(0.025, 0.025, 1.2, 0.9, 1.7, 0, PAINT, led);
      break;
    }
    case 'split': {
      const len = -0.18 - d.rear;
      for (const side of [-1, 1]) k.box(len, 0.24, 0.012, (-0.18 + d.rear) / 2, 0.56, side * 0.68, PAINT, T);
      k.box(0.012, 0.24, 1.3, d.rear - 0.03, 0.56, 0, PAINT, T);
      k.add(taperedBox(0.62, 1.57, 0.43, 0.7, 0.51, 0.55, 0.72, 0.21), PAINT, T);
      break;
    }
    case 'none':
      break;
  }
}

/** Denting for the rusty model: nudge painted vertices by a hash of their position (shared corners move together). */
function dent(geo: BufferGeometry): void {
  const pos = geo.getAttribute('position');
  const tag = geo.getAttribute('aVeh');
  for (let i = 0; i < pos.count; i++) {
    if (tag.getX(i) !== SLOT.body) continue;
    const key = Math.round(pos.getX(i) * 100) * 73856093 ^ Math.round(pos.getY(i) * 100) * 19349663 ^ Math.round(pos.getZ(i) * 100) * 83492791;
    const a = (hash01(key, 1) - 0.5) * 0.035;
    const b = (hash01(key, 2) - 0.5) * 0.02;
    pos.setXYZ(i, pos.getX(i) + b, pos.getY(i) + b * 0.5, pos.getZ(i) + a);
  }
}

/** Simplified tuk-tuk for distant views (~250 triangles). */
function tuktukLod1(kind: TukKind): Kit {
  const k = new Kit();
  const d = tukDims(kind);
  k.box(-0.18 - d.rear, 0.56, 1.32, (-0.18 + d.rear) / 2, 0.72, 0, PAINT, B);
  k.box(0.8, 0.36, 1.0, 0.22, 0.62, 0, PAINT, B);
  k.add(taperedBox(0.6, 1.55, 0.44, 1.02, 0.5, 0.56, 0.9, 0.2), PAINT, B);
  k.add(taperedBox(d.canopyRear, 0.92, 1.72, 1.84, 0.72, 1.7, 1.78, 0.64), PAINT, C);
  k.add(deformedBox((sx, sy, sz) => [(sy > 0 ? 0.72 : 0.84) + sx * 0.01, sy > 0 ? 1.62 : 1.04, sz * 0.5]), GLASS);
  for (const [x, z] of [[0.76, 0.52], [0.76, -0.52], [d.rear + 0.07, 0.64], [d.rear + 0.07, -0.64]] as const) k.box(0.04, 0.8, 0.04, x, 1.35, z, CHROME);
  k.box(0.1, 0.46, 1.2, d.benches[0][0] + 0.06, 1.1, 0, VINYL);
  k.box(0.28, 0.13, 0.56, 0.52, 1.92, 0, SIGN, { emit: EMIT.sign });
  k.box(0.04, 0.12, 0.2, 1.55, 0.95, 0, LAMP, { emit: EMIT.head });
  k.box(0.03, 0.08, 1.1, d.rear - 0.02, 0.9, 0, TAIL, { emit: EMIT.tail });
  k.cyl(TUK_WHEEL_R, 0.15, 1.22, TUK_WHEEL_R, 0, TYRE, 'z', 8, { wheel: [1.22, TUK_WHEEL_R] });
  for (const side of [-1, 1]) k.cyl(TUK_WHEEL_R, 0.15, d.rearAxle, TUK_WHEEL_R, side * 0.6, TYRE, 'z', 8, { wheel: [d.rearAxle, TUK_WHEEL_R] });
  return k;
}

const tukCache = new Map<string, BufferGeometry>();

/** Tuk-tuk geometry for a body variant and livery extra; lod 1 is the distant stand-in (no extras). */
export function tuktukGeometry(kind: TukKind, extra: TukExtra = 'none', lod: 0 | 1 = 0): BufferGeometry {
  const key = lod ? `lod1:${kind}` : `${kind}:${extra}`;
  let g = tukCache.get(key);
  if (!g) {
    g = (lod ? tuktukLod1(kind) : tuktukParts(kind, extra)).geometry();
    if (kind === 'rusty' && !lod) dent(g);
    tukCache.set(key, g);
  }
  return g;
}

/** Per-vehicle add-ons drawn as their own batches: upgrades and weather. */
export type TukAccessory = 'garland' | 'party' | 'curtains';
export const TUK_ACCESSORIES: readonly TukAccessory[] = ['garland', 'party', 'curtains'];

const accCache = new Map<string, BufferGeometry>();

/** Geometry of an accessory fitted to a tuk-tuk body variant. */
export function tukAccessoryGeometry(acc: TukAccessory, kind: TukKind): BufferGeometry {
  const key = `${acc}:${kind}`;
  let g = accCache.get(key);
  if (g) return g;
  const k = new Kit();
  const d = tukDims(kind);
  if (acc === 'garland') {
    // Phuang malai: a jasmine loop with marigold and rose tassels on the windscreen bar.
    const loop = new TorusGeometry(0.075, 0.018, 3, 8);
    loop.rotateY(Math.PI / 2);
    k.add(place(loop, 0.74, 1.54, 0), '#f7f3e8');
    k.box(0.035, 0.07, 0.035, 0.74, 1.43, 0, AMBER);
    k.box(0.03, 0.05, 0.03, 0.74, 1.37, 0, '#c0392b');
  } else if (acc === 'party') {
    const pink: PartOpts = { emit: EMIT.led };
    const cr = d.canopyRear;
    const mid = (0.62 + cr) / 2;
    for (const side of [-1, 1]) {
      k.box(0.62 - mid, 0.025, 0.025, (0.62 + mid) / 2, 1.64, side * 0.7, '#ff3fb4', pink);
      k.box(mid - cr, 0.025, 0.025, (mid + cr) / 2, 1.64, side * 0.7, '#35e0ff', pink);
    }
    k.box(0.025, 0.025, 1.3, 0.88, 1.66, 0, '#b04dff', pink);
  } else {
    // Clear rain curtains let down along both sides of the passenger area.
    const len = -0.2 - d.rear;
    for (const side of [-1, 1]) k.box(len, 0.62, 0.01, (-0.2 + d.rear) / 2, 1.34, side * 0.72, '#d6ecf3');
  }
  g = k.geometry();
  accCache.set(key, g);
  return g;
}

// ---------------------------------------------------------- ambient traffic

export type AmbientKind = 'songthaew' | 'scooter' | 'scooterBox' | 'sedan' | 'pickup' | 'van' | 'taxi';
export const AMBIENT_KINDS: readonly AmbientKind[] = ['songthaew', 'scooter', 'scooterBox', 'sedan', 'pickup', 'van', 'taxi'];

/** Wheel radius per ambient kind (m). */
export const AMBIENT_WHEEL_R: Record<AmbientKind, number> = {
  songthaew: 0.36,
  scooter: 0.24,
  scooterBox: 0.24,
  sedan: 0.31,
  pickup: 0.36,
  van: 0.34,
  taxi: 0.31,
};

/** Half-width (m) per ambient kind, for parking against the kerb. */
export const AMBIENT_HALF_WIDTH: Record<AmbientKind, number> = {
  songthaew: 0.95,
  scooter: 0.35,
  scooterBox: 0.35,
  sedan: 0.88,
  pickup: 0.9,
  van: 0.95,
  taxi: 0.88,
};

/** Rider hip points on a scooter: rider, pillion. */
export const SCOOTER_SEATS: V3[] = [
  [-0.2, 0.82, 0],
  [-0.56, 0.84, 0],
];

/**
 * Blob shadow on the road under a scooter's riders, for a rider alone and with
 * a pillion: centre along the scooter, half-length, half-width (m). It covers
 * the riders from the pillion's back to the rider's hands on the bars, drawn
 * about half as large again because a blob fades out towards its rim, as the
 * blob under a pedestrian is.
 */
export const SCOOTER_RIDER_BLOB: readonly (readonly [number, number, number])[] = [
  [0.02, 0.65, 0.4],
  [-0.16, 0.85, 0.4],
];

function songthaew(): Kit {
  const k = new Kit();
  for (const x of [1.75, -1.35]) for (const side of [-1, 1]) wheel(k, x, side * 0.8, 0.36, 0.22, '#c9ccd0', false);
  k.box(5.0, 0.2, 1.6, -0.1, 0.55, 0, '#333333');
  // Cab and bonnet.
  k.add(taperedBox(1.6, 2.62, 0.6, 1.25, 0.86, 0.62, 1.12, 0.84), PAINT, B);
  k.box(1.0, 1.3, 1.76, 1.12, 1.3, 0, PAINT, B);
  k.add(deformedBox((sx, sy, sz) => [(sy > 0 ? 1.52 : 1.64) + sx * 0.012, sy > 0 ? 1.9 : 1.26, sz * 0.8]), GLASS);
  k.box(1.12, 0.06, 1.78, 1.08, 1.97, 0, PAINT, B);
  for (const side of [-1, 1]) {
    k.box(0.6, 0.45, 0.012, 1.18, 1.62, side * 0.885, TINT);
    k.box(0.04, 0.12, 0.08, 1.55, 1.55, side * 1.0, DARK);
    k.box(0.03, 0.12, 0.2, 2.64, 1.02, side * 0.6, LAMP, { emit: EMIT.head });
    k.box(0.03, 0.14, 0.1, -2.67, 0.95, side * 0.82, TAIL, { emit: EMIT.tail });
  }
  k.box(0.04, 0.3, 1.0, 2.63, 0.9, 0, CHROME);
  k.box(0.1, 0.14, 1.8, 2.66, 0.6, 0, '#bfc3c7');
  k.box(0.05, 0.22, 1.4, 1.62, 2.14, 0, '#f4efe6');
  k.box(0.055, 0.06, 1.0, 1.62, 2.14, 0, '#c0392b');
  // Covered bed: floor, low sides, benches, posts, raised roof with a trim band, roof rack.
  k.box(3.3, 0.08, 1.8, -0.98, 0.82, 0, '#5b3b28');
  for (const side of [-1, 1]) {
    k.box(3.3, 0.5, 0.05, -0.98, 1.1, side * 0.88, PAINT, B);
    k.box(3.0, 0.1, 0.35, -1.0, 1.2, side * 0.62, '#7a4a2e');
    k.box(3.0, 0.3, 0.05, -1.0, 1.45, side * 0.83, '#7a4a2e');
    for (const x of [0.55, -0.9, -2.55]) k.box(0.05, 0.9, 0.05, x, 1.78, side * 0.88, CHROME);
    for (const y of [1.55, 1.8]) k.cyl(0.015, 3.2, -0.95, y, side * 0.89, CHROME, 'x', 4);
    k.cyl(0.02, 3.0, -0.9, 2.42, side * 0.65, CHROME, 'x', 4);
    k.cyl(0.02, 1.1, -2.6, 1.55, side * 0.8, CHROME, 'y', 4);
  }
  k.box(3.5, 0.08, 1.92, -0.9, 2.2, 0, PAINT, T);
  k.box(3.5, 0.08, 1.9, -0.9, 2.27, 0, PAINT, B);
  k.box(3.2, 0.06, 1.5, -0.9, 2.33, 0, PAINT, B);
  k.box(0.25, 0.05, 1.2, -2.72, 0.5, 0, CHROME);
  return k;
}

function scooter(box: boolean): Kit {
  const k = new Kit();
  for (const x of [0.64, -0.64]) {
    const o: PartOpts = { wheel: [x, 0.24] };
    k.cyl(0.24, 0.1, x, 0.24, 0, TYRE, 'z', 10, o);
    k.cyl(0.1, 0.11, x, 0.24, 0, CHROME, 'z', 6, o);
  }
  k.box(0.55, 0.06, 0.3, 0.05, 0.36, 0, PAINT, B);
  k.add(taperedBox(-0.88, -0.1, 0.35, 0.72, 0.16, 0.36, 0.62, 0.17), PAINT, B);
  k.box(0.62, 0.08, 0.28, -0.38, 0.78, 0, TYRE);
  k.add(taperedBox(0.22, 0.42, 0.36, 0.95, 0.19, 0.4, 0.92, 0.12), PAINT, B);
  k.box(0.3, 0.05, 0.14, 0.64, 0.52, 0, PAINT, B);
  for (const side of [-1, 1]) {
    k.box(0.03, 0.4, 0.03, 0.6, 0.62, side * 0.06, CHROME, undefined, 0, 0, 0.3);
    k.box(0.02, 0.06, 0.08, 0.42, 1.18, side * 0.26, DARK);
  }
  k.cyl(0.018, 0.62, 0.42, 1.05, 0, CHROME, 'z', 4);
  k.box(0.14, 0.12, 0.2, 0.47, 1.02, 0, PAINT, B);
  k.box(0.02, 0.07, 0.12, 0.545, 1.02, 0, LAMP, { emit: EMIT.head });
  k.box(0.03, 0.05, 0.12, -0.89, 0.66, 0, TAIL, { emit: EMIT.tail });
  k.cyl(0.035, 0.4, -0.45, 0.3, 0.14, CHROME, 'x', 5);
  k.box(0.012, 0.08, 0.14, -0.9, 0.5, 0, '#f4f4f4');
  if (box) {
    k.box(0.4, 0.36, 0.42, -0.66, 1.02, 0, PAINT, T);
    k.box(0.41, 0.05, 0.43, -0.66, 1.18, 0, '#f4f4f4');
  }
  return k;
}

/** Car body: lower body, glasshouse, roof; shared by sedans and taxis. */
function sedan(taxi: boolean): Kit {
  const k = new Kit();
  for (const x of [1.4, -1.4]) for (const side of [-1, 1]) carWheel(k, x, side * 0.76, 0.31, 0.2);
  k.box(4.3, 0.46, 1.72, 0, 0.55, 0, PAINT, B);
  k.add(taperedBox(1.55, 2.25, 0.32, 0.78, 0.86, 0.36, 0.66, 0.8), PAINT, B);
  k.add(taperedBox(-2.25, -1.6, 0.36, 0.7, 0.8, 0.32, 0.78, 0.86), PAINT, B);
  k.add(
    deformedBox((sx, sy, sz) => {
      const top = sy > 0;
      const x = sx > 0 ? (top ? 0.42 : 1.05) : top ? -0.95 : -1.4;
      return [x, top ? 1.38 : 0.78, sz * (top ? 0.72 : 0.84)];
    }),
    TINT,
  );
  k.add(taperedBox(-0.92, 0.4, 1.37, 1.44, 0.73, 1.37, 1.44, 0.73), PAINT, B);
  carTrim(k, 2.25, 0.86);
  if (taxi) {
    k.box(4.32, 0.18, 1.74, 0, 0.42, 0, PAINT, T);
    k.box(0.5, 0.14, 0.32, -0.25, 1.52, 0, SIGN, { emit: EMIT.sign });
  }
  return k;
}

function carWheel(k: Kit, x: number, z: number, r: number, w: number): void {
  const o: PartOpts = { wheel: [x, r] };
  k.cyl(r, w, x, r, z, TYRE, 'z', 8, o);
  k.cyl(r * 0.6, w + 0.012, x, r, z, '#9aa0a6', 'z', 6, o);
}

/** Lamps, bumpers, grille, mirrors and plates for a car whose ends are at ±half. */
function carTrim(k: Kit, half: number, hw: number): void {
  for (const side of [-1, 1]) {
    k.box(0.03, 0.1, 0.3, half + 0.01, 0.66, side * (hw - 0.28), LAMP, { emit: EMIT.head });
    k.box(0.03, 0.1, 0.3, -half - 0.01, 0.7, side * (hw - 0.26), TAIL, { emit: EMIT.tail });
    k.box(0.06, 0.08, 0.12, half * 0.4, 1.0, side * (hw + 0.06), PAINT, B);
  }
  k.box(0.12, 0.14, hw * 2 + 0.04, half - 0.04, 0.36, 0, '#8e9398');
  k.box(0.12, 0.14, hw * 2 + 0.04, -half + 0.04, 0.36, 0, '#8e9398');
  k.box(0.02, 0.12, 0.7, half + 0.02, 0.52, 0, DARK);
  k.box(0.012, 0.1, 0.3, half + 0.03, 0.44, 0, '#f4f4f4');
  k.box(0.012, 0.1, 0.3, -half - 0.03, 0.46, 0, '#f4f4f4');
}

function pickup(): Kit {
  const k = new Kit();
  for (const x of [1.6, -1.5]) for (const side of [-1, 1]) carWheel(k, x, side * 0.78, 0.36, 0.24);
  k.box(4.8, 0.2, 1.5, 0, 0.55, 0, '#333333');
  k.add(taperedBox(1.2, 2.6, 0.6, 1.2, 0.88, 0.62, 1.06, 0.84), PAINT, B);
  k.box(1.5, 0.55, 1.78, 0.45, 0.95, 0, PAINT, B);
  k.add(
    deformedBox((sx, sy, sz) => {
      const top = sy > 0;
      const x = sx > 0 ? (top ? 0.82 : 1.2) : top ? -0.25 : -0.3;
      return [x, top ? 1.74 : 1.22, sz * (top ? 0.76 : 0.87)];
    }),
    TINT,
  );
  k.box(1.1, 0.06, 1.56, 0.28, 1.76, 0, PAINT, B);
  k.box(2.1, 0.06, 1.7, -1.55, 0.95, 0, '#333333');
  for (const side of [-1, 1]) k.box(2.1, 0.42, 0.06, -1.55, 1.15, side * 0.87, PAINT, B);
  k.box(0.06, 0.42, 1.74, -2.6, 1.15, 0, PAINT, B);
  k.box(0.06, 0.42, 1.74, -0.5, 1.15, 0, PAINT, B);
  carTrim(k, 2.6, 0.88);
  return k;
}

function van(): Kit {
  const k = new Kit();
  for (const x of [1.6, -1.6]) for (const side of [-1, 1]) carWheel(k, x, side * 0.8, 0.34, 0.22);
  k.box(4.8, 0.9, 1.86, -0.1, 0.8, 0, PAINT, B);
  k.add(taperedBox(2.1, 2.5, 0.35, 1.2, 0.93, 0.4, 1.0, 0.86), PAINT, B);
  k.box(4.3, 0.6, 1.84, -0.3, 1.55, 0, TINT);
  k.add(deformedBox((sx, sy, sz) => [(sy > 0 ? 1.8 : 2.12) + sx * 0.012, sy > 0 ? 1.85 : 1.25, sz * 0.9]), TINT);
  k.box(4.4, 0.12, 1.86, -0.3, 1.91, 0, PAINT, B);
  for (const x of [1.1, -0.4, -1.8, -2.45]) k.box(0.12, 0.6, 1.86, x, 1.55, 0, PAINT, B);
  k.box(4.82, 0.08, 1.87, -0.1, 1.05, 0, PAINT, T);
  carTrim(k, 2.5, 0.93);
  return k;
}

const ambientCache = new Map<AmbientKind, BufferGeometry>();

export function ambientGeometry(kind: AmbientKind): BufferGeometry {
  let g = ambientCache.get(kind);
  if (!g) {
    const k =
      kind === 'songthaew'
        ? songthaew()
        : kind === 'scooter' || kind === 'scooterBox'
          ? scooter(kind === 'scooterBox')
          : kind === 'pickup'
            ? pickup()
            : kind === 'van'
              ? van()
              : sedan(kind === 'taxi');
    g = k.geometry();
    ambientCache.set(kind, g);
  }
  return g;
}

// ----------------------------------------------------------- paint schemes

/** Paint for an ambient vehicle: [body, canopy, trim] hex colours, picked by a seed in [0, 1). */
export function ambientPaint(kind: AmbientKind, u: number): [string, string, string] {
  const pick = <T>(list: readonly T[]) => list[Math.min(list.length - 1, Math.floor(u * list.length))];
  switch (kind) {
    case 'songthaew': {
      // Red rot daeng mostly; the yellow, white, blue and green inter-town trucks now and then.
      if (u < 0.84) return ['#c8312b', '#c8312b', '#f4efe6'];
      const others: [string, string, string][] = [
        ['#f2c418', '#f2c418', '#f4efe6'],
        ['#f4f4f0', '#f4f4f0', '#2e6fb5'],
        ['#2e6fb5', '#2e6fb5', '#f4efe6'],
        ['#2f9e5b', '#2f9e5b', '#f4efe6'],
      ];
      return others[Math.min(others.length - 1, Math.floor(((u - 0.84) / 0.16) * others.length))];
    }
    case 'scooter':
    case 'scooterBox':
      return [pick(['#c0392b', '#1b1b1f', '#f4f4f4', '#2e86c1', '#7f8c8d', '#e67e22', '#8e44ad', '#16a085', '#f1c40f', '#d35400']), '#1b1b1f', pick(['#1db954', '#f36c21', '#e4007c', '#00a651'])];
    case 'taxi':
      return u < 0.6 ? ['#f2c418', '#f2c418', '#1f4fa8'] : ['#c8312b', '#c8312b', '#f2c418'];
    case 'van':
      return [u < 0.8 ? '#f4f4f0' : pick(['#c9ccd0', '#2b2d31', '#e8e4da']), '#f4f4f0', pick(['#2e6fb5', '#c0392b', '#7f8c8d', '#2f9e5b'])];
    default:
      return [pick(['#f3f3f1', '#f3f3f1', '#c9ccd0', '#c9ccd0', '#2b2d31', '#8a8f96', '#7a1f1f', '#e8e4da', '#1f3a5f']), '#ffffff', '#ffffff'];
  }
}

// ------------------------------------------------------------ light cones

let coneGeo: BufferGeometry | null = null;

/**
 * Headlight pool on the road ahead of a vehicle: a flat fan facing up, bright
 * at the lamp and fading to black at its rounded far edge (for additive blending).
 */
export function headlightConeGeometry(): BufferGeometry {
  if (coneGeo) return coneGeo;
  const pos: number[] = [];
  const col: number[] = [];
  const edge = [3.6, 1.4, -1.4, -3.6];
  const farX = (z: number) => 11 - 0.08 * z * z;
  for (let i = 0; i + 1 < edge.length; i++) {
    pos.push(1.2, 0.05, 0, farX(edge[i]), 0.05, edge[i], farX(edge[i + 1]), 0.05, edge[i + 1]);
    col.push(1, 1, 1, 0, 0, 0, 0, 0, 0);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  coneGeo = g;
  return g;
}

/** Axis-aligned bounds of a model geometry (model units). */
export function modelBounds(geo: BufferGeometry): { min: V3; max: V3 } {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
}
