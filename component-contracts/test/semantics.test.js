/**
 * The semantic layer: what a platform team builds from.
 *
 * Most of these use small synthetic components rather than the Counter fixture,
 * so each test states the one CSS fact it depends on and a wrong normalisation
 * cannot hide behind a component that happens to be right.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import { importFromSources, importFromPath, sourcesFromFiles } from '../src/core/import/index.js';
import { loadConfig, tokenIndexFor } from '../src/core/build.js';
import { resolve, checkClosed } from '../src/core/resolve.js';
import { emitPlatformJson } from '../src/core/emit/platform.js';
import { VISUAL_PROPERTY, SEMANTIC_FIELDS, SEMANTIC_VALUES, IDIOMS } from '../src/core/platform-map.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = await loadConfig(ROOT);

const TSX = (body = '') =>
  `export interface XProps { a?: string }\n` +
  `export function X(){ return (<div className="ds-x">${body}</div>); }`;

/** Import a synthetic component and resolve it for one platform. */
function build(tsx, css, platform = 'ios') {
  const { contract } = importFromSources({
    sources: sourcesFromFiles([{ name: 'X.tsx', content: tsx }, { name: 'x.css', content: css }]),
    id: 'x',
  });
  const { artifact } = resolve(contract, tokenIndexFor(contract, config), platform);
  return { contract, artifact, doc: JSON.parse(emitPlatformJson(artifact, { contract })) };
}
const node = (doc, name) => doc.nodes.find((n) => n.name === name);

/* ------------------------------------------------------------------ *
 * the mapping data is complete and self-consistent
 * ------------------------------------------------------------------ */

test('every CSS role the reader can produce has a place in the spec', () => {
  // A role with no entry would arrive as "unmapped" by omission, which is a
  // gap in the table rather than a property the component got wrong.
  const produced = new Set([
    ...Object.values(VISUAL_PROPERTY),
    'borderStyle', 'borderWidth', 'borderColor',
    'outlineStyle', 'outlineWidth', 'outlineColor',
    'padTop', 'padRight', 'padBottom', 'padLeft',
    'flexGrow', 'flexShrink', 'flexBasis',
    'transform', 'transitionEnabled', 'transitionDurationMs', 'animation', 'animationDurationMs',
    'typography',
  ]);
  const missing = [...produced].filter((role) => !(role in SEMANTIC_FIELDS));
  assert.deepEqual(missing, [], `these roles are read but not mapped: ${missing.join(', ')}`);
});

test('every value table a field names exists, and every table is used', () => {
  const named = new Set(Object.values(SEMANTIC_FIELDS).flatMap((f) => (f.values ? [f.values] : [])));
  for (const t of named) assert.ok(SEMANTIC_VALUES[t], `fields refer to a value table "${t}" that does not exist`);
  for (const t of Object.keys(SEMANTIC_VALUES)) assert.ok(named.has(t), `value table "${t}" is not used by any field`);
});

/**
 * A component that uses every layout, text, transform, animation and state
 * concept the semantic layer can name. Scanning the source for concept names
 * confused a concept with a comparison literal; running a real component
 * through the layer cannot.
 */
const KITCHEN_SINK = {
  tsx: `
    export interface XProps {
      a?: string;
    }
    export function X() {
      const go = () => { navigator.vibrate(8); };
      return (
        <div className="ds-x" aria-busy={a} aria-disabled={a}>
          <button className="ds-x__btn" aria-label="Go" onPointerDown={go} onPointerUp={go} onPointerCancel={go} onPointerLeave={go} onKeyDown={go} onClick={go}><Icon className="ds-x__icon" /></button>
          <div className="ds-x__val" role="spinbutton" aria-valuenow={a}>1</div>
          <span className="ds-x__label" />
          <span className="ds-x__spin" />
        </div>
      );
    }
  `,
  css: `
    .ds-x {
      display: flex; flex-direction: row; align-items: center; justify-content: center;
      gap: var(--semantic-spacing-4);
      width: 100px; height: var(--semantic-size-32); min-height: var(--semantic-size-48); aspect-ratio: 1;
      padding: var(--semantic-spacing-4);
      border: 1px solid var(--semantic-color-border-moderate); border-right-color: transparent;
      border-radius: var(--semantic-border-radius-8);
      background: var(--semantic-color-background-default);
      color: var(--semantic-color-text-primary);
      opacity: 0.9; overflow: hidden;
    }
    .ds-x__btn { position: relative; flex: 1 1 0; align-self: stretch; }
    .ds-x__btn[aria-disabled='true'] { color: var(--semantic-color-disabled-icon); }
    .ds-x__btn::after {
      content: ''; position: absolute; top: 50%; left: 50%; width: 100%; height: 100%;
      min-width: var(--semantic-size-48); min-height: var(--semantic-size-48);
      transform: translate(-50%, -50%);
    }
    .ds-x__btn[aria-disabled='true']::after { content: none; }
    .ds-x__btn:focus-visible {
      outline: 2px solid var(--semantic-color-border-brand); outline-offset: 2px;
    }
    .ds-x__icon { transition: transform 100ms linear; }
    .ds-x__btn:active:not([aria-disabled='true']) .ds-x__icon { transform: scale(0.9); }
    .ds-x__val {
      display: flex; flex-direction: column;
      font-family: var(--semantic-typography-label-font-family);
      font-size: var(--semantic-typography-label-font-size);
      font-weight: var(--semantic-typography-label-font-weight);
      line-height: var(--semantic-typography-label-line-height);
      letter-spacing: var(--semantic-typography-label-letter-spacing);
      font-variant-numeric: tabular-nums;
      transition: transform 80ms ease;
    }
    .ds-x__val:active { transform: translateY(4px) rotate(5deg); }
    .ds-x__label { white-space: nowrap; text-overflow: ellipsis; text-align: center; }
    .ds-x__spin { animation: ds-spin 700ms linear infinite; }
    @keyframes ds-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .ds-x__icon, .ds-x__val { transition-duration: 0.01ms; }
      .ds-x__spin { animation-duration: 2s; }
    }
  `,
};

test('the concept vocabulary and the idiom table agree in both directions', () => {
  const frameworks = { ios: 'swiftui', android: 'compose' };
  const used = new Set();

  for (const platform of ['ios', 'android']) {
    const { contract, artifact } = build(KITCHEN_SINK.tsx, KITCHEN_SINK.css, platform);
    const hints = JSON.parse(emitPlatformJson(artifact, { contract, frameworks })).implementationHints;

    // Forward: nothing the layer can name is missing an idiom.
    assert.equal(hints.without, undefined, `${platform}: concepts with no idiom: ${hints.without}`);
    for (const id of Object.keys(hints.concepts)) {
      used.add(id);
      assert.ok(hints.concepts[id].idiom.trim(), `${id} has an empty idiom`);
    }
  }

  // Both frameworks are authored for every concept, so switching the framework
  // a platform builds in never leaves a hole.
  for (const [id, entry] of Object.entries(IDIOMS.concepts)) {
    for (const fw of ['swiftui', 'compose']) assert.ok(entry[fw]?.trim(), `"${id}" has no ${fw} idiom`);
  }

  // Backward: an idiom nothing can produce is dead weight that looks authoritative.
  // Accessibility roles are exempt, since which ones appear depends on the component.
  const dead = Object.keys(IDIOMS.concepts).filter((id) => !id.startsWith('a11y.') && !used.has(id));
  assert.deepEqual(dead, [], `idioms no concept can reach: ${dead.join(', ')}`);
});

test('accessibility concepts the mapping can emit each have an idiom, or are listed as missing', async () => {
  // Not every ARIA role is used by every component, so this does not demand all
  // of them; it demands that the ones Counter uses are covered.
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  const { artifact } = resolve(contract, tokenIndexFor(contract, config), 'ios');
  const out = JSON.parse(emitPlatformJson(artifact, { contract, frameworks: { ios: 'swiftui' } }));
  assert.equal(out.implementationHints.without, undefined, `uncovered: ${out.implementationHints.without}`);
});

/* ------------------------------------------------------------------ *
 * layout is stated relative to the parent's axis
 * ------------------------------------------------------------------ */

test('align-self and flex mean different things on different axes, so the parent axis is applied', () => {
  const { doc } = build(
    TSX('<span className="ds-x__a" /><span className="ds-x__b" />'),
    `.ds-x { display: flex; flex-direction: column; width: 200px; }
     .ds-x__a { align-self: stretch; }
     .ds-x__b { flex: 1 1 0; align-self: center; }`,
  );
  assert.equal(node(doc, 'root').layout.container.axis, 'vertical');

  // In a column the cross axis is horizontal: stretch fills the WIDTH, and the
  // height (main axis) only hugs its content.
  const a = node(doc, 'a').layout.size;
  assert.deepEqual(a.width, { mode: 'fill' });
  assert.deepEqual(a.height, { mode: 'hug' });

  // flex grows along the HEIGHT here; centred, it hugs its width.
  const b = node(doc, 'b').layout.size;
  assert.deepEqual(b.height, { mode: 'flex', grow: 1, shrink: 1, basis: 0 });
  assert.deepEqual(b.width, { mode: 'hug' });
});

test('an unset align-items is CSS\u2019s own default, stretch', () => {
  const { doc } = build(
    TSX('<span className="ds-x__a" />'),
    `.ds-x { display: flex; } .ds-x__a { color: var(--semantic-color-text-primary); }`,
  );
  assert.equal(node(doc, 'root').layout.container.crossAlign, undefined, 'nothing was stated, so nothing is claimed on the container');
  assert.deepEqual(node(doc, 'a').layout.size.height, { mode: 'fill' });
});

test('a length in px becomes the platform\u2019s own unit, and stays that on its platform', () => {
  const css = `.ds-x { width: 200px; }`;
  assert.deepEqual(node(build(TSX(), css, 'ios').doc, 'root').layout.size.width, { mode: 'fixed', value: { value: 200, unit: 'pt' } });
  assert.deepEqual(node(build(TSX(), css, 'android').doc, 'root').layout.size.width, { mode: 'fixed', value: { value: 200, unit: 'dp' } });
});

test('one side of a border can differ, which is how a spinner arc is drawn', () => {
  // `border-right-color: transparent` was dropped silently, so the spinner
  // rendered as a closed ring.
  const { doc } = build(
    TSX('<span className="ds-x__spin" />'),
    `.ds-x__spin { border: 2px solid currentColor; border-right-color: transparent; }`,
  );
  const b = node(doc, 'spin').appearance.border;
  assert.equal(b.style, 'solid');
  assert.equal(b.color, 'currentColor');
  assert.equal(b.right.color, 'transparent');
});

test('text that must stay on one line and truncate is stated as such', () => {
  const { doc } = build(
    TSX('<span className="ds-x__t" />'),
    `.ds-x__t { white-space: nowrap; text-overflow: ellipsis; overflow: hidden; text-align: center; }`,
  );
  const t = node(doc, 't').appearance;
  assert.equal(t.text.wrap, 'none');
  assert.equal(t.text.overflow, 'ellipsis');
  assert.equal(t.text.align, 'center');
  assert.equal(t.clip, true);
});

/* ------------------------------------------------------------------ *
 * animations always say what they go to
 * ------------------------------------------------------------------ */

test('a transition of transform with nothing that sets a transform is not emitted', () => {
  // This is the iOS team's gap: "transform" with no target left them to guess
  // a slide-and-fade. It must not exist, and the reason must be visible.
  const { doc } = build(TSX(), `.ds-x { transition: transform 100ms linear; }`);
  assert.deepEqual(doc.animations, []);
  assert.match(doc.implementationNotes.join('\n'), /nothing to animate to/);
});

test('every transform animation names an explicit function and an explicit target', () => {
  for (const css of [
    `.ds-x { transition: transform 80ms ease; } .ds-x:active { transform: scale(0.95); }`,
    `.ds-x { transition: transform 80ms ease; } .ds-x:active { transform: translateY(4px); }`,
    `.ds-x { transition: transform 80ms ease; } .ds-x:active { transform: rotate(10deg); }`,
  ]) {
    const { doc } = build(TSX(), css);
    const a = doc.animations[0];
    assert.ok(a, css);
    assert.equal(a.property, 'transform');
    assert.ok(Object.keys(a.changes[0].to).length, 'a target with no function would be a bare "transform"');
    assert.ok(Object.keys(a.rest.value).length, 'and the rest value is the matching identity');
  }
});

test('the rest value is the identity of exactly the functions that change', () => {
  const { doc } = build(TSX(), `.ds-x { transition: transform 80ms ease; } .ds-x:active { transform: scale(0.9) rotate(5deg); }`);
  assert.deepEqual(doc.animations[0].rest.value, { scale: 1, rotateDeg: 0 });
  assert.deepEqual(doc.animations[0].changes[0].to.order, ['scale', 'rotate']);
});

test('a transform the reader cannot represent is flagged, never approximated', () => {
  const { doc } = build(TSX(), `.ds-x { transition: transform 80ms ease; } .ds-x:active { transform: matrix(1, 0, 0, 1, 5, 5); }`);
  assert.deepEqual(doc.animations, []);
  assert.match(doc.implementationNotes.join('\n'), /Manual translation required for transform: matrix/);
});

test('a missing timing function is CSS\u2019s default, and says it was implied', () => {
  const { doc } = build(TSX(), `.ds-x { transition: transform 100ms; } .ds-x:active { transform: scale(0.9); }`);
  assert.equal(doc.animations[0].timing.curve.named, 'ease');
  assert.match(doc.animations[0].timing.curve.implied, /CSS default/);
});

test('a loop reads its keyframes, an implied start, and what reduced motion really does', () => {
  const { doc } = build(
    TSX('<span className="ds-x__spin" />'),
    `.ds-x__spin { animation: ds-spin 700ms linear infinite; }
     @media (prefers-reduced-motion: reduce) { .ds-x__spin { animation-duration: 2s; } }
     @keyframes ds-spin { to { transform: rotate(360deg); } }`,
  );
  const loop = doc.animations.find((a) => a.kind === 'loop');
  assert.equal(loop.node, 'spin');
  assert.deepEqual(loop.keyframes.map((k) => k.offset), [0, 1]);
  assert.match(loop.keyframes[0].implied, /identity/);
  assert.deepEqual(loop.keyframes[0].value, { rotateDeg: 0 });
  assert.deepEqual(loop.keyframes[1].value, { rotateDeg: 360 });
  assert.equal(loop.timing.durationMs, 700);
  assert.equal(loop.timing.iterations, 'infinite');
  assert.equal(loop.reducedMotion.durationMs, 2000, 'it slows; it does not fade');
});

test('keyframes with several stops, and animation: none under reduced motion', () => {
  const { doc } = build(
    TSX('<span className="ds-x__spin" />'),
    `.ds-x__spin { animation: wob 1s ease-in-out infinite; }
     @media (prefers-reduced-motion: reduce) { .ds-x__spin { animation: none; } }
     @keyframes wob { 0% { transform: rotate(0deg); } 50% { transform: rotate(180deg); } 100% { transform: rotate(360deg); } }`,
  );
  const loop = doc.animations[0];
  assert.deepEqual(loop.keyframes.map((k) => [k.offset, k.value.rotateDeg]), [[0, 0], [0.5, 180], [1, 360]]);
  assert.equal(loop.keyframes[0].implied, undefined, 'an explicit 0% frame is not implied');
  assert.equal(loop.timing.curve.named, 'easeInOut');
  assert.deepEqual(loop.reducedMotion.enabled, false);
});

test('a loop with no reduced-motion rule leaves it unstated and the gap visible', () => {
  const { artifact } = build(
    TSX('<span className="ds-x__spin" />'),
    `.ds-x__spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`,
  );
  assert.equal(artifact.animations[0].reducedMotion, null);
  assert.ok(checkClosed(artifact).problems.some((p) => /reduced-motion/.test(p)));
});

/* ------------------------------------------------------------------ *
 * nothing disappears silently
 * ------------------------------------------------------------------ */

test('a rule whose class no node carries is reported as unplaced, not lost', () => {
  // Measuring coverage after matching made exactly this invisible.
  const { doc } = build(TSX(), `.ds-x { color: var(--semantic-color-text-primary); } .ds-x__ghost { color: var(--semantic-color-text-primary); }`);
  assert.equal(doc.coverage.sourceRules, 2);
  assert.equal(doc.coverage.unplaced.length, 1);
  assert.match(doc.coverage.unplaced[0].why, /no node in the markup carries \.ds-x__ghost/);
});

test('hover is dropped on a touch platform by design, and recorded as such', () => {
  const css = `.ds-x { color: var(--semantic-color-text-primary); } .ds-x:hover { color: var(--semantic-color-text-hover); }`;
  const ios = build(TSX(), css, 'ios').doc;
  assert.deepEqual(ios.coverage.droppedByDesign.map((d) => d.selector), ['.ds-x:hover']);
  assert.deepEqual(ios.coverage.unplaced, []);
});

test('an unrecognised CSS property is named, so nobody assumes it was applied', () => {
  const { doc } = build(TSX(), `.ds-x { margin: 4px; display: grid; }`);
  assert.deepEqual(doc.droppedProperties.unrecognised, ['margin']);
  assert.match(doc.implementationNotes.join('\n'), /Unrecognised CSS properties.*margin/);
  // A value the table does not map is kept, not forced into the nearest concept.
  assert.deepEqual(node(doc, 'root').unmapped, [{ role: 'display', value: 'grid' }]);
});

test('a state that must not hold is a condition, not a lost rule', () => {
  const { doc } = build(TSX(), `.ds-x:not(:disabled):active { color: var(--semantic-color-text-primary); }`);
  const c = node(doc, 'root').conditional[0];
  assert.deepEqual(c.when.map((w) => [w.state, !!w.negate]), [['disabled', true], ['pressed', false]]);
  assert.deepEqual(doc.coverage.unplaced, []);
});

test('a cva() base class puts the root in reach of its own rules', () => {
  const { doc } = build(
    `import { cva } from 'class-variance-authority';
     const button = cva('ds-x', { variants: { a: { b: 'ds-x--b' } } });
     export interface XProps { a?: string }
     export function X(){ return (<div className={button({ a: 'b' })} />); }`,
    `.ds-x { color: var(--semantic-color-text-primary); }`,
  );
  assert.equal(node(doc, 'root').appearance.foreground, '{semantic.color.text.primary}');
  assert.deepEqual(doc.coverage.unplaced, []);
});

/* ------------------------------------------------------------------ *
 * what the source says about itself reaches the spec
 * ------------------------------------------------------------------ */

test('prop docs, state docs and named constants arrive in the file, verbatim', () => {
  const { doc } = build(
    `/** How long the value stays scaled up after a change. */
     const POP_MS = 100;
     export interface XProps {
       /** Visible text. Omit only when icon-only. */
       label?: string;
       /** Shows a spinner and blocks interaction. */
       loading?: boolean;
     }
     export function X(){ return (<div className="ds-x" />); }`,
    `.ds-x { color: var(--semantic-color-text-primary); }`,
  );
  assert.equal(doc.props.find((p) => p.name === 'label').description, 'Visible text. Omit only when icon-only.');
  assert.deepEqual(doc.stateDocs, { loading: 'Shows a spinner and blocks interaction.' });
  assert.deepEqual(doc.sourceConstants, [{
    name: 'POP_MS', kind: 'number', value: 100,
    description: 'How long the value stays scaled up after a change.',
    source: 'const POP_MS = 100;',
  }]);
});

test('a data attribute names the prop that drives it', () => {
  const { doc } = build(
    `export interface XProps {
       dense?: boolean;
     }
     export function X({ dense }: XProps){ return (<div className="ds-x" data-dense={dense} />); }`,
    `.ds-x[data-dense='true'] { color: var(--semantic-color-text-primary); }`,
  );
  assert.deepEqual(node(doc, 'root').conditional[0].when[0].driver, { prop: 'dense' });
  assert.deepEqual(doc.unresolvedConditions, []);
});

test('an attribute set by a spread is reported as unresolved, never guessed', () => {
  const { doc } = build(
    `export interface XProps { a?: string }
     export function X(props: XProps){ return (<div className="ds-x" {...props} />); }`,
    `.ds-x[aria-disabled='true'] { color: var(--semantic-color-text-primary); }`,
  );
  assert.equal(doc.unresolvedConditions[0].attribute, 'aria-disabled');
  assert.equal(node(doc, 'root').conditional[0].when[0].driver, null);
});

/* ------------------------------------------------------------------ *
 * both platforms, and the framework block
 * ------------------------------------------------------------------ */

test('what the component states is identical on both platforms; only the translation differs', async () => {
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  const [ios, android] = ['ios', 'android'].map((p) =>
    JSON.parse(emitPlatformJson(resolve(contract, tokenIndexFor(contract, config), p).artifact, { contract })));

  const strip = (nodes) => nodes.map(({ accessibility: _a, ...rest }) => rest);
  assert.deepEqual(strip(ios.nodes), strip(android.nodes), 'layout and appearance are what the component states');
  assert.deepEqual(ios.animations, android.animations);
  assert.deepEqual(ios.hitAreas, android.hitAreas);
  assert.deepEqual(ios.focusRings, android.focusRings);
  assert.deepEqual(ios.coverage, android.coverage);

  // ...and the translation is what differs.
  assert.notEqual(ios.accessibility.touchTarget.platformGuidance.unit, android.accessibility.touchTarget.platformGuidance.unit);
});

test('the touch target is one statement: what the component asks for, what the platform recommends, and which to build to', async () => {
  // Two sections used to give 44 (guidance) and a 48 token (the component), and
  // a reader could not tell which was the number.
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  const docFor = (p) => JSON.parse(emitPlatformJson(resolve(contract, tokenIndexFor(contract, config), p).artifact, { contract }));

  const ios = docFor('ios').accessibility;
  assert.deepEqual(ios.touchTarget, {
    stated: '{semantic.size.48}',
    platformGuidance: { value: 44, unit: 'pt' },
    buildTo: 'stated',
  });
  assert.deepEqual(docFor('android').accessibility.touchTarget.platformGuidance, { value: 48, unit: 'dp' });

  // The four overlapping fields are gone, and the conformance says the same thing.
  for (const gone of ['minTarget', 'minTargetUnit', 'minTargetSource', 'minTargetToken']) {
    assert.equal(ios[gone], undefined, `${gone} still disagrees with touchTarget`);
  }
  const rule = docFor('ios').conformance.find((c) => c.id === 'a11y.minTarget');
  assert.equal(rule.params.expect, '{semantic.size.48}');
  assert.equal(rule.params.platformGuidance, '44pt');
});

test('a component that states no touch target is built to the platform guidance, and says so', () => {
  const { doc } = build(TSX('<button className="ds-x__b" />'), `.ds-x { color: var(--semantic-color-text-primary); }`);
  assert.equal(doc.accessibility.touchTarget.stated, null);
  assert.equal(doc.accessibility.touchTarget.buildTo, 'platformGuidance');
});

test('framework idioms appear only when asked for, and only for that platform', async () => {
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  const artifactFor = (p) => resolve(contract, tokenIndexFor(contract, config), p).artifact;

  const none = JSON.parse(emitPlatformJson(artifactFor('ios'), { contract }));
  assert.equal(none.implementationHints, undefined, 'unset means framework-agnostic');

  const frameworks = { ios: 'swiftui', android: 'compose' };
  const ios = JSON.parse(emitPlatformJson(artifactFor('ios'), { contract, frameworks }));
  const android = JSON.parse(emitPlatformJson(artifactFor('android'), { contract, frameworks }));
  assert.equal(ios.implementationHints.framework, 'swiftui');
  assert.equal(android.implementationHints.framework, 'compose');
  assert.match(ios.implementationHints.concepts['container.stack.horizontal'].idiom, /^HStack/);
  assert.match(android.implementationHints.concepts['container.stack.horizontal'].idiom, /^Row/);
  assert.match(ios.implementationHints.concepts['transform.scale'].idiom, /scaleEffect/);
  assert.match(android.implementationHints.concepts['transform.scale'].idiom, /graphicsLayer/);

  // One platform opted in does not give the other one hints.
  const onlyIos = JSON.parse(emitPlatformJson(artifactFor('android'), { contract, frameworks: { ios: 'swiftui' } }));
  assert.equal(onlyIos.implementationHints, undefined);
});

test('framework names stay inside the advisory block and nowhere else', async () => {
  // The data is what the team builds from, and it names no framework. The hints
  // may, because they are labelled advisory and can be switched off.
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  const BANNED = ['SwiftUI', 'Compose', 'HStack', 'Row(', 'scaleEffect', 'graphicsLayer', 'LocalContentColor', 'CGFloat', 'androidx'];

  for (const platform of ['ios', 'android']) {
    const { artifact } = resolve(contract, tokenIndexFor(contract, config), platform);
    const doc = JSON.parse(emitPlatformJson(artifact, { contract, frameworks: { ios: 'swiftui', android: 'compose' } }));
    const { implementationHints, ...data } = doc;
    assert.ok(implementationHints, 'the block is present when asked for');
    const text = JSON.stringify(data);
    for (const word of BANNED) assert.ok(!text.includes(word), `${platform} data mentions "${word}" outside implementationHints`);
  }
});

test('the guide tells a reader how to build from the file', async () => {
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  const doc = JSON.parse(emitPlatformJson(resolve(contract, tokenIndexFor(contract, config), 'ios').artifact, { contract }));
  assert.ok(doc.guide.buildFrom.every((k) => k in doc), 'every section the guide names exists');
  assert.ok(doc.evidence.visualRules.length, 'the raw rules are kept under evidence');
  for (const gone of ['tree', 'nodeStyles', 'accessibilityNodes', 'motion', 'loops', 'visualRules', 'interactionBindings']) {
    assert.equal(doc[gone], undefined, `"${gone}" was folded into nodes, animations or evidence`);
  }
});

/* ------------------------------------------------------------------ *
 * a node that is not always there says so
 * ------------------------------------------------------------------ */

test('an element behind a condition is marked, without claiming to know the condition', () => {
  // The tree used to list a Button's spinner, icons and label as always present,
  // so a team would build all four. The condition is source logic and is not
  // extracted; the spec must say THAT it exists.
  const { doc } = build(
    TSX('{a ? (<span className="ds-x__spin" />) : null}{a && <span className="ds-x__b" />}<span className="ds-x__c" />'),
    `.ds-x { color: var(--semantic-color-text-primary); }`,
  );
  assert.deepEqual(doc.conditionallyRendered.nodes.sort(), ['b', 'spin']);
  assert.equal(node(doc, 'spin').renderedConditionally, true);
  assert.equal(node(doc, 'b').renderedConditionally, true);
  assert.equal(node(doc, 'c').renderedConditionally, undefined, 'an unconditional sibling is not flagged');
  assert.match(doc.conditionallyRendered.why, /not extracted/);
});

test('the else-branch of a parenthesised ternary is conditional too', () => {
  const { doc } = build(
    TSX('{a ? (<span className="ds-x__one" />) : (<span className="ds-x__two" />)}'),
    `.ds-x { color: var(--semantic-color-text-primary); }`,
  );
  assert.deepEqual(doc.conditionallyRendered.nodes.sort(), ['one', 'two']);
});

test('a component with an unconditional tree reports nothing conditional', async () => {
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  const doc = JSON.parse(emitPlatformJson(resolve(contract, tokenIndexFor(contract, config), 'ios').artifact, { contract }));
  assert.equal(doc.conditionallyRendered, undefined);
});

test('the raw base rules are not repeated in evidence when visualRules already hold them', async () => {
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  const doc = JSON.parse(emitPlatformJson(resolve(contract, tokenIndexFor(contract, config), 'ios').artifact, { contract }));
  assert.ok(doc.evidence.visualRules.length);
  assert.equal(doc.evidence.nodeStyles, undefined);
});

/* ------------------------------------------------------------------ *
 * a rule shared by several nodes reaches every one of them
 * ------------------------------------------------------------------ */

test('nodes that share a class carry the same conditions, not just the first of them', () => {
  // Both buttons of a stepper share one class. A rule was marked "placed" by
  // its order alone, so the first button took it and the second got nothing:
  // the increment button would never have greyed out at its maximum.
  const { doc } = build(
    TSX('<button className="ds-x__btn"><i className="ds-x__ico" /></button><button className="ds-x__btn"><i className="ds-x__ico" /></button>'),
    `.ds-x__btn { color: var(--semantic-color-text-primary); }
     .ds-x__btn[aria-disabled='true'] { color: var(--semantic-color-disabled-icon); }
     .ds-x__btn:active .ds-x__ico { transform: scale(0.9); }
     .ds-x__ico { transition: transform 100ms linear; }`,
  );
  const summary = (n) => JSON.stringify(n.conditional.map((c) => [c.when.map((w) => w.state || w.attribute), c.appearance]));
  assert.equal(summary(node(doc, 'btn')), summary(node(doc, 'btn2')));
  assert.equal(summary(node(doc, 'ico')), summary(node(doc, 'ico2')));
  assert.ok(node(doc, 'btn2').conditional.length, 'the second button must not be empty');
  assert.equal(doc.animations.filter((a) => a.property === 'transform').length, 2, 'and each icon animates');
});

test('every conditional rule instance in the evidence is on the node it targets', async () => {
  // The general statement of the bug above, checked over a real component: for
  // each resolved rule with conditions that is not a focus ring or a hit area,
  // its node must carry an entry for it.
  for (const platform of ['ios', 'android']) {
    const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
    const doc = JSON.parse(emitPlatformJson(resolve(contract, tokenIndexFor(contract, config), platform).artifact, { contract }));

    let checked = 0;
    for (const r of doc.evidence.visualRules) {
      if (r.pseudoElement || r.media.length || r.manualTranslation || !r.conditions.length) continue;
      if (!Object.keys(r.properties).some((k) => SEMANTIC_FIELDS[k]?.to)) continue; // outline, transition: not a visual change
      if (doc.focusRings.some((f) => f.node === r.node && f.source === r.source)) continue;

      checked++;
      assert.ok(node(doc, r.node).conditional.some((c) => c.order === r.order), `${platform}: ${r.node} lost "${r.source}"`);
    }
    assert.ok(checked >= 5, `only ${checked} rules were checked; the invariant is not being exercised`);
  }
});

/* ------------------------------------------------------------------ *
 * what a node announces, what is defined elsewhere, what a token is for
 * ------------------------------------------------------------------ */

test('an announced state says WHEN it is announced, and only a plain prop is claimed as a prop', () => {
  // `frozen` made the value read-only, but the tree only recorded "readonly:
  // true", so a team could not tell what triggered it.
  const { doc } = build(
    `export interface XProps {
       frozen?: boolean;
     }
     export function X({ frozen, enabled }: XProps){
       return (<div className="ds-x" role="group" aria-readonly={frozen || undefined} aria-busy={loading || undefined} aria-disabled={!enabled}>
                 <span className="ds-x__v" aria-selected="true" />
               </div>);
     }`,
    `.ds-x { color: var(--semantic-color-text-primary); }`,
  );
  const states = Object.fromEntries(node(doc, 'root').accessibility.states.map((s) => [s.state, s.when]));
  assert.deepEqual(states.readonly, { prop: 'frozen' });
  assert.deepEqual(states.busy, { expression: 'loading || undefined' }, 'loading is not a declared prop, so it is not claimed as one');
  assert.deepEqual(states.disabled, { expression: '!enabled' }, 'a negation is not the prop');
  assert.deepEqual(node(doc, 'v').accessibility.states[0].when, { literal: 'true' });
});

test('a state with no platform equivalent is flagged rather than dropped', () => {
  const { doc } = build(
    `export interface XProps {
       a?: string;
     }
     export function X(){ return (<div className="ds-x" aria-expanded={a} />); }`,
    `.ds-x { color: var(--semantic-color-text-primary); }`,
  );
  const s = node(doc, 'root').accessibility.states[0];
  assert.equal(s.state, 'expanded');
  assert.ok(s.kind, 'expanded has a mapping on both platforms');
});

test('components defined elsewhere are listed, so nobody invents their size or glyph', async () => {
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  const doc = JSON.parse(emitPlatformJson(resolve(contract, tokenIndexFor(contract, config), 'ios').artifact, { contract }));
  assert.deepEqual(doc.externalComponents.nodes.map((n) => n.component).sort(), ['AddSmallIcon', 'RemoveSmallIcon']);
  assert.match(doc.externalComponents.why, /defined elsewhere/);

  const { doc: plain } = build(TSX(), `.ds-x { color: var(--semantic-color-text-primary); }`);
  assert.equal(plain.externalComponents, undefined, 'nothing external, nothing listed');
});

test('a token says what it is used as, from where it sits and not from its name', async () => {
  // "dimension" cannot tell a font size from a gap or a corner radius.
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  const { tokens } = JSON.parse(emitPlatformJson(resolve(contract, tokenIndexFor(contract, config), 'android').artifact, { contract }));

  // Text is one token, as colour is: the composite is listed, and the five it stands for are not.
  assert.deepEqual(tokens['semantic.typography.label.l'].usedAs, ['typography']);
  assert.deepEqual(tokens['semantic.size.48'].usedAs, ['hitArea.min.height', 'hitArea.min.width']);
  assert.deepEqual(tokens['semantic.spacing.0'].usedAs, ['padding.bottom', 'padding.left', 'padding.right', 'padding.top']);
  // One token in two roles carries both.
  assert.deepEqual(tokens['semantic.border.width.default'].usedAs, ['border.width', 'focusRing.offset', 'focusRing.width']);

  for (const [path, t] of Object.entries(tokens)) assert.ok(t.usedAs?.length, `${path} is declared but used as nothing`);
});

test('a spec with no logic the markup depends on has no behaviorSource at all', () => {
  const { doc } = build(TSX(), `.ds-x { color: var(--semantic-color-text-primary); }`);
  assert.equal(doc.behaviorSource, undefined);
});

test('the framework traps the reviewers hit stay documented in the idioms', () => {
  // Each of these produces a result that looks right and is subtly wrong.
  // The neutral note and the framework's own, as the emitter joins them for that file.
  const note = (id, framework) => [IDIOMS.concepts[id].note, IDIOMS.concepts[id].notes?.[framework]].filter(Boolean).join(' ');
  assert.match(note('container.stack.horizontal', 'swiftui'), /spacing: 0/);
  assert.match(note('container.stack.vertical', 'swiftui'), /spacing: 0/);
  assert.match(note('border.inside', 'compose'), /inset the content/);
  assert.match(note('state.pressed', 'compose'), /indication = null/);
  assert.match(note('animation.reducedMotion', 'compose'), /snap\(\)/);
  assert.match(note('text.font', 'swiftui'), /scale/);
  assert.match(note('hitArea', 'compose'), /layout/);
});

/* ------------------------------------------------------------------ *
 * where a markup value comes from
 * ------------------------------------------------------------------ */

const RANGE_TSX = `
  export interface XProps {
    value?: number;
    min?: number;
    max?: number;
    label?: string;
    labelledBy?: string;
    describedBy?: string;
    frozen?: boolean;
    format?: (n: number) => string;
  }
  export function X({ value: controlled, min = 0, max = 10, label, labelledBy, describedBy, frozen, format }: XProps) {
    const clamp = (n: number) => Math.min(max, Math.max(min, n));
    const value = clamp(controlled ?? 0);
    return (
      <div className="ds-x" role="spinbutton"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-readonly={frozen || undefined}
        aria-valuenow={value} aria-valuemin={min} aria-valuemax={max}
        aria-valuetext={format?.(value)}>{value}</div>
    );
  }`;
const RANGE_CSS = `.ds-x { color: var(--semantic-color-text-primary); }`;

test('an expression is not a prop because it starts with one', () => {
  // `labelledBy ? undefined : label` was read as the labelledBy prop, and
  // `format?.(value)` as the format prop itself.
  const { contract } = importFromSources({
    sources: sourcesFromFiles([{ name: 'X.tsx', content: RANGE_TSX }, { name: 'x.css', content: RANGE_CSS }]),
    id: 'x',
  });
  const a11y = contract.composition.tree.a11y;
  assert.equal(a11y.label, 'expr:labelledBy ? undefined : label');
  assert.equal(a11y.value.text, 'expr:format?.(value)');
  // A bare name that IS a prop still is one.
  assert.equal(a11y.labelledBy, 'prop:labelledBy');
  assert.equal(a11y.value.min, 'prop:min');
});

test('a local that shadows a prop is reported as the local, not as the prop', () => {
  // `{value}` in the markup is `const value = clamp(...)`, so sending the team to
  // the `value` prop sends them to the wrong place (it is `controlled` here).
  const { doc } = build(RANGE_TSX, RANGE_CSS);
  const a = node(doc, 'root');
  assert.deepEqual(node(doc, 'root').content, { derived: 'value' });
  assert.deepEqual(a.accessibility.valueRange.now, { derived: 'value' });
  // Not shadowed, so these remain props.
  assert.deepEqual(a.accessibility.valueRange.min, { prop: 'min' });
  assert.deepEqual(a.accessibility.valueRange.max, { prop: 'max' });
  // A genuine expression says which component-scope names it reads.
  assert.deepEqual(a.accessibility.valueRange.text, { expression: 'format?.(value)', uses: ['value'] });
  assert.deepEqual(a.accessibility.label, { expression: 'labelledBy ? undefined : label' });
});

test('a node reports its announced range and the elements it is described by', () => {
  for (const platform of ['ios', 'android']) {
    const { doc } = build(RANGE_TSX, RANGE_CSS, platform);
    const a = node(doc, 'root').accessibility;
    assert.deepEqual(Object.keys(a.valueRange).sort(), ['max', 'min', 'now', 'text']);
    // The platforms have no id reference, so these are the prop that carries the id.
    assert.deepEqual(a.labelledBy, { prop: 'labelledBy' });
    assert.deepEqual(a.describedBy, { prop: 'describedBy' });
  }
});

test('a state that takes a string says that its wording is not in the source', () => {
  const { doc } = build(RANGE_TSX, RANGE_CSS);
  const readonly = node(doc, 'root').accessibility.states.find((s) => s.state === 'readonly');
  assert.equal(readonly.kind, 'property');
  assert.equal(readonly.wording, 'not stated in the source');
  // A trait or semantic the platform words itself (VoiceOver and TalkBack say
  // "dimmed" / "disabled" on their own) is not marked, on either platform.
  for (const platform of ['ios', 'android']) {
    const { doc: off } = build(
      `export interface XProps { a?: string }
       export function X(){ return (<div className="ds-x" aria-disabled={a} />); }`,
      RANGE_CSS,
      platform,
    );
    const s = node(off, 'root').accessibility.states.find((x) => x.state === 'disabled');
    assert.equal(s.wording, undefined, `${platform}: the platform supplies the wording`);
  }
});

/* ------------------------------------------------------------------ *
 * the events and feedback the source uses
 * ------------------------------------------------------------------ */

const events = (doc) => Object.fromEntries((doc.behaviorSource?.events || []).map((e) => [e.concept, e]));

test('an event is reported where the source names it, in a handler attribute or in quoted logic', () => {
  const { doc } = build(
    `export interface XProps { a?: string }
     export function X(){
       const stop = () => { window.removeEventListener('pointerup', stop); };
       const buzz = () => { navigator.vibrate(8); };
       return (<button className="ds-x" onKeyDown={buzz} onPointerDown={stop} />);
     }`,
    RANGE_CSS,
  );
  const e = events(doc);
  assert.deepEqual(e['event.keyDown'].names, ['onKeyDown']);
  assert.deepEqual(e['event.keyDown'].foundIn, ['node:root']);
  assert.deepEqual(e['event.pointerDown'].foundIn, ['node:root']);
  // A DOM event name in a quoted statement counts as the event.
  assert.deepEqual(e['event.pointerUp'].names, ['pointerup']);
  assert.deepEqual(e['event.pointerUp'].foundIn, ['stop']);
  assert.deepEqual(e['feedback.haptic'].foundIn, ['buzz']);
});

test('an event is found by whole name, and an event the source does not use is not reported', () => {
  // onKeyDownCapture is a different handler; pointerupdate is not pointerup.
  const { doc } = build(
    `export interface XProps { a?: string }
     export function X(){
       const go = () => { track('pointerupdate'); };
       return (<button className="ds-x" onKeyDownCapture={go} />);
     }`,
    RANGE_CSS,
  );
  assert.deepEqual(events(doc), {});
  assert.equal(doc.behaviorSource?.events, undefined);
});

test('an event concept carries an idiom for both frameworks, and says what it does not know', () => {
  for (const platform of ['ios', 'android']) {
    const { contract, artifact } = build(KITCHEN_SINK.tsx, KITCHEN_SINK.css, platform);
    const hints = JSON.parse(emitPlatformJson(artifact, { contract, frameworks: { ios: 'swiftui', android: 'compose' } })).implementationHints;
    for (const id of ['event.pointerDown', 'event.pointerUp', 'event.pointerCancel', 'event.pointerLeave', 'event.keyDown', 'event.click', 'feedback.haptic']) {
      assert.ok(hints.concepts[id]?.idiom, `${platform}: ${id} has an idiom`);
    }
    // The duration in navigator.vibrate does not carry over to a native haptic.
    assert.match(hints.concepts['feedback.haptic'].note, /duration/);
  }
});

test('Counter\u2019s hold, keys and haptic are named, and each is found where the source has it', async () => {
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  const doc = JSON.parse(emitPlatformJson(resolve(contract, tokenIndexFor(contract, config), 'android').artifact, { contract }));
  const e = events(doc);
  assert.deepEqual(Object.keys(e).sort(), [
    'event.click', 'event.keyDown', 'event.pointerCancel', 'event.pointerDown', 'event.pointerLeave', 'event.pointerUp', 'feedback.haptic',
  ]);
  assert.ok(e['event.keyDown'].foundIn.includes('node:value'), 'the value node attaches the key handler');
  assert.deepEqual(e['feedback.haptic'].foundIn, ['setValue']);
  assert.ok(e['event.pointerUp'].foundIn.every((n) => doc.behaviorSource.entries.some((x) => x.name === n)), 'every location is a quoted entry');
});

test('the hit-area idiom does not recommend something that takes layout space as if it did not', () => {
  // minimumInteractiveComponentSize() reserves space in layout, so offering it as the
  // way to get a hit area "without moving anything" would change the design.
  const hit = IDIOMS.concepts.hitArea;
  assert.ok(!/minimumInteractiveComponentSize/.test(hit.compose), 'it is not the recommended idiom');
  assert.match(hit.notes.compose, /minimumInteractiveComponentSize\(\) reserves the space in layout/);
  assert.ok(!/minimumInteractiveComponentSize/.test(hit.note), 'the shared note is neutral');
});

/* ------------------------------------------------------------------ *
 * small things a reader would otherwise guess at
 * ------------------------------------------------------------------ */

test('identical style rows are said to be identical, and rows that differ are not', async () => {
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  const counter = JSON.parse(emitPlatformJson(resolve(contract, tokenIndexFor(contract, config), 'ios').artifact, { contract }));
  assert.ok(counter.styles.length > 1);
  assert.match(counter.stylesNote, /same values/);
  // It must not imply that nothing changes: state changes live elsewhere.
  assert.match(counter.stylesNote, /nodes\[\]\.conditional and animations/);

  // Button's rows differ by variant, so nothing is claimed.
  const button = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/button.contract.json'), 'utf8'));
  const doc = JSON.parse(emitPlatformJson(resolve(button, tokenIndexFor(button, config), 'ios').artifact, { contract: button }));
  assert.ok(doc.styles.length > 1);
  assert.equal(doc.stylesNote, undefined, 'the rows are not the same, so nothing is claimed');
});

test('the reset delay is traceable to the source constant it came from', async () => {
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  const doc = JSON.parse(emitPlatformJson(resolve(contract, tokenIndexFor(contract, config), 'ios').artifact, { contract }));
  const timeline = doc.animations.find((a) => a.changes.some((c) => c.timeline))?.changes.find((c) => c.timeline).timeline
    ?? doc.animations.find((a) => a.timeline)?.timeline;
  assert.equal(timeline.resetDelayExpression, 'POP_MS');
  assert.ok(doc.sourceConstants.some((c) => c.name === 'POP_MS'), 'POP_MS is a quoted source constant');

  // A bare number is not an expression worth naming.
  const bare = build(
    `export interface XProps { a?: string }
     export function X(){ const [pop, setPop] = useState(false); const go = () => { setPop(true); setTimeout(() => setPop(false), 100); }; return (<div className="ds-x" data-pop={pop} onClick={go} />); }`,
    `.ds-x { transition: opacity 100ms linear; } .ds-x[data-pop='true'] { opacity: 0.5; }`,
  ).doc;
  const t2 = bare.animations.flatMap((a) => [a.timeline, ...a.changes.map((c) => c.timeline)]).find(Boolean);
  assert.ok(t2, 'the bare-literal reset still produces a timeline');
  assert.equal(t2.resetDelayExpression, undefined, 'a literal 100 is not a name to trace');
});

test('the guide explains each form a value can take, so a reader is not left to infer them', () => {
  const { doc } = build(TSX(), RANGE_CSS);
  const text = doc.guide.values.join('\n');
  for (const term of ['{derived}', '{expression}', 'valueRange', 'labelledBy', 'wording', 'behaviorSource.events', 'resetDelayExpression', 'integer']) {
    assert.ok(text.includes(term), `the guide does not mention ${term}`);
  }
});

test('a prop modelled as a state is still reported as that prop, not as an unknown expression', () => {
  // Button declares `loading`, and the importer turns it into a state, so it is no
  // longer in contract.props. `aria-busy={loading || undefined}` is still the
  // `loading` prop; calling it an expression hid what makes the control busy.
  const { contract, doc } = build(
    `export interface XProps {
       loading?: boolean;
       label?: string;
     }
     export function X({ loading = false, label }: XProps){
       return (<button className="ds-x" aria-busy={loading || undefined} disabled={loading}>{label}</button>);
     }`,
    RANGE_CSS,
  );
  assert.ok(!('loading' in contract.props), 'it is modelled as a state, so it is not a contract prop');
  const busy = node(doc, 'root').accessibility.states.find((s) => s.state === 'busy');
  assert.deepEqual(busy.when, { prop: 'loading' });
  assert.match(doc.guide.values.join('\n'), /not listed in props is modelled as a state/);
});

/* ------------------------------------------------------------------ *
 * what two independent readers could not tell from the first version
 * ------------------------------------------------------------------ */

test(':focus-visible is kept apart from :focus, so a tap does not show a keyboard ring', () => {
  const css = (selector) => `.ds-x:${selector} { outline: 2px solid var(--semantic-color-border-brand); outline-offset: 2px; }`;
  const visible = build(TSX(), css('focus-visible')).doc;
  assert.equal(visible.focusRings[0].trigger, 'focused');
  assert.equal(visible.focusRings[0].focusVisible, true, 'keyboard focus only, as the source says');
  // Plain :focus is every focus, and must not be marked as keyboard-only.
  const any = build(TSX(), css('focus')).doc;
  assert.equal(any.focusRings[0].focusVisible, undefined);
  // And a conditional style on :focus-visible carries the same fact, not only rings.
  const cond = build(TSX(), `.ds-x { color: var(--semantic-color-text-primary); } .ds-x:focus-visible { background: var(--semantic-color-background-default); }`).doc;
  const c = node(cond, 'root').conditional.find((x) => x.when.some((w) => w.state === 'focused'));
  assert.ok(c.when.find((w) => w.state === 'focused').focusVisible, 'a condition keeps it too');
});

test('an attribute a spread helper sets announces its state on the node, with the spread as its condition', async () => {
  // Counter\u2019s buttons are aria-disabled only through {...buttonProps(...)}. The markup never
  // says so, so the node announced nothing and both reviewers asked how a blocked button is read.
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  for (const platform of ['ios', 'android']) {
    const doc = JSON.parse(emitPlatformJson(resolve(contract, tokenIndexFor(contract, config), platform).artifact, { contract }));
    const s = node(doc, 'button').accessibility.states.find((x) => x.state === 'disabled');
    assert.ok(s, `${platform}: the blocked button announces "disabled"`);
    assert.deepEqual(s.when.logic, ['buttonProps', 'atMin']);
    assert.match(s.when.spread, /^buttonProps\(/);
    assert.equal(node(doc, 'button2').accessibility.states.find((x) => x.state === 'disabled').when.logic[1], 'atMax');
  }
  // A node that states it in the markup is not reported twice.
  const { doc } = build(
    `export interface XProps {
       frozen?: boolean;
     }
     export function X({ frozen }: XProps){
       const props = () => ({ 'aria-disabled': true });
       return (<button className="ds-x" aria-disabled={frozen || undefined} {...props()} />);
     }`,
    RANGE_CSS,
  );
  assert.equal(node(doc, 'root').accessibility.states.filter((x) => x.state === 'disabled').length, 1);
});

test('tab order is stated where the source says it, and is not called focusable', async () => {
  // tabIndex -1 takes a control out of the keyboard order and leaves it focusable by script or
  // pointer; "focusable: false" would say something stronger than the source does.
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  const doc = JSON.parse(emitPlatformJson(resolve(contract, tokenIndexFor(contract, config), 'ios').artifact, { contract }));
  assert.deepEqual(node(doc, 'button').accessibility.tabOrder.included, false);
  assert.equal(node(doc, 'button').accessibility.tabOrder.literal, 'tabIndex: -1');
  assert.deepEqual(node(doc, 'button').accessibility.tabOrder.setBy.logic, ['buttonProps', 'atMin']);
  assert.deepEqual(node(doc, 'value').accessibility.tabOrder, { included: true, setBy: { attribute: 'tabIndex' } });
  assert.equal(node(doc, 'button').accessibility.focusable, undefined);

  // Nothing stated, nothing claimed.
  const plain = build(TSX(), RANGE_CSS).doc;
  assert.equal(node(plain, 'root').accessibility?.tabOrder, undefined);
});

const SWIFTUI_ONLY = /SwiftUI|HStack|VStack|@FocusState|@Environment|@ScaledMetric|@GestureState|DragGesture|contentShape|ButtonStyle|layoutPriority|frame\(|sensoryFeedback|onKeyPress|UIImpact|\.disabled\(/;
const COMPOSE_ONLY = /Compose|Modifier\.|\bRow\b|\bColumn\b|androidx|detectTapGestures|tryAwaitRelease|clickable|ProgressBarRangeInfo|LocalHapticFeedback|onKeyEvent|indication|ripple|snap\(\)|semantics \{|MutableInteractionSource|Settings\.Global/;

test('a note shared by both frameworks names neither, and a framework note names only its own', () => {
  for (const [id, entry] of Object.entries(IDIOMS.concepts)) {
    if (entry.note) {
      assert.ok(!SWIFTUI_ONLY.test(entry.note), `${id}: the shared note names SwiftUI: ${entry.note}`);
      assert.ok(!COMPOSE_ONLY.test(entry.note), `${id}: the shared note names Compose: ${entry.note}`);
    }
    for (const fw of Object.keys(entry.notes || {})) assert.ok(['swiftui', 'compose'].includes(fw), `${id}: "${fw}" is not a framework`);
    if (entry.notes?.swiftui) assert.ok(!COMPOSE_ONLY.test(entry.notes.swiftui), `${id}: the SwiftUI note names Compose`);
    if (entry.notes?.compose) assert.ok(!SWIFTUI_ONLY.test(entry.notes.compose), `${id}: the Compose note names SwiftUI`);
  }
});

test('a platform file carries advice for its own framework and not the other', async () => {
  // The iOS spec was handed a Compose API name inside its hints. Checked on the emitted
  // text, over both Counter and the kitchen sink, so every concept that can appear does.
  const { contract: counter } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  const frameworks = { ios: 'swiftui', android: 'compose' };
  const other = { ios: COMPOSE_ONLY, android: SWIFTUI_ONLY };
  for (const platform of ['ios', 'android']) {
    const sources = [
      { contract: counter, artifact: resolve(counter, tokenIndexFor(counter, config), platform).artifact },
      build(KITCHEN_SINK.tsx, KITCHEN_SINK.css, platform),
    ];
    for (const { contract, artifact } of sources) {
      const hints = JSON.parse(emitPlatformJson(artifact, { contract, frameworks })).implementationHints;
      for (const [id, c] of Object.entries(hints.concepts)) {
        const text = [c.idiom, c.note, c.frameworkNote].filter(Boolean).join(' ');
        assert.ok(!other[platform].test(text), `${platform} ${id} carries the other framework's advice: ${text}`);
      }
    }
  }
});

test('label required follows the declared prop, so it cannot contradict the props list', () => {
  const tsx = (optional) => `export interface XProps {
    label${optional ? '?' : ''}: string;
  }
  export function X({ label }: XProps){ return (<button className="ds-x" aria-label={label} />); }`;
  assert.equal(build(tsx(false), RANGE_CSS).doc.accessibility.labelRequired, true);
  assert.equal(build(tsx(true), RANGE_CSS).doc.accessibility.labelRequired, false, 'an optional label is not required of the consumer');
  // Counter declares label?: string with a default, and the spec used to say it was required.
  assert.equal(build(tsx(true), RANGE_CSS).doc.props.find((p) => p.name === 'label').required, false);
});

test('the guide defines the terms two readers could not work out', () => {
  const { doc } = build(TSX(), RANGE_CSS);
  const text = doc.guide.values.join('\n');
  for (const term of ['offset + width', 'focusVisible', 'A condition with state', 'atLeastNodeBox', 'removedWhen is a list of alternatives', 'ANY one', 'ALL hold', 'author\'s own comment', 'labelSource', 'labelRequired', 'tabOrder.included']) {
    assert.ok(text.includes(term), `the guide does not explain: ${term}`);
  }
});

test('announced states are stated once, on the node that announces them', async () => {
  // A second, condition-less map at component level read as an empty contradiction beside the
  // per-node list. The internal artifact keeps it for the reader UI and spec.md.
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  const { artifact } = resolve(contract, tokenIndexFor(contract, config), 'ios');
  const doc = JSON.parse(emitPlatformJson(artifact, { contract }));
  assert.equal(doc.accessibility.states, undefined);
  assert.ok(node(doc, 'value').accessibility.states.length, 'the node carries them');
  assert.ok('states' in artifact.a11y, 'the internal artifact still has the map the UI reads');
});

test('the mapping page shows the framework notes, not only the shared one', async () => {
  const { mappingTables } = await import('../src/core/mapping-table.js');
  const idioms = mappingTables().find((t) => t.id === 'idioms');
  const row = (id) => idioms.rows.find((r) => r.key === id).cells.at(-1).text;
  assert.match(row('container.stack.horizontal'), /SwiftUI: .*spacing: 0/);
  assert.match(row('container.stack.horizontal'), /Compose: .*Row has no implicit spacing/);
  assert.match(row('state.pressed'), /Compose: .*indication = null/);
});

/* ------------------------------------------------------------------ *
 * the text token a node's text comes from
 *
 * Colour is stated as the one token it is. Text is the same: the name of the
 * composite (semantic.typography.label.l), and not the five tokens it stands for.
 * ------------------------------------------------------------------ */

const TEXT_CSS = (decls) => `.ds-x { ${decls} }`;
const FIVE = (group) => [
  `font-family: var(--${group}-font-family);`,
  `font-size: var(--${group}-font-size);`,
  `font-weight: var(--${group}-font-weight);`,
  `line-height: var(--${group}-line-height);`,
  `letter-spacing: var(--${group}-letter-spacing);`,
].join(' ');
const MEMBERS = ['font.family', 'font.size', 'font.weight', 'line.height', 'letter.spacing'];

test('text is stated as one token, the way colour is, and not as the five it stands for', async () => {
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  for (const platform of ['ios', 'android']) {
    const doc = JSON.parse(emitPlatformJson(resolve(contract, tokenIndexFor(contract, config), platform).artifact, { contract }));
    const value = node(doc, 'value').appearance;
    assert.equal(value.typography, '{semantic.typography.label.l}', platform);
    assert.equal(value.foreground, '{semantic.color.text.primary}', 'it reads the same as a colour token');
    // The individual tokens are not repeated beside it.
    for (const k of ['family', 'size', 'weight', 'lineHeight', 'letterSpacing']) assert.equal(value.text?.[k], undefined, `${platform}: text.${k}`);
    // Other text properties are still stated.
    assert.equal(value.text.numericFigures, 'tabular');
    assert.equal(doc.guide.values.filter((v) => v.startsWith('appearance.typography')).length, 1);
    // And no part of the build-facing output names them.
    const text = JSON.stringify({ ...doc, evidence: undefined });
    for (const m of MEMBERS) assert.ok(!text.includes(`semantic.typography.label.l.${m}`), `${platform}: mentions ${m}`);
  }
});

test('the word style is not used for text anywhere in the output', async () => {
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  const doc = JSON.parse(emitPlatformJson(resolve(contract, tokenIndexFor(contract, config), 'android').artifact, { contract }));
  const guide = doc.guide.values.find((v) => v.startsWith('appearance.typography'));
  assert.doesNotMatch(guide, /\bstyle\b/i);
  assert.equal(doc.nodes.some((n) => 'style' in (n.appearance?.text || {})), false);
  const t = doc.tokens['semantic.typography.label.l'];
  assert.deepEqual(t.usedAs, ['typography']);
});

test('a composite is claimed only when every text property agrees on it', () => {
  const typography = (decls) => node(build(TSX(), TEXT_CSS(decls)).doc, 'root').appearance.typography;
  const text = (decls) => node(build(TSX(), TEXT_CSS(decls)).doc, 'root').appearance.text;

  assert.equal(typography(FIVE('semantic-typography-label-l')), '{semantic.typography.label.l}');
  // Two properties are enough; the rest of the group is simply not set here.
  assert.equal(typography('font-size: var(--semantic-typography-x-s-font-size); line-height: var(--semantic-typography-x-s-line-height);'), '{semantic.typography.x.s}');

  // Different groups: not one token, so each stays as it is.
  const mixed = 'font-size: var(--semantic-typography-label-l-font-size); line-height: var(--semantic-typography-label-m-line-height);';
  assert.equal(typography(mixed), undefined);
  assert.equal(text(mixed).size, '{semantic.typography.label.l.font.size}', 'and the individual tokens are stated');
  // One property is a literal, so the text does not come from the token alone.
  const literal = `${FIVE('semantic-typography-label-l')} font-weight: 700;`;
  assert.equal(typography(literal), undefined);
  assert.equal(text(literal).weight, 700);
  // A token that is not named for its own property is not part of a typography group.
  assert.equal(typography('font-size: var(--semantic-size-16); line-height: var(--semantic-typography-label-l-line-height);'), undefined);
  // One token is not enough to say there is a group.
  assert.equal(typography('font-size: var(--semantic-typography-label-l-font-size);'), undefined);
});

test('a text token that changes with a variant is stated on each change', () => {
  const tsx = `export interface XProps {
    size?: string;
  }
  export function X({ size }: XProps){ return (<div className="ds-x" data-size={size} />); }`;
  const css = `.ds-x { color: var(--semantic-color-text-primary); }
    .ds-x[data-size='sm'] { font-size: var(--semantic-typography-x-s-font-size); line-height: var(--semantic-typography-x-s-line-height); }
    .ds-x[data-size='lg'] { font-size: var(--semantic-typography-x-l-font-size); line-height: var(--semantic-typography-x-l-line-height); }`;
  const { doc } = build(tsx, css);
  const change = (v) => node(doc, 'root').conditional.find((c) => c.when.some((w) => w.equals === v)).appearance;
  assert.equal(change('sm').typography, '{semantic.typography.x.s}');
  assert.equal(change('lg').typography, '{semantic.typography.x.l}');
  assert.equal(change('sm').text, undefined, 'and not the two tokens it stands for');
});

test('spec.md names the text token too, and not the five tokens', async () => {
  const { emitDocs } = await import('../src/core/docs.js');
  const { validateContract } = await import('../src/core/validate.js');
  const docsFor = (contract) => {
    const idx = tokenIndexFor(contract, config);
    // The same shape build.js hands to emitDocs, including the file list it prints.
    const artifacts = ['ios', 'android'].map((platform) => ({ platform, artifact: resolve(contract, idx, platform).artifact, files: [`${platform}.json`] }));
    return emitDocs(contract, artifacts, validateContract(contract, idx));
  };

  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  const md = docsFor(contract);
  assert.match(md, /### Text token/);
  assert.match(md, /\| `value` \| always \| `\{semantic\.typography\.label\.l\}` \|/);
  assert.doesNotMatch(md, /text style/i);
  for (const m of MEMBERS) assert.ok(!md.includes(`semantic.typography.label.l.${m}`), `spec.md mentions ${m}`);
  assert.match(md, /\| typography \|/, 'the node table has one typography column');
  assert.doesNotMatch(md, /\| fontFamily \|/);

  // No text token, no section: nothing is claimed.
  const { contract: plain } = importFromSources({
    sources: sourcesFromFiles([{ name: 'X.tsx', content: TSX() }, { name: 'x.css', content: RANGE_CSS }]),
    id: 'x',
  });
  assert.ok(!/### Text token/.test(docsFor(plain)));
});

test('the contract carries the text token in place of the five, and declares it', async () => {
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  const value = contract.composition.tree.children.find((n) => n.name === 'value');
  assert.equal(value.styles.default.typography, '{semantic.typography.label.l}');
  for (const role of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing']) {
    assert.equal(role in value.styles.default, false, `node styles still hold ${role}`);
  }
  const rule = contract.visualRules.find((r) => r.properties.typography);
  assert.equal(rule.properties.typography, '{semantic.typography.label.l}');
  assert.equal('fontSize' in rule.properties, false);
  // The composite is in the contract's own vocabulary; the tokens only it used are not.
  assert.deepEqual(contract.tokens['semantic.typography.label.l'], { value: null, type: 'typography' });
  for (const m of MEMBERS) assert.equal(contract.tokens[`semantic.typography.label.l.${m}`], undefined, `${m} is still in the vocabulary`);
});

test('every {token} an output refers to is in its tokens list', async () => {
  // The style was once emitted as a {reference} that tokens[] did not list, so a team resolving
  // every brace through their token system would look for something undeclared. Checked over
  // the places a reference can appear, for Counter and the kitchen sink on both platforms.
  const { contract: counter } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  for (const platform of ['ios', 'android']) {
    for (const { contract, artifact } of [
      { contract: counter, artifact: resolve(counter, tokenIndexFor(counter, config), platform).artifact },
      build(KITCHEN_SINK.tsx, KITCHEN_SINK.css, platform),
    ]) {
      const doc = JSON.parse(emitPlatformJson(artifact, { contract }));
      const text = JSON.stringify([doc.nodes, doc.animations, doc.hitAreas, doc.focusRings, doc.styles]);
      const refs = new Set([...text.matchAll(/\{([a-z][\w-]*(?:\.[\w-]+)+)\}/g)].map((m) => m[1]));
      const missing = [...refs].filter((r) => !(r in doc.tokens));
      assert.deepEqual(missing, [], `${platform}: referenced but not listed in tokens: ${missing.join(', ')}`);
    }
  }
});

test('the text token appears in tokens, typed and with what it is used as', async () => {
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  for (const platform of ['ios', 'android']) {
    const doc = JSON.parse(emitPlatformJson(resolve(contract, tokenIndexFor(contract, config), platform).artifact, { contract }));
    const token = doc.tokens['semantic.typography.label.l'];
    assert.equal(token.type, 'typography', platform);
    assert.equal(token.value, null);
    assert.deepEqual(token.usedAs, ['typography']);
    for (const m of MEMBERS) assert.equal(doc.tokens[`semantic.typography.label.l.${m}`], undefined, `${platform}: ${m} is listed`);
  }
});

test('a text token set by two rules together is still found', () => {
  // Neither rule sets two properties, so neither alone is a composite; the node\u2019s merged styles are.
  const { contract, doc } = build(
    TSX(),
    `.ds-x { font-size: var(--semantic-typography-t-font-size); }
     .ds-x { line-height: var(--semantic-typography-t-line-height); }`,
  );
  assert.equal(contract.composition.tree.styles.default.typography, '{semantic.typography.t}');
  assert.equal(node(doc, 'root').appearance.typography, '{semantic.typography.t}');
  assert.equal(node(doc, 'root').appearance.text, undefined);
});

test('a text token covers the idioms for the properties it stands for', () => {
  // No individual property is stated, but a team still needs font, line height and letter spacing.
  const { artifact, contract } = build(TSX(), TEXT_CSS(FIVE('semantic-typography-label-l')));
  const hints = JSON.parse(emitPlatformJson(artifact, { contract, frameworks: { ios: 'swiftui', android: 'compose' } })).implementationHints;
  for (const id of ['text.font', 'text.lineHeight', 'text.letterSpacing']) assert.ok(hints.concepts[id], `${id} is covered`);
});

test('a component with sizes states the text token in its matrix, but only if every row can', () => {
  // The matrix rows must all have the same fields, so they switch to the composite together or not at all.
  const tsx = `export type XSize = 'sm' | 'lg';
  export interface XProps {
    size?: XSize;
    label?: string;
  }
  export function X({ size = 'sm', label }: XProps) {
    return (<button className="ds-x" data-size={size} aria-label={label}>Go</button>);
  }`;
  const four = (g) => ['font-size', 'font-weight', 'line-height', 'letter-spacing'].map((p) => `${p}: var(--semantic-typography-${g}-${p});`).join(' ');
  const css = (sm, lg) => `.ds-x { display: inline-flex; color: var(--semantic-color-text-primary); }
    .ds-x[data-size='sm'] { padding: var(--semantic-spacing-4) var(--semantic-spacing-8); border-radius: var(--semantic-border-radius-4); ${sm} }
    .ds-x[data-size='lg'] { padding: var(--semantic-spacing-8) var(--semantic-spacing-16); border-radius: var(--semantic-border-radius-8); ${lg} }`;
  const MEMBER = /font\.size|font\.weight|line\.height|letter\.spacing/;
  const rowsProblems = (artifact) => checkClosed(artifact).problems.filter((p) => p.startsWith('styles['));
  const run = (sm, lg) => {
    const { contract, artifact, doc } = build(tsx, css(sm, lg));
    return { contract, artifact, doc };
  };

  // Each size comes from one group: every row says so, and none repeats the four it stands for.
  const one = run(four('x-s'), four('x-l'));
  assert.deepEqual(rowsProblems(one.artifact), [], 'the rows keep a common shape');
  const bySize = (size) => one.doc.styles.filter((r) => r.size === size);
  assert.ok(bySize('sm').length && bySize('lg').length);
  assert.ok(bySize('sm').every((r) => r.typography === '{semantic.typography.x.s}'));
  assert.ok(bySize('lg').every((r) => r.typography === '{semantic.typography.x.l}'));
  assert.ok(one.doc.styles.every((r) => !('fontSize' in r) && !('lineHeight' in r)));
  assert.deepEqual(Object.keys(one.doc.tokens).filter((k) => /typography/.test(k)), ['semantic.typography.x.l', 'semantic.typography.x.s']);
  assert.ok(Object.keys(one.doc.tokens).every((k) => !MEMBER.test(k) || !/typography/.test(k)), 'no individual text token is listed');

  // One size mixes groups, so it has no composite, and then no row switches: they would differ in shape.
  const mixed = run(four('x-s'), `font-size: var(--semantic-typography-x-l-font-size); font-weight: var(--semantic-typography-x-l-font-weight);
    line-height: var(--semantic-typography-x-m-line-height); letter-spacing: var(--semantic-typography-x-l-letter-spacing);`);
  assert.deepEqual(rowsProblems(mixed.artifact), [], 'and the rows still have a common shape');
  assert.ok(mixed.doc.styles.every((r) => 'fontSize' in r && !('typography' in r)), 'every row keeps its individual tokens');
  assert.ok(mixed.doc.tokens['semantic.typography.x.l.font.size'], 'so those tokens are listed');
});
