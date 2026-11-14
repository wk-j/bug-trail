import { attrs, cx } from '/lib/html.js';

/**
 * A sticky note: a numbered step on the board.
 * tone: yellow | green | pink | orange | blue
 * flags: [{ text, tone }] small stamps on the note (bug starts, user sees, fixed)
 * tilt: degrees, so notes don't line up like a spreadsheet
 */
export function StickyNote({ n, html = '', tone = 'yellow', flags = [], attrs: a = {}, style = '', tilt = 0, cls } = {}) {
  return `<div class="${cx('ui-note', `ui-note--${tone}`, cls)}"${attrs({ ...a, style: `--tilt:${tilt}deg;${style}` })}>
    ${n !== undefined ? `<span class="ui-note__n">${n}</span>` : ''}
    <span class="ui-note__text">${html}</span>
    ${flags.map((f) => `<span class="ui-note__flag ui-tone--${f.tone}">${f.text}</span>`).join('')}
  </div>`;
}
