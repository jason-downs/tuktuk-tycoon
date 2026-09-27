// Tooltips for the game's controls. Any element with a title shows it in a
// game-styled tooltip: once the mouse has rested on it for SHOW_MS, straight
// away while another tooltip is showing or hid less than WARM_MS ago, and when
// a control is reached by keyboard navigation (focusNav.ts). The browser's
// own, slower tooltip is kept away by moving the title into data-tip whenever
// the element is pointed at or reached by keyboard, and again whenever React
// writes the title back. The text stays in the accessibility tree: as the
// aria-label of a control with no name of its own (an icon), else as its
// aria-description when it differs from the name.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { focusNavActive } from './focusNav';
import type { OverlayProps } from './overlays';

/** Milliseconds the mouse rests on a control before its tooltip shows. */
export const SHOW_MS = 500;
/** For this long (ms) after a tooltip hides, the next one shows without waiting. */
const WARM_MS = 400;
/** Gap (px) between the tooltip and its control. */
const GAP = 8;
/** Margin (px) kept from the window's edges. */
const EDGE = 8;
/** The arrow's centre stays at least this far (px) from the tooltip's left and right edges. */
const ARROW_INSET = 12;

export interface TipRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TipPlacement {
  left: number;
  top: number;
  /** The tooltip hangs below the control (else above it). */
  below: boolean;
  /** Where the arrow meets the tooltip's edge, px from its left. */
  arrowAt: number;
}

/**
 * Where a w×h tooltip goes: centred on its control, below it unless only above has room; kept inside the window
 * horizontally, with the arrow on the control's centre.
 */
export function placeTip(anchor: TipRect, w: number, h: number, vw: number, vh: number): TipPlacement {
  const below = anchor.bottom + GAP + h <= vh - EDGE || anchor.top - GAP - h < EDGE;
  const mid = (anchor.left + anchor.right) / 2;
  const left = Math.min(Math.max(mid - w / 2, EDGE), Math.max(EDGE, vw - EDGE - w));
  const arrowAt = Math.min(Math.max(mid - left, ARROW_INSET), Math.max(ARROW_INSET, w - ARROW_INSET));
  return { left, top: below ? anchor.bottom + GAP : anchor.top - GAP - h, below, arrowAt };
}

/** The tooltip text of an element, taking its title over (see the file comment). */
function takeTitle(el: HTMLElement): string {
  const title = el.getAttribute('title');
  if (title !== null) {
    el.removeAttribute('title');
    el.dataset.tip = title;
    // data-tip-label marks an aria-label this layer gave an icon, so a changed title updates it.
    const named = el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') || /\p{L}{2}/u.test(el.innerText ?? '');
    if (el.dataset.tipLabel || !named) {
      el.dataset.tipLabel = '1';
      el.setAttribute('aria-label', title);
    } else if (el.getAttribute('aria-label') !== title) {
      el.setAttribute('aria-description', title);
    }
  }
  return el.dataset.tip ?? '';
}

/**
 * The nearest element at or containing a target with a title or data-tip, or null when its text is empty (an empty
 * title hides an ancestor's tooltip, as in the browser).
 */
function tipped(target: EventTarget | null): HTMLElement | null {
  const el = target instanceof Element ? target.closest<HTMLElement>('[title], [data-tip]') : null;
  return el && (el.getAttribute('title') || el.dataset.tip) ? el : null;
}

interface Tip {
  text: string;
  anchor: TipRect;
}

/** The tooltip layer, drawn above the rest of the UI. */
export function Tooltips(_: OverlayProps) {
  const [tip, setTip] = useState<Tip | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let target: HTMLElement | null = null;
    /** The tooltip of `target` is showing (else it is waiting out SHOW_MS). */
    let visible = false;
    let timer = 0;
    let hiddenAt = -Infinity;
    // A press on a control hides its tooltip until the mouse leaves it.
    let pressed: HTMLElement | null = null;
    const watch = new MutationObserver(() => {
      if (!target) return;
      takeTitle(target);
      if (visible) show(target);
    });
    const place = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const show = (el: HTMLElement) => {
      const text = takeTitle(el);
      if (!text || !el.isConnected) return hide();
      visible = true;
      setTip({ text, anchor: place(el) });
    };
    const hide = () => {
      window.clearTimeout(timer);
      watch.disconnect();
      if (visible) hiddenAt = performance.now();
      visible = false;
      target = null;
      setTip(null);
    };
    const aim = (el: HTMLElement, wait: number) => {
      if (el === target) return;
      const warm = visible || performance.now() - hiddenAt < WARM_MS;
      hide();
      target = el;
      takeTitle(el);
      // When the title prop changes, React writes the title attribute back: the observer takes it over again and
      // updates the tooltip's text if it is showing.
      watch.observe(el, { attributes: true, attributeFilter: ['title'] });
      if (warm || wait === 0) show(el);
      else timer = window.setTimeout(() => target === el && show(el), wait);
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const el = tipped(e.target);
      if (el && el === pressed) return;
      pressed = null;
      if (el) aim(el, SHOW_MS);
      else if (target) hide();
    };
    const onLeave = (e: PointerEvent) => {
      if (!e.relatedTarget) {
        pressed = null;
        if (target) hide();
      }
    };
    const onDown = () => {
      pressed = target;
      if (target) hide();
    };
    const onFocus = (e: FocusEvent) => {
      const el = tipped(e.target);
      if (el && focusNavActive()) aim(el, 0);
    };
    const onBlur = (e: FocusEvent) => {
      if (target && e.target === target) hide();
    };
    const onKey = (e: KeyboardEvent) => {
      // Any key but Tab and Shift hides the tooltip. Those two drive keyboard navigation (focusNav.ts), where
      // focusout hides this tooltip and focusin shows the next control's.
      if (target && e.key !== 'Tab' && e.key !== 'Shift') hide();
    };
    // A control that moves or goes away takes its tooltip with it (checked every 250 ms).
    const follow = window.setInterval(() => {
      if (!target || !visible) return;
      if (!target.isConnected) hide();
      else setTip((t) => (t ? { ...t, anchor: place(target!) } : t));
    }, 250);

    window.addEventListener('pointerover', onOver, true);
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('focusin', onFocus);
    window.addEventListener('focusout', onBlur);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', hide, { capture: true, passive: true });
    window.addEventListener('blur', hide);
    return () => {
      window.clearInterval(follow);
      hide();
      window.removeEventListener('pointerover', onOver, true);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('focusin', onFocus);
      window.removeEventListener('focusout', onBlur);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) return;
    const p = placeTip(tip.anchor, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight);
    el.style.left = `${p.left}px`;
    el.style.top = `${p.top}px`;
    el.style.setProperty('--arrow-at', `${p.arrowAt}px`);
    el.classList.toggle('above', !p.below);
    el.classList.add('placed');
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={ref} className="tooltip" aria-hidden>
      {tip.text}
    </div>
  );
}
