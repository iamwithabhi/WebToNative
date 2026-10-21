/**
 * Appearance: everything visual, as the component resolves it.
 *
 * It opens with the outline of each node's border, padding and gap, then the tokens
 * applied per variant and the metrics per size. A dashed swatch means the value lives
 * in the platform's own token library; the name is what the generated code needs.
 */

import { html } from '../html.js';
import { layoutVariants, outlineTree, outlineView } from '../lib/outline.js';
import { platformName } from '../lib/platform.js';
import { valueWords } from '../lib/tokens.js';
import { outline, outlineLegend } from './outline.js';
import { banner, chip, chips, fact, facts, gapList, none, quiet, section, token } from './shared.js';
import { rowHead, td, th, tableBlock, tr } from './table.js';

/** The outline for the first platform's nodes, with one card per layout that changes. */
function outlineSection(previews, tokenMap) {
  const first = previews[0];
  const nodes = first?.artifact?.nodes || [];
  const hint = 'Each node with its border, padding and gap. Schematic, not to scale: a token\u2019s value lives in the platform token library, so the bands are labelled, not measured. Padding or a gap that is not stated is zero.';

  if (!nodes.length) return html`${section('Outline', hint)}${quiet('Generate the platform specs to see the outline.')}`;

  const labels = { label: valueWords, valueOf: (ref) => tokenMap.get(ref) };
  const cards = [
    { title: 'At rest', tree: outlineTree(nodes) },
    ...layoutVariants(nodes).map((v) => ({ title: v.label, tree: outlineTree(nodes, v.key) })),
  ];

  return html`${section('Outline', hint)}${outlineLegend()}
<div class="stack">${cards.map((card) => html`<div class="card card-pad"><h3 class="card-title mono">${card.title}</h3>${outline(card.tree ? outlineView(card.tree, labels) : null)}</div>`)}</div>
<p class="foot-note">Resolved for ${platformName(first.platform)}.</p>`;
}

export function appearanceView({ contract: c, previews, tokens, tokenMap, requiredSizeKeys = [], gaps }) {
  const roles = c.appearance.roles || [];
  const variants = c.props.variant?.values || [];
  const sizes = c.props.size?.values || [];
  const metricKeys = [...new Set([...requiredSizeKeys, ...sizes.flatMap((s) => Object.keys(c.appearance.bySize?.[s] || {}))])];
  const layout = c.layout || {};
  const ring = c.appearance.focusRing;
  const known = tokens.filter((t) => t.value != null).length;
  const tok = (value) => token(value, tokenMap);

  return html`${banner('Everything visual, resolved. A dashed swatch means the value lives in the platform\u2019s own token library \u2014 the name is what the generated code needs.')}

${outlineSection(previews, tokenMap)}

${variants.length ? html`${section('Applied tokens', 'Blank means the state inherits the resting value.')}
${variants.map((variant) => {
    const block = c.appearance.byVariant?.[variant] || {};
    const rows = ['default', ...(c.states || []).filter((s) => s !== 'idle' && block[s])];
    return tableBlock({ title: variant }, [th('State'), roles.map((r) => th(r))],
      rows.map((row) => tr([rowHead(row === 'default' ? 'at rest' : row), roles.map((role) => td(tok(block[row]?.[role])))])));
  })}` : ''}

${sizes.length ? html`${section('Metrics', 'Per size.')}
${tableBlock({}, [th('Size'), metricKeys.map((k) => th(k))],
    sizes.map((s) => tr([rowHead(s), metricKeys.map((k) => td(tok(c.appearance.bySize?.[s]?.[k])))])))}` : ''}

${section('Layout', 'Intent, not mechanism \u2014 whether it becomes an HStack, a Row, or flexbox is the platform\u2019s call.')}
${facts(html`${fact('Direction', layout.direction || '\u2014')}${fact('Alignment', `${layout.align || '\u2014'} \u00b7 ${layout.justify || '\u2014'}`)}${fact('Sizing', `${layout.sizing?.width || '\u2014'} wide \u00b7 ${layout.sizing?.height || '\u2014'} tall`)}${fact('Order', chips(layout.childOrder))}`)}

${ring ? html`${section('Focus ring')}
${facts(html`${fact('Colour', tok(ring.color))}${fact('Geometry', `${ring.width ?? '\u2014'}px, offset ${ring.offset ?? '\u2014'}px, ${ring.style || 'solid'}`)}`)}` : ''}

${tokens.length ? html`${section('Token vocabulary', `Read from the component. ${known} of ${tokens.length} declare a value here; the rest come from each platform\u2019s token library.`)}
<div class="card"><div class="rows">${tokens.map((t) => html`<div class="row-between">${tok(`{${t.name}}`)}${chip(t.type || 'unknown')}</div>`)}</div></div>` : ''}
${!ring && !tokens.length ? none('nothing else to show') : ''}
${gapList(gaps)}`;
}
