/**
 * Accessibility: stated once as intent, then translated.
 *
 * The columns are what the resolver produced for each platform, the same values the
 * spec files carry. Roles and announced states are shown in each platform's own
 * primitive; an action a role obliges a team to implement is named beside it.
 */

import { html } from '../html.js';
import { platformName } from '../lib/platform.js';
import { banner, chip, chipList, code, fact, facts, gapList, none, required, section, sub } from './shared.js';
import { rowHead, td, th, tableBlock, tr } from './table.js';

/** A matrix: a label per row, and one cell per platform. */
function platformTable(previews, rows) {
  return tableBlock({}, [th(''), previews.map((p) => th(platformName(p.platform)))],
    rows.map((r) => tr([
      rowHead(html`${r.label}${r.note ? sub(r.note, 'normal') : ''}`),
      r.cells.map((cell) => td(cell ?? none('\u2014'))),
    ])));
}

function roleText(m) {
  if (m.traits?.length) return m.traits.map((t) => `.${t}`).join(', ');
  if (m.role) return `Role.${m.role}`;
  if (m.container) return `container(${m.container})`;
  return null;
}

export function a11yView({ contract: c, previews: P, gaps }) {
  const a = c.a11y || {};
  if (!P.length) return banner('Generate the platform specs to see how this maps.');

  const own = [
    {
      label: 'Role',
      note: a.role ? `from role="${a.role}"` : 'none declared',
      cells: P.map(({ artifact }) => { const t = roleText(artifact.a11y); return t ? code(t) : null; }),
    },
    {
      label: 'Accessible name',
      note: 'announced, never drawn',
      cells: P.map(({ artifact }) => (artifact.a11y.labelSource ? html`${code(artifact.a11y.labelSource)}${artifact.a11y.labelRequired ? required() : ''}` : null)),
    },
    { label: 'Focusable', cells: P.map(({ artifact }) => (artifact.a11y.focusable === false ? 'no' : 'yes')) },
    { label: 'Focus indicator', cells: P.map(({ artifact }) => artifact.a11y.focusIndicator ?? null) },
    {
      label: 'Touch target',
      note: 'platform guidance',
      cells: P.map(({ artifact }) => code(`${artifact.a11y.minTarget}${artifact.a11y.minTargetUnit}`)),
    },
  ];

  /* Announced states, each in the platform's own primitive. */
  const stateKeys = [...new Set(P.flatMap(({ artifact }) => Object.keys(artifact.a11y.states || {})))];
  for (const key of stateKeys) {
    own.push({
      label: key,
      note: 'announced state',
      cells: P.map(({ artifact }) => {
        const v = artifact.a11y.states?.[key];
        if (!v) return null;
        const text = v.trait ? `.${v.trait}` : v.semantics || v.property || null;
        return text ? html`${code(text)}${v.announce ? html`<span class="announce">${v.announce}</span>` : ''}` : null;
      }),
    });
  }

  /* Roles inside the tree. */
  const nodeNames = [...new Set(P.flatMap(({ artifact }) => (artifact.a11yNodes || []).map((n) => n.node)))];
  const nodeRows = nodeNames.map((name) => {
    const first = P[0].artifact.a11yNodes.find((n) => n.node === name);
    return {
      label: name,
      note: first ? `role="${first.role}"` : null,
      cells: P.map(({ artifact }) => {
        const n = (artifact.a11yNodes || []).find((x) => x.node === name);
        if (!n) return null;
        if (n.unmapped) return html`<span class="warn">no equivalent</span>`;
        return html`${code(n.text)}${n.actions.length ? sub(`must implement: ${n.actions.join(', ')}`) : ''}${n.plain ? sub('native control') : ''}`;
      }),
    };
  });

  const keys = a.keyboard || [];

  return html`${banner('Stated once as intent, then translated. These columns are what the resolver produced for each platform \u2014 the same values the spec files carry.')}

${section('The component')}
${platformTable(P, own)}

${nodeRows.length ? html`${section('Inside the tree', 'Nodes in the markup that carry a role of their own.')}${platformTable(P, nodeRows)}` : ''}

${section('Keyboard')}
${facts(html`${fact('Keys', keys.length ? chipList(keys.map((k) => chip(`${k.key} \u2192 ${k.action}`))) : none('none declared'))}${fact('Hit area', c.hitArea?.strategy || '\u2014')}`)}
${gapList(gaps)}`;
}
