import { useEffect, type PointerEvent as ReactPointerEvent } from 'react';
import '../../map/manualPainter';
import type { Game } from '../../sim/game';
import {
  MANUAL_SPEED_BONUS,
  manualControl,
  pickTurn,
  previewTurn,
  setAutodrive,
  setManual,
  setPedals,
  uTurn,
  whoDrives,
  type TurnIntent,
} from '../../sim/manual';
import { targetSpeed } from '../../sim/movement';
import { isTyping } from '../drive/DriveKeys';
import { km } from '../format';
import type { OverlayProps } from '../overlays';
import { ui, useGame, useUI } from '../store';
import './manual.css';

/** Real milliseconds the brake is held at a standstill before the tuk-tuk U-turns. */
const UTURN_HOLD_MS = 500;
/** Below this speed (m/s) the tuk-tuk counts as standing still for a U-turn. */
const STANDSTILL_MS = 0.3;

/** Switch manual driving for the player's tuk-tuk, keeping the camera on it. */
export function toggleManual(game: Game): void {
  const on = !manualControl(game).on;
  if (!setManual(game, on)) return;
  if (on) {
    ui.set({ follow: true, selectedVehicle: null });
    game.notify('Manual driving: hold W/↑ to go, S/↓ to brake, A/D or ←/→ to choose the next turn. G hands the wheel to the GPS.', 'info');
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
      title={d.on ? 'Hand the wheel to the GPS (G)' : 'Drive by hand: throttle, brake and turns (W)'}
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
        Hold <kbd>W</kbd> go · <kbd>S</kbd> brake · <kbd>A</kbd>/<kbd>D</kbd> next turn · <kbd>G</kbd> GPS
      </div>
    </div>
  );
}

/**
 * The brake doubles as the U-turn: pressed at a standstill and held for
 * UTURN_HOLD_MS, the tuk-tuk turns round (two-way roads only).
 */
const brakeHold = new WeakMap<Game, { since: number | null; warned: boolean }>();

function brakeDown(game: Game): void {
  const v = game.playerVehicle();
  const at = !!v && manualControl(game).on && v.speed < STANDSTILL_MS;
  brakeHold.set(game, { since: at ? performance.now() : null, warned: false });
}

function brakeUp(game: Game): void {
  brakeHold.delete(game);
}

/** Called every frame: turn round once the brake has been held long enough at a standstill. */
function checkUTurn(game: Game): void {
  const hold = brakeHold.get(game);
  if (!hold || hold.since === null || game.isPaused() || performance.now() - hold.since < UTURN_HOLD_MS) return;
  hold.since = null;
  if (uTurn(game)) return;
  const v = game.playerVehicle();
  if (v && !hold.warned && !game.world.graph.arcValid(v.arc ^ 1)) {
    hold.warned = true;
    game.notify('One-way street — no U-turns here. Take the next turn instead.', 'info');
  }
}

/** Driving keys and pad buttons in Drive mode take the wheel back from the GPS or autopilot. */
function takeWheel(game: Game): boolean {
  const s = ui.get();
  if (s.mode !== 'drive' || s.haggle !== null || s.planner || !game.playerVehicle()) return false;
  if (whoDrives(game) === 'hand') return true;
  return setAutodrive(game, false) === 'hand';
}

/** Keyboard driving (WASD, arrows) and, on touch screens, an on-screen pad. */
export function ManualDriveOverlay({ game }: OverlayProps) {
  const d = useGame(game, (g) => {
    const c = manualControl(g);
    return { on: c.on, turn: c.turn ?? '', throttle: c.throttle, brake: c.brake, has: !!g.playerVehicle() };
  });

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || ui.get().haggle !== null) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const driving = k === 'w' || k === 's' || k === 'a' || k === 'd' || k.startsWith('Arrow');
      if (!driving) return;
      const c = manualControl(game);
      if (!c.on && !(driving && !e.repeat && takeWheel(game))) return;
      if (k === 'w' || k === 'ArrowUp') setPedals(game, true, c.brake);
      else if (k === 's' || k === 'ArrowDown') {
        if (!e.repeat) brakeDown(game);
        setPedals(game, c.throttle, true);
      } else if (k === 'a' || k === 'ArrowLeft') {
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
      else if (k === 's' || k === 'ArrowDown') {
        brakeUp(game);
        setPedals(game, c.throttle, false);
      }
    };
    const release = () => {
      brakeUp(game);
      setPedals(game, false, false);
    };
    const offFrame = game.on('frame', () => checkUTurn(game));
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    return () => {
      offFrame();
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
    };
  }, [game]);

  const driveMode = useUI((s) => s.mode === 'drive' && !s.planner);
  if (!d.on && !(driveMode && d.has)) return null;
  const hold = (pedal: 'throttle' | 'brake', on: boolean) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (on && !takeWheel(game) && !manualControl(game).on) return;
    const c = manualControl(game);
    if (on) e.currentTarget.setPointerCapture?.(e.pointerId);
    if (pedal === 'throttle') setPedals(game, on, c.brake);
    else {
      if (on) brakeDown(game);
      else brakeUp(game);
      setPedals(game, c.throttle, on);
    }
  };
  const turn = (dir: TurnIntent) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!takeWheel(game) && !manualControl(game).on) return;
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
