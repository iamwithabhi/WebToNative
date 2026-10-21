#!/usr/bin/env node
/**
 * component-contracts CLI.
 *
 * A thin facade over src/core. Everything here is argument parsing, file
 * paths, and terminal formatting — all logic lives in the core library so the
 * UI and CI share exactly one code path.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';

import { loadConfig, tokenIndexFor, buildAll, deleteComponent } from '../src/core/build.js';
import { listContracts, loadContract, saveContract } from '../src/core/contract.js';
import { validateContract } from '../src/core/validate.js';
import { importFromPath, mergeDraft } from '../src/core/import/index.js';
import { startServer } from '../src/server/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------- terminal helpers ---------------- */

const tty = process.stdout.isTTY;
const c = (code) => (s) => (tty ? `\u001b[${code}m${s}\u001b[0m` : String(s));
const dim = c('2');
const bold = c('1');
const red = c('31');
const yellow = c('33');
const green = c('32');
const blue = c('34');
const cyan = c('36');

const SEV = {
  error: (s) => red('✗ ' + s),
  warning: (s) => yellow('! ' + s),
  info: (s) => dim('· ' + s),
};

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=');
      flags[k] = v === undefined ? true : v;
    } else positional.push(arg);
  }
  return { flags, positional };
}

function printFindings(validation, { showInfo = false } = {}) {
  const items = validation.findings.filter((f) => showInfo || f.severity !== 'info');
  for (const f of items) {
    const fmt = SEV[f.severity] || SEV.info;
    console.log(`  ${fmt(f.message)} ${dim(f.path)}`);
  }
  if (validation.questions.length) {
    console.log('');
    console.log(bold('  Open design questions'));
    console.log(dim('  Answer these with the designer and the iOS/Android leads present.'));
    console.log('');
    validation.questions.forEach((q, i) => {
      console.log(`  ${dim(String(i + 1).padStart(2))}. ${q}`);
    });
  }
}

function summaryLine(v) {
  const parts = [];
  if (v.counts.error) parts.push(red(`${v.counts.error} error${v.counts.error > 1 ? 's' : ''}`));
  if (v.counts.warning) parts.push(yellow(`${v.counts.warning} warning${v.counts.warning > 1 ? 's' : ''}`));
  if (!parts.length) parts.push(green('clean'));
  return parts.join(dim(' · '));
}

/* ---------------- commands ---------------- */

async function cmdList() {
  const config = await loadConfig(ROOT);
  const contracts = await listContracts(config.contractsDir);
  if (!contracts.length) {
    console.log(dim('No contracts yet. Run `cc open` to create one.'));
    return 0;
  }
  console.log('');
  for (const ct of contracts) {
    console.log(
      `  ${bold(ct.name.padEnd(18))} ${dim(ct.id.padEnd(14))} ` +
        `${dim('v' + ct.contractVersion)}  ${dim(`${ct.variants} variants · ${ct.states} states`)}`
    );
  }
  console.log('');
  return 0;
}

async function cmdValidate(ids) {
  const config = await loadConfig(ROOT);
  const all = await listContracts(config.contractsDir);
  const targets = ids.length ? all.filter((ct) => ids.includes(ct.id)) : all;

  if (!targets.length) {
    console.log(red('No matching contracts.'));
    return 1;
  }

  let failed = 0;

  for (const meta of targets) {
    const contract = await loadContract(config.contractsDir, meta.id);
    const tokens = tokenIndexFor(contract, config);
    const v = validateContract(contract, tokens);
    console.log('');
    console.log(
      `${bold(contract.name)} ${dim(`v${contract.contractVersion}`)}  ${summaryLine(v)} ` +
        dim(`· ${tokens.size} tokens`)
    );
    if (v.findings.some((f) => f.severity !== 'info')) printFindings(v);
    if (!v.ok) failed++;
  }

  console.log('');
  return failed ? 1 : 0;
}

async function cmdBuild(ids, flags) {
  const config = await loadConfig(ROOT);
  const strict = flags.strict !== 'false' && flags['no-strict'] !== true;
  const dryRun = !!flags['dry-run'];

  if (dryRun) {
    console.log('');
    console.log(dim('Dry run'));
  }

  const { builds } = await buildAll({ config, strict, dryRun, ids: ids.length ? ids : null });

  let failed = 0;
  for (const b of builds) {
    console.log('');
    if (b.error) {
      console.log(`${bold(b.component)}  ${red(b.error)}`);
      failed++;
      continue;
    }

    console.log(`${bold(b.component)} ${dim(`v${b.contractVersion}`)}  ${summaryLine(b.validation)}`);

    for (const r of b.results) {
      if (r.skipped) {
        console.log(`  ${red('✗')} ${r.platform.padEnd(8)} ${red('artifact is not closed')}`);
        for (const p of r.closure.problems.slice(0, 8)) console.log(`      ${dim(p)}`);
        if (r.closure.problems.length > 8) {
          console.log(`      ${dim(`… and ${r.closure.problems.length - 8} more`)}`);
        }
        continue;
      }
      const mark = r.incomplete ? yellow('!') : green('✓');
      console.log(
        `  ${mark} ${r.platform.padEnd(8)} ${dim(`${r.artifact.styles.length} style rows`)}` +
          (r.incomplete ? yellow(`  ${r.closure.problems.length} unresolved`) : '')
      );
      for (const f of r.files) console.log(`      ${cyan(f)}`);
      for (const d of r.diagnostics.filter((x) => x.level !== 'info')) {
        console.log(`      ${SEV[d.level] ? SEV[d.level](d.message) : d.message}`);
      }
    }

    if (b.docs) console.log(`  ${green('✓')} ${'docs'.padEnd(8)} ${cyan(b.docs)}`);

    if (b.validation.questions.length) {
      console.log('');
      console.log(
        `  ${yellow(`${b.validation.questions.length} note(s)`)} ` +
          dim('— things the component does not state. Run `cc validate` to list them.')
      );
    }

    if (!b.ok) failed++;
  }

  console.log('');
  const partial = builds.filter((b) => b.incomplete).length;
  if (failed) {
    console.log(red(`${failed} component(s) failed.`));
    console.log(dim('Pass --no-strict to write the specs anyway, with the gaps left in.'));
  } else if (partial) {
    console.log(yellow(`Written with gaps — ${partial} component(s) are incomplete.`));
    console.log(dim('Unresolved values reach the platform as nulls. Fix them in the component before shipping.'));
  } else {
    console.log(green('All components built and closed.'));
  }
  console.log('');
  return failed ? 1 : 0;
}

async function cmdImport(args, flags) {
  const [path] = args;
  if (!path) {
    console.log(red('Usage: cc import <path-to-component> [--id=button] [--name="Button"]'));
    return 1;
  }

  const config = await loadConfig(ROOT);

  const { contract, report } = await importFromPath({
    path,
    cssPrefix: config.cssPrefix,
    id: flags.id,
    name: flags.name,
  });

  console.log('');
  console.log(`${bold('Imported')} ${cyan(path)}`);
  console.log(dim(`  ${report.sources.join(', ')}`));
  console.log('');
  console.log(
    `  ${green(report.coverage.derived + ' values read from code')}` +
      dim(` · ${report.coverage.tokens} tokens (${report.coverage.tokenValues} with known values)`) +
      (report.coverage.skipped ? dim(` · ${report.coverage.skipped} hardcoded`) : '')
  );

  if (flags.verbose) {
    console.log('');
    for (const d of report.derived) {
      console.log(`    ${green('✓')} ${d.path.padEnd(42)} ${dim(d.evidence)}`);
    }
    for (const s of report.skipped) {
      console.log(`    ${yellow('?')} ${s.what.padEnd(42)} ${dim(s.why)}`);
    }
  } else if (report.skipped.length) {
    console.log(dim('  Run with --verbose to see exactly what was and was not derived.'));
  }

  if (report.notes.length) {
    console.log('');
    console.log(bold('  Notes'));
    for (const n of report.notes) console.log(`    ${dim('·')} ${n}`);
  }

  const tokens = tokenIndexFor(contract, config);
  const validation = validateContract(contract, tokens);
  console.log('');
  console.log(`  ${bold('Draft contract')}  ${summaryLine(validation)}`);

  if (validation.questions.length) {
    console.log('');
    console.log(bold(`  ${validation.questions.length} open design question(s)`));
    console.log(dim('  These could not be read from the code. They are real decisions —'));
    console.log(dim('  answer them with the designer and the iOS/Android leads present.'));
    console.log('');
    validation.questions.forEach((q, i) => {
      console.log(`  ${dim(String(i + 1).padStart(2))}. ${q}`);
    });
  }

  if (flags['dry-run']) {
    console.log('');
    console.log(dim('  Dry run — nothing written.'));
    console.log('');
    return 0;
  }

  const existing = await listContracts(config.contractsDir);
  let final = contract;

  if (existing.some((c) => c.id === contract.id)) {
    if (flags.replace) {
      console.log('');
      console.log(yellow('  Replacing the existing contract — any hand-answered fields are lost.'));
    } else {
      // Merging is the default: re-importing must not delete decisions that
      // were never in the code to begin with.
      const prior = await loadContract(config.contractsDir, contract.id);
      const { contract: mergedContract, merge } = mergeDraft(prior, contract);
      final = mergedContract;

      console.log('');
      console.log(bold('  Merged with the existing contract'));
      console.log(
        `    ${green(merge.preserved.length + ' preserved')}` +
          dim(' · ') +
          `${cyan(merge.updated.length + ' updated from code')}` +
          (merge.dropped.length ? dim(' · ') + red(merge.dropped.length + ' dropped') : '')
      );

      const show = (label, items, colour) => {
        if (!items.length) return;
        console.log('');
        console.log(`    ${bold(label)}`);
        for (const i of items.slice(0, flags.verbose ? 200 : 6)) console.log(`      ${colour(i)}`);
        if (!flags.verbose && items.length > 6) {
          console.log(dim(`      … and ${items.length - 6} more (--verbose)`));
        }
      };
      show('Updated from code', merge.updated, cyan);
      show('Dropped (no longer in code)', merge.dropped, red);
      if (flags.verbose) show('Preserved (your answers)', merge.preserved, green);

      const after = validateContract(final, tokenIndexFor(final, config));
      console.log('');
      console.log(`  ${bold('After merge')}  ${summaryLine(after)} ${dim(`· ${after.questions.length} question(s) remain`)}`);
    }
  }

  const written = await saveContract(config.contractsDir, final);
  console.log('');
  console.log(`  ${green('✓')} ${cyan(written.replace(config.root + '/', ''))}`);
  console.log('');
  console.log(dim(`  Next: cc open  — fill in the open questions, then generate.`));
  console.log('');
  return 0;
}

async function confirm(question) {
  if (!process.stdin.isTTY) return false;
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function cmdDelete(ids, flags) {
  if (!ids.length) {
    console.log(red('Usage: cc delete <id...> [--keep-artifacts] [--yes]'));
    return 1;
  }

  const config = await loadConfig(ROOT);
  const existing = await listContracts(config.contractsDir);
  const keepSpecs = !!(flags['keep-specs'] || flags['keep-artifacts']);

  const missing = ids.filter((id) => !existing.some((c) => c.id === id));
  if (missing.length) {
    console.log('');
    console.log(red(`  Unknown contract: ${missing.join(', ')}`));
    console.log(dim(`  Known: ${existing.map((c) => c.id).join(', ') || 'none'}`));
    console.log('');
    return 1;
  }

  // Always show exactly what is about to go before anything is removed.
  console.log('');
  const plans = [];
  for (const id of ids) {
    const plan = await deleteComponent({ config, id, keepSpecs, dryRun: true });
    plans.push(plan);
    console.log(`  ${bold(id)} ${dim(`— ${plan.removed.length} file(s)`)}`);
    for (const file of plan.removed) {
      console.log(`      ${file.endsWith('.contract.json') ? yellow(file) : dim(file)}`);
    }
  }

  const total = plans.reduce((n, p) => n + p.removed.length, 0);

  if (flags['dry-run']) {
    console.log('');
    console.log(dim('  Dry run — nothing removed.'));
    console.log('');
    return 0;
  }

  if (!flags.yes) {
    console.log('');
    const ok = await confirm(`  Delete ${total} file(s)? This cannot be undone. [y/N] `);
    if (!ok) {
      console.log('');
      console.log(dim(process.stdin.isTTY ? '  Cancelled.' : '  Not a TTY — pass --yes to confirm.'));
      console.log('');
      return 1;
    }
  }

  for (const id of ids) {
    await deleteComponent({ config, id, keepSpecs });
  }

  console.log('');
  console.log(`  ${green('✓')} Deleted ${ids.length} contract(s) and ${total - ids.length} spec file(s)`);
  if (keepSpecs) {
    console.log(
      yellow('  Platform specs were kept.') +
        dim(' They now reference a contract that no longer exists.')
    );
  }
  console.log('');
  return 0;
}

async function cmdOpen(flags) {
  const config = await loadConfig(ROOT);
  const port = Number(flags.port || 4321);
  const { url } = await startServer({ config, root: ROOT, port });

  console.log('');
  console.log(`  ${bold('component-contracts')}`);
  console.log(`  ${dim('Author a contract, generate platform files.')}`);
  console.log('');
  console.log(`  ${green('▸')} ${blue(url)}`);
  console.log('');
  console.log(dim('  Ctrl-C to stop.'));
  console.log('');

  if (!flags['no-open']) {
    const { spawn } = await import('node:child_process');
    const opener =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    try {
      spawn(opener, [url], { stdio: 'ignore', detached: true }).unref();
    } catch {
      /* no browser available — the URL is printed above */
    }
  }
  return new Promise(() => {}); // run until interrupted
}

function usage() {
  console.log(`
  ${bold('component-contracts')} ${dim('— platform-neutral component contracts')}

  ${bold('cc open')}                  Open the authoring UI ${dim('(default)')}
  ${bold('cc list')}                  List contracts
  ${bold('cc import')} <path>         Draft a contract from existing component code
  ${bold('cc validate')} [id...]      Check contracts, list open design questions
  ${bold('cc build')} [id...]         Resolve and write platform specs
  ${bold('cc delete')} <id...>        Remove a contract and its platform specs

  ${dim('Flags')}
    --port=4321             Port for ${bold('open')}
    --no-open               Do not launch a browser
    --id=button             Component id for ${bold('import')}
    --name="Button"         Display name for ${bold('import')}
    --verbose               Show every derived and skipped field on ${bold('import')}
    --replace               Discard hand-answered fields on re-${bold('import')}
                            ${dim('(default is a reviewable merge)')}
    --keep-specs            Leave platform specs behind on ${bold('delete')}
    --yes                   Skip the confirmation prompt on ${bold('delete')}
    --dry-run               Compute everything, write nothing
    --no-strict             Emit even when an artifact is not closed ${dim('(not for CI)')}
`);
}

/* ---------------- entry ---------------- */

const { flags, positional } = parseArgs(process.argv.slice(2));
const [command = 'open', ...rest] = positional;

const commands = {
  open: () => cmdOpen(flags),
  list: () => cmdList(),
  import: () => cmdImport(rest, flags),
  validate: () => cmdValidate(rest),
  delete: () => cmdDelete(rest, flags),
  rm: () => cmdDelete(rest, flags),
  build: () => cmdBuild(rest, flags),
  help: () => (usage(), 0),
};

const run = commands[command];
if (!run) {
  console.log(red(`Unknown command "${command}"`));
  usage();
  process.exit(1);
}

try {
  process.exit((await run()) ?? 0);
} catch (err) {
  console.error('');
  console.error(red('  ' + (err?.message || String(err))));
  if (flags.debug) console.error(err);
  console.error('');
  process.exit(1);
}
