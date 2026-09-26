// Cash ledger and the daily settlement (rents, wages, upkeep).

import { VEHICLE_MODELS } from '../content/vehicles';
import { BALANCE } from './balance';
import { DAY, HOUR } from './clock';
import type { Game } from './game';
import type { DayBook, LedgerCategory } from './types';

export function currentBook(game: Game): DayBook {
  const books = game.state.books;
  const day = businessDay(game.state.time);
  let book = books[books.length - 1];
  if (!book || book.day !== day) {
    book = { day, income: {}, expense: {}, trips: 0, cashEnd: game.state.cash };
    books.push(book);
    if (books.length > 120) books.splice(0, books.length - 120);
  }
  return book;
}

/** Business days run from the rollover hour (04:00) to the next. */
export function businessDay(time: number): number {
  return Math.floor((time - BALANCE.dayRolloverHour * HOUR) / DAY);
}

export function earn(game: Game, amount: number, cat: LedgerCategory): void {
  if (amount === 0) return;
  game.state.cash += amount;
  const book = currentBook(game);
  book.income[cat] = (book.income[cat] ?? 0) + amount;
  book.cashEnd = game.state.cash;
}

/** Deduct cash. Settlement costs may push cash negative; purchases should check canAfford first. */
export function spend(game: Game, amount: number, cat: LedgerCategory): void {
  if (amount === 0) return;
  game.state.cash -= amount;
  const book = currentBook(game);
  book.expense[cat] = (book.expense[cat] ?? 0) + amount;
  book.cashEnd = game.state.cash;
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
    this.lastDay = day;
    this.settle(game);
  }

  /** Daily settlement at 04:00 for the business day that just ended. */
  settle(game: Game): void {
    const state = game.state;
    const closing = state.books[state.books.length - 1];
    for (const v of state.vehicles) {
      if (v.ownership === 'rented' || v.ownership === 'leased') spend(game, v.rentPerDay, 'rent');
      const model = VEHICLE_MODELS[v.model];
      const upkeep = model?.powertrain === 'ev' ? BALANCE.upkeep.evPerDay : BALANCE.upkeep.lpgPerDay;
      if (v.ownership !== 'rented') spend(game, upkeep + BALANCE.upkeep.insurancePerDay, 'maintenance');
    }
    for (const d of state.drivers) {
      if (d.isPlayer) continue;
      if (d.payModel === 'salary') spend(game, d.dailyPay, 'wages');
      else earn(game, d.dailyPay, 'rent_income');
      d.earnedToday = 0;
    }
    for (const d of state.drivers) d.fatigue = Math.max(0, d.fatigue - 60);
    game.emit('day', closing);
    if (closing) {
      const t = bookTotals(closing);
      game.notify(
        `Day ${closing.day + 1} closed: ${t.net >= 0 ? '+' : '−'}฿${Math.abs(Math.round(t.net)).toLocaleString()} net from ${closing.trips} trips.`,
        t.net >= 0 ? 'good' : 'bad',
      );
    }
    if (state.cash < 0) game.notify(`You're ฿${Math.round(-state.cash).toLocaleString()} in the red. Lung Daeng wants his rent.`, 'bad');
  }
}
