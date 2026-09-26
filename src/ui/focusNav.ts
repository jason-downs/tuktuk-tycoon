// Keyboard focus navigation. Tab is the game's mode key, so focus moves with
// Shift+Tab (and with Tab inside the haggle sheet, which takes the keyboard).
// Once a Tab keypress has moved focus, Tab and Shift+Tab keep moving it, and
// Enter and Space work the focused control and are not game keys. A
// pointer press anywhere, or Esc, hands those keys back to the game. A control
// focused by a mouse click does not count, so Tab and Enter stay game keys
// for mouse players.

import { isKeyTarget } from './keyTarget';

/** A focus change this soon (ms) after a Tab keypress the game left alone is keyboard navigation. */
const TAB_FOCUS_MS = 1000;

/** The last Tab keypress (its event, to see afterwards whether the game used it) and when it came. */
let lastTab: { e: { defaultPrevented: boolean }; at: number } | null = null;
/** Keyboard focus navigation is on. */
let active = false;

/** A key went down (called in the capture phase, before any game key handler). */
export function noteKeyDown(e: { key: string; defaultPrevented: boolean }, now: number): void {
  if (e.key === 'Tab') {
    lastTab = { e, at: now };
    return;
  }
  if (e.key === 'Shift') return;
  lastTab = null;
  if (e.key === 'Escape') active = false;
}

/** Focus moved onto an element. It is keyboard navigation when a Tab the game did not use as its mode key moved it. */
export function noteFocusIn(now: number): void {
  if (lastTab && !lastTab.e.defaultPrevented && now - lastTab.at <= TAB_FOCUS_MS) active = true;
  lastTab = null;
}

/** A pointer press ends keyboard navigation. */
export function notePointerDown(): void {
  lastTab = null;
  active = false;
}

/** A Tab keypress has moved focus, and no pointer press or Esc has ended keyboard navigation since. */
export function focusNavActive(): boolean {
  return active;
}

/** The key lands on a control the player reached with the keyboard, so Enter and Space belong to that control. */
export function onFocusedControl(e: { target: EventTarget | null }): boolean {
  const el = e.target as { tagName?: string } | null;
  return active && !!el && typeof el.tagName === 'string' && el.tagName !== 'BODY' && el.tagName !== 'HTML' && !isKeyTarget(e.target);
}

/** Listen for the events that start and end keyboard navigation. Returns the uninstaller. */
export function installFocusNav(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    // Esc leaves keyboard navigation: the focused control lets go of the keys too.
    if (e.key === 'Escape' && active && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    noteKeyDown(e, performance.now());
  };
  const onFocusIn = () => noteFocusIn(performance.now());
  // Capture phase, so dialogs that stop key events (the haggle) cannot hide them.
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('focusin', onFocusIn, true);
  window.addEventListener('pointerdown', notePointerDown, true);
  return () => {
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('focusin', onFocusIn, true);
    window.removeEventListener('pointerdown', notePointerDown, true);
  };
}
