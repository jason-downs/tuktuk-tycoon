import { VEHICLE_MODELS } from '../content/vehicles';
import { BALANCE } from './balance';
import type { Game } from './game';
import type { ArcPosition } from './routing';
import type { Vehicle } from './types';

const ACCEL = 2.2; // m/s² (game time)
const DECEL = 4.5;
const ARRIVAL_SLOWDOWN_M = 25;
/** Crawl speed when out of fuel ("pushing it to the pump"). */
const EMPTY_TANK_SPEED = 2.5;
/** Largest slowdown from an edge penalty: a closed street is crawled at a fifth of normal speed. */
export const MAX_EDGE_SLOWDOWN = 5;

export function vehiclePosition(v: Vehicle): ArcPosition {
  return { arc: v.arc, s: v.s };
}

/** Cruising speed for this vehicle on its current arc, m/s. */
export function targetSpeed(game: Game, v: Vehicle): number {
  const graph = game.world.graph;
  const edge = v.arc >> 1;
  const cls = graph.edges[edge].cls;
  const model = VEHICLE_MODELS[v.model];
  let speed = graph.speedOf(edge) * (model?.speed ?? 1);
  const driver = v.driverId !== null ? game.driver(v.driverId) : null;
  if (driver) speed *= 0.9 + driver.driving / 500;
  speed *= game.speedFactor(cls);
  if (game.edgePenalty) speed /= Math.min(MAX_EDGE_SLOWDOWN, Math.max(1, game.edgePenalty(edge)));
  for (const up of v.upgrades) speed *= game.upgradeSpeed(up);
  if (v.fuel <= 0) speed = Math.min(speed, EMPTY_TANK_SPEED);
  return speed;
}

/** Route the vehicle to a node. Returns false if unreachable. */
export function sendTo(game: Game, v: Vehicle, node: number): boolean {
  const route = game.world.router.route(vehiclePosition(v), node);
  if (!route) return false;
  v.route = route;
  v.routeIdx = 0;
  if (route.arcs.length) {
    v.arc = route.arcs[0];
    v.s = route.startS;
  }
  return true;
}

/**
 * Advance a vehicle along its route by dt game seconds.
 * Returns true on the step it reaches the end of its route.
 */
export function driveVehicle(game: Game, v: Vehicle, dt: number): boolean {
  if (game.state.time < v.busyUntil || !v.route) {
    v.speed = 0;
    return false;
  }
  const graph = game.world.graph;
  const route = v.route;
  if (route.arcs.length === 0) {
    v.route = null;
    v.speed = 0;
    return true;
  }
  // Remaining distance on the route, for arrival slowdown.
  let remaining = graph.arcLen(v.arc) - v.s;
  for (let i = v.routeIdx + 1; i < route.arcs.length && remaining < ARRIVAL_SLOWDOWN_M; i++) remaining += graph.arcLen(route.arcs[i]);
  let target = targetSpeed(game, v);
  if (remaining < ARRIVAL_SLOWDOWN_M) target = Math.min(target, 3 + remaining / 5);
  const dv = target - v.speed;
  v.speed += Math.max(-DECEL * dt, Math.min(ACCEL * dt, dv));
  let dist = Math.max(0.2, v.speed) * dt;
  const moved = dist;

  let arrived = false;
  while (dist > 0) {
    const len = graph.arcLen(v.arc);
    if (v.s + dist < len) {
      v.s += dist;
      dist = 0;
    } else {
      dist -= len - v.s;
      if (v.routeIdx + 1 >= route.arcs.length) {
        v.s = len;
        arrived = true;
        break;
      }
      v.routeIdx++;
      v.arc = route.arcs[v.routeIdx];
      v.s = 0;
    }
  }
  accountDistance(game, v, (moved - dist) / 1000);
  if (arrived) {
    v.route = null;
    v.speed = 0;
  }
  return arrived;
}

/** Odometer, fuel, wear and company mileage for km driven (GPS or manual). */
export function accountDistance(game: Game, v: Vehicle, km: number): void {
  v.odometer += km;
  const model = VEHICLE_MODELS[v.model];
  v.fuel = Math.max(0, v.fuel - km / (model?.rangeKm ?? BALANCE.fuel.tankKm));
  v.condition = Math.max(0, v.condition - km * BALANCE.upkeep.wearPerKm);
  game.state.stats.distance += km;
}
