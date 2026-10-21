/**
 * How every table in the reader is drawn: an optional title and note, then the table in a card.
 *
 * Nothing about a table's padding, text or spacing is chosen where it is used. The scheme is in
 * css/app.css under `.tbl`: a column head is 12px medium muted, a row label (`rowHead`) is 14px medium, a
 * cell is 14px regular and top-aligned, with `numeric` and `nowrap` as options. A table is only ever made
 * here, so the nineteen on the Mapping page and the one in a pane read as the same kind of thing.
 * `sticky` is for a table whose header must pin to the page while it scrolls, which needs a card and a
 * wrapper that do not clip or scroll.
 */

import { html, cx } from '../html.js';

/** A column head. */
export const th = (content = '', { numeric = false, sticky = false } = {}) =>
  html`<th class="${cx(numeric && 'num', sticky && 'pin')}">${content}</th>`;

/** The words that name a row (a state, a size, a trigger). */
export const rowHead = (content) => html`<th scope="row">${content}</th>`;

/** A cell. */
export const td = (content = '', { numeric = false, nowrap = false, colspan, className } = {}) =>
  html`<td class="${cx(numeric && 'num', nowrap && 'nowrap', className)}"${colspan ? html` colspan="${colspan}"` : ''}>${content}</td>`;

export const tr = (cells) => html`<tr>${cells}</tr>`;

/** A table in its card. `head` is the cells of the header row; `rows` are `tr`s. */
export const tableBlock = ({ title, note, sticky = false } = {}, head, rows) =>
  html`<div class="tblock">${title ? html`<h3 class="tblock-title">${title}</h3>` : ''}${note ? html`<p class="tblock-note">${note}</p>` : ''}<div class="${cx('card', 'tbl-card', (title || note) && 'tbl-spaced', sticky && 'tbl-sticky')}"><div class="tbl-wrap"><table class="tbl"><thead>${tr(head)}</thead><tbody>${rows}</tbody></table></div></div></div>`;
