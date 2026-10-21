/**
 * The data the reader's tests run on: Counter, as the server hands it to the browser.
 *
 * It is built the way the server's routes build it (the contract, its validation and token list, and
 * one preview per platform), from the Counter fixture rather than from anyone's workspace. Nothing is
 * committed: it is rebuilt each time, so it can never go stale when the tool's output changes.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { importFromPath } from '../../src/core/import/index.js';
import { loadConfig, tokenIndexFor, outputPaths } from '../../src/core/build.js';
import { validateContract } from '../../src/core/validate.js';
import { resolve as resolveArtifact, checkClosed } from '../../src/core/resolve.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** Counter, exactly as the browser would receive it. JSON-round-tripped so it is plain data, as it is over the wire. */
export async function counterData() {
  const config = await loadConfig(ROOT);
  const { contract } = await importFromPath({ path: join(ROOT, 'test/fixtures/Counter'), id: 'counter' });
  const idx = tokenIndexFor(contract, config);

  const previews = config.platforms.map((platform) => {
    const { artifact, diagnostics } = resolveArtifact(contract, idx, platform);
    return {
      platform,
      artifact,
      diagnostics,
      closure: checkClosed(artifact),
      files: Object.values(outputPaths(config, contract, platform)).map((p) => p.replace(config.root + '/', '')),
    };
  });

  const data = JSON.parse(
    JSON.stringify({
      config: { platforms: config.platforms, vocab: { requiredSizeKeys: ['padX', 'padY', 'radius', 'fontSize'] } },
      contract,
      validation: validateContract(contract, idx),
      tokens: idx.list(),
      previews,
    }),
  );
  return { ...data, tokenMap: new Map(data.tokens.map((t) => [t.name, t.value])) };
}

/** The text a person reads in some markup: tags removed (no space added where one was not), entities decoded, whitespace collapsed. */
export const text = (markup) =>
  String(markup)
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** The chips in some markup, as their texts. */
export const chipsIn = (markup) =>
  [...String(markup).matchAll(/<span class="badge chip">([^<]*)<\/span>/g)].map((m) => text(m[1]));

/** How many times a pattern occurs in some markup. */
export const count = (markup, re) => (String(markup).match(re) || []).length;
