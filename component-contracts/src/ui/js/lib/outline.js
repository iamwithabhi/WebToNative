/**
 * The outline: a component's parts as nested boxes, with each node's border,
 * padding and gap drawn where they sit.
 *
 * It is built from the nodes the platform spec carries (layout, padding, border,
 * size modes), so it shows what the spec says and nothing it does not. It is
 * schematic, not to scale: a token's value lives in the platform's token library,
 * so the bands are labelled, not measured. Proportions follow only what the spec
 * states: a node that is flex shares the main axis, fill stretches, hug does not.
 *
 * Padding or a gap that is not stated is zero (CSS has no implicit spacing), and
 * is drawn that way, muted, so "none" reads as a fact rather than a gap.
 *
 * Layout that changes behind a condition (a size, full width) gets an outline of
 * its own, so spacing that varies can be seen without interacting.
 *
 * This file is the logic only: it returns a view model of plain strings and flags,
 * and views/outline.js draws it. No DOM, so it is tested in Node.
 */

/** A condition in words, e.g. `data-size = sm`. */
const whenWords = (when) => when.map((w) => `${w.attribute} ${w.negate ? '\u2260' : '='} ${w.equals}`).join(' and ');

const whenKey = (when) => when.map((w) => `${w.node}[${w.attribute}${w.negate ? '!=' : '='}${w.equals}]`).join(' & ');

/** Does a conditional change touch anything the outline draws? */
const touchesOutline = (c) =>
  !!(c.layout?.container || c.layout?.padding || c.layout?.size || c.appearance?.border || c.appearance?.cornerRadius);

/** A condition set by an attribute; an interaction state (pressed, focused) is not a layout variant. */
const byAttribute = (c) => !!c.when?.length && c.when.every((w) => w.attribute && !w.state);

/** The distinct conditions, set by an attribute, under which a node's layout or border changes. */
export function layoutVariants(nodes = []) {
  const found = new Map();
  for (const node of nodes) {
    for (const c of node.conditional || []) {
      if (!byAttribute(c) || !touchesOutline(c)) continue;
      const key = whenKey(c.when);
      if (!found.has(key)) found.set(key, { key, label: whenWords(c.when) });
    }
  }
  return [...found.values()];
}

const mergeLayout = (base = {}, over = {}) => ({
  ...(base.container || over.container ? { container: { ...base.container, ...over.container } } : {}),
  ...(base.padding || over.padding ? { padding: { ...base.padding, ...over.padding } } : {}),
  ...(base.size || over.size ? { size: { ...base.size, ...over.size } } : {}),
});

/**
 * The node tree, with one variant applied (or none, for the component at rest).
 * Every node carries only what the spec states for it.
 */
export function outlineTree(nodes = [], variantKey = null) {
  const byName = new Map(nodes.map((n) => [n.name, n]));

  const resolved = (node) => {
    let layout = node.layout || {};
    let border = node.appearance?.border;
    let radius = node.appearance?.cornerRadius;
    if (variantKey) {
      for (const c of node.conditional || []) {
        if (!byAttribute(c) || whenKey(c.when) !== variantKey) continue;
        layout = mergeLayout(layout, c.layout);
        if (c.appearance?.border) border = { ...border, ...c.appearance.border };
        if (c.appearance?.cornerRadius !== undefined) radius = c.appearance.cornerRadius;
      }
    }
    return { layout, border, radius };
  };

  const build = (node) => {
    const { layout, border, radius } = resolved(node);
    return {
      name: node.name,
      kind: node.kind,
      component: node.component || null,
      element: node.element || null,
      container: layout.container || null,
      padding: layout.padding || null,
      border: border || null,
      radius: radius ?? null,
      size: layout.size || {},
      children: (node.children || []).map((name) => byName.get(name)).filter(Boolean).map(build),
    };
  };

  const top = nodes.find((n) => !n.parent) || nodes[0];
  return top ? build(top) : null;
}

/* ------------------------------------------------------------------ *
 * the view model
 * ------------------------------------------------------------------ */

const isZero = (v) => v === 0 || v === '0' || (!!v && typeof v === 'object' && v.value === 0);

/** One value, shortened for a cramped label: `{semantic.spacing.0}` -> `spacing 0`. */
function shortOf(value, h) {
  if (value == null || value === '') return '\u2014';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    const ref = value.match(/^\{(.+)\}$/)?.[1];
    return ref ? ref.split('.').slice(-2).join(' ') : value;
  }
  if (value.expression) return value.expression.replace(/\{([^}]+)\}/g, (_, r) => r.split('.').slice(-2).join(' '));
  if (value.value !== undefined) return `${value.value}${value.unit === '%' ? '%' : ''}`;
  return h.label(value);
}

/** The full name, for a tooltip, with the resolved value when one is known. */
function fullOf(value, h) {
  const text = h.label(value);
  const ref = typeof value === 'string' ? value.match(/^\{(.+)\}$/)?.[1] : null;
  const known = ref ? h.valueOf?.(ref) : null;
  return known != null ? `${text} = ${known}` : text;
}

/** A value's short label plus its resolved value when the contract declares one. */
function labelOf(value, h) {
  const ref = typeof value === 'string' ? value.match(/^\{(.+)\}$/)?.[1] : null;
  const known = ref ? h.valueOf?.(ref) : null;
  return `${shortOf(value, h)}${known != null ? ` \u00b7 ${known}` : ''}`;
}

function sizeWords(mode, h) {
  if (!mode) return null;
  switch (mode.mode) {
    case 'fixed': return `fixed ${shortOf(mode.value, h)}`;
    case 'fill': return 'fill';
    case 'hug': return 'hug';
    case 'flex': return `flex ${mode.grow ?? 1}`;
    case 'percentOfParent': return `${mode.percent}% of parent`;
    default: return mode.mode || null;
  }
}

const SIDES = [['top', 'pt', 'T'], ['right', 'pr', 'R'], ['bottom', 'pb', 'B'], ['left', 'pl', 'L']];
const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' };

/** How a child sits in its parent, in the parent's axis: share, fill or its own size. */
function itemOf(child, parentAxis) {
  const vertical = parentAxis === 'vertical';
  const main = vertical ? child.size.height : child.size.width;
  const cross = vertical ? child.size.width : child.size.height;
  let flex = '0 0 auto';
  if (main?.mode === 'flex') flex = `${main.grow ?? 1} ${main.shrink ?? 1} 0%`;
  else if (main?.mode === 'fill') flex = '1 1 0%';
  return { flex, stretch: cross?.mode === 'fill' };
}

/**
 * Everything the view needs to draw one node, as strings and flags.
 *
 * @param node a node from outlineTree
 * @param h    how to name a value: { label(value), valueOf?(ref) }
 */
export function outlineView(node, h, parentAxis = null) {
  const axis = node.container?.axis || 'horizontal';
  const external = node.kind === 'component';
  const hasKids = node.children.length > 0;

  const meta = [
    hasKids ? (axis === 'vertical' ? 'column' : 'row') : null,
    node.container?.mainAlign ? `main ${node.container.mainAlign}` : null,
    node.container?.crossAlign ? `cross ${node.container.crossAlign}` : null,
  ].filter(Boolean).join(' \u00b7 ');

  const sizes = ['W', 'H']
    .map((key) => ({ key, text: sizeWords(key === 'W' ? node.size.width : node.size.height, h) }))
    .filter((s) => !!s.text);

  /* padding: one label when every side agrees, four when they differ */
  const pad = node.padding || {};
  const given = SIDES.filter(([side]) => pad[side] != null);
  const uniform = given.length === 4 && SIDES.every(([side]) => JSON.stringify(pad[side]) === JSON.stringify(pad.top));
  let padding = null;
  if (!external && (hasKids || given.length)) {
    if (!given.length) {
      padding = { one: true, labels: [{ side: 'pt', text: 'padding 0', title: 'padding not set: zero', unset: true }] };
    } else if (uniform) {
      padding = {
        one: true,
        labels: [{ side: 'pt', text: `padding ${labelOf(pad.top, h)}`, title: `padding, all sides: ${fullOf(pad.top, h)}`, unset: false }],
      };
    } else {
      padding = {
        one: false,
        labels: SIDES.map(([side, cls, letter]) =>
          pad[side] == null
            ? { side: cls, text: `${letter} 0`, title: `padding ${side} not set: zero`, unset: true }
            : { side: cls, text: `${letter} ${labelOf(pad[side], h)}`, title: `padding ${side}: ${fullOf(pad[side], h)}`, unset: false },
        ),
      };
    }
  }

  /* border: a band only when it is stated and not zero */
  const b = node.border;
  const hasBorder = !!b && b.width != null && !isZero(b.width);
  const border = hasBorder
    ? {
        text: `border ${labelOf(b.width, h)}${b.style ? ` \u00b7 ${b.style}` : ''}`,
        title: `border ${fullOf(b.width, h)}${b.style ? `, ${b.style}` : ''}`,
      }
    : null;
  const radius = node.radius != null && !isZero(node.radius)
    ? { text: `r ${labelOf(node.radius, h)}`, title: `corner radius ${fullOf(node.radius, h)}` }
    : null;

  let gap = null;
  if (hasKids && node.children.length > 1) {
    const g = node.container?.gap;
    const stated = g != null && g !== '';
    gap = {
      vertical: axis === 'vertical',
      text: stated ? labelOf(g, h) : '0',
      title: stated ? `gap ${fullOf(g, h)}` : 'gap not set: zero',
      unset: !stated,
    };
  }

  return {
    name: node.name,
    element: node.element,
    external: external ? node.component : null,
    meta,
    sizes,
    includesBorderAndPadding: !!node.size.includesBorderAndPadding,
    item: parentAxis ? itemOf(node, parentAxis) : null,
    radius: external ? null : radius,
    border: external ? null : border,
    padding,
    container: hasKids && !external
      ? {
          direction: axis === 'vertical' ? 'column' : 'row',
          justify: node.container?.mainAlign ? ALIGN[node.container.mainAlign] || node.container.mainAlign : null,
          align: ALIGN[node.container?.crossAlign] || 'stretch',
        }
      : null,
    leaf: hasKids || external ? null : node.element || 'content',
    gap,
    children: node.children.map((c) => outlineView(c, h, axis)),
  };
}

/** The key to the colours, so the bands can be read without guessing. */
export const OUTLINE_LEGEND = [
  { cls: 'ol-k-border', text: 'border' },
  { cls: 'ol-k-pad', text: 'padding' },
  { cls: 'ol-k-content', text: 'content' },
  { cls: 'ol-k-gap', text: 'gap between children' },
  { cls: 'ol-k-ext', text: 'component defined elsewhere' },
];
