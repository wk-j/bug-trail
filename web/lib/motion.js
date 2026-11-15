// How the page changes: page changes and live redraws go through the View Transitions API where
// the browser has it, so the old page crossfades into the new one; elsewhere the DOM is swapped
// as before. Components animate themselves in while the root carries data-enter (see ui/*.css),
// which is set only when a page is opened, so a live redraw doesn't replay their entrances.
// Timings, easings and the reduced-motion fallback are tokens in ui/tokens.css.

const root = document.documentElement;
const ENTER_MS = 1400; // longer than the slowest staggered entrance (board yarn)
let enterTimer = 0;

/** Let components play their entrance for the next moment. */
export function enter() {
  root.dataset.enter = '';
  clearTimeout(enterTimer);
  enterTimer = setTimeout(() => { delete root.dataset.enter; }, ENTER_MS);
}

/** Stop entrances at once (e.g. a redraw while one is still playing). */
export function settle() {
  clearTimeout(enterTimer);
  delete root.dataset.enter;
}

function swap(kind, update) {
  if (!document.startViewTransition || document.visibilityState !== 'visible') {
    update();
    return Promise.resolve();
  }
  root.dataset.vt = kind;
  const t = document.startViewTransition(update);
  t.finished.finally(() => { if (root.dataset.vt === kind) delete root.dataset.vt; });
  t.ready.catch(() => {}); // a skipped transition is fine: the update still ran
  return t.updateCallbackDone;
}

/** Open a page: crossfade from the old one and let its components arrive. */
export const page = (update) => swap('page', () => { enter(); update(); });

/** Redraw the open page in place (live reload): a short crossfade, nothing arrives again. */
export const refresh = (update) => swap('refresh', () => { settle(); update(); });

/** How to scroll something into view: smoothly, unless reduced motion is asked for. */
export const scrollBehavior = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

/** Run a plain DOM swap (the default for pages rendered without a transition). */
export const now = (update) => { update(); return Promise.resolve(); };
