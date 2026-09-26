import { useEffect, type PointerEvent as ReactPointerEvent } from 'react';
import '../../map/manualPainter';
import type { Game } from '../../sim/game';
import { MANUAL_SPEED_BONUS, manualControl, pickTurn, previewTurn, setManual, setPedals, type TurnIntent } from '../../sim/manual';
import { targetSpeed } from '../../sim/movement';
import { km } from '../format';
import type { OverlayProps } from '../overlays';
import { ui, useGame } from '../store';
import './manual.css';

/** Switch manual driving for the player's tuk-tuk, keeping the camera on it. */
export function toggleManual(game: Game): void {
  const on = !manualControl(game).on;
  if (!setManual(game, on)) return;
  if (on) {
    ui.set({ follow: true, selectedVehicle: null });
    game.notify('Manual driving: hold W/↑ to go, S/↓ to brake, A/D or ←/→ to choose the next turn. M hands back to the GPS.', 'info');
  } else {
    game.notify('Manual driving off.', 'info');
  }
}

/** 🕹️ button on the player card. */
export function ManualToggle({ game }: { game: Game }) {
  const d = useGame(game, (g) => ({ on: manualControl(g).on, has: !!g.playerVehicle() }));
  return (
    <button
      className={`btn ${d.on ? 'on' : ''}`}
      disabled={!d.has}
      onClick={() => toggleManual(game)}
      title={d.on ? 'Hand back to the GPS (M)' : 'Drive by hand: throttle, brake and turns (M)'}
      aria-pressed={d.on}
    >
      🕹️ {d.on ? 'Driving' : 'Drive'}
    </button>
  );
}

const ARROW: Record<string, string> = { left: '↰', right: '↱', straight: '↑', uturn: '↶', arrive: '📍' };

/** Speed, next turn and GPS distance, shown on the player card while driving by hand. */
export function ManualStatus({ game }: { game: Game }) {
  const d = useGame(game, (g) => {
    const c = manualControl(g);
    const v = g.playerVehicle();
    if (!c.on || !v) return null;
    const graph = g.world.graph;
    const p = previewTurn(g, v);
    let gps = -1;
    if (v.route) {
      gps = graph.arcLen(v.arc) - v.s;
      for (let i = v.routeIdx + 1; i < v.route.arcs.length; i++) gps += graph.arcLen(v.route.arcs[i]);
    }
    const t = v.task;
    const dest =
      t.kind === 'trip'
        ? g.place(t.trip.request.to).name
        : t.kind === 'refuel' || (t.kind === 'cruise' && t.place >= 0)
          ? g.place(t.place).name
          : t.kind === 'pickup'
            ? 'your passenger'
            : '';
    return {
      kmh: Math.round(v.speed * 3.6),
      max: Math.round(targetSpeed(g, v) * MANUAL_SPEED_BONUS * 3.6),
      kind: p ? (p.exit ? p.exit.kind : 'arrive') : '',
      source: p?.source ?? '',
      road: p?.exit ? graph.edgeName(p.exit.arc >> 1) : '',
      dist: p ? p.distance : 0,
      turn: c.turn ?? '',
      gps,
      dest,
      busy: g.state.time < v.busyUntil,
    };
  });
  if (!d) return null;
  let next = 'Open road ahead';
  if (d.kind === 'arrive') next = 'Destination ahead';
  else if (d.kind === 'uturn') next = 'Dead end — turning back';
  else if (d.kind) {
    const how = d.kind === 'straight' ? 'Straight on' : d.kind === 'left' ? 'Left' : 'Right';
    next = `${how}${d.road ? ` ${d.kind === 'straight' ? 'along' : 'onto'} ${d.road}` : ''}`;
  }
  return (
    <div className="manual-status" role="status">
      <div className="manual-speed">
        <b>{d.kmh}</b> km/h <span className="small muted">· up to {d.max}</span>
        {d.busy && <span className="small muted"> · passengers boarding</span>}
      </div>
      {d.kind && (
        <div className={`manual-next from-${d.source}`}>
          <span className="manual-arrow">{ARROW[d.kind] ?? '↑'}</span>
          <span>
            {next} <span className="small muted">in {km(d.dist)}</span>
          </span>
        </div>
      )}
      <div className="small muted">
        {d.turn ? `Next junction: ${d.turn} turn chosen (press again to cancel)` : d.gps >= 0 ? `GPS: ${km(d.gps)} to ${d.dest || 'the destination'}` : 'No route — explore, or pick a passenger'}
      </div>
      <div className="manual-keys small">
        Hold <kbd>W</kbd> go · <kbd>S</kbd> brake · <kbd>A</kbd>/<kbd>D</kbd> next turn · <kbd>M</kbd> exit
      </div>
    </div>
  );
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

/** Keyboard driving (M, WASD, arrows) and, on touch screens, an on-screen pad. */
export function ManualDriveOverlay({ game }: OverlayProps) {
  const d = useGame(game, (g) => {
    const c = manualControl(g);
    return { on: c.on, turn: c.turn ?? '', throttle: c.throttle, brake: c.brake };
  });

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'm') {
        if (!e.repeat) toggleManual(game);
        return;
      }
      const c = manualControl(game);
      if (!c.on) return;
      if (k === 'w' || k === 'ArrowUp') setPedals(game, true, c.brake);
      else if (k === 's' || k === 'ArrowDown') setPedals(game, c.throttle, true);
      else if (k === 'a' || k === 'ArrowLeft') {
        if (!e.repeat) pickTurn(game, 'left');
      } else if (k === 'd' || k === 'ArrowRight') {
        if (!e.repeat) pickTurn(game, 'right');
      } else return;
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      const c = manualControl(game);
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'w' || k === 'ArrowUp') setPedals(game, false, c.brake);
      else if (k === 's' || k === 'ArrowDown') setPedals(game, c.throttle, false);
    };
    const release = () => setPedals(game, false, false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
    };
  }, [game]);

  if (!d.on) return null;
  const hold = (pedal: 'throttle' | 'brake', on: boolean) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    const c = manualControl(game);
    if (on) e.currentTarget.setPointerCapture?.(e.pointerId);
    if (pedal === 'throttle') setPedals(game, on, c.brake);
    else setPedals(game, c.throttle, on);
  };
  const turn = (dir: TurnIntent) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    pickTurn(game, dir);
  };
  return (
    <div className="manual-pad" aria-label="Driving controls">
      <button className={`pad-btn ${d.turn === 'left' ? 'on' : ''}`} onPointerDown={turn('left')} aria-label="Turn left at the next junction">
        ◀
      </button>
      <div className="pad-col">
        <button
          className={`pad-btn ${d.throttle ? 'on' : ''}`}
          onPointerDown={hold('throttle', true)}
          onPointerUp={hold('throttle', false)}
          onPointerCancel={hold('throttle', false)}
          onLostPointerCapture={hold('throttle', false)}
          aria-label="Throttle (hold)"
        >
          ▲
        </button>
        <button
          className={`pad-btn ${d.brake ? 'on' : ''}`}
          onPointerDown={hold('brake', true)}
          onPointerUp={hold('brake', false)}
          onPointerCancel={hold('brake', false)}
          onLostPointerCapture={hold('brake', false)}
          aria-label="Brake (hold)"
        >
          ▼
        </button>
      </div>
      <button className={`pad-btn ${d.turn === 'right' ? 'on' : ''}`} onPointerDown={turn('right')} aria-label="Turn right at the next junction">
        ▶
      </button>
    </div>
  );
}
