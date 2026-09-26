import { VEHICLE_MODELS } from '../../content/vehicles';
import type { PanelProps } from '../panels';
import { taskText } from '../format';
import { ui, useGame } from '../store';

export function FleetPanel({ game, view }: PanelProps) {
  const rows = useGame(game, (g) =>
    g.state.vehicles.map((v) => {
      const d = v.driverId !== null ? g.driver(v.driverId) : undefined;
      return `${v.id}|${v.name}|${d ? (d.isPlayer ? 'You' : d.nickname) : '—'}|${taskText(g, v)}|${Math.round(v.fuel * 100)}|${Math.round(v.condition)}|${VEHICLE_MODELS[v.model]?.name ?? v.model}|${v.ownership}`;
    }),
  );
  return (
    <div className="list">
      {rows.map((row) => {
        const [id, name, driver, task, fuel, cond, model, own] = row.split('|');
        return (
          <button
            key={id}
            className="list-row"
            onClick={() => {
              const v = game.vehicle(Number(id));
              if (!v) return;
              ui.set({ selectedVehicle: v.id, follow: true });
              const p = game.vehiclePose(v);
              view?.flyTo(p.x, p.y, 16);
            }}
          >
            <div className="list-main">
              <b>{name}</b> <span className="muted small">· {model} · {own}</span>
              <div className="small">{driver} — {task}</div>
            </div>
            <div className="list-side small">
              ⛽ {fuel}%<br />🔧 {cond}%
            </div>
          </button>
        );
      })}
    </div>
  );
}
