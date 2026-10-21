/**
 * Choosing a component folder: which of its files are read, and the limits.
 *
 * Only code and stylesheets are sent, tests, stories and tooling are skipped, and a
 * folder that is too large is refused rather than truncated silently. The browser
 * hands over the files; this decides which of them count.
 *
 * Pure: it takes entries that look like {relPath, file: {size, text()}} so it is tested in Node.
 */

export const CODE_RE = /\.(tsx|jsx|mts|cts|ts|js|mjs)$/i;
export const STYLE_RE = /\.(css|scss|sass|less)$/i;
export const SKIP_RE = /(^|\/)(node_modules|\.git|dist|build|coverage|__snapshots__)(\/|$)|\.(test|spec|stories)\.|(^|\/)\./;
export const MAX_FILES = 40;
export const MAX_BYTES = 2 * 1024 * 1024;

export const usable = (rel) => !SKIP_RE.test(rel) && (CODE_RE.test(rel) || STYLE_RE.test(rel));

/** The files that count, as `{ ok: true, folder, files }`, or `{ ok: false, error }` and why. */
export async function collect(entries) {
  const keep = entries.filter((e) => usable(e.relPath)).slice(0, MAX_FILES);
  if (!keep.length) return { ok: false, error: 'No component or stylesheet files in that folder' };
  const files = [];
  let bytes = 0;
  for (const { relPath, file } of keep) {
    bytes += file.size;
    if (bytes > MAX_BYTES) return { ok: false, error: 'That folder is too large \u2014 point at the component itself' };
    files.push({ name: relPath, content: await file.text() });
  }
  const folder = entries[0].relPath.includes('/') ? entries[0].relPath.split('/')[0] : 'component';
  return { ok: true, folder, files };
}

/** The id a folder would get: `IconButton` -> `icon-button`. */
export const idFromFolder = (folder) =>
  folder.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
