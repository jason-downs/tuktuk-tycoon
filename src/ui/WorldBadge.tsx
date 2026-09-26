import '../map/worldPainters';
import { activeOccurrences, upcomingOccurrences } from '../sim/events';
import { currentWeather, weatherIcon, weatherLabel } from '../sim/weather';
import type { OverlayProps } from './overlays';
import { ui, useGame, useUI } from './store';
import { byImportance, startsIn, untilText } from './worldFormat';
import './world.css';

/** Days ahead the badge looks for the next festival when nothing is on. */
const NEXT_DAYS = 7;

/** Pill under the top bar: weather now and the main event running; opens the calendar panel. */
export function WorldBadge({ game }: OverlayProps) {
  const d = useGame(game, (g) => {
    const now = g.state.time;
    const w = currentWeather(g);
    const active = activeOccurrences(now).sort(byImportance);
    const main = active.find((o) => o.event.kind !== 'season') ?? active[0];
    const closed = active.some((o) => o.event.roads?.some((r) => r.closed));
    let next = '';
    if (!main) {
      const up = upcomingOccurrences(now, NEXT_DAYS).find((o) => o.start > now && (o.event.kind === 'festival' || o.event.kind === 'holiday'));
      if (up) next = `${up.event.icon} ${up.event.name} ${startsIn(up, now)}`;
    }
    return {
      icon: weatherIcon(w, now),
      temp: w.temp,
      label: weatherLabel(w),
      event: main ? `${main.event.icon} ${main.event.name}` : '',
      until: main ? untilText(main, now) : '',
      live: main?.event.kind === 'festival',
      more: Math.max(0, new Set(active.map((o) => o.event.id)).size - 1),
      closed,
      next,
    };
  });
  const open = useUI((s) => s.panel === 'calendar');
  const title = `${d.label}, ${d.temp}°C${d.event ? ` · ${d.event} ${d.until}` : ''} — open the calendar`;
  return (
    <button className={`world-badge ${open ? 'on' : ''}`} title={title} onClick={() => ui.set({ panel: open ? null : 'calendar' })}>
      <span className="wb-weather">
        <span className="wb-icon">{d.icon}</span>
        {d.temp}°
      </span>
      <span className="wb-sep" />
      {d.event ? (
        <span className={`wb-event ${d.live ? 'live' : ''}`}>
          {d.live && <span className="wb-pulse" />}
          {d.event} <span className="muted small">{d.until}</span>
          {d.more > 0 && <span className="muted small"> +{d.more}</span>}
        </span>
      ) : (
        <span className="wb-event muted">{d.next ? `Next: ${d.next}` : d.label}</span>
      )}
      {d.closed && <span className="wb-closed">⛔</span>}
    </button>
  );
}
