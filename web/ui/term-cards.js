import { esc, inline } from '/lib/html.js';

/** A card file of terms and their meanings. terms: [{ term, meaning }] */
export function TermCards({ terms = [] } = {}) {
  if (!terms.length) return '';
  return `<dl class="ui-glossary">${terms.map((t) => `
    <div class="ui-glossary__card"><dt>${esc(t.term)}</dt><dd>${inline(t.meaning)}</dd></div>`).join('')}</dl>`;
}
