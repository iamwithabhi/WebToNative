/**
 * Platform specs: one directory per component, one folder per platform.
 *
 * Values are fully resolved, with no cascade left to apply and no curve left to
 * convert. A platform that is not closed says how many values are unresolved.
 */

import { html } from '../html.js';
import { platformName, withPlatformNames } from '../lib/platform.js';
import { banner, quiet } from './shared.js';

export function specsView({ previews }) {
  if (!previews.length) return quiet('Resolving\u2026');

  return html`${banner('One directory per component, one folder per platform. Values are fully resolved \u2014 no cascade left to apply, no curve left to convert.')}
<div class="stack">${previews.map((p) => {
    const notable = p.diagnostics.filter((d) => d.level !== 'info');
    return html`<div class="card card-pad"><div class="card-head"><h3 class="card-title">${platformName(p.platform)}</h3><span class="${p.closure.closed ? 'badge badge-secondary ok' : 'badge badge-outline warn'}">${p.closure.closed ? 'complete' : 'incomplete'}</span></div>
${p.closure.closed
    ? html`<div class="files">${p.files.map((f) => html`<div>${f}</div>`)}</div>`
    : html`<div class="unresolved"><b>${p.closure.problems.length} unresolved</b>${p.closure.problems.slice(0, 5).map((x) => html`<div class="mono small">${withPlatformNames(x)}</div>`)}</div>`}
${notable.length ? html`<div class="notes">${notable.map((d) => html`<div>${withPlatformNames(d.message)}</div>`)}</div>` : ''}</div>`;
  })}</div>`;
}
