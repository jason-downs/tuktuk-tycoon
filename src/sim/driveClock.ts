// The drive clock. At the speed buttons' 1× a tuk-tuk crosses the screen at
// hundreds of km/h, so while the player drives their own tuk-tuk in Drive mode
// game time follows a street-level pace: DRIVE_TIME_SCALE game seconds per real
// second while they steer, 1× while parked, loading or waiting with no
// passenger in sight, 1× while the GPS drives, and fast forward while the
// tuk-tuk is out of town or off the road. In Manage mode the speed buttons
// rule. Pauses (the pause button, the kerbside haggle) still stop time:
// Game.timeScale only asks the override when nothing is paused.

import { BASE_TIME_SCALE, SPEED_STEPS } from './clock';
import type { Game } from './game';
import { isManualDriven, manualControl } from './manual';
import type { Vehicle } from './types';

/** [pacing] Game seconds per real second while the player steers by hand (docs/plan-3d.md). */
export const DRIVE_TIME_SCALE = 4;
/** Driving paces offered in the settings, game seconds per real second. */
export const DRIVE_PACES = [3, 4, 5] as const;
/** Game seconds per real second while parked, loading, or stopped with no passenger in sight (1×). */
export const DRIVE_IDLE_TIME_SCALE = BASE_TIME_SCALE;
/** Game seconds per real second while the GPS drives the player's tuk-tuk (1×). */
export const AUTODRIVE_TIME_SCALE = BASE_TIME_SCALE;
/** [pacing] Game seconds per real second while the tuk-tuk is out of town or off the road for repairs (8×). */
export const AWAY_TIME_SCALE = 240;
/** Real seconds the clock takes to settle on a new pace. */
export const DRIVE_CLOCK_EASE_S = 0.4;
/** Below this speed (m/s) a hand-driven tuk-tuk counts as stopped. */
const STOPPED_MS = 0.3;

export type PlayMode = 'drive' | 'manage';

/** A passenger waiting for a ride within sight of the vehicle, not taken by anyone else. */
export function hailInSight(game: Game, v: Vehicle): boolean {
  const pose = game.vehiclePose(v);
  const r = game.sightRadius(v);
  for (const req of game.visibleTo(v)) {
    if (req.claimedBy !== null && req.claimedBy !== v.id) continue;
    const from = game.place(req.from);
    if (Math.hypot(from.x - pose.x, from.y - pose.y) <= r) return true;
  }
  return false;
}

/** The tuk-tuk has somewhere to be: a passenger to fetch or carry, a pump, or a GPS route. */
function hasErrand(v: Vehicle): boolean {
  const k = v.task.kind;
  return v.route !== null || k === 'pickup' || k === 'trip' || k === 'refuel';
}

/**
 * The pace the drive clock is heading for, in game seconds per real second,
 * or null when the speed buttons rule (Manage mode, or no tuk-tuk to drive).
 */
export function driveClockTarget(game: Game, mode: PlayMode, pace: number = DRIVE_TIME_SCALE): number | null {
  if (mode !== 'drive') return null;
  const v = game.playerVehicle();
  if (!v) return null;
  const kind = v.task.kind;
  if (kind === 'away' || kind === 'broken') return AWAY_TIME_SCALE;
  if (game.state.time < v.busyUntil) return DRIVE_IDLE_TIME_SCALE;
  if (!isManualDriven(game, v)) return AUTODRIVE_TIME_SCALE;
  const c = manualControl(game);
  if (v.speed < STOPPED_MS && !c.throttle && !hasErrand(v) && !hailInSight(game, v)) return DRIVE_IDLE_TIME_SCALE;
  return pace;
}

/** Short label for a clock rate relative to 1×: "⅛×", "1×", "8×". */
export function clockLabel(scale: number): string {
  const ratio = scale / BASE_TIME_SCALE;
  if (ratio >= 0.95) return `${Math.round(ratio * 10) / 10}×`;
  const fractions: [number, string][] = [
    [1 / 10, '⅒'],
    [1 / 8, '⅛'],
    [1 / 6, '⅙'],
    [1 / 5, '⅕'],
    [1 / 4, '¼'],
    [1 / 3, '⅓'],
    [1 / 2, '½'],
  ];
  const best = fractions.reduce((a, b) => (Math.abs(b[0] - ratio) < Math.abs(a[0] - ratio) ? b : a));
  return `${best[1]}×`;
}

export interface DriveClockOptions {
  /** The UI's current play mode. */
  mode(): PlayMode;
  /** Game seconds per real second while steering by hand (the "Driving pace" setting). */
  pace(): number;
}

/**
 * Eases the drive clock towards driveClockTarget over about
 * DRIVE_CLOCK_EASE_S real seconds (in log space, so 4 → 30 and 30 → 240 feel
 * alike) and serves it to Game.clockOverride.
 */
export class DriveClock {
  /** Current pace in game seconds per real second, or null while the speed buttons rule. */
  current: number | null = null;
  private readonly game: Game;
  private readonly opts: DriveClockOptions;

  constructor(game: Game, opts: DriveClockOptions) {
    this.game = game;
    this.opts = opts;
  }

  target(): number | null {
    return driveClockTarget(this.game, this.opts.mode(), this.opts.pace());
  }

  /** Advance the easing by a real-time interval (seconds). */
  tick(realDt: number): void {
    const target = this.target();
    if (target === null) {
      this.current = null;
      return;
    }
    if (this.current === null) this.current = Math.max(1, SPEED_STEPS[this.game.state.speed] * BASE_TIME_SCALE);
    const k = 1 - Math.exp(-Math.max(0, realDt) / (DRIVE_CLOCK_EASE_S / 3));
    const next = Math.exp(Math.log(this.current) + (Math.log(target) - Math.log(this.current)) * k);
    this.current = Math.abs(next - target) <= target * 0.01 ? target : next;
  }

  /** The override for Game.clockOverride. */
  value(): number | null {
    if (this.opts.mode() !== 'drive') return null;
    return this.current ?? this.target();
  }

  /** Install on the game: serve clockOverride and ease on every frame. Returns the uninstaller. */
  install(): () => void {
    const game = this.game;
    const override = () => this.value();
    game.clockOverride = override;
    const off = game.on('frame', (dt: number) => this.tick(dt));
    return () => {
      off();
      if (game.clockOverride === override) game.clockOverride = null;
    };
  }
}
