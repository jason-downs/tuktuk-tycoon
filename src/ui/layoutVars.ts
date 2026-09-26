// The top bar wraps onto two or three rows as the window narrows (and as its
// content grows), the Drive-mode GPS line comes and goes, and on phones the
// card sheet grows from the bottom, so overlays placed around them read their
// measured sizes from CSS variables on .app: --topbar-bottom (px from the top
// of .app to the bar's bottom edge), --gps-h (the GPS line's height, 0 when it
// is not shown), --sheet-h (the card stack's height) and --coach-h.
//
// --coach-h is the room the tutorial card takes under the top bar on narrow
// screens, where it spans the width just under the bar (tutorial/coachPlacement.ts).
// Tucked away (collapsed) it is only its title, and the GPS line, badge,
// minimap, notices and panel under the bar move down by its height so it hides
// none of them. Open, it is too tall for them all to fit above the touch pad
// and the card sheet on a phone, so it is 0 and the card covers them until it
// is tucked away.

import { useLayoutEffect, type RefObject } from 'react';
import { FLOOR_GAP } from './tutorial/coachPlacement';

/** Keep --topbar-bottom, --gps-h, --sheet-h and --coach-h on the .app element up to date. */
export function useHudLayoutVars(appRef: RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const app = appRef.current;
    if (!app) return;
    const watched = new WeakSet<Element>();
    const measure = () => {
      const bar = app.querySelector<HTMLElement>(':scope > .topbar');
      const gps = app.querySelector<HTMLElement>(':scope > .gps-hud');
      const sheet = app.querySelector<HTMLElement>(':scope > .left-stack');
      // Expanding, collapsing and docking the card all change its size, which the observer sees.
      const coach = app.querySelector<HTMLElement>(':scope > .coach');
      for (const el of [bar, gps, sheet, coach]) {
        if (el && !watched.has(el)) {
          watched.add(el);
          sizes.observe(el);
        }
      }
      const barBottom = bar ? bar.offsetTop + bar.offsetHeight : 64;
      const tucked = coach && coach.classList.contains('coach-mobile') && coach.classList.contains('coach-collapsed');
      app.style.setProperty('--topbar-bottom', `${barBottom}px`);
      app.style.setProperty('--gps-h', `${gps ? gps.offsetHeight : 0}px`);
      app.style.setProperty('--sheet-h', `${sheet ? sheet.offsetHeight : 0}px`);
      // The docked card sits FLOOR_GAP under the bar (it may not have moved there yet when the bar resizes).
      app.style.setProperty('--coach-h', `${tucked ? FLOOR_GAP + coach.offsetHeight : 0}px`);
    };
    const sizes = new ResizeObserver(measure);
    // Overlays such as the GPS line mount and unmount as direct children of .app.
    const children = new MutationObserver(measure);
    children.observe(app, { childList: true });
    measure();
    return () => {
      sizes.disconnect();
      children.disconnect();
    };
  }, [appRef]);
}
