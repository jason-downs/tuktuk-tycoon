// Game keys. ? opens and closes Help, and Esc closes it. In both modes Tab
// switches mode, M opens the city map, Space pauses, 1–5 set the speed, F
// follows and Esc closes cards, panels and the city map; in Drive mode E (or
// Enter) picks up or fills up at the kerb, H sounds the horn and G hands the
// wheel to the GPS and back. Pedal and turn keys live with the manual-driving
// overlay (manual/ManualDrive.tsx). Shift+Tab moves keyboard focus instead
// (focusNav.ts). No game key acts while a dialog (Help) or the haggle has the
// keyboard. All of these go through one window listener (keyDown), so the key
// that closes Help is never also read as a game key.

import { useEffect } from 'react';
import { sound } from '../../audio/sound';
import type { Game } from '../../sim/game';
import { manualInteract, setAutodrive, whoDrives } from '../../sim/manual';
import { focusNavActive, installFocusNav, onFocusedControl } from '../focusNav';
import { setMode, toggleMode } from '../mode';
import { ui } from '../store';

/** Input types that take no typed text: a click leaves them focused, and the game keys still work. */
const NON_TEXT_INPUTS: ReadonlySet<string> = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image']);

/**
 * Whether a key belongs to the focused form control rather than the game: every key in a text field, select or
 * editable element; only the arrow, Home, End and page keys on a slider; none on a checkbox or button.
 */
export function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  if (type === 'range') return /^(Arrow|Home$|End$|Page)/.test(e.key);
  return !NON_TEXT_INPUTS.has(type);
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

/** 🕹️ on the player card: in Manage mode take the wheel (switch to Drive); in Drive mode the same as G. */
export function toggleWheel(game: Game): void {
  if (ui.get().mode === 'drive') toggleAutodrive(game);
  else setMode(game, 'drive');
}

/** One key press for the Drive/Manage keys. Keys under an open dialog (Help) are left to it. */
export function driveKeyDown(game: Game, e: KeyboardEvent): void {
  if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
  const s = ui.get();
  if (s.modal !== null) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === 'Tab') {
    // Shift+Tab, and Tab once it has moved focus, move keyboard focus through the controls.
    if (e.shiftKey || focusNavActive()) return;
    e.preventDefault();
    if (!e.repeat) toggleMode(game);
    return;
  }
  if (k === 'm') {
    if (!e.repeat) ui.set((st) => ({ planner: !st.planner }));
    return;
  }
  if (s.mode !== 'drive' || s.planner || s.haggle !== null || e.repeat) return;
  if (k === 'e' || (k === 'Enter' && !onFocusedControl(e))) {
    e.preventDefault();
    manualInteract(game);
  } else if (k === 'h') {
    soundHorn(game);
  } else if (k === 'g') {
    toggleAutodrive(game);
  }
}

/** One key press for the keys that work in both modes: pause, speed, follow and Esc. */
export function gameKeyDown(game: Game, e: KeyboardEvent): void {
  if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
  const s = ui.get();
  if (s.haggle !== null || s.modal !== null) return;
  if (e.key === ' ') {
    if (onFocusedControl(e)) return;
    e.preventDefault();
    game.setSpeed(game.state.speed === 0 ? 2 : 0);
  } else if (e.key >= '1' && e.key <= '5') {
    game.setSpeed(Number(e.key));
  } else if (e.key === 'f' || e.key === 'F') {
    ui.set((st) => ({ follow: !st.follow }));
  } else if (e.key === 'Escape') {
    ui.set({ selectedRequest: null, selectedPlace: null, selectedVehicle: null, panel: null, planner: false });
  }
}

/** Help's keys: ? opens and closes it, Esc closes it. Returns whether the key was Help's. */
export function helpKeyDown(e: KeyboardEvent): boolean {
  if (isTyping(e)) return false;
  if (e.key === '?') {
    ui.set((s) => ({ modal: s.modal === 'help' ? null : 'help' }));
    return true;
  }
  if (e.key === 'Escape' && ui.get().modal === 'help') {
    ui.set({ modal: null });
    return true;
  }
  return false;
}

/** One key press as the window listener sees it: Help's keys, then the game keys. */
export function keyDown(game: Game, e: KeyboardEvent): void {
  if (helpKeyDown(e)) return;
  gameKeyDown(game, e);
  driveKeyDown(game, e);
}

/** Install the game keys and keyboard focus navigation for a game. */
export function useDriveKeys(game: Game): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyDown(game, e);
    const offFocus = installFocusNav();
    window.addEventListener('keydown', onKey);
    return () => {
      offFocus();
      window.removeEventListener('keydown', onKey);
    };
  }, [game]);
}
