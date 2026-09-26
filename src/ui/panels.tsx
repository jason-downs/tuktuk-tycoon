import type { ComponentType } from 'react';
import type { MapView } from '../map/MapView';
import type { Game } from '../sim/game';
import { CalendarPanel } from './panels/CalendarPanel';
import { FinancePanel } from './panels/FinancePanel';
import { FleetPanel } from './panels/FleetPanel';
import { GaragePanel } from './panels/GaragePanel';

export interface PanelProps {
  game: Game;
  view: MapView | null;
}

export interface PanelDef {
  id: string;
  title: string;
  icon: string;
  component: ComponentType<PanelProps>;
}

/** Management panels, in top-bar order. */
export const PANELS: PanelDef[] = [
  { id: 'fleet', title: 'Fleet', icon: '🛺', component: FleetPanel },
  { id: 'garage', title: 'Garage', icon: '🔧', component: GaragePanel },
  { id: 'finance', title: 'Finances', icon: '📒', component: FinancePanel },
  { id: 'calendar', title: 'Calendar', icon: '📅', component: CalendarPanel },
];
