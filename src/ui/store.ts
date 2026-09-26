import { useRef, useSyncExternalStore } from 'react';
import { DRIVE_PACES, DRIVE_TIME_SCALE, type PlayMode } from '../sim/driveClock';
import type { Game } from '../sim/game';

/** UI-only state shared by the map view and React panels (not saved). */
export interface UIState {
  selectedRequest: number | null;
  selectedVehicle: number | null;
  selectedPlace: number | null;
  /** Camera follows the selected (or player's) tuk-tuk. */
  follow: boolean;
  /** Right-hand management panel, or null when closed. */
  panel: string | null;
  /** Kerbside negotiation in progress for the player. */
  haggle: { vehicleId: number; requestId: number } | null;
  /** Modal dialog id (menu, help, new game…), or null. */
  modal: string | null;
  /** Drive: you steer your own tuk-tuk with a chase camera. Manage: your tuk-tuk drives itself and the speed buttons rule. */
  mode: PlayMode;
  /** The flat city-map planner is shown instead of the 3D view. */
  planner: boolean;
  /** Game seconds per real second while you steer by hand (the "Driving pace" setting). */
  drivePace: number;
  /** The last toot of your horn: performance.now() and where (sim metres). Waiting passengers nearby wave harder. */
  horn: { at: number; x: number; y: number } | null;
}

type Listener = () => void;

const PACE_KEY = 'tuktuk-drive-pace';

/** The saved "Driving pace" setting, or the default when storage is empty or unavailable. */
export function loadDrivePace(): number {
  try {
    const v = Number(localStorage.getItem(PACE_KEY));
    return (DRIVE_PACES as readonly number[]).includes(v) ? v : DRIVE_TIME_SCALE;
  } catch {
    return DRIVE_TIME_SCALE;
  }
}

/** Change the "Driving pace" setting and remember it in this browser. */
export function setDrivePace(pace: number): void {
  ui.set({ drivePace: pace });
  try {
    localStorage.setItem(PACE_KEY, String(pace));
  } catch {
    /* storage unavailable: the setting lasts for this session only */
  }
}

export class Store<T extends object> {
  private state: T;
  private listeners = new Set<Listener>();

  constructor(initial: T) {
    this.state = initial;
  }

  get(): T {
    return this.state;
  }

  set(patch: Partial<T> | ((s: T) => Partial<T>)): void {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...next };
    this.listeners.forEach((l) => l());
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export const ui = new Store<UIState>({
  selectedRequest: null,
  selectedVehicle: null,
  selectedPlace: null,
  follow: true,
  panel: null,
  haggle: null,
  modal: null,
  mode: 'drive',
  planner: false,
  drivePace: loadDrivePace(),
  horn: null,
});

export function useUI<T>(select: (s: UIState) => T): T {
  return useSyncExternalStore(ui.subscribe, () => select(ui.get()));
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/** Tick emitted to React at most UI_HZ times per second. */
const UI_HZ = 5;
const tickListeners = new Set<Listener>();
let tickVersion = 0;
let lastTick = 0;

/** Wire the game's frame events to React re-renders (call once per game). */
export function bindGameTicks(game: Game): () => void {
  const bump = () => {
    tickVersion++;
    tickListeners.forEach((l) => l());
  };
  const offFrame = game.on('frame', () => {
    const now = performance.now();
    if (now - lastTick >= 1000 / UI_HZ) {
      lastTick = now;
      bump();
    }
  });
  // Discrete events refresh immediately.
  const offs = ['notice', 'trip', 'day', 'speed', 'pause', 'haggle', 'change'].map((e) => game.on(e, bump));
  return () => {
    offFrame();
    offs.forEach((o) => o());
  };
}

function subscribeTicks(l: Listener): () => void {
  tickListeners.add(l);
  return () => tickListeners.delete(l);
}

/**
 * Read derived data from the game, re-evaluated on each UI tick. The result is
 * compared shallowly, so return primitives, flat objects or arrays of stable refs.
 */
export function useGame<T>(game: Game, select: (g: Game) => T): T {
  const cache = useRef<{ version: number; select: (g: Game) => T; value: T } | null>(null);
  return useSyncExternalStore(subscribeTicks, () => {
    const c = cache.current;
    if (c && c.version === tickVersion && c.select === select) return c.value;
    const value = select(game);
    if (c && shallowEqual(c.value, value)) {
      c.version = tickVersion;
      c.select = select;
      return c.value;
    }
    cache.current = { version: tickVersion, select, value };
    return value;
  });
}
