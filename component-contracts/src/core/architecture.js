/*
 * The tool, described by reading itself.
 *
 * Every source file opens with a block comment saying what it is for. This
 * reads those, so the page describing the tool cannot drift from the tool:
 * a file with no description shows as undescribed rather than as prose
 * someone once wrote and nobody updated.
 *
 * The pipeline order below and the one-line note on each group are the only things
 * stated here rather than read. The pipeline mirrors the order buildComponent runs in.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

/** Directories that hold source, in the order a reader should meet them. */
const GROUPS = [
  { id: 'cli', dir: 'bin', title: 'Entry points', note: 'How the tool is invoked.' },
  {
    id: 'import',
    dir: 'src/core/import',
    title: '1. Import — read the component',
    note: 'Turns a React component into a contract. Records evidence for everything it derives, and a note for everything it cannot.',
  },
  {
    id: 'core',
    dir: 'src/core',
    title: '2–4. Contract, validate, resolve',
    note: 'The contract model, the checks over it, and the narrowing of a contract to one platform.',
  },
  {
    id: 'emit',
    dir: 'src/core/emit',
    title: '5. Emit — write the platform file',
    note: 'One file per platform, plus the human-readable spec.',
  },
  { id: 'server', dir: 'src/server', title: 'Server', note: 'Serves the reader UI and its API.' },
  {
    id: 'ui-app',
    dir: 'src/ui/js',
    title: 'Reader: app',
    note: 'The one file that touches the page (state, server calls, events, dialogs), the template tag every view is built with, and the loader for the three reference pages.',
  },
  {
    id: 'ui-lib',
    dir: 'src/ui/js/lib',
    title: 'Reader: logic',
    note: 'What the reader works out from the specs: how a value is named, the outline, the motion rows, which files of a folder count, which findings belong to which page. Pure, with no DOM, so it is tested in Node.',
  },
  {
    id: 'ui-views',
    dir: 'src/ui/js/views',
    title: 'Reader: views',
    note: 'One for each page of a component, and for the frame around it. Each is a pure function from plain data to markup, so it is tested in Node with no browser.',
  },
  { id: 'ui-pages', dir: 'src/ui/js/pages', title: 'Reader: pages', note: 'The About, Checks and Mapping pages, which read what the tool says about itself.' },
  { id: 'ui-css', dir: 'src/ui/css', title: 'Reader: styles', note: 'The whole stylesheet: theme, layout, components and the table scheme. Plain CSS, no build.' },
  {
    id: 'ui',
    dir: 'src/ui',
    title: 'Reader: pages (HTML)',
    note: 'Served exactly as they are. There is nothing to install and nothing to build: these files are the reader.',
  },
];

/** The stages a component passes through, in the order buildComponent runs. */
const PIPELINE = [
  {
    id: 'import',
    title: 'Import',
    command: 'cc import <path>',
    input: 'React component (.tsx, .css)',
    output: 'contracts/<id>.contract.json',
    does: 'Reads props from the TS interface, axes from cva() or data-* selectors, appearance and states from CSS, and the element tree from the returned JSX. A custom property the stylesheet declares is local; one it only reads is a design token.',
    refuses: 'Anything it cannot read becomes a note. It never guesses a value.',
  },
  {
    id: 'validate',
    title: 'Validate',
    command: 'cc validate',
    input: 'contract',
    output: 'notes and errors',
    does: 'Checks the contract against itself — token references resolve, curves are well formed, axes are coherent.',
    refuses: 'Notes are warnings, not failures. A contract with gaps can still be built, but the caller has to say so.',
  },
  {
    id: 'resolve',
    title: 'Resolve',
    command: '(internal, once per platform)',
    input: 'contract + token index + platform',
    output: 'artifact',
    does: 'Flattens the cascade into one fully enumerated row per variant × size × state, turns token references into platform symbols, converts curves and springs, and translates roles.',
    refuses: 'A state or mechanism with no equivalent on the platform is dropped and reported — never approximated.',
  },
  {
    id: 'closure',
    title: 'Closure check',
    command: '(internal)',
    input: 'artifact',
    output: 'closed, or a list of problems',
    does: 'Asks whether every row is internally consistent: same fields throughout, nothing null, row count equal to variants × sizes × states. Absent keys are checked first, because iterating an object can only see what is present.',
    refuses: 'It does not check against an external checklist. That would demand metrics the design never stated, forcing the tool to block on everything or invent values.',
  },
  {
    id: 'emit',
    title: 'Emit',
    command: 'cc build',
    input: 'artifact',
    output: 'ButtonSpec.swift, ButtonSpec.kt, spec.md',
    does: 'Writes one self-contained file per platform: axes, the style table, the element tree with per-node styling, motion, accessibility.',
    refuses: 'With --strict (the default) it will not write a file that failed closure.',
  },
];

/** The first block comment in a file is its description of itself. */
function headerComment(source) {
  const m = source.match(/^(?:#![^\n]*\n)?\s*\/\*\*?([\s\S]*?)\*\//);
  if (!m) return null;

  const text = m[1]
    .split('\n')
    .map((l) => l.replace(/^\s*\*ic?/, '').replace(/^\s*\*/, '').trim())
    .join('\n')
    .trim();
  if (!text) return null;

  const paragraphs = text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim());
  return { summary: paragraphs[0], detail: paragraphs.slice(1) };
}

async function filesIn(root, dir) {
  const full = join(root, dir);
  let entries;
  try {
    entries = await readdir(full, { withFileTypes: true });
  } catch {
    return [];
  }

  const out = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!/\.(js|html|css|json)$/.test(e.name)) continue;

    const path = join(full, e.name);
    const [source, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    const header = /\.(js|css)$/.test(e.name) ? headerComment(source) : null;

    out.push({
      name: e.name,
      path: relative(root, path),
      lines: source.split('\n').length,
      bytes: info.size,
      summary: header?.summary || null,
      detail: header?.detail || [],
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function architecture(root) {
  const groups = [];
  for (const g of GROUPS) {
    const files = (await filesIn(root, g.dir)).filter(
      // src/core is listed by GROUPS entries of its own subdirectories.
      (f) => !(g.dir === 'src/core' && /^src\/core\/(import|emit)\//.test(f.path)),
    );
    if (files.length) groups.push({ ...g, files });
  }

  const totals = groups.reduce(
    (a, g) => ({
      files: a.files + g.files.length,
      lines: a.lines + g.files.reduce((n, f) => n + f.lines, 0),
      undescribed: a.undescribed + g.files.filter((f) => !f.summary && /\.(js|css)$/.test(f.name)).length,
    }),
    { files: 0, lines: 0, undescribed: 0 },
  );

  return { pipeline: PIPELINE, groups, totals };
}
