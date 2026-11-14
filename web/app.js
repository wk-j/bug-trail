// Entry point: routing and live reload. Pages are composed from /ui components.
import { store } from '/lib/store.js';
import { renderList } from '/pages/list.js';
import { renderTrail, closeClipboard } from '/pages/trail.js';

const app = document.getElementById('app');
const live = document.getElementById('live');

async function route() {
  // #/t/<trail> or #/t/<trail>/<step>: a link can point at one step of a trail.
  const m = location.hash.match(/^#\/t\/([^/]+)(?:\/(.+))?$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const step = m[2] ? decodeURIComponent(m[2]) : null;
    if (store.view?.id !== id) store.view = { id, selected: step, caseIdx: 0 };
    else if (step) store.view.selected = step;
    await renderTrail(app, true);
  } else {
    store.view = null;
    store.trail = null;
    closeClipboard();
    await renderList(app);
  }
}

window.addEventListener('hashchange', () => { window.scrollTo(0, 0); route(); });

const events = new EventSource('/events');
events.onopen = () => live.classList.add('on');
events.onerror = () => live.classList.remove('on');
events.onmessage = (e) => {
  const { id } = JSON.parse(e.data);
  if (!store.view) renderList(app);
  else if (store.view.id === id) renderTrail(app, false);
};

route();
