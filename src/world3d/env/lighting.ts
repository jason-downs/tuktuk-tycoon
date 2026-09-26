// Time-of-day look driven by the sun's elevation, not the clock hour
// (docs/3d/world.md §3.2): key light, sky zenith and horizon, hemisphere sky
// and ground, fog and exposure, blended between keyframes for morning, day,
// golden hour, blue hour and night. Morning and evening take different paths
// through the same elevations (dawn is cool and pale, dusk golden). Pure: the
// layer converts the sRGB byte colours to three.js colours.

import { hex, mix, type RGB } from './colour';

const DEG = Math.PI / 180;

export type Phase = 'night' | 'blue' | 'morning' | 'day' | 'golden';

/** One lighting keyframe. Intensities are three.js light intensities (physically based lights). */
export interface LightKey {
  key: RGB;
  keyIntensity: number;
  zenith: RGB;
  horizon: RGB;
  hemiSky: RGB;
  hemiGround: RGB;
  hemiIntensity: number;
  fog: RGB;
  exposure: number;
}

const key = (k: string, ki: number, z: string, h: string, hs: string, hg: string, hi: number, f: string, ex: number): LightKey => ({
  key: hex(k),
  keyIntensity: ki,
  zenith: hex(z),
  horizon: hex(h),
  hemiSky: hex(hs),
  hemiGround: hex(hg),
  hemiIntensity: hi,
  fog: hex(f),
  exposure: ex,
});

// Colours from world.md §3.2. Key intensities are world.md's scaled by 0.8 to
// the renderer's calibration; hemisphere intensities keep the ambient
// luminance readable (the night sky colour is very dark, so its intensity is high).
export const KEYS = {
  day: key('#fff4e0', 2.4, '#7fb6e0', '#cfe3ec', '#a9cdef', '#cdb89a', 1.35, '#cfe3ec', 1.0),
  morningHigh: key('#ffe6c4', 1.9, '#8fbde2', '#e4e6dc', '#b4d4ee', '#c2ab88', 1.15, '#d9e4e4', 1.02),
  morning: key('#ffd9a8', 1.3, '#9cc3e3', '#f1e3cf', '#bcd8ee', '#b89f7a', 1.0, '#dfe6e3', 1.05),
  dawn: key('#ffc89a', 0.35, '#5f7aa8', '#f0c6a8', '#8a9cc4', '#6a5a48', 1.2, '#b9b6bd', 1.12),
  goldenHigh: key('#ffb86b', 1.6, '#7aa0c8', '#ffc58a', '#c9b8d8', '#a4805a', 0.95, '#f1c9a0', 1.05),
  goldenLow: key('#ff8a4a', 0.8, '#6f8fbe', '#ffad72', '#c0a8cf', '#8d6a4a', 0.9, '#eeb58c', 1.08),
  blue: key('#000000', 0, '#2e3f6e', '#e39a6b', '#5d6f9a', '#3a3028', 1.3, '#6d6f8a', 1.2),
  night: key('#000000', 0, '#0f1630', '#25304f', '#1b2440', '#2a2018', 3.7, '#1a1f33', 1.35),
} satisfies Record<string, LightKey>;

/** Keyframes by sun elevation (degrees), low to high, for the morning and the evening. */
const MORNING: [number, LightKey][] = [
  [-7, KEYS.night],
  [-2.5, KEYS.blue],
  [1.5, KEYS.dawn],
  [8, KEYS.morning],
  [20, KEYS.morningHigh],
  [35, KEYS.day],
];
const EVENING: [number, LightKey][] = [
  [-7, KEYS.night],
  [-2.5, KEYS.blue],
  [1, KEYS.goldenLow],
  [12, KEYS.goldenHigh],
  [35, KEYS.day],
];

function lerpKey(a: LightKey, b: LightKey, t: number): LightKey {
  const n = (x: number, y: number) => x + (y - x) * t;
  return {
    key: mix(a.key, b.key, t),
    keyIntensity: n(a.keyIntensity, b.keyIntensity),
    zenith: mix(a.zenith, b.zenith, t),
    horizon: mix(a.horizon, b.horizon, t),
    hemiSky: mix(a.hemiSky, b.hemiSky, t),
    hemiGround: mix(a.hemiGround, b.hemiGround, t),
    hemiIntensity: n(a.hemiIntensity, b.hemiIntensity),
    fog: mix(a.fog, b.fog, t),
    exposure: n(a.exposure, b.exposure),
  };
}

function sampleKeys(keys: [number, LightKey][], elevDeg: number): LightKey {
  if (elevDeg <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [e1, k1] = keys[i];
    if (elevDeg <= e1) {
      const [e0, k0] = keys[i - 1];
      const t = (elevDeg - e0) / (e1 - e0);
      // Smoothstep between keyframes so the light has no visible kinks.
      return lerpKey(k0, k1, t * t * (3 - 2 * t));
    }
  }
  return keys[keys.length - 1][1];
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface TimeOfDay extends LightKey {
  phase: Phase;
  /** Sun elevation, radians. */
  sunElevation: number;
  /** Moonlight share of the key light (0 = the sun is the key light). */
  moonKey: number;
  /** Night factor for lit windows: 0 by day, 1 at night (60% at the height of blue hour). */
  night: number;
  /** Street lamps: on at +2° sun elevation, full by blue hour. */
  lamps: number;
  /** Visibility of stars. */
  stars: number;
  /** Sun disc and glow strength (fades below the horizon). */
  sunGlow: number;
}

/**
 * The time-of-day look for a sun elevation (radians). `rising` picks the
 * morning or evening path; the moon adds a dim bluish key light at night
 * (world.md: #8fa3d6, 0.25, doubled at full moon).
 */
export function timeOfDay(sunElevation: number, rising: boolean, moonElevation: number, moonLit: number): TimeOfDay {
  const e = sunElevation / DEG;
  const base = sampleKeys(rising ? MORNING : EVENING, e);
  const phase: Phase = e < -6 ? 'night' : e < 0 ? 'blue' : e > 35 ? 'day' : rising ? 'morning' : 'golden';
  const dark = smoothstep(-1, -7, e);
  const moonUp = smoothstep(0, 10, moonElevation / DEG);
  const moonIntensity = 0.2 * (1 + moonLit) * moonUp * dark;
  const out: TimeOfDay = {
    ...base,
    phase,
    sunElevation,
    moonKey: 0,
    night: smoothstep(6, -1, e) * 0.6 + smoothstep(-1, -7, e) * 0.4,
    lamps: smoothstep(3, 1, e),
    stars: smoothstep(-5, -12, e),
    sunGlow: smoothstep(-5, 0.5, e),
  };
  if (moonIntensity > out.keyIntensity) {
    out.moonKey = 1;
    out.key = hex('#8fa3d6');
    out.keyIntensity = moonIntensity;
  }
  return out;
}
