/**
 * Build orchestration — contract in, platform files out.
 *
 * This is what both the CLI and the UI call. It is deliberately the only place
 * that touches the filesystem for output, so "what gets written where" has a
 * single definition.
 */

import { readFile, writeFile, mkdir, rm, stat, readdir } from 'node:fs/promises';
import { join, dirname, resolve as resolvePath } from 'node:path';

import { TokenIndex } from './tokens.js';
import { loadContract, normalise } from './contract.js';
import { validateContract } from './validate.js';
import { resolve, checkClosed } from './resolve.js';
import { emitPlatformJson } from './emit/platform.js';
import { emitDocs } from './docs.js';
import { pascal } from './emit/util.js';

export const TOOL = 'component-contracts v0.1.0';

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

export async function loadConfig(root) {
  const path = join(root, 'ds.config.json');
  const cfg = JSON.parse(await readFile(path, 'utf8'));
  return {
    root,
    ...cfg,
    // Optional namespace filter. Unset is usually right: a component's own
    // declarations are local variables, and anything else it reads is a token.
    cssPrefix: cfg.tokens?.cssPrefix || null,
    symbols: cfg.tokens?.symbols || {},
    contractsDir: resolvePath(root, cfg.contractsDir || './contracts'),
    outDir: resolvePath(root, cfg.outDir || './platform-specs'),
  };
}

/**
 * The token index for a component.
 *
 * Tokens belong to the contract, not to a shared directory, so the index is
 * built per component from the vocabulary discovered when it was added.
 */
export function tokenIndexFor(contract, config) {
  return TokenIndex.fromContract(contract, config.symbols || {});
}

/* ------------------------------------------------------------------ *
 * Layout of generated output
 * ------------------------------------------------------------------ */

/**
 * Where each platform's spec lands.
 *
 *   platform-specs/
 *     button/
 *       spec.md       the human-readable summary
 *       ios.json      one self-contained spec per platform
 *       android.json
 *
 * Component first, platform second. That way everything one component needs is
 * a single directory an engineer can review, copy, or delete as a unit — and
 * adding a platform never touches the other platforms' folders.
 *
 * Files are named for the platform rather than a language. The spec states what
 * iOS and Android each need; the team chooses the framework.
 */
/**
 * One file per platform.
 *
 * A split across resolved JSON, assertions JSON and a spec source meant the
 * consumer had to stitch three artifacts together and infer the layout from
 * none of them. Everything a platform needs now lives in a single file.
 */
export function outputPaths(config, contract, platform) {
  // One file per platform, named for the platform rather than a language: the
  // spec is data, and the team picks the framework.
  return { spec: join(config.outDir, contract.id, `${platform}.json`) };
}

/** The human-readable spec for a component, alongside its platform folders. */
export function docsPath(config, id) {
  return join(config.outDir, id, 'spec.md');
}

/** Everything generated for one component lives under a single directory. */
export function componentOutDir(config, id) {
  return join(config.outDir, id);
}

async function write(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  return path;
}

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

/**
 * Resolve and emit one component for every configured platform.
 *
 * @param {object}  opts
 * @param {object}  opts.config
 * @param {object}  opts.contract       normalised contract
 * @param {TokenIndex} opts.tokens
 * @param {boolean} opts.strict         fail if any artifact is not closed
 * @param {boolean} opts.dryRun         compute everything, write nothing
 */
export async function buildComponent({ config, contract, tokens, strict = true, dryRun = false }) {
  tokens = tokens || tokenIndexFor(contract, config);
  const validation = validateContract(contract, tokens);
  const platforms = (contract.platforms || config.platforms || []).filter((p) =>
    (config.platforms || []).includes(p)
  );

  const results = [];
  let blocked = false;

  for (const platform of platforms) {
    const { artifact, diagnostics } = resolve(contract, tokens, platform);
    const closure = checkClosed(artifact);
    const paths = outputPaths(config, contract, platform);
    const emitList = config.emit?.[platform] || ['resolved'];
    const written = [];

    if (strict && !closure.closed) {
      blocked = true;
      results.push({ platform, artifact, diagnostics, closure, files: [], skipped: true });
      continue;
    }

    // Not strict: the spec is written with gaps intact. Anything unresolved
    // reaches the platform as a null rather than a value, so the caller is
    // expected to surface `closure.problems` rather than treat this as clean.
    const incomplete = !closure.closed;

    if (!dryRun) {
      const source = emitPlatformJson(artifact, { tool: TOOL, contract, frameworks: config.frameworks });
      written.push(await write(paths.spec, source));
    } else {
      written.push(paths.spec);
    }

    results.push({
      platform,
      artifact,
      diagnostics,
      closure,
      incomplete,
      files: written.map((p) => p.replace(config.root + '/', '')),
      skipped: false,
    });
  }

  let docs = null;
  if (!dryRun && !blocked && results.length) {
    const path = docsPath(config, contract.id);
    await write(path, emitDocs(contract, results, validation));
    docs = path.replace(config.root + '/', '');
  }

  const incomplete = results.some((r) => r.incomplete);

  return {
    component: contract.id,
    contractVersion: contract.contractVersion,
    validation,
    results,
    docs,
    blocked,
    /** Written, but with gaps. Callers must say so rather than report success. */
    incomplete,
    // Success means the specs were written. Whether the contract still has
    // notes is reported separately — that is a warning, not a failure.
    ok: !blocked,
  };
}

/** Build every contract in the contracts directory. */
export async function buildAll({ config, strict = true, dryRun = false, ids = null }) {
  const { listContracts } = await import('./contract.js');
  const all = await listContracts(config.contractsDir);
  const targets = ids ? all.filter((c) => ids.includes(c.id)) : all;

  const builds = [];
  for (const meta of targets) {
    if (meta.broken) {
      builds.push({ component: meta.id, ok: false, error: 'Contract file is not valid JSON' });
      continue;
    }
    const contract = await loadContract(config.contractsDir, meta.id);
    builds.push(await buildComponent({ config, contract, strict, dryRun }));
  }
  return { builds, ok: builds.every((b) => b.ok) };
}

/* ------------------------------------------------------------------ *
 * Delete
 * ------------------------------------------------------------------ */

/**
 * Remove a contract and, by default, everything generated from it.
 *
 * Leaving specs behind is worse than deleting them: `git diff --exit-code`
 * still passes, so CI stays green while platform teams keep consuming files for
 * a component that no longer exists. Orphaned output is invisible drift, which
 * is exactly what this tool exists to prevent.
 *
 * Because every component owns one directory under the spec root, this is a
 * contract file plus a single tree — no scattered per-platform cleanup.
 *
 * @param {object}  opts
 * @param {boolean} opts.keepSpecs  leave the generated spec directory in place
 * @param {boolean} opts.dryRun     report what would go, remove nothing
 */
export async function deleteComponent({ config, id, keepSpecs = false, keepArtifacts = false, dryRun = false }) {
  const keep = keepSpecs || keepArtifacts;

  // Hard guard. Deletion is the only destructive operation here, so the bounds
  // are asserted rather than assumed: a misconfigured outDir must fail loudly
  // instead of quietly widening the blast radius.
  assertDeletable(config);

  if (!/^[a-z][a-z0-9-]*$/.test(String(id || ''))) {
    throw new Error(`Refusing to delete: "${id}" is not a valid component id.`);
  }

  const contractPath = join(config.contractsDir, `${id}.contract.json`);
  const specDir = componentOutDir(config, id);

  // Never touch anything outside the directories this tool owns.
  const owned = [config.contractsDir, config.outDir];
  const inBounds = (p) => owned.some((dir) => p.startsWith(dir + '/'));

  const removed = [];

  if (!inBounds(contractPath) || !(await exists(contractPath))) {
    throw new Error(`No contract found for "${id}".`);
  }
  if (!dryRun) await rm(contractPath, { force: true });
  removed.push(contractPath.replace(config.root + '/', ''));

  if (!keep && inBounds(specDir) && (await exists(specDir))) {
    for (const file of await listFiles(specDir)) {
      removed.push(file.replace(config.root + '/', ''));
    }
    if (!dryRun) await rm(specDir, { recursive: true, force: true });
  }

  if (!dryRun && !keep) await pruneEmptyDirs(config.outDir);

  return { id, removed, keptSpecs: keep, dryRun };
}

/**
 * Refuse to operate when the configured directories are not safely scoped.
 *
 * Catches the configuration mistakes that would turn a component delete into a
 * project delete: an outDir of `.` or `/`, a spec root outside the project, or
 * contracts and output pointing at the same place.
 */
function assertDeletable(config) {
  const root = resolvePath(config.root);
  for (const [label, dir] of [
    ['contractsDir', config.contractsDir],
    ['outDir', config.outDir],
  ]) {
    if (!dir) throw new Error(`Refusing to delete: ${label} is not configured.`);
    const full = resolvePath(dir);
    if (full === root || full === '/' || !full.startsWith(root + '/')) {
      throw new Error(
        `Refusing to delete: ${label} (${dir}) must be a directory inside the project root (${root}).`
      );
    }
  }
  if (resolvePath(config.contractsDir) === resolvePath(config.outDir)) {
    throw new Error('Refusing to delete: contractsDir and outDir must not be the same directory.');
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Every file under a directory, recursively. */
async function listFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out.sort();
}

/** Remove directories left empty after deleting generated specs. */
async function pruneEmptyDirs(root) {
  if (!(await exists(root))) return;
  const walk = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return false; // unreadable — leave it alone rather than assume it is empty
    }
    let empty = true;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const childEmpty = await walk(join(dir, entry.name));
        if (childEmpty) await rm(join(dir, entry.name), { recursive: true, force: true });
        else empty = false;
      } else empty = false;
    }
    return empty;
  };
  // Children only — the spec root itself is never removed.
  await walk(root);
}

export { normalise, validateContract, resolve, checkClosed };
