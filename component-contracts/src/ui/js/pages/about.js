/**
 * How this tool works: the pipeline, and what each file does.
 *
 * Every description is the file's own opening comment, read when the page loads, so it
 * cannot fall out of date. A file that does not describe itself is shown as undescribed
 * rather than given prose that could go stale.
 */

import { html } from '../html.js';
import { code, sub } from '../views/shared.js';
import { td, th, tableBlock, tr } from '../views/table.js';
import { failed, pageShell } from './shell.js';

export const endpoint = '/api/architecture';
export const nav = () => [{ id: 'pipeline', label: 'Pipeline' }, { id: 'files', label: 'Files' }];

export function view({ data, error } = {}) {
  const totals = data?.totals;
  const lede = totals
    ? `${totals.files} source files, ${totals.lines.toLocaleString()} lines. ${totals.undescribed ? `${totals.undescribed} do not describe themselves.` : 'Every file describes itself.'}`
    : null;

  return pageShell({
    title: 'How this tool works',
    source: 'read from the source at request time',
    current: '/about.html',
    lede,
    nav: nav(),
    children: html`<section class="page-section" id="pipeline"><h2>The pipeline</h2>
<p class="hint">A component becomes a contract, the contract is narrowed to one platform, and that result is written as a single file. Each stage may only narrow what the previous stage said \u2014 nothing invents.</p>
${error ? failed('the pipeline', error) : ''}
<div class="stack">${(data?.pipeline || []).map((s, i) => html`<div class="card stage-card"><div class="stage-head"><span class="stage-n">${i + 1}</span><h3 class="card-title">${s.title}</h3><span class="mono small muted">${s.command}</span></div>
<div class="stage-flow">${code(s.input)}<span class="muted">\u2192</span>${code(s.output)}</div>
<p>${s.does}</p>
<p class="stage-refuses"><b>Refuses:</b> ${s.refuses}</p></div>`)}</div></section>

<section class="page-section" id="files"><h2>What each file does</h2>
<p class="hint">Each description is the file\u2019s own opening comment. A file that does not describe itself is shown as undescribed rather than given prose that could go stale.</p>
${(data?.groups || []).map((g) => tableBlock({ title: g.title, note: html`${g.note} ${code(`${g.dir}/`)}` },
    [th('File'), th('Lines', { numeric: true }), th('What it does')],
    g.files.map((f) => tr([
      td(code(f.name), { nowrap: true }),
      td(f.lines, { numeric: true, className: 'muted' }),
      td(html`${f.summary ?? html`<span class="warn italic">no description in the file</span>`}${f.detail?.length ? sub(f.detail[0], 'mt') : ''}`),
    ]))))}
${data ? html`<p class="small muted">Descriptions are read from each file when this page loads, so they cannot fall out of date.</p>` : ''}</section>`,
  });
}
