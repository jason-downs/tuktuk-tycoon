// How the sim's weather (src/sim/weather.ts) looks in 3D (docs/3d/world.md
// §3.4): rain and storms darken and desaturate the light and pull the fog in,
// cool-season mornings bring mist over the moat and the Ping, and smoky-season
// haze turns the fog brown, reddens the sun and hides Doi Suthep. Pure: a
// plain numeric description that the environment layer eases towards.

import type { CalendarInfo } from '../../sim/clock';
import { hazeActive, type WeatherNow } from '../../sim/weather';
import { hex, type RGB } from './colour';

export interface AtmosphereLook {
  /** Rain streak density 0–1. */
  rain: number;
  /** Thunderstorm strength 0–1 (lightning). */
  storm: number;
  /** Cloud cover in the sky dome 0–1. */
  cloud: number;
  /** Smoke haze 0–1. */
  haze: number;
  /** Low mist over water 0–1. */
  mist: number;
  /** Target road wetness 0–1. */
  wet: number;
  /** Multipliers on the sun/moon key light and the hemisphere light. */
  keyMul: number;
  hemiMul: number;
  /** Tint of the key light (haze reddens the sun) and its strength. */
  keyTint: RGB;
  keyTintAmount: number;
  /** Desaturation of the sky and fog towards grey, 0–1. */
  desaturate: number;
  /** Darkening of the sky dome, 0–1. */
  darken: number;
  /** Fog colour (daylight value) and how strongly it tints the time-of-day fog (0–1). */
  fogTint: RGB;
  fogTintAmount: number;
  /** Multipliers on the fog near and far distances. */
  fogNear: number;
  fogFar: number;
  /** How much the Doi Suthep backdrop fades into the horizon (1 = hidden). */
  backdropHide: number;
}

/** Aerial haze on the far mountains in clear air. */
export const CLEAR_BACKDROP_HAZE = 0.5;

const CLEAR: AtmosphereLook = {
  rain: 0,
  storm: 0,
  cloud: 0.12,
  haze: 0,
  mist: 0,
  wet: 0,
  keyMul: 1,
  hemiMul: 1,
  keyTint: hex('#ffffff'),
  keyTintAmount: 0,
  desaturate: 0,
  darken: 0,
  fogTint: hex('#cfe3ec'),
  fogTintAmount: 0,
  fogNear: 1,
  fogFar: 1,
  backdropHide: CLEAR_BACKDROP_HAZE,
};

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Cool-season (Nov–Jan) morning mist over water on otherwise fine days, 0–1: peaks around 06:30, gone by 09:00. */
export function coolSeasonMist(cal: Pick<CalendarInfo, 'month' | 'hour'>): number {
  if (cal.month !== 10 && cal.month !== 11 && cal.month !== 0) return 0;
  return smoothstep(4.5, 6, cal.hour) * (1 - smoothstep(7.2, 9, cal.hour));
}

/** The 3D look for the weather at a calendar time. */
export function atmosphereLook(w: WeatherNow, cal: Pick<CalendarInfo, 'month' | 'hour'>): AtmosphereLook {
  const out: AtmosphereLook = { ...CLEAR, keyTint: [...CLEAR.keyTint], fogTint: [...CLEAR.fogTint] };
  switch (w.sky) {
    case 'cloudy':
      Object.assign(out, { cloud: 0.62, keyMul: 0.6, desaturate: 0.18, darken: 0.08, fogNear: 0.9, fogFar: 0.9, backdropHide: 0.5 });
      out.fogTint = hex('#c3ccd2');
      out.fogTintAmount = 0.35;
      break;
    case 'rain':
      Object.assign(out, { rain: 0.6, cloud: 0.92, wet: 1, keyMul: 0.32, hemiMul: 0.82, desaturate: 0.5, darken: 0.35 });
      Object.assign(out, { fogNear: 0.5, fogFar: 0.55, backdropHide: 0.88 });
      out.fogTint = hex('#99a1a8');
      out.fogTintAmount = 0.6;
      break;
    case 'storm':
      Object.assign(out, { rain: 1, storm: 1, cloud: 1, wet: 1, keyMul: 0.16, hemiMul: 0.66, desaturate: 0.6, darken: 0.55 });
      Object.assign(out, { fogNear: 0.35, fogFar: 0.4, backdropHide: 0.96 });
      out.fogTint = hex('#7c848c');
      out.fogTintAmount = 0.7;
      break;
    case 'fog': {
      // Radiation fog burns off through the morning (same curve as the flat map's tint).
      const m = Math.max(0.25, Math.min(1, (9.5 - cal.hour) / 3));
      Object.assign(out, { mist: m, keyMul: 1 - 0.55 * m, desaturate: 0.3 * m, fogNear: 1 - 0.9 * m, fogFar: 1 - 0.8 * m });
      out.backdropHide = Math.max(CLEAR_BACKDROP_HAZE, m);
      out.fogTint = hex('#e3e8e6');
      out.fogTintAmount = 0.85 * m;
      break;
    }
    default:
      break;
  }
  if (w.sky !== 'fog' && w.sky !== 'rain' && w.sky !== 'storm') out.mist = Math.max(out.mist, 0.45 * coolSeasonMist(cal));
  const haze = hazeActive(w);
  if (haze) {
    const h = haze === 2 ? 1 : 0.6;
    out.haze = h;
    const div = haze === 2 ? 3 : 2;
    out.fogNear /= div;
    out.fogFar /= div;
    out.fogTint = hex(haze === 2 ? '#bca786' : '#c9b89a');
    out.fogTintAmount = Math.max(out.fogTintAmount, 0.6 + 0.3 * h);
    out.keyMul *= 1 - 0.35 * h;
    out.keyTint = hex('#ff9a55');
    out.keyTintAmount = 0.25 + 0.3 * h;
    out.desaturate = Math.max(out.desaturate, 0.25);
    out.backdropHide = 1;
  }
  return out;
}

/** Numeric fields of AtmosphereLook, for easing between looks. */
export const LOOK_NUMBERS = [
  'rain',
  'storm',
  'cloud',
  'haze',
  'mist',
  'keyMul',
  'hemiMul',
  'keyTintAmount',
  'desaturate',
  'darken',
  'fogTintAmount',
  'fogNear',
  'fogFar',
  'backdropHide',
] as const satisfies readonly (keyof AtmosphereLook)[];

/** Move `cur` towards `target` by a fraction k (0–1). Colours ease per channel. */
export function easeLook(cur: AtmosphereLook, target: AtmosphereLook, k: number): void {
  for (const f of LOOK_NUMBERS) cur[f] += (target[f] - cur[f]) * k;
  for (let i = 0; i < 3; i++) {
    cur.keyTint[i] += (target.keyTint[i] - cur.keyTint[i]) * k;
    cur.fogTint[i] += (target.fogTint[i] - cur.fogTint[i]) * k;
  }
}

/** A fresh copy of a look (colours are copied, not shared). */
export function cloneLook(l: AtmosphereLook): AtmosphereLook {
  return { ...l, keyTint: [...l.keyTint], fogTint: [...l.fogTint] };
}

/**
 * Wetness after a game-time step: soaks within a few game minutes when rain
 * falls, dries over about two game hours afterwards.
 */
export function stepWetness(wet: number, target: number, gameSeconds: number): number {
  if (target > wet) return Math.min(target, wet + gameSeconds / 600);
  return Math.max(target, wet - gameSeconds / 7200);
}

/** Lightning is scheduled in slots of this many real seconds; at most one flash per slot. */
export const FLASH_SLOT = 1.7;

function slotHash(n: number, salt: number): number {
  let h = Math.imul(n ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Lightning flash brightness 0–1 at a real time (seconds) in a storm of
 * strength 0–1: about one flash every six seconds in a full storm, each a
 * bright flicker followed by a weaker second stroke.
 */
export function lightningFlash(time: number, storm: number): number {
  if (storm < 0.3) return 0;
  const slot = Math.floor(time / FLASH_SLOT);
  if (slotHash(slot, 1) > 0.28 * storm) return 0;
  const t = time - slot * FLASH_SLOT - slotHash(slot, 2) * (FLASH_SLOT - 0.4);
  if (t < 0 || t > 0.34) return 0;
  const first = t < 0.08 ? 1 - (t / 0.08) * 0.4 : 0;
  const second = t > 0.14 && t < 0.34 ? 0.75 * (1 - (t - 0.14) / 0.2) : 0;
  return Math.max(first, second) * storm;
}
