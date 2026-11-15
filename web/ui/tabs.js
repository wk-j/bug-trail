import { attrs, cx, esc } from '/lib/html.js';

/** File-folder index tabs. items: [{ html, active, attrs }] */
export function Tabs({ label = '', items = [] } = {}) {
  return `<div class="ui-tabs" role="tablist"${attrs({ 'aria-label': label })}>
    ${label ? `<span class="ui-tabs__label">${esc(label)}</span>` : ''}
    ${items.map((it) => `<button type="button" class="${cx('ui-tab', it.active && 'is-active')}" role="tab"${attrs({ 'aria-selected': String(!!it.active), ...it.attrs })}>${it.html}</button>`).join('')}
  </div>`;
}

/** Choose `tab` among its siblings in place, so the change animates instead of redrawing. */
export function selectTab(tab) {
  for (const t of tab.closest('.ui-tabs').querySelectorAll('.ui-tab')) {
    t.classList.toggle('is-active', t === tab);
    t.setAttribute('aria-selected', String(t === tab));
  }
}
