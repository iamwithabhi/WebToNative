/**
 * The server: what it serves to the browser, and the file list its preview reports.
 *
 * It is started on a free port over a throwaway project, so these tests touch neither the
 * user's contracts nor the built UI. They cover the parts the reader depends on without
 * being able to see: that built assets (script, style, font) are served with the type a
 * browser needs, that nothing outside the UI directory is, and which file each platform's
 * spec is reported as being written to.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer } from '../src/server/index.js';
import { loadConfig } from '../src/core/build.js';
import { saveContract } from '../src/core/contract.js';
import { importFromPath } from '../src/core/import/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let root, server, url;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'cc-server-'));
  await copyFile(join(ROOT, 'ds.config.json'), join(root, 'ds.config.json'));
  await mkdir(join(root, 'src/ui/assets'), { recursive: true });
  await writeFile(join(root, 'src/ui/index.html'), '<!doctype html><title>ui</title>');
  await writeFile(join(root, 'src/ui/assets/app-abc123.js'), 'export {}');
  await writeFile(join(root, 'src/ui/assets/app-abc123.css'), 'a{}');
  await writeFile(join(root, 'src/ui/assets/inter.woff2'), Buffer.from([0, 1, 2]));
  await writeFile(join(root, 'secret.txt'), 'outside the UI directory');

  const config = await loadConfig(root);
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  await saveContract(config.contractsDir, contract);
  ({ server, url } = await startServer({ config, root, port: 0 }));
});

after(async () => {
  await new Promise((done) => server.close(done));
  await rm(root, { recursive: true, force: true });
});

const get = (path) => fetch(url + path);

test('it reports the port it is actually listening on, so port 0 means any free port', () => {
  assert.match(url, /^http:\/\/localhost:\d+$/);
  assert.notEqual(new URL(url).port, '0');
});

test('built assets are served with the type a browser needs, and the page at /', async () => {
  const page = await get('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);

  const types = {
    '/assets/app-abc123.js': /text\/javascript/,
    '/assets/app-abc123.css': /text\/css/,
    '/assets/inter.woff2': /^font\/woff2$/,
  };
  for (const [path, type] of Object.entries(types)) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), type, path);
  }
});

test('nothing outside the UI directory is served, and a missing file is a 404', async () => {
  // The URL parser already removes "../" before the server's own directory check sees it, so
  // that check is defence in depth and this tests the outcome, not that line.
  const outside = await get('/../../secret.txt');
  assert.notEqual(await outside.text(), 'outside the UI directory');
  assert.ok([403, 404].includes(outside.status), `got ${outside.status}`);
  assert.equal((await get('/assets/missing.js')).status, 404);
  assert.equal((await get('/api/nope')).status, 404);
});

test('a preview names the file each platform’s spec is written to', async () => {
  // The list was always empty: it was filtered by `emit`, whose entries never matched the path's key.
  const contract = (await (await get('/api/contract/counter')).json()).contract;
  const res = await fetch(`${url}/api/preview/counter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contract }),
  });
  assert.equal(res.status, 200);
  const { previews } = await res.json();
  assert.deepEqual(previews.map((p) => p.platform), ['ios', 'android']);
  for (const p of previews) assert.deepEqual(p.files, [`platform-specs/counter/${p.platform}.json`]);
});
