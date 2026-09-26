// Geometries for instanced street props, keyed by the kind names the
// generator records with addProp(). Each model faces +X at yaw 0 (its
// model +Z is the right-hand side) and stands on the ground at the origin.

import type { BufferGeometry } from 'three';
import { HERITAGE_LAMP_HEAD, POLE, STREET_LAMP_HEAD } from './build/props';
import { Kit, tone, type Paint, type V } from './lowpoly';

export { HERITAGE_LAMP_HEAD, POLE, STREET_LAMP_HEAD };

const Q = Math.PI / 4;

/** Galvanised arm lamp; the arm reaches over the carriageway along +X. */
function streetLamp(): BufferGeometry {
  const k = new Kit();
  const steel = '#9ea4a8';
  const { reach, height } = STREET_LAMP_HEAD;
  k.box(0, 0.25, 0, 0.45, 0.5, 0.45, tone(steel, 0.8));
  k.prism([0, 0.5, 0], [0, height - 0.1, 0], 0.11, 0.07, 4, steel, { rot: Q });
  k.prism([0, height - 0.3, 0], [reach - 0.35, height + 0.2, 0], 0.05, 0.04, 3, steel);
  k.box(reach, height, 0, 0.8, 0.16, 0.34, '#6f7478', '#8a9095', { bottom: '#fff1c9' });
  return k.geometry();
}

/** Dark Lanna-style lantern post for the moat promenade and heritage streets. */
function heritageLamp(): BufferGeometry {
  const k = new Kit();
  const dark = '#2d332f';
  const h = HERITAGE_LAMP_HEAD.height;
  k.box(0, 0.2, 0, 0.5, 0.4, 0.5, dark);
  k.prism([0, 0.4, 0], [0, h - 0.42, 0], 0.08, 0.06, 4, dark, { rot: Q });
  k.box(0, h - 0.36, 0, 0.3, 0.12, 0.3, dark);
  k.prism([0, h - 0.3, 0], [0, h + 0.3, 0], 0.19, 0.24, 4, '#f3d9a0', { rot: Q });
  k.prism([0, h + 0.3, 0], [0, h + 0.6, 0], 0.33, 0, 4, dark, { rot: Q });
  k.prism([0, h + 0.6, 0], [0, h + 0.82, 0], 0.035, 0, 3, '#c9a24a');
  return k.geometry();
}

/** Square concrete pole with a crossarm across the road (model Z). */
function powerPole(): BufferGeometry {
  const k = new Kit();
  const conc = '#b5b1a8';
  k.prism([0, 0, 0], [0, POLE.height, 0], 0.17, 0.1, 4, conc, { rot: Q, capTop: true, base: tone(conc, 0.7) });
  k.box(0, POLE.arm, 0, 0.12, 0.12, POLE.armHalf * 2 + 0.3, '#8d8a84');
  return k.geometry();
}

/** Signal head facing +X: black box with lit red and dim amber/green lenses. */
function signalHead(k: Kit, x: number, y: number, z: number): void {
  k.box(x, y, z, 0.3, 0.95, 0.32, '#1d1f20', '#1d1f20', { bottom: '#1d1f20' });
  const f = x + 0.155;
  const lens = (yy: number, c: Paint) => k.quad([f, yy - 0.1, z - 0.1], [f, yy - 0.1, z + 0.1], [f, yy + 0.1, z + 0.1], [f, yy + 0.1, z - 0.1], c, [x, yy, z]);
  lens(y + 0.3, '#ff3b2f');
  lens(y, '#6d5a1c');
  lens(y - 0.3, '#1d5a2a');
}

/** Signal pole on the kerb: an arm over the carriageway (model −Z), overhead and pole heads, countdown. */
function trafficLight(): BufferGeometry {
  const k = new Kit();
  const pole = '#3b3f42';
  k.prism([0, 0, 0], [0, 5.6, 0], 0.12, 0.1, 4, pole, { rot: Q, capTop: true });
  k.box(0, 5.45, -2.3, 0.1, 0.1, 4.6, pole);
  signalHead(k, 0.1, 4.95, -3.6);
  k.box(0.1, 4.95, -4.15, 0.25, 0.5, 0.5, '#1d1f20', '#1d1f20', { bottom: '#1d1f20' });
  const f = 0.23;
  k.quad([f, 4.8, -4.33], [f, 4.8, -3.97], [f, 5.1, -3.97], [f, 5.1, -4.33], '#ff4a2a', [0.1, 4.95, -4.15]);
  signalHead(k, 0.14, 3.0, 0);
  return k.geometry();
}

/** San phra phum: a gilded miniature Lanna house on a pillar, facing the street (+X). */
function spiritHouse(): BufferGeometry {
  const k = new Kit();
  const gold = '#d8a431';
  const red = '#b8352a';
  k.prism([0, 0, 0], [0, 1.35, 0], 0.1, 0.09, 4, '#ece6da', { rot: Q });
  k.box(0, 1.4, 0, 0.8, 0.1, 0.8, gold, '#e9d3a0', { bottom: tone(gold, 0.7) });
  k.box(0, 1.72, 0, 0.5, 0.55, 0.5, gold, gold);
  k.quad([0.252, 1.5, -0.1], [0.252, 1.5, 0.1], [0.252, 1.85, 0.1], [0.252, 1.85, -0.1], red, [0, 1.72, 0]);
  // Steep gable roof, ridge along X, with a gold finial at each end.
  const e = 1.98;
  const r = 2.45;
  k.quad([-0.38, e, -0.36], [0.38, e, -0.36], [0.38, r, 0], [-0.38, r, 0], red, [0, 2.1, 0]);
  k.quad([-0.38, e, 0.36], [0.38, e, 0.36], [0.38, r, 0], [-0.38, r, 0], red, [0, 2.1, 0]);
  k.tri([0.26, e, -0.25], [0.26, e, 0.25], [0.26, r - 0.05, 0], gold, [0, 2.1, 0]);
  k.tri([-0.26, e, -0.25], [-0.26, e, 0.25], [-0.26, r - 0.05, 0], gold, [0, 2.1, 0]);
  k.prism([0.38, r, 0], [0.5, r + 0.25, 0], 0.03, 0, 3, gold);
  // Offerings: a red drink and a marigold garland on the platform.
  k.box(0.3, 1.52, 0.22, 0.08, 0.14, 0.08, '#c8312b');
  return k.geometry();
}

/** One parked scooter centred at (x, z), its nose along angle a (about Y): wheels, body, seat, front shield. */
function scooter(k: Kit, x: number, z: number, a: number, body: Paint): void {
  const at = (lx: number): [number, number] => [x + lx * Math.cos(a), z - lx * Math.sin(a)];
  const [wx, wz] = at(0);
  k.box(wx, 0.23, wz, 1.7, 0.46, 0.12, '#1e1e1e', '#1e1e1e', { rotY: a });
  const [bx, bz] = at(-0.15);
  k.box(bx, 0.55, bz, 1.2, 0.36, 0.34, body, tone(body, 1.08), { rotY: a });
  const [sx, sz] = at(-0.3);
  k.box(sx, 0.78, sz, 0.62, 0.1, 0.28, '#2a2a2a', '#303030', { rotY: a });
  const [fx, fz] = at(0.58);
  k.box(fx, 0.72, fz, 0.2, 0.8, 0.42, body, '#2a2a2a', { rotY: a });
}

/** Three scooters parked at 45°, 0.9 m apart along Z, noses towards +X. */
function parkedBikes(): BufferGeometry {
  const k = new Kit();
  const colours = ['#c0392b', '#2c3e50', '#ecf0f1'];
  for (let i = 0; i < 3; i++) scooter(k, 0, (i - 1) * 0.9, Q, colours[i]);
  return k.geometry();
}

/** Glass-cased food cart with a gas bottle behind and plastic stools on its serving side (+X). */
function foodCart(): BufferGeometry {
  const k = new Kit();
  k.box(0, 0.12, 0, 0.5, 0.24, 1.6, '#222222');
  k.box(0, 0.62, 0, 0.7, 0.76, 1.5, '#c9cdd0', '#b9bdc0');
  k.box(0, 1.22, 0, 0.6, 0.45, 1.3, '#bfe0ea', '#d7eef3');
  k.box(0.36, 0.78, 0, 0.02, 0.26, 1.5, '#c8312b', '#c8312b');
  k.prism([-0.55, 0, 0.45], [-0.55, 0.55, 0.45], 0.15, 0.15, 4, '#d35a2a', { rot: Q, capTop: true });
  const stools: [number, Paint][] = [
    [-0.6, '#c8312b'],
    [0, '#2f6db5'],
    [0.6, '#c8312b'],
  ];
  for (const [z, c] of stools) k.prism([1.1, 0, z], [1.1, 0.45, z], 0.2, 0.15, 4, c, { rot: Q, capTop: true });
  return k.geometry();
}

/** Big vendor parasol, 3 m across, in four alternating colours. */
function parasol(): BufferGeometry {
  const k = new Kit();
  k.prism([0, 0, 0], [0, 2.45, 0], 0.03, 0.03, 3, '#dcdcdc');
  const colours = ['#c8312b', '#f0c330', '#2f6db5', '#f4efe6'];
  const rim: V[] = [];
  for (let i = 0; i < 8; i++) rim.push([Math.cos((i / 8) * Math.PI * 2) * 1.5, 2.05, Math.sin((i / 8) * Math.PI * 2) * 1.5]);
  const apex: V = [0, 2.6, 0];
  const hub: V = [0, 2.2, 0];
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    k.tri(rim[i], rim[j], apex, colours[i % 4], [0, 1.5, 0]);
    k.tri(rim[i], rim[j], hub, tone(colours[i % 4], 0.7), [0, 3.5, 0]);
  }
  return k.geometry();
}

/** Sala-style bus shelter: open towards the road (+X), bench and back panel, red gable roof. */
function busShelter(): BufferGeometry {
  const k = new Kit();
  const post = '#e9e4d8';
  k.box(0, 0.07, 0, 1.6, 0.14, 3.6, '#bdb7ab');
  for (const [x, z] of [
    [0.7, 1.65],
    [0.7, -1.65],
    [-0.7, 1.65],
    [-0.7, -1.65],
  ])
    k.prism([x, 0.14, z], [x, 2.4, z], 0.06, 0.06, 4, post, { rot: Q });
  k.box(-0.35, 0.47, 0, 0.45, 0.08, 3.0, '#8a6a45');
  k.box(-0.74, 1.2, 0, 0.06, 1.2, 3.3, '#2f6db5', '#2f6db5');
  // Gable roof, ridge along Z, eaves out 0.3 m; underside for the view from the pavement.
  const e = 2.4;
  const r = 3.05;
  const inside: V = [0, 2.6, 0];
  k.quad([1.1, e, -2.1], [1.1, e, 2.1], [0, r, 2.1], [0, r, -2.1], '#b8452f', inside);
  k.quad([-1.1, e, -2.1], [-1.1, e, 2.1], [0, r, 2.1], [0, r, -2.1], '#a63d2a', inside);
  k.tri([0.9, e + 0.02, 1.9], [-0.9, e + 0.02, 1.9], [0, r - 0.05, 1.9], '#d8a431', inside);
  k.tri([0.9, e + 0.02, -1.9], [-0.9, e + 0.02, -1.9], [0, r - 0.05, -1.9], '#d8a431', inside);
  k.quad([1.1, e - 0.02, -2.1], [-1.1, e - 0.02, -2.1], [-1.1, e - 0.02, 2.1], [1.1, e - 0.02, 2.1], '#8a8378', [0, 3, 0]);
  return k.geometry();
}

/** Two white poles: the Thai tricolour and the yellow Buddhist dharma-wheel flag, flying along +X. */
function flagPoles(): BufferGeometry {
  const k = new Kit();
  const top = 6.5;
  for (const z of [-0.6, 0.6]) {
    k.prism([0, 0, z], [0, top, z], 0.05, 0.035, 4, '#f2f2f2', { rot: Q });
    k.prism([0, top, z], [0, top + 0.18, z], 0.06, 0, 3, '#d8a431');
  }
  // Thai flag: red, white, blue (double), white, red.
  const stripes: [number, Paint][] = [
    [1, '#c8312b'],
    [1, '#f4f4f4'],
    [2, '#2d2a6e'],
    [1, '#f4f4f4'],
    [1, '#c8312b'],
  ];
  let y = top - 0.05;
  for (const [h, c] of stripes) {
    const dy = (h / 6) * 1.0;
    k.panel([0.05, y - dy, -0.6], [1.55, y - dy, -0.6], [1.55, y, -0.6], [0.05, y, -0.6], c);
    y -= dy;
  }
  k.panel([0.05, top - 1.05, 0.6], [1.55, top - 1.05, 0.6], [1.55, top - 0.05, 0.6], [0.05, top - 0.05, 0.6], '#f2c230');
  for (const dz of [0.012, -0.012]) {
    const z = 0.6 + dz;
    const face = z > 0.6 ? 1 : -1;
    k.quad([0.6, top - 0.8, z], [1.0, top - 0.8, z], [1.0, top - 0.3, z], [0.6, top - 0.3, z], '#b8322a', [0.8, top - 0.55, z - face]);
  }
  return k.geometry();
}

/** Moat fountain jet: a foaming column rising from below the water into a ragged spray burst. */
function fountain(): BufferGeometry {
  const k = new Kit();
  k.prism([0, -1.8, 0], [0, 4.3, 0], 0.55, 0.09, 6, '#cbe9ee', { base: '#eef9fa' });
  k.lump(0, 4.4, 0, 1.2, 0.9, 1.2, 6, (band, i) => (band === 'under' ? '#bfe3ea' : i % 3 ? '#eef9fa' : '#d9f1f4'), 23, { under: 1.1, jitter: 0.35 });
  return k.geometry();
}

/** Market stall: table with goods under a striped canopy, facing +X. */
function stall(): BufferGeometry {
  const k = new Kit();
  k.box(0, 0.4, 0, 1.0, 0.8, 2.0, '#8a6a45', '#e8e0d0');
  k.box(0.1, 0.9, 0, 0.6, 0.2, 1.6, '#e67e22', '#f0c330');
  for (const [x, z] of [
    [0.55, 1.05],
    [0.55, -1.05],
    [-0.55, 1.05],
    [-0.55, -1.05],
  ])
    k.prism([x, 0, z], [x, 2.2, z], 0.03, 0.03, 3, '#9aa0a6');
  const e = 2.1;
  const r = 2.45;
  const bands = ['#2f6db5', '#f4efe6', '#2f6db5'];
  for (let i = 0; i < 3; i++) {
    const z0 = -1.2 + i * 0.8;
    const z1 = z0 + 0.8;
    k.quad([0.7, e, z0], [0.7, e, z1], [0, r, z1], [0, r, z0], bands[i], [0, 2, 0]);
    k.quad([-0.7, e, z0], [-0.7, e, z1], [0, r, z1], [0, r, z0], bands[i], [0, 2, 0]);
  }
  k.quad([0.7, e - 0.01, -1.2], [-0.7, e - 0.01, -1.2], [-0.7, e - 0.01, 1.2], [0.7, e - 0.01, 1.2], '#9fb4c8', [0, 3, 0]);
  return k.geometry();
}

/** Green PEA ground cabinet for the buried-cable roads. */
function peaCabinet(): BufferGeometry {
  const k = new Kit();
  k.box(0, 0.1, 0, 0.7, 0.2, 1.4, '#b8b2a8');
  k.box(0, 0.85, 0, 0.55, 1.3, 1.2, '#2f7a4a', '#27693f');
  k.box(0, 1.53, 0, 0.62, 0.06, 1.28, '#27693f', '#2f7a4a', { bottom: '#1f5533' });
  k.quad([0.28, 0.35, -0.01], [0.28, 0.35, 0.01], [0.28, 1.4, 0.01], [0.28, 1.4, -0.01], '#1b4a2c', [0, 0.85, 0]);
  return k.geometry();
}

/** Wooden bench on concrete legs; a seated person faces +X. */
function bench(): BufferGeometry {
  const k = new Kit();
  const wood = '#8a6a45';
  const conc = '#cfc8bb';
  k.box(0, 0.45, 0, 0.45, 0.08, 1.8, wood, tone(wood, 1.1), { bottom: tone(wood, 0.7) });
  k.box(-0.22, 0.75, 0, 0.06, 0.45, 1.8, wood);
  for (const z of [-0.75, 0.75]) k.box(0, 0.21, z, 0.4, 0.42, 0.08, conc);
  return k.geometry();
}

/**
 * Factory per prop kind; kinds without a factory are not drawn. Kinds:
 * street_lamp (head at STREET_LAMP_HEAD along +X), heritage_lamp (lamp at
 * HERITAGE_LAMP_HEAD on the post), power_pole, traffic_light, spirit_house,
 * parked_bike (a group of three scooters), food_cart, parasol, bus_shelter,
 * flag_pole (a Thai and a Buddhist flag), fountain (moat jet; starts below
 * the water surface), stall, pea_cabinet, bench. Lighting reads street_lamp /
 * heritage_lamp positions for night light pools.
 */
export const PROP_MODELS: Record<string, () => BufferGeometry> = {
  street_lamp: streetLamp,
  heritage_lamp: heritageLamp,
  power_pole: powerPole,
  traffic_light: trafficLight,
  spirit_house: spiritHouse,
  parked_bike: parkedBikes,
  food_cart: foodCart,
  parasol,
  bus_shelter: busShelter,
  flag_pole: flagPoles,
  fountain,
  stall,
  pea_cabinet: peaCabinet,
  bench,
};

/**
 * Kinds recorded with addProp that are data for other layers rather than drawn
 * props: crowd walkways (walk*), effect anchors (fx_*) and temple bodhi-tree
 * spots (planted by the tree scatter).
 */
export function isMarkerKind(kind: string): boolean {
  return kind === 'bodhi_spot' || kind.startsWith('walk') || kind.startsWith('fx_');
}
