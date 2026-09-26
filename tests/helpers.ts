import { readFileSync } from 'node:fs';
import { businessDay } from '../src/sim/economy';
import type { Game } from '../src/sim/game';
import { RoadGraph, type GraphJSON } from '../src/sim/graph';
import type { DayBook } from '../src/sim/types';

let cached: RoadGraph | null = null;

type Lines = DayBook['income'];

/** Amounts `after` holds beyond `before`, per ledger category (categories that did not move are left out). */
function gained(after: Lines = {}, before: Lines = {}): Lines {
  const out: Lines = {};
  for (const [k, v] of Object.entries(after) as [keyof Lines, number][]) {
    const d = v - (before[k] ?? 0);
    if (d !== 0) out[k] = d;
  }
  return out;
}

/**
 * Run `cross`, which steps the game across the next 04:00 rollover, and return what it booked to the business day
 * that closed: the settlement and the bills of the 'day' listeners.
 */
export function settledLines(game: Game, cross: () => void): DayBook {
  const day = businessDay(game.state.time);
  const find = () => game.state.books.find((b) => b.day === day);
  const before = structuredClone(find());
  cross();
  const after = find();
  return {
    day,
    income: gained(after?.income, before?.income),
    expense: gained(after?.expense, before?.expense),
    trips: (after?.trips ?? 0) - (before?.trips ?? 0),
    cashEnd: after?.cashEnd ?? game.state.cash,
  };
}

/** The real Chiang Mai road graph baked into public/data. */
export function loadGraph(): RoadGraph {
  if (!cached) {
    const json = JSON.parse(readFileSync(new URL('../public/data/graph.json', import.meta.url), 'utf8')) as GraphJSON;
    cached = new RoadGraph(json);
  }
  return cached;
}
