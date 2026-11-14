import { cx, esc } from '/lib/html.js';

/** A rubber-stamp impression. tone: ok | info | warn | bad | plain. size: 'lg' | 'sm' */
export function Stamp({ text = '', tone = 'bad', tilt = -7, size = 'lg', cls } = {}) {
  return `<span class="${cx('ui-stamp', `ui-stamp--${size}`, `ui-tone--${tone}`, cls)}" style="--tilt:${tilt}deg">${esc(text)}</span>`;
}
