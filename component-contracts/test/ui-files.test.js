/**
 * The reader is plain files that stay lean: what it loads exists, nothing external is fetched, and it stays small.
 *
 * There is no build, so the files in src/ui are the reader. This checks that they hang together (each page
 * loads a script and a stylesheet that exist, every module imports a module that exists), that it works
 * offline (no external URL anywhere, the logo's font is in the folder), that nothing a build would leave behind
 * is there, and that it stays within a size budget, so a bundle or a library cannot creep in unnoticed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI = join(ROOT, 'src/ui');

const walk = async (dir) =>
  (await readdir(dir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).map((e) => join(e.parentPath ?? e.path, e.name));

const exists = (p) => stat(p).then((s) => s.isFile(), () => false);

test('there are four pages, each loading the stylesheet and one script, and each is what it says it is', async () => {
  const pages = { 'index.html': 'ToNative', 'about.html': 'How this tool works', 'checks.html': 'What gets checked', 'mapping.html': 'Platform mapping' };
  assert.deepEqual((await readdir(UI)).filter((n) => n.endsWith('.html')).sort(), Object.keys(pages).sort());
  for (const [page, title] of Object.entries(pages)) {
    const html = await readFile(join(UI, page), 'utf8');
    assert.match(html, new RegExp(`<title>${title}</title>`), `${page} is titled ${title}`);
    assert.match(html, /<link rel="stylesheet" href="\/css\/app\.css">/);
    const scripts = [...html.matchAll(/<script type="module" src="([^"]+)">/g)].map((m) => m[1]);
    assert.equal(scripts.length, 1, `${page} loads one script`);
    assert.ok(await exists(join(UI, scripts[0])), `${page} loads ${scripts[0]}, which exists`);
    // The theme is set before the page paints, so a light-theme person does not see a flash of dark.
    assert.match(html, /localStorage\.getItem\("cc-theme"\)==="light"/);
  }
});

test('every module imports modules that exist, so the graph is complete with nothing to install or build', async () => {
  const scripts = (await walk(join(UI, 'js'))).filter((p) => p.endsWith('.js'));
  assert.ok(scripts.length >= 25, `only ${scripts.length} scripts found`);
  const missing = [];
  for (const file of scripts) {
    const src = await readFile(file, 'utf8');
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      if (!(await exists(resolve(dirname(file), m[1])))) missing.push(`${relative(UI, file)} imports ${m[1]}`);
    }
    // A bare import (a package) would need an install.
    for (const m of src.matchAll(/from\s+['"]([^./'"][^'"]*)['"]/g)) missing.push(`${relative(UI, file)} imports the package ${m[1]}`);
  }
  assert.deepEqual(missing, [], missing.join('\n'));
});

test('it works offline: no external address is loaded anywhere, and the logo’s font is a file in the folder', async () => {
  for (const file of await walk(UI)) {
    if (/\.woff2?$/.test(file)) continue;
    const src = await readFile(file, 'utf8');
    assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /https?:\/\//, `${relative(UI, file)} refers to an external address`);
  }
  const font = await readFile(join(UI, 'fonts/tiny5.woff2'));
  assert.equal(font.subarray(0, 4).toString('latin1'), 'wOF2', 'it is a real woff2 font');
  const css = await readFile(join(UI, 'css/app.css'), 'utf8');
  assert.match(css, /font-family:\s*'Tiny5'[\s\S]*?src:\s*url\(\.\.\/fonts\/tiny5\.woff2\)/, 'the stylesheet declares it, from the folder');
  assert.match(css, /--font-logo:\s*'Tiny5'/);
});

test('no build output or install is left in it, and nothing else describes a build', async () => {
  const names = (await readdir(UI, { recursive: true })).map((n) => n.replace(/\\/g, '/'));
  assert.ok(!names.some((n) => n.startsWith('assets/') || n === 'assets'), 'no bundled assets');
  assert.ok(!names.some((n) => n.includes('.build-hash') || n.includes('node_modules') || n.endsWith('.map')));
  assert.ok(!names.some((n) => /package(-lock)?\.json$/.test(n)), 'no package manifest: it has no dependencies');
  assert.ok(!(await exists(join(ROOT, 'web/package.json'))), 'and there is no web/ folder with its own install');
});

test('it stays lean: the whole reader fits a small budget, and no single file is a bundle', async () => {
  const sizes = await Promise.all((await walk(UI)).map(async (f) => ({ f: relative(UI, f), bytes: (await stat(f)).size })));
  const total = sizes.reduce((n, s) => n + s.bytes, 0);
  const biggest = [...sizes].sort((a, b) => b.bytes - a.bytes)[0];
  assert.ok(total < 250_000, `the reader is ${(total / 1024).toFixed(0)} KB, over its 250 KB budget`);
  assert.ok(biggest.bytes < 80_000, `${biggest.f} is ${(biggest.bytes / 1024).toFixed(0)} KB: a file that big is a bundle, not source`);
});
