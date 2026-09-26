import { useEffect, useRef, useState } from 'react';
import { DRIVE_IDLE_TIME_SCALE, DRIVE_PACES, clockLabel } from '../../sim/driveClock';
import type { Game } from '../../sim/game';
import { setMode } from '../mode';
import { setDrivePace, ui, useGame, useUI } from '../store';
import './drive.css';

/** Drive / Manage switch in the top bar (Tab). */
export function ModeToggle({ game }: { game: Game }) {
  const mode = useUI((s) => s.mode);
  const haggling = useUI((s) => s.haggle !== null);
  const planner = useUI((s) => s.planner);
  return (
    <div className="mode-toggle" role="group" aria-label="Play mode">
      <button
        className={`btn tiny ${mode === 'drive' ? 'on' : ''}`}
        disabled={haggling}
        aria-pressed={mode === 'drive'}
        onClick={() => setMode(game, 'drive')}
        title="Drive: steer your own tuk-tuk, the clock slows to street pace (Tab)"
      >
        🛺 <span className="mode-label">Drive</span>
      </button>
      <button
        className={`btn tiny ${mode === 'manage' ? 'on' : ''}`}
        disabled={haggling}
        aria-pressed={mode === 'manage'}
        onClick={() => setMode(game, 'manage')}
        title="Manage: your tuk-tuk drives itself, the speed buttons run the clock (Tab)"
      >
        📋 <span className="mode-label">Manage</span>
      </button>
      <button
        className={`btn tiny ${planner ? 'on' : ''}`}
        aria-pressed={planner}
        onClick={() => ui.set((s) => ({ planner: !s.planner }))}
        title="City map: the flat planning map of zones, closures and events (M)"
      >
        🗺️ <span className="mode-label">City map</span>
      </button>
    </div>
  );
}

/** "Drive clock ⅛×" beside the speed buttons while Drive mode runs the clock, with the Driving pace setting. */
export function DriveClockChip({ game }: { game: Game }) {
  const mode = useUI((s) => s.mode);
  const pace = useUI((s) => s.drivePace);
  const d = useGame(game, (g) => ({ scale: g.timeScale, paused: g.isPaused(), active: g.clockOverride?.(g) != null }));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  if (mode !== 'drive' || !d.active) return null;
  const label = d.paused ? '❚❚' : clockLabel(d.scale);
  const why = d.scale > DRIVE_IDLE_TIME_SCALE ? 'fast-forwarding while you are away' : d.scale >= DRIVE_IDLE_TIME_SCALE ? '1× while parked, loading or on the GPS' : `${pace} game seconds per real second while you steer`;
  return (
    <div className="drive-clock" ref={ref}>
      <button
        className="drive-clock-chip"
        onClick={() => setOpen((o) => !o)}
        title={`Drive clock: ${why}. Click to set the driving pace.`}
        aria-expanded={open}
      >
        ⏱ <span className="drive-clock-name">Drive clock</span> <b>{label}</b>
      </button>
      {open && (
        <div className="drive-clock-pop" role="dialog" aria-label="Driving pace">
          <div className="eyebrow">Driving pace</div>
          <div className="row">
            {DRIVE_PACES.map((p) => (
              <button key={p} className={`btn tiny ${pace === p ? 'on' : ''}`} onClick={() => setDrivePace(p)} aria-pressed={pace === p}>
                {p}
              </button>
            ))}
          </div>
          <p className="small muted">
            Game seconds per real second while you steer by hand ({clockLabel(pace)} of 1×). The clock runs at 1× while you are
            parked, loading or letting the GPS drive, and speeds up while you are out of town.
          </p>
        </div>
      )}
    </div>
  );
}
