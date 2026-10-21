/**
 * A small tokenizer shared by the source readers.
 *
 * Comments, strings and template literals are single opaque tokens, so a
 * keyword inside one can never be mistaken for code. Nothing here evaluates
 * anything. It is deliberately not a JavaScript parser: regex literals and
 * unusual syntax can unbalance it, which callers must treat as "skip and say so"
 * rather than "guess".
 */

const LEX =
  /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\[\s\S]|[^'\\\n])*'|"(?:\\[\s\S]|[^"\\\n])*"|`(?:\\[\s\S]|[^`\\])*`|[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|=>|[^\s]/g;

export const isIdent = (v) => /^[A-Za-z_$][\w$]*$/.test(v || '');
export const isNumber = (v) => /^\d+(?:\.\d+)?$/.test(v || '');
export const isString = (v) => /^'.*'$|^".*"$/s.test(v || '');
export const isComment = (t) => t.v.startsWith('//') || t.v.startsWith('/*');

/** Tokens in source order, whitespace dropped, comments kept. */
export function tokenize(code) {
  const tokens = [];
  for (const m of String(code).matchAll(LEX)) {
    if (/^\s/.test(m[0])) continue;
    tokens.push({ v: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

/**
 * The bracket depth of every token, and the index of each bracket's partner.
 * `balanced` is false when the source cannot be paired, which is the signal to
 * give up rather than read on.
 */
export function brackets(tokens) {
  const depth = [];
  const pair = new Map();
  const stack = [];
  const close = { '}': '{', ')': '(', ']': '[' };
  let ok = true;

  for (let i = 0; i < tokens.length; i++) {
    const v = isComment(tokens[i]) ? '' : tokens[i].v;
    if (close[v]) {
      const open = stack.pop();
      if (open === undefined || tokens[open].v !== close[v]) { ok = false; depth[i] = 0; continue; }
      pair.set(open, i);
      pair.set(i, open);
    }
    depth[i] = stack.length;
    if (v === '{' || v === '(' || v === '[') stack.push(i);
  }
  return { depth, pair, balanced: ok && stack.length === 0 };
}
