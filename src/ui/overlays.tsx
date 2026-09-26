import type { ComponentType } from 'react';
import type { GameView } from './view';
import type { Game } from '../sim/game';
import { AudioDirector } from './audio/AudioDirector';
import { DropoffFx } from './drive/DropoffFx';
import { GpsHud } from './drive/GpsHud';
import { HelpModal } from './help/HelpModal';
import { ManualDriveOverlay } from './manual/ManualDrive';
import { Minimap } from './Minimap';
import { TutorialCoach } from './tutorial/TutorialCoach';
import { WorldBadge } from './WorldBadge';

export interface OverlayProps {
  game: Game;
  view: GameView | null;
}

/**
 * Always-mounted UI layers drawn above the map (event banners, tutorial,
 * weather HUD, …). Each positions itself; order is paint order.
 */
export const OVERLAYS: { id: string; component: ComponentType<OverlayProps> }[] = [
  { id: 'world-badge', component: WorldBadge },
  { id: 'audio', component: AudioDirector },
  { id: 'manual', component: ManualDriveOverlay },
  { id: 'gps', component: GpsHud },
  { id: 'minimap', component: Minimap },
  { id: 'dropoff', component: DropoffFx },
  { id: 'tutorial', component: TutorialCoach },
  { id: 'help', component: HelpModal },
];
