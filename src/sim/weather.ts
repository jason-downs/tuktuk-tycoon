// Weather by season. The sky for any game hour is a pure function of the game
// seed and the hour (hashed noise), so the 24-hour forecast is exact and a saved
// game resumes the same weather. Climate numbers are WMO 1991–2020 normals,
// ERA5 hourly rain shape and CAMS PM2.5 from docs/research/calendar.md §2–3.
//
// Effects: rain and storms bring more short-hop hails, a little more fare
// tolerance, slower roads and wet passengers (unless the tuk-tuk has rain
// curtains); morning fog slows traffic; smoky haze keeps tourists in.

import { TOURIST_CATEGORIES } from '../content/events';
import { DAY, HOUR, calendar, type CalendarInfo } from './clock';
import type { Game, GameSystem } from './game';
import type { PlaceCategory, Vehicle } from './types';

export type Sky = 'clear' | 'cloudy' | 'fog' | 'rain' | 'storm';
/** 0 clean air, 1 smoky haze, 2 heavy smoke (AQI over ~150). */
export type HazeLevel = 0 | 1 | 2;

export interface WeatherNow {
  sky: Sky;
  haze: HazeLevel;
  /** °C. */
  temp: number;
  /** Absolute game hour index (game time / 3600, floored). */
  hour: number;
}

export interface SkyInfo {
  icon: string;
  nightIcon: string;
  label: string;
}

export const SKY_INFO: Record<Sky, SkyInfo> = {
  clear: { icon: '☀️', nightIcon: '🌙', label: 'Clear' },
  cloudy: { icon: '⛅', nightIcon: '☁️', label: 'Cloudy' },
  fog: { icon: '🌁', nightIcon: '🌁', label: 'Morning fog' },
  rain: { icon: '🌧️', nightIcon: '🌧️', label: 'Rain' },
  storm: { icon: '⛈️', nightIcon: '⛈️', label: 'Thunderstorm' },
};

export const HAZE_LABEL = ['', 'Smoky haze', 'Heavy smoke'] as const;

/** How a sky changes the street. Rating penalties apply to tuk-tuks without rain curtains. */
export interface SkyEffect {
  demand: number;
  fare: number;
  speed: number;
  rating: number;
  /** Rating change with rain curtains fitted. */
  ratingCurtains: number;
}

/**
 * Afternoon storm: short-hop requests ×1.3, speed ×0.8, +10% fare tolerance (calendar.md §8, design est.);
 * rating −0.3 for wet riders [pacing]. Storms and fog are stronger/weaker versions [pacing].
 */
export const SKY_EFFECTS: Record<Sky, SkyEffect> = {
  clear: { demand: 1, fare: 1, speed: 1, rating: 0, ratingCurtains: 0 },
  cloudy: { demand: 1, fare: 1, speed: 1, rating: 0, ratingCurtains: 0 },
  fog: { demand: 1, fare: 1, speed: 0.85, rating: 0, ratingCurtains: 0 },
  rain: { demand: 1.3, fare: 1.1, speed: 0.8, rating: -0.3, ratingCurtains: 0 },
  storm: { demand: 1.45, fare: 1.15, speed: 0.65, rating: -0.6, ratingCurtains: -0.15 },
};

/** Tourist demand in haze: ×0.9 (calendar.md §8 smoke season); heavy smoke ×0.7 (haze emergency, design est.). */
export const HAZE_DEMAND = [1, 0.9, 0.7] as const;

// ------------------------------------------------------------- climate
// [research] calendar.md §2, WMO 1991–2020 normals for the Chiang Mai station (Jan … Dec).
const MAX_C = [30.0, 32.9, 35.4, 36.7, 34.7, 33.2, 32.1, 31.6, 32.0, 31.7, 30.8, 29.2];
const MIN_C = [15.7, 16.8, 20.1, 23.4, 24.2, 24.5, 24.3, 24.0, 23.7, 22.6, 19.9, 16.9];
/** Rain days (≥1 mm) per month. */
const RAIN_DAYS = [1.0, 0.7, 2.1, 4.7, 12.0, 11.6, 14.4, 17.1, 14.7, 9.1, 3.0, 1.2];
/** Sunshine hours per month. */
const SUN_HOURS = [258, 252, 268, 253, 217, 146, 115, 111, 153, 196, 229, 238];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * [research] calendar.md §2 ERA5 2016–2025: chance an hour is wet, by hour of day (May–Oct). 13:00–17:00 21–25 %,
 * 08:00–11:00 11–13 %, 20:00–23:00 16–20 %; other hours interpolated. Used as the shape of rain onset times.
 */
const WET_HOUR = [
  0.14, 0.13, 0.12, 0.11, 0.1, 0.1, 0.1, 0.11, 0.12, 0.12, 0.12, 0.13, 0.17, 0.21, 0.23, 0.25, 0.24, 0.22, 0.2, 0.19, 0.18,
  0.18, 0.17, 0.16,
];
const WET_TOTAL = WET_HOUR.reduce((a, b) => a + b, 0);

/** [pacing] Share of rain spells that are thunderstorms, for afternoon (12–19) onsets; other hours get 40 % of it. */
const STORM_SHARE = [0.1, 0.1, 0.3, 0.5, 0.55, 0.5, 0.45, 0.45, 0.45, 0.4, 0.2, 0.1];

/**
 * Chance a day is hazy. Shape from CAMS monthly PM2.5 (calendar.md §3: Mar 38–44, Apr 30–54 µg/m³, 27 days over the
 * 37.5 standard in Apr 2026; smoke from mid-Feb); the mapping to a daily chance is [pacing].
 */
const HAZE_CHANCE = [0.12, 0.3, 0.65, 0.55, 0.06, 0, 0, 0, 0, 0, 0, 0.04];
/** [pacing] Share of haze days in heavy smoke (2026: PM2.5 over 300 µg/m³ in early April, calendar.md §3). */
const HEAVY_SHARE = [0, 0.05, 0.2, 0.3, 0, 0, 0, 0, 0, 0, 0, 0];
/** [pacing] Chance of morning fog in the cool season (none in the research; the cool dry months get some). */
const FOG_CHANCE = [0.25, 0.12, 0, 0, 0, 0, 0, 0, 0, 0.05, 0.12, 0.25];

// ---------------------------------------------------------------- noise
function hash01(seed: number, a: number, b: number): number {
  let h = (seed ^ Math.imul(a + 0x632be5ab, 0x9e3779b1) ^ Math.imul(b + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

interface Spell {
  /** Onset hour of day (0–23). */
  start: number;
  /** Hours of thunderstorm at the start of the spell. */
  storm: number;
  /** Total hours of rain including the storm. */
  len: number;
}

const monthOf = (day: number): CalendarInfo => calendar(day * DAY + 12 * HOUR);

const spellCache = new Map<string, Spell[]>();

/** Rain spells that start on a game day. */
function daySpells(seed: number, day: number): Spell[] {
  const key = `${seed}:${day}`;
  const hit = spellCache.get(key);
  if (hit) return hit;
  const m = monthOf(day).month;
  const pDay = RAIN_DAYS[m] / DAYS_IN_MONTH[m];
  const spells: Spell[] = [];
  if (hash01(seed, day, 1) < pDay) {
    const n = hash01(seed, day, 2) < (pDay > 0.3 ? 0.4 : 0.15) ? 2 : 1;
    for (let k = 0; k < n; k++) {
      let r = hash01(seed, day, 10 + k) * WET_TOTAL;
      let start = 0;
      for (; start < 23 && r >= WET_HOUR[start]; start++) r -= WET_HOUR[start];
      const afternoon = start >= 12 && start < 19;
      const isStorm = hash01(seed, day, 20 + k) < STORM_SHARE[m] * (afternoon ? 1 : 0.4);
      const u = hash01(seed, day, 30 + k);
      const storm = isStorm ? 1 + Math.floor(u * 2) : 0;
      const len = isStorm ? storm + Math.floor(hash01(seed, day, 40 + k) * 2) : 1 + Math.floor(u * 3);
      spells.push({ start, storm, len });
    }
  }
  if (spellCache.size > 4_000) spellCache.clear();
  spellCache.set(key, spells);
  return spells;
}

/** Smoky haze for a game day: 0, 1 or 2. Episodes last two to three days. */
export function hazeLevel(seed: number, day: number): HazeLevel {
  const c = monthOf(day);
  let p = HAZE_CHANCE[c.month];
  if (c.month === 1) p = c.date < 15 ? 0.1 : 0.45;
  if (p <= 0) return 0;
  const offset = Math.floor(hash01(seed, 7, 77) * 3);
  const u = hash01(seed, Math.floor((day + offset) / 3), 50);
  const u2 = hash01(seed, day, 51);
  // Mostly follows the 3-day episode, with a little day-to-day variation.
  const v = u * 0.8 + u2 * 0.2;
  if (v >= p) return 0;
  return v < p * HEAVY_SHARE[c.month] ? 2 : 1;
}

/** The sky in a given absolute game hour. */
export function skyAt(seed: number, hourIndex: number): Sky {
  const day = Math.floor(hourIndex / 24);
  const h = hourIndex - day * 24;
  // Rain spells from today, or from yesterday running past midnight.
  for (const d of [day, day - 1]) {
    const offset = (day - d) * 24;
    for (const sp of daySpells(seed, d)) {
      const t = h + offset - sp.start;
      if (t >= 0 && t < sp.len) return t < sp.storm ? 'storm' : 'rain';
      if (t === -1) return 'cloudy';
    }
  }
  const m = monthOf(day).month;
  if (h >= 5 && h < 9 && hash01(seed, day, 60) < FOG_CHANCE[m]) return 'fog';
  if (h >= 8 && h < 19) {
    const pCloud = Math.max(0.05, Math.min(0.75, 1 - SUN_HOURS[m] / DAYS_IN_MONTH[m] / 11));
    const k = Math.floor(h / 4);
    const t = (h % 4) / 4;
    const n = hash01(seed, day * 8 + k, 70) * (1 - t) + hash01(seed, day * 8 + k + 1, 70) * t;
    if (n < pCloud) return 'cloudy';
  }
  return 'clear';
}

/** Air temperature from the monthly normals and a daily curve (coolest 06:00, warmest 15:00, quick evening drop). */
export function temperature(month: number, hour: number, sky: Sky): number {
  const lo = MIN_C[month];
  const hi = MAX_C[month];
  const h = hour < 6 ? hour + 24 : hour;
  const f = h <= 15 ? 0.5 - 0.5 * Math.cos((Math.PI * (h - 6)) / 9) : 1 - ((h - 15) / 15) ** 0.6;
  let t = lo + (hi - lo) * f;
  if (sky === 'rain') t -= 3;
  if (sky === 'storm') t -= 5;
  if (sky === 'fog') t -= 1;
  return Math.round(t);
}

let nowCache: { seed: number; hour: number; value: WeatherNow } | null = null;

/** Weather at a game time. */
export function weatherAt(seed: number, time: number): WeatherNow {
  const hour = Math.floor(time / HOUR);
  if (nowCache && nowCache.seed === seed && nowCache.hour === hour) return nowCache.value;
  const sky = skyAt(seed, hour);
  const cal = calendar(hour * HOUR);
  const value: WeatherNow = { sky, haze: hazeLevel(seed, cal.day), temp: temperature(cal.month, cal.hour, sky), hour };
  nowCache = { seed, hour, value };
  return value;
}

export function currentWeather(game: Game): WeatherNow {
  return weatherAt(game.state.seed, game.state.time);
}

export interface ForecastBlock {
  /** Game time at the start of the block. */
  time: number;
  sky: Sky;
  haze: HazeLevel;
  temp: number;
}

const SEVERITY: Record<Sky, number> = { clear: 0, cloudy: 1, fog: 2, rain: 3, storm: 4 };

/** Forecast for the next `hours` hours in blocks of `step` hours (the worst sky in each block). */
export function weatherForecast(game: Game, hours = 24, step = 3): ForecastBlock[] {
  const seed = game.state.seed;
  const first = Math.floor(game.state.time / HOUR) + 1;
  const out: ForecastBlock[] = [];
  for (let b = first; b < first + hours; b += step) {
    let sky: Sky = 'clear';
    for (let h = b; h < b + step; h++) {
      const s = skyAt(seed, h);
      if (SEVERITY[s] > SEVERITY[sky]) sky = s;
    }
    const cal = calendar(b * HOUR);
    out.push({ time: b * HOUR, sky, haze: hazeLevel(seed, cal.day), temp: temperature(cal.month, cal.hour + step / 2, sky) });
  }
  return out;
}

/** Haze that counts right now: rain and storms wash the smoke out. */
export function hazeActive(w: WeatherNow): HazeLevel {
  return w.sky === 'rain' || w.sky === 'storm' ? 0 : w.haze;
}

export function isNight(time: number): boolean {
  const h = calendar(time).hour;
  return h < 6.3 || h >= 18.2;
}

export function weatherIcon(w: WeatherNow, time: number): string {
  if (hazeActive(w) && (w.sky === 'clear' || w.sky === 'cloudy')) return '🌫️';
  return isNight(time) ? SKY_INFO[w.sky].nightIcon : SKY_INFO[w.sky].icon;
}

export function weatherLabel(w: WeatherNow): string {
  const haze = hazeActive(w);
  if (haze && (w.sky === 'clear' || w.sky === 'cloudy')) return HAZE_LABEL[haze];
  return SKY_INFO[w.sky].label + (haze ? ` · ${HAZE_LABEL[haze].toLowerCase()}` : '');
}

/** Effect chips for the UI. */
export function weatherEffectChips(w: WeatherNow): string[] {
  const e = SKY_EFFECTS[w.sky];
  const chips: string[] = [];
  if (e.demand > 1) chips.push(`Hails +${Math.round((e.demand - 1) * 100)}%`);
  if (e.fare > 1) chips.push(`Fares +${Math.round((e.fare - 1) * 100)}%`);
  if (e.speed < 1) chips.push(`Speed −${Math.round((1 - e.speed) * 100)}%`);
  if (e.rating < 0) chips.push(`Rating −${Math.abs(e.rating)} without rain curtains`);
  const haze = hazeActive(w);
  if (haze) chips.push(`Tourists −${Math.round((1 - HAZE_DEMAND[haze]) * 100)}%`);
  return chips;
}

// ----------------------------------------------------------------- system
interface WeatherState {
  /** Last hour index whose weather was announced. */
  lastHour: number;
  /** Last day whose haze was announced. */
  lastHazeDay: number;
}

export function weatherState(game: Game): WeatherState {
  const raw = (game.state.systems.weather ?? {}) as Partial<WeatherState>;
  const s: WeatherState = { lastHour: raw.lastHour ?? -1, lastHazeDay: raw.lastHazeDay ?? -1 };
  game.state.systems.weather = s;
  return s;
}

const TOURIST = new Set<PlaceCategory>(TOURIST_CATEGORIES);
const calTime = (cal: CalendarInfo): number => cal.day * DAY + cal.hour * HOUR;

/** Rating change from the weather for a finished trip. */
export function weatherRating(game: Game, v: Vehicle): number {
  const e = SKY_EFFECTS[currentWeather(game).sky];
  return v.upgrades.includes('rain_curtains') ? e.ratingCurtains : e.rating;
}

export class WeatherSystem implements GameSystem {
  readonly id = 'weather';

  init(game: Game): void {
    const st = weatherState(game);
    if (st.lastHour < 0) st.lastHour = Math.floor(game.state.time / HOUR);
    const seed = game.state.seed;
    game.demandModifiers.push((place, cal) => {
      const w = weatherAt(seed, calTime(cal));
      let m = SKY_EFFECTS[w.sky].demand;
      const haze = hazeActive(w);
      if (haze && TOURIST.has(place.cat)) m *= HAZE_DEMAND[haze];
      return m;
    });
    game.fareModifiers.push((_o, cal) => SKY_EFFECTS[weatherAt(seed, calTime(cal)).sky].fare);
    game.speedModifiers.push((_cls, cal) => SKY_EFFECTS[weatherAt(seed, calTime(cal)).sky].speed);
    game.ratingModifiers.push((v) => weatherRating(game, v));
  }

  update(game: Game): void {
    const st = game.state.systems.weather as WeatherState;
    const hour = Math.floor(game.state.time / HOUR);
    if (hour === st.lastHour) return;
    const prev = skyAt(game.state.seed, hour - 1);
    st.lastHour = hour;
    const w = currentWeather(game);
    const wet = (s: Sky) => s === 'rain' || s === 'storm';
    if (w.sky === 'storm' && prev !== 'storm') {
      game.notify('⛈️ Thunderstorm! Everyone wants a ride and the roads flood — riders get soaked without rain curtains.', 'info');
    } else if (w.sky === 'rain' && !wet(prev)) {
      game.notify('🌧️ Rain: nobody wants to walk, so short hops pay. Roads are slower, and riders get wet without rain curtains.', 'info');
    }
    const cal = calendar(game.state.time);
    if (w.haze && cal.hour >= 6 && st.lastHazeDay !== cal.day) {
      st.lastHazeDay = cal.day;
      game.notify(
        w.haze === 2
          ? '🌫️ Heavy smoke: PM2.5 is off the charts and tourists are staying in.'
          : '🌫️ Smoky haze today: the mountain has vanished and fewer tourists are out.',
        'info',
      );
    }
  }
}
