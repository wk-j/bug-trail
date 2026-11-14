import { attrs, cx } from '/lib/html.js';

/**
 * A manila case folder with a labelled tab. With `href` it's a link (a folder in a stack);
 * without, it's an open folder holding the page's main document.
 * `stamp` is HTML (usually a Stamp) pressed onto the folder's corner.
 */
export function Folder({ tab = '', body = '', href, stamp = '', id, cls } = {}) {
  const tag = href ? 'a' : 'section';
  return `<${tag} class="${cx('ui-folder', href ? 'ui-folder--link' : 'ui-folder--open', cls)}"${attrs({ href, id })}>
    <span class="ui-folder__tab">${tab}</span>
    ${stamp ? `<span class="ui-folder__stamp">${stamp}</span>` : ''}
    <div class="ui-folder__body">${body}</div>
  </${tag}>`;
}
