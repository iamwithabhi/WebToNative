/**
 * Motion & interaction: what moves, and what makes it move.
 *
 * One table of motions (when, what moves, timing, reduced motion), then what the user
 * can do and which handler in the source deals with it. The logic itself is quoted
 * exactly as written and collapsed until opened: what a handler does is not interpreted.
 * The rows are built in lib/motion.js.
 */

import { html } from '../html.js';
import { constantRows, interactionRows, motionRows } from '../lib/motion.js';
import { platformName } from '../lib/platform.js';
import { valueWords } from '../lib/tokens.js';
import { icon } from './icons.js';
import { banner, chip, chipList, code, fact, facts, gapList, none, quiet, section, sub } from './shared.js';
import { rowHead, td, th, tableBlock, tr } from './table.js';

function whenCell(row) {
  const { trigger } = row;
  return html`${trigger.text ? trigger.text : trigger.lines.map((l) =>
    // A hand-written contract names a state, not a node: say the state and invent no node.
    html`<div>${l.node ? html`${code(l.node)} ` : ''}${l.predicates.join(', ')}</div>`)}${trigger.why.map((w) => sub(w, 'normal'))}`;
}

function timingCell(row) {
  const same = row.timing.every((t) => t.text === row.timing[0].text);
  return html`${same ? row.timing[0]?.text ?? '\u2014' : row.timing.map((t) => html`<div>${platformName(t.platform)}: ${t.text}</div>`)}${row.then ? sub(row.then) : ''}`;
}

/** The handler's name, which opens its quoted source. A native disclosure: no script, and closed until opened. */
const quote = (entry) => html`<details class="quote"><summary>${icon('chevron')}${code(entry.name)}</summary><pre class="quoted">${entry.source}</pre>${entry.truncated ? sub('cut at the length limit: read the file for the rest') : ''}</details>`;

function interaction(artifact) {
  const { handled, inline } = interactionRows(artifact);
  const constants = constantRows(artifact);
  if (!handled.length && !inline.length && !constants.length) return '';

  return html`${section('Interaction', html`What the user can do, as the source handles it, and the amounts its author named. What a handler does is logic, quoted exactly as written for the team to translate: open one to read it. Nothing is interpreted. The complete logic is also in ${code('spec.md')} and in each platform file under ${code('behaviorSource')}.`)}
${handled.length || inline.length ? tableBlock({}, [th('User action'), th('Handled in'), th('Uses')], html`${handled.map((r) => tr([
    rowHead(html`${r.actions.join(', ')}${r.attached.length ? sub(`on ${r.attached.join(', ')}`, 'normal') : ''}`),
    td(quote(r.entry)),
    td((r.entry.uses || []).length ? chipList(r.entry.uses.map(chip)) : none('\u2014')),
  ]))}${inline.map((r) => tr([
    rowHead(r.action),
    td(none(html`written inline in the markup on ${r.nodes.map((n) => code(n))}`), { colspan: 2 }),
  ]))}`) : ''}
${constants.length ? tableBlock({}, [th('Named amount'), th('Value'), th('The author\u2019s note'), th('Used in')], constants.map((c) => tr([
    td(code(c.name), { nowrap: true }),
    td(`${String(c.value)}${c.unit ? ` ${c.unit}` : ''}`),
    td(c.note ?? none('no note')),
    td(c.usedIn.length ? chipList(c.usedIn.map(chip)) : none('\u2014')),
  ]))) : ''}`;
}

/** The hand-written state machine, drawn only when a contract has one. */
function stateMachine(behavior) {
  const rows = Object.entries(behavior?.states || {}).flatMap(([from, node]) =>
    Object.entries(node.on || {}).map(([event, t]) => ({ from, event, spec: typeof t === 'string' ? { target: t } : t })));
  if (!rows.length) return '';
  return html`${section('State machine', 'A state machine written into this contract by hand. The importer does not write one, so this appears only when someone has.')}
${tableBlock({}, [th('State'), th('Event'), th('Goes to'), th('Only when'), th('Does')], rows.map(({ from, event, spec }) => tr([
    rowHead(from),
    td(code(event)),
    td(code(spec.target)),
    td(spec.guard ? behavior.guards?.[spec.guard] || spec.guard : none('always')),
    td((spec.actions || []).length ? chipList(spec.actions.map(chip)) : none('\u2014')),
  ])))}`;
}

export function motionView({ previews, behavior, gaps }) {
  const intro = banner('What moves, and what makes it move. Read from the component\u2019s own CSS and markup; where the source does not say, the row says so.');

  if (!previews.length) {
    return html`${intro}${quiet('Generate the platform specs to see the motion.')}${stateMachine(behavior)}${gapList(gaps)}`;
  }

  const rows = motionRows(previews, { label: valueWords });
  const unresolved = previews[0].artifact.unresolvedConditions || [];

  return html`${intro}
${section('Motion', 'Each row is one motion: what starts it, what moves, how long it takes, and what it does when the user has asked for reduced motion.')}
${rows.length
    ? tableBlock({}, [th('When'), th('What moves'), th('Timing'), th('Reduced motion')], rows.map((r) => tr([
      rowHead(whenCell(r)),
      td(html`${code(r.node)} ${r.motion}`),
      td(timingCell(r)),
      td(r.reduced),
    ])))
    : quiet('Nothing in this component animates.')}

${unresolved.length ? html`${section('Not explained by the markup', 'These conditions are real, but what makes them true is not in the markup. Read the source.')}
${facts(unresolved.map((u) => fact(u.attribute, html`on ${u.nodes.join(', ')}${sub(u.why)}`)))}` : ''}

${interaction(previews[0].artifact)}
${stateMachine(behavior)}
${gapList(gaps)}`;
}
