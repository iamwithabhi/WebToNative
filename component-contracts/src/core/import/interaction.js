/**
 * Source-backed boolean interaction bindings, not inferred state machines.
 *
 * Reads const [state, setter] = useState(true|false), direct data-*={state},
 * literal setter calls and setTimeout(() => setter(initial), delay). State
 * and delay declarations must end with semicolons. A timer
 * block may contain only that call. Delays are nonnegative decimal literals
 * or unambiguous, visible const literals. React.useState is also supported.
 * Strings, comments and templates are opaque; regex literals and division are
 * outside this reader's subset. Aliases, shadowed names and complex callbacks
 * are left for manual translation. No source is evaluated.
 */

export function extractInteractionBindings(code) {
  const bindings = [];
  const notes = [];
  const tokens = [];
  const lex = /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|`(?:\\[\s\S]|[^`\\])*`|[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|=>|\?\.|[^\s]/g;
  for (const m of code.matchAll(lex)) {
    if (/^\s|^\/\/|^\/\*/.test(m[0])) continue;
    tokens.push({ value: m[0], start: m.index, end: m.index + m[0].length });
  }
  const at = (i) => tokens[i]?.value;
  const source = (start, end) => code.slice(tokens[start].start, tokens[end].end);
  const identifier = (value) => /^[A-Za-z_$][\w$]*$/.test(value || '');
  const number = (value) => /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value || '') && Number.isFinite(Number(value));
  const pairs = new Map();
  const parents = [];
  const stack = [];
  for (let i = 0; i < tokens.length; i++) {
    const value = at(i);
    parents[i] = stack.at(-1);
    if (value === '/' && at(i - 1) !== '<' && at(i + 1) !== '>') {
      return { bindings, notes: ['Skipped interaction extraction: regex literals and division require manual translation.'] };
    }
    if (['(', '[', '{'].includes(value)) stack.push(i);
    if ([')', ']', '}'].includes(value)) {
      const open = stack.pop();
      if (at(open) !== { ')': '(', ']': '[', '}': '{' }[value]) {
        return { bindings, notes: ['Skipped interaction extraction: unbalanced source.'] };
      }
      pairs.set(open, i);
      pairs.set(i, open);
    }
  }
  if (stack.length) return { bindings, notes: ['Skipped interaction extraction: unbalanced source.'] };
  const visible = (declaration, usage) => {
    const scope = parents[declaration];
    return scope === undefined || (scope < usage && usage < pairs.get(scope));
  };
  const bareCall = (i) => identifier(at(i)) && !['.', '?.', 'new', 'function'].includes(at(i - 1)) && at(i + 1) === '(';

  // All arrow boundaries matter, including anonymous callbacks inside named ones.
  const functions = [];
  for (let i = 0; i < tokens.length; i++) {
    if (at(i) === '=>') {
      const params = at(i - 1) === ')' ? pairs.get(i - 1) : i - 1;
      let end = i + 1;
      if (at(end) === '{') end = pairs.get(end);
      else {
        while (end < tokens.length && ![',', ';', ')', ']', '}'].includes(at(end))) {
          end = (pairs.get(end) > end ? pairs.get(end) : end) + 1;
        }
        end--;
      }
      let assignment = params - 1;
      if (at(assignment) === '(' && at(assignment - 1) === 'useCallback') assignment -= 2;
      const named = at(assignment) === '=' && identifier(at(assignment - 1)) && at(assignment - 2) === 'const';
      functions.push({ start: params, end, body: i + 1, name: named ? at(assignment - 1) : null });
    }
    if (at(i) === '{' && at(i - 1) === ')') {
      const params = pairs.get(i - 1);
      if (['if', 'for', 'while', 'switch', 'catch', 'with'].includes(at(params - 1))) continue;
      const named = identifier(at(params - 1)) && at(params - 2) === 'function';
      functions.push({ start: params, end: pairs.get(i), body: i, name: named ? at(params - 1) : null });
    }
  }
  const context = (i) => {
    const fn = functions.filter((f) => f.body <= i && i <= f.end).sort((a, b) => b.start - a.start)[0];
    return { containingFunction: fn?.name || null, contextExpression: fn ? source(fn.start, fn.end) : null };
  };

  const attributes = [];
  for (let i = 0; i < tokens.length; i++) {
    if (at(i) !== '<' || !identifier(at(i + 1))) continue;
    for (let j = i + 2; j < tokens.length && at(j) !== '>'; j++) {
      if (at(j) === 'data' && at(j + 1) === '-') {
        let eq = j + 2;
        while (identifier(at(eq)) || at(eq) === '-') eq++;
        const name = tokens.slice(j, eq).map((t) => t.value).join('');
        if (/^data-[a-z][a-z0-9-]*$/.test(name) && at(eq) === '=' && at(eq + 1) === '{' && identifier(at(eq + 2)) && at(eq + 3) === '}') {
          attributes.push({ attribute: name, state: at(eq + 2), ref: eq + 2, nameStart: j, nameEnd: eq, expression: source(j, eq + 3) });
        }
      }
      if (pairs.get(j) > j) j = pairs.get(j);
    }
  }

  const timers = [];
  const constants = [];
  const ambiguousTimer = tokens.some((t, ref) => t.value === 'setTimeout' && !bareCall(ref) && at(ref - 1) !== 'typeof');
  for (let i = 0; i < tokens.length; i++) {
    if (at(i) === 'const' && identifier(at(i + 1)) && at(i + 2) === '=' && number(at(i + 3)) && at(i + 4) === ';') {
      constants.push({ name: at(i + 1), ref: i + 1, start: i, end: i + 4, value: Number(at(i + 3)) });
    }
    if (at(i) !== 'setTimeout' || !bareCall(i)) continue;
    const end = pairs.get(i + 1);
    let comma = i + 2;
    while (comma < end && at(comma) !== ',') comma = (pairs.get(comma) > comma ? pairs.get(comma) : comma) + 1;
    const delayStart = comma + 1;
    let delayEnd = end - 1;
    if (at(delayEnd) === ',') delayEnd--;
    let call = i + 5;
    const arrow = at(i + 2) === '(' && at(i + 3) === ')' && at(i + 4) === '=>';
    const block = at(call) === '{';
    if (block) call++;
    const callEnd = pairs.get(call + 1);
    let callbackEnd = callEnd + 1;
    if (block && at(callbackEnd) === ';') callbackEnd++;
    if (block && at(callbackEnd) === '}') callbackEnd++;
    const simple = !ambiguousTimer && arrow && bareCall(call) && callEnd === call + 3 && ['true', 'false'].includes(at(call + 2)) && callbackEnd === comma;
    timers.push({ start: i, end, call, simple, delayStart, delayEnd });
  }

  for (let i = 0; i < tokens.length; i++) {
    if (at(i) !== 'const' || at(i + 1) !== '[' || !identifier(at(i + 2)) || at(i + 3) !== ',' || !identifier(at(i + 4)) || at(i + 5) !== ']' || at(i + 6) !== '=') continue;
    let hook = i + 7;
    if (at(hook) === 'React' && at(hook + 1) === '.') hook += 2;
    if (at(hook) !== 'useState') continue;
    let open = hook + 1;
    if (at(open) === '<' && at(open + 1) === 'boolean' && at(open + 2) === '>') open += 3;
    if (at(open) !== '(' || !['true', 'false'].includes(at(open + 1)) || at(open + 2) !== ')' || at(open + 3) !== ';') continue;
    const state = at(i + 2);
    const setter = at(i + 4);
    const attrs = attributes.filter((a) => a.state === state && visible(i, a.ref));
    if (!attrs.length) continue;
    const initial = at(open + 1) === 'true';
    const calls = tokens.flatMap((t, ref) => t.value === setter && bareCall(ref) && visible(i, ref) ? [ref] : []);
    const allowed = new Set([i + 2, i + 4, ...attrs.map((a) => a.ref), ...calls]);
    for (const attr of attributes) {
      for (let ref = attr.nameStart; ref < attr.nameEnd; ref++) allowed.add(ref);
    }
    if (tokens.some((t, ref) => (t.value === state || t.value === setter) && !allowed.has(ref))) {
      notes.push(`Skipped ${state}: ambiguous or unsupported state/setter references require manual translation.`);
      continue;
    }
    const activations = [];
    const resets = [];
    for (const call of calls) {
      const end = pairs.get(call + 1);
      const literal = end === call + 3 && ['true', 'false'].includes(at(call + 2));
      const timer = timers.find((t) => t.start < call && call < t.end);
      if (!literal || (timer && (!timer.simple || timer.call !== call))) {
        notes.push(`${state}: unsupported setter or timer callback ${source(call, end)}; manual translation required.`);
        continue;
      }
      const value = at(call + 2) === 'true';
      if (timer && value === initial) {
        const { delayStart, delayEnd } = timer;
        const delayExpression = delayStart <= delayEnd ? source(delayStart, delayEnd) : null;
        const single = delayStart === delayEnd;
        let delayMs = single && number(at(delayStart)) ? Number(at(delayStart)) : null;
        let delayEvidence = null;
        if (single && identifier(at(delayStart))) {
          const candidates = constants.filter((c) => c.name === at(delayStart) && visible(c.start, timer.start) && c.start < timer.start);
          const refs = new Set(timers.filter((t) => t.delayStart === t.delayEnd && at(t.delayStart) === at(delayStart)).map((t) => t.delayStart));
          if (candidates.length === 1) {
            const constant = candidates[0];
            refs.add(constant.ref);
            if (!tokens.some((t, ref) => t.value === constant.name && !refs.has(ref))) {
              delayMs = constant.value;
              delayEvidence = source(constant.start, constant.end);
            }
          }
        }
        if (delayMs === null) notes.push(`${state}: unknown reset delay ${delayExpression ?? '(omitted)'}; manual translation required.`);
        resets.push({ value, delayMs, expression: source(timer.start, timer.end), setterExpression: source(call, end), delayExpression, delayEvidence, ...context(timer.start) });
      } else if (!timer && value !== initial) {
        activations.push({ value, expression: source(call, end), ...context(call), trigger: { expression: source(call, end), manualTranslation: true } });
      } else {
        notes.push(`${state}: ${source(call, end)} is not a supported activation or timed reset; manual translation required.`);
      }
    }
    if (!activations.length) notes.push(`${state}: activation not established; manual translation required.`);
    else notes.push(`${state}: activation triggers and guards require manual translation from source; no event or prop-change semantics inferred.`);
    if (!resets.length) notes.push(`${state}: no supported timed reset found.`);
    if (resets.length > 1) notes.push(`${state}: multiple timed resets found; no single reset selected. See resetCandidates.`);
    for (const attr of attrs) {
      bindings.push({
        attribute: attr.attribute, state, setter, initial,
        source: { state: source(i, open + 2), attribute: attr.expression },
        activations,
        reset: resets.length === 1 ? resets[0] : null,
        ...(resets.length > 1 ? { resetCandidates: resets } : {}),
      });
    }
  }
  return { bindings, notes: [...new Set(notes)] };
}
