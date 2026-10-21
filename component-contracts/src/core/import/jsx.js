/**
 * JSX structure extraction.
 *
 * A component's visual tree is in its markup, not in its class names. Scanning
 * for BEM suffixes produced a flat list that missed nesting entirely, and —
 * worse — could not tell a rendered child from an accessibility attribute. A
 * prop named `label` passed to `aria-label` is not visible text, but a
 * name-based guess said it was, which is how a spinbutton's accessible name
 * ended up rendered on screen.
 *
 * So this walks the returned JSX and builds the actual tree, recording for each
 * node what it renders, what it is to assistive tech, and which class carries
 * its styling.
 */

const VOID_ELEMENTS = new Set(['img', 'input', 'br', 'hr', 'source', 'track']);

/** JavaScript words that are never a reference to something the component defines. */
const NOT_REFERENCES = new Set([
  'true', 'false', 'null', 'undefined', 'void', 'typeof', 'new', 'this', 'return', 'if', 'else',
  'function', 'const', 'let', 'var', 'in', 'of', 'as', 'async', 'await',
]);

/**
 * The identifiers an expression refers to. A name after a dot is a property, not
 * a reference, and a string is not code. This only needs to be a superset the
 * logic reader can intersect with what the component actually defines.
 */
function referencesIn(expr) {
  const text = String(expr).replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, ' ');
  const out = new Set();
  for (const m of text.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)) {
    if (!NOT_REFERENCES.has(m[1])) out.add(m[1]);
  }
  return [...out];
}

/** Split attributes without breaking on `>` inside braces or strings. */
function splitAttributes(text) {
  const out = [];
  let buf = '';
  let depth = 0;
  let quote = null;

  for (const ch of text) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** `className="a b"` / `role={x}` -> { name, value, isExpression }. */
function parseAttribute(raw) {
  if (raw.startsWith('{...')) return { name: '...spread', value: raw.slice(4, -1), spread: true };
  const eq = raw.indexOf('=');
  if (eq < 0) return { name: raw, value: true, boolean: true };

  const name = raw.slice(0, eq);
  let value = raw.slice(eq + 1);
  if (value.startsWith('{') && value.endsWith('}')) {
    return { name, value: value.slice(1, -1).trim(), isExpression: true };
  }
  return { name, value: value.replace(/^['"]|['"]$/g, '') };
}

/**
 * The base classes of every `cva()` function declared in the file.
 *
 *   const button = cva('ds-button', { variants: { ... } });
 *   <button className={button({ variant, size })} />
 *
 * The element's class is whatever the base string is, and no literal appears at
 * the usage site. Without this the root node had no class, so every rule
 * targeting `.ds-button` matched nothing and was lost.
 */
function cvaBases(src) {
  const bases = {};
  for (const m of String(src).matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*cva\(\s*(['"`])([^'"`]*)\2/g)) {
    bases[m[1]] = m[3].split(/\s+/).filter(Boolean);
  }
  return bases;
}

/** The literal class names in a className attribute, however it is composed. */
function classNamesFrom(attr, bases = {}) {
  if (!attr) return [];
  const names = new Set();

  // A plain attribute is already the class list; only an expression needs its
  // string literals picking out of the surrounding code.
  if (!attr.isExpression) {
    for (const cls of String(attr.value).split(/\s+/)) if (cls) names.add(cls);
    return [...names];
  }

  // A call to a known cva function stands for that function's base classes, and
  // ONLY those: a string inside the call (`button({ size: 'sm' })`) is a variant
  // value, not a class on the element.
  const callee = String(attr.value).match(/^\s*(\w+)\s*\(/)?.[1];
  if (bases[callee]) return [...bases[callee]];

  for (const m of String(attr.value).matchAll(/['"`]([^'"`]+)['"`]/g)) {
    for (const cls of m[1].split(/\s+/)) if (cls && !cls.includes('$')) names.add(cls);
  }
  return [...names];
}

/** The BEM sub-element of a class list: `ds-counter__value` -> `value`. */
function bemPart(classNames) {
  for (const cls of classNames) {
    const m = cls.match(/__([a-z0-9-]+)$/i);
    if (m) return m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Tokenising the return block
 * ------------------------------------------------------------------ */

/**
 * The JSX returned by the component function.
 *
 * Requires a `<` after the paren. A component is full of other returns —
 * cleanup functions from `useEffect`, objects from helpers — and matching the
 * first `return (` found one of those instead of the markup.
 */
function returnBlock(src) {
  const withParen = [...src.matchAll(/\breturn\s*\(\s*(?=<)/g)];
  if (withParen.length) {
    const open = src.indexOf('(', withParen[withParen.length - 1].index);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') {
        depth--;
        if (depth === 0) return src.slice(open + 1, i);
      }
    }
  }

  // `return <div …/>;` with no wrapping parens.
  const bare = [...src.matchAll(/\breturn\s+(?=<)/g)];
  if (bare.length) {
    const start = bare[bare.length - 1].index + bare[bare.length - 1][0].length;
    return src.slice(start);
  }
  return null;
}

/** What can directly precede an element that is not always rendered. */
const CONDITIONAL_LEAD = [
  /\?\s*\(?\s*$/,        // loading ? <A />   or   loading ? ( <A />
  /&&\s*\(?\s*$/,        // iconOnly && <A />
  /\)\s*:\s*\(?\s*$/,    // ) : ( <B />        the else-branch of a parenthesised ternary
];

/**
 * Build the element tree.
 *
 * Deliberately a focused reader rather than a full JSX parser: it handles the
 * shapes components actually use — elements, self-closing tags, text
 * expressions, ternaries and `&&` guards — and ignores anything else instead of
 * guessing at it.
 */
export function extractJsxTree(src) {
  const block = returnBlock(src);
  if (!block) return null;
  const bases = cvaBases(src);

  const stack = [];
  let root = null;
  let i = 0;
  // The text between the previous tag and the next one. When a tag follows
  // `loading ? (`, `x && ` or `) : (`, that element is not always rendered.
  let lead = '';

  const attach = (node) => {
    if (stack.length) stack[stack.length - 1].children.push(node);
    else if (!root) root = node;
  };

  while (i < block.length) {
    const lt = block.indexOf('<', i);

    // Text or expression between tags.
    if (lt < 0 || (stack.length && lt > i)) {
      const text = block.slice(i, lt < 0 ? block.length : lt).trim();
      if (text && stack.length) {
        for (const m of text.matchAll(/\{([^{}]+)\}/g)) {
          const expr = m[1].trim();
          if (!expr || expr.startsWith('/*')) continue;
          stack[stack.length - 1].children.push({ kind: 'expression', expression: expr, children: [] });
        }
      }
      if (lt < 0) break;
      lead = block.slice(i, lt);
      i = lt;
      continue;
    }

    if (block.startsWith('</', lt)) {
      const close = block.indexOf('>', lt);
      stack.pop();
      lead = '';
      i = close + 1;
      continue;
    }

    // Find the end of the opening tag, respecting braces and strings.
    let j = lt + 1;
    let depth = 0;
    let quote = null;
    while (j < block.length) {
      const ch = block[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
      j++;
    }

    const inner = block.slice(lt + 1, j);
    const selfClosing = inner.trimEnd().endsWith('/');
    const body = selfClosing ? inner.trimEnd().slice(0, -1) : inner;

    const parts = splitAttributes(body);
    const tag = parts.shift();
    if (!tag || tag.startsWith('!')) {
      i = j + 1;
      continue;
    }

    const attrs = {};
    // Spreads are kept in a list: an element can have several, and they all
    // used to land under one key and overwrite each other.
    const spreads = [];
    const references = new Set();
    for (const raw of parts) {
      const a = parseAttribute(raw);
      if (a.spread) {
        spreads.push(a.value.trim());
        referencesIn(a.value).forEach((r) => references.add(r));
        continue;
      }
      attrs[a.name] = a;
      // What the markup refers to: handlers, computed labels, helper results.
      // className is styling, not logic.
      if (a.isExpression && a.name !== 'className') referencesIn(a.value).forEach((r) => references.add(r));
    }

    const classNames = classNamesFrom(attrs.className, bases);
    const node = {
      kind: 'element',
      tag,
      component: /^[A-Z]/.test(tag),
      name: bemPart(classNames) || null,
      classNames,
      attrs,
      spreads,
      references: [...references],
      // Only the shapes that unambiguously signal a condition. It records THAT
      // the element is conditional, never what the condition is: that is source
      // logic, and the spec says so rather than implying the node is always there.
      conditionalRender: CONDITIONAL_LEAD.some((re) => re.test(lead)),
      children: [],
    };
    lead = '';

    attach(node);
    if (!selfClosing && !VOID_ELEMENTS.has(tag)) stack.push(node);
    i = j + 1;
  }

  return root;
}

/* ------------------------------------------------------------------ *
 * Turning the tree into contract nodes
 * ------------------------------------------------------------------ */

const ARIA_STATE = {
  'aria-disabled': 'disabled',
  'aria-busy': 'busy',
  'aria-expanded': 'expanded',
  'aria-selected': 'selected',
  'aria-checked': 'checked',
  'aria-readonly': 'readonly',
  'aria-pressed': 'pressed',
};

const IMPLICIT_ROLE = { button: 'button', a: 'link', input: 'textfield', img: 'image' };

/**
 * A prop reference if the expression is EXACTLY one, else null.
 *
 * It used to take the first word of any expression, so `labelledBy ? undefined :
 * label` was read as the labelledBy prop and `formatValueText?.(value)` as the
 * formatValueText prop itself. An expression is not a prop because it starts with
 * one: it is reported as the expression it is.
 */
const propRef = (expr, props) => {
  const name = String(expr).trim().match(/^([A-Za-z_$][\w$]*)$/)?.[1];
  return name && props && name in props ? `prop:${name}` : null;
};

/**
 * Flatten the JSX tree into contract composition nodes.
 *
 * Only what the markup states: which nodes exist, how they nest, what each
 * renders, and what each is to assistive tech. An `aria-label` becomes an
 * accessible name — never a visible child.
 */
export function compositionFromTree(tree, props) {
  const built = build(tree, props);
  if (built) nameNodes(built, true);
  return built;
}

function build(tree, props) {
  if (!tree || tree.kind !== 'element') return null;

  const a11y = {};
  let role = tree.attrs.role?.value || IMPLICIT_ROLE[tree.tag] || null;
  if (tree.attrs.role?.isExpression) role = null;

  if (tree.attrs['aria-label']) {
    const attr = tree.attrs['aria-label'];
    a11y.label = attr.isExpression ? propRef(attr.value, props) || `expr:${attr.value}` : `literal:${attr.value}`;
  }
  // `aria-labelledby` and `aria-describedby` name ANOTHER ELEMENT by id. That
  // concept does not exist natively, so the spec says which prop carries it.
  for (const [attr, key] of [['aria-labelledby', 'labelledBy'], ['aria-describedby', 'describedBy']]) {
    const a = tree.attrs[attr];
    if (a) a11y[key] = a.isExpression ? propRef(a.value, props) || `expr:${a.value}` : `literal:${a.value}`;
  }

  for (const [attr, key] of Object.entries(ARIA_STATE)) {
    if (!tree.attrs[attr]) continue;
    a11y[key] = true;

    // WHEN it is announced. `aria-readonly={frozen || undefined}` is "while the
    // frozen prop is true", and only an expression that is exactly that is read
    // as a prop: `value + 1` is not the `value` prop, so it stays an expression.
    const a = tree.attrs[attr];
    const simple = a.isExpression ? String(a.value).trim().match(/^!?(\w+)(?:\s*\|\|\s*(?:undefined|null|false))?$/) : null;
    (a11y.stateWhen ||= {})[key] = !a.isExpression
      ? `literal:${a.value}`
      : simple && !String(a.value).trim().startsWith('!') && props && simple[1] in props
        ? `prop:${simple[1]}`
        : `expr:${a.value}`;
  }
  for (const attr of ['aria-valuenow', 'aria-valuemin', 'aria-valuemax', 'aria-valuetext']) {
    const a = tree.attrs[attr];
    if (!a) continue;
    a11y.value ||= {};
    a11y.value[attr.replace('aria-value', '').toLowerCase() || 'now'] = a.isExpression
      ? propRef(a.value, props) || `expr:${a.value}`
      : a.value;
  }
  if (tree.attrs.tabIndex) a11y.focusable = String(tree.attrs.tabIndex.value) !== '-1';

  let content = null;
  const children = [];
  const nodeReferences = new Set(tree.references || []);
  for (const child of tree.children) {
    if (child.kind === 'expression') {
      referencesIn(child.expression).forEach((r) => nodeReferences.add(r));
      const ref = propRef(child.expression, props);
      if (!/[<]/.test(child.expression)) content = ref || `expr:${child.expression}`;
      continue;
    }
    if (child.component) {
      children.push({
        hints: { bem: child.name, tag: child.tag.replace(/Icon$/, '').toLowerCase() },
        kind: 'component',
        component: child.tag,
        styleClass: child.classNames.find((c) => c.includes('__')) || null,
        ...(child.conditionalRender ? { conditionalRender: true } : {}),
        children: [],
      });
      continue;
    }
    const sub = build(child, props);
    if (sub) children.push(sub);
  }

  /* Naming hints, resolved later when sibling context is available. */
  const labelRef = (a11y.label || '').match(/^prop:(\w+?)(Label)?$/i);

  /*
   * What drives each data-* attribute. The stylesheet keys rules on these
   * (`[data-full-width='true']`), and the only thing that says WHY one is set is
   * the markup: `data-full-width={fullWidth}` means the `fullWidth` prop. A value
   * that is not a prop stays as the source expression, for manual translation.
   */
  const attributes = {};
  for (const [name, a] of Object.entries(tree.attrs)) {
    if (!name.startsWith('data-')) continue;
    attributes[name] = a.isExpression ? propRef(a.value, props) || `expr:${a.value}` : `literal:${a.value}`;
  }

  // Event handlers the markup attaches (`onClick`, `onKeyDown`): names only. What
  // a handler does is in the logic it references.
  const handlers = Object.keys(tree.attrs).filter((name) => /^on[A-Z]/.test(name));

  return {
    hints: {
      bem: tree.name,
      label: labelRef ? labelRef[1] : null,
      role,
      tag: tree.tag,
    },
    kind: 'element',
    element: tree.tag,
    styleClass: tree.classNames.find((c) => c.includes('__')) || tree.classNames[0] || null,
    ...(role ? { role } : {}),
    ...(content ? { content } : {}),
    ...(Object.keys(a11y).length ? { a11y } : {}),
    ...(Object.keys(attributes).length ? { attributes } : {}),
    ...(tree.conditionalRender ? { conditionalRender: true } : {}),
    ...(handlers.length ? { handlers } : {}),
    ...(tree.spreads?.length ? { spreads: tree.spreads } : {}),
    ...(nodeReferences.size ? { references: [...nodeReferences] } : {}),
    children,
  };
}

/**
 * Give every node a readable name.
 *
 * A second pass, because the best name depends on siblings: `ds-counter__button`
 * is the obvious name for a button until there are two of them, at which point
 * the accessible names — decrement and increment — are what actually
 * distinguish them.
 */
function nameNodes(node, isRoot = false, used = new Set()) {
  if (isRoot) {
    node.name = 'root';
    used.add('root');
  }

  const bemCount = {};
  for (const child of node.children) {
    const bem = child.hints?.bem;
    if (bem) bemCount[bem] = (bemCount[bem] || 0) + 1;
  }

  for (const child of node.children) {
    const h = child.hints || {};
    const ambiguous = h.bem && bemCount[h.bem] > 1;
    const base = (ambiguous && h.label) || h.bem || h.label || h.role || h.tag || 'node';

    let name = base;
    let n = 2;
    while (used.has(name)) name = `${base}${n++}`;
    used.add(name);
    child.name = name;
    delete child.hints;

    nameNodes(child, false, used);
  }

  if (isRoot) delete node.hints;
  return node;
}
