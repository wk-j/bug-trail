// The list page: a stack of case folders on the desk.
import { esc, inline, fmtDate, getJSON, human } from '/lib/html.js';
import { locLabel, STATUS_TONE, SEVERITY_TONE } from '/lib/model.js';
import { Plaque } from '/ui/plaque.js';
import { Folder } from '/ui/folder.js';
import { Stamp } from '/ui/stamp.js';
import { Tag, Meter } from '/ui/tag.js';
import { Sheet } from '/ui/sheet.js';

export async function renderList(app) {
  let data;
  try { data = await getJSON('/api/trails'); } catch (e) {
    app.innerHTML = Sheet({ title: "Can't load trails", body: `<p>${esc(e.message)}</p>`, tape: true });
    return;
  }
  document.title = 'Bug Trail';
  document.documentElement.lang = 'en';

  const plaque = Plaque({ title: 'Bug trails', sub: `Watching <code>${esc(data.dir)}</code>` });
  if (data.trails.length === 0) {
    app.innerHTML = plaque + Sheet({
      title: 'Map your first bug', variant: 'legal', tape: true,
      body: `<div class="ui-prose">
        <p>Ask any agent to trace an issue with the <b>bug-trail</b> skill. Its map is pinned up here as soon as it writes the file.</p>
        <p><code>Use the bug-trail skill to analyze https://github.com/OWNER/REPO/issues/123</code></p>
        <p>If your agent doesn't have the skill yet: <code>bug-trail skill setup</code></p>
      </div>`,
    });
    return;
  }

  app.innerHTML = `${plaque}<div class="ui-grid">${data.trails.map((t) => Folder({
    href: `#/t/${encodeURIComponent(t.id)}`,
    tab: `${esc(t.issue?.repo ?? t.id)}${t.issue?.number ? `#${t.issue.number}` : ''}`,
    stamp: t.summary?.status ? Stamp({ text: human(t.summary.status), tone: STATUS_TONE[t.summary.status] ?? 'plain', size: 'sm', tilt: 6 }) : '',
    body: `
      <h2 class="case-title">${inline(t.summary?.headline ?? t.issue?.title ?? t.id)}</h2>
      ${t.origin
        ? `<p class="case-origin"><span class="case-origin__pin"></span>Starts in <code>${esc(locLabel(t.origin.location) || t.origin.title)}</code></p>`
        : '<p class="case-origin is-none">No code flow yet</p>'}
      <div class="ui-row">
        ${t.issue?.state ? Tag({ text: t.issue.state === 'open' ? 'Open' : 'Closed', tone: t.issue.state === 'open' ? 'ok' : 'info' }) : ''}
        ${t.summary?.severity ? Tag({ text: `${t.summary.severity} severity`, tone: SEVERITY_TONE[t.summary.severity] ?? 'plain' }) : ''}
        ${typeof t.summary?.confidence === 'number' ? Meter({ value: t.summary.confidence, label: `${Math.round(t.summary.confidence * 100)}% sure` }) : ''}
        ${t.errors ? Tag({ text: `${t.errors} format error${t.errors > 1 ? 's' : ''}`, tone: 'bad' }) : ''}
      </div>
      <p class="case-foot">${t.steps ? `${t.steps} steps · ` : ''}analyzed ${esc(fmtDate(t.analyzed_at))}</p>`,
  })).join('')}</div>`;
}
