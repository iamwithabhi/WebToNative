/** Source constants are read verbatim, with their doc comment, or not at all. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSourceConstants } from '../src/core/import/constants.js';

const by = (res, name) => res.constants.find((c) => c.name === name);

const counter = `
/** Repeat interval while a button is held. */
const HOLD_INTERVAL_MS = 150;
/** How long the value stays scaled up after a change. */
const POP_MS = 100;
/** Haptic pulse length on supporting devices. */
const HAPTIC_MS = 8;
/** PageUp/PageDown multiplier. */
const LARGE_STEP_FACTOR = 10;
`;

test('the named numbers of a component are read with the sentence above each', () => {
  const r = extractSourceConstants(counter);
  assert.equal(r.constants.length, 4);
  assert.deepEqual(by(r, 'HOLD_INTERVAL_MS'), {
    name: 'HOLD_INTERVAL_MS',
    kind: 'number',
    value: 150,
    description: 'Repeat interval while a button is held.',
    source: 'const HOLD_INTERVAL_MS = 150;',
  });
  assert.equal(by(r, 'HAPTIC_MS').value, 8);
  assert.equal(by(r, 'LARGE_STEP_FACTOR').description, 'PageUp/PageDown multiplier.');
  assert.deepEqual(r.notes, []);
});

test('a flat lookup map is kept whole, with or without as const', () => {
  const r = extractSourceConstants(`const ICON_SIZE = { sm: 'sm', md: 'sm', lg: 'md' } as const;`);
  assert.equal(r.constants[0].kind, 'map');
  assert.deepEqual(r.constants[0].value, { sm: 'sm', md: 'sm', lg: 'md' });
  assert.equal(r.constants[0].source, `const ICON_SIZE = { sm: 'sm', md: 'sm', lg: 'md' } as const;`);

  const plain = extractSourceConstants(`const GAP = { tight: 4, loose: 12 };`);
  assert.deepEqual(plain.constants[0].value, { tight: 4, loose: 12 });
});

test('a constant with no doc comment has no description, never a guessed one', () => {
  for (const code of [
    `const POP_MS = 100;`,
    `// how long the pop lasts\nconst POP_MS = 100;`,
    `/** orphaned */\n\nconst POP_MS = 100;`,
  ]) {
    const r = extractSourceConstants(code);
    assert.equal(r.constants[0].description, null, code);
  }
});

test('a multi-line doc block collapses to one sentence', () => {
  const r = extractSourceConstants(`
    /**
     * Haptic pulse length
     * on supporting devices.
     */
    const HAPTIC_MS = 8;
  `);
  assert.equal(r.constants[0].description, 'Haptic pulse length on supporting devices.');
});

test('export, type annotations, negatives and decimals are all literals', () => {
  const r = extractSourceConstants(`
    export const A = 5;
    const B: number = 2.5;
    const C = -3;
    const D = 'hi';
  `);
  assert.deepEqual(r.constants.map((c) => [c.name, c.value]), [['A', 5], ['B', 2.5], ['C', -3], ['D', 'hi']]);
});

test('only module scope counts: a constant inside a function is not a design number', () => {
  const r = extractSourceConstants(`
    const TOP = 1;
    export function Counter() {
      const INNER = 2;
      if (x) { const NESTED = 3; }
      return null;
    }
  `);
  assert.deepEqual(r.constants.map((c) => c.name), ['TOP']);
});

test('comments and strings cannot declare anything', () => {
  const r = extractSourceConstants(`
    // const COMMENTED = 1;
    /* const BLOCK = 2; */
    const TEXT = "const FAKE = 3;";
    const REAL = 4;
  `);
  assert.deepEqual(r.constants.map((c) => c.name), ['TEXT', 'REAL']);
  assert.equal(r.constants[0].value, 'const FAKE = 3;');
});

test('anything that is not a plain literal is flagged, not evaluated', () => {
  const r = extractSourceConstants(`
    const COMPUTED = 50 * 2;
    const ALIAS = OTHER;
    const NESTED = { a: { b: 1 } };
    const LIST = [1, 2, 3];
    const SPREAD = { ...base, a: 1 };
    const OK = 7;
  `);
  assert.deepEqual(r.constants.map((c) => c.name), ['OK']);
  for (const n of ['COMPUTED', 'ALIAS', 'NESTED', 'LIST', 'SPREAD']) {
    assert.ok(r.notes.some((x) => x.startsWith(`${n}:`)), `${n} should be flagged`);
  }
});

test('functions and components are not constants and are not noise', () => {
  const r = extractSourceConstants(`
    const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
    export const Button = forwardRef(function Button() { return null; });
    const POP_MS = 100;
  `);
  assert.deepEqual(r.constants.map((c) => c.name), ['POP_MS']);
  assert.deepEqual(r.notes, []);
});

test('empty, non-string and unbalanced input yield nothing rather than a guess', () => {
  assert.deepEqual(extractSourceConstants(''), { constants: [], notes: [] });
  assert.deepEqual(extractSourceConstants(null), { constants: [], notes: [] });
  const bad = extractSourceConstants(`const A = 1; function f() {`);
  assert.deepEqual(bad.constants, []);
  assert.match(bad.notes[0], /unbalanced/);
});

test('constants are returned in source order', () => {
  const r = extractSourceConstants(counter);
  assert.deepEqual(r.constants.map((c) => c.name), ['HOLD_INTERVAL_MS', 'POP_MS', 'HAPTIC_MS', 'LARGE_STEP_FACTOR']);
});

/* ------------------------------------------------------------------ *
 * prop documentation
 * ------------------------------------------------------------------ */

import { extractPropDocs } from '../src/core/import/constants.js';

test('the sentence above each prop is read verbatim, and only that', () => {
  const docs = extractPropDocs(`
    export interface ButtonProps {
      /** Visible text. Omit only when \`iconOnly\` is set. */
      label?: string;
      variant?: ButtonVariant;
      /** Shows a spinner and blocks interaction. Announced via \`aria-busy\`. */
      loading?: boolean;
    }
  `);
  assert.deepEqual(docs, {
    label: 'Visible text. Omit only when `iconOnly` is set.',
    loading: 'Shows a spinner and blocks interaction. Announced via `aria-busy`.',
  });
  assert.ok(!('variant' in docs), 'a prop with no doc comment has none, never a guessed one');
});

test('multi-line docs collapse, and braces inside a comment do not break the match', () => {
  const docs = extractPropDocs(`
    export interface CounterProps {
      /**
       * Human-readable rendering of the value for assistive tech, e.g. \`(n) => \${n} items\`.
       * Maps to \`aria-valuetext\`.
       */
      formatValueText?: (value: number) => string;
      /** Starting value when uncontrolled. */
      defaultValue?: number;
    }
  `);
  assert.match(docs.formatValueText, /^Human-readable rendering of the value for assistive tech/);
  assert.match(docs.formatValueText, /Maps to `aria-valuetext`\.$/);
  assert.equal(docs.defaultValue, 'Starting value when uncontrolled.');
});

test('a blank line, a line comment or a nested member does not donate a description', () => {
  const docs = extractPropDocs(`
    interface XProps {
      /** orphaned */

      a?: string;
      // not a doc comment
      b?: string;
      /** belongs to c */
      c?: { /** inner */ d?: string };
    }
  `);
  assert.deepEqual(docs, { c: 'belongs to c' });
});

test('no props interface, or empty input, yields nothing', () => {
  assert.deepEqual(extractPropDocs(''), {});
  assert.deepEqual(extractPropDocs(null), {});
  assert.deepEqual(extractPropDocs('const a = 1;'), {});
});
