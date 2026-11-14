import { attrs, cx, esc } from '/lib/html.js';

/**
 * A label. variant: 'label' (embossed label-maker tape, default), 'paper' (a small paper label,
 * for field: value pairs) or 'luggage' (a luggage tag on a string, for jump links).
 * tone: ok | info | warn | bad | plain
 */
export function Tag({ text = '', html, tone = 'plain', variant = 'label', title, attrs: a = {}, tag = 'span', cls } = {}) {
  return `<${tag} class="${cx('ui-tag', `ui-tag--${variant}`, `ui-tone--${tone}`, cls)}"${attrs({ title, ...a })}>${html ?? esc(text)}</${tag}>`;
}

/** A gauge: a recessed track with a coloured fill, for confidence. */
export function Meter({ value = 0, label = '', title } = {}) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return `<span class="ui-meter"${attrs({ title })}><span class="ui-meter__label">${esc(label || `${pct}%`)}</span><span class="ui-meter__track"><i style="width:${pct}%"></i></span></span>`;
}
