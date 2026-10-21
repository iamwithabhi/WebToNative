/**
 * The Motion & interaction page's logic: the rows it is built from.
 *
 * lib/motion.ts is pure, so it is tested here on the specs the real pipeline produces for
 * Counter and for small synthetic components. That the page draws these rows, keeps quoted
 * source closed until it is opened, and shows a hand-written state machine only when there
 * is one, is covered by test/ui-views.test.js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import { importFromSources, importFromPath, sourcesFromFiles } from '../src/core/import/index.js';
import { loadConfig, tokenIndexFor } from '../src/core/build.js';
import { resolve } from '../src/core/resolve.js';
import { motionRows, interactionRows, constantRows } from '../src/ui/js/lib/motion.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = await loadConfig(ROOT);

const label = (v) => (typeof v === 'string' ? v.replace(/^\{(.+)\}$/, '$1') : JSON.stringify(v));
const h = { label };

// What the reader receives from /api/preview: the resolver's artifact, as JSON.
const previewsFor = (contract) =>
  ['ios', 'android'].map((platform) => ({
    platform,
    artifact: JSON.parse(JSON.stringify(resolve(contract, tokenIndexFor(contract, config), platform).artifact)),
  }));
const fromSource = (tsx, css) =>
  previewsFor(importFromSources({ sources: sourcesFromFiles([{ name: 'X.tsx', content: tsx }, { name: 'x.css', content: css }]), id: 'x' }).contract);

const counter = previewsFor((await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' })).contract);
const where = (row) => row.trigger.text || row.trigger.lines.map((l) => `${l.node} ${l.predicates.join(', ')}`).join(' | ');

const SPIN_TSX = `export interface XProps {
  tone?: string;
}
export function X({ tone }: XProps) {
  return (<div className="ds-x" data-tone={tone}><span className="ds-x__spin" /></div>);
}`;
const SPIN_CSS = `
  .ds-x { background: var(--semantic-color-background-default); transition: background-color 120ms ease; }
  .ds-x[data-tone='a'] { background: var(--semantic-color-fill-a); }
  .ds-x[data-tone='b'] { background: var(--semantic-color-fill-b); }
  .ds-x[data-tone='c'] { background: var(--semantic-color-fill-c); }
  .ds-x__spin { border: 2px solid currentColor; border-right-color: transparent; animation: ds-spin 700ms linear infinite; }
  @keyframes ds-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .ds-x__spin { animation-duration: 2s; } }`;

/* ------------------------------------------------------------------ */

test('each row says what triggers a motion, what moves, how long, and what reduced motion does', () => {
  const rows = motionRows(counter, h);
  assert.equal(rows.length, 3);

  const [press, press2, pop] = rows;
  assert.equal(where(press), 'button pressed, not disabled');
  assert.equal(`${press.node} ${press.motion}`, 'icon scale 1 \u2192 0.9');
  assert.equal(press.timing[0].text, '100ms \u00b7 linear');
  assert.equal(press.reduced, 'instant');
  assert.equal(where(press2), 'button2 pressed, not disabled');

  // The pop is set by the component, so the row says what sets it, and when it returns.
  assert.equal(where(pop), 'value pop is set');
  assert.deepEqual(pop.trigger.why, ['set in setValue']);
  assert.equal(`${pop.node} ${pop.motion}`, 'value scale 1 \u2192 1.1');
  assert.equal(pop.then, 'back to rest after 100ms (POP_MS)');
});

test('a trigger says what the markup says sets it, and nothing it cannot read', () => {
  const [press] = motionRows(counter, h);
  // aria-disabled comes from a helper spread onto the button: said in terms of the attribute.
  assert.deepEqual(press.trigger.why, ['disabled is set by buttonProps(-step, atMin)']);
  // An interaction state needs no explanation: the platform tracks it. It comes first.
  assert.deepEqual(press.trigger.lines[0].predicates, ['pressed', 'not disabled']);
});

test('a loop is one row: it runs while it is active, and says what reduced motion slows it to', () => {
  const loop = motionRows(fromSource(SPIN_TSX, SPIN_CSS), h).find((r) => r.kind === 'loop');
  assert.equal(where(loop), 'while the node is rendered');
  assert.equal(`${loop.node} ${loop.motion}`, 'spin rotate 0\u00b0 \u2192 360\u00b0');
  assert.equal(loop.timing[0].text, '700ms \u00b7 linear \u00b7 repeats');
  assert.equal(loop.reduced, '2000ms');
});

test('a value that moves between several state values is one motion, not one row per value', () => {
  const colour = motionRows(fromSource(SPIN_TSX, SPIN_CSS), h).filter((r) => r.property === 'fill');
  assert.equal(colour.length, 1, 'three tones, one row');
  assert.equal(where(colour[0]), 'when its state changes');
  assert.equal(colour[0].motion, 'fill moves between its values (3)');
  assert.equal(colour[0].timing[0].text, '120ms \u00b7 ease');
  assert.equal(colour[0].reduced, 'not stated', 'and what is not stated is said');
});

test('timing is compared across platforms, so a difference is available to show', () => {
  assert.ok(motionRows(counter, h).every((r) => r.timing.every((t) => t.text === r.timing[0].text)), 'Counter is the same on both');

  const spring = (platform, response) => ({
    platform,
    artifact: { animations: [{ kind: 'transition', node: 'root', property: 'transform', rest: { value: { scale: 1 } },
      changes: [{ to: { scale: 0.9 }, when: [{ node: 'root', state: 'pressed' }] }],
      timing: { durationMs: 200, curve: { type: 'spring', response, dampingFraction: 0.8 } }, reducedMotion: { enabled: false } }] },
  });
  const [row] = motionRows([spring('ios', 0.3), spring('android', 0.4)], h);
  assert.deepEqual(row.timing, [
    { platform: 'ios', text: '200ms \u00b7 spring (response 0.3, damping 0.8)' },
    { platform: 'android', text: '200ms \u00b7 spring (response 0.4, damping 0.8)' },
  ]);
  assert.equal(row.reduced, 'off');
});

// What a hand-written contract produces: it names a state, not a node, and states reduced motion as a mode.
const handWritten = (reducedMotion) => [{ platform: 'ios', artifact: { animations: [{
  kind: 'transition', node: null, on: 'idle->pressed', property: 'transform', rest: { value: { scale: 1 } },
  changes: [{ when: [{ state: 'pressed' }], to: { scale: 0.95 } }],
  timing: { durationMs: 100, curve: { named: 'linear' } }, reducedMotion,
}] } }];

test('a hand-written contract states reduced motion as a mode, and the row says that mode', () => {
  const [row] = motionRows(handWritten({ mode: 'fade' }), h);
  assert.equal(row.reduced, 'fade');
  assert.equal(row.node, 'idle->pressed', 'it is named by the states it moves between');
  assert.equal(motionRows(handWritten(null), h)[0].reduced, 'not stated');
});

test('a trigger that names a state and no node says the state and invents no node', () => {
  const [row] = motionRows(handWritten({ mode: 'fade' }), h);
  assert.equal(row.trigger.lines.length, 1);
  assert.equal(row.trigger.lines[0].node, undefined);
  assert.deepEqual(row.trigger.lines[0].predicates, ['pressed']);
});

/* ------------------------------------------------------------------ *
 * Interaction: what the user can do, and who handles it
 * ------------------------------------------------------------------ */

test('each user action is attributed to the handler whose own text uses it, and nothing more', () => {
  const { handled, inline } = interactionRows(counter[0].artifact);
  const by = (name) => handled.find((r) => r.entry.name === name);

  assert.deepEqual(by('buttonProps').actions, ['press down', 'pointer leaves', 'click']);
  assert.deepEqual(by('useEffect#2').actions, ['release', 'touch cancelled']);
  assert.deepEqual(by('onKeyDown').actions, ['key press']);
  assert.deepEqual(by('setValue').actions, ['haptic feedback']);
  assert.deepEqual(by('onKeyDown').attached, ['value'], 'the key handler is attached to the value node');
  assert.deepEqual(by('buttonProps').attached, []);
  assert.deepEqual(inline, []);
  assert.equal(handled.length, 4, 'a handler that merely supports another is not listed');
  assert.deepEqual(by('buttonProps').entry.uses, ['focusSpin', 'nudge', 'startHold', 'stopHold']);
});

test('the amounts the author named come with the author’s own note and where they are used', () => {
  const rows = constantRows(counter[0].artifact);
  const hold = rows.find((r) => r.name === 'HOLD_INTERVAL_MS');
  assert.deepEqual({ value: hold.value, unit: hold.unit, note: hold.note, usedIn: hold.usedIn },
    { value: 150, unit: 'ms', note: 'Repeat interval while a button is held.', usedIn: ['startHold'] });
  assert.equal(rows.find((r) => r.name === 'HAPTIC_MS').note, 'Haptic pulse length on supporting devices.');
  assert.deepEqual(rows.find((r) => r.name === 'LARGE_STEP_FACTOR').usedIn, ['onKeyDown']);
  assert.equal(rows.find((r) => r.name === 'LARGE_STEP_FACTOR').unit, '', 'a multiplier is not a duration');
});

test('an event the markup attaches inline has no handler to open, so it says where it is', () => {
  const { handled, inline } = interactionRows({ logic: [], sourceEvents: [{ concept: 'event.click', names: ['onClick'], foundIn: ['node:root'] }] });
  assert.equal(handled.length, 0);
  assert.deepEqual(inline, [{ action: 'click', nodes: ['root'] }]);
});

test('a constant with no note says so, and a name with regex characters is still found', () => {
  const rows = constantRows({ sourceConstants: [{ name: 'A$B', value: 3 }, { name: 'PLAIN', value: 1, description: 'x' }], logic: [{ name: 'use', source: 'go(A$B); PLAINER();' }] });
  assert.deepEqual(rows[0].usedIn, ['use'], 'the dollar sign is matched literally');
  assert.equal(rows[0].note, null);
  assert.deepEqual(rows[1].usedIn, [], 'PLAIN is not found inside PLAINER');
});

test('the logic is pure: it must run in Node with no DOM', () => {
  const src = readFileSync(join(ROOT, 'src/ui/js/lib/motion.js'), 'utf8');
  assert.doesNotMatch(src, /\bdocument\b|\bwindow\b|\bfetch\(/);
});
