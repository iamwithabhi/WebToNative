/**
 * Left to platform: where a platform may go native, and what it must hold to.
 *
 * Each adaptable thing ships with a fallback that is already correct, so a team that does
 * nothing still gets a compliant component: these permit a decision, they never require one.
 * Props a platform does not carry are listed here and omitted from that platform's spec.
 */

import { html } from '../html.js';
import { platformName } from '../lib/platform.js';
import { banner, chip, chipList, chips, code, fact, facts, gapList, quiet, section, sub } from './shared.js';

export function platformView({ contract: c, previews, gaps }) {
  const adaptable = Object.entries(c.adaptable || {});
  const notModelled = Object.entries(c.props || {})
    .map(([name, d]) => [name, Object.entries(d.platforms || {}).filter(([, v]) => v.supported === false)])
    .filter(([, off]) => off.length);

  return html`${banner(html`Where a platform may go native. Each of these ships with a fallback that is already correct, so a team that does nothing still gets a compliant component \u2014 these <em>permit</em> a decision, they never require one.`)}

${section('Adaptable')}
${adaptable.length ? html`<div class="stack">${adaptable.map(([name, d]) => {
    const holds = [
      d.envelope?.maxDurationMs ? `within ${d.envelope.maxDurationMs}ms` : null,
      d.envelope?.mustPreserveLayout ? 'no layout shift' : null,
      d.envelope?.mustBePerceivable ? 'perceivable' : null,
      d.envelope?.sizeRange ? `${d.envelope.sizeRange.join('\u2013')}px` : null,
    ].filter((x) => !!x);
    return html`<div class="card card-pad"><h3 class="card-title">${name}<span class="badge badge-secondary">adaptable</span></h3><p class="card-lede">${d.intent || 'no stated intent'}</p>
${facts(html`${previews.map(({ platform, artifact }) => fact(platformName(platform), chips(artifact.adaptable?.[name]?.envelope?.allowed)))}${fact('Must hold', chips(holds))}${fact('Fallback', code(JSON.stringify(d.fallback)))}`)}</div>`;
  })}</div>` : quiet('Nothing is delegated \u2014 every visual is fully specified.')}

${notModelled.length ? html`${section('Not carried to native', 'Web-shaped props, omitted from those specs entirely rather than left as a note to interpret.')}
${facts(notModelled.map(([name, off]) => fact(name, html`${chipList(off.map(([p]) => chip(platformName(p))))}${sub(off.find(([, v]) => v.note)?.[1]?.note || 'handled at the call site')}`)))}` : ''}
${gapList(gaps)}`;
}
