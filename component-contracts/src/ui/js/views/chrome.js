/**
 * The frame around a component: the rail, the status column, the header, and the chips that
 * switch pages.
 *
 * Each is a function from plain state to markup. Save is not a standing button: it appears
 * inside the open component's own list item, and only while that component has unsaved edits.
 * The pages are chips (still a tab list, so the roles, arrow keys and `aria-selected` are right).
 */

import { html, raw, cx } from '../html.js';
import { platformName, withPlatformNames } from '../lib/platform.js';
import { icon } from './icons.js';
import { findingMark } from './shared.js';

/** The three generated pages, linked from the top of every view. */
export const LINKS = [
  ['/about.html', 'How it works', 'How this tool works'],
  ['/checks.html', 'Checks', 'What gets checked'],
  ['/mapping.html', 'Platform mapping', 'How web concepts map to iOS and Android'],
];

export const themeButton = (dark) =>
  html`<button class="btn btn-ghost btn-icon" data-action="theme" title="Toggle theme" aria-label="Toggle theme">${icon(dark ? 'sun' : 'moon')}</button>`;

/** The inside of the components rail. */
export function railView({ contracts, id, dirty, dark = true }) {
  return html`<div class="rail-head">
<div class="logo">ToNative</div>
<div class="tagline">Web to Native</div>
</div>
<div class="rail-list">${contracts.map((c) => {
    const active = c.id === id;
    // A container, not a button: a button cannot hold a button, and Save is the opener's sibling,
    // so the opener's name stays the component's.
    return html`<div class="${cx('rail-item', active && 'active')}"><button class="rail-open" data-action="open" data-id="${c.id}"${active ? raw(' aria-current="true"') : ''}><div class="rail-name">${c.name}</div><div class="rail-meta">${c.variants} variants \u00b7 ${c.states} states</div></button>${active && dirty ? html`<button class="btn btn-default btn-xs rail-save" data-action="save">Save</button>` : ''}</div>`;
  })}</div>
<div class="rail-foot"><button class="btn btn-secondary btn-sm grow" data-action="add-open">Add component</button>${themeButton(dark)}</div>`;
}

/** The inside of the status column: is the contract complete, which platforms resolve, what is open. */
export function inspectorView({ validation, previews, building = false, id }) {
  if (!id || !validation) return '';
  const errors = validation.counts.error;
  const ready = errors === 0;
  const notes = validation.findings.filter((f) => f.severity !== 'info');

  return html`<div class="status-scroll"><div class="status-body">
<div class="${cx('card status-card', ready && 'status-ready')}">
<div class="status-top"><div class="status-big">${ready ? '\u2713' : errors}</div><span class="${cx('badge badge-outline', ready ? 'ok' : 'warn-badge')}">${ready ? 'complete' : `${errors} unresolved`}</span></div>
<div class="status-sub">${ready ? 'fully resolved' : errors === 1 ? 'unresolved value' : 'unresolved values'}</div>
<p class="status-text">${ready ? 'Every value the platforms need is present.' : 'These are not in the component. Specs can still be generated \u2014 anything unresolved reaches the platform as a null.'}</p>
</div>
${previews.length ? html`<div class="card status-platforms">${previews.map((p) => html`<div class="status-platform"><span class="${cx('dot', p.closure.closed ? 'dot-ok' : 'dot-bad')}" aria-hidden="true"></span>${platformName(p.platform)}</div>`)}</div>` : ''}
${notes.length ? html`<div><div class="notes-head">${notes.length} note${notes.length > 1 ? 's' : ''}</div><div class="notes-body">${notes.slice(0, 12).map((f) => html`<div class="note">${findingMark(f.severity)}<span>${withPlatformNames(f.question || f.message)}</span></div>`)}${notes.length > 12 ? html`<div class="small muted">\u2026 and ${notes.length - 12} more</div>` : ''}</div></div>` : ''}
</div></div>
<div class="status-foot"><button class="${cx('btn btn-block', ready ? 'btn-default' : 'btn-warning')}" data-action="build"${building ? raw(' disabled') : ''}>${building ? 'Generating\u2026' : ready ? 'Generate platform specs' : 'Generate anyway'}</button>
<p class="small muted">iOS and Android. Resolved values, Swift and Kotlin specs, conformance assertions.</p></div>`;
}

/**
 * The top of the main column: the component's name and version (on one baseline, in a group of their
 * own so the links stay centred) and the three reference pages. The text is quiet on purpose.
 */
export function headerView({ contract, ready }) {
  const title = ready ? (contract?.name || contract?.id || 'Nothing added yet') : '\u2014';
  return html`<div class="title-group"><h1 class="title">${title}</h1>${contract ? html`<span class="version">v${contract.contractVersion}</span>` : ''}</div>
<nav class="header-nav" aria-label="Reference pages">${LINKS.map(([href, label, hint]) => html`<a class="btn btn-ghost btn-sm header-link" href="${href}" title="${hint}">${label}</a>`)}</nav>`;
}

/** The pages of a component, as chips. `errorsFor(key)` is how many unresolved values a page carries. */
export const chipsView = ({ tabs, tab, errorsFor }) =>
  html`<div class="page-chips" role="tablist" aria-label="Pages">${tabs.map(([key, label]) => {
    const n = errorsFor(key);
    const active = key === tab;
    return html`<button class="page-chip" role="tab" id="tab-${key}" aria-selected="${String(active)}" tabindex="${active ? 0 : -1}" data-action="tab" data-tab="${key}">${label}${n ? html`<span class="badge badge-count">${n}</span>` : ''}</button>`;
  })}</div>`;

/** Shown when there are no components yet. */
export const emptyView = () =>
  html`<div class="empty"><h3>Point it at a component</h3><p>It reads what the component already defines and shows what that means on iOS and Android \u2014 tokens, motion, accessibility, and everything left to each platform.</p><button class="btn btn-default" data-action="add-open">Add component</button></div>`;

/** The message shown when the reader could not start at all. */
export const fatalView = (message) => html`<div class="empty"><h3>Could not start</h3><p>${message}</p></div>`;
