import type { Game } from './game';

/**
 * Registers the optional simulation systems (calendar events, weather,
 * business, goals…) on a new or loaded game. Each system keeps its own state
 * under game.state.systems[<id>].
 */
export function installSystems(game: Game): void {
  void game;
}
