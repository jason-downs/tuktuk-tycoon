// Hire panel: today's driver applicants, Lung Daeng's rentals and the
// dealer's showroom (buy outright or on hire-purchase).

import { useState, useSyncExternalStore } from 'react';
import { DRIVER_ROSTER } from '../../content/drivers';
import { VEHICLE_MODELS, type VehicleModel } from '../../content/vehicles';
import { ZONES } from '../../content/zones';
import { BALANCE } from '../../sim/balance';
import {
  FLEET,
  MARKET_MODELS,
  buyVehicle,
  deliveryCondition,
  evPlates,
  fleetState,
  freeVehicles,
  hireCandidate,
  leaseTerms,
  rentVehicle,
  rentedCount,
  rentedFrom,
  upkeepPerDay,
  whyCantBuy,
  whyCantHire,
  whyCantRent,
  type Candidate,
} from '../../sim/fleet';
import type { Game } from '../../sim/game';
import type { PayModel } from '../../sim/types';
import { baht } from '../format';
import type { PanelProps } from '../panels';
import { Store, ui, useGame } from '../store';
import { ConfirmButton, SHIFT_LABEL, SkillGrid, Why, percent, shiftHours, stopFormKeys } from './fleetParts';

export type HireTab = 'drivers' | 'vehicles';

/** Which tab the Hire panel shows; other panels switch it through openHire. */
export const hireView = new Store<{ tab: HireTab }>({ tab: 'drivers' });

const currentTab = (): HireTab => hireView.get().tab;

/** Open the Hire panel on a tab. */
export function openHire(tab: HireTab): void {
  hireView.set({ tab });
  ui.set({ panel: 'hire' });
}

/** Re-render key for the panel: cash, the applicant pool and who drives what. */
function hireSignature(g: Game): string {
  const s = fleetState(g);
  const parts: (string | number)[] = [Math.round(g.state.cash), s.poolDay, s.candidates.map((c) => c.roster).join(','), g.state.drivers.length];
  for (const v of g.state.vehicles) parts.push(v.id, v.name, v.driverId ?? '-', v.model);
  return parts.join('|');
}

export function HirePanel({ game }: PanelProps) {
  useGame(game, hireSignature);
  const tab = useSyncExternalStore(hireView.subscribe, currentTab, currentTab);
  const applicants = fleetState(game).candidates.length;
  return (
    <div className="fl" onKeyDown={stopFormKeys}>
      <div className="fl-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'drivers'} className={`btn ${tab === 'drivers' ? 'on' : ''}`} onClick={() => hireView.set({ tab: 'drivers' })}>
          👤 Drivers <span className="small">({applicants})</span>
        </button>
        <button role="tab" aria-selected={tab === 'vehicles'} className={`btn ${tab === 'vehicles' ? 'on' : ''}`} onClick={() => hireView.set({ tab: 'vehicles' })}>
          🛺 Tuk-tuks
        </button>
      </div>
      {tab === 'drivers' ? <DriversTab game={game} /> : <VehiclesTab game={game} />}
    </div>
  );
}

// ------------------------------------------------------------------ drivers
function DriversTab({ game }: { game: Game }) {
  const candidates = fleetState(game).candidates;
  const free = freeVehicles(game);
  // 'auto' seats a new hire in the first free tuk-tuk.
  const [choice, setChoice] = useState<number | 'none' | 'auto'>('auto');
  const seat = choice === 'none' ? null : typeof choice === 'number' && free.some((v) => v.id === choice) ? choice : (free[0]?.id ?? null);

  return (
    <>
      <div className="fl-summary">
        <div className="fl-block-head">
          <span className="eyebrow">Today’s applicants</span>
          <span className="muted small">new faces at 04:00</span>
        </div>
        <ul className="fl-explain">
          <li>
            <b>Salary:</b> you pay a daily wage at 04:00 (at least {baht(FLEET.minWage)}, the Chiang Mai minimum) and the fuel;
            they keep a share of the fares and their tips.
          </li>
          <li>
            <b>Rent-out:</b> they pay you rent each day, keep the fares and buy their own fuel.
          </li>
        </ul>
        <p className="fl-note">
          Hiring fee {baht(FLEET.hiringFee)}. Drivers want to take home about {baht(FLEET.morale.comfortablePay)} a day, and start
          happier on the terms they prefer (★).
        </p>
        <div className="fl-toolbar">
          <label className="fl-label" htmlFor="fl-seat">
            Starts in
          </label>
          <select
            id="fl-seat"
            className="fl-select"
            value={seat ?? 'none'}
            onChange={(e) => setChoice(e.target.value === 'none' ? 'none' : Number(e.target.value))}
          >
            {free.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({VEHICLE_MODELS[v.model]?.name.toLowerCase() ?? v.model})
              </option>
            ))}
            <option value="none">No tuk-tuk yet</option>
          </select>
        </div>
        {free.length === 0 && (
          <p className="fl-note">
            Every tuk-tuk has a driver. New hires wait without one: salaried drivers are still paid, rent-out drivers pay
            nothing until they get one.{' '}
            <button className="link" onClick={() => hireView.set({ tab: 'vehicles' })}>
              Rent or buy a tuk-tuk
            </button>
          </p>
        )}
      </div>
      {candidates.length === 0 && <p className="muted small">Nobody else is looking for work today. New applicants arrive at 04:00.</p>}
      {candidates.map((c) => (
        <CandidateCard key={c.roster} game={game} c={c} seat={seat} />
      ))}
    </>
  );
}

function CandidateCard({ game, c, seat }: { game: Game; c: Candidate; seat: number | null }) {
  const r = DRIVER_ROSTER[c.roster];
  const why = whyCantHire(game, c.roster);
  const shift = r.shift ?? 'day';
  const zone = r.zone ? ZONES.find((z) => z.id === r.zone)?.name : undefined;
  const offer = (model: PayModel, title: string, terms: string) => {
    const pref = c.prefers === model;
    return (
      <button
        className={`btn fl-offer ${pref ? 'primary' : ''}`}
        disabled={!!why}
        title={`Hire ${r.nickname} for a ${baht(FLEET.hiringFee)} fee${pref ? ` — morale +${FLEET.morale.preferredBonus} on the terms they prefer` : ''}`}
        onClick={() => hireCandidate(game, c.roster, model, seat)}
      >
        <span>
          {title}
          {pref ? ' ★' : ''}
        </span>
        <small>{terms}</small>
      </button>
    );
  };
  return (
    <div className="fl-card">
      <div className="fl-card-head">
        <span>
          <span className="fl-name">{r.nickname}</span> <span className="muted small">{r.fullName}</span>
        </span>
        <span className="fl-badge soft">prefers {c.prefers === 'rent' ? 'rent-out' : 'salary'}</span>
      </div>
      <p className="fl-hook">{r.hook}</p>
      <SkillGrid skills={c} />
      <p className="fl-note">
        Likes the {SHIFT_LABEL[shift].toLowerCase()} shift ({shiftHours(shift)}){zone ? ` around ${zone}` : ''}.
      </p>
      <div className="fl-offers">
        {offer('salary', 'Hire on salary', `you pay ${baht(c.salaryAsk)}/day + ${percent(c.commissionAsk)} of fares`)}
        {offer('rent', 'Hire on rent-out', `pays you ${baht(c.rentOffer)}/day`)}
      </div>
      <Why reason={why} />
    </div>
  );
}

// ------------------------------------------------------------------ vehicles
function VehiclesTab({ game }: { game: Game }) {
  const plates = evPlates(game);
  return (
    <>
      <div className="fl-summary">
        <div className="fl-kpis">
          <div className="fl-kpi">
            <b>{baht(game.state.cash)}</b>
            <span>cash</span>
          </div>
          <div className="fl-kpi">
            <b>{rentedCount(game)}</b>
            <span>rented</span>
          </div>
          <div className="fl-kpi">
            <b>
              {plates.used} / {plates.people}
            </b>
            <span>EV plates used</span>
          </div>
        </div>
        <p className="fl-note">
          Chiang Mai’s electric taxi plates are one per person: you and each of your drivers can register one EV. Hire more
          drivers to run more EVs.
        </p>
      </div>
      <RentCard game={game} />
      <OwnerRentCard game={game} />
      <div className="fl-section">
        <span className="eyebrow">Dealer</span>
        <span className="muted small">buy outright or on hire-purchase</span>
      </div>
      {MARKET_MODELS.map((id) => (
        <ModelCard key={id} game={game} model={VEHICLE_MODELS[id]} />
      ))}
    </>
  );
}

function OwnerRentCard({ game }: { game: Game }) {
  const model = VEHICLE_MODELS[FLEET.owners.model];
  const why = whyCantRent(game, 'owner');
  return (
    <div className="fl-card">
      <div className="fl-card-head">
        <span className="fl-name">Rent an idle tuk-tuk from its owner</span>
        <span className="fl-price">{baht(FLEET.owners.rentPerDay)}/day</span>
      </div>
      <p className="fl-hook">
        Of the ~1,040 for-hire tuk-tuks registered in Chiang Mai, only about a hundred work the streets. Their owners are
        happy to rent them to a reliable operator.
      </p>
      <ModelChips model={model} rented />
      <p className="fl-note">
        Plated, in decent shape, no deposit. Needs a hired driver on your books. You rent {rentedFrom(game, 'owner')} of up
        to {FLEET.owners.max}.
      </p>
      <div className="fl-actions">
        <button className="btn primary" disabled={!!why} onClick={() => rentVehicle(game, 'owner')}>
          Rent one · {baht(FLEET.owners.rentPerDay)}/day
        </button>
      </div>
      <Why reason={why} />
    </div>
  );
}

function RentCard({ game }: { game: Game }) {
  const model = VEHICLE_MODELS.rusty;
  const why = whyCantRent(game);
  return (
    <div className="fl-card">
      <div className="fl-card-head">
        <span className="fl-name">Rent from Lung Daeng</span>
        <span className="fl-price">{baht(FLEET.rentPerDay)}/day</span>
      </div>
      <p className="fl-hook">{model.blurb}</p>
      <ModelChips model={model} rented />
      <p className="fl-note">
        No deposit. Rent is paid at 04:00, and handing one back costs that day’s rent. Rented tuk-tuks can’t be sold or
        modified. You rent {rentedFrom(game, 'lung_daeng')} of his {FLEET.maxRented}.
      </p>
      <div className="fl-actions">
        <button className="btn primary" disabled={!!why} onClick={() => rentVehicle(game)}>
          Rent one · {baht(FLEET.rentPerDay)}/day
        </button>
      </div>
      <Why reason={why} />
    </div>
  );
}

function ModelCard({ game, model }: { game: Game; model: VehicleModel }) {
  const terms = leaseTerms(model.price);
  const whyCash = whyCantBuy(game, model.id, 'cash');
  const whyLease = whyCantBuy(game, model.id, 'lease');
  const reasons = (whyCash === whyLease ? [whyCash] : [whyCash && `Buy: ${whyCash}`, whyLease && `Hire-purchase: ${whyLease}`]).filter(
    (r): r is string => !!r,
  );
  return (
    <div className="fl-card">
      <div className="fl-card-head">
        <span className="fl-name">{model.name}</span>
        <span className="fl-price">{baht(model.price)}</span>
      </div>
      <p className="fl-hook">{model.blurb}</p>
      <ModelChips model={model} delivered />
      <div className="fl-offers">
        <ConfirmButton
          className="primary fl-offer"
          disabled={!!whyCash}
          label={
            <>
              <span>Buy for {baht(model.price)}</span>
              <small>yours outright</small>
            </>
          }
          confirm={`Pay ${baht(model.price)}`}
          onConfirm={() => buyVehicle(game, model.id, 'cash')}
        />
        <ConfirmButton
          className="fl-offer"
          disabled={!!whyLease}
          label={
            <>
              <span>Hire-purchase</span>
              <small>
                {baht(terms.down)} down, then {baht(terms.instalment)}/day × {FLEET.lease.days}
              </small>
            </>
          }
          confirm={`Pay ${baht(terms.down)} down`}
          onConfirm={() => buyVehicle(game, model.id, 'lease')}
        />
      </div>
      <p className="fl-note">
        Hire-purchase: {Math.round(FLEET.lease.downShare * 100)}% down, then the rest plus{' '}
        {Math.round((FLEET.lease.markup - 1) * 100)}% in {FLEET.lease.days} daily instalments at 04:00 — {baht(terms.total)} in all.
        Pay it off early any time. Once it’s yours it resells for {Math.round(FLEET.resale.share * 100)}% of the price, less{' '}
        {Math.round(FLEET.resale.perYear * 100)}% a year.
      </p>
      {reasons.map((r) => (
        <Why key={r} reason={r} />
      ))}
    </div>
  );
}

/** Specs of a model; `delivered` adds the condition it arrives in, `rented` shows Lung Daeng covering upkeep. */
function ModelChips({ model, delivered, rented }: { model: VehicleModel; delivered?: boolean; rented?: boolean }) {
  const ev = model.powertrain === 'ev';
  const perKm = ev ? BALANCE.fuel.evPerKm : BALANCE.fuel.lpgPerKm;
  const condition = deliveryCondition(model.id);
  return (
    <div className="fl-chips">
      <span className={`fl-chip ${ev ? 'good' : ''}`}>{ev ? '⚡ Electric' : '⛽ LPG'}</span>
      <span className="fl-chip" title="Bigger groups need more seats">
        {model.seats} seats
      </span>
      <span className="fl-chip" title="Distance on a full tank or battery">
        {model.rangeKm} km range
      </span>
      <span className="fl-chip" title="Cruising speed">
        speed {Math.round(model.speed * 100)}%
      </span>
      <span className={`fl-chip ${model.breakdownPerDay >= 0.03 ? 'bad' : 'good'}`} title="Chance of a breakdown per day in service, at full condition">
        breakdowns {(model.breakdownPerDay * 100).toFixed(1)}%/day
      </span>
      <span className="fl-chip" title={ev ? 'Charging cost' : 'LPG cost'}>
        ฿{perKm.toFixed(2)}/km
      </span>
      {rented ? (
        <span className="fl-chip good" title="Lung Daeng pays maintenance, insurance and tax on his tuk-tuks">
          no upkeep
        </span>
      ) : (
        <span className="fl-chip" title="Maintenance, insurance and tax, paid at 04:00 on owned and leased tuk-tuks">
          upkeep {baht(upkeepPerDay(model.id))}/day
        </span>
      )}
      {delivered && condition < 100 && <span className="fl-chip">arrives at {condition}% condition</span>}
      {delivered && condition >= 100 && <span className="fl-chip good">brand new</span>}
    </div>
  );
}
