// Which festival and market set dressing is out at a game time, read from the
// events calendar (src/content/events.ts via src/sim/events.ts) so the 3D city
// matches the sim's closures and notices (docs/3d/world.md §3.5).
//
// - Yi Peng / Loy Krathong: khom khwaen lanterns hang over Tha Phae Rd,
//   Ratchadamnoen, Moon Muang and the moat causeways from the day before the
//   first festival evening until the morning after the last; candles and
//   krathongs come out on the festival evenings themselves. There are no sky
//   lanterns over the city (2026 municipal ban, calendar.md).
// - Walking streets: stalls stand from 16:00 set-up until the market closes.
// - Night Bazaar (Chang Klan Rd): stalls every evening 17:00–24:00 (world.md §3.5).
// - Songkran: water splashes along the moat; lighter during the build-up days.
// - Chinese New Year: red lanterns in the streets around Warorot.

import { DAY, HOUR } from '../../sim/clock';
import { occurrencesBetween, type EventOccurrence } from '../../sim/events';

export interface FestivalState {
  /** Yi Peng lanterns strung over the streets. */
  yiPengLanterns: boolean;
  /** Candles on temple walls and krathongs on the Ping (festival evenings). */
  yiPengEvening: boolean;
  sundayMarket: boolean;
  saturdayMarket: boolean;
  nightBazaar: boolean;
  /** Songkran splash strength: 1 on the main days, 0.45 during the build-up, else 0. */
  songkran: number;
  chineseNewYear: boolean;
}

/** Stalls go up from this hour on a market day. */
export const MARKET_SETUP_HOUR = 16;
/** Night Bazaar stall hours (world.md §3.5: nightly 17:00–24:00). */
export const NIGHT_BAZAAR_HOURS = [17, 24] as const;
/** Lanterns hang this long before the first festival evening begins and after the last ends. */
const LANTERNS_BEFORE = 30 * HOUR;
const LANTERNS_AFTER = 8 * HOUR;

const has = (occ: EventOccurrence[], id: string, t: number): boolean => occ.some((o) => o.event.id === id && o.start <= t && t < o.end);

/** Market stalls stand from set-up (16:00 on the market day, or the market start if earlier) until it closes. */
function marketUp(occ: EventOccurrence[], id: string, t: number): boolean {
  return occ.some((o) => {
    if (o.event.id !== id) return false;
    const setup = Math.min(o.start, Math.floor(o.start / DAY) * DAY + MARKET_SETUP_HOUR * HOUR);
    return setup <= t && t < o.end;
  });
}

export function festivalsAt(time: number): FestivalState {
  const near = occurrencesBetween(time - LANTERNS_AFTER, time + LANTERNS_BEFORE);
  const hour = (((time % DAY) + DAY) % DAY) / HOUR;
  return {
    yiPengLanterns: near.some((o) => o.event.id === 'yi_peng' && o.start - LANTERNS_BEFORE <= time && time < o.end + LANTERNS_AFTER),
    yiPengEvening: has(near, 'yi_peng', time),
    sundayMarket: marketUp(near, 'sunday_walking_street', time),
    saturdayMarket: marketUp(near, 'saturday_walking_street', time),
    nightBazaar: hour >= NIGHT_BAZAAR_HOURS[0] && hour < NIGHT_BAZAAR_HOURS[1],
    songkran:
      has(near, 'songkran', time) || has(near, 'songkran_tha_phae_night', time) ? 1 : has(near, 'songkran_buildup', time) ? 0.45 : 0,
    chineseNewYear: has(near, 'chinese_new_year', time),
  };
}
