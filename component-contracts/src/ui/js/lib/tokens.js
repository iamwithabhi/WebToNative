/**
 * How a value is named in the reader.
 *
 * A token is shown by its name and never by its path, a literal as written, and a
 * token whose value the component does not declare says so instead of showing a
 * guess. This is the reader's wording only: the specs keep the path.
 *
 * Pure: no DOM, so it is tested in Node with the rest of the logic.
 */

/** `{semantic.spacing.0}` -> `semantic.spacing.0`, or null for anything else. */
export const tokenRef = (v) => (typeof v === 'string' && /^\{(.+)\}$/.test(v) ? v.slice(1, -1) : null);

export const isColor = (v) => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v);

/** `semantic.spacing.0` -> `semantic spacing 0`. */
export const tokenLabel = (ref) => String(ref).split('.').join(' ');

/** What to draw for one value: nothing set, a literal, or a token with what is known of it. */
export function applied(value, tokenMap) {
  if (value == null || value === '') return { kind: 'unset' };
  const ref = tokenRef(value);
  if (!ref) {
    // A length written as an object ({ value: 8, unit: 'px' }) is put into words, never drawn as "[object Object]".
    const text = typeof value === 'object' ? valueWords(value) : String(value);
    return { kind: 'literal', text, none: text === 'transparent' || text === 'none' };
  }
  const resolved = tokenMap.get(ref);
  return {
    kind: 'token',
    label: tokenLabel(ref),
    color: isColor(resolved) ? resolved : null,
    // A colour is its swatch; anything else the contract knows is shown as text.
    value: resolved != null && !isColor(resolved) ? String(resolved) : null,
  };
}

/** Any value a node states, in words: a token by name, an expression with its tokens named. */
export function valueWords(v) {
  if (v == null || v === '') return '\u2014';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    const ref = tokenRef(v);
    return ref ? tokenLabel(ref) : v;
  }
  if (v.expression) return v.expression.replace(/\{([^}]+)\}/g, (_, ref) => tokenLabel(ref));
  if (v.value !== undefined) return `${v.value}${v.unit && v.unit !== '%' ? ` ${v.unit}` : v.unit || ''}`;
  return JSON.stringify(v);
}

/** Set (or, for an empty value, remove) a dotted path, creating the parents on the way down. */
export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let node = obj;
  for (const k of keys) {
    if (node[k] == null || typeof node[k] !== 'object') node[k] = {};
    node = node[k];
  }
  if (value === '' || value === undefined) delete node[last];
  else node[last] = value;
}
