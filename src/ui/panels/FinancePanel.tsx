import { bookTotals } from '../../sim/economy';
import type { DayBook, LedgerCategory } from '../../sim/types';
import type { PanelProps } from '../panels';
import { baht } from '../format';
import { useGame } from '../store';

const LABELS: Record<LedgerCategory, string> = {
  fares: 'Fares',
  tips: 'Tips',
  rent_income: 'Rent from drivers',
  fuel: 'Fuel',
  rent: 'Vehicle rent',
  wages: 'Wages',
  commission: 'Driver commission',
  maintenance: 'Maintenance',
  vehicles: 'Vehicles',
  upgrades: 'Upgrades',
  business: 'Business',
  marketing: 'Marketing',
  loan: 'Loans',
  fees: 'Fees & fines',
  other: 'Other',
};

export function FinancePanel({ game }: PanelProps) {
  const books = useGame(game, (g) => g.state.books.slice(-7).map((b) => JSON.stringify(b)));
  const parsed = books.map((b) => JSON.parse(b) as DayBook);
  return (
    <div className="finance">
      {parsed.length === 0 && <p className="muted">No trading days yet.</p>}
      {[...parsed].reverse().map((b) => {
        const t = bookTotals(b);
        return (
          <div key={b.day} className="daybook">
            <div className="daybook-head">
              <b>Day {b.day + 1}</b>
              <span className={t.net >= 0 ? 'pos' : 'neg'}>{baht(t.net)}</span>
              <span className="muted small">{b.trips} trips</span>
            </div>
            <table>
              <tbody>
                {Object.entries(b.income).map(([k, v]) => (
                  <tr key={`i-${k}`}>
                    <td>{LABELS[k as LedgerCategory]}</td>
                    <td className="pos">{baht(v ?? 0)}</td>
                  </tr>
                ))}
                {Object.entries(b.expense).map(([k, v]) => (
                  <tr key={`e-${k}`}>
                    <td>{LABELS[k as LedgerCategory]}</td>
                    <td className="neg">{baht(-(v ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
