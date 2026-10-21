/** Counter's visual requirements must survive source -> contract -> both JSON files. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { importFromPath, mergeDraft } from '../src/core/import/index.js';
import { tokenIndexFor, loadConfig } from '../src/core/build.js';
import { resolve, checkClosed } from '../src/core/resolve.js';
import { emitPlatformJson } from '../src/core/emit/platform.js';
import { extractVisualRules } from '../src/core/import/visual.js';
import { TokenMatcher } from '../src/core/import/tokenmatch.js';
import { validateContract } from '../src/core/validate.js';

const { contract } = await importFromPath({ path: fileURLToPath(new URL('./fixtures/Counter', import.meta.url)) });
const config = await loadConfig(fileURLToPath(new URL('..', import.meta.url)));
const tokens = tokenIndexFor(contract, config);
const specs = ['ios', 'android'].map((platform) => {
  const { artifact } = resolve(contract, tokens, platform);
  return { platform, artifact, doc: JSON.parse(emitPlatformJson(artifact, { contract })) };
});

const node = (doc, name) => doc.nodes.find((n) => n.name === name);

test('both platforms retain root geometry, border, fill and the actual child order', () => {
  for (const { artifact, doc } of specs) {
    assert.equal(checkClosed(artifact).closed, true);

    const root = node(doc, 'root');
    assert.deepEqual(root.children, ['button', 'value', 'button2']);
    assert.deepEqual(root.layout.container, { kind: 'stack', crossAlign: 'center', axis: 'horizontal' });

    // calc() keeps every token operand; nothing is flattened to a guessed number.
    assert.deepEqual(root.layout.size.width, {
      mode: 'fixed',
      value: { expression: '2 * {semantic.size.40} + {semantic.size.24}', syntax: 'arithmetic' },
    });
    assert.deepEqual(root.layout.size.height, { mode: 'fixed', value: '{semantic.size.32}' });
    assert.equal(root.layout.size.includesBorderAndPadding, true);

    assert.deepEqual(root.appearance.border, {
      style: 'solid',
      width: '{semantic.border.width.default}',
      color: '{semantic.color.border.moderate}',
    });
    assert.equal(root.appearance.cornerRadius, '{semantic.border.radius.8}');
    assert.equal(root.appearance.background, '{semantic.color.background.default}');
    assert.equal(root.layout.padding, undefined, 'child padding must not leak into the root');

    assert.equal(doc.styles[0].borderColor, '{semantic.color.border.moderate}');
    assert.ok(doc.tokens['semantic.size.40']);
    assert.ok(doc.tokens['semantic.size.24']);

    // fullWidth is a prop, and the spec says so rather than leaving a reader to guess.
    const full = root.conditional.find((c) => c.when.some((w) => w.attribute === 'data-full-width'));
    assert.deepEqual(full.layout.size.width, { mode: 'fill' });
    assert.deepEqual(full.when[0].driver, { prop: 'fullWidth' });
  }
});

test('child layout and disabled colour remain scoped to their node and condition', () => {
  for (const { doc } of specs) {
    const button = node(doc, 'button');

    // flex: 1 1 0 in a horizontal stack is a share of the main axis, and
    // align-self: stretch is the full cross axis - stated for THIS parent.
    assert.deepEqual(button.layout.size.width, { mode: 'flex', grow: 1, shrink: 1, basis: 0 });
    assert.deepEqual(button.layout.size.height, { mode: 'fill' });
    assert.deepEqual(button.layout.padding, {
      top: '{semantic.spacing.0}', right: '{semantic.spacing.0}',
      bottom: '{semantic.spacing.0}', left: '{semantic.spacing.0}',
    });
    assert.equal(button.appearance.border.width, 0);
    assert.equal(button.appearance.background, 'none');
    assert.equal(button.appearance.foreground, '{semantic.color.icon.brand.primary}');

    const disabled = button.conditional.find((c) => c.when.some((w) => w.attribute === 'aria-disabled'));
    assert.equal(disabled.appearance.foreground, '{semantic.color.disabled.icon}');
    assert.equal(disabled.when[0].equals, 'true');

    const value = node(doc, 'value');
    assert.deepEqual(value.layout.size.width, { mode: 'fixed', value: '{semantic.size.24}' });
    // Text is one token, as colour is, and the five it stands for are not repeated.
    assert.equal(value.appearance.typography, '{semantic.typography.label.l}');
    assert.equal(value.appearance.text.family, undefined);
    assert.equal(value.appearance.text.numericFigures, 'tabular');

    // The icons only size to their content.
    assert.deepEqual(node(doc, 'icon').layout.size, { width: { mode: 'hug' }, height: { mode: 'hug' } });
  }
});

test('hit areas and focus rings are first-class, and never the visible box', () => {
  for (const { doc } of specs) {
    assert.equal(doc.hitAreas.length, 2);
    const h = doc.hitAreas[0];
    assert.deepEqual(h.min, { width: '{semantic.size.48}', height: '{semantic.size.48}' });
    assert.equal(h.centered, true);
    assert.equal(h.affectsLayout, false);
    assert.equal(h.atLeastNodeBox, true);
    // Removed while the control is unavailable, so it cannot swallow nearby taps.
    assert.equal(h.removedWhen[0][0].attribute, 'aria-disabled');

    // None of that leaks into the node's own box.
    assert.equal(node(doc, 'button').layout.size.min, undefined);

    assert.equal(doc.focusRings.length, 3, 'grouped selectors must reach both buttons and the value');
    const ring = doc.focusRings[0];
    assert.equal(ring.color, '{semantic.color.border.brand}');
    assert.equal(ring.width.expression, '2 * {semantic.border.width.default}');
    assert.equal(ring.offset.expression, '-1 * ({semantic.border.width.default} + {semantic.spacing.2})');
    assert.equal(ring.cornerRadiusWhileFocused.expression, '{semantic.border.radius.8} - {semantic.spacing.2}');
    assert.ok(doc.tokens['semantic.spacing.2']);

    // The ring's radius is told once, not also as a change to the node.
    assert.ok(!node(doc, 'button').conditional.some((c) => c.appearance?.cornerRadius));
  }
});

test('every animation says what it animates to, and nothing names a bare "transform"', () => {
  for (const { doc } of specs) {
    assert.equal(doc.animations.length, 3);
    assert.equal(doc.motion, undefined, 'the old target-less motion list is gone');

    for (const a of doc.animations) {
      assert.equal(a.property, 'transform');
      assert.deepEqual(a.rest.value, { scale: 1 }, 'the start is the identity, and says where that came from');
      assert.match(a.rest.from, /identity/);
      assert.ok(a.changes.length, 'a transform animation with no target must not exist');
      for (const c of a.changes) {
        assert.ok(c.to && typeof c.to.scale === 'number', 'the target is an explicit scale');
        assert.ok(c.when.length, 'and it says when it applies');
      }
      assert.deepEqual(a.timing.curve, { type: 'cubicBezier', value: [0, 0, 1, 1], named: 'linear' });
      assert.equal(a.timing.durationMs, 100);

      // 0.01ms is what the stylesheet says; it is also, in effect, instant.
      assert.equal(a.reducedMotion.durationMs, 0.01);
      assert.equal(a.reducedMotion.effectivelyInstant, true);
    }

    const press = doc.animations.find((a) => a.node === 'icon');
    assert.deepEqual(press.changes[0].to, { scale: 0.9 });
    assert.ok(press.changes[0].when.some((w) => w.node === 'button' && w.state === 'pressed'));
    assert.ok(press.changes[0].when.some((w) => w.attribute === 'aria-disabled' && w.negate));

    // The value "pop": scale up, then back, driven by a source-backed state.
    const pop = doc.animations.find((a) => a.node === 'value');
    assert.deepEqual(pop.changes[0].to, { scale: 1.1 });
    const driver = pop.changes[0].when[0].driver;
    assert.equal(driver.state, 'pop');
    assert.deepEqual(driver.activatedIn, ['setValue']);
    assert.equal(driver.resetAfterMs, 100);
    assert.deepEqual(
      pop.changes[0].timeline.singleShot.map((s) => [s.atMs, s.flag, s.overMs]),
      [[0, true, 100], [100, false, 100]],
    );
  }
});

test('a condition set by a helper is traced to the quoted logic, not called unknown and not evaluated', () => {
  // aria-disabled comes from `{...buttonProps(-step, atMin)}`. The tool does not
  // evaluate that, but it can say exactly which statements decide it, so a team
  // is pointed at them instead of being told to "read the source".
  for (const { doc } of specs) {
    assert.deepEqual(doc.unresolvedConditions, [], 'the cause is located, so nothing is unresolved');

    const driverOf = (name) => node(doc, name).conditional
      .find((c) => c.when.some((w) => w.attribute === 'aria-disabled')).when[0].driver;
    assert.deepEqual(driverOf('button'), { spread: 'buttonProps(-step, atMin)', logic: ['buttonProps', 'atMin'] });
    assert.deepEqual(driverOf('button2'), { spread: 'buttonProps(step, atMax)', logic: ['buttonProps', 'atMax'] });

    // ...and the statements it points at are really there, quoted exactly.
    const entry = (name) => doc.behaviorSource.entries.find((e) => e.name === name);
    assert.match(entry('buttonProps').source, /'aria-disabled': blocked \|\| undefined/);
    assert.match(entry('buttonProps').source, /const blocked = frozen \|\| unavailable;/);
    assert.equal(entry('atMin').source, 'const atMin = value <= min;');
    assert.equal(entry('atMax').source, 'const atMax = value >= max;');

    // A prop-driven and a state-driven attribute are resolved as before.
    assert.ok(!doc.unresolvedConditions.some((u) => u.attribute === 'data-full-width'));
    assert.ok(!doc.unresolvedConditions.some((u) => u.attribute === 'data-pop'));
  }
});

test('behaviour that is logic, not style, is quoted for the team to translate', () => {
  // The gaps both reviewers rated highest: when each button is disabled, what
  // holding it does, which keys act on it, how the default labels are built.
  for (const { doc } of specs) {
    const names = doc.behaviorSource.entries.map((e) => e.name);
    for (const expected of ['buttonProps', 'startHold', 'nudge', 'setValue', 'onKeyDown', 'atMin', 'atMax', 'decrementName', 'incrementName', 'clamp']) {
      assert.ok(names.includes(expected), `${expected} is reachable from the markup and must be quoted`);
    }
    const entry = (name) => doc.behaviorSource.entries.find((e) => e.name === name);

    // Hold-to-repeat: the first step is immediate, then it repeats. No initial delay.
    assert.match(entry('startHold').source, /nudge\(delta\);\s*stopHold\(\);\s*holdTimer\.current = setInterval\(\(\) => nudge\(delta\), HOLD_INTERVAL_MS\)/);
    // The keyboard map, and what the bound does, are in the quoted text.
    assert.match(entry('onKeyDown').source, /PageUp: \(\) => nudge\(large\)/);
    assert.match(entry('setValue').source, /if \(clamped === valueRef\.current\)/);
    assert.match(entry('decrementName').source, /`Decrease \$\{nameForActions\}`/);

    // Release anywhere ends the hold, and unmounting clears the timers: both are
    // effects, kept because they touch reachable logic. Found by content, not by
    // position, because the numbering follows the source order.
    const effects = doc.behaviorSource.entries.filter((e) => e.kind === 'effect');
    assert.equal(effects.length, 2);
    assert.ok(effects.some((e) => e.source.includes("addEventListener('pointerup', stopHold)")));
    assert.ok(effects.some((e) => /clearInterval|clearTimeout/.test(e.source)), 'the unmount cleanup is behaviour');

    // The state the quoted code reads and writes is quoted too: a statement that
    // names `holdTimer` or `setPop` with no declaration cannot be translated.
    const defined = new Set(doc.behaviorSource.entries.flatMap((e) => [e.name, ...(e.also || [])]));
    for (const needed of ['holdTimer', 'popTimer', 'valueRef', 'pop', 'setPop', 'uncontrolled', 'setUncontrolled', 'spinRef']) {
      assert.ok(defined.has(needed), `${needed} is read by quoted code and must be quoted`);
    }
    assert.match(entry('valueRef.current').source, /valueRef\.current = value/);
    assert.deepEqual(entry('pop').also, ['setPop']);

    // A node names the logic its own markup refers to.
    assert.deepEqual(node(doc, 'button').logic.sort(), ['atMin', 'buttonProps', 'decrementName']);
    assert.ok(node(doc, 'value').logic.includes('onKeyDown'));
  }
});

test('every stylesheet rule is accounted for, and the count is against the source', () => {
  for (const { doc } of specs) {
    assert.equal(doc.coverage.sourceRules, contract.visualRules.length);
    assert.deepEqual(doc.coverage.unplaced, []);
    assert.equal(doc.coverage.placed + doc.coverage.droppedByDesign.length, doc.coverage.sourceRules);
  }
});

test('properties that exist only in a browser are recorded, not silently dropped', () => {
  for (const { doc } of specs) {
    assert.deepEqual(doc.droppedProperties.webOnly, [
      '-webkit-tap-highlight-color', '-webkit-user-select', 'cursor', 'touch-action', 'user-select',
    ]);
    assert.deepEqual(doc.droppedProperties.unrecognised, []);
  }
});

test('axis-less re-import preserves new default styles rather than pruning them', () => {
  const old = structuredClone(contract);
  old.appearance.bySize.default.padX = '{semantic.spacing.0}';
  const { contract: merged } = mergeDraft(old, structuredClone(contract));
  assert.ok(merged.appearance.byVariant.default);
  assert.ok(merged.appearance.bySize.default);
  assert.equal(merged.visualRules.length, contract.visualRules.length);
  assert.equal(merged.appearance.bySize.default.padX, undefined);
  assert.ok(!validateContract(merged, tokens).findings.some((f) => f.code === 'layout.child.unknown'));
});

test('visual rules retain literals, media conditions and unknown selector evidence', () => {
  const { rules } = extractVisualRules(`
    .box { width: 12px; padding: 1px 2px 3px 4px; }
    @media (min-width: 600px) { .box { width: 25%; } }
    .box > .child { height: 4px; }
  `, new TokenMatcher());
  assert.deepEqual(rules[0].properties.padLeft, { value: 4, unit: 'px' });
  assert.deepEqual(rules[1].media, ['(min-width: 600px)']);
  assert.equal(rules[2].manualTranslation, true);
});

test('re-importing preserves a decision the code cannot supply, and creates nothing when there is none', () => {
  // fillGap built the parent objects on the way down whether or not it had anything to keep,
  // so every re-import left an empty `hitArea: {}` in the contract.
  const fresh = () => structuredClone(contract);
  const without = mergeDraft(fresh(), fresh()).contract;
  assert.ok(!('hitArea' in without), 'no decision, so no empty object');

  const old = fresh();
  old.hitArea = { strategy: 'expand' };
  const kept = mergeDraft(old, fresh());
  assert.equal(kept.contract.hitArea.strategy, 'expand', 'a stated decision survives');
  assert.ok(kept.merge.preserved.includes('hitArea.strategy'));
});
