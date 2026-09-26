// The player's first passengers. Until the player has given the rides that
// hired drivers want to see before they join (FLEET.ridesBeforeHiring), a
// passenger is placed a short drive from the player's free tuk-tuk — along the
// road ahead or just round the next corner, with no U-turn, so they are on
// screen in Drive mode — whenever no unclaimed street passenger waits within
// STARTER_NEAR_M by road. A new game opens with one already waiting; after a
// drop-off, once the tuk-tuk has been free with nobody near for
// STARTER_DELAY_S, the next appears. They fit in the tuk-tuk, wait for up to
// STARTER_PATIENCE_S, and rivals leave them to the player.

import { calendar, HOUR } from './clock';
import { makeRequest, pickArchetype, pickDestination } from './demand';
import { seatsIn } from './dispatch';
import { FLEET } from './fleet';
import type { Game, GameSystem } from './game';
import type { Place, Vehicle } from './types';

/** A waiting street passenger this close by road (m, no U-turn) counts as near: no new one is needed. */
export const STARTER_NEAR_M = 250;
/** Range of driving distance (m, no U-turn) from the tuk-tuk to where a new passenger is placed: STARTER_MIN_M to STARTER_MAX_M. */
export const STARTER_MIN_M = 40;
export const STARTER_MAX_M = 200;
/**
 * [pacing] Game seconds the tuk-tuk is free with nobody near before a passenger appears: 3 real seconds while steering
 * at DRIVE_TIME_SCALE, well under a second while parked, when the drive clock runs at 1×.
 */
export const STARTER_DELAY_S = 12;
/** [pacing] How long a starter passenger waits (game seconds). */
export const STARTER_PATIENCE_S = HOUR;
/** Game seconds between checks (each routes to the passengers close by). */
const CHECK_EVERY_S = 2;

export class StarterSystem implements GameSystem {
  readonly id = 'starter';
  /** Game time the player's tuk-tuk became free with nobody waiting near it; NaN while it is busy or someone is near. */
  private freeSince = Number.NaN;
  /** Game time before which spawnStarter is not tried again after a try placed nobody (each try routes to every place within STARTER_MAX_M). */
  private retryAt = -Infinity;

  /** Game time of the last check. */
  private checkedAt = -Infinity;

  update(game: Game): void {
    if (game.state.stats.trips >= FLEET.ridesBeforeHiring) return;
    const now = game.state.time;
    if (now - this.checkedAt < CHECK_EVERY_S) return;
    this.checkedAt = now;
    const v = game.playerVehicle();
    if (!v || (v.task.kind !== 'idle' && v.task.kind !== 'cruise') || passengerNear(game, v)) {
      this.freeSince = Number.NaN;
      return;
    }
    if (Number.isNaN(this.freeSince)) this.freeSince = now;
    // No delay before the first ride: a new game opens with a passenger already waiting, and a lost one is replaced at once.
    if ((game.state.stats.trips > 0 && now - this.freeSince < STARTER_DELAY_S) || now < this.retryAt) return;
    if (spawnStarter(game, v)) this.freeSince = Number.NaN;
    else this.retryAt = now + STARTER_DELAY_S;
  }
}

/** Whether an unclaimed street passenger waits within STARTER_NEAR_M of the tuk-tuk by road. */
function passengerNear(game: Game, v: Vehicle): boolean {
  const p = game.vehiclePose(v);
  const r2 = STARTER_NEAR_M * STARTER_NEAR_M;
  for (const r of game.state.requests) {
    if (r.claimedBy !== null || r.channel !== 'street') continue;
    const place = game.place(r.from);
    const dx = place.x - p.x;
    const dy = place.y - p.y;
    // A straight line is never longer than the road, so only passengers within STARTER_NEAR_M as the crow flies are routed to.
    if (dx * dx + dy * dy > r2) continue;
    const route = game.world.router.route({ arc: v.arc, s: v.s }, place.node, false);
    if (route && route.length <= STARTER_NEAR_M) return true;
  }
  return false;
}

/**
 * Put a passenger at the nearest place STARTER_MIN_M–STARTER_MAX_M ahead of the tuk-tuk by road that has somewhere to
 * go (the eight nearest are tried); returns false when none does.
 */
export function spawnStarter(game: Game, v: Vehicle): boolean {
  const p = game.vehiclePose(v);
  const router = game.world.router;
  const candidates: { place: Place; metres: number }[] = [];
  for (const place of game.world.places) {
    if (place.offmap) continue;
    // A straight line is never longer than the road, so this rules out most places before routing.
    const d = Math.hypot(place.x - p.x, place.y - p.y);
    if (d > STARTER_MAX_M) continue;
    const route = router.route({ arc: v.arc, s: v.s }, place.node, false);
    if (!route || route.length < STARTER_MIN_M || route.length > STARTER_MAX_M) continue;
    candidates.push({ place, metres: route.length });
  }
  candidates.sort((a, b) => a.metres - b.metres || a.place.idx - b.place.idx);
  const cal = calendar(game.state.time);
  for (const { place } of candidates.slice(0, 8)) {
    const arch = pickArchetype(game, place.cat, cal);
    const to = pickDestination(game, place, arch, cal);
    if (!to || to.offmap) continue;
    const req = makeRequest(game, place, to, arch, 'street', cal);
    req.party = Math.min(req.party, seatsIn(v));
    req.expiresAt = game.state.time + STARTER_PATIENCE_S;
    req.starter = true;
    game.state.requests.push(req);
    game.emit('change');
    return true;
  }
  return false;
}
