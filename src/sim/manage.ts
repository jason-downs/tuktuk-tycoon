// Management actions for the player's hired fleet: sending the nearest free
// hired tuk-tuk to a waiting passenger.

import { claimRequest, findRequest, fitsParty } from './dispatch';
import type { Game } from './game';
import { climbBlocked } from './mountain';
import type { RideRequest, Vehicle } from './types';

/** A hired tuk-tuk free to take a job: it has a driver, is idle or cruising, and fits the passenger's party. */
export function isFreeFor(game: Game, v: Vehicle, req: RideRequest): boolean {
  if (v.driverId === null) return false;
  const driver = game.driver(v.driverId);
  if (!driver || driver.isPlayer) return false;
  if (v.task.kind !== 'idle' && v.task.kind !== 'cruise') return false;
  return fitsParty(v, req) && !climbBlocked(game, v, req);
}

/** Free hired tuk-tuks for a passenger, nearest (straight line) first. */
export function freeVehiclesFor(game: Game, req: RideRequest): Vehicle[] {
  const from = game.place(req.from);
  return game.state.vehicles
    .filter((v) => isFreeFor(game, v, req))
    .map((v) => {
      const p = game.vehiclePose(v);
      return { v, d: Math.hypot(p.x - from.x, p.y - from.y) };
    })
    .sort((a, b) => a.d - b.d)
    .map((x) => x.v);
}

/**
 * Send the nearest free hired tuk-tuk that can reach the passenger. Returns
 * the vehicle, or null when none is free (or the passenger is already taken).
 */
export function dispatchNearest(game: Game, requestId: number): Vehicle | null {
  const req = findRequest(game, requestId);
  if (!req || req.claimedBy !== null) return null;
  for (const v of freeVehiclesFor(game, req)) {
    if (claimRequest(game, v, requestId)) {
      game.emit('change');
      return v;
    }
  }
  return null;
}
