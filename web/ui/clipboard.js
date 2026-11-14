/**
 * A clipboard that slides in from the right: a hardboard back, a metal clip, a sheet of paper.
 * mountClipboard() creates the single element; Clipboard() renders what's clipped to it.
 */
export function mountClipboard() {
  const el = document.createElement('aside');
  el.className = 'ui-clipboard';
  el.hidden = true;
  el.setAttribute('aria-label', 'Details');
  document.body.appendChild(el);
  return el;
}

/** head: the clip's label row; strip: a bar under it (e.g. stepping controls); body: the sheet. */
export function Clipboard({ head = '', strip = '', body = '' } = {}) {
  return `<div class="ui-clipboard__clip" aria-hidden="true"></div>
    <div class="ui-clipboard__sheet">
      <div class="ui-clipboard__head">${head}</div>
      ${strip ? `<div class="ui-clipboard__strip">${strip}</div>` : ''}
      <div class="ui-clipboard__body">${body}</div>
    </div>`;
}
