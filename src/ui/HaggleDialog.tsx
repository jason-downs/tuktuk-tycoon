import { useEffect, useRef, useState } from 'react';
import { ARCHETYPES } from '../content/archetypes';
import { spokenName } from '../content/dialogue';
import type { QuoteOutcome } from '../sim/dispatch';
import type { Game } from '../sim/game';
import { setPedals } from '../sim/manual';
import { baht, km } from './format';
import { SpeechLine } from './SpeechLine';
import { ui, useUI } from './store';
import './drive/drive.css';

const PRESETS = [
  { label: 'Local price', ratio: 0.9 },
  { label: 'Fair', ratio: 1 },
  { label: 'Tourist price', ratio: 1.3 },
  { label: 'Cheeky', ratio: 1.7 },
];

const round10 = (v: number) => Math.max(0, Math.round(v / 10) * 10);

/**
 * Kerbside fare negotiation for the player's own tuk-tuk. In Drive mode it is
 * a sheet at the bottom of the screen so the passenger stays in view; in
 * Manage mode a dialog. While open it takes the keyboard: 1–4 pick a price,
 * ←/→ change it by ฿10, Enter quotes (or takes a counter-offer), Esc lets the
 * passenger go.
 */
export function HaggleDialog({ game }: { game: Game }) {
  const haggle = useUI((s) => s.haggle);
  const sheet = useUI((s) => s.mode === 'drive');
  const req = haggle ? game.state.requests.find((r) => r.id === haggle.requestId) : undefined;
  const [fare, setFare] = useState(0);
  const [outcome, setOutcome] = useState<QuoteOutcome | null>(null);
  const [countered, setCountered] = useState(false);
  /** Set while the passenger climbs in or walks off, when keys do nothing. */
  const settling = useRef(false);

  useEffect(() => {
    if (req) {
      setFare(round10(req.fairFare * 1.1));
      setOutcome(null);
      setCountered(false);
      settling.current = false;
      // Keys held when the haggle opened would otherwise stay pressed.
      setPedals(game, false, false);
    }
  }, [req?.id]);

  const monk = req?.archetype === 'monk';
  const presets = monk ? [{ label: 'Free (merit)', ratio: 0 }, ...PRESETS.slice(0, 2)] : PRESETS;
  const close = () => ui.set({ haggle: null });

  const offer = () => {
    if (settling.current) return;
    const o = game.playerQuote(fare, countered);
    setOutcome(o);
    if (o.kind === 'counter') setCountered(true);
    if (o.kind === 'accept') {
      settling.current = true;
      setTimeout(() => {
        game.playerStartTrip(o.fare);
        close();
      }, 700);
    }
    if (o.kind === 'leave') {
      settling.current = true;
      setTimeout(() => {
        game.playerAbandon();
        close();
      }, 1100);
    }
  };

  const takeCounter = () => {
    if (outcome?.kind !== 'counter' || settling.current) return;
    settling.current = true;
    game.playerStartTrip(outcome.offer);
    close();
  };

  const decline = () => {
    if (settling.current) return;
    settling.current = true;
    game.playerAbandon();
    close();
  };

  // The haggle takes the keyboard: its keys act here and no game key fires underneath.
  useEffect(() => {
    if (!haggle || !req) return;
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const k = e.key;
      let handled = true;
      if (outcome?.kind === 'counter') {
        if (k === 'Enter') takeCounter();
        else if (k === 'Escape') decline();
        else if (k === 'c' || k === 'C') setOutcome(null);
        else handled = false;
      } else if (!outcome) {
        const n = Number(k);
        if (Number.isInteger(n) && n >= 1 && n <= presets.length) setFare(round10(req.fairFare * presets[n - 1].ratio));
        else if (k === 'ArrowLeft' || k === 'ArrowDown' || k === '-') setFare((f) => Math.max(0, f - 10));
        else if (k === 'ArrowRight' || k === 'ArrowUp' || k === '+' || k === '=') setFare((f) => f + 10);
        else if (k === 'Enter') offer();
        else if (k === 'Escape') decline();
        else handled = false;
      } else handled = k === 'Enter' || k === 'Escape';
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!haggle || !req) return null;
  const info = ARCHETYPES[req.archetype];
  const from = game.place(req.from);
  const to = game.place(req.to);
  const names = [from.name, to.name, spokenName(from), spokenName(to)];
  const ratio = req.fairFare ? fare / req.fairFare : 1;
  const mood = ratio <= 1.05 ? '🙂' : ratio <= req.maxRatio * 0.95 ? '🤔' : ratio <= req.maxRatio * 1.1 ? '😬' : '😠';

  const body = (
    <div className="dialog haggle" role="dialog" aria-label="Agree a fare">
      <div className="haggle-head">
        <div className="avatar" style={{ borderColor: info.color }}>
          {info.icon}
        </div>
        <div>
          <div className="eyebrow">
            {info.label}
            {req.party > 1 ? ` · party of ${req.party}` : ''}
          </div>
          <SpeechLine line={req.line} protect={names} />
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
          <SpeechLine line={outcome.line} protect={names} className="bubble" quotes={false} />
          {outcome.kind === 'counter' && (
            <>
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
              <div className="keys small">
                <kbd>Enter</kbd> deal · <kbd>C</kbd> counter again · <kbd>Esc</kbd> let them go
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          {monk && (
            <p className="hint">
              Monks don’t haggle. Many drivers give them a free ride to make merit (<i>tham bun</i>) — your reputation will
              thank you.
            </p>
          )}
          <div className="presets">
            {presets.map((p, i) => (
              <button key={p.label} className={`chip ${round10(req.fairFare * p.ratio) === fare ? 'on' : ''}`} onClick={() => setFare(round10(req.fairFare * p.ratio))}>
                <span className="key">{i + 1}</span>
                {p.label}
                <b>{baht(round10(req.fairFare * p.ratio))}</b>
              </button>
            ))}
          </div>
          <div className="fare-picker">
            <button className="btn round" onClick={() => setFare((f) => Math.max(0, f - 10))} aria-label="฿10 less">
              −
            </button>
            <div className="fare-value">
              {baht(fare)}
              <span className="mood" title="How the passenger feels about it">
                {mood}
              </span>
            </div>
            <button className="btn round" onClick={() => setFare((f) => f + 10)} aria-label="฿10 more">
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
          {!sheet && (
            <p className="hint">
              Overcharging earns more today but costs you stars; honest fares bring passengers back. Late at night, tourists
              accept more.
            </p>
          )}
          <div className="row">
            <button className="btn primary big" onClick={offer}>
              {countered ? 'Final offer' : 'Quote'} {baht(fare)}
            </button>
            <button className="btn ghost" onClick={decline}>
              Decline ride
            </button>
          </div>
          <div className="keys small">
            <kbd>1</kbd>–<kbd>{presets.length}</kbd> price · <kbd>←</kbd>
            <kbd>→</kbd> ฿10 · <kbd>Enter</kbd> quote · <kbd>Esc</kbd> decline
          </div>
        </>
      )}
    </div>
  );

  return sheet ? <div className="haggle-sheet">{body}</div> : <div className="modal-backdrop">{body}</div>;
}
