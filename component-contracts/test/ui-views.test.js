/**
 * The panes, drawn on Counter as the server hands it to the browser.
 *
 * Each assertion is about what a person reads or does: the words on the page, that a field edits the
 * right path, that source stays closed until it is opened, that every value on Props and Events is a chip.
 * A view is a pure function that returns markup, so this runs in Node with no browser. How it looks is not
 * tested here: that was measured in a browser (see CLAUDE.md), and the wiring is exercised by scripts/e2e.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { counterData, text, chipsIn, count } from './helpers/ui-data.js';
import { html, raw, esc } from '../src/ui/js/html.js';
import { overviewView } from '../src/ui/js/views/overview.js';
import { propsView } from '../src/ui/js/views/props.js';
import { eventsView } from '../src/ui/js/views/events.js';
import { appearanceView } from '../src/ui/js/views/appearance.js';
import { motionView } from '../src/ui/js/views/motion.js';
import { a11yView } from '../src/ui/js/views/a11y.js';
import { platformView } from '../src/ui/js/views/platform.js';
import { specsView } from '../src/ui/js/views/specs.js';
import { importReportView } from '../src/ui/js/views/import-report.js';
import { gapList } from '../src/ui/js/views/shared.js';

const D = await counterData();
const { contract, previews, tokens, tokenMap } = D;
const clone = (x) => structuredClone(x);
const rowsOf = (markup) => String(markup).match(/<tr>.*?<\/tr>/gs) || [];
const question = { code: 'props.variant', severity: 'warn', message: 'm', question: 'What is it?', path: 'props.variant' };

/* ------------------------------------------------------------------ *
 * what makes it safe to build markup from a contract's own text
 * ------------------------------------------------------------------ */

test('text from a contract can never become markup, in text or in an attribute', () => {
  const evil = '<img src=x onerror=alert(1)> "quoted" & \'single\'';
  const out = String(html`<p title="${evil}">${evil}</p>`);
  assert.ok(!out.includes('<img'), 'no element was made from the text');
  assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(out, /title="&lt;img src=x onerror=alert\(1\)&gt; &quot;quoted&quot; &amp; &#39;single&#39;"/);
  // The same through a real view: a hostile name does not escape the field it is in.
  const c = clone(contract);
  c.name = '"><script>alert(1)</script>';
  const view = String(overviewView({ contract: c, tokens, gaps: [] }));
  assert.ok(!view.includes('<script>'), 'the name did not become a script');
  assert.match(view, /value="&quot;&gt;&lt;script&gt;/);
});

test('markup that this code wrote passes through; arrays join; nothing, false and true vanish', () => {
  assert.equal(String(html`<b>${raw('<i>x</i>')}</b>`), '<b><i>x</i></b>');
  assert.equal(String(html`${[html`<a>1</a>`, html`<a>2</a>`]}`), '<a>1</a><a>2</a>');
  assert.equal(String(html`[${null}${undefined}${false}${true}]`), '[]');
  assert.equal(String(html`${0}`), '0', 'zero is a value, not an absence');
  assert.equal(esc('a&b'), 'a&amp;b');
  // A nested template is not escaped twice.
  assert.equal(String(html`<p>${html`<b>${'<'}</b>`}</p>`), '<p><b>&lt;</b></p>');
});

/* ------------------------------------------------------------------ *
 * Overview
 * ------------------------------------------------------------------ */

test('Overview: three fields, each editing its own path, and nothing else is editable', () => {
  const v = String(overviewView({ contract, tokens, gaps: [] }));
  assert.deepEqual([...v.matchAll(/data-edit="([^"]+)"/g)].map((m) => m[1]), ['name', 'description', 'contractVersion']);
  assert.equal(count(v, /<input|<textarea/g), 3, 'two inputs and one textarea');
  assert.match(v, new RegExp(`id="f-name"[^>]*value="${contract.name}"`));
  assert.match(v, /<label for="f-name">Name<\/label>/, 'a field is labelled');
});

test('Overview: says what the component is, with chips that read as separate words', () => {
  const page = text(overviewView({ contract, tokens, gaps: [] }));
  assert.ok(page.includes('0 variants × 0 sizes × 3 states'));
  assert.ok(page.includes(`${tokens.length} referenced · 0 with a known value`));
  assert.ok(page.includes('counter.contract.json'));
  // Adjacent chips must not run together when copied or read aloud.
  assert.ok(page.includes('iOS Android'));
  assert.ok(page.includes('idle focused pressed'));
  assert.ok(!page.includes('iOSAndroid'));
});

test('Overview: Delete is at the bottom, after everything else, and only when it is offered', () => {
  const without = String(overviewView({ contract, tokens, gaps: [] }));
  assert.ok(!without.includes('data-action="delete-open"'));
  const v = String(overviewView({ contract, tokens, gaps: [], canDelete: true }));
  const del = v.indexOf('data-action="delete-open"');
  assert.ok(del > v.indexOf('counter.contract.json'), 'it follows the last fact (Source)');
  assert.ok(del > v.indexOf('data-gaps'), 'and the open questions');
  assert.ok(!v.slice(del).includes('<div class="section"'), 'nothing is drawn after it but its own block');
  assert.match(v, /<button class="btn btn-destructive btn-sm" data-action="delete-open">Delete<\/button>/);
});

test('Overview: findings that point at it are shown with where they point', () => {
  const v = overviewView({ contract, tokens, gaps: [{ code: 'meta.description', severity: 'warn', message: 'm', question: 'What is it for?', path: 'description' }] });
  assert.ok(text(v).includes('What is it for?'));
  assert.ok(text(v).includes('description'));
});

/* ------------------------------------------------------------------ *
 * Props and Events: every value is a chip
 * ------------------------------------------------------------------ */

test('Props: lists the props with their kind, whether required, and default', () => {
  const page = text(propsView({ contract, gaps: [] }));
  assert.ok(page.includes('Other props'));
  assert.match(page, /defaultValue\s*number\s*default 0/);
  assert.match(page, /frozen\s*boolean\s*default false/);
  assert.ok(page.includes('Composition'));
});

test('Props: names a prop a platform does not carry, and why', () => {
  const c = clone(contract);
  c.props.className = { kind: 'string', platforms: { ios: { supported: false, note: 'a web styling hook' } } };
  assert.match(text(propsView({ contract: c, gaps: [] })), /not on iOS \u2014 a web styling hook/);
});

test('Props: kinds, defaults, renamed names and what a part is bound to are all chips', () => {
  const c = clone(contract);
  c.props.value.names = { ios: 'count', android: 'amount' };
  c.props.size = { kind: 'enum', axis: true, values: ['sm', 'md', 'lg'], default: 'md' };
  c.composition = { children: { icon: { contentType: 'icon', boundTo: 'iconName', visibleIn: ['large'] } } };
  const v = String(propsView({ contract: c, gaps: [question] }));
  assert.equal(count(v, /<code/g), 0, 'no filled code chip');
  assert.equal(count(v, /class="[^"]*\bmono\b/g), 0, 'no bare mono text');
  const all = chipsIn(v);
  for (const expected of ['number', 'boolean', 'string', '0', 'false', 'Quantity', 'count', 'amount', 'icon', 'iconName', 'props.variant']) {
    assert.ok(all.includes(expected), `${expected} is a chip`);
  }
  for (const state of ['idle', 'focused', 'pressed', 'sm', 'lg']) assert.ok(all.includes(state), state);
  assert.equal(all.filter((x) => x === 'md').length, 2, "'md' is both a value and the default, so it is two chips");
  // The platform a name belongs to is written as a person writes it.
  assert.match(text(v), /iOS: count/);
  assert.match(text(v), /Android: amount/);
  assert.doesNotMatch(text(v), /\bios:/);
});

test('Events: shows an event, says when nothing wires it, and does not invent events', () => {
  const v = text(eventsView({ contract, gaps: [] }));
  assert.ok(v.includes('onChange'));
  assert.ok(v.includes('not wired to any transition'));

  const c = clone(contract);
  c.props = Object.fromEntries(Object.entries(c.props).filter(([, d]) => d.kind !== 'event'));
  const none = text(eventsView({ contract: c, gaps: [] }));
  assert.ok(none.includes('No events were read from this component.'));
  assert.ok(none.includes('Nothing is inferred here'));
});

test('Events: payload, where it is inherited from, platform names and what fires it are all chips', () => {
  const c = clone(contract);
  c.props.onClick = { kind: 'event', payload: 'PointerEvent', inheritedFrom: 'button', names: { ios: 'action', android: 'onClick' } };
  c.behavior = { guards: {}, states: { idle: { on: { press: { target: 'pressed', actions: ['emit:onClick'] } } } } };
  const v = String(eventsView({ contract: c, gaps: [question] }));
  assert.equal(count(v, /<code/g), 0);
  assert.equal(count(v, /class="[^"]*\bmono\b/g), 0);
  const all = chipsIn(v);
  for (const expected of ['pressed', 'PointerEvent', 'button', 'action', 'onClick', 'press', 'idle', 'props.variant']) assert.ok(all.includes(expected), expected);
  assert.match(text(v), /iOS: action/);
  assert.match(text(v), /Android: onClick/);
  // Nothing to show is not a value: it is said as the empty style, not drawn as a chip.
  assert.match(v, /<span class="none">no payload<\/span>/, 'onChange has no payload');
  assert.ok(!all.includes('no payload'));
});

test('an open question says iOS, and leaves where it points exactly as it is', () => {
  const v = gapList([{ code: 'x', severity: 'warn', message: 'm', question: 'Is this prop carried on ios?', path: 'props.ios.supported' }]);
  assert.ok(text(v).includes('Is this prop carried on iOS?'));
  assert.ok(text(v).includes('props.ios.supported'));
  // The container is always drawn, so a page can refresh it in place; empty, it is hidden by CSS.
  assert.match(String(gapList([])), /<div class="gaps" data-gaps[^>]*><\/div>/);
});

/* ------------------------------------------------------------------ *
 * Appearance
 * ------------------------------------------------------------------ */

const appearance = (over = {}) =>
  appearanceView({ contract, previews, tokens, tokenMap, requiredSizeKeys: ['padX'], gaps: [], ...over });

test('Appearance: opens with the outline, a card for the component at rest and one for each layout that changes', () => {
  const v = String(appearance());
  assert.ok(text(v).includes('At rest'));
  assert.ok(text(v).includes('data-full-width = true'));
  assert.equal(count(v, /data-node="/g), 12, 'six nodes in each of two cards');
  assert.equal(count(v, /<span class="ol-key">/g), 5);
  assert.ok(text(v).includes('Schematic, not to scale'));
  assert.ok(text(v).includes('Resolved for iOS.'));
});

test('Appearance: says zero for what is not stated, and draws no band for a border of 0', () => {
  const v = String(appearance());
  assert.equal(count(v, /class="ol-border"/g), 2, 'the root, in each card; the buttons state 0');
  assert.match(v, /<span class="ol-pv ol-pt ol-unset"[^>]*>padding 0<\/span>/, 'the root states no padding, so it says zero, muted');
  assert.match(v, /<div class="ol-gap ol-gap-h ol-unset"[^>]*><span>0<\/span>/, 'and no gap, so the gap marker says zero too');
  assert.match(v, /<div class="ol-leaf ol-ext"[^>]*>RemoveSmallIcon<\/div>/);
});

test('Appearance: without specs there is nothing to draw, and it says so', () => {
  assert.ok(text(appearance({ previews: [] })).includes('Generate the platform specs to see the outline.'));
});

test('Appearance: applied tokens per variant and metrics per size are tables, with a state row for what a state changes', () => {
  const c = clone(contract);
  c.props.variant = { values: ['primary', 'ghost'] };
  c.props.size = { values: ['sm', 'lg'] };
  c.states = ['idle', 'pressed'];
  c.appearance.roles = ['fill', 'text'];
  c.appearance.byVariant = { primary: { default: { fill: '{semantic.color.fill}', text: '#fff' }, pressed: { fill: '{semantic.color.dark}' } }, ghost: { default: { fill: 'transparent' } } };
  c.appearance.bySize = { sm: { padX: { value: 8, unit: 'px' } }, lg: {} };
  const v = String(appearance({ contract: c, tokenMap: new Map([['semantic.color.fill', '#ff0000']]) }));
  assert.equal(count(v, /<table/g), 3, 'two variants and one metrics table');
  const rows = rowsOf(v).filter((r) => /<th scope="row">/.test(r)).map(text);
  assert.ok(rows.some((r) => r.startsWith('at rest') && r.includes('semantic color fill')));
  assert.ok(rows.some((r) => r.startsWith('pressed') && r.includes('semantic color dark')), 'a state that changes something has its own row');
  assert.ok(text(v).includes('Blank means the state inherits the resting value.'));
  // A token the contract gives a colour for is that colour; one it does not is a dashed swatch.
  assert.match(v, /style="background:#ff0000"/);
  assert.ok(v.includes('swatch swatch-unknown'));
  // A size metric written as a length is words, not "[object Object]".
  assert.ok(rows.some((r) => r.startsWith('sm') && r.includes('8 px')));
  assert.ok(!v.includes('[object Object]'));
});

/* ------------------------------------------------------------------ *
 * Motion & interaction
 * ------------------------------------------------------------------ */

const motion = (over = {}) => motionView({ previews, behavior: contract.behavior, gaps: [], ...over });

test('Motion: one table of motions: when, what moves, timing, reduced motion', () => {
  const v = String(motion());
  const table = rowsOf(v);
  assert.equal(text(table[0]), 'WhenWhat movesTimingReduced motion');
  assert.equal(text(table[1]), 'button pressed, not disableddisabled is set by buttonProps(-step, atMin)icon scale 1 → 0.9100ms · linearinstant');
  assert.equal(table.slice(1, 4).length, 3);
});

test('Motion: quoted source is closed until it is opened, and is the component’s own text', () => {
  const v = String(motion());
  assert.ok(count(v, /<details class="quote">/g) >= 1, 'each handler is a disclosure');
  assert.equal(count(v, /<details class="quote" open/g), 0, 'and none starts open');
  assert.match(v, /<summary>[^]*?useEffect#2/);
  assert.ok(text(v).includes("addEventListener('pointerup', stopHold)"), 'the source is there to open, exactly as written');
});

test('Motion: attributes each user action to the handler that uses the event, with the author’s own note', () => {
  const rows = rowsOf(motion()).map(text);
  const handler = (action) => rows.find((r) => r.startsWith(action));
  assert.ok(handler('press down, pointer leaves, click').includes('buttonProps'));
  assert.ok(handler('key press').includes('onKeyDown'));
  assert.ok(handler('key press').startsWith('key presson value'), 'the key handler says which node it is on');
  assert.deepEqual(rows.find((r) => r.startsWith('HOLD_INTERVAL_MS')), 'HOLD_INTERVAL_MS150 msRepeat interval while a button is held.startHold');
  assert.ok(text(motion()).includes('Haptic pulse length on supporting devices.'));
});

test('Motion: shows a hand-written state machine only when there is one', () => {
  assert.ok(!text(motion({ behavior: { states: {}, guards: {} } })).includes('State machine'));
  const withMachine = motion({ behavior: { guards: { g: 'it is allowed' }, states: { idle: { on: { press: { target: 'pressed', guard: 'g', actions: ['go'] } } } } } });
  assert.ok(text(withMachine).includes('State machine'));
  assert.ok(text(withMachine).includes('it is allowed'));
});

test('Motion: without specs it asks for them, and with nothing animating it says so', () => {
  assert.ok(text(motion({ previews: [], behavior: null })).includes('Generate the platform specs to see the motion.'));
  const still = previews.map((p) => ({ ...p, artifact: { ...p.artifact, animations: [] } }));
  assert.ok(text(motion({ previews: still, behavior: null })).includes('Nothing in this component animates.'));
});

test('Motion: a trigger with no node is just the state, with no empty code chip before it', () => {
  const legacy = { ...previews[0], artifact: { ...previews[0].artifact, animations: [{
    kind: 'transition', node: null, on: 'idle->pressed', property: 'transform', rest: { value: { scale: 1 } },
    changes: [{ when: [{ state: 'pressed' }], to: { scale: 0.95 } }],
    timing: { durationMs: 100, curve: { named: 'linear' } }, reducedMotion: { mode: 'fade' },
  }] } };
  const row = rowsOf(motionView({ previews: [legacy], behavior: null, gaps: [] }))[1];
  const cells = row.match(/<t[hd][^>]*>.*?<\/t[hd]>/gs);
  assert.equal(text(cells[0]), 'pressed');
  assert.ok(!/<code/.test(cells[0]), 'no empty chip before the state');
  assert.equal(text(cells[1]), 'idle->pressed scale 1 → 0.95');
  assert.equal(text(cells[3]), 'fade');
});

test('Motion: when the platforms time a motion differently, it says which is which, by name', () => {
  const spring = (response) => [{
    kind: 'transition', node: 'root', property: 'transform', rest: { value: { scale: 1 } },
    changes: [{ to: { scale: 0.9 }, when: [{ node: 'root', state: 'pressed' }] }],
    timing: { durationMs: 200, curve: { type: 'spring', response, dampingFraction: 0.8 } }, reducedMotion: { enabled: false },
  }];
  const differing = previews.map((x, i) => ({ ...x, artifact: { ...x.artifact, animations: spring(i ? 0.4 : 0.3) } }));
  const row = text(rowsOf(motionView({ previews: differing, behavior: null, gaps: [] }))[1]);
  assert.ok(row.includes('iOS: 200ms · spring (response 0.3, damping 0.8)'));
  assert.ok(row.includes('Android: 200ms · spring (response 0.4, damping 0.8)'));
});

/* ------------------------------------------------------------------ *
 * Accessibility, Left to platform, Specs, Import report
 * ------------------------------------------------------------------ */

test('Accessibility: shows each platform’s own primitive for a role, and what must be implemented', () => {
  const v = String(a11yView({ contract, previews, gaps: [] }));
  const page = text(v);
  for (const expected of ['Inside the tree', '.adjustable', 'must implement: increment, decrement', 'Touch target', '44pt', '48dp']) {
    assert.ok(page.includes(expected), expected);
  }
  // Columns are named as people write the platforms.
  assert.ok(count(v, /<th class="">iOS<\/th>/g) > 0);
  assert.ok(count(v, /<th class="">Android<\/th>/g) > 0);
  assert.equal(count(v, /<th class="">(ios|android)<\/th>/g), 0);
  assert.ok(text(a11yView({ contract, previews: [], gaps: [] })).includes('Generate the platform specs to see how this maps.'));
});

test('Left to platform: says nothing is delegated when nothing is, and labels what each platform may adapt by name', () => {
  assert.ok(text(platformView({ contract: { ...contract, adaptable: {} }, previews, gaps: [] })).includes('Nothing is delegated'));

  const c = clone(contract);
  c.adaptable = { ring: { intent: 'the focus ring', fallback: { style: 'solid' } } };
  const withEnvelope = previews.map((x) => ({ ...x, artifact: { ...x.artifact, adaptable: { ring: { envelope: { allowed: ['solid', 'glow'] } } } } }));
  const labels = [...String(platformView({ contract: c, previews: withEnvelope, gaps: [] })).matchAll(/<div class="fact-label">([^<]*)<\/div>/g)].map((m) => m[1]);
  assert.ok(labels.includes('iOS') && labels.includes('Android'));
  assert.ok(!labels.includes('ios'));
});

test('Left to platform: names the platforms a prop is not carried to', () => {
  const c = clone(contract);
  c.props.className = { kind: 'string', platforms: { ios: { supported: false, note: 'a web styling hook' }, android: { supported: false } } };
  const chips = chipsIn(platformView({ contract: c, previews, gaps: [] }));
  assert.ok(chips.includes('iOS') && chips.includes('Android'));
  assert.ok(!chips.includes('ios') && !chips.includes('android'));
});

test('Specs: each platform complete, with the files it writes, named as a person names it', () => {
  const v = String(specsView({ previews }));
  assert.equal(count(v, />complete</g), 2);
  assert.ok(text(v).includes('platform-specs/counter/ios.json'), 'a file path is data and keeps its lowercase');
  assert.match(v, /<h3 class="card-title">iOS<\/h3>/);
  assert.match(v, /<h3 class="card-title">Android<\/h3>/);
  assert.ok(text(specsView({ previews: [] })).includes('Resolving'));
});

test('Specs: says how many values are unresolved when a platform is not closed, and fixes the tool’s sentences but never a path or key', () => {
  const noisy = previews.map((x) => ({
    ...x,
    diagnostics: [{ level: 'warn', message: 'motion "x" dropped on ios (state not applicable)' }],
    closure: { closed: false, problems: ['platform-specs/counter/ios.json: adaptable.ring.platforms.ios is not set on ios'] },
  }));
  const v = String(specsView({ previews: noisy }));
  assert.ok(v.includes('incomplete'));
  assert.ok(text(v).includes('2 unresolved') || count(v, /<b>1 unresolved<\/b>/g) === 2);
  assert.equal(count(v, /motion &quot;x&quot; dropped on iOS \(state not applicable\)/g), 2, 'a sentence the tool wrote says iOS');
  assert.equal(count(v, /platform-specs\/counter\/ios\.json: adaptable\.ring\.platforms\.ios is not set on iOS/g), 2, 'a path and a dotted key stay exactly as they are');
});

test('Import report: says what an import read, kept and refused to guess', () => {
  const v = text(importReportView({
    report: { coverage: { derived: 3 }, sources: ['A.tsx', 'a.css'], derived: [{ path: 'props.size', evidence: 'type union' }], skipped: [{ what: 'font', why: 'no token' }], notes: ['a call'] },
    merge: { preserved: ['a'], updated: ['b: 1 → 2'], dropped: [] },
  }));
  for (const expected of ['3 values read', 'non-destructive', 'refused to guess', 'b: 1 → 2', 'A.tsx \u00b7 a.css', 'props.size', 'type union', 'no token', 'a call']) assert.ok(v.includes(expected), expected);
  assert.ok(!text(importReportView({ report: { coverage: { derived: 0 }, sources: [], derived: [], skipped: [], notes: [] }, merge: null })).includes('non-destructive'), 'a first import has nothing merged');
});
