/**
 * Import tests.
 *
 * The importer's value depends entirely on it being HONEST: everything it
 * claims to have derived must actually be in the source, and everything it
 * cannot read must surface as a question rather than a plausible-looking guess.
 * These tests check both directions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadConfig, tokenIndexFor } from '../src/core/build.js';
import { validateContract } from '../src/core/validate.js';
import { resolve, checkClosed } from '../src/core/resolve.js';
import {
  importFromPath,
  importFromSources,
  sourcesFromFiles,
  gatherSources,
  mergeDraft,
} from '../src/core/import/index.js';
import { TokenMatcher } from '../src/core/import/tokenmatch.js';
import { extractProps, extractVariants, extractCss, extractJsx } from '../src/core/import/extract.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'test/fixtures/Button');

const ctx = await (async () => {
  const config = await loadConfig(ROOT);
  const matcher = new TokenMatcher({ cssPrefix: config.cssPrefix });
  const sources = await gatherSources(FIXTURE);
  const imported = await importFromPath({
    path: FIXTURE,
    cssPrefix: config.cssPrefix,
    id: 'imported-button',
  });
  const tokens = tokenIndexFor(imported.contract, config);
  return { config, matcher, sources, tokens, ...imported };
})();

/* ------------------------------------------------------------------ *
 * token matching
 * ------------------------------------------------------------------ */

test('CSS custom properties become tokens', () => {
  const m = new TokenMatcher({ cssPrefix: '--ds-' });
  assert.equal(m.fromCssVar('var(--ds-brand-600)').ref, '{brand.600}');
  assert.equal(m.fromCssVar('var(--ds-text-disabled)').ref, '{text.disabled}');
});

test('a custom property outside the namespace is not a token', () => {
  const m = new TokenMatcher({ cssPrefix: '--ds-' });
  assert.equal(m.fromCssVar('var(--some-app-thing)'), null);
});

test('a declared custom property carries its value', () => {
  // The only place a component tells us what a token actually is.
  const m = new TokenMatcher({ cssPrefix: '--ds-' });
  const d = m.declaration('--ds-brand-500', '#3b5bdb');
  assert.equal(d.ref, '{brand.500}');
  assert.equal(d.value, '#3b5bdb');
  assert.equal(m.vocabulary()['brand.500'].type, 'color');
});

test('a referenced-but-undeclared token has no value, and that is fine', () => {
  const m = new TokenMatcher({ cssPrefix: '--ds-' });
  m.fromCssVar('var(--ds-brand-600)', 'fill');
  const vocab = m.vocabulary();
  assert.equal(vocab['brand.600'].value, null);
  assert.equal(vocab['brand.600'].type, 'color', 'type inferred from how it is used');
});

test('utility classes map to a role and a token', () => {
  const m = new TokenMatcher({ cssPrefix: '--ds-' });
  const bg = m.fromUtilityClass('bg-brand-500');
  assert.equal(bg.role, 'fill');
  assert.equal(bg.ref, '{brand.500}');

  const border = m.fromUtilityClass('border-border-default');
  assert.equal(border.role, 'borderColor');
  assert.equal(border.ref, '{border.default}');
});

test('the overloaded `text-` prefix is disambiguated by name', () => {
  // text- sets colour AND font size in utility CSS. With no catalogue to check
  // against, the token's own name is the only honest hint.
  const m = new TokenMatcher({ cssPrefix: '--ds-' });
  assert.equal(m.fromUtilityClass('text-text-primary').role, 'labelColor');
  assert.equal(m.fromUtilityClass('text-textSize-md').role, 'fontSize');
});

test('transparent is kept as a literal, not forced into a token', () => {
  const m = new TokenMatcher({ cssPrefix: '--ds-' });
  assert.equal(m.fromUtilityClass('bg-transparent').ref, 'transparent');
});

test('a literal resolves to a token only when the component declared one', () => {
  const m = new TokenMatcher({ cssPrefix: '--ds-' });
  m.declaration('--ds-brand-500', '#3b5bdb');
  assert.equal(m.fromLiteral('#3b5bdb').ref, '{brand.500}');
});

test('a literal with no declaration behind it is reported as hardcoded', () => {
  // Never attached to a name we invented — it is flagged so it can be
  // tokenised properly.
  const m = new TokenMatcher({ cssPrefix: '--ds-' });
  const hit = m.fromLiteral('#abcdef');
  assert.equal(hit.ref, null);
  assert.equal(hit.hardcoded, true);
});

test('a value shared by two declared tokens is refused, not guessed', () => {
  const m = new TokenMatcher({ cssPrefix: '--ds-' });
  m.declaration('--ds-brand-500', '#3b5bdb');
  m.declaration('--ds-focus-default', '#3b5bdb');
  const hit = m.fromLiteral('#3b5bdb');
  assert.equal(hit.ref, null);
  assert.equal(hit.ambiguous.length, 2);
});

test('an unrecognised utility class matches nothing', () => {
  const m = new TokenMatcher({ cssPrefix: '--ds-' });
  assert.equal(m.fromUtilityClass('shadow-lg'), null);
});

/* ------------------------------------------------------------------ *
 * extractors
 * ------------------------------------------------------------------ */

test('props come from the TypeScript interface', () => {
  const src = ctx.sources.code.map((f) => f.content).join('\n');
  const { props } = extractProps(src);
  assert.equal(props.label.kind, 'string');
  assert.equal(props.label.required, true);
  assert.equal(props.iconStart.kind, 'slot');
  assert.equal(props.iconStart.required, false);
  assert.equal(props.onClick.kind, 'event');
  assert.equal(props.fullWidth.kind, 'boolean');
});

test('the variant matrix comes from cva()', () => {
  const src = ctx.sources.code.map((f) => f.content).join('\n');
  const { axes, appearance, sizes, defaults } = extractVariants(src, new TokenMatcher({ cssPrefix: '--ds-' }));
  assert.deepEqual(axes.variant, ['primary', 'secondary', 'ghost', 'destructive']);
  assert.deepEqual(axes.size, ['sm', 'md', 'lg']);
  assert.equal(appearance.primary.fill, '{brand.500}');
  assert.equal(appearance.ghost.fill, 'transparent');
  assert.equal(sizes.md.padX, '{space.md}');
  assert.equal(defaults.variant, 'primary');
});

test('states come from CSS pseudo-selectors', () => {
  const css = ctx.sources.styles.map((f) => f.content).join('\n');
  const { states } = extractCss(css, new TokenMatcher({ cssPrefix: '--ds-' }));
  assert.equal(states.hover.fill, '{brand.600}');
  assert.equal(states.pressed.fill, '{brand.700}');
  assert.equal(states.disabled.labelColor, '{text.disabled}');
  assert.equal(states.loading.fill, '{brand.600}');
});

test('a transition is parsed without shredding its cubic-bezier', () => {
  // Splitting `background-color 150ms cubic-bezier(0.4, 0, 0.2, 1)` on commas
  // produces four junk entries. Paren depth has to be respected.
  const css = ctx.sources.styles.map((f) => f.content).join('\n');
  const { transitions } = extractCss(css, new TokenMatcher({ cssPrefix: '--ds-' }));
  const fade = transitions.find((t) => t.property === 'fill');
  assert.equal(fade.durationMs, 150);
  assert.deepEqual(fade.curve.value, [0.4, 0, 0.2, 1]);
  assert.equal(transitions.filter((t) => t.property === 'fill').length, 1, 'exactly one, not four');
});

test('focus ring geometry and touch target come from CSS', () => {
  const css = ctx.sources.styles.map((f) => f.content).join('\n');
  const { focusRing, minTarget, reducedMotion } = extractCss(css, new TokenMatcher({ cssPrefix: '--ds-' }));
  assert.equal(focusRing.width, 2);
  assert.equal(focusRing.offset, 2);
  assert.equal(focusRing.color, '{focus.default}');
  // `min-height: 44px` is a plain value with no token behind it, so it is kept
  // as the number rather than attached to a token name we invented.
  assert.equal(minTarget, 44);
  assert.equal(reducedMotion, true);
});

test('`animation: none` in a reduced-motion block is not read as a loop', () => {
  const css = ctx.sources.styles.map((f) => f.content).join('\n');
  const { loops } = extractCss(css, new TokenMatcher({ cssPrefix: '--ds-' }));
  assert.equal(loops.length, 1);
  assert.equal(loops[0].id, 'ds-spin');
  assert.equal(loops[0].iterations, 'infinite');
});

test('accessibility comes from JSX attributes', () => {
  const src = ctx.sources.code.map((f) => f.content).join('\n');
  const { a11y } = extractJsx(src);
  assert.equal(a11y.role, 'button');
  assert.equal(a11y.state.busy, true);
  assert.equal(a11y.state.disabled, true);
});

/* ------------------------------------------------------------------ *
 * assembled contract
 * ------------------------------------------------------------------ */

test('the draft carries the axes, states, and matrix from the source', () => {
  const c = ctx.contract;
  assert.deepEqual(c.props.variant.values, ['primary', 'secondary', 'ghost', 'destructive']);
  assert.equal(c.props.variant.default, 'primary');
  assert.ok(c.states.includes('hover'));
  assert.ok(c.states.includes('loading'));
  // No cssPrefix is configured, so the whole custom-property name becomes the
  // token path. Setting a prefix would trim the `ds.` here.
  assert.equal(c.appearance.byVariant.primary.default.fill, '{brand.500}');
  assert.equal(c.appearance.byVariant.primary.hover.fill, '{ds.brand.600}');
});

test('base CSS applies to every variant; state CSS does not', () => {
  const c = ctx.contract;
  // `:hover { background: brand-600 }` is NOT variant-scoped in CSS, but
  // semantically belongs to primary. Claiming it for ghost would be a guess.
  assert.ok(c.appearance.byVariant.primary.hover);
  assert.ok(!c.appearance.byVariant.ghost.hover);
});

test('the contract carries the component\u2019s own token vocabulary', () => {
  const vocab = ctx.contract.tokens;
  assert.ok(Object.keys(vocab).length > 10);
  // From utility classes, which have no `--` prefix to trim.
  assert.equal(vocab['brand.500'].type, 'color');
  assert.equal(vocab['space.md'].type, 'dimension');
  // Referenced without declaration, so no value — and that is expected.
  assert.equal(vocab['brand.500'].value, null);
  // From a custom property, with the full name kept since no prefix is set.
  assert.equal(vocab['ds.brand.600'].type, 'color');
});

test('size-scoped values land in bySize, not in the colour matrix', () => {
  const c = ctx.contract;
  assert.equal(c.appearance.bySize.md.fontSize, '{textSize.md}');
  assert.equal(c.appearance.bySize.md.padX, '{space.md}');
  assert.ok(!c.appearance.roles.includes('fontSize'));
});

test('boolean state props become states rather than props', () => {
  const c = ctx.contract;
  assert.ok(!c.props.loading, 'loading is a state, not a boolean prop');
  assert.ok(!c.props.disabled);
  assert.ok(c.states.includes('loading'));
  assert.ok(c.states.includes('disabled'));
});

test('no platform support is decided for a prop', () => {
  // Whether `fullWidth` makes sense on a touch platform is a judgement. The
  // source does not state it, so the contract must not claim it.
  for (const [name, d] of Object.entries(ctx.contract.props)) {
    assert.ok(!d.platforms, `${name} should carry no invented platform verdict`);
  }
});

test('nothing is delegated to the platform on import', () => {
  // What a platform may substitute, and inside which envelope, is a design
  // decision written nowhere in a React component. Inventing envelopes put
  // limits into the contract that nobody had agreed to.
  assert.deepEqual(ctx.contract.adaptable, {});
});

test('a press transform is recorded exactly as written, and is not called an animation unless the CSS animates it', () => {
  // The fixture says `:active { transform: scale(0.97) }` and declares a
  // transition on background-color only. So the press scale is real and must be
  // recorded, but in CSS it snaps: nothing transitions `transform`. The old
  // reading invented a 0ms animation for it.
  const { artifact } = resolve(ctx.contract, ctx.tokens, 'ios');
  const root = artifact.nodes.find((n) => n.parent === null);
  const press = root.conditional.find((c) => c.when.some((w) => w.state === 'pressed'));

  assert.ok(press, 'scale(0.97) on :active should be recorded');
  assert.equal(press.appearance.transform.scale, 0.97);

  const transformAnimation = artifact.animations.find((a) => a.property === 'transform' && a.node === root.name);
  assert.equal(transformAnimation, undefined, 'no transition covers transform, so it must not be animated');
});

test('a transition is read with the timing function the CSS actually states', () => {
  const { artifact } = resolve(ctx.contract, ctx.tokens, 'ios');
  const fill = artifact.animations.find((a) => a.property === 'fill');
  assert.ok(fill, 'the background-color transition should be read');
  assert.equal(fill.timing.durationMs, 150);
  assert.deepEqual(fill.timing.curve.value, [0.4, 0, 0.2, 1]);
});

test('a linear transition is linear, and a missing timing function is the CSS default', async () => {
  // Both were previously read as easeInOut.
  const make = (css) =>
    importFromSources({
      sources: sourcesFromFiles([
        { name: 'X.tsx', content: 'export interface XProps { a?: string }\nexport function X(){ return (<div className="ds-x" />); }' },
        { name: 'x.css', content: css },
      ]),
      id: 'x',
    });

  const linear = extractCss('.ds-x { transition: transform 100ms linear; }', ctx.matcher);
  assert.equal(linear.transitions[0].curve.type, 'linear');

  const named = extractCss('.ds-x { transition: opacity 100ms ease-in; }', ctx.matcher);
  assert.equal(named.transitions[0].curve.type, 'easeIn');

  const none = extractCss('.ds-x { transition: opacity 100ms; }', ctx.matcher);
  assert.equal(none.transitions[0].curve.type, 'ease', 'no keyword means CSS\u2019s own default');

  // And through the scoped reader that now owns motion.
  const { contract } = make('.ds-x { transition: transform 100ms linear; } .ds-x:active { transform: scale(0.9); }');
  const { artifact } = resolve(contract, tokenIndexFor(contract, ctx.config), 'ios');
  const a = artifact.animations.find((x) => x.property === 'transform');
  assert.equal(a.timing.curve.named, 'linear');
});

test('reduced motion is only claimed when the stylesheet declares it, and is what it declares', () => {
  // The fixture says `@media (prefers-reduced-motion: reduce) { .ds-button { transition: none } }`.
  const { artifact } = resolve(ctx.contract, ctx.tokens, 'ios');
  const animated = artifact.animations.filter((a) => a.kind === 'transition');
  assert.ok(animated.length, 'the fixture has a transition to check');
  for (const a of animated) {
    assert.equal(a.reducedMotion?.enabled, false, 'transition: none means no animation, exactly');
  }
});

test('with no reduced-motion block, reduced motion is unstated rather than assumed', () => {
  const { contract } = importFromSources({
    sources: sourcesFromFiles([
      { name: 'X.tsx', content: 'export interface XProps { a?: string }\nexport function X(){ return (<div className="ds-x" />); }' },
      { name: 'x.css', content: '.ds-x { transition: transform 100ms linear; } .ds-x:active { transform: scale(0.9); }' },
    ]),
    id: 'x',
  });
  const { artifact } = resolve(contract, tokenIndexFor(contract, ctx.config), 'ios');
  const a = artifact.animations.find((x) => x.property === 'transform');
  assert.equal(a.reducedMotion, null, 'nothing was stated, so nothing may be claimed');
  assert.ok(checkClosed(artifact).problems.some((p) => /reduced-motion/.test(p)), 'and the gap must be visible');
});

test('a spinner under reduced motion does what the CSS says: it slows, it does not fade', () => {
  const css = `
    .ds-x__spinner { animation: ds-spin 700ms linear infinite; }
    @media (prefers-reduced-motion: reduce) { .ds-x__spinner { animation-duration: 2s; } }
    @keyframes ds-spin { to { transform: rotate(360deg); } }
  `;
  const { contract } = importFromSources({
    sources: sourcesFromFiles([
      { name: 'X.tsx', content: 'export interface XProps { a?: string }\nexport function X(){ return (<div className="ds-x"><span className="ds-x__spinner" /></div>); }' },
      { name: 'x.css', content: css },
    ]),
    id: 'x',
  });
  const { artifact } = resolve(contract, tokenIndexFor(contract, ctx.config), 'ios');
  const loop = artifact.animations.find((a) => a.kind === 'loop');

  assert.equal(loop.timing.durationMs, 700);
  assert.equal(loop.timing.iterations, 'infinite');
  assert.deepEqual(loop.reducedMotion.durationMs, 2000);
  assert.ok(!('mode' in loop.reducedMotion), 'no fade or other mode was invented');
  // The start is implied by the missing `from` frame and says so.
  assert.equal(loop.keyframes[0].offset, 0);
  assert.match(loop.keyframes[0].implied, /identity/);
  assert.equal(loop.keyframes.at(-1).value.rotateDeg, 360);
});

/* ------------------------------------------------------------------ *
 * honesty: what it refuses to invent
 * ------------------------------------------------------------------ */

test('the draft does not pretend to be complete', () => {
  // A draft may well be generatable — every required value resolved. What it
  // must never do is claim there is nothing left to decide.
  const v = validateContract(ctx.contract, ctx.tokens);
  assert.ok(v.questions.length > 0, 'an imported draft should carry open questions');
  assert.ok(v.counts.warning > 0);
});

test('undecidable state styling surfaces as a question per variant', () => {
  const v = validateContract(ctx.contract, ctx.tokens);
  const joined = v.questions.join('\n');
  for (const variant of ['secondary', 'ghost', 'destructive']) {
    assert.match(joined, new RegExp(`"${variant}".*(hover|pressed|disabled)`, 'i'));
  }
});

test('a genuinely missing value blocks generation', () => {
  // Warnings do not block — a variant with no state overrides is unusual but
  // valid. A missing REQUIRED value is a different matter: it would become a
  // guess on two platforms.
  const broken = structuredClone(ctx.contract);
  delete broken.appearance.bySize.md.padX;

  for (const platform of ['ios', 'android']) {
    const { artifact } = resolve(broken, ctx.tokens, platform);
    assert.equal(checkClosed(artifact).closed, false, `${platform} must be blocked`);
  }
  // …while the untouched draft still generates.
  for (const platform of ['ios', 'android']) {
    assert.equal(checkClosed(resolve(ctx.contract, ctx.tokens, platform).artifact).closed, true, platform);
  }
});

test('every derived claim cites evidence from the source', () => {
  for (const d of ctx.report.derived) {
    assert.ok(d.path, 'a derived field must say what it set');
    assert.ok(d.from, 'a derived field must say where it came from');
  }
  assert.ok(ctx.report.derived.length > 30, 'the fixture should yield a substantial draft');
});

test('unmatched values are reported rather than silently dropped', () => {
  assert.ok(Array.isArray(ctx.report.skipped));
  for (const s of ctx.report.skipped) {
    assert.ok(s.what && s.why);
  }
});

test('the importer discloses the judgement calls it made', () => {
  const notes = ctx.report.notes.join('\n');
  assert.match(notes, /state styling in css is not variant-scoped/i);
});

test('no interaction logic is invented', () => {
  // Which event moves a component between states, and under what condition, is
  // not expressed in CSS or prop types. An earlier version generated a whole
  // state machine — PRESS, RELEASE_INSIDE, BLUR, and a guard expression — none
  // of which existed in the source.
  assert.deepEqual(ctx.contract.behavior.states, {});
  assert.deepEqual(ctx.contract.behavior.guards, {});
});

test('no hit area or keyboard map is invented', () => {
  assert.ok(!ctx.contract.hitArea, 'a touch-target strategy is a decision, not a reading');
  assert.deepEqual(ctx.contract.a11y.keyboard, [], 'nothing declares a keyboard map');
});

/* ------------------------------------------------------------------ *
 * re-import: the code moves, the answers stay
 * ------------------------------------------------------------------ */

test('focus is derived even when its rule only sets an outline', () => {
  // `:focus-visible { outline: ... }` produces no colour role, so deriving the
  // state list from matched roles alone silently loses focus.
  assert.ok(ctx.contract.states.includes('focused'));
  assert.ok(ctx.contract.appearance.focusRing, 'the ring itself is read');
});

test('re-import preserves answers that were never in the code', () => {
  const answered = structuredClone(ctx.contract);
  answered.description = 'A single-action control.';
  answered.appearance.byVariant.ghost.hover = { fill: '{surface.muted}' };
  answered.appearance.bySize.md.lineHeight = '{lineHeight.md}';

  const { contract, merge } = mergeDraft(answered, ctx.contract);

  assert.equal(contract.description, 'A single-action control.');
  assert.deepEqual(contract.appearance.byVariant.ghost.hover, { fill: '{surface.muted}' });
  assert.equal(contract.appearance.bySize.md.lineHeight, '{lineHeight.md}');
  assert.ok(merge.preserved.length > 0);
});

test('re-import takes the new value when the code changed', () => {
  const answered = structuredClone(ctx.contract);
  const draft = structuredClone(ctx.contract);
  draft.appearance.byVariant.primary.default.fill = '{danger.500}';

  const { contract, merge } = mergeDraft(answered, draft);

  assert.equal(contract.appearance.byVariant.primary.default.fill, '{danger.500}');
  assert.ok(merge.updated.some((u) => u.includes('{brand.500} → {danger.500}')));
});

test('re-import drops things the code removed, and says so', () => {
  const answered = structuredClone(ctx.contract);
  answered.appearance.byVariant.legacy = { default: { fill: '{brand.500}' } };

  const draft = structuredClone(ctx.contract);
  const { contract, merge } = mergeDraft(answered, draft);

  assert.ok(!contract.appearance.byVariant.legacy, 'a deleted variant must not resurrect');
  assert.ok(merge.dropped.some((d) => d.includes('legacy')));
});

test('re-import keeps a hand-added adaptable envelope', () => {
  // The importer never creates these, but once a human adds one it must
  // survive the code changing underneath it.
  const answered = structuredClone(ctx.contract);
  answered.adaptable.pressFeedback = {
    intent: 'a deliberate, human-written intent',
    envelope: { allowed: ['ripple', 'scale'], maxDurationMs: 120 },
    fallback: { type: 'scale', to: 0.97 },
  };

  const { contract } = mergeDraft(answered, ctx.contract);

  assert.equal(contract.adaptable.pressFeedback.intent, 'a deliberate, human-written intent');
  assert.equal(contract.adaptable.pressFeedback.envelope.maxDurationMs, 120);
});

test('re-import keeps a hand-written state machine', () => {
  // Import leaves behaviour empty. Once someone writes it, a re-import must
  // not wipe it just because the code cannot express it.
  const answered = structuredClone(ctx.contract);
  answered.behavior = {
    initial: 'idle',
    guards: {},
    states: {
      idle: { on: { PRESS: { target: 'pressed' } } },
      pressed: { on: { RELEASE_INSIDE: { target: 'idle', actions: ['emit:onClick'] } } },
      focused: { on: {} },
      disabled: { on: {} },
      loading: { on: {} },
    },
  };

  const { contract } = mergeDraft(answered, ctx.contract);

  assert.deepEqual(contract.behavior.states.pressed.on.RELEASE_INSIDE.actions, ['emit:onClick']);
});

test('re-import does not resurrect a state the code deleted', () => {
  const answered = structuredClone(ctx.contract);
  answered.appearance.byVariant.primary.hover = { fill: '{brand.600}' };

  const draft = structuredClone(ctx.contract);
  draft.states = draft.states.filter((s) => s !== 'hover');

  const { contract, merge } = mergeDraft(answered, draft);

  assert.ok(!contract.appearance.byVariant.primary.hover);
  assert.ok(merge.dropped.some((d) => d.includes('hover')));
});

test('answering a question makes it go away, and it survives a re-import', () => {
  const before = validateContract(ctx.contract, ctx.tokens);
  const target = before.findings.find((f) => f.code === 'appearance.state.identical');
  assert.ok(target, 'the fixture should leave at least one state question open');

  const { variant, state } = target.answer.context;
  const answered = structuredClone(ctx.contract);
  answered.description = 'A single-action control.';
  // "Looks the same at rest" is recorded as an explicit empty block.
  answered.appearance.byVariant[variant][state] = {};

  const direct = validateContract(answered, ctx.tokens);
  assert.ok(
    direct.questions.length < before.questions.length,
    `expected fewer than ${before.questions.length}, got ${direct.questions.length}`
  );

  // Re-importing must not resurrect it.
  const { contract } = mergeDraft(answered, ctx.contract);
  const after = validateContract(contract, ctx.tokens);
  assert.equal(after.questions.length, direct.questions.length);
  assert.ok(!after.questions.includes(target.question));
});

/* ------------------------------------------------------------------ *
 * picking a folder in the browser
 * ------------------------------------------------------------------ */

test('a folder picked in the browser imports identically to one on disk', async () => {
  // Browsers never expose an absolute path, so the UI sends file contents.
  // Both entry points must land on exactly the same contract, or the tool
  // behaves differently depending on how you added the component.
  const { readFile } = await import('node:fs/promises');
  const files = await Promise.all(
    ctx.sources.all.map(async (f) => ({
      name: `Button/${f.name}`,
      content: await readFile(f.path, 'utf8'),
    }))
  );

  const fromFolder = importFromSources({
    sources: sourcesFromFiles(files),
    cssPrefix: ctx.config.cssPrefix,
    id: 'imported-button',
  });

  assert.deepEqual(fromFolder.contract, ctx.contract);
  assert.equal(fromFolder.report.coverage.derived, ctx.report.coverage.derived);
});

test('sourcesFromFiles partitions code and styles the same way as disk', () => {
  const sources = sourcesFromFiles([
    { name: 'Button/Button.tsx', content: 'x' },
    { name: 'Button/button.css', content: 'y' },
    { name: 'Button/readme.md', content: 'z' },
  ]);
  assert.deepEqual(sources.code.map((f) => f.name), ['Button.tsx']);
  assert.deepEqual(sources.styles.map((f) => f.name), ['button.css']);
  assert.equal(sources.all.length, 3);
});

test('an empty or unusable file set yields no sources', () => {
  assert.equal(sourcesFromFiles([]).all.length, 0);
  assert.equal(sourcesFromFiles(null).all.length, 0);
  // Entries without content are ignored rather than crashing the import.
  assert.equal(sourcesFromFiles([{ name: 'a.tsx' }]).all.length, 0);
});

/* ------------------------------------------------------------------ *
 * events
 * ------------------------------------------------------------------ */

test('no event name is ever invented', async () => {
  // `pressed` is an internal visual state, not something a component raises.
  // An earlier version hardcoded `emit:onPress`, which put a phantom event in
  // the contract that existed nowhere in the source.
  const declared = new Set(
    Object.entries(ctx.contract.props)
      .filter(([, d]) => d.kind === 'event')
      .map(([name]) => name)
  );

  for (const node of Object.values(ctx.contract.behavior.states)) {
    for (const t of Object.values(node.on || {})) {
      for (const action of (typeof t === 'object' && t.actions) || []) {
        if (!action.startsWith('emit:')) continue;
        const name = action.slice(5);
        assert.ok(declared.has(name), `"${name}" is emitted but never declared as a prop`);
      }
    }
  }
});

test('a native element brings its activation handler, and only that', async () => {
  const { extractProps, NATIVE_ACTIVATION } = await import('../src/core/import/extract.js');
  const src = ctx.sources.code.map((f) => f.content).join('\n');
  const { extends: inherits } = extractProps(src);

  // The fixture declares its own onClick rather than extending, so there is
  // nothing to inherit — the mapping itself is what matters here.
  assert.equal(NATIVE_ACTIVATION.Button.event, 'onClick');
  assert.equal(NATIVE_ACTIVATION.Input.event, 'onChange');
  assert.ok(!('onMouseEnter' in NATIVE_ACTIVATION), 'only the activation handler is taken');
  void inherits;
});

test('an omitted handler is not inherited', async () => {
  const { extractProps } = await import('../src/core/import/extract.js');
  const { extends: inherits } = extractProps(`
    export interface XProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
      label: string;
    }
  `);
  assert.equal(inherits.element, 'Button');
  assert.ok(inherits.omitted.includes('onClick'), 'the Omit list must be respected');
});

/* ------------------------------------------------------------------ *
 * element tree
 * ------------------------------------------------------------------ */

test('an aria-label is an accessible name, never a visible child', async () => {
  // The bug this guards: a prop passed to `aria-label` was recorded as a text
  // child, so a spinbutton's accessible name was drawn on screen.
  const { extractJsxTree, compositionFromTree } = await import('../src/core/import/jsx.js');
  const { extractProps } = await import('../src/core/import/extract.js');

  const src = `
    export interface XProps {
      label?: string;
      value?: number;
    }
    export function X({ label, value }: XProps) {
      return (
        <div className="ds-x">
          <div className="ds-x__value" role="spinbutton" aria-label={label}>{value}</div>
        </div>
      );
    }`;

  const { props } = extractProps(src);
  const tree = compositionFromTree(extractJsxTree(src), props);
  const node = tree.children[0];

  assert.equal(node.role, 'spinbutton');
  assert.equal(node.a11y.label, 'prop:label', 'the label is announced');
  assert.equal(node.content, 'prop:value', 'the value is what is rendered');
  assert.ok(node.content !== 'prop:label', 'the label must never be the content');
});

test('the tree preserves nesting, not a flat list of class names', async () => {
  const { extractJsxTree, compositionFromTree } = await import('../src/core/import/jsx.js');
  const src = `
    export function X() {
      return (
        <div className="ds-x">
          <button className="ds-x__button" aria-label="Less"><Icon /></button>
          <button className="ds-x__button" aria-label="More"><Icon /></button>
        </div>
      );
    }`;
  const tree = compositionFromTree(extractJsxTree(src), {});
  assert.equal(tree.name, 'root');
  assert.equal(tree.children.length, 2);
  assert.equal(tree.children[0].children.length, 1, 'the icon is nested inside the button');
  // Siblings sharing a class are told apart by their accessible names.
  assert.notEqual(tree.children[0].name, tree.children[1].name);
});

test('the JSX return is found past other returns in the file', async () => {
  const { extractJsxTree } = await import('../src/core/import/jsx.js');
  const src = `
    export function X() {
      useEffect(() => () => cleanup(), []);
      const helper = () => { return { a: 1 }; };
      return (<div className="ds-x"><span /></div>);
    }`;
  const tree = extractJsxTree(src);
  assert.ok(tree, 'a cleanup function or object return must not be mistaken for markup');
  assert.equal(tree.tag, 'div');
});
