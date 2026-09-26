// Wat Chedi Luang (docs/3d/world.md §2.8 #4): the ruined brick and laterite
// chedi, modelled 55 m tall on its OSM 58 m square base. Stepped square
// terraces, naga staircases on all four sides up to the niche level, niches
// with a gold Buddha facing east, elephant sculptures along the south
// terrace, and the broken stump of the bell with moss on the break.

import { BC } from './buildingPalette';
import type { ChediSpec } from './chedi';
import type { BuildContext } from './context';
import { basis, bdir, beam, bp, cbox, face, lathe, obox, SIDE, tri3, UP } from './kit';
import { hash01, mix, shade, type RGB } from './mesh';

export function chediLuang(ctx: BuildContext, spec: ChediSpec, key: number): void {
  const w = ctx.w.buildings;
  const S = spec.side;
  const H = spec.height;
  const b = basis(spec.x, spec.y, spec.ang);
  const brick = mix(BC.chediLuang, BC.chediLuangTan, 0.35);
  const tone = (k: number): RGB => mix(brick, k % 2 ? BC.laterite : BC.lichen, 0.12 + hash01(key + k, 601) * 0.18);
  // Terraces: [half-side fraction, top height fraction].
  const tiers: [number, number][] = [
    [0.5, 0.045],
    [0.44, 0.165],
    [0.385, 0.29],
    [0.335, 0.42],
    [0.285, 0.565],
  ];
  let h = 0;
  tiers.forEach(([f, top], k) => {
    const r = S * f;
    const c = tone(k);
    obox(w, b, -r, r, -r, r, h, H * top, shade(c, 0.82), c, mix(c, BC.moss, 0.3));
    h = H * top;
  });
  const nicheBase = H * 0.435;
  const rTop = S * 0.285;
  // Niches on the four faces of the top terrace, the east one with a gold Buddha.
  for (let side = 0; side < 4; side++) {
    const ang = spec.ang + (side * Math.PI) / 2;
    const sb = basis(spec.x, spec.y, ang);
    const [dx, dy] = bdir(sb, 1, 0);
    face(w, bp(sb, rTop + 0.05, -2.2, nicheBase), bp(sb, rTop + 0.05, 2.2, nicheBase), bp(sb, rTop + 0.05, 2.2, nicheBase + 5.5), bp(sb, rTop + 0.05, -2.2, nicheBase + 5.5), BC.lacquerBlack, shade(BC.lacquerBlack, 1.4), [dx, dy, 0]);
    // Stepped pediment over the niche.
    obox(w, sb, rTop, rTop + 0.8, -3, 3, nicheBase + 5.5, nicheBase + 6.6, tone(side + 7), tone(side + 7), mix(tone(side + 7), BC.moss, 0.35));
    const eastish = Math.cos(ang) > 0.7;
    if (eastish) {
      cbox(w, sb, rTop - 0.4, 0, 1.2, 1.6, nicheBase, nicheBase + 0.8, BC.goldDark, BC.gold, BC.gold);
      lathe(w, ...(bp(sb, rTop - 0.4, 0, 0).slice(0, 2) as [number, number]), [
        [0.7, nicheBase + 0.8],
        [0.55, nicheBase + 2.4],
        [0.35, nicheBase + 3.0],
        [0, nicheBase + 3.6],
      ], 6, [BC.gold, BC.gold, BC.goldLit, BC.goldLit]);
    }
    // Naga staircase from the ground up to the niche level.
    const sw = 3.2;
    const q1 = S * 0.5 + 9;
    const q0 = rTop;
    face(w, bp(sb, q1, -sw, 0.05), bp(sb, q1, sw, 0.05), bp(sb, q0, sw, nicheBase), bp(sb, q0, -sw, nicheBase), shade(brick, 0.85), brick, UP);
    for (const sv of [-1, 1]) {
      const [nx, ny] = bdir(sb, 0, sv);
      tri3(w, bp(sb, q1, sv * sw, 0.05), bp(sb, q0, sv * sw, 0.05), bp(sb, q0, sv * sw, nicheBase), shade(brick, 0.78), [nx, ny, 0]);
      // Naga balustrade with a raised hooded head at the foot.
      const v = sv * (sw + 0.35);
      beam(w, bp(sb, q1 - 0.5, v, 1.2), bp(sb, q0 + 0.5, v, nicheBase + 1.0), 0.38, 0.3, shade(brick, 0.95), tone(side + 3));
      beam(w, bp(sb, q1 - 0.6, v, 0.6), bp(sb, q1 + 0.3, v, 3.4), 0.6, 0.25, shade(brick, 1.05), mix(brick, BC.moss, 0.3));
    }
  }
  // Elephants along the south-facing side of the lowest terrace.
  let southAng = spec.ang;
  for (let k = 1; k < 4; k++) {
    const a = spec.ang + (k * Math.PI) / 2;
    if (-Math.sin(a) > -Math.sin(southAng)) southAng = a;
  }
  const south = basis(spec.x, spec.y, southAng);
  const ez = H * 0.045;
  for (let k = 0; k < 5; k++) {
    const v = -S * 0.36 + (S * 0.72 * (k + 0.5)) / 5;
    if (Math.abs(v) < 5) continue;
    const u = S * 0.44;
    const grey = k === 2 ? BC.stucco : mix(BC.weathered, brick, 0.35);
    obox(w, south, u - 0.3, u + 1.6, v - 1.1, v + 1.1, ez + 0.8, ez + 3.4, shade(grey, 0.85), grey, grey, SIDE.V0 | SIDE.U1 | SIDE.V1 | SIDE.TOP);
    obox(w, south, u + 1.5, u + 2.5, v - 0.75, v + 0.75, ez + 2.0, ez + 3.7, shade(grey, 0.9), grey, grey, SIDE.V0 | SIDE.U1 | SIDE.V1 | SIDE.TOP);
    beam(w, bp(south, u + 2.4, v, ez + 2.3), bp(south, u + 2.8, v, ez + 0.1), 0.26, 0.16, shade(grey, 0.92));
    obox(w, south, u + 1.3, u + 1.5, v - 1.5, v + 1.5, ez + 1.9, ez + 3.8, shade(grey, 0.95), grey, grey, SIDE.U1 | SIDE.U0 | SIDE.TOP);
    for (const dv of [-0.65, 0.65]) cbox(w, south, u + 1.0, v + dv, 0.7, 0.7, ez, ez + 1.2, shade(grey, 0.8), grey, grey, SIDE.SIDES);
  }
  // Round base and the broken bell.
  const top = H * 0.565;
  const rb = S * 0.25;
  const bell = tone(9);
  lathe(w, spec.x, spec.y, [
    [rb, top],
    [rb, top + H * 0.04],
    [rb * 0.93, top + H * 0.04],
    [rb * 0.93, top + H * 0.07],
    [rb * 0.9, top + H * 0.14],
    [rb * 0.78, top + H * 0.22],
    [rb * 0.6, top + H * 0.28],
  ], 16, [bell, bell, tone(10), tone(10), bell, bell, mix(bell, BC.moss, 0.25)], spec.ang);
  // Jagged stump where the spire fell (1545).
  const stump = top + H * 0.28;
  lathe(w, spec.x + 0.8, spec.y - 0.5, [
    [rb * 0.6, stump - 0.2],
    [rb * 0.42, stump + H * 0.05],
    [rb * 0.22, stump + (H - stump) * 0.8],
    [rb * 0.08, H],
  ], 7, [mix(bell, BC.moss, 0.3), mix(bell, BC.moss, 0.45), mix(bell, BC.lichen, 0.4), BC.moss], spec.ang + 0.2);
  ctx.occ.markRing(
    [
      [-S / 2 - 9, -S / 2 - 9],
      [S / 2 + 9, -S / 2 - 9],
      [S / 2 + 9, S / 2 + 9],
      [-S / 2 - 9, S / 2 + 9],
    ].map(([u, v]) => bp(b, u, v, 0).slice(0, 2) as [number, number]),
    0,
  );
}
