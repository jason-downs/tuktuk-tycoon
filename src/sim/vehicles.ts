// Moves every tuk-tuk and handles what happens when one reaches the end of its
// route: pickups, drop-offs, refuelling, ranks. Also rolls breakdowns.

import { VEHICLE_MODELS } from '../content/vehicles';
import { RANK_WAIT } from './ai';
import { BALANCE } from './balance';
import { repairDiscount } from './business';
import { HOUR } from './clock';
import { addReviews, completeTrip, findRequest, refuel } from './dispatch';
import { spend } from './economy';
import type { Game } from './game';
import { driveManual, isManualDriven } from './manual';
import { driveVehicle } from './movement';
import { beginKerbside } from './kerbside';
import { goAway, leavesTown } from './offmap';
import type { Vehicle } from './types';

/** Hours a working day is assumed to last, for spreading the daily breakdown chance. */
const SERVICE_HOURS = 14;

/** Chance per in-service day that a vehicle breaks down; it rises as condition falls. */
export function breakdownPerDay(game: Game, v: Pick<Vehicle, 'model' | 'condition' | 'upgrades'>): number {
  const model = VEHICLE_MODELS[v.model];
  if (!model) return 0;
  let perDay = model.breakdownPerDay * (1 + (100 - v.condition) / 30);
  for (const up of v.upgrades) perDay *= game.upgradeReliability(up);
  return perDay;
}

export class VehicleSystem {
  update(game: Game, dt: number): void {
    for (const v of game.state.vehicles) {
      if (v.task.kind === 'broken') {
        // Planned workshop work (service, fitting, respray, EV kit) is finished by the garage system.
        if (v.task.work === undefined && game.state.time >= v.task.until) {
          v.task = { kind: 'idle' };
          v.condition = Math.max(v.condition, 55);
          game.notify(`${v.name} is fixed and back on the road.`, 'good');
        }
        continue;
      }
      if (v.task.kind === 'haggle') {
        // A kerbside haggle holds the 'haggle' pause until it is settled. Pauses are not saved, so a haggle
        // without one (a game loaded mid-haggle) goes through the kerbside again: the player is asked again,
        // autopilot settles it, or it ends when the passenger has gone.
        if (!game.isPaused('haggle')) beginKerbside(game, v, v.task.requestId);
        continue;
      }
      if (v.task.kind === 'offduty' || v.task.kind === 'away') continue;
      const manual = isManualDriven(game, v);
      const wasMoving = (manual ? v.speed > 0.5 : v.route !== null) && game.state.time >= v.busyUntil;
      if (manual ? driveManual(game, v, dt) : driveVehicle(game, v, dt)) this.arrive(game, v);
      if (wasMoving) this.rollBreakdown(game, v, dt);
    }
  }

  private arrive(game: Game, v: Vehicle): void {
    const task = v.task;
    const driver = v.driverId !== null ? game.driver(v.driverId) : null;
    const playerControlled = !!driver?.isPlayer && !game.state.autopilot;
    switch (task.kind) {
      case 'pickup':
        beginKerbside(game, v, task.requestId);
        return;
      case 'trip':
        if (leavesTown(game, task.trip)) goAway(game, v, task.trip);
        else completeTrip(game, v);
        return;
      case 'refuel': {
        const model = VEHICLE_MODELS[v.model];
        const ev = model?.powertrain === 'ev';
        refuel(game, v, ev ? game.evChargePerKm(game.place(task.place)) : BALANCE.fuel.lpgPerKm, model?.rangeKm ?? BALANCE.fuel.tankKm);
        v.task = { kind: 'idle' };
        if (playerControlled) game.notify(ev ? 'Battery charged.' : 'Tank full of LPG.', 'info');
        return;
      }
      case 'cruise':
        v.task = { kind: 'idle' };
        v.waitUntil = game.state.time + RANK_WAIT;
        return;
      case 'depot':
        v.task = { kind: 'offduty' };
        return;
      default:
        return;
    }
  }

  private rollBreakdown(game: Game, v: Vehicle, dt: number): void {
    if (!VEHICLE_MODELS[v.model]) return;
    const p = (breakdownPerDay(game, v) * dt) / (SERVICE_HOURS * HOUR);
    if (!game.rng.chance(p)) return;
    // Company depots have a workshop bay, which makes roadside repairs cheaper.
    const repair = Math.round((game.rng.range(500, 3_000) * repairDiscount(game)) / 50) * 50;
    const hours = game.rng.range(2, 6);
    spend(game, repair, 'maintenance');
    // A breakdown mid-trip strands the passenger: they pay nothing, leave and post a poor review.
    if (v.task.kind === 'trip') addReviews(game, 1.5, 1);
    if (v.task.kind === 'pickup') {
      const req = findRequest(game, v.task.requestId);
      if (req) req.claimedBy = null;
    }
    v.task = { kind: 'broken', until: game.state.time + hours * HOUR };
    v.route = null;
    v.speed = 0;
    const pose = game.vehiclePose(v);
    game.notify(`${v.name} broke down! Repairs ฿${repair.toLocaleString()}, off the road ~${Math.round(hours)} h.`, 'bad', pose.x, pose.y);
  }
}
