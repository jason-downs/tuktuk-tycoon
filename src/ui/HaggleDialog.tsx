import { useEffect, useState } from 'react';
import { ARCHETYPES } from '../content/archetypes';
import type { QuoteOutcome } from '../sim/dispatch';
import type { Game } from '../sim/game';
import { baht, km } from './format';
import { ui, useUI } from './store';

const PRESETS = [
  { label: 'Local price', ratio: 0.9 },
  { label: 'Fair', ratio: 1 },
  { label: 'Tourist price', ratio: 1.3 },
  { label: 'Cheeky', ratio: 1.7 },
];

const round10 = (v: number) => Math.max(0, Math.round(v / 10) * 10);

/** Kerbside fare negotiation for the player's own tuk-tuk. */
export function HaggleDialog({ game }: { game: Game }) {
  const haggle = useUI((s) => s.haggle);
  const req = haggle ? game.state.requests.find((r) => r.id === haggle.requestId) : undefined;
  const [fare, setFare] = useState(0);
  const [outcome, setOutcome] = useState<QuoteOutcome | null>(null);
  const [countered, setCountered] = useState(false);

  useEffect(() => {
    if (req) {
      setFare(round10(req.fairFare * 1.1));
      setOutcome(null);
      setCountered(false);
    }
  }, [req?.id]);

  if (!haggle || !req) return null;
  const info = ARCHETYPES[req.archetype];
  const from = game.place(req.from);
  const to = game.place(req.to);
  const ratio = req.fairFare ? fare / req.fairFare : 1;
  const close = () => ui.set({ haggle: null });

  const offer = () => {
    const o = game.playerQuote(fare, countered);
    setOutcome(o);
    if (o.kind === 'counter') setCountered(true);
    if (o.kind === 'accept') {
      setTimeout(() => {
        game.playerStartTrip(o.fare);
        close();
      }, 700);
    }
    if (o.kind === 'leave') {
      setTimeout(() => {
        game.playerAbandon();
        close();
      }, 1100);
    }
  };

  const takeCounter = () => {
    if (outcome?.kind !== 'counter') return;
    game.playerStartTrip(outcome.offer);
    close();
  };

  const decline = () => {
    game.playerAbandon();
    close();
  };

  const monk = req.archetype === 'monk';
  const mood = ratio <= 1.05 ? '🙂' : ratio <= req.maxRatio * 0.95 ? '🤔' : ratio <= req.maxRatio * 1.1 ? '😬' : '😠';

  return (
    <div className="modal-backdrop">
      <div className="dialog haggle">
        <div className="haggle-head">
          <div className="avatar" style={{ borderColor: info.color }}>
            {info.icon}
          </div>
          <div>
            <div className="eyebrow">
              {info.label}
              {req.party > 1 ? ` · party of ${req.party}` : ''}
            </div>
            <div className="quote-line">“{req.line}”</div>
          </div>
        </div>
        <div className="trip-summary">
          <span>{from.name}</span>
          <span className="arrow">→</span>
          <span>{to.name}</span>
          <span className="muted">
            {km(req.distance)} · going rate ≈ {baht(req.fairFare)}
          </span>
        </div>

        {outcome ? (
          <div className={`outcome outcome-${outcome.kind}`}>
            <div className="bubble">{outcome.line}</div>
            {outcome.kind === 'counter' && (
              <div className="row">
                <button className="btn primary" onClick={takeCounter}>
                  Deal at {baht(outcome.offer)}
                </button>
                <button className="btn" onClick={() => setOutcome(null)}>
                  Counter again
                </button>
                <button className="btn ghost" onClick={decline}>
                  Let them go
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {monk && (
              <p className="hint">
                Monks don’t haggle. Many drivers give them a free ride to make merit (<i>tham bun</i>) — your reputation
                will thank you.
              </p>
            )}
            <div className="presets">
              {(monk ? [{ label: 'Free (merit)', ratio: 0 }, ...PRESETS.slice(0, 2)] : PRESETS).map((p) => (
                <button key={p.label} className={`chip ${round10(req.fairFare * p.ratio) === fare ? 'on' : ''}`} onClick={() => setFare(round10(req.fairFare * p.ratio))}>
                  {p.label}
                  <b>{baht(round10(req.fairFare * p.ratio))}</b>
                </button>
              ))}
            </div>
            <div className="fare-picker">
              <button className="btn round" onClick={() => setFare((f) => Math.max(0, f - 10))}>
                −
              </button>
              <div className="fare-value">
                {baht(fare)}
                <span className="mood" title="How the passenger feels about it">
                  {mood}
                </span>
              </div>
              <button className="btn round" onClick={() => setFare((f) => f + 10)}>
                +
              </button>
            </div>
            <input
              className="slider"
              type="range"
              min={0}
              max={round10(req.fairFare * 3)}
              step={10}
              value={fare}
              onChange={(e) => setFare(Number(e.target.value))}
            />
            <p className="hint">
              Overcharging earns more today but costs you stars; honest fares bring passengers back. Late at night,
              tourists accept more.
            </p>
            <div className="row">
              <button className="btn primary big" onClick={offer}>
                {countered ? 'Final offer' : 'Quote'} {baht(fare)}
              </button>
              <button className="btn ghost" onClick={decline}>
                Decline ride
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
