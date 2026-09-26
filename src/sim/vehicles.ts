// Moves every tuk-tuk and handles what happens when one reaches the end of its
// route: pickups, drop-offs, refuelling, ranks. Also rolls breakdowns.

import { VEHICLE_MODELS } from '../content/vehicles';
import { RANK_WAIT, aiHaggle } from './ai';
import { BALANCE } from './balance';
import { HOUR } from './clock';
import { completeTrip, findRequest, measureRequest, refuel, startTrip } from './dispatch';
import { spend } from './economy';
import type { Game } from './game';
import { driveVehicle } from './movement';
import type { Vehicle } from './types';

/** Hours a working day is assumed to last, for spreading the daily breakdown chance. */
const SERVICE_HOURS = 14;

export class VehicleSystem {
  update(game: Game, dt: number): void {
    for (const v of game.state.vehicles) {
      if (v.task.kind === 'broken') {
        if (game.state.time >= v.task.until) {
          v.task = { kind: 'idle' };
          v.condition = Math.max(v.condition, 55);
          game.notify(`${v.name} is fixed and back on the road.`, 'good');
        }
        continue;
      }
      if (v.task.kind === 'offduty' || v.task.kind === 'haggle') continue;
      const wasMoving = v.route !== null && game.state.time >= v.busyUntil;
      if (driveVehicle(game, v, dt)) this.arrive(game, v);
      if (wasMoving) this.rollBreakdown(game, v, dt);
    }
  }

  private arrive(game: Game, v: Vehicle): void {
    const task = v.task;
    const driver = v.driverId !== null ? game.driver(v.driverId) : null;
    const playerControlled = !!driver?.isPlayer && !game.state.autopilot;
    switch (task.kind) {
      case 'pickup': {
        const req = findRequest(game, task.requestId);
        if (!req) {
          v.task = { kind: 'idle' };
          if (playerControlled) game.notify('The passenger gave up waiting and left.', 'bad');
          return;
        }
        if (!playerControlled && driver) {
          aiHaggle(game, v, driver);
          return;
        }
        measureRequest(game, req);
        if (req.fixedFare !== null) {
          startTrip(game, v, req.fixedFare);
          game.notify(`App booking picked up: fixed fare ฿${req.fixedFare}.`, 'info');
          return;
        }
        v.task = { kind: 'haggle', requestId: req.id };
        game.pause('haggle');
        game.emit('haggle', { vehicleId: v.id, requestId: req.id });
        return;
      }
      case 'trip':
        completeTrip(game, v);
        return;
      case 'refuel': {
        const model = VEHICLE_MODELS[v.model];
        const ev = model?.powertrain === 'ev';
        refuel(game, v, ev ? BALANCE.fuel.evPerKm : BALANCE.fuel.lpgPerKm, model?.rangeKm ?? BALANCE.fuel.tankKm);
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
    const model = VEHICLE_MODELS[v.model];
    if (!model) return;
    let perDay = model.breakdownPerDay * (1 + (100 - v.condition) / 30);
    for (const up of v.upgrades) perDay *= game.upgradeReliability(up);
    const p = (perDay * dt) / (SERVICE_HOURS * HOUR);
    if (!game.rng.chance(p)) return;
    const repair = Math.round(game.rng.range(500, 3_000) / 50) * 50;
    const hours = game.rng.range(2, 6);
    spend(game, repair, 'maintenance');
    // A breakdown mid-trip strands the passenger: they pay nothing and leave.
    if (v.task.kind === 'trip') game.state.ratings.push(1.5);
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
