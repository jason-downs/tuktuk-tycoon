import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { COACH, PANEL_TOUR } from '../../content/tutorial';
import { BALANCE } from '../../sim/balance';
import { TUTORIAL_STEPS, stepIndex, tutorialSignal, tutorialState, type TutorialStep } from '../../sim/tutorial';
import type { OverlayProps } from '../overlays';
import { PANELS, type PanelDef } from '../panels';
import { GlossedText } from '../SpeechLine';
import { ui, useGame, useUI } from '../store';
import './coach.css';

/** Where the card sits and which way its pointer faces. */
interface Placement {
  left: number;
  top: number;
  /** 'left': the anchor is to the card's left; 'up': the anchor is above. */
  arrow: 'left' | 'up' | 'none';
  /** Pointer offset along the card edge, px. */
  arrowAt: number;
  mobile: boolean;
}

const GAP = 14;
const MOBILE_WIDTH = 700;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function samePlacement(a: Placement | null, b: Placement): boolean {
  return !!a && a.arrow === b.arrow && a.mobile === b.mobile && Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.arrowAt - b.arrowAt) < 1;
}

/**
 * Lung Daeng's coach card for a new game: a small, non-blocking card beside
 * the UI the current step is about, which it also highlights.
 */
export function TutorialCoach({ game }: OverlayProps) {
  const d = useGame(game, (g) => {
    const st = tutorialState(g);
    return {
      step: st.step,
      done: st.done,
      fare: st.fare,
      tip: st.tip,
      rating: st.rating,
      lost: st.lost,
      opened: st.opened.join(','),
      waiting: st.step === 'find' && !st.done ? g.visibleRequests().length : -1,
    };
  });
  const modalOpen = useUI((s) => s.modal !== null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Each new step opens the card again.
  useEffect(() => setCollapsed(false), [d.step]);

  // Switching mode and opening panels are UI actions the simulation cannot see.
  useEffect(() => {
    let prev = ui.get();
    return ui.subscribe(() => {
      const s = ui.get();
      if (s.mode !== prev.mode) tutorialSignal(game, { kind: 'mode', mode: s.mode });
      if (s.panel && s.panel !== prev.panel) tutorialSignal(game, { kind: 'panel', id: s.panel });
      prev = s;
    });
  }, [game]);

  useLayoutEffect(() => {
    if (d.done) return;
    const coach = COACH[d.step];
    let lit: Element | null = null;
    const update = () => {
      const card = cardRef.current;
      if (!card) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = card.offsetWidth;
      const h = card.offsetHeight;
      const floor = (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 60) + 8;
      const anchor = coach.anchor ? document.querySelector(coach.anchor) : null;
      let next: Placement;
      if (vw < MOBILE_WIDTH) {
        next = { left: 8, top: floor, arrow: 'none', arrowAt: 0, mobile: true };
      } else if (!anchor) {
        const stack = document.querySelector('.left-stack')?.getBoundingClientRect();
        next = { left: (stack?.right ?? 10) + GAP, top: floor, arrow: 'none', arrowAt: 0, mobile: false };
      } else {
        const r = anchor.getBoundingClientRect();
        if (!coach.below && r.right + GAP + w <= vw - 8) {
          const top = clamp(r.top, floor, vh - h - 8);
          next = { left: r.right + GAP, top, arrow: 'left', arrowAt: clamp(r.top + 22 - top, 14, h - 20), mobile: false };
        } else {
          const left = clamp(r.left + r.width / 2 - w / 2, 8, vw - w - 8);
          next = { left, top: clamp(r.bottom + GAP, 8, vh - h - 8), arrow: 'up', arrowAt: clamp(r.left + r.width / 2 - left, 18, w - 18), mobile: false };
        }
      }
      setPlace((p) => (samePlacement(p, next) ? p : next));
      const target = document.querySelector(coach.highlight ?? coach.anchor ?? '.no-coach-target');
      if (target !== lit) {
        lit?.classList.remove('coach-target');
        target?.classList.add('coach-target');
        lit = target;
      } else if (target && !target.classList.contains('coach-target')) {
        target.classList.add('coach-target');
      }
    };
    update();
    const timer = window.setInterval(update, 250);
    window.addEventListener('resize', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', update);
      lit?.classList.remove('coach-target');
    };
  }, [d.step, d.done, collapsed]);

  // Help and other modal dialogs cover the game; the coach waits until they close.
  if (d.done || modalOpen) return null;
  const coach = COACH[d.step];
  const fill = (text: string) =>
    text
      .replace('{rent}', String(BALANCE.startRentPerDay))
      .replace('{fare}', String(d.fare))
      .replace('{tip}', d.tip > 0 ? ` plus a ฿${d.tip} tip` : '')
      .replace('{rating}', d.rating.toFixed(1));
  const body = coach.body.map(fill);
  if (d.step === 'find' && d.lost && coach.lost) body.unshift(coach.lost);
  const opened = d.opened ? d.opened.split(',') : [];
  const tour = PANEL_TOUR.flatMap((t) => {
    const def = PANELS.find((p) => p.id === t.id);
    return def ? [{ ...t, def }] : [];
  });
  const style = !place ? { visibility: 'hidden' as const } : place.mobile ? { top: place.top } : { left: place.left, top: place.top };

  return (
    <div
      ref={cardRef}
      className={`coach ${place?.mobile ? 'coach-mobile' : ''} ${collapsed ? 'coach-collapsed' : ''} coach-arrow-${place?.arrow ?? 'none'}`}
      style={{ ...style, ['--arrow-at' as string]: `${place?.arrowAt ?? 0}px` }}
      role="dialog"
      aria-label={`Tutorial: ${coach.title}`}
    >
      <div className="coach-head">
        <div className="coach-avatar" aria-hidden>
          👴
        </div>
        <div className="coach-titles">
          <div className="eyebrow">
            Lung Daeng · {stepIndex(d.step) + 1} of {TUTORIAL_STEPS.length}
          </div>
          <div className="coach-title">{coach.title}</div>
        </div>
        <div className="coach-tools">
          <button
            className="btn tiny ghost"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Show Lung Daeng’s tip' : 'Tuck the tip away'}
            aria-label={collapsed ? 'Expand tutorial card' : 'Collapse tutorial card'}
            aria-expanded={!collapsed}
          >
            {collapsed ? '▾' : '▴'}
          </button>
          <button className="btn tiny ghost" onClick={() => tutorialSignal(game, { kind: 'skip' })} title="Skip the tutorial (replay it from Help)">
            Skip
          </button>
        </div>
      </div>
      {!collapsed && (
        <CoachBody
          game={game}
          body={body}
          step={d.step}
          waiting={d.waiting}
          opened={opened}
          tour={tour}
          action={coach.action}
          waitFor={coach.waitFor}
        />
      )}
    </div>
  );
}

interface CoachBodyProps {
  game: OverlayProps['game'];
  body: string[];
  step: TutorialStep;
  /** Passengers the player can see, during the 'select' step (−1 otherwise). */
  waiting: number;
  opened: string[];
  tour: { id: string; blurb: string; def: PanelDef }[];
  action?: string;
  waitFor?: string;
}

/** The card's text, the panel tour and the footer with progress and the next button. */
function CoachBody({ game, body, step, waiting, opened, tour, action, waitFor }: CoachBodyProps) {
  const at = stepIndex(step);
  return (
    <>
      {body.map((p, i) => (
        <p key={i} className="coach-text">
          <GlossedText text={p} />
        </p>
      ))}
      {waiting === 0 && <p className="hint">Nobody waving yet? Give it a moment — the clock runs at 1× while you wait.</p>}
      {step === 'panels' && (
        <ul className="coach-panels">
          {tour.map(({ id, blurb, def }) => {
            const seen = opened.includes(id);
            return (
              <li key={id}>
                <button className={`btn tiny ${seen ? 'on' : ''}`} onClick={() => ui.set({ panel: id })}>
                  {def.icon} {def.title}
                  {seen ? ' ✓' : ''}
                </button>
                <span className="small muted">{blurb}</span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="coach-foot">
        <div className="coach-dots" aria-hidden>
          {TUTORIAL_STEPS.map((s, i) => (
            <span key={s} className={i < at ? 'done' : i === at ? 'now' : ''} />
          ))}
        </div>
        {action ? (
          <button className="btn primary" onClick={() => tutorialSignal(game, { kind: 'next' })}>
            {action}
          </button>
        ) : (
          <span className="coach-wait small">{waitFor}</span>
        )}
      </div>
    </>
  );
}
