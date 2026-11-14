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
    if (view?.id !== id) view = { id, selected: step };
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
    .map((s, i) => ({ ...s, role: s.role || 'normal', n: i + 1, col: compIdx.get(s.component) }));
  const ids = new Set(steps.map((s) => s.id));
  let edges = Array.isArray(f.edges) && f.edges.length
    ? f.edges.filter((e) => ids.has(e.from) && ids.has(e.to))
    : steps.slice(1).filter((s) => !s.alongside).map((s, i) => ({ from: steps[i].id, to: s.id }));
  return { title: f.title, comps, steps, edges, bugPath: steps.filter((s) => BUG_ROLES.includes(s.role)) };
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
          ${flow.bugPath.length > 1 ? `
            <span class="follow" aria-label="Follow the bug">
              <button class="btn" id="prev" aria-label="Previous step on the bug path">←</button>
              <span class="pos" id="pos"></span>
              <button class="btn" id="next">Follow the bug →</button>
            </span>` : ''}
        </div>
      </div>
      <div class="legend">
        <span><i class="sw origin"></i>Bug starts here</span>
        <span><i class="sw bug"></i>Bug path</span>
        <span><i class="sw symptom"></i>What the user sees</span>
        <span><i class="sw fix"></i>Fixed here</span>
        <span><i class="sw conc"></i>Runs at the same time</span>
        <span class="hint">Click a step for its code</span>
      </div>
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

// ---------- the code-flow map ----------
// Columns are components, rows are steps in execution order. Steps with
// `alongside` share the row of the step they run next to.
const PAD_X = 18, HEAD_H = 64, ROW_GAP = 46, TOP_PAD = 18, BOTTOM_PAD = 28, CORNER = 8;
let COL_W = 260;
let geo = null; // { boxes, rowTop, rowBottom, occupied } from the last layout
let resizeTimer = null;
let ro = null;

function drawFlow(el) {
  const avail = el.parentElement.clientWidth;
  const n = flow.comps.length;
  COL_W = Math.max(230, Math.min(380, Math.floor(avail / n)));
  const nodeW = COL_W - PAD_X * 2;
  const width = Math.max(avail, n * COL_W);
  const offset = Math.floor((width - n * COL_W) / 2); // centre when there is spare room

  // Rows read left to right, then top to bottom. A step joins the current row
  // when the previous step calls straight into it in a column further right;
  // `alongside` steps join the row of the step they run next to.
  const rowOf = new Map();
  const used = new Set(); // "row,col"
  const linked = (a, b) => flow.edges.some((e) => e.from === a && e.to === b);
  let row = -1;
  let prev = null;
  for (const s of flow.steps) {
    const a = s.alongside ? rowOf.get(s.alongside) : undefined;
    let r;
    if (a !== undefined && !used.has(`${a},${s.col}`)) r = a;
    else if (prev && s.col > prev.col && !used.has(`${row},${s.col}`) && linked(prev.id, s.id)) r = row;
    else r = ++row;
    rowOf.set(s.id, r);
    used.add(`${r},${s.col}`);
    if (!s.alongside) prev = s;
  }
  const rows = row + 1;
  const bugIndex = new Map(flow.bugPath.map((s, i) => [s.id, i + 1]));
  const colX = (c) => offset + c * COL_W;

  el.style.width = `${width}px`;
  el.innerHTML = `
    <div class="flow-head" style="width:${width}px">
      ${flow.comps.map((c, i) => `
        <div class="comp-head kind-${esc(c.kind || 'app')}" style="left:${colX(i)}px;width:${COL_W}px">
          <b>${inline(c.name)}</b>${c.detail ? `<span>${inline(c.detail)}</span>` : ''}
        </div>`).join('')}
    </div>
    <div class="flow-canvas" id="canvas">
      ${flow.comps.map((c, i) => `<div class="col-band${i % 2 ? ' odd' : ''}" style="left:${colX(i)}px;width:${COL_W}px"></div>`).join('')}
      <svg class="wires" id="wires"></svg>
      ${flow.steps.map((s) => `
        <div class="step role-${esc(s.role)}${s.fix ? ' has-fix' : ''}" data-id="${esc(s.id)}" tabindex="0" role="button"
             aria-label="Step ${s.n}: ${esc(s.title)}${ROLE_TAG[s.role] ? ` (${ROLE_TAG[s.role]})` : ''}"
             style="left:${colX(s.col) + PAD_X}px;top:0;width:${nodeW}px">
          <div class="step-top">
            <span class="num">${s.n}</span>
            ${ROLE_TAG[s.role] ? `<span class="tag">${ROLE_TAG[s.role]}${bugIndex.has(s.id) && flow.bugPath.length > 1 ? ` · ${bugIndex.get(s.id)}/${flow.bugPath.length}` : ''}</span>` : ''}
          </div>
          <div class="step-title">${inline(s.title)}</div>
          ${s.location?.path ? `<div class="step-loc" title="${esc(s.location.path)}${s.location.line ? `:${s.location.line}` : ''}"><code>${esc(locLabel(s.location))}</code></div>` : ''}
          ${s.fix ? `<div class="step-fix">Fixed · ${inline(s.fix.label)}</div>` : ''}
        </div>`).join('')}
    </div>`;

  // Measure, then place rows top to bottom.
  const canvas = document.getElementById('canvas');
  const els = new Map([...canvas.querySelectorAll('.step')].map((e) => [e.dataset.id, e]));
  const rowH = Array(rows).fill(0);
  for (const s of flow.steps) rowH[rowOf.get(s.id)] = Math.max(rowH[rowOf.get(s.id)], els.get(s.id).offsetHeight);
  const rowTop = [];
  let y = TOP_PAD;
  for (let r = 0; r < rows; r++) { rowTop[r] = y; y += rowH[r] + ROW_GAP; }
  const height = y - ROW_GAP + BOTTOM_PAD;
  canvas.style.height = `${height}px`;

  const boxes = new Map();
  const occupied = new Map(); // "col,row" -> step id
  for (const s of flow.steps) {
    const r = rowOf.get(s.id);
    const e = els.get(s.id);
    e.style.top = `${rowTop[r]}px`;
    const l = colX(s.col) + PAD_X;
    const h = e.offsetHeight;
    boxes.set(s.id, { l, r: l + nodeW, t: rowTop[r], b: rowTop[r] + h, cx: l + nodeW / 2, cy: rowTop[r] + h / 2, col: s.col, row: r });
    occupied.set(`${s.col},${r}`, s.id);
  }
  geo = { boxes, rowTop, rowH, occupied };

  drawWires(width, height);

  // Re-layout when the panel width changes (window resize, drawer, etc.).
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

// Orthogonal path through points with rounded corners.
function ortho(pts) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1], [x, y] = pts[i], [nx, ny] = pts[i + 1];
    const r = Math.min(CORNER, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
    const ax = x - Math.sign(x - px) * r, ay = y - Math.sign(y - py) * r;
    const bx = x + Math.sign(nx - x) * r, by = y + Math.sign(ny - y) * r;
    d += ` L${ax},${ay} Q${x},${y} ${bx},${by}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${last[0]},${last[1]}`;
}

function wirePath(a, b, dy = 0, dx = 0) {
  const { occupied } = geo;
  const busy = (col, row) => occupied.has(`${col},${row}`);
  const between = (x, y) => { const lo = Math.min(x, y), hi = Math.max(x, y); const out = []; for (let i = lo + 1; i < hi; i++) out.push(i); return out; };
  const LANE_Y = (box) => box.t + 22 + dy; // wires leave and enter at the title line
  // Detours run through the middle of the gap between rows, below or above the tallest step.
  const gapBelow = (r) => geo.rowTop[r] + geo.rowH[r] + ROW_GAP / 2 + dy / 2;
  const gapAbove = (r) => geo.rowTop[r] - ROW_GAP / 2 - dy / 2;
  b = { ...b, cx: b.cx + dx };
  const ARROW = 3;

  if (a.col === b.col) {
    const clear = between(a.row, b.row).every((r) => !busy(a.col, r));
    if (b.row > a.row && clear) return [[a.cx, a.b], [b.cx, b.t - ARROW]];
    const gx = a.r + PAD_X - 4; // the gutter to the right of the column
    return [[a.r, LANE_Y(a)], [gx, LANE_Y(a)], [gx, LANE_Y(b)], [b.r + ARROW, LANE_Y(b)]];
  }
  const dir = b.col > a.col ? 1 : -1;
  const sideA = dir > 0 ? a.r : a.l;
  const sideB = dir > 0 ? b.l - ARROW : b.r + ARROW;
  if (a.row === b.row) {
    if (between(a.col, b.col).every((c) => !busy(c, a.row))) return [[sideA, LANE_Y(a)], [sideB, LANE_Y(b)]];
    const gy = gapBelow(a.row);
    return [[a.cx, a.b], [a.cx, gy], [b.cx, gy], [b.cx, b.b + ARROW]];
  }

  const down = b.row > a.row;
  const endY = down ? b.t - ARROW : b.b + ARROW;
  // 1) across on A's row, then down/up into B.
  const hClear = [...between(a.col, b.col), b.col].every((c) => !busy(c, a.row)) &&
                 between(a.row, b.row).every((r) => !busy(b.col, r));
  if (hClear) return [[sideA, LANE_Y(a)], [b.cx, LANE_Y(a)], [b.cx, endY]];
  // 2) down/up out of A, then across into B's side.
  const vClear = [...between(a.row, b.row), b.row].every((r) => !busy(a.col, r)) &&
                 between(a.col, b.col).every((c) => !busy(c, b.row));
  if (vClear) return [[a.cx, down ? a.b : a.t], [a.cx, LANE_Y(b)], [sideB, LANE_Y(b)]];
  // 3) through the gap next to A's row, then into B.
  const gapY = down ? gapBelow(a.row) : gapAbove(a.row);
  return [[a.cx, down ? a.b : a.t], [a.cx, gapY], [b.cx, gapY], [b.cx, endY]];
}

// Pick the first of a few nudged variants of a wire whose straight segments
// don't run on top of a wire already placed.
let placed = [];
function placeWire(a, b) {
  const overlaps = (pts) => {
    for (let k = 1; k < pts.length; k++) {
      const [x1, y1] = pts[k - 1], [x2, y2] = pts[k];
      for (const [u1, v1, u2, v2] of placed) {
        if (y1 === y2 && v1 === v2 && Math.abs(y1 - v1) < 6 && Math.min(x1, x2) < Math.max(u1, u2) && Math.min(u1, u2) < Math.max(x1, x2)) return true;
        if (x1 === x2 && u1 === u2 && Math.abs(x1 - u1) < 6 && Math.min(y1, y2) < Math.max(v1, v2) && Math.min(v1, v2) < Math.max(y1, y2)) return true;
      }
    }
    return false;
  };
  let pts;
  for (const [dy, dx] of [[0, 0], [16, 18], [16, -18], [32, 36], [-10, -36]]) {
    pts = wirePath(a, b, dy, dx);
    if (!overlaps(pts)) break;
  }
  for (let k = 1; k < pts.length; k++) placed.push([...pts[k - 1], ...pts[k]]);
  return pts;
}

let labelRects = [];
function drawWires(width, height) {
  placed = [];
  labelRects = [];
  const svg = document.getElementById('wires');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  const bug = new Set(flow.bugPath.map((s) => s.id));
  const marker = (k) => `<marker id="m-${k}" class="w-${k}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1,1 L9,5 L1,9 z"/></marker>`;
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';

  let labels = '';
  const paths = flow.edges.map((e, i) => {
    const a = geo.boxes.get(e.from), b = geo.boxes.get(e.to);
    const sa = stepById.get(e.from), sb = stepById.get(e.to);
    const pts = placeWire(a, b);
    const kind = e.kind === 'concurrent' || sa.role === 'concurrent' || sb.role === 'concurrent' ? 'conc'
      : (bug.has(e.from) && bug.has(e.to)) || e.kind === 'error' ? 'bug' : 'norm';
    // Label: a spot along a segment that clears steps and other labels; if none, it
    // stays in the tooltip and the drawer.
    if (e.label) {
      const w = Math.min(ctx.measureText(e.label).width + 12, 300);
      const cands = [];
      for (let k = 1; k < pts.length; k++) {
        const [x1, y1] = pts[k - 1], [x2, y2] = pts[k];
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (y1 === y2 && len >= w + 16) {
          for (const f of [0.5, 0.3, 0.7]) cands.push({ len, l: x1 + (x2 - x1) * f - w / 2, t: y1 - 19 });
        } else if (x1 === x2 && len >= 34) {
          cands.push({ len: len / 4, l: x1 + 6, t: (y1 + y2) / 2 - 9 });
        }
      }
      cands.sort((p, q) => q.len - p.len);
      const hit = (r) => labelRects.some((o) => r.l < o.l + o.w + 4 && o.l < r.l + r.w + 4 && r.t < o.t + 18 + 2 && o.t < r.t + 18 + 2) ||
        [...geo.boxes.values()].some((b) => r.l < b.r && b.l < r.l + r.w && r.t < b.b && b.t < r.t + 18);
      const spot = cands.map((c) => ({ l: c.l, t: c.t, w })).find((r) => !hit(r));
      if (spot) {
        labelRects.push(spot);
        labels += `<div class="wire-label w-${kind}" data-edge="${i}" style="left:${spot.l}px;top:${spot.t}px;width:${w}px">${esc(e.label)}</div>`;
      }
    }
    return `<path class="wire w-${kind}" data-edge="${i}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" d="${ortho(pts)}" marker-end="url(#m-${kind})"><title>${esc(sa.title)} → ${esc(sb.title)}${e.label ? ` (${esc(e.label)})` : ''}</title></path>`;
  });
  // Bug wires on top of the others.
  paths.sort((x, y) => (x.includes('w-bug') ? 1 : 0) - (y.includes('w-bug') ? 1 : 0));
  svg.innerHTML = `<defs>${['norm', 'bug', 'conc'].map(marker).join('')}</defs>${paths.join('')}`;
  document.querySelectorAll('.wire-label').forEach((l) => l.remove());
  document.getElementById('canvas').insertAdjacentHTML('beforeend', labels);
}

// ---------- selection, focus, follow the bug ----------
function focusStep(id) {
  const el = document.getElementById('flow');
  if (!el) return;
  el.querySelectorAll('.hl').forEach((x) => x.classList.remove('hl'));
  if (!id || !stepById.has(id)) { el.classList.remove('focus'); return; }
  el.classList.add('focus');
  const keep = new Set([id]);
  for (const e of flow.edges) {
    if (e.from === id || e.to === id) {
      keep.add(e.from); keep.add(e.to);
      el.querySelectorAll(`[data-edge="${flow.edges.indexOf(e)}"]`).forEach((w) => w.classList.add('hl'));
    }
  }
  el.querySelectorAll('.step').forEach((s) => { if (keep.has(s.dataset.id)) s.classList.add('hl'); });
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
  const i = path.findIndex((s) => s.id === view.selected);
  const next = i === -1 ? 0 : Math.max(0, Math.min(path.length - 1, i + dir));
  select(path[next].id);
}

function updateFollow() {
  const pos = document.getElementById('pos');
  if (!pos || !flow) return;
  const path = flow.bugPath;
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
  const f = e.target.closest('[data-follow]');
  if (f) return followBug(Number(f.dataset.follow));
  const b = e.target.closest('[data-jump]');
  if (b) select(b.dataset.jump, true);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && view?.selected) select(null, false);
});

route();
