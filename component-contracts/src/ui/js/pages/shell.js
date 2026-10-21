/**
 * The frame the three reference pages share: a title, where it was read from, links to the other
 * pages, and a sticky section nav. They scroll as pages; the app itself scrolls inside its panes.
 *
 * Each page fetches JSON the server already builds from the source (the validator, the files' own
 * comments, the mapping table), so none of them can say anything the code does not.
 */

import { html, cx } from '../html.js';

const PAGES = [
  ['/', 'components'],
  ['/about.html', 'how it works'],
  ['/checks.html', 'checks'],
  ['/mapping.html', 'platform mapping'],
];

/** The sticky list of sections. Drawn on its own so a page can move the highlight without redrawing the page. */
export const navView = (items) =>
  html`<nav class="page-nav" aria-label="Sections">${items.map((n) => html`<a class="${cx('btn btn-sm', !n.active && 'btn-ghost')}" href="#${n.id}"${n.active ? html` aria-current="true"` : ''}>${n.label}</a>`)}</nav>`;

export const pageShell = ({ title, source, current, lede, nav, children }) =>
  html`<div class="page"><header><h1 class="page-title">${title}</h1><p class="page-source">${source} \u00b7 ${PAGES.filter(([href]) => href !== current).map(([href, label], i) => html`<span>${i ? ' \u00b7 ' : ''}<a href="${href}">${label}</a></span>`)}</p>${lede ? html`<p class="page-lede">${lede}</p>` : ''}</header>
${navView(nav)}
${children}</div>`;

export const failed = (what, message) => html`<p class="page-error">Could not load ${what}: ${message}</p>`;
