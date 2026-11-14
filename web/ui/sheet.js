import { attrs, cx, esc } from '/lib/html.js';

/**
 * A sheet of paper with an optional heading.
 * variant: 'paper' (default) | 'notebook' (ruled, red margin, punched holes) |
 *          'legal' (yellow legal pad) | 'card' (index card with a red rule)
 */
export function Sheet({ title, sub, actions = '', body = '', variant = 'paper', id, cls, tape = false } = {}) {
  const head = title || actions
    ? `<header class="ui-sheet__head">${title ? `<h2>${esc(title)}</h2>` : ''}${sub ? `<span class="ui-sheet__sub">${esc(sub)}</span>` : ''}${actions ? `<div class="ui-sheet__actions">${actions}</div>` : ''}</header>`
    : '';
  return `<section class="${cx('ui-sheet', `ui-sheet--${variant}`, tape && 'ui-sheet--taped', cls)}"${attrs({ id })}>${head}<div class="ui-sheet__body">${body}</div></section>`;
}
