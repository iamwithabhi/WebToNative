/**
 * Platform mapping: every web concept and the iOS and Android name it becomes.
 *
 * The tables are read from src/core/platform-map.json when the page loads, the same module the emitters
 * use, so this page cannot drift from what the tool does. A value is the platform's own name; "native"
 * means the control already carries it; a dash means no equivalent, which is shown rather than hidden.
 */

import { html, raw } from '../html.js';
import { code, sub } from '../views/shared.js';
import { td, th, tableBlock, tr } from '../views/table.js';
import { failed, pageShell } from './shell.js';

export const endpoint = '/api/mapping';

const countRows = (s) => (s.rows ? s.rows.length : (s.subtables ?? []).reduce((n, t) => n + t.rows.length, 0));

/** The sections as nav entries, with the one in view highlighted. */
export const nav = (sections = [], active = null) => sections.map((s) => ({ id: s.id, label: s.title, active: s.id === active }));

/**
 * One cell. A value the platform names is an identifier, so it is code. A sentence that explains
 * (a "why not", a note, a meaning) is text, not code: it is told from a keyword by having spaces.
 * The legend at the top explains the three styles a person has to read: a value, "native", a dash.
 */
function cell(c) {
  const sentence = (c.kind === 'plain' || c.kind === 'warn') && /\s/.test(c.text);
  const tone = { warn: 'warn', plain: 'keyword', hidden: 'muted' }[c.kind] ?? '';
  return td(html`${c.kind === 'missing' ? html`<span class="muted">${c.text}</span>`
    : sentence ? html`<span class="${c.kind === 'warn' ? 'warn' : 'muted'}">${c.text}</span>`
    : code(c.text, tone)}${c.actions?.length ? sub(`+ ${c.actions.join(', ')}`, 'tight') : ''}`);
}

// The header pins under the page's own header while the table scrolls, so the block must not clip.
const grid = (t, title) => tableBlock({ title, sticky: true }, t.columns.map((c) => th(c, { sticky: true })), t.rows.map((r) => tr(r.cells.map(cell))));

export function view({ data, error, active = null } = {}) {
  const sections = data?.sections ?? [];
  const rows = sections.reduce((n, s) => n + countRows(s), 0);

  return pageShell({
    title: 'Platform mapping',
    source: raw('<a href="/platform-map.json">src/core/platform-map.json</a>'),
    current: '/mapping.html',
    lede: data ? `${rows} mappings across ${sections.length} tables, read from the module at request time \u2014 this page cannot drift from the code the emitters use.` : null,
    nav: nav(sections, active),
    children: html`<div class="legend"><span>${code('value')} the platform\u2019s own name</span><span>${code('native', 'keyword')} control already carries it</span><span>\u2014 no equivalent</span></div>
${error ? failed('the mapping', error) : ''}
${sections.map((s) => html`<section class="page-section" id="${s.id}"><h2>${s.title}</h2>${s.note ? html`<p class="hint">${s.note}</p>` : ''}${s.subtables ? s.subtables.map((st) => grid(st, st.title)) : grid(s)}</section>`)}`,
  });
}
