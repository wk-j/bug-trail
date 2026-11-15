// Entry point: routing and live reload. Pages are composed from /ui components; lib/motion.js
// decides how one page gives way to the next.
import { store } from '/lib/store.js';
import { page, refresh } from '/lib/motion.js';
import { renderList } from '/pages/list.js';
import { renderTrail, closeClipboard } from '/pages/trail.js';

const app = document.getElementById('app');
const live = document.getElementById('live');

// Opening a page: the old one fades out, the new one starts at the top and its parts arrive.
const open = (update) => page(() => { window.scrollTo(0, 0); update(); });

let current = 0;
// Only the latest route may put its page up (an earlier fetch can come back after a later one).
const latest = (n, commit) => (update) => commit(() => { if (n === current) update(); });

async function route() {
  const n = ++current;
  // #/t/<trail> or #/t/<trail>/<step>: a link can point at one step of a trail.
  const m = location.hash.match(/^#\/t\/([^/]+)(?:\/(.+))?$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const step = m[2] ? decodeURIComponent(m[2]) : null;
    const other = store.view?.id !== id;
    if (other) store.view = { id, selected: step, caseIdx: 0 };
    else if (step) store.view.selected = step;
    await renderTrail(app, { fresh: true, commit: latest(n, other ? open : refresh) });
  } else {
    store.view = null;
    store.trail = null;
    await renderList(app, { commit: latest(n, (update) => open(() => { closeClipboard(true); update(); })) });
  }
}

window.addEventListener('hashchange', route);

const events = new EventSource('/events');
events.onopen = () => live.classList.add('on');
events.onerror = () => live.classList.remove('on');
events.onmessage = (e) => {
  const { id } = JSON.parse(e.data);
  if (store.view && store.view.id !== id) return;
  live.classList.remove('is-blink');
  void live.offsetWidth; // restart the lamp's flicker
  live.classList.add('is-blink');
  if (!store.view) renderList(app, { commit: refresh });
  else renderTrail(app, { fresh: false, commit: refresh });
};

route();
