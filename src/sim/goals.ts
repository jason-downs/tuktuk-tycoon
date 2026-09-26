// Goal chain: checks the goals in content/goals.ts every few game seconds,
// completes each one once (game.state.goals), pays its reward through the
// ledger and announces it with a 'goal' notice. Counters the state alone cannot
// answer (five-star rides, tours, Yi Peng trips) come from the 'trip' event.

import { FIVE_STAR, GOALS, type GoalDef, type GoalTrack } from '../content/goals';
import { addReviews } from './business';
import type { TripResult } from './dispatch';
import { earn } from './economy';
import { activeOccurrences } from './events';
import type { Game, GameSystem } from './game';

/** Game seconds between goal checks. */
const CHECK_EVERY = 10;
/** Yi Peng nights kept in the tracker. */
const MAX_NIGHTS = 12;

/** The goal counters, with missing fields filled in (older saves). */
export function goalTrack(game: Game): GoalTrack {
  const t = (game.state.systems.goals ??= {}) as Partial<GoalTrack>;
  t.fiveStars ??= 0;
  t.tours ??= 0;
  t.yiPeng ??= {};
  return t as GoalTrack;
}

export function isComplete(game: Game, id: string): boolean {
  return game.state.goals.includes(id);
}

/** Progress of a goal, 0–1 (1 once completed). */
export function goalProgress(game: Game, goal: GoalDef): number {
  if (isComplete(game, goal.id)) return 1;
  return Math.max(0, Math.min(1, goal.progress(game, goalTrack(game))));
}

export class GoalsSystem implements GameSystem {
  readonly id = 'goals';
  private bucket = Number.NaN;

  init(game: Game): void {
    goalTrack(game);
    game.on('trip', (r: TripResult) => this.onTrip(game, r));
  }

  update(game: Game): void {
    const bucket = Math.floor(game.state.time / CHECK_EVERY);
    if (bucket === this.bucket) return;
    this.bucket = bucket;
    this.check(game);
  }

  /** Complete every goal whose progress has reached 1. */
  check(game: Game): void {
    const track = goalTrack(game);
    for (const goal of GOALS) {
      if (isComplete(game, goal.id)) continue;
      if (goal.progress(game, track) >= 1) this.complete(game, goal);
    }
  }

  private complete(game: Game, goal: GoalDef): void {
    game.state.goals.push(goal.id);
    const { cash, reviews } = goal.reward;
    if (cash) earn(game, cash, 'other');
    if (reviews) addReviews(game, 5, reviews);
    const extra = reviews ? ` and ${reviews} five-star review${reviews === 1 ? '' : 's'}` : '';
    game.notify(`${goal.icon} Goal: ${goal.title}! Reward ฿${cash.toLocaleString('en-US')}${extra}.`, 'goal');
    game.emit('goal', goal.id);
    game.emit('change');
  }

  private onTrip(game: Game, r: TripResult): void {
    const t = goalTrack(game);
    if (r.rating >= FIVE_STAR) t.fiveStars++;
    if (r.request.source?.startsWith('tour:')) t.tours++;
    const night = activeOccurrences(game.state.time).find((o) => o.event.id === 'yi_peng');
    if (night) {
      t.yiPeng[night.key] = (t.yiPeng[night.key] ?? 0) + 1;
      const keys = Object.keys(t.yiPeng);
      if (keys.length > MAX_NIGHTS) delete t.yiPeng[keys[0]];
    }
  }
}
