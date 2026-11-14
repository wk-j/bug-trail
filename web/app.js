import { LANES, KIND_LANE, KIND_LABEL } from '/format.js';

const app = document.getElementById('app');
const live = document.getElementById('live');

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
const human = (s) => String(s ?? '').replace(/_/g, ' ');

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

async function getJSON(url) {
  const r = await fetch(url);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || r.statusText);
  return body;
}

// ---------- routing & live reload ----------
let view = null; // { id, selected, storyIdx }

async function route() {
  // #/t/<trail> or #/t/<trail>/<step>: a link can point at one step of a trail.
  const m = location.hash.match(/^#\/t\/([^/]+)(?:\/(.+))?$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const step = m[2] ? decodeURIComponent(m[2]) : null;
    if (view?.id !== id) view = { id, selected: step, storyIdx: -1 };
    else if (step) view.selected = step;
    await showTrail(true);
  } else {
    view = null;
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
route();

// ---------- list page ----------
async function showList() {
  let data;
  try { data = await getJSON('/api/trails'); } catch (e) {
    app.innerHTML = `<div class="empty"><h2>Cannot load trails</h2><p>${esc(e.message)}</p></div>`;
    return;
  }
  document.title = 'Bug Trail';
  if (data.trails.length === 0) {
    app.innerHTML = `
      <div class="empty">
        <h2>No bug trails yet</h2>
        <p>Ask any agent to analyze an issue with the <b>bug-trail</b> skill. The map appears here as soon as it writes the file.</p>
        <pre>Use the bug-trail skill to analyze https://github.com/OWNER/REPO/issues/123</pre>
        <p>Install the skill first if your agent doesn't have it:</p>
        <pre>bug-trail install-skill</pre>
        <p>To look at the examples: <code>bug-trail serve --dir examples</code> in the project folder.</p>
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
        <p>${inline(t.issue?.title ?? '')}</p>
        <div class="meta">
          ${pills(t.issue, t.summary)}
          ${t.errors ? `<span class="pill bad">${t.errors} format error${t.errors > 1 ? 's' : ''}</span>` : ''}
        </div>
        <p class="foot">${t.nodes} nodes · analyzed ${esc(fmtDate(t.analyzed_at))}</p>
      </a>`).join('')}
    </div>`;
}

// ---------- trail page ----------
let trail = null;
let nodeById = new Map();
let adjacency = new Map();

async function showTrail(fresh) {
  let data;
  try { data = await getJSON(`/api/trails/${encodeURIComponent(view.id)}`); } catch (e) {
    app.innerHTML = `<div class="empty"><h2>Trail not found</h2><p>${esc(e.message)}</p><p><a href="#/">← All trails</a></p></div>`;
    return;
  }
  const { validation } = data;
  trail = data.trail;
  if (!trail || !Array.isArray(trail.nodes)) {
    app.innerHTML = `<p><a href="#/">← All trails</a></p>${banner(validation)}`;
    return;
  }

  const scroller = document.querySelector('.map-scroll');
  const keep = !fresh && scroller ? { x: scroller.scrollLeft, y: scroller.scrollTop } : null;

  const nodes = trail.nodes.filter((n) => n && n.id && KIND_LANE[n.kind]);
  nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges = (trail.edges ?? []).filter((e) => nodeById.has(e.from) && nodeById.has(e.to));
  adjacency = new Map(nodes.map((n) => [n.id, { in: [], out: [] }]));
  edges.forEach((e) => { adjacency.get(e.from).out.push(e); adjacency.get(e.to).in.push(e); });
  const story = (trail.story ?? []).filter((id) => nodeById.has(id));
  if (view.selected && !nodeById.has(view.selected)) view.selected = null;

  const { issue = {}, summary = {} } = trail;
  document.title = `${issue.repo ?? ''}#${issue.number ?? ''} · Bug Trail`;

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

    <section class="panel map-panel">
        <div class="panel-head">
          <h2>Trail map <span class="hint">Click a step for details · Esc to close</span></h2>
          ${story.length ? `
            <div class="story" aria-label="Step through the story">
              <button class="btn" id="prev">← Back</button>
              <span class="pos" id="pos"></span>
              <button class="btn" id="next">Next →</button>
            </div>` : ''}
        </div>
        <div class="legend">
          ${legendItem('causes', 'causes')}${legendItem('supports', 'supports')}${legendItem('refutes', 'refutes', true)}
          ${legendItem('fixes', 'fixes / implements')}${legendItem('verifies', 'verifies')}${legendItem('mitigates', 'mitigates')}
          ${legendItem('default', 'leads to / other')}
          <span>✓ confirmed · ~ likely · dashed = open · <s>struck</s> = ruled out</span>
        </div>
        <div class="map-wrap" id="mapwrap">
          <div class="map-scroll"><div class="map" id="map"></div></div>
          <aside class="detail" id="detail" hidden aria-label="Step details"></aside>
        </div>
    </section>

    <div class="lower">
      <section class="panel">
        <div class="panel-head"><h2>Timeline</h2></div>
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

  const map = document.getElementById('map');
  drawMap(map, nodes, edges, story);

  map.addEventListener('click', (e) => {
    const el = e.target.closest('.node');
    if (el) select(el.dataset.id, story);
    else if (view.selected) select(null, story, false); // click on empty map closes the drawer
  });
  map.addEventListener('keydown', (e) => {
    const el = e.target.closest('.node');
    if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(el.dataset.id, story); }
  });
  map.addEventListener('mouseover', (e) => {
    const el = e.target.closest('.node');
    if (el) focus(el.dataset.id);
  });
  map.addEventListener('mouseleave', () => focus(view.selected));
  map.addEventListener('mouseout', (e) => {
    if (e.target.closest('.node') && !e.relatedTarget?.closest?.('.node')) focus(view.selected);
  });

  if (story.length) {
    document.getElementById('prev').onclick = () => stepStory(story, -1);
    document.getElementById('next').onclick = () => stepStory(story, +1);
  }

  if (keep) { const s = document.querySelector('.map-scroll'); s.scrollLeft = keep.x; s.scrollTop = keep.y; }
  select(view.selected, story, fresh && !!view.selected);
}

const currentStory = () => (trail?.story ?? []).filter((id) => nodeById.has(id));

// Links to other nodes (detail panel, timeline) select that node; ✕ closes the drawer.
app.addEventListener('click', (e) => {
  if (!trail || !view) return;
  if (e.target.closest('[data-close]')) return select(null, currentStory(), false);
  const b = e.target.closest('[data-jump]');
  if (b) select(b.dataset.jump, currentStory(), true);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && view?.selected && trail) select(null, currentStory(), false);
});

function banner(v) {
  if (!v) return '';
  const parts = [];
  if (v.errors.length) parts.push(`<details class="banner bad" open><summary>${v.errors.length} format error${v.errors.length > 1 ? 's' : ''}: the map may be incomplete</summary><ul>${v.errors.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></details>`);
  if (v.warnings.length) parts.push(`<details class="banner warn"><summary>${v.warnings.length} warning${v.warnings.length > 1 ? 's' : ''} from the format check</summary><ul>${v.warnings.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></details>`);
  return parts.join('');
}

function legendItem(rel, label, dashed = false) {
  return `<span class="rel-${rel}"><svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" class="edge${dashed ? ' dashed' : ''}"/></svg>${label}</span>`;
}

function listBlock(title, items, tag) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return `<h3>${title}</h3><${tag}>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</${tag}>`;
}

function timeline(issue, nodes) {
  const items = nodes.filter((n) => n.at && !Number.isNaN(Date.parse(n.at)))
    .map((n) => ({ at: n.at, node: n }));
  if (issue.created_at && !nodes.some((n) => n.kind === 'report' && n.at)) items.push({ at: issue.created_at, label: 'Issue opened', lane: 'reported' });
  if (issue.closed_at) items.push({ at: issue.closed_at, label: 'Issue closed', lane: 'verified' });
  items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (items.length === 0) return '<p class="placeholder">No dated events in this trail.</p>';
  return `<ol class="timeline">${items.map((it) => {
    const lane = it.node ? KIND_LANE[it.node.kind] : it.lane;
    return `<li class="lane-${lane}">
      <time datetime="${esc(it.at)}">${esc(fmtDate(it.at))}</time>
      ${it.node ? `<span class="kind">${esc(KIND_LABEL[it.node.kind])}</span>
        <button class="linkish" data-jump="${esc(it.node.id)}">${esc(it.node.title)}</button>`
        : `<span class="plain">${esc(it.label)}</span>`}
    </li>`;
  }).join('')}</ol>`;
}

// ---------- map layout ----------
const PAD_X = 16, TOP = 64, GAP = 16, BOTTOM = 28;
let COL_W = 236, NODE_W = 204;

// Columns stretch to fill the panel, down to a readable minimum (then the map scrolls).
function sizeColumns(map) {
  const avail = map.parentElement.clientWidth;
  COL_W = Math.max(204, Math.min(360, Math.floor(avail / LANES.length)));
  NODE_W = COL_W - PAD_X * 2;
}

let resizeTimer = null;
let lastDraw = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const map = document.getElementById('map');
    if (map && lastDraw) { drawMap(map, ...lastDraw); select(view.selected, lastDraw[2], false); }
  }, 120);
});

function drawMap(map, nodes, edges, story) {
  lastDraw = [nodes, edges, story];
  sizeColumns(map);
  const laneIdx = Object.fromEntries(LANES.map((l, i) => [l.id, i]));
  const lanes = LANES.map(() => []);
  nodes.forEach((n, i) => { n._i = i; n._lane = laneIdx[KIND_LANE[n.kind]]; lanes[n._lane].push(n); });

  // Start in time order, then reorder each lane by where its neighbours sit (fewer crossings).
  const t = (n) => (n.at ? Date.parse(n.at) : Infinity);
  lanes.forEach((col) => col.sort((a, b) => (t(a) - t(b)) || (a._i - b._i)));
  const pos = new Map();
  const index = () => lanes.forEach((col) => col.forEach((n, k) => pos.set(n.id, (k + 0.5) / col.length)));
  index();
  const neighbours = (id) => [...adjacency.get(id).in.map((e) => e.from), ...adjacency.get(id).out.map((e) => e.to)];
  for (let pass = 0; pass < 3; pass++) {
    const order = pass % 2 === 0 ? lanes.map((_, i) => i) : lanes.map((_, i) => lanes.length - 1 - i);
    for (const li of order) {
      const col = lanes[li];
      const key = new Map(col.map((n) => {
        const ns = neighbours(n.id).filter((id) => nodeById.get(id)._lane !== li);
        return [n.id, ns.length ? ns.reduce((s, id) => s + pos.get(id), 0) / ns.length : pos.get(n.id)];
      }));
      col.sort((a, b) => (key.get(a.id) - key.get(b.id)) || (pos.get(a.id) - pos.get(b.id)));
      col.forEach((n, k) => pos.set(n.id, (k + 0.5) / col.length));
    }
  }

  const stepOf = new Map(story.map((id, k) => [id, k + 1]));
  const width = LANES.length * COL_W;
  map.style.width = `${width}px`;
  map.innerHTML = `
    ${LANES.map((l, i) => `<div class="lane-bg" style="left:${i * COL_W}px;width:${COL_W}px"></div>`).join('')}
    ${LANES.map((l, i) => `<div class="lane-head lane-${l.id}" style="left:${i * COL_W}px;width:${COL_W}px"><b>${l.label}</b><span>${l.hint}</span></div>`).join('')}
    <svg class="edges" id="edges"></svg>
    ${nodes.map((n) => `
      <div class="node lane-${KIND_LANE[n.kind]}${stepOf.has(n.id) ? ' in-story' : ''}" tabindex="0" role="button"
           data-id="${esc(n.id)}" data-status="${esc(n.status ?? '')}" ${stepOf.has(n.id) ? `data-step="${stepOf.get(n.id)}"` : ''}
           style="left:${n._lane * COL_W + PAD_X}px;top:${TOP}px;width:${NODE_W}px" aria-label="${esc(KIND_LABEL[n.kind])}: ${esc(n.title)}">
        <div class="k"><span>${esc(KIND_LABEL[n.kind])}</span>${n.status ? `<span class="st">${esc(n.status)}</span>` : ''}</div>
        <div class="t">${inline(n.title)}</div>
        ${n.at || n.actor ? `<div class="m">${esc(fmtDate(n.at))}${n.at && n.actor ? ' · ' : ''}${esc(n.actor ?? '')}</div>` : ''}
      </div>`).join('')}`;

  // Measure, then stack each lane from the top so the map uses the space it has.
  const els = new Map([...map.querySelectorAll('.node')].map((el) => [el.dataset.id, el]));
  const colH = lanes.map((col) => col.reduce((s, n) => s + els.get(n.id).offsetHeight, 0) + Math.max(0, col.length - 1) * GAP);
  const inner = Math.max(120, ...colH);
  const box = new Map();
  lanes.forEach((col, li) => {
    let y = TOP;
    if (col.length === 0) {
      const ph = document.createElement('div');
      ph.className = 'lane-empty';
      ph.style.cssText = `left:${li * COL_W + PAD_X}px;top:${TOP}px;width:${NODE_W}px`;
      ph.textContent = LANES[li].id === 'cause' ? 'Root cause not found yet' : 'Nothing here yet';
      map.appendChild(ph);
    }
    for (const n of col) {
      const el = els.get(n.id);
      el.style.top = `${y}px`;
      const h = el.offsetHeight;
      box.set(n.id, { l: li * COL_W + PAD_X, r: li * COL_W + PAD_X + NODE_W, t: y, cy: y + h / 2, lane: li });
      y += h + GAP;
    }
  });
  const height = TOP + inner + BOTTOM;
  map.style.height = `${height}px`;

  // Edges.
  const storyPairs = new Set();
  for (let k = 1; k < story.length; k++) { storyPairs.add(`${story[k - 1]}>${story[k]}`); storyPairs.add(`${story[k]}>${story[k - 1]}`); }
  const relClass = (r) => (['causes', 'supports', 'refutes', 'fixes', 'implements', 'verifies', 'mitigates'].includes(r) ? r : 'default');
  const svg = document.getElementById('edges');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  const markers = ['default', 'causes', 'supports', 'refutes', 'fixes', 'implements', 'verifies', 'mitigates']
    .map((r) => `<marker id="arr-${r}" class="rel-${r}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker>`).join('');
  svg.innerHTML = `<defs>${markers}</defs>${edges.map((e, k) => {
    const a = box.get(e.from), b = box.get(e.to);
    let d;
    if (a.lane < b.lane) {
      const c = Math.max(30, (b.l - a.r) / 2);
      d = `M${a.r},${a.cy} C${a.r + c},${a.cy} ${b.l - c},${b.cy} ${b.l - 2},${b.cy}`;
    } else if (a.lane > b.lane) {
      const c = Math.max(30, (a.l - b.r) / 2);
      d = `M${a.l},${a.cy} C${a.l - c},${a.cy} ${b.r + c},${b.cy} ${b.r + 2},${b.cy}`;
    } else {
      const k2 = 34 + Math.min(40, Math.abs(b.cy - a.cy) / 6);
      d = `M${a.r},${a.cy} C${a.r + k2},${a.cy} ${b.r + k2},${b.cy} ${b.r + 2},${b.cy}`;
    }
    const rc = relClass(e.relation);
    const dashed = e.relation === 'refutes' || nodeById.get(e.from).status === 'rejected' || nodeById.get(e.to).status === 'rejected';
    const inStory = storyPairs.has(`${e.from}>${e.to}`);
    return `<g data-edge="${k}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" class="edge-g">
      <path class="edge rel-${rc}${dashed ? ' dashed' : ''}${inStory ? ' story' : ''}" d="${d}" marker-end="url(#arr-${rc})"/>
      <path class="edge-hit" d="${d}"/>
    </g>`;
  }).join('')}`;

  // Edge tooltips.
  let tip = document.querySelector('.tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; document.body.appendChild(tip); }
  svg.querySelectorAll('.edge-hit').forEach((hit) => {
    const e = edges[hit.parentNode.dataset.edge];
    hit.addEventListener('mousemove', (ev) => {
      tip.hidden = false;
      tip.innerHTML = `<b>${esc(nodeById.get(e.from).title)}</b> <i>${esc(human(e.relation))}</i> <b>${esc(nodeById.get(e.to).title)}</b>${e.note ? `<br>${esc(e.note)}` : ''}`;
      tip.style.left = `${Math.min(ev.clientX + 12, innerWidth - 300)}px`;
      tip.style.top = `${ev.clientY + 14}px`;
    });
    hit.addEventListener('mouseleave', () => { tip.hidden = true; });
  });
}

// ---------- selection, focus, story ----------
function focus(id) {
  const map = document.getElementById('map');
  if (!map) return;
  map.querySelectorAll('.hl').forEach((el) => el.classList.remove('hl'));
  if (!id || !adjacency.has(id)) { map.classList.remove('focus'); return; }
  map.classList.add('focus');
  const keep = new Set([id]);
  adjacency.get(id).in.forEach((e) => keep.add(e.from));
  adjacency.get(id).out.forEach((e) => keep.add(e.to));
  map.querySelectorAll('.node').forEach((el) => { if (keep.has(el.dataset.id)) el.classList.add('hl'); });
  map.querySelectorAll('.edge-g').forEach((g) => {
    if (g.dataset.from === id || g.dataset.to === id) g.querySelector('.edge').classList.add('hl');
  });
}

function select(id, story, scroll = true) {
  view.selected = id && nodeById.has(id) ? id : null;
  const si = story.indexOf(view.selected);
  if (si !== -1) view.storyIdx = si;
  // Keep the address shareable without adding a history entry per click.
  const hash = `#/t/${encodeURIComponent(view.id)}${view.selected ? `/${encodeURIComponent(view.selected)}` : ''}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
  document.querySelectorAll('.node.sel').forEach((el) => el.classList.remove('sel'));
  // Open or close the drawer first, so scrolling accounts for the space it covers.
  renderDetail(story);
  const el = view.selected && document.querySelector(`.node[data-id="${CSS.escape(view.selected)}"]`);
  if (el) {
    el.classList.add('sel');
    if (scroll) el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }
  focus(view.selected);
  updateStoryControls(story);
}

function stepStory(story, dir) {
  const next = view.storyIdx === -1 ? 0 : Math.min(story.length - 1, Math.max(0, view.storyIdx + dir));
  view.storyIdx = next;
  select(story[next], story);
}

function updateStoryControls(story) {
  if (!story.length) return;
  const pos = document.getElementById('pos');
  const inStory = view.selected && story.includes(view.selected);
  pos.textContent = inStory ? `Step ${view.storyIdx + 1} of ${story.length}` : `${story.length} steps`;
  document.getElementById('prev').disabled = !inStory || view.storyIdx <= 0;
  document.getElementById('next').disabled = inStory && view.storyIdx >= story.length - 1;
  document.getElementById('next').textContent = inStory ? 'Next →' : 'Start story →';
}

function renderDetail(story) {
  const panel = document.getElementById('detail');
  const wrap = document.getElementById('mapwrap');
  const n = view.selected && nodeById.get(view.selected);
  panel.hidden = !n;
  wrap.classList.toggle('drawer-open', !!n);
  if (!n) { panel.innerHTML = ''; return; }
  const lane = KIND_LANE[n.kind];
  const adj = adjacency.get(n.id);
  const laneLabel = LANES.find((l) => l.id === lane).label;
  const conn = (e, other, dir) => {
    const o = nodeById.get(other);
    const rel = dir === 'out' ? human(e.relation) : `← ${human(e.relation)}`;
    return `<li class="lane-${KIND_LANE[o.kind]}"><span class="rel">${esc(rel)}</span><button class="linkish" data-jump="${esc(o.id)}">${esc(o.title)}</button>${e.note ? `<span class="note">${esc(e.note)}</span>` : ''}</li>`;
  };
  const step = story.indexOf(n.id);
  panel.innerHTML = `
    <div class="panel-head"><h2>Details</h2>
      <span class="head-right">${step !== -1 ? `<span class="pill">Story step ${step + 1}</span>` : ''}
        <button class="btn" data-close aria-label="Close details">✕</button></span>
    </div>
    <div class="body lane-${lane}">
      <div class="kind">${esc(KIND_LABEL[n.kind])}${KIND_LABEL[n.kind] !== laneLabel ? ` · ${esc(laneLabel)}` : ''}</div>
      <h3>${inline(n.title)}</h3>
      <div class="meta">
        ${n.status ? `<span class="pill ${{ confirmed: 'ok', done: 'ok', likely: 'info', open: 'warn', rejected: 'bad' }[n.status] ?? ''}">${esc(n.status)}</span>` : ''}
        ${n.at ? `<span>${esc(fmtDateTime(n.at))}</span>` : ''}
        ${n.actor ? `<span>· ${esc(n.actor)}</span>` : ''}
      </div>
      <div class="text">${n.detail ? richText(n.detail) : '<p class="note">No further detail recorded.</p>'}</div>
      ${n.refs?.length ? `<h4>Sources</h4><ul>${n.refs.map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a></li>`).join('')}</ul>` : ''}
      ${adj.out.length ? `<h4>Leads to</h4><ul>${adj.out.map((e) => conn(e, e.to, 'out')).join('')}</ul>` : ''}
      ${adj.in.length ? `<h4>Comes from</h4><ul>${adj.in.map((e) => conn(e, e.from, 'in')).join('')}</ul>` : ''}
    </div>`;
}
