// Small helpers shared by every component: escaping, inline formatting, dates.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

/** Escape, then render `backticks` as code. */
export const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

/** Paragraphs (blank-line separated), `code`, bare URLs as links, single newlines as <br>. */
export function richText(s) {
  return String(s ?? '').split(/\n\s*\n/).filter((p) => p.trim()).map((p) => {
    let h = esc(p.trim());
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    return `<p>${h.replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

/** Render an attributes object: { 'data-id': 'x', hidden: true, disabled: false }. */
export function attrs(obj = {}) {
  return Object.entries(obj)
    .filter(([, v]) => v !== false && v !== null && v !== undefined)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`))
    .join('');
}

/** Join class names, skipping falsy ones. */
export const cx = (...names) => names.filter(Boolean).join(' ');

export const human = (s) => String(s ?? '').replace(/_/g, ' ');
export const basename = (p) => String(p ?? '').split('/').pop();
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(undefined, {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
}) : '');

export async function getJSON(url) {
  const r = await fetch(url);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || r.statusText);
  return body;
}
