/**
 * The resolver — the semantic core of the whole system.
 *
 * Takes a contract plus a token index and produces a CLOSED artifact for one
 * platform: every value explicit, every cascade flattened, every curve already
 * converted, every inapplicable state already removed.
 *
 * The guarantee: a platform engineer reading the output never has to make a
 * design decision. Adaptable fields are the one exception, and even they carry
 * a fallback that is already correct.
 */

import { asTokenRef } from './tokens.js';
import { statesForPlatform, axesOf } from './contract.js';
// Every web -> platform mapping lives in src/core/platform-map.js.
import {
  A11Y_ROLE_MAP,
  A11Y_STATE_MAP,
  MECHANISM_PLATFORMS,
  TARGET_FLOOR,
  TARGET_UNIT,
  platformProperty,
  platformRole,
} from './platform-map.js';
import { resolveCurve, effectiveDurationMs } from './animation.js';
import { buildSemantics } from './semantics.js';
import { withTypography, hasTypography } from './typography.js';

export { TARGET_FLOOR, TARGET_UNIT, platformRole };

/** Values that are legal literals rather than token references. */
const LITERALS = new Set(['transparent', 'none', 'inherit', 'currentColor']);

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/*
 * A token reference stays a reference.
 *
 * This used to render the platform's symbol — `DSTokens.semanticColorX` — from
 * a pattern in the config. That guessed at a token library the consuming team
 * may not have, and the guess is unnecessary: the tool never knows a token's
 * value anyway, since the values live in the design system rather than in the
 * component. So the path is emitted as written, in braces, and the team maps
 * it to whatever accessor they already use.
 */
function symbolise(value, tokens, platform, collected, types) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map((v) => symbolise(v, tokens, platform, collected, types));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, symbolise(v, tokens, platform, collected, types)]));
  }
  if (typeof value !== 'string') return value;
  if (LITERALS.has(value)) return value;

  const ref = asTokenRef(value);
  if (ref == null) {
    for (const match of value.matchAll(/\{([\w.-]+)\}/g)) {
      collected.set(match[1], tokens.valueOf(match[1]));
      if (types) types.set(match[1], tokens.typeOf(match[1]));
    }
    return value;
  }

  collected.set(ref, tokens.valueOf(ref));
  if (types) types.set(ref, tokens.typeOf(ref));
  // Braces mark it as a reference, the same way the contract writes it, so a
  // consumer never has to guess whether a dotted string is a token or a value.
  return `{${ref}}`;
}

function numericTokenValue(value, tokens) {
  const ref = asTokenRef(value);
  if (ref == null) return typeof value === 'number' ? value : null;
  const v = tokens.valueOf(ref);
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const m = String(v).match(/^(-?[\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

/* ------------------------------------------------------------------ *
 * resolve
 * ------------------------------------------------------------------ */

/**
 * @param {object} contract  normalised contract
 * @param {import('./tokens.js').TokenIndex} tokens
 * @param {'web'|'ios'|'android'} platform
 * @returns {{artifact: object, diagnostics: Array}}
 */
export function resolve(contract, tokens, platform) {
  const diagnostics = [];
  const tokenValues = new Map();
  const tokenTypes = new Map();
  const axes = axesOf(contract);
  // A component need not have variants or sizes. When it has neither, the
  // matrix collapses to one implicit row per state rather than being empty.
  const variants = axes.variant?.length ? axes.variant : ['default'];
  const sizes = axes.size?.length ? axes.size : ['default'];
  const states = statesForPlatform(contract, platform);
  const roles = contract.appearance?.roles || [];

  const sym = (v) => symbolise(v, tokens, platform, tokenValues, tokenTypes);
  const visualValue = (v) => {
    if (Array.isArray(v)) return v.map(visualValue);
    if (v && typeof v === 'object') {
      if (v.unit === 'px') return { ...v, unit: TARGET_UNIT[platform] };
      return Object.fromEntries(Object.entries(v).map(([key, value]) => [key, visualValue(value)]));
    }
    return sym(v);
  };

  const missing = [];

  /* ---------------- props ---------------- */

  const props = [];
  for (const [name, def] of Object.entries(contract.props || {})) {
    if (def.axis) continue; // axis props surface as `axes`
    const support = def.platforms?.[platform];
    if (support && support.supported === false) {
      diagnostics.push({
        level: 'info',
        message: `prop "${name}" omitted on ${platform}${support.note ? ` — ${support.note}` : ''}`,
      });
      continue;
    }
    const outName = def.names?.[platform] || name;
    const entry = {
      name: outName,
      kind: def.kind,
      required: !!def.required,
    };
    if (name !== outName) entry.sourceName = name;
    if (def.default !== undefined) entry.default = def.default;
    if (def.values) entry.values = [...def.values];
    if (def.description) entry.description = def.description;
    if (def.contentType) entry.contentType = def.contentType;
    if (def.payload) entry.payload = def.payload;
    if (def.constraints) entry.constraints = { ...def.constraints };
    props.push(entry);
  }

  /* ---------------- styles: the flattened matrix ---------------- */

  const focusRing = contract.appearance?.focusRing
    ? {
        color: sym(contract.appearance.focusRing.color),
        // These are token references as often as they are numbers, so they
        // need resolving too — otherwise the spec ships a literal "{...}".
        width: sym(contract.appearance.focusRing.width),
        offset: sym(contract.appearance.focusRing.offset),
        style: contract.appearance.focusRing.style,
      }
    : null;

  const children = contract.composition?.children || {};

  const childVisibility = (state) => {
    const out = {};
    for (const [name, def] of Object.entries(children)) {
      if (Array.isArray(def.visibleIn)) {
        out[name] = def.visibleIn.includes(state) ? 'visible' : 'hidden';
      } else if (Array.isArray(def.hiddenIn) && def.hiddenIn.includes(state)) {
        out[name] = 'hidden';
      } else if (typeof def.boundTo === 'string' && def.boundTo.startsWith('prop:')) {
        out[name] = 'boundToProp';
      } else {
        out[name] = 'visible';
      }
    }
    return out;
  };

  // Rows are built from the contract's own values and symbolised afterwards, so that the
  // text tokens a composite stands for can be replaced before any of them is collected.
  const rawRows = [];
  for (const variant of variants) {
    const block = contract.appearance?.byVariant?.[variant] || {};
    const base = block.default || {};

    for (const size of sizes) {
      const metrics = contract.appearance?.bySize?.[size] || {};

      for (const state of states) {
        const delta = state === 'idle' ? block.idle || {} : block[state] || {};
        const merged = { ...base, ...delta };

        const row = { variant, size, state };
        for (const role of roles) row[role] = merged[role];

        // Any extra role present in the cascade but not declared still ships,
        // rather than silently vanishing.
        for (const [k, v] of Object.entries(merged)) {
          if (!(k in row)) row[k] = v;
        }

        for (const [k, v] of Object.entries(metrics)) row[k] = v;

        if (merged.opacity == null) row.opacity = 1;
        if (focusRing) row.focusRing = focusRing;
        row.children = childVisibility(state);

        rawRows.push(row);
      }
    }
  }

  // Text is stated as the one token it comes from, as colour is. Every row has to carry the
  // same fields, so the matrix switches to the composite only if every row that sets text
  // can; otherwise all of them keep the individual tokens.
  const collapsedRows = rawRows.map(withTypography);
  const useComposite = rawRows.some(hasTypography) && rawRows.every((row, i) => !hasTypography(row) || collapsedRows[i].typography);
  const NOT_VALUES = new Set(['variant', 'size', 'state', 'children', 'focusRing']);
  const styles = (useComposite ? collapsedRows : rawRows).map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, NOT_VALUES.has(k) ? v : visualValue(v)]))
  );

  /* ---------------- per-node styles ---------------- */

  /*
   * The tree carries styling of its own — the container's padding, a child's
   * radius. Without this the platform file describes the component's own box
   * but not its parts, and the team consuming the single file would have to
   * go back to the web source to lay the thing out.
   *
   * These are sparse by nature: a node sets only what it sets. An absent field
   * means "this node does not set it", which is a fact, not a gap — so unlike
   * the matrix these rows are not filled out to a common shape.
   */
  const nodeStyles = [];
  const nodeStyleFields = new Set();

  const collectNodeStyles = (node) => {
    if (!node) return;

    for (const [rawState, decls] of Object.entries(node.styles || {})) {
      // The stylesheet calls the base state `default`; the matrix calls it
      // `idle`. Same state, so use one name in the output.
      const state = rawState === 'default' ? 'idle' : rawState;

      // A state the platform does not have (hover on touch) is dropped here
      // for the same reason it is dropped from the matrix.
      if (!states.includes(state)) {
        diagnostics.push({
          kind: 'droppedNodeState',
          node: node.name,
          state,
          reason: `"${state}" does not exist on ${platform}`,
        });
        continue;
      }

      const row = { node: node.name, state };
      for (const [k, v] of Object.entries(decls || {})) {
        row[k] = visualValue(v);
        nodeStyleFields.add(k);
      }
      nodeStyles.push(row);
    }

    for (const child of node.children || []) collectNodeStyles(child);
  };
  collectNodeStyles(contract.composition?.tree);

  // Resolve selector targets to node identities, retaining ancestor conditions
  // (press the button -> scale its icon), pseudo-elements and media scope.
  const visualRules = [];
  const scopedNodes = [];
  const visitVisual = (node, ancestors = []) => {
    if (!node) return;
    scopedNodes.push({ node, ancestors });
    for (const child of node.children || []) visitVisual(child, [...ancestors, node]);
  };
  visitVisual(contract.composition?.tree);
  const hasClass = (node, name) => (node.styleClass || '').split(/\s+/).includes(name);
  const droppedByDesign = [];
  const unmatchedRules = [];
  for (const rule of contract.visualRules || []) {
    // Hover has no touch equivalent. Dropped for the same reason it is dropped
    // from the matrix, and recorded so its absence is traceable.
    if (platform !== 'web' && rule.conditions.some((c) => c.state === 'hover')) {
      droppedByDesign.push({ order: rule.order, selector: rule.selector, why: `hover does not exist on ${platform}` });
      continue;
    }
    const targets = scopedNodes.filter(({ node, ancestors }) =>
      hasClass(node, rule.targetClass) && rule.conditions.every((c) =>
        c.subject !== 'ancestor' || ancestors.some((a) => hasClass(a, c.className))));
    // A rule that reaches no node is not "nothing to do": it is a rule the
    // markup reader could not connect to the tree, and it must be said so.
    if (!targets.length) unmatchedRules.push(rule);
    for (const { node, ancestors } of targets) {
      visualRules.push({
        node: node.name,
        pseudoElement: rule.pseudoElement,
        conditions: rule.conditions.map((c) => ({
          ...c,
          node: c.subject === 'self' ? node.name : [...ancestors].reverse().find((a) => hasClass(a, c.className))?.name,
        })),
        media: rule.media,
        properties: visualValue(rule.properties),
        transitions: rule.transitions,
        source: rule.selector,
        order: rule.order,
        ...(rule.manualTranslation ? { manualTranslation: true } : {}),
      });
    }
  }

  /* ---------------- hit area ---------------- */

  const declaredTarget = numericTokenValue(contract.a11y?.minTargetSize, tokens);
  const floor = TARGET_FLOOR[platform];
  if (declaredTarget != null && declaredTarget < floor) {
    diagnostics.push({
      level: 'warning',
      message:
        `a11y.minTargetSize resolves to ${declaredTarget}${TARGET_UNIT[platform]} but ` +
        `${platform} guidance is ${floor}${TARGET_UNIT[platform]}. The contract value is used as-is — ` +
        `raise it in the contract if that is not intended.`,
    });
  }

  const hitArea = {
    strategy: contract.hitArea?.strategy ?? null,
    min: declaredTarget ?? floor,
    unit: TARGET_UNIT[platform],
  };

  /* ---------------- motion ---------------- */

  const motion = [];
  for (const t of contract.motion?.transitions || []) {
    if (!t.on || !t.on.includes('->')) continue;
    const [from, to] = t.on.split('->').map((s) => s.trim());

    const applies = (s) => s === '*' || states.includes(s);
    if (!applies(from) || !applies(to)) {
      diagnostics.push({
        level: 'info',
        message: `motion "${t.on}" dropped on ${platform} (state not applicable)`,
      });
      continue;
    }

    let curve;
    try {
      curve = resolveCurve(t.curve);
    } catch (err) {
      diagnostics.push({ level: 'error', message: `motion "${t.on}": ${err.message}` });
      continue;
    }

    const platformCurve =
      curve.type === 'spring'
        ? { type: 'spring', ...curve[platform], settlingMs: curve.settlingMs, overshoots: curve.overshoots }
        : { type: 'cubicBezier', ...curve[platform], value: curve.value };

    motion.push({
      from,
      to,
      properties: [...t.properties],
      // The same properties named the way this platform expresses them, so an
      // animated `transform` arrives as `graphicsLayer` on Android and a
      // transform modifier on iOS rather than a web-only string.
      platformProperties: t.properties.map((p) => platformProperty(p, platform)),
      toValues: t.to || {},
      durationMs: effectiveDurationMs(curve, t.duration),
      curve: platformCurve,
      interruptible: t.interruptible !== false,
      reducedMotion: t.reducedMotion,
    });
  }

  const loops = [];
  for (const l of contract.motion?.loops || []) {
    const activeIn = (l.activeIn || []).filter((s) => states.includes(s));
    if (!activeIn.length) continue;
    let curve;
    try {
      curve = resolveCurve(l.curve || { type: 'linear' });
    } catch {
      curve = resolveCurve({ type: 'linear' });
    }
    loops.push({
      id: l.id,
      activeIn,
      property: l.property,
      platformProperty: platformProperty(l.property, platform),
      from: l.from,
      to: l.to,
      durationMs: l.duration,
      curve: curve.type === 'spring' ? curve[platform] : { type: 'cubicBezier', value: curve.value },
      iterations: l.iterations ?? 'infinite',
      reducedMotion: l.reducedMotion,
    });
  }

  /* ---------------- adaptable ---------------- */

  const adaptable = {};
  for (const [name, def] of Object.entries(contract.adaptable || {})) {
    const allowed = (def.envelope?.allowed || []).filter((mech) => {
      const supported = MECHANISM_PLATFORMS[mech];
      return !supported || supported.includes(platform);
    });

    adaptable[name] = {
      intent: def.intent,
      preferred: def.preferred || 'fallback',
      envelope: { ...def.envelope, allowed },
      fallback: def.fallback,
    };

    if (!allowed.length && def.envelope?.allowed?.length) {
      adaptable[name].preferred = 'fallback';
      diagnostics.push({
        level: 'info',
        message: `adaptable "${name}": no allowed mechanism is available on ${platform}; using the fallback.`,
      });
    }
  }

  /* ---------------- accessibility ---------------- */

  const roleMap = A11Y_ROLE_MAP[contract.a11y?.role] || null;
  const a11yStates = {};
  for (const [key, enabled] of Object.entries(contract.a11y?.state || {})) {
    if (!enabled) continue;
    const mapping = A11Y_STATE_MAP[key]?.[platform];
    if (mapping) a11yStates[key] = mapping;
  }

  const a11y = {
    ...(roleMap ? roleMap[platform] : {}),
    labelSource: contract.a11y?.label?.source || null,
    labelRequired: !!contract.a11y?.label?.required,
    focusable: contract.a11y?.focus?.focusable !== false,
    focusIndicator: contract.a11y?.focus?.indicator || null,
    states: a11yStates,
    minTarget: hitArea.min,
    minTargetUnit: hitArea.unit,
    // Which number is this? The component may state a token whose value this
    // tool cannot know, in which case the platform guidance floor is shown and
    // the token is named so the two are not mistaken for each other.
    minTargetSource: declaredTarget != null ? 'component' : 'platform guidance',
    ...(contract.a11y?.minTargetSize != null && declaredTarget == null ? { minTargetToken: contract.a11y.minTargetSize } : {}),
  };

  if (platform === 'web') {
    a11y.keyboard = (contract.a11y?.keyboard || []).map((k) => ({ key: k.key, action: k.action }));
  }

  /* ---------------- roles in the tree ---------------- */

  /*
   * What each node in the markup is to assistive technology on this platform.
   * The emitters worked this out themselves at write time, so the UI had no
   * way to show it; now both read the same list.
   */
  const a11yNodes = [];
  const walkRoles = (node) => {
    if (!node) return;
    if (node.role) {
      const r = platformRole(node.role, platform);
      a11yNodes.push({
        node: node.name,
        role: node.role,
        // The concept, not the platform's spelling of it.
        kind: r?.kind ?? null,
        concept: r?.concept ?? null,
        text: r?.text ?? null,
        actions: r?.actions || [],
        unmapped: !!r?.unmapped,
        plain: !!r?.plain,
        hidden: !!r?.hidden,
        label: node.a11y?.label || null,
      });
    }
    for (const child of node.children || []) walkRoles(child);
  };
  walkRoles(contract.composition?.tree);

  /* ---------------- behaviour ---------------- */

  const behaviorStates = {};
  for (const [name, node] of Object.entries(contract.behavior?.states || {})) {
    if (!states.includes(name)) continue;
    const on = {};
    for (const [event, t] of Object.entries(node.on || {})) {
      const spec = typeof t === 'string' ? { target: t } : t;
      if (spec.platforms && !spec.platforms.includes(platform)) continue;
      if (!states.includes(spec.target)) continue;
      on[event] = {
        target: spec.target,
        ...(spec.guard ? { guard: spec.guard } : {}),
        ...(spec.actions ? { actions: [...spec.actions] } : {}),
      };
    }
    behaviorStates[name] = {
      ...(node.entry ? { entry: [...node.entry] } : {}),
      ...(node.exit ? { exit: [...node.exit] } : {}),
      ...(node.after ? { after: node.after } : {}),
      on,
    };
  }

  /* ---------------- build-ready semantics ---------------- */

  const semantics = buildSemantics({
    contract,
    platform,
    nodeStyles,
    visualRules,
    a11yNodes,
    bindings: contract.interactionBindings || [],
    legacyMotion: motion,
    legacyLoops: loops,
    logic: contract.logic || [],
    a11yStates,
    sourceRules: contract.visualRules || [],
    unmatchedRules,
    droppedByDesign,
    keyframes: contract.keyframes || {},
    rootFields: [...new Set(styles.flatMap((row) => Object.keys(row)))],
  });
  for (const n of semantics.notes) diagnostics.push({ level: 'info', message: n });

  /* ---------------- artifact ---------------- */

  const artifact = {
    component: contract.id,
    name: contract.name,
    description: contract.description || '',
    contractVersion: contract.contractVersion,
    platform,
    generatedAt: null, // filled by the emitter so repeat runs stay byte-identical
    axes: {
      ...Object.fromEntries(Object.entries(axes).filter(([k]) => k !== 'state')),
      state: states,
    },
    props,
    /**
     * Every field a style row is required to carry. Emitted so the closure gate
     * can detect an ABSENT key — iterating a row only ever finds keys that
     * exist, so a metric dropped from the contract would otherwise pass
     * silently and become a guess on the platform side.
     */
    /**
     * The fields every style row must carry.
     *
     * Derived from what the component actually sets, not from a checklist. A
     * component that never states a corner radius is not incomplete — it has
     * no corner radius. What does matter is that every row carries the same
     * fields, or the generated struct would have an inconsistent shape.
     */
    requiredFields: [
      ...new Set(
        styles.flatMap((row) =>
          Object.keys(row).filter((k) => !['variant', 'size', 'state', 'children', 'focusRing'].includes(k))
        )
      ),
    ],
    layout: {
      ...contract.layout,
      childOrder: [...(contract.layout?.childOrder || [])],
      sizing: { ...contract.layout?.sizing },
    },
    styles,
    nodeStyles,
    visualRules,
    nodes: semantics.nodes,
    animations: semantics.animations,
    hitAreas: semantics.hitAreas,
    focusRings: semantics.focusRings,
    coverage: semantics.coverage,
    unresolvedConditions: semantics.unresolvedConditions,
    sourceEvents: semantics.sourceEvents,
    conditionallyRendered: semantics.conditionallyRendered,
    externalComponents: semantics.externalComponents,
    concepts: semantics.concepts,
    ignoredProperties: contract.ignoredProperties || { webOnly: [], unrecognised: [] },
    sourceConstants: contract.sourceConstants || [],
    logic: contract.logic || [],
    stateDocs: contract.stateDocs || {},
    interactionBindings: contract.interactionBindings || [],
    sourceNotes: [...(contract.sourceNotes || []), ...semantics.notes],
    a11yNodes,
    nodeStyleFields: [...nodeStyleFields],
    hitArea,
    motion,
    loops,
    adaptable,
    a11y,
    behavior: {
      initial: states.includes(contract.behavior?.initial) ? contract.behavior.initial : states[0] || null,
      guards: { ...(contract.behavior?.guards || {}) },
      states: behaviorStates,
    },
    tokenValues: Object.fromEntries([...tokenValues.entries()].sort()),
    tokenTypes: Object.fromEntries([...tokenTypes.entries()].sort()),
  };

  return { artifact, diagnostics };
}

/* ------------------------------------------------------------------ *
 * Completeness check — the --strict gate
 * ------------------------------------------------------------------ */

/**
 * Verifies the artifact is CLOSED: no nulls, no prose, nothing left to decide.
 * A failure here is a bug in the contract, not in the platform team's judgement.
 */
export function checkClosed(artifact) {
  const problems = [];

  if (!artifact.axes.state.length) problems.push('axes.state is empty');
  if (!artifact.styles.length) problems.push('styles matrix is empty');

  // A component need not have variants or sizes; the matrix collapses to one
  // implicit row per state when it has neither.
  const expectedRows =
    (artifact.axes.variant?.length || 1) *
    (artifact.axes.size?.length || 1) *
    artifact.axes.state.length;
  if (artifact.styles.length !== expectedRows) {
    problems.push(`styles has ${artifact.styles.length} rows, expected ${expectedRows}`);
  }

  artifact.styles.forEach((row) => {
    const where = `styles[${row.variant}/${row.size}/${row.state}]`;

    // Absent keys first. Object.entries can only see what is present, so a
    // field dropped from the contract would otherwise never be noticed.
    for (const field of artifact.requiredFields || []) {
      if (!(field in row)) problems.push(`${where}.${field} is missing`);
    }

    for (const [key, value] of Object.entries(row)) {
      if (key === 'children' || key === 'focusRing') continue;
      if (value === null || value === undefined || value === '') {
        problems.push(`${where}.${key} is unresolved`);
      }
    }
    if (row.focusRing) {
      for (const k of ['color', 'width', 'offset', 'style']) {
        if (row.focusRing[k] == null) problems.push(`${where}.focusRing.${k} is unresolved`);
      }
    }
  });

  for (const [name, def] of Object.entries(artifact.adaptable || {})) {
    if (!def.fallback) problems.push(`adaptable.${name} has no fallback`);
    if (!def.envelope) problems.push(`adaptable.${name} has no envelope`);
  }

  artifact.motion.forEach((m, i) => {
    if (!m.reducedMotion) problems.push(`motion[${i}] has no reducedMotion`);
    if (m.curve.type !== 'spring' && m.durationMs == null) {
      problems.push(`motion[${i}] has no duration`);
    }
  });

  // Every animation must say what reduced motion does to it. Absence is a
  // question for the designer, not a default the platform may choose.
  (artifact.animations || []).forEach((a) => {
    if (!a.reducedMotion) problems.push(`animations[${a.id}] (${a.node || a.on}: ${a.property}) has no reduced-motion behaviour`);
    if (a.timing?.durationMs == null && a.timing?.curve?.type !== 'spring') problems.push(`animations[${a.id}] has no duration`);
  });

  if (!artifact.a11y.labelSource) problems.push('a11y.labelSource is unresolved');
  if (artifact.a11y.minTarget == null) problems.push('a11y.minTarget is unresolved');

  // Deliberately not checked: a token with no known value. The component
  // referenced it without declaring it, and the platform's own token library
  // supplies the value at build time. The NAME is what has to resolve.

  return { closed: problems.length === 0, problems };
}
