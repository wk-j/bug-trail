import { Stamp } from '/ui/stamp.js';

/** A line led by a small stamp: "SHOULD …", "DOES NOW …". `html` is the line's text. */
export function Verdict({ label = '', tone = 'ok', html = '' } = {}) {
  return `<div class="ui-verdict ui-verdict--${tone}">${Stamp({ text: label, tone, tilt: -3, size: 'sm' })}<span>${html}</span></div>`;
}
