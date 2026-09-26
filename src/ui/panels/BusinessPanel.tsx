import { useState } from 'react';
import {
  DEPOT,
  HOTEL_BILLING_DAYS,
  HOTEL_FARE_PREMIUM,
  HOTEL_MIN_RANK,
  LOAN,
  RANKS,
  SERVICES,
  SERVICE_GROUPS,
  TOURS,
  type ServiceDef,
} from '../../content/business';
import {
  businessState,
  canClimb,
  closeDepot,
  creditLimit,
  currentRank,
  depotCheck,
  depotSites,
  endHotel,
  fleetSize,
  fleetValue,
  hotelCheck,
  hotelSites,
  instalmentFor,
  loanCheck,
  loanOffer,
  netWorth,
  nextBillDay,
  openDepot,
  ownedCount,
  parkedAt,
  partnerHotel,
  repairDiscount,
  repayLoan,
  serviceCheck,
  startService,
  stopService,
  takeLoan,
  type Check,
} from '../../sim/business';
import { businessDay } from '../../sim/economy';
import type { Game } from '../../sim/game';
import type { GameView } from '../view';
import '../../map/businessPainter';
import type { PanelProps } from '../panels';
import { baht } from '../format';
import { useGame } from '../store';
import './business.css';

type Tab = 'services' | 'hotels' | 'depots' | 'bank';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'services', label: 'Services', icon: '📋' },
  { id: 'hotels', label: 'Hotels', icon: '🏨' },
  { id: 'depots', label: 'Depots', icon: '🏠' },
  { id: 'bank', label: 'Bank', icon: '🏦' },
];

/** Tab kept while the panel is closed and reopened. */
let lastTab: Tab = 'services';

/** Run an action and tell the player why it failed. */
function act(game: Game, check: Check): void {
  if (!check.ok) game.notify(check.reason, 'bad');
}

const per = (every: number): string => (every === 7 ? 'week' : every === 30 ? 'month' : every === 1 ? 'day' : `${every} days`);
const inDays = (n: number): string => (n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);
const rides = (s?: { trips: number; fares: number }): string => (s ? `${s.trips.toLocaleString('en-US')} ride${s.trips === 1 ? '' : 's'} · ${baht(s.fares)}` : 'No rides yet');

export function BusinessPanel({ game, view }: PanelProps) {
  // Re-render each game minute and whenever money, stars, fleet or contracts change.
  useGame(game, (g) => {
    const st = g.state.systems.business as { loan?: { balance: number } | null } | undefined;
    return `${Math.floor(g.state.time / 60)}|${Math.round(g.state.cash)}|${g.state.reputation.toFixed(2)}|${g.state.vehicles.length}|${g.state.unlocks.join(',')}|${Math.round(st?.loan?.balance ?? 0)}|${g.state.stats.trips}`;
  });
  const [tab, setTabState] = useState<Tab>(lastTab);
  const setTab = (t: Tab) => {
    lastTab = t;
    setTabState(t);
  };
  return (
    <div className="biz">
      <RankCard game={game} />
      <div className="biz-tabs" role="tablist" aria-label="Business sections">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`btn tiny ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      {tab === 'services' && <Services game={game} />}
      {tab === 'hotels' && <Hotels game={game} view={view} />}
      {tab === 'depots' && <Depots game={game} view={view} />}
      {tab === 'bank' && <Bank game={game} />}
    </div>
  );
}

// ------------------------------------------------------------------- rank
function Meter({ label, have, need, money }: { label: string; have: number; need: number; money?: boolean }) {
  const done = have >= need;
  const fmt = (v: number) => (money ? baht(v) : v.toLocaleString('en-US'));
  return (
    <div className={`biz-meter ${done ? 'done' : ''}`}>
      <span className="biz-meter-label">{label}</span>
      <span className="biz-meter-track">
        <span className="biz-meter-fill" style={{ width: `${Math.max(0, Math.min(1, have / need)) * 100}%` }} />
      </span>
      <span className="biz-meter-val">
        {done ? '✓ ' : ''}
        {fmt(Math.max(0, have))} / {fmt(need)}
      </span>
    </div>
  );
}

function RankCard({ game }: { game: Game }) {
  const rank = currentRank(game);
  const k = RANKS[rank];
  const next = RANKS[rank + 1];
  const worth = netWorth(game);
  const fleet = fleetSize(game);
  const owned = ownedCount(game);
  return (
    <section className="biz-rank">
      <div className="biz-rank-top">
        <span className="biz-rank-icon" aria-hidden>
          {k.icon}
        </span>
        <div className="biz-rank-id">
          <span className="eyebrow">Company rank</span>
          <div className="biz-rank-name">{k.name}</div>
        </div>
        <div className="biz-worth" title="Cash + resale value of owned tuk-tuks − bank loan. Hire-purchase tuk-tuks count once paid off.">
          <span className="eyebrow">Net worth</span>
          <b className={worth < 0 ? 'neg' : ''}>{baht(worth)}</b>
          <span className="small muted">
            {fleet} tuk-tuk{fleet === 1 ? '' : 's'} · {owned} owned
          </span>
        </div>
      </div>
      <ol className="biz-ladder" aria-label="Rank ladder">
        {RANKS.map((r, i) => (
          <li key={r.id} className={i < rank ? 'done' : i === rank ? 'now' : ''} title={r.name}>
            <span aria-hidden>{r.icon}</span>
            <span className="biz-ladder-name">{r.name}</span>
          </li>
        ))}
      </ol>
      {next ? (
        <div className="biz-next">
          <div className="small">
            Next: <b>{next.name}</b> <span className="muted">— {next.blurb}</span>
          </div>
          <Meter label="Tuk-tuks" have={fleet} need={next.minFleet} />
          <Meter label="Owned" have={owned} need={next.minOwned} />
          {Number.isFinite(next.minNetWorth) && <Meter label="Net worth" have={worth} need={next.minNetWorth} money />}
        </div>
      ) : (
        <p className="hint small">{k.blurb} There is no higher rank — only a bigger empire.</p>
      )}
    </section>
  );
}

// --------------------------------------------------------------- services
function requirementChips(game: Game, def: ServiceDef): { text: string; ok: boolean }[] {
  const chips: { text: string; ok: boolean }[] = [];
  if (def.minRank) chips.push({ text: `${RANKS[def.minRank].icon} ${RANKS[def.minRank].name}`, ok: currentRank(game) >= def.minRank });
  if (def.minFleet) chips.push({ text: `🛺 ${def.minFleet} tuk-tuks`, ok: fleetSize(game) >= def.minFleet });
  if (def.minRep) chips.push({ text: `★ ${def.minRep.toFixed(1)}`, ok: game.state.reputation >= def.minRep });
  for (const r of def.requires ?? []) {
    const other = SERVICES.find((s) => s.id === r);
    chips.push({ text: `${other?.icon ?? ''} ${other?.name ?? r}`, ok: r in businessState(game).services });
  }
  if (def.climbing) chips.push({ text: '⛰️ electric tuk-tuk', ok: game.state.vehicles.some(canClimb) });
  return chips;
}

/** "฿1,400 / week", "฿30,000 to start, then ฿9,000 / month" or "฿12,000 one-off". */
function priceText(def: ServiceDef): string {
  const r = def.running;
  if (!r) return `${baht(def.cost)} one-off`;
  const running = `${baht(r.amount)} / ${per(r.every)}`;
  return def.cost === r.amount ? running : `${baht(def.cost)} to start, then ${running}`;
}

function statsKey(def: ServiceDef): string {
  const tour = TOURS.find((t) => t.service === def.id);
  return tour ? `tour:${tour.id}` : def.id;
}

function ServiceCard({ game, def }: { game: Game; def: ServiceDef }) {
  const [confirm, setConfirm] = useState(false);
  const st = businessState(game);
  const on = st.services[def.id];
  const check = serviceCheck(game, def.id);
  const today = businessDay(game.state.time);
  const stats = st.stats[statsKey(def)];
  const chips = on ? [] : requirementChips(game, def);
  return (
    <article className={`biz-item ${on ? 'on' : ''}`}>
      <div className="biz-item-head">
        <span className="biz-icon" aria-hidden>
          {def.icon}
        </span>
        <div className="biz-item-title">
          <b>{def.name}</b>
          <div className="biz-price small">
            {on && <span className="biz-status">● Running · </span>}
            <span className={on ? 'muted' : ''}>{priceText(def)}</span>
            {def.perRide && <span className="muted"> · {baht(def.perRide)} per guest</span>}
          </div>
        </div>
      </div>
      <p className="biz-effect">{def.effect}</p>
      <p className="biz-blurb">{def.blurb}</p>
      {chips.length > 0 && (
        <div className="biz-chips">
          {chips.map((c) => (
            <span key={c.text} className={`biz-chip ${c.ok ? 'ok' : 'miss'}`}>
              {c.ok ? '✓ ' : ''}
              {c.text}
            </span>
          ))}
        </div>
      )}
      <div className="biz-foot">
        {on ? (
          <>
            <span className="small">
              Since day {on.since + 1} · {rides(stats)}
              {def.running && <span className="muted"> · next bill {inDays(nextBillDay(on.since, def.running.every, today) - today)}</span>}
            </span>
            {confirm ? (
              <span className="biz-confirm">
                <button className="btn tiny" onClick={() => setConfirm(false)}>
                  Keep
                </button>
                <button
                  className="btn tiny danger"
                  onClick={() => {
                    setConfirm(false);
                    act(game, stopService(game, def.id));
                  }}
                >
                  Cancel it
                </button>
              </span>
            ) : (
              <button className="btn tiny ghost" onClick={() => setConfirm(true)} title="The signup fee is not refunded">
                Cancel…
              </button>
            )}
          </>
        ) : (
          <>
            <span className={`small ${check.ok ? 'muted' : 'biz-why'}`}>{check.ok ? 'Ready to sign.' : check.reason}</span>
            <button className="btn tiny primary" disabled={!check.ok} onClick={() => act(game, startService(game, def.id))}>
              Start · {baht(def.cost)}
            </button>
          </>
        )}
      </div>
    </article>
  );
}

export function Services({ game }: { game: Game }) {
  return (
    <div className="biz-list">
      {SERVICE_GROUPS.map((g) => (
        <section key={g.id} className="biz-group">
          <div className="eyebrow">{g.title}</div>
          {SERVICES.filter((s) => s.group === g.id).map((def) => (
            <ServiceCard key={def.id} game={game} def={def} />
          ))}
        </section>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------- hotels
export function Hotels({ game, view }: { game: Game; view: GameView | null }) {
  const st = businessState(game);
  const rank = currentRank(game);
  const sites = [...hotelSites(game.world)].sort((a, b) => Number(b.place.id in st.hotels) - Number(a.place.id in st.hotels) || b.tier.monthly - a.tier.monthly);
  const today = businessDay(game.state.time);
  return (
    <div className="biz-list">
      <p className="hint small">
        A partner hotel’s front desk books its guests with you at a fixed fare {Math.round((HOTEL_FARE_PREMIUM - 1) * 100)} % over the street rate. Fees
        are monthly; the first month is paid on signing.
      </p>
      {rank < HOTEL_MIN_RANK && <p className="biz-why small">Hotels sign with a {RANKS[HOTEL_MIN_RANK].name} or above.</p>}
      {sites.map((s) => {
        const on = st.hotels[s.place.id];
        const check = hotelCheck(game, s.place.id);
        const stats = st.stats[`hotel:${s.place.id}`];
        return (
          <div key={s.place.id} className={`biz-row ${on ? 'on' : ''}`}>
            <div className="biz-row-main">
              <button className="link" onClick={() => view?.flyTo(s.place.x, s.place.y, 16)} title="Show on the map">
                {s.place.name}
              </button>
              <div className="small muted">
                <span className={`biz-tier ${s.tier.id}`}>{s.tier.label}</span> {baht(s.tier.monthly)} / month · needs ★ {s.tier.minRep.toFixed(1)}
              </div>
              {on && (
                <div className="small">
                  {rides(stats)} · <span className="muted">next fee {inDays(nextBillDay(on.since, HOTEL_BILLING_DAYS, today) - today)}</span>
                </div>
              )}
              {!on && !check.ok && rank >= HOTEL_MIN_RANK && <div className="biz-why small">{check.reason}</div>}
            </div>
            {on ? (
              <button className="btn tiny ghost" onClick={() => act(game, endHotel(game, s.place.id))}>
                End
              </button>
            ) : (
              <button className="btn tiny primary" disabled={!check.ok} onClick={() => act(game, partnerHotel(game, s.place.id))}>
                Partner
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------- depots
export function Depots({ game, view }: { game: Game; view: GameView | null }) {
  const st = businessState(game);
  const rank = currentRank(game);
  const discount = repairDiscount(game);
  const open = Object.keys(st.depots).length;
  return (
    <div className="biz-list">
      <p className="hint small">
        A shophouse garage behind a filling station. Off-duty drivers park there, electric tuk-tuks charge there (overnight at the
        depot too), and the workshop bay makes repairs {Math.round((1 - DEPOT.repairDiscount) * 100)} % cheaper ({Math.round((1 - DEPOT.repairDiscountMany) * 100)} % with{' '}
        {DEPOT.manyDepots}+ depots). {baht(DEPOT.deposit)} deposit, then {baht(DEPOT.rentPerDay)} a day.
      </p>
      <div className="biz-summary small">
        <span>
          {open} depot{open === 1 ? '' : 's'} open
        </span>
        <span>Repairs at {Math.round(discount * 100)} % of the price</span>
      </div>
      {rank < DEPOT.minRank && <p className="biz-why small">Landlords rent to a {RANKS[DEPOT.minRank].name} or above.</p>}
      {depotSites(game.world).map((d) => {
        const on = st.depots[d.zone.id];
        const check = depotCheck(game, d.zone.id);
        return (
          <div key={d.zone.id} className={`biz-row ${on ? 'on' : ''}`}>
            <div className="biz-row-main">
              <button className="link" onClick={() => view?.flyTo(d.x, d.y, 16)} title="Show on the map">
                {d.zone.name}
              </button>
              <div className="small muted">
                By {d.place.name} · {d.zone.blurb}
              </div>
              {on && (
                <div className="small">
                  Open since day {on.since + 1} · {parkedAt(game, d)} parked now
                </div>
              )}
              {!on && !check.ok && rank >= DEPOT.minRank && <div className="biz-why small">{check.reason}</div>}
            </div>
            {on ? (
              <button className="btn tiny ghost" onClick={() => act(game, closeDepot(game, d.zone.id))} title="The deposit is not returned">
                Close
              </button>
            ) : (
              <button className="btn tiny primary" disabled={!check.ok} onClick={() => act(game, openDepot(game, d.zone.id))}>
                Rent
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------- bank
/** Days left on a loan paying `instalment` a day at the loan rate. */
function daysLeft(balance: number, instalment: number): number {
  let n = 0;
  for (let b = balance; b > 0.5 && n < 999; n++) b = b * (1 + LOAN.dailyRate) - instalment;
  return n;
}

export function Bank({ game }: { game: Game }) {
  const loan = businessState(game).loan;
  const offer = loanOffer(game);
  const [amount, setAmount] = useState(0);
  const limit = creditLimit(game);
  const unsecured = Math.round(LOAN.unsecuredPerStar * Math.max(0, game.state.reputation - 3));
  const secured = Math.round(LOAN.collateralShare * fleetValue(game));
  if (loan) {
    const left = daysLeft(loan.balance, loan.instalment);
    const paid = 1 - loan.balance / Math.max(loan.borrowed, loan.balance);
    return (
      <div className="biz-list">
        <section className="biz-item on">
          <div className="biz-item-head">
            <span className="biz-icon" aria-hidden>
              🏦
            </span>
            <div className="biz-item-title">
              <b>Bank loan</b>
              <div className="small muted">
                {baht(loan.borrowed)} borrowed on day {loan.takenDay + 1}
              </div>
            </div>
          </div>
          <div className="biz-facts">
            <span>
              <span className="muted">Still owed</span>
              <b>{baht(loan.balance)}</b>
            </span>
            <span>
              <span className="muted">Instalment</span>
              <b>{baht(loan.instalment)} / day</b>
            </span>
            <span>
              <span className="muted">Days left</span>
              <b>≈ {left}</b>
            </span>
            <span>
              <span className="muted">Interest paid</span>
              <b>{baht(loan.interestPaid)}</b>
            </span>
          </div>
          <div className="biz-meter">
            <span className="biz-meter-label">Repaid</span>
            <span className="biz-meter-track">
              <span className="biz-meter-fill" style={{ width: `${Math.max(0, paid) * 100}%` }} />
            </span>
            <span className="biz-meter-val">{Math.round(Math.max(0, paid) * 100)} %</span>
          </div>
          {loan.missed > 0 && (
            <p className="biz-why small">
              {loan.missed} missed instalment{loan.missed === 1 ? '' : 's'}: each adds a {Math.round(LOAN.lateFee * 100)} % late fee and two 1★ reviews.
            </p>
          )}
          <p className="hint small">Instalments are taken at 04:00 with {(LOAN.dailyRate * 100).toFixed(1)} % daily interest. Paying early has no penalty.</p>
          <div className="biz-foot">
            <button className="btn tiny" disabled={game.state.cash < loan.instalment} onClick={() => act(game, repayLoan(game, loan.instalment))}>
              Pay {baht(loan.instalment)} now
            </button>
            <button className="btn tiny primary" disabled={game.state.cash < Math.ceil(loan.balance)} onClick={() => act(game, repayLoan(game, loan.balance))}>
              Repay all · {baht(Math.ceil(loan.balance))}
            </button>
          </div>
        </section>
      </div>
    );
  }
  const max = Math.max(LOAN.minAmount, offer);
  const pick = Math.min(max, Math.max(LOAN.minAmount, amount || Math.round(max / 2 / 1000) * 1000));
  const check = loanCheck(game, pick);
  const instalment = instalmentFor(pick);
  return (
    <div className="biz-list">
      <section className="biz-item">
        <div className="biz-item-head">
          <span className="biz-icon" aria-hidden>
            🏦
          </span>
          <div className="biz-item-title">
            <b>Borrow from the bank</b>
            <div className="small muted">
              Repaid daily over {LOAN.termDays} days at {(LOAN.dailyRate * 100).toFixed(1)} % a day
            </div>
          </div>
        </div>
        <div className="biz-facts">
          <span>
            <span className="muted">For your ★ {game.state.reputation.toFixed(1)}</span>
            <b>{baht(unsecured)}</b>
          </span>
          <span>
            <span className="muted">Against your tuk-tuks</span>
            <b>{baht(secured)}</b>
          </span>
          <span>
            <span className="muted">Credit limit</span>
            <b>{baht(limit)}</b>
          </span>
        </div>
        {offer >= LOAN.minAmount ? (
          <>
            <label className="biz-slider">
              <span className="small muted">Amount</span>
              <input type="range" min={LOAN.minAmount} max={max} step={1000} value={pick} onChange={(e) => setAmount(Number(e.target.value))} />
              <b>{baht(pick)}</b>
            </label>
            <p className="small">
              {baht(instalment)} a day for {LOAN.termDays} days — {baht(instalment * LOAN.termDays)} in all.
            </p>
          </>
        ) : (
          <p className="biz-why small">{check.reason}</p>
        )}
        <p className="hint small">
          The limit is {baht(LOAN.unsecuredPerStar)} for each star above 3★, plus half the resale value of the tuk-tuks you own outright. A missed
          instalment adds a {Math.round(LOAN.lateFee * 100)} % late fee and two 1★ reviews.
        </p>
        <div className="biz-foot">
          <span />
          <button className="btn tiny primary" disabled={!check.ok} onClick={() => act(game, takeLoan(game, pick))}>
            Borrow · {baht(pick)}
          </button>
        </div>
      </section>
    </div>
  );
}
