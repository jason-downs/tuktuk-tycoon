import { previewTurn, walkingPassenger, whoDrives } from '../../sim/manual';
import { signalAhead } from '../../sim/signals';
import { km, taskText } from '../format';
import type { OverlayProps } from '../overlays';
import { useGame, useUI } from '../store';
import './drive.css';

const ARROW: Record<string, string> = { left: '↰', right: '↱', straight: '↑', uturn: '↶', arrive: '📍', road: '↑' };
/** Signals are announced this far ahead (m). */
const SIGNAL_NOTICE_M = 150;

/**
 * Drive-mode GPS line under the top bar: the next turn ("120 m · left onto
 * Moon Muang Rd"), the destination and its distance, who is driving, the
 * speed, and a red light ahead.
 */
export function GpsHud({ game }: OverlayProps) {
  const mode = useUI((s) => s.mode);
  const planner = useUI((s) => s.planner);
  const d = useGame(game, (g) => {
    const v = g.playerVehicle();
    if (!v) return null;
    const graph = g.world.graph;
    const who = whoDrives(g);
    const t = v.task;
    if (t.kind === 'away' || t.kind === 'broken') return { status: taskText(g, v), who, kmh: 0, next: '', arrow: '', dest: '', gps: -1, light: '', lightM: 0, walking: false, idle: false };
    const p = previewTurn(g, v);
    let next = 'Open road ahead';
    let arrow = ARROW.road;
    if (p) {
      const road = p.exit ? graph.edgeName(p.exit.arc >> 1) : '';
      if (!p.exit) {
        next = `${km(p.distance)} · destination ahead`;
        arrow = ARROW.arrive;
      } else if (p.exit.kind === 'uturn') {
        next = `${km(p.distance)} · dead end, turning back`;
        arrow = ARROW.uturn;
      } else {
        const how = p.exit.kind === 'straight' ? 'straight on' : p.exit.kind;
        next = `${km(p.distance)} · ${how}${road ? ` ${p.exit.kind === 'straight' ? 'along' : 'onto'} ${road}` : ''}`;
        arrow = ARROW[p.exit.kind];
      }
    }
    let gps = -1;
    if (v.route) {
      gps = graph.arcLen(v.arc) - v.s;
      for (let i = v.routeIdx + 1; i < v.route.arcs.length; i++) gps += graph.arcLen(v.route.arcs[i]);
    }
    let dest = '';
    if (t.kind === 'trip') dest = g.place(t.trip.request.to).name;
    else if (t.kind === 'pickup') {
      const r = g.state.requests.find((q) => q.id === t.requestId);
      dest = r ? `your passenger at ${g.place(r.from).name}` : 'your passenger';
    } else if (t.kind === 'refuel') dest = g.place(t.place).name;
    else if (t.kind === 'cruise') dest = t.place >= 0 ? g.place(t.place).name : 'the spot you picked';
    const sig = signalAhead(g, v, SIGNAL_NOTICE_M);
    const light = sig && sig.light !== 'green' && sig.toLine > -1 ? sig.light : '';
    return {
      status: '',
      who,
      kmh: Math.round(v.speed * 3.6),
      next,
      arrow,
      dest,
      gps,
      light,
      lightM: sig ? Math.max(0, Math.round(sig.toLine)) : 0,
      walking: !!walkingPassenger(g),
      idle: t.kind === 'idle' || (t.kind === 'cruise' && !v.route),
    };
  });
  if (mode !== 'drive' || planner || !d) return null;
  const driver =
    d.who === 'hand' ? '🕹️ You drive · G autodrive' : d.who === 'gps' ? '🧭 GPS drives · W takes the wheel' : '🤖 Autodrive · W takes the wheel';
  return (
    <div className="gps-hud" role="status" aria-live="polite">
      {d.status ? (
        <div className="gps-line">{d.status}</div>
      ) : (
        <>
          <div className="gps-line">
            <span className="gps-arrow">{d.arrow}</span>
            <span className="gps-next">{d.next}</span>
            <span className="gps-speed">
              <b>{d.kmh}</b> km/h
            </span>
          </div>
          <div className="gps-sub">
            {d.walking ? (
              <span>🚶 Your passenger is walking over…</span>
            ) : d.dest ? (
              <span>
                📍 {d.dest}
                {d.gps >= 0 ? ` · ${km(d.gps)}` : ''}
              </span>
            ) : d.idle ? (
              <span>{d.who === 'autopilot' ? 'Looking for passengers…' : 'Find a waving passenger: stop beside them and press E'}</span>
            ) : null}
            {d.light && (
              <span className={`gps-light gps-light-${d.light}`}>
                {d.light === 'red' ? '🔴 Red light' : '🟡 Amber'} · {km(d.lightM)}
              </span>
            )}
          </div>
        </>
      )}
      <div className="gps-who small">{driver}</div>
    </div>
  );
}
