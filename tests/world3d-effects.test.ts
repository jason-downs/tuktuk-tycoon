import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROAD_SETS } from '../src/content/events';
import { Projection } from '../src/geo';
import { ccw, FX, moatGaps, pieceEnds, segDist, signedArea } from '../src/world3d/build/effects';
import { buildCity } from '../src/world3d/build/world';
import { ringOf, type CityData } from '../src/world3d/city';
import landmarks from '../src/content/landmarks.json';

const city = JSON.parse(readFileSync(new URL('../public/data/city3d.json', import.meta.url), 'utf8')) as CityData;
const proj = new Projection(city.origin);
const lm = (id: string) => {
  const l = (landmarks as { id: string; lat: number; lon: number }[]).find((m) => m.id === id)!;
  return proj.toXY(l.lon, l.lat);
};
const boxOf = (set: string) => {
  const [s, w, n, e] = ROAD_SETS[set].box!;
  const [x0, y0] = proj.toXY(w, s);
  const [x1, y1] = proj.toXY(e, n);
  return [x0, y0, x1, y1];
};

describe('effect anchors from the city data', () => {
  const built = buildCity(city);
  const fx = (kind: string) => built.props[kind] ?? new Float32Array(0);
  const count = (kind: string) => fx(kind).length / 4;

  it('are finite and counted', () => {
    const counts: Record<string, number> = {};
    for (const kind of Object.values(FX)) {
      const a = fx(kind);
      counts[kind] = a.length / 4;
      for (let i = 0; i < a.length; i++) expect(Number.isFinite(a[i])).toBe(true);
    }
    console.log('effect anchors', counts);
  });

  it('hang Yi Peng lanterns over Tha Phae Rd, Ratchadamnoen, Moon Muang and the moat causeways', () => {
    const a = fx(FX.lanternYiPeng);
    expect(count(FX.lanternYiPeng)).toBeGreaterThan(250);
    const tp = boxOf('tha_phae_rd');
    const rd = boxOf('ratchadamnoen');
    let onThaPhae = 0;
    let onRatchadamnoen = 0;
    for (let i = 0; i < a.length; i += 4) {
      const [x, y, , half] = [a[i], a[i + 1], a[i + 2], a[i + 3]];
      // Strings span a street: a few metres either side, never absurd.
      expect(half).toBeGreaterThan(1.5);
      expect(half).toBeLessThan(14);
      if (x >= tp[0] && x <= tp[2] && y >= tp[1] && y <= tp[3]) onThaPhae++;
      if (x >= rd[0] && x <= rd[2] && y >= rd[1] && y <= rd[3]) onRatchadamnoen++;
    }
    // Tha Phae Rd (~1 km) and Ratchadamnoen (~1.1 km) get a string every ~10 m.
    expect(onThaPhae).toBeGreaterThan(70);
    expect(onRatchadamnoen).toBeGreaterThan(80);
  });

  it('strings lanterns over the causeway at every city gate', () => {
    const a = fx(FX.lanternYiPeng);
    for (const gate of ['tha_phae_gate', 'chang_phueak_gate', 'suan_dok_gate', 'saen_pung_gate', 'chiang_mai_gate']) {
      const [gx, gy] = lm(gate);
      let near = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.hypot(a[i] - gx, a[i + 1] - gy) < 70) near++;
      expect(near, gate).toBeGreaterThanOrEqual(3);
    }
  });

  it('finds a crossing in every gap between moat pieces', () => {
    const moat = city.areas.filter((x) => city.areaKinds[x.k] === 'moat').map((x) => ccw(ringOf(x.r)));
    // OSM splits the moat at each road crossing: 19 pieces around the loop.
    expect(moatGaps(moat).length).toBeGreaterThanOrEqual(15);
  });

  it('puts walking-street stalls on the closed roads, three rows on Ratchadamnoen', () => {
    const sun = fx(FX.stallSunday);
    const sat = fx(FX.stallSaturday);
    expect(count(FX.stallSunday)).toBeGreaterThan(600);
    expect(count(FX.stallSaturday)).toBeGreaterThan(250);
    const rd = boxOf('ratchadamnoen');
    const pad = 15;
    for (let i = 0; i < sun.length; i += 4) {
      expect(sun[i]).toBeGreaterThan(rd[0] - pad);
      expect(sun[i]).toBeLessThan(rd[2] + pad);
      expect(sun[i + 1]).toBeGreaterThan(rd[1] - pad);
      expect(sun[i + 1]).toBeLessThan(rd[3] + pad);
    }
    const wl = boxOf('wualai');
    for (let i = 0; i < sat.length; i += 4) {
      expect(sat[i]).toBeGreaterThan(wl[0] - pad);
      expect(sat[i]).toBeLessThan(wl[2] + pad);
    }
    // Ratchadamnoen is ~1.1 km: three rows at 2.4 m spacing, minus junction gaps.
    expect(count(FX.stallSunday) / 3).toBeGreaterThan(250);
  });

  it('lines the Night Bazaar with pavement stalls', () => {
    const [bx, by] = lm('night_bazaar');
    const a = fx(FX.stallBazaar);
    expect(count(FX.stallBazaar)).toBeGreaterThan(200);
    for (let i = 0; i < a.length; i += 4) expect(Math.hypot(a[i] - bx, a[i + 1] - by)).toBeLessThan(440);
  });

  it('lays the krathong path down the Ping from Nawarat Bridge to the Iron Bridge', () => {
    const a = fx(FX.river);
    expect(count(FX.river)).toBeGreaterThan(20);
    const [nx, ny] = lm('nawarat_bridge');
    const [ix, iy] = lm('iron_bridge');
    const first = [a[0], a[1]];
    const last = [a[a.length - 4], a[a.length - 3]];
    expect(Math.hypot(first[0] - nx, first[1] - ny)).toBeLessThan(120);
    expect(Math.hypot(last[0] - ix, last[1] - iy)).toBeLessThan(120);
    // Downstream is south here: the flow heading points roughly south (−π/2).
    let south = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.sin(a[i + 2]) < -0.5) south++;
    expect(south / count(FX.river)).toBeGreaterThan(0.8);
    for (let i = 3; i < a.length; i += 4) expect(a[i]).toBeGreaterThanOrEqual(4);
  });

  it('places candles near Tha Phae Gate and moat-bank points outside the water', () => {
    const [gx, gy] = lm('tha_phae_gate');
    const c = fx(FX.candle);
    expect(count(FX.candle)).toBeGreaterThan(1000);
    for (let i = 0; i < c.length; i += 4) expect(Math.hypot(c[i] - gx, c[i + 1] - gy)).toBeLessThan(1100);
    expect(count(FX.moat)).toBeGreaterThan(500);
    expect(count(FX.mist)).toBeGreaterThan(200);
  });

  it('is deterministic', () => {
    const again = buildCity(city);
    for (const kind of Object.values(FX)) expect(Array.from(again.props[kind] ?? [])).toEqual(Array.from(fx(kind)));
  });
});

describe('effect geometry helpers', () => {
  it('orients rings counter-clockwise', () => {
    const cw: [number, number][] = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ];
    expect(signedArea(cw)).toBeLessThan(0);
    expect(signedArea(ccw(cw))).toBeGreaterThan(0);
  });

  it('finds the ends of a water piece and the gap between two pieces', () => {
    // Two 100 × 16 m channels along x with a 20 m causeway between them.
    const west: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 16],
      [0, 16],
    ];
    const east: [number, number][] = west.map(([x, y]) => [x + 120, y]);
    const ends = pieceEnds(west).sort((a, b) => a[0] - b[0]);
    expect(ends[0][0]).toBeCloseTo(0);
    expect(ends[0][1]).toBeCloseTo(8);
    expect(ends[1][0]).toBeCloseTo(100);
    const gaps = moatGaps([west, east]);
    expect(gaps.length).toBe(1);
    const [a, b] = gaps[0];
    expect(Math.min(a[0], b[0])).toBeCloseTo(100);
    expect(Math.max(a[0], b[0])).toBeCloseTo(120);
    // A road crossing the causeway at x = 110 is on it; one 40 m away is not.
    expect(segDist(110, 8, a, b)).toBeLessThan(1);
    expect(segDist(110, 48, a, b)).toBeGreaterThan(30);
  });
});
