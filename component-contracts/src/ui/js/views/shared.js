/**
 * The small pieces every pane is made of: a banner, a section heading, a list of facts, a token
 * shown by name, a chip, and the findings that point at a pane.
 *
 * Each is a function from plain values to markup and reads nothing global, so a pane can be built
 * from fixture data in a test. Identifiers are `code`, values on the Props and Events panes are
 * `chip`s, a second line under a value is `sub`; the table scheme lives in table.js.
 */

import { html, cx } from '../html.js';
import { withPlatformNames } from '../lib/platform.js';
import { applied } from '../lib/tokens.js';
import { icon } from './icons.js';

export const banner = (content) => html`<div class="banner" role="note">${icon('info')}<div>${content}</div></div>`;

export const section = (title, hint, id) =>
  html`<div class="section"${id ? html` id="${id}"` : ''}><h2>${title}</h2>${hint ? html`<p class="hint">${hint}</p>` : ''}</div>`;

export const facts = (rows) => html`<div class="card facts">${rows}</div>`;

export const fact = (label, content) =>
  html`<div class="fact"><div class="fact-label">${label}</div><div class="fact-value">${content}</div></div>`;

/** A short word or value in a pill, set in the code font. The trailing space is real text, so chips read as separate words when copied. */
export const chip = (text) => html`<span class="badge chip">${text}</span> `;

/** A list of chips: a flex row, so a pill never nudges the height of the line it sits in. */
export const chipList = (children) => html`<div class="chip-list">${children}</div>`;

export const none = (text = 'not set') => html`<span class="none">${text}</span>`;

export const chips = (items) => (items?.length ? chipList(items.map(chip)) : none('none'));

/** A secondary line under a value. */
export const sub = (content, className) => html`<div class="${cx('sub', className)}">${content}</div>`;

/** An identifier: a name, a code, a selector, a snippet. One size everywhere, so it never depends on its surroundings. */
export const code = (text, className) => html`<code class="${cx('code', className)}">${text}</code>`;

export const required = () => html`<span class="badge badge-secondary required">required</span>`;

const swatch = ({ className, style, title } = {}) =>
  html`<span class="${cx('swatch', className)}"${title ? html` title="${title}"` : ''}${style ? html` style="${style}"` : ''}></span>`;

/** A value as applied: a swatch and a readable name, never a raw `{path}`. */
export function token(value, tokenMap = new Map()) {
  const a = applied(value, tokenMap);
  if (a.kind === 'unset') return none('not set');
  if (a.kind === 'literal') return html`<span class="token">${swatch({ className: a.none ? 'swatch-none' : 'swatch-literal' })}${a.text}</span>`;
  return html`<span class="token">${swatch(a.color
    ? { style: `background:${a.color}` }
    : { className: 'swatch-unknown', title: 'The value comes from the platform token library' })}${a.label}${a.value ? html`<span class="token-value">${a.value}</span>` : ''}</span>`;
}

export const findingMark = (severity) =>
  html`<span class="${cx('mark', severity === 'error' ? 'mark-error' : 'mark-warn')}" aria-label="${severity === 'error' ? 'unresolved' : 'open question'}">${severity === 'error' ? '!' : '?'}</span>`;

/** The findings that point at a pane, so a gap shows where it belongs. `chipPaths` draws where a question points as a chip. */
export function gapList(items = [], { chipPaths = false } = {}) {
  // The container is always drawn, empty or not: app.js refreshes it in place while someone is typing on
  // the Overview, so that the field they are typing in is never replaced. An empty one is hidden by CSS.
  return html`<div class="gaps" data-gaps data-testid="gaps">${items.map((f) => html`<div class="gap">${findingMark(f.severity)}<span>${withPlatformNames(f.question || f.message)}${chipPaths
    ? html`<span class="gap-path">${chip(f.path)}</span>`
    : html`<span class="gap-path gap-path-mono">${f.path}</span>`}</span></div>`)}</div>`;
}

/** An empty state: a sentence, and optionally why. */
export const quiet = (content) => html`<div class="quiet">${content}</div>`;
