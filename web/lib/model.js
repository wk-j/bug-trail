// The trail as the UI sees it: normalised flow, labels and tones for statuses.
import { BUG_ROLES } from '/format.js';
import { basename } from '/lib/html.js';

export const ROLE_TAG = {
  origin: 'Bug starts here',
  propagates: 'Bug spreads',
  symptom: 'User sees this',
  concurrent: 'At the same time',
};

// Tones are shared by Tag and Stamp: ok, info, warn, bad, plain.
export const STATUS_TONE = {
  new: 'plain', investigating: 'info', root_caused: 'warn', fix_in_progress: 'warn',
  fixed: 'ok', wont_fix: 'plain', duplicate: 'plain', cannot_reproduce: 'plain',
};
export const SEVERITY_TONE = { critical: 'bad', high: 'bad', medium: 'warn', low: 'plain' };
export const NODE_TONE = { confirmed: 'ok', done: 'ok', likely: 'info', open: 'warn', rejected: 'bad' };

export const isBugStep = (s) => s.path === 'bug' || BUG_ROLES.includes(s.role);
export const isStore = (c) => c.kind === 'storage' || c.kind === 'external';

/** "chunk_plan.go:14 · ChunkPlan" */
export function locLabel(loc) {
  if (!loc?.path) return '';
  const file = `${basename(loc.path)}${loc.line ? `:${loc.line}` : ''}`;
  return loc.symbol ? `${file} · ${loc.symbol}` : file;
}

export function normalizeFlow(f) {
  if (!f || !Array.isArray(f.components) || !Array.isArray(f.steps)) return null;
  const comps = f.components.filter((c) => c && c.id);
  const compIdx = new Map(comps.map((c, i) => [c.id, i]));
  const steps = f.steps.filter((s) => s && s.id && compIdx.has(s.component))
    .map((s, i) => ({ ...s, role: s.role || 'normal', path: s.path || 'both', n: i + 1, col: compIdx.get(s.component) }));
  const ids = new Set(steps.map((s) => s.id));
  const edges = Array.isArray(f.edges) && f.edges.length
    ? f.edges.filter((e) => ids.has(e.from) && ids.has(e.to))
    : steps.slice(1).filter((s) => !s.alongside).map((s, i) => ({ from: steps[i].id, to: s.id }));
  const cases = (Array.isArray(f.cases) ? f.cases : [])
    .filter((c) => c && c.id && Array.isArray(c.correct) && Array.isArray(c.bug))
    .map((c) => ({ ...c, correct: c.correct.filter((id) => ids.has(id)), bug: c.bug.filter((id) => ids.has(id)) }));
  return { title: f.title, comps, steps, edges, cases, hasCorrect: steps.some((s) => s.path === 'correct'), bugPath: [] };
}
