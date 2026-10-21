/**
 * Source-scoped visual rules.
 *
 * Keeps arithmetic, selector conditions, pseudo-elements, media overrides and
 * keyframes instead of flattening them into one root style. This is a bounded
 * CSS reader, not a browser: anything it does not understand is retained as
 * evidence and marked for manual translation, and nothing is dropped without
 * being recorded.
 *
 * Two things it deliberately will not do:
 *   - invent a value the stylesheet does not state. A transition with no timing
 *     function gets CSS's own default (ease), flagged as implied; a keyframe
 *     with no `from` frame is marked implied rather than given a made-up start.
 *   - decide what a property means for a platform. It reads CSS into named
 *     roles; platform-map.json says what each role becomes.
 */
import { VISUAL_PROPERTY, WEB_ONLY_PROPERTIES, ANIMATION } from '../platform-map.js';

const TIME = /^\d*\.?\d+(ms|s)$/;
const toMs = (t) => parseFloat(t) * (t.endsWith('ms') ? 1 : 1000);
const TIMING = /^(linear|ease|ease-in|ease-out|ease-in-out|cubic-bezier\(.+\))$/;
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/** Properties read by dedicated branches below, so they are never "unrecognised". */
const HANDLED = new Set([
  'border', 'outline', 'padding', 'flex', 'transition', 'transition-duration',
  'transform', 'animation', 'animation-duration',
]);

function split(value, delimiter) {
  const parts = [];
  let start = 0, depth = 0, quote = null;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quote) { if (c === quote && value[i - 1] !== '\\') quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (!depth && (delimiter === ' ' ? /\s/.test(c) : c === delimiter)) {
      if (value.slice(start, i).trim()) parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (value.slice(start).trim()) parts.push(value.slice(start).trim());
  return parts;
}

/** The balanced `selector { body }` blocks at the top level of `text`. */
function scanBlocks(text) {
  const out = [];
  let pos = 0;
  while (pos < text.length) {
    const open = text.indexOf('{', pos);
    if (open < 0) break;
    const selector = text.slice(pos, open).trim();
    let end = open + 1, depth = 1, quote = null;
    while (end < text.length && depth) {
      const c = text[end];
      if (quote) { if (c === quote && text[end - 1] !== '\\') quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      end++;
    }
    out.push({ selector, body: text.slice(open + 1, end - 1) });
    pos = end;
  }
  return out;
}

const declarationsOf = (body) =>
  split(body, ';')
    .map((s) => {
      const colon = s.indexOf(':');
      return colon < 0 ? null : [s.slice(0, colon).trim(), s.slice(colon + 1).trim()];
    })
    .filter(Boolean);

/** `ease-in-out` -> { type: 'easeInOut' }; a bezier keeps its control points. */
function curveOf(timing) {
  if (!timing) return { type: ANIMATION.cssDefaultTimingCurve, implied: true };
  if (timing.startsWith('cubic-bezier')) {
    return { type: 'cubicBezier', value: split(timing.slice(13, -1), ',').map(Number) };
  }
  return { type: camel(timing) };
}

export function extractVisualRules(raw, matcher) {
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [], notes = [], keyframes = {};
  const ignored = { webOnly: new Set(), unrecognised: new Set() };

  const valueOf = (rawValue, role, seen = new Set()) => {
    let unresolved = false;
    // Replace balanced var() calls, including local aliases, without losing
    // calc operators or other token operands.
    const substitute = (text) => {
      let out = '', pos = 0;
      const re = /var\(/g;
      let m;
      while ((m = re.exec(text))) {
        out += text.slice(pos, m.index);
        let end = m.index + 4, depth = 1;
        while (end < text.length && depth) {
          if (text[end] === '(') depth++;
          if (text[end] === ')') depth--;
          end++;
        }
        const parts = split(text.slice(m.index + 4, end - 1), ',');
        const prop = parts[0];
        if (matcher.localAliases.has(prop) && !seen.has(prop)) {
          seen.add(prop);
          out += substitute(matcher.localAliases.get(prop));
          seen.delete(prop);
        } else if (matcher.isToken(prop)) {
          out += matcher.fromCssVar(`var(${prop})`, role).ref;
          if (parts.length > 1) notes.push(`Token fallback retained in source for ${rawValue}; token ${prop} must be supplied.`);
        } else {
          unresolved = true;
          out += text.slice(m.index, end);
        }
        pos = end;
        re.lastIndex = end;
      }
      return out + text.slice(pos);
    };
    const text = substitute(rawValue.trim());
    if (unresolved) return { source: rawValue, expression: text, manualTranslation: true };
    if (/^\{[\w.-]+\}$/.test(text)) return text;
    if (/^-?\d*\.?\d+$/.test(text)) return Number(text);
    const dimension = text.match(/^(-?\d*\.?\d+)(px|%|em|rem)$/);
    if (dimension) return { value: Number(dimension[1]), unit: dimension[2] };
    if (/^calc\(/.test(text)) return { expression: text.slice(5, -1), syntax: 'arithmetic' };
    return text;
  };

  /**
   * `transform` as named components, so nothing has to guess what "transform"
   * means. Order is kept only when it can matter (more than one kind of
   * function); an unsupported function is returned raw and flagged.
   */
  const transformOf = (rawValue) => {
    const text = rawValue.trim();
    if (text === 'none') return { none: true };
    const out = {};
    const kinds = [];
    for (const part of split(text, ' ')) {
      const m = part.match(/^([a-zA-Z]+)\((.*)\)$/);
      const args = m ? split(m[2], ',') : [];
      const num = (a) => (/^-?\d*\.?\d+$/.test(a) ? Number(a) : null);
      const fn = m?.[1];
      let ok = true;
      if (fn === 'scale' && args.length && args.length <= 2 && args.every((a) => num(a) != null)) {
        const [x, y = x] = args.map(num);
        if (x === y) out.scale = x; else { out.scaleX = x; out.scaleY = y; }
        kinds.push('scale');
      } else if ((fn === 'scaleX' || fn === 'scaleY') && args.length === 1 && num(args[0]) != null) {
        out[fn] = num(args[0]);
        kinds.push('scale');
      } else if (fn === 'translate' && args.length && args.length <= 2) {
        out.translateX = valueOf(args[0], 'dimension');
        if (args[1] != null) out.translateY = valueOf(args[1], 'dimension');
        kinds.push('translate');
      } else if ((fn === 'translateX' || fn === 'translateY') && args.length === 1) {
        out[fn] = valueOf(args[0], 'dimension');
        kinds.push('translate');
      } else if (fn === 'rotate' && args.length === 1 && /^-?\d*\.?\d+(deg|turn|rad)$/.test(args[0])) {
        const n = parseFloat(args[0]);
        out.rotateDeg = args[0].endsWith('turn') ? n * 360 : args[0].endsWith('rad') ? (n * 180) / Math.PI : n;
        kinds.push('rotate');
      } else ok = false;

      if (!ok) {
        notes.push(`Manual translation required for transform: ${rawValue}.`);
        return { raw: rawValue, manualTranslation: true };
      }
    }
    const distinct = [...new Set(kinds)];
    if (kinds.length !== distinct.length) {
      notes.push(`Manual translation required for transform: ${rawValue} (a function is repeated, so order matters).`);
      return { raw: rawValue, manualTranslation: true };
    }
    if (distinct.length > 1) out.order = distinct;
    return out;
  };

  /** `animation: ds-spin 700ms linear infinite` as named fields. */
  const animationOf = (rawValue) => {
    if (/^none\b/.test(rawValue.trim())) return { none: true };
    const parts = split(rawValue, ' ');
    const times = parts.filter((p) => TIME.test(p));
    const timing = parts.find((p) => TIMING.test(p));
    const iterations = parts.find((p) => p === 'infinite' || /^\d*\.?\d+$/.test(p));
    const direction = parts.find((p) => /^(normal|reverse|alternate|alternate-reverse)$/.test(p));
    const fill = parts.find((p) => /^(forwards|backwards|both)$/.test(p));
    const reserved = new Set([...times, timing, iterations, direction, fill]);
    const name = parts.find((p) => !reserved.has(p) && /^[A-Za-z_][\w-]*$/.test(p));
    return {
      name: name || null,
      durationMs: times[0] ? toMs(times[0]) : null,
      delayMs: times[1] ? toMs(times[1]) : 0,
      curve: curveOf(timing),
      iterations: iterations === 'infinite' ? 'infinite' : iterations ? Number(iterations) : 1,
      direction: direction || 'normal',
      fillMode: fill || 'none',
    };
  };

  /** Read one block's declarations into roles, transitions and recorded drops. */
  const read = (declarations) => {
    const properties = {}, transitions = [];
    const val = (v, role) => valueOf(v, role);
    for (const [property, rawValue] of declarations) {
      if (property === 'border' || property === 'outline') {
        const prefix = property === 'border' ? 'border' : 'outline';
        const parts = split(rawValue, ' ');
        const style = parts.find((p) => /^(none|solid|dashed|dotted|double|hidden|auto)$/.test(p));
        const rest = parts.filter((p) => p !== style);
        if (style) properties[`${prefix}Style`] = style;
        if (rest[0]) properties[`${prefix}Width`] = val(rest[0], 'borderWidth');
        if (rest[1]) properties[`${prefix}Color`] = val(rest[1], 'borderColor');
      } else if (property === 'padding') {
        const p = split(rawValue, ' ');
        const [top, right = top, bottom = top, left = right] = p;
        for (const [key, v] of Object.entries({ padTop: top, padRight: right, padBottom: bottom, padLeft: left })) properties[key] = val(v, 'spacing');
      } else if (property === 'flex') {
        const [grow, shrink, basis] = split(rawValue, ' ');
        if (basis) {
          properties.flexGrow = val(grow);
          properties.flexShrink = val(shrink);
          properties.flexBasis = val(basis, 'dimension');
        } else properties.flex = val(rawValue);
      } else if (property === 'transition') {
        if (rawValue === 'none') properties.transitionEnabled = false;
        else for (const entry of split(rawValue, ',')) {
          const parts = split(entry, ' ');
          // `transition: 120ms ease` names no property: CSS means all of them.
          const named = parts[0] && !TIME.test(parts[0]) && !TIMING.test(parts[0]);
          const times = parts.filter((p) => TIME.test(p)).map(toMs);
          const timing = parts.find((p) => TIMING.test(p));
          transitions.push({
            property: named ? VISUAL_PROPERTY[parts[0]] || camel(parts[0]) : 'all',
            durationMs: times[0] ?? null,
            delayMs: times[1] ?? 0,
            curve: curveOf(timing),
          });
        }
      } else if (property === 'transition-duration') {
        if (TIME.test(rawValue)) properties.transitionDurationMs = toMs(rawValue);
        else notes.push(`Manual translation required for transition-duration: ${rawValue}.`);
      } else if (property === 'animation') {
        properties.animation = animationOf(rawValue);
      } else if (property === 'animation-duration') {
        if (TIME.test(rawValue)) properties.animationDurationMs = toMs(rawValue);
        else notes.push(`Manual translation required for animation-duration: ${rawValue}.`);
      } else if (property === 'transform') {
        properties.transform = transformOf(rawValue);
      } else if (VISUAL_PROPERTY[property]) {
        properties[VISUAL_PROPERTY[property]] = val(rawValue, VISUAL_PROPERTY[property]);
      } else if (property.startsWith('--')) {
        // A local custom property: followed through aliases, not a style.
      } else if (WEB_ONLY_PROPERTIES[property]) {
        ignored.webOnly.add(property);
      } else if (!HANDLED.has(property)) {
        ignored.unrecognised.add(property);
      }
    }
    return { properties, transitions };
  };

  const keyframesOf = (name, body) => {
    const frames = [];
    for (const { selector, body: frameBody } of scanBlocks(body)) {
      const { properties } = read(declarationsOf(frameBody));
      for (const stop of split(selector, ',')) {
        const offset = stop === 'from' ? 0 : stop === 'to' ? 1 : /^\d*\.?\d+%$/.test(stop) ? parseFloat(stop) / 100 : null;
        if (offset == null) { notes.push(`Manual translation required for keyframe selector ${stop} in ${name}.`); continue; }
        frames.push({ offset, properties });
      }
    }
    keyframes[name] = frames.sort((a, b) => a.offset - b.offset);
  };

  const walk = (text, media = []) => {
    for (const { selector: selectorText, body } of scanBlocks(text)) {
      if (selectorText.startsWith('@media')) {
        walk(body, [...media, selectorText.slice(6).trim()]);
        continue;
      }
      if (selectorText.startsWith('@keyframes')) {
        keyframesOf(selectorText.slice(10).trim(), body);
        continue;
      }
      if (selectorText.startsWith('@')) {
        notes.push(`Manual translation required for ${selectorText}.`);
        continue;
      }
      const declarations = declarationsOf(body);
      for (const selector of split(selectorText, ',')) {
        const segments = split(selector, ' ');
        const target = segments.at(-1)?.match(/^\.([\w-]+)/)?.[1];
        if (!target) { notes.push(`Manual translation required for selector ${selector}.`); continue; }
        const conditions = [];
        let supported = true;
        for (const [index, segment] of segments.entries()) {
          const className = segment.match(/^\.([\w-]+)/)?.[1];
          if (!className) { supported = false; continue; }
          let rest = segment.slice(className.length + 1).replace(/::(before|after)$/, '');
          const subject = index === segments.length - 1 ? 'self' : 'ancestor';
          const add = (condition) => conditions.push({ subject, className, ...condition });
          rest = rest.replace(/:not\(\[([\w-]+)=['"]([^'"]+)['"]\]\)/g, (_, attribute, value) => {
            add({ attribute, equals: value, negate: true }); return '';
          });
          rest = rest.replace(/\[([\w-]+)=['"]([^'"]+)['"]\]/g, (_, attribute, value) => {
            add({ attribute, equals: value }); return '';
          });
          // `:not(:disabled)` - a state that must NOT hold.
          rest = rest.replace(/:not\(:(focus-visible|focus|active|hover|disabled)\)/g, (_, state) => {
            add({ state: { 'focus-visible': 'focused', focus: 'focused', active: 'pressed' }[state] || state, negate: true, ...(state === 'focus-visible' ? { focusVisible: true } : {}) }); return '';
          });
          rest = rest.replace(/:(focus-visible|focus|active|hover|disabled)\b/g, (_, state) => {
            // :focus-visible is "focused, and the browser would show an indicator":
            // keyboard focus, not a pointer press. Both become the state `focused`, so the
            // difference is kept as a flag rather than lost.
            add({ state: { 'focus-visible': 'focused', focus: 'focused', active: 'pressed' }[state] || state, ...(state === 'focus-visible' ? { focusVisible: true } : {}) }); return '';
          });
          if (rest) supported = false;
        }
        const { properties, transitions } = read(declarations);
        if (!Object.keys(properties).length && !transitions.length) continue;
        rules.push({ selector, targetClass: target, pseudoElement: selector.match(/::(before|after)$/)?.[1] || null,
          conditions, media, properties, transitions, order: rules.length,
          ...(supported ? {} : { manualTranslation: true }) });
      }
    }
  };
  walk(css);

  if (ignored.unrecognised.size) {
    notes.push(`Unrecognised CSS properties, manual translation required: ${[...ignored.unrecognised].sort().join(', ')}.`);
  }
  return {
    rules,
    keyframes,
    ignored: { webOnly: [...ignored.webOnly].sort(), unrecognised: [...ignored.unrecognised].sort() },
    notes: [...new Set(notes)],
  };
}
