import { EventsSystem } from './events';
import type { Game } from './game';
import { RivalsSystem } from './rivals';
import { WeatherSystem } from './weather';

/**
 * Registers the optional simulation systems (calendar events, weather,
 * business, goals…) on a new or loaded game. Each system keeps its own state
 * under game.state.systems[<id>].
 */
export function installSystems(game: Game): void {
  game.addSystem(new WeatherSystem());
  game.addSystem(new EventsSystem());
  game.addSystem(new RivalsSystem());
}
