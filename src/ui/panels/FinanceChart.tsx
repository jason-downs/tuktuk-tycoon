import { useState } from 'react';
import { DAY, HOUR, WEEKDAYS, calendar } from '../../sim/clock';
import { businessDay } from '../../sim/economy';
import type { Game } from '../../sim/game';
import type { DayBook, LedgerCategory } from '../../sim/types';
import { baht } from '../format';
import { useGame } from '../store';
import './finance-chart.css';

/** Most business days shown. */
const DAYS = 14;
/** Fewest slots drawn, so a young company's first days don't become fat columns. */
const MIN_SLOTS = 7;
/** Loans drawn and repaid are financing, not trading, so the chart leaves them out. */
const EXCLUDED: LedgerCategory[] = ['loan'];

const W = 400;
const H = 168;
const PAD = { left: 44, right: 10, top: 10, bottom: 22 };
const BAR = 11;

interface DayPoint {
  day: number;
  income: number;
  expense: number;
  net: number;
  trips: number;
  today: boolean;
}

function sum(part: DayBook['income']): number {
  let s = 0;
  for (const [k, v] of Object.entries(part)) if (!EXCLUDED.includes(k as LedgerCategory)) s += v ?? 0;
  return s;
}

/** Round a span up to 1, 2 or 5 × 10ⁿ for clean axis ticks. */
function niceStep(span: number): number {
  const raw = span / 2;
  const p = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

const compact = (v: number): string => {
  const a = Math.abs(v);
  const s = a >= 1_000_000 ? `${+(a / 1_000_000).toFixed(1)}M` : a >= 1_000 ? `${+(a / 1_000).toFixed(1)}k` : `${Math.round(a)}`;
  return `${v < 0 ? '−' : ''}฿${s}`;
};

function dayLabel(day: number): string {
  const c = calendar(day * DAY + 12 * HOUR);
  return `${WEEKDAYS[c.weekday]} ${c.date}`;
}

/** Income columns up, expense columns down from zero, and the daily net as a line, for the last 14 business days. */
export function FinanceChart({ game }: { game: Game }) {
  const key = useGame(game, (g) => {
    const b = g.state.books[g.state.books.length - 1];
    return `${businessDay(g.state.time)}|${g.state.books.length}|${b ? Math.round(sum(b.income)) : 0}|${b ? Math.round(sum(b.expense)) : 0}|${b?.trips ?? 0}`;
  });
  const [hover, setHover] = useState<number | null>(null);
  const today = Number(key.split('|')[0]);
  const byDay = new Map(game.state.books.map((b) => [b.day, b]));
  // The company's first trading day; earlier slots stay empty and unlabelled.
  const firstDay = Math.max(today - DAYS + 1, Math.min(...game.state.books.map((b) => b.day), today));
  const slots = Math.max(MIN_SLOTS, today - firstDay + 1);
  const points: DayPoint[] = [];
  for (let d = today - slots + 1; d <= today; d++) {
    const b = byDay.get(d);
    const income = b ? sum(b.income) : 0;
    const expense = b ? sum(b.expense) : 0;
    points.push({ day: d, income, expense, net: income - expense, trips: b?.trips ?? 0, today: d === today });
  }
  const firstIdx = points.findIndex((p) => p.day >= firstDay);
  const shown = points.slice(firstIdx);
  if (!shown.some((p) => p.income || p.expense)) return null;

  const top = Math.max(1, ...points.map((p) => Math.max(p.income, p.net)));
  const bottom = Math.max(1, ...points.map((p) => Math.max(p.expense, -p.net)));
  const step = niceStep(Math.max(top, bottom));
  const yMax = Math.ceil(top / step) * step;
  const yMin = -Math.ceil(bottom / step) * step;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / slots;
  const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin)) * plotH;
  const cx = (i: number) => PAD.left + slot * (i + 0.5);
  const zero = y(0);
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-6; v += step) ticks.push(v);

  const column = (i: number, v: number, up: boolean): string => {
    const h = Math.abs(y(v) - zero);
    if (h < 0.5) return '';
    const x = cx(i) - BAR / 2;
    const r = Math.min(4, h, BAR / 2);
    if (up) {
      const t = zero - h;
      return `M${x},${zero}V${t + r}Q${x},${t} ${x + r},${t}H${x + BAR - r}Q${x + BAR},${t} ${x + BAR},${t + r}V${zero}Z`;
    }
    const b = zero + h;
    return `M${x},${zero}V${b - r}Q${x},${b} ${x + r},${b}H${x + BAR - r}Q${x + BAR},${b} ${x + BAR},${b - r}V${zero}Z`;
  };

  const line = points
    .map((p, i) => (i < firstIdx ? '' : `${i === firstIdx ? 'M' : 'L'}${cx(i).toFixed(1)},${y(p.net).toFixed(1)}`))
    .join('');
  const last = points[points.length - 1];
  const tip = hover !== null ? points[hover] : null;
  const tipLeft = hover !== null ? Math.min(Math.max(cx(hover) / W, 0.2), 0.8) : 0;

  return (
    <figure className="fchart" aria-label="Income, expenses and net for each recent business day">
      <div className="fchart-head">
        <span className="eyebrow">
          Last {shown.length === 1 ? 'day' : `${shown.length} days`}
          <span className="fchart-today">
            Today so far <b className={last.net >= 0 ? 'pos' : 'neg'}>{baht(last.net)}</b> net
          </span>
        </span>
        <span className="fchart-legend">
          <span>
            <i className="sw income" /> Income
          </span>
          <span>
            <i className="sw expense" /> Expenses
          </span>
          <span>
            <i className="sw net" /> Net
          </span>
        </span>
      </div>
      <div className="fchart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Today so far: income ${baht(last.income)}, expenses ${baht(last.expense)}, net ${baht(last.net)}.`}>
          {ticks.map((v) => (
            <g key={v}>
              <line className={v === 0 ? 'fc-zero' : 'fc-grid'} x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
              <text className="fc-tick" x={PAD.left - 6} y={y(v) + 3.5} textAnchor="end">
                {compact(v)}
              </text>
            </g>
          ))}
          {points.map((p, i) => (
            <g key={p.day} className={hover === i ? 'fc-day on' : 'fc-day'}>
              <path className="fc-income" d={column(i, p.income, true)} />
              <path className="fc-expense" d={column(i, p.expense, false)} />
              {i >= firstIdx && (slots <= MIN_SLOTS || i % 2 === (slots - 1) % 2 || hover === i) && (
                <text className={`fc-x ${p.today ? 'now' : ''}`} x={cx(i)} y={H - 6} textAnchor="middle">
                  {p.today ? 'Today' : calendar(p.day * DAY + 12 * HOUR).date}
                </text>
              )}
            </g>
          ))}
          <path className="fc-net" d={line} />
          {points.map((p, i) =>
            i < firstIdx ? null : <circle key={p.day} className={`fc-dot ${hover === i ? 'on' : ''}`} cx={cx(i)} cy={y(p.net)} r={hover === i || p.today ? 4.5 : 3} />,
          )}
          {points.map((p, i) =>
            i < firstIdx ? null : (
            <rect
              key={p.day}
              className="fc-hit"
              x={PAD.left + slot * i}
              y={PAD.top}
              width={slot}
              height={plotH}
              tabIndex={0}
              aria-label={`${dayLabel(p.day)}: income ${baht(p.income)}, expenses ${baht(p.expense)}, net ${baht(p.net)}, ${p.trips} trips`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            />
            ),
          )}
        </svg>
        {tip && (
          <div className="fchart-tip" style={{ left: `${tipLeft * 100}%` }}>
            <b>
              Day {tip.day + 1} · {dayLabel(tip.day)}
              {tip.today ? ' (so far)' : ''}
            </b>
            <span>
              <i className="sw income" /> Income <em>{baht(tip.income)}</em>
            </span>
            <span>
              <i className="sw expense" /> Expenses <em>{baht(-tip.expense)}</em>
            </span>
            <span>
              <i className="sw net" /> Net <em className={tip.net >= 0 ? 'pos' : 'neg'}>{baht(tip.net)}</em>
            </span>
            <span className="muted">{tip.trips} trips</span>
          </div>
        )}
      </div>
      <figcaption className="hint small">Business days run 04:00 to 04:00. Loans drawn and repaid are left out of the chart; the day-by-day ledger below lists everything.</figcaption>
    </figure>
  );
}
