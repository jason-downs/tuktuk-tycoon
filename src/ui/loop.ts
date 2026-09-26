import type { Game } from '../sim/game';

/**
 * Drives the simulation once per animation frame, independent of which view
 * renders the world (views only draw). Returns a stop function.
 */
export function startGameLoop(game: Game): () => void {
  let last = performance.now();
  let raf = 0;
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    game.update(dt);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
