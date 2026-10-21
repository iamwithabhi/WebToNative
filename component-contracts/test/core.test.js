/**
 * Core tests.
 *
 * Weighted towards the two things that would fail silently and expensively:
 * spring conversion (wrong numbers still compile and still animate) and
 * artifact closure (a gap becomes a guess on three platforms).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { convertSpring, dampingRatio, naturalFrequency, settlingTime, resolveCurve } from '../src/core/animation.js';
import { TokenIndex, applyPattern, asTokenRef } from '../src/core/tokens.js';
import { normalise, statesForPlatform, axesOf } from '../src/core/contract.js';
import { validateContract } from '../src/core/validate.js';
import { resolve, checkClosed } from '../src/core/resolve.js';
import { loadConfig, tokenIndexFor } from '../src/core/build.js';

/** The platforms this project actually ships specs for. */
const SHIPPED = ['ios', 'android'];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A complete reference contract kept with the tests.
 *
 * Deliberately NOT read from `contracts/`: that directory is the user's
 * workspace, and the suite must not depend on whatever happens to be in it.
 */
// The suite cannot run without its fixture. It has gone missing more than
// once with no code path to explain it, so fail with instructions rather than
// a bare ENOENT from 200 lines away.
{
  const { access } = await import('node:fs/promises');
  const fixture = join(ROOT, 'test/fixtures/button.contract.json');
  try {
    await access(fixture);
  } catch {
    throw new Error(
      `Missing ${fixture}\n` +
        `The test fixture is gone. Restore test/fixtures/ from a backup before running the suite.`,
    );
  }
}

const ctx = await (async () => {
  const config = await loadConfig(ROOT);
  const { readFile } = await import('node:fs/promises');
  const raw = JSON.parse(await readFile(join(ROOT, 'test/fixtures/button.contract.json'), 'utf8'));
  const contract = normalise(raw);
  // Tokens belong to the component, not to a shared library.
  const tokens = tokenIndexFor(contract, config);
  return { config, tokens, contract };
})();

/* ------------------------------------------------------------------ *
 * spring maths
 * ------------------------------------------------------------------ */

test('damping ratio matches the closed form', () => {
  // zeta = c / (2 * sqrt(k*m)) = 30 / (2*sqrt(400*1)) = 0.75
  assert.equal(dampingRatio(400, 30, 1), 0.75);
  // critically damped: c = 2*sqrt(k*m)
  assert.equal(dampingRatio(100, 20, 1), 1);
});

test('natural frequency matches the closed form', () => {
  assert.equal(naturalFrequency(400, 1), 20);
  assert.equal(naturalFrequency(400, 4), 10);
});

test('SwiftUI response is 2*pi/omega_n', () => {
  const s = convertSpring({ stiffness: 400, damping: 30, mass: 1 });
  assert.equal(s.ios.response, Number(((2 * Math.PI) / 20).toFixed(4)));
  assert.equal(s.ios.dampingFraction, 0.75);
  // interpolatingSpring takes the canonical values unchanged
  assert.deepEqual(s.ios.interpolating, { mass: 1, stiffness: 400, damping: 30 });
});

test('Compose stiffness is normalised by mass', () => {
  // Compose assumes unit mass, so stiffness must be divided through.
  const s = convertSpring({ stiffness: 800, damping: 40, mass: 2 });
  assert.equal(s.android.stiffness, 400);
  assert.equal(s.android.dampingRatio, dampingRatio(800, 40, 2));
});

test('mass-equivalent springs converge on the same platform parameters', () => {
  // Doubling k and m leaves omega_n and zeta unchanged, so every platform
  // parameterisation must be identical. This is the invariant that keeps the
  // three platforms feeling the same.
  const a = convertSpring({ stiffness: 400, damping: 30, mass: 1 });
  const b = convertSpring({ stiffness: 800, damping: 60, mass: 2 });
  assert.equal(a.ios.response, b.ios.response);
  assert.equal(a.ios.dampingFraction, b.ios.dampingFraction);
  assert.equal(a.android.stiffness, b.android.stiffness);
  assert.equal(a.android.dampingRatio, b.android.dampingRatio);
});

test('settling time shortens as damping rises', () => {
  const under = settlingTime(400, 10, 1);
  const crit = settlingTime(400, 40, 1);
  assert.ok(under > crit, 'lightly damped springs take longer to settle');
  assert.ok(crit > 0 && crit < 5);
});

test('overdamped and critically damped springs terminate', () => {
  assert.ok(Number.isFinite(settlingTime(400, 40, 1)));   // zeta = 1
  assert.ok(Number.isFinite(settlingTime(400, 100, 1)));  // zeta > 1
});

test('spring overshoot is reported', () => {
  assert.equal(convertSpring({ stiffness: 400, damping: 30, mass: 1 }).overshoots, true);
  assert.equal(convertSpring({ stiffness: 400, damping: 60, mass: 1 }).overshoots, false);
});

test('cubic bezier passes through to every platform', () => {
  const c = resolveCurve({ type: 'cubicBezier', value: [0.4, 0, 0.2, 1] });
  assert.deepEqual(c.ios.timingCurve, [0.4, 0, 0.2, 1]);
  assert.deepEqual(c.android.cubicBezierEasing, [0.4, 0, 0.2, 1]);
  assert.equal(c.web.cssEasing, 'cubic-bezier(0.4, 0, 0.2, 1)');
});

test('malformed curves are rejected rather than guessed', () => {
  assert.throws(() => resolveCurve({ type: 'cubicBezier', value: [0, 1] }));
  assert.throws(() => resolveCurve({ type: 'nope' }));
  assert.throws(() => convertSpring({ stiffness: 0, damping: 10, mass: 1 }));
});

/* ------------------------------------------------------------------ *
 * tokens
 * ------------------------------------------------------------------ */

test('symbol patterns expand per platform', () => {
  assert.equal(applyPattern('DSTokens.{path|camel}', 'brand.500'), 'DSTokens.brand500');
  assert.equal(applyPattern('DsTokens.{path|camel}', 'space.touchTarget'), 'DsTokens.spaceTouchTarget');
  assert.equal(applyPattern('var(--ds-{path|kebab})', 'brand.500'), 'var(--ds-brand-500)');
});

test('token references are distinguished from literals', () => {
  assert.equal(asTokenRef('{brand.500}'), 'brand.500');
  assert.equal(asTokenRef('transparent'), null);
  assert.equal(asTokenRef(12), null);
});

test('the token vocabulary comes from the component itself', () => {
  // No shared library. These names were read out of the component's own CSS
  // and utility classes when it was added.
  assert.ok(ctx.tokens.size > 0);
  assert.ok(ctx.tokens.has('brand.500'));
  assert.equal(ctx.tokens.typeOf('brand.500'), 'color');
  assert.equal(ctx.tokens.typeOf('space.md'), 'dimension');
});

test('a referenced-but-undeclared token is valid, just valueless', () => {
  // The component says `var(--ds-brand-500)` without declaring it. The name is
  // all code generation needs — the platform's token library holds the value.
  assert.equal(ctx.tokens.has('brand.500'), true);
  assert.equal(ctx.tokens.valueOf('brand.500'), null);
});

test('a token index can be built straight from a contract', () => {
  const idx = TokenIndex.fromContract(
    { tokens: { 'a.b': { value: '#fff', type: 'color' } } },
    { ios: { pattern: 'T.{path|camel}' } }
  );
  assert.equal(idx.size, 1);
  assert.equal(idx.valueOf('a.b'), '#fff');
  assert.equal(idx.symbolFor('a.b', 'ios'), 'T.aB');
});

/* ------------------------------------------------------------------ *
 * platform filtering
 * ------------------------------------------------------------------ */

test('hover is stripped from every touch platform', () => {
  // The contract still declares hover — it is a real web state and the engine
  // keeps supporting it. It simply never reaches a touch platform's spec.
  assert.ok(ctx.contract.states.includes('hover'));
  for (const platform of SHIPPED) {
    assert.ok(!statesForPlatform(ctx.contract, platform).includes('hover'), platform);
  }
  assert.ok(statesForPlatform(ctx.contract, 'web').includes('hover'), 'engine still supports web');
});

test('the styles matrix is fully enumerated per platform', () => {
  const axes = axesOf(ctx.contract);
  for (const platform of SHIPPED) {
    const { artifact } = resolve(ctx.contract, ctx.tokens, platform);
    const expected =
      axes.variant.length * axes.size.length * statesForPlatform(ctx.contract, platform).length;
    assert.equal(artifact.styles.length, expected, `${platform} row count`);
  }
});

test('motion referencing a dropped state is removed, not left dangling', () => {
  const { artifact } = resolve(ctx.contract, ctx.tokens, 'ios');
  assert.ok(!artifact.motion.some((m) => m.from === 'hover' || m.to === 'hover'));
  assert.ok(artifact.motion.some((m) => m.to === 'pressed'), 'press motion survives');
});

test('unsupported props are omitted entirely rather than annotated', () => {
  // fullWidth is web-shaped. Native specs must not carry it at all — not even
  // as a note saying "use a modifier", which would be prose to interpret.
  for (const platform of SHIPPED) {
    const { artifact } = resolve(ctx.contract, ctx.tokens, platform);
    assert.ok(!artifact.props.some((p) => p.name === 'fullWidth'), platform);
  }
});

test('prop names are remapped per platform', () => {
  const ios = resolve(ctx.contract, ctx.tokens, 'ios').artifact;
  const icon = ios.props.find((p) => p.sourceName === 'iconStart');
  assert.equal(icon.name, 'leadingIcon');
});

test('android-only mechanisms are filtered out of other platforms', () => {
  const ios = resolve(ctx.contract, ctx.tokens, 'ios').artifact;
  const android = resolve(ctx.contract, ctx.tokens, 'android').artifact;
  assert.ok(!ios.adaptable.pressFeedback.envelope.allowed.includes('ripple'));
  assert.ok(android.adaptable.pressFeedback.envelope.allowed.includes('ripple'));
});

test('every adaptable field carries a fallback, so no team must decide', () => {
  for (const platform of SHIPPED) {
    const { artifact } = resolve(ctx.contract, ctx.tokens, platform);
    for (const [name, def] of Object.entries(artifact.adaptable)) {
      assert.ok(def.fallback, `${platform}/${name} needs a fallback`);
      assert.ok(def.envelope, `${platform}/${name} needs an envelope`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * cascade
 * ------------------------------------------------------------------ */

test('state deltas layer over the default block', () => {
  const { artifact } = resolve(ctx.contract, ctx.tokens, 'ios');
  const idle = artifact.styles.find((r) => r.variant === 'primary' && r.size === 'md' && r.state === 'idle');
  const pressed = artifact.styles.find((r) => r.variant === 'primary' && r.size === 'md' && r.state === 'pressed');

  // `brand.500` came from a utility class, `ds.brand.700` from a custom
  // property — with no cssPrefix set, the property keeps its full name.
  assert.equal(idle.fill, '{brand.500}');
  assert.equal(pressed.fill, '{ds.brand.700}', 'pressed overrides fill');
  assert.equal(pressed.labelColor, idle.labelColor, 'unspecified roles inherit');
});

test('size metrics apply across every variant and state', () => {
  const { artifact } = resolve(ctx.contract, ctx.tokens, 'ios');
  for (const row of artifact.styles.filter((r) => r.size === 'lg')) {
    assert.equal(row.padX, '{space.lg}');
  }
});

test('token paths carry the declared type, so consumers need not guess', () => {
  // Values are usually unknown, so a Swift or Kotlin type inferred from the
  // value would make every colour a CGFloat.
  const { artifact } = resolve(ctx.contract, ctx.tokens, 'ios');
  assert.equal(artifact.tokenTypes['brand.500'], 'color');
  assert.equal(artifact.tokenTypes['space.md'], 'dimension');
});

/* ------------------------------------------------------------------ *
 * closure — the --strict gate
 * ------------------------------------------------------------------ */

test('the reference contract closes on every platform', () => {
  for (const platform of SHIPPED) {
    const { artifact } = resolve(ctx.contract, ctx.tokens, platform);
    const { closed, problems } = checkClosed(artifact);
    assert.ok(closed, `${platform} not closed: ${problems.slice(0, 3).join('; ')}`);
  }
});

test('a missing role is caught as unresolved rather than shipped as null', () => {
  const broken = structuredClone(ctx.contract);
  delete broken.appearance.byVariant.primary.default.fill;
  const { artifact } = resolve(broken, ctx.tokens, 'ios');
  const { closed, problems } = checkClosed(artifact);
  assert.equal(closed, false);
  assert.ok(problems.some((p) => p.includes('fill is unresolved')));
});

test('a missing size metric is caught', () => {
  const broken = structuredClone(ctx.contract);
  delete broken.appearance.bySize.md.radius;
  const { closed } = checkClosed(resolve(broken, ctx.tokens, 'ios').artifact);
  assert.equal(closed, false);
});

test('resolution is deterministic', () => {
  const a = JSON.stringify(resolve(ctx.contract, ctx.tokens, 'ios').artifact);
  const b = JSON.stringify(resolve(ctx.contract, ctx.tokens, 'ios').artifact);
  assert.equal(a, b, 'same input must produce byte-identical output for CI diffing');
});

/* ------------------------------------------------------------------ *
 * validation
 * ------------------------------------------------------------------ */

test('the reference contract validates clean', () => {
  const v = validateContract(ctx.contract, ctx.tokens);
  assert.equal(v.ok, true, v.findings.filter((f) => f.severity === 'error').map((f) => f.message).join('; '));
});

test('a token outside the component vocabulary is an error', () => {
  const broken = structuredClone(ctx.contract);
  broken.appearance.byVariant.primary.default.fill = '{does.not.exist}';
  const v = validateContract(broken, tokenIndexFor(broken, ctx.config));
  assert.equal(v.ok, false);
  assert.ok(v.findings.some((f) => f.code === 'token.missing'));
});

test('an undeclared value does not block generation', () => {
  // Every token in the fixture is referenced without a declared value. If that
  // blocked closure, nothing would ever generate.
  const declared = Object.values(ctx.contract.tokens).filter((t) => t.value != null);
  assert.equal(declared.length, 0, 'the fixture declares no token values');
  for (const platform of SHIPPED) {
    assert.equal(checkClosed(resolve(ctx.contract, ctx.tokens, platform).artifact).closed, true, platform);
  }
});

test('a transition without reducedMotion is rejected', () => {
  const broken = structuredClone(ctx.contract);
  delete broken.motion.transitions[0].reducedMotion;
  const v = validateContract(broken, ctx.tokens);
  assert.ok(v.findings.some((f) => f.code === 'motion.reducedMotion'));
});

test('unsafe animated properties are rejected with a reason', () => {
  const broken = structuredClone(ctx.contract);
  broken.motion.transitions[0].properties = ['blur'];
  const v = validateContract(broken, ctx.tokens);
  const finding = v.findings.find((f) => f.code === 'motion.unsafe');
  assert.ok(finding);
  assert.match(finding.message, /differ substantially per platform/);
});

test('an adaptable field without a fallback is rejected', () => {
  const broken = structuredClone(ctx.contract);
  delete broken.adaptable.pressFeedback.fallback;
  const v = validateContract(broken, ctx.tokens);
  assert.ok(v.findings.some((f) => f.code === 'adaptable.fallback'));
});

test('unresolved fields surface as plain-language questions', () => {
  const broken = structuredClone(ctx.contract);
  delete broken.appearance.byVariant.ghost.default.labelColor;
  delete broken.a11y.minTargetSize;
  const v = validateContract(broken, ctx.tokens);
  assert.ok(v.questions.some((q) => /labelColor.*ghost|ghost.*labelColor/i.test(q)));
  assert.ok(v.questions.some((q) => /touch target/i.test(q)));
});

test('a sub-guidance touch target warns instead of being silently raised', () => {
  // The component sets min-height: 44px. Android guidance is 48dp, so the tool
  // reports the gap — and still uses 44, because raising it would be the tool
  // making a design decision.
  const { artifact, diagnostics } = resolve(ctx.contract, ctx.tokens, 'android');
  const warn = diagnostics.find((d) => d.level === 'warning');
  assert.ok(warn, 'expected a warning about Android guidance');
  assert.match(warn.message, /48dp/);
  assert.equal(artifact.hitArea.min, 44);
});

/* ------------------------------------------------------------------ *
 * animatable properties + role mapping
 * ------------------------------------------------------------------ */

test('transform is a safe animatable property, not a warning', () => {
  const c = structuredClone(ctx.contract);
  c.motion.transitions.push({
    on: '*->pressed',
    properties: ['transform'],
    duration: 120,
    curve: { type: 'cubicBezier', value: [0.4, 0, 0.2, 1] },
    reducedMotion: 'instant',
  });
  const v = validateContract(c, ctx.tokens);
  assert.ok(!v.findings.some((f) => /transform.*safe set/i.test(f.message)));
});

test('animated properties carry a per-platform name', () => {
  // `transform` is the CSS umbrella; each platform expresses it differently.
  const c = structuredClone(ctx.contract);
  c.motion.transitions.push({
    on: '*->pressed',
    properties: ['transform', 'opacity'],
    duration: 120,
    curve: { type: 'cubicBezier', value: [0.4, 0, 0.2, 1] },
    reducedMotion: 'instant',
  });
  const android = resolve(c, ctx.tokens, 'android').artifact.motion.find((m) => m.properties.includes('transform'));
  assert.deepEqual(android.platformProperties, ['graphicsLayer', 'alpha']);
  const ios = resolve(c, ctx.tokens, 'ios').artifact.motion.find((m) => m.properties.includes('transform'));
  assert.deepEqual(ios.platformProperties, ['transformEffect', 'opacity']);
});

test('the group role maps to an accessibility container per platform', () => {
  const c = structuredClone(ctx.contract);
  c.a11y.role = 'group';
  const v = validateContract(c, ctx.tokens);
  assert.ok(!v.findings.some((f) => /no known platform mapping/i.test(f.message)), 'group must be mapped');

  assert.equal(resolve(c, ctx.tokens, 'ios').artifact.a11y.container, 'contain');
  assert.equal(resolve(c, ctx.tokens, 'android').artifact.a11y.container, 'mergeDescendants');
});

test('every declared role has a resolver mapping', () => {
  // The validator's role list and the resolver's mapping table must agree, or
  // a role can pass validation and then resolve to nothing.
  const c = structuredClone(ctx.contract);
  for (const role of state_A11Y_ROLES()) {
    c.a11y.role = role;
    const { artifact } = resolve(c, ctx.tokens, 'ios');
    assert.ok(artifact.a11y && Object.keys(artifact.a11y).length, `role "${role}" resolved to nothing`);
  }
});

function state_A11Y_ROLES() {
  return [
    'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'textfield', 'image',
    'header', 'slider', 'progressbar', 'group', 'radiogroup', 'list', 'listitem',
    'menu', 'menuitem', 'tablist', 'toolbar', 'region', 'search', 'separator',
    'dialog', 'alert', 'none',
  ];
}

/* ------------------------------------------------------------------ *
 * role translation
 * ------------------------------------------------------------------ */

test('spinbutton has no native role, so it maps to what each platform does have', async () => {
  // iOS has no "spinbutton". An adjustable value is the adjustable trait;
  // Compose has no Role for it either, so the value rides on a state
  // description. Different mechanisms, identical obligation.
  const { platformRole } = await import('../src/core/resolve.js');

  const ios = platformRole('spinbutton', 'ios');
  assert.equal(ios.kind, 'traits');
  assert.deepEqual(ios.concept, ['adjustable']);
  assert.equal(ios.text, '.adjustable', 'the platform spelling is kept for display');

  const android = platformRole('spinbutton', 'android');
  assert.equal(android.kind, 'semantics');
  assert.equal(android.concept, 'stateDescription');

  // The obligation does not differ by platform, so neither should its name.
  assert.deepEqual(ios.actions, ['increment', 'decrement']);
  assert.deepEqual(android.actions, ['increment', 'decrement']);
});

test('an ARIA role never reaches a platform file untranslated', async () => {
  const { platformRole } = await import('../src/core/resolve.js');
  for (const role of ['button', 'spinbutton', 'group', 'slider', 'checkbox', 'combobox']) {
    for (const platform of SHIPPED) {
      const r = platformRole(role, platform);
      assert.ok(r.text, `${role} has no ${platform} expression`);
      assert.notEqual(r.text, role, `${role} passed through untranslated on ${platform}`);
    }
  }
});

test('a role with no equivalent is flagged rather than passed through', async () => {
  const { platformRole } = await import('../src/core/resolve.js');
  const r = platformRole('marquee', 'ios');
  assert.equal(r.unmapped, true);
  assert.equal(r.text, null);
  assert.equal(r.source, 'marquee');
});

/* ------------------------------------------------------------------ *
 * the mapping table
 * ------------------------------------------------------------------ */

test('every web to platform mapping lives in one file', async () => {
  // These were spread across the resolver, the contract model, the extractors
  // and the emitters, which made "maintained once" true in principle only.
  const map = await import('../src/core/platform-map.js');
  for (const name of [
    'A11Y_ROLE_MAP',
    'A11Y_STATE_MAP',
    'MECHANISM_PLATFORMS',
    'TARGET_FLOOR',
    'TARGET_UNIT',
    'ANIMATABLE_PROPERTY',
    'POINTER_ONLY_STATES',
    'CSS_PROP_ROLE',
    'PSEUDO_STATE',
    'UTILITY_ROLES',
    'NATIVE_ACTIVATION',
  ]) {
    assert.ok(map[name], `${name} must be exported from platform-map.js`);
  }
});

test('every role in the accepted list has a mapping for every platform', async () => {
  const { A11Y_ROLES, platformRole } = await import('../src/core/platform-map.js');
  for (const role of A11Y_ROLES) {
    for (const platform of SHIPPED) {
      const r = platformRole(role, platform);
      assert.ok(r, `${role} returned nothing for ${platform}`);
      assert.ok(!r.unmapped, `${role} is unmapped on ${platform}`);
      assert.ok(r.text, `${role} has no expression on ${platform}`);
    }
  }
});

test('nothing in the mapping file is defined but unused', async () => {
  // A table that exists but is wired to nothing is worse than a duplicate: the
  // real mapping lives elsewhere while this one looks authoritative.
  const { readFile, readdir } = await import('node:fs/promises');
  const map = await import('../src/core/platform-map.js');

  const files = [];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) await walk(full);
      else if (e.name.endsWith('.js') && !full.endsWith('platform-map.js')) files.push(full);
    }
  };
  await walk(new URL('../src', import.meta.url).pathname);
  const src = (await Promise.all(files.map((f) => readFile(f, 'utf8')))).join('\n');

  for (const name of Object.keys(map)) {
    assert.ok(src.includes(name), `${name} is exported from platform-map.js but nothing imports it`);
  }
});

test('the accepted role list is exactly what the table defines', async () => {
  // The validator's list and the resolver's table cannot drift apart, because
  // they are now the same object.
  const { A11Y_ROLES, A11Y_ROLE_MAP } = await import('../src/core/platform-map.js');
  assert.deepEqual(A11Y_ROLES, Object.keys(A11Y_ROLE_MAP));
});

test('the mapping page is generated from the mapping module', async () => {
  // The page exists so the mapping can be read; if it were hand-written it
  // would quietly disagree with the emitters the first time a row changed.
  const { mappingTables } = await import('../src/core/mapping-table.js');
  const { A11Y_ROLE_MAP, A11Y_STATE_MAP, MECHANISM_PLATFORMS } = await import(
    '../src/core/platform-map.js'
  );
  const sections = mappingTables();

  const by = (id) => sections.find((s) => s.id === id);
  assert.equal(by('roles').rows.length, Object.keys(A11Y_ROLE_MAP).length);
  assert.equal(by('states').rows.length, Object.keys(A11Y_STATE_MAP).length);
  assert.equal(by('mechanisms').rows.length, Object.keys(MECHANISM_PLATFORMS).length);

  // Every cell must carry text; a blank cell is indistinguishable from a bug.
  for (const s of sections) {
    const tables = s.rows ? [s] : s.subtables;
    for (const t of tables) {
      for (const r of t.rows) {
        assert.equal(r.cells.length, t.columns.length, `${s.id}/${r.key} wrong cell count`);
        for (const c of r.cells) assert.ok(c.text, `${s.id}/${r.key} has an empty cell`);
      }
    }
  }
});

test('the mapping page names a platform in its Platform column as a person does, and keeps the id as the row key', async () => {
  // The id is data (it keys the row); what is printed is for a reader.
  const { mappingTables } = await import('../src/core/mapping-table.js');
  const label = { ios: 'iOS', android: 'Android', web: 'Web' };
  const seen = [];
  for (const s of mappingTables()) {
    for (const t of s.rows ? [s] : s.subtables) {
      const col = t.columns.indexOf('Platform');
      if (col < 0) continue;
      for (const r of t.rows) {
        seen.push(r.key);
        assert.ok(label[r.key], `${s.id}: an unexpected platform id ${r.key}`);
        assert.equal(r.cells[col].text, label[r.key], `${s.id}/${r.key}`);
      }
    }
  }
  // Three tables have the column: not an empty loop that passes while checking nothing.
  assert.ok(seen.length >= 9, `only ${seen.length} Platform rows were checked`);
  for (const id of ['ios', 'android', 'web']) assert.ok(seen.includes(id), id);
});

test('the mapping page reports a role the same way the emitters do', async () => {
  // Same source, so a role can never read one way on the page and another in
  // the emitted spec.
  const { mappingTables } = await import('../src/core/mapping-table.js');
  const { platformRole } = await import('../src/core/platform-map.js');
  const roles = mappingTables().find((s) => s.id === 'roles');

  for (const row of roles.rows) {
    for (const [i, platform] of ['ios', 'android'].entries()) {
      assert.equal(row.cells[2 + i].text, platformRole(row.key, platform).text);
    }
  }
});

test('the mapping data is plain JSON, readable without running the code', async () => {
  // The point of the split: a Swift or Kotlin tool, or a reviewer, can read
  // the mappings without a JavaScript runtime.
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('../src/core/platform-map.json', import.meta.url), 'utf8');
  const data = JSON.parse(raw);

  const map = await import('../src/core/platform-map.js');
  assert.deepEqual(data.accessibilityRoles, map.A11Y_ROLE_MAP);
  assert.deepEqual(data.animatableProperties, map.ANIMATABLE_PROPERTY);
  assert.deepEqual(data.namedCurves, map.NAMED_CURVES);
  assert.deepEqual(data.touchTargets.floor, map.TARGET_FLOOR);

  // Derived lookups must not be duplicated in the data, or there would be a
  // second place to forget to update.
  assert.ok(!('safeAnimatable' in data), 'safe list is the animatable keys');
  assert.ok(!('a11yRoles' in data), 'role list is the role table keys');
});

test('no mapping table is defined in JavaScript instead of the JSON', async () => {
  // A table declared as a JS literal would be invisible to any non-JS reader.
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/core/platform-map.js', import.meta.url), 'utf8');
  const literals = src.match(/^export const [A-Z_]+ = \{$/gm) || [];
  assert.deepEqual(literals, [], `these should live in platform-map.json: ${literals.join(', ')}`);
});

test('a reader with only the JSON can reproduce every role expression', async () => {
  // Stands in for a Swift or Kotlin consumer: it gets the file and nothing
  // else — no imports from our code. If the precedence or the text formats
  // were still hidden in JavaScript, this could not agree.
  const { readFile } = await import('node:fs/promises');
  const d = JSON.parse(
    await readFile(new URL('../src/core/platform-map.json', import.meta.url), 'utf8'),
  );

  const render = (role, platform) => {
    const m = d.accessibilityRoles[role]?.[platform];
    if (!m) return null;
    for (const field of d.roleExpression.order) {
      const v = m[field];
      if (v == null || v === false || v === '') continue;
      if (Array.isArray(v) && !v.length) continue;
      const f = d.roleExpression.forms[field];
      return Array.isArray(v)
        ? v.map((x) => f.template.replace('{item}', x)).join(f.join ?? '')
        : f.template.replace('{value}', v);
    }
    return null;
  };

  const { platformRole } = await import('../src/core/platform-map.js');
  for (const role of Object.keys(d.accessibilityRoles)) {
    for (const platform of ['ios', 'android', 'web']) {
      assert.equal(render(role, platform), platformRole(role, platform).text, `${role}/${platform}`);
    }
  }
});

test('what stays in JavaScript is not mapping knowledge', async () => {
  // The file may load data, build runtime types, and interpret templates. It
  // must not contain a mapping only a JavaScript reader can see.
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/core/platform-map.js', import.meta.url), 'utf8');

  // No role, trait, or platform API name spelled out in the code.
  for (const literal of ['isButton', 'Role.', 'accessibilityHidden', 'cubic-bezier', 'CGFloat', 'Dp']) {
    assert.ok(!src.includes(`'${literal}`), `"${literal}" is hardcoded; it belongs in the JSON`);
  }
});

/* ------------------------------------------------------------------ *
 * per-node styling
 *
 * These build into a throwaway workspace. The suite must not depend on
 * whatever happens to be in `contracts/` — that is the user's, and it can be
 * emptied at any time.
 * ------------------------------------------------------------------ */

/** The reference contract, with styling added to a node of its tree. */
function contractWithNodeStyles() {
  const c = structuredClone(ctx.contract);
  c.composition = {
    tree: {
      kind: 'element',
      element: 'div',
      name: 'root',
      children: [
        {
          kind: 'element',
          element: 'span',
          name: 'label',
          children: [],
          styles: {
            default: { labelColor: '{semantic.color.text.primary}' },
            focused: { radius: '{semantic.border.radius.full}' },
            hover: { labelColor: '{semantic.color.text.primary}' },
          },
        },
      ],
    },
    children: {},
  };
  return c;
}

test('per-node styling reaches the artifact, resolved and state-filtered', async () => {
  const contract = contractWithNodeStyles();

  for (const platform of SHIPPED) {
    const { artifact } = resolve(contract, ctx.tokens, platform);
    assert.ok(artifact.nodeStyles.length, `${platform} resolved no node styles`);

    const rows = artifact.nodeStyles.filter((r) => r.node === 'label');
    assert.ok(rows.length, 'the styled node is missing');

    // `default` is the stylesheet's name for the base state; the matrix calls
    // it `idle`. One name, or a consumer sees two states that are one.
    assert.ok(!rows.some((r) => r.state === 'default'));
    assert.ok(rows.some((r) => r.state === 'idle'));

    // hover is pointer-only, so it goes for the same reason it goes from the matrix.
    assert.ok(!rows.some((r) => r.state === 'hover'), `hover survived on ${platform}`);
    for (const r of rows) assert.ok(artifact.axes.state.includes(r.state));

    // A token stays a path in braces, and every path must be declared.
    for (const r of rows) {
      for (const [k, v] of Object.entries(r)) {
        if (k === 'node' || k === 'state' || v == null) continue;
        if (typeof v === 'string' && v.startsWith('{')) {
          const path = v.slice(1, -1);
          assert.ok(artifact.tokenTypes[path], `${path} is referenced but has no declared type`);
        }
      }
    }
  }
});

test('a spec declares every type it references, and resolves every token', async () => {
  // A file naming a type it never declares still has balanced braces, so the
  // structural check passes while the file does not compile. The single-file
  // promise is that the platform team needs nothing else.
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { buildComponent } = await import('../src/core/build.js');

  const root = await mkdtemp(join(tmpdir(), 'cc-spec-'));
  const config = { ...ctx.config, root, outDir: join(root, 'platform-specs') };
  const contract = contractWithNodeStyles();

  const result = await buildComponent({ config, contract, tokens: ctx.tokens, strict: false });
  const files = result.results.flatMap((r) => r.files);
  assert.ok(files.length, 'nothing was emitted');

  const { readFile } = await import('node:fs/promises');
  for (const rel of files) {
    if (!/\.(swift|kt)$/.test(rel)) continue;
    const src = await readFile(join(root, rel.replace(root + '/', '')), 'utf8');

    const declared = new Set(
      [...src.matchAll(/(?:public struct|data class|enum|object)\s+(\w+)/g)].map((m) => m[1]),
    );
    const prefix = rel.split('/').pop().replace(/Spec\.(swift|kt)$/, '');
    const referenced = new Set(
      [...src.matchAll(new RegExp(`\\b(${prefix}(?:NodeStyle|Node|Spec))\\b`, 'g'))].map((m) => m[1]),
    );
    for (const type of referenced) {
      assert.ok(declared.has(type), `${rel} uses ${type} but never declares it`);
    }

    assert.ok(!/\{[a-z][\w.]*\}/.test(src), `${rel} still contains a raw {token.ref}`);
  }
});

/* ------------------------------------------------------------------ *
 * the architecture page
 * ------------------------------------------------------------------ */

test('the architecture page describes files by reading them', async () => {
  // Hand-written prose about a codebase goes stale silently. These come from
  // each file's own opening comment, so a rename or a rewrite carries through.
  const { architecture } = await import('../src/core/architecture.js');
  const a = await architecture(ROOT);

  assert.ok(a.groups.length, 'no groups found');
  assert.ok(a.totals.files > 20, `only ${a.totals.files} files found`);

  const byName = new Map(a.groups.flatMap((g) => g.files.map((f) => [f.name, f])));
  assert.match(byName.get('resolve.js').summary, /resolver/i);
  assert.match(byName.get('platform-map.js').summary, /mapping/i);

  // Every file is reported at its real length.
  const { readFile } = await import('node:fs/promises');
  for (const g of a.groups) {
    for (const f of g.files) {
      const real = (await readFile(join(ROOT, f.path), 'utf8')).split('\n').length;
      assert.equal(f.lines, real, `${f.path} line count is wrong`);
    }
  }
});

test('every source file, scripts and the stylesheet, says what it is for', async () => {
  // The page can only describe a file that describes itself, so an
  // undescribed file is a real gap rather than a rendering choice.
  const { architecture } = await import('../src/core/architecture.js');
  const a = await architecture(ROOT);

  const missing = a.groups
    .flatMap((g) => g.files)
    .filter((f) => /\.(js|css)$/.test(f.name) && !f.summary)
    .map((f) => f.path);

  assert.deepEqual(missing, [], `these files need an opening comment: ${missing.join(', ')}`);
});

/* ------------------------------------------------------------------ *
 * the checks page
 * ------------------------------------------------------------------ */

test('the checks page lists the rules the validator actually runs', async () => {
  // A hand-kept list is wrong the first time someone adds a rule, so this is
  // parsed out of validate.js. If the parse breaks, the page silently shrinks.
  const { readFile } = await import('node:fs/promises');
  const { checks } = await import('../src/core/checks.js');

  const c = await checks(ROOT);
  const src = await readFile(join(ROOT, 'src/core/validate.js'), 'utf8');

  // Every distinct rule code in the source must appear on the page.
  const inSource = new Set([...src.matchAll(/\bf\.(?:error|warn|info)\(\s*'([^']+)'/g)].map((m) => m[1]));
  const onPage = new Set(c.groups.flatMap((g) => g.rules.map((r) => r.code)));
  for (const code of inSource) assert.ok(onPage.has(code), `${code} is missing from the checks page`);

  assert.equal(onPage.size, inSource.size, 'the page and the validator disagree on rule count');
  assert.deepEqual(c.ungrouped, [], 'every rule must belong to a group');
  assert.ok(c.closure.items.length, 'the closure check must be described');
});

test('every accessibility value shown per platform comes from the resolver', async () => {
  // The tab shows an iOS and an Android column. Those have to be what the
  // spec files carry, not a second translation done in the browser.
  const contract = structuredClone(ctx.contract);
  const seen = {};

  for (const platform of SHIPPED) {
    const { artifact } = resolve(contract, ctx.tokens, platform);
    assert.ok(artifact.a11y, `${platform} has no a11y block`);
    assert.ok(artifact.a11y.minTarget > 0, `${platform} has no touch target`);
    assert.ok(Array.isArray(artifact.a11yNodes), `${platform} has no per-node roles`);
    seen[platform] = { size: artifact.a11y.minTarget, unit: artifact.a11y.minTargetUnit };

    // Every node carrying a role must resolve to something expressible.
    for (const n of artifact.a11yNodes) {
      assert.ok(n.role, 'a node was listed without a role');
      assert.ok(n.text || n.unmapped, `${n.node} resolved to nothing on ${platform}`);
    }
  }

  // The fixture states its own 44, and a stated value holds on both
  // platforms — so the sizes may match. The unit never does.
  assert.equal(seen.ios.unit, 'pt');
  assert.equal(seen.android.unit, 'dp');
});

test('every validation rule records why it exists', async () => {
  // The messages say what a rule rejects; only the rationale says why that
  // matters. A rule added without one would show up on the checks page as a
  // bare assertion, so this fails the build instead.
  const { checks } = await import('../src/core/checks.js');
  const c = await checks(ROOT);

  const missing = c.groups
    .flatMap((g) => g.rules)
    .filter((r) => !r.intent)
    .map((r) => `${r.code} (validate.js:${r.line})`);

  assert.deepEqual(missing, [], `add a rationale in checks.js INTENT for: ${missing.join(', ')}`);
  assert.equal(c.totals.undocumented, 0);
});

test('no rationale is left behind for a rule that no longer exists', async () => {
  // A stale entry would describe a check the tool does not run.
  const { readFile } = await import('node:fs/promises');
  const { checks } = await import('../src/core/checks.js');

  const src = await readFile(join(ROOT, 'src/core/checks.js'), 'utf8');
  const block = src.slice(src.indexOf('const INTENT = {'), src.indexOf('\n};', src.indexOf('const INTENT = {')));
  const documented = [...block.matchAll(/^\s*'([\w.-]+)':/gm)].map((m) => m[1]);

  const real = new Set((await checks(ROOT)).groups.flatMap((g) => g.rules.map((r) => r.code)));
  const orphans = documented.filter((code) => !real.has(code));

  assert.deepEqual(orphans, [], `these rationales describe rules that no longer exist: ${orphans.join(', ')}`);
});

/* ------------------------------------------------------------------ *
 * conformance
 * ------------------------------------------------------------------ */

test('both platforms get the same conformance assertions', async () => {
  // Swift had a conformance section and Kotlin had none, from the same
  // contract. Nothing caught it, because comments do not affect anything.
  const { mkdtemp, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { buildComponent } = await import('../src/core/build.js');

  const root = await mkdtemp(join(tmpdir(), 'cc-conf-'));
  const config = { ...ctx.config, root, outDir: join(root, 'platform-specs') };
  const result = await buildComponent({ config, contract: ctx.contract, tokens: ctx.tokens, strict: false });

  const ids = {};
  for (const rel of result.results.flatMap((r) => r.files)) {
    const doc = JSON.parse(await readFile(join(root, rel.replace(root + '/', '')), 'utf8'));
    assert.ok(doc.conformance?.length, `${rel} declares no assertions`);
    ids[doc.platform] = doc.conformance.map((a) => a.id);
  }

  assert.equal(ids.ios.length, ids.android.length, 'one platform asserts more than the other');

  // Platform-neutral assertions must be identical. Props and a11y are exempt:
  // prop names are remapped per platform, and iOS states traits where Compose
  // states a role — those differences are the translation working.
  const neutral = (list) => list.filter((id) => !/^(prop|a11y)\./.test(id));
  assert.deepEqual(neutral(ids.ios), neutral(ids.android), 'the platforms disagree on what must be true');
});

test('the platform spec names no UI framework and no token library', async () => {
  // The whole point of the format: a team consumes it in whatever environment
  // they already have. A SwiftUI type or an invented `DSTokens` accessor makes
  // the file fit one codebase and no other.
  const { emitPlatformJson } = await import('../src/core/emit/platform.js');

  for (const platform of SHIPPED) {
    const { artifact } = resolve(ctx.contract, ctx.tokens, platform);
    const src = emitPlatformJson(artifact, { contract: ctx.contract });

    for (const banned of [
      'SwiftUI', 'CGFloat', 'Font.Weight', 'Sendable', 'import ',
      'androidx', 'TextUnit', 'DSTokens', 'DsTokens',
      // Framework spelling of a concept, rather than the concept.
      '.isButton', 'Role.', 'accessibilityAdjustableAction', 'accessibilityHidden',
    ]) {
      assert.ok(!src.includes(banned), `${platform} spec mentions "${banned}"`);
    }
    JSON.parse(src); // must be valid JSON, not source code
  }
});

test('accessibility is stated as a concept, not as platform syntax', async () => {
  // `.adjustable` is Swift, `Role.Button` is Compose. The obligation is the
  // same on both; only the spelling differs, and spelling is the framework's.
  const { resolve: res } = await import('../src/core/resolve.js');

  for (const platform of SHIPPED) {
    const { artifact } = res(ctx.contract, ctx.tokens, platform);
    for (const n of artifact.a11yNodes) {
      assert.ok(n.kind, `${n.node} has no mechanism kind on ${platform}`);
      assert.ok(n.concept, `${n.node} has no concept on ${platform}`);

      const concepts = Array.isArray(n.concept) ? n.concept : [n.concept];
      for (const c of concepts) {
        assert.ok(!String(c).startsWith('.'), `${c} is Swift syntax`);
        assert.ok(!String(c).startsWith('Role.'), `${c} is Compose syntax`);
      }
      for (const a of n.actions) {
        assert.ok(!/^accessibility[A-Z]/.test(a), `action "${a}" is a framework API name`);
      }
    }
  }
});

test('token references are paths, never a guessed symbol', async () => {
  // The tool does not know a token's value — those live in the design system —
  // so a reference is the only honest thing to emit.
  const { artifact } = resolve(ctx.contract, ctx.tokens, 'ios');
  const referenced = new Set();

  for (const row of artifact.styles) {
    for (const [k, v] of Object.entries(row)) {
      if (k === 'children' || k === 'focusRing' || typeof v !== 'string') continue;
      if (v.startsWith('{')) referenced.add(v.slice(1, -1));
      else assert.ok(!/^DS?Tokens\./.test(v), `${k} still renders a symbol: ${v}`);
    }
  }

  assert.ok(referenced.size, 'no tokens were referenced at all');
  // Every path referenced must be declared with its type.
  for (const path of referenced) {
    assert.ok(artifact.tokenTypes[path], `${path} is referenced but has no declared type`);
  }
});
