import { KIND_LANE, KIND_LABEL, BUG_ROLES } from '/format.js';

const app = document.getElementById('app');
const live = document.getElementById('live');

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
const human = (s) => String(s ?? '').replace(/_/g, ' ');
const basename = (p) => String(p ?? '').split('/').pop();

function richText(s) {
  return String(s ?? '').split(/\n\s*\n/).filter((p) => p.trim()).map((p) => {
    let h = esc(p.trim());
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    return `<p>${h.replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

const STATUS_TONE = {
  new: '', investigating: 'info', root_caused: 'warn', fix_in_progress: 'warn',
  fixed: 'ok', wont_fix: '', duplicate: '', cannot_reproduce: '',
};
const SEVERITY_TONE = { critical: 'bad', high: 'bad', medium: 'warn', low: '' };

const ROLE_TAG = {
  origin: 'Bug starts here',
  propagates: 'Bug spreads',
  symptom: 'User sees this',
  concurrent: 'At the same time',
};

function pills(issue, summary) {
  const out = [];
  if (issue?.state) out.push(`<span class="pill ${issue.state === 'open' ? 'ok' : 'info'}">${issue.state === 'open' ? 'Open' : 'Closed'}</span>`);
  if (summary?.status) out.push(`<span class="pill ${STATUS_TONE[summary.status] ?? ''}">${esc(human(summary.status))}</span>`);
  if (summary?.severity) out.push(`<span class="pill ${SEVERITY_TONE[summary.severity] ?? ''}">${esc(summary.severity)} severity</span>`);
  if (typeof summary?.confidence === 'number') {
    const pct = Math.round(summary.confidence * 100);
    out.push(`<span class="conf" title="How sure the analysis is">${pct}% confidence <span class="bar"><i style="width:${pct}%"></i></span></span>`);
  }
  return out.join('');
}

// "chunk_plan.go:14 · ChunkPlan"
function locLabel(loc) {
  if (!loc?.path) return '';
  const file = `${basename(loc.path)}${loc.line ? `:${loc.line}` : ''}`;
  return loc.symbol ? `${file} · ${loc.symbol}` : file;
}

async function getJSON(url) {
  const r = await fetch(url);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || r.statusText);
  return body;
}

// ---------- routing & live reload ----------
let view = null; // { id, selected }

async function route() {
  // #/t/<trail> or #/t/<trail>/<step>: a link can point at one step of a trail.
  const m = location.hash.match(/^#\/t\/([^/]+)(?:\/(.+))?$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const step = m[2] ? decodeURIComponent(m[2]) : null;
    if (view?.id !== id) view = { id, selected: step, caseIdx: 0 };
    else if (step) view.selected = step;
    await showTrail(true);
  } else {
    view = null;
    closeDrawer();
    await showList();
  }
}

window.addEventListener('hashchange', () => { window.scrollTo(0, 0); route(); });
const events = new EventSource('/events');
events.onopen = () => live.classList.add('on');
events.onerror = () => live.classList.remove('on');
events.onmessage = (e) => {
  const { id } = JSON.parse(e.data);
  if (!view) showList();
  else if (view.id === id) showTrail(false);
};

// ---------- list page ----------
async function showList() {
  let data;
  try { data = await getJSON('/api/trails'); } catch (e) {
    app.innerHTML = `<div class="empty"><h2>Can't load trails</h2><p>${esc(e.message)}</p></div>`;
    return;
  }
  document.title = 'Bug Trail';
  document.documentElement.lang = 'en';
  if (data.trails.length === 0) {
    app.innerHTML = `
      <div class="empty">
        <h2>Map your first bug</h2>
        <p>Ask any agent to trace an issue with the <b>bug-trail</b> skill. The code-flow map shows up here as soon as it writes the file.</p>
        <pre>Use the bug-trail skill to analyze https://github.com/OWNER/REPO/issues/123</pre>
        <p>If your agent doesn't have the skill yet: <code>bug-trail install-skill</code></p>
        <p class="foot">Watching <code>${esc(data.dir)}</code></p>
      </div>`;
    return;
  }
  app.innerHTML = `
    <div class="list-head">
      <h1>Bug trails</h1>
      <span class="dir">Watching <code>${esc(data.dir)}</code></span>
    </div>
    <div class="cards">${data.trails.map((t) => `
      <a class="card" href="#/t/${encodeURIComponent(t.id)}">
        <div class="ref">${esc(t.issue?.repo ?? t.id)}${t.issue?.number ? `#${t.issue.number}` : ''}</div>
        <h2>${inline(t.summary?.headline ?? t.issue?.title ?? t.id)}</h2>
        ${t.origin ? `<p class="starts"><span class="dot"></span>Starts in <code>${esc(locLabel(t.origin.location) || t.origin.title)}</code></p>`
          : `<p class="starts none">No code flow yet</p>`}
        <div class="meta">
          ${pills(t.issue, t.summary)}
          ${t.errors ? `<span class="pill bad">${t.errors} format error${t.errors > 1 ? 's' : ''}</span>` : ''}
        </div>
        <p class="foot">${t.steps ? `${t.steps} steps · ` : ''}analyzed ${esc(fmtDate(t.analyzed_at))}</p>
      </a>`).join('')}
    </div>`;
}

// ---------- trail page ----------
let trail = null;
let flow = null;           // normalized flow: { title, comps, steps, edges, bugPath }
let stepById = new Map();
let nodeById = new Map();  // investigation nodes

function normalizeFlow(f) {
  if (!f || !Array.isArray(f.components) || !Array.isArray(f.steps)) return null;
  const comps = f.components.filter((c) => c && c.id);
  const compIdx = new Map(comps.map((c, i) => [c.id, i]));
  const steps = f.steps.filter((s) => s && s.id && compIdx.has(s.component))
    .map((s, i) => ({ ...s, role: s.role || 'normal', path: s.path || 'both', n: i + 1, col: compIdx.get(s.component) }));
  const ids = new Set(steps.map((s) => s.id));
  let edges = Array.isArray(f.edges) && f.edges.length
    ? f.edges.filter((e) => ids.has(e.from) && ids.has(e.to))
    : steps.slice(1).filter((s) => !s.alongside).map((s, i) => ({ from: steps[i].id, to: s.id }));
  const cases = (Array.isArray(f.cases) ? f.cases : [])
    .filter((c) => c && c.id && Array.isArray(c.correct) && Array.isArray(c.bug))
    .map((c) => ({ ...c, correct: c.correct.filter((id) => ids.has(id)), bug: c.bug.filter((id) => ids.has(id)) }));
  const hasCorrect = steps.some((s) => s.path === 'correct');
  return { title: f.title, comps, steps, edges, cases, hasCorrect, bugPath: [] };
}

// The case on screen, or null when the trail has none (then everything is shown).
const activeCase = () => (flow?.cases.length ? flow.cases[Math.min(view.caseIdx ?? 0, flow.cases.length - 1)] : null);

// Steps that the active case doesn't go through are dimmed.
function caseOff(id) {
  const c = activeCase();
  return !!c && !c.correct.includes(id) && !c.bug.includes(id);
}
// An edge is lit when both ends are on a route of the active case and the route doesn't
// go the long way between them (a shortcut the input never takes stays dim).
function wireOn(e) {
  const c = activeCase();
  if (!c) return true;
  const takes = (route) => {
    if (!route.includes(e.from) || !route.includes(e.to)) return false;
    const inRoute = new Set(route);
    const seen = new Set([e.from]);
    const queue = flow.edges.filter((x) => x !== e && x.from === e.from && inRoute.has(x.to)).map((x) => x.to);
    while (queue.length) {
      const n = queue.shift();
      if (n === e.to) return false;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const x of flow.edges) if (x.from === n && inRoute.has(x.to) && !seen.has(x.to)) queue.push(x.to);
    }
    return true;
  };
  return takes(c.correct) || takes(c.bug);
}

// The bug path the stepper walks: the active case's bug route, else every bug step.
function computeBugPath() {
  const c = activeCase();
  const pick = c ? c.bug.map((id) => stepById.get(id)) : flow.steps;
  flow.bugPath = pick.filter((s) => s && BUG_ROLES.includes(s.role));
}

function caseBar() {
  if (!flow.cases.length) return '';
  const c = activeCase();
  const works = typeof c.works === 'boolean' ? c.works : !c.bug.some((id) => BUG_ROLES.includes(stepById.get(id)?.role));
  const input = c.input && typeof c.input === 'object'
    ? Object.entries(c.input).map(([k, v]) => `<span class="kv"><code>${esc(k)}</code> ${v === '' || v === null ? '<i>empty</i>' : `<code>${esc(v)}</code>`}</span>`).join('')
    : '';
  return `
    <div class="cases" role="tablist" aria-label="Cases">
      <span class="cases-label">Case</span>
      ${flow.cases.map((x, i) => `<button class="case-pill${x === c ? ' on' : ''}" role="tab" aria-selected="${x === c}" data-case="${i}">${inline(x.title)}</button>`).join('')}
    </div>
    <div class="case-strip">
      ${input ? `<div class="case-input"><span class="lbl">Input</span>${input}</div>` : ''}
      <div class="case-out">
        <span class="out ok"><b>Should</b> ${inline(c.should)}</span>
        <span class="out ${works ? 'ok' : 'bad'}"><b>${works ? 'Does (same)' : 'Does now'}</b> ${inline(c.does)}</span>
      </div>
    </div>`;
}

async function showTrail(fresh) {
  let data;
  try { data = await getJSON(`/api/trails/${encodeURIComponent(view.id)}`); } catch (e) {
    app.innerHTML = `<div class="empty"><h2>Trail not found</h2><p>${esc(e.message)}</p><p><a href="#/">← All trails</a></p></div>`;
    return;
  }
  const { validation } = data;
  trail = data.trail;
  if (!trail || typeof trail !== 'object') {
    app.innerHTML = `<p><a href="#/">← All trails</a></p>${banner(validation)}`;
    return;
  }

  const scroller = document.querySelector('.flow-scroll');
  const keep = !fresh && scroller ? { x: scroller.scrollLeft, y: scroller.scrollTop } : null;

  flow = normalizeFlow(trail.flow);
  stepById = new Map((flow?.steps ?? []).map((s) => [s.id, s]));
  const nodes = (Array.isArray(trail.nodes) ? trail.nodes : []).filter((n) => n && n.id && KIND_LANE[n.kind]);
  nodeById = new Map(nodes.map((n) => [n.id, n]));
  if (view.selected && !stepById.has(view.selected) && !nodeById.has(view.selected)) view.selected = null;
  if (flow) computeBugPath();

  // Thai (or any) trail text gets the right lang for line breaking and fonts.
  document.documentElement.lang = typeof trail.language === 'string' ? trail.language : 'en';
  const { issue = {}, summary = {} } = trail;
  document.title = `${issue.repo ?? ''}#${issue.number ?? ''} · Bug Trail`;
  const origin = flow?.steps.find((s) => s.role === 'origin');
  const symptom = flow?.steps.find((s) => s.role === 'symptom');

  app.innerHTML = `
    <section class="trail-head">
      <div class="crumbs">
        <a href="#/">← All trails</a><span>·</span>
        <a class="ref" href="${esc(issue.url)}" target="_blank" rel="noopener">${esc(issue.repo)}#${esc(issue.number)}</a>
        ${issue.author ? `<span>· opened by ${esc(issue.author)} ${esc(fmtDate(issue.created_at))}</span>` : ''}
      </div>
      <h1>${inline(summary.headline ?? issue.title)}</h1>
      <p class="issue-title">${inline(issue.title)}</p>
      <div class="meta">${pills(issue, summary)}
        ${(issue.labels ?? []).map((l) => `<span class="pill">${esc(l)}</span>`).join('')}
      </div>
      ${summary.tldr ? `<div class="tldr">${richText(summary.tldr)}</div>` : ''}
      ${banner(validation)}
    </section>

    ${backgroundSection(trail.background)}

    ${flow ? `
    <section class="panel flow-panel">
      <div class="panel-head">
        <div class="flow-title">
          <h2>Code flow</h2>
          ${flow.title ? `<span class="sub">${inline(flow.title)}</span>` : ''}
        </div>
        <div class="jump">
          ${origin ? `<button class="chip origin" data-jump="${esc(origin.id)}"><span class="dot"></span>Starts in <code>${esc(locLabel(origin.location) || origin.title)}</code></button>` : ''}
          ${symptom ? `<button class="chip symptom" data-jump="${esc(symptom.id)}"><span class="dot"></span>Seen as <b>${inline(symptom.title)}</b></button>` : ''}
          ${flow.steps.some((x) => BUG_ROLES.includes(x.role)) ? `
            <span class="follow" aria-label="Follow the bug">
              <button class="btn" id="prev" aria-label="Previous step on the bug path">←</button>
              <span class="pos" id="pos"></span>
              <button class="btn" id="next">Follow the bug →</button>
            </span>` : ''}
        </div>
      </div>
      <div class="legend">
        ${flow.hasCorrect ? '<span><i class="sw correct"></i>Correct logic</span>' : ''}
        <span><i class="sw bug"></i>What the code does</span>
        <span><i class="sw norm"></i>Shared by both</span>
        <span><i class="flagsw">bug starts</i>Where it goes wrong</span>
        <span><i class="flagsw sym">user sees</i>Where it shows up</span>
        <span class="hint">Click a step for its code</span>
      </div>
      <div id="casebar">${caseBar()}</div>
      <div class="flow-scroll"><div class="flow" id="flow"></div></div>
    </section>` : `
    <section class="panel noflow">
      <div class="panel-head"><h2>Code flow</h2></div>
      <div class="placeholder">
        <p>This trail doesn't map the code path yet (format ${esc(String(trail.format ?? '').replace('bug-trail/', ''))}).</p>
        <p>Run the <b>bug-trail</b> skill on this issue again. The new version traces which components and functions the bug passes through.</p>
      </div>
    </section>`}

    <div class="lower">
      <section class="panel">
        <div class="panel-head"><h2>Investigation</h2><span class="sub">How people tracked it down</span></div>
        ${timeline(issue, nodes)}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Where it stands</h2></div>
        <div class="lists">
          ${listBlock('Open questions', trail.open_questions, 'ul')}
          ${listBlock('Next steps', trail.next_steps, 'ol')}
          ${!trail.open_questions?.length && !trail.next_steps?.length ? '<p class="placeholder">No open questions or next steps recorded.</p>' : ''}
        </div>
      </section>
    </div>
    <p class="foot">Analyzed ${esc(fmtDateTime(trail.analyzed_at))}${trail.analyzed_by ? ` by ${esc(trail.analyzed_by)}` : ''} · file <code>${esc(view.id)}.json</code></p>`;

  if (flow) {
    const el = document.getElementById('flow');
    computeBugPath();
    drawFlow(el);
    el.addEventListener('click', (e) => {
      const s = e.target.closest('.step');
      if (s) select(s.dataset.id);
      else if (view.selected) select(null, false);
    });
    el.addEventListener('keydown', (e) => {
      const s = e.target.closest('.step');
      if (s && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(s.dataset.id); }
    });
    el.addEventListener('mouseover', (e) => { const s = e.target.closest('.step'); if (s) focusStep(s.dataset.id); });
    el.addEventListener('mouseleave', () => focusStep(view.selected));
    if (flow.bugPath.length > 1) {
      document.getElementById('prev').onclick = () => followBug(-1);
      document.getElementById('next').onclick = () => followBug(+1);
    }
    if (keep) { const s = document.querySelector('.flow-scroll'); s.scrollLeft = keep.x; s.scrollTop = keep.y; }
  }
  select(view.selected, fresh && !!view.selected);
  linkTerms(app);
}

function banner(v) {
  if (!v) return '';
  const parts = [];
  if (v.errors.length) parts.push(`<details class="banner bad" open><summary>${v.errors.length} format error${v.errors.length > 1 ? 's' : ''}: the map may be incomplete</summary><ul>${v.errors.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></details>`);
  if (v.warnings.length) parts.push(`<details class="banner warn"><summary>${v.warnings.length} warning${v.warnings.length > 1 ? 's' : ''} from the format check</summary><ul>${v.warnings.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></details>`);
  return parts.join('');
}

function listBlock(title, items, tag) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return `<h3>${title}</h3><${tag}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${tag}>`;
}

function timeline(issue, nodes) {
  const dated = nodes.filter((n) => n.at && !Number.isNaN(Date.parse(n.at)));
  const items = dated.map((n) => ({ at: n.at, node: n }));
  if (issue.created_at && !nodes.some((n) => n.kind === 'report' && n.at)) items.push({ at: issue.created_at, label: 'Issue opened', lane: 'reported' });
  if (issue.closed_at) items.push({ at: issue.closed_at, label: 'Issue closed', lane: 'verified' });
  items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const undated = nodes.filter((n) => !dated.includes(n));
  if (items.length === 0 && undated.length === 0) return '<p class="placeholder">No investigation recorded.</p>';
  const row = (it) => {
    const n = it.node;
    const lane = n ? KIND_LANE[n.kind] : it.lane;
    return `<li class="lane-${lane}${n?.status === 'rejected' ? ' rejected' : ''}">
      ${it.at ? `<time datetime="${esc(it.at)}">${esc(fmtDate(it.at))}</time>` : ''}
      ${n ? `<span class="kind">${esc(KIND_LABEL[n.kind])}${n.status === 'rejected' ? ' · ruled out' : ''}</span>
        <button class="linkish" data-jump="${esc(n.id)}">${inline(n.title)}</button>`
        : `<span class="plain">${esc(it.label)}</span>`}
    </li>`;
  };
  return `<ol class="timeline">${items.map(row).join('')}${undated.map((n) => row({ node: n })).join('')}</ol>`;
}

// ---------- background and glossary ----------
let glossary = []; // [{ term, meaning }], longest first

function backgroundSection(bg) {
  glossary = [];
  if (!bg || typeof bg !== 'object' || !bg.context) return '';
  const terms = (Array.isArray(bg.terms) ? bg.terms : []).filter((t) => t && t.term && t.meaning);
  glossary = [...terms].sort((a, b) => b.term.length - a.term.length);
  return `
    <section class="background" id="background">
      <h2 class="section-title">Background</h2>
      <div class="bg-grid">
        <div class="bg-main">
          <div class="bg-context">${richText(bg.context)}</div>
          ${bg.rule ? `<div class="bg-rule"><span class="lbl">The rule</span>${richText(bg.rule)}</div>` : ''}
          ${Array.isArray(bg.refs) && bg.refs.length ? `<p class="bg-refs">${bg.refs.map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a>`).join(' · ')}</p>` : ''}
        </div>
        ${terms.length ? `
        <dl class="bg-terms">
          ${terms.map((t) => `<div><dt><code>${esc(t.term)}</code></dt><dd>${inline(t.meaning)}</dd></div>`).join('')}
        </dl>` : ''}
      </div>
    </section>`;
}

// Underline glossary terms wherever they appear, with the meaning on hover.
function linkTerms(root) {
  if (!root || !glossary.length) return;
  const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\w])(${glossary.map((t) => escRe(t.term)).join('|')})(?![\\w])`, 'g');
  const meaning = new Map(glossary.map((t) => [t.term, t.meaning]));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest('.term, .bg-terms, script, style, textarea, .snippet')
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
      span.className = 'term';
      span.textContent = m[0];
      span.title = `${m[0]}: ${meaning.get(m[0]).replace(/`/g, '')}`;
      frag.append(span);
      last = m.index + m[0].length;
    }
    frag.append(n.nodeValue.slice(last));
    n.replaceWith(frag);
  }
}

// ---------- the system map ----------
// Components are boxes, grouped into containers by `group`; storage and external systems
// stand in a column on the right. Steps hang under the box they run in as numbered pills,
// coloured by flow. Arrows join components, one per flow (correct, bug, shared).
const GAP_X = 64, PAD = 26, GROUP_PAD = 18, GROUP_HEAD = 30, NODE_H = 52, PILL_H = 26,
  PILL_GAP = 6, STACK_GAP = 30, BAND_GAP = 26, PILL_MAX = 262;
let gfx = null;
let resizeTimer = null;
let ro = null;

// Measure with whatever font the page ends up using; the map names no font of its own.
const textWidth = (() => {
  const ctx = document.createElement('canvas').getContext('2d');
  return (t, px, weight = 400) => {
    ctx.font = `${weight} ${px}px ${getComputedStyle(document.body).fontFamily}`;
    return ctx.measureText(String(t ?? '')).width;
  };
})();

const isBugStep = (s) => s.path === 'bug' || BUG_ROLES.includes(s.role);
const isStore = (c) => c.kind === 'storage' || c.kind === 'external';

function drawFlow(el) {
  const avail = el.parentElement.clientWidth;
  const comps = flow.comps;
  const stepsOf = new Map(comps.map((c) => [c.id, flow.steps.filter((s) => s.component === c.id)]));

  // Component-level arrows, one per (from, to, flow), from the step edges that cross components.
  const cmap = new Map();
  for (const e of flow.edges) {
    const a = stepById.get(e.from), b = stepById.get(e.to);
    if (a.component === b.component) continue;
    const kind = a.path === 'correct' || b.path === 'correct' ? 'ok'
      : e.kind === 'concurrent' || a.role === 'concurrent' || b.role === 'concurrent' ? 'conc'
      : isBugStep(b) || e.kind === 'error' ? 'bug' : 'norm';
    const key = `${a.component}|${b.component}|${kind}`;
    if (!cmap.has(key)) cmap.set(key, { from: a.component, to: b.component, kind, edges: [] });
    cmap.get(key).edges.push(e);
  }
  const cedges = [...cmap.values()];

  // Rank components left to right: drop back edges (DFS from the first step's component), then longest path.
  const firstSeen = new Map();
  flow.steps.forEach((s, i) => { if (!firstSeen.has(s.component)) firstSeen.set(s.component, i); });
  const order = [...comps].sort((x, y) => (firstSeen.get(x.id) ?? 1e9) - (firstSeen.get(y.id) ?? 1e9));
  const out = new Map(comps.map((c) => [c.id, []]));
  for (const e of cedges) if (!out.get(e.from).includes(e.to)) out.get(e.from).push(e.to);
  const state = new Map(); const back = new Set();
  const dfs = (u) => {
    state.set(u, 1);
    for (const v of out.get(u)) {
      if (state.get(v) === 1) back.add(`${u}|${v}`);
      else if (!state.has(v)) dfs(v);
    }
    state.set(u, 2);
  };
  for (const c of order) if (!state.has(c.id)) dfs(c.id);
  const rank = new Map(comps.map((c) => [c.id, 0]));
  for (let pass = 0; pass < comps.length; pass++) {
    for (const [u, vs] of out) for (const v of vs) {
      if (back.has(`${u}|${v}`)) continue;
      if (rank.get(v) < rank.get(u) + 1) rank.set(v, rank.get(u) + 1);
    }
  }

  // Sizes.
  const size = new Map();
  for (const c of comps) {
    const pills = stepsOf.get(c.id);
    const nodeW = Math.max(150, textWidth(c.name, 13, 600), textWidth(c.detail, 12)) + 34;
    const extra = (st) => 44 + (st.role === 'origin' || st.role === 'symptom' ? 74 : 0) + (st.fix ? 46 : 0);
    const pillW = pills.length ? Math.min(PILL_MAX, Math.max(...pills.map((st) => textWidth(st.title, 12.5) + extra(st)))) : 0;
    // Pill heights come from the rendered text (measured below), so nothing is clipped.
    const pillH = pills.map(() => PILL_H);
    const w = Math.max(nodeW, pillW);
    const h = NODE_H + (pills.length ? 14 + pillH.reduce((x2, y2) => x2 + y2 + PILL_GAP, 0) - PILL_GAP : 0);
    size.set(c.id, { nodeW, pillW, pillH, w, h });
  }

  // Columns (shared by all groups so the flow reads left to right).
  // Measure every pill at its final width with its real text and font.
  const probe = document.createElement('div');
  probe.className = 'pill-measure';
  probe.innerHTML = flow.steps.map((st) => `<div class="step pill multi role-${esc(st.role)}" data-m="${esc(st.id)}" style="width:${size.get(st.component).pillW}px"><span class="num">${st.n}</span><span class="pt">${inline(st.title)}</span>${st.role === 'origin' ? '<span class="flag">bug starts</span>' : ''}${st.role === 'symptom' ? '<span class="flag sym">user sees</span>' : ''}${st.fix ? '<span class="flag fix">fixed</span>' : ''}</div>`).join('');
  el.appendChild(probe);
  const measured = new Map([...probe.children].map((d) => [d.dataset.m, Math.max(PILL_H, Math.ceil(d.getBoundingClientRect().height))]));
  probe.remove();
  for (const c of comps) {
    const sz = size.get(c.id);
    sz.pillH = stepsOf.get(c.id).map((st) => measured.get(st.id) ?? PILL_H);
    sz.h = NODE_H + (sz.pillH.length ? 14 + sz.pillH.reduce((x2, y2) => x2 + y2 + PILL_GAP, 0) - PILL_GAP : 0);
    sz.w = Math.max(sz.nodeW, sz.pillW);
  }

  // Storage and external systems sit in their own band below the code, at their place in the order.
  const flowComps = order.filter((c) => !isStore(c));
  const stores = order.filter(isStore);
  const maxRank = Math.max(0, ...comps.map((c) => rank.get(c.id)));
  const colW = Array(maxRank + 1).fill(0);
  for (const c of comps) colW[rank.get(c.id)] = Math.max(colW[rank.get(c.id)], size.get(c.id).w);
  const colX = [];
  let x = PAD + GROUP_PAD;
  for (let r = 0; r <= maxRank; r++) { colX[r] = x; x += colW[r] + GAP_X; }

  // Groups become horizontal bands, in order of first appearance.
  const groups = [];
  for (const c of flowComps) {
    const g = c.group || '';
    let entry = groups.find((x2) => x2.key === g);
    if (!entry) groups.push(entry = { key: g, label: c.group || '', comps: [] });
    entry.comps.push(c);
  }
  if (stores.length) groups.push({ key: '\u0001stores', label: '', comps: stores, stores: true });

  const groupOf = new Map();
  groups.forEach((g, gi) => g.comps.forEach((c) => groupOf.set(c.id, gi)));
  const skips = cedges.filter((e) => groupOf.get(e.from) === groupOf.get(e.to) && rank.get(e.to) - rank.get(e.from) > 1);
  // One module needs no box around it; only draw containers when there are several.
  const boxed = groups.filter((g) => g.label).length > 1;

  // Groups whose columns don't overlap share a band, side by side; storage gets the last band.
  const bands = [];
  for (const [gi, g] of groups.entries()) {
    const ranks = new Set(g.comps.map((c) => rank.get(c.id)));
    const fit = g.stores ? null : bands.find((bd) => !bd.stores && [...ranks].every((r) => !bd.ranks.has(r)));
    if (fit) { fit.groups.push(gi); ranks.forEach((r) => fit.ranks.add(r)); }
    else bands.push({ groups: [gi], ranks, stores: !!g.stores });
  }

  const bandOfComp = new Map();
  bands.forEach((bd, bi) => bd.groups.forEach((gi) => groups[gi].comps.forEach((c) => bandOfComp.set(c.id, bi))));
  // Returns to an earlier column in the same band run through the lane above the boxes.
  const ups = cedges.filter((e) => !skips.includes(e) && bandOfComp.get(e.from) === bandOfComp.get(e.to)
    && rank.get(e.to) < rank.get(e.from));
  const place = new Map(); // compId -> {x, y, w, nodeW, pillW, h}
  let y = PAD;
  const containers = [];
  for (const [bi, bd] of bands.entries()) {
    const top = y;
    const labelled = boxed && bd.groups.some((gi) => groups[gi].label);
    const lanes = [...skips, ...ups].filter((e) => bandOfComp.get(e.from) === bi).length;
    const laneTop = top + (labelled ? GROUP_HEAD : GROUP_PAD / 2);
    const inner = laneTop + (lanes ? lanes * 10 + 8 : 0);
    let bandH = 0;
    for (const gi of bd.groups) {
      const g = groups[gi];
      g.laneTop = laneTop;
      for (let r = 0; r <= maxRank; r++) {
        let yy = inner;
        for (const c of g.comps.filter((c2) => rank.get(c2.id) === r)) {
          const sz = size.get(c.id);
          place.set(c.id, { x: colX[r] + (colW[r] - sz.w) / 2, y: yy, ...sz });
          yy += sz.h + STACK_GAP;
        }
        bandH = Math.max(bandH, yy - STACK_GAP - inner);
      }
    }
    const bottom = inner + bandH + GROUP_PAD;
    for (const gi of bd.groups) {
      const g = groups[gi];
      if (!g.label || !boxed) continue;
      const xs = g.comps.map((c) => place.get(c.id));
      containers.push({ label: g.label, l: Math.min(...xs.map((p) => p.x)) - GROUP_PAD, r: Math.max(...xs.map((p) => p.x + p.w)) + GROUP_PAD, t: top, b: bottom });
    }
    y = bottom + BAND_GAP;
  }
  const backCount = cedges.filter((e) => !ups.includes(e)).filter((e) => {
    const a = place.get(e.from), b = place.get(e.to);
    return b.x + b.w / 2 < a.x + a.w / 2 - 4;
  }).length;
  const contentBottom = y - BAND_GAP;
  const height = contentBottom + 24 + backCount * 12 + PAD;
  const contentW = x - GAP_X + PAD + GROUP_PAD;
  const width = Math.max(avail, contentW);
  const shift = Math.max(0, Math.floor((avail - contentW) / 2));
  el.parentElement.classList.toggle('fits', contentW <= avail);
  el.style.width = `${width}px`;

  const bugIndex = new Map(flow.bugPath.map((s, i) => [s.id, i + 1]));
  const flowCls = (s) => (s.path === 'correct' ? 'f-ok' : isBugStep(s) ? 'f-bug' : s.role === 'concurrent' ? 'f-conc' : 'f-norm');
  el.innerHTML = `
    <div class="flow-canvas map" id="canvas" style="height:${height}px">
      ${containers.map((g) => `<div class="group" style="left:${g.l + shift}px;top:${g.t}px;width:${g.r - g.l}px;height:${g.b - g.t}px"><span>${esc(g.label)}</span></div>`).join('')}
      <svg class="wires" id="wires"></svg>
      ${comps.map((c) => {
        const p = place.get(c.id);
        const nx = p.x + shift + (p.w - p.nodeW) / 2;
        const px = p.x + shift + (p.w - p.pillW) / 2;
        return `
        <div class="cnode kind-${esc(c.kind || 'app')}" data-comp="${esc(c.id)}" style="left:${nx}px;top:${p.y}px;width:${p.nodeW}px;height:${NODE_H}px">
          <b>${esc(c.name)}</b>${c.detail ? `<span>${esc(c.detail)}</span>` : ''}
        </div>
        ${stepsOf.get(c.id).map((s, k, all) => `
          <div class="step pill multi ${flowCls(s)} role-${esc(s.role)}${caseOff(s.id) ? ' off' : ''}" data-id="${esc(s.id)}" tabindex="0" role="button"
               title="${esc(s.title)}${s.location?.path ? ` — ${esc(locLabel(s.location))}` : ''}"
               style="left:${px}px;top:${p.y + NODE_H + 14 + p.pillH.slice(0, k).reduce((x2, y2) => x2 + y2 + PILL_GAP, 0)}px;width:${p.pillW}px;height:${p.pillH[k]}px">
            <span class="num">${s.n}</span>
            <span class="pt">${inline(s.title)}</span>
            ${s.role === 'origin' ? `<span class="flag">bug starts${bugIndex.has(s.id) ? '' : ''}</span>` : ''}
            ${s.role === 'symptom' ? '<span class="flag sym">user sees</span>' : ''}
            ${s.fix ? '<span class="flag fix">fixed</span>' : ''}
          </div>`).join('')}`;
      }).join('')}
    </div>`;

  const boxes = new Map();
  for (const c of comps) {
    const p = place.get(c.id);
    const l = p.x + shift + (p.w - p.nodeW) / 2;
    boxes.set(c.id, { l, r: l + p.nodeW, t: p.y, b: p.y + NODE_H, cx: l + p.nodeW / 2, cy: p.y + NODE_H / 2,
      slotL: p.x + shift, slotR: p.x + shift + p.w,
      stackBottom: p.y + p.h, pills: stepsOf.get(c.id).length });
  }
  linkTerms(el);
  gfx = { boxes, cedges, height, contentBottom, skips: new Set(skips), ups: new Set(ups), bandOfComp,
    laneTop: new Map([...skips, ...ups].map((e) => [e, groups[groupOf.get(e.from)].laneTop])) };
  drawWires(width, height);

  if (ro) ro.disconnect();
  ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const f = document.getElementById('flow');
      if (f && Math.abs(f.parentElement.clientWidth - avail) > 4) { drawFlow(f); focusStep(view.selected); markSelected(); }
    }, 100);
  });
  ro.observe(el.parentElement);
}

function drawWires(width, height) {
  const svg = document.getElementById('wires');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  const { boxes, cedges, contentBottom } = gfx;
  const marker = (k) => `<marker id="m-${k}" class="w-${k}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1,1 L9,5 L1,9 z"/></marker>`;

  // Parallel arrows between the same two components sit side by side.
  const pairs = new Map();
  for (const e of cedges) {
    const k = [e.from, e.to].sort().join('|');
    if (!pairs.has(k)) pairs.set(k, []);
    pairs.get(k).push(e);
  }
  const offset = (e) => { const list = pairs.get([e.from, e.to].sort().join('|')); const i = list.indexOf(e); return (i - (list.length - 1) / 2) * 9; };

  let backIdx = 0;
  const laneUsed = new Map();
  const paths = cedges.map((e) => {
    const a = boxes.get(e.from), b = boxes.get(e.to);
    const o = offset(e);
    let d;
    if (gfx.skips.has(e)) {
      // Skips columns: rise into a lane above the boxes, run across, drop into B.
      const top = gfx.laneTop.get(e);
      const k = laneUsed.get(top) || 0; laneUsed.set(top, k + 1);
      const yl = top + 4 + k * 10, y1 = a.cy + o, y2 = b.cy + o, R = 10;
      // Rise just right of A's box, drop just left of B's whole column (pills are wider than boxes).
      const xa = Math.max(a.r, a.slotR) + 12, xb = Math.min(b.l, b.slotL) - 14 - k * 6;
      d = `M${a.r},${y1} L${xa - R},${y1} Q${xa},${y1} ${xa},${y1 - R} L${xa},${yl + R} Q${xa},${yl} ${xa + R},${yl} L${xb - R},${yl} Q${xb},${yl} ${xb},${yl + R} L${xb},${y2 - R} Q${xb},${y2} ${xb + R},${y2} L${b.l - 3},${y2}`;
    } else if (gfx.ups.has(e)) {
      // A return to an earlier column: up from A's top, back along the lane, down into B's top.
      const top = gfx.laneTop.get(e);
      const k = laneUsed.get(top) || 0; laneUsed.set(top, k + 1);
      const yl = top + 4 + k * 10, R = 8;
      const xa = a.cx + 12 + o, xb = b.cx + 12 + o + k * 4;
      d = `M${xa},${a.t} L${xa},${yl + R} Q${xa},${yl} ${xa - R},${yl} L${xb + R},${yl} Q${xb},${yl} ${xb},${yl + R} L${xb},${b.t - 3}`;
    } else if (b.l > a.r + 8 && gfx.bandOfComp.get(e.from) !== gfx.bandOfComp.get(e.to)) {
      // Forward into another band: across to the gap before B's column, then up or down, then in.
      const xg = Math.min(b.l, b.slotL) - 14 - (o > 0 ? 6 : 0), y1 = a.cy + o, y2 = b.cy + o, R = 10;
      const dir = y2 > y1 ? 1 : -1;
      d = `M${a.r},${y1} L${xg - R},${y1} Q${xg},${y1} ${xg},${y1 + dir * R} L${xg},${y2 - dir * R} Q${xg},${y2} ${xg + R},${y2} L${b.l - 3},${y2}`;
    } else if (b.l > a.r + 8) {
      // Forward: out of A's right side, into B's left side.
      const y1 = a.cy + o, y2 = b.cy + o, dx = Math.max(36, (b.l - a.r) / 2);
      d = `M${a.r},${y1} C${a.r + dx},${y1} ${b.l - dx},${y2} ${b.l - 3},${y2}`;
    } else if (Math.abs(a.cx - b.cx) < 8) {
      // Same column: around the right side.
      const xr = Math.max(a.r, b.r) + 34;
      d = `M${a.r},${a.cy + o} C${xr},${a.cy + o} ${xr},${b.cy + o} ${b.r + 3},${b.cy + o}`;
    } else {
      // Back to the left: drop below everything, run left, come up into B's left side.
      const yb = contentBottom + 20 + backIdx++ * 12;
      const xl = Math.min(b.l, b.slotL) - 14 - backIdx * 6;
      const sx = a.cx + o;
      const R = 10;
      d = `M${sx},${a.stackBottom + 4} L${sx},${yb - R} Q${sx},${yb} ${sx - R},${yb} L${xl + R},${yb} Q${xl},${yb} ${xl},${yb - R} L${xl},${b.cy + o + R} Q${xl},${b.cy + o} ${xl + R},${b.cy + o} L${b.l - 3},${b.cy + o}`;
    }
    const steps = [...new Set(e.edges.flatMap((x) => [x.from, x.to]))].join(' ');
    const on = e.edges.some(wireOn);
    const title = e.edges.map((x) => `${stepById.get(x.from).n} → ${stepById.get(x.to).n}${x.label ? `: ${x.label}` : ''}`).join('\n');
    return `<path class="wire w-${e.kind}${on ? '' : ' off'}${e.kind === 'norm' && b.l <= a.r ? ' dashed' : ''}" data-steps="${esc(steps)}" d="${d}" marker-end="url(#m-${e.kind})"><title>${esc(title)}</title></path>`;
  });
  // Dotted spines from each box to its pills.
  const spines = [...boxes.values()].filter((bx) => bx.pills).map((bx) =>
    `<line class="spine" x1="${bx.cx}" y1="${bx.b}" x2="${bx.cx}" y2="${bx.stackBottom - 12}"/>`);
  paths.sort((x, y) => (/w-(bug|ok)/.test(x) ? 1 : 0) - (/w-(bug|ok)/.test(y) ? 1 : 0));
  svg.innerHTML = `<defs>${['norm', 'bug', 'conc', 'ok'].map(marker).join('')}</defs>${spines.join('')}${paths.join('')}`;
}

// ---------- selection, focus, follow the bug ----------
function focusStep(id) {
  const el = document.getElementById('flow');
  if (!el) return;
  el.querySelectorAll('.hl').forEach((x) => x.classList.remove('hl'));
  if (!id || !stepById.has(id)) { el.classList.remove('focus'); return; }
  el.classList.add('focus');
  const keep = new Set([id]);
  for (const e of flow.edges) if (e.from === id || e.to === id) { keep.add(e.from); keep.add(e.to); }
  el.querySelectorAll('.step').forEach((s) => { if (keep.has(s.dataset.id)) s.classList.add('hl'); });
  el.querySelectorAll('.wire').forEach((w) => { if (w.dataset.steps.split(' ').includes(id)) w.classList.add('hl'); });
  const comp = stepById.get(id).component;
  el.querySelectorAll('.cnode').forEach((n) => {
    if ([...keep].some((k) => stepById.get(k)?.component === n.dataset.comp)) n.classList.add('hl');
  });
}

function markSelected() {
  document.querySelectorAll('.step.sel').forEach((e) => e.classList.remove('sel'));
  const el = view?.selected && document.querySelector(`.step[data-id="${CSS.escape(view.selected)}"]`);
  if (el) el.classList.add('sel');
  return el;
}

function select(id, scroll = true) {
  if (!view) return;
  view.selected = id && (stepById.has(id) || nodeById.has(id)) ? id : null;
  const hash = `#/t/${encodeURIComponent(view.id)}${view.selected ? `/${encodeURIComponent(view.selected)}` : ''}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
  renderDrawer();
  const el = markSelected();
  if (el && scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  focusStep(stepById.has(view.selected) ? view.selected : null);
  updateFollow();
}

function followBug(dir) {
  const path = flow.bugPath;
  if (!path.length) return;
  const i = path.findIndex((s) => s.id === view.selected);
  const next = i === -1 ? 0 : Math.max(0, Math.min(path.length - 1, i + dir));
  select(path[next].id);
}

function updateFollow() {
  const pos = document.getElementById('pos');
  if (!pos || !flow) return;
  const path = flow.bugPath;
  document.getElementById('next').hidden = path.length === 0;
  const i = path.findIndex((s) => s.id === view.selected);
  pos.textContent = i === -1 ? '' : `${i + 1} of ${path.length}`;
  document.getElementById('prev').hidden = i === -1;
  document.getElementById('prev').disabled = i <= 0;
  const next = document.getElementById('next');
  next.textContent = i === -1 ? 'Follow the bug →' : 'Next →';
  next.disabled = i === path.length - 1;
}

// ---------- the details drawer ----------
const drawer = document.createElement('aside');
drawer.className = 'drawer';
drawer.hidden = true;
drawer.setAttribute('aria-label', 'Details');
document.body.appendChild(drawer);

function closeDrawer() {
  drawer.hidden = true;
  document.body.classList.remove('drawer-open');
}

function renderDrawer() {
  const s = view?.selected && stepById.get(view.selected);
  const n = view?.selected && !s && nodeById.get(view.selected);
  if (!s && !n) { closeDrawer(); drawer.innerHTML = ''; return; }
  drawer.hidden = false;
  document.body.classList.add('drawer-open');
  drawer.innerHTML = s ? stepDetail(s) : nodeDetail(n);
  linkTerms(drawer);
  drawer.scrollTop = 0;
}

function stepDetail(s) {
  const comp = flow.comps[s.col];
  const loc = s.location;
  const into = flow.edges.filter((e) => e.to === s.id);
  const out = flow.edges.filter((e) => e.from === s.id);
  const link = (e, otherId, arrow) => {
    const o = stepById.get(otherId);
    return `<li><button class="linkish" data-jump="${esc(o.id)}"><span class="num sm">${o.n}</span>${inline(o.title)}</button>${e.label ? `<span class="note"><code>${esc(e.label)}</code></span>` : ''}${arrow}</li>`;
  };
  const bi = flow.bugPath.findIndex((b) => b.id === s.id);
  const follow = bi === -1 || flow.bugPath.length < 2 ? '' : `
    <div class="drawer-follow">
      <button class="btn" data-follow="-1" ${bi === 0 ? 'disabled' : ''}>← Back</button>
      <span>Bug path · ${bi + 1} of ${flow.bugPath.length}</span>
      <button class="btn" data-follow="1" ${bi === flow.bugPath.length - 1 ? 'disabled' : ''}>Next →</button>
    </div>`;
  return `
    <div class="drawer-head role-${esc(s.role)}">
      <span class="num">${s.n}</span>
      <span class="where">${inline(comp.name)}</span>
      ${s.path === 'correct' ? '<span class="tag ok">Correct logic</span>' : s.path === 'bug' && !ROLE_TAG[s.role] ? '<span class="tag">Current code</span>' : ''}
      ${ROLE_TAG[s.role] ? `<span class="tag">${ROLE_TAG[s.role]}</span>` : ''}
      <button class="btn close" data-close aria-label="Close details">✕</button>
    </div>${follow}
    <div class="drawer-body">
      <h3>${inline(s.title)}</h3>
      ${loc?.path ? `
        <div class="loc">
          <code class="path">${esc(loc.path)}${loc.line ? `:${loc.line}` : ''}</code>
          ${loc.symbol ? `<span class="sym"><code>${esc(loc.symbol)}</code></span>` : ''}
          ${loc.url ? `<a class="open" href="${esc(loc.url)}" target="_blank" rel="noopener">Open on GitHub ↗</a>` : ''}
        </div>` : ''}
      ${s.snippet ? `<pre class="snippet"><code>${esc(s.snippet)}</code></pre>` : ''}
      ${s.detail ? `<div class="text">${richText(s.detail)}</div>` : ''}
      ${s.fix ? `
        <div class="fixbox">
          <b>Fixed here</b> · ${s.fix.url ? `<a href="${esc(s.fix.url)}" target="_blank" rel="noopener">${inline(s.fix.label)}</a>` : inline(s.fix.label)}
          ${s.fix.detail ? `<div class="text">${richText(s.fix.detail)}</div>` : ''}
        </div>` : ''}
      ${into.length ? `<h4>Comes from</h4><ul class="links">${into.map((e) => link(e, e.from, '')).join('')}</ul>` : ''}
      ${out.length ? `<h4>Leads to</h4><ul class="links">${out.map((e) => link(e, e.to, '')).join('')}</ul>` : ''}
      ${s.refs?.length ? `<h4>Sources</h4><ul class="links">${s.refs.map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a></li>`).join('')}</ul>` : ''}
    </div>`;
}

function nodeDetail(n) {
  const tone = { confirmed: 'ok', done: 'ok', likely: 'info', open: 'warn', rejected: 'bad' }[n.status] ?? '';
  return `
    <div class="drawer-head lane-${KIND_LANE[n.kind]}">
      <span class="where">Investigation · ${esc(KIND_LABEL[n.kind])}</span>
      <button class="btn close" data-close aria-label="Close details">✕</button>
    </div>
    <div class="drawer-body">
      <h3>${inline(n.title)}</h3>
      <div class="meta">
        ${n.status ? `<span class="pill ${tone}">${esc(n.status === 'rejected' ? 'ruled out' : n.status)}</span>` : ''}
        ${n.at ? `<span>${esc(fmtDateTime(n.at))}</span>` : ''}
        ${n.actor ? `<span>· ${esc(n.actor)}</span>` : ''}
      </div>
      ${n.detail ? `<div class="text">${richText(n.detail)}</div>` : ''}
      ${n.refs?.length ? `<h4>Sources</h4><ul class="links">${n.refs.map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a></li>`).join('')}</ul>` : ''}
    </div>`;
}

// Jump links (chips, drawer, timeline) select; ✕ and Esc close.
document.addEventListener('click', (e) => {
  if (!trail || !view) return;
  if (e.target.closest('[data-close]')) return select(null, false);
  const cb = e.target.closest('[data-case]');
  if (cb) {
    view.caseIdx = Number(cb.dataset.case);
    const c = activeCase();
    if (view.selected && stepById.has(view.selected) && !c.correct.includes(view.selected) && !c.bug.includes(view.selected)) view.selected = null;
    document.getElementById('casebar').innerHTML = caseBar();
    linkTerms(document.getElementById('casebar'));
    computeBugPath();
    drawFlow(document.getElementById('flow'));
    return select(view.selected, false);
  }
  const f = e.target.closest('[data-follow]');
  if (f) return followBug(Number(f.dataset.follow));
  const b = e.target.closest('[data-jump]');
  if (b) select(b.dataset.jump, true);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && view?.selected) select(null, false);
});

route();
