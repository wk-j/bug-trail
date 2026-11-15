/**
 * A clipboard that slides in from the right: a hardboard back, a metal clip, a sheet of paper.
 * mountClipboard() creates the single element; Clipboard() renders what's clipped to it;
 * showClipboard() and hideClipboard() put it up and take it away with its motion.
 */
export function mountClipboard() {
  const el = document.createElement('aside');
  el.className = 'ui-clipboard';
  el.hidden = true;
  el.setAttribute('aria-label', 'Details');
  document.body.appendChild(el);
  return el;
}

/** head: the clip's label row; strip: a bar under it (e.g. stepping controls); body: the sheet. */
export function Clipboard({ head = '', strip = '', body = '' } = {}) {
  return `<div class="ui-clipboard__clip" aria-hidden="true"></div>
    <div class="ui-clipboard__sheet">
      <div class="ui-clipboard__head">${head}</div>
      ${strip ? `<div class="ui-clipboard__strip">${strip}</div>` : ''}
      <div class="ui-clipboard__body">${body}</div>
    </div>`;
}

/**
 * Clip `html` to the board. `key` names what's on it: a new key turns to a new sheet (scrolled to
 * the top); the same key redraws the sheet where it is, keeping its scroll (a live reload).
 */
export function showClipboard(el, html, key) {
  const same = !el.hidden && !el.classList.contains('is-leaving') && el.dataset.key === key;
  const wasOpen = !el.hidden && !el.classList.contains('is-leaving');
  const scroll = same ? el.querySelector('.ui-clipboard__sheet')?.scrollTop ?? 0 : 0;
  el.classList.remove('is-leaving');
  el.classList.toggle('is-turning', wasOpen && !same);
  el.hidden = false;
  el.dataset.key = key;
  el.innerHTML = html;
  el.querySelector('.ui-clipboard__sheet').scrollTop = scroll;
}

/** Take the clipboard away; `now` skips the motion (e.g. when leaving the page). */
export function hideClipboard(el, now = false) {
  const done = () => {
    el.hidden = true;
    el.classList.remove('is-leaving', 'is-turning');
    el.innerHTML = '';
    delete el.dataset.key;
  };
  if (el.hidden) return;
  if (now) { done(); return; }
  if (el.classList.contains('is-leaving')) return;
  el.classList.remove('is-turning');
  el.classList.add('is-leaving');
  Promise.all(el.getAnimations().map((a) => a.finished))
    .then(() => { if (el.classList.contains('is-leaving')) done(); }, () => {});
}
