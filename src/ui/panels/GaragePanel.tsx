import { useState } from 'react';
import { ARCHETYPES } from '../../content/archetypes';
import { PAINTS } from '../../content/paints';
import { VEHICLE_UPGRADES, type VehicleUpgrade } from '../../content/upgrades';
import { VEHICLE_MODELS } from '../../content/vehicles';
import { BALANCE } from '../../sim/balance';
import { formatClock } from '../../sim/clock';
import {
  AUTO_SERVICE_OPTIONS,
  EV_CONVERSION_HOURS,
  EV_KIT_PRICE,
  NIGHT_FROM_HOUR,
  NIGHT_TO_HOUR,
  PAINT_HOURS,
  canConvertToEv,
  canInstall,
  canRepaint,
  canService,
  evConversionModel,
  formatHours,
  garageState,
  hasUpgrade,
  installUpgrade,
  repaint,
  repaintCost,
  serviceQuote,
  setAutoService,
  startEvConversion,
  startService,
  vehicleJob,
} from '../../sim/garage';
import type { Game } from '../../sim/game';
import { CLIMB_HELP_TEXT, vehicleClimbs } from '../../sim/mountain';
import type { Archetype, Vehicle } from '../../sim/types';
import { breakdownPerDay } from '../../sim/vehicles';
import { baht, taskText } from '../format';
import type { PanelProps } from '../panels';
import { useGame, useUI } from '../store';
import { TukTukArt } from '../TukTukArt';
import './garage.css';

type Tab = 'workshop' | 'upgrades' | 'paint';

const TABS: { id: Tab; label: string }[] = [
  { id: 'workshop', label: '🔧 Workshop' },
  { id: 'upgrades', label: '✨ Upgrades' },
  { id: 'paint', label: '🎨 Paint shop' },
];

const UPGRADES = Object.values(VEHICLE_UPGRADES).sort((a, b) => a.price - b.price);
/** "a, b and c". */
const andList = (items: string[]): string => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const RENTABLE = andList(UPGRADES.filter((u) => u.rentable).map((u) => `${u.icon} ${u.name.toLowerCase()}`));

/** Flat snapshot of the vehicle on the ramp (compared shallowly by useGame). */
function snapshot(g: Game, want: number | null) {
  const v = (want !== null ? g.vehicle(want) : undefined) ?? g.playerVehicle() ?? g.state.vehicles[0];
  if (!v) return null;
  const driver = v.driverId !== null ? g.driver(v.driverId) : undefined;
  const job = vehicleJob(g, v);
  return {
    id: v.id,
    model: v.model,
    paint: v.paint,
    ownership: v.ownership,
    rent: v.rentPerDay,
    upgrades: v.upgrades.join(','),
    condition: Math.round(v.condition),
    fuel: Math.round(v.fuel * 100),
    odometer: Math.round(v.odometer),
    task: taskText(g, v),
    job: job ? `${job.kind}:${job.item}` : '',
    driver: driver ? (driver.isPlayer ? 'You' : driver.nickname) : '',
    cash: Math.floor(g.state.cash),
    fleet: g.state.vehicles.map((x) => `${x.id}\t${x.name}`).join('\n'),
    autoService: garageState(g).autoService ?? 0,
    hired: g.state.drivers.some((dr) => !dr.isPlayer),
  };
}

const signed = (n: number): string => `${n > 0 ? '+' : '−'}${Math.abs(n).toFixed(2).replace(/0$/, '')}`;
const pct = (f: number): string => `${Math.round(f * 100)}%`;

/** "1 in 9 days" style breakdown odds. */
function odds(perDay: number): string {
  if (perDay <= 0) return 'never';
  const days = 1 / perDay;
  return days < 1.5 ? 'about daily' : `1 in ${Math.round(days)} days`;
}

interface Tag {
  text: string;
  tone: 'good' | 'bad' | '';
}

/** Rating changes per passenger type, fans first. */
function fanTags(fans: Partial<Record<Archetype, number>> | undefined): Tag[] {
  return Object.entries(fans ?? {})
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
    .map(([arch, r]) => {
      const info = ARCHETYPES[arch as Archetype];
      return { text: `${info.icon} ${info.label} ${signed(r ?? 0)}★`, tone: (r ?? 0) >= 0 ? 'good' : 'bad' };
    });
}

/** Plain-language effects of an upgrade, from its data: always-on effects, rider reactions, and after-dark ones. */
function effectTags(up: VehicleUpgrade): { always: Tag[]; riders: Tag[]; night: Tag[] } {
  const always: Tag[] = [];
  if (up.comfort) always.push({ text: `${signed(up.comfort)}★ every ride`, tone: 'good' });
  if (up.speed) always.push({ text: `${pct(up.speed - 1)} faster`, tone: 'good' });
  if (up.sight) always.push({ text: `Spots hails ${pct(up.sight - 1)} further away`, tone: 'good' });
  if (up.reliability) always.push({ text: `${pct(1 - up.reliability)} fewer breakdowns`, tone: 'good' });
  if (up.climbs) always.push({ text: '⛰️ Climbs Doi Suthep', tone: 'good' });
  if (up.rainproof) always.push({ text: '☔ Dry riders in rain, storms and Songkran', tone: 'good' });
  if (up.hubs) always.push({ text: `✈️ ${signed(up.hubs)}★ airport & station runs`, tone: 'good' });
  const night = fanTags(up.nightFans);
  if (up.nightlife) night.unshift({ text: `🍸 Nightlife runs ${signed(up.nightlife)}★`, tone: 'good' });
  return { always, riders: fanTags(up.fans), night };
}

function Tags({ tags, label }: { tags: Tag[]; label?: string }) {
  if (!tags.length) return null;
  return (
    <div className="garage-tags">
      {label && <span className="garage-tags-label">{label}</span>}
      {tags.map((t) => (
        <span key={t.text} className={`garage-tag ${t.tone}`}>
          {t.text}
        </span>
      ))}
    </div>
  );
}

/** What the vehicle is in the workshop for, e.g. "service & repair". */
function workLabel(v: Vehicle): string {
  return v.task.kind === 'broken' && v.task.work ? v.task.work : 'repairs';
}

function Why({ text }: { text: string }) {
  return <p className="garage-why">🔒 {text}</p>;
}

function Meter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bar" title={`${label}: ${Math.round(value * 100)}%`}>
      <span className="bar-label">{label}</span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
      </div>
    </div>
  );
}

export function GaragePanel({ game }: PanelProps) {
  const selected = useUI((s) => s.selectedVehicle);
  const [pick, setPick] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('workshop');
  const d = useGame(game, (g) => snapshot(g, pick ?? selected));
  const v = d ? game.vehicle(d.id) : undefined;
  if (!d || !v) return <p className="muted">No tuk-tuks in the garage yet.</p>;

  const model = VEHICLE_MODELS[d.model];
  const ev = model?.powertrain === 'ev';
  const fleet = d.fleet.split('\n').map((row) => row.split('\t'));
  const fitted = d.upgrades ? d.upgrades.split(',') : [];
  const climbs = vehicleClimbs(v);
  const ownership =
    d.ownership === 'rented' ? `Rented from Lung Daeng · ${baht(d.rent)}/day` : d.ownership === 'leased' ? 'Hire-purchase' : 'Owned';

  return (
    <div className="garage">
      <div className="garage-head">
        <TukTukArt paint={d.paint} className="garage-hero" />
        <div className="garage-id">
          {fleet.length > 1 ? (
            <select className="garage-pick" value={d.id} onChange={(e) => setPick(Number(e.target.value))} aria-label="Vehicle">
              {fleet.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          ) : (
            <div className="title">{v.name}</div>
          )}
          <div className="muted small">
            {model?.name ?? d.model} · {ownership}
          </div>
          <div className="small">
            {PAINTS[d.paint]?.name ?? 'Unpainted'}
            {d.driver ? ` · driver: ${d.driver}` : ' · no driver'}
          </div>
        </div>
      </div>
      <div className="task">{d.task}</div>
      <Meter label="Condition" value={d.condition / 100} color={d.condition < 35 ? '#d6453d' : '#d9a13b'} />
      <Meter label={ev ? 'Battery' : 'LPG'} value={d.fuel / 100} color={d.fuel < 20 ? '#d6453d' : '#3aa35b'} />
      <div className="facts garage-facts">
        <span>🛣️ {d.odometer.toLocaleString('en-US')} km</span>
        <span title="Chance of a breakdown per working day">🔧 Breakdowns {odds(breakdownPerDay(game, v))}</span>
        <span className={climbs ? 'pos' : 'muted'} title={climbs ? '' : CLIMB_HELP_TEXT}>
          ⛰️ {climbs ? 'Climbs Doi Suthep' : 'Can’t climb Doi Suthep'}
        </span>
      </div>
      {fitted.length > 0 && (
        <div className="garage-fitted" title="Fitted upgrades">
          {fitted.map((id) => (
            <span key={id} className="garage-tag" title={VEHICLE_UPGRADES[id]?.desc}>
              {VEHICLE_UPGRADES[id]?.icon ?? '🔧'} {VEHICLE_UPGRADES[id]?.name ?? id}
            </span>
          ))}
        </div>
      )}

      <div className="garage-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`btn tiny ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'workshop' && <Workshop game={game} v={v} autoService={d.autoService} hired={d.hired} />}
      {tab === 'upgrades' && <Upgrades game={game} v={v} />}
      {tab === 'paint' && <PaintShop key={v.id} game={game} v={v} />}
    </div>
  );
}

function Workshop({ game, v, autoService, hired }: { game: Game; v: Vehicle; autoService: number; hired: boolean }) {
  const q = serviceQuote(v);
  const service = canService(game, v);
  const job = vehicleJob(game, v);
  const model = VEHICLE_MODELS[v.model];
  const target = evConversionModel(v);
  const convert = canConvertToEv(game, v);
  const lpgParts = v.upgrades.filter((id) => VEHICLE_UPGRADES[id]?.powertrain === 'lpg').map((id) => VEHICLE_UPGRADES[id].name);
  return (
    <>
      <section className="garage-card">
        <div className="garage-card-head">
          <b>🔧 Service &amp; repair</b>
          {q.points > 0 && <span className="garage-price">{baht(q.cost)}</span>}
        </div>
        {q.points > 0 ? (
          <>
            <p className="small">
              Condition {Math.round(v.condition)}% → 100% · off the road for {formatHours(q.hours)}.
            </p>
            <p className="small muted">
              Breakdowns {odds(breakdownPerDay(game, v))} → {odds(breakdownPerDay(game, { ...v, condition: 100 }))}. Below 30%
              condition, passengers mark you down.
              {v.ownership === 'rented' ? ' It’s Lung Daeng’s tuk-tuk, but renters pay for repairs.' : ''}
            </p>
          </>
        ) : (
          <p className="small muted">Freshly serviced. Every kilometre wears it a little; come back when condition drops.</p>
        )}
        {job?.kind === 'service' ? (
          <p className="small pos">In the workshop now.</p>
        ) : (
          <>
            <button className="btn primary wide" disabled={!service.ok} onClick={() => startService(game, v)}>
              Book service{q.points > 0 ? ` · ${baht(q.cost)}` : ''}
            </button>
            {!service.ok && q.points > 0 && <Why text={service.reason} />}
          </>
        )}
      </section>

      <section className="garage-card">
        <div className="garage-card-head">
          <b>🗓️ Fleet service policy</b>
        </div>
        <p className="small muted">
          When a hired driver’s shift ends, their tuk-tuk goes in for a service if its condition is below:
        </p>
        <div className="garage-chips">
          {[0, ...AUTO_SERVICE_OPTIONS].map((t) => (
            <button key={t} className={`btn tiny ${autoService === t ? 'on' : ''}`} onClick={() => setAutoService(game, t || null)}>
              {t ? `under ${t}%` : 'Off'}
            </button>
          ))}
        </div>
        {!hired && <p className="hint small">Applies once you hire drivers. Your own tuk-tuk is up to you.</p>}
      </section>

      {model?.powertrain === 'lpg' && target ? (
        <section className="garage-card garage-ev">
          <div className="garage-card-head">
            <b>⚡ EV conversion kit</b>
            <span className="garage-price">{baht(EV_KIT_PRICE)}</span>
          </div>
          <p className="small">
            Out with the LPG engine, in with a battery and hub motor. {formatHours(EV_CONVERSION_HOURS)} in the workshop; the
            tuk-tuk keeps its plate.
          </p>
          <table className="garage-compare">
            <thead>
              <tr>
                <th />
                <th>Now</th>
                <th>Electric</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Running cost</td>
                <td>฿{BALANCE.fuel.lpgPerKm}/km</td>
                <td className="pos">฿{BALANCE.fuel.evPerKm}/km</td>
              </tr>
              <tr>
                <td>Upkeep</td>
                <td>{baht(BALANCE.upkeep.lpgPerDay)}/day</td>
                <td className="pos">{baht(BALANCE.upkeep.evPerDay)}/day</td>
              </tr>
              <tr>
                <td>Range</td>
                <td>{model.rangeKm} km</td>
                <td className={target.rangeKm < model.rangeKm ? 'neg' : 'pos'}>{target.rangeKm} km</td>
              </tr>
              <tr>
                <td>Breakdowns</td>
                <td>{odds(breakdownPerDay(game, { ...v, condition: 100 }))}</td>
                <td className="pos">{odds(breakdownPerDay(game, { model: target.id, condition: 100, upgrades: [] }))}</td>
              </tr>
              <tr>
                <td>Doi Suthep</td>
                <td>{vehicleClimbs(v) ? '✓' : '✗'}</td>
                <td className="pos">✓</td>
              </tr>
            </tbody>
          </table>
          <p className="hint small">
            Charges at the big malls. {lpgParts.length ? `${lpgParts.join(' and ')} come out with the engine.` : ''}
          </p>
          {job?.kind === 'ev' ? (
            <p className="small pos">Conversion under way.</p>
          ) : (
            <>
              <button className="btn primary wide" disabled={!convert.ok} onClick={() => startEvConversion(game, v)}>
                Convert to electric · {baht(EV_KIT_PRICE)}
              </button>
              {!convert.ok && <Why text={convert.reason} />}
            </>
          )}
        </section>
      ) : (
        <section className="garage-card">
          <div className="garage-card-head">
            <b>⚡ Electric</b>
          </div>
          <p className="small muted">
            Silent and cheap to run at ฿{BALANCE.fuel.evPerKm}/km. Charges at the big malls, and climbs Doi Suthep without
            complaint.
          </p>
        </section>
      )}
    </>
  );
}

function Upgrades({ game, v }: { game: Game; v: Vehicle }) {
  const powertrain = VEHICLE_MODELS[v.model]?.powertrain;
  const list = UPGRADES.filter((u) => !u.powertrain || u.powertrain === powertrain);
  const job = vehicleJob(game, v);
  const rented = v.ownership === 'rented';
  return (
    <>
      {rented && (
        <p className="hint garage-rented">
          🔒 Lung Daeng won’t let you drill holes in his tuk-tuk. On a rented one you can only add the {RENTABLE}. Buy or
          lease your own for the rest.
        </p>
      )}
      {job && (
        <p className="hint garage-rented">
          🔧 In the workshop ({workLabel(v)}) until {formatClock(job.until)}. Parts that take fitting time can be booked
          once it’s back; on-the-spot extras go on now.
        </p>
      )}
      <p className="hint small">
        ★ = change to the passenger’s rating. 🌙 = trips starting {NIGHT_FROM_HOUR}:00–{String(NIGHT_TO_HOUR).padStart(2, '0')}:00.
      </p>
      <div className="list garage-list">
        {list.map((up) => {
          const done = hasUpgrade(v, up.id);
          const fitting = job?.kind === 'fit' && job.item === up.id;
          const verdict = canInstall(game, v, up.id);
          // The banners above explain the rented and workshop rules, so those rows only point to them.
          const note = rented && !up.rentable ? '🔒 own tuk-tuk only' : job && up.hours ? '🔒 after the workshop' : null;
          const tags = effectTags(up);
          return (
            <div key={up.id} className={`garage-row ${done ? 'fitted' : ''}`}>
              <div className="garage-icon">{up.icon}</div>
              <div className="garage-row-main">
                <b>{up.name}</b>
                <div className="small muted">{up.desc}</div>
                <Tags tags={[...tags.always, ...tags.riders]} />
                <Tags tags={tags.night} label="🌙 After dark" />
                {!done && !fitting && !verdict.ok && !note && <Why text={verdict.reason} />}
              </div>
              <div className="garage-row-side">
                {done ? (
                  <span className="garage-badge">✓ Fitted</span>
                ) : fitting ? (
                  <span className="garage-badge">🔧 Fitting</span>
                ) : (
                  <button className="btn primary tiny" disabled={!verdict.ok} onClick={() => installUpgrade(game, v, up.id)}>
                    {baht(up.price)}
                  </button>
                )}
                {!done && (
                  <div className="small muted">
                    {fitting ? `ready ${formatClock(job.until)}` : (note ?? (up.hours ? `${formatHours(up.hours)} fit` : 'on the spot'))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function PaintShop({ game, v }: { game: Game; v: Vehicle }) {
  const [sel, setSel] = useState<string | null>(null);
  const job = vehicleJob(game, v);
  const id = sel ?? v.paint;
  const paint = PAINTS[id] ?? PAINTS.nakhon_blue;
  const verdict = canRepaint(game, v, id);
  const current = id === v.paint;
  return (
    <>
      {v.ownership === 'rented' && (
        <p className="hint garage-rented">
          🔒 Lung Daeng likes his tuk-tuk the colour it is. Preview any livery here, then repaint the tuk-tuks you own or
          lease.
        </p>
      )}
      <section className="garage-card garage-paint-detail">
        <TukTukArt paint={paint.id} className="garage-paint-preview" />
        <div className="garage-paint-info">
          <div className="garage-card-head">
            <b>{paint.name}</b>
            {!current && <span className="garage-price">{baht(repaintCost(paint.id))}</span>}
          </div>
          <p className="small">{paint.blurb}</p>
          <Tags
            tags={[
              ...(paint.comfort > 0 ? [{ text: `${signed(paint.comfort)}★ every ride`, tone: 'good' as const }] : []),
              ...(current ? [] : [{ text: `🕑 ${PAINT_HOURS} h in the paint shop`, tone: '' as const }]),
            ]}
          />
        </div>
      </section>
      {job?.kind === 'paint' ? (
        <p className="small pos">In the paint shop: {PAINTS[job.item]?.name}.</p>
      ) : current ? (
        <p className="hint small">This is its livery now. Pick another below to preview it.</p>
      ) : (
        <>
          <button className="btn primary wide" disabled={!verdict.ok} onClick={() => repaint(game, v, paint.id) && setSel(null)}>
            Repaint in {paint.name} · {baht(repaintCost(paint.id))}
          </button>
          {!verdict.ok && <Why text={verdict.reason} />}
        </>
      )}
      <div className="garage-swatches">
        {Object.values(PAINTS).map((p) => (
          <button key={p.id} className={`garage-swatch ${p.id === id ? 'on' : ''}`} onClick={() => setSel(p.id)} title={p.blurb}>
            <TukTukArt paint={p.id} />
            <span className="garage-swatch-name">{p.name}</span>
            <span className="small muted">{p.id === v.paint ? 'Current' : baht(repaintCost(p.id))}</span>
          </button>
        ))}
      </div>
    </>
  );
}
