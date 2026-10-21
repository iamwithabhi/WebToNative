/**
 * Every table in the reader is drawn the same way, because none of them chooses how.
 *
 * A table is only ever made by views/table.js, and the scheme for its padding, alignment and text is one block
 * of css/app.css under `.tbl`. What would break that is a view building a table by hand, reaching for its own
 * `<code>`, or styling something inline, so this reads the reader's source and fails on each, and checks that
 * the scheme in the stylesheet is what it is documented to be. It checks how a table is built stays uniform.
 * It cannot see how it looks: that was measured in a browser.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI = join(ROOT, 'src/ui');

/** Every script of the reader, as { path, src }. */
async function scripts() {
  const files = (await readdir(join(UI, 'js'), { recursive: true })).filter((p) => p.endsWith('.js'));
  return Promise.all(files.map(async (p) => ({ path: p, src: await readFile(join(UI, 'js', p), 'utf8') })));
}

/** The body of the rule for a selector in the stylesheet, or null. */
function rule(css, selector) {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) return null;
  return css.slice(start, css.indexOf('}', start));
}

test('a table is built in one place: no view writes raw table markup', async () => {
  const raw = [];
  let seen = 0;
  for (const { path, src } of await scripts()) {
    seen++;
    if (path === 'views/table.js') continue; // the one place a table is made
    // Strip comments first: a comment may say "<table>" in words.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of code.matchAll(/<(table|thead|tbody|tfoot|tr|th|td)[\s>]/g)) raw.push(`${path}: <${m[1]}>`);
  }
  assert.ok(seen >= 20, `only ${seen} scripts were read: the scan is not looking at the reader`);
  assert.deepEqual(raw, [], `raw table markup outside views/table.js:\n  ${raw.join('\n  ')}`);
});

test('an identifier is code(), so it has one size and weight wherever it appears', async () => {
  const stray = [];
  for (const { path, src } of await scripts()) {
    if (path === 'views/shared.js') continue; // where code() is defined
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (/<code[\s>]/.test(code)) stray.push(path);
  }
  assert.deepEqual(stray, [], `a <code> that is not code():\n  ${stray.join('\n  ')}`);
});

test('nothing is styled inline except what has to be: the outline’s layout and a token’s own colour', async () => {
  const allowed = new Set(['views/outline.js', 'views/shared.js']);
  const offenders = [];
  for (const { path, src } of await scripts()) {
    if (allowed.has(path)) continue;
    if (/\sstyle=["'`$]/.test(src.replace(/\/\*[\s\S]*?\*\//g, ''))) offenders.push(path);
  }
  assert.deepEqual(offenders, [], `inline style outside the outline and the swatch (the stylesheet decides how a thing looks):\n  ${offenders.join('\n  ')}`);
});

test('the scheme is where it is said to be: column heads, row labels and cells are set in one block of the stylesheet', async () => {
  const css = await readFile(join(UI, 'css/app.css'), 'utf8');
  const head = rule(css, '.tbl th');
  assert.ok(head, 'the column head rule');
  assert.match(head, /height: 36px/);
  assert.match(head, /padding: 0 16px/);
  assert.match(head, /font-size: 12px/);
  assert.match(head, /font-weight: 500/);
  assert.match(head, /color: var\(--muted-foreground\)/);
  assert.match(head, /vertical-align: middle/);

  const label = rule(css, ".tbl th[scope='row']");
  assert.ok(label, 'the row label rule');
  assert.match(label, /font-size: 14px/);
  assert.match(label, /vertical-align: top/);

  const cell = rule(css, '.tbl td');
  assert.ok(cell, 'the cell rule');
  assert.match(cell, /padding: 10px 16px/);
  assert.match(cell, /vertical-align: top/);

  assert.match(rule(css, '.tbl .num'), /text-align: right/);
  assert.match(rule(css, '.tbl .nowrap'), /white-space: nowrap/);
  // A sticky header must not be clipped by its card or its wrapper.
  assert.match(rule(css, '.tbl-sticky'), /overflow: clip/);
  assert.match(rule(css, '.tbl-sticky .tbl-wrap'), /overflow: visible/);
});

test('table.js is the only way a table gets its card, and offers only what the scheme has: numeric, nowrap, sticky', async () => {
  const src = await readFile(join(UI, 'js/views/table.js'), 'utf8');
  for (const option of ['numeric', 'nowrap', 'sticky']) assert.ok(src.includes(option), option);
  assert.match(src, /export const tableBlock/);
  assert.match(src, /export const rowHead/);
});
