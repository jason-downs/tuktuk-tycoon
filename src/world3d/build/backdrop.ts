// Doi Suthep–Doi Pui massif on the western horizon (not drivable).

import type { CityData } from '../city';
import { mix, shade, type MeshWriter, type RGB } from './mesh';
import { P } from './palette';
import { frustum, type V3 } from './shapes';

/** Procedural Doi Suthep–Doi Pui massif west of the city (docs/3d/world.md §1.8). */
export function mountains(w: MeshWriter, city: CityData): void {
  const o = city.origin;
  const mPerLon = 111_320 * Math.cos((o.lat * Math.PI) / 180);
  const xy = (lon: number, lat: number): [number, number] => [(lon - o.lon) * mPerLon, (lat - o.lat) * 110_574];
  // [lon, lat, height above the city (m), sigma (m)]
  const peaks: [number, number, number, number][] = [
    [98.8975, 18.8065, 1366, 2600], // Doi Suthep summit, 1,676 m
    [98.8855, 18.8275, 1375, 2300], // Doi Pui, 1,685 m
    [98.905, 18.772, 950, 2600],
    [98.89, 18.86, 1000, 3000],
    [98.9, 18.74, 700, 3000],
    [98.93, 18.83, 350, 1500],
  ].map(([lon, lat, h, s]) => [...xy(lon, lat), h, s] as [number, number, number, number]);
  const [cityWest] = xy(98.938, 18.79);
  const height = (x: number, y: number) => {
    let h = 0;
    for (const [px, py, ph, s] of peaks) h += ph * Math.exp(-((x - px) ** 2 + (y - py) ** 2) / (2 * s * s));
    // Rolling foothills.
    h += 60 * Math.sin(x / 900) * Math.cos(y / 1100) + 40 * Math.sin((x + y) / 530);
    const fade = Math.min(1, Math.max(0, (cityWest - x) / 1800));
    return Math.max(0, h * fade * fade) - 0.5;
  };
  const x0 = cityWest - 13_000;
  const x1 = cityWest + 400;
  const y0 = -14_000;
  const y1 = 16_000;
  const nx = 60;
  const ny = 120;
  const dx = (x1 - x0) / nx;
  const dy = (y1 - y0) / ny;
  const colour = (h: number): RGB => (h > 700 ? P.mountainHigh : mix(P.groundFar, P.mountain, Math.min(1, h / 250)));
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const ax = x0 + i * dx;
      const ay = y0 + j * dy;
      const p00: V3 = [ax, ay, height(ax, ay)];
      const p10: V3 = [ax + dx, ay, height(ax + dx, ay)];
      const p11: V3 = [ax + dx, ay + dy, height(ax + dx, ay + dy)];
      const p01: V3 = [ax, ay + dy, height(ax, ay + dy)];
      if (p00[2] <= 0 && p10[2] <= 0 && p11[2] <= 0 && p01[2] <= 0) continue;
      const c = colour((p00[2] + p11[2]) / 2);
      w.tri(p00, p10, p11, c);
      w.tri(p00, p11, p01, shade(c, 0.96));
    }
  }
  // Gold glint of Wat Phra That Doi Suthep on its ledge (1,060 m).
  const [tx, ty] = xy(98.9221, 18.80492);
  const th = height(tx, ty);
  frustum(w, tx, ty, 9, 0.5, th, th + 26, 8, P.gold, false);
}
