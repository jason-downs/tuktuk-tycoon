// Game calendar. Game time is seconds since 00:00 on Sunday 1 November 2026,
// Chiang Mai local time: the start of the cool high season, three weeks before
// Yi Peng / Loy Krathong (23–25 Nov 2026).

export const GAME_EPOCH_UTC = Date.UTC(2026, 10, 1); // month index 10 = November
export const DAY = 86_400;
export const HOUR = 3_600;
export const MINUTE = 60;

/** Game seconds that pass per real second at 1× speed. */
export const BASE_TIME_SCALE = 30;
export const SPEED_STEPS = [0, 0.5, 1, 2, 4, 8] as const;

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export interface CalendarInfo {
  /** Whole days since the epoch (day 0 = Sun 1 Nov 2026). */
  day: number;
  year: number;
  /** 0 = January. */
  month: number;
  /** Day of month, 1-based. */
  date: number;
  /** 0 = Sunday. */
  weekday: number;
  /** Fractional hour of day, 0–24. */
  hour: number;
  minute: number;
}

export function calendar(time: number): CalendarInfo {
  const day = Math.floor(time / DAY);
  const d = new Date(GAME_EPOCH_UTC + day * DAY * 1000);
  const secOfDay = time - day * DAY;
  return {
    day,
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    date: d.getUTCDate(),
    weekday: d.getUTCDay(),
    hour: secOfDay / HOUR,
    minute: Math.floor((secOfDay % HOUR) / MINUTE),
  };
}

export function formatClock(time: number): string {
  const c = calendar(time);
  return `${String(Math.floor(c.hour)).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
}

export function formatDate(time: number): string {
  const c = calendar(time);
  return `${WEEKDAYS[c.weekday]} ${c.date} ${MONTHS[c.month]} ${c.year}`;
}

/** [research] calendar.md §8 "Weekday rush": Mon–Fri 07:00–09:00 and 16:00–18:00. */
export function isWeekdayRush(cal: CalendarInfo): boolean {
  const h = cal.hour;
  return cal.weekday >= 1 && cal.weekday <= 5 && ((h >= 7 && h < 9) || (h >= 16 && h < 18));
}

/** Game time of a calendar date and hour (local), e.g. timeOf(2026, 10, 24, 18). */
export function timeOf(year: number, month: number, date: number, hour = 0): number {
  return (Date.UTC(year, month, date) - GAME_EPOCH_UTC) / 1000 + hour * HOUR;
}

/**
 * 0 at midnight … 1 at noon, smooth; the flat map's lighting. It keeps November's sunrise and sunset all year; the 3D
 * view follows the real sun for the date (world3d/env/sun.ts).
 */
export function daylight(hour: number): number {
  // Chiang Mai in November: sunrise ≈ 06:25, sunset ≈ 17:50.
  const rise = 6.4;
  const set = 17.85;
  if (hour < rise - 0.6 || hour > set + 0.6) return 0;
  if (hour < rise + 0.6) return (hour - (rise - 0.6)) / 1.2;
  if (hour > set - 0.6) return 1 - (hour - (set - 0.6)) / 1.2;
  return 1;
}
