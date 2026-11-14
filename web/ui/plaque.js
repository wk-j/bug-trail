import { esc } from '/lib/html.js';

/** An engraved brass plaque for a page title. `sub` is HTML. */
export function Plaque({ title = '', sub = '' } = {}) {
  return `<header class="ui-plaque"><h1>${esc(title)}</h1>${sub ? `<span class="ui-plaque__sub">${sub}</span>` : ''}</header>`;
}
