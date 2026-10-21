/**
 * Build-ready semantics, derived from what the component's CSS and markup state.
 *
 * A platform team should not have to re-read flexbox. This turns the raw rules
 * into one description per node (how it is laid out, how it looks, how it looks
 * under each condition), plus the animations, hit areas and focus rings that
 * are otherwise scattered across a stylesheet.
 *
 * It decides nothing. Every name it writes comes from the tables in
 * platform-map.json, every value from the component, and every rule it could not
 * place is reported by `coverage` instead of being dropped. If a pattern is only
 * partly present (a pseudo-element that looks like a hit area but has no minimum
 * size) it is left as ordinary rules rather than promoted to something it may
 * not be.
 *
 * What it will not do: invent a start value, an end value or a timing the source
 * does not give. An animation of `transform` with nothing that sets a transform
 * is dropped with a note, never emitted as a target-less "transform". And where a
 * condition's cause is not in the markup (an attribute set through a spread or a
 * helper), it says so under `unresolvedConditions` instead of implying it knows.
 */

import { SEMANTIC_FIELDS, SEMANTIC_VALUES, HIT_AREA_PATTERN, ANIMATION, A11Y_STATE_MAP, SOURCE_EVENTS } from './platform-map.js';
import { resolveCurve } from './animation.js';

const LAYOUT_KEYS = new Set(['container', 'item', 'size', 'padding']);

const setPath = (obj, path, value) => {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
};

const isManual = (v) => v && typeof v === 'object' && v.manualTranslation;
const isPercent = (v) => v && typeof v === 'object' && v.unit === '%';
const present = (v) => v !== undefined && v !== null;

/** CSS roles -> the spec's concept tree, using only the tables in platform-map.json. */
function normalise(props) {
  const out = {}, notApplied = [], unmapped = [];
  for (const [role, value] of Object.entries(props || {})) {
    const field = SEMANTIC_FIELDS[role];
    if (!field) { unmapped.push({ role, value }); continue; }
    if (isManual(value)) { unmapped.push({ role, value: value.raw ?? value.source }); continue; }

    let mapped = value;
    if (field.values) {
      const table = SEMANTIC_VALUES[field.values];
      if (typeof value === 'string' && Object.hasOwn(table, value)) mapped = table[value];
      else { unmapped.push({ role, value }); continue; }
    }
    if (field.to === null) {
      notApplied.push({ role, ...(field.reason ? { reason: field.reason } : { consumedBy: field.consumedBy }) });
      continue;
    }
    if (mapped === null) continue; // a value that changes nothing, such as display: block
    setPath(out, field.to, mapped);
  }
  return { out, notApplied, unmapped };
}

const sizeOf = (v) =>
  isPercent(v) ? (v.value === 100 ? { mode: 'fill' } : { mode: 'percentOfParent', percent: v.value }) : { mode: 'fixed', value: v };

/**
 * How a node is sized along each axis, relative to the stack it sits in.
 *
 * `align-self: stretch` and `flex: 1 1 0` mean different things depending on
 * which axis the parent runs along, so the parent's axis is applied here rather
 * than left to every consumer. An unset align-items is CSS's own default,
 * stretch.
 */
function sizing(out, parentStack) {
  const item = out.item || {};
  const size = out.size || {};
  const result = {};
  for (const dim of ['width', 'height']) {
    const explicit = size[dim];
    const isMain = parentStack && (dim === 'width') === (parentStack.axis === 'horizontal');
    if (parentStack && isMain) {
      if (item.grow > 0) result[dim] = { mode: 'flex', grow: item.grow, shrink: item.shrink ?? 1, basis: item.basis ?? 'auto' };
      else if (present(explicit)) result[dim] = sizeOf(explicit);
      else if (present(item.basis) && item.basis !== 'auto') result[dim] = { mode: 'fixed', value: item.basis };
      else result[dim] = { mode: 'hug' };
    } else if (parentStack) {
      if (present(explicit)) result[dim] = sizeOf(explicit);
      else result[dim] = (item.selfAlign ?? parentStack.crossAlign ?? 'stretch') === 'stretch' ? { mode: 'fill' } : { mode: 'hug' };
    } else {
      result[dim] = present(explicit) ? sizeOf(explicit) : { mode: 'hug' };
    }
  }
  const min = {}, max = {};
  if (present(size.minWidth)) min.width = size.minWidth;
  if (present(size.minHeight)) min.height = size.minHeight;
  if (present(size.maxWidth)) max.width = size.maxWidth;
  if (present(size.maxHeight)) max.height = size.maxHeight;
  return {
    ...result,
    ...(Object.keys(min).length ? { min } : {}),
    ...(Object.keys(max).length ? { max } : {}),
    ...(present(size.aspectRatio) ? { aspectRatio: size.aspectRatio } : {}),
    ...(present(size.includesBorderAndPadding) ? { includesBorderAndPadding: size.includesBorderAndPadding } : {}),
  };
}

/** Split a normalised tree into its layout and appearance halves. */
function halves(out, parentStack, { withSizing }) {
  const layout = {}, appearance = {};
  for (const [k, v] of Object.entries(out)) {
    if (!LAYOUT_KEYS.has(k)) appearance[k] = v;
  }
  if (out.container) {
    layout.container = { ...out.container };
    if (layout.container.kind === 'stack' && !layout.container.axis) layout.container.axis = 'horizontal';
  }
  if (out.padding) layout.padding = out.padding;
  if (withSizing) {
    layout.size = sizing(out, parentStack);
  } else if (out.size || out.item) {
    // A conditional change to size states only what it sets. Width and height
    // are expressed in the same modes as the base so they read the same way.
    const size = {};
    for (const [k, v] of Object.entries(out.size || {})) {
      size[k] = k === 'width' || k === 'height' ? sizeOf(v) : v;
    }
    if (Object.keys(size).length) layout.size = size;
    if (out.item) layout.item = out.item;
  }
  return { layout, appearance };
}

/** Which idiom concepts a normalised partial exercises. */
function conceptsOf({ layout = {}, appearance = {} }, use) {
  const c = layout.container;
  if (c?.kind === 'stack') use(`container.stack.${c.axis || 'horizontal'}`);
  if (c?.crossAlign) use('container.crossAlign');
  if (c?.mainAlign) use('container.mainAlign');
  if (present(c?.gap)) use('container.gap');
  for (const dim of ['width', 'height']) {
    const m = layout.size?.[dim];
    if (m?.mode === 'fixed') use('size.fixed');
    if (m?.mode === 'fill' || m?.mode === 'percentOfParent') use('size.fill');
    if (m?.mode === 'flex') use('item.flex');
  }
  if (layout.size?.min) use('size.minimum');
  if (present(layout.size?.aspectRatio)) use('size.aspectRatio');
  if (layout.padding) use('padding');
  const b = appearance.border;
  if (b) {
    const sided = Object.keys(b).some((k) => ['top', 'right', 'bottom', 'left'].includes(k));
    use('border.inside');
    if (sided) use('border.sides');
  }
  if (present(appearance.cornerRadius)) use('cornerRadius');
  if (present(appearance.background)) use('background');
  if (present(appearance.foreground)) use('foreground');
  if (present(appearance.opacity)) use('opacity');
  if (present(appearance.clip)) use('clip');
  // The composite stands for the family, size, weight, line height and letter spacing, so a team
  // needs the idioms for all of them, though no individual property is stated.
  if (present(appearance.typography)) { use('text.font'); use('text.lineHeight'); use('text.letterSpacing'); }
  const t = appearance.text;
  if (t) {
    if (t.family || t.size || t.weight) use('text.font');
    if (present(t.lineHeight)) use('text.lineHeight');
    if (present(t.letterSpacing)) use('text.letterSpacing');
    if (t.numericFigures === 'tabular') use('text.numericFigures.tabular');
    if (t.wrap === 'none' || t.overflow === 'ellipsis') use('text.truncate');
    if (t.align) use('text.align');
  }
  const x = appearance.transform;
  if (x && !x.none) {
    if ('scale' in x || 'scaleX' in x || 'scaleY' in x) use('transform.scale');
    if ('translateX' in x || 'translateY' in x) use('transform.translate');
    if ('rotateDeg' in x) use('transform.rotate');
  }
}

/** The transform each function reduces to when it is not applied. */
const identityOf = (transform) =>
  Object.fromEntries(Object.keys(transform || {}).filter((k) => k in ANIMATION.identity).map((k) => [k, ANIMATION.identity[k]]));

const curveFor = (transitionCurve) => {
  const r = resolveCurve(transitionCurve);
  return {
    type: 'cubicBezier',
    value: r.value,
    ...(r.named ? { named: r.named } : {}),
    ...(transitionCurve?.implied ? { implied: 'CSS default timing function' } : {}),
  };
};

const instant = (ms) => ms != null && ms < ANIMATION.instantBelowMs;

/**
 * Where a value read from the markup comes from, as data.
 *
 * The importer records `prop:x`, `expr:...` or `literal:...`. A `prop:x` is only
 * a prop when nothing in the component shadows it: `value` in `{value}` is the
 * local `const value = clamp(...)`, not the `value` prop, and reporting it as the
 * prop sends a team to the wrong place. JavaScript scoping makes this decidable: a
 * component-scope declaration of the same name wins.
 *
 * @param {string} src             `prop:x`, `expr:...` or `literal:...`
 * @param {Map<string, object>} logicByName  quoted logic entries by every name they declare
 * @returns {{prop}|{derived}|{expression, uses?}|{literal}|null}
 */
export function describeRef(src, logicByName) {
  if (typeof src !== 'string') return src ?? null;
  const m = src.match(/^(prop|expr|literal):([\s\S]*)$/);
  if (!m) return { literal: src };
  const [, kind, rest] = m;
  const entry = logicByName.get(rest.trim());
  if (kind === 'literal') return { literal: rest };
  if (kind === 'prop') return entry?.scope === 'component' ? { derived: rest } : { prop: rest };
  // An expression that is one name declared in the component is that derived value.
  if (entry?.scope === 'component' && /^[A-Za-z_$][\w$]*$/.test(rest.trim())) return { derived: rest.trim() };
  const used = [...new Set([...rest.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)].map((x) => x[1]).filter((n) => logicByName.get(n)?.scope === 'component'))];
  return { expression: rest, ...(used.length ? { uses: used } : {}) };
}

/** The same lookup the builder uses, for a reader that has only the quoted logic. */
export const logicIndex = (logic = []) => new Map(logic.flatMap((l) => [l.name, ...(l.also || [])].map((n) => [n, l])));

/**
 * @param {object} a
 * @param {object} a.contract
 * @param {string} a.platform         the platform these states and roles are translated for
 * @param {object[]} a.nodeStyles     resolved per-node rows (idle and states)
 * @param {object[]} a.visualRules    resolved, with node names and token symbols
 * @param {object[]} a.a11yNodes      roles in the tree, translated for this platform
 * @param {object[]} a.bindings       source-backed boolean interaction bindings
 * @param {object[]} a.legacyMotion   motion entries from a hand-authored contract
 * @param {object[]} a.legacyLoops    loops from a hand-authored contract
 * @param {object} a.a11yStates       announced states, already translated for this platform
 * @param {object[]} a.logic          source statements the markup depends on, quoted verbatim
 * @param {object} a.keyframes
 * @param {string[]} a.rootFields     fields present on the component's own style rows
 * @param {object[]} a.sourceRules    every rule read from the stylesheet, before any was matched to a node
 * @param {object[]} a.unmatchedRules source rules whose class no node in the markup carries
 * @param {object[]} a.droppedByDesign source rules a platform legitimately lacks (hover on touch)
 */
export function buildSemantics({ contract, platform, nodeStyles = [], visualRules = [], a11yNodes = [], bindings = [], legacyMotion = [], legacyLoops = [], logic = [], a11yStates = {}, keyframes = {}, rootFields = [], sourceRules = [], unmatchedRules = [], droppedByDesign = [] }) {
  const notes = [];
  const used = new Set();
  const use = (id) => used.add(id);
  // One stylesheet rule is resolved onto every node that carries its class (both
  // buttons of a stepper share one). "Already placed" is therefore a fact about a
  // rule AND a node: keying it by the rule alone let the first node claim a rule
  // and silently starve every other node that shares it.
  const claimed = new Map(); // `${order}:${node}` -> where it went
  const placed = new Set();  // source rules placed on at least one node
  const claim = (r, where) => { claimed.set(`${r.order}:${r.node}`, where); placed.add(r.order); };
  const isClaimed = (r) => claimed.has(`${r.order}:${r.node}`);
  const tree = contract.composition?.tree || null;

  const plain = (r) => !r.pseudoElement && !r.media.length && !r.manualTranslation;
  const rulesFor = (name) => visualRules.filter((r) => r.node === name);
  const baseOf = (name) => Object.assign({}, ...nodeStyles.filter((r) => r.node === name && r.state === 'idle').map(({ node: _n, state: _s, ...rest }) => rest));

  /* ---------------- what drives a condition ---------------- */

  // data-* attributes as the markup sets them, by node.
  const attrsOf = new Map();
  const spreadsOf = new Map();
  // A state pair is one entry reachable under both of its identifiers.
  const logicByName = new Map(logic.flatMap((l) => [l.name, ...(l.also || [])].map((n) => [n, l])));

  const refOf = (src) => describeRef(src, logicByName);
  const collectAttrs = (n) => {
    if (!n) return;
    if (n.attributes) attrsOf.set(n.name, n.attributes);
    if (n.spreads?.length) spreadsOf.set(n.name, n.spreads);
    (n.children || []).forEach(collectAttrs);
  };
  collectAttrs(tree);

  const unresolved = new Map(); // attribute -> Set(nodes)

  /**
   * A spread of a helper whose quoted source sets this very attribute: a located
   * cause that points at the statements to translate. It is NOT evaluated.
   */
  const spreadSetting = (nodeName, attribute) => {
    for (const spread of spreadsOf.get(nodeName) || []) {
      const callee = spread.match(/^\s*([A-Za-z_$][\w$]*)\s*\(/)?.[1];
      const entry = callee && logicByName.get(callee);
      if (entry && entry.source.includes(attribute)) {
        const args = spread.slice(spread.indexOf('(') + 1, spread.lastIndexOf(')'));
        const argNames = [...args.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)].map((m) => m[1]).filter((n) => logicByName.has(n));
        return { spread, entry, logic: [callee, ...new Set(argNames)] };
      }
    }
    return null;
  };

  /**
   * The cause of an attribute being set: a prop (from the markup), a boolean
   * state with a source-backed activation, a source expression, or nothing we
   * could read. Nothing is reported, never guessed.
   */
  const driverOf = (nodeName, attribute) => {
    const binding = bindings.find((b) => b.attribute === attribute);
    if (binding) {
      return {
        state: binding.state,
        activatedIn: binding.activations.map((a) => a.containingFunction || null),
        activation: binding.activations[0]?.expression ?? null,
        resetAfterMs: binding.reset?.delayMs ?? null,
        // The delay as the source writes it (a named constant such as POP_MS), so the
        // number can be traced to its sourceConstants entry and kept in step with it.
        ...(binding.reset?.delayExpression && !/^[\d.]+(ms)?$/.test(binding.reset.delayExpression.trim())
          ? { resetDelayExpression: binding.reset.delayExpression.trim() } : {}),
      };
    }
    const src = attrsOf.get(nodeName)?.[attribute];
    if (src) return refOf(src);
    const located = spreadSetting(nodeName, attribute);
    if (located) return { spread: located.spread, logic: located.logic };
    (unresolved.get(attribute) || unresolved.set(attribute, new Set()).get(attribute)).add(nodeName);
    return null;
  };

  const cond = (c, fallbackNode) => {
    const node = c.node ?? fallbackNode;
    return {
      node,
      ...(c.state ? { state: c.state, ...(c.negate ? { negate: true } : {}), ...(c.focusVisible ? { focusVisible: true } : {}) } : {}),
      ...(c.attribute
        ? { attribute: c.attribute, equals: c.equals, ...(c.negate ? { negate: true } : {}), driver: driverOf(node, c.attribute) }
        : {}),
    };
  };

  /** What the activation and reset imply over time, when both are source-backed. */
  const timelineOf = (conditions, timing) => {
    for (const c of conditions) {
      const d = c.driver;
      if (d?.state && d.resetAfterMs != null && timing?.durationMs != null) {
        // The source constant is worded "how long it stays scaled up". Whether it
        // actually HOLDS depends on the transition: with a reset delay equal to
        // the transition duration it arrives as the flag clears, so it does not.
        const hold = Math.max(0, d.resetAfterMs - timing.durationMs);
        return {
          singleShot: [
            { atMs: 0, flag: true, animate: 'rest to changed value', overMs: timing.durationMs },
            { atMs: d.resetAfterMs, flag: false, animate: 'changed value back to rest', overMs: timing.durationMs },
          ],
          holdAtChangedMs: hold,
          ...(d.resetDelayExpression ? { resetDelayExpression: d.resetDelayExpression } : {}),
          shape: hold === 0
            ? 'rises over the transition and falls straight back: there is no plateau at the changed value'
            : `rises, holds at the changed value for ${hold}ms, then falls`,
          note: 'What re-triggers it before the reset, and any guard on activation, are not extracted as data. They are in the quoted logic: read the entries named by activatedIn.',
        };
      }
    }
    return null;
  };

  /* ---------------- nodes (base layout and appearance) ---------------- */

  const nodes = [];
  const byName = new Map();
  // The quoted statements this node's own markup refers to (a handler, a helper
  // spread, a computed label). Direct references only; each entry lists what it uses.
  /**
   * The states a node announces to assistive technology, each with WHEN. Without
   * the condition a team knows a control can be "read-only" but not that the
   * frozen prop is what makes it so.
   */
  const announcedStates = (node) => {
    // A helper spread onto the node can announce a state too: Counter's buttons are
    // aria-disabled only through `{...buttonProps(...)}`, so the markup never says so.
    // The attribute is found literally in the quoted helper; its condition is the
    // spread itself, to be read there, not worked out here.
    const viaSpread = {};
    for (const state of Object.keys(A11Y_STATE_MAP)) {
      if (node.a11y?.stateWhen?.[state]) continue;
      const hit = spreadSetting(node.name, `aria-${state}`);
      if (hit) viaSpread[state] = { spread: hit.spread, logic: hit.logic };
    }
    return statesFrom(node, viaSpread);
  };
  const statesFrom = (node, viaSpread) =>
    [...Object.entries(node.a11y?.stateWhen || {}), ...Object.entries(viaSpread)].map(([state, when]) => {
      const m = A11Y_STATE_MAP[state]?.[platform];
      const concept = m?.trait ? { kind: 'trait', concept: m.trait }
        : m?.property ? { kind: 'property', concept: m.property }
        : m?.semantics ? { kind: 'semantics', concept: m.semantics.replace(/\(\)$/, '') }
        : null;
      if (concept) use(`a11y.${concept.kind === 'trait' ? 'traits' : concept.kind}.${concept.concept}`);
      return {
        state,
        when: typeof when === 'string' ? refOf(when) : when,
        ...(concept || { unmapped: true }),
        // A property takes a string. The source states that the control is
        // read-only, not what to say, so the words are the team's to choose.
        ...(concept?.kind === 'property' || (concept?.kind === 'semantics' && /state/i.test(concept.concept)) ? { wording: 'not stated in the source' } : {}),
        ...(m?.announce ? { announce: m.announce } : {}),
      };
    });

  /** The range a slider-like node announces: now, min, max and the text for the value. */
  const valueRangeOf = (node) => {
    const v = node.a11y?.value;
    if (!v) return null;
    use('a11y.range');
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, refOf(val)]));
  };

  /**
   * `aria-labelledby` and `aria-describedby` name ANOTHER ELEMENT by its id.
   * Neither platform has that: the label is a string on the element itself. So the
   * prop is reported as what it is, and the team decides what string it becomes.
   */
  const referencesOf = (node) => {
    const out = {};
    for (const key of ['labelledBy', 'describedBy']) if (node.a11y?.[key]) out[key] = refOf(node.a11y[key]);
    if (Object.keys(out).length) use('a11y.reference');
    return out;
  };

  /**
   * Whether a node is in the keyboard tab order, where the source says so. A
   * `tabIndex` of -1 removes it from the order while leaving it focusable by
   * script or pointer, which is why this is not called "focusable". It is read
   * from the attribute on the markup or from a literal in a spread helper, never
   * assumed: a node with neither says nothing.
   */
  const tabOrderOf = (node) => {
    if (node.a11y && 'focusable' in node.a11y) return { included: node.a11y.focusable, setBy: { attribute: 'tabIndex' } };
    const hit = spreadSetting(node.name, 'tabIndex');
    const literal = hit?.entry.source.match(/tabIndex['"]?\s*:\s*(-?\d+)/)?.[1];
    return literal === undefined ? null : { included: literal !== '-1', setBy: { spread: hit.spread, logic: hit.logic }, literal: `tabIndex: ${literal}` };
  };

  const nodeLogic = (node) => (node.references || []).filter((n) => logicByName.has(n));
  const walk = (node, parent) => {
    const { out, notApplied, unmapped } = normalise(baseOf(node.name));
    const parentStack = parent?.layout?.container?.kind === 'stack' ? parent.layout.container : null;
    const { layout, appearance } = halves(out, parentStack, { withSizing: true });

    const a11y = a11yNodes.find((n) => n.node === node.name);
    const entry = {
      name: node.name,
      parent: parent?.name ?? null,
      kind: node.kind,
      ...(node.element ? { element: node.element } : {}),
      ...(node.component ? { component: node.component } : {}),
      ...(node.role ? { role: node.role } : {}),
      ...(node.content ? { content: refOf(node.content) } : {}),
      ...(node.conditionalRender ? { renderedConditionally: true } : {}),
      ...(nodeLogic(node).length ? { logic: nodeLogic(node) } : {}),
      children: (node.children || []).map((c) => c.name),
      layout,
      appearance,
      conditional: [],
      ...(a11y || announcedStates(node).length || tabOrderOf(node) || node.a11y?.value || node.a11y?.labelledBy || node.a11y?.describedBy ? {
        accessibility: {
          ...(a11y ? { kind: a11y.kind, concept: a11y.concept, actions: a11y.actions, ...(a11y.label ? { label: refOf(a11y.label) } : { label: null }) } : {}),
          ...(valueRangeOf(node) ? { valueRange: valueRangeOf(node) } : {}),
          ...(tabOrderOf(node) ? { tabOrder: tabOrderOf(node) } : {}),
          ...referencesOf(node),
          ...(announcedStates(node).length ? { states: announcedStates(node) } : {}),
          ...(a11y?.unmapped ? { unmapped: true } : {}),
          ...(a11y?.plain ? { native: true } : {}),
          ...(a11y?.hidden ? { hidden: true } : {}),
        },
      } : {}),
      ...(notApplied.length ? { notApplied } : {}),
      ...(unmapped.length ? { unmapped } : {}),
    };
    conceptsOf({ layout, appearance }, use);
    if (a11y?.concept) {
      const list = Array.isArray(a11y.concept) ? a11y.concept : [a11y.concept];
      for (const c of list) use(`a11y.${a11y.kind}.${c}`);
      for (const act of a11y.actions || []) use(`a11y.action.${act}`);
    }

    for (const r of rulesFor(node.name)) if (plain(r) && !r.conditions.length) claim(r, `nodes.${node.name}`);
    nodes.push(entry);
    byName.set(node.name, entry);
    for (const child of node.children || []) walk(child, entry);
  };
  if (tree) walk(tree, null);

  // Announced states (busy, disabled, selected ...) in this platform's own terms.
  for (const mapping of Object.values(a11yStates)) {
    if (mapping.trait) use(`a11y.traits.${mapping.trait}`);
    if (mapping.property) use(`a11y.property.${mapping.property}`);
    if (mapping.semantics) use(`a11y.semantics.${mapping.semantics.replace(/\(\)$/, '')}`);
  }

  /* ---------------- hit areas ---------------- */

  const hitAreas = [];
  const p = HIT_AREA_PATTERN;
  for (const r of visualRules) {
    if (r.pseudoElement !== p.pseudoElement || r.manualTranslation || r.media.length || r.conditions.some((c) => c.subject === 'ancestor')) continue;
    const props = r.properties;
    const emptyContent = typeof props.content === 'string' && /^(''|"")$/.test(props.content);
    const centered = isPercent(props.top) && props.top.value === 50 && isPercent(props.left) && props.left.value === 50 &&
      isPercent(props.transform?.translateX) && props.transform.translateX.value === -50 &&
      isPercent(props.transform?.translateY) && props.transform.translateY.value === -50;
    const sized = p.requires.minimumSizeProperties.every((k) => present(props[k]));
    if (!emptyContent || props.position !== p.requires.position || !centered || !sized || r.conditions.length) continue;

    const removal = visualRules.filter((x) =>
      x.pseudoElement === p.pseudoElement && x.node === r.node && x.conditions.length && x.properties.content === p.removedByContent);
    hitAreas.push({
      node: r.node,
      min: { width: props.minWidth, height: props.minHeight },
      centered: true,
      atLeastNodeBox: isPercent(props.width) && props.width.value === 100 && isPercent(props.height) && props.height.value === 100,
      affectsLayout: false,
      removedWhen: removal.map((x) => x.conditions.map((c) => cond(c, x.node))),
      source: [r.source, ...removal.map((x) => x.source)],
    });
    claim(r, `hitAreas.${r.node}`);
    for (const x of removal) claim(x, `hitAreas.${r.node}`);
    use('hitArea');
  }

  /* ---------------- focus rings ---------------- */

  const focusRings = [];
  for (const r of visualRules) {
    if (!plain(r) || r.conditions.length !== 1 || r.conditions[0].state !== 'focused' || r.conditions[0].subject !== 'self') continue;
    const props = r.properties;
    if (!present(props.outlineColor) && !present(props.outlineWidth)) continue;
    focusRings.push({
      node: r.node,
      trigger: 'focused',
      // The source draws the ring on :focus-visible, which is keyboard focus and not a
      // pointer press. `trigger` alone said "any focus", so a tap would have shown it.
      ...(r.conditions[0].focusVisible ? { focusVisible: true } : {}),
      ...(present(props.outlineColor) ? { color: props.outlineColor } : {}),
      ...(present(props.outlineWidth) ? { width: props.outlineWidth } : {}),
      ...(present(props.outlineStyle) ? { style: props.outlineStyle } : {}),
      ...(present(props.outlineOffset) ? { offset: props.outlineOffset } : {}),
      // The node's own corner radius while focused; the ring follows it. It is
      // stated here and nowhere else, so the same fact is not told twice.
      ...(present(props.radius) ? { cornerRadiusWhileFocused: props.radius } : {}),
      source: r.source,
    });
    claim(r, `focusRings.${r.node}`);
    use('focusRing');
    use('state.focused');
  }

  /* ---------------- conditional changes ---------------- */

  for (const r of visualRules) {
    if (!plain(r) || !r.conditions.length || isClaimed(r)) continue;
    const entry = byName.get(r.node);
    if (!entry) continue;
    const { out, unmapped: allUnmapped } = normalise(r.properties);

    // A value that is a local variable reassigned per variant has no single
    // answer on the rule itself. When the component's own style matrix carries
    // that role, the values are there, per variant and size: point to them
    // rather than calling them unmapped, which would suggest they were lost.
    const isRoot = byName.get(r.node)?.parent === null;
    const fromStyles = [];
    const unmapped = [];
    for (const u of allUnmapped) {
      const raw = r.properties[u.role];
      if (isRoot && rootFields.includes(u.role) && isManual(raw) && /var\(--/.test(raw.expression || '')) fromStyles.push(u.role);
      else unmapped.push(u);
    }
    const { layout, appearance } = halves(out, null, { withSizing: false });
    if (!Object.keys(layout).length && !Object.keys(appearance).length && !unmapped.length && !fromStyles.length) continue;

    entry.conditional.push({
      when: r.conditions.map((c) => cond(c, r.node)),
      ...(Object.keys(layout).length ? { layout } : {}),
      ...(Object.keys(appearance).length ? { appearance } : {}),
      ...(fromStyles.length ? { valuesFrom: { styles: fromStyles } } : {}),
      ...(unmapped.length ? { unmapped } : {}),
      source: r.source,
      order: r.order,
    });
    conceptsOf({ layout, appearance }, use);
    for (const c of r.conditions) {
      if (c.state === 'pressed') use('state.pressed');
      if (c.attribute === 'aria-disabled') use('state.unavailable.focusable');
    }
    claim(r, `nodes.${r.node}.conditional`);
  }

  /* ---------------- animations ---------------- */

  const animations = [];
  const reducedFor = (nodeName, kind) => {
    const media = visualRules.filter((r) => r.node === nodeName && !r.pseudoElement &&
      r.media.some((m) => /prefers-reduced-motion\s*:\s*reduce/.test(m)));
    for (const r of media) claim(r, `animations.${nodeName}`);
    for (const r of media.slice().reverse()) {
      if (kind === 'transition') {
        if (r.properties.transitionEnabled === false) return { enabled: false, source: r.source };
        if (present(r.properties.transitionDurationMs)) {
          const ms = r.properties.transitionDurationMs;
          return { durationMs: ms, effectivelyInstant: instant(ms), source: r.source };
        }
      } else {
        if (r.properties.animation?.none) return { enabled: false, source: r.source };
        if (present(r.properties.animationDurationMs)) return { durationMs: r.properties.animationDurationMs, source: r.source };
      }
    }
    return null;
  };

  const changedProps = (name) => [...new Set(visualRules
    .filter((r) => r.node === name && plain(r) && r.conditions.length)
    .flatMap((r) => Object.keys(r.properties)))];

  for (const rule of visualRules) {
    if (!plain(rule) || !rule.transitions.length) continue;
    const node = byName.get(rule.node);
    const base = baseOf(rule.node);

    for (const t of rule.transitions) {
      if (t.durationMs == null) { notes.push(`${rule.source}: transition of ${t.property} has no duration, so nothing animates.`); continue; }
      const props = t.property === 'all' ? changedProps(rule.node).filter((k) => !['transitionEnabled', 'transitionDurationMs'].includes(k)) : [t.property];
      for (const prop of props) {
        const changes = visualRules.filter((r) => r.node === rule.node && plain(r) && r.conditions.length && present(r.properties[prop]) && !isManual(r.properties[prop]));
        const timing = { durationMs: t.durationMs, delayMs: t.delayMs, curve: curveFor(t.curve), effectivelyInstant: instant(t.durationMs) };

        let entry;
        if (changes.length) {
          const rest = prop === 'transform'
            ? (present(base.transform) && !base.transform.none
                ? { value: base.transform, from: 'node style' }
                : { value: identityOf(changes[0].properties.transform), from: 'identity (CSS transform: none)' })
            : { value: base[prop] ?? null, from: present(base[prop]) ? 'node style' : 'unstated' };
          entry = {
            kind: 'transition',
            node: rule.node,
            property: prop,
            rest,
            changes: changes.map((c) => {
              const when = c.conditions.map((x) => cond(x, c.node));
              const timeline = timelineOf(when, timing);
              return { when, to: c.properties[prop], source: c.source, ...(timeline ? { timeline } : {}) };
            }),
            direction: rule.conditions.length ? 'enter' : 'both',
          };
          for (const c of changes) {
            const slot = node?.conditional.find((x) => x.order === c.order);
            if (slot) (slot.animatedBy ||= []).push(animations.length);
          }
        } else if (prop !== 'transform' && node?.parent === null && rootFields.includes(prop)) {
          entry = { kind: 'transition', node: rule.node, property: prop, valuesFrom: 'styles', direction: rule.conditions.length ? 'enter' : 'both' };
        } else {
          notes.push(`${rule.source}: transitions ${prop}, but no rule sets a different ${prop} for ${rule.node}, so there is nothing to animate to. Not emitted.`);
          continue;
        }
        const reducedMotion = reducedFor(rule.node, 'transition');
        animations.push({ id: animations.length, ...entry, timing, reducedMotion, source: rule.source });
        use(timing.curve.named === 'linear' ? 'animation.timing.linear' : 'animation.timing.cubicBezier');
        if (reducedMotion) use('animation.reducedMotion');
        if (prop === 'transform') {
          const keys = Object.keys(Object.assign({}, ...changes.map((c) => c.properties.transform)));
          if (keys.some((k) => k.startsWith('scale'))) use('transform.scale');
          if (keys.some((k) => k.startsWith('translate'))) use('transform.translate');
          if (keys.includes('rotateDeg')) use('transform.rotate');
        }
        claim(rule, `animations.${rule.node}`);
      }
    }
  }

  // Looping animations: the keyframes are read, never assumed.
  for (const rule of visualRules) {
    const a = rule.properties.animation;
    if (!plain(rule) || !a || a.none) continue;
    const frames = keyframes[a.name];
    if (!frames?.length) { notes.push(`${rule.source}: animation ${a.name} has no readable @keyframes, so it needs manual translation.`); continue; }
    const base = baseOf(rule.node);
    const names = [...new Set(frames.flatMap((f) => Object.keys(f.properties)))];

    for (const prop of names) {
      let list = frames.filter((f) => present(f.properties[prop])).map((f) => ({ offset: f.offset, value: f.properties[prop] }));
      if (list.some((f) => isManual(f.value))) { notes.push(`${rule.source}: keyframes for ${prop} need manual translation.`); continue; }
      if (list[0].offset !== 0) {
        const start = prop === 'transform'
          ? identityOf(Object.assign({}, ...list.map((f) => f.value)))
          : base[prop] ?? null;
        list = [{ offset: 0, value: start, implied: prop === 'transform' ? 'identity (no from frame)' : 'node style (no from frame)' }, ...list];
      }
      const timing = { durationMs: a.durationMs, delayMs: a.delayMs, curve: curveFor(a.curve), iterations: a.iterations, direction: a.direction, fillMode: a.fillMode };
      const reducedMotion = reducedFor(rule.node, 'loop');
      animations.push({
        id: animations.length, kind: 'loop', node: rule.node, property: prop, keyframes: list, timing, reducedMotion,
        appliesWhile: 'the node is rendered',
        source: rule.source,
      });
      use('animation.loop');
      use(timing.curve.named === 'linear' ? 'animation.timing.linear' : 'animation.timing.cubicBezier');
      if (reducedMotion) use('animation.reducedMotion');
      if (prop === 'transform' && list.some((f) => 'rotateDeg' in f.value)) use('transform.rotate');
    }
    claim(rule, `animations.${rule.node}`);
  }

  // Motion from a hand-authored contract, which names states instead of nodes.
  for (const m of legacyMotion) {
    if (m.node) continue;
    const to = m.toValues || {};
    for (const prop of m.properties) {
      if (prop === 'transform' && !Object.keys(to).some((k) => k in ANIMATION.identity)) {
        notes.push(`${m.from}->${m.to}: declares a transform with no target value, so it is not emitted.`);
        continue;
      }
      const entry = Object.keys(to).length && prop === 'transform'
        ? { rest: { value: identityOf(to), from: 'identity' }, changes: [{ when: [{ state: m.to }], to }] }
        : { valuesFrom: 'styles' };
      animations.push({
        id: animations.length, kind: 'transition', node: null, property: prop, on: `${m.from}->${m.to}`, ...entry,
        timing: { durationMs: m.durationMs, curve: m.curve },
        reducedMotion: m.reducedMotion ? { mode: m.reducedMotion } : null,
        source: 'contract.motion',
      });
    }
  }

  for (const l of legacyLoops) {
    animations.push({
      id: animations.length, kind: 'loop', node: null, property: l.property,
      keyframes: [{ offset: 0, value: l.from }, { offset: 1, value: l.to }],
      timing: { durationMs: l.durationMs, curve: l.curve, iterations: l.iterations },
      activeIn: l.activeIn,
      reducedMotion: l.reducedMotion ? { mode: l.reducedMotion } : null,
      source: 'contract.motion',
    });
    use('animation.loop');
  }

  /* ---------------- coverage and honesty ---------------- */

  // Coverage is measured against the rules the stylesheet HAS, not the ones that
  // happened to reach a node. Measuring after the loss made a rule that matched
  // nothing invisible, which is the one case this exists to catch.
  const dropped = new Set(droppedByDesign.map((d) => d.order));
  const unmatched = new Set(unmatchedRules.map((r) => r.order));
  const reached = new Set(visualRules.map((r) => r.order));
  const unplaced = [];
  for (const r of sourceRules) {
    if (placed.has(r.order) || dropped.has(r.order)) continue;
    unplaced.push({
      selector: r.selector,
      why: unmatched.has(r.order) && !reached.has(r.order)
        ? `no node in the markup carries .${r.targetClass}, so this rule could not be placed`
        : r.manualTranslation ? 'selector is not supported; manual translation required'
        : r.pseudoElement ? `${r.pseudoElement} pseudo-element that is not a recognised hit area`
        : r.media.length ? `inside ${r.media.join(' and ')}` : 'not placed',
    });
  }

  /**
   * Which events and feedback the source uses, and where. Found by name in the
   * quoted statements and in the handler attributes of the markup, never inferred.
   * It says the source listens for a key press, not what it does with it.
   */
  const sourceEvents = [];
  const handlerNodes = [];
  const gather = (n) => { if (n.handlers?.length) handlerNodes.push(n); (n.children || []).forEach(gather); };
  if (tree) gather(tree);
  for (const [concept, names] of Object.entries(SOURCE_EVENTS)) {
    const found = new Map(); // name -> where
    const note = (name, where) => (found.get(name) || found.set(name, new Set()).get(name)).add(where);
    for (const name of names) {
      const word = new RegExp(`(?<![\\w$])${name}(?![\\w$])`);
      for (const entry of logic) if (word.test(entry.source)) note(name, entry.name);
      for (const n of handlerNodes) if (n.handlers.includes(name)) note(name, `node:${n.name}`);
    }
    if (!found.size) continue;
    use(concept);
    sourceEvents.push({
      concept,
      names: [...found.keys()],
      foundIn: [...new Set([...found.values()].flatMap((w) => [...w]))],
    });
  }

  const unresolvedConditions = [...unresolved.entries()].map(([attribute, ns]) => ({
    attribute,
    nodes: [...ns],
    why: 'No markup attribute or source-backed state sets this. It is set inside the component (a spread, a helper or a computed prop), so when it is true must be read from the source.',
  }));

  return {
    nodes,
    animations,
    hitAreas,
    focusRings,
    unresolvedConditions,
    sourceEvents,
    conditionallyRendered: nodes.filter((n) => n.renderedConditionally).map((n) => n.name),
    externalComponents: nodes.filter((n) => n.kind === 'component').map((n) => ({ node: n.name, component: n.component })),
    coverage: {
      sourceRules: sourceRules.length,
      placed: sourceRules.length - unplaced.length - dropped.size,
      droppedByDesign: droppedByDesign.map(({ selector, why }) => ({ selector, why })),
      unplaced,
    },
    concepts: [...used].sort(),
    notes,
  };
}
