/**
 * The frame around a component and the pages beside it: the rail, the status column, the header, the page
 * chips, the dialogs, the rules of the state, and the About, Checks and Mapping pages.
 *
 * Like the panes, each is a pure function that returns markup, so it runs in Node. The structure that a
 * person's experience depends on is asserted directly: Save is a sibling of the opener and not inside it,
 * the pages are a real tab list, the badge is in the status card. What it looks like was measured in a
 * browser; what the buttons do is exercised by scripts/e2e.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { counterData, text, count } from './helpers/ui-data.js';
import { chipsView, emptyView, fatalView, headerView, inspectorView, railView } from '../src/ui/js/views/chrome.js';
import { addDialogView, deleteDialogView } from '../src/ui/js/views/dialogs.js';
import { paneView } from '../src/ui/js/views/pane.js';
import { PANE_GAPS, TABS, TAB_CODES, gapsFor, tabErrors, tabsFor } from '../src/ui/js/lib/state.js';
import { view as aboutView } from '../src/ui/js/pages/about.js';
import { view as checksView } from '../src/ui/js/pages/checks.js';
import { view as mappingView, nav as mappingNav } from '../src/ui/js/pages/mapping.js';

const D = await counterData();
const { contract, previews, validation, tokens, tokenMap, config } = D;
const one = [{ id: 'counter', name: 'Counter', variants: 0, states: 3 }];
const two = [...one, { id: 'button', name: 'Button', variants: 4, states: 6 }];

/** The list item of a component in the rail: from its opening tag to the next item (or the footer). */
const itemOf = (markup, id) => {
  const s = String(markup);
  const start = s.indexOf(`data-id="${id}"`);
  const open = s.lastIndexOf('<div class="rail-item', start);
  const next = s.indexOf('<div class="rail-item', start);
  const end = next > 0 ? next : s.indexOf('<div class="rail-foot">', start);
  return s.slice(open, end);
};

/* ------------------------------------------------------------------ *
 * the rail
 * ------------------------------------------------------------------ */

test('Rail: the product is a logo, with its tagline directly beneath, and nothing of the old name or a platform list', () => {
  const r = String(railView({ contracts: one, id: 'counter', dirty: false }));
  assert.match(r, /<div class="logo">ToNative<\/div>\s*<div class="tagline">Web to Native<\/div>/);
  assert.ok(!/Component Contracts/i.test(r));
  assert.ok(!r.includes('iOS \u00b7 Android'), 'the platforms are in the status column, not here');
});

test('Rail: lists the components, marks the open one, and names each opener by the component alone', () => {
  const r = String(railView({ contracts: two, id: 'counter', dirty: false }));
  assert.equal(count(r, /data-action="open"/g), 2);
  assert.match(itemOf(r, 'counter'), /aria-current="true"/);
  assert.ok(!/aria-current/.test(itemOf(r, 'button')), 'only the open one is current');
  assert.equal(text(itemOf(r, 'button')), 'Button4 variants \u00b7 6 states');
});

test('Rail: there is no Save until something changes, then one, in the open component’s own list item and nowhere else', () => {
  assert.ok(!String(railView({ contracts: two, id: 'counter', dirty: false })).includes('data-action="save"'));
  const dirty = String(railView({ contracts: two, id: 'counter', dirty: true }));
  assert.equal(count(dirty, /data-action="save"/g), 1);
  assert.ok(itemOf(dirty, 'counter').includes('data-action="save"'));
  assert.ok(!itemOf(dirty, 'button').includes('data-action="save"'), 'not on a component that is not open');
});

test('Rail: Save is the opener’s sibling, never inside it, because a button cannot hold a button', () => {
  const item = itemOf(railView({ contracts: one, id: 'counter', dirty: true }), 'counter');
  const opener = item.match(/<button class="rail-open".*?<\/button>/s)[0];
  assert.ok(!opener.includes('<button', 1) && count(opener, /<button/g) === 1, 'the opener holds no other button');
  assert.ok(!opener.includes('Save'), 'so its name stays the component’s');
  assert.ok(item.indexOf('data-action="save"') > item.indexOf('</button>'), 'Save comes after the opener closes');
});

test('Rail: the footer is Add component and the theme toggle, and there is no Delete', () => {
  const r = String(railView({ contracts: one, id: 'counter', dirty: true }));
  assert.ok(r.includes('data-action="add-open">Add component'));
  assert.ok(r.includes('data-action="theme"'));
  assert.ok(!r.includes('delete-open') && !/>Delete</.test(r));
  // The toggle shows the theme you would switch to.
  assert.match(String(railView({ contracts: one, id: 'counter', dirty: false, dark: true })), /<circle cx="12" cy="12" r="4"\/>/, 'a sun in the dark theme');
  assert.match(String(railView({ contracts: one, id: 'counter', dirty: false, dark: false })), /M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z/, 'a moon in the light one');
});

/* ------------------------------------------------------------------ *
 * the status column
 * ------------------------------------------------------------------ */

test('Status: the badge is in the card with the count, there is no titled header, and the platforms are named', () => {
  const s = String(inspectorView({ validation, previews, id: 'counter' }));
  const card = s.match(/<div class="card status-card[^"]*">.*?<\/div>\s*<p class="status-text">/s)[0];
  assert.ok(card.includes(`>${validation.counts.error} unresolved<`), 'the badge is inside the bordered card');
  assert.ok(card.includes('status-big'), 'next to the big number');
  assert.ok(!/>Status</.test(s), 'no visible "Status" label');
  assert.ok(!/class="[^"]*status-head/.test(s), 'and no header row above the card');
  assert.deepEqual([...s.matchAll(/<div class="status-platform">.*?<\/span>([^<]*)<\/div>/g)].map((m) => m[1]), ['iOS', 'Android']);
  assert.ok(text(s).includes('anything unresolved reaches the platform as a null'));
});

test('Status: offers to generate anyway while something is unresolved, and says so plainly when it is complete', () => {
  assert.ok(String(inspectorView({ validation, previews, id: 'counter' })).includes('btn-warning" data-action="build">Generate anyway'));
  const clean = { findings: [], counts: { error: 0 } };
  const ok = String(inspectorView({ validation: clean, previews, id: 'counter' }));
  assert.ok(ok.includes('>complete<') && ok.includes('Generate platform specs') && ok.includes('Every value the platforms need is present.'));
  assert.ok(ok.includes('status-ready'), 'and the card is marked as ready');
  const building = String(inspectorView({ validation, previews, id: 'counter', building: true }));
  assert.match(building, /data-action="build" disabled>Generating\u2026/);
});

test('Status: the notes it lists say iOS like everywhere else, and are capped with a count of the rest', () => {
  const many = { counts: { error: 0 }, findings: Array.from({ length: 15 }, (_, i) => ({ severity: 'warn', code: `x.${i}`, path: `x.${i}`, message: 'm', question: i === 0 ? 'Does the ring show on ios?' : `question ${i}` })) };
  const s = String(inspectorView({ validation: many, previews, id: 'counter' }));
  assert.ok(text(s).includes('Does the ring show on iOS?'));
  assert.ok(text(s).includes('15 notes'));
  assert.equal(count(s, /<div class="note">/g), 12);
  assert.ok(text(s).includes('and 3 more'));
});

test('Status: with nothing open it draws nothing', () => {
  assert.equal(String(inspectorView({ validation: null, previews: [], id: null })), '');
});

/* ------------------------------------------------------------------ *
 * the header and the page chips
 * ------------------------------------------------------------------ */

test('Header: the version sits with the title in a group of its own, so the links stay centred beside it', () => {
  const h = String(headerView({ contract, ready: true }));
  assert.match(h, /<div class="title-group"><h1 class="title">Counter<\/h1><span class="version">v\d[^<]*<\/span><\/div>\s*<nav class="header-nav" aria-label="Reference pages">/);
  assert.deepEqual([...h.matchAll(/class="btn btn-ghost btn-sm header-link" href="([^"]+)"/g)].map((m) => m[1]), ['/about.html', '/checks.html', '/mapping.html']);
});

test('Header: says something sensible before it is ready and when there is no component', () => {
  assert.ok(text(headerView({ contract: null, ready: false })).startsWith('\u2014'));
  assert.ok(text(headerView({ contract: null, ready: true })).startsWith('Nothing added yet'));
  assert.ok(!String(headerView({ contract: null, ready: true })).includes('class="version"'));
});

test('Chips: the pages are a real tab list: eight tabs, one selected, one in the tab order', () => {
  const c = String(chipsView({ tabs: tabsFor(null), tab: 'overview', errorsFor: () => 0 }));
  assert.match(c, /role="tablist" aria-label="Pages"/);
  assert.equal(count(c, /role="tab"/g), 8);
  assert.equal(count(c, /aria-selected="true"/g), 1);
  assert.match(c, /id="tab-overview" aria-selected="true" tabindex="0"/);
  assert.equal(count(c, /tabindex="-1"/g), 7, 'the others are reached by arrow keys');
  assert.deepEqual([...c.matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1]), TABS.map(([k]) => k));
  assert.ok(!c.includes('overflow'), 'they wrap; they are never a scrolling strip');
});

test('Chips: a page that carries unresolved values shows how many, and an import adds a ninth page', () => {
  const c = String(chipsView({ tabs: tabsFor({}), tab: 'appearance', errorsFor: (k) => (k === 'a11y' ? 2 : 0) }));
  assert.equal(count(c, /role="tab"/g), 9);
  assert.match(c, /Accessibility<span class="badge badge-count">2<\/span>/);
  assert.equal(count(c, /badge-count/g), 1);
  assert.match(c, /Import report/);
  assert.match(c, /id="tab-appearance" aria-selected="true"/);
});

/* ------------------------------------------------------------------ *
 * the rules of the state, and which pane is shown
 * ------------------------------------------------------------------ */

test('State: gaps are the warnings and errors for an area, never plain information, and errors are counted per page', () => {
  const v = { findings: [
    { code: 'a11y.label', severity: 'error', path: 'a' }, { code: 'a11y.role', severity: 'warn', path: 'b' },
    { code: 'a11y.note', severity: 'info', path: 'c' }, { code: 'meta.name', severity: 'error', path: 'd' },
  ] };
  assert.deepEqual(gapsFor(v, 'a11y').map((f) => f.path), ['a', 'b'], 'information is left out');
  assert.equal(tabErrors(v, 'a11y'), 1, 'only the error counts');
  assert.equal(tabErrors(v, 'overview'), 1);
  assert.equal(tabErrors(v, 'events'), 0, 'a page with no code of its own counts nothing');
  assert.deepEqual(gapsFor(null, 'a11y'), []);
});

test('State: every page that shows findings says which, and every code it counts is one it shows', () => {
  for (const [tab] of TABS) if (tab !== 'specs') assert.ok(PANE_GAPS[tab], `${tab} says which findings it shows`);
  for (const [tab, code] of Object.entries(TAB_CODES)) assert.ok(PANE_GAPS[tab].includes(code), `${tab} shows the ${code} findings its chip counts`);
});

const state = (over = {}) => ({ ready: true, contract, validation, previews, tokens, tokenMap, config, tab: 'overview', importReport: null, importMerge: null, ...over });

test('Pane: each page draws its own view, and Delete is offered on the Overview only', () => {
  const heads = { overview: 'The only fields edited here', props: 'The component\u2019s API', appearance: 'Everything visual, resolved', events: 'Callbacks the component raises', motion: 'What moves, and what makes it move', a11y: 'Stated once as intent', platform: 'Where a platform may go native', specs: 'One directory per component' };
  for (const [tab, start] of Object.entries(heads)) assert.ok(text(paneView(state({ tab }))).startsWith(start), `${tab} draws its own page`);
  assert.ok(String(paneView(state({ tab: 'overview' }))).includes('delete-open'));
  for (const tab of Object.keys(heads).filter((t) => t !== 'overview')) assert.ok(!String(paneView(state({ tab }))).includes('delete-open'), `not on ${tab}`);
});

test('Pane: a page is given only the findings that point at it', () => {
  const v = { counts: { error: 0 }, findings: [
    { code: 'prop.size', severity: 'warn', path: 'props.size', message: 'm', question: 'Which sizes?' },
    { code: 'event.click', severity: 'warn', path: 'props.onClick', message: 'm', question: 'What does click do?' },
  ] };
  assert.ok(text(paneView(state({ tab: 'props', validation: v }))).includes('Which sizes?'));
  assert.ok(!text(paneView(state({ tab: 'props', validation: v }))).includes('What does click do?'));
  assert.ok(text(paneView(state({ tab: 'events', validation: v }))).includes('What does click do?'));
});

test('Pane: the import report is a page only once there is one, and nothing open shows the invitation', () => {
  assert.equal(String(paneView(state({ tab: 'import' }))), '', 'no report, nothing to show');
  const report = { coverage: { derived: 2 }, sources: ['A.tsx'], derived: [], skipped: [], notes: [] };
  assert.ok(text(paneView(state({ tab: 'import', importReport: report }))).includes('2 values read'));
  assert.ok(text(paneView({ ready: true, contract: null })).includes('Point it at a component'));
  assert.equal(String(paneView({ ready: false, contract: null })), '', 'and nothing at all before it has loaded');
  assert.ok(text(emptyView()).includes('Point it at a component') && String(emptyView()).includes('add-open'));
  assert.ok(text(fatalView('the contracts directory is missing')).includes('Could not start') && text(fatalView('x')).includes('x'));
});

/* ------------------------------------------------------------------ *
 * the dialogs
 * ------------------------------------------------------------------ */

test('Add dialog: Add stays off until a folder is chosen or a path is typed, and a chosen folder lists only what is read', () => {
  assert.match(String(addDialogView({})), /data-action="add-submit" disabled>/);
  assert.ok(!/data-action="add-submit" disabled/.test(String(addDialogView({ path: 'src/components/Button' }))));
  assert.match(String(addDialogView({ busy: true, path: 'x' })), /data-action="add-submit" disabled>/, 'and not while it is working');

  const picked = { folder: 'IconButton', files: [{ name: 'IconButton/IconButton.tsx', content: '' }, { name: 'IconButton/icon-button.css', content: '' }] };
  const d = String(addDialogView({ picked }));
  assert.ok(text(d).includes('IconButton'));
  assert.match(d, /<span class="kind">code<\/span>IconButton\/IconButton\.tsx/);
  assert.match(d, /<span class="kind">css<\/span>IconButton\/icon-button\.css/);
  assert.match(d, /placeholder="icon-button"/, 'the id it would get is shown');
  assert.ok(!/Drop a component folder here/.test(d), 'the drop target gives way to the list');
});

test('Add dialog: is a labelled dialog with a drop target, a hidden folder picker, an id, a choice for what to do if it exists, and a path on disk', () => {
  const d = String(addDialogView({ mode: 'replace', id: 'x', path: 'p' }));
  assert.match(d, /id="add-title">Add component</);
  assert.match(d, /role="button" tabindex="0" aria-label="Drop a component folder" data-dropzone/);
  assert.match(d, /<input type="file" id="add-files" multiple hidden webkitdirectory directory>/);
  assert.match(d, /<option value="replace" selected>/);
  assert.ok(!/<option value="merge" selected>/.test(d));
  assert.match(d, /aria-label="Path on disk"/);
  assert.match(d, /id="imp-id" value="x"/);
});

test('Delete dialog: names the component and exactly which files go, before anything is removed', () => {
  const files = ['contracts/counter.contract.json', 'platform-specs/counter/ios.json'];
  const d = String(deleteDialogView({ name: 'Counter', files }));
  assert.ok(text(d).startsWith('Delete Counter?'));
  for (const f of files) assert.ok(d.includes(f));
  assert.match(d, /<div class="strong">contracts\/counter\.contract\.json<\/div>/, 'the contract itself is picked out');
  assert.match(d, /<label for="keep-specs">Keep platform specs<\/label>/);
  assert.ok(!/id="keep-specs" checked/.test(d), 'keeping the specs is something you choose');
  assert.ok(/id="keep-specs" checked/.test(String(deleteDialogView({ name: 'Counter', files, keep: true }))));
  assert.match(d, /data-action="delete-cancel">Cancel[^]*data-action="delete-confirm">Delete/);
});

test('Delete dialog: says it is checking, and shows the server’s reason when it cannot say', () => {
  assert.ok(text(deleteDialogView({ name: 'Counter', files: null })).includes('Checking'));
  assert.ok(text(deleteDialogView({ name: 'Counter', files: null, error: 'no such contract' })).includes('no such contract'));
});

/* ------------------------------------------------------------------ *
 * the reference pages
 * ------------------------------------------------------------------ */

const architecture = {
  totals: { files: 3, lines: 1200, undescribed: 0 },
  pipeline: [{ title: 'Import', command: 'cc import <path>', input: 'React component', output: 'a contract', does: 'Reads it.', refuses: 'Guessing.' }],
  groups: [{ title: 'Core', note: 'The pipeline.', dir: 'src/core', files: [{ name: 'resolve.js', lines: 700, summary: 'The resolver.', detail: ['More.'] }, { name: 'x.js', lines: 5 }] }],
};

test('About: the pipeline and the files, each file described by its own opening comment, and one that is not says so', () => {
  const p = String(aboutView({ data: architecture }));
  assert.ok(text(p).includes('3 source files, 1,200 lines. Every file describes itself.'));
  assert.ok(text(p).includes('Refuses: Guessing.'));
  assert.match(p, /<code class="code">resolve\.js<\/code>/);
  assert.ok(text(p).includes('The resolver.'));
  assert.ok(text(p).includes('no description in the file'), 'a file with no comment is shown as undescribed, not given prose');
  assert.match(p, /<th class="num">Lines<\/th>/);
  assert.ok(text(aboutView({ data: { ...architecture, totals: { ...architecture.totals, undescribed: 1 } } })).includes('1 do not describe themselves.'));
  // The page does not link to itself.
  assert.ok(!/<a href="\/about\.html">/.test(p) && /<a href="\/checks\.html">/.test(p));
});

test('Checks: the closure check and every rule, with its severity, its message, and why it exists only where that is recorded', () => {
  const data = {
    totals: { rules: 2, errors: 1, warnings: 1 }, ungrouped: [{ code: 'orphan.rule' }],
    closure: { question: 'Is it closed?', note: 'Internally.', items: [{ check: 'Same fields', why: 'So rows match.' }], blocking: 'Blocks a build.' },
    groups: [{ title: 'Identity', note: 'Who.', rules: [
      { code: 'meta.name', severity: 'error', messages: ['Needs a name.'], intent: 'The name is shown.', line: 12 },
      { code: 'meta.x', severity: 'warn', messages: ['Hm.'], line: 20 },
    ] }],
  };
  const p = String(checksView({ data }));
  const t = text(p);
  for (const expected of ['2 validation rules (1 error, 1 warning) plus the closure check.', 'Is it closed?', 'Same fields', 'Blocks a build.', 'Needs a name.', 'The name is shown.', 'validate.js:12', 'orphan.rule']) assert.ok(t.includes(expected), expected);
  assert.match(p, /badge badge-outline upper sev-error">error</);
  assert.match(p, /badge badge-outline upper sev-warn">warn</);
  assert.equal(count(p, /class="sub mt">The name is shown/g), 1);
  // Each rule has a location line, and only the rule with a recorded reason has a second block: none is invented for the other.
  assert.equal(count(p, /class="sub mt"/g), 3, 'a rule with no recorded reason gets none, not even an empty one');
});

test('Mapping: a value is code, a sentence is text, a keyword is quiet, a dash is a dash, and the header pins to the page', () => {
  const data = { sections: [
    { id: 'roles', title: 'Roles', note: 'Each role.', columns: ['Role', 'iOS', 'Why not'], rows: [
      { key: 'button', cells: [{ text: 'button', kind: 'key' }, { text: '.isButton', kind: 'mapped', actions: ['increment'] }, { text: 'does not apply to this one', kind: 'warn' }] },
      { key: 'x', cells: [{ text: 'x', kind: 'key' }, { text: 'native', kind: 'plain' }, { text: '\u2014', kind: 'missing' }] },
    ] },
    { id: 'anim', title: 'Animation', subtables: [{ title: 'Curves', columns: ['Name'], rows: [{ key: 'a', cells: [{ text: 'linear', kind: 'mapped' }] }] }] },
  ] };
  const p = String(mappingView({ data, active: 'anim' }));
  assert.ok(text(p).includes('3 mappings across 2 tables'));
  assert.match(p, /<code class="code">\.isButton<\/code>/, 'a value the platform names is code');
  assert.match(p, /<span class="warn">does not apply to this one<\/span>/, 'a sentence that explains is text, not code');
  assert.match(p, /<code class="code keyword">native<\/code>/, 'a keyword is quiet');
  assert.match(p, /<span class="muted">\u2014<\/span>/);
  assert.ok(text(p).includes('+ increment'));
  assert.equal(count(p, /<th class="pin">/g), 4, 'every header cell pins');
  assert.equal(count(p, /tbl-sticky/g), 2, 'and each of the two tables is a card that neither clips nor scrolls');
  assert.deepEqual(mappingNav(data.sections, 'anim'), [{ id: 'roles', label: 'Roles', active: false }, { id: 'anim', label: 'Animation', active: true }]);
  assert.match(p, /<a class="btn btn-sm" href="#anim" aria-current="true">Animation<\/a>/);
  assert.match(p, /<a href="\/platform-map\.json">src\/core\/platform-map\.json<\/a>/);
});

test('The reference pages show a failure as a message in the page, never as nothing', () => {
  for (const [name, view] of [['the pipeline', aboutView], ['the checks', checksView], ['the mapping', mappingView]]) {
    assert.ok(text(view({ error: 'the server said no' })).includes(`Could not load ${name}: the server said no`), name);
  }
});
