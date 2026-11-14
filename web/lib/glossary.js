// Glossary terms from the trail's background, linked wherever they appear on the page.

let glossary = []; // [{ term, meaning }], longest first

export function setGlossary(terms) {
  glossary = [...(terms ?? [])].filter((t) => t && t.term && t.meaning).sort((a, b) => b.term.length - a.term.length);
}

/** Underline glossary terms inside `root`, with the meaning on hover. */
export function linkTerms(root) {
  if (!root || !glossary.length) return;
  const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\w])(${glossary.map((t) => escRe(t.term)).join('|')})(?![\\w])`, 'g');
  const meaning = new Map(glossary.map((t) => [t.term, t.meaning]));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest('.ui-term, .ui-glossary, script, style, textarea, .ui-code')
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    re.lastIndex = 0;
    if (!re.test(n.nodeValue)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of n.nodeValue.matchAll(re)) {
      frag.append(n.nodeValue.slice(last, m.index));
      const span = document.createElement('span');
      span.className = 'ui-term';
      span.textContent = m[0];
      span.title = `${m[0]}: ${meaning.get(m[0]).replace(/`/g, '')}`;
      frag.append(span);
      last = m.index + m[0].length;
    }
    frag.append(n.nodeValue.slice(last));
    n.replaceWith(frag);
  }
}
