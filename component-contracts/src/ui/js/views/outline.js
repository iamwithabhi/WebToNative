/**
 * The outline, drawn: each node as nested bands (border, padding, content) with its
 * children laid out along its axis and a marker for the gap between them.
 *
 * lib/outline.js decides what to say; this only draws it. It is schematic, not to
 * scale, and says so wherever it is shown.
 */

import { html, raw, esc, cx } from '../html.js';
import { OUTLINE_LEGEND } from '../lib/outline.js';

const head = (v) => html`<div class="ol-head"><b>${v.name}</b>${v.external ? html`<span class="ol-ext-tag">${v.external}</span>` : ''}${v.meta ? html`<span>${v.meta}</span>` : ''}</div>`;

const sizes = (v) => (v.sizes.length
  ? html`<div class="ol-size">${v.sizes.map((s) => html`<span${v.includesBorderAndPadding ? html` title="includes border and padding"` : ''}><i>${s.key}</i> ${s.text}</span>`)}</div>`
  : '');

/** The inline style a child needs to take its share of its parent's axis. */
const itemStyle = (v) => (v.item ? raw(` style="flex:${esc(v.item.flex)}${v.item.stretch ? ';align-self:stretch' : ''}"`) : '');

function node(v) {
  if (v.external) {
    return html`<div class="ol-node"${itemStyle(v)} data-node="${v.name}">${head(v)}<div class="ol-leaf ol-ext" title="Defined elsewhere: its size and glyph are not stated here">${v.external}</div>${sizes(v)}</div>`;
  }

  const content = v.container
    ? html`<div class="ol-content" style="flex-direction:${v.container.direction};${v.container.justify ? `justify-content:${v.container.justify};` : ''}align-items:${v.container.align}">${v.children.map((child, i) => html`${i && v.gap
      ? html`<div class="${cx('ol-gap', v.gap.vertical ? 'ol-gap-v' : 'ol-gap-h', v.gap.unset && 'ol-unset')}" title="${v.gap.title}"><span>${v.gap.text}</span></div>`
      : ''}${node(child)}`)}</div>`
    : html`<div class="ol-content ol-leaf" title="No child nodes">${v.leaf}</div>`;

  const padded = v.padding
    ? html`<div class="${cx('ol-pad', v.padding.one && 'ol-pad-one')}">${v.padding.labels.map((l) => html`<span class="${cx('ol-pv', `ol-${l.side}`, l.unset && 'ol-unset')}" title="${l.title}">${l.text}</span>`)}${content}</div>`
    : content;

  const boxed = v.border
    ? html`<div class="ol-border"><span class="ol-bv" title="${v.border.title}">${v.border.text}</span>${padded}</div>`
    : padded;

  return html`<div class="ol-node"${itemStyle(v)} data-node="${v.name}">${head(v)}<div class="ol-box">${v.radius ? html`<span class="ol-radius" title="${v.radius.title}">${v.radius.text}</span>` : ''}${boxed}</div>${sizes(v)}</div>`;
}

/** One outline, scrollable sideways so a wide component is never squeezed. */
export const outline = (view) => (view ? html`<div class="ol-scroll">${node(view)}</div>` : '');

export const outlineLegend = () => html`<div class="ol-legend">${OUTLINE_LEGEND.map((k) => html`<span class="ol-key"><i class="${k.cls}"></i>${k.text}</span>`)}</div>`;
