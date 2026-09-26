// Where Lung Daeng's coach card goes (TutorialCoach.tsx): beside the UI the
// current step is about, clear of that UI and of the HUD it must not hide
// (the GPS line, the world badge). Pure geometry in CSS pixels, so it can be
// tested without a browser.

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where the card sits and which way its pointer faces. */
export interface Placement {
  left: number;
  top: number;
  /** 'left': the anchor is to the card's left; 'up': above it; 'down': below it. */
  arrow: 'left' | 'up' | 'down' | 'none';
  /** Pointer offset along the card edge, px. */
  arrowAt: number;
  mobile: boolean;
}

export interface CoachLayout {
  /** Viewport size. */
  vw: number;
  vh: number;
  /** The card's size. */
  w: number;
  h: number;
  /** Highest the card may sit: just under the top bar. */
  floor: number;
  /** The UI the step is about, or null for a free-standing card. */
  anchor: Rect | null;
  /** The step asks for the card under its anchor. */
  below: boolean;
  /** Right edge of the card stack, where a free-standing card goes. */
  stackRight: number;
  /** HUD the card should not cover. */
  avoid: Rect[];
}

export const GAP = 14;
/** Below this viewport width the card spans the screen under the top bar. */
export const MOBILE_WIDTH = 700;
/** Edge margin, px. */
const EDGE = 8;
/** Covering the step's own UI (its buttons) counts this many times over covering the HUD. */
const ANCHOR_WEIGHT = 3;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

export function samePlacement(a: Placement | null, b: Placement): boolean {
  return !!a && a.arrow === b.arrow && a.mobile === b.mobile && Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.arrowAt - b.arrowAt) < 1;
}

/**
 * Place the card. With an anchor it tries, in order: to the anchor's right,
 * below it and above it, each also slid down or up past whatever HUD it would
 * cover. It takes the first spot that covers nothing, or else the one that
 * covers least (the anchor weighs most, so the step's own buttons stay clear).
 */
export function placeCoach(l: CoachLayout): Placement {
  const { vw, vh, w, h, floor } = l;
  if (vw < MOBILE_WIDTH) return { left: EDGE, top: floor, arrow: 'none', arrowAt: 0, mobile: true };
  const lowest = Math.max(floor, vh - h - EDGE);
  const fit = (top: number) => clamp(top, floor, lowest);
  const r = l.anchor;
  const blockers = [...l.avoid, ...(r ? [r] : [])];
  // Spots the card can slide to: just under or just over each blocker.
  const slides = (top: number) => [top, ...blockers.flatMap((b) => [fit(b.bottom + GAP), fit(b.top - GAP - h)])];

  const candidates: Placement[] = [];
  if (!r) {
    for (const top of slides(floor)) candidates.push({ left: l.stackRight + GAP, top, arrow: 'none', arrowAt: 0, mobile: false });
  } else {
    if (!l.below && r.right + GAP + w <= vw - EDGE) {
      for (const top of slides(fit(r.top))) {
        // The pointer shows only while the card is level with some of the anchor.
        const level = top < r.bottom && top + h > r.top;
        candidates.push({ left: r.right + GAP, top, arrow: level ? 'left' : 'none', arrowAt: clamp(r.top + 22 - top, 14, h - 20), mobile: false });
      }
    }
    const left = clamp((r.left + r.right) / 2 - w / 2, EDGE, vw - w - EDGE);
    const arrowAt = clamp((r.left + r.right) / 2 - left, 18, w - 18);
    // The pointer shows only while the card sits just under or just over the anchor.
    const pointer = (top: number): Placement['arrow'] => {
      const under = top - r.bottom;
      const over = r.top - (top + h);
      return under >= 0 && under <= 2 * GAP ? 'up' : over >= 0 && over <= 2 * GAP ? 'down' : 'none';
    };
    const tops: number[] = [];
    if (l.below || r.bottom + GAP + h <= vh - EDGE) tops.push(...slides(fit(r.bottom + GAP)));
    if (!l.below) tops.push(...slides(fit(r.top - GAP - h)));
    for (const top of tops) candidates.push({ left, top, arrow: pointer(top), arrowAt, mobile: false });
  }

  let best = candidates[0];
  let bestCost = Infinity;
  for (const c of candidates) {
    const box = { left: c.left, top: c.top, right: c.left + w, bottom: c.top + h };
    let cost = 0;
    for (const a of l.avoid) cost += overlap(box, a);
    if (r) cost += ANCHOR_WEIGHT * overlap(box, r);
    if (cost < bestCost) {
      best = c;
      bestCost = cost;
      if (cost === 0) break;
    }
  }
  return best;
}
