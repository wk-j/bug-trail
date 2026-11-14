import { esc } from '/lib/html.js';

/**
 * A key to the board. items: [{ swatch, label }]
 * swatch: 'yarn-red' | 'yarn-green' | 'yarn-plain' | 'note-<tone>' | 'flag-bad' | 'flag-warn'
 */
export function Legend({ items = [], hint = '' } = {}) {
  return `<div class="ui-legend">
    ${items.map((it) => `<span class="ui-legend__item"><i class="ui-sw ui-sw--${it.swatch}">${it.flag ? esc(it.flag) : ''}</i>${esc(it.label)}</span>`).join('')}
    ${hint ? `<span class="ui-legend__hint">${esc(hint)}</span>` : ''}
  </div>`;
}
