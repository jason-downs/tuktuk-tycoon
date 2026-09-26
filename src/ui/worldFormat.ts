// Shared formatting for the calendar panel and the event/weather badge.

import type { EventKind } from '../content/events';
import { DAY, MONTHS, WEEKDAYS, calendar, formatClock } from '../sim/clock';
import { SEASON_INDEX } from '../sim/demand';
import type { EventOccurrence } from '../sim/events';

/** Which event the badge shows when several run at once. */
const KIND_RANK: Record<EventKind, number> = { festival: 0, market: 1, holiday: 2, dry: 3, campus: 4, season: 5 };

export function byImportance(a: EventOccurrence, b: EventOccurrence): number {
  return KIND_RANK[a.event.kind] - KIND_RANK[b.event.kind] || a.start - b.start;
}

export function dayLabel(time: number, now: number): string {
  const d = Math.floor(time / DAY);
  const today = Math.floor(now / DAY);
  if (d === today) return 'Today';
  if (d === today + 1) return 'Tomorrow';
  const c = calendar(time);
  return `${WEEKDAYS[c.weekday]} ${c.date} ${MONTHS[c.month]}`;
}

/** "17:00–01:00", or a date range for all-day and multi-day runs. */
export function occurrenceTime(o: EventOccurrence): string {
  const len = o.end - o.start;
  const allDay = calendar(o.start).hour === 0 && len % DAY === 0;
  if (allDay) {
    const a = calendar(o.start);
    const b = calendar(o.end - 1);
    if (len === DAY) return 'All day';
    return a.month === b.month ? `${a.date}–${b.date} ${MONTHS[a.month]}` : `${a.date} ${MONTHS[a.month]} – ${b.date} ${MONTHS[b.month]}`;
  }
  return `${formatClock(o.start)}–${formatClock(o.end)}`;
}

/** "until 23:00" / "until Sun 3 Jan" for an event that is running. */
export function untilText(o: EventOccurrence, now: number): string {
  if (o.end - now <= DAY && Math.floor((o.end - 1) / DAY) <= Math.floor(now / DAY) + 1 && o.end - o.start < DAY) {
    return `until ${formatClock(o.end)}`;
  }
  const c = calendar(o.end - 1);
  return `until ${WEEKDAYS[c.weekday]} ${c.date} ${MONTHS[c.month]}`;
}

/** "in 3 h", "tomorrow 17:00", "in 5 days". */
export function startsIn(o: EventOccurrence, now: number): string {
  const dt = o.start - now;
  if (dt < 3_600 * 6) return `in ${Math.max(1, Math.round(dt / 3_600))} h`;
  const days = Math.floor(o.start / DAY) - Math.floor(now / DAY);
  if (days <= 0) return `at ${formatClock(o.start)}`;
  if (days === 1) return `tomorrow ${formatClock(o.start)}`;
  return `in ${days} days`;
}

export interface SeasonInfo {
  label: string;
  tone: 'high' | 'shoulder' | 'green';
  index: number;
  text: string;
}

/** The tourist season for a month, from the MOTS visitors-per-day index (calendar.md §1). */
export function seasonInfo(month: number): SeasonInfo {
  const index = SEASON_INDEX[month];
  const tone = index >= 1.15 ? 'high' : index <= 0.85 ? 'green' : 'shoulder';
  const label = tone === 'high' ? 'High season' : tone === 'green' ? 'Green season' : 'Shoulder season';
  const pct = Math.round(Math.abs(index - 1) * 100);
  const rel = index >= 1 ? `${pct}% above` : `${pct}% below`;
  const text = `Tourism Ministry (MOTS) index ${index.toFixed(2)}: visitors per day in ${MONTHS[month]} run ${rel} the yearly average, and street hails scale with it.`;
  return { label, tone, index, text };
}
