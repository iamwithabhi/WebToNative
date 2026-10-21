/**
 * Semantic validation.
 *
 * Shape errors are cheap; this module is about the expensive kind — a contract
 * that parses fine but leaves a design decision unmade. Every finding carries a
 * `question`: the plain-language thing a human has to decide. The list of open
 * questions IS the agenda for the contract review session.
 */

import { asTokenRef } from './tokens.js';
import {
  SAFE_ANIMATABLE,
  UNSAFE_ANIMATABLE,
  REDUCED_MOTION_MODES,
  REQUIRED_SIZE_KEYS,
  OPTIONAL_SIZE_KEYS,
  A11Y_ROLES,
  axesOf,
  statesForPlatform,
  POINTER_ONLY_STATES,
} from './contract.js';
import { resolveCurve, effectiveDurationMs } from './animation.js';

export { REQUIRED_SIZE_KEYS, OPTIONAL_SIZE_KEYS };

const SEMVER = /^\d+\.\d+\.\d+$/;

class Findings {
  constructor() {
    this.items = [];
  }
  /**
   * @param answer  How a human resolves this, if they can. The UI renders one
   *                input from this descriptor, so it never needs to know about
   *                individual finding codes:
   *                  { at, kind: 'token'|'number'|'text'|'select'|'sameAsDefault',
   *                    tokenType?, options?, context? }
   */
  add(severity, code, path, message, question, answer) {
    this.items.push({
      severity,
      code,
      path,
      message,
      question: question || null,
      answer: answer || null,
    });
  }
  error(code, path, message, question, answer) {
    this.add('error', code, path, message, question, answer);
  }
  warn(code, path, message, question, answer) {
    this.add('warning', code, path, message, question, answer);
  }
  info(code, path, message) {
    this.add('info', code, path, message, null, null);
  }
}

/**
 * @param {object} contract  normalised contract
 * @param {import('./tokens.js').TokenIndex} tokens
 */
export function validateContract(contract, tokens) {
  const f = new Findings();
  const axes = axesOf(contract);
  const variants = axes.variant || [];
  const sizes = axes.size || [];
  const states = contract.states || [];

  /* ---------------- meta ---------------- */

  if (!contract.id || !/^[a-z][a-z0-9-]*$/.test(contract.id)) {
    f.error('meta.id', 'id', 'Component id must be lowercase kebab-case.');
  }
  if (!contract.name) f.error('meta.name', 'name', 'Component needs a display name.');
  if (!SEMVER.test(contract.contractVersion || '')) {
    f.error('meta.version', 'contractVersion', 'contractVersion must be semver (e.g. 1.0.0).');
  }
  if (!contract.description) {
    f.warn('meta.description', 'description', 'No description.',
      'What is this component for, in one sentence?',
      { at: 'description', kind: 'text', placeholder: 'A single-action control.' });
  }

  /* ---------------- axes ---------------- */

  if (!variants.length) {
    f.error('axes.variant', 'props.variant', 'No variant axis defined.', 'What visual variants does this component have?');
  }
  if (!sizes.length) {
    f.error('axes.size', 'props.size', 'No size axis defined.', 'What sizes does this component come in?');
  }
  if (!states.length) {
    f.error('axes.state', 'states', 'No states defined.', 'What interaction states does this component have?');
  }

  for (const [name, def] of Object.entries(contract.props || {})) {
    if (def.kind === 'enum') {
      if (!def.values?.length) {
        f.error('prop.enum.empty', `props.${name}`, `Enum prop "${name}" has no values.`);
      } else if (def.default != null && !def.values.includes(def.default)) {
        f.error('prop.enum.default', `props.${name}.default`,
          `Default "${def.default}" is not one of the declared values.`);
      }
    }
  }

  /* ---------------- token reference helper ---------------- */

  // A token only has to be part of the component's vocabulary. Its VALUE may
  // well be unknown — the component referenced it without declaring it, and the
  // platform's own token library fills that in. Only the name must resolve.
  const checkToken = (value, path, question, tokenType) => {
    const ref = asTokenRef(value);
    if (ref == null) return; // literal, fine
    if (!tokens.has(ref)) {
      f.error('token.missing', path, `"${ref}" is not one of this component's tokens.`,
        question || `Which token should ${path} use?`,
        { at: path, kind: 'token', tokenType: tokenType || 'any' });
    }
  };

  /* ---------------- appearance ---------------- */

  /**
   * Is this state already answered somewhere other than the colour matrix?
   *
   * A component commonly expresses `focused` with a focus ring and `loading`
   * by swapping in a spinner. Asking whether the fill changes in those states
   * is noise — the component has already said what happens, just not in the
   * place the matrix looks.
   */
  const handledElsewhere = (state) => {
    if (state === 'focused' && contract.appearance?.focusRing) return true;
    const children = Object.values(contract.composition?.children || {});
    if (children.some((c) => c.visibleIn?.includes(state) || c.hiddenIn?.includes(state))) return true;
    if ((contract.motion?.transitions || []).some((t) => t.on?.endsWith(`->${state}`))) return true;
    if ((contract.motion?.loops || []).some((l) => l.activeIn?.includes(state))) return true;
    return false;
  };

  const roles = contract.appearance?.roles || [];
  if (!roles.length) {
    f.error('appearance.roles', 'appearance.roles', 'No appearance roles declared.',
      'Which colour roles does this component have (fill, label, border)?');
  }

  for (const variant of variants) {
    const block = contract.appearance?.byVariant?.[variant];
    if (!block) {
      f.error('appearance.variant.missing', `appearance.byVariant.${variant}`,
        `Variant "${variant}" has no appearance block.`,
        `How does the "${variant}" variant look?`);
      continue;
    }
    if (!block.default) {
      f.error('appearance.default.missing', `appearance.byVariant.${variant}.default`,
        `Variant "${variant}" has no default state block.`,
        `What are the resting colours for "${variant}"?`);
      continue;
    }

    // The default block must be complete — every role resolved.
    for (const role of roles) {
      const value = block.default[role];
      if (value == null || value === '') {
        f.error('appearance.role.unresolved', `appearance.byVariant.${variant}.default.${role}`,
          `"${variant}" default has no value for role "${role}".`,
          `What ${role} does "${variant}" use at rest?`,
          {
            at: `appearance.byVariant.${variant}.default.${role}`,
            kind: 'token',
            tokenType: /color|fill|border(?!Width)|label|focus/i.test(role) ? 'color' : 'dimension',
            context: { variant, state: 'default', role },
          });
      } else {
        checkToken(value, `appearance.byVariant.${variant}.default.${role}`,
          `Which token is the ${role} for "${variant}"?`);
      }
    }

    // State deltas may be partial, but must reference known roles and states.
    for (const [stateName, delta] of Object.entries(block)) {
      if (stateName === 'default') continue;
      if (!states.includes(stateName)) {
        f.error('appearance.state.unknown', `appearance.byVariant.${variant}.${stateName}`,
          `"${stateName}" is not in the declared states list.`);
        continue;
      }
      for (const [role, value] of Object.entries(delta || {})) {
        if (!roles.includes(role)) {
          f.warn('appearance.role.unknown', `appearance.byVariant.${variant}.${stateName}.${role}`,
            `Role "${role}" is not declared in appearance.roles.`);
        }
        checkToken(value, `appearance.byVariant.${variant}.${stateName}.${role}`);
      }
    }

    // Every non-default state should say something, or it is visually identical
    // to default — usually a miss rather than a decision. An explicitly present
    // but empty block IS the decision ("deliberately identical"), so it is
    // accepted silently and the question does not come back.
    for (const state of states) {
      if (state === 'idle' || state === 'default') continue;
      if (handledElsewhere(state)) continue;
      if (!(state in block)) {
        f.warn('appearance.state.identical', `appearance.byVariant.${variant}.${state}`,
          `"${variant}" has no "${state}" overrides — it will look identical to default.`,
          `Does "${variant}" change appearance when ${state}?`,
          {
            at: `appearance.byVariant.${variant}.${state}`,
            kind: 'sameAsDefault',
            roles,
            context: { variant, state },
          });
      }
    }
  }

  /* ---------------- sizes ---------------- */

  for (const size of sizes) {
    const block = contract.appearance?.bySize?.[size];
    if (!block) {
      f.error('size.missing', `appearance.bySize.${size}`, `Size "${size}" has no block.`,
        `What are the metrics for size "${size}"?`);
      continue;
    }
    for (const key of [...REQUIRED_SIZE_KEYS, ...OPTIONAL_SIZE_KEYS]) {
      const value = block[key];
      if (value == null || value === '') {
        // A metric no size declares is simply not part of this component.
        // Only a metric SOME size declares is a problem, because it leaves the
        // generated struct inconsistent between rows.
        const partial = sizes.some((s) => contract.appearance?.bySize?.[s]?.[key] != null);
        if (partial) {
          f.error(
            'size.key.unresolved',
            `appearance.bySize.${size}.${key}`,
            `Size "${size}" has no "${key}", but another size does.`,
            `What ${key} does size "${size}" use?`,
            {
              at: `appearance.bySize.${size}.${key}`,
              kind: 'token',
              tokenType: key === 'fontWeight' ? 'fontWeight' : 'dimension',
              context: { size, key },
            }
          );
        }
      } else {
        checkToken(value, `appearance.bySize.${size}.${key}`);
      }
    }
  }

  /* ---------------- focus ring ---------------- */

  if (contract.a11y?.focus?.focusable && contract.a11y?.focus?.indicator === 'focusRing') {
    const ring = contract.appearance?.focusRing;
    if (!ring) {
      f.error('focusRing.missing', 'appearance.focusRing.color',
        'Focus indicator is "focusRing" but no ring is defined.',
        'What colour is the focus ring?',
        { at: 'appearance.focusRing.color', kind: 'token', tokenType: 'color' });
    } else {
      for (const key of ['color', 'width', 'offset', 'style']) {
        if (ring[key] == null || ring[key] === '') {
          f.error('focusRing.key', `appearance.focusRing.${key}`,
            `Focus ring has no "${key}".`, `What is the focus ring ${key}?`,
            key === 'color'
              ? { at: `appearance.focusRing.${key}`, kind: 'token', tokenType: 'color' }
              : key === 'style'
                ? { at: 'appearance.focusRing.style', kind: 'select', options: ['solid', 'dashed'] }
                : { at: `appearance.focusRing.${key}`, kind: 'number', unit: 'px' });
        }
      }
      checkToken(ring.color, 'appearance.focusRing.color');
    }
  }

  /* ---------------- layout / composition ---------------- */

  const children = contract.composition?.children || {};
  const treeChildren = new Set((contract.composition?.tree?.children || []).map((node) => node.name));
  for (const child of contract.layout?.childOrder || []) {
    if (!children[child] && !treeChildren.has(child)) {
      f.error('layout.child.unknown', `layout.childOrder`,
        `childOrder references "${child}" which is not defined in composition.children.`);
    }
  }
  for (const [name, def] of Object.entries(children)) {
    if (!(contract.layout?.childOrder || []).includes(name)) {
      f.warn('composition.child.unordered', `composition.children.${name}`,
        `Child "${name}" is not in layout.childOrder and will not be placed.`,
        `Where does "${name}" sit in the layout?`);
    }
    if (def.boundTo?.startsWith('prop:')) {
      const propName = def.boundTo.slice(5);
      if (!contract.props?.[propName]) {
        f.error('composition.bind.unknown', `composition.children.${name}.boundTo`,
          `Bound to prop "${propName}" which does not exist.`);
      }
    }
  }

  // Per-state child visibility must be decided for states that imply a change.
  for (const state of states) {
    if (state === 'loading' && !Object.values(children).some((c) => c.visibleIn?.includes('loading'))) {
      f.warn('composition.loading', 'composition.children',
        'No child is marked visible in the loading state.',
        'During loading, does the label stay visible? Where does the spinner go?');
    }
  }

  /* ---------------- behaviour ---------------- */

  const bStates = Object.keys(contract.behavior?.states || {});
  // No state machine is a valid outcome — a component's interaction logic is
  // not expressed in its CSS or prop types, so there may be nothing to read.
  if (bStates.length && contract.behavior?.initial && !bStates.includes(contract.behavior.initial)) {
    f.error('behavior.initial', 'behavior.initial',
      `Initial state "${contract.behavior.initial}" is not defined in behavior.states.`);
  }
  for (const [name, node] of Object.entries(contract.behavior?.states || {})) {
    if (!states.includes(name)) {
      f.warn('behavior.state.undeclared', `behavior.states.${name}`,
        `Behaviour state "${name}" is not in the top-level states list.`);
    }
    for (const [event, t] of Object.entries(node.on || {})) {
      const target = typeof t === 'string' ? t : t.target;
      if (!bStates.includes(target)) {
        f.error('behavior.target', `behavior.states.${name}.on.${event}`,
          `Transition targets unknown state "${target}".`);
      }
      const guard = typeof t === 'object' ? t.guard : null;
      if (guard && !(guard in (contract.behavior?.guards || {}))) {
        f.error('behavior.guard', `behavior.states.${name}.on.${event}.guard`,
          `Unknown guard "${guard}".`);
      }
    }
  }

  /* ---------------- motion ---------------- */

  contract.motion?.transitions?.forEach((t, i) => {
    const path = `motion.transitions[${i}]`;

    if (!t.on || !t.on.includes('->')) {
      f.error('motion.on', `${path}.on`, 'Transition "on" must be of the form "from->to".');
    } else {
      const [from, to] = t.on.split('->').map((s) => s.trim());
      if (from !== '*' && !states.includes(from)) {
        f.error('motion.from', `${path}.on`, `Unknown source state "${from}".`);
      }
      if (to !== '*' && !states.includes(to)) {
        f.error('motion.to', `${path}.on`, `Unknown target state "${to}".`);
      }
    }

    if (!t.properties?.length) {
      f.error('motion.properties', `${path}.properties`, 'Transition animates nothing.',
        'Which properties change during this transition?');
    }
    for (const prop of t.properties || []) {
      if (UNSAFE_ANIMATABLE[prop]) {
        f.error('motion.unsafe', `${path}.properties`,
          `"${prop}" is not safely animatable cross-platform: ${UNSAFE_ANIMATABLE[prop]}.`);
      } else if (!SAFE_ANIMATABLE.has(prop)) {
        f.warn('motion.unknown-prop', `${path}.properties`,
          `"${prop}" is not in the known cross-platform-safe set.`);
      }
    }

    if (!t.reducedMotion) {
      f.error('motion.reducedMotion', `${path}.reducedMotion`,
        'Every transition must declare a reduced-motion fallback.',
        `With reduced motion on, what should "${t.on || 'this transition'}" do?`,
        { at: `motion.transitions.${i}.reducedMotion`, kind: 'select', options: REDUCED_MOTION_MODES });
    } else if (!REDUCED_MOTION_MODES.includes(t.reducedMotion)) {
      f.error('motion.reducedMotion.invalid', `${path}.reducedMotion`,
        `reducedMotion must be one of: ${REDUCED_MOTION_MODES.join(', ')}.`);
    }

    try {
      const curve = resolveCurve(t.curve);
      if (curve.type === 'spring' && curve.settlingMs > 1000) {
        f.warn('motion.slow-spring', `${path}.curve`,
          `Spring settles in ~${curve.settlingMs}ms, which will read as sluggish.`);
      }
      if (curve.type !== 'spring' && t.duration == null) {
        f.error('motion.duration', `${path}.duration`, 'Timing curves need an explicit duration.',
          `How long should "${t.on || 'this transition'}" take?`,
          { at: `motion.transitions.${i}.duration`, kind: 'number', unit: 'ms' });
      }
    } catch (err) {
      f.error('motion.curve', `${path}.curve`, err.message,
        'What easing or spring should this transition use?');
    }
  });

  contract.motion?.loops?.forEach((l, i) => {
    const path = `motion.loops[${i}]`;
    if (!l.reducedMotion) {
      f.error('motion.loop.reducedMotion', `${path}.reducedMotion`,
        'Looping animations must declare a reduced-motion fallback.',
        `With reduced motion on, what replaces the "${l.id || 'looping'}" animation?`,
        { at: `motion.loops.${i}.reducedMotion`, kind: 'select', options: REDUCED_MOTION_MODES });
    }
    for (const state of l.activeIn || []) {
      if (!states.includes(state)) {
        f.error('motion.loop.state', `${path}.activeIn`, `Unknown state "${state}".`);
      }
    }
  });

  /* ---------------- accessibility ---------------- */

  if (!contract.a11y?.role) {
    f.error('a11y.role', 'a11y.role', 'No accessibility role declared.',
      'What is this, to a screen reader?',
      { at: 'a11y.role', kind: 'select', options: A11Y_ROLES });
  } else if (!A11Y_ROLES.includes(contract.a11y.role)) {
    f.warn('a11y.role.unknown', 'a11y.role', `Role "${contract.a11y.role}" has no known platform mapping.`);
  }

  if (!contract.a11y?.label?.source) {
    f.error('a11y.label', 'a11y.label.source', 'No accessible name source.',
      'What does a screen reader announce as this component\u2019s name?',
      { at: 'a11y.label.source', kind: 'text', placeholder: 'prop:label' });
  } else if (contract.a11y.label.source.startsWith('prop:')) {
    const p = contract.a11y.label.source.slice(5);
    if (!contract.props?.[p]) {
      f.error('a11y.label.prop', 'a11y.label.source', `Accessible name references unknown prop "${p}".`);
    }
  }

  if (contract.a11y?.minTargetSize == null) {
    f.error('a11y.target', 'a11y.minTargetSize', 'No minimum touch target declared.',
      'What is the minimum touch target? iOS guidance is 44pt, Android 48dp.',
      { at: 'a11y.minTargetSize', kind: 'token', tokenType: 'dimension' });
  } else {
    checkToken(contract.a11y.minTargetSize, 'a11y.minTargetSize');
  }

  if (states.includes('disabled') && !contract.a11y?.state?.disabled) {
    f.warn('a11y.disabled', 'a11y.state.disabled',
      'A disabled state exists but is not exposed to assistive tech.',
      'Should screen readers announce the disabled state?');
  }

  /* ---------------- adaptable ---------------- */

  for (const [name, def] of Object.entries(contract.adaptable || {})) {
    const path = `adaptable.${name}`;
    if (!def.intent) {
      f.error('adaptable.intent', `${path}.intent`, 'Adaptable field needs a stated intent.',
        `What is "${name}" actually for?`,
        { at: `adaptable.${name}.intent`, kind: 'text', placeholder: 'immediate response on touch down' });
    }
    if (!def.envelope) {
      f.error('adaptable.envelope', `${path}.envelope`,
        'Adaptable field needs an envelope, or platforms are unconstrained.',
        `What are the limits on how "${name}" may be implemented?`);
    }
    if (!def.fallback) {
      f.error('adaptable.fallback', `${path}.fallback`,
        'Adaptable field needs a fallback so no team is forced to decide.',
        `If a platform does nothing special, what should "${name}" do?`);
    }
    if (def.envelope?.maxDurationMs && def.fallback?.curve) {
      try {
        const curve = resolveCurve(def.fallback.curve);
        const ms = effectiveDurationMs(curve, def.fallback.durationMs);
        if (ms != null && ms > def.envelope.maxDurationMs) {
          f.error('adaptable.fallback.envelope', `${path}.fallback`,
            `Fallback takes ~${ms}ms but the envelope caps it at ${def.envelope.maxDurationMs}ms.`);
        }
      } catch {
        /* curve errors already reported elsewhere */
      }
    }
  }

  /* ---------------- platform notes ---------------- */

  for (const platform of contract.platforms || []) {
    const dropped = (contract.states || []).filter(
      (s) => POINTER_ONLY_STATES.has(s) && statesForPlatform(contract, platform).indexOf(s) === -1
    );
    if (dropped.length) {
      f.info('platform.states.dropped', 'states',
        `${platform}: ${dropped.join(', ')} removed (no pointer on this platform).`);
    }
  }

  const errors = f.items.filter((i) => i.severity === 'error');
  const warnings = f.items.filter((i) => i.severity === 'warning');

  return {
    ok: errors.length === 0,
    findings: f.items,
    counts: {
      error: errors.length,
      warning: warnings.length,
      info: f.items.length - errors.length - warnings.length,
    },
    /** Open design questions, deduplicated — the review-session agenda. */
    questions: [...new Set(f.items.filter((i) => i.question).map((i) => i.question))],
  };
}
