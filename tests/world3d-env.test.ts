import { afterEach, describe, expect, it } from 'vitest';
import { calendar, daylight, timeOf } from '../src/sim/clock';
import type { WeatherNow } from '../src/sim/weather';
import { atmosphereLook, coolSeasonMist, lightningFlash, stepWetness, CLEAR_BACKDROP_HAZE } from '../src/world3d/env/atmosphere';
import { festivalsAt } from '../src/world3d/env/festivals';
import { KEYS, timeOfDay } from '../src/world3d/env/lighting';
import { DEFAULT_QUALITY, QUALITY, qualityLevel, qualityPreset, resetQualityCache, setQuality } from '../src/world3d/env/quality';
import { dayOfYear, moonIllumination, moonPhase, moonPosition, skyDirection, solarPosition } from '../src/world3d/env/sun';

const DEG = Math.PI / 180;
const at = (y: number, m: number, d: number, h: number) => calendar(timeOf(y, m, d, h));
const elevDeg = (y: number, m: number, d: number, h: number) => solarPosition(at(y, m, d, h)).elevation / DEG;

/** First hour (to the minute) when the sun's centre reaches −0.833° (standard sunrise), scanning from `from`. */
function crossing(y: number, m: number, d: number, from: number, to: number): number {
  const step = 1 / 60;
  let prev = elevDeg(y, m, d, from) + 0.833;
  for (let h = from + step; h <= to; h += step) {
    const e = elevDeg(y, m, d, h) + 0.833;
    if (Math.sign(e) !== Math.sign(prev)) return h;
    prev = e;
  }
  return Number.NaN;
}

describe('sun path over Chiang Mai (18.79 N)', () => {
  it('peaks at 50–57° at noon in November and climbs past 80° at Songkran', () => {
    for (let d = 1; d <= 30; d++) {
      let peak = -90;
      for (let h = 11; h <= 13.5; h += 1 / 30) peak = Math.max(peak, elevDeg(2026, 10, d, h));
      expect(peak).toBeGreaterThan(49);
      expect(peak).toBeLessThan(57.5);
    }
    let songkran = -90;
    for (let h = 11; h <= 13.5; h += 1 / 30) songkran = Math.max(songkran, elevDeg(2027, 3, 13, h));
    // δ ≈ +9° on 13 April: 90 − 18.79 + 9 ≈ 80°.
    expect(songkran).toBeGreaterThan(79.5);
  });

  it('is well below the horizon at midnight', () => {
    expect(elevDeg(2026, 10, 1, 0)).toBeLessThan(-50);
    expect(elevDeg(2026, 10, 24, 0)).toBeLessThan(-50);
    expect(elevDeg(2027, 5, 21, 0)).toBeLessThan(-40);
  });

  it('rises at ≈ 06:25 and sets at ≈ 17:50 in early November, matching daylight()', () => {
    const rise = crossing(2026, 10, 1, 5, 8);
    const set = crossing(2026, 10, 1, 16, 19);
    expect(Math.abs(rise - (6 + 25 / 60))).toBeLessThan(8 / 60);
    expect(Math.abs(set - (17 + 50 / 60))).toBeLessThan(8 / 60);
    // daylight() switches the flat map's lights on the same schedule.
    expect(daylight(rise - 0.7)).toBe(0);
    expect(daylight(rise + 0.7)).toBeGreaterThan(0.9);
    expect(daylight(set + 0.7)).toBe(0);
  });

  it('rises in the east, stands in the south at noon and sets in the west (winter half)', () => {
    const morning = solarPosition(at(2026, 10, 10, 8));
    const noon = solarPosition(at(2026, 10, 10, 12.15));
    const evening = solarPosition(at(2026, 10, 10, 16.5));
    expect(morning.azimuth / DEG).toBeGreaterThan(100);
    expect(morning.azimuth / DEG).toBeLessThan(150);
    expect(Math.abs(noon.azimuth / DEG - 180)).toBeLessThan(8);
    expect(evening.azimuth / DEG).toBeGreaterThan(210);
    expect(evening.azimuth / DEG).toBeLessThan(260);
    expect(morning.hourAngle).toBeLessThan(0);
    expect(evening.hourAngle).toBeGreaterThan(0);
  });

  it('points the world-space direction vector at the sun (X east, Y up, Z south)', () => {
    const v = skyDirection(solarPosition(at(2026, 10, 10, 12.15)), { x: 0, y: 0, z: 0 });
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 6);
    // November noon: high in the south, i.e. +Z in three.js world space.
    expect(v.z).toBeGreaterThan(0.4);
    expect(v.y).toBeGreaterThan(0.75);
    const east = skyDirection({ elevation: 0, azimuth: Math.PI / 2 }, { x: 0, y: 0, z: 0 });
    expect(east.x).toBeCloseTo(1, 6);
    const north = skyDirection({ elevation: 0, azimuth: 0 }, { x: 0, y: 0, z: 0 });
    expect(north.z).toBeCloseTo(-1, 6);
  });

  it('counts days of the year', () => {
    expect(dayOfYear({ year: 2026, month: 0, date: 1 })).toBe(1);
    expect(dayOfYear({ year: 2026, month: 10, date: 1 })).toBe(305);
    expect(dayOfYear({ year: 2028, month: 11, date: 31 })).toBe(366);
  });
});

describe('moon', () => {
  it('is full on the Yi Peng night, 24 Nov 2026', () => {
    const p = moonPhase(timeOf(2026, 10, 24, 21));
    expect(Math.abs(p - 0.5)).toBeLessThan(0.03);
    expect(moonIllumination(p)).toBeGreaterThan(0.98);
    // A week earlier it is near first quarter.
    expect(Math.abs(moonPhase(timeOf(2026, 10, 17, 12)) - 0.25)).toBeLessThan(0.04);
  });

  it('rides high around midnight at full moon', () => {
    const cal = at(2026, 10, 24, 23.9);
    const moon = moonPosition(solarPosition(cal), moonPhase(timeOf(2026, 10, 24, 23.9)));
    expect(moon.elevation / DEG).toBeGreaterThan(60);
  });
});

describe('time-of-day lighting keyframes', () => {
  const look = (y: number, m: number, d: number, h: number) => {
    const cal = at(y, m, d, h);
    const sun = solarPosition(cal);
    const phase = moonPhase(timeOf(y, m, d, h));
    return timeOfDay(sun.elevation, sun.hourAngle < 0, moonPosition(sun, phase).elevation, moonIllumination(phase));
  };

  it('names the phases by sun elevation', () => {
    expect(look(2026, 10, 10, 12).phase).toBe('day');
    expect(look(2026, 10, 10, 7.2).phase).toBe('morning');
    expect(look(2026, 10, 10, 17.2).phase).toBe('golden');
    expect(look(2026, 10, 10, 18.05).phase).toBe('blue');
    expect(look(2026, 10, 10, 23).phase).toBe('night');
  });

  it('uses the world.md colours at the keyframes', () => {
    const noon = look(2026, 10, 10, 12);
    expect(noon.key).toEqual(KEYS.day.key);
    expect(noon.fog).toEqual(KEYS.day.fog);
    const night = look(2026, 10, 10, 23);
    expect(night.zenith).toEqual(KEYS.night.zenith);
    expect(night.fog).toEqual(KEYS.night.fog);
  });

  it('lights windows and lamps at dusk and keeps them off by day', () => {
    const noon = look(2026, 10, 10, 12);
    expect(noon.night).toBe(0);
    expect(noon.lamps).toBe(0);
    expect(noon.stars).toBe(0);
    const blue = timeOfDay(-2.5 * DEG, false, -30 * DEG, 0);
    expect(blue.night).toBeGreaterThan(0.55);
    expect(blue.night).toBeLessThan(0.75);
    expect(blue.lamps).toBe(1);
    // Lamps come on around +2°.
    expect(timeOfDay(2 * DEG, false, -30 * DEG, 0).lamps).toBeCloseTo(0.5, 1);
    const night = look(2026, 10, 10, 23);
    expect(night.night).toBe(1);
    expect(night.stars).toBe(1);
  });

  it('hands the key light to the moon at night, brighter at full moon', () => {
    const dark = timeOfDay(-20 * DEG, false, 45 * DEG, 0.05);
    const full = timeOfDay(-20 * DEG, false, 45 * DEG, 1);
    expect(dark.moonKey).toBe(1);
    expect(full.keyIntensity).toBeGreaterThan(dark.keyIntensity * 1.5);
    expect(full.keyIntensity).toBeLessThan(0.5);
    const moonDown = timeOfDay(-20 * DEG, false, -10 * DEG, 1);
    expect(moonDown.keyIntensity).toBe(0);
  });

  it('changes smoothly through the day (no jumps between samples)', () => {
    let prev = timeOfDay(-30 * DEG, true, -30 * DEG, 0);
    for (let e = -30; e <= 70; e += 0.25) {
      const cur = timeOfDay(e * DEG, true, -30 * DEG, 0);
      expect(Math.abs(cur.keyIntensity - prev.keyIntensity)).toBeLessThan(0.2);
      expect(Math.abs(cur.fog[0] - prev.fog[0])).toBeLessThan(12);
      for (const v of [...cur.key, ...cur.zenith, ...cur.horizon, cur.hemiIntensity, cur.exposure]) expect(Number.isFinite(v)).toBe(true);
      prev = cur;
    }
  });
});

describe('weather → atmosphere', () => {
  const w = (sky: WeatherNow['sky'], haze: WeatherNow['haze'] = 0): WeatherNow => ({ sky, haze, temp: 25, hour: 0 });
  const noonNov = { month: 10, hour: 13 };

  it('leaves clear skies at the time-of-day look', () => {
    const l = atmosphereLook(w('clear'), noonNov);
    expect(l.rain).toBe(0);
    expect(l.fogNear).toBe(1);
    expect(l.fogFar).toBe(1);
    expect(l.keyMul).toBe(1);
    expect(l.backdropHide).toBe(CLEAR_BACKDROP_HAZE);
  });

  it('darkens, wets and pulls the fog in for rain, more for storms', () => {
    const rain = atmosphereLook(w('rain'), noonNov);
    const storm = atmosphereLook(w('storm'), noonNov);
    expect(rain.rain).toBeGreaterThan(0.4);
    expect(storm.rain).toBe(1);
    expect(storm.storm).toBe(1);
    expect(rain.wet).toBe(1);
    expect(rain.fogFar).toBeLessThan(0.7);
    expect(storm.fogFar).toBeLessThan(rain.fogFar);
    expect(rain.keyMul).toBeLessThan(0.5);
    expect(storm.keyMul).toBeLessThan(rain.keyMul);
    expect(storm.darken).toBeGreaterThan(rain.darken);
    expect(rain.cloud).toBeGreaterThan(0.8);
  });

  it('turns smoky haze into brown fog and hides Doi Suthep', () => {
    const clear = atmosphereLook(w('clear'), { month: 2, hour: 11 });
    const haze = atmosphereLook(w('clear', 1), { month: 2, hour: 11 });
    const heavy = atmosphereLook(w('clear', 2), { month: 2, hour: 11 });
    expect(haze.backdropHide).toBe(1);
    expect(heavy.backdropHide).toBe(1);
    expect(clear.backdropHide).toBe(CLEAR_BACKDROP_HAZE);
    expect(clear.backdropHide).toBeLessThan(0.6);
    expect(haze.fogFar).toBeCloseTo(0.5);
    expect(heavy.fogFar).toBeCloseTo(1 / 3);
    // Brownish: red above blue.
    expect(haze.fogTint[0]).toBeGreaterThan(haze.fogTint[2] + 20);
    expect(haze.fogTintAmount).toBeGreaterThan(0.6);
    expect(heavy.keyTintAmount).toBeGreaterThan(0.3);
    // Rain washes the smoke out.
    expect(atmosphereLook(w('rain', 2), { month: 3, hour: 15 }).haze).toBe(0);
  });

  it('brings low mist on cool-season mornings and fog that burns off', () => {
    expect(coolSeasonMist({ month: 10, hour: 6.5 })).toBeGreaterThan(0.9);
    expect(coolSeasonMist({ month: 10, hour: 10 })).toBe(0);
    expect(coolSeasonMist({ month: 5, hour: 6.5 })).toBe(0);
    expect(atmosphereLook(w('clear'), { month: 11, hour: 6.5 }).mist).toBeGreaterThan(0.3);
    const early = atmosphereLook(w('fog'), { month: 0, hour: 6 });
    const late = atmosphereLook(w('fog'), { month: 0, hour: 9 });
    expect(early.mist).toBe(1);
    expect(late.mist).toBeLessThan(early.mist);
    expect(early.fogFar).toBeLessThan(0.4);
    expect(early.backdropHide).toBe(1);
  });

  it('soaks roads quickly and dries them over a couple of game hours', () => {
    expect(stepWetness(0, 1, 600)).toBe(1);
    expect(stepWetness(1, 0, 3600)).toBeCloseTo(0.5);
    expect(stepWetness(1, 0, 7200)).toBe(0);
  });

  it('flashes lightning only in storms, every few seconds and briefly', () => {
    let lit = 0;
    let flashes = 0;
    let max = 0;
    let wasDark = true;
    let darkFor = 0;
    for (let t = 0; t < 600; t += 0.01) {
      expect(lightningFlash(t, 0)).toBe(0);
      const f = lightningFlash(t, 1);
      max = Math.max(max, f);
      if (f > 0) {
        lit++;
        // A new flash starts after at least half a second of darkness (the double stroke counts once).
        if (wasDark && darkFor > 0.5) flashes++;
        wasDark = false;
        darkFor = 0;
      } else {
        wasDark = true;
        darkFor += 0.01;
      }
    }
    expect(max).toBeGreaterThan(0.9);
    expect(600 / flashes).toBeGreaterThan(4);
    expect(600 / flashes).toBeLessThan(10);
    // Lit well under a tenth of the time: flashes, not strobing.
    expect(lit / 60_000).toBeLessThan(0.08);
  });
});

describe('festival calendar in 3D', () => {
  it('hangs Yi Peng lanterns from 22 Nov to the morning of 26 Nov 2026, candles on the festival evenings', () => {
    expect(festivalsAt(timeOf(2026, 10, 20, 20)).yiPengLanterns).toBe(false);
    expect(festivalsAt(timeOf(2026, 10, 22, 14)).yiPengLanterns).toBe(true);
    expect(festivalsAt(timeOf(2026, 10, 24, 12)).yiPengLanterns).toBe(true);
    expect(festivalsAt(timeOf(2026, 10, 24, 19)).yiPengLanterns).toBe(true);
    expect(festivalsAt(timeOf(2026, 10, 26, 3)).yiPengLanterns).toBe(true);
    expect(festivalsAt(timeOf(2026, 10, 27, 12)).yiPengLanterns).toBe(false);
    expect(festivalsAt(timeOf(2026, 10, 24, 19)).yiPengEvening).toBe(true);
    expect(festivalsAt(timeOf(2026, 10, 24, 12)).yiPengEvening).toBe(false);
    expect(festivalsAt(timeOf(2026, 10, 25, 0.5)).yiPengEvening).toBe(true);
    expect(festivalsAt(timeOf(2026, 10, 28, 19)).yiPengEvening).toBe(false);
  });

  it('never releases sky lanterns over the city', () => {
    for (let h = 0; h < 24 * 5; h += 0.5) expect(Object.keys(festivalsAt(timeOf(2026, 10, 22, h)))).not.toContain('skyLanterns');
  });

  it('puts the walking streets up on schedule', () => {
    // Sun 1 Nov 2026 (game day 0) and Sat 7 Nov 2026.
    expect(festivalsAt(timeOf(2026, 10, 1, 15.5)).sundayMarket).toBe(false);
    expect(festivalsAt(timeOf(2026, 10, 1, 16.5)).sundayMarket).toBe(true);
    expect(festivalsAt(timeOf(2026, 10, 1, 22.9)).sundayMarket).toBe(true);
    expect(festivalsAt(timeOf(2026, 10, 1, 23.1)).sundayMarket).toBe(false);
    expect(festivalsAt(timeOf(2026, 10, 2, 18)).sundayMarket).toBe(false);
    // Saturday: stalls go up from 16:00 for the 17:00 opening.
    expect(festivalsAt(timeOf(2026, 10, 7, 16.2)).saturdayMarket).toBe(true);
    expect(festivalsAt(timeOf(2026, 10, 7, 18)).saturdayMarket).toBe(true);
    expect(festivalsAt(timeOf(2026, 10, 7, 23.5)).saturdayMarket).toBe(false);
    expect(festivalsAt(timeOf(2026, 10, 7, 18)).sundayMarket).toBe(false);
    expect(festivalsAt(timeOf(2026, 10, 3, 20)).nightBazaar).toBe(true);
    expect(festivalsAt(timeOf(2026, 10, 3, 12)).nightBazaar).toBe(false);
  });

  it('splashes the moat at Songkran and hangs red lanterns for Chinese New Year', () => {
    expect(festivalsAt(timeOf(2027, 3, 13, 14)).songkran).toBe(1);
    expect(festivalsAt(timeOf(2027, 3, 11, 14)).songkran).toBeCloseTo(0.45);
    expect(festivalsAt(timeOf(2027, 3, 20, 14)).songkran).toBe(0);
    expect(festivalsAt(timeOf(2027, 1, 6, 12)).chineseNewYear).toBe(true);
    expect(festivalsAt(timeOf(2027, 1, 10, 12)).chineseNewYear).toBe(false);
  });
});

describe('graphics quality setting', () => {
  const store = new Map<string, string>();
  const g = globalThis as unknown as { localStorage?: Storage };
  afterEach(() => {
    delete g.localStorage;
    store.clear();
    resetQualityCache();
  });

  it('defaults to medium and scales shadows, pixel ratio and particles', () => {
    resetQualityCache();
    expect(DEFAULT_QUALITY).toBe('medium');
    expect(qualityLevel()).toBe('medium');
    expect(QUALITY.low.shadowMapSize).toBeLessThan(QUALITY.medium.shadowMapSize);
    expect(QUALITY.medium.shadowMapSize).toBeLessThan(QUALITY.high.shadowMapSize);
    expect(QUALITY.low.pixelRatio).toBeLessThan(QUALITY.high.pixelRatio);
    expect(QUALITY.low.rainStreaks).toBeLessThan(QUALITY.high.rainStreaks);
  });

  it('remembers the choice in localStorage', () => {
    g.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    } as Storage;
    resetQualityCache();
    setQuality('high');
    expect(qualityPreset().shadowMapSize).toBe(4096);
    resetQualityCache();
    expect(qualityLevel()).toBe('high');
  });

  it('survives storage that throws', () => {
    g.localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    resetQualityCache();
    expect(qualityLevel()).toBe('medium');
    setQuality('low');
    expect(qualityLevel()).toBe('low');
  });
});
