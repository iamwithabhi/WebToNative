/**
 * Building HTML in JavaScript without a framework, and without ever trusting a string.
 *
 * `html` is a template tag: every value put into it is escaped unless it is itself the result of
 * `html` (or `raw`). So text from a contract can never become markup, and a view is just a function that
 * returns the page it describes. Arrays are joined, and null, undefined and false vanish. Views are pure:
 * they touch no DOM, so they run in Node and are tested there.
 */

class Safe {
  constructor(s) {
    this.s = s;
  }

  toString() {
    return this.s;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text made safe to put inside markup or a quoted attribute. */
export const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Markup that is already safe: it is not escaped again. Use only for markup this code wrote. */
export const raw = (markup) => new Safe(String(markup));

const part = (v) => (v == null || v === false || v === true ? '' : v instanceof Safe ? v.s : Array.isArray(v) ? v.map(part).join('') : esc(v));

/** The template tag: `html\`<p>${text}</p>\``. */
export const html = (strings, ...values) => new Safe(strings.reduce((out, s, i) => out + part(values[i - 1]) + s));

/** Class names, joined: falsy ones are left out. */
export const cx = (...names) => names.filter(Boolean).join(' ');
