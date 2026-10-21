/** Source evidence must survive extraction; unknown behavior must stay unknown. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractInteractionBindings } from '../src/core/import/interaction.js';

const counter = `
  const POP_MS = 100;
  export function Counter({ value: controlledValue }: CounterProps) {
    const [pop, setPop] = useState(false);
    const setValue = useCallback(
      (next: number) => {
        if (next === valueRef.current) return;
        onChange?.(next);
        setPop(true);
        clearTimeout(popTimer.current);
        popTimer.current = setTimeout(() => setPop(false), POP_MS);
      },
      [onChange],
    );
    return <div data-pop={pop} />;
  }
`;

test('Counter records activation in setValue and the source-backed 100ms reset', () => {
  const { bindings, notes } = extractInteractionBindings(counter);
  assert.equal(bindings.length, 1);
  const binding = bindings[0];
  assert.equal(binding.attribute, 'data-pop');
  assert.equal(binding.state, 'pop');
  assert.equal(binding.setter, 'setPop');
  assert.equal(binding.initial, false);
  assert.deepEqual(binding.source, {
    state: 'const [pop, setPop] = useState(false)',
    attribute: 'data-pop={pop}',
  });
  assert.equal(binding.activations.length, 1);
  const activation = binding.activations[0];
  assert.equal(activation.value, true);
  assert.equal(activation.expression, 'setPop(true)');
  assert.equal(activation.containingFunction, 'setValue');
  assert.match(activation.contextExpression, /if \(next === valueRef.current\) return;/);
  assert.deepEqual(activation.trigger, { expression: 'setPop(true)', manualTranslation: true });
  assert.equal(binding.reset.value, false);
  assert.equal(binding.reset.delayMs, 100);
  assert.equal(binding.reset.delayExpression, 'POP_MS');
  assert.equal(binding.reset.delayEvidence, 'const POP_MS = 100;');
  assert.equal(binding.reset.expression, 'setTimeout(() => setPop(false), POP_MS)');
  assert.equal(binding.reset.containingFunction, 'setValue');
  assert.match(notes.join('\n'), /no event or prop-change semantics inferred/);
  assert.ok(!('events' in binding));
  assert.ok(!('guards' in binding));
});

test('a guarded Counter activation is not inferred as a prop-change trigger', () => {
  const code = counter.replace('if (next === valueRef.current) return;', 'if (clamped === valueRef.current) { stopHold(); return; }');
  const { bindings } = extractInteractionBindings(code);
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].attribute, 'data-pop');
  assert.equal(bindings[0].activations[0].containingFunction, 'setValue');
  assert.match(bindings[0].activations[0].contextExpression, /if \(clamped === valueRef.current\)/);
  assert.equal(bindings[0].reset.delayMs, 100);
});

test('false activation and true reset are read literally, including a block timer', () => {
  const { bindings } = extractInteractionBindings(`
    function Example() {
      const [ready, setReady] = React.useState<boolean>(true);
      function pause() {
        setReady(false);
        setTimeout(() => { setReady(true); }, 25.5);
      }
      return <div data-ready={ready} />;
    }
  `);
  assert.equal(bindings[0].initial, true);
  assert.equal(bindings[0].activations[0].value, false);
  assert.equal(bindings[0].activations[0].containingFunction, 'pause');
  assert.equal(bindings[0].reset.value, true);
  assert.equal(bindings[0].reset.delayMs, 25.5);
  assert.equal(bindings[0].reset.delayExpression, '25.5');
  assert.equal(bindings[0].reset.delayEvidence, null);
});

test('zero delay is retained rather than replaced by a default', () => {
  const { bindings } = extractInteractionBindings(counter.replace(', POP_MS)', ', 0)'));
  assert.equal(bindings[0].reset.delayMs, 0);
});

test('unknown timer values stay source expressions and are flagged, never evaluated', () => {
  for (const delay of ['duration', 'props.delay', 'getDelay(1, 2)', 'POP_MS * 2', '-1', 'Infinity', '"100"']) {
    const { bindings, notes } = extractInteractionBindings(counter.replace(', POP_MS)', `, ${delay})`));
    assert.equal(bindings[0].reset.delayMs, null, delay);
    assert.equal(bindings[0].reset.delayExpression, delay);
    assert.match(notes.join('\n'), /unknown reset delay/);
  }
});

test('mutable, computed, shadowed and out-of-scope constants are not resolved', () => {
  for (const code of [
    counter.replace('const POP_MS = 100;', 'let POP_MS = 100;'),
    counter.replace('const POP_MS = 100;', 'const POP_MS = 50 * 2;'),
    counter.replace('(next: number)', '(POP_MS: number)'),
    counter.replace('const POP_MS = 100;', '{ const POP_MS = 100; }'),
    counter.replace('const POP_MS = 100;', 'const POP_MS = 100; function other() { const POP_MS = 200; }'),
  ]) {
    const { bindings, notes } = extractInteractionBindings(code);
    assert.equal(bindings[0].reset.delayMs, null);
    assert.match(notes.join('\n'), /unknown reset delay/);
  }
});

test('anonymous activation retains source without attributing it to an outer function', () => {
  const { bindings, notes } = extractInteractionBindings(counter.replace('setPop(true);', 'subscribe(() => { setPop(true); });'));
  assert.equal(bindings[0].activations[0].containingFunction, null);
  assert.equal(bindings[0].activations[0].trigger.expression, 'setPop(true)');
  assert.equal(bindings[0].activations[0].trigger.manualTranslation, true);
  assert.match(notes.join('\n'), /manual translation/);
});

test('a concise named arrow is recognized without making it an event', () => {
  const { bindings } = extractInteractionBindings(counter.replace('setPop(true);', 'const activate = () => setPop(true);'));
  assert.equal(bindings[0].activations[0].containingFunction, 'activate');
});

test('unsupported updater activation and missing activation require manual translation', () => {
  for (const replacement of ['setPop(previous => !previous);', '']) {
    const { bindings, notes } = extractInteractionBindings(counter.replace('setPop(true);', replacement));
    assert.deepEqual(bindings[0].activations, []);
    assert.equal(bindings[0].reset.delayMs, 100);
    assert.match(notes.join('\n'), /activation not established; manual translation/);
  }
});

test('complex timers and ordinary false setters are not fabricated timed resets', () => {
  for (const replacement of [
    'setPop(false)',
    'setTimeout(() => { if (ready) setPop(false); }, 100)',
    'setTimeout(() => setPop(previous => !previous), 100)',
    'setTimeout(() => schedule(() => setPop(false)), 100)',
  ]) {
    const { bindings, notes } = extractInteractionBindings(counter.replace('setTimeout(() => setPop(false), POP_MS)', replacement));
    assert.equal(bindings[0].reset, null);
    assert.match(notes.join('\n'), /no supported timed reset/);
  }
});

test('multiple timers remain separate evidence instead of choosing an arbitrary reset', () => {
  const { bindings, notes } = extractInteractionBindings(counter.replace('clearTimeout(popTimer.current);', 'setTimeout(() => setPop(false), 200);'));
  assert.equal(bindings[0].reset, null);
  assert.deepEqual(bindings[0].resetCandidates.map((r) => r.delayMs), [200, 100]);
  assert.match(notes.join('\n'), /multiple timed resets/);
});

test('comments and strings cannot contribute declarations, attributes or setter calls', () => {
  const fake = `const [pop, setPop] = useState(false); setPop(true); setTimeout(() => setPop(false), 100); <div data-pop={pop} />`;
  for (const code of [`// ${fake}`, `/* ${fake} */`, JSON.stringify(fake), '`' + fake + '`']) {
    assert.deepEqual(extractInteractionBindings(code), { bindings: [], notes: [] });
  }
  const { bindings } = extractInteractionBindings(counter.replace('setPop(true);', '// setPop(true);\n const text = "setPop(true)";'));
  assert.deepEqual(bindings[0].activations, []);
});

test('absence and unsupported attribute or initializer syntax yield no fabricated behavior', () => {
  for (const code of ['', 'return <div data-pop={props.pop} />;', counter.replace('data-pop={pop}', 'data-pop={pop || undefined}'), counter.replace('useState(false)', 'useState(() => false)'), counter.replace('data-pop={pop}', 'aria-pressed={pop}')]) {
    assert.deepEqual(extractInteractionBindings(code).bindings, []);
  }
});

test('shadowed state or setter names are refused instead of joined across scopes', () => {
  for (const code of [
    counter.replace('(next: number)', '(setPop: Function)'),
    counter.replace('(next: number)', '(pop: boolean)'),
    counter + counter,
  ]) {
    const { bindings, notes } = extractInteractionBindings(code);
    assert.deepEqual(bindings, []);
    assert.match(notes.join('\n'), /ambiguous or unsupported/);
  }
});

test('a shadowed timer function cannot establish a reset', () => {
  const { bindings, notes } = extractInteractionBindings(counter.replace('(next: number)', '(setTimeout: Function)'));
  assert.equal(bindings[0].reset, null);
  assert.match(notes.join('\n'), /unsupported setter or timer callback/);
});

test('a postprocessed hook result is not treated as direct useState destructuring', () => {
  const { bindings } = extractInteractionBindings(counter.replace('useState(false);', 'useState(false).map(transform);'));
  assert.deepEqual(bindings, []);
});

test('omitted delays are unknown, not an invented zero', () => {
  const { bindings, notes } = extractInteractionBindings(counter.replace(', POP_MS)', ')'));
  assert.equal(bindings[0].reset.delayMs, null);
  assert.equal(bindings[0].reset.delayExpression, null);
  assert.match(notes.join('\n'), /unknown reset delay \(omitted\)/);
});

test('unsupported regex literals and unbalanced source are explicitly skipped', () => {
  for (const code of [counter + 'const example = /setPop(true)/;', counter + '{']) {
    const { bindings, notes } = extractInteractionBindings(code);
    assert.deepEqual(bindings, []);
    assert.match(notes.join('\n'), /Skipped interaction extraction/);
  }
});

test('each direct attribute and each activation keeps its own source evidence', () => {
  const { bindings } = extractInteractionBindings(counter
    .replace('clearTimeout(popTimer.current);', 'if (retry) setPop(true);')
    .replace('data-pop={pop}', 'data-pop={pop} data-active={pop}'));
  assert.deepEqual(bindings.map((b) => b.attribute), ['data-pop', 'data-active']);
  for (const binding of bindings) {
    assert.equal(binding.activations.length, 2);
    assert.ok(binding.activations.every((a) => a.containingFunction === 'setValue'));
    assert.equal(binding.reset.delayMs, 100);
  }
});
