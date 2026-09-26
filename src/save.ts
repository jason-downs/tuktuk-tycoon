import type { World } from './data/world';
import { Game, SAVE_VERSION } from './sim/game';
import type { GameState } from './sim/types';

const KEY = 'tuktuk-tycoon-save';

export interface SaveInfo {
  company: string;
  time: number;
  cash: number;
  savedAt: number;
  /** Save format; saves from another version can't be continued. */
  version?: number;
}

/** A save exists but was made for a different map/format. */
export function saveIsStale(info: SaveInfo): boolean {
  return (info.version ?? 1) !== SAVE_VERSION;
}

export function readSaveInfo(): SaveInfo | null {
  try {
    const raw = localStorage.getItem(`${KEY}:info`);
    return raw ? (JSON.parse(raw) as SaveInfo) : null;
  } catch {
    return null;
  }
}

export function saveGame(game: Game): boolean {
  try {
    localStorage.setItem(KEY, game.serialize());
    const info: SaveInfo = { company: game.state.companyName, time: game.state.time, cash: game.state.cash, savedAt: Date.now(), version: SAVE_VERSION };
    localStorage.setItem(`${KEY}:info`, JSON.stringify(info));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(world: World): Game | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as GameState;
    if (state.version !== SAVE_VERSION) return null;
    return Game.load(world, state);
  } catch {
    return null;
  }
}

export function deleteSave(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(`${KEY}:info`);
  } catch {
    /* storage unavailable */
  }
}
