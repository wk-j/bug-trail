import { attrs, cx, esc } from '/lib/html.js';

/**
 * A cork board in a wooden frame. `head` sits on the top rail (title, tools); `strip` is a
 * shelf of paper under the rail (legend, case tabs); `body` is pinned on the cork.
 */
export function CorkBoard({ title = '', sub = '', tools = '', strip = '', body = '', id, cls } = {}) {
  return `<section class="${cx('ui-cork', cls)}"${attrs({ id })}>
    <header class="ui-cork__rail">
      <span class="ui-cork__plate"><b>${esc(title)}</b>${sub ? `<span>${sub}</span>` : ''}</span>
      ${tools ? `<div class="ui-cork__tools">${tools}</div>` : ''}
    </header>
    ${strip ? `<div class="ui-cork__strip">${strip}</div>` : ''}
    <div class="ui-cork__surface">${body}</div>
  </section>`;
}
