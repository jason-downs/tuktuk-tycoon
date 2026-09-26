// Low-poly tree species for the instanced vegetation (docs/3d/world.md §1.7),
// trunk base at the origin, Y up, sizes in metres at scale 1. Each model stays
// within ~110 triangles; the common street and park species are ~40–55.

import type { BufferGeometry } from 'three';
import { foliage, Kit, tone, type Paint, type V } from './lowpoly';

const BARK = '#5b4a3a';
const BARK_GREY = '#7a7064';
const PALM_TRUNK = '#8a7b66';

/** Drooping palm frond from the crown point c along compass angle a: a ridged (Λ) strip, 4 triangles. */
function frond(k: Kit, c: V, a: number, len: number, lift: number, droop: number, width: number, paint: Paint): void {
  const dx = Math.cos(a);
  const dz = Math.sin(a);
  const sx = -dz * width;
  const sz = dx * width;
  const mid: V = [c[0] + dx * len * 0.5, c[1] + lift, c[2] + dz * len * 0.5];
  const tip: V = [c[0] + dx * len, c[1] + lift - droop, c[2] + dz * len];
  const l: V = [mid[0] + sx, mid[1] - width * 0.3, mid[2] + sz];
  const r: V = [mid[0] - sx, mid[1] - width * 0.3, mid[2] - sz];
  const below = (p: V, q: V, s: V): V => [(p[0] + q[0] + s[0]) / 3, (p[1] + q[1] + s[1]) / 3 - 1, (p[2] + q[2] + s[2]) / 3];
  k.tri(c, mid, l, paint, below(c, mid, l));
  k.tri(c, r, mid, tone(paint, 0.88), below(c, r, mid));
  k.tri(mid, tip, l, tone(paint, 1.05), below(mid, tip, l));
  k.tri(mid, r, tip, tone(paint, 0.92), below(mid, r, tip));
}

function rainTree(): BufferGeometry {
  const k = new Kit();
  k.prism([0, 0, 0], [0, 3.2, 0], 0.5, 0.38, 5, BARK, { base: tone(BARK, 0.8) });
  k.prism([0, 2.8, 0], [2.6, 8.0, 1.0], 0.28, 0.14, 3, BARK);
  k.prism([0, 2.8, 0], [-2.2, 8.1, -1.4], 0.28, 0.14, 3, BARK);
  // Wide umbrella crown with a shallow underside.
  k.lump(0, 8.4, 0, 8.6, 3.0, 8.2, 8, foliage('#4a7a37', 1), 1, { under: 0.3, upperH: 0.62, upperR: 0.74, jitter: 0.12 });
  return k.geometry();
}

function roundTree(): BufferGeometry {
  const k = new Kit();
  k.prism([0, 0, 0], [0, 2.6, 0], 0.3, 0.22, 5, BARK, { base: tone(BARK, 0.8) });
  k.lump(0, 5.0, 0, 3.4, 2.6, 3.2, 7, foliage('#4f7f36', 2), 2, { jitter: 0.2 });
  return k.geometry();
}

function coconutPalm(): BufferGeometry {
  const k = new Kit();
  const pts: V[] = [
    [0, 0, 0],
    [0.35, 3.5, 0],
    [1.0, 6.5, 0.1],
    [1.9, 9.0, 0.2],
  ];
  for (let i = 0; i < 3; i++) k.prism(pts[i], pts[i + 1], 0.2 - i * 0.015, 0.185 - i * 0.015, 4, PALM_TRUNK, i === 0 ? { base: tone(PALM_TRUNK, 0.8) } : {});
  const c = pts[3];
  for (let i = 0; i < 6; i++) frond(k, c, (i / 6) * Math.PI * 2 + 0.3, 4.2, 0.55, 1.9, 0.45, i === 4 ? '#9a8a4a' : '#6a9a3a');
  return k.geometry();
}

function sugarPalm(): BufferGeometry {
  const k = new Kit();
  const trunk = '#6e6356';
  k.prism([0, 0, 0], [0, 12.2, 0], 0.36, 0.28, 5, trunk, { base: tone(trunk, 0.8) });
  const cy = 13.2;
  k.lump(0, cy, 0, 2.3, 2.0, 2.3, 6, foliage('#4d7a33', 3), 3, { under: 0.7 });
  // Stiff fan leaves sticking out all round the crown.
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const el = [0.7, 0.05, -0.45][i % 3];
    const dx = Math.cos(a) * Math.cos(el);
    const dy = Math.sin(el);
    const dz = Math.sin(a) * Math.cos(el);
    const p: V = [dx * 1.6, cy + dy * 1.6, dz * 1.6];
    const tip = (spread: number): V => {
      const b = a + spread;
      return [Math.cos(b) * Math.cos(el) * 3.9, cy + dy * 3.9 + spread * 0.4, Math.sin(b) * Math.cos(el) * 3.9];
    };
    const inside: V = [0, cy, 0];
    const green = i % 2 ? '#5b8a3a' : '#527f35';
    k.tri(p, tip(-0.42), tip(0), green, inside);
    k.tri(p, tip(0), tip(0.42), tone(green, 1.08), inside);
  }
  return k.geometry();
}

function royalPalm(): BufferGeometry {
  const k = new Kit();
  const trunk = '#b8b4aa';
  k.prism([0, 0, 0], [0, 7, 0], 0.42, 0.47, 6, trunk, { base: tone(trunk, 0.8) });
  k.prism([0, 7, 0], [0, 15, 0], 0.47, 0.32, 6, trunk);
  k.prism([0, 15, 0], [0, 17.2, 0], 0.34, 0.3, 5, '#5f8a3c');
  const c: V = [0, 17.2, 0];
  for (let i = 0; i < 7; i++) frond(k, c, (i / 7) * Math.PI * 2, 4.8, 1.1, 2.6, 0.5, i === 6 ? '#8f8a4a' : '#5f9337');
  return k.geometry();
}

function yangNa(): BufferGeometry {
  const k = new Kit();
  const trunk = '#9a948a';
  k.prism([0, 0, 0], [0, 22, 0], 0.55, 0.28, 6, trunk, { base: tone(trunk, 0.75) });
  k.lump(0, 23.5, 0, 4.8, 3.2, 4.4, 7, foliage('#557d3a', 4), 4);
  k.lump(2.2, 21.8, -1.5, 3.0, 2.0, 2.8, 5, foliage('#557d3a', 5), 5);
  return k.geometry();
}

function bodhi(): BufferGeometry {
  const k = new Kit();
  k.prism([0, 0, 0], [0, 3.6, 0], 0.75, 0.5, 6, BARK_GREY, { base: tone(BARK_GREY, 0.75) });
  k.prism([0, 3.2, 0], [3.0, 8.0, 0.8], 0.3, 0.16, 3, BARK_GREY);
  k.prism([0, 3.2, 0], [-2.6, 8.2, 1.6], 0.3, 0.16, 3, BARK_GREY);
  k.prism([0, 3.2, 0], [0.2, 8.4, -2.8], 0.3, 0.16, 3, BARK_GREY);
  k.lump(0, 8.8, 0, 7.5, 4.0, 7.0, 8, foliage('#5d8f3c', 6), 6, { under: 0.4 });
  k.lump(2.5, 10.4, -2.0, 4.5, 3.0, 4.2, 6, foliage('#5d8f3c', 7), 7);
  // Cloth sashes round the trunk (yellow, red, white) and two wooden props.
  const sash = ['#f2c230', '#c8312b', '#f4f0e6'];
  const band = (y: number, r: number): V[] =>
    Array.from({ length: 6 }, (_, i): V => [Math.cos((i / 6) * Math.PI * 2) * r, y, Math.sin((i / 6) * Math.PI * 2) * r]);
  const lo = band(1.0, 0.8);
  const hi = band(1.45, 0.77);
  for (let i = 0; i < 6; i++) k.quad(lo[i], lo[(i + 1) % 6], hi[(i + 1) % 6], hi[i], sash[i % 3], [0, 1.2, 0]);
  k.prism([2.2, 0, 0.8], [1.5, 4.6, 0.5], 0.09, 0.08, 3, '#8a6a45');
  k.prism([-1.6, 0, -1.9], [-1.2, 4.8, -1.0], 0.09, 0.08, 3, '#8a6a45');
  return k.geometry();
}

function banyan(): BufferGeometry {
  const k = new Kit();
  k.prism([0, 0, 0], [0, 3.8, 0], 0.9, 0.6, 6, BARK_GREY, { base: tone(BARK_GREY, 0.75) });
  k.prism([1.5, 0, 0.9], [0.6, 4.8, 0.4], 0.38, 0.26, 4, BARK_GREY);
  // Aerial roots hanging from the crown.
  const roots: [number, number][] = [
    [3.8, 1.2],
    [-3.2, 2.6],
    [-1.4, -3.9],
    [2.6, -3.0],
  ];
  for (const [x, z] of roots) k.prism([x, 0, z], [x * 1.05, 6.6, z * 1.05], 0.09, 0.06, 3, '#6d6358');
  k.lump(0, 8.0, 0, 7.5, 4.2, 7.2, 8, foliage('#3f6e33', 8), 8, { under: 0.35 });
  k.lump(-2.8, 9.6, 2.4, 4.6, 3.0, 4.4, 6, foliage('#3f6e33', 9), 9);
  return k.geometry();
}

function teak(): BufferGeometry {
  const k = new Kit();
  k.prism([0, 0, 0], [0, 6.2, 0], 0.32, 0.24, 5, '#6a5a48', { base: tone('#6a5a48', 0.8) });
  k.lump(0, 9.5, 0, 3.6, 4.2, 3.4, 7, foliage('#6f8f3f', 10, [['#b59a55', 0.1]]), 10, { under: 0.5 });
  k.lump(0.4, 13.2, -0.3, 2.2, 1.8, 2.0, 5, foliage('#6f8f3f', 11), 11);
  return k.geometry();
}

function frangipani(): BufferGeometry {
  const k = new Kit();
  const bark = '#8c8378';
  k.prism([0, 0, 0], [0, 1.5, 0], 0.2, 0.16, 4, bark);
  const tips: V[] = [
    [1.4, 3.3, 0.3],
    [-1.0, 3.5, 1.1],
    [-0.3, 3.2, -1.3],
  ];
  tips.forEach((t, i) => {
    k.prism([0, 1.4, 0], t, 0.13, 0.09, 3, bark);
    k.lump(t[0], t[1] + 0.2, t[2], 1.25, 0.8, 1.2, 5, foliage('#5f8a3c', 12 + i, [['#f7f1e2', 0.16], ['#f4b9c8', 0.08]]), 12 + i, { under: 0.5, jitter: 0.22 });
  });
  return k.geometry();
}

function bougainvillea(): BufferGeometry {
  const k = new Kit();
  const paint = foliage('#d23f8c', 15, [['#3e6b35', 0.35], ['#f07b2a', 0.06]]);
  k.lump(0, 1.35, 0, 1.9, 1.35, 1.8, 6, paint, 15, { under: 0.98, jitter: 0.22 });
  k.lump(0.8, 2.3, -0.4, 1.2, 0.9, 1.1, 5, paint, 16, { jitter: 0.22 });
  return k.geometry();
}

function goldenShower(): BufferGeometry {
  const k = new Kit();
  k.prism([0, 0, 0], [0, 4.4, 0], 0.26, 0.2, 5, '#6b5a48', { base: tone('#6b5a48', 0.8) });
  k.lump(0, 7.2, 0, 3.8, 2.8, 3.6, 7, foliage('#5a8a3a', 17, [['#f2c230', 0.25]]), 17);
  // Hanging chains of yellow flowers.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const x = Math.cos(a) * 2.6;
    const z = Math.sin(a) * 2.5;
    k.prism([x, 6.3, z], [x, 4.8, z], 0.35, 0, 3, '#f2c230');
  }
  return k.geometry();
}

function banana(): BufferGeometry {
  const k = new Kit();
  const stems: V[] = [
    [0.3, 0, 0.1],
    [-0.25, 0, 0.3],
    [0, 0, -0.35],
  ];
  const leaf = '#7bb04a';
  stems.forEach((s, i) => {
    const top: V = [s[0] * 1.6, 2.1 + i * 0.25, s[2] * 1.6];
    k.prism(s, top, 0.12, 0.1, 3, '#7a8a4a');
    for (let j = 0; j < 2; j++) {
      const a = Math.atan2(s[2], s[0]) + (j ? 1.1 : -0.9) + i * 0.4;
      frond(k, top, a, 2.1, 0.55, 0.75, 0.38, (i + j) % 3 === 2 ? '#a09a50' : leaf);
    }
  });
  return k.geometry();
}

const BUILDERS: Record<string, () => BufferGeometry> = {
  rain: rainTree,
  round: roundTree,
  palm: coconutPalm,
  yang: yangNa,
  bodhi,
  banyan,
  teak,
  sugar_palm: sugarPalm,
  royal_palm: royalPalm,
  frangipani,
  bougainvillea,
  golden_shower: goldenShower,
  banana,
};

/**
 * Tree geometry for a kind in TREE_KINDS (src/world3d/build/context.ts):
 * rain tree, generic round-crowned yard tree (mango), coconut palm, yang na,
 * bodhi (with sashes and props), banyan, teak, sugar palm, royal palm,
 * frangipani, bougainvillea bush, golden shower and banana.
 */
export function treeGeometry(kind: string): BufferGeometry {
  return (BUILDERS[kind] ?? roundTree)();
}
