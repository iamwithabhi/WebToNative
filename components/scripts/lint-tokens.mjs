/**
 * Enforces the token contract:
 *   1. Component source may only reference Semantic/Component-tier variables.
 *      Referencing a --base-* variable is an error.
 *   2. No hardcoded colour literals (hex / rgb() / hsl()) in component CSS.
 *
 * Generated token files and the icon set are exempt — base.css *defines* the
 * primitives, and icons use `currentColor`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '../src');
const EXEMPT = [join(SRC, 'tokens'), join(SRC, 'icons/generated')];

const RULES = [
  { id: 'no-base-token', re: /var\(\s*(--base-[a-z0-9-]+)/gi, msg: (m) => `references base token ${m[1]}` },
  { id: 'no-hex', re: /#[0-9a-f]{3,8}\b/gi, msg: (m) => `hardcoded colour ${m[0]}` },
  { id: 'no-rgb', re: /\b(?:rgba?|hsla?)\(/gi, msg: (m) => `hardcoded colour function ${m[0]}` },
];

function files(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (EXEMPT.some((e) => p.startsWith(e))) continue;
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(css|tsx?)$/.test(entry)) out.push(p);
  }
  return out;
}

const violations = [];

for (const file of files(SRC)) {
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');

  for (const rule of RULES) {
    for (const [i, line] of lines.entries()) {
      if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue;
      for (const m of line.matchAll(rule.re)) {
        violations.push(`${relative(SRC, file)}:${i + 1}  [${rule.id}] ${rule.msg(m)}`);
      }
    }
  }
}

if (violations.length) {
  console.error(`Token contract violations (${violations.length}):\n`);
  for (const v of violations) console.error(`  ${v}`);
  console.error('\nComponents must consume Semantic or Component tier tokens only.');
  process.exit(1);
}

console.log('lint:tokens  ok — no base-tier or hardcoded colour references in component source');
