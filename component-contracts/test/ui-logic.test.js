/**
 * The reader's small pure modules: how a value is named, and which files of a chosen folder count.
 *
 * Both are logic the UI depends on and a person would only notice when it is wrong, so they
 * are tested directly, in Node, with no browser: naming (tokens.ts) and folder choice (collect.ts).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applied, valueWords, tokenRef, tokenLabel, setPath } from '../src/ui/js/lib/tokens.js';
import { collect, usable, idFromFolder, MAX_FILES, MAX_BYTES } from '../src/ui/js/lib/collect.js';
import { platformName, withPlatformNames } from '../src/ui/js/lib/platform.js';

test('a token is named, never shown as a path, and says when its value is not known', () => {
  const known = new Map([['semantic.color.x', '#ff0000'], ['semantic.size.8', 8], ['semantic.color.short', '#fff'], ['semantic.color.alpha', '#11223344']]);
  assert.deepEqual(applied('{semantic.color.x}', known), { kind: 'token', label: 'semantic color x', color: '#ff0000', value: null });
  assert.deepEqual(applied('{semantic.size.8}', known), { kind: 'token', label: 'semantic size 8', color: null, value: '8' });
  assert.equal(applied('{semantic.color.short}', known).color, '#fff', 'a short hex is still a colour');
  assert.equal(applied('{semantic.color.alpha}', known).color, '#11223344', 'and so is one with alpha');
  assert.deepEqual(applied('transparent', known), { kind: 'literal', text: 'transparent', none: true });
  assert.equal(applied({ value: 8, unit: 'px' }, known).text, '8 px', 'a length is words, never "[object Object]"');
  assert.deepEqual(applied('{semantic.unknown}', known), { kind: 'token', label: 'semantic unknown', color: null, value: null });
  assert.deepEqual(applied(null, known), { kind: 'unset' });
  assert.deepEqual(applied('', known), { kind: 'unset' });
  assert.deepEqual(applied('none', known), { kind: 'literal', text: 'none', none: true });
  assert.deepEqual(applied('12px', known), { kind: 'literal', text: '12px', none: false });
});

test('a value is put into words: a token by name, an expression with its tokens named', () => {
  assert.equal(tokenRef('{a.b}'), 'a.b');
  assert.equal(tokenRef('a.b'), null);
  assert.equal(tokenRef({ x: 1 }), null);
  assert.equal(tokenLabel('semantic.spacing.0'), 'semantic spacing 0');
  assert.equal(valueWords(null), '\u2014');
  assert.equal(valueWords(0), '0', 'zero is a value, not an absence');
  assert.equal(valueWords('{semantic.spacing.8}'), 'semantic spacing 8');
  assert.equal(valueWords({ expression: '2 * {semantic.size.40} + {semantic.size.24}' }), '2 * semantic size 40 + semantic size 24');
  assert.equal(valueWords({ value: 4, unit: 'pt' }), '4 pt');
  assert.equal(valueWords({ value: 50, unit: '%' }), '50%');
  assert.equal(valueWords({ value: 4 }), '4', 'a value with no unit has none');
  assert.equal(valueWords('auto'), 'auto', 'a literal is as written');
});

test('setting a path creates its parents, and an empty value removes the key', () => {
  const o = {};
  setPath(o, 'a.b.c', 'x');
  assert.deepEqual(o, { a: { b: { c: 'x' } } });
  setPath(o, 'a.b.c', '');
  assert.deepEqual(o, { a: { b: {} } });
  setPath(o, 'a.b', { replaced: 1 });
  assert.deepEqual(o, { a: { b: { replaced: 1 } } });
});

const file = (relPath, text = 'x', size = text.length) => ({ relPath, file: { size, text: async () => text } });

test('only code and stylesheets of a component folder count; tests, stories and tooling do not', () => {
  for (const ok of ['Counter/Counter.tsx', 'Counter/counter.css', 'Counter/index.ts', 'Counter/a.scss']) assert.ok(usable(ok), ok);
  for (const no of [
    'Counter/Counter.test.tsx', 'Counter/Counter.stories.tsx', 'Counter/Counter.spec.ts', 'Counter/README.md',
    'Counter/node_modules/x/index.js', 'Counter/.git/config', 'Counter/dist/out.js', 'Counter/.hidden.ts', 'Counter/img.png',
  ]) assert.equal(usable(no), false, no);
});

test('choosing a folder yields its name and files, refuses an empty or oversized one, and says why', async () => {
  const ok = await collect([file('Counter/Counter.tsx', 'a'), file('Counter/counter.css', 'b'), file('Counter/Counter.test.tsx', 'no')]);
  assert.deepEqual(ok, { ok: true, folder: 'Counter', files: [{ name: 'Counter/Counter.tsx', content: 'a' }, { name: 'Counter/counter.css', content: 'b' }] });

  const none = await collect([file('Counter/README.md')]);
  assert.deepEqual(none, { ok: false, error: 'No component or stylesheet files in that folder' });

  const big = await collect([file('Big/a.tsx', 'x', MAX_BYTES), file('Big/b.tsx', 'y', 10)]);
  assert.equal(big.ok, false);
  assert.match(big.error, /too large/);

  const many = await collect(Array.from({ length: MAX_FILES + 10 }, (_, i) => file(`Dir/f${i}.ts`)));
  assert.equal(many.files.length, MAX_FILES, 'a folder is capped rather than read without limit');
  assert.equal((await collect([file('loose.tsx')])).folder, 'component', 'a single loose file has no folder name');
});

test('an id is made from a folder name', () => {
  assert.equal(idFromFolder('IconButton'), 'icon-button');
  assert.equal(idFromFolder('My Component_v2'), 'my-component-v2');
  assert.equal(idFromFolder('Counter'), 'counter');
});

test('a platform is named as a person writes it', () => {
  assert.equal(platformName('ios'), 'iOS');
  assert.equal(platformName('android'), 'Android');
  assert.equal(platformName('web'), 'Web');
  assert.equal(platformName('tv'), 'tv', 'an id with no display name is shown as it is, not guessed at');
});

test('a sentence the tool wrote is fixed, and a path or a key is never touched', () => {
  assert.equal(withPlatformNames('motion "x" dropped on ios (state not applicable)'), 'motion "x" dropped on iOS (state not applicable)');
  assert.equal(withPlatformNames('not on android.'), 'not on Android.', 'a full stop ends the sentence; it is not a file extension');
  assert.equal(withPlatformNames('ios, android and ios: both'), 'iOS, Android and iOS: both');
  assert.equal(withPlatformNames('the web is not a target'), 'the web is not a target', 'web is an ordinary word in a sentence');
  // These look like platform words and are data, so they stay exactly as they are.
  for (const exact of [
    'platform-specs/counter/ios.json', 'adaptable.ring.platforms.ios.supported', 'specs/android/x.kt',
    'androidx.compose.ui', 'iosevka', 'iOS and Android',
    // Each of these is protected by one condition only: after a slash, after a dot, before a slash.
    'platform-specs/ios', 'adaptable.platforms.ios', 'android/res/values',
    // And a name that starts the string, protected only by what follows it.
    'ios.json', 'android.contract.json',
  ]) assert.equal(withPlatformNames(exact), exact, exact);
  assert.equal(withPlatformNames('wrote platform-specs/counter/ios.json for ios'), 'wrote platform-specs/counter/ios.json for iOS', 'both in one sentence');
});
