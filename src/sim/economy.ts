// Cash ledger and the daily settlement (rents, wages, upkeep).

import { VEHICLE_MODELS } from '../content/vehicles';
import { BALANCE } from './balance';
import { DAY, HOUR } from './clock';
import type { Game } from './game';
import type { DayBook, LedgerCategory } from './types';

/** Day books kept; older ones are dropped. */
const MAX_BOOKS = 120;

/** While a game's 04:00 settlement runs: the business day that closed, which every line is booked to. */
const settlingDay = new WeakMap<Game, number>();

/** The book lines are posted to now: the day being settled while the settlement runs, otherwise today's. */
export function currentBook(game: Game): DayBook {
  return bookFor(game, settlingDay.get(game) ?? businessDay(game.state.time));
}

/** The book of a business day, opened in day order if that day has none yet. */
function bookFor(game: Game, day: number): DayBook {
  const books = game.state.books;
  let i = books.length - 1;
  while (i >= 0 && books[i].day > day) i--;
  if (i >= 0 && books[i].day === day) return books[i];
  // A day without lines ended on the cash of the last earlier day, or on today's cash less every later day's net.
  const later = books.slice(i + 1).reduce((sum, b) => sum + bookTotals(b).net, 0);
  const book: DayBook = { day, income: {}, expense: {}, trips: 0, cashEnd: i >= 0 ? books[i].cashEnd : game.state.cash - later };
  books.splice(i + 1, 0, book);
  if (books.length > MAX_BOOKS) books.splice(0, books.length - MAX_BOOKS);
  return book;
}

/** Business days run from the rollover hour (04:00) to the next. */
export function businessDay(time: number): number {
  return Math.floor((time - BALANCE.dayRolloverHour * HOUR) / DAY);
}

/** Move cash for a line in `book`. A line on an earlier day also moves the closing cash of every later day. */
function post(game: Game, book: DayBook, delta: number): void {
  game.state.cash += delta;
  const books = game.state.books;
  for (let i = books.indexOf(book); i >= 0 && i < books.length - 1; i++) books[i].cashEnd += delta;
  books[books.length - 1].cashEnd = game.state.cash;
}

export function earn(game: Game, amount: number, cat: LedgerCategory): void {
  if (amount === 0) return;
  const book = currentBook(game);
  book.income[cat] = (book.income[cat] ?? 0) + amount;
  post(game, book, amount);
}

/** Deduct cash. Settlement costs may push cash negative; purchases should check canAfford first. */
export function spend(game: Game, amount: number, cat: LedgerCategory): void {
  if (amount === 0) return;
  const book = currentBook(game);
  book.expense[cat] = (book.expense[cat] ?? 0) + amount;
  post(game, book, -amount);
}

export function canAfford(game: Game, amount: number): boolean {
  return game.state.cash >= amount;
}

export function bookTotals(book: DayBook): { income: number; expense: number; net: number } {
  const income = Object.values(book.income).reduce((a, b) => a + (b ?? 0), 0);
  const expense = Object.values(book.expense).reduce((a, b) => a + (b ?? 0), 0);
  return { income, expense, net: income - expense };
}

export class EconomySystem {
  private lastDay: number | null = null;

  update(game: Game): void {
    const day = businessDay(game.state.time);
    if (this.lastDay === null) this.lastDay = day;
    if (day === this.lastDay) return;
    const closed = this.lastDay;
    this.lastDay = day;
    this.settle(game, closed);
  }

  /**
   * Daily settlement at 04:00 for the business day that just ended. Its rents, upkeep, wages and drivers' rent, and
   * whatever the 'day' listeners bill (services, hotels, depots, the loan, hire-purchase), are booked to that day, and
   * the closing notice reports the day with all of them.
   */
  settle(game: Game, closed: number): void {
    const state = game.state;
    settlingDay.set(game, closed);
    try {
      for (const v of state.vehicles) {
        if (v.ownership === 'rented' || v.ownership === 'leased') spend(game, v.rentPerDay, 'rent');
        const model = VEHICLE_MODELS[v.model];
        const upkeep = model?.powertrain === 'ev' ? BALANCE.upkeep.evPerDay : BALANCE.upkeep.lpgPerDay;
        if (v.ownership !== 'rented') spend(game, upkeep + BALANCE.upkeep.insurancePerDay, 'maintenance');
      }
      for (const d of state.drivers) {
        if (d.isPlayer) continue;
        if (d.payModel === 'salary') spend(game, d.dailyPay, 'wages');
        // Rent-out drivers pay only while they have a tuk-tuk to work.
        else if (d.vehicleId !== null) earn(game, d.dailyPay, 'rent_income');
        d.earnedToday = 0;
      }
      for (const d of state.drivers) d.fatigue = Math.max(0, d.fatigue - 60);
      game.emit('day', currentBook(game));
    } finally {
      settlingDay.delete(game);
    }
    const closing = bookFor(game, closed);
    const t = bookTotals(closing);
    game.notify(
      `Day ${closing.day + 1} closed: ${t.net >= 0 ? '+' : '−'}฿${Math.abs(Math.round(t.net)).toLocaleString()} net from ${closing.trips} trips.`,
      t.net >= 0 ? 'good' : 'bad',
    );
    if (state.cash < 0) game.notify(`You're ฿${Math.round(-state.cash).toLocaleString()} in the red. Lung Daeng wants his rent.`, 'bad');
  }
}
