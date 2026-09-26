import type { ComponentType } from 'react';
import type { MapView } from '../map/MapView';
import type { Game } from '../sim/game';
import { WorldBadge } from './WorldBadge';

export interface OverlayProps {
  game: Game;
  view: MapView | null;
}

/**
 * Always-mounted UI layers drawn above the map (event banners, tutorial,
 * weather HUD, …). Each positions itself; order is paint order.
 */
export const OVERLAYS: { id: string; component: ComponentType<OverlayProps> }[] = [
  { id: 'world-badge', component: WorldBadge },
];
