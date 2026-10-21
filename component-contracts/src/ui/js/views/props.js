/**
 * Props: the component's API, as the contract reads it.
 *
 * Axes drive the appearance matrix and become enums in the generated specs. A prop a
 * platform does not carry, or names differently, says so here and not in the specs.
 * Every value on this pane is a chip, including where an open question points.
 */

import { html } from '../html.js';
import { platformName } from '../lib/platform.js';
import { banner, chip, chips, fact, facts, gapList, required, section, sub } from './shared.js';

const entriesOf = (o) => Object.entries(o || {});

function platformNote(def) {
  const off = entriesOf(def.platforms).filter(([, v]) => v.supported === false).map(([p]) => p);
  if (!off.length) return '';
  const note = Object.values(def.platforms).find((v) => v.note)?.note || 'handled at the call site';
  return sub(html`not on ${off.map(platformName).join(' or ')} \u2014 ${note}`);
}

function nameNote(name, def) {
  const renamed = entriesOf(def.names).filter(([, v]) => v && v !== name);
  if (!renamed.length) return '';
  return sub(renamed.map(([p, v], i) => html`<span>${i ? ' \u00b7 ' : ''}${platformName(p)}: ${chip(v)}</span>`));
}

export function propsView({ contract: c, gaps }) {
  const entries = entriesOf(c.props);
  const axes = entries.filter(([, d]) => d.axis);
  const rest = entries.filter(([, d]) => !d.axis && d.kind !== 'event');
  const composition = entriesOf(c.composition?.children);

  return html`${banner('The component\u2019s API. Axes drive the appearance matrix and become enums in the generated specs.')}

${section('Axes')}
${facts(axes.map(([name, d]) => fact(name, html`${chips(d.values)}${sub(html`default ${chip(String(d.default))}`)}`)))}

${section('States', 'Pointer-only states are removed automatically on iOS and Android.')}
${facts(fact('States', chips(c.states)))}

${rest.length ? html`${section('Other props')}
${facts(rest.map(([name, d]) => fact(name, html`<div class="meta-row">${chip(d.kind)}${d.required ? required() : ''}${d.default !== undefined ? html`<span class="meta-default">default ${chip(String(d.default))}</span>` : ''}</div>${nameNote(name, d)}${platformNote(d)}`)))}` : ''}

${section('Composition', 'What the component renders, and when.')}
${facts(composition.map(([name, d]) => fact(name, html`<div class="meta-row">${chip(d.contentType || 'node')}${d.boundTo ? html`<span class="meta-default">from ${chip(d.boundTo)}</span>` : ''}</div>${d.visibleIn ? sub(`only when ${d.visibleIn.join(', ')}`) : ''}${d.hiddenIn ? sub(`hidden when ${d.hiddenIn.join(', ')}`) : ''}`)))}
${gapList(gaps, { chipPaths: true })}`;
}
