// Lanna temple architecture: viharn (assembly hall) and chedi (stupa).

import type { CityBuilding } from '../city';
import { hash01, shade, type MeshWriter, type RGB } from './mesh';
import { P } from './palette';
import { at, box, frameOf, frustum, gableRoof, hexOf, hipRoof, type Frame, type Ring } from './shapes';

export function viharn(w: MeshWriter, b: CityBuilding, ring: Ring): void {
  const f = frameOf(b, ring);
  const wallH = 3.6;
  w.walls(ring, 0, 1, shade(P.templeWhite, 0.85), P.templeWhite);
  w.walls(ring, 1, wallH, P.templeWhite, P.templeWhite);
  w.polygon(ring, undefined, wallH, P.templeWhite);
  const roofRed = hash01(b.id, 2) < 0.5 ? P.templeRoofRed : P.templeRoofOrange;
  // Lower sweeping eave skirt.
  const skirt: Frame = { ...f, L: f.L + 1.2, W: f.W + 2.4 };
  hipRoof(w, skirt, wallH - 0.8, wallH + f.W * 0.3, 0.6, shade(roofRed, 0.9));
  // Main tier and a shorter, higher upper tier.
  const main: Frame = { ...f, L: f.L * 0.92, W: f.W * 0.86 };
  gableRoof(w, main, wallH + f.W * 0.18, wallH + f.W * 0.62, 0.4, roofRed, P.lacquerRed);
  const upper: Frame = { ...f, L: f.L * 0.55, W: f.W * 0.62 };
  gableRoof(w, upper, wallH + f.W * 0.42, wallH + f.W * 0.8, 0.3, shade(roofRed, 1.1), P.gold);
  // Gold chofa finials at the gable peaks.
  for (const s of [-1, 1]) {
    const [x, y] = at(f, (s * main.L) / 2 + s * 0.3, 0, 0);
    frustum(w, x, y, 0.25, 0.02, wallH + f.W * 0.62, wallH + f.W * 0.62 + 2.2, 4, P.gold, false);
    const [x2, y2] = at(f, (s * upper.L) / 2 + s * 0.2, 0, 0);
    frustum(w, x2, y2, 0.2, 0.02, wallH + f.W * 0.8, wallH + f.W * 0.8 + 1.8, 4, P.gold, false);
  }
}

/**
 * Chedi (stupa) on a square base: stepped plinth, octagonal drum, bell, and a
 * ringed spire. Finish by hash: white with gold spire, all gold, weathered, or
 * ruined brick (Wat Chedi Luang style for very large, brown-tagged footprints).
 */
export function chedi(w: MeshWriter, b: CityBuilding, ring: Ring, colour: string, sizeOverride?: number): void {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of ring) {
    cx += x;
    cy += y;
  }
  cx /= ring.length;
  cy /= ring.length;
  const s = sizeOverride ?? Math.sqrt(Math.max(9, b.a));
  const u = hash01(b.id, 12);
  const ruin = s > 40 || /^#?b79f7b$/i.test(colour) || u > 0.9;
  const finish = ruin ? 'ruin' : u < 0.45 ? 'white' : u < 0.75 ? 'gold' : 'weathered';
  const body = finish === 'gold' ? P.gold : finish === 'ruin' ? hexOf('#9b6b4f') : finish === 'weathered' ? hexOf('#cfcabd') : P.templeWhite;
  const spire = finish === 'ruin' ? hexOf('#8f5d43') : P.gold;
  const ang = b.o ? b.o[2] / 1000 : 0;
  let h = 0;
  const tier = (frac: number, hh: number, c: RGB) => {
    box(w, cx, cy, s * frac, s * frac, h, h + hh, ang, shade(c, 0.9), c);
    h += hh;
  };
  tier(1, s * 0.1, body);
  tier(0.86, s * 0.1, body);
  tier(0.72, s * 0.09, body);
  if (finish === 'ruin' && s > 40) {
    // Wat Chedi Luang: huge truncated brick mass with stepped terraces.
    tier(0.6, s * 0.12, body);
    tier(0.48, s * 0.1, body);
    frustum(w, cx, cy, s * 0.22, s * 0.14, h, h + s * 0.12, 8, shade(body, 1.05), true, Math.PI / 8);
    return;
  }
  frustum(w, cx, cy, s * 0.3, s * 0.3, h, h + s * 0.12, 8, body, false, Math.PI / 8);
  h += s * 0.12;
  // Bell.
  frustum(w, cx, cy, s * 0.3, s * 0.26, h, h + s * 0.14, 8, body, false, Math.PI / 8);
  frustum(w, cx, cy, s * 0.26, s * 0.12, h + s * 0.14, h + s * 0.32, 8, body, false, Math.PI / 8);
  h += s * 0.32;
  box(w, cx, cy, s * 0.2, s * 0.2, h, h + s * 0.06, ang, body, body);
  h += s * 0.06;
  // Ringed spire.
  frustum(w, cx, cy, s * 0.09, s * 0.015, h, h + s * 0.85, 8, spire, false, Math.PI / 8);
  for (let k = 0; k < 5; k++) frustum(w, cx, cy, s * (0.1 - k * 0.014), s * (0.1 - k * 0.014), h + k * s * 0.07, h + k * s * 0.07 + s * 0.025, 8, shade(spire, 1.1), true, Math.PI / 8);
}
