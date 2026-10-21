/**
 * Code -> draft contract.
 *
 * Reads a component directory or file set, extracts what is verifiably present,
 * and assembles a DRAFT contract. Everything it could not derive is left
 * unresolved on purpose, so the validator turns it into an open question.
 *
 * The output is a starting point, not an answer. The provenance report tells
 * you exactly which fields came from the code and which still need a human —
 * that list is the agenda for the contract review session.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';

import { TokenMatcher } from './tokenmatch.js';
import { extractJsxTree, compositionFromTree } from './jsx.js';
import { extractVisualRules } from './visual.js';
import { extractInteractionBindings } from './interaction.js';
import { extractSourceConstants, extractPropDocs } from './constants.js';
import { extractLogic } from './logic.js';
import { withTypography } from '../typography.js';
import { TYPOGRAPHY } from '../platform-map.js';
import {
  NATIVE_ACTIVATION,
  extractProps,
  extractDefaults,
  extractVariants,
  extractCss,
  extractJsx,
  collectLocalVars,
  collectLocalAliases,
} from './extract.js';
import { blankContract, normalise, REQUIRED_SIZE_KEYS, OPTIONAL_SIZE_KEYS } from '../contract.js';

/** Handled specially by the resolver, so never a declared appearance role. */
const NON_ROLE_FIELDS = new Set(['focusRing', 'opacity', 'fontFamily']);

const CODE_EXT = new Set(['.tsx', '.jsx', '.ts', '.js']);
const STYLE_EXT = new Set(['.css', '.scss', '.sass', '.less']);

/* ------------------------------------------------------------------ *
 * Source gathering
 * ------------------------------------------------------------------ */

export async function gatherSources(path) {
  const info = await stat(path);
  const files = [];

  if (info.isFile()) {
    files.push({ name: basename(path), path, content: await readFile(path, 'utf8') });
  } else {
    const walk = async (dir, depth = 0) => {
      if (depth > 2) return;
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full, depth + 1);
        else if (CODE_EXT.has(extname(entry.name)) || STYLE_EXT.has(extname(entry.name))) {
          if (/\.(test|spec|stories)\./.test(entry.name)) continue;
          files.push({ name: entry.name, path: full, content: await readFile(full, 'utf8') });
        }
      }
    };
    await walk(path);
  }

  return {
    code: files.filter((f) => CODE_EXT.has(extname(f.name))),
    styles: files.filter((f) => STYLE_EXT.has(extname(f.name))),
    all: files,
  };
}

/* ------------------------------------------------------------------ *
 * Import
 * ------------------------------------------------------------------ */

/**
 * @param {object} opts
 * @param {{code:Array,styles:Array,all:Array}} opts.sources
 * @param {import('../tokens.js').TokenIndex} opts.tokens
 * @param {object} opts.symbols   tokenLibrary.symbols from config
 * @param {string} [opts.id]      override the component id
 */
const countNodes = (n) => 1 + (n.children || []).reduce((s, c) => s + countNodes(c), 0);

export function importFromSources({ sources, cssPrefix = null, id, name }) {
  const cssText = sources.styles.map((f) => f.content).join('\n\n');
  // Properties the component declares are its own variables; ones it only
  // reads come from the design system. That distinction needs no config.
  const matcher = new TokenMatcher({
    cssPrefix,
    localVars: collectLocalVars(cssText),
    localAliases: collectLocalAliases(cssText),
  });
  const report = { derived: [], skipped: [], notes: [], sources: sources.all.map((f) => f.name) };

  const code = sources.code.map((f) => f.content).join('\n\n');
  const css = cssText;

  const primary = sources.code[0]?.name || sources.styles[0]?.name || 'component';
  const componentId =
    id ||
    basename(primary, extname(primary))
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase();

  const contract = blankContract(componentId, name);
  const collect = (items) => {
    for (const e of items || []) {
      if (e.level === 'derived') report.derived.push(e);
      else if (e.level === 'skipped') report.skipped.push(e);
    }
  };

  /* ---------------- props ---------------- */

  const tsProps = extractProps(code);
  const defaults = extractDefaults(code);
  collect(tsProps.evidence);
  if (!tsProps.found) {
    report.notes.push('No `*Props` interface found — props could not be derived from types.');
  }

  /* ---------------- variant matrix ---------------- */

  const variants = extractVariants(code, matcher);
  collect(variants.evidence);
  /* ---------------- css ---------------- */

  const styles = extractCss(css, matcher);
  const visual = extractVisualRules(css, matcher);
  collect(styles.evidence);
  if (!css) report.notes.push('No stylesheet found — states, motion, and focus ring were not derived.');

  /* ---------------- jsx ---------------- */

  const jsx = extractJsx(code);
  collect(jsx.evidence);

  /* ================= assemble ================= */

  /* axes — from cva(), from `data-*` selectors, or from a TS union. A real
   * component usually declares them in more than one of those places. */
  const allAxes = {};
  for (const [axis, values] of Object.entries(styles.axisValues || {})) allAxes[axis] = values;
  for (const [axis, values] of Object.entries(variants.axes || {})) allAxes[axis] = values;
  for (const [propName, def] of Object.entries(tsProps.props)) {
    if (def.kind === 'enum' && def.values?.length) allAxes[propName] = def.values;
  }

  for (const [axis, values] of Object.entries(allAxes)) {
    if (!values?.length) continue;
    contract.props[axis] = {
      kind: 'enum',
      values,
      default: variants.defaults[axis] || defaults[axis] || values[0],
      axis: true,
    };
  }
  if (!contract.props.variant) delete contract.props.variant;
  if (!contract.props.size) delete contract.props.size;

  /* Axes beyond variant and size — `tone`, `density`, and the like. The
   * appearance matrix is variant x size x state, so a third axis cannot be
   * expressed. Its default value is used and the rest is reported, rather than
   * silently folding two tones into one. */
  const extraAxes = Object.keys(allAxes).filter((a) => a !== 'variant' && a !== 'size');
  const extraDefaults = {};
  for (const axis of extraAxes) {
    extraDefaults[axis] = contract.props[axis]?.default ?? allAxes[axis][0];
  }

  /* other props */
  const STATE_PROPS = new Set(['loading', 'disabled', 'busy']);
  // What the author wrote above each prop. extractProps reads comment-stripped
  // source, so this is the only place that text survives.
  const propDocs = extractPropDocs(code);
  contract.stateDocs = {};
  for (const [propName, def] of Object.entries(tsProps.props)) {
    if (contract.props[propName]?.axis) continue;
    if (STATE_PROPS.has(propName)) {
      // The prop becomes a state, but what the author said about it is still
      // the best statement of what that state does.
      if (propDocs[propName]) contract.stateDocs[propName === 'busy' ? 'loading' : propName] = propDocs[propName];
      report.notes.push(
        `\`${propName}\` is modelled as a state, not a boolean prop — states are a variant axis in the contract.`
      );
      continue;
    }
    contract.props[propName] = {
      ...def,
      ...(defaults[propName] !== undefined ? { default: defaults[propName] } : {}),
    };
    if (def.kind === 'slot') contract.props[propName].contentType = 'node';
  }
  for (const [propName, def] of Object.entries(contract.props)) {
    if (propDocs[propName] && !def.description) def.description = propDocs[propName];
  }

  /* The activation handler a native element brings with it. Declared through
   * the extends clause and reaching the element via the spread, so it is read
   * from the code rather than assumed. */
  let activationEvent = null;
  const inherits = tsProps.extends;
  if (inherits && NATIVE_ACTIVATION[inherits.element]) {
    const { event, payload } = NATIVE_ACTIVATION[inherits.element];
    if (!inherits.omitted.includes(event) && !contract.props[event]) {
      activationEvent = event;
      contract.props[event] = {
        kind: 'event',
        payload,
        required: false,
        inheritedFrom: inherits.source,
      };
      report.derived.push({
        level: 'derived',
        path: `props.${event}`,
        from: 'native-attributes',
        evidence: `extends ${inherits.source}`,
      });
      report.notes.push(
        `\`${event}\` comes from \`${inherits.source}\` and reaches the element through the props spread. ` +
          `Only the activation handler is taken — the rest of the DOM handlers mean nothing on iOS or Android.`
      );
    }
  } else if (Object.values(contract.props).some((d) => d.kind === 'event')) {
    activationEvent = Object.entries(contract.props).find(([, d]) => d.kind === 'event')?.[0] || null;
  }

  /* states */
  const seen = new Set(['idle']);
  // From selectors, not just from rules that produced a role — a focus rule
  // whose only declaration is `outline` still declares a focused state.
  for (const s of styles.seenStates || []) seen.add(s);
  for (const s of Object.keys(styles.states)) if (s !== 'default') seen.add(s);
  for (const p of Object.keys(tsProps.props)) if (STATE_PROPS.has(p)) seen.add(p === 'busy' ? 'loading' : p);
  contract.states = ['idle', 'hover', 'focused', 'pressed', 'disabled', 'loading'].filter((s) => seen.has(s));
  if (contract.states.length === 1) contract.states = ['idle', 'pressed', 'disabled'];

  /* appearance
   *
   * Two different kinds of CSS rule, with different derivability:
   *   - base rules        apply to every variant unconditionally -> derivable
   *   - pseudo-state rules apply in CSS to every variant too, but semantically
   *     belong to the default variant (a secondary button hovering to brand-600
   *     would be wrong). Applying them everywhere would be a guess, so they go
   *     to the default variant only and the rest become open questions.
   */
  const SIZE_KEYS = new Set([...REQUIRED_SIZE_KEYS, ...OPTIONAL_SIZE_KEYS]);
  const partition = (roleMap) => {
    const colour = {};
    const size = {};
    for (const [k, v] of Object.entries(roleMap || {})) {
      if (SIZE_KEYS.has(k)) size[k] = v;
      else colour[k] = v;
    }
    return { colour, size };
  };

  const cssBase = partition(styles.states.default);

  /** Combination rules that apply at the default value of every extra axis. */
  const combosFor = (variantValue) =>
    (styles.byCombination || []).filter((c) => {
      // Size-scoped rules are metrics, not variant styling.
      if (c.axes.size) return false;
      if (c.axes.variant && c.axes.variant !== variantValue) return false;
      if (!c.axes.variant && variantValue !== contract.props.variant?.default) return false;
      return extraAxes.every((axis) => !c.axes[axis] || c.axes[axis] === extraDefaults[axis]);
    });

  const roles = new Set();
  const addRoles = (roleMap) => Object.keys(partition(roleMap).colour).forEach((r) => roles.add(r));
  for (const roleMap of Object.values(variants.appearance)) addRoles(roleMap);
  for (const roleMap of Object.values(styles.states)) addRoles(roleMap);
  for (const combo of styles.byCombination || []) {
    if (combo.axes.size) continue; // metrics, not colour roles
    addRoles(combo.roles);
  }
  for (const f of NON_ROLE_FIELDS) roles.delete(f);
  // Only roles the component actually sets. Seeding fill/label/border when the
  // source declares none would put empty values into every row.
  contract.appearance.roles = [...roles];

  contract.appearance.byVariant = {};
  // With no variant axis the matrix has one implicit row; it must be named
  // the same here as in the resolver, or the styling lands under a key nothing
  // reads.
  const variantValues = contract.props.variant?.values?.length ? contract.props.variant.values : ['default'];
  for (const value of variantValues) {
    // Base CSS first, then anything scoped to this variant on top.
    const block = { default: { ...cssBase.colour, ...(variants.appearance[value] || {}) } };

    for (const combo of combosFor(value)) {
      const { colour } = partition(combo.roles);
      if (!Object.keys(colour).length) continue;
      if (combo.state === 'default') Object.assign(block.default, colour);
      else if (contract.states.includes(combo.state)) {
        block[combo.state] = { ...(block[combo.state] || {}), ...colour };
      }
    }

    // Pseudo-state rules with no variant in the selector apply to every variant
    // in CSS, but semantically belong to the default one.
    if (value === contract.props.variant?.default) {
      for (const [stateName, roleMap] of Object.entries(styles.states)) {
        if (stateName === 'default') continue;
        if (!contract.states.includes(stateName)) continue;
        block[stateName] = { ...partition(roleMap).colour, ...(block[stateName] || {}) };
      }
    }
    contract.appearance.byVariant[value] = block;
  }

  if (extraAxes.length) {
    report.notes.push(
      `${extraAxes.map((a) => `\`${a}\``).join(', ')} ${extraAxes.length > 1 ? 'are' : 'is'} an additional axis. ` +
        `The matrix is variant x size x state, so styling was taken at ` +
        `${extraAxes.map((a) => `${a}=${extraDefaults[a]}`).join(', ')}; the other values need their own handling.`
    );
  }

  if (Object.keys(styles.states).some((s) => s !== 'default') && variantValues.length > 1) {
    report.notes.push(
      `State styling in CSS is not variant-scoped, so it was applied only to "${contract.props.variant?.default}". ` +
        `The other variants' state rows are intentionally blank — they are open questions.`
    );
  }

  /* sizes — cva size classes, with base CSS filling any gaps */
  contract.appearance.bySize = {};
  for (const size of contract.props.size?.values?.length ? contract.props.size.values : ['default']) {
    const fromCss = (styles.byCombination || [])
      .filter((c) => c.axes.size === size && c.state === 'default')
      .reduce((acc, c) => ({ ...acc, ...partition(c.roles).size }), {});
    contract.appearance.bySize[size] = { ...cssBase.size, ...fromCss, ...(variants.sizes[size] || {}) };
  }

  /* focus ring */
  if (styles.focusRing) {
    contract.appearance.focusRing = {
      color: styles.focusRing.color ?? null,
      width: styles.focusRing.width ?? null,
      offset: styles.focusRing.offset ?? null,
      style: styles.focusRing.style ?? 'solid',
    };
    for (const [k, v] of Object.entries(contract.appearance.focusRing)) {
      if (v == null) delete contract.appearance.focusRing[k];
    }
  }

  /* composition — the actual element tree, read from the markup
   *
   * A flat list of class names could not express nesting, and could not tell a
   * rendered child from an accessibility attribute. A prop passed to
   * `aria-label` is an accessible name, not visible text; treating it as a text
   * child is how a spinbutton's name ended up drawn on screen. */
  // The DECLARED props, not only the ones kept in the contract: `loading` and
  // `disabled` are modelled as states, so they are dropped from contract.props, but
  // `aria-busy={loading || undefined}` is still the `loading` prop and reporting it as
  // an unknown expression hides the one thing a reader wants to know.
  const tree = compositionFromTree(extractJsxTree(code), { ...tsProps.props, ...contract.props });
  if (tree) {
    /* Keep selector scope and arithmetic; flattened BEM buckets lose both. */
    const attach = (node) => {
      const classes = (node.styleClass || '').split(/\s+/);
      const own = visual.rules.filter((r) => classes.includes(r.targetClass));
      const base = own.filter((r) => !r.conditions.length && !r.media.length && !r.pseudoElement && !r.manualTranslation);
      // Several base rules can together set one typography token that no single rule sets
      // whole, so the composite is decided over the merged properties, not merged from rules.
      if (base.length) node.styles = { default: withTypography(Object.assign({}, ...base.map((r) => r.properties))) };
      (node.children || []).forEach(attach);
    };
    attach(tree);

    contract.composition = { tree };
    report.derived.push({
      level: 'derived',
      path: 'composition.tree',
      from: 'jsx',
      evidence: `${countNodes(tree)} nodes`,
    });
  } else {
    contract.composition = { tree: null };
    report.notes.push('The returned markup could not be parsed, so no element tree was read.');
  }

  // Text is stated the way colour is: as the one token it comes from. Each rule keeps the
  // composite in place of the individual tokens it stands for. This runs after the node
  // styles above were merged from the raw rules, because a composite can be set by several.
  for (const rule of visual.rules) rule.properties = withTypography(rule.properties);

  contract.layout = { ...(contract.layout || {}), ...(styles.layout || {}) };
  contract.layout.childOrder = (tree?.children || []).map((node) => node.name);
  delete contract.layout.sizing;
  contract.visualRules = visual.rules;
  contract.keyframes = visual.keyframes;
  contract.ignoredProperties = visual.ignored;
  contract.sourceNotes = visual.notes;
  report.notes.push(...visual.notes);

  // The source-scoped root base is authoritative for axis-less components.
  // This also prevents child padding and disabled colours leaking into it.
  if (tree && !contract.props.variant && !contract.props.size) {
    const base = { ...(tree.styles?.default || {}) };
    for (const key of ['outlineWidth', 'outlineColor', 'outlineStyle', 'outlineOffset']) delete base[key];
    contract.appearance.byVariant = { default: { default: base } };
    contract.appearance.bySize = { default: {} };
    contract.appearance.roles = Object.keys(base);
    // Focus rings are scoped to their actual nodes in visualRules.
    delete contract.appearance.focusRing;
  }

  /* behaviour
   *
   * Nothing here is inferred. A component's interaction logic — which event
   * moves it between states, and under what condition — is not expressed in
   * its CSS or its prop types, so there is nothing to read. Previously this
   * invented a whole state machine (PRESS, RELEASE_INSIDE, BLUR, and a guard
   * expression), none of which existed in the source. */
  contract.behavior = { initial: null, guards: {}, states: {} };

  /* motion
   *
   * Read from the scoped visual rules, where each transition and animation
   * names the node it belongs to and the condition that changes it. That is
   * what a platform team needs: "this icon scales to 0.9 while its button is
   * pressed", not "something animates its transform".
   *
   * The whole-component reading that used to live here could not say any of
   * that, and it got three things wrong: it read `linear` as easeInOut, it
   * emitted transform motion with no target, and it wrote a reduced-motion
   * behaviour ("fade") and a rotation angle (360) that the stylesheet never
   * stated. It now runs only for selectors the scoped reader cannot place. */
  contract.motion = { transitions: [], loops: [] };
  const scopedMotion = visual.rules.some((r) => r.transitions.length || r.properties.animation);
  if (!scopedMotion) {
    const pressScale = styles.transitions.find((t) => t.pressScale);
    for (const t of styles.transitions) {
      if (t.pressScale) continue;
      contract.motion.transitions.push({
        on: "*->*",
        properties: [t.property],
        duration: t.durationMs,
        curve: t.curve,
        interruptible: true,
        ...(styles.reducedMotion ? { reducedMotion: "instant" } : {}),
      });
    }
    if (pressScale) {
      const declared = styles.transitions.find((x) => x.property === "transform");
      contract.motion.transitions.push({
        on: "*->pressed",
        properties: ["scale"],
        to: { scale: pressScale.to },
        duration: declared?.durationMs ?? 0,
        curve: declared?.curve ?? { type: "linear" },
        interruptible: true,
        ...(styles.reducedMotion ? { reducedMotion: "instant" } : {}),
      });
    }
  }
  if (!styles.reducedMotion && (scopedMotion || contract.motion.transitions.length)) {
    report.notes.push(
      "No `prefers-reduced-motion` block found, so reduced motion is unstated for this component's animations — it is required, and now an open question."
    );
  }

  // Named numbers the author stated once at module scope, with the sentence
  // that explains each. Read verbatim; what they do is for the team to translate.
  const constants = extractSourceConstants(code);
  contract.sourceConstants = constants.constants;
  report.notes.push(...constants.notes);

  // The logic the markup depends on, quoted verbatim: when a button is disabled,
  // what holding it does, which keys act on it. Roots are what the markup refers
  // to, so nothing unrelated is included.
  const logicRoots = new Set();
  const gatherRefs = (n) => { (n.references || []).forEach((r) => logicRoots.add(r)); (n.children || []).forEach(gatherRefs); };
  if (tree) gatherRefs(tree);
  const logic = extractLogic(code, { roots: [...logicRoots] });
  contract.logic = logic.entries;
  report.notes.push(...logic.notes);

  const interactions = extractInteractionBindings(code);
  contract.interactionBindings = interactions.bindings;
  contract.sourceNotes.push(...interactions.notes);
  report.notes.push(...interactions.notes);

  /* a11y */
  if (jsx.a11y.role) contract.a11y.role = jsx.a11y.role;
  if (Object.keys(jsx.a11y.state || {}).length) contract.a11y.state = jsx.a11y.state;
  // `required` says whether the CONSUMER must supply the label, so it is whatever the
  // declared prop says. It was hardcoded true, which contradicted a `label?: string`
  // with a default of "Quantity" in the same file.
  contract.a11y.label = { source: contract.props.label ? 'prop:label' : null, required: !!contract.props.label?.required };
  if (!contract.props.label) delete contract.a11y.label.source;
  if (styles.minTarget != null) contract.a11y.minTargetSize = styles.minTarget;
  else delete contract.a11y.minTargetSize;
  // Only what the markup states. A focus ring is recorded because the
  // stylesheet draws one; a keyboard map is not, because nothing declares it.
  contract.a11y.focus = styles.focusRing ? { indicator: 'focusRing' } : {};
  contract.a11y.keyboard = [];

  /* adaptable
   *
   * Left empty on purpose. Whether a platform may substitute a ripple, and
   * what envelope it must stay inside, is a design decision — it is not
   * written anywhere in a React component. Inventing envelopes here put
   * limits into the contract that nobody had agreed. */
  contract.adaptable = {};

  /* Which props make sense on a touch platform is a judgement, not something
   * the source states, so nothing is marked unsupported here. */

  /* the component's own token vocabulary */
  contract.tokens = matcher.vocabulary();

  // A typography token a rule or node refers to is a token in its own right, a composite of the
  // text properties it stands for, so the vocabulary declares it. Without this the contract and
  // the platform files carry a {reference} that is not in the token list.
  const composites = new Set();
  const collectComposites = (properties) => { if (properties?.typography) composites.add(properties.typography); };
  contract.visualRules.forEach((rule) => collectComposites(rule.properties));
  const walkComposites = (node) => {
    if (!node) return;
    Object.values(node.styles || {}).forEach(collectComposites);
    (node.children || []).forEach(walkComposites);
  };
  walkComposites(contract.composition?.tree);
  for (const ref of composites) contract.tokens[ref.slice(1, -1)] = { value: null, type: TYPOGRAPHY.tokenType };

  // The individual tokens a composite stands for are no longer referenced, so the vocabulary
  // drops them, unless something else still uses one (a size's font size, say) or the
  // component declared a value for it.
  const referenced = new Set(
    (JSON.stringify({ ...contract, tokens: undefined, logic: undefined, sourceConstants: undefined }).match(/\{[\w.-]+\}/g) || []).map((m) => m.slice(1, -1))
  );
  for (const ref of composites) {
    for (const cssName of Object.values(TYPOGRAPHY.properties)) {
      const member = `${ref.slice(1, -1)}.${cssName.split('-').join('.')}`;
      if (contract.tokens[member]?.value == null && !referenced.has(member)) delete contract.tokens[member];
    }
  }
  contract.tokens = Object.fromEntries(Object.entries(contract.tokens).sort(([a], [b]) => a.localeCompare(b)));

  const declared = Object.values(contract.tokens).filter((t) => t.value != null).length;
  if (Object.keys(contract.tokens).length && declared === 0) {
    report.notes.push(
      'The component references tokens but never declares their values, so swatches are ' +
        'unavailable. Names still resolve, which is all code generation needs.'
    );
  }

  delete contract.hitArea;

  report.coverage = {
    derived: report.derived.length,
    skipped: report.skipped.length,
    files: sources.all.length,
    tokens: Object.keys(contract.tokens).length,
    tokenValues: declared,
  };

  return { contract: normalise(contract), report };
}

/**
 * Build a source set from in-memory files.
 *
 * Used when a folder is chosen in the browser: browsers never expose an
 * absolute path, so the contents come to us instead. Same partitioning as
 * gatherSources, so everything downstream is identical either way.
 *
 * @param {Array<{name:string, content:string}>} files
 */
export function sourcesFromFiles(files) {
  const all = (files || [])
    .filter((f) => f && typeof f.content === 'string' && f.name)
    .map((f) => ({
      name: basename(f.name),
      path: f.name,
      content: f.content,
    }));

  return {
    code: all.filter((f) => CODE_EXT.has(extname(f.name))),
    styles: all.filter((f) => STYLE_EXT.has(extname(f.name))),
    all,
  };
}

export async function importFromPath({ path, cssPrefix, id, name }) {
  const sources = await gatherSources(path);
  if (!sources.all.length) throw new Error(`No source files found at ${path}`);
  return importFromSources({ sources, cssPrefix, id, name });
}

/* ------------------------------------------------------------------ *
 * Re-import
 * ------------------------------------------------------------------ */

const isBlank = (v) => v == null || v === '';

/**
 * Merge a fresh draft into an existing contract.
 *
 * Re-importing must not throw away human answers. A designer spends an hour
 * deciding what "ghost, disabled" looks like — that decision is not in the code
 * and never will be, so a second import would otherwise delete it and ask the
 * same question again.
 *
 * The split:
 *   - STRUCTURE comes from code   — axes, states, props, roles. If a variant was
 *                                   deleted in source, it goes here too.
 *   - VALUES prefer code          — a changed class means the code moved.
 *   - GAPS keep the human answer  — anything the draft could not derive.
 *
 * Everything that changes is reported, so a re-import is reviewable rather than
 * a silent rewrite.
 */
export function mergeDraft(existing, draft) {
  const merged = structuredClone(draft);
  const preserved = [];
  const updated = [];
  const dropped = [];

  const variants = draft.props?.variant?.values || ['default'];
  const sizes = draft.props?.size?.values || ['default'];
  const states = draft.states || [];
  const roles = draft.appearance?.roles || [];

  /* ---- appearance matrix ---- */
  for (const [variant, exBlock] of Object.entries(existing.appearance?.byVariant || {})) {
    if (!variants.includes(variant)) {
      dropped.push(`appearance.byVariant.${variant} (variant no longer in code)`);
      continue;
    }
    merged.appearance.byVariant[variant] ||= { default: {} };

    for (const [stateName, exRoles] of Object.entries(exBlock || {})) {
      if (stateName !== 'default' && !states.includes(stateName)) {
        dropped.push(`appearance.byVariant.${variant}.${stateName} (state no longer in code)`);
        continue;
      }
      const target = (merged.appearance.byVariant[variant][stateName] ||= {});

      for (const [role, exValue] of Object.entries(exRoles || {})) {
        // A blank is not an answer. Carrying it forward would pin the role to
        // an empty value instead of letting it inherit from the resting state.
        if (isBlank(exValue)) continue;
        if (!roles.includes(role)) {
          dropped.push(`appearance.byVariant.${variant}.${stateName}.${role} (role no longer in code)`);
          continue;
        }
        const where = `appearance.byVariant.${variant}.${stateName}.${role}`;
        if (isBlank(target[role])) {
          target[role] = exValue;
          preserved.push(where);
        } else if (target[role] !== exValue) {
          updated.push(`${where}: ${exValue} → ${target[role]}`);
        }
      }
    }
  }

  /* ---- size metrics ---- */
  for (const [size, exMetrics] of Object.entries(existing.appearance?.bySize || {})) {
    if (!sizes.includes(size)) {
      dropped.push(`appearance.bySize.${size} (size no longer in code)`);
      continue;
    }
    const target = (merged.appearance.bySize[size] ||= {});
    for (const [key, exValue] of Object.entries(exMetrics || {})) {
      if (draft.visualRules?.length && !draft.props.variant && !draft.props.size) {
        // Older imports accidentally attached child metrics to the root.
        // Re-read source-scoped metrics rather than preserving that corruption.
        dropped.push(`appearance.bySize.${size}.${key} (replaced by source-scoped node properties)`);
        continue;
      }
      if (isBlank(exValue)) continue;
      const where = `appearance.bySize.${size}.${key}`;
      if (isBlank(target[key])) {
        target[key] = exValue;
        preserved.push(where);
      } else if (target[key] !== exValue) {
        updated.push(`${where}: ${exValue} → ${target[key]}`);
      }
    }
  }

  /* ---- scalars the code can rarely supply ---- */
  const fillGap = (path) => {
    if (draft.visualRules?.length && path.startsWith('appearance.focusRing.')) return;
    const keys = path.split('.');
    const last = keys.pop();
    let ex = existing;
    for (const k of keys) ex = ex?.[k];
    // Nothing to preserve: leave the contract as it is. The parents used to be created on the
    // way down regardless, so every re-import left an empty `hitArea: {}` behind.
    if (!ex || isBlank(ex[last])) return;
    let mg = merged;
    for (const k of keys) {
      if (mg[k] == null || typeof mg[k] !== 'object') mg[k] = {};
      mg = mg[k];
    }
    if (isBlank(mg[last])) {
      mg[last] = ex[last];
      preserved.push(path);
    }
  };

  for (const path of [
    'description',
    'a11y.minTargetSize',
    'a11y.label.source',
    'appearance.focusRing.color',
    'appearance.focusRing.width',
    'appearance.focusRing.offset',
    'appearance.focusRing.style',
    'layout.direction',
    'layout.align',
    'layout.justify',
    'hitArea.strategy',
  ]) {
    fillGap(path);
  }

  /* ---- tokens: the code is authoritative, but keep any value already known ---- */
  merged.tokens = { ...(draft.tokens || {}) };
  for (const [name, prior] of Object.entries(existing.tokens || {})) {
    if (!merged.tokens[name]) continue; // the component no longer uses it
    if (merged.tokens[name].value == null && prior.value != null) {
      merged.tokens[name] = { ...merged.tokens[name], value: prior.value };
      preserved.push(`tokens.${name} (value)`);
    }
  }

  /* ---- contract version: keep the human's, it is theirs to bump ---- */
  if (existing.contractVersion) merged.contractVersion = existing.contractVersion;
  if (existing.name && !name(draft)) merged.name = existing.name;

  /* ---- adaptable: keep tuned envelopes, add anything new ---- */
  for (const [key, exDef] of Object.entries(existing.adaptable || {})) {
    if (merged.adaptable[key]) {
      // The human may have narrowed an envelope or written a real intent.
      merged.adaptable[key] = {
        ...merged.adaptable[key],
        ...(exDef.intent ? { intent: exDef.intent } : {}),
        envelope: { ...merged.adaptable[key].envelope, ...exDef.envelope },
        fallback: exDef.fallback ?? merged.adaptable[key].fallback,
      };
      preserved.push(`adaptable.${key} (envelope and fallback)`);
    } else {
      merged.adaptable[key] = exDef;
      preserved.push(`adaptable.${key}`);
    }
  }

  /* ---- motion: reducedMotion is a human decision when CSS lacks it ---- */
  for (const t of merged.motion?.transitions || []) {
    if (t.reducedMotion) continue;
    const match = (existing.motion?.transitions || []).find((e) => e.on === t.on);
    if (match?.reducedMotion) {
      t.reducedMotion = match.reducedMotion;
      preserved.push(`motion "${t.on}".reducedMotion`);
    }
  }
  for (const l of merged.motion?.loops || []) {
    if (l.reducedMotion) continue;
    const match = (existing.motion?.loops || []).find((e) => e.id === l.id);
    if (match?.reducedMotion) {
      l.reducedMotion = match.reducedMotion;
      preserved.push(`motion loop "${l.id}".reducedMotion`);
    }
  }

  /* ---- behaviour: the human's machine wins if they edited it ---- */
  const draftEvents = JSON.stringify(draft.behavior?.states || {});
  const exEvents = JSON.stringify(existing.behavior?.states || {});
  if (exEvents !== draftEvents && Object.keys(existing.behavior?.states || {}).length) {
    const stillValid = Object.keys(existing.behavior.states).every((s) => states.includes(s));
    if (stillValid) {
      merged.behavior = structuredClone(existing.behavior);
      preserved.push('behavior (state machine kept as edited)');
    }
  }

  /* ---- prune: the merged result must be structurally consistent ----
   *
   * Walking `existing` only catches stale entries that came from there. The
   * draft can carry them too, so a final pass enforces that the matrix only
   * ever references axes, states, and roles that actually exist.
   */
  for (const variant of Object.keys(merged.appearance?.byVariant || {})) {
    if (!variants.includes(variant)) {
      delete merged.appearance.byVariant[variant];
      dropped.push(`appearance.byVariant.${variant} (variant no longer in code)`);
      continue;
    }
    const block = merged.appearance.byVariant[variant];
    for (const stateName of Object.keys(block)) {
      if (stateName !== 'default' && !states.includes(stateName)) {
        delete block[stateName];
        dropped.push(`appearance.byVariant.${variant}.${stateName} (state no longer in code)`);
        continue;
      }
      for (const role of Object.keys(block[stateName] || {})) {
        if (!roles.includes(role)) {
          delete block[stateName][role];
          dropped.push(`appearance.byVariant.${variant}.${stateName}.${role} (role no longer in code)`);
        }
      }
    }
  }
  for (const size of Object.keys(merged.appearance?.bySize || {})) {
    if (!sizes.includes(size)) {
      delete merged.appearance.bySize[size];
      dropped.push(`appearance.bySize.${size} (size no longer in code)`);
    }
  }

  return { contract: normalise(merged), merge: { preserved, updated, dropped: [...new Set(dropped)] } };

  function name(d) {
    return d.name && d.name !== d.id.charAt(0).toUpperCase() + d.id.slice(1);
  }
}
