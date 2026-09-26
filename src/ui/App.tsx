import { useEffect, useRef, useState } from 'react';
import { ARCHETYPES } from '../content/archetypes';
import { VEHICLE_MODELS } from '../content/vehicles';
import { MapView } from '../map/MapView';
import { SPEED_STEPS, formatClock, formatDate } from '../sim/clock';
import type { Game } from '../sim/game';
import type { Notice } from '../sim/types';
import { baht, km, minutes, taskText } from './format';
import { HaggleDialog } from './HaggleDialog';
import { OVERLAYS } from './overlays';
import { PANELS } from './panels';
import { bindGameTicks, ui, useGame, useUI } from './store';

export interface AppProps {
  game: Game;
  base: string;
  onSave: () => void;
  onQuit: () => void;
}

export function App({ game, base, onSave, onQuit }: AppProps) {
  const mapEl = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<MapView | null>(null);

  useEffect(() => bindGameTicks(game), [game]);

  useEffect(() => {
    if (!mapEl.current) return;
    const mv = new MapView(mapEl.current, game, { base });
    setView(mv);
    const offHaggle = game.on('haggle', (p: { vehicleId: number; requestId: number }) => ui.set({ haggle: p }));
    return () => {
      offHaggle();
      mv.destroy();
    };
  }, [game, base]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === ' ') {
        e.preventDefault();
        game.setSpeed(game.state.speed === 0 ? 2 : 0);
      } else if (e.key >= '1' && e.key <= '5') {
        game.setSpeed(Number(e.key));
      } else if (e.key === 'f' || e.key === 'F') {
        ui.set((s) => ({ follow: !s.follow }));
      } else if (e.key === 'Escape') {
        ui.set({ selectedRequest: null, selectedPlace: null, selectedVehicle: null, panel: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game]);

  return (
    <div className="app">
      <div className="map" ref={mapEl} />
      <TopBar game={game} onSave={onSave} onQuit={onQuit} />
      <div className="left-stack">
        <PlayerCard game={game} view={view} />
        <SelectedVehicleCard game={game} />
        <RequestCard game={game} view={view} />
        <PlaceCard game={game} />
      </div>
      <PanelHost game={game} view={view} />
      {OVERLAYS.map(({ id, component: Overlay }) => (
        <Overlay key={id} game={game} view={view} />
      ))}
      <Toasts game={game} view={view} />
      <HaggleDialog game={game} />
    </div>
  );
}

function TopBar({ game, onSave, onQuit }: { game: Game; onSave: () => void; onQuit: () => void }) {
  const d = useGame(game, (g) => ({
    cash: Math.round(g.state.cash),
    time: Math.floor(g.state.time / 60),
    rep: Math.round(g.state.reputation * 10) / 10,
    speed: g.state.speed,
    paused: g.isPaused(),
    company: g.state.companyName,
    fleet: g.state.vehicles.length,
  }));
  const panel = useUI((s) => s.panel);
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">🛺</span>
        <div>
          <div className="company">{d.company}</div>
          <div className="muted small">
            {d.fleet} tuk-tuk{d.fleet === 1 ? '' : 's'} · Chiang Mai
          </div>
        </div>
      </div>
      <div className="stat cash" title="Cash">
        {baht(d.cash)}
      </div>
      <div className="stat" title="Customer rating">
        <span className="star">★</span> {d.rep.toFixed(1)}
      </div>
      <div className="stat clock" title="Game time">
        <div>{formatClock(d.time * 60)}</div>
        <div className="muted small">{formatDate(d.time * 60)}</div>
      </div>
      <div className="speed" role="group" aria-label="Game speed">
        {SPEED_STEPS.map((s, i) => (
          <button
            key={i}
            className={`btn tiny ${d.speed === i ? 'on' : ''}`}
            onClick={() => game.setSpeed(i)}
            title={i === 0 ? 'Pause (Space)' : `${s}× speed (${i})`}
          >
            {i === 0 ? '❚❚' : `${s}×`}
          </button>
        ))}
      </div>
      <nav className="panels-nav">
        {PANELS.map((p) => (
          <button key={p.id} className={`btn tab ${panel === p.id ? 'on' : ''}`} onClick={() => ui.set({ panel: panel === p.id ? null : p.id })}>
            <span>{p.icon}</span> {p.title}
          </button>
        ))}
      </nav>
      <div className="menu">
        <button className="btn tiny" onClick={onSave} title="Save game">
          💾
        </button>
        <button className="btn tiny" onClick={onQuit} title="Main menu">
          ☰
        </button>
      </div>
    </header>
  );
}

function Bar({ value, color, label }: { value: number; color: string; label: string }) {
  return (
    <div className="bar" title={`${label}: ${Math.round(value * 100)}%`}>
      <span className="bar-label">{label}</span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function PlayerCard({ game, view }: { game: Game; view: MapView | null }) {
  const d = useGame(game, (g) => {
    const v = g.playerVehicle();
    return {
      has: !!v,
      name: v?.name ?? '',
      task: v ? taskText(g, v) : '',
      fuel: v?.fuel ?? 0,
      condition: (v?.condition ?? 0) / 100,
      autopilot: g.state.autopilot,
      model: v ? VEHICLE_MODELS[v.model]?.name ?? v.model : '',
      busy: v ? v.task.kind === 'trip' || v.task.kind === 'haggle' || v.task.kind === 'broken' : false,
    };
  });
  const follow = useUI((s) => s.follow && s.selectedVehicle === null);
  if (!d.has) return null;
  return (
    <section className="card player">
      <div className="card-head">
        <span className="eyebrow">Your tuk-tuk</span>
        <button
          className={`btn tiny ${follow ? 'on' : ''}`}
          onClick={() => {
            ui.set({ selectedVehicle: null, follow: true });
            const v = game.playerVehicle();
            if (v && view) {
              const p = game.vehiclePose(v);
              view.flyTo(p.x, p.y, 16);
            }
          }}
          title="Follow your tuk-tuk (F)"
        >
          🎯
        </button>
      </div>
      <div className="title">{d.name}</div>
      <div className="muted small">{d.model}</div>
      <div className="task">{d.task}</div>
      <Bar value={d.fuel} color={d.fuel < 0.2 ? '#d6453d' : '#3aa35b'} label="LPG" />
      <Bar value={d.condition} color={d.condition < 0.35 ? '#d6453d' : '#d9a13b'} label="Condition" />
      <div className="row">
        <button className="btn" disabled={d.busy} onClick={() => game.playerRefuel() && game.notify('Off to the LPG pump.', 'info')}>
          ⛽ Refuel
        </button>
        <label className="toggle" title="Let your tuk-tuk find passengers and haggle by itself">
          <input
            type="checkbox"
            checked={d.autopilot}
            onChange={(e) => {
              game.state.autopilot = e.target.checked;
              game.emit('change');
            }}
          />
          Autopilot
        </label>
      </div>
      <p className="hint small">Click a waving passenger to pick them up. Right-click the map to drive somewhere.</p>
    </section>
  );
}

function SelectedVehicleCard({ game }: { game: Game }) {
  const id = useUI((s) => s.selectedVehicle);
  const d = useGame(game, (g) => {
    const v = id !== null ? g.vehicle(id) : undefined;
    if (!v) return null;
    const driver = v.driverId !== null ? g.driver(v.driverId) : undefined;
    return {
      name: v.name,
      driver: driver ? (driver.isPlayer ? 'You' : `${driver.nickname} (${driver.fullName})`) : 'No driver',
      task: taskText(g, v),
      fuel: v.fuel,
      condition: v.condition / 100,
      isPlayer: !!driver?.isPlayer,
    };
  });
  if (!d || d.isPlayer) return null;
  return (
    <section className="card">
      <div className="card-head">
        <span className="eyebrow">Fleet tuk-tuk</span>
        <button className="btn tiny" onClick={() => ui.set({ selectedVehicle: null })}>
          ✕
        </button>
      </div>
      <div className="title">{d.name}</div>
      <div className="muted small">Driver: {d.driver}</div>
      <div className="task">{d.task}</div>
      <Bar value={d.fuel} color="#3aa35b" label="Fuel" />
      <Bar value={d.condition} color="#d9a13b" label="Condition" />
    </section>
  );
}

function RequestCard({ game, view }: { game: Game; view: MapView | null }) {
  const id = useUI((s) => s.selectedRequest);
  const d = useGame(game, (g) => {
    const r = id !== null ? g.state.requests.find((q) => q.id === id) : undefined;
    if (!r) return null;
    const pv = g.playerVehicle();
    const pose = pv ? g.vehiclePose(pv) : null;
    const from = g.place(r.from);
    return {
      r,
      left: Math.floor((r.expiresAt - g.state.time) / 60),
      away: pose ? Math.hypot(from.x - pose.x, from.y - pose.y) : 0,
      mine: r.claimedBy !== null && r.claimedBy === pv?.id,
      busy: pv?.task.kind === 'trip' || pv?.task.kind === 'haggle',
    };
  });
  if (!d) return null;
  const { r } = d;
  const info = ARCHETYPES[r.archetype];
  const from = game.place(r.from);
  const to = game.place(r.to);
  return (
    <section className="card request">
      <div className="card-head">
        <span className="eyebrow" style={{ color: info.color }}>
          {info.icon} {info.label}
          {r.party > 1 ? ` ×${r.party}` : ''}
          {r.channel === 'app' ? ' · 📱 app booking' : ''}
        </span>
        <button className="btn tiny" onClick={() => ui.set({ selectedRequest: null })}>
          ✕
        </button>
      </div>
      <div className="quote-line">“{r.line}”</div>
      <div className="trip-summary compact">
        <button className="link" onClick={() => view?.flyTo(from.x, from.y)}>
          {from.name}
        </button>
        <span className="arrow">→</span>
        <button className="link" onClick={() => view?.flyTo(to.x, to.y)}>
          {to.name}
        </button>
      </div>
      <div className="facts">
        <span>≈ {km(r.distance)}</span>
        <span>{r.fixedFare !== null ? `fixed ${baht(r.fixedFare)}` : `going rate ${baht(r.fairFare)}`}</span>
        <span>{km(d.away)} away</span>
        <span className={d.left < 5 ? 'warn' : ''}>waits {minutes(d.left * 60)}</span>
      </div>
      <button
        className="btn primary wide"
        disabled={d.mine || d.busy}
        onClick={() => {
          if (game.playerClaim(r.id)) ui.set({ follow: true, selectedVehicle: null });
        }}
      >
        {d.mine ? 'On your way…' : d.busy ? 'Finish your trip first' : 'Pick up'}
      </button>
    </section>
  );
}

function PlaceCard({ game }: { game: Game }) {
  const idx = useUI((s) => s.selectedPlace);
  if (idx === null) return null;
  const p = game.place(idx);
  return (
    <section className="card place">
      <div className="card-head">
        <span className="eyebrow">{p.cat}</span>
        <button className="btn tiny" onClick={() => ui.set({ selectedPlace: null })}>
          ✕
        </button>
      </div>
      <div className="title">{p.name}</div>
      {p.th && <div className="thai">{p.th}</div>}
      {p.notes && <p className="notes">{p.notes}</p>}
      {p.lpg && <p className="notes">LPG autogas pump. Right-click it on the map or press ⛽ Refuel to fill up.</p>}
    </section>
  );
}

function PanelHost({ game, view }: { game: Game; view: MapView | null }) {
  const id = useUI((s) => s.panel);
  const panel = PANELS.find((p) => p.id === id);
  if (!panel) return null;
  const Body = panel.component;
  return (
    <aside className="panel">
      <div className="panel-head">
        <h2>
          {panel.icon} {panel.title}
        </h2>
        <button className="btn tiny" onClick={() => ui.set({ panel: null })}>
          ✕
        </button>
      </div>
      <div className="panel-body">
        <Body game={game} view={view} />
      </div>
    </aside>
  );
}

function Toasts({ game, view }: { game: Game; view: MapView | null }) {
  const [items, setItems] = useState<Notice[]>([]);
  useEffect(() => {
    return game.on('notice', (n: Notice) => {
      setItems((list) => [...list.slice(-4), n]);
      setTimeout(() => setItems((list) => list.filter((x) => x.id !== n.id)), n.kind === 'goal' || n.kind === 'event' ? 9000 : 5000);
    });
  }, [game]);
  return (
    <div className="toasts">
      {items.map((n) => (
        <div
          key={n.id}
          className={`toast toast-${n.kind}`}
          onClick={() => {
            if (n.x !== undefined && n.y !== undefined) view?.flyTo(n.x, n.y);
            setItems((list) => list.filter((x) => x.id !== n.id));
          }}
        >
          {n.text}
        </div>
      ))}
    </div>
  );
}
