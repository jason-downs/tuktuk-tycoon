// Sun and moon positions over Chiang Mai from the game calendar. Pure maths,
// no three.js: the NOAA simplified solar model (declination, equation of time,
// hour angle) for the map origin at 18.79 N, local time UTC+7. November
// sunrise comes out at ≈ 06:24 and sunset at ≈ 17:51. daylight() in
// src/sim/clock.ts keeps those November times all year and serves only the
// flat map; the 3D layers read day and night from EnvState.night, which
// follows this model. Noon elevation runs from ≈ 57° on 1 Nov to ≈ 50° on
// 30 Nov and reaches ≈ 80° at Songkran.
//
// The moon uses a mean synodic month from a known new moon and rides the sun's
// path shifted by its phase, with the declination mirrored at full moon (a
// November full moon rides high, like a June sun). Good to a few degrees,
// which is plenty for lighting.

import { GAME_EPOCH_UTC, HOUR, type CalendarInfo } from '../../sim/clock';

const DEG = Math.PI / 180;
/** Map origin (graph.projection / city3d.json origin). */
export const SITE = { lat: 18.79, lon: 98.9775, utcOffset: 7 } as const;
/** Mean synodic month (days) and a reference new moon (6 Jan 2000 18:14 UTC). */
const SYNODIC_DAYS = 29.530588853;
const NEW_MOON_UTC = Date.UTC(2000, 0, 6, 18, 14);

export interface SkyPosition {
  /** Radians above the horizon (geometric, no refraction). */
  elevation: number;
  /** Radians clockwise from north (π/2 east, π south). */
  azimuth: number;
}

export interface SunPosition extends SkyPosition {
  /** Solar declination, radians. */
  declination: number;
  /** Hour angle, radians: negative before solar noon. */
  hourAngle: number;
}

/** Day of the year, 1 = 1 January. */
export function dayOfYear(cal: Pick<CalendarInfo, 'year' | 'month' | 'date'>): number {
  return Math.round((Date.UTC(cal.year, cal.month, cal.date) - Date.UTC(cal.year, 0, 1)) / 86_400_000) + 1;
}

/** Elevation and azimuth of a body with declination `dec` at hour angle `ha` for the site latitude. */
export function horizontal(dec: number, ha: number, lat = SITE.lat * DEG): SkyPosition {
  const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  // Azimuth measured from south, then turned to a compass bearing from north.
  const fromSouth = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat));
  let azimuth = fromSouth + Math.PI;
  if (azimuth >= 2 * Math.PI) azimuth -= 2 * Math.PI;
  return { elevation, azimuth };
}

/** Sun position for a calendar date and local hour (NOAA "General Solar Position Calculations"). */
export function solarPosition(cal: Pick<CalendarInfo, 'year' | 'month' | 'date' | 'hour'>): SunPosition {
  const doy = dayOfYear(cal);
  const days = cal.year % 4 === 0 ? 366 : 365;
  const g = ((2 * Math.PI) / days) * (doy - 1 + (cal.hour - 12) / 24);
  const eqTime =
    229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const declination =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  // True solar time in minutes, then the hour angle (15° per hour from solar noon).
  const trueSolar = cal.hour * 60 + eqTime + 4 * SITE.lon - 60 * SITE.utcOffset;
  const hourAngle = (trueSolar / 4 - 180) * DEG;
  return { ...horizontal(declination, hourAngle), declination, hourAngle };
}

/** Real UTC milliseconds of a game time (game time is Chiang Mai local time). */
export function utcMs(time: number): number {
  return GAME_EPOCH_UTC + time * 1000 - SITE.utcOffset * HOUR * 1000;
}

/** Moon phase at a game time: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
export function moonPhase(time: number): number {
  const days = (utcMs(time) - NEW_MOON_UTC) / 86_400_000;
  const p = (days / SYNODIC_DAYS) % 1;
  return p < 0 ? p + 1 : p;
}

/** Fraction of the moon's disc that is lit (0 new … 1 full). */
export function moonIllumination(phase: number): number {
  return (1 - Math.cos(2 * Math.PI * phase)) / 2;
}

/** Approximate moon position: the sun's path shifted by the phase, declination mirrored towards full moon. */
export function moonPosition(sun: SunPosition, phase: number): SkyPosition {
  const dec = sun.declination * Math.cos(2 * Math.PI * phase);
  return horizontal(dec, sun.hourAngle - 2 * Math.PI * phase);
}

/**
 * Unit vector towards a sky position in three.js world space (X east, Y up,
 * Z south), written into `out`.
 */
export function skyDirection(p: SkyPosition, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const c = Math.cos(p.elevation);
  out.x = Math.sin(p.azimuth) * c;
  out.y = Math.sin(p.elevation);
  out.z = -Math.cos(p.azimuth) * c;
  return out;
}
