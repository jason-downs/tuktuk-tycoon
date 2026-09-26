import type { Game } from '../sim/game';

/**
 * How hard it is raining, 0–1, read from the weather system's state if a game
 * has one (game.state.systems.weather.current). Accepts a condition name
 * ('rain', 'storm', …) or an object with a kind/type/id and optional
 * intensity; anything else counts as dry.
 */
export function rainIntensity(game: Game): number {
  const weather = game.state.systems.weather as { current?: unknown } | undefined;
  const current = weather && typeof weather === 'object' ? weather.current : undefined;
  let kind: unknown = current;
  let intensity: number | null = null;
  if (current && typeof current === 'object') {
    const c = current as Record<string, unknown>;
    kind = c.kind ?? c.type ?? c.id ?? c.name;
    if (typeof c.intensity === 'number' && Number.isFinite(c.intensity)) intensity = Math.max(0, Math.min(1, c.intensity));
  }
  if (typeof kind !== 'string') return 0;
  if (/storm|thunder|monsoon|downpour/i.test(kind)) return intensity ?? 1;
  if (/rain|shower|drizzle/i.test(kind)) return intensity ?? (/drizzle|light/i.test(kind) ? 0.35 : 0.65);
  return 0;
}
