import { cx, esc } from '/lib/html.js';

/** A note taped to the page: format errors and warnings. tone: bad | warn */
export function Notice({ tone = 'warn', summary = '', items = [], open = false } = {}) {
  if (!items.length) return '';
  return `<details class="${cx('ui-notice', `ui-notice--${tone}`)}"${open ? ' open' : ''}>
    <summary>${esc(summary)}</summary>
    <ul>${items.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
  </details>`;
}
