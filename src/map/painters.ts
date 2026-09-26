import type { Game } from '../sim/game';

/** What an overlay painter gets each frame. Coordinates are CSS pixels. */
export interface PaintContext {
  ctx: CanvasRenderingContext2D;
  game: Game;
  /** CSS-pixel size of the overlay. */
  width: number;
  height: number;
  zoom: number;
  /** performance.now() of this frame. */
  now: number;
  /** Game-space metres → screen CSS pixels. */
  toScreen(x: number, y: number): { x: number; y: number };
}

/**
 * Extra drawing on the map overlay (weather, festival effects, rivals…).
 * 'under' painters run before passengers and tuk-tuks, 'over' after them.
 */
export interface OverlayPainter {
  id: string;
  layer: 'under' | 'over';
  paint(p: PaintContext): void;
}

export const OVERLAY_PAINTERS: OverlayPainter[] = [];

export function registerPainter(p: OverlayPainter): void {
  const i = OVERLAY_PAINTERS.findIndex((q) => q.id === p.id);
  if (i >= 0) OVERLAY_PAINTERS[i] = p;
  else OVERLAY_PAINTERS.push(p);
}
