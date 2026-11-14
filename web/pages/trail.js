// The trail page: case folder, background, evidence board, notebook and legal pad.
import { KIND_LANE, KIND_LABEL, BUG_ROLES } from '/format.js';
import { esc, inline, richText, human, fmtDate, fmtDateTime, getJSON } from '/lib/html.js';
import { normalizeFlow, locLabel, ROLE_TAG, STATUS_TONE, SEVERITY_TONE, NODE_TONE } from '/lib/model.js';
import { store, activeCase, computeBugPath, caseWorks } from '/lib/store.js';
import { setGlossary, linkTerms } from '/lib/glossary.js';
import { drawBoard, focusStep, markSelected } from '/map/board.js';
import { Folder } from '/ui/folder.js';
import { Stamp } from '/ui/stamp.js';
import { Tag, Meter } from '/ui/tag.js';
import { Sheet } from '/ui/sheet.js';
import { CorkBoard } from '/ui/corkboard.js';
import { Button } from '/ui/button.js';
import { Legend } from '/ui/legend.js';
import { Tabs } from '/ui/tabs.js';
import { Verdict } from '/ui/verdict.js';
import { Timeline } from '/ui/timeline.js';
import { TermCards } from '/ui/term-cards.js';
import { Notice } from '/ui/notice.js';
import { CodeBlock, CodePath } from '/ui/code-block.js';
import { Clipboard, mountClipboard } from '/ui/clipboard.js';

const clipboard = mountClipboard();

// ---------- page ----------

export async function renderTrail(app, fresh) {
  const { view } = store;
  let data;
  try { data = await getJSON(`/api/trails/${encodeURIComponent(view.id)}`); } catch (e) {
    app.innerHTML = Sheet({ title: 'Trail not found', tape: true, body: `<p>${esc(e.message)}</p><p><a href="#/">← All trails</a></p>` });
    return;
  }
  const { validation } = data;
  const trail = store.trail = data.trail;
  if (!trail || typeof trail !== 'object') {
    app.innerHTML = `<p><a class="back" href="#/">← All trails</a></p>${notices(validation)}`;
    return;
  }

  const surface = document.querySelector('.ui-cork__surface');
  const keep = !fresh && surface ? { x: surface.scrollLeft, y: surface.scrollTop } : null;

  const flow = store.flow = normalizeFlow(trail.flow);
  store.stepById = new Map((flow?.steps ?? []).map((s) => [s.id, s]));
  const nodes = (Array.isArray(trail.nodes) ? trail.nodes : []).filter((n) => n && n.id && KIND_LANE[n.kind]);
  store.nodeById = new Map(nodes.map((n) => [n.id, n]));
  if (view.selected && !store.stepById.has(view.selected) && !store.nodeById.has(view.selected)) view.selected = null;
  if (flow) computeBugPath();
  setGlossary(trail.background?.terms);

  document.documentElement.lang = typeof trail.language === 'string' ? trail.language : 'en';
  const { issue = {}, summary = {} } = trail;
  document.title = `${issue.repo ?? ''}#${issue.number ?? ''} · Bug Trail`;

  app.innerHTML = [
    caseFolder(issue, summary, validation),
    background(trail.background),
    flow ? board(flow) : Sheet({
      title: 'Code flow', tape: true,
      body: `<p>This trail doesn't map the code path yet (format ${esc(String(trail.format ?? '').replace('bug-trail/', ''))}).</p>
        <p>Run the <b>bug-trail</b> skill on this issue again to trace the components and functions the bug passes through.</p>`,
    }),
    `<div class="ui-split">
      ${Sheet({ title: 'Investigation', sub: 'How people tracked it down', variant: 'notebook', body: investigation(issue, nodes) })}
      ${Sheet({ title: 'Where it stands', variant: 'legal', body: standing(trail) })}
    </div>`,
    `<p class="ui-foot">Analyzed ${esc(fmtDateTime(trail.analyzed_at))}${trail.analyzed_by ? ` by ${esc(trail.analyzed_by)}` : ''} · file <code>${esc(view.id)}.json</code></p>`,
  ].join('');

  if (flow) {
    const el = document.getElementById('flow');
    drawBoard(el);
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
    if (keep) { const s = document.querySelector('.ui-cork__surface'); s.scrollLeft = keep.x; s.scrollTop = keep.y; }
  }
  select(view.selected, fresh && !!view.selected);
  linkTerms(app);
}

function notices(v) {
  if (!v) return '';
  return Notice({ tone: 'bad', open: true, items: v.errors, summary: `${v.errors.length} format error${v.errors.length > 1 ? 's' : ''}: the map may be incomplete` })
    + Notice({ tone: 'warn', items: v.warnings, summary: `${v.warnings.length} warning${v.warnings.length > 1 ? 's' : ''} from the format check` });
}

function caseFolder(issue, summary, validation) {
  return Folder({
    tab: `<a href="${esc(issue.url)}" target="_blank" rel="noopener">${esc(issue.repo)}#${esc(issue.number)}</a>`,
    stamp: summary.status ? Stamp({ text: human(summary.status), tone: STATUS_TONE[summary.status] ?? 'plain', tilt: -8 }) : '',
    cls: 'case-file',
    body: `
      <div class="case-crumbs"><a class="back" href="#/">← All trails</a>${issue.author ? ` · opened by ${esc(issue.author)} ${esc(fmtDate(issue.created_at))}` : ''}</div>
      <h1 class="case-headline">${inline(summary.headline ?? issue.title)}</h1>
      <p class="case-issue">${inline(issue.title)}</p>
      <div class="ui-row">
        ${issue.state ? Tag({ text: issue.state === 'open' ? 'Open' : 'Closed', tone: issue.state === 'open' ? 'ok' : 'info' }) : ''}
        ${summary.severity ? Tag({ text: `${summary.severity} severity`, tone: SEVERITY_TONE[summary.severity] ?? 'plain' }) : ''}
        ${(issue.labels ?? []).map((l) => Tag({ text: l, variant: 'paper' })).join('')}
        ${typeof summary.confidence === 'number' ? Meter({ value: summary.confidence, label: `${Math.round(summary.confidence * 100)}% sure`, title: 'How sure the analysis is' }) : ''}
      </div>
      ${summary.tldr ? `<div class="ui-prose case-tldr">${richText(summary.tldr)}</div>` : ''}
      ${notices(validation)}`,
  });
}

function background(bg) {
  if (!bg || typeof bg !== 'object' || !bg.context) return '';
  const terms = (Array.isArray(bg.terms) ? bg.terms : []).filter((t) => t && t.term && t.meaning);
  return Sheet({
    title: 'Background', tape: true, cls: 'case-background',
    body: `
      <div class="case-bg">
        <div class="ui-prose">${richText(bg.context)}</div>
        ${bg.rule ? Sheet({ title: 'The rule', variant: 'card', cls: 'case-rule', body: `<div class="ui-prose">${richText(bg.rule)}</div>` }) : ''}
      </div>
      ${Array.isArray(bg.refs) && bg.refs.length ? `<p class="case-refs">${bg.refs.map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a>`).join(' · ')}</p>` : ''}
      ${TermCards({ terms })}`,
  });
}

function board(flow) {
  const origin = flow.steps.find((s) => s.role === 'origin');
  const symptom = flow.steps.find((s) => s.role === 'symptom');
  const hasBug = flow.steps.some((x) => BUG_ROLES.includes(x.role));
  const tools = [
    origin ? Tag({ variant: 'luggage', tag: 'button', tone: 'bad', attrs: { 'data-jump': origin.id }, html: `Starts in <code>${esc(locLabel(origin.location) || origin.title)}</code>` }) : '',
    symptom ? Tag({ variant: 'luggage', tag: 'button', tone: 'warn', attrs: { 'data-jump': symptom.id }, html: `Seen as <b>${inline(symptom.title)}</b>` }) : '',
    hasBug ? `<span class="ui-row case-follow">${Button({ label: '←', variant: 'key', attrs: { id: 'prev', 'aria-label': 'Previous step on the bug path' } })}<span id="pos" class="case-pos"></span>${Button({ label: 'Follow the bug →', attrs: { id: 'next' } })}</span>` : '',
  ].join('');
  const legend = Legend({
    hint: 'Click a note for its code',
    items: [
      ...(flow.hasCorrect ? [{ swatch: 'yarn-green', label: 'Correct logic' }] : []),
      { swatch: 'yarn-red', label: 'What the code does' },
      { swatch: 'yarn-plain', label: 'Shared by both' },
      { swatch: 'flag-bad', flag: 'bug starts', label: 'Where it goes wrong' },
      { swatch: 'flag-warn', flag: 'user sees', label: 'Where it shows up' },
    ],
  });
  return CorkBoard({
    title: 'Code flow', sub: flow.title ? inline(flow.title) : '', tools,
    strip: `${legend}<div id="casebar">${caseBar()}</div>`,
    body: '<div class="flow" id="flow"></div>',
  });
}

function caseBar() {
  const { flow } = store;
  if (!flow.cases.length) return '';
  const c = activeCase();
  const works = caseWorks(c);
  const input = c.input && typeof c.input === 'object'
    ? Object.entries(c.input).map(([k, v]) => Tag({ variant: 'paper', html: `<code>${esc(k)}</code> ${v === '' || v === null ? '<i>empty</i>' : `<code>${esc(v)}</code>`}` })).join('')
    : '';
  return `
    ${Tabs({ label: 'Case', items: flow.cases.map((x, i) => ({ html: inline(x.title), active: x === c, attrs: { 'data-case': String(i) } })) })}
    <div class="case-strip">
      ${input ? `<div class="ui-row"><span class="case-strip__lbl">Input</span>${input}</div>` : ''}
      ${Verdict({ label: 'Should', tone: 'ok', html: inline(c.should) })}
      ${Verdict({ label: works ? 'Does (same)' : 'Does now', tone: works ? 'ok' : 'bad', html: inline(c.does) })}
    </div>`;
}

function investigation(issue, nodes) {
  const dated = nodes.filter((n) => n.at && !Number.isNaN(Date.parse(n.at)));
  const items = dated.map((n) => ({ at: n.at, node: n }));
  if (issue.created_at && !nodes.some((n) => n.kind === 'report' && n.at)) items.push({ at: issue.created_at, label: 'Issue opened', lane: 'reported' });
  if (issue.closed_at) items.push({ at: issue.closed_at, label: 'Issue closed', lane: 'verified' });
  items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const undated = nodes.filter((n) => !dated.includes(n)).map((n) => ({ node: n }));
  return Timeline({
    empty: 'No investigation recorded.',
    items: [...items, ...undated].map((it) => {
      const n = it.node;
      return {
        date: it.at ? fmtDate(it.at) : '',
        datetime: it.at,
        lane: n ? KIND_LANE[n.kind] : it.lane,
        kind: n ? `${KIND_LABEL[n.kind]}${n.status === 'rejected' ? ' · ruled out' : ''}` : '',
        struck: n?.status === 'rejected',
        html: n ? inline(n.title) : esc(it.label),
        attrs: n ? { 'data-jump': n.id } : null,
      };
    }),
  });
}

function standing(trail) {
  const list = (title, items, tag) => (Array.isArray(items) && items.length
    ? `<h3 class="case-list-title">${title}</h3><${tag} class="case-list">${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${tag}>` : '');
  const body = list('Open questions', trail.open_questions, 'ul') + list('Next steps', trail.next_steps, 'ol');
  return body || '<p class="ui-muted">No open questions or next steps recorded.</p>';
}

// ---------- selection, following the bug, the clipboard ----------

export function select(id, scroll = true) {
  const { view, stepById, nodeById } = store;
  if (!view) return;
  view.selected = id && (stepById.has(id) || nodeById.has(id)) ? id : null;
  const hash = `#/t/${encodeURIComponent(view.id)}${view.selected ? `/${encodeURIComponent(view.selected)}` : ''}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
  renderClipboard();
  const el = markSelected();
  if (el && scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  focusStep(stepById.has(view.selected) ? view.selected : null);
  updateFollow();
}

function followBug(dir) {
  const path = store.flow.bugPath;
  if (!path.length) return;
  const i = path.findIndex((s) => s.id === store.view.selected);
  select(path[i === -1 ? 0 : Math.max(0, Math.min(path.length - 1, i + dir))].id);
}

function updateFollow() {
  const pos = document.getElementById('pos');
  if (!pos || !store.flow) return;
  const path = store.flow.bugPath;
  const next = document.getElementById('next');
  const prev = document.getElementById('prev');
  next.hidden = path.length === 0;
  const i = path.findIndex((s) => s.id === store.view.selected);
  pos.textContent = i === -1 ? '' : `${i + 1} of ${path.length}`;
  prev.hidden = i === -1;
  prev.disabled = i <= 0;
  next.textContent = i === -1 ? 'Follow the bug →' : 'Next →';
  next.disabled = i === path.length - 1;
}

export function closeClipboard() {
  clipboard.hidden = true;
  clipboard.innerHTML = '';
}

function renderClipboard() {
  const { view, stepById, nodeById } = store;
  const s = view?.selected && stepById.get(view.selected);
  const n = view?.selected && !s && nodeById.get(view.selected);
  if (!s && !n) { closeClipboard(); return; }
  clipboard.hidden = false;
  clipboard.innerHTML = s ? stepSheet(s) : nodeSheet(n);
  linkTerms(clipboard);
  clipboard.querySelector('.ui-clipboard__sheet').scrollTop = 0;
}

const closeBtn = () => Button({ label: '✕', variant: 'key', attrs: { 'data-close': '', 'aria-label': 'Close details' } });

function stepSheet(s) {
  const { flow, stepById } = store;
  const comp = flow.comps[s.col];
  const into = flow.edges.filter((e) => e.to === s.id);
  const out = flow.edges.filter((e) => e.from === s.id);
  const link = (e, otherId) => {
    const o = stepById.get(otherId);
    return `<li><button type="button" class="linkish" data-jump="${esc(o.id)}"><span class="ui-clipboard__num">${o.n}</span>${inline(o.title)}</button>${e.label ? `<span class="ui-clipboard__note"><code>${esc(e.label)}</code></span>` : ''}</li>`;
  };
  const bi = flow.bugPath.findIndex((b) => b.id === s.id);
  const strip = bi === -1 || flow.bugPath.length < 2 ? '' : `
    ${Button({ label: '← Back', attrs: { 'data-follow': '-1', disabled: bi === 0 } })}
    <span>Bug path · ${bi + 1} of ${flow.bugPath.length}</span>
    ${Button({ label: 'Next →', attrs: { 'data-follow': '1', disabled: bi === flow.bugPath.length - 1 } })}`;
  const tag = s.path === 'correct' ? Tag({ text: 'Correct logic', tone: 'ok' })
    : ROLE_TAG[s.role] ? Tag({ text: ROLE_TAG[s.role], tone: s.role === 'symptom' ? 'warn' : s.role === 'concurrent' ? 'info' : 'bad' })
    : s.path === 'bug' ? Tag({ text: 'Current code', tone: 'bad' }) : '';
  return Clipboard({
    head: `<span class="ui-clipboard__num">${s.n}</span><span class="ui-clipboard__where">${inline(comp.name)}</span>${tag}${closeBtn()}`,
    strip,
    body: `
      <h3>${inline(s.title)}</h3>
      ${CodePath(s.location ?? {})}
      ${s.snippet ? CodeBlock({ code: s.snippet, start: s.location?.line }) : ''}
      ${s.detail ? `<div>${richText(s.detail)}</div>` : ''}
      ${s.fix ? `<div class="ui-clipboard__fix"><b>Fixed here</b> · ${s.fix.url ? `<a href="${esc(s.fix.url)}" target="_blank" rel="noopener">${inline(s.fix.label)}</a>` : inline(s.fix.label)}${s.fix.detail ? richText(s.fix.detail) : ''}</div>` : ''}
      ${into.length ? `<h4>Comes from</h4><ul>${into.map((e) => link(e, e.from)).join('')}</ul>` : ''}
      ${out.length ? `<h4>Leads to</h4><ul>${out.map((e) => link(e, e.to)).join('')}</ul>` : ''}
      ${s.refs?.length ? `<h4>Sources</h4><ul>${s.refs.map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a></li>`).join('')}</ul>` : ''}`,
  });
}

function nodeSheet(n) {
  return Clipboard({
    head: `<span class="ui-clipboard__where lane-${KIND_LANE[n.kind]}">Investigation · ${esc(KIND_LABEL[n.kind])}</span>${closeBtn()}`,
    body: `
      <h3>${inline(n.title)}</h3>
      <div class="ui-clipboard__meta">
        ${n.status ? Tag({ text: n.status === 'rejected' ? 'ruled out' : n.status, tone: NODE_TONE[n.status] ?? 'plain' }) : ''}
        ${n.at ? `<span>${esc(fmtDateTime(n.at))}</span>` : ''}
        ${n.actor ? `<span>· ${esc(n.actor)}</span>` : ''}
      </div>
      ${n.detail ? `<div>${richText(n.detail)}</div>` : ''}
      ${n.refs?.length ? `<h4>Sources</h4><ul>${n.refs.map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a></li>`).join('')}</ul>` : ''}`,
  });
}

// ---------- events (installed once) ----------

document.addEventListener('click', (e) => {
  const { trail, view, stepById } = store;
  if (!trail || !view) return;
  if (e.target.closest('[data-close]')) return select(null, false);
  if (e.target.closest('#next')) return followBug(+1);
  if (e.target.closest('#prev')) return followBug(-1);
  const cb = e.target.closest('[data-case]');
  if (cb) {
    view.caseIdx = Number(cb.dataset.case);
    const c = activeCase();
    if (view.selected && stepById.has(view.selected) && !c.correct.includes(view.selected) && !c.bug.includes(view.selected)) view.selected = null;
    document.getElementById('casebar').innerHTML = caseBar();
    linkTerms(document.getElementById('casebar'));
    computeBugPath();
    drawBoard(document.getElementById('flow'));
    return select(view.selected, false);
  }
  const f = e.target.closest('[data-follow]');
  if (f) return followBug(Number(f.dataset.follow));
  const b = e.target.closest('[data-jump]');
  if (b) select(b.dataset.jump, true);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && store.view?.selected) select(null, false);
});
