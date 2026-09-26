import { MONTHS, WEEKDAYS, calendar, formatClock, formatDate } from '../../sim/clock';
import { SEASON_INDEX } from '../../sim/demand';
import { activeOccurrences, eventAnchor, eventEffectChips, upcomingOccurrences, type EventOccurrence } from '../../sim/events';
import type { Game } from '../../sim/game';
import { RIVAL_KINDS, rivalsOf } from '../../sim/rivals';
import { currentWeather, hazeActive, isNight, SKY_INFO, weatherEffectChips, weatherForecast, weatherIcon, weatherLabel } from '../../sim/weather';
import type { GameView } from '../view';
import type { PanelProps } from '../panels';
import { useGame } from '../store';
import { dayLabel, occurrenceTime, seasonInfo, startsIn, untilText } from '../worldFormat';
import '../world.css';

/** Days of events listed ahead. */
const LOOKAHEAD_DAYS = 14;

export function CalendarPanel({ game, view }: PanelProps) {
  // Re-render every 10 game minutes, or when rivals take a fare.
  useGame(game, (g) => `${Math.floor(g.state.time / 600)}|${(g.state.systems.rivals as { takenToday?: number } | undefined)?.takenToday ?? 0}`);
  const now = game.state.time;
  return (
    <div className="cal">
      <TodayCard now={now} />
      <WeatherCard game={game} />
      <ActiveEvents game={game} view={view} now={now} />
      <Upcoming game={game} view={view} now={now} />
      <Competition game={game} />
    </div>
  );
}

function TodayCard({ now }: { now: number }) {
  const cal = calendar(now);
  const season = seasonInfo(cal.month);
  const max = Math.max(...SEASON_INDEX);
  return (
    <section className="cal-card">
      <div className="cal-head">
        <span className="eyebrow">Today</span>
        <span className={`season-pill ${season.tone}`}>{season.label}</span>
      </div>
      <div className="cal-big">
        {formatDate(now)} · {formatClock(now)}
      </div>
      <div className="season-bars" aria-label="Visitors per day by month">
        {SEASON_INDEX.map((v, m) => (
          <div key={m} className={`season-bar ${m === cal.month ? 'now' : ''}`} style={{ height: `${(v / max) * 100}%` }} title={`${MONTHS[m]}: index ${v.toFixed(2)}`} />
        ))}
      </div>
      <div className="season-labels">
        {MONTHS.map((m, i) => (
          <span key={m} className={i === cal.month ? 'now' : ''}>
            {m[0]}
          </span>
        ))}
      </div>
      <p className="hint small">{season.text}</p>
    </section>
  );
}

function WeatherCard({ game }: { game: Game }) {
  const now = game.state.time;
  const w = currentWeather(game);
  const chips = weatherEffectChips(w);
  const forecast = weatherForecast(game, 24, 3);
  const wet = w.sky === 'rain' || w.sky === 'storm';
  return (
    <section className="cal-card">
      <div className="cal-head">
        <span className="eyebrow">Weather</span>
        <span className="muted small">next 24 h</span>
      </div>
      <div className="wx-now">
        <span className="wx-icon">{weatherIcon(w, now)}</span>
        <div>
          <div className="wx-temp">{w.temp}°C</div>
          <div className="wx-label">{weatherLabel(w)}</div>
        </div>
      </div>
      <div className="wchips">
        {chips.length ? chips.map((c) => <span key={c} className="wchip">{c}</span>) : <span className="wchip calm">No effect on rides</span>}
      </div>
      <div className="forecast">
        {forecast.map((f) => {
          const icon = hazeActive({ ...f, hour: 0 }) && (f.sky === 'clear' || f.sky === 'cloudy') ? '🌫️' : isNight(f.time + 5_400) ? SKY_INFO[f.sky].nightIcon : SKY_INFO[f.sky].icon;
          return (
            <div key={f.time} className={`fc ${f.sky === 'rain' || f.sky === 'storm' ? 'wet' : ''}`} title={SKY_INFO[f.sky].label}>
              {formatClock(f.time).slice(0, 2)}h
              <span className="fc-icon">{icon}</span>
              {f.temp}°
            </div>
          );
        })}
      </div>
      <p className="hint small">
        {wet
          ? 'Wet riders mark you down unless your tuk-tuk has rain curtains (garage upgrade).'
          : 'Afternoon storms are common from May to October; smoky haze from mid-February to April.'}
      </p>
    </section>
  );
}

interface EventRowProps {
  o: EventOccurrence;
  now: number;
  live: boolean;
  view: GameView | null;
  game: Game;
  /** Time text; defaults to the occurrence's hours (or "until …" when live). */
  when?: string;
}

function EventRow({ o, now, live, view, game, when }: EventRowProps) {
  const e = o.event;
  const at = eventAnchor(game.world, e);
  const chips = eventEffectChips(e);
  return (
    <button className={`ev-row ${live ? 'live' : ''}`} onClick={() => at && view?.flyTo(at.x, at.y, 15)} title={at ? 'Show on the map' : e.where}>
      <span className="ev-icon">{e.icon}</span>
      <span>
        <span className="ev-top">
          <span className="ev-name">{e.name}</span>
          {e.th && <span className="ev-th">{e.th}</span>}
          <span className="ev-time">{when ?? (live ? untilText(o, now) : occurrenceTime(o))}</span>
          {o.approx && <span className="tag-approx">expected</span>}
        </span>
        <span className="ev-where">{e.where}</span>
        <span className="ev-drivers">{e.drivers}</span>
        {chips.length > 0 && (
          <span className="wchips">
            {chips.map((c) => (
              <span key={c} className={`wchip ${c.startsWith('⛔') ? 'closed' : ''}`}>
                {c}
              </span>
            ))}
          </span>
        )}
      </span>
    </button>
  );
}

function dedupe(list: EventOccurrence[]): EventOccurrence[] {
  const seen = new Set<string>();
  return list.filter((o) => (seen.has(o.event.id) ? false : (seen.add(o.event.id), true)));
}

function ActiveEvents({ game, view, now }: { game: Game; view: GameView | null; now: number }) {
  const active = dedupe(activeOccurrences(now));
  return (
    <section>
      <div className="eyebrow">On now</div>
      <div className="ev-list" style={{ marginTop: 6 }}>
        {active.length === 0 && <p className="muted small">Nothing special on — an ordinary day on the streets.</p>}
        {active.map((o) => (
          <EventRow key={o.key} o={o} now={now} live view={view} game={game} />
        ))}
      </div>
    </section>
  );
}

/** One row per event: its first run in the window, with repeats folded into the time text. */
interface UpcomingRow {
  first: EventOccurrence;
  count: number;
}

function Upcoming({ game, view, now }: { game: Game; view: GameView | null; now: number }) {
  const activeIds = new Set(activeOccurrences(now).map((o) => o.event.id));
  const rows = new Map<string, UpcomingRow>();
  for (const o of upcomingOccurrences(now, LOOKAHEAD_DAYS)) {
    if (o.start <= now || activeIds.has(o.event.id)) continue;
    const row = rows.get(o.event.id);
    if (row) row.count++;
    else rows.set(o.event.id, { first: o, count: 1 });
  }
  const groups: { label: string; items: UpcomingRow[] }[] = [];
  for (const row of rows.values()) {
    const label = dayLabel(row.first.start, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(row);
    else groups.push({ label, items: [row] });
  }
  const next = [...rows.values()][0]?.first;
  const when = (r: UpcomingRow): string => {
    const weekly = r.first.event.weekly?.[0];
    if (weekly) return `every ${WEEKDAYS[weekly.weekday]} ${occurrenceTime(r.first)}`;
    return r.count > 1 ? `${occurrenceTime(r.first)} · ${r.count} days` : occurrenceTime(r.first);
  };
  return (
    <section>
      <div className="cal-head">
        <span className="eyebrow">Next {LOOKAHEAD_DAYS} days</span>
        {next && <span className="muted small">next: {startsIn(next, now)}</span>}
      </div>
      <div className="ev-list" style={{ marginTop: 6 }}>
        {groups.length === 0 && <p className="muted small">No festivals or closures in the next two weeks.</p>}
        {groups.map((grp) => (
          <div key={grp.label} className="ev-list">
            <div className="ev-day">{grp.label}</div>
            {grp.items.map((r) => (
              <EventRow key={r.first.key} o={r.first} now={now} live={false} view={view} game={game} when={when(r)} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function Competition({ game }: { game: Game }) {
  const sys = rivalsOf(game);
  const st = game.state.systems.rivals as { taken?: number; takenToday?: number } | undefined;
  if (!sys) return null;
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < sys.count; i++) counts[sys.kind[i]]++;
  const label: Record<(typeof RIVAL_KINDS)[number], string> = {
    songthaew: '🚐 Songthaews',
    tuktuk: '🛺 Rival tuk-tuks',
    car: '🚗 Cars',
    motorbike: '🛵 Motorbikes',
  };
  return (
    <section className="cal-card">
      <div className="cal-head">
        <span className="eyebrow">Competition on the road</span>
        <span className="muted small">
          {st?.takenToday ?? 0} fares lost today · {st?.taken ?? 0} total
        </span>
      </div>
      <div className="rival-stats">
        {RIVAL_KINDS.map((k, i) => (
          <div key={k} className="rival-stat">
            <b>{counts[i]}</b>
            {label[k]}
          </div>
        ))}
      </div>
      <p className="hint small">
        Red songthaews (rot daeng) and rival tuk-tuks pick up passengers who have waited too long. Locals favour the ฿30-a-head songthaew; tourists
        prefer a tuk-tuk. More rivals take to the road each month and during festivals.
      </p>
    </section>
  );
}
