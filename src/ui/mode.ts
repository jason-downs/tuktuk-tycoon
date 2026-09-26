// Drive and Manage modes (UI-only, not saved). Drive puts you at the wheel of
// your own tuk-tuk with a chase camera and the drive clock; Manage hands your
// tuk-tuk to autopilot, frees the camera and gives the clock back to the speed
// buttons. The last choice is remembered for the browser session.

import type { PlayMode } from '../sim/driveClock';
import type { Game } from '../sim/game';
import { setManual } from '../sim/manual';
import { ui } from './store';

const SESSION_KEY = 'tuktuk-mode';
/** The mode chosen this session when session storage is unavailable. */
let sessionChoice: PlayMode | null = null;
/** Autopilot as it was when Manage switched it on, per game. */
const autopilotBefore = new WeakMap<Game, boolean>();

function readSessionMode(): PlayMode | null {
  try {
    const v = sessionStorage.getItem(SESSION_KEY);
    if (v === 'drive' || v === 'manage') return v;
  } catch {
    /* no session storage: fall back to this page's memory */
  }
  return sessionChoice;
}

function rememberMode(mode: PlayMode): void {
  sessionChoice = mode;
  try {
    sessionStorage.setItem(SESSION_KEY, mode);
  } catch {
    /* no session storage: this page's memory is enough */
  }
}

/** The mode a game opens in: the last one chosen this session, else Drive while the fleet is a single tuk-tuk. */
export function initialMode(game: Game): PlayMode {
  return readSessionMode() ?? (game.state.vehicles.length <= 1 ? 'drive' : 'manage');
}

/** Switching is blocked while the player haggles at the kerb. */
export function canSwitchMode(game: Game): boolean {
  return ui.get().haggle === null && !game.isPaused('haggle');
}

/**
 * Put the game in a mode. Manage switches autopilot on for your tuk-tuk
 * (remembering how it was); Drive puts your hands on the wheel (manual
 * driving), or restores autopilot as it was if there is no tuk-tuk to drive.
 * Returns false while switching is blocked.
 */
export function applyMode(game: Game, mode: PlayMode): boolean {
  if (!canSwitchMode(game)) return false;
  if (mode === 'manage') {
    if (!autopilotBefore.has(game)) autopilotBefore.set(game, game.state.autopilot);
    setManual(game, false);
    game.state.autopilot = true;
    ui.set({ mode });
  } else {
    const before = autopilotBefore.get(game) ?? false;
    autopilotBefore.delete(game);
    if (!setManual(game, true)) game.state.autopilot = before;
    ui.set({ mode, follow: true, selectedVehicle: null });
  }
  game.emit('mode', mode);
  game.emit('change');
  return true;
}

/** Switch mode by the player's choice (Tab or the top-bar toggle), and remember it for the session. */
export function setMode(game: Game, mode: PlayMode): boolean {
  if (!applyMode(game, mode)) {
    game.notify('Finish the haggle first.', 'info');
    return false;
  }
  rememberMode(mode);
  return true;
}

/** Tab: Drive ↔ Manage. */
export function toggleMode(game: Game): boolean {
  return setMode(game, ui.get().mode === 'drive' ? 'manage' : 'drive');
}
