import { attrs, esc } from '/lib/html.js';

/** Source code printed on green-bar listing paper. */
export function CodeBlock({ code = '', start } = {}) {
  const lines = String(code).split('\n');
  return `<pre class="ui-code"${attrs({ 'data-start': start })}>${lines.map((l, i) => `<span class="ui-code__line">${start ? `<i>${start + i}</i>` : ''}${esc(l) || ' '}</span>`).join('')}</pre>`;
}

/** A file location: path:line, symbol, and a link out. */
export function CodePath({ path = '', line, symbol, url, linkLabel = 'Open on GitHub ↗' } = {}) {
  if (!path) return '';
  return `<div class="ui-codepath">
    <code class="ui-codepath__path">${esc(path)}${line ? `:${line}` : ''}</code>
    ${symbol ? `<code class="ui-codepath__sym">${esc(symbol)}</code>` : ''}
    ${url ? `<a class="ui-codepath__open" href="${esc(url)}" target="_blank" rel="noopener">${esc(linkLabel)}</a>` : ''}
  </div>`;
}
