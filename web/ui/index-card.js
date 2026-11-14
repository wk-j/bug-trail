import { attrs, cx, esc } from '/lib/html.js';

/**
 * An index card pinned to the board (a component of the system). Storage and external systems
 * are drawn as a metal file box instead. kind: app | library | service | process | storage | external
 */
export function IndexCard({ title = '', sub = '', kind = 'app', attrs: a = {}, style = '', cls } = {}) {
  const box = kind === 'storage' || kind === 'external';
  return `<div class="${cx('ui-icard', box ? 'ui-icard--box' : 'ui-icard--card', `ui-icard--${kind}`, cls)}"${attrs({ ...a, style })}>
    ${box ? '' : '<i class="ui-pin" aria-hidden="true"></i>'}
    <b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}
  </div>`;
}
