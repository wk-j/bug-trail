// The evidence board: lays out the system map and draws it with board components.
// Components are pinned index cards (grouped on kraft sheets by `group`), storage and external
// systems are file boxes in a band below, steps are sticky notes under the card they run in,
// and the flows are yarn: red for the bug, green for the correct logic, plain for shared steps.
import { esc, inline } from '/lib/html.js';
import { store, caseOff, wireOn } from '/lib/store.js';
import { isBugStep, isStore, locLabel } from '/lib/model.js';
import { linkTerms } from '/lib/glossary.js';
import { settle } from '/lib/motion.js';
import { IndexCard } from '/ui/index-card.js';
import { StickyNote } from '/ui/sticky-note.js';

const GAP_X = 64, PAD = 28, GROUP_PAD = 20, GROUP_HEAD = 34, NODE_H = 56, NOTE_H = 28,
  NOTE_GAP = 9, STACK_GAP = 32, BAND_GAP = 30, NOTE_MAX = 262;

let gfx = null;
let resizeTimer = null;
let ro = null;

// Measure with whatever font the page ends up using; the board names no font of its own.
const textWidth = (() => {
  const ctx = document.createElement('canvas').getContext('2d');
  return (t, px, weight = 400) => {
    ctx.font = `${weight} ${px}px ${getComputedStyle(document.body).fontFamily}`;
    return ctx.measureText(String(t ?? '')).width;
  };
})();

const noteTone = (s) => (s.path === 'correct' ? 'green' : s.role === 'symptom' ? 'orange'
  : s.role === 'concurrent' ? 'blue' : isBugStep(s) ? 'pink' : 'yellow');
const noteFlags = (s) => [
  ...(s.role === 'origin' ? [{ text: 'bug starts', tone: 'bad' }] : []),
  ...(s.role === 'symptom' ? [{ text: 'user sees', tone: 'warn' }] : []),
  ...(s.fix ? [{ text: 'fixed', tone: 'ok' }] : []),
];
const noteTilt = (s) => ((s.n * 37) % 7 - 3) * 0.35;

function note(s, { width, top, left, height, measure = false, i = 0 } = {}) {
  return StickyNote({
    n: s.n,
    html: inline(s.title),
    tone: noteTone(s),
    flags: noteFlags(s),
    tilt: measure ? 0 : noteTilt(s),
    cls: `step role-${s.role}${!measure && caseOff(s.id) ? ' off' : ''}`,
    attrs: measure ? { 'data-m': s.id } : {
      'data-id': s.id, tabindex: '0', role: 'button',
      title: `${s.title}${s.location?.path ? ` — ${locLabel(s.location)}` : ''}`,
    },
    // --i: the order notes are stuck on when the board is first drawn (ui/sticky-note.css).
    style: measure ? `width:${width}px` : `left:${left}px;top:${top}px;width:${width}px;height:${height}px;--i:${i}`,
  });
}

/** Lay out and draw the board into `el` (inside a CorkBoard surface). */
export function drawBoard(el) {
  const { flow, stepById } = store;
  const avail = el.parentElement.clientWidth;
  const comps = flow.comps;
  const stepsOf = new Map(comps.map((c) => [c.id, flow.steps.filter((s) => s.component === c.id)]));

  // Component-level yarn, one per (from, to, flow), from the step edges that cross components.
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

  // Widths from text; note heights from the rendered notes.
  const size = new Map();
  for (const c of comps) {
    const notes = stepsOf.get(c.id);
    const nodeW = Math.max(160, textWidth(c.name, 13.5, 700), textWidth(c.detail, 12)) + 40;
    const extra = (st) => 46 + (st.role === 'origin' || st.role === 'symptom' ? 78 : 0) + (st.fix ? 50 : 0);
    const noteW = notes.length ? Math.min(NOTE_MAX, Math.max(...notes.map((st) => textWidth(st.title, 12.5) + extra(st)))) : 0;
    size.set(c.id, { nodeW, noteW, w: Math.max(nodeW, noteW) });
  }
  const probe = document.createElement('div');
  probe.className = 'board-measure';
  probe.innerHTML = flow.steps.map((st) => note(st, { width: size.get(st.component).noteW, measure: true })).join('');
  el.appendChild(probe);
  const measured = new Map([...probe.children].map((d) => [d.dataset.m, Math.max(NOTE_H, Math.ceil(d.getBoundingClientRect().height))]));
  probe.remove();
  for (const c of comps) {
    const sz = size.get(c.id);
    sz.noteH = stepsOf.get(c.id).map((st) => measured.get(st.id) ?? NOTE_H);
    sz.h = NODE_H + (sz.noteH.length ? 18 + sz.noteH.reduce((a, b) => a + b + NOTE_GAP, 0) - NOTE_GAP : 0);
  }

  // Columns are shared by all groups so the flow reads left to right.
  const flowComps = order.filter((c) => !isStore(c));
  const stores = order.filter(isStore);
  const maxRank = Math.max(0, ...comps.map((c) => rank.get(c.id)));
  const colW = Array(maxRank + 1).fill(0);
  for (const c of comps) colW[rank.get(c.id)] = Math.max(colW[rank.get(c.id)], size.get(c.id).w);
  const colX = [];
  let x = PAD + GROUP_PAD;
  for (let r = 0; r <= maxRank; r++) { colX[r] = x; x += colW[r] + GAP_X; }

  // Groups in order of first appearance; storage gets its own band below.
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
  // One module needs no sheet behind it; only draw groups when there are several.
  const boxed = groups.filter((g) => g.label).length > 1;

  // Groups whose columns don't overlap share a band, side by side.
  const bands = [];
  for (const [gi, g] of groups.entries()) {
    const ranks = new Set(g.comps.map((c) => rank.get(c.id)));
    const fit = g.stores ? null : bands.find((bd) => !bd.stores && [...ranks].every((r) => !bd.ranks.has(r)));
    if (fit) { fit.groups.push(gi); ranks.forEach((r) => fit.ranks.add(r)); }
    else bands.push({ groups: [gi], ranks, stores: !!g.stores });
  }
  const bandOfComp = new Map();
  bands.forEach((bd, bi) => bd.groups.forEach((gi) => groups[gi].comps.forEach((c) => bandOfComp.set(c.id, bi))));
  // Returns to an earlier column in the same band run through the lane above the cards.
  const ups = cedges.filter((e) => !skips.includes(e) && bandOfComp.get(e.from) === bandOfComp.get(e.to)
    && rank.get(e.to) < rank.get(e.from));

  const place = new Map();
  let y = PAD;
  const sheets = [];
  for (const [bi, bd] of bands.entries()) {
    const top = y;
    const labelled = boxed && bd.groups.some((gi) => groups[gi].label);
    const lanes = [...skips, ...ups].filter((e) => bandOfComp.get(e.from) === bi).length;
    const laneTop = top + (labelled ? GROUP_HEAD : GROUP_PAD / 2) + 6;
    const inner = laneTop + (lanes ? lanes * 10 + 10 : 4);
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
      sheets.push({ label: g.label, l: Math.min(...xs.map((p) => p.x)) - GROUP_PAD, r: Math.max(...xs.map((p) => p.x + p.w)) + GROUP_PAD, t: top, b: bottom });
    }
    y = bottom + BAND_GAP;
  }
  const backCount = cedges.filter((e) => !ups.includes(e)).filter((e) => {
    const a = place.get(e.from), b = place.get(e.to);
    return b.x + b.w / 2 < a.x + a.w / 2 - 4;
  }).length;
  const contentBottom = y - BAND_GAP;
  const height = contentBottom + 26 + backCount * 12 + PAD;
  const contentW = x - GAP_X + PAD + GROUP_PAD;
  const width = Math.max(avail, contentW);
  const shift = Math.max(0, Math.floor((avail - contentW) / 2));
  el.parentElement.classList.toggle('fits', contentW <= avail);
  el.style.width = `${width}px`;

  el.innerHTML = `
    <div class="board" id="canvas" style="height:${height}px">
      ${sheets.map((g) => `<div class="board-group" style="left:${g.l + shift}px;top:${g.t}px;width:${g.r - g.l}px;height:${g.b - g.t}px"><span class="board-group__tape">${esc(g.label)}</span></div>`).join('')}
      <svg class="board-yarn" id="wires"></svg>
      ${comps.map((c, ci) => {
        const p = place.get(c.id);
        const nx = p.x + shift + (p.w - p.nodeW) / 2;
        const px = p.x + shift + (p.w - p.noteW) / 2;
        return IndexCard({
          title: c.name, sub: c.detail, kind: c.kind || 'app', cls: 'cnode',
          attrs: { 'data-comp': c.id }, style: `left:${nx}px;top:${p.y}px;width:${p.nodeW}px;height:${NODE_H}px;--i:${ci}`,
        }) + stepsOf.get(c.id).map((s, k) => note(s, {
          left: px, width: p.noteW, height: p.noteH[k], i: ci + k + 1,
          top: p.y + NODE_H + 18 + p.noteH.slice(0, k).reduce((a, b) => a + b + NOTE_GAP, 0),
        })).join('');
      }).join('')}
    </div>`;

  const boxes = new Map();
  for (const c of comps) {
    const p = place.get(c.id);
    const l = p.x + shift + (p.w - p.nodeW) / 2;
    boxes.set(c.id, { l, r: l + p.nodeW, t: p.y, b: p.y + NODE_H, cx: l + p.nodeW / 2, cy: p.y + NODE_H / 2,
      slotL: p.x + shift, slotR: p.x + shift + p.w, stackBottom: p.y + p.h, notes: stepsOf.get(c.id).length });
  }
  linkTerms(el);
  gfx = { boxes, cedges, contentBottom, skips: new Set(skips), ups: new Set(ups), bandOfComp,
    laneTop: new Map([...skips, ...ups].map((e) => [e, groups[groupOf.get(e.from)].laneTop])) };
  drawYarn(width, height);

  if (ro) ro.disconnect();
  ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const f = document.getElementById('flow');
      if (f && Math.abs(f.parentElement.clientWidth - avail) > 4) { settle(); drawBoard(f); focusStep(store.view?.selected); markSelected(); }
    }, 100);
  });
  ro.observe(el.parentElement);
}

function drawYarn(width, height) {
  const { stepById } = store;
  const svg = document.getElementById('wires');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  const { boxes, cedges, contentBottom } = gfx;
  const marker = (k) => `<marker id="m-${k}" class="board-head w-${k}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1,1 L9,5 L1,9 z"/></marker>`;

  // Parallel strands between the same two cards sit side by side.
  const pairs = new Map();
  for (const e of cedges) {
    const k = [e.from, e.to].sort().join('|');
    if (!pairs.has(k)) pairs.set(k, []);
    pairs.get(k).push(e);
  }
  const offset = (e) => { const list = pairs.get([e.from, e.to].sort().join('|')); return (list.indexOf(e) - (list.length - 1) / 2) * 9; };

  let backIdx = 0;
  const laneUsed = new Map();
  const paths = cedges.map((e, ei) => {
    const a = boxes.get(e.from), b = boxes.get(e.to);
    const o = offset(e);
    let d;
    if (gfx.skips.has(e)) {
      // Skips columns: rise into the lane above the cards, run across, drop into B.
      const top = gfx.laneTop.get(e);
      const k = laneUsed.get(top) || 0; laneUsed.set(top, k + 1);
      const yl = top + 4 + k * 10, y1 = a.cy + o, y2 = b.cy + o, R = 10;
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
      // Into another band: across to the gap before B's column, then up or down, then in.
      const xg = Math.min(b.l, b.slotL) - 14 - (o > 0 ? 6 : 0), y1 = a.cy + o, y2 = b.cy + o, R = 10;
      const dir = y2 > y1 ? 1 : -1;
      d = `M${a.r},${y1} L${xg - R},${y1} Q${xg},${y1} ${xg},${y1 + dir * R} L${xg},${y2 - dir * R} Q${xg},${y2} ${xg + R},${y2} L${b.l - 3},${y2}`;
    } else if (b.l > a.r + 8) {
      // Forward: a gentle sag of yarn from A's right side to B's left side.
      const y1 = a.cy + o, y2 = b.cy + o, dx = Math.max(36, (b.l - a.r) / 2);
      d = `M${a.r},${y1} C${a.r + dx},${y1 + 8} ${b.l - dx},${y2 + 8} ${b.l - 3},${y2}`;
    } else if (Math.abs(a.cx - b.cx) < 8) {
      const xr = Math.max(a.r, b.r) + 34;
      d = `M${a.r},${a.cy + o} C${xr},${a.cy + o} ${xr},${b.cy + o} ${b.r + 3},${b.cy + o}`;
    } else {
      // Back to the left: drop below everything, run left, come up into B's left side.
      const yb = contentBottom + 20 + backIdx++ * 12;
      const xl = Math.min(b.l, b.slotL) - 14 - backIdx * 6;
      const sx = a.cx + o, R = 10;
      d = `M${sx},${a.stackBottom + 4} L${sx},${yb - R} Q${sx},${yb} ${sx - R},${yb} L${xl + R},${yb} Q${xl},${yb} ${xl},${yb - R} L${xl},${b.cy + o + R} Q${xl},${b.cy + o} ${xl + R},${b.cy + o} L${b.l - 3},${b.cy + o}`;
    }
    const steps = [...new Set(e.edges.flatMap((x) => [x.from, x.to]))].join(' ');
    const on = e.edges.some(wireOn);
    const title = e.edges.map((x) => `${stepById.get(x.from).n} → ${stepById.get(x.to).n}${x.label ? `: ${x.label}` : ''}`).join('\n');
    const dashed = e.kind === 'conc' || (e.kind === 'norm' && b.l <= a.r);
    // Solid yarn is measured as length 1 so board.css can draw it along its length as it arrives.
    return `<path class="wire board-strand w-${e.kind}${on ? '' : ' off'}${dashed && e.kind === 'norm' ? ' dashed' : ''}" data-steps="${esc(steps)}" data-e="${ei}" d="${d}"${dashed ? '' : ' pathLength="1"'} style="--i:${ei}" marker-end="url(#m-${e.kind})"><title>${esc(title)}</title></path>`;
  });
  // A thread from each card down through its notes.
  const threads = [...boxes.values()].filter((bx) => bx.notes).map((bx) =>
    `<line class="board-thread" x1="${bx.cx}" y1="${bx.b}" x2="${bx.cx}" y2="${bx.stackBottom - 12}"/>`);
  paths.sort((p, q) => (/w-(bug|ok)/.test(p) ? 1 : 0) - (/w-(bug|ok)/.test(q) ? 1 : 0));
  svg.innerHTML = `<defs>${['norm', 'bug', 'conc', 'ok'].map(marker).join('')}</defs>${threads.join('')}${paths.join('')}`;
}

/** The active case changed: dim what it doesn't touch, in place, so the change fades over. */
export function applyCase(el) {
  if (!el || !store.flow) return;
  el.querySelectorAll('.step').forEach((s) => s.classList.toggle('off', caseOff(s.dataset.id)));
  el.querySelectorAll('.wire').forEach((w) => {
    const e = gfx.cedges[Number(w.dataset.e)];
    if (e) w.classList.toggle('off', !e.edges.some(wireOn));
  });
}

/** Highlight a step, the steps it connects to, their cards and the yarn between them. */
export function focusStep(id) {
  const { flow, stepById } = store;
  const el = document.getElementById('flow');
  if (!el || !flow) return;
  el.querySelectorAll('.hl').forEach((x) => x.classList.remove('hl'));
  if (!id || !stepById.has(id)) { el.classList.remove('focus'); return; }
  el.classList.add('focus');
  const keep = new Set([id]);
  for (const e of flow.edges) if (e.from === id || e.to === id) { keep.add(e.from); keep.add(e.to); }
  el.querySelectorAll('.step').forEach((s) => { if (keep.has(s.dataset.id)) s.classList.add('hl'); });
  el.querySelectorAll('.wire').forEach((w) => { if (w.dataset.steps.split(' ').includes(id)) w.classList.add('hl'); });
  el.querySelectorAll('.cnode').forEach((n) => {
    if ([...keep].some((k) => stepById.get(k)?.component === n.dataset.comp)) n.classList.add('hl');
  });
}

/** Mark the selected step's note; returns it. */
export function markSelected() {
  document.querySelectorAll('.step.sel').forEach((e) => e.classList.remove('sel'));
  const id = store.view?.selected;
  const el = id && document.querySelector(`.step[data-id="${CSS.escape(id)}"]`);
  if (el) el.classList.add('sel');
  return el;
}
