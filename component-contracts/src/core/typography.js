/**
 * Typography tokens: recognising the composite a component's text comes from.
 *
 * A component sets its font family, size, weight, line height and letter spacing
 * from five tokens, and nothing in the stylesheet says they are one thing. They are:
 * each variable is named <token>-<css-property>, so stripping the property's own
 * name from one leaves the composite it belongs to
 * (--semantic-typography-label-l-font-size -> semantic-typography-label-l).
 *
 * Colour is stated as the one token it is. Text is stated the same way: the name of
 * the composite, and not the individual tokens it stands for. This is the one place
 * that rule lives. The importer calls it to put the composite in the contract in
 * place of the five; the resolver does the same for the matrix; everything after
 * only reads what was recorded.
 *
 * It claims a composite only when the evidence is unambiguous: every text property
 * the rule or node sets is a token named that way, they all share one composite,
 * and at least two are set. A literal weight, a calc(), or a token from another
 * group means the properties do not come from one token, and saying they do would be
 * a guess, so they are left as they are.
 */

import { TYPOGRAPHY } from './platform-map.js';

/** Does this set of role-keyed properties set any of the text properties a composite stands for? */
export const hasTypography = (properties = {}) =>
  Object.keys(TYPOGRAPHY.properties).some((role) => properties[role] !== undefined);

/**
 * The typography composite a set of role-keyed properties belongs to, as a token
 * reference ('{semantic.typography.label.l}'), or null when none is evident.
 */
export function typographyOf(properties = {}) {
  const prefixes = new Set();
  let count = 0;
  for (const [role, cssName] of Object.entries(TYPOGRAPHY.properties)) {
    const value = properties[role];
    if (value === undefined) continue;
    const ref = typeof value === 'string' ? value.match(/^\{(.+)\}$/)?.[1] : null;
    const suffix = '.' + cssName.split('-').join('.');
    if (!ref || !ref.endsWith(suffix)) return null;
    prefixes.add(ref.slice(0, -suffix.length));
    count++;
  }
  return count >= TYPOGRAPHY.minimumProperties && prefixes.size === 1 ? `{${[...prefixes][0]}}` : null;
}

/**
 * The properties with the individual text tokens replaced by the composite they make
 * up, in the place the first of them held. Unchanged when there is no composite to
 * claim, or when one is already recorded and says something different.
 */
export function withTypography(properties = {}) {
  const { typography: existing, ...rest } = properties;
  const ref = typographyOf(rest);
  if (!ref || (existing !== undefined && existing !== ref)) return properties;

  const out = {};
  let placed = false;
  for (const [key, value] of Object.entries(properties)) {
    if (key === 'typography') continue;
    if (key in TYPOGRAPHY.properties) {
      if (!placed) { out.typography = ref; placed = true; }
      continue;
    }
    out[key] = value;
  }
  return out;
}
