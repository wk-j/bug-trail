// Shared state of the trail page, and the case logic that reads it.
import { BUG_ROLES } from '/format.js';

export const store = {
  view: null,          // { id, selected, caseIdx }
  trail: null,
  flow: null,          // normalised flow (lib/model.js)
  stepById: new Map(),
  nodeById: new Map(), // investigation nodes
};

/** The case on screen, or null when the trail has none (then everything is shown). */
export function activeCase() {
  const { flow, view } = store;
  return flow?.cases.length ? flow.cases[Math.min(view?.caseIdx ?? 0, flow.cases.length - 1)] : null;
}

/** Steps the active case doesn't go through are dimmed. */
export function caseOff(id) {
  const c = activeCase();
  return !!c && !c.correct.includes(id) && !c.bug.includes(id);
}

/**
 * An edge is lit when both ends are on a route of the active case and the route doesn't go the
 * long way between them (a shortcut the input never takes stays dim).
 */
export function wireOn(e) {
  const c = activeCase();
  if (!c) return true;
  const { edges } = store.flow;
  const takes = (route) => {
    if (!route.includes(e.from) || !route.includes(e.to)) return false;
    const inRoute = new Set(route);
    const seen = new Set([e.from]);
    const queue = edges.filter((x) => x !== e && x.from === e.from && inRoute.has(x.to)).map((x) => x.to);
    while (queue.length) {
      const n = queue.shift();
      if (n === e.to) return false;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const x of edges) if (x.from === n && inRoute.has(x.to) && !seen.has(x.to)) queue.push(x.to);
    }
    return true;
  };
  return takes(c.correct) || takes(c.bug);
}

/** The bug path the stepper walks: the active case's bug route, else every bug step. */
export function computeBugPath() {
  const { flow, stepById } = store;
  const c = activeCase();
  const pick = c ? c.bug.map((id) => stepById.get(id)) : flow.steps;
  flow.bugPath = pick.filter((s) => s && BUG_ROLES.includes(s.role));
}

export function caseWorks(c) {
  return typeof c.works === 'boolean' ? c.works : !c.bug.some((id) => BUG_ROLES.includes(store.stepById.get(id)?.role));
}
