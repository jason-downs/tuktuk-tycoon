import { ARCHETYPES } from '../content/archetypes';
import { tourDwellText } from '../sim/business';
import type { Game } from '../sim/game';
import type { Vehicle } from '../sim/types';

export const baht = (v: number): string => `${v < 0 ? '−' : ''}฿${Math.abs(Math.round(v)).toLocaleString('en-US')}`;

export const km = (m: number): string => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

export function minutes(seconds: number): string {
  const m = Math.max(0, Math.round(seconds / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function stars(r: number): string {
  const full = Math.round(r * 2) / 2;
  return '★'.repeat(Math.floor(full)) + (full % 1 ? '½' : '') ;
}

/** One-line description of what a tuk-tuk is doing. */
export function taskText(game: Game, v: Vehicle): string {
  const t = v.task;
  switch (t.kind) {
    case 'idle':
      return tourDwellText(game, v) ?? (v.route ? 'Driving' : 'Waiting for passengers');
    case 'pickup': {
      const r = game.state.requests.find((q) => q.id === t.requestId);
      return r ? `Picking up ${ARCHETYPES[r.archetype].label.toLowerCase()} at ${game.place(r.from).name}` : 'Picking up';
    }
    case 'haggle':
      return 'Agreeing a fare';
    case 'trip':
      return `To ${game.place(t.trip.request.to).name} · ${baht(t.trip.fare)}`;
    case 'refuel':
      return `Refuelling at ${game.place(t.place).name}`;
    case 'cruise':
      return t.place >= 0 ? `Heading to ${game.place(t.place).name}` : 'Driving';
    case 'depot':
      return 'Returning to depot';
    case 'broken':
      return `Broken down — back in ${minutes(t.until - game.state.time)}`;
    case 'offduty':
      return 'Off duty';
  }
}
