// The moment a tuk-tuk reaches a waiting passenger: hired drivers settle the
// fare by themselves, bookings with a fixed fare just board, and the player
// is asked to haggle (the game pauses on the 'haggle' event).

import { aiHaggle } from './ai';
import { findRequest, measureRequest, startTrip } from './dispatch';
import type { Game } from './game';
import type { Vehicle } from './types';

export function beginKerbside(game: Game, v: Vehicle, requestId: number): void {
  const driver = v.driverId !== null ? game.driver(v.driverId) : null;
  const playerControlled = !!driver?.isPlayer && !game.state.autopilot;
  const req = findRequest(game, requestId);
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
    game.notify(`${req.channel === 'app' ? 'App booking' : 'Booking'} picked up: fixed fare ฿${req.fixedFare}.`, 'info');
    return;
  }
  v.task = { kind: 'haggle', requestId: req.id };
  game.pause('haggle');
  game.emit('haggle', { vehicleId: v.id, requestId: req.id });
}
