/**
 * The Motion & interaction page's logic: what moves, and what makes it move.
 *
 * One table. Each row is a motion: the trigger that starts it, what moves and from
 * where to where, how long it takes, and what it does when the user has asked for
 * reduced motion. That is the whole question a team asks of this page.
 *
 * Everything in a row is read from the platform spec's animations. A trigger is the
 * condition the component's own CSS attaches to the motion (pressed, not disabled,
 * a prop is true) with, underneath, what the markup says sets it. Where the source
 * does not say, the row says so, and nothing is filled in.
 *
 * Below it, Interaction: what the user can do (press, hold, keys, haptics) and which
 * handler in the source deals with it, with the author's own named amounts and their
 * notes beside it. What a handler does is logic, which is quoted exactly as written
 * and is not interpreted, so each is collapsed until opened.
 *
 * This file is the logic only: it returns rows of plain strings, and views/motion.js draws
 * them. No DOM, so it is tested in Node.
 */

/** What the user does, for each event the source is found to use. */
const ACTION_WORDS = {
  'event.pointerDown': 'press down',
  'event.pointerUp': 'release',
  'event.pointerCancel': 'touch cancelled',
  'event.pointerLeave': 'pointer leaves',
  'event.keyDown': 'key press',
  'event.click': 'click',
  'feedback.haptic': 'haptic feedback',
};

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const STATE_WORDS = {
  pressed: 'pressed', focused: 'focused', hover: 'hovered', disabled: 'disabled', loading: 'loading', idle: 'at rest',
};

/** `data-full-width` -> `full width`, `aria-disabled` -> `disabled`. */
const attributeWords = (attribute) => String(attribute).replace(/^(aria|data)-/, '').replace(/-/g, ' ');

/** `borderColor` -> `border color`. */
const propertyWords = (property) => String(property).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

/** One value: a number, a `{value, unit}` length, a token by name, or a keyword. */
function valueWords(v, h) {
  if (v == null || v === '') return '\u2014';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return h.label(v);
  if (v.value !== undefined && 'unit' in v) return `${v.value}${v.unit || ''}`;
  return h.label(v);
}

/** From and to for a transform: `scale 1 \u2192 0.9`, `rotate 0\u00b0 \u2192 360\u00b0`. */
function transformWords(from, to, h) {
  const keys = [...new Set([...Object.keys(to || {}), ...Object.keys(from || {})])].filter((k) => k !== 'order');
  return keys
    .map((k) => {
      const name = k === 'rotateDeg' ? 'rotate' : k;
      const unit = k === 'rotateDeg' ? '\u00b0' : '';
      const a = from?.[k] === undefined ? null : `${valueWords(from[k], h)}${unit}`;
      const b = to?.[k] === undefined ? '\u2014' : `${valueWords(to[k], h)}${unit}`;
      return a === null ? `${name} \u2192 ${b}` : `${name} ${a} \u2192 ${b}`;
    })
    .join(', ');
}

const curveWords = (timing) => {
  const c = timing?.curve || {};
  if (c.type === 'spring') {
    return c.response != null
      ? `spring (response ${c.response}, damping ${c.dampingFraction})`
      : c.stiffness != null ? `spring (stiffness ${c.stiffness}, ratio ${c.dampingRatio})` : 'spring';
  }
  return c.named || (c.value ? `cubic-bezier(${c.value.join(', ')})` : '\u2014');
};

const timingWords = (a) => {
  const t = a?.timing;
  if (!t) return '\u2014';
  const parts = [`${t.durationMs ?? '\u2014'}ms`, curveWords(t)];
  if (t.delayMs) parts.push(`after ${t.delayMs}ms`);
  if (a.kind === 'loop') parts.push(t.iterations === 'infinite' ? 'repeats' : `${t.iterations} times`);
  return parts.join(' \u00b7 ');
};

/** What the user's "reduce motion" setting does to this motion, as the stylesheet states it. */
const reducedWords = (r) =>
  !r ? 'not stated'
  : r.enabled === false ? 'off'
  : r.mode ? r.mode
  : r.effectivelyInstant ? 'instant'
  : `${r.durationMs}ms`;

/**
 * A condition as a short statement about its node: `pressed`, `not disabled`,
 * `pop is set`. A condition that names a prop, a state or a computed value uses that
 * name, because it says more than the attribute it ends up on.
 */
function predicate(w) {
  if (w.state) return `${w.negate ? 'not ' : ''}${STATE_WORDS[w.state] || w.state}${w.focusVisible ? ' by keyboard' : ''}`;
  const d = w.driver || {};
  // A state the component sets reads as "pop is set"; its own value is not the point.
  if (d.state) return `${d.state} is ${w.negate ? 'not ' : ''}${w.equals === 'true' ? 'set' : w.equals}`;
  const named = d.prop || d.derived;
  if (named) return `${named} ${w.negate ? 'is not' : 'is'} ${w.equals}`;
  const name = attributeWords(w.attribute);
  if (w.equals === 'true') return `${w.negate ? 'not ' : ''}${name}`;
  return `${name} ${w.negate ? '\u2260' : '='} ${w.equals}`;
}

/** What the markup says sets a condition, when it is not a prop. Nothing here is evaluated. */
function whyOf(w) {
  const d = w.driver;
  if (!w.attribute) return null; // an interaction state: the platform tracks it
  if (!d) return 'set inside the component';
  if (d.state) return `set in ${(d.activatedIn || []).filter(Boolean).join(', ') || 'the component'}`;
  // Said in terms of the attribute, so it is clear what the helper sets.
  if (d.spread) return `${attributeWords(w.attribute)} is set by ${d.spread}`;
  if (d.derived) return `${d.derived} is computed in the component`;
  if (d.expression) return `${attributeWords(w.attribute)} comes from ${d.expression}`;
  return null; // a prop or a literal needs no explanation
}

/** The trigger for one change: the nodes it depends on, each with what must hold of it. */
function triggerOf(when = []) {
  const byNode = new Map();
  // Interaction states first: "pressed, not disabled" reads in the order a person thinks of them.
  for (const w of [...when].sort((a, b) => Number(!!b.state) - Number(!!a.state))) {
    const list = byNode.get(w.node) || byNode.set(w.node, []).get(w.node);
    list.push(predicate(w));
  }
  const why = [...new Set(when.map(whyOf).filter((x) => !!x))];
  return { lines: [...byNode].map(([node, predicates]) => ({ node, predicates })), why };
}

/**
 * The rows of the table: one per motion.
 *
 * A transform that a condition switches on is a motion of its own, so each condition
 * is a row. A colour or other value that moves between the values its states give it is
 * one motion, however many values there are, so it is one row.
 *
 * @param previews the first sets the rows; the others are compared with it for timing.
 * @param h        how to name a value: { label(value) }
 */
export function motionRows(previews = [], h) {
  const first = previews[0]?.artifact?.animations || [];
  const rows = [];

  first.forEach((a, index) => {
    const timing = previews.map((p) => ({ platform: p.platform, text: timingWords(p.artifact?.animations?.[index]) }));
    const reduced = reducedWords(a.reducedMotion);
    const base = { node: a.node || a.on || 'component', property: a.property, kind: a.kind, timing, reduced };

    if (a.kind === 'loop') {
      const frames = a.keyframes || [];
      rows.push({
        ...base,
        trigger: { lines: [], text: `while ${a.appliesWhile || 'it is active'}`, why: [] },
        motion: transformWords(frames[0]?.value, frames.at(-1)?.value, h) || propertyWords(a.property),
      });
      return;
    }

    const changes = a.changes || [];
    const discrete = changes.length > 0 && changes.every((c) => c.to && typeof c.to === 'object');
    if (discrete) {
      for (const change of changes) {
        const then = change.timeline?.singleShot?.[1];
        rows.push({
          ...base,
          trigger: triggerOf(change.when),
          motion: transformWords(a.rest?.value, change.to, h),
          then: then ? `back to rest after ${then.atMs}ms${change.timeline.resetDelayExpression ? ` (${change.timeline.resetDelayExpression})` : ''}` : null,
        });
      }
      return;
    }

    rows.push({
      ...base,
      trigger: { lines: [], text: 'when its state changes', why: [] },
      motion: `${propertyWords(a.property)} moves between its values${changes.length ? ` (${changes.length})` : ''}`,
    });
  });

  return rows;
}

/**
 * Which handler in the source deals with which user action.
 *
 * An action is attributed to a handler only because the handler's own text uses the
 * event, as the importer found it. What the handler does is not said: that is its
 * quoted source. An event the markup attaches inline has no handler to open, so it
 * is listed with the node it is on.
 */
export function interactionRows({ logic = [], sourceEvents = [] } = {}) {
  const words = (events) => events.map((ev) => ACTION_WORDS[ev.concept] || ev.concept);
  const handled = logic
    .filter((entry) => sourceEvents.some((ev) => ev.foundIn.includes(entry.name)))
    .map((entry) => {
      const events = sourceEvents.filter((ev) => ev.foundIn.includes(entry.name));
      const attached = [...new Set(events.flatMap((ev) => ev.foundIn.filter((f) => f.startsWith('node:')).map((f) => f.slice(5))))];
      return { entry, actions: words(events), attached };
    });
  const inline = sourceEvents
    .filter((ev) => ev.foundIn.length && ev.foundIn.every((f) => f.startsWith('node:')))
    .map((ev) => ({ action: words([ev])[0], nodes: ev.foundIn.map((f) => f.slice(5)) }));
  return { handled, inline };
}

/**
 * The amounts the component's author named, with the author's own note and where in
 * the quoted logic each is used. A name ending in _MS is milliseconds, as it says.
 */
export function constantRows({ sourceConstants = [], logic = [] } = {}) {
  return sourceConstants.map((c) => {
    const word = new RegExp(`(?<![\\w$])${escapeRe(c.name)}(?![\\w$])`);
    return {
      name: c.name,
      value: c.value,
      unit: /_MS$/.test(c.name) ? 'ms' : '',
      note: c.description || null,
      usedIn: logic.filter((entry) => word.test(entry.source)).map((entry) => entry.name),
    };
  });
}
