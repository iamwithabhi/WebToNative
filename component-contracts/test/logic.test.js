/**
 * The logic reader quotes what the markup depends on, and nothing else.
 *
 * Each test states the one rule it relies on, with a small component, so a wrong
 * boundary or a wrong reachability decision cannot hide behind a real component
 * that happens to come out right.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLogic } from '../src/core/import/logic.js';

const names = (r) => r.entries.map((e) => e.name);
const by = (r, n) => r.entries.find((e) => e.name === n);

test('only what the markup can reach is quoted, in source order', () => {
  const code = `
const helper = (n: number) => n * 2;
const unrelated = () => 42;
export function X() {
  const a = () => helper(1);
  const b = () => unrelated();
  const c = () => 7;
  return (<div onClick={a} />);
}`;
  const r = extractLogic(code, { roots: ['a'] });
  assert.deepEqual(names(r), ['helper', 'a']);
  assert.equal(by(r, 'helper').scope, 'module');
  assert.equal(by(r, 'a').scope, 'component');
});

test('with nothing referenced by the markup, nothing is quoted', () => {
  const code = `export function X() { const a = () => 1; return (<div />); }`;
  assert.deepEqual(extractLogic(code, { roots: [] }).entries, []);
});

test('statements are quoted exactly as written, not rewritten', () => {
  const code = `
export function X() {
  const atMin = value <= min;
  const go = useCallback(
    (d: number) => {
      step(d);   // keep this comment
    },
    [step],
  );
  return (<div onClick={go} data-x={atMin} />);
}`;
  const r = extractLogic(code, { roots: ['go', 'atMin'] });
  assert.equal(by(r, 'atMin').source, 'const atMin = value <= min;');
  assert.ok(code.includes(by(r, 'go').source), 'the quoted text is a verbatim slice of the file');
  assert.match(by(r, 'go').source, /\/\/ keep this comment/);
});

test('state is quoted when reachable code reads it and left out when nothing does', () => {
  const code = `
export function X() {
  const [n, setN] = useState(0);
  const ref = useRef(null);
  const id = useId();
  const unused = useRef(null);
  const stop = () => { clearInterval(ref.current); };
  useEffect(() => { window.addEventListener('up', stop); }, [stop]);
  useEffect(() => { return () => clearInterval(ref.current); }, []);
  useEffect(() => { track(unused.current); }, []);
  return (<div onClick={stop} />);
}`;
  const r = extractLogic(code, { roots: ['stop'] });
  // `ref` is read by `stop`, so it is quoted; `n`, `id` and `unused` are not read by anything reachable.
  assert.deepEqual(names(r), ['ref', 'stop', 'useEffect#1', 'useEffect#2']);
  assert.equal(by(r, 'ref').kind, 'state');
  assert.equal(by(r, 'ref').hook, 'useRef', 'a timer handle is not a value that re-renders, and the hook says so');
  assert.match(by(r, 'useEffect#1').source, /addEventListener\('up', stop\)/);
  assert.match(by(r, 'useEffect#2').source, /clearInterval\(ref\.current\)/);
  assert.ok(!r.entries.some((e) => /unused/.test(e.source)), 'an effect on state nothing reachable reads is not dragged in');
});

test('a state pair is one entry that names both of its identifiers', () => {
  const code = `
export function X() {
  const [pop, setPop] = useState(false);
  const go = () => setPop(true);
  return (<div data-pop={pop} onClick={go} />);
}`;
  const r = extractLogic(code, { roots: ['pop', 'go'] });
  assert.deepEqual(names(r), ['pop', 'go']);
  assert.deepEqual(by(r, 'pop').also, ['setPop']);
  assert.deepEqual(by(r, 'go').uses, ['pop'], 'a use of the setter is a use of the pair');
});

test('a statement that keeps a ref in step with a value is kept with the ref it feeds', () => {
  const code = `
export function X() {
  const ref = useRef(0);
  const value = props.v * 2;
  ref.current = value;
  const read = () => ref.current;
  return (<div onClick={read} />);
}`;
  const r = extractLogic(code, { roots: ['read'] });
  assert.deepEqual(names(r), ['ref', 'value', 'ref.current', 'read']);
  assert.equal(by(r, 'ref.current').kind, 'assignment');
});

test('every spelling of a function is a function, and a derived expression is a value', () => {
  const code = `
export function X() {
  const arrow = () => 1;
  const bare = n => n;
  const typed = (a: number): number => a;
  const asyncFn = async () => 2;
  const memoised = useCallback(() => 3, []);
  function declared() { return 4; }
  const derived = arrow() + 1;
  return (<div a={arrow} b={bare} c={typed} d={asyncFn} e={memoised} f={declared} g={derived} />);
}`;
  const r = extractLogic(code, { roots: ['arrow', 'bare', 'typed', 'asyncFn', 'memoised', 'declared', 'derived'] });
  const kind = (n) => by(r, n)?.kind;
  for (const n of ['arrow', 'bare', 'typed', 'asyncFn', 'memoised', 'declared']) assert.equal(kind(n), 'function', n);
  assert.equal(kind('derived'), 'value');
});

test('a literal, a hook result and a destructuring are not logic', () => {
  const code = `
const POP_MS = 100;
export function X() {
  const limit = 5;
  const memo = useMemo(() => 1, []);
  const { a, b } = props;
  const [c, d] = useState(0);
  const go = () => POP_MS + limit + memo + a + c;
  return (<div onClick={go} />);
}`;
  const r = extractLogic(code, { roots: ['go', 'limit', 'memo', 'a', 'c', 'POP_MS'] });
  assert.deepEqual(names(r), ['memo', 'c', 'go'], 'module literals are sourceConstants; a memo is derived and a hook pair is state');
  assert.equal(by(r, 'memo').kind, 'value');
  assert.equal(by(r, 'c').kind, 'state');
});

test('a name after a dot is a property, not a reference', () => {
  const code = `
export function X() {
  const stop = () => 1;
  const a = () => api.stop();
  return (<div onClick={a} />);
}`;
  assert.deepEqual(names(extractLogic(code, { roots: ['a'] })), ['a']);
});

test('constants inside a quoted function are part of it, not entries of their own', () => {
  const code = `
export function X() {
  const outer = () => { const inner = () => 1; return inner(); };
  return (<div onClick={outer} />);
}`;
  const r = extractLogic(code, { roots: ['outer'] });
  assert.deepEqual(names(r), ['outer']);
  assert.match(by(r, 'outer').source, /const inner = \(\) => 1;/);
});

test('statements with no semicolons still end where they end', () => {
  const code = `
export function X() {
  const a = () => {
    return 1
  }
  const b = () => a()
  return (<div onClick={b} />)
}`;
  const r = extractLogic(code, { roots: ['b'] });
  assert.deepEqual(names(r), ['a', 'b']);
  assert.equal(by(r, 'b').source, 'const b = () => a()');
  assert.match(by(r, 'a').source, /^const a = \(\) => \{\s*return 1\s*\}$/);
});

test('each entry lists the other entries it uses, never itself', () => {
  const code = `
export function X() {
  const base = () => 1;
  const mid = () => base();
  const top = () => mid() + base();
  return (<div onClick={top} />);
}`;
  const r = extractLogic(code, { roots: ['top'] });
  assert.deepEqual(by(r, 'top').uses, ['base', 'mid']);
  assert.deepEqual(by(r, 'mid').uses, ['base']);
  assert.deepEqual(by(r, 'base').uses, []);
});

test('markup that cannot be found, or source that cannot be paired, yields nothing and says why', () => {
  const none = extractLogic(`export const x = 1;`, { roots: ['x'] });
  assert.deepEqual(none.entries, []);
  assert.match(none.notes[0], /No returned markup/);

  const broken = extractLogic(`export function X() { const a = () => { return (<div />); }`, { roots: ['a'] });
  assert.deepEqual(broken.entries, []);
  assert.match(broken.notes[0], /could not be paired/);

  assert.deepEqual(extractLogic('', { roots: ['a'] }), { entries: [], notes: [] });
  assert.deepEqual(extractLogic(null, { roots: ['a'] }), { entries: [], notes: [] });
});

test('a statement longer than the cap is cut, flagged, and reported', () => {
  const body = 'x();\n'.repeat(700);
  const code = `export function X() { const long = () => {\n${body}};\n return (<div onClick={long} />); }`;
  const r = extractLogic(code, { roots: ['long'] });
  assert.equal(by(r, 'long').truncated, true);
  assert.ok(by(r, 'long').source.length <= 2500);
  assert.match(r.notes.join(' '), /long: quoted source is longer than/);
});

test('strings and comments cannot fake a statement or a reference', () => {
  const code = `
export function X() {
  const real = () => "const fake = () => 1;";
  // const ghost = () => 2;
  return (<div onClick={real} />);
}`;
  const r = extractLogic(code, { roots: ['real', 'fake', 'ghost'] });
  assert.deepEqual(names(r), ['real']);
});

test('a statement that continues across lines is not split, with or without semicolons', () => {
  // The newline rule must not cut a ternary, a trailing operator or a chained call.
  for (const semi of [';', '']) {
    const code = `
export function X() {
  const label = labelled
    ? null
    : fallback${semi}
  const total = first +
    second${semi}
  const items = list
    .filter(Boolean)
    .map(String)${semi}
  return (<div x={label} y={total} z={items} />)${semi}
}`;
    const r = extractLogic(code, { roots: ['label', 'total', 'items'] });
    assert.deepEqual(names(r), ['label', 'total', 'items'], `semicolon "${semi}"`);
    assert.match(by(r, 'label').source, /\? null\s*: fallback/);
    assert.match(by(r, 'total').source, /first \+\s*second/);
    assert.match(by(r, 'items').source, /\.filter\(Boolean\)\s*\.map\(String\)/);
  }
});
