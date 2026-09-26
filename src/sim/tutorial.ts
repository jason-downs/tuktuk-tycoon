// First-game coach. Lung Daeng walks a new player through one ride and the
// controls. Each step advances on a real event: a passenger selected, a pickup,
// the kerbside haggle, the drop-off, a speed change, the autopilot switch, a
// panel opened. The UI reports selections and panels with tutorialSignal();
// everything else is read from the game. Progress lives in
// game.state.systems.tutorial, so a saved game resumes mid-lesson.

import type { TripResult } from './dispatch';
import type { Game, GameSystem } from './game';

export const TUTORIAL_STEPS = [
  'welcome',
  'select',
  'pickup',
  'drive',
  'haggle',
  'dropoff',
  'paid',
  'speed',
  'autopilot',
  'panels',
  'finish',
] as const;
export type TutorialStep = (typeof TUTORIAL_STEPS)[number];

/** Panels to open before the panel tour finishes by itself. */
export const PANEL_TOUR_GOAL = 3;

export interface TutorialState {
  step: TutorialStep;
  done: boolean;
  /** The first finished ride, shown by the 'paid' step. */
  fare: number;
  tip: number;
  rating: number;
  /** Panels opened during the panel tour. */
  opened: string[];
  /** The last passenger walked away before the ride finished. */
  lost: boolean;
  /** Autopilot setting when the autopilot step began; switching it completes the step. */
  autopilotAtStep: boolean;
}

export type TutorialSignal =
  | { kind: 'next' }
  | { kind: 'skip' }
  | { kind: 'restart' }
  | { kind: 'select' }
  | { kind: 'panel'; id: string };

function fresh(done: boolean): TutorialState {
  return { step: 'welcome', done, fare: 0, tip: 0, rating: 0, opened: [], lost: false, autopilotAtStep: false };
}

/** The tutorial's saved state, with any missing fields defaulted. */
export function tutorialState(game: Game): TutorialState {
  const systems = game.state.systems;
  let st = systems.tutorial as Partial<TutorialState> | undefined;
  if (!st || typeof st !== 'object') systems.tutorial = st = fresh(false);
  const defaults = fresh(false);
  for (const key of Object.keys(defaults) as (keyof TutorialState)[]) {
    if (st[key] === undefined) (st as Record<string, unknown>)[key] = defaults[key];
  }
  if (!TUTORIAL_STEPS.includes(st.step as TutorialStep)) st.step = 'welcome';
  return st as TutorialState;
}

export const stepIndex = (step: TutorialStep): number => TUTORIAL_STEPS.indexOf(step);

function go(game: Game, st: TutorialState, step: TutorialStep): void {
  if (st.step === step) return;
  st.step = step;
  if (step === 'autopilot') st.autopilotAtStep = game.state.autopilot;
  if (step === 'panels') st.opened = [];
  game.emit('tutorial', step);
  game.emit('change');
}

function finish(game: Game, st: TutorialState): void {
  st.done = true;
  game.emit('tutorial', 'done');
  game.emit('change');
}

/** Steps the player moves on from with the coach card's button. */
const NEXT: Partial<Record<TutorialStep, TutorialStep | 'done'>> = {
  welcome: 'select',
  paid: 'speed',
  speed: 'autopilot',
  autopilot: 'panels',
  panels: 'finish',
  finish: 'done',
};

/** Report a player action the simulation cannot see (selections, panels, buttons). */
export function tutorialSignal(game: Game, signal: TutorialSignal): void {
  const st = tutorialState(game);
  if (signal.kind === 'restart') {
    game.state.systems.tutorial = fresh(false);
    game.emit('tutorial', 'welcome');
    game.emit('change');
    return;
  }
  if (st.done) return;
  switch (signal.kind) {
    case 'skip':
      finish(game, st);
      return;
    case 'next': {
      const next = NEXT[st.step];
      if (next === 'done') finish(game, st);
      else if (next) go(game, st, next);
      return;
    }
    case 'select':
      if (st.step === 'select') {
        st.lost = false;
        go(game, st, 'pickup');
      }
      return;
    case 'panel':
      if (st.step === 'panels' && !st.opened.includes(signal.id)) {
        st.opened.push(signal.id);
        if (st.opened.length >= PANEL_TOUR_GOAL) go(game, st, 'finish');
        else game.emit('change');
      }
      return;
  }
}

/** A game counts as new until the first ride or a second tuk-tuk. */
function isFreshGame(game: Game): boolean {
  return game.state.stats.trips === 0 && game.state.vehicles.length <= 1;
}

export class TutorialSystem implements GameSystem {
  readonly id = 'tutorial';

  init(game: Game): void {
    // Saves from before the tutorial existed skip it; new games start at the welcome.
    if (!game.state.systems.tutorial) game.state.systems.tutorial = fresh(!isFreshGame(game));
    tutorialState(game);
    game.on('haggle', (p: { vehicleId: number }) => {
      const st = tutorialState(game);
      if (st.done || p.vehicleId !== game.playerVehicle()?.id) return;
      if (stepIndex(st.step) < stepIndex('haggle')) go(game, st, 'haggle');
    });
    game.on('trip', (r: TripResult) => {
      const st = tutorialState(game);
      if (st.done || r.vehicleId !== game.playerVehicle()?.id || stepIndex(st.step) >= stepIndex('paid')) return;
      st.fare = r.fare;
      st.tip = r.tip;
      st.rating = Math.round(r.rating * 10) / 10;
      go(game, st, 'paid');
    });
    game.on('speed', () => {
      const st = tutorialState(game);
      if (!st.done && st.step === 'speed') go(game, st, 'autopilot');
    });
  }

  update(game: Game): void {
    const st = tutorialState(game);
    if (st.done) return;
    if (st.step === 'autopilot' && game.state.autopilot !== st.autopilotAtStep) {
      go(game, st, 'panels');
      return;
    }
    const at = stepIndex(st.step);
    if (at >= stepIndex('paid')) return;
    const v = game.playerVehicle();
    if (!v) return;
    // Follow the ride as it happens, even if the player runs ahead of the coach.
    const kind = v.task.kind;
    if (kind === 'pickup' && at < stepIndex('drive')) go(game, st, 'drive');
    else if (kind === 'haggle' && at < stepIndex('haggle')) go(game, st, 'haggle');
    else if (kind === 'trip' && at < stepIndex('dropoff')) go(game, st, 'dropoff');
    else if (at >= stepIndex('drive') && kind !== 'pickup' && kind !== 'haggle' && kind !== 'trip') {
      // The passenger walked, the deal fell through or the tuk-tuk broke down: find another.
      st.lost = true;
      go(game, st, 'select');
    }
  }
}
