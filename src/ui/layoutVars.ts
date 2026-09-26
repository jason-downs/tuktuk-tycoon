// The top bar wraps onto two or three rows as the window narrows (and as its
// content grows), the Drive-mode GPS line comes and goes, and on phones the
// card sheet grows from the bottom, so overlays placed around them read their
// measured sizes from CSS variables on .app: --topbar-bottom (px from the top
// of .app to the bar's bottom edge), --gps-h (the GPS line's height, 0 when it
// is not shown) and --sheet-h (the card stack's height).

import { useLayoutEffect, type RefObject } from 'react';

/** Keep --topbar-bottom, --gps-h and --sheet-h on the .app element up to date. */
export function useHudLayoutVars(appRef: RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const app = appRef.current;
    if (!app) return;
    const watched = new WeakSet<Element>();
    const measure = () => {
      const bar = app.querySelector<HTMLElement>(':scope > .topbar');
      const gps = app.querySelector<HTMLElement>(':scope > .gps-hud');
      const sheet = app.querySelector<HTMLElement>(':scope > .left-stack');
      for (const el of [bar, gps, sheet]) {
        if (el && !watched.has(el)) {
          watched.add(el);
          sizes.observe(el);
        }
      }
      app.style.setProperty('--topbar-bottom', `${bar ? bar.offsetTop + bar.offsetHeight : 64}px`);
      app.style.setProperty('--gps-h', `${gps ? gps.offsetHeight : 0}px`);
      app.style.setProperty('--sheet-h', `${sheet ? sheet.offsetHeight : 0}px`);
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
