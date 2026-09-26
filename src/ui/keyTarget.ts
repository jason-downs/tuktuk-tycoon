// Where game keys land. Browser extensions that bind single letter keys
// (Vimium, Vimium C, Surfingkeys and the like) handle those keys before the
// page sees them, except while an editable element has focus, since the
// player could be typing there. So while a game runs, keyboard focus rests on
// a hidden editable element whenever no other control needs it: the
// extensions let every key through, and the game's key handlers read keys
// there as game keys (isKeyTarget). Text fields, selects and controls reached
// by keyboard navigation (focusNav.ts) keep the focus they are given; a button,
// checkbox or slider that a mouse press focused hands it back.
//
// Esc is the one key those extensions keep while an editable element has
// focus: they swallow it and blur the element instead. A blur that no pointer
// press, window switch, focus move or Esc the page itself received explains is
// that Esc, so the game gets an Esc of its own, dispatched on window, and the
// element takes the focus back.

import { focusNavActive } from './focusNav';

const ATTR = 'data-game-keys';
/** Real milliseconds between checks that the focus has not fallen back to the page itself (a focused control removed). */
const CHECK_MS = 400;
/** A pointer press or a real Esc this recent (ms) explains a blur of the key target. */
const RECENT_MS = 300;

/** Whether an event target is the element game keys land on. */
export function isKeyTarget(el: unknown): boolean {
  const e = el as Partial<Element> | null;
  return typeof e?.hasAttribute === 'function' && e.hasAttribute(ATTR);
}

/** Input types a pointer press focuses without the player going on to type or pick in them. */
const PRESS_INPUTS: ReadonlySet<string> = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

/** Whether a control keeps the focus a pointer press gave it: typing goes into it (a text field) or the press opened it (a select). */
export function keepsFocusAfterPointer(el: { tagName: string; isContentEditable?: boolean; type?: string }): boolean {
  if (isKeyTarget(el)) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && !PRESS_INPUTS.has(el.type ?? 'text');
}

/**
 * Whether a blur of the key target was an extension swallowing Esc: the page still has focus, nothing else took it,
 * and neither a pointer press nor an Esc the page received in the last RECENT_MS explains the blur (sincePointer,
 * sinceEsc: ms since each).
 */
export function blurMeansEscape(s: { pageFocused: boolean; focusFree: boolean; sincePointer: number; sinceEsc: number }): boolean {
  return s.pageFocused && s.focusFree && s.sincePointer >= RECENT_MS && s.sinceEsc >= RECENT_MS;
}

/** Put the hidden key target in the page and keep keyboard focus on it while nothing else needs it. Returns the uninstaller. */
export function installKeyTarget(): () => void {
  // Touch-only devices: a focused editable element would raise the on-screen keyboard, and there are no key-binding extensions.
  if (!window.matchMedia('(any-pointer: fine)').matches) return () => {};
  const el = document.createElement('div');
  el.setAttribute(ATTR, '');
  el.contentEditable = 'true';
  el.tabIndex = -1;
  el.spellcheck = false;
  el.setAttribute('inputmode', 'none');
  el.setAttribute('aria-label', 'Game keys');
  el.className = 'key-target';
  document.body.appendChild(el);

  const idle = (a: Element | null) => a === null || a === document.body || a === document.documentElement;
  // Set while the element takes focus, so a blur that comes from inside that call is not read as Esc.
  let focusing = false;
  // Focus did not stay on the element (something, such as an extension, moved it straight away): stop trying until the next mouse press.
  let refused = false;
  const take = () => {
    if (refused) return;
    focusing = true;
    el.focus({ preventScroll: true });
    focusing = false;
    if (document.activeElement !== el) refused = true;
  };
  const claim = () => {
    if (document.hasFocus() && idle(document.activeElement)) take();
  };
  // A mouse press that focused a button, checkbox or slider: the press has done its work, so the keys come back here.
  // Touch presses leave the focus alone, so no on-screen keyboard comes up.
  const afterPointer = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    refused = false;
    setTimeout(() => {
      const a = document.activeElement;
      if (idle(a) || (a && !isKeyTarget(a) && !keepsFocusAfterPointer(a) && !focusNavActive())) take();
    }, 0);
  };
  // Keys that would type into the element or open the system's press-and-hold accent menu do nothing there; the game's own listeners still see them.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.key === 'Tab' || e.key === 'Escape') return;
    if (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete' || e.key.startsWith('Arrow')) e.preventDefault();
  };
  const noInput = (e: Event) => e.preventDefault();
  // Text an input method composes gets past the keydown and lands in the element; it is cleared.
  const onInput = () => {
    if (el.textContent) el.textContent = '';
  };
  const onFocusOut = () => setTimeout(claim, 0);
  const timer = setInterval(claim, CHECK_MS);

  // Time of the last pointer press and of the last Esc the page itself received.
  let pointerAt = -Infinity;
  let escAt = -Infinity;
  const onPointerDown = () => (pointerAt = performance.now());
  const onWindowKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && e.isTrusted) escAt = performance.now();
  };
  let removed = false;
  const onBlur = (e: FocusEvent) => {
    if (removed || focusing || e.relatedTarget !== null) return;
    setTimeout(() => {
      const now = performance.now();
      const a = document.activeElement;
      // The periodic check may already have taken the focus back.
      const focusFree = idle(a) || a === el;
      if (removed || !blurMeansEscape({ pageFocused: document.hasFocus(), focusFree, sincePointer: now - pointerAt, sinceEsc: now - escAt })) return;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
      claim();
    }, 0);
  };

  el.addEventListener('keydown', onKeyDown);
  el.addEventListener('blur', onBlur);
  el.addEventListener('beforeinput', noInput);
  el.addEventListener('input', onInput);
  el.addEventListener('paste', noInput);
  el.addEventListener('drop', noInput);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointerup', afterPointer, true);
  window.addEventListener('keydown', onWindowKey, true);
  window.addEventListener('focus', claim);
  document.addEventListener('focusout', onFocusOut);
  claim();
  return () => {
    removed = true;
    clearInterval(timer);
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('pointerup', afterPointer, true);
    window.removeEventListener('keydown', onWindowKey, true);
    window.removeEventListener('focus', claim);
    document.removeEventListener('focusout', onFocusOut);
    el.remove();
  };
}
