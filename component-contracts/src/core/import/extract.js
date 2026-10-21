/**
 * Source extractors.
 *
 * These read what is *verifiably present* in the code. Nothing is inferred by
 * vibe: if a value is not in the source, it is not in the output, and the
 * importer turns its absence into an open question.
 *
 * Deliberately lightweight parsing rather than a full TS AST — the goal is a
 * good draft, not a compiler. Anything unrecognised is reported as skipped so
 * a human knows to look.
 */

// Source-reading tables live with the platform mappings, in one file.
import {
  CSS_PROP_ROLE,
  CSS_KEYWORDS,
  PSEUDO_STATE,
  NATIVE_ACTIVATION,
} from '../platform-map.js';

export { NATIVE_ACTIVATION };

const TS_KIND = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  ReactNode: 'slot',
  'React.ReactNode': 'slot',
  JSX: 'slot',
};

/** Strip comments so they cannot be mistaken for code. */
const decomment = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** Find the balanced region starting at the opening bracket at `from`. */
function balanced(src, from, open = '{', close = '}') {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) {
      depth--;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Props from a TypeScript interface / type alias
 * ------------------------------------------------------------------ */

/**
 * Standalone union type aliases.
 *
 *   export type ButtonVariant = 'primary' | 'secondary' | 'tertiary';
 *
 * Components commonly declare their axes this way and then reference them from
 * the props interface, so a member's literal values are one hop away rather
 * than inline.
 */
export function extractTypeAliases(src) {
  const aliases = {};   // name -> string[] of literal values
  const indirect = {};  // name -> the raw type it stands for
  const re = /(?:export\s+)?type\s+(\w+)\s*=\s*([^;]+);/g;
  let m;
  while ((m = re.exec(decomment(src)))) {
    const [, name, body] = m;
    const parts = body
      .split('|')
      .map((x) => x.trim())
      .filter(Boolean);
    if (parts.length > 1 && parts.every((x) => /^'[^']*'$|^"[^"]*"$/.test(x))) {
      aliases[name] = parts.map((x) => x.slice(1, -1));
    } else {
      // `type IconComponent = ComponentType<IconProps>` — not an axis, but
      // still needed so a prop using it is classified rather than skipped.
      indirect[name] = body.trim();
    }
  }
  aliases.__indirect = indirect;
  return aliases;
}

export function extractProps(src) {
  const clean = decomment(src);
  const aliases = extractTypeAliases(src);
  const props = {};
  const evidence = [];

  const header = clean.match(/(?:export\s+)?(?:interface|type)\s+\w*Props\w*\s*((?:extends[^{]+)?)(?:=\s*)?\{/);
  if (!header) return { props, aliases, evidence, found: false, extends: null };

  /* What the interface inherits from, if anything. */
  const extendsText = header[1] || '';
  const nativeMatch = extendsText.match(/(\w+)HTMLAttributes/);
  const omitMatch = extendsText.match(/Omit<[^,]+,\s*([^>]+)>/);
  const inherits = nativeMatch
    ? {
        element: nativeMatch[1],
        source: `${nativeMatch[1]}HTMLAttributes`,
        omitted: omitMatch
          ? omitMatch[1].split('|').map((x) => x.trim().replace(/^['"]|['"]$/g, ''))
          : [],
      }
    : null;

  const body = balanced(clean, clean.indexOf('{', header.index));
  if (!body) return { props, aliases, evidence, found: false, extends: inherits };

  const memberRe = /^\s*(\w+)(\??)\s*:\s*([^;\n]+)[;\n]/gm;
  let m;
  while ((m = memberRe.exec(body))) {
    const [, name, optional, rawType] = m;
    const type = rawType.trim();

    const resolved = aliases.__indirect?.[type] || type;
    let kind = TS_KIND[type] || TS_KIND[resolved];
    let values;

    // Union of string literals, inline or behind a type alias.
    const literals = type.match(/^(?:'[^']*'\s*\|\s*)*'[^']*'$/)
      ? type.split('|').map((s) => s.trim().replace(/^'|'$/g, ''))
      : aliases[type] || null;

    if (literals && literals.length > 1) {
      kind = 'enum';
      values = literals;
    } else if (/=>/.test(type)) {
      // A handler returns nothing; a formatter returns a value. `(n: number)
      // => string` is not an event, and listing it as one misrepresents the
      // component's API.
      const returnsVoid = /=>\s*void\s*$/.test(type.trim());
      kind = returnsVoid || /^on[A-Z]/.test(name) ? 'event' : 'function';
    } else if (/ReactNode|ReactElement|JSX\.Element|ComponentType|ElementType|\bFC</.test(resolved)) {
      kind = 'slot';
    } else if (!kind) {
      kind = /\bstring\b/.test(resolved)
        ? 'string'
        : /\bnumber\b/.test(resolved)
          ? 'number'
          : /\bboolean\b/.test(resolved)
            ? 'boolean'
            : /=>/.test(resolved)
              ? /=>\s*void\s*$/.test(resolved.trim()) || /^on[A-Z]/.test(name)
                ? 'event'
                : 'function'
              : null;
    }

    if (!kind) {
      evidence.push({ level: 'skipped', what: `prop ${name}`, why: `unrecognised type \`${type}\`` });
      continue;
    }

    props[name] = { kind, required: optional !== '?' };
    if (values) props[name].values = values;
    if (kind === 'slot') props[name].contentType = 'node';
    evidence.push({ level: 'derived', path: `props.${name}`, from: 'ts-interface', evidence: `${name}${optional}: ${type}` });
  }

  return { props, aliases, evidence, found: true, extends: inherits };
}

/** Default values from destructuring: `{ loading = false }` */
export function extractDefaults(src) {
  const out = {};
  const fn = decomment(src).match(/function\s+\w+\s*\(\s*\{/);
  if (!fn) return out;
  const params = balanced(decomment(src), decomment(src).indexOf('{', fn.index));
  if (!params) return out;
  const re = /(\w+)\s*=\s*(true|false|'[^']*'|"[^"]*"|-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(params))) {
    let v = m[2];
    if (v === 'true') v = true;
    else if (v === 'false') v = false;
    else if (/^-?[\d.]+$/.test(v)) v = Number(v);
    else v = v.replace(/^['"]|['"]$/g, '');
    out[m[1]] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Variant matrix from cva() / tv()
 * ------------------------------------------------------------------ */

export function extractVariants(src, matcher) {
  const clean = decomment(src);
  const axes = {};
  const appearance = {};
  const sizes = {};
  const defaults = {};
  const evidence = [];

  const call = clean.match(/\b(?:cva|tv|cn?va)\s*\(/);
  if (!call) return { axes, appearance, sizes, defaults, evidence, found: false };

  const variantsIdx = clean.indexOf('variants:', call.index);
  if (variantsIdx < 0) return { axes, appearance, sizes, defaults, evidence, found: false };

  const variantsBlock = balanced(clean, clean.indexOf('{', variantsIdx));
  if (!variantsBlock) return { axes, appearance, sizes, defaults, evidence, found: false };

  // Each axis: `variant: { primary: '...', secondary: '...' }`
  const axisRe = /(\w+)\s*:\s*\{/g;
  let am;
  while ((am = axisRe.exec(variantsBlock))) {
    const axisName = am[1];
    const block = balanced(variantsBlock, variantsBlock.indexOf('{', am.index + axisName.length));
    if (!block) continue;

    const values = {};
    const valueRe = /(['"]?)([\w-]+)\1\s*:\s*(['"`])([\s\S]*?)\3/g;
    let vm;
    while ((vm = valueRe.exec(block))) {
      values[vm[2]] = vm[4].trim();
    }
    if (!Object.keys(values).length) continue;

    axes[axisName] = Object.keys(values);
    axisRe.lastIndex = am.index + block.length;

    for (const [value, classes] of Object.entries(values)) {
      const roles = {};
      for (const cls of classes.split(/\s+/).filter(Boolean)) {
        const hit = matcher.fromUtilityClass(cls);
        if (!hit) {
          evidence.push({ level: 'skipped', what: `class \`${cls}\``, why: 'no matching token' });
          continue;
        }
        roles[hit.role] = hit.ref;
        evidence.push({
          level: 'derived',
          path: `${axisName}.${value}.${hit.role}`,
          from: hit.via,
          evidence: `${cls} → ${hit.ref}`,
        });
      }
      if (axisName === 'size') sizes[value] = roles;
      else appearance[value] = roles;
    }
  }

  // defaultVariants: { variant: 'primary', size: 'md' }
  const defIdx = clean.indexOf('defaultVariants');
  if (defIdx > -1) {
    const defBlock = balanced(clean, clean.indexOf('{', defIdx));
    if (defBlock) {
      const re = /(\w+)\s*:\s*['"]([\w-]+)['"]/g;
      let dm;
      while ((dm = re.exec(defBlock))) defaults[dm[1]] = dm[2];
    }
  }

  return { axes, appearance, sizes, defaults, evidence, found: true };
}

/* ------------------------------------------------------------------ *
 * CSS: states, transitions, focus ring, touch target, loops
 * ------------------------------------------------------------------ */


/**
 * Expand the `padding` shorthand into the vertical/horizontal pair the
 * contract models. Components almost always write the shorthand, so not
 * handling it meant asking what padding a size used when the CSS said so
 * plainly.
 */
function expandPadding(value) {
  const parts = splitTopLevel(value, ' ').filter(Boolean);
  if (parts.length === 1) return { padY: parts[0], padX: parts[0] };
  if (parts.length === 2) return { padY: parts[0], padX: parts[1] };
  if (parts.length === 3) return { padY: null, padX: parts[1] }; // top and bottom differ
  if (parts.length === 4) return parts[0] === parts[2] ? { padY: parts[0], padX: parts[1] } : { padY: null, padX: parts[1] };
  return {};
}


function declarations(block) {
  const out = [];
  for (const line of block.split(';')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    out.push([line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()]);
  }
  return out;
}

/**
 * Split on top-level commas only.
 *
 * `background-color 150ms cubic-bezier(0.4, 0, 0.2, 1)` is ONE transition, but
 * a naive split on "," shreds it into four — producing a junk duration and
 * three garbage entries. Paren depth has to be tracked.
 */
function splitTopLevel(value, separator = ',') {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === separator && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Collect every custom property the stylesheet DECLARES.
 *
 * These are the component's own variables. Anything it only reads comes from
 * outside, which is what makes it a design token.
 */
/** Local variables declared exactly once, with the value they were given. */
export function collectLocalAliases(css) {
  const counts = new Map();
  const values = new Map();
  const re = /(^|[;{}])\s*(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi;
  let m;
  while ((m = re.exec(decommentCss(css)))) {
    const [, , prop, value] = m;
    counts.set(prop, (counts.get(prop) || 0) + 1);
    values.set(prop, value.trim());
  }
  const single = new Map();
  for (const [prop, n] of counts) if (n === 1) single.set(prop, values.get(prop));
  return single;
}

/** Strip CSS comments. A comment before a declaration hid it from detection. */
export const decommentCss = (css) => String(css).replace(/\/\*[\s\S]*?\*\//g, '');

export function collectLocalVars(css) {
  const local = new Set();
  const re = /(^|[;{}])\s*(--[a-z0-9-]+)\s*:/gi;
  let m;
  while ((m = re.exec(decommentCss(css)))) local.add(m[2]);
  return local;
}

/** Strip `:not(...)` so its contents cannot be read as a state. */
const withoutNot = (sel) => sel.replace(/:not\([^)]*\)/g, '');

/**
 * CSS-wide keywords that are legitimate values in their own right.
 *
 * `border-color: transparent` is a real, deliberate answer — not a hardcoded
 * value waiting to be tokenised. Treating it as the latter made the tool ask
 * what border colour a variant used when the component had already said.
 */

/** Every custom property referenced in a value, outermost first. */
function varRefs(value) {
  const out = [];
  const re = /var\(\s*(--[a-z0-9-]+)/gi;
  let m;
  while ((m = re.exec(String(value)))) out.push(m[1]);
  return out;
}

/**
 * Pull the axes and state out of a selector.
 *
 *   .ds-button[data-tone='default'][data-variant='secondary']:disabled
 *     -> { axes: { tone: 'default', variant: 'secondary' }, state: 'disabled' }
 */
export function parseSelector(selector) {
  const axes = {};
  const flags = {};
  const attrRe = /\[data-([a-z0-9-]+)\s*=\s*['"]?([^'"\]]+)['"]?\]/gi;
  let m;
  while ((m = attrRe.exec(selector))) {
    const name = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const value = m[2];
    // `data-full-width='true'` is a boolean flag, not an axis.
    if (value === 'true' || value === 'false') flags[name] = value === 'true';
    else axes[name] = value;
  }

  const bare = withoutNot(selector);
  const matched = Object.entries(PSEUDO_STATE).find(([token]) => bare.includes(token));

  return {
    axes,
    flags,
    state: matched ? matched[1] : null,
    // A rule aimed at a child element, not the component root.
    child: /__[a-z-]+/.test(selector) ? (selector.match(/__([a-z-]+)/) || [])[1] : null,
  };
}

export function extractCss(rawCss, matcher) {
  const css = decommentCss(rawCss);
  const states = {};
  const seenStates = new Set();
  const axisValues = {};        // axis -> Set(values)
  const byCombination = [];     // { axes, state, roles }
  const byChild = {};           // BEM sub-element -> { state -> roles }
  const transitions = [];
  const loops = [];
  const evidence = [];
  let focusRing = null;
  let minTarget = null;
  let reducedMotion = /@media[^{]*prefers-reduced-motion[^{]*\{/.test(css);

  /* What each local variable means, learned from the rules that consume it:
   *
   *   .ds-button          { background: var(--ds-button-bg) }
   *   .ds-button:active   { background: var(--ds-button-bg-pressed, ...) }
   *
   * gives  --ds-button-bg         -> fill at rest
   *        --ds-button-bg-pressed -> fill when pressed
   *
   * Variant rules then assign those variables to real tokens, which is how a
   * component specifies its pressed appearance per variant without ever
   * writing a variant-scoped `:active` rule. Missing this was why the tool
   * kept asking about states the component had already answered. */
  const localRole = new Map();

  const rules = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(css))) {
    const selector = m[1].trim();
    if (selector.startsWith('@') || /^(to|from|\d+%)$/.test(selector)) continue;
    rules.push({ selector, block: m[2], parsed: parseSelector(selector) });
  }

  /* ---- pass 1: learn what each local variable means, and in which state ---- */
  for (const { block, parsed } of rules) {
    // Any rule that is not variant-scoped can teach us this, INCLUDING the
    // stateful ones — that is where `--ds-button-bg-pressed` gets its meaning.
    // Skipping those was why the tool kept asking about states the component
    // had already answered.
    if (Object.keys(parsed.axes).length || parsed.child) continue;
    const state = parsed.state || 'default';

    for (const [prop, value] of declarations(block)) {
      const role = CSS_PROP_ROLE[prop];
      if (!role) continue;
      // Only the outermost reference defines this state; a `var(a, var(b))`
      // fallback already carries its own meaning from the base rule.
      const [primary] = varRefs(value);
      if (!primary || matcher.isToken(primary) || localRole.has(primary)) continue;

      localRole.set(primary, { role, state });
      evidence.push({
        level: 'derived',
        path: `appearance.roles.${role}${state === 'default' ? '' : ` (${state})`}`,
        from: 'css-variable',
        evidence: `${prop}: var(${primary})`,
      });
    }
  }

  /* ---- pass 2: every rule ---- */
  for (const { selector, block, parsed } of rules) {
    for (const [axis, value] of Object.entries(parsed.axes)) {
      (axisValues[axis] ||= new Set()).add(value);
    }
    if (parsed.state) seenStates.add(parsed.state);

    const stateName = parsed.state || 'default';
    /** state -> { role: tokenRef }. One rule can speak for several states. */
    const byState = {};
    const put = (state, role, ref) => {
      (byState[state] ||= {})[role] = ref;
    };
    const roles = (byState[stateName] ||= {});

    for (const [prop, value] of declarations(block)) {
      /* a local variable being pointed at a token — the common modern pattern */
      if (prop.startsWith('--')) {
        const mapping = localRole.get(prop);
        const hit = matcher.fromCssValue(value, mapping?.role);
        if (mapping && hit?.ref) {
          // The variable's own state wins: a variant block assigning
          // `--ds-button-bg-pressed` is describing its PRESSED appearance,
          // even though the rule itself carries no pseudo-class.
          const target = mapping.state === 'default' ? stateName : mapping.state;
          put(target, mapping.role, hit.ref);
          evidence.push({
            level: 'derived',
            path: `${Object.values(parsed.axes).join('.') || 'base'}.${target}.${mapping.role}`,
            from: 'css-variable',
            evidence: `${selector} { ${prop}: ${value} }`,
          });
        } else if (!mapping && !matcher.isToken(prop)) {
          // A local variable with no role yet — record the token it points at
          // so it still joins the vocabulary.
          matcher.fromCssValue(value);
        }
        continue;
      }

      /* focus ring — the shorthand carries width, style and colour in any order */
      if (stateName === 'focused' && prop === 'outline') {
        const parts = splitTopLevel(value, ' ').filter(Boolean);
        const styleIdx = parts.findIndex((x) => /^(solid|dashed|dotted|double|none|auto)$/i.test(x));
        const colourish = parts.filter(
          (x, i) => i !== styleIdx && (/var\(/.test(x) || /^#|^rgb|^hsl|^currentcolor$/i.test(x))
        );
        // Colour is the last colour-shaped part; anything before it is the width.
        const colourRaw = colourish[colourish.length - 1];
        const widthRaw = parts.find((x, i) => i !== styleIdx && x !== colourRaw);

        const colour = colourRaw ? matcher.fromCssValue(colourRaw, 'focusRing') : null;
        const width = widthRaw ? matcher.fromCssValue(widthRaw, 'borderWidth') : null;
        const widthNum = widthRaw?.match(/^(-?[\d.]+)/);

        focusRing = {
          ...(focusRing || {}),
          ...(colour?.ref ? { color: colour.ref } : {}),
          ...(width?.ref ? { width: width.ref } : widthNum ? { width: Number(widthNum[1]) } : {}),
          ...(styleIdx >= 0 ? { style: parts[styleIdx].toLowerCase() } : {}),
        };
        continue;
      }
      if (prop === 'outline-offset') {
        // No default. An unreadable offset is absent, not 2.
        const hit = matcher.fromCssValue(value, 'spacing');
        const num = value.match(/^(-?[\d.]+)/);
        const offset = hit?.ref ?? (num ? Number(num[1]) : null);
        if (offset != null) focusRing = { ...(focusRing || {}), offset };
        continue;
      }
      if (prop === 'box-shadow' && stateName === 'focused' && !focusRing?.color) {
        const color = matcher.fromCssValue(value, 'focusRing');
        const width = value.match(/(-?[\d.]+)px/);
        if (color?.ref) {
          focusRing = { ...(focusRing || {}), color: color.ref, width: width ? Number(width[1]) : 2, style: 'solid' };
        }
        continue;
      }

      /* padding shorthand -> the vertical/horizontal pair */
      if (prop === 'padding' || prop === 'padding-inline' || prop === 'padding-block') {
        const pair =
          prop === 'padding-inline'
            ? { padX: splitTopLevel(value, ' ')[0] }
            : prop === 'padding-block'
              ? { padY: splitTopLevel(value, ' ')[0] }
              : expandPadding(value);
        for (const [role, raw] of Object.entries(pair)) {
          if (!raw) continue;
          const hit = matcher.fromCssValue(raw, role);
          if (!hit?.ref) continue;
          put(stateName, role, hit.ref);
          evidence.push({
            level: 'derived',
            path: `${Object.values(parsed.axes).join('.') || 'base'}.${stateName}.${role}`,
            from: 'css-shorthand',
            evidence: `${selector} { padding: ${value} }`,
          });
        }
        continue;
      }

      /* minimum height — a per-size metric, or the touch target when global */
      if (prop === 'min-height' || prop === 'min-width') {
        // `min-width: 0` is the flexbox overflow idiom, not a touch target.
        // Reading it as one produced a 0pt target, which is worse than having
        // no answer at all.
        const trivial = /^(0|0px|auto|none)$/i.test(String(value).trim());
        if (trivial) continue;

        const hit = matcher.fromCssValue(value, 'minHeight');
        if (parsed.axes.size) {
          // Scoped to a size, so it is that size's own height, not an a11y floor.
          if (hit?.ref) put(stateName, 'minHeight', hit.ref);
        } else if (prop === 'min-height') {
          const num = value.match(/(-?[\d.]+)/);
          minTarget = hit?.ref ?? (num ? Number(num[1]) : null);
        }
        continue;
      }

      /* transitions */
      if (prop === 'transition' && value !== 'none') {
        for (const t of splitTopLevel(value)) {
          const cssProp = t.split(/\s+/)[0];
          const ms = t.match(/(-?[\d.]+)(ms|s)\b/);
          const bezier = t.match(/cubic-bezier\(([^)]+)\)/);
          transitions.push({
            property: CSS_PROP_ROLE[cssProp] || cssProp,
            durationMs: ms ? (ms[2] === 'ms' ? Number(ms[1]) : Number(ms[1]) * 1000) : null,
            curve: bezier
              ? { type: 'cubicBezier', value: splitTopLevel(bezier[1]).map(Number) }
              // Longest keyword first: `\bease\b` also matches inside `ease-in`.
              // No keyword at all is CSS's own default, `ease` - never easeInOut,
              // and `linear` must not be read as something else.
              : {
                  type: /\blinear\b/.test(t) ? 'linear'
                    : /\bease-in-out\b/.test(t) ? 'easeInOut'
                    : /\bease-in\b/.test(t) ? 'easeIn'
                    : /\bease-out\b/.test(t) ? 'easeOut'
                    : 'ease',
                },
          });
          evidence.push({ level: 'derived', path: 'motion.transitions', from: 'css', evidence: `transition: ${t}` });
        }
        continue;
      }

      /* press transform */
      if (prop === 'transform' && stateName === 'pressed') {
        const scale = value.match(/scale\(([\d.]+)\)/);
        if (scale) {
          transitions.push({ property: 'scale', to: Number(scale[1]), durationMs: null, curve: null, pressScale: true });
          evidence.push({ level: 'derived', path: 'adaptable.pressFeedback', from: 'css', evidence: `transform: ${value}` });
        }
        continue;
      }

      /* looping animation */
      if (prop === 'animation') {
        if (value === 'none' || value.startsWith('none')) continue;
        const ms = value.match(/(-?[\d.]+)(ms|s)\b/);
        loops.push({
          id: value.split(/\s+/)[0],
          durationMs: ms ? (ms[2] === 'ms' ? Number(ms[1]) : Number(ms[1]) * 1000) : 800,
          iterations: /infinite/.test(value) ? 'infinite' : 1,
          curve: { type: /linear/.test(value) ? 'linear' : 'easeInOut' },
        });
        evidence.push({ level: 'derived', path: 'motion.loops', from: 'css', evidence: `animation: ${value}` });
        continue;
      }

      /* a role set directly */
      const role = CSS_PROP_ROLE[prop];
      if (!role) continue;

      // A rule aimed at a sub-element styles that node, not the root.
      if (parsed.child) {
        const child = parsed.child.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        const lit = String(value).trim().toLowerCase();
        const resolved = CSS_KEYWORDS.has(lit) ? lit : matcher.fromCssValue(value, role)?.ref;
        if (resolved) {
          ((byChild[child] ||= {})[stateName] ||= {})[role] = resolved;
          evidence.push({
            level: 'derived',
            path: `composition.${child}.${stateName}.${role}`,
            from: 'css',
            evidence: `${selector} { ${prop}: ${value} }`,
          });
        }
        continue;
      }
      const literal = String(value).trim().toLowerCase();
      if (CSS_KEYWORDS.has(literal)) {
        put(stateName, role, literal === 'currentcolor' ? 'currentColor' : literal);
        evidence.push({
          level: 'derived',
          path: `${Object.values(parsed.axes).join('.') || 'base'}.${stateName}.${role}`,
          from: 'css-keyword',
          evidence: `${selector} { ${prop}: ${value} }`,
        });
        continue;
      }

      const hit = matcher.fromCssValue(value, role);
      if (!hit?.ref) {
        if (hit?.ambiguous || hit?.hardcoded) {
          evidence.push({
            level: 'skipped',
            what: `${prop}: ${value}`,
            why: hit.ambiguous
              ? `ambiguous — matches ${hit.ambiguous.join(', ')}`
              : 'hardcoded — no token behind it',
          });
        }
        continue;
      }
      roles[role] = hit.ref;
      evidence.push({
        level: 'derived',
        path: `${Object.values(parsed.axes).join('.') || 'base'}.${stateName}.${role}`,
        from: hit.via,
        evidence: `${selector} { ${prop}: ${value} }`,
      });
    }

    for (const [state, roleMap] of Object.entries(byState)) {
      if (!Object.keys(roleMap).length) continue;
      if (state !== 'default') seenStates.add(state);

      if (!Object.keys(parsed.axes).length) {
        states[state] = { ...(states[state] || {}), ...roleMap };
      } else {
        byCombination.push({ axes: parsed.axes, state, roles: roleMap });
      }
    }
  }

  /* layout, as the base rule actually states it */
  const base = rules.find((r) => !Object.keys(r.parsed.axes).length && !r.parsed.state && !r.parsed.child);
  const layout = {};
  if (base) {
    for (const [prop, value] of declarations(base.block)) {
      if (prop === 'display' && /flex/.test(value)) layout.display = value.trim();
      if (prop === 'flex-direction') layout.direction = /column/.test(value) ? 'vertical' : 'horizontal';
      if (prop === 'align-items') layout.align = value.trim().replace(/^flex-/, '');
      if (prop === 'justify-content') layout.justify = value.trim().replace(/^flex-/, '');
    }
    if (layout.display && !layout.direction) layout.direction = 'horizontal';
  }

  return {
    states,
    byChild,
    layout,
    seenStates: [...seenStates],
    axisValues: Object.fromEntries(Object.entries(axisValues).map(([k, v]) => [k, [...v]])),
    byCombination,
    localRoles: Object.fromEntries(localRole),
    transitions,
    loops,
    focusRing,
    minTarget,
    reducedMotion,
    evidence,
  };
}

/* ------------------------------------------------------------------ *
 * JSX: accessibility + slots
 * ------------------------------------------------------------------ */

export function extractJsx(src) {
  const clean = decomment(src);
  const a11y = {};
  const children = [];
  const evidence = [];

  const open = clean.match(/<(button|a|input|div|span)\b([^>]*)>/);
  if (open) {
    const [, element, attrs] = open;
    const role = attrs.match(/role=["']([\w-]+)["']/);
    if (role) {
      a11y.role = role[1];
      evidence.push({ level: 'derived', path: 'a11y.role', from: 'jsx', evidence: `role="${role[1]}"` });
    } else if (element === 'button') {
      a11y.role = 'button';
      evidence.push({ level: 'derived', path: 'a11y.role', from: 'jsx', evidence: '<button> element' });
    } else if (element === 'a') {
      a11y.role = 'link';
      evidence.push({ level: 'derived', path: 'a11y.role', from: 'jsx', evidence: '<a> element' });
    }

    a11y.state = {};
    for (const [attr, key] of [
      ['aria-busy', 'busy'],
      ['aria-disabled', 'disabled'],
      ['aria-expanded', 'expanded'],
      ['aria-selected', 'selected'],
    ]) {
      if (attrs.includes(attr)) {
        a11y.state[key] = true;
        evidence.push({ level: 'derived', path: `a11y.state.${key}`, from: 'jsx', evidence: attr });
      }
    }
    if (attrs.includes('disabled') && !a11y.state.disabled) a11y.state.disabled = true;
  }

  // Only `{children}` and BEM sub-elements. A bare `{identifier}` scan also
  // caught locals like `{iconSize}`, which are not slots at all.
  if (/\{\s*children\s*\}/.test(clean)) children.push('children');

  const bemRe = /className=["'][\w-]*__([\w-]+)["']/g;
  let bm;
  while ((bm = bemRe.exec(clean))) children.push(bm[1]);

  const ternary = clean.match(/\{\s*(\w+)\s*\?\s*<(\w+)[^>]*\/?>\s*:\s*(\w+)\s*\}/);
  const conditional = ternary ? { when: ternary[1], then: ternary[2], otherwise: ternary[3] } : null;

  return { a11y, children: [...new Set(children)], conditional, evidence };
}
