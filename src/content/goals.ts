// The goal chain shown in the Goals panel. Each goal reads the game state
// generically (stats, books, vehicles, drivers, unlocks), so goals that depend
// on the fleet market or the garage simply sit at 0 % until the player can act
// on them. Rewards are [pacing]: roughly an hour or two of takings at the stage
// where the goal usually falls, plus a few five-star reviews for the big ones.
// Yi Peng dates: calendar.md §4 (23–25 Nov 2026, full moon Tue 24 Nov).

import { RANKS } from './business';
import { VEHICLE_UPGRADES } from './upgrades';
import { currentRank, netWorth, ownedCount } from '../sim/business';
import type { Game } from '../sim/game';
import type { DayBook, LedgerCategory } from '../sim/types';

/** Counters the goals system keeps from the 'trip' event (game.state.systems.goals). */
export interface GoalTrack {
  /** Rides rated 4.75★ or better, which show as five stars. */
  fiveStars: number;
  /** Tour charters completed. */
  tours: number;
  /** Trips completed during each Yi Peng night, by event occurrence key. */
  yiPeng: Record<string, number>;
}

export interface GoalDef {
  id: string;
  chapter: number;
  icon: string;
  title: string;
  desc: string;
  /** How far along the player is, 0–1 (1 completes the goal). */
  progress(game: Game, track: GoalTrack): number;
  /** Short progress text, e.g. "4 / 10 rides". */
  detail(game: Game, track: GoalTrack): string;
  reward: { cash: number; reviews?: number };
}

export const GOAL_CHAPTERS = ['At the rank', 'Owner-driver', 'Fleet boss', 'Tycoon'] as const;

/** Rating at or above which a ride shows as five stars. */
export const FIVE_STAR = 4.75;
/** Trips the company needs on one Yi Peng night. */
export const YI_PENG_TRIPS = 30;

const n = (v: number) => Math.floor(v).toLocaleString('en-US');
const thb = (v: number) => `฿${n(v)}`;
const frac = (have: number, need: number) => Math.max(0, Math.min(1, have / need));

/** Money earned in a business day: everything but loans drawn and goal rewards. */
const EARNED_EXCLUDED: LedgerCategory[] = ['loan', 'other'];
function earned(book: DayBook): number {
  let sum = 0;
  for (const [k, v] of Object.entries(book.income)) if (!EARNED_EXCLUDED.includes(k as LedgerCategory)) sum += v ?? 0;
  return sum;
}
const bestDay = (g: Game) => g.state.books.reduce((m, b) => Math.max(m, earned(b)), 0);

const count = (id: string, icon: string, title: string, desc: string, chapter: number, need: number, unit: string, value: (g: Game, t: GoalTrack) => number, reward: GoalDef['reward']): GoalDef => ({
  id,
  chapter,
  icon,
  title,
  desc,
  progress: (g, t) => frac(value(g, t), need),
  detail: (g, t) => `${n(Math.min(need, value(g, t)))} / ${n(need)} ${unit}`,
  reward,
});

const money = (id: string, icon: string, title: string, desc: string, chapter: number, need: number, value: (g: Game) => number, reward: GoalDef['reward']): GoalDef => ({
  id,
  chapter,
  icon,
  title,
  desc,
  progress: (g) => frac(value(g), need),
  detail: (g) => `${thb(Math.max(0, Math.min(need, value(g))))} / ${thb(need)}`,
  reward,
});

const flag = (id: string, icon: string, title: string, desc: string, chapter: number, done: (g: Game) => boolean, reward: GoalDef['reward'], todo = 'Not yet'): GoalDef => ({
  id,
  chapter,
  icon,
  title,
  desc,
  progress: (g) => (done(g) ? 1 : 0),
  detail: (g) => (done(g) ? 'Done' : todo),
  reward,
});

const hasUpgrade = (g: Game, test: (id: string) => boolean) => g.state.vehicles.some((v) => v.upgrades.some(test));
const unlocked = (g: Game, test: (id: string) => boolean) => g.state.unlocks.some(test);
const hired = (g: Game) => g.state.drivers.filter((d) => !d.isPlayer).length;
const fleet = (g: Game) => g.state.vehicles.length;

export const GOALS: GoalDef[] = [
  // ------------------------------------------------------------ chapter 0
  count('first_ride', '🛺', 'First fare', 'Complete your first ride.', 0, 1, 'rides', (g) => g.state.stats.trips, { cash: 200 }),
  flag('refuel', '⛽', 'Fill her up', 'Refuel at an LPG pump: right-click one on the map, or press ⛽ Refuel.', 0, (g) => g.state.books.some((b) => (b.expense.fuel ?? 0) > 0), { cash: 200 }),
  flag('malai', '🌼', 'Mae Yanang’s blessing', 'Hang a jasmine phuang malai on a tuk-tuk’s mirror (garage).', 0, (g) => hasUpgrade(g, (u) => u === 'malai'), { cash: 300, reviews: 1 }),
  count('ten_rides', '🔟', 'Regular on the rank', 'Complete 10 rides.', 0, 10, 'rides', (g) => g.state.stats.trips, { cash: 500 }),
  count('five_star', '⭐', 'Five stars', 'Get a five-star rating from a passenger.', 0, 1, 'five-star rides', (_g, t) => t.fiveStars, { cash: 500 }),
  money('day_1000', '💰', 'A good day', 'Earn ฿1,000 in one business day (04:00 to 04:00).', 0, 1_000, bestDay, { cash: 500 }),
  // ------------------------------------------------------------ chapter 1
  flag('comfort', '🛋️', 'Creature comforts', 'Fit a comfort upgrade, such as cushions, to a tuk-tuk.', 1, (g) => hasUpgrade(g, (u) => (VEHICLE_UPGRADES[u]?.comfort ?? 0) > 0), { cash: 1_000 }),
  count('first_hire', '🤝', 'Hire your first driver', 'Take on a driver to work a second tuk-tuk.', 1, 1, 'drivers', hired, { cash: 2_000 }),
  count('own', '🔑', 'Own a tuk-tuk', 'Buy a tuk-tuk outright or on hire-purchase.', 1, 1, 'owned', (g) => ownedCount(g), { cash: 3_000, reviews: 2 }),
  count('hundred_rides', '💯', 'Hundred fares', 'Complete 100 rides across the company.', 1, 100, 'rides', (g) => g.state.stats.trips, { cash: 2_000 }),
  flag('rep_45', '🌟', 'Word of mouth', 'Hold a 4.5★ rating after at least 50 rides.', 1, (g) => g.state.stats.trips >= 50 && g.state.reputation >= 4.5, { cash: 3_000 }),
  flag('join_app', '📱', 'Go digital', 'Sign the fleet up to the TukGo app (Business panel).', 1, (g) => unlocked(g, (u) => u === 'app'), { cash: 3_000 }),
  money('day_10k', '💵', 'Big day', 'Earn ฿10,000 in one business day.', 1, 10_000, bestDay, { cash: 5_000 }),
  // ------------------------------------------------------------ chapter 2
  count('five_tuktuks', '🛺', 'Run 5 tuk-tuks', 'Grow the fleet to five tuk-tuks.', 2, 5, 'tuk-tuks', fleet, { cash: 10_000 }),
  flag('hotel', '🏨', 'Hotel partner', 'Sign a partnership with a hotel (Business panel).', 2, (g) => unlocked(g, (u) => u.startsWith('hotel:')), { cash: 10_000, reviews: 3 }),
  flag('depot', '🏠', 'Home base', 'Rent a depot for your fleet (Business panel).', 2, (g) => unlocked(g, (u) => u.startsWith('depot:')), { cash: 10_000 }),
  count('tours', '🛕', 'Tour operator', 'Complete 5 tour charters.', 2, 5, 'tours', (_g, t) => t.tours, { cash: 8_000 }),
  {
    id: 'yi_peng',
    chapter: 2,
    icon: '🏮',
    title: 'Survive Yi Peng',
    desc: `Complete ${YI_PENG_TRIPS} trips on one Yi Peng night (23–25 Nov, 17:00–01:00).`,
    progress: (_g, t) => frac(Math.max(0, ...Object.values(t.yiPeng)), YI_PENG_TRIPS),
    detail: (_g, t) => `Best night: ${Math.min(YI_PENG_TRIPS, Math.max(0, ...Object.values(t.yiPeng)))} / ${YI_PENG_TRIPS} trips`,
    reward: { cash: 20_000, reviews: 5 },
  },
  count('thousand_rides', '🎟️', 'A thousand fares', 'Complete 1,000 rides across the company.', 2, 1_000, 'rides', (g) => g.state.stats.trips, { cash: 15_000 }),
  // ------------------------------------------------------------ chapter 3
  count('ten_tuktuks', '🚦', 'Run 10 tuk-tuks', 'Grow the fleet to ten tuk-tuks.', 3, 10, 'tuk-tuks', fleet, { cash: 30_000 }),
  flag('airport', '✈️', 'Arrivals hall', 'Win the CNX airport taxi-counter permit.', 3, (g) => unlocked(g, (u) => u === 'airport'), { cash: 30_000 }),
  money('day_50k', '🪙', 'Golden day', 'Earn ฿50,000 in one business day.', 3, 50_000, bestDay, { cash: 25_000 }),
  money('millionaire', '💎', 'Millionaire', 'Reach ฿1,000,000 net worth (cash + tuk-tuks − loans).', 3, 1_000_000, (g) => netWorth(g), { cash: 50_000 }),
  {
    id: 'tycoon',
    chapter: 3,
    icon: '👑',
    title: 'Lanna Tuk-Tuk Tycoon',
    desc: 'Reach the top company rank.',
    progress: (g) => currentRank(g) / (RANKS.length - 1),
    detail: (g) => `Rank: ${RANKS[currentRank(g)].name}`,
    reward: { cash: 100_000, reviews: 5 },
  },
];

export const GOAL_BY_ID: Record<string, GoalDef> = Object.fromEntries(GOALS.map((g) => [g.id, g]));
