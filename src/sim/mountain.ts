// The Doi Suthep climb. economics.md ("Suggested game numbers", trip catalogue): LPG tuk-tuks
// "can't climb" to Doi Suthep; the run unlocks with an EV or an engine upgrade, and otherwise the
// fare goes to the songthaews. culture.md §7: mountain tuk-tuks are specially modified.
//
// A place is up the mountain when it lies on the Doi Suthep–Pui slopes served by the road that
// climbs from the zoo: west of 98.938°E, between 18.785°N and 18.87°N. That box holds Wat Phra That
// Doi Suthep (98.922°E), Bhubing Palace (98.901°E) and Wat Pha Lat (98.934°E) but leaves out the
// foot of the mountain (zoo 98.948°E, Huay Kaew waterfall 98.944°E, CMU) and the flat land to the
// south-west (Night Safari and Royal Park Rajapruek at 18.74–18.75°N). Coordinates:
// docs/research/landmarks.md.

import { VEHICLE_UPGRADES } from '../content/upgrades';
import { VEHICLE_MODELS } from '../content/vehicles';
import type { World } from '../data/world';
import type { Game } from './game';
import type { Place, RideRequest, Vehicle } from './types';

/** Lon/lat box of the Doi Suthep slopes above the zoo. */
export const DOI_SUTHEP_SLOPES = { west: 98.85, east: 98.938, south: 18.785, north: 18.87 } as const;

/** Shown when a tuk-tuk that can't climb is offered a Doi Suthep ride. */
export const CLIMB_BLOCKED_TEXT = 'Your tuk-tuk can’t make the climb up Doi Suthep.';
/** How to lift the block, for request cards and the garage. */
export const CLIMB_HELP_TEXT = 'Fit a mountain rebuild at the garage, or convert it to electric.';

/** Is this place up on the Doi Suthep slopes? */
export function isUpDoiSuthep(world: World, place: Place): boolean {
  const [lon, lat] = world.graph.projection.toLngLat(place.x, place.y);
  const b = DOI_SUTHEP_SLOPES;
  return lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north;
}

/** Does this ride start or end up the mountain? */
export function requestClimbs(world: World, req: RideRequest): boolean {
  return isUpDoiSuthep(world, world.places[req.from]) || isUpDoiSuthep(world, world.places[req.to]);
}

/** Can this tuk-tuk haul passengers up Doi Suthep (an EV, or an LPG with the mountain rebuild)? */
export function vehicleClimbs(v: Vehicle): boolean {
  if (VEHICLE_MODELS[v.model]?.climbs) return true;
  return v.upgrades.some((id) => VEHICLE_UPGRADES[id]?.climbs);
}

/** True when the ride needs the climb and this tuk-tuk can't make it: it must not take the job. */
export function climbBlocked(game: Game, v: Vehicle, req: RideRequest): boolean {
  return !vehicleClimbs(v) && requestClimbs(game.world, req);
}
