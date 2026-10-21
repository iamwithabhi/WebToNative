/**
 * Overview: the only pane with fields a person edits.
 *
 * Name, description and contract version exist nowhere in the component's code, so
 * they are the only things this tool asks for. Everything else is read.
 *
 * Removing the contract is also here, at the bottom: it is about the whole contract, not about
 * one field, and it is not something to keep one click away from every other view.
 */

import { html } from '../html.js';
import { platformName } from '../lib/platform.js';
import { banner, chips, fact, facts, gapList, section } from './shared.js';

export function overviewView({ contract: c, tokens, gaps, canDelete = false }) {
  const known = tokens.filter((t) => t.value != null).length;
  const variants = c.props.variant?.values?.length || 0;
  const sizes = c.props.size?.values?.length || 0;

  return html`${banner('The only fields edited here. Everything else is read from the component \u2014 to change it, change the component.')}

<div class="field"><label for="f-name">Name</label><input class="input" id="f-name" data-edit="name" value="${c.name || ''}"></div>
<div class="field"><label for="f-desc">Description</label><textarea class="input" id="f-desc" rows="3" data-edit="description" placeholder="One sentence: what is this component for?">${c.description || ''}</textarea></div>
<div class="field"><label for="f-version">Contract version</label><input class="input input-narrow mono" id="f-version" data-edit="contractVersion" value="${c.contractVersion || ''}">
<p class="field-note">Minor for an added variant or optional prop. Major for a removal, rename, or changed token.</p></div>

${section('At a glance')}
${facts(html`${fact('Platforms', chips((c.platforms || []).map(platformName)))}${fact('Matrix', `${variants} variants \u00d7 ${sizes} sizes \u00d7 ${c.states.length} states`)}${fact('States', chips(c.states))}${fact('Tokens', `${tokens.length} referenced \u00b7 ${known} with a known value`)}${fact('Source', html`<span class="mono">${c.id}.contract.json</span>`)}`)}
${gapList(gaps)}

${canDelete ? html`<div class="danger-zone"><div><div class="danger-title">Delete this contract</div><p class="danger-note">You are asked what goes with it first, and can keep the generated specs.</p></div><button class="btn btn-destructive btn-sm" data-action="delete-open">Delete</button></div>` : ''}`;
}
