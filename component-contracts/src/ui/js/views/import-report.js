/**
 * Import report: what came from the code, and what it refused to guess.
 *
 * A re-import merges with the existing contract rather than replacing it, so the
 * report says what was kept, what the code updated, and what was dropped.
 */

import { html } from '../html.js';
import { code, section } from './shared.js';

export function importReportView({ report: r, merge: m }) {
  return html`${section('Import report', 'What came from the code, and what it refused to guess.')}
<div class="stack">
${m ? html`<div class="card card-pad"><div class="card-head"><h3 class="card-title">Merged with the existing contract</h3><span class="badge badge-secondary ok">non-destructive</span></div>
<div class="triple">${[['kept', m.preserved.length], ['updated from code', m.updated.length], ['dropped', m.dropped.length]].map(([label, n]) => html`<div class="stat"><div class="stat-n">${n}</div><div class="stat-label">${label}</div></div>`)}</div>
${m.updated.map((u) => html`<div class="mono small info">${u}</div>`)}${m.dropped.map((d) => html`<div class="mono small danger">${d}</div>`)}</div>` : ''}

<div class="card card-pad"><div class="card-head"><h3 class="card-title">${r.coverage.derived} values read</h3><span class="card-aside">${r.sources.join(' \u00b7 ')}</span></div>
${r.derived.slice(0, 80).map((d) => html`<div class="line"><span class="ok">\u2713</span>${code(d.path)}<span class="small muted">${d.evidence || ''}</span></div>`)}
${r.derived.length > 80 ? html`<div class="small muted">\u2026 and ${r.derived.length - 80} more</div>` : ''}</div>

${r.skipped.length ? html`<div class="card card-pad"><div class="card-head"><h3 class="card-title">${r.skipped.length} not matched</h3><span class="badge badge-outline warn">refused to guess</span></div>
${r.skipped.map((s) => html`<div class="line"><span class="warn">?</span>${code(s.what)}<span class="small muted">${s.why}</span></div>`)}</div>` : ''}

${r.notes.length ? html`<div class="card card-pad"><h3 class="card-title">Calls the importer made</h3><ul class="notes-list">${r.notes.map((n) => html`<li>${n}</li>`)}</ul></div>` : ''}
</div>`;
}
