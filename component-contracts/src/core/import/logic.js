/**
 * The logic a component's markup depends on, quoted verbatim.
 *
 * A stylesheet and a type list cannot say when a button is disabled, what
 * holding it does, which keys act on it or how a default label is built. That
 * is logic, and the choices for it are to invent a state machine (which this
 * project exists to prevent) or to hand the platform team the source and let
 * them translate it. This does the second.
 *
 * What counts as relevant is a fact, not a guess: start from the names the
 * markup refers to (handlers, a spread helper, `aria-label={decrementName}`,
 * `{value}`), and follow only the names those statements refer to in turn.
 * Everything unreachable from the markup is left out.
 *
 * That includes state. `const [pop, setPop] = useState(false)` is quoted when
 * reachable code reads or sets it, because "used but never defined" is exactly
 * what a reader cannot translate; an unreferenced hook stays out. A statement
 * that keeps a ref in step with a value (`valueRef.current = value`) is kept for
 * the same reason, as is an effect that touches anything reachable, which is
 * where "release anywhere ends the hold" lives.
 *
 * It quotes statements exactly as written. It does not evaluate, summarise or
 * translate them, and a statement it cannot read cleanly is reported rather
 * than approximated.
 */

import { tokenize, brackets, isIdent, isComment } from './lex.js';

const STARTERS = new Set(['const', 'let', 'var', 'function', 'class', 'export', 'import', 'type', 'interface', 'enum']);
const BLOCK_STARTERS = new Set(['if', 'for', 'while', 'switch', 'try', 'return', 'throw']);
const EFFECTS = new Set(['useEffect', 'useLayoutEffect', 'useInsertionEffect']);
const NOT_A_FUNCTION_BODY = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);
/** Words that continue an expression across a newline rather than start a statement. */
const CONTINUES = new Set(['else', 'catch', 'finally', 'as', 'satisfies', 'instanceof', 'in', 'of', 'extends']);

const MAX_SOURCE = 2500;
const MAX_ENTRIES = 40;

export function extractLogic(code, { roots = [] } = {}) {
  const notes = [];
  const empty = (note) => ({ entries: [], notes: note ? [note] : [] });
  if (typeof code !== 'string' || !code.trim()) return empty();

  const tokens = tokenize(code);
  const { depth, pair, balanced } = brackets(tokens);
  if (!balanced) return empty('Skipped logic extraction: the source could not be paired (a regex literal or unusual syntax), so it is left for manual translation.');

  const at = (i) => tokens[i]?.v;
  const text = (s, e) => code.slice(tokens[s].start, tokens[e].end);
  const newlineBetween = (i, j) => /\n/.test(code.slice(tokens[i].end, tokens[j].start));
  const live = (i) => !isComment(tokens[i]);
  /** Can this token be the last of an expression? (so a newline after it may end a statement) */
  const endsExpression = (i) => {
    const v = at(i);
    return isIdent(v) || /^[\d'"`]/.test(v) || v === ')' || v === ']' || v === '}';
  };

  /* ---- where the markup is returned ---- */
  let returnChar = -1;
  for (const re of [/\breturn\s*\(\s*(?=<)/g, /\breturn\s+(?=<)/g]) {
    const all = [...code.matchAll(re)];
    if (all.length) { returnChar = all[all.length - 1].index; break; }
  }
  if (returnChar < 0) return empty('No returned markup was found, so no logic could be tied to it.');
  const ri = tokens.findIndex((t) => t.start >= returnChar);

  /* ---- the function that contains it ---- */
  const bodies = [];
  for (let o = 0; o < tokens.length; o++) {
    if (at(o) !== '{' || !live(o) || !pair.has(o)) continue;
    const prev = at(o - 1);
    let isBody = prev === '=>';
    if (prev === ')') {
      const open = pair.get(o - 1);
      isBody = !NOT_A_FUNCTION_BODY.has(at(open - 1));
    } else if (isIdent(prev) && at(o - 2) === ':' && at(o - 3) === ')') {
      isBody = true; // function f(a): Type {
    }
    if (isBody) bodies.push([o, pair.get(o)]);
  }
  const containing = bodies.filter(([o, c]) => o < ri && ri < c).sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]));
  if (!containing.length) return empty('The component function could not be located.');
  const [bo, bc] = containing[0];
  const bodyDepth = depth[bo] + 1;

  /* ---- classify one statement ---- */
  const classify = (s, e, scope) => {
    let i = s;
    if (at(i) === 'export') i++;
    if (at(i) === 'default') i++;
    if (at(i) === 'async' && at(i + 1) === 'function') i++;

    if (at(i) === 'function' && isIdent(at(i + 1))) {
      return { name: at(i + 1), names: [at(i + 1)], kind: 'function', scope, s, e };
    }
    if (scope === 'component' && EFFECTS.has(at(i)) && at(i + 1) === '(') {
      return { name: at(i), names: [], kind: 'effect', scope, s, e };
    }
    // `ref.current = value;` keeps a ref in step with a value on every render.
    if (scope === 'component' && isIdent(at(i)) && at(i + 1) === '.' && at(i + 2) === 'current' && at(i + 3) === '=') {
      return { name: `${at(i)}.current`, names: [], kind: 'assignment', scope, s, e };
    }
    if (at(i) !== 'const' && at(i) !== 'let') return null;

    // One name, or `const [a, b] = useX(...)` (kept only for a hook, below).
    let names;
    let eq;
    if (isIdent(at(i + 1))) {
      names = [at(i + 1)];
      eq = i + 2;
      while (eq <= e && !(at(eq) === '=' && depth[eq] === depth[i])) eq++;
    } else if (at(i + 1) === '[' && pair.has(i + 1)) {
      names = [];
      for (let k = i + 2; k < pair.get(i + 1); k++) if (isIdent(at(k)) && live(k)) names.push(at(k));
      eq = pair.get(i + 1) + 1;
    } else {
      return null; // object destructuring: props, not logic
    }
    if (eq > e || at(eq) !== '=' || !names.length) return null;

    const k = eq + 1;
    const first = at(k);
    const initEnd = at(e) === ';' ? e - 1 : e;
    if (k > initEnd) return null;

    const functionLike =
      first === 'function' ||
      first === 'useCallback' ||
      (first === 'async' && (at(k + 1) === 'function' || at(k + 1) === '(' || at(k + 2) === '=>')) ||
      (isIdent(first) && at(k + 1) === '=>') ||
      (first === '(' && pair.has(k) && at(pair.get(k) + 1) === '=>') ||
      // a typed arrow: (a: A): B => ...
      (first === '(' && pair.has(k) && at(pair.get(k) + 1) === ':' && tokens.slice(pair.get(k) + 1, initEnd + 1).some((t) => t.v === '=>'));
    if (functionLike && names.length === 1) return { name: names[0], names, kind: 'function', scope, s, e };

    if (/^use[A-Z]/.test(first)) {
      if (scope === 'module') return null;
      // useMemo is a derived value; every other hook holds state, a ref or an id.
      return { name: names[0], names, kind: first === 'useMemo' ? 'value' : 'state', hook: first, scope, s, e };
    }
    if (names.length > 1) return null;
    if (scope === 'module') return null; // module literals are sourceConstants

    // A bare literal is a constant, not logic.
    if (k === initEnd && /^(['"`]|\d|true$|false$|null$)/.test(first)) return null;
    return { name: names[0], names, kind: 'value', scope, s, e };
  };

  /* ---- statements at one depth, split without a full parser ---- */
  const statementsIn = (from, to, atDepth, startsStatement) => {
    const out = [];
    let i = from;
    while (i <= to) {
      if (!live(i) || depth[i] !== atDepth || !startsStatement(i)) { i++; continue; }
      const s = i;
      let j = i;
      let e = -1;
      const head = at(s) === 'export' ? at(s + 1) : at(s);
      while (j <= to) {
        if (live(j) && depth[j] === atDepth) {
          if (at(j) === ';') { e = j; break; }
          if (at(j) === '}' && j > s) {
            const next = j + 1 <= to ? j + 1 : -1;
            const fnDecl = head === 'function' || head === 'async' || head === 'class' || BLOCK_STARTERS.has(head);
            const continues = next > 0 && ['else', 'catch', 'finally'].includes(at(next));
            const ends = next < 0 || (newlineBetween(j, next) && startsStatement(next));
            if ((fnDecl && !continues) || (ends && !continues)) { e = j; break; }
          }
        }
        // Without a semicolon, a newline ends the statement when the previous token
        // ends an expression and the next one can begin a statement - unless the
        // next one continues it (`else`, `as`, `instanceof` ...). This is the
        // rule JavaScript itself applies, not a list of declaration keywords.
        if (j > s && live(j) && depth[j] === atDepth && isIdent(at(j)) && !CONTINUES.has(at(j))) {
          let p = j - 1;
          while (p > s && !live(p)) p--;
          if (newlineBetween(p, j) && endsExpression(p)) {
            e = p;
            break;
          }
        }
        j++;
      }
      if (e < 0) e = to;
      out.push([s, e]);
      i = e + 1;
    }
    return out;
  };

  const moduleStart = (i) => STARTERS.has(at(i));
  const bodyStart = (i) => {
    const v = at(i);
    return STARTERS.has(v) || BLOCK_STARTERS.has(v) || EFFECTS.has(v) || /^use[A-Z]/.test(v) || isIdent(v);
  };

  const all = [];
  for (const [s, e] of statementsIn(0, tokens.length - 1, 0, moduleStart)) {
    if (s <= ri && ri <= e) continue; // the component itself
    const c = classify(s, e, 'module');
    if (c) all.push(c);
  }
  for (const [s, e] of statementsIn(bo + 1, bc - 1, bodyDepth, bodyStart)) {
    const c = classify(s, e, 'component');
    if (c) all.push(c);
  }

  /* ---- reachability from the markup ---- */
  const named = all.filter((x) => x.names.length);
  const byName = new Map();
  for (const entry of named) {
    for (const n of entry.names) if (!byName.has(n) || entry.scope === 'component') byName.set(n, entry);
  }

  const namesIn = (entry) => {
    const out = new Set();
    for (let i = entry.s; i <= entry.e; i++) {
      if (live(i) && isIdent(at(i)) && at(i - 1) !== '.' && at(i - 1) !== '?.') out.add(at(i));
    }
    return out;
  };

  const reached = new Set();
  const queue = [];
  const reach = (name) => {
    const entry = byName.get(name);
    if (entry && !reached.has(entry)) { reached.add(entry); queue.push(entry); }
  };
  for (const r of roots) reach(r);

  // Effects and ref-sync statements have no name to be reached by: they are kept
  // when they touch anything reachable, and what they touch becomes reachable.
  const glue = all.filter((x) => x.kind === 'effect' || x.kind === 'assignment');
  const keptGlue = new Set();
  const touches = (g) => [...namesIn(g)].some((n) => reached.has(byName.get(n)));
  for (;;) {
    while (queue.length) for (const n of namesIn(queue.shift())) reach(n);
    let grew = false;
    for (const g of glue) {
      if (keptGlue.has(g) || !touches(g)) continue;
      keptGlue.add(g);
      grew = true;
      for (const n of namesIn(g)) reach(n);
    }
    if (!grew && !queue.length) break;
  }

  /* ---- the result, in source order ---- */
  let picked = [...reached, ...keptGlue].sort((a, b) => a.s - b.s);
  if (picked.length > MAX_ENTRIES) {
    notes.push(`${picked.length} statements are reachable from the markup; only the first ${MAX_ENTRIES} are quoted.`);
    picked = picked.slice(0, MAX_ENTRIES);
  }

  const pickedSet = new Set(picked);
  const labelOf = (entry) => entry.name;
  let glueN = 0;
  const entries = picked.map((e) => {
    const source = text(e.s, e.e);
    const truncated = source.length > MAX_SOURCE;
    if (truncated) notes.push(`${labelOf(e)}: quoted source is longer than ${MAX_SOURCE} characters and was cut; read the file for the rest.`);
    const uses = new Set();
    for (const n of namesIn(e)) {
      const other = byName.get(n);
      if (other && other !== e && pickedSet.has(other)) uses.add(other.name);
    }
    return {
      name: e.kind === 'effect' ? `${e.name}#${++glueN}` : e.name,
      kind: e.kind,
      scope: e.scope,
      // Which hook holds it: useState, useRef and useId are all "state" to a
      // reader who cannot tell a timer handle from a value that re-renders.
      ...(e.hook ? { hook: e.hook } : {}),
      ...(e.names.length > 1 ? { also: e.names.slice(1) } : {}),
      source: truncated ? source.slice(0, MAX_SOURCE) : source,
      ...(truncated ? { truncated: true } : {}),
      uses: [...uses].sort(),
    };
  });

  return { entries, notes: [...new Set(notes)] };
}
