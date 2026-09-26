// Tree placement: OSM trees and tree rows, moat banks, parks and temple
// grounds, and street trees on major roads.

import { ringOf, ROAD_FLAG } from '../city';
import { TREE_KINDS, type BuildContext, type TreeKind } from './context';
import { hash01 } from './mesh';
import { alongLine, bbox, pointInRing } from './shapes';

export function scatterTrees(ctx: BuildContext): void {
  const { city, occ, parkAreas, moatRings, roadPts } = ctx;
  // ---- trees
  const trees = ctx.trees;
  const addTree = (x: number, y: number, kind: TreeKind, scale: number) => {
    trees.push(x, y, scale, TREE_KINDS.indexOf(kind));
    occ.markDisc(x, y, 2.5);
  };
  for (let i = 0; i < city.trees.length; i += 3) {
    const x = city.trees[i] / 10;
    const y = city.trees[i + 1] / 10;
    const sp = city.species[city.trees[i + 2]] ?? '';
    const kind: TreeKind = /Albizia|Samanea/.test(sp) ? 'rain' : /Dipterocarpus/.test(sp) ? 'yang' : /Ficus/.test(sp) ? 'bodhi' : 'round';
    addTree(x, y, kind, 0.85 + hash01(i, 7) * 0.4);
  }
  for (const l of city.lines) {
    if (city.lineKinds[l.k] !== 'tree_row') continue;
    alongLine(ringOf(l.p), 9, (x, y, n) => {
      if (occ.free(x, y)) addTree(x, y, hash01(n, 3) < 0.3 ? 'palm' : 'rain', 0.8 + hash01(n, 5) * 0.4);
    });
  }
  // Moat banks: a tree every ~12 m just outside the water.
  let seed = 1;
  for (const ring of moatRings) {
    for (const side of [-4.5, 4.5]) {
      alongLine([...ring, ring[0]], 12, (x, y, n, nx, ny) => {
        const px = x + nx * side;
        const py = y + ny * side;
        if (occ.free(px, py) && !moatRings.some((r) => pointInRing(px, py, r))) {
          const u = hash01(n + seed * 7919, 11);
          addTree(px, py, u < 0.35 ? 'rain' : u < 0.55 ? 'palm' : u < 0.7 ? 'bodhi' : 'round', 0.75 + hash01(n, 13) * 0.45);
        }
      });
      seed++;
    }
  }
  // Parks, temple grounds, campuses: jittered grid.
  for (const { ring, kind } of parkAreas) {
    const spacing = kind === 'forest' ? 11 : kind === 'temple' ? 14 : kind === 'campus' || kind === 'school' || kind === 'hospital' ? 20 : kind === 'cemetery' ? 14 : 13;
    const [x0, y0, x1, y1] = bbox(ring);
    if ((x1 - x0) * (y1 - y0) > 4e6) continue;
    let n = 0;
    for (let y = y0; y <= y1; y += spacing) {
      for (let x = x0; x <= x1; x += spacing) {
        n++;
        const jx = x + (hash01(n + Math.round(x0), 17) - 0.5) * spacing * 0.8;
        const jy = y + (hash01(n + Math.round(y0), 19) - 0.5) * spacing * 0.8;
        if (!pointInRing(jx, jy, ring) || !occ.free(jx, jy)) continue;
        if (hash01(n, 23) < (kind === 'forest' ? 0.15 : 0.35)) continue;
        const u = hash01(n + Math.round(x0 * 3), 29);
        const tk: TreeKind = kind === 'temple' ? (u < 0.3 ? 'bodhi' : u < 0.5 ? 'palm' : 'round') : u < 0.45 ? 'rain' : u < 0.6 ? 'palm' : 'round';
        addTree(jx, jy, tk, 0.7 + hash01(n, 31) * 0.5);
      }
    }
  }
  // Street trees on major roads.
  city.roads.ways.forEach((way, wi) => {
    const [cls, flags, widthDm] = way;
    if (cls > 2 || flags & ROAD_FLAG.BRIDGE) return;
    const pts = roadPts[wi];
    const side = widthDm / 20 + 2.6;
    alongLine(pts, 18, (x, y, n, nx, ny) => {
      for (const s of [side, -side]) {
        const px = x + nx * s;
        const py = y + ny * s;
        if (hash01(n * 2 + (s > 0 ? 1 : 0) + wi * 131, 37) < 0.55 && occ.free(px, py)) {
          addTree(px, py, hash01(n + wi, 41) < 0.3 ? 'palm' : 'rain', 0.7 + hash01(n, 43) * 0.35);
        }
      }
    });
  });

}
