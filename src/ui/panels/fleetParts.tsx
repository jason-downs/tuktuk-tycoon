// Small building blocks shared by the Fleet and Hire panels: skill bars,
// meters, bounded steppers, two-step confirm buttons and the tuk-tuk and
// driver pickers.

import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { DriverSkill } from '../../content/drivers';
import { VEHICLE_MODELS } from '../../content/vehicles';
import { onShift } from '../../sim/ai';
import { calendar, formatClock } from '../../sim/clock';
import { FLEET, SHIFT_HOURS, isResting, nextShiftStart, rideLock, whyCantAssign } from '../../sim/fleet';
import type { Game } from '../../sim/game';
import type { Driver, Vehicle } from '../../sim/types';
import { baht, taskText } from '../format';
import './fleet.css';

/** The five driver skills, with what each one does in the simulation. */
export const SKILLS: { key: DriverSkill; label: string; effect: string }[] = [
  { key: 'driving', label: 'Driving', effect: 'Road speed, up to ±10 %.' },
  { key: 'english', label: 'English', effect: `Ratings from foreign visitors, up to ±${FLEET.englishSwing} ★.` },
  { key: 'charm', label: 'Charm', effect: 'Every trip rating, up to ±0.5 ★.' },
  { key: 'honesty', label: 'Honesty', effect: 'Low honesty quotes greedy fares and pockets some of them.' },
  { key: 'stamina', label: 'Stamina', effect: 'How slowly long trips tire them out.' },
];

export const SHIFT_LABEL: Record<Driver['shift'], string> = { day: 'Day', night: 'Night', long: 'Long' };

export function shiftHours(shift: Driver['shift']): string {
  const [a, b] = SHIFT_HOURS[shift];
  const hh = (h: number) => String(h).padStart(2, '0');
  return `${hh(a)}–${hh(b)}`;
}

/** Short pay terms: "฿450/day + 15%" for salary, "pays you ฿350/day" for rent-out. */
export function payText(d: Pick<Driver, 'payModel' | 'dailyPay' | 'commission'>): string {
  return d.payModel === 'salary' ? `${baht(d.dailyPay)}/day + ${Math.round(d.commission * 100)}%` : `pays you ${baht(d.dailyPay)}/day`;
}

export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** Colour for a 0–100 value where high is good. */
export function tone(value: number): string {
  if (value < 30) return 'var(--red)';
  if (value < 55) return '#d9a13b';
  return 'var(--green)';
}

/** What a tuk-tuk is up to, including why it is standing still. */
export function vehicleStatus(game: Game, v: Vehicle): { text: string; warn: boolean } {
  const d = v.driverId !== null ? game.driver(v.driverId) : undefined;
  const now = game.state.time;
  if (!d) return { text: 'Parked — no driver', warn: true };
  if (!d.isPlayer && isResting(game, d)) return { text: `${d.nickname} is resting until ${formatClock(d.restUntil ?? now)}`, warn: false };
  if (!d.isPlayer && v.task.kind === 'offduty' && !onShift(d, calendar(now))) {
    return { text: `Off shift until ${formatClock(nextShiftStart(d.shift, now))}`, warn: false };
  }
  return { text: taskText(game, v), warn: v.task.kind === 'broken' };
}

export function driverLabel(d: Driver): string {
  return d.isPlayer ? 'You' : d.nickname;
}

export function modelName(v: Vehicle): string {
  return VEHICLE_MODELS[v.model]?.name ?? v.model;
}

export function isEvModel(modelId: string): boolean {
  return VEHICLE_MODELS[modelId]?.powertrain === 'ev';
}

/** Thin horizontal meter for a 0–100 value. */
export function Meter({ value, color, label }: { value: number; color?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <span className="fl-meter" title={label ? `${label}: ${Math.round(v)}%` : undefined} aria-label={label}>
      <span className="fl-meter-fill" style={{ width: `${v}%`, background: color ?? tone(v) }} />
    </span>
  );
}

/** The five skills as labelled bars with values. */
export function SkillGrid({ skills }: { skills: Record<DriverSkill, number> }) {
  return (
    <div className="fl-skills">
      {SKILLS.map((s) => (
        <div key={s.key} className="fl-skill" title={`${s.label} ${skills[s.key]}: ${s.effect}`}>
          <span className="fl-skill-label">
            {s.label}
            <b>{skills[s.key]}</b>
          </span>
          <Meter value={skills[s.key]} />
        </div>
      ))}
    </div>
  );
}

interface StepperProps {
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  /** Why the value cannot go lower / higher (shown as the button's tooltip). */
  minNote?: string;
  maxNote?: string;
  label: string;
}

/** − value + control that stays within [min, max]. */
export function Stepper({ value, min, max, step, format, onChange, minNote, maxNote, label }: StepperProps) {
  const down = Math.max(min, Math.round((value - step) * 1000) / 1000);
  const up = Math.min(max, Math.round((value + step) * 1000) / 1000);
  return (
    <span className="fl-stepper" role="group" aria-label={label}>
      <button className="btn tiny" disabled={value <= min} title={value <= min ? minNote : `Lower to ${format(down)}`} onClick={() => onChange(down)} aria-label={`Lower ${label}`}>
        −
      </button>
      <span className="fl-stepper-value">{format(value)}</span>
      <button className="btn tiny" disabled={value >= max} title={value >= max ? maxNote : `Raise to ${format(up)}`} onClick={() => onChange(up)} aria-label={`Raise ${label}`}>
        +
      </button>
    </span>
  );
}

interface ConfirmProps {
  label: ReactNode;
  /** Text of the second, confirming click. */
  confirm: ReactNode;
  onConfirm: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
  /** Extra classes for the first button (e.g. "primary fl-offer"). */
  className?: string;
}

/** A button that asks for a second click before acting; it disarms itself after a few seconds. */
export function ConfirmButton({ label, confirm, onConfirm, disabled, danger, title, className }: ConfirmProps) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  useEffect(() => {
    if (disabled) setArmed(false);
  }, [disabled]);
  if (!armed) {
    return (
      <button className={`btn ${danger ? 'fl-danger' : ''} ${className ?? ''}`} disabled={disabled} title={title} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="fl-confirm">
      <button
        className={`btn ${danger ? 'fl-danger on' : 'primary'}`}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirm}
      </button>
      <button className="btn ghost tiny" onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  );
}

/** A reason an action is unavailable, shown under its button. */
export function Why({ reason }: { reason: string | null | undefined }) {
  return reason ? <p className="fl-why">{reason}</p> : null;
}

/**
 * Picker that puts a driver in a tuk-tuk (or takes them out). Choosing a tuk-tuk
 * someone else drives swaps the two drivers' tuk-tuks.
 */
export function VehiclePicker({ game, driver, onPick }: { game: Game; driver: Driver; onPick: (vehicleId: number | null) => void }) {
  const current = driver.vehicleId !== null ? game.vehicle(driver.vehicleId) : undefined;
  const lock = current ? rideLock(current, current.name) : null;
  return (
    <select
      className="fl-select"
      value={driver.vehicleId ?? ''}
      disabled={lock !== null}
      title={lock ?? undefined}
      onChange={(e) => onPick(e.target.value === '' ? null : Number(e.target.value))}
    >
      <option value="">{driver.isPlayer ? 'On foot — no tuk-tuk' : 'No tuk-tuk'}</option>
      {game.state.vehicles.map((v) => {
        const other = v.driverId !== null && v.driverId !== driver.id ? game.driver(v.driverId) : undefined;
        const busy = v.id !== driver.vehicleId && !!whyCantAssign(game, driver.id, v.id);
        const note = other ? ` — swap with ${driverLabel(other)}` : v.driverId === null ? ' — free' : '';
        return (
          <option key={v.id} value={v.id} disabled={busy}>
            {v.name}
            {note}
            {busy ? (v.task.kind === 'away' ? ' (out of town)' : ' (passenger aboard)') : ''}
          </option>
        );
      })}
    </select>
  );
}

/** Pick a driver for a tuk-tuk: the same swap rules as VehiclePicker, seen from the tuk-tuk. */
export function DriverPicker({ game, vehicle, onPick }: { game: Game; vehicle: Vehicle; onPick: (driverId: number | null) => void }) {
  const lock = rideLock(vehicle);
  return (
    <select
      className="fl-select"
      value={vehicle.driverId ?? ''}
      disabled={lock !== null}
      title={lock ?? undefined}
      onChange={(e) => onPick(e.target.value === '' ? null : Number(e.target.value))}
    >
      <option value="">No driver — parked</option>
      {game.state.drivers.map((d) => {
        const busy = d.id !== vehicle.driverId && !!whyCantAssign(game, d.id, vehicle.id);
        const from = d.vehicleId !== null && d.vehicleId !== vehicle.id ? game.vehicle(d.vehicleId) : undefined;
        const note = from ? ` — from ${from.name}${vehicle.driverId !== null ? ' (swap)' : ''}` : d.vehicleId === null ? ' — no tuk-tuk' : '';
        return (
          <option key={d.id} value={d.id} disabled={busy}>
            {driverLabel(d)}
            {note}
            {busy ? (from?.task.kind === 'away' ? ' (out of town)' : ' (passenger aboard)') : ''}
          </option>
        );
      })}
    </select>
  );
}

/**
 * Keeps typing in the panel's inputs and selects from reaching the game's
 * global keyboard shortcuts (speed keys, follow, manual driving).
 */
export function stopFormKeys(e: KeyboardEvent<HTMLElement>): void {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') e.stopPropagation();
}
