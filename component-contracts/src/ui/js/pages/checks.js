/**
 * What gets checked: the closure check that decides whether a spec may be written, and
 * every validation rule the validator runs.
 *
 * The rules are parsed from the validator itself, so this list is the list. Each shows
 * the message it raises and, where one has been recorded, why it exists. A rule with no
 * recorded reason says so rather than being given one.
 */

import { html } from '../html.js';
import { code, sub } from '../views/shared.js';
import { td, th, tableBlock, tr } from '../views/table.js';
import { failed, pageShell } from './shell.js';

export const endpoint = '/api/checks';
export const nav = () => [{ id: 'closure', label: 'Closure' }, { id: 'rules', label: 'Validation rules' }];

const SEVERITY = { error: 'sev-error', warn: 'sev-warn', info: 'sev-info' };

export function view({ data, error } = {}) {
  const lede = data ? `${data.totals.rules} validation rules (${data.totals.errors} error, ${data.totals.warnings} warning) plus the closure check.` : null;

  return pageShell({
    title: 'What gets checked',
    source: 'read from src/core/validate.js at request time',
    current: '/checks.html',
    lede,
    nav: nav(),
    children: html`<section class="page-section" id="closure"><h2>The closure check</h2>
<p class="hint">This is the one that decides whether a spec may be written.</p>
${error ? failed('the checks', error) : ''}
${data ? html`<div class="card closure-card"><p class="strong">${data.closure.question}</p><p class="muted">${data.closure.note}</p>
<ul class="closure-list">${data.closure.items.map((i) => html`<li><span class="ok">\u2713</span><span>${i.check}<span class="why">${i.why}</span></span></li>`)}</ul>
<p class="stage-refuses">${data.closure.blocking}</p></div>` : ''}</section>

<section class="page-section" id="rules"><h2>Validation rules</h2>
<p class="hint">Parsed from the validator, so this list is the list. Each rule shows the message it raises; where the reason it exists has been recorded, that is shown too.</p>
${(data?.groups || []).map((g) => tableBlock({ title: g.title, note: g.note },
    [th('Rule'), th('Severity'), th('What it says')],
    g.rules.map((r) => tr([
      td(code(r.code), { nowrap: true }),
      td(html`<span class="badge badge-outline upper ${SEVERITY[r.severity] ?? SEVERITY.info}">${r.severity}</span>`),
      td(html`${r.messages.map((m) => html`<div>${m}</div>`)}${r.intent ? sub(r.intent, 'mt') : ''}${sub(code(`validate.js:${r.line}`), 'mt')}`),
    ]))))}
${data?.ungrouped.length ? html`<p class="warn italic">${data.ungrouped.length} rules are not in any group: ${data.ungrouped.map((u) => u.code).join(', ')}</p>` : ''}</section>`,
  });
}
