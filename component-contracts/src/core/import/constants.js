/**
 * What the source says about itself: named constants, and prop documentation.
 *
 * Two readers live here because both lift a sentence the author already wrote
 * and attach it to something the CSS and the types cannot carry.
 *
 * Named source constants, with the doc comment that explains each one.
 *
 * A component often states its numbers once, at module scope, next to a
 * sentence saying what they are for:
 *
 *   /** Repeat interval while a button is held. *\/
 *   const HOLD_INTERVAL_MS = 150;
 *
 * Those numbers matter to a platform team (a haptic length, a repeat interval,
 * a step multiplier, which icon size goes with which button size) and none of
 * them live in the CSS or the prop types. This reads them out verbatim.
 *
 * It does NOT infer what a constant does. The doc comment is the only meaning
 * attached, and a constant with none is reported with no description rather
 * than one guessed from its name. Anything that is not a plain literal is left
 * for manual translation and noted, never evaluated.
 *
 * Only module-scope declarations count: a constant inside a function is an
 * implementation detail of that function, not a stated design number.
 */

import { tokenize, brackets, isIdent, isNumber, isString, isComment } from './lex.js';

const unquote = (v) => v.slice(1, -1).replace(/\\(['"\\])/g, '$1');

/** The text of a /** block, markers and leading asterisks removed. */
function docText(comment) {
  return comment
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*+\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractSourceConstants(code) {
  const constants = [];
  const notes = [];
  if (typeof code !== 'string' || !code.trim()) return { constants, notes };

  // Tokens, comments included, so a doc block can be attached to what follows.
  const tokens = tokenize(code);

  // Depth of every token, so module scope is a fact rather than a guess.
  const { depth, balanced } = brackets(tokens);
  if (!balanced) {
    return { constants, notes: ['Skipped constant extraction: unbalanced source.'] };
  }

  const code$ = (i, j) => code.slice(tokens[i].start, tokens[j].end);
  const at = (i) => tokens[i]?.v;

  /** The /** block directly above token i, or null. A blank line breaks the link. */
  const docAbove = (i) => {
    const prev = tokens[i - 1];
    if (!prev || !prev.v.startsWith('/**')) return null;
    const gap = code.slice(prev.end, tokens[i].start);
    if (/\n[ \t]*\n/.test(gap)) return null;
    return docText(prev.v) || null;
  };

  for (let i = 0; i < tokens.length; i++) {
    if (isComment(tokens[i]) || depth[i] !== 0) continue;

    let declStart = i;
    if (at(i) === 'export' && at(i + 1) === 'const') i++;
    if (at(i) !== 'const' || !isIdent(at(i + 1)) || depth[i] !== 0) continue;

    const name = at(i + 1);
    let j = i + 2;
    // Optional type annotation: skip to '=' without crossing a statement end.
    while (j < tokens.length && at(j) !== '=' && at(j) !== ';' && !isComment(tokens[j])) j++;
    if (at(j) !== '=') continue;

    const rhs = j + 1;
    const first = at(rhs);

    /** Where this statement ends: a ';' at depth 0, else the next declaration. */
    const stmtEnd = () => {
      let k = rhs;
      while (k < tokens.length && !(at(k) === ';' && depth[k] === 0)) {
        if (depth[k] === 0 && k > rhs && (at(k) === 'const' || at(k) === 'export' || at(k) === 'function')) return k - 1;
        k++;
      }
      return Math.min(k, tokens.length - 1);
    };
    const end = stmtEnd();
    const finish = (value, kind, lastTok) => {
      const declEnd = at(lastTok + 1) === ';' ? lastTok + 1 : lastTok;
      constants.push({
        name,
        kind,
        value,
        description: docAbove(declStart),
        source: code$(declStart, declEnd),
      });
      i = declEnd;
    };

    // number, optionally negative
    if (first === '-' && isNumber(at(rhs + 1)) && (at(rhs + 2) === ';' || rhs + 2 > end)) {
      finish(-Number(at(rhs + 1)), 'number', rhs + 1);
      continue;
    }
    if (isNumber(first) && (at(rhs + 1) === ';' || rhs + 1 > end)) {
      finish(Number(first), 'number', rhs);
      continue;
    }
    // string
    if (isString(first) && (at(rhs + 1) === ';' || rhs + 1 > end)) {
      finish(unquote(first), 'string', rhs);
      continue;
    }
    // flat object of literals, optionally `as const`
    if (first === '{') {
      const close = tokens.findIndex((t, k) => k > rhs && depth[k] === depth[rhs] && t.v === '}');
      const map = {};
      let flat = close > rhs;
      let k = rhs + 1;
      while (flat && k < close) {
        if (isComment(tokens[k])) { k++; continue; }
        const key = at(k);
        const colon = at(k + 1);
        const val = at(k + 2);
        const okKey = isIdent(key) || isString(key) || isNumber(key);
        const okVal = isString(val) || isNumber(val);
        if (!okKey || colon !== ':' || !okVal) { flat = false; break; }
        map[isString(key) ? unquote(key) : key] = isString(val) ? unquote(val) : Number(val);
        k += 3;
        if (at(k) === ',') k++;
      }
      const after = close + 1;
      const hasAsConst = at(after) === 'as' && at(after + 1) === 'const';
      const last = hasAsConst ? after + 1 : close;
      if (flat && (at(last + 1) === ';' || last + 1 > end)) {
        finish(map, 'map', last);
        continue;
      }
    }

    // Looks like data but is not a plain literal: say so instead of guessing.
    const loneIdentifier = isIdent(first) && !['function', 'class', 'async', 'new'].includes(first) && at(rhs + 1) === ';';
    const dataLike = isNumber(first) || first === '-' || isString(first) || first === '{' || first === '[' || loneIdentifier;
    if (dataLike) {
      notes.push(`${name}: value is not a plain literal; manual translation required.`);
    }
    i = Math.max(i, end);
  }

  return { constants, notes: [...new Set(notes)] };
}

/**
 * The doc comment above each prop of a `*Props` interface.
 *
 * These carry design meaning the type alone does not (what a prop does to
 * assistive technology, what it requires, when to prefer one over another) and
 * extractProps reads comment-stripped source, so it never saw them. The text is
 * taken verbatim; a prop with no doc comment has none, rather than one guessed
 * from its name.
 */
export function extractPropDocs(code) {
  if (typeof code !== 'string' || !code.trim()) return {};

  // Comment bodies blanked, offsets preserved, so a brace inside a comment
  // cannot throw the matching off while the original text is still sliceable.
  const masked = code.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (c) => c.replace(/[^\n]/g, ' '));
  const header = masked.match(/(?:export\s+)?(?:interface|type)\s+\w*Props\w*\s*(?:extends[^{]+)?(?:=\s*)?\{/);
  if (!header) return {};

  const open = header.index + header[0].length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}' && --depth === 0) { close = i; break; }
  }
  if (close < 0) return {};

  const body = masked.slice(open + 1, close);
  const docs = {};
  const memberRe = /^[ \t]*(\w+)\??[ \t]*:/gm;
  let m;
  while ((m = memberRe.exec(body))) {
    // Only members at the interface's own depth, not those of a nested type.
    const before = body.slice(0, m.index);
    const nesting = (before.match(/[{(\[]/g) || []).length - (before.match(/[})\]]/g) || []).length;
    if (nesting !== 0) continue;

    const at = open + 1 + m.index;
    const above = code.slice(0, at);
    // The comment must end the text directly above (one newline, no blank
    // line) and start at the NEAREST opener, not an earlier prop's.
    const endIdx = above.search(/\*\/[ \t]*\n[ \t]*$/);
    if (endIdx < 0) continue;
    const startIdx = above.lastIndexOf('/**', endIdx);
    if (startIdx < 0) continue;
    const text = docText(above.slice(startIdx, endIdx + 2));
    if (text) docs[m[1]] = text;
  }
  return docs;
}
