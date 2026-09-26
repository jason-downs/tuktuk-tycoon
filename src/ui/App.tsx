import { useEffect, useMemo, useRef, useState } from 'react';
import { ARCHETYPES } from '../content/archetypes';
import { spokenName } from '../content/dialogue';
import { VEHICLE_MODELS } from '../content/vehicles';
import type { MapView } from '../map/MapView';
import { World3DView } from '../world3d/World3DView';
import type { GameView } from './view';
import { SPEED_STEPS, formatClock, formatDate } from '../sim/clock';
import { DriveClock } from '../sim/driveClock';
import type { Game } from '../sim/game';
import { bookingTag } from '../sim/business';
import { fitsParty, inRide } from '../sim/dispatch';
import { dispatchNearest, freeVehiclesFor } from '../sim/manage';
import { setAutodrive, setManual } from '../sim/manual';
import { climbBlocked, requestClimbs } from '../sim/mountain';
import type { Notice } from '../sim/types';
import { ClimbNotice } from './ClimbNotice';
import { baht, km, minutes, taskText } from './format';
import { HaggleDialog } from './HaggleDialog';
import { startGameLoop } from './loop';
import { applyMode, initialMode } from './mode';
import { OVERLAYS } from './overlays';
import { PANELS } from './panels';
import { bindGameTicks, ui, useGame, useUI } from './store';
import { SoundControls } from './audio/SoundControls';
import { useDriveKeys } from './drive/DriveKeys';
import { DriveClockChip, ModeToggle } from './drive/TopBarDrive';
import { ManualStatus, ManualToggle } from './manual/ManualDrive';
import { SpeechLine } from './SpeechLine';
import './responsive.css';

/** The flat MapLibre map, fetched the first time it is opened (it brings MapLibre with it). */
const loadMapView = (): Promise<typeof MapView> => import('../map/MapView').then((m) => m.MapView);

export interface AppProps {
  game: Game;
  base: string;
  onSave: () => void;
  onQuit: () => void;
}

export function App({ game, base, onSave, onQuit }: AppProps) {
  const worldEl = useRef<HTMLDivElement>(null);
  const plannerEl = useRef<HTMLDivElement>(null);
  const [main, setMain] = useState<GameView | null>(null);
  const [plan, setPlan] = useState<GameView | null>(null);
  const planner = useUI((s) => s.planner);
  // The 3D city is the main view; ?view=map shows the flat planning map instead.
  const flat = useMemo(() => new URLSearchParams(window.location.search).get('view') === 'map', []);

  useEffect(() => bindGameTicks(game), [game]);
  useEffect(() => startGameLoop(game), [game]);
  useEffect(() => new DriveClock(game, { mode: () => ui.get().mode, pace: () => ui.get().drivePace }).install(), [game]);
  useEffect(() => {
    ui.set({ planner: false, haggle: null });
    applyMode(game, initialMode(game));
  }, [game]);
  useDriveKeys(game);

  useEffect(() => {
    const el = worldEl.current;
    if (!el) return;
    let cancelled = false;
    let mv: GameView | null = null;
    if (flat) {
      loadMapView().then((Flat) => {
        if (cancelled) return;
        mv = new Flat(el, game, { base });
        setMain(mv);
      });
    } else {
      mv = new World3DView(el, game, { base });
      setMain(mv);
    }
    const offHaggle = game.on('haggle', (p: { vehicleId: number; requestId: number }) => ui.set({ haggle: p }));
    return () => {
      cancelled = true;
      offHaggle();
      mv?.destroy();
      setMain(null);
    };
  }, [game, base, flat]);

  // The city-map planner (M): the flat map takes the 3D view's place while it is open; only one of them renders.
  useEffect(() => {
    const el = plannerEl.current;
    if (!planner || flat || !main || !el) return;
    let cancelled = false;
    let pv: MapView | null = null;
    main.setActive?.(false);
    loadMapView().then(
      (Flat) => {
        if (cancelled) return;
        pv = new Flat(el, game, { base });
        if (main instanceof World3DView) pv.flyTo(main.rig.tx, main.rig.ty, 15);
        setPlan(pv);
      },
      (err: unknown) => {
        game.notify(`Could not open the city map: ${String(err)}`, 'bad');
        ui.set({ planner: false });
      },
    );
    return () => {
      cancelled = true;
      if (pv) {
        // Back in Manage mode, the 3D camera looks where the map was looking.
        const c = pv.map.getCenter();
        const [x, y] = game.world.graph.projection.toXY(c.lng, c.lat);
        if (ui.get().mode === 'manage') {
          ui.set({ follow: false });
          main.flyTo(x, y);
        }
        pv.destroy();
      }
      setPlan(null);
      main.setActive?.(true);
    };
  }, [planner, flat, main, game, base]);

  const view = plan ?? main;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (ui.get().haggle !== null || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        game.setSpeed(game.state.speed === 0 ? 2 : 0);
      } else if (e.key >= '1' && e.key <= '5') {
        game.setSpeed(Number(e.key));
      } else if (e.key === 'f' || e.key === 'F') {
        ui.set((s) => ({ follow: !s.follow }));
      } else if (e.key === 'Escape') {
        ui.set({ selectedRequest: null, selectedPlace: null, selectedVehicle: null, panel: null, planner: false });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game]);

  return (
    <div className="app">
      <div className={`map world-host ${planner && !flat ? 'hidden' : ''}`} ref={worldEl} />
      {!flat && <div className={`map planner-host ${planner ? '' : 'hidden'}`} ref={plannerEl} />}
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
  const driving = useUI((s) => s.mode === 'drive');
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
      <ModeToggle game={game} />
      <div className={`speed ${driving ? 'dimmed' : ''}`} role="group" aria-label="Game speed">
        {SPEED_STEPS.map((s, i) => (
          <button
            key={i}
            className={`btn tiny ${d.speed === i ? 'on' : ''}`}
            onClick={() => game.setSpeed(i)}
            title={i === 0 ? 'Pause (Space)' : driving ? `${s}× speed (${i}) — runs the clock in Manage mode (Tab)` : `${s}× speed (${i})`}
          >
            {i === 0 ? '❚❚' : `${s}×`}
          </button>
        ))}
      </div>
      <DriveClockChip game={game} />
      <nav className="panels-nav">
        {PANELS.map((p) => (
          <button
            key={p.id}
            className={`btn tab ${panel === p.id ? 'on' : ''}`}
            onClick={() => ui.set({ panel: panel === p.id ? null : p.id })}
            title={p.title}
            aria-label={p.title}
          >
            <span className="tab-icon" aria-hidden>
              {p.icon}
            </span>
            <span className="tab-label">{p.title}</span>
          </button>
        ))}
      </nav>
      <div className="menu">
        <SoundControls />
        <button className="btn tiny" onClick={() => ui.set({ modal: 'help' })} title="How to play (?)" aria-label="How to play">
          ?
        </button>
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

function PlayerCard({ game, view }: { game: Game; view: GameView | null }) {
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
      ev: v ? VEHICLE_MODELS[v.model]?.powertrain === 'ev' : false,
      busy: v ? inRide(v) || v.task.kind === 'broken' : false,
    };
  });
  const follow = useUI((s) => s.follow && s.selectedVehicle === null);
  const driving = useUI((s) => s.mode === 'drive');
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
      <Bar value={d.fuel} color={d.fuel < 0.2 ? '#d6453d' : '#3aa35b'} label={d.ev ? 'Battery' : 'LPG'} />
      <Bar value={d.condition} color={d.condition < 0.35 ? '#d6453d' : '#d9a13b'} label="Condition" />
      <div className="row">
        <button
          className="btn"
          disabled={d.busy}
          onClick={() => game.playerRefuel() && game.notify(d.ev ? 'Off to a charger at the mall.' : 'Off to the LPG pump.', 'info')}
        >
          {d.ev ? '⚡ Charge' : '⛽ Refuel'}
        </button>
        <ManualToggle game={game} />
        <label className="toggle" title="Let your tuk-tuk find passengers and haggle by itself">
          <input
            type="checkbox"
            checked={d.autopilot}
            onChange={(e) => {
              if (e.target.checked) setManual(game, false);
              game.state.autopilot = e.target.checked;
              game.emit('change');
            }}
          />
          Autopilot
        </label>
      </div>
      {!driving && <ManualStatus game={game} />}
      <p className="hint small">
        {driving
          ? 'WASD drive · E pick up · G autodrive · Tab manage'
          : 'Tab drive · click a passenger to pick up or dispatch · right-click the map to send your tuk-tuk'}
      </p>
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

function RequestCard({ game, view }: { game: Game; view: GameView | null }) {
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
      mine: !!pv && (pv.task.kind === 'pickup' || pv.task.kind === 'haggle') && pv.task.requestId === r.id,
      busy: !pv
        ? ''
        : pv.task.kind === 'trip' || pv.task.kind === 'haggle'
          ? 'Finish your trip first'
          : pv.task.kind === 'away'
            ? 'You’re out of town'
            : pv.task.kind === 'broken'
              ? 'Your tuk-tuk is off the road'
              : '',
      tooBig: !!pv && !fitsParty(pv, r),
      climb: requestClimbs(g.world, r),
      noClimb: pv ? climbBlocked(g, pv, r) : false,
      claimed: r.claimedBy !== null && r.claimedBy !== pv?.id,
      free: freeVehiclesFor(g, r).length,
      hired: g.state.vehicles.some((v) => v !== pv && v.driverId !== null),
    };
  });
  const managing = useUI((s) => s.mode === 'manage');
  if (!d) return null;
  const { r } = d;
  const info = ARCHETYPES[r.archetype];
  const from = game.place(r.from);
  const to = game.place(r.to);
  const tag = bookingTag(game, r);
  return (
    <section className="card request">
      <div className="card-head">
        <span className="eyebrow" style={{ color: info.color }}>
          {info.icon} {info.label}
          {r.party > 1 ? ` ×${r.party}` : ''}
          {tag ? ` · ${tag.icon} ${tag.label}` : ''}
        </span>
        <button className="btn tiny" onClick={() => ui.set({ selectedRequest: null })}>
          ✕
        </button>
      </div>
      <SpeechLine line={r.line} protect={[from.name, to.name, spokenName(from), spokenName(to)]} />
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
        {d.climb && <span>⛰️ Doi Suthep climb</span>}
      </div>
      {d.noClimb && <ClimbNotice />}
      <button
        className="btn primary wide"
        disabled={d.mine || d.busy !== '' || d.noClimb || d.claimed || d.tooBig}
        onClick={() => {
          if (!game.playerClaim(r.id)) return;
          // In Drive mode the GPS takes the wheel to get there; W takes it back.
          if (ui.get().mode === 'drive') setAutodrive(game, true);
          ui.set({ follow: true, selectedVehicle: null });
        }}
      >
        {d.mine
          ? 'On your way…'
          : d.claimed
            ? 'A fleet tuk-tuk is on the way'
            : d.busy || (d.noClimb ? 'Can’t make the climb' : d.tooBig ? 'Too many passengers' : 'Pick up')}
      </button>
      {(managing || d.hired) && !d.mine && !d.claimed && (
        <button
          className="btn wide dispatch"
          disabled={d.free === 0}
          onClick={() => {
            const v = dispatchNearest(game, r.id);
            if (v) game.notify(`${v.name} is on the way to ${from.name}.`, 'info');
            else game.notify('No free tuk-tuk can reach them.', 'bad');
          }}
          title="Send the closest idle tuk-tuk with a hired driver"
        >
          {d.free ? `Dispatch nearest free tuk-tuk (${d.free} free)` : 'No free tuk-tuk to dispatch'}
        </button>
      )}
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

function PanelHost({ game, view }: { game: Game; view: GameView | null }) {
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

function Toasts({ game, view }: { game: Game; view: GameView | null }) {
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
