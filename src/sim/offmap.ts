// Out-of-town trips. A tuk-tuk taking a passenger beyond the play area drives
// to the portal on the map edge, disappears for the time the road trip takes
// (the clock runs on), and comes back in through the same portal: empty after
// a one-way drop-off, or carrying the passenger back to where they were picked
// up on a round trip (Doi Suthep, the Night Safari…).

import { CLIMB_KMH, OFFMAP_KMH } from '../content/offmap';
import { VEHICLE_MODELS } from '../content/vehicles';
import { BALANCE } from './balance';
import { completeTrip } from './dispatch';
import type { Game, GameSystem } from './game';
import { isUpDoiSuthep } from './mountain';
import { sendTo } from './movement';
import type { Place, Trip, Vehicle } from './types';

/** Seconds of driving for `metres` beyond the edge of town to a place. */
export function awaySeconds(game: Game, place: Place, metres: number): number {
  const kmh = isUpDoiSuthep(game.world, place) ? CLIMB_KMH : OFFMAP_KMH;
  return metres / (kmh / 3.6);
}

/** Fuel and wear for driving `km` out of town. */
function burn(v: Vehicle, km: number): void {
  const model = VEHICLE_MODELS[v.model];
  v.odometer += km;
  v.fuel = Math.max(0, v.fuel - km / (model?.rangeKm ?? BALANCE.fuel.tankKm));
  v.condition = Math.max(0, v.condition - km * BALANCE.upkeep.wearPerKm);
}

/** The trip's destination is out of town: head off beyond the portal. */
export function goAway(game: Game, v: Vehicle, trip: Trip): void {
  const dest = game.place(trip.request.to);
  const off = dest.offmap!;
  const oneWay = awaySeconds(game, dest, off.extraM);
  const until = game.state.time + oneWay + (off.roundTrip ? off.waitS + oneWay : 0);
  burn(v, (off.extraM / 1000) * (off.roundTrip ? 2 : 1));
  trip.awayS = until - game.state.time;
  v.task = { kind: 'away', until, trip, portal: off.portal };
  v.route = null;
  v.speed = 0;
  game.emit('change');
}

/** Put a returning vehicle on the portal's inbound node. */
function reenter(game: Game, v: Vehicle, portal: number): void {
  const graph = game.world.graph;
  const node = graph.portals[portal]?.in ?? graph.portals[0].in;
  const out = graph.outgoing(node);
  v.arc = out.length ? out[0] : v.arc;
  v.s = 0;
  v.route = null;
  v.speed = 0;
}

export class OffmapSystem implements GameSystem {
  readonly id = 'offmap';

  update(game: Game): void {
    const now = game.state.time;
    for (const v of game.state.vehicles) {
      const task = v.task;
      if (task.kind !== 'away' || now < task.until) continue;
      const trip = task.trip;
      if (!trip) {
        // Back in town after an out-of-town drop-off.
        reenter(game, v, task.portal);
        v.task = { kind: 'idle' };
        continue;
      }
      const dest = game.place(trip.request.to);
      if (dest.offmap?.roundTrip) {
        // Bring the passenger back to where they were picked up.
        reenter(game, v, task.portal);
        const from = game.place(trip.request.from);
        const back: Trip = { ...trip, returning: true };
        v.task = { kind: 'trip', trip: back };
        if (sendTo(game, v, from.node)) back.distance += v.route?.length ?? 0;
        else completeTrip(game, v);
        continue;
      }
      // Dropped off out of town: get paid, then drive back.
      v.task = { kind: 'trip', trip };
      completeTrip(game, v);
      const back = awaySeconds(game, dest, dest.offmap?.extraM ?? 0);
      v.task = { kind: 'away', until: now + back, trip: null, portal: task.portal };
      v.busyUntil = 0;
    }
  }
}

/** True when a trip's arrival at its end node means leaving town rather than dropping off. */
export function leavesTown(game: Game, trip: Trip): boolean {
  return !trip.returning && !!game.place(trip.request.to).offmap;
}
