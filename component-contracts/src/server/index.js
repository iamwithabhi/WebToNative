/**
 * Local HTTP server for the authoring UI.
 *
 * Every endpoint is a thin wrapper over src/core — the UI and the CLI run the
 * same code, so what you see in the browser is exactly what CI will produce.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, resolve as resolvePath } from 'node:path';

import { tokenIndexFor, buildComponent, outputPaths, deleteComponent } from '../core/build.js';
import { mappingTables } from '../core/mapping-table.js';
import { architecture } from '../core/architecture.js';
import { checks } from '../core/checks.js';
import {
  listContracts,
  loadContract,
  saveContract,
  blankContract,
  normalise,
  axesOf,
} from '../core/contract.js';
import { validateContract, REQUIRED_SIZE_KEYS } from '../core/validate.js';
import { resolve as resolveArtifact, checkClosed } from '../core/resolve.js';
import { importFromPath, importFromSources, sourcesFromFiles, mergeDraft } from '../core/import/index.js';
import { SAFE_ANIMATABLE, A11Y_ROLES, REDUCED_MOTION_MODES } from '../core/contract.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
};

const MAX_BODY = 8 * 1024 * 1024;

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('That folder is too large to read in one go.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Request body is not valid JSON');
  }
}

export async function startServer({ config, root, port = 4321 }) {
  const uiDir = join(root, 'src', 'ui');

  /** A component's tokens come from its own contract. */
  const indexFor = (contract) => tokenIndexFor(contract, config);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    try {
      /* ------------------------- API ------------------------- */

      // The checks, read out of the validator itself.
      if (path === '/api/checks' && req.method === 'GET') {
        return json(res, 200, await checks(root));
      }

      // How the tool works, read out of the source files themselves.
      if (path === '/api/architecture' && req.method === 'GET') {
        return json(res, 200, await architecture(root));
      }

      // The mapping tables, read out of the mapping module itself.
      // The raw data, so the page can hand over the file it is rendering.
      if (path === '/platform-map.json' && req.method === 'GET') {
        const raw = await readFile(join(root, 'src', 'core', 'platform-map.json'));
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(raw);
      }

      if (path === '/api/mapping' && req.method === 'GET') {
        return json(res, 200, { sections: mappingTables() });
      }

      if (path === '/api/state' && req.method === 'GET') {
        return json(res, 200, {
          root: config.root,
          contractsDir: config.contractsDir.replace(config.root + '/', ''),
          outDir: config.outDir.replace(config.root + '/', ''),
          platforms: config.platforms,
          emit: config.emit,
          contracts: await listContracts(config.contractsDir),
          cssPrefix: config.cssPrefix,
          vocab: {
            safeAnimatable: [...SAFE_ANIMATABLE],
            a11yRoles: A11Y_ROLES,
            reducedMotion: REDUCED_MOTION_MODES,
            requiredSizeKeys: REQUIRED_SIZE_KEYS,
          },
        });
      }

      const tokensMatch = path.match(/^\/api\/tokens\/([a-z0-9-]+)$/);
      if (tokensMatch && req.method === 'GET') {
        const contract = await loadContract(config.contractsDir, tokensMatch[1]);
        return json(res, 200, { tokens: indexFor(contract).list() });
      }

      if (path === '/api/import' && req.method === 'POST') {
        const body = await readBody(req);
        let draft;
        let report;

        if (Array.isArray(body.files) && body.files.length) {
          // A folder chosen in the browser. Browsers never hand over an
          // absolute path, so the file contents arrive instead.
          const sources = sourcesFromFiles(body.files);
          if (!sources.all.length) {
            return json(res, 400, { error: 'That folder has no component or stylesheet files in it.' });
          }
          ({ contract: draft, report } = importFromSources({
            sources,
            cssPrefix: config.cssPrefix,
            id: body.id,
            name: body.name,
          }));
        } else if (body.path) {
          ({ contract: draft, report } = await importFromPath({
            path: resolvePath(config.root, body.path),
            cssPrefix: config.cssPrefix,
            id: body.id,
            name: body.name,
          }));
        } else {
          return json(res, 400, { error: 'Choose a component folder, or give a path.' });
        }

        const existing = await listContracts(config.contractsDir);
        let contract = draft;
        let merge = null;

        if (existing.some((c) => c.id === draft.id)) {
          if (body.mode === 'replace') {
            // Explicitly destructive — only ever on request.
          } else {
            // Default: never delete a decision that was not in the code.
            const prior = await loadContract(config.contractsDir, draft.id);
            const result = mergeDraft(prior, draft);
            contract = result.contract;
            merge = result.merge;
          }
        }

        if (body.save !== false) {
          // A replace-import is an explicit, user-chosen overwrite.
          await saveContract(config.contractsDir, contract, { force: body.mode === 'replace' });
        }

        return json(res, 200, {
          contract,
          report,
          merge,
          validation: validateContract(contract, indexFor(contract)),
          tokens: indexFor(contract).list(),
        });
      }

      if (path === '/api/contract' && req.method === 'POST') {
        const body = await readBody(req);
        const id = String(body.id || '').trim().toLowerCase();
        if (!/^[a-z][a-z0-9-]*$/.test(id)) {
          return json(res, 400, { error: 'Component id must be lowercase kebab-case, e.g. "icon-button".' });
        }
        const existing = await listContracts(config.contractsDir);
        if (existing.some((ct) => ct.id === id)) {
          return json(res, 409, { error: `A contract for "${id}" already exists.` });
        }
        const contract = blankContract(id, body.name);
        await saveContract(config.contractsDir, contract);
        return json(res, 201, { contract });
      }

      const contractMatch = path.match(/^\/api\/contract\/([a-z0-9-]+)$/);
      if (contractMatch) {
        const id = contractMatch[1];

        if (req.method === 'GET') {
          const contract = await loadContract(config.contractsDir, id);
          return json(res, 200, {
            contract,
            validation: validateContract(contract, indexFor(contract)),
            axes: axesOf(contract),
            tokens: indexFor(contract).list(),
          });
        }

        if (req.method === 'PUT') {
          const body = await readBody(req);
          const contract = normalise(body.contract);
          if (contract.id !== id) return json(res, 400, { error: 'Contract id mismatch.' });
          try {
            await saveContract(config.contractsDir, contract, { force: !!body.force });
          } catch (err) {
            // A stale tab trying to write a much emptier contract.
            return json(res, 409, { error: err.message });
          }
          return json(res, 200, {
            saved: true,
            validation: validateContract(contract, indexFor(contract)),
            axes: axesOf(contract),
          });
        }

        if (req.method === 'DELETE') {
          const keepSpecs = url.searchParams.get('keepSpecs') === '1';
          const dryRun = url.searchParams.get('dryRun') === '1';
          try {
            const result = await deleteComponent({ config, id, keepSpecs, dryRun });
            return json(res, 200, {
              ...result,
              contracts: dryRun ? undefined : await listContracts(config.contractsDir),
            });
          } catch (err) {
            return json(res, 404, { error: err.message });
          }
        }
      }

      const previewMatch = path.match(/^\/api\/preview\/([a-z0-9-]+)$/);
      if (previewMatch && req.method === 'POST') {
        const body = await readBody(req);
        const contract = normalise(body.contract);
        const idx = indexFor(contract);
        const validation = validateContract(contract, idx);
        const platforms = (contract.platforms || config.platforms).filter((p) =>
          config.platforms.includes(p)
        );
        const previews = platforms.map((platform) => {
          const { artifact, diagnostics } = resolveArtifact(contract, idx, platform);
          return {
            platform,
            artifact,
            diagnostics,
            closure: checkClosed(artifact),
            // The file this platform's spec is written to. It used to be filtered by `emit`,
            // whose entries ("json") never match the path's key ("spec"), so the list was
            // always empty and the Platform specs pane could not say where anything went.
            files: Object.values(outputPaths(config, contract, platform)).map((p) => p.replace(config.root + '/', '')),
          };
        });
        return json(res, 200, { validation, previews });
      }

      const buildMatch = path.match(/^\/api\/build\/([a-z0-9-]+)$/);
      if (buildMatch && req.method === 'POST') {
        const id = buildMatch[1];
        const body = await readBody(req);
        const contract = body.contract ? normalise(body.contract) : await loadContract(config.contractsDir, id);
        if (body.contract) await saveContract(config.contractsDir, contract);
        // `strict: false` lets a spec be generated with gaps still present.
        // The response carries what is unresolved so the caller can warn.
        const result = await buildComponent({ config, contract, strict: body.strict !== false });
        return json(res, 200, result);
      }

      if (path.startsWith('/api/')) {
        return json(res, 404, { error: `No route for ${req.method} ${path}` });
      }

      /* ------------------------- static ------------------------- */

      const rel = path === '/' ? 'index.html' : normalize(path).replace(/^([/\\])+/, '');
      const file = join(uiDir, rel);
      if (!file.startsWith(uiDir)) {
        res.writeHead(403).end('Forbidden');
        return;
      }

      const content = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(content);
    } catch (err) {
      if (err?.code === 'ENOENT') {
        if (path.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      json(res, 500, { error: err?.message || String(err) });
    }
  });

  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', ok);
  });

  // The port actually bound, so asking for port 0 (any free port) reports where it landed.
  return { server, url: `http://localhost:${server.address().port}` };
}
