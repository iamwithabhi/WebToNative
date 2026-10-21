/**
 * Token discovery.
 *
 * There is no external token library. A component's token vocabulary comes from
 * the component itself: the custom properties it references, the utility
 * classes it applies, and any `--token: value` declarations it happens to ship.
 *
 * So this module does not match values against a catalogue — it *finds* the
 * tokens a component uses and reports them, with a value when the source
 * happens to declare one and a type inferred from how the token is used.
 *
 * A token whose value is unknown is still perfectly usable: the platform's own
 * token library supplies it at build time. What matters here is the name.
 */

import { UTILITY_ROLES, typeForRole } from '../platform-map.js';

export { UTILITY_ROLES, typeForRole };

const strip = (s) => String(s).trim().replace(/^['"]|['"]$/g, '');

/** Prefixes whose value is a dimension rather than a colour. */
const SIZE_PREFIXES = new Set(['px', 'py', 'p', 'gap', 'rounded', 'leading']);

export const isColorValue = (v) => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(String(v).trim());

/** A CSS value with no var() and no units — usable as a literal. */
function literalValue(raw) {
  const v = strip(raw);
  if (isColorValue(v)) return v.toLowerCase();
  const num = v.match(/^(-?[\d.]+)(px|rem|em|pt|dp|sp|ms|s|%)?$/);
  if (num) {
    const n = parseFloat(num[1]);
    return num[2] === 's' ? n * 1000 : n;
  }
  return v || null;
}

export class TokenMatcher {
  /**
   * @param {object} opts
   * @param {string|null} opts.cssPrefix  optional namespace filter, e.g. `--ds-`.
   *   Left null, any custom property qualifies — which is usually right, since
   *   real design systems use several prefixes at once.
   * @param {Set<string>} opts.localVars  properties the component declares for
   *   its own use. These are implementation detail, not design tokens.
   */
  constructor({ cssPrefix = null, localVars = new Set(), localAliases = new Map() } = {}) {
    this.cssPrefix = cssPrefix;
    this.localVars = localVars;
    /**
     * Local variables declared exactly once, mapped to their declared value.
     *
     *   --ds-button-touch-target: var(--semantic-size-48)
     *
     * Following one of these is reading the stylesheet, not guessing. Only
     * single-valued ones qualify: a variable reassigned per variant (like
     * `--ds-button-bg`) has no single answer to follow.
     */
    this.localAliases = localAliases;
    /** name -> { value, type, from } discovered along the way. */
    this.found = new Map();
  }

  /**
   * Is this custom property a design token?
   *
   * A property the component declares for itself (`--ds-button-bg`) is a local
   * variable. One it only ever reads (`--component-color-button-...`) comes
   * from outside, which makes it a token. This needs no configuration and
   * survives whatever prefixes a design system happens to use.
   */
  isToken(prop) {
    const name = String(prop).trim();
    if (!name.startsWith('--')) return false;
    if (this.localVars.has(name)) return false;
    if (this.cssPrefix && !name.startsWith(this.cssPrefix)) return false;
    return true;
  }

  /** Record a token, keeping the most informative version seen. */
  record(name, { value = null, type = null, from = 'usage' } = {}) {
    const prior = this.found.get(name);
    this.found.set(name, {
      value: value ?? prior?.value ?? null,
      type: type || prior?.type || null,
      from: value != null ? 'declaration' : prior?.from || from,
    });
    return name;
  }

  /** Everything discovered, as a plain object for the contract. */
  vocabulary() {
    return Object.fromEntries(
      [...this.found.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, t]) => [name, { value: t.value, type: t.type || 'unknown' }])
    );
  }

  /** `--component-color-button-primary-bg` -> `component.color.button.primary.bg` */
  nameFromCustomProperty(prop) {
    const name = String(prop).trim();
    if (!this.isToken(name)) return null;
    const body = this.cssPrefix && name.startsWith(this.cssPrefix)
      ? name.slice(this.cssPrefix.length)
      : name.replace(/^--/, '');
    return body.split('-').filter(Boolean).join('.');
  }

  /**
   * `--ds-brand-500: #3b5bdb` — a declaration, so the value is known.
   * These are the only place a component tells us what a token actually is.
   */
  declaration(prop, rawValue, role) {
    const name = this.nameFromCustomProperty(prop);
    if (!name) return null;
    const value = literalValue(rawValue);
    this.record(name, {
      value,
      type: isColorValue(value) ? 'color' : role ? typeForRole(role) : typeof value === 'number' ? 'dimension' : null,
      from: 'declaration',
    });
    return { ref: `{${name}}`, name, value, via: 'css-declaration' };
  }

  /** `var(--ds-brand-600)` -> `{brand.600}`. Always a token, value may be unknown. */
  fromCssVar(text, role, seen = new Set()) {
    const m = String(text).match(/var\(\s*(--[a-z0-9-]+)\s*(?:,[^)]*)?\)/i);
    if (!m) return null;
    const prop = m[1];

    // A single-valued local variable stands for whatever it was declared as.
    if (this.localVars.has(prop) && this.localAliases.has(prop) && !seen.has(prop)) {
      seen.add(prop);
      const via = this.fromCssVar(this.localAliases.get(prop), role, seen);
      if (via) return { ...via, through: prop };
    }

    const name = this.nameFromCustomProperty(prop);
    if (!name) return null;
    this.record(name, { type: role ? typeForRole(role) : null, from: 'usage' });
    return { ref: `{${name}}`, name, confidence: 'high', via: 'css-var' };
  }

  /** `bg-brand-500` -> { role: 'fill', ref: '{brand.500}' }. */
  fromUtilityClass(cls) {
    const raw = strip(cls);
    const dash = raw.indexOf('-');
    if (dash < 0) return null;

    const prefix = raw.slice(0, dash);
    const rest = raw.slice(dash + 1);
    let role = UTILITY_ROLES[prefix];
    if (!role) return null;

    if (rest === 'transparent' || rest === 'none' || rest === 'current') {
      return { role, ref: rest === 'current' ? 'currentColor' : rest, via: 'utility-literal' };
    }

    const name = rest.split('-').filter(Boolean).join('.');
    if (!name) return null;

    // `text-` is overloaded: colour and font size. A trailing size-ish segment
    // is the only honest hint available without a catalogue to check against.
    if (prefix === 'text' && /(^|\.)(size|textsize)(\.|$)/i.test(name)) role = 'fontSize';
    if (prefix === 'font' && /(^|\.)(family|sans|serif|mono)(\.|$)/i.test(name)) role = 'fontFamily';

    this.record(name, {
      type: SIZE_PREFIXES.has(prefix) || role === 'fontSize' ? 'dimension' : typeForRole(role),
      from: 'usage',
    });
    return { role, ref: `{${name}}`, name, confidence: 'high', via: 'utility-class' };
  }

  /**
   * A bare value such as `#3b5bdb` or `12px`.
   *
   * Only resolvable to a token when the component itself declared one with that
   * value. Otherwise it is a hardcoded value — reported so it can be tokenised,
   * never silently attached to a name we invented.
   */
  fromLiteral(rawValue) {
    const value = literalValue(rawValue);
    if (value == null) return null;

    const matches = [...this.found.entries()].filter(([, t]) => t.value != null && t.value === value);
    if (!matches.length) return { ref: null, value, hardcoded: true, via: 'literal-value' };
    if (matches.length > 1) {
      return { ref: null, value, ambiguous: matches.map(([n]) => n), via: 'literal-value' };
    }
    return { ref: `{${matches[0][0]}}`, name: matches[0][0], value, confidence: 'medium', via: 'literal-value' };
  }

  /** Try the custom-property route first, then a declared literal. */
  fromCssValue(value, role) {
    return this.fromCssVar(value, role) || this.fromLiteral(value);
  }
}
