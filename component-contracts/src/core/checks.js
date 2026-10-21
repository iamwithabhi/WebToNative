/*
 * The checks this tool runs, listed by reading the validator.
 *
 * A hand-written list of rules is wrong the first time someone adds one. This
 * parses the `f.error(...)` / `f.warn(...)` / `f.info(...)` calls out of
 * validate.js and the problem strings out of the closure check, so the page
 * describing the checks is derived from the checks.
 *
 * What it cannot read is intent — why a rule exists, and whether failing it
 * stops a build. That is stated here, keyed by rule code, and any rule without
 * an entry is reported as undocumented rather than quietly given prose.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Rule groups, by the prefix of the rule code. */
const GROUPS = {
  meta: { title: 'Identity', note: 'The contract can be named and versioned.' },
  axes: { title: 'Axes', note: 'The variant, size, and state dimensions of the component.' },
  props: { title: 'Props', note: 'The component API as its types declare it.' },
  prop: { title: 'Props', note: 'Enum props and their defaults.' },
  size: { title: 'Sizes', note: 'Per-size metrics and the keys they use.' },
  focusRing: { title: 'Focus ring', note: 'The ring is drawn from complete values.' },
  layout: { title: 'Layout', note: 'Children referenced by layout exist in the tree.' },
  platform: { title: 'Platform', note: 'What is dropped when narrowing to one platform.' },
  token: { title: 'Tokens', note: 'Every value points at a token the component actually has.' },
  appearance: { title: 'Appearance', note: 'The style matrix is complete across variants and states.' },
  motion: { title: 'Motion', note: 'Animation is expressible on every target platform.' },
  a11y: { title: 'Accessibility', note: 'The component says what it is and how it is reached.' },
  composition: { title: 'Composition', note: 'The element tree and its parts.' },
  adaptable: { title: 'Adaptable', note: 'Platform-specific choices each carry a working fallback.' },
  behavior: { title: 'Behaviour', note: 'Declared states and transitions agree with each other.' },
  hitArea: { title: 'Hit area', note: 'The component can be hit at the platform minimum.' },
};

/**
 * Why each rule exists. Absence is reported, never filled in.
 * `blocking` records whether the finding actually stops a build — several
 * rules are raised as errors but do not.
 */
const INTENT = {
  /* identity */
  'meta.id': 'The id becomes a file name and a type name on both platforms, so it has to be valid in both.',
  'meta.name': 'The name is what a reader sees in the spec, the UI, and the generated documentation.',
  'meta.version': 'Consumers pin to a contract version, so versions have to be comparable to each other.',
  'meta.description': 'A component with no stated purpose cannot be reviewed for whether it does that job.',

  /* axes */
  'axes.variant': 'Reported when no variant axis exists. The resolver collapses to a single implicit row, so a component with one appearance still builds — this does not block.',
  'axes.size': 'Reported when no size axis exists. Handled exactly like variant, and equally non-blocking.',
  'axes.state': 'States are the one axis that cannot be implied. With none there is no matrix to enumerate and nothing to emit.',

  /* props */
  'prop.enum.empty': 'An enum with no values admits no value, so every use of the prop is invalid.',
  'prop.enum.default': 'A default outside the declared set means the component starts in a state its own type rejects.',

  /* tokens */
  'token.missing': 'A reference that resolves to nothing reaches the platform as a dangling symbol that will not compile.',

  /* appearance */
  'appearance.roles': 'Roles are what the matrix has columns for. With none declared there is nothing to style.',
  'appearance.variant.missing': 'Each variant needs a block, or its rows in the matrix cannot be filled.',
  'appearance.default.missing': 'Every other state is stored as a delta from the base, so the base has to exist first.',
  'appearance.role.unresolved': 'A role left unresolved in the base state becomes a null in the emitted file.',
  'appearance.state.unknown': 'A style block for a state the component does not have is dead weight that will never be applied.',
  'appearance.role.unknown': 'A role that appears in a state but in no declaration is usually a typo, so it is a warning rather than an error.',
  'appearance.state.identical': 'A state with no overrides renders identically to the base. Usually an oversight — but an explicitly empty block is read as a decision and accepted silently.',

  /* sizes */
  'size.missing': 'A declared size with no block has no metrics, so its rows cannot be built.',
  'size.key.unresolved': 'Only raised when another size sets the same key. One size having a padding and another not is an omission rather than a choice.',

  /* focus ring */
  'focusRing.missing': 'The ring is the visible focus indicator. Without a colour it cannot be drawn at all.',
  'focusRing.key': 'A ring with some parts missing cannot be drawn consistently across platforms.',

  /* layout and composition */
  'layout.child.unknown': 'Ordering a child that does not exist means the layout refers to nothing.',
  'composition.child.unordered': 'A child absent from childOrder is never placed, so it silently does not render.',
  'composition.bind.unknown': 'Binding to a prop that does not exist gives the child no source of content.',
  'composition.loading': 'A loading state with nothing marked visible leaves the component blank while it loads. Asked because the answer is a design decision, not a fact in the code.',

  /* behaviour */
  'behavior.initial': 'A machine starting in an undefined state has no valid first state to enter.',
  'behavior.state.undeclared': 'A behaviour state outside the top-level list has no row in the style matrix, so it cannot be rendered.',
  'behavior.target': 'A transition to an unknown state is a dead end at runtime.',
  'behavior.guard': 'A transition naming a guard that does not exist can never be evaluated.',

  /* motion */
  'motion.on': 'Transitions are keyed "from->to". Any other form cannot say which states it connects.',
  'motion.from': 'A transition out of a state the component does not have can never fire.',
  'motion.to': 'A transition into a state the component does not have has no destination.',
  'motion.properties': 'A transition animating nothing has no effect and is probably unfinished.',
  'motion.unsafe': 'Some properties animate differently or expensively per platform. These are refused rather than approximated, and the reason is recorded against each one.',
  'motion.unknown-prop': 'A property outside the known set has no per-platform name, so it is passed through unchanged and flagged.',
  'motion.reducedMotion': 'Reduced motion is an accessibility setting. Without a declared fallback the platform has to invent one.',
  'motion.reducedMotion.invalid': 'An unrecognised mode cannot be honoured by either platform.',
  'motion.slow-spring': 'A spring that takes a long time to settle feels unresponsive. A warning, because a slow spring is sometimes intended.',
  'motion.duration': 'A timing curve describes the shape of an animation but not its length, so the duration must be stated separately.',
  'motion.curve': 'Forwards whatever the curve parser rejected — an unknown type, or control points that are not four numbers.',
  'motion.loop.reducedMotion': 'A looping animation never stops on its own, so it matters most when reduced motion is on.',
  'motion.loop.state': 'A loop active in a state the component does not have can never run.',

  /* accessibility */
  'a11y.role': 'Reported when the root node declares no role. A layout wrapper legitimately has none and its children may carry their own, so this does not block.',
  'a11y.role.unknown': 'A role outside the mapping table has no iOS or Android equivalent, so the spec would have nothing to say about it.',
  'a11y.label': 'A control with no accessible name is announced as nothing by a screen reader.',
  'a11y.label.prop': 'A name sourced from a prop that does not exist resolves to nothing at runtime.',
  'a11y.target': 'iOS asks for 44pt and Android 48dp. Without a stated minimum the component may be smaller than either.',
  'a11y.disabled': 'A disabled control that still announces as enabled misleads a screen-reader user. A warning, since not every disabled state needs announcing.',

  /* adaptable */
  'adaptable.intent': 'A platform team implementing this natively needs to know what it is for, or they cannot judge whether their version is faithful.',
  'adaptable.envelope': 'The envelope is what keeps a native implementation within bounds. Without it the field is unconstrained.',
  'adaptable.fallback': 'A team that makes no special choice must still get something correct, so no platform is forced to decide.',
  'adaptable.fallback.envelope': 'A fallback breaching its own envelope means the default is outside the limits the contract sets.',

  /* platform */
  'platform.states.dropped': 'Informational. Records that a pointer-only state was removed for this platform, so its absence from the spec is traceable rather than mysterious.',
};


/** One `f.<severity>(code, path, message, ...)` call in the validator. */
/*
 * One `f.<severity>(code, path, message, ...)` call in the validator.
 *
 * The message is not always a literal — `motion.curve` passes `err.message`
 * through — so an identifier is accepted and reported as dynamic. An earlier
 * version required a literal and silently dropped that rule.
 */
const CALL =
  /\bf\.(error|warn|info)\(\s*'([^']+)'\s*,\s*(?:'([^']*)'|`([^`]*)`|([A-Za-z_$][\w.$]*))\s*,\s*(?:'([^']*)'|`([^`]*)`|([A-Za-z_$][\w.$]*))/g;

export async function checks(root) {
  const src = await readFile(join(root, 'src/core/validate.js'), 'utf8');

  const byCode = new Map();
  for (const m of src.matchAll(CALL)) {
    const [, severity, code, pathA, pathB, pathVar, msgA, msgB, msgVar] = m;
    const line = src.slice(0, m.index).split('\n').length;
    const entry = byCode.get(code) || {
      code,
      severity,
      group: code.split('.')[0],
      paths: new Set(),
      messages: new Set(),
      lines: [],
      intent: INTENT[code] || null,
    };
    // A rule raised at more than one severity is reported at the strictest.
    if (severity === 'error') entry.severity = 'error';
    entry.paths.add(pathA ?? pathB ?? `\${${pathVar}}`);
    const message = msgA ?? msgB ?? (msgVar ? `(from ${msgVar})` : '');
    entry.messages.add(message.replace(/\$\{[^}]*\}/g, '…'));
    entry.lines.push(line);
    byCode.set(code, entry);
  }

  const groups = [];
  for (const [prefix, meta] of Object.entries(GROUPS)) {
    const rules = [...byCode.values()]
      .filter((r) => r.group === prefix)
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((r) => ({
        code: r.code,
        severity: r.severity,
        paths: [...r.paths],
        messages: [...r.messages],
        line: Math.min(...r.lines),
        intent: r.intent,
      }));
    if (rules.length) groups.push({ id: prefix, ...meta, rules });
  }

  // Anything whose prefix has no group would otherwise vanish from the page.
  const grouped = new Set(groups.flatMap((g) => g.rules.map((r) => r.code)));
  const ungrouped = [...byCode.values()]
    .filter((r) => !grouped.has(r.code))
    .map((r) => ({ code: r.code, severity: r.severity, line: Math.min(...r.lines) }));

  const all = [...byCode.values()];
  return {
    groups,
    ungrouped,
    closure: closureChecks(),
    totals: {
      rules: all.length,
      errors: all.filter((r) => r.severity === 'error').length,
      warnings: all.filter((r) => r.severity === 'warn').length,
      undocumented: all.filter((r) => !r.intent).length,
    },
  };
}

/**
 * The closure check is not rule-based: it asks one question of the resolved
 * artifact, so it is described rather than parsed.
 */
function closureChecks() {
  return {
    question: 'Is every row of the resolved artifact internally consistent?',
    note:
      'Closure is not a checklist. An external list would demand things the design never stated, forcing the tool either to block on everything or to invent values. It asks only that what the component does say is complete and uniform.',
    items: [
      { check: 'axes.state is not empty', why: 'With no states there is no matrix.' },
      { check: 'the styles matrix is not empty', why: 'Nothing to emit otherwise.' },
      {
        check: 'row count equals variants × sizes × states',
        why: 'A missing combination would be a hole the platform has to guess at.',
      },
      {
        check: 'every required field is present on every row',
        why: 'Absent keys are checked first: iterating an object can only see what is there, so a dropped field would never be noticed.',
      },
      { check: 'no value is null, undefined, or empty', why: 'These reach the platform as nulls.' },
      { check: 'every focus ring part resolves', why: 'A half-specified ring cannot be drawn.' },
      { check: 'every adaptable field has a fallback', why: 'A platform that makes no choice still needs something correct.' },
    ],
    blocking:
      'With --strict, the default, a component that fails closure is not written. With --no-strict it is written with gaps intact and reported as incomplete rather than successful.',
  };
}
