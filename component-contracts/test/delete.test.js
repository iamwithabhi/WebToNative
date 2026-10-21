/**
 * Delete tests.
 *
 * Deletion is the one operation that destroys work, so the guarantees worth
 * testing are: it removes what it says it will, it never reaches outside the
 * directories this tool owns, and keeping specs behind is an explicit choice
 * rather than an accident.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { mkdtemp, mkdir, writeFile, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { deleteComponent, outputPaths, docsPath, componentOutDir } from '../src/core/build.js';
import { blankContract, saveContract, listContracts } from '../src/core/contract.js';

const PLATFORMS = ['ios', 'android'];

/** A throwaway workspace so tests never touch the real contracts or specs. */
async function workspace(ids = ['widget']) {
  const root = await mkdtemp(join(tmpdir(), 'cc-del-'));
  const config = {
    root,
    platforms: PLATFORMS,
    contractsDir: join(root, 'contracts'),
    outDir: join(root, 'platform-specs'),
    emit: { ios: ['resolved', 'swift'], android: ['resolved', 'kotlin'] },
  };
  await mkdir(config.contractsDir, { recursive: true });

  for (const id of ids) {
    const contract = blankContract(id, id);
    await saveContract(config.contractsDir, contract);

    // Stand in for generated specs — one file per platform.
    for (const platform of PLATFORMS) {
      const { spec } = outputPaths(config, contract, platform);
      await mkdir(dirname(spec), { recursive: true });
      await writeFile(spec, '// generated\n');
    }
    const docs = docsPath(config, id);
    await mkdir(dirname(docs), { recursive: true });
    await writeFile(docs, `# ${id}\n`);
  }

  return { root, config, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const exists = async (p) => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

test('delete removes the contract and the whole spec directory', async () => {
  const ws = await workspace();
  try {
    const result = await deleteComponent({ config: ws.config, id: 'widget' });

    assert.equal(await exists(join(ws.config.contractsDir, 'widget.contract.json')), false);
    assert.equal(await exists(componentOutDir(ws.config, 'widget')), false);
    assert.ok(result.removed.length >= 4, 'contract + one spec per platform + docs');
    assert.deepEqual(await listContracts(ws.config.contractsDir), []);
  } finally {
    await ws.cleanup();
  }
});

test('one component is one directory, so cleanup is a single tree', async () => {
  const ws = await workspace();
  try {
    const plan = await deleteComponent({ config: ws.config, id: 'widget', dryRun: true });
    const specFiles = plan.removed.filter((f) => f.startsWith('platform-specs/'));
    assert.ok(specFiles.every((f) => f.startsWith('platform-specs/widget/')));
    // One file per platform, side by side, rather than a folder each.
    assert.ok(specFiles.some((f) => f.endsWith('ios.json')));
    assert.ok(specFiles.some((f) => f.endsWith('android.json')));
    assert.ok(specFiles.some((f) => f.endsWith('spec.md')));
  } finally {
    await ws.cleanup();
  }
});

test('dry run reports the same files but removes nothing', async () => {
  const ws = await workspace();
  try {
    const plan = await deleteComponent({ config: ws.config, id: 'widget', dryRun: true });
    assert.equal(plan.dryRun, true);
    assert.equal(await exists(join(ws.config.contractsDir, 'widget.contract.json')), true);

    const real = await deleteComponent({ config: ws.config, id: 'widget' });
    assert.deepEqual(real.removed, plan.removed, 'the preview must match what actually happens');
  } finally {
    await ws.cleanup();
  }
});

test('keepSpecs removes only the contract', async () => {
  const ws = await workspace();
  try {
    const result = await deleteComponent({ config: ws.config, id: 'widget', keepSpecs: true });

    assert.equal(result.removed.length, 1);
    assert.equal(result.keptSpecs, true);
    assert.equal(await exists(join(ws.config.contractsDir, 'widget.contract.json')), false);
    assert.equal(
      await exists(componentOutDir(ws.config, 'widget')),
      true,
      'specs survive when explicitly kept'
    );
  } finally {
    await ws.cleanup();
  }
});

test('deleting an unknown component throws rather than silently succeeding', async () => {
  const ws = await workspace();
  try {
    await assert.rejects(() => deleteComponent({ config: ws.config, id: 'nope' }), /No contract found/);
  } finally {
    await ws.cleanup();
  }
});

test('deleting one component leaves the others untouched', async () => {
  const ws = await workspace(['widget', 'other']);
  try {
    await deleteComponent({ config: ws.config, id: 'widget' });

    const left = await listContracts(ws.config.contractsDir);
    assert.deepEqual(left.map((c) => c.id), ['other']);
    assert.equal(await exists(componentOutDir(ws.config, 'other')), true);
  } finally {
    await ws.cleanup();
  }
});

test('empty directories are pruned, but the spec root survives', async () => {
  const ws = await workspace();
  try {
    await deleteComponent({ config: ws.config, id: 'widget' });
    assert.equal(await exists(ws.config.outDir), true, 'the spec root itself is never removed');
    const left = await readdir(ws.config.outDir);
    assert.equal(left.length, 0, `spec root should be empty, found: ${left.join(', ')}`);
  } finally {
    await ws.cleanup();
  }
});

/* ------------------------------------------------------------------ *
 * bounds — the guard rails
 * ------------------------------------------------------------------ */

test('a path-traversal id is refused outright', async () => {
  const ws = await workspace();
  try {
    await assert.rejects(
      () => deleteComponent({ config: ws.config, id: '../../etc/passwd' }),
      /not a valid component id/
    );
    assert.equal(await exists(ws.config.contractsDir), true);
  } finally {
    await ws.cleanup();
  }
});

test('an empty or absurd id is refused', async () => {
  const ws = await workspace();
  try {
    for (const id of ['', '/', '.', '..', 'Widget', 'a b']) {
      await assert.rejects(() => deleteComponent({ config: ws.config, id }), /not a valid component id/);
    }
  } finally {
    await ws.cleanup();
  }
});

test('an outDir at the project root is refused, not obeyed', async () => {
  const ws = await workspace();
  try {
    // The configuration mistake that would turn a component delete into a
    // project delete. It must fail loudly.
    const bad = { ...ws.config, outDir: ws.root };
    await assert.rejects(
      () => deleteComponent({ config: bad, id: 'widget' }),
      /must be a directory inside the project root/
    );
    assert.equal(await exists(join(ws.config.contractsDir, 'widget.contract.json')), true);
  } finally {
    await ws.cleanup();
  }
});

test('an outDir outside the project is refused', async () => {
  const ws = await workspace();
  try {
    const bad = { ...ws.config, outDir: '/tmp' };
    await assert.rejects(
      () => deleteComponent({ config: bad, id: 'widget' }),
      /must be a directory inside the project root/
    );
  } finally {
    await ws.cleanup();
  }
});

test('contracts and specs sharing a directory is refused', async () => {
  const ws = await workspace();
  try {
    const bad = { ...ws.config, outDir: ws.config.contractsDir };
    await assert.rejects(
      () => deleteComponent({ config: bad, id: 'widget' }),
      /must not be the same directory/
    );
  } finally {
    await ws.cleanup();
  }
});

test('nothing outside contracts/ and the spec root is ever touched', async () => {
  const ws = await workspace();
  try {
    // A sibling directory — a token library, for instance — must survive.
    const tokens = join(ws.root, 'tokens');
    await mkdir(tokens, { recursive: true });
    await writeFile(join(tokens, 'color.tokens.json'), '{}');

    await deleteComponent({ config: ws.config, id: 'widget' });

    assert.equal(await exists(join(tokens, 'color.tokens.json')), true, 'token library must survive');
    assert.equal(await exists(tokens), true);
  } finally {
    await ws.cleanup();
  }
});
