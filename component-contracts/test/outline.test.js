/**
 * The outline's logic, on resolved platform specs.
 *
 * lib/outline.ts is pure (no DOM, no React), so it is tested here against specs the real
 * pipeline produces for Counter and for small synthetic components. It returns a view model
 * of strings and flags; that the view draws it, and the drawing's own classes, are covered
 * by test/ui-views.test.js and the style check below. What the eye makes of the colours is
 * covered by neither, because nothing in this repository can look.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import { importFromSources, importFromPath, sourcesFromFiles } from '../src/core/import/index.js';
import { loadConfig, tokenIndexFor } from '../src/core/build.js';
import { resolve } from '../src/core/resolve.js';
import { emitPlatformJson } from '../src/core/emit/platform.js';
import { outlineTree, outlineView, layoutVariants, OUTLINE_LEGEND } from '../src/ui/js/lib/outline.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = await loadConfig(ROOT);

// Stands in for the reader's naming: a token by its path, anything else as written.
const label = (v) => {
  if (v == null) return '\u2014';
  if (typeof v === 'string') return v.replace(/^\{(.+)\}$/, '$1');
  if (typeof v === 'number') return String(v);
  if (v.expression) return v.expression;
  return JSON.stringify(v);
};
const h = { label, valueOf: () => null };

const specNodes = (tsx, css, platform = 'ios') => {
  const { contract } = importFromSources({
    sources: sourcesFromFiles([{ name: 'X.tsx', content: tsx }, { name: 'x.css', content: css }]),
    id: 'x',
  });
  return JSON.parse(emitPlatformJson(resolve(contract, tokenIndexFor(contract, config), platform).artifact, { contract })).nodes;
};

const TSX = `
  export interface XProps {
    size?: string;
  }
  export function X({ size }: XProps) {
    return (
      <div className="ds-x" data-size={size}>
        <span className="ds-x__a" />
        <span className="ds-x__b" />
        <Icon className="ds-x__icon" />
      </div>
    );
  }
`;
const CSS = `
  .ds-x {
    display: flex; flex-direction: row; align-items: center;
    gap: var(--semantic-spacing-8);
    padding: var(--semantic-spacing-4) var(--semantic-spacing-12);
    border: 2px solid var(--semantic-color-border-moderate);
    border-radius: var(--semantic-border-radius-8);
    width: 200px; height: var(--semantic-size-32);
    box-sizing: border-box;
  }
  .ds-x[data-size='sm'] { padding: var(--semantic-spacing-2); gap: var(--semantic-spacing-4); }
  .ds-x__a { width: var(--semantic-size-24); }
  .ds-x__b { flex: 1 1 0; }
`;

const nodes = specNodes(TSX, CSS);
const view = (variant = null, n = nodes, labels = h) => outlineView(outlineTree(n, variant), labels);

/* ------------------------------------------------------------------ */

test('the tree follows the spec: the parent, its children in order, and what each states', () => {
  const t = outlineTree(nodes);
  assert.equal(t.name, 'root');
  assert.deepEqual(t.children.map((c) => c.name), ['a', 'b', 'icon']);
  assert.equal(t.container.axis, 'horizontal');
  assert.equal(t.border.width.value, 2, 'a literal border width is kept as stated');
  assert.equal(t.children[2].kind, 'component');
  assert.equal(t.children[2].component, 'Icon');
  assert.equal(outlineTree([]), null, 'nothing to draw, nothing drawn');
});

test('spacing is drawn where it sits: a border band, padding per side, and a gap between children', () => {
  const v = view();
  assert.match(v.border.text, /^border 2/, 'the border is stated and not zero, so it has a band');
  assert.equal(v.padding.one, false, 'differing sides are not collapsed to one label');
  assert.deepEqual(v.padding.labels.map((l) => l.side), ['pt', 'pr', 'pb', 'pl']);
  assert.deepEqual(v.padding.labels.map((l) => l.text[0]), ['T', 'R', 'B', 'L']);
  assert.match(v.padding.labels[0].text, /spacing 4/);
  assert.match(v.padding.labels[1].text, /spacing 12/);
  assert.match(v.gap.text, /spacing 8/, 'the gap value is on the marker');
  assert.equal(v.gap.vertical, false);
  assert.match(v.radius.text, /^r /);
  assert.deepEqual(v.container, { direction: 'row', justify: null, align: 'center' });
});

test('padding that is the same on every side is one label, and padding not set is zero, flagged unset', () => {
  const sm = layoutVariants(nodes).find((x) => /sm/.test(x.label));
  const v = view(sm.key);
  assert.equal(v.padding.one, true);
  assert.equal(v.padding.labels.length, 1);
  assert.match(v.padding.labels[0].text, /^padding .*spacing 2/);
  assert.equal(v.padding.labels[0].unset, false);
  // Only the root has padding to label: its children are leaves that state none.
  assert.ok(v.children.every((c) => c.padding === null));

  const bare = specNodes(
    `export interface XProps {
       a?: string;
     }
     export function X(){ return (<div className="ds-x"><span className="ds-x__a" /></div>); }`,
    `.ds-x { display: flex; }`,
  );
  const b = outlineView(outlineTree(bare), h);
  assert.deepEqual(b.padding, { one: true, labels: [{ side: 'pt', text: 'padding 0', title: 'padding not set: zero', unset: true }] });
  assert.equal(b.border, null, 'no border stated, no band');
  assert.equal(b.gap, null, 'one child has nothing to be a gap between');
});

test('a gap that is not stated is zero, and is flagged unset', () => {
  const t = specNodes(
    `export interface XProps {
       a?: string;
     }
     export function X(){ return (<div className="ds-x"><span className="ds-x__a" /><span className="ds-x__b" /></div>); }`,
    `.ds-x { display: flex; padding: var(--semantic-spacing-4); }`,
  );
  assert.deepEqual(outlineView(outlineTree(t), h).gap, { vertical: false, text: '0', title: 'gap not set: zero', unset: true });
});

test('layout that changes behind a condition gets an outline of its own, and only the nodes it names change', () => {
  const variants = layoutVariants(nodes);
  assert.deepEqual(variants.map((x) => x.label), ['data-size = sm']);

  const rest = outlineTree(nodes);
  const sm = outlineTree(nodes, variants[0].key);
  assert.notDeepEqual(sm.padding, rest.padding, 'root padding changes');
  assert.equal(sm.padding.top, sm.padding.left, 'and is now the same on every side');
  assert.deepEqual(sm.children.map((c) => c.size), rest.children.map((c) => c.size), 'children are untouched');
  assert.deepEqual(sm.border, rest.border);
});

test('an interaction state is not a layout variant', () => {
  const press = specNodes(
    `export interface XProps {
       a?: string;
     }
     export function X(){ return (<button className="ds-x" />); }`,
    `.ds-x { padding: var(--semantic-spacing-4); } .ds-x:active { padding: var(--semantic-spacing-2); }`,
  );
  assert.deepEqual(layoutVariants(press), [], 'pressed is a state, not a size or a layout switch');
});

test('size modes shape the diagram: flex shares the axis, fill stretches, hug takes what it needs', () => {
  const v = view();
  const [a, b, icon] = v.children;
  assert.deepEqual(b.item, { flex: '1 1 0%', stretch: false }, 'the flex child shares the main axis');
  assert.deepEqual(a.item, { flex: '0 0 auto', stretch: false }, 'a fixed child keeps its own size');
  assert.deepEqual(b.sizes[0], { key: 'W', text: 'flex 1' });
  assert.deepEqual(icon.sizes, [{ key: 'W', text: 'hug' }, { key: 'H', text: 'hug' }]);
  assert.deepEqual(v.sizes[0], { key: 'W', text: 'fixed 200' });
  // The root says it includes its border and padding because the stylesheet says so.
  assert.equal(v.includesBorderAndPadding, true);
  const contentBox = specNodes(TSX, CSS.replace('box-sizing: border-box;', ''));
  assert.equal(outlineView(outlineTree(contentBox), h).includesBorderAndPadding, false);
});

test('a component defined elsewhere is drawn as that, with no invented box', () => {
  const icon = view().children[2];
  assert.equal(icon.external, 'Icon');
  assert.equal(icon.padding, null);
  assert.equal(icon.border, null);
  assert.equal(icon.container, null);
  assert.equal(icon.leaf, null);
});

test('a token’s value is shown beside its name only when the contract declares one', () => {
  const known = view(null, nodes, { label, valueOf: (ref) => (ref === 'semantic.spacing.8' ? 8 : null) });
  assert.match(known.gap.text, /spacing 8 \u00b7 8/);
  assert.match(known.gap.title, /semantic\.spacing\.8 = 8/);
  assert.doesNotMatch(view().gap.text, /\u00b7/);
});

test('Counter, from its real spec: three children, a gap between them, a full-width variant, two external icons', async () => {
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  for (const platform of ['ios', 'android']) {
    const doc = JSON.parse(emitPlatformJson(resolve(contract, tokenIndexFor(contract, config), platform).artifact, { contract }));
    const t = outlineTree(doc.nodes);
    assert.deepEqual(t.children.map((c) => c.name), ['button', 'value', 'button2']);
    assert.equal(t.children[0].children[0].component, 'RemoveSmallIcon');

    const v = outlineView(t, h);
    assert.equal(v.gap.unset, true, 'the root states no gap');
    const flat = (n) => [n, ...n.children.flatMap(flat)];
    assert.equal(flat(v).length, 6);
    assert.equal(flat(v).filter((n) => n.external).length, 2);
    // The buttons state a border of 0, which is no border: only the root has a band.
    assert.deepEqual(flat(v).filter((n) => n.border).map((n) => n.name), ['root']);

    const variants = layoutVariants(doc.nodes);
    assert.deepEqual(variants.map((x) => x.label), ['data-full-width = true']);
    assert.deepEqual(outlineTree(doc.nodes, variants[0].key).size.width, { mode: 'fill' });
    assert.equal(t.size.width.mode, 'fixed', 'at rest it is the fixed width');
  }
});

test('the legend names every band the drawing uses, and each has a style', () => {
  const component = readFileSync(join(ROOT, 'src/ui/js/views/outline.js'), 'utf8');
  const css = readFileSync(join(ROOT, 'src/ui/css/app.css'), 'utf8');
  const used = new Set([...component.matchAll(/\bol-[a-z-]+/g)].map((m) => m[0]));
  for (const k of OUTLINE_LEGEND) used.add(k.cls);
  assert.equal(OUTLINE_LEGEND.length, 5);
  for (const cls of ['ol-border', 'ol-pad', 'ol-content', 'ol-gap', 'ol-ext']) assert.ok(used.has(cls), `the drawing uses ${cls}`);
  const missing = [...used].filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(css));
  assert.deepEqual(missing, [], `drawn but not styled: ${missing.join(', ')}`);
});

test('the logic is pure: it must run in Node with no DOM', () => {
  const src = readFileSync(join(ROOT, 'src/ui/js/lib/outline.js'), 'utf8');
  assert.doesNotMatch(src, /\bdocument\b|\bwindow\b|\bfetch\(/);
});
