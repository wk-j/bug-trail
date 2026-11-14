import { attrs, cx, esc } from '/lib/html.js';

/**
 * A raised, bevelled button that presses in.
 * variant: 'raised' (default) | 'key' (small square key) | 'flat' (text on a surface)
 */
export function Button({ label = '', html, variant = 'raised', attrs: a = {}, cls } = {}) {
  return `<button class="${cx('ui-btn', `ui-btn--${variant}`, cls)}"${attrs({ type: 'button', ...a })}>${html ?? esc(label)}</button>`;
}
