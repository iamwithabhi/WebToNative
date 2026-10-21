/**
 * The token vocabulary a component uses.
 *
 * There is no central token library. Each contract carries the tokens its
 * component references, discovered when the component was added:
 *
 *   "tokens": {
 *     "brand.500": { "value": "#3b5bdb", "type": "color"     },
 *     "brand.600": { "value": null,      "type": "color"     },
 *     "space.md":  { "value": 12,        "type": "dimension" }
 *   }
 *
 * A null value is normal and not a problem. It means the component referenced
 * the token without declaring it — the platform's own token library supplies
 * the value at build time. What has to resolve here is the NAME, because that
 * is what becomes `DSTokens.brand600` in generated Swift.
 */

const ALIAS_RE = /^\{([^}]+)\}$/;

const segments = (path) => String(path).split('.').filter(Boolean);

const casers = {
  kebab: (p) => segments(p).join('-').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(),
  snake: (p) => segments(p).join('_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase(),
  camel: (p) =>
    segments(p)
      .map((s, i) => (i === 0 ? s.charAt(0).toLowerCase() + s.slice(1) : s.charAt(0).toUpperCase() + s.slice(1)))
      .join(''),
  pascal: (p) => segments(p).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(''),
  dot: (p) => segments(p).join('.'),
};

/** Expand a symbol pattern such as `DSTokens.{path|camel}`. */
export function applyPattern(pattern, path) {
  return pattern.replace(/\{path(?:\|(\w+))?\}/g, (_, mode) => {
    const fn = casers[mode || 'dot'];
    if (!fn) throw new Error(`Unknown casing mode "${mode}" in pattern "${pattern}"`);
    return fn(path);
  });
}

/**
 * Parse a contract token reference: "{brand.500}" -> "brand.500".
 * Returns null when the string is a literal rather than a reference.
 */
export function asTokenRef(value) {
  if (typeof value !== 'string') return null;
  const m = value.match(ALIAS_RE);
  return m ? m[1].trim() : null;
}

export class TokenIndex {
  /**
   * @param {Record<string,{value:*,type:string}>} tokens  the contract's vocabulary
   * @param {Record<string,{pattern:string,import?:string}>} symbols  per-platform naming
   */
  constructor(tokens = {}, symbols = {}) {
    this.tokens = new Map(Object.entries(tokens));
    this.symbolConfig = symbols;
  }

  /** Build from a contract's own `tokens` block. */
  static fromContract(contract, symbols = {}) {
    return new TokenIndex(contract?.tokens || {}, symbols);
  }

  has(name) {
    return this.tokens.has(name);
  }

  get(name) {
    return this.tokens.get(name) || null;
  }

  get size() {
    return this.tokens.size;
  }

  names() {
    return [...this.tokens.keys()].sort();
  }

  /** All tokens as a list, for pickers and previews. */
  list() {
    return this.names().map((name) => ({ name, ...this.tokens.get(name) }));
  }

  /**
   * The resolved value, when the component declared one.
   * Returns null for a referenced-but-undeclared token, which is expected.
   */
  valueOf(name) {
    return this.tokens.get(name)?.value ?? null;
  }

  typeOf(name) {
    return this.tokens.get(name)?.type || 'unknown';
  }

  /** The symbol a platform uses: ("brand.500", "ios") -> "DSTokens.brand500". */
  symbolFor(name, platform) {
    const cfg = this.symbolConfig[platform];
    if (!cfg?.pattern) {
      throw new Error(`No symbol pattern configured for platform "${platform}"`);
    }
    return applyPattern(cfg.pattern, name);
  }

  importFor(platform) {
    return this.symbolConfig[platform]?.import || null;
  }
}
