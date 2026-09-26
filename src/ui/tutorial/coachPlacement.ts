// Where Lung Daeng's coach card goes (TutorialCoach.tsx): beside the UI the
// current step is about and pointing at it, clear of that UI, of the controls
// the player presses and of the HUD (the GPS line, which it must not hide while
// the player drives, and the world badge). Pure geometry in CSS pixels, so it
// can be tested without a browser.

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** UI the card should not cover. */
export interface Obstacle extends Rect {
  /**
   * What covering one px² of it costs: 1 for a readout (the default), CONTROL_WEIGHT for controls the player presses,
   * KEEP_CLEAR for the HUD the card must not hide.
   */
  weight?: number;
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
  /** UI the card should not cover. */
  avoid: Obstacle[];
}

export const GAP = 14;
/** The card keeps this far (px) under the top bar; `floor` is the bar's bottom edge plus this. */
export const FLOOR_GAP = 8;
/**
 * Below this viewport width the card spans the screen just under the top bar.
 * The HUD under the bar makes room for it when it is tucked away (--coach-h, layoutVars.ts).
 */
export const MOBILE_WIDTH = 700;
/** Covering the step's own UI or a control counts this many times over covering a readout. */
export const CONTROL_WEIGHT = 3;
/**
 * The cost per px² of covering what the card must not hide (the GPS line while the player drives): more than any
 * spot that keeps it clear costs, so the card covers it only when every spot would.
 */
export const KEEP_CLEAR = 1_000_000;
/** Edge margin, px. */
const EDGE = 8;
/** The pointer stays this far (px) from the card's corners. */
const ARROW_INSET = 18;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Whether a card spanning the screen under the top bar (narrow screens) reaches
 * down over the touch pad: an open card can be too tall to end above it on a
 * short phone, or once the pad rises above a tall card sheet. Anywhere else,
 * placeCoach weighs the pad as an obstacle.
 */
export function dockedOverPad(p: Placement, h: number, pad: Rect | null): boolean {
  return p.mobile && !!pad && pad.bottom > pad.top && p.top < pad.bottom && p.top + h > pad.top;
}

export function samePlacement(a: Placement | null, b: Placement): boolean {
  return !!a && a.arrow === b.arrow && a.mobile === b.mobile && Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.arrowAt - b.arrowAt) < 1;
}

/**
 * Place the card. With an anchor it tries, in order: to the anchor's right,
 * below it and above it. Each spot is also tried slid down or up past whatever
 * it would cover; below and above, also slid sideways as far as the pointer
 * can still reach the anchor. It takes the spot that costs least: covering
 * readouts, three times that for the anchor and controls, and half the card's
 * area for a card whose pointer no longer reaches its anchor, so a card stays
 * on its anchor unless that covers a lot; any spot that covers what it must not
 * hide (KEEP_CLEAR) costs more than any spot that keeps it clear. Ties go to the
 * earlier, less moved spot.
 */
export function placeCoach(l: CoachLayout): Placement {
  const { vw, vh, w, h, floor } = l;
  if (vw < MOBILE_WIDTH) return { left: EDGE, top: floor, arrow: 'none', arrowAt: 0, mobile: true };
  const lowest = Math.max(floor, vh - h - EDGE);
  const fit = (top: number) => clamp(top, floor, lowest);
  const r = l.anchor;
  const blockers: Rect[] = [...l.avoid, ...(r ? [r] : [])];
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
    const mid = (r.left + r.right) / 2;
    // Sideways, the card may go as far as keeps the pointer on the anchor's middle.
    const minLeft = Math.max(EDGE, Math.min(mid - w + ARROW_INSET, vw - w - EDGE));
    const maxLeft = Math.max(minLeft, Math.min(vw - w - EDGE, mid - ARROW_INSET));
    const centred = clamp(mid - w / 2, minLeft, maxLeft);
    const lefts = [centred, ...blockers.flatMap((b) => [b.right + GAP, b.left - GAP - w]).map((x) => clamp(x, minLeft, maxLeft))]
      .filter((x, i, all) => all.findIndex((y) => Math.abs(y - x) < 1) === i)
      .sort((a, b) => Math.abs(a - centred) - Math.abs(b - centred));
    // The pointer shows only while the card sits just under or just over the
    // anchor: at most a gap further than the nearest spot the card may take
    // (under a button in the top bar, that is the floor).
    const under = fit(r.bottom + GAP);
    const over = fit(r.top - GAP - h);
    const pointer = (top: number): Placement['arrow'] => {
      if (top >= r.bottom && top <= Math.max(r.bottom, under) + GAP) return 'up';
      if (top + h <= r.top && top >= Math.min(r.top - h, over) - GAP) return 'down';
      return 'none';
    };
    const tops: number[] = [];
    if (l.below || r.bottom + GAP + h <= vh - EDGE) tops.push(...slides(under));
    if (!l.below) tops.push(...slides(over));
    for (const top of tops) {
      for (const left of lefts) candidates.push({ left, top, arrow: pointer(top), arrowAt: clamp(mid - left, ARROW_INSET, w - ARROW_INSET), mobile: false });
    }
  }

  const detached = r ? (w * h) / 2 : 0;
  let best = candidates[0];
  let bestCost = Infinity;
  for (const c of candidates) {
    const box = { left: c.left, top: c.top, right: c.left + w, bottom: c.top + h };
    let cost = c.arrow === 'none' ? detached : 0;
    for (const a of l.avoid) cost += (a.weight ?? 1) * overlap(box, a);
    if (r) cost += CONTROL_WEIGHT * overlap(box, r);
    if (cost < bestCost) {
      best = c;
      bestCost = cost;
      if (cost === 0) break;
    }
  }
  return best;
}
