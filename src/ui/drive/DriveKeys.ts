// Drive and Manage keys: Tab switches mode, M opens the city map, and in Drive
// mode E (or Enter) picks up or fills up at the kerb, H sounds the horn and G
// hands the wheel to the GPS and back. Pedal and turn keys live with the
// manual-driving overlay (manual/ManualDrive.tsx).

import { useEffect } from 'react';
import { sound } from '../../audio/sound';
import type { Game } from '../../sim/game';
import { manualInteract, setAutodrive, whoDrives } from '../../sim/manual';
import { toggleMode } from '../mode';
import { ui } from '../store';

/** Keys typed into a text field, select or editable element are not game keys. */
export function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/** Toot the horn; waiting passengers near the tuk-tuk wave harder. */
export function soundHorn(game: Game): void {
  sound.horn();
  const v = game.playerVehicle();
  if (!v) return;
  const p = game.vehiclePose(v);
  ui.set({ horn: { at: performance.now(), x: p.x, y: p.y } });
}

/** G: hand the wheel to the GPS (or, with nowhere to go, to autopilot) and take it back. */
export function toggleAutodrive(game: Game): void {
  const next = setAutodrive(game, whoDrives(game) === 'hand');
  const text =
    next === 'hand'
      ? 'You have the wheel.'
      : next === 'gps'
        ? 'The GPS drives you there. G or W takes the wheel back.'
        : 'Autodrive: your tuk-tuk looks for passengers by itself. G or W takes the wheel back.';
  game.notify(text, 'info');
}

/** Install the Drive/Manage keys for a game. */
export function useDriveKeys(game: Game): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      const s = ui.get();
      if (s.modal !== null) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'Tab') {
        e.preventDefault();
        if (!e.repeat) toggleMode(game);
        return;
      }
      if (k === 'm') {
        if (!e.repeat) ui.set((st) => ({ planner: !st.planner }));
        return;
      }
      if (s.mode !== 'drive' || s.planner || s.haggle !== null || e.repeat) return;
      if (k === 'e' || k === 'Enter') {
        e.preventDefault();
        manualInteract(game);
      } else if (k === 'h') {
        soundHorn(game);
      } else if (k === 'g') {
        toggleAutodrive(game);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game]);
}
