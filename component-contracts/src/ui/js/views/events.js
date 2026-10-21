/**
 * Events: the callbacks a component raises, and the platform name each one takes.
 *
 * An event appears only when the component declares it, in its own props or through a
 * native element's attributes. Where each one is raised from is read off a state
 * machine when a person has written one into the contract. Every value is a chip.
 */

import { html } from '../html.js';
import { platformName } from '../lib/platform.js';
import { banner, chip, fact, facts, gapList, none, quiet, section, sub } from './shared.js';

export function eventsView({ contract: c, gaps }) {
  const events = Object.entries(c.props || {}).filter(([, d]) => d.kind === 'event');

  /* Where each event is raised from, read off the state machine. */
  const firedBy = new Map();
  for (const [from, node] of Object.entries(c.behavior?.states || {})) {
    for (const [event, t] of Object.entries(node.on || {})) {
      const spec = typeof t === 'string' ? { target: t } : t;
      for (const a of spec.actions || []) {
        if (!a.startsWith('emit:')) continue;
        const name = a.slice(5);
        firedBy.set(name, [...(firedBy.get(name) || []), { from, event, guard: spec.guard }]);
      }
    }
  }

  if (!events.length) {
    return html`${banner('Callbacks the component raises, and the platform name each one takes.')}
${quiet(html`<p>No events were read from this component.</p><p class="quiet-note">Nothing is inferred here \u2014 an event appears only when the component declares it, either in its own props or through a native element\u2019s attributes.</p>`)}`;
  }

  return html`${banner(html`Callbacks the component raises. Internal states such as ${chip('pressed')} only change appearance and are not events \u2014 they live under <strong>Motion &amp; interaction</strong>.`)}
${section('Events')}
${facts(events.map(([name, d]) => {
    const fires = firedBy.get(name) || [];
    return fact(name, html`${d.payload && d.payload !== 'none' ? chip(d.payload) : none('no payload')}
${d.inheritedFrom ? sub(html`inherited from ${chip(d.inheritedFrom)}`) : ''}
${d.names ? sub(Object.entries(d.names).map(([p, v], i) => html`<span>${i ? ' \u00b7 ' : ''}${platformName(p)}: ${chip(v)}</span>`)) : ''}
${fires.length
    ? sub(html`fires on ${fires.map((f, i) => html`<span>${i ? ', ' : ''}${chip(f.event)} from ${chip(f.from)}</span>`)}${fires[0].guard ? ` \u2014 only when ${c.behavior?.guards?.[fires[0].guard] || fires[0].guard}` : ''}`)
    : sub('not wired to any transition', 'italic')}`);
  }))}
${gapList(gaps, { chipPaths: true })}`;
}
