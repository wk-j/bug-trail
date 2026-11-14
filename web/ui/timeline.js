import { attrs, cx, esc } from '/lib/html.js';

/**
 * Dated entries written down the margin of a notebook page.
 * items: [{ date, datetime, kind, lane, html, struck, attrs }]
 */
export function Timeline({ items = [], empty = 'Nothing recorded.' } = {}) {
  if (!items.length) return `<p class="ui-muted">${esc(empty)}</p>`;
  return `<ol class="ui-timeline">${items.map((it) => `
    <li class="${cx(it.lane && `lane-${it.lane}`, it.struck && 'is-struck')}">
      <time${attrs({ datetime: it.datetime })}>${esc(it.date ?? '')}</time>
      <div>
        ${it.kind ? `<span class="ui-timeline__kind">${esc(it.kind)}</span>` : ''}
        ${it.attrs ? `<button type="button" class="ui-timeline__entry linkish"${attrs(it.attrs)}>${it.html}</button>` : `<span class="ui-timeline__entry">${it.html}</span>`}
      </div>
    </li>`).join('')}</ol>`;
}
