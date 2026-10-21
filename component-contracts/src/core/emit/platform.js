/**
 * The per-platform artifact, as data.
 *
 * Platform-specific but framework-agnostic. It states what iOS and Android
 * each need — 44pt against 48dp, a `button` trait against a `Button` role,
 * `action` against `onClick` — without naming a UI framework or a token
 * library. Earlier this emitted Swift and Kotlin source, which forced
 * SwiftUI and Jetpack Compose on a team that might use neither, and referred
 * to a `DSTokens` accessor invented from a pattern in the config.
 *
 * Tokens appear as the path the component wrote, in braces. The tool does not
 * know their values — those live in the design system — so a reference is the
 * only honest thing to emit, and the team maps it to their own accessor.
 *
 * The file is laid out to be built from, top to bottom: the component's API,
 * then one description per node, then the animations, hit areas and focus
 * rings that act on those nodes. The raw rules those were derived from sit
 * under `evidence`, for tracing a value rather than for building from.
 *
 * Framework idioms (SwiftUI, Compose) are an opt-in, advisory block, written
 * only when the config names a framework for the platform. They are kept apart
 * from the data so the data stays framework-agnostic.
 */

import { IDIOMS, TARGET_FLOOR, TARGET_UNIT } from '../platform-map.js';

/**
 * One statement of the touch target, instead of four fields that disagreed.
 *
 * The component may state a minimum (a token whose value this tool cannot know,
 * or a number); the platform has its own guidance. Showing guidance as "the
 * minimum" beside a hit area of a different stated size read as a contradiction
 * (44 against 48). Both are given, labelled, with the one to build to.
 */
function touchTarget(a, platform) {
  const stated = a.minTargetSource === 'component' ? a.minTarget : (a.minTargetToken ?? null);
  return {
    stated,
    ...(typeof stated === 'number' ? { unit: a.minTargetUnit } : {}),
    platformGuidance: { value: TARGET_FLOOR[platform], unit: TARGET_UNIT[platform] },
    buildTo: stated != null ? 'stated' : 'platformGuidance',
  };
}

/** The accessibility block as a team reads it: the touch target is one object. */
function publicAccessibility(a, platform) {
  // `states` is left out: every announced state is stated on its node, with WHEN it applies,
  // and a second map here said less (no condition) and read as a contradiction when empty.
  const { minTarget: _m, minTargetUnit: _u, minTargetSource: _s, minTargetToken: _t, states: _st, ...rest } = a;
  return { ...rest, touchTarget: touchTarget(a, platform) };
}

function buildAssertions(artifact) {
  const out = [];
  const add = (id, tier, kind, message, params = {}) => out.push({ id, tier, kind, message, params });

  for (const [axis, values] of Object.entries(artifact.axes)) {
    if (!values?.length) continue;
    add(`axis.${axis}`, 'exact', 'enumExact', `The ${axis} axis must have exactly these values`, {
      axis,
      values: values.join(','),
    });
  }

  for (const p of artifact.props || []) {
    add(`prop.${p.name}`, 'exact', 'propExists',
      `Property "${p.name}" must exist and be ${p.required ? 'required' : 'optional'}`,
      { name: p.name, kind: String(p.kind), required: String(!!p.required) });
  }

  const rows = artifact.styles?.length || 0;
  if (rows) {
    add('style.total', 'exact', 'styleTableTotal',
      `The style lookup must cover all ${rows} combinations with no default branch`,
      { rows: String(rows), table: 'styles' });
  }

  // Animations that name a node and a target. Each is complete on its own, so
  // one assertion per animation is enough; the values are in `animations`.
  for (const a of artifact.animations || []) {
    const where = a.node ?? a.on;
    add(`animation.${a.id}`, 'exact', 'animationApplied',
      `${a.kind === 'loop' ? 'Loop' : 'Transition'} of ${a.property} on ${where} must follow animations[${a.id}]`,
      {
        node: String(a.node ?? ''), property: String(a.property), kind: a.kind,
        durationMs: String(a.timing?.durationMs ?? ''),
        reducedMotion: a.reducedMotion ? JSON.stringify(a.reducedMotion) : 'unstated',
      });
  }

  // Hand-authored contracts still carry springs and state-pair motion.
  (artifact.motion || []).forEach((m, i) => {
    if (m.curve?.type === 'spring') {
      add(`motion.${i}.damping`, 'exact', 'motionEquals', `Spring damping for ${m.from}->${m.to}`, {
        from: String(m.from), to: String(m.to),
        field: m.curve.dampingFraction != null ? 'dampingFraction' : 'dampingRatio',
        expect: String(m.curve.dampingFraction ?? m.curve.dampingRatio), tolerance: '0.01',
      });
      add(`motion.${i}.rate`, 'exact', 'motionEquals', `Spring rate for ${m.from}->${m.to}`, {
        from: String(m.from), to: String(m.to),
        field: m.curve.response != null ? 'response' : 'stiffness',
        expect: String(m.curve.response ?? m.curve.stiffness),
        tolerance: m.curve.response != null ? '0.01' : '1',
      });
    } else {
      add(`motion.${i}.duration`, 'exact', 'motionEquals', `Duration for ${m.from}->${m.to}`, {
        from: String(m.from), to: String(m.to), field: 'durationMs',
        expect: String(m.durationMs), tolerance: '0',
      });
    }
    if (m.reducedMotion != null) {
      add(`motion.${i}.reducedMotion`, 'exact', 'reducedMotionDeclared',
        `Reduced-motion behaviour for ${m.from}->${m.to}`,
        { from: String(m.from), to: String(m.to), expect: String(m.reducedMotion) });
    }
  });

  for (const h of artifact.hitAreas || []) {
    add(`hitArea.${h.node}`, 'exact', 'hitAreaMinimum',
      `The interactive region of ${h.node} must be at least the stated minimum, centred on it`,
      { node: h.node, minWidth: JSON.stringify(h.min.width), minHeight: JSON.stringify(h.min.height) });
  }
  for (const f of artifact.focusRings || []) {
    add(`focusRing.${f.node}`, 'exact', 'focusRingDrawn',
      `${f.node} must draw its focus ring while focused, as stated in focusRings`, { node: f.node });
  }

  const a = artifact.a11y || {};
  if (a.traits?.length)
    add('a11y.traits', 'exact', 'a11yTraits', 'Accessibility traits must match', { expect: a.traits.join(',') });
  if (a.role) add('a11y.role', 'exact', 'a11yRole', `Accessibility role must be ${a.role}`, { expect: String(a.role) });
  if (a.minTarget) {
    const t = touchTarget(a, artifact.platform);
    const want = t.buildTo === 'stated' ? t.stated : t.platformGuidance.value;
    add('a11y.minTarget', 'exact', 'minTouchTarget',
      `The touch target must be at least ${typeof want === 'number' ? `${want}${t.unit || t.platformGuidance.unit}` : want}`,
      { expect: String(want), buildTo: t.buildTo, platformGuidance: `${t.platformGuidance.value}${t.platformGuidance.unit}` });
  }
  for (const [stateName, mapping] of Object.entries(a.states || {})) {
    const how = mapping.trait ? `.${mapping.trait}` : mapping.semantics || mapping.property || '';
    add(`a11y.state.${stateName}`, 'exact', 'a11yStateExposed',
      `"${stateName}" must be exposed to assistive technology`, { state: stateName, expect: String(how) });
  }
  for (const n of artifact.a11yNodes || []) {
    if (!n.concept) continue;
    add(`a11y.node.${n.node}`, 'exact', 'a11yNodeRole',
      `"${n.node}" must be exposed as ${n.kind}: ${n.concept}`,
      {
        node: n.node,
        kind: String(n.kind),
        expect: Array.isArray(n.concept) ? n.concept.join(',') : String(n.concept),
        actions: (n.actions || []).join(','),
      });
  }

  for (const [stateName, node] of Object.entries(artifact.behavior?.states || {})) {
    for (const [event, t] of Object.entries(node.on || {})) {
      add(`behavior.${stateName}.${event}`, 'exact', 'transition',
        `${stateName} + ${event} must go to ${t.target}`,
        { from: stateName, event, to: String(t.target), guard: String(t.guard || '') });
    }
  }

  for (const [name, def] of Object.entries(artifact.adaptable || {})) {
    add(`adaptable.${name}`, 'envelope', 'envelopeBounded',
      `"${name}" may use any allowed mechanism but must stay inside the envelope; doing nothing and using the fallback also passes`,
      {
        field: name,
        allowed: (def.envelope?.allowed || []).join(','),
        maxDurationMs: String(def.envelope?.maxDurationMs ?? ''),
        mustPreserveLayout: String(def.envelope?.mustPreserveLayout ?? false),
      });
  }

  return out;
}

/** Path segments that structure the document without naming what a value is. */
const STRUCTURAL = new Set(['layout', 'appearance', 'value', 'basis', 'expression', 'syntax']);

/**
 * What each token is USED AS: the role its position gives it (`text.size`,
 * `padding.top`, `border.color`). A token's declared type says only
 * "dimension"; where it sits says whether that is a font size, a gap or a
 * corner radius, which decides how a platform treats it. Derived by walking the
 * spec, not by reading the token's name.
 */
function tokenRoles(artifact) {
  const roles = new Map();
  const add = (token, role) => {
    if (!role) return;
    if (!roles.has(token)) roles.set(token, new Set());
    roles.get(token).add(role);
  };
  const visit = (value, path, prefix) => {
    if (typeof value === 'string') {
      for (const m of value.matchAll(/\{([\w.-]+)\}/g)) add(m[1], [prefix, ...path.filter((k) => !STRUCTURAL.has(k))].filter(Boolean).join('.'));
    } else if (Array.isArray(value)) {
      value.forEach((v) => visit(v, path, prefix));
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) visit(v, [...path, k], prefix);
    }
  };

  const nodes = artifact.nodes || [];
  for (const n of nodes) {
    visit(n.layout, [], '');
    visit(n.appearance, [], '');
    for (const c of n.conditional || []) { visit(c.layout, [], ''); visit(c.appearance, [], ''); }
  }
  for (const h of artifact.hitAreas || []) visit(h.min, [], 'hitArea.min');
  for (const f of artifact.focusRings || []) {
    const { node: _n, trigger: _t, source: _s, ...rest } = f;
    visit(rest, [], 'focusRing');
  }
  // A hand-authored contract has no nodes, only the style matrix.
  if (!nodes.length) {
    for (const row of artifact.styles || []) {
      for (const [k, v] of Object.entries(row)) if (!['variant', 'size', 'state', 'children'].includes(k)) visit(v, [k], 'style');
    }
  }
  return roles;
}

/** Every token this artifact references, with its declared type and what it is used as. */
function tokenIndex(artifact) {
  const roles = tokenRoles(artifact);
  const out = {};
  for (const [path, type] of Object.entries(artifact.tokenTypes || {})) {
    out[path] = {
      type,
      value: artifact.tokenValues?.[path] ?? null,
      ...(roles.has(path) ? { usedAs: [...roles.get(path)].sort() } : {}),
    };
  }
  return out;
}

/**
 * Framework idioms for the concepts this spec actually uses, for one platform.
 * Advisory. A concept with no idiom is listed under `without` rather than given
 * one, so a gap in the table is visible instead of silent.
 */
function implementationHints(artifact, framework) {
  const table = IDIOMS.concepts;
  const concepts = {};
  const without = [];
  for (const id of artifact.concepts || []) {
    const idiom = table[id]?.[framework];
    if (!idiom) { without.push(id); continue; }
    // `note` is framework-neutral and shared. `frameworkNote` is this framework's own,
    // so a SwiftUI file never carries Compose advice and the reverse.
    const own = table[id].notes?.[framework];
    concepts[id] = { idiom, ...(table[id].note ? { note: table[id].note } : {}), ...(own ? { frameworkNote: own } : {}) };
  }
  return { framework, advisory: IDIOMS.$note, concepts, ...(without.length ? { without } : {}) };
}

/** True when more than one style row exists and every row carries the same values. */
function sameStyles(rows = [], axes = {}) {
  if (rows.length < 2) return false;
  const axisKeys = new Set([...Object.keys(axes), 'variant', 'size', 'state']);
  const body = (r) => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !axisKeys.has(k))));
  const first = body(rows[0]);
  return rows.every((r) => body(r) === first);
}

const GUIDE = {
  buildFrom: ['props', 'axes', 'styles', 'nodes', 'animations', 'hitAreas', 'focusRings', 'accessibility', 'sourceConstants', 'behaviorSource'],
  precedence:
    'nodes hold the layout and appearance to build. An entry in a node\'s conditional list changes that node while every condition in its `when` holds. ' +
    'evidence is the raw source those were derived from: use it to trace a value, not to build from. Behaviour that is logic rather than style (when a control is disabled, what holding it does, which keys act on it) is in behaviorSource, quoted verbatim for you to translate.',
  values: [
    'A value in {braces} is a design-token path. Resolve it through your own token accessor; this file never knows a token value.',
    'A bare number in a length position is in logical units: points on iOS, density-independent pixels on Android. {value, unit} states the unit.',
    '{expression, syntax: "arithmetic"} is a calc() with every token operand kept. Resolve the tokens, then evaluate.',
    '"none" and "transparent" as a background mean no fill.',
    'size modes are relative to the parent stack: fixed, fill, hug, percentOfParent, or flex with grow, shrink and basis.',
    'A condition with attribute and equals is true when that attribute has that value. `driver` says what sets it: a prop, a source-backed state with its activation, a source expression, or a spread of a helper (driver.spread and driver.logic point at the behaviorSource entries to translate).',
    'includesBorderAndPadding: true means width and height include the border and padding, so children are laid out INSIDE the border. Where a platform draws a border without taking layout space (a stroke overlay), inset the content by the border width.',
    'appearance.typography is the text token: one composite token, for example {semantic.typography.label.l}, that stands for the font family, size, weight, line height and letter spacing together. Resolve it through your own token accessor like any other token. The individual tokens it stands for are not listed. When a node\'s text properties do not all come from one such token, they are stated one by one under appearance.text instead. Other text properties (tabular figures, truncation) are always under appearance.text.',
    'tokens[].usedAs says what each token is used as (text.size, padding.top, border.color), derived from where it appears. A declared type alone only says dimension.',
    'A gap, padding or margin that is not stated is zero. CSS has no implicit spacing; a native stack may, so state zero explicitly rather than relying on its default.',
    'A focus ring is a band as thick as its width. The offset is measured from the node edge, positive outward: the band\'s inner edge sits at the offset and its outer edge at offset + width. A negative offset puts the band inside the node. focusVisible: true means the source draws it on :focus-visible, which is keyboard focus and not a pointer press; whether a platform has an equivalent is the team\'s decision.',
    'A condition with state (focused, pressed) is true while the control is in that interaction state, which the platform tracks itself. It has no attribute because nothing in the markup sets it.',
    'A hit area is a positioned element, so where it overlaps a sibling that is not positioned it receives the pointer first. centered: its centre is the node centre. atLeastNodeBox: it is never smaller than the node, and min is the floor above that. affectsLayout: false is how the source behaves (it takes no layout space); whether a platform can do the same is the team\'s decision. removedWhen is a list of alternatives: the hit area is removed when ANY one of them holds, and an alternative is itself a list of conditions that must ALL hold.',
    'A prop or constant description is the author\'s own comment, quoted as written and not checked against the code. Where it disagrees with behaviorSource or an animation timeline, the quoted logic is the behaviour.',
    'accessibility.labelSource is the prop a component takes its name from by default. How each node is actually named, including when another element names it (labelledBy), is stated on the node under accessibility.',
    'accessibility.labelRequired is whether the consumer must supply the label, taken from the declared prop. A node can still be named by a default in the quoted logic.',
    'tabOrder.included says whether a node is in the keyboard tab order, from a tabIndex on the markup or a literal in a spread helper. false (tabIndex -1) leaves the node focusable by script or pointer; it is not "cannot be focused".',
    'reducedMotion is what the stylesheet does to that animation when the user asks for reduced motion. The end values still apply and only the animation changes. Whether the change should still happen at all is a design decision the source does not state.',
    'An animation timeline states the activation, the reset and holdAtChangedMs (zero means it rises and falls with no plateau at the changed value). resetDelayExpression is the delay as the source writes it, so it can be traced to sourceConstants.',
    'A value read from the markup (a content, a label, a range, a condition) is one of: {prop} a prop the component declares; {derived} a value the component computes itself, whose statement is in behaviorSource; {expression} source text for translation, with uses naming the derived values it reads; {literal}. A derived value that shares a prop\'s name is the derived value, not the prop. A {prop} that is not listed in props is modelled as a state (loading, disabled): find it in axes.state.',
    'accessibility.valueRange is the range a control announces (now, min, max, text), each as one of the forms above. labelledBy and describedBy name another element by id in the source; neither platform has that, so each is the prop that carries the id and the string it becomes is the team\'s decision.',
    'An announced state marked wording: "not stated in the source" takes a string on this platform. The source says the control is in that state, not what to say.',
    'props[].kind "number" is a JavaScript number: the source states no integer constraint, so whether to accept fractions is not given.',
    'behaviorSource.events lists the web events and feedback the source uses and where, by name. It does not say what a handler does: that is the quoted statement.',
  ],
  unresolved:
    'unresolvedConditions names conditions whose cause is set inside the component and was not extracted. Read the source for those; do not assume.',
  coverage:
    'coverage.unplaced lists any stylesheet rule that could not be placed on a node. Empty means every rule is accounted for; droppedByDesign lists what this platform legitimately lacks.',
};

export function emitPlatformJson(artifact, { tool, contract, frameworks } = {}) {
  const framework = frameworks?.[artifact.platform] || null;
  const hasNodes = (artifact.nodes || []).length > 0;

  const doc = {
    $schema: 'https://component-contracts.dev/schema/platform-spec-1.json',
    $note:
      'Platform-specific, framework-agnostic. Values in {braces} are token paths — ' +
      'resolve them through your own token accessor. Everything else is literal.',

    component: artifact.component,
    name: artifact.name,
    description: artifact.description || null,
    platform: artifact.platform,
    contractVersion: artifact.contractVersion,
    generatedBy: tool || null,

    guide: GUIDE,

    props: artifact.props,
    axes: artifact.axes,
    ...(Object.keys(artifact.stateDocs || {}).length ? { stateDocs: artifact.stateDocs } : {}),
    sourceConstants: artifact.sourceConstants || [],

    /* The fully enumerated matrix: one row per variant x size x state. */
    styles: artifact.styles,
    ...(sameStyles(artifact.styles, artifact.axes) ? {
      stylesNote: 'Every row has the same values, so this table varies nothing by the axes. A change that depends on a state is not here: it is under nodes[].conditional and animations.',
    } : {}),
    requiredFields: artifact.requiredFields || [],

    /* One description per node, with its conditional changes. */
    ...(hasNodes ? {} : { layout: artifact.layout || null }),
    nodes: artifact.nodes || [],

    animations: artifact.animations || [],
    hitAreas: artifact.hitAreas || [],
    focusRings: artifact.focusRings || [],

    /*
     * The logic the markup depends on, quoted verbatim. A stylesheet cannot say
     * when a button is disabled or what holding it does; this is where that is
     * stated. It is source text for translation, not data to interpret.
     */
    ...((artifact.logic || []).length || (artifact.sourceEvents || []).length ? {
      behaviorSource: {
        note: 'Source statements the markup depends on, quoted exactly as written for you to translate. A node lists the ones its own markup refers to under logic; each entry lists what it uses. Nothing here has been evaluated or summarised.',
        language: 'typescript',
        entries: artifact.logic || [],
        ...((artifact.sourceEvents || []).length ? {
          events: artifact.sourceEvents,
          eventsNote: 'The web events and feedback the source uses, found by name in the quoted statements and the markup. This says the source listens for them, not what it does with them: that is the quoted statement. A concept here has an idiom under implementationHints.',
        } : {}),
      },
    } : {}),

    accessibility: publicAccessibility(artifact.a11y, artifact.platform),
    behavior: artifact.behavior || null,
    adaptable: artifact.adaptable || {},

    /* What to read the source for, and what was left out on purpose. */
    unresolvedConditions: artifact.unresolvedConditions || [],
    ...((artifact.externalComponents || []).length ? {
      externalComponents: {
        nodes: artifact.externalComponents,
        why: 'These nodes render a component that is defined elsewhere. Its glyph or content, its intrinsic size and whether it takes the surrounding foreground colour are not in this spec: use the platform equivalent your design system provides.',
      },
    } : {}),
    ...((artifact.conditionallyRendered || []).length ? {
      conditionallyRendered: {
        nodes: artifact.conditionallyRendered,
        why: 'These nodes sit behind a condition in the markup (a ternary or &&), so they are not always present. The condition is source logic and is not extracted: read the source for when each is shown.',
      },
    } : {}),
    implementationNotes: artifact.sourceNotes || [],
    coverage: artifact.coverage || null,
    droppedProperties: {
      webOnly: artifact.ignoredProperties?.webOnly || [],
      unrecognised: artifact.ignoredProperties?.unrecognised || [],
    },

    /* What an implementation must satisfy. */
    conformance: buildAssertions(artifact),

    tokens: tokenIndex(artifact),

    ...(framework ? { implementationHints: implementationHints(artifact, framework) } : {}),

    evidence: {
      note: 'The raw rules the sections above were derived from. Trace a value here; do not build from it.',
      // The base rules are already inside visualRules, so nodeStyles is only
      // needed when a contract was authored by hand and has no rules to read.
      ...((artifact.visualRules || []).length ? {} : { nodeStyles: artifact.nodeStyles || [] }),
      visualRules: artifact.visualRules || [],
      interactionBindings: artifact.interactionBindings || [],
    },
  };

  return JSON.stringify(doc, null, 2) + '\n';
}
