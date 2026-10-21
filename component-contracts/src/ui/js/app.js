/**
 * The reader: one component's contract, resolved for iOS and Android.
 *
 * Storybook already shows props, variants and visual states. This does not rebuild any of that. It shows
 * what a component means on each platform: which tokens are applied where, what its motion is once
 * converted, what it says to a screen reader, and what is left to each platform. It is a reader: the only
 * editable fields are the few on Overview that exist nowhere in the code.
 *
 * This is the one file that touches the page. It holds the state, asks the server, and draws by handing
 * the state to the pure views (which return markup) and putting the result in place. Events are delegated
 * from `data-action` attributes, the dialogs are native <dialog> elements, and nothing is built or installed.
 */

import { api } from './lib/api.js';
import { collect, SKIP_RE } from './lib/collect.js';
import { platformName } from './lib/platform.js';
import { PANE_GAPS, gapsFor, tabErrors, tabsFor } from './lib/state.js';
import { setPath } from './lib/tokens.js';
import { chipsView, fatalView, headerView, inspectorView, railView } from './views/chrome.js';
import { addDialogView, deleteDialogView } from './views/dialogs.js';
import { paneView } from './views/pane.js';
import { gapList } from './views/shared.js';

const $ = (id) => document.getElementById(id);
const message = (err) => (err instanceof Error ? err.message : String(err));
const isDark = () => document.documentElement.classList.contains('dark');

/** Everything the reader knows. The server resolves and validates; this only asks. */
const S = {
  ready: false, fatal: null, config: null, contracts: [], id: null, contract: null, validation: null,
  previews: [], tokens: [], tokenMap: new Map(), dirty: false, building: false, tab: 'overview',
  importReport: null, importMerge: null,
};
let previewTimer;
let importedId = null; // the component an import report was made for: a report belongs to that one only

/* ------------------------------------------------------------------ *
 * drawing
 * ------------------------------------------------------------------ */

const renderRail = () => { $('rail').innerHTML = String(railView({ contracts: S.contracts, id: S.id, dirty: S.dirty, dark: isDark() })); };
const renderHeader = () => { $('header').innerHTML = String(headerView({ contract: S.contract, ready: S.ready })); };
const renderStatus = () => { $('status').innerHTML = String(inspectorView({ validation: S.validation, previews: S.previews, building: S.building, id: S.id })); };

function renderStrip() {
  const el = $('strip');
  el.hidden = !S.contract;
  if (!S.contract) { el.innerHTML = ''; return; }
  const hadFocus = !!document.activeElement?.closest?.('#strip');
  el.innerHTML = String(chipsView({ tabs: tabsFor(S.importReport), tab: S.tab, errorsFor: (k) => tabErrors(S.validation, k) }));
  if (hadFocus) $(`tab-${S.tab}`)?.focus();
}

/** The open page. The field being typed in, and where the page was scrolled to, are kept across a redraw. */
function renderPane({ resetScroll = false } = {}) {
  const root = $('pane');
  const scroller = $('pane-scroll');
  const top = scroller.scrollTop;
  const a = document.activeElement;
  const keep = a && root.contains(a) && a.id ? { id: a.id, start: a.selectionStart, end: a.selectionEnd } : null;
  root.innerHTML = String(paneView(S));
  scroller.scrollTop = resetScroll ? 0 : top;
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) { el.focus(); try { el.setSelectionRange(keep.start, keep.end); } catch { /* not a text field */ } }
  }
}

/** On the Overview the findings are replaced in place, so the field being typed in is never replaced. */
function refreshGaps() {
  const el = document.querySelector('#pane [data-gaps]');
  if (el) el.outerHTML = String(gapList(gapsFor(S.validation, ...PANE_GAPS.overview)));
}

function renderAll() {
  if (S.fatal) { $('app').innerHTML = String(fatalView(S.fatal)); return; }
  renderRail(); renderHeader(); renderStrip(); renderStatus(); renderPane({ resetScroll: true });
}

function toast(kind, text) {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = text;
  $('toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 7000 : 4000);
}

/* ------------------------------------------------------------------ *
 * talking to the server
 * ------------------------------------------------------------------ */

async function refreshConfig() {
  S.config = await api('/api/state');
  S.contracts = S.config.contracts;
  renderRail();
}

async function refreshPreview() {
  if (!S.id || !S.contract) return;
  const id = S.id;
  try {
    const data = await api(`/api/preview/${id}`, { method: 'POST', body: { contract: S.contract } });
    if (id !== S.id) return; // the person moved on to another component while this was resolving
    S.validation = data.validation;
    S.previews = data.previews;
    renderStatus(); renderStrip();
    if (S.tab === 'overview') refreshGaps(); else renderPane();
  } catch (err) {
    toast('error', message(err));
  }
}

async function select(id) {
  const data = await api(`/api/contract/${id}`);
  S.id = id; S.contract = data.contract; S.validation = data.validation; S.dirty = false; S.previews = [];
  S.tokens = data.tokens || [];
  S.tokenMap = new Map(S.tokens.map((t) => [t.name, t.value]));
  if (importedId !== id) { S.importReport = null; S.importMerge = null; }
  if (S.tab === 'import' && !S.importReport) S.tab = 'overview';
  renderAll();
  void refreshPreview();
}

function edit(path, value) {
  if (!S.contract) return;
  const next = structuredClone(S.contract);
  setPath(next, path, value);
  S.contract = next;
  const wasDirty = S.dirty;
  S.dirty = true;
  if (!wasDirty) renderRail(); // Save appears in this component's list item
  if (path === 'name' || path === 'contractVersion') renderHeader();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => void refreshPreview(), 250);
}

async function save() {
  try {
    const data = await api(`/api/contract/${S.id}`, { method: 'PUT', body: { contract: S.contract } });
    S.validation = data.validation;
    S.dirty = false;
    await refreshConfig();
    renderStatus(); renderStrip();
    if (S.tab === 'overview') refreshGaps(); else renderPane();
    toast('success', 'Saved');
  } catch (err) {
    toast('error', message(err));
  }
}

async function build() {
  S.building = true;
  renderStatus();
  try {
    const result = await api(`/api/build/${S.id}`, { method: 'POST', body: { contract: S.contract, strict: false } });
    S.dirty = false;
    S.validation = result.validation;
    const files = result.results.reduce((n, r) => n + r.files.length, 0);
    const gaps = result.results.reduce((n, r) => n + (r.closure?.problems.length || 0), 0);
    toast('success', gaps
      ? `${files} files written \u2014 ${gaps} value(s) left unresolved`
      : `${files} files written for ${result.results.map((r) => platformName(r.platform)).join(' and ')}`);
    S.tab = 'specs';
    renderRail(); renderStrip(); renderPane({ resetScroll: true });
    await refreshPreview();
  } catch (err) {
    toast('error', message(err));
  } finally {
    S.building = false;
    renderStatus();
  }
}

async function remove(keepSpecs) {
  const gone = S.id;
  try {
    const result = await api(`/api/contract/${gone}${keepSpecs ? '?keepSpecs=1' : ''}`, { method: 'DELETE' });
    S.contracts = result.contracts;
    S.dirty = false;
    S.importReport = null;
    if (result.contracts.length) await select(result.contracts[0].id);
    else {
      Object.assign(S, { id: null, contract: null, validation: null, previews: [], tokens: [], tokenMap: new Map() });
      renderAll();
    }
    toast('success', `Deleted ${gone}`);
  } catch (err) {
    toast('error', message(err));
  }
}

async function importComponent(body) {
  try {
    const { contract: made, report, merge } = await api('/api/import', { method: 'POST', body });
    await refreshConfig();
    await select(made.id);
    S.importReport = report;
    S.importMerge = merge;
    importedId = made.id;
    S.tab = 'overview';
    renderStrip(); renderPane({ resetScroll: true });
    toast('success', `${report.coverage.derived} values read from ${report.sources.length} file(s)`);
  } catch (err) {
    toast('error', message(err));
  }
}

function setTab(tab, { focus = false } = {}) {
  if (tab !== S.tab) { S.tab = tab; renderStrip(); renderPane({ resetScroll: true }); }
  if (focus) $(`tab-${tab}`)?.focus();
}

/* ------------------------------------------------------------------ *
 * the delete dialog: shows exactly which files go, from the server's own dry run
 * ------------------------------------------------------------------ */

const del = { files: null, error: null };

function drawDelete() {
  const keep = $('keep-specs')?.checked ?? false;
  $('delete-dialog').innerHTML = String(deleteDialogView({ name: S.contract?.name || S.id, files: del.files, error: del.error, keep }));
}

function openDelete() {
  del.files = null; del.error = null;
  drawDelete();
  $('delete-dialog').showModal();
  api(`/api/contract/${S.id}?dryRun=1`, { method: 'DELETE' })
    .then((plan) => { del.files = plan.removed; drawDelete(); })
    .catch((err) => { del.error = message(err); drawDelete(); });
}

/* ------------------------------------------------------------------ *
 * the add dialog: point at a folder by dropping it, browsing, or typing a path
 * ------------------------------------------------------------------ */

const fresh = () => ({ picked: null, id: '', mode: 'merge', path: '', busy: false });
let add = fresh();
const drawAdd = () => { $('add-dialog').innerHTML = String(addDialogView(add)); };

function openAdd() {
  add = fresh();
  drawAdd();
  $('add-dialog').showModal();
}

/** Every file under a dropped directory, skipping what is never read. */
async function walkDropped(items) {
  const entries = [];
  const walk = (entry, prefix = '') => new Promise((done) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) { entry.file((file) => { entries.push({ relPath: rel, file }); done(); }, () => done()); return; }
    if (SKIP_RE.test(`${rel}/`)) return done();
    const reader = entry.createReader();
    const batch = () => reader.readEntries(async (list) => {
      if (!list.length) return done();
      await Promise.all(list.map((child) => walk(child, rel)));
      batch();
    }, () => done());
    batch();
  });
  await Promise.all(items.map((i) => walk(i)));
  return entries;
}

async function pick(entries) {
  const result = await collect(entries);
  if (!result.ok) return toast('error', result.error);
  add.picked = { folder: result.folder, files: result.files };
  drawAdd();
}

async function submitAdd() {
  const id = add.id.trim() || undefined;
  if (!add.picked && !add.path.trim()) return;
  const body = add.picked
    ? { id, mode: add.mode, files: add.picked.files, name: add.picked.folder }
    : { id, mode: add.mode, path: add.path.trim() };
  add.busy = true;
  drawAdd();
  await importComponent(body);
  $('add-dialog').close();
}

/** Keeps the Add button honest as a path is typed, without redrawing the field being typed in. */
function syncAddButton() {
  const button = document.querySelector('[data-action="add-submit"]');
  if (button) button.disabled = add.busy || !(add.picked || add.path.trim());
}

/* ------------------------------------------------------------------ *
 * events
 * ------------------------------------------------------------------ */

const ACTIONS = {
  open(el) {
    if (el.dataset.id === S.id) return;
    if (S.dirty && !window.confirm('Discard unsaved changes?')) return;
    void select(el.dataset.id);
  },
  tab: (el) => setTab(el.dataset.tab),
  save: () => void save(),
  build: () => void build(),
  'delete-open': openDelete,
  'delete-cancel': () => $('delete-dialog').close(),
  'delete-confirm': () => { const keep = $('keep-specs').checked; $('delete-dialog').close(); void remove(keep); },
  'add-open': openAdd,
  'add-cancel': () => $('add-dialog').close(),
  'add-browse': () => $('add-files').click(),
  'add-change': () => { add.picked = null; drawAdd(); },
  'add-submit': () => void submitAdd(),
  theme() {
    const dark = !isDark();
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('cc-theme', dark ? 'dark' : 'light'); } catch { /* storage may be blocked */ }
    renderRail();
    document.querySelector('[data-action="theme"]')?.focus();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && !el.disabled) ACTIONS[el.dataset.action]?.(el);
});

document.addEventListener('input', (e) => {
  const field = e.target.closest('[data-edit]');
  if (field) return edit(field.dataset.edit, field.value);
  if (e.target.id === 'imp-id') add.id = e.target.value;
  if (e.target.id === 'imp-path') { add.path = e.target.value; syncAddButton(); }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'imp-mode') add.mode = e.target.value;
  if (e.target.id === 'add-files') {
    void pick([...e.target.files].map((file) => ({ relPath: file.webkitRelativePath || file.name, file })));
  }
});

// The pages are a tab list: arrow keys move between them, and moving selects (automatic activation).
document.addEventListener('keydown', (e) => {
  const tab = e.target.closest?.('[role="tab"]');
  if (tab) {
    const tabs = [...document.querySelectorAll('#strip [role="tab"]')];
    const i = tabs.indexOf(tab);
    const target = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (target === undefined) return;
    e.preventDefault();
    setTab(tabs[(target + tabs.length) % tabs.length].dataset.tab, { focus: true });
  }
  const zone = e.target.closest?.('[data-dropzone]');
  if (zone && (e.key === 'Enter' || e.key === ' ') && !add.picked && e.target === zone) { e.preventDefault(); $('add-files').click(); }
});

for (const type of ['dragenter', 'dragover']) {
  document.addEventListener(type, (e) => { const z = e.target.closest?.('[data-dropzone]'); if (z) { e.preventDefault(); z.classList.add('over'); } });
}
document.addEventListener('dragleave', (e) => e.target.closest?.('[data-dropzone]')?.classList.remove('over'));
document.addEventListener('drop', async (e) => {
  const zone = e.target.closest?.('[data-dropzone]');
  if (!zone) return;
  e.preventDefault();
  zone.classList.remove('over');
  const items = [...(e.dataTransfer?.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (items.length) await pick(await walkDropped(items));
});

// Leaving with unsaved edits is the one thing worth interrupting.
window.addEventListener('beforeunload', (e) => { if (S.dirty) e.preventDefault(); });

/* ------------------------------------------------------------------ *
 * start
 * ------------------------------------------------------------------ */

try {
  await refreshConfig();
  if (S.contracts.length) await select(S.contracts[0].id);
} catch (err) {
  S.fatal = message(err);
} finally {
  S.ready = true;
  renderAll();
}
