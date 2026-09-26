import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { sound } from '../../audio/sound';
import './sound.css';

/** Top-bar sound button: a small popover with mute and volume. */
export function SoundControls() {
  const s = useSyncExternalStore(sound.subscribe, () => sound.settings);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const silent = s.muted || s.volume === 0;
  const icon = silent ? '🔇' : s.volume < 0.4 ? '🔈' : '🔊';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="sound-controls" ref={root}>
      <button
        className={`btn tiny ${open ? 'on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={silent ? 'Sound is off' : `Sound ${Math.round(s.volume * 100)}%`}
        aria-label="Sound settings"
        aria-expanded={open}
      >
        {icon}
      </button>
      {open && (
        <div className="sound-popover" role="dialog" aria-label="Sound">
          <div className="eyebrow">Sound</div>
          <label className="sound-volume">
            <span className="small muted">Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={s.muted ? 0 : s.volume}
              onChange={(e) => sound.setVolume(Number(e.target.value))}
              aria-label="Volume"
            />
            <span className="small">{s.muted ? 'off' : `${Math.round(s.volume * 100)}%`}</span>
          </label>
          <button className={`btn wide ${s.muted ? 'on' : ''}`} onClick={() => sound.toggleMute()}>
            {s.muted ? '🔇 Muted — tap to unmute' : '🔇 Mute'}
          </button>
          <p className="hint small">Engine, horn, coins and rain are made live in your browser — no downloads.</p>
        </div>
      )}
    </div>
  );
}
