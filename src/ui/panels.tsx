import type { ComponentType } from 'react';
import type { GameView } from './view';
import type { Game } from '../sim/game';
import { CalendarPanel } from './panels/CalendarPanel';
import { FinancePanel } from './panels/FinancePanel';
import { FleetPanel } from './panels/FleetPanel';
import { GaragePanel } from './panels/GaragePanel';
import { HirePanel } from './panels/HirePanel';

export interface PanelProps {
  game: Game;
  view: GameView | null;
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
  { id: 'hire', title: 'Hire', icon: '🤝', component: HirePanel },
  { id: 'garage', title: 'Garage', icon: '🔧', component: GaragePanel },
  { id: 'finance', title: 'Finances', icon: '📒', component: FinancePanel },
  { id: 'calendar', title: 'Calendar', icon: '📅', component: CalendarPanel },
];
