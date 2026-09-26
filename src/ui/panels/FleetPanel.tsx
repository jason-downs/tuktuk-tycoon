// Fleet panel: every tuk-tuk and driver, with inline detail to manage them.
// Clicking a tuk-tuk shows it on the map; selecting one on the map opens it here.

import { useEffect, useState, type ReactNode } from 'react';
import { VEHICLE_MODELS } from '../../content/vehicles';
import { ZONES } from '../../content/zones';
import {
  FLEET,
  assignDriver,
  dailyBills,
  driverRecord,
  fireDriver,
  hiredDrivers,
  isResting,
  leaseOf,
  payBounds,
  payOffLease,
  renameVehicle,
  resaleValue,
  returnVehicle,
  sellVehicle,
  setCommission,
  setDailyPay,
  setPayModel,
  setShift,
  setZone,
  severance,
  takeHome,
  upkeepPerDay,
  vehicleToday,
  whyCantFire,
  whyCantPayOff,
  whyCantReturn,
  whyCantSell,
} from '../../sim/fleet';
import { formatClock } from '../../sim/clock';
import type { Game } from '../../sim/game';
import type { Driver, Vehicle } from '../../sim/types';
import type { MapView } from '../../map/MapView';
import { baht } from '../format';
import type { PanelProps } from '../panels';
import { ui, useGame, useUI } from '../store';
import {
  ConfirmButton,
  DriverPicker,
  Meter,
  SHIFT_LABEL,
  SkillGrid,
  Stepper,
  VehiclePicker,
  Why,
  isEvModel,
  modelName,
  payText,
  percent,
  shiftHours,
  stopFormKeys,
  tone,
  vehicleStatus,
} from './fleetParts';
import { openHire } from './HirePanel';

const SHIFTS: Driver['shift'][] = ['day', 'night', 'long'];
const OWNERSHIP: Record<Vehicle['ownership'], string> = { rented: 'Rented', leased: 'Hire-purchase', owned: 'Owned' };

/**
 * Re-render key for the panel: the game minute (fuel, tasks, morale), cash
 * (what is affordable) and every setting an action can alter.
 */
function fleetSignature(g: Game): string {
  const parts: (string | number)[] = [Math.floor(g.state.time / 60), Math.round(g.state.cash)];
  for (const v of g.state.vehicles) parts.push(v.id, v.name, v.driverId ?? '-', v.ownership, v.task.kind);
  for (const d of g.state.drivers) parts.push(d.id, d.vehicleId ?? '-', d.payModel, d.dailyPay, d.commission, d.shift, d.zone ?? '-', d.restUntil ?? 0);
  return parts.join('|');
}

/** Drop the map selection of a tuk-tuk that has left the fleet. */
function forget(vehicleId: number): void {
  if (ui.get().selectedVehicle === vehicleId) ui.set({ selectedVehicle: null });
}

function showOnMap(game: Game, view: MapView | null, v: Vehicle): void {
  ui.set({ selectedVehicle: v.id, follow: true });
  const p = game.vehiclePose(v);
  view?.flyTo(p.x, p.y, 16);
}

export function FleetPanel({ game, view }: PanelProps) {
  useGame(game, fleetSignature);
  const selected = useUI((s) => s.selectedVehicle);
  const [openVehicle, setOpenVehicle] = useState<number | null>(selected);
  const [openDriver, setOpenDriver] = useState<number | null>(null);
  useEffect(() => {
    if (selected !== null) setOpenVehicle(selected);
  }, [selected]);

  const vehicles = game.state.vehicles;
  const drivers = [...game.state.drivers].sort((a, b) => Number(b.isPlayer) - Number(a.isPlayer));
  const hired = drivers.length - 1;

  return (
    <div className="fl" onKeyDown={stopFormKeys}>
      <Summary game={game} />

      <div className="fl-section">
        <span className="eyebrow">Tuk-tuks · {vehicles.length}</span>
        <span className="muted small">click one to show it on the map</span>
      </div>
      <div className="list">
        {vehicles.map((v) => (
          <VehicleItem
            key={v.id}
            game={game}
            v={v}
            open={openVehicle === v.id}
            onToggle={() => {
              if (openVehicle === v.id) setOpenVehicle(null);
              else {
                setOpenVehicle(v.id);
                showOnMap(game, view, v);
              }
            }}
          />
        ))}
        {vehicles.length === 0 && (
          <p className="fl-note">
            No tuk-tuks at all.{' '}
            <button className="link" onClick={() => openHire('vehicles')}>
              Rent one from Lung Daeng
            </button>
          </p>
        )}
      </div>

      <div className="fl-section">
        <span className="eyebrow">Drivers · {drivers.length}</span>
        <span className="muted small">shifts, zones and pay</span>
      </div>
      <div className="list">
        {drivers.map((d) => (
          <DriverItem key={d.id} game={game} d={d} open={openDriver === d.id} onToggle={() => setOpenDriver(openDriver === d.id ? null : d.id)} />
        ))}
      </div>
      {hired === 0 && (
        <p className="fl-note">
          No hired drivers yet. A second tuk-tuk with a driver earns while you drive your own.{' '}
          <button className="link" onClick={() => openHire('drivers')}>
            See today’s applicants
          </button>
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ summary
function Summary({ game }: { game: Game }) {
  let trips = 0;
  let fares = 0;
  for (const v of game.state.vehicles) {
    const t = vehicleToday(game, v);
    trips += t.trips;
    fares += t.fares;
  }
  const bills = dailyBills(game);
  const out = bills.rent + bills.wages + bills.instalments + bills.upkeep;
  const items = [
    bills.rent && `rent ${baht(bills.rent)}`,
    bills.wages && `wages ${baht(bills.wages)}`,
    bills.instalments && `hire-purchase ${baht(bills.instalments)}`,
    bills.upkeep && `upkeep ${baht(bills.upkeep)}`,
  ].filter(Boolean);
  return (
    <div className="fl-summary">
      <div className="fl-kpis">
        <Kpi value={game.state.vehicles.length} label="tuk-tuks" />
        <Kpi value={hiredDrivers(game).length} label="hired drivers" />
        <Kpi value={trips} label="trips today" />
        <Kpi value={baht(fares)} label="fares today" />
      </div>
      <p className="fl-bills">
        Due at 04:00: <b className="fl-bad">{baht(-out)}</b>
        {items.length > 0 && ` (${items.join(' · ')})`}
        {bills.rentIncome > 0 && (
          <>
            , and <b className="fl-good">+{baht(bills.rentIncome)}</b> rent from drivers
          </>
        )}
        .
      </p>
      <div className="fl-actions">
        <button className="btn primary" onClick={() => openHire('drivers')}>
          🤝 Hire drivers
        </button>
        <button className="btn" onClick={() => openHire('vehicles')}>
          🛺 Rent or buy tuk-tuks
        </button>
      </div>
    </div>
  );
}

function Kpi({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="fl-kpi">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="fl-field">
      <label className="fl-label" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="fl-field-body">{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ vehicles
function VehicleItem({ game, v, open, onToggle }: { game: Game; v: Vehicle; open: boolean; onToggle: () => void }) {
  const d = v.driverId !== null ? game.driver(v.driverId) : undefined;
  const status = vehicleStatus(game, v);
  const today = vehicleToday(game, v);
  const ev = isEvModel(v.model);
  return (
    <div className={`fl-item ${open ? 'open' : ''}`}>
      <button className="list-row fl-row" onClick={onToggle} aria-expanded={open}>
        <span className="fl-icon" aria-hidden>
          🛺
        </span>
        <div className="fl-row-main">
          <div className="fl-row-title">
            <b>{v.name}</b>
            <span className={`fl-badge ${v.ownership}`}>{OWNERSHIP[v.ownership]}</span>
          </div>
          <div className="fl-row-sub">
            {modelName(v)} · {d ? (d.isPlayer ? 'you drive' : `${d.nickname} drives`) : 'no driver'}
          </div>
          <div className={`fl-row-status ${status.warn ? 'warn' : ''}`}>{status.text}</div>
          <div className="fl-row-meters">
            <span className="fl-gauge">
              {ev ? '🔋' : '⛽'}
              <Meter value={v.fuel * 100} label={ev ? 'Battery' : 'LPG'} />
            </span>
            <span className="fl-gauge">
              🔧
              <Meter value={v.condition} label="Condition" />
            </span>
          </div>
        </div>
        <div className="fl-row-side">
          <b>{baht(today.fares)}</b>
          {today.trips} trip{today.trips === 1 ? '' : 's'} today
        </div>
      </button>
      {open && <VehicleDetail game={game} v={v} />}
    </div>
  );
}

export function VehicleDetail({ game, v }: { game: Game; v: Vehicle }) {
  const model = VEHICLE_MODELS[v.model];
  const idle = hiredDrivers(game).filter((d) => d.vehicleId === null);
  return (
    <div className="fl-detail">
      <RenameField game={game} v={v} />
      <Field label="Driver">
        <DriverPicker
          game={game}
          vehicle={v}
          onPick={(id) => {
            if (id !== null) assignDriver(game, id, v.id);
            else if (v.driverId !== null) assignDriver(game, v.driverId, null);
          }}
        />
      </Field>
      {v.driverId === null && (
        <p className="fl-note">
          {idle.length > 0
            ? `${idle.map((d) => d.nickname).join(', ')} ${idle.length === 1 ? 'has' : 'have'} no tuk-tuk — pick them above.`
            : 'Parked tuk-tuks earn nothing. '}
          {idle.length === 0 && (
            <button className="link" onClick={() => openHire('drivers')}>
              Hire a driver
            </button>
          )}
        </p>
      )}
      <div className="fl-facts">
        {model && <span>{model.seats} seats</span>}
        {model && <span>{model.rangeKm} km range</span>}
        <span>
          condition <b>{Math.round(v.condition)}%</b>
        </span>
        <span>
          odometer <b>{Math.round(v.odometer).toLocaleString('en-US')} km</b>
        </span>
        {v.upgrades.length > 0 && (
          <span>
            {v.upgrades.length} upgrade{v.upgrades.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <Ownership game={game} v={v} />
    </div>
  );
}

function RenameField({ game, v }: { game: Game; v: Vehicle }) {
  const [name, setName] = useState(v.name);
  useEffect(() => setName(v.name), [v.name]);
  const clean = name.replace(/\s+/g, ' ').trim();
  const dirty = clean.length > 0 && clean !== v.name;
  const id = `fl-name-${v.id}`;
  return (
    <Field label="Name" htmlFor={id}>
      <input
        id={id}
        className="fl-input"
        value={name}
        maxLength={28}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && dirty) renameVehicle(game, v.id, name);
          if (e.key === 'Escape') setName(v.name);
        }}
      />
      <button className="btn tiny" disabled={!dirty} onClick={() => renameVehicle(game, v.id, name)}>
        Rename
      </button>
    </Field>
  );
}

function Ownership({ game, v }: { game: Game; v: Vehicle }) {
  const driver = v.driverId !== null ? game.driver(v.driverId) : undefined;
  const leftBehind = driver ? (driver.isPlayer ? 'You’ll be on foot until you take another tuk-tuk.' : `${driver.nickname} will be left without a tuk-tuk.`) : null;

  if (v.ownership === 'rented') {
    const why = whyCantReturn(v);
    return (
      <div className="fl-block">
        <div className="fl-block-head">
          <span className="eyebrow">Rented from Lung Daeng</span>
          <span className="small">{baht(v.rentPerDay)}/day at 04:00</span>
        </div>
        <p className="fl-note">Rented tuk-tuks can’t be sold or modified. Handing one back costs today’s rent.</p>
        <div className="fl-actions">
          <ConfirmButton
            label="Return to Lung Daeng"
            confirm={`Return · pay ${baht(v.rentPerDay)}`}
            disabled={!!why}
            onConfirm={() => returnVehicle(game, v.id) && forget(v.id)}
          />
        </div>
        {!why && leftBehind && <p className="fl-note">{leftBehind}</p>}
        <Why reason={why} />
      </div>
    );
  }

  if (v.ownership === 'leased') {
    const lease = leaseOf(game, v);
    const why = whyCantPayOff(game, v);
    const paidShare = lease ? 1 - lease.daysLeft / FLEET.lease.days : 0;
    return (
      <div className="fl-block">
        <div className="fl-block-head">
          <span className="eyebrow">Hire-purchase</span>
          {lease && <span className="small">{baht(lease.instalment)}/day at 04:00</span>}
        </div>
        {lease && (
          <>
            <div className="fl-condition">
              <span>Paid</span>
              <Meter value={paidShare * 100} color="var(--gold)" label="Instalments paid" />
              <span>
                {FLEET.lease.days - lease.daysLeft} / {FLEET.lease.days}
              </span>
            </div>
            <p className="fl-note">
              {baht(lease.remaining)} still owed. Upkeep {baht(upkeepPerDay(v.model))}/day. Once it’s paid off you can sell it.
            </p>
            <div className="fl-actions">
              <ConfirmButton label={`Pay off ${baht(lease.remaining)}`} confirm={`Pay ${baht(lease.remaining)} now`} disabled={!!why} onConfirm={() => payOffLease(game, v.id)} />
            </div>
            <Why reason={why} />
          </>
        )}
      </div>
    );
  }

  const value = resaleValue(game, v);
  const why = whyCantSell(game, v);
  return (
    <div className="fl-block">
      <div className="fl-block-head">
        <span className="eyebrow">Owned</span>
        <span className="small">upkeep {baht(upkeepPerDay(v.model))}/day</span>
      </div>
      <p className="fl-note">
        Bought on day {v.boughtDay + 1} for {baht(v.purchasePrice)}. A buyer pays {Math.round(FLEET.resale.share * 100)}% of that, less{' '}
        {Math.round(FLEET.resale.perYear * 100)}% for each year of age.
      </p>
      <div className="fl-actions">
        <ConfirmButton danger label={`Sell for ${baht(value)}`} confirm={`Sell · +${baht(value)}`} disabled={!!why} onConfirm={() => sellVehicle(game, v.id) > 0 && forget(v.id)} />
      </div>
      {!why && leftBehind && <p className="fl-note">{leftBehind}</p>}
      <Why reason={why} />
    </div>
  );
}

// ------------------------------------------------------------------ drivers
function DriverItem({ game, d, open, onToggle }: { game: Game; d: Driver; open: boolean; onToggle: () => void }) {
  const v = d.vehicleId !== null ? game.vehicle(d.vehicleId) : undefined;
  const rec = d.isPlayer ? null : driverRecord(game, d);
  const zone = ZONES.find((z) => z.id === d.zone);
  const resting = !d.isPlayer && isResting(game, d);
  return (
    <div className={`fl-item ${open ? 'open' : ''}`}>
      <button className="list-row fl-row" onClick={onToggle} aria-expanded={open}>
        <span className={`fl-avatar ${d.isPlayer ? 'you' : ''}`} aria-hidden>
          {d.isPlayer ? '★' : d.nickname.charAt(0)}
        </span>
        <div className="fl-row-main">
          <div className="fl-row-title">
            <b>{d.isPlayer ? 'You' : d.nickname}</b>
            {d.isPlayer && <span className="fl-badge you">Owner</span>}
            {rec?.leaving && <span className="fl-badge warn">Leaving</span>}
            {resting && <span className="fl-badge soft">Resting</span>}
            <span className="muted small">★ {d.rating.toFixed(1)}</span>
          </div>
          <div className="fl-row-sub">
            {v ? v.name : <span className="fl-bad">No tuk-tuk</span>}
            {!d.isPlayer && ` · ${SHIFT_LABEL[d.shift]} ${shiftHours(d.shift)}`}
            {zone ? ` · ${zone.name}` : ''}
          </div>
          {!d.isPlayer && (
            <div className="fl-row-meters">
              <span className="fl-gauge" title={`Morale ${Math.round(d.morale)}`}>
                🙂
                <Meter value={d.morale} label="Morale" />
              </span>
              <span className="fl-gauge" title={`Fatigue ${Math.round(d.fatigue)}`}>
                😴
                <Meter value={d.fatigue} color={tone(100 - d.fatigue)} label="Fatigue" />
              </span>
            </div>
          )}
        </div>
        <div className="fl-row-side">
          {d.isPlayer ? (
            <>
              <b>{d.trips}</b>trips
            </>
          ) : (
            <>
              <b>{d.payModel === 'salary' ? baht(d.dailyPay) : `+${baht(d.dailyPay)}`}</b>
              {d.payModel === 'salary' ? `wage + ${percent(d.commission)}` : 'rent in'}
            </>
          )}
        </div>
      </button>
      {open && (d.isPlayer ? <PlayerDetail game={game} d={d} /> : <DriverDetail game={game} d={d} />)}
    </div>
  );
}

export function PlayerDetail({ game, d }: { game: Game; d: Driver }) {
  return (
    <div className="fl-detail">
      <p className="fl-hook">{d.hook}</p>
      <SkillGrid skills={d} />
      <div className="fl-facts spaced">
        <span>
          <b>{d.trips}</b> trips
        </span>
        <span>
          <b>{baht(d.lifetimeFares)}</b> in fares
        </span>
        <span>
          rating <b>★ {d.rating.toFixed(1)}</b>
        </span>
      </div>
      <Field label="Your tuk-tuk">
        <VehiclePicker game={game} driver={d} onPick={(id) => assignDriver(game, d.id, id)} />
      </Field>
      <p className="fl-note">
        Take any tuk-tuk to drive it yourself; its driver {d.vehicleId !== null ? 'moves into yours' : 'is left without one'}.
      </p>
    </div>
  );
}

export function DriverDetail({ game, d }: { game: Game; d: Driver }) {
  const rec = driverRecord(game, d);
  const hasVehicle = d.vehicleId !== null;
  const bounds = payBounds(d.payModel);
  const why = whyCantFire(game, d.id);
  const zone = ZONES.find((z) => z.id === d.zone);
  const takeHomeToday = takeHome(d, d.earnedToday, hasVehicle);
  const m = FLEET.morale;
  const delta = rec.lastMoraleDelta;
  return (
    <div className="fl-detail">
      <p className="fl-hook">
        {d.fullName} — {d.hook}
      </p>
      <SkillGrid skills={d} />
      <div className="fl-condition">
        <span>Morale</span>
        <Meter value={d.morale} label="Morale" />
        <span>
          {Math.round(d.morale)}
          {delta !== 0 && <span className={delta > 0 ? 'fl-good' : 'fl-bad'}> ({delta > 0 ? '+' : '−'}{Math.abs(delta)})</span>}
        </span>
        <span>Fatigue</span>
        <Meter value={d.fatigue} color={tone(100 - d.fatigue)} label="Fatigue" />
        <span>{Math.round(d.fatigue)}</span>
      </div>
      <DriverWarnings game={game} d={d} />
      <div className="fl-facts spaced">
        <span>
          <b>{d.trips}</b> trips
        </span>
        <span>
          <b>{baht(d.lifetimeFares)}</b> in fares
        </span>
        <span>
          rating <b>★ {d.rating.toFixed(1)}</b>
        </span>
        <span>hired day {d.hiredDay + 1}</span>
      </div>
      <p className="fl-note">
        Take-home so far today {d.payModel === 'salary' ? '(wage, commission and tips)' : '(fares and tips, less rent and fuel)'}{' '}
        <b className={takeHomeToday >= m.comfortablePay ? 'fl-good' : ''}>{baht(takeHomeToday)}</b>
        {rec.lastNet !== null && <> · yesterday {baht(rec.lastNet)}</>}. Below about {baht(m.comfortablePay)} a day, morale falls.
      </p>

      <Field label="Tuk-tuk">
        <VehiclePicker game={game} driver={d} onPick={(id) => assignDriver(game, d.id, id)} />
      </Field>
      <Field label="Shift">
        <span className="fl-seg">
          {SHIFTS.map((s) => (
            <button key={s} className={`btn tiny ${d.shift === s ? 'on' : ''}`} onClick={() => setShift(game, d.id, s)} title={`Morale ${m.shiftCost[s] ? `−${m.shiftCost[s]}` : '±0'} a day`}>
              {SHIFT_LABEL[s]}
              <small>
                {shiftHours(s)}
                {m.shiftCost[s] ? ` · −${m.shiftCost[s]}/day` : ''}
              </small>
            </button>
          ))}
        </span>
      </Field>
      <Field label="Zone" htmlFor={`fl-zone-${d.id}`}>
        <select id={`fl-zone-${d.id}`} className="fl-select" value={d.zone ?? ''} onChange={(e) => setZone(game, d.id, e.target.value || null)}>
          <option value="">Anywhere</option>
          {ZONES.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
      </Field>
      <p className="fl-note">{zone ? `${zone.blurb} They favour fares and ranks here.` : 'They chase the best fare anywhere in town.'}</p>

      <Field label="Pay model">
        <span className="fl-seg">
          <button className={`btn tiny ${d.payModel === 'salary' ? 'on' : ''}`} onClick={() => setPayModel(game, d.id, 'salary')}>
            Salary
            <small>you pay wage + fuel</small>
          </button>
          <button className={`btn tiny ${d.payModel === 'rent' ? 'on' : ''}`} onClick={() => setPayModel(game, d.id, 'rent')}>
            Rent-out
            <small>they pay you</small>
          </button>
        </span>
      </Field>
      {d.payModel === 'salary' ? (
        <>
          <Field label="Daily wage">
            <Stepper
              label="daily wage"
              value={d.dailyPay}
              min={bounds.min}
              max={bounds.max}
              step={bounds.step}
              format={baht}
              onChange={(v) => setDailyPay(game, d.id, v)}
              minNote={`${baht(FLEET.minWage)} is the Mueang Chiang Mai minimum wage.`}
              maxNote={`${baht(bounds.max)} is the most you can pay.`}
            />
          </Field>
          <Field label="Commission">
            <Stepper
              label="commission"
              value={d.commission}
              min={0}
              max={FLEET.commission.max}
              step={FLEET.commission.step}
              format={percent}
              onChange={(v) => setCommission(game, d.id, v)}
              minNote="No commission."
              maxNote={`${percent(FLEET.commission.max)} of fares is the most you can give.`}
            />
          </Field>
        </>
      ) : (
        <Field label="Daily rent">
          <Stepper
            label="daily rent"
            value={d.dailyPay}
            min={bounds.min}
            max={bounds.max}
            step={bounds.step}
            format={baht}
            onChange={(v) => setDailyPay(game, d.id, v)}
            minNote={`${baht(bounds.min)} is the least you can charge.`}
            maxNote={`${baht(bounds.max)} is the most any driver will pay.`}
          />
        </Field>
      )}
      <p className="fl-note">
        Now {payText(d)}. Asked for {baht(rec.ask.salary)}/day + {percent(rec.ask.commission)} on salary, or offered {baht(rec.ask.rent)}/day
        rent.
      </p>

      <div className="fl-actions">
        <ConfirmButton danger label={`Fire · ${baht(severance(d))} severance`} confirm={`Fire ${d.nickname}`} disabled={!!why} onConfirm={() => fireDriver(game, d.id)} />
      </div>
      <Why reason={why} />
    </div>
  );
}

function DriverWarnings({ game, d }: { game: Game; d: Driver }) {
  const rec = driverRecord(game, d);
  const m = FLEET.morale;
  const notes: string[] = [];
  if (rec.leaving) notes.push(`${d.nickname} has handed in notice and leaves after the current ride.`);
  else if (rec.lowDays > 0) notes.push(`Morale ended yesterday below ${m.quitBelow}: one more day like that and ${d.nickname} quits.`);
  else if (d.morale < m.warnBelow) notes.push('Unhappy: raise take-home pay or shorten the shift.');
  if (isResting(game, d)) notes.push(`Exhausted — resting until ${formatClock(d.restUntil ?? 0)}.`);
  else if (d.fatigue > FLEET.exhausted - 15) notes.push(`Tired: above ${FLEET.exhausted} fatigue they park until their next shift.`);
  if (d.vehicleId === null) notes.push(d.payModel === 'salary' ? 'No tuk-tuk: still drawing a wage.' : 'No tuk-tuk: paying no rent and earning nothing.');
  return (
    <>
      {notes.map((n) => (
        <p key={n} className="fl-why">
          {n}
        </p>
      ))}
    </>
  );
}
