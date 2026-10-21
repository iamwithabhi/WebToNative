/**
 * The reader, driven in a real browser the way a person uses it: open a component, edit and save, look at
 * every page, generate the specs, switch theme, add a component by path and by folder, and delete one.
 *
 * Node tests check what each view draws; this checks what the buttons do. It builds its own throwaway
 * project in a temporary folder (the tool and the Counter fixture, with empty contracts/ and platform-specs/),
 * starts the server there on a free port, and removes it all afterwards: it touches none of your files.
 *
 * It needs two things that are not dependencies of this project, so it is not part of `npm test`:
 *   playwright-core   install it anywhere and point PLAYWRIGHT_DIR at that folder (default: the current directory)
 *   Chrome            CHROME_PATH (default: the usual macOS location)
 *
 *   PLAYWRIGHT_DIR=/tmp/shot node scripts/e2e.mjs
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let chromium;
try {
  ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR ?? process.cwd(), 'x.js'))('playwright-core'));
} catch {
  console.error('playwright-core was not found. Install it somewhere and set PLAYWRIGHT_DIR to that folder.');
  process.exit(2);
}
if (!existsSync(CHROME)) { console.error(`Chrome was not found at ${CHROME}. Set CHROME_PATH.`); process.exit(2); }

/* ---------------- a throwaway project and a server for it ---------------- */

const freePort = () => new Promise((resolve) => { const s = createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

const COPY = await mkdtemp(join(tmpdir(), 'cc-e2e-'));
for (const item of ['bin', 'src', 'package.json', 'ds.config.json']) await cp(join(ROOT, item), join(COPY, item), { recursive: true });
await mkdir(join(COPY, 'test/fixtures'), { recursive: true });
await cp(join(ROOT, 'test/fixtures/Counter'), join(COPY, 'test/fixtures/Counter'), { recursive: true });
await mkdir(join(COPY, 'contracts'));
await mkdir(join(COPY, 'platform-specs'));
const COUNTER = join(COPY, 'test/fixtures/Counter');

const PORT = await freePort();
const UI = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['bin/cc.js', 'open', '--no-open', `--port=${PORT}`], { cwd: COPY, stdio: 'ignore' });
const stop = async () => { server.kill(); await rm(COPY, { recursive: true, force: true }); };
for (let i = 0; i < 50; i++) { if (await fetch(UI).then((r) => r.ok, () => false)) break; await new Promise((r) => setTimeout(r, 100)); }

const api = async (p, init) => (await fetch(UI + p, init)).json();
const seeded = await api('/api/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: COUNTER, id: 'counter' }) });
if (!seeded.contract) { console.error('could not seed Counter:', JSON.stringify(seeded).slice(0, 200)); await stop(); process.exit(2); }

/* ---------------- the browser ---------------- */

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 150)}`));
page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(`console: ${m.text().slice(0, 150)}`));

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => { cond ? pass++ : fail++; console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}${!cond && detail ? `  -> ${detail}` : ''}`); };
const toast = (re) => page.locator('.toast').filter({ hasText: re }).first().waitFor({ timeout: 8000 }).then(() => true, () => false);
const tab = (name) => page.getByRole('tab', { name: new RegExp(`^${name.replace(/&/g, '\\$&')}`) });

try {
  console.log('# load');
  await page.goto(`${UI}/`, { waitUntil: 'load' });
  await page.getByRole('button', { name: /Counter/ }).first().waitFor({ timeout: 8000 });
  ok('rail lists Counter', (await page.getByRole('button', { name: /Counter/ }).count()) >= 1);
  ok('title shows the component', (await page.locator('h1').innerText()).trim() === 'Counter');
  ok('eight pages, as chips', (await page.getByRole('tab').count()) === 8);
  ok('dark by default', await page.evaluate(() => document.documentElement.classList.contains('dark')));

  console.log('# edit and save (Overview)');
  const rail = page.getByRole('complementary', { name: 'Components' });
  const saveButtons = () => page.getByRole('button', { name: 'Save', exact: true });
  ok('no Save button before an edit', (await saveButtons().count()) === 0);
  await page.getByLabel('Name').fill('Counter X');
  await saveButtons().first().waitFor({ timeout: 3000 }).catch(() => {});
  ok('Save appears after an edit', (await saveButtons().count()) === 1);
  ok("and it is in the rail, in the component's own list item", (await rail.getByRole('button', { name: 'Save', exact: true }).count()) === 1);
  const geo = await page.evaluate(() => {
    const save = [...document.querySelectorAll('aside[aria-label="Components"] button')].find((b) => b.textContent.trim() === 'Save');
    const item = save.parentElement;
    const a = save.getBoundingClientRect(); const b = item.getBoundingClientRect();
    return { inside: a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom, nested: !!item.querySelector('button[aria-current]').querySelector('button') };
  });
  ok("Save sits inside the item's box and is not nested in the opener", geo.inside && !geo.nested, JSON.stringify(geo));
  await saveButtons().click();
  ok('toast says Saved', await toast(/Saved/));
  ok('it reached disk', (await api('/api/contract/counter')).contract.name === 'Counter X');
  await page.waitForTimeout(400);
  ok('Save goes away again after saving', (await saveButtons().count()) === 0);
  await page.reload({ waitUntil: 'load' });
  await page.getByLabel('Name').waitFor();
  ok('it survives a reload', (await page.getByLabel('Name').inputValue()) === 'Counter X');

  console.log('# every page opens without error');
  for (const t of ['Props', 'Appearance', 'Events', 'Motion & interaction', 'Accessibility', 'Left to platform', 'Platform specs', 'Overview']) {
    await tab(t).click();
    await page.waitForTimeout(250);
  }
  ok('no script errors so far', errors.length === 0, errors.join(' | '));
  await tab('Overview').focus();
  await page.keyboard.press('ArrowRight');
  ok('the arrow key moves to the next page', (await page.locator('[role=tab][aria-selected=true]').innerText()).startsWith('Props'));
  await page.keyboard.press('End');
  ok('End goes to the last', (await page.locator('[role=tab][aria-selected=true]').innerText()).startsWith('Platform specs'));
  await tab('Overview').click();

  console.log('# appearance outline');
  await tab('Appearance').click();
  await page.waitForTimeout(500);
  ok('outline draws nodes', (await page.locator('[data-node]').count()) >= 6);
  ok('legend present', (await page.locator('.ol-key').count()) === 5);
  ok('a variant card for full width', (await page.getByText('data-full-width = true').count()) > 0);

  console.log('# motion: quoted source opens on demand');
  await tab('Motion').click();
  await page.waitForTimeout(500);
  ok('motion rows', (await page.getByRole('row').count()) > 6);
  ok('no source visible at first', (await page.locator('pre:visible').count()) === 0);
  await page.locator('summary', { hasText: 'useEffect#2' }).click();
  ok('opening a handler shows its source', /addEventListener/.test(await page.locator('pre:visible').first().innerText()));
  await page.locator('summary', { hasText: 'useEffect#2' }).click();
  ok('and closes it again', (await page.locator('pre:visible').count()) === 0);

  console.log('# generate');
  await page.getByRole('button', { name: /Generate/ }).click();
  ok('toast says files were written', await toast(/files written/));
  ok('lands on Platform specs', (await page.locator('[role=tab][aria-selected=true]').innerText()).startsWith('Platform specs'));
  ok('platform files exist on disk', existsSync(join(COPY, 'platform-specs/counter/ios.json')) && existsSync(join(COPY, 'platform-specs/counter/android.json')));
  ok('each platform says complete', (await page.getByText('complete', { exact: true }).count()) >= 2);

  console.log('# theme');
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  ok('switches to light', await page.evaluate(() => !document.documentElement.classList.contains('dark')));
  ok('and remembers it', (await page.evaluate(() => localStorage.getItem('cc-theme'))) === 'light');
  await page.reload({ waitUntil: 'load' });
  ok('and keeps it across a reload, before the page paints', await page.evaluate(() => !document.documentElement.classList.contains('dark')));
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  ok('and back to dark', await page.evaluate(() => document.documentElement.classList.contains('dark')));

  console.log('# delete (bottom of the Overview)');
  await tab('Overview').click();
  ok('Delete is not in the rail', (await rail.getByRole('button', { name: 'Delete' }).count()) === 0);
  const below = await page.evaluate(() => {
    const del = [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Delete');
    const cards = [...document.querySelectorAll('main .card')];
    return del.getBoundingClientRect().top > cards[cards.length - 1].getBoundingClientRect().bottom;
  });
  ok('Delete sits below the last card on the Overview', below);
  await tab('Props').click();
  ok('and is not on another page', (await page.getByRole('button', { name: 'Delete', exact: true }).count()) === 0);
  await tab('Overview').click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const dlg = page.getByRole('alertdialog');
  await dlg.waitFor();
  ok('asks first, naming the component', /Delete Counter X\?/.test(await dlg.innerText()));
  await dlg.getByText('counter.contract.json').first().waitFor({ timeout: 5000 }).catch(() => {});
  ok('lists the files that will go', /counter\.contract\.json/.test(await dlg.innerText()) && /ios\.json/.test(await dlg.innerText()));
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  ok('Cancel deletes nothing', existsSync(join(COPY, 'contracts/counter.contract.json')));
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('alertdialog').waitFor();
  await page.getByLabel('Keep platform specs').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  ok('toast says deleted', await toast(/Deleted counter/));
  ok('contract is gone', !existsSync(join(COPY, 'contracts/counter.contract.json')));
  ok('kept specs survive when asked', existsSync(join(COPY, 'platform-specs/counter/ios.json')));
  ok('empty state invites adding one', await page.getByText('Point it at a component').isVisible());

  console.log('# add by path');
  await page.getByRole('button', { name: 'Add component' }).first().click();
  const add = page.getByRole('dialog');
  await add.waitFor();
  ok('Add is disabled with nothing chosen', await add.getByRole('button', { name: 'Add component' }).isDisabled());
  await add.getByText('Or enter a path on disk').click();
  await add.getByLabel('Path on disk').fill(COUNTER);
  ok('Add enables once a path is typed', await add.getByRole('button', { name: 'Add component' }).isEnabled());
  await add.getByRole('button', { name: 'Add component' }).click();
  ok('toast says values were read', await toast(/values read/));
  ok('contract written to disk', existsSync(join(COPY, 'contracts/counter.contract.json')));
  ok('rail shows it', (await page.getByRole('button', { name: /Counter/ }).count()) >= 1);
  await tab('Import report').waitFor({ timeout: 5000 }).catch(() => {});
  ok('an Import report page appears', (await tab('Import report').count()) === 1);
  await tab('Import report').click();
  ok('and shows what was read', await page.getByText(/values read/).first().isVisible());

  console.log('# add by choosing a folder');
  await page.getByRole('button', { name: 'Add component' }).first().click();
  const add2 = page.getByRole('dialog');
  await add2.waitFor();
  await add2.locator('input[type=file]').setInputFiles(COUNTER);
  await page.waitForTimeout(800);
  const text = await add2.innerText();
  ok('shows the chosen folder', /Counter/.test(text));
  ok('lists code and css files, not tests or stories', /Counter\.tsx/.test(text) && /counter\.css/.test(text) && !/\.test\./.test(text) && !/\.stories\./.test(text), text.slice(0, 200));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('Escape closes the dialog', (await page.getByRole('dialog').count()) === 0);

  console.log('# the reference pages');
  for (const [path, heading] of [['about', 'How this tool works'], ['checks', 'What gets checked'], ['mapping', 'Platform mapping']]) {
    await page.goto(`${UI}/${path}.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    ok(`${path} loads with its tables`, (await page.locator('h1').innerText()).trim() === heading && (await page.locator('table').count()) > 0);
  }
  await page.goto(`${UI}/mapping.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(300);
  ok("Mapping's table header stays pinned while the table scrolls", await page.evaluate(() => { const th = document.querySelector('.tbl th.pin'); return th && Math.abs(th.getBoundingClientRect().top - 54) < 3; }));

  console.log(`\nscript errors: ${errors.length ? errors.join(' | ') : 'none'}`);
} finally {
  await browser.close();
  await stop();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail || errors.length ? 1 : 0);
