/**
 * The two dialogs: add a component, and delete one.
 *
 * Both are native `<dialog>` elements, so focus, Escape and the backdrop are the browser's own. These
 * functions draw what is inside. Add takes a folder (dropped, browsed, or a path typed); which of its
 * files count, and the limits, are in lib/collect.js. Delete shows exactly which files go, from the
 * server's own dry run, before anything is removed.
 */

import { html, raw, cx } from '../html.js';
import { idFromFolder, STYLE_RE } from '../lib/collect.js';
import { icon } from './icons.js';

export function addDialogView({ picked, id = '', mode = 'merge', path = '', busy = false }) {
  const canAdd = !busy && (picked || path.trim());
  return html`<div class="dialog-head"><h2 id="add-title">Add component</h2><p class="muted">Choose the component\u2019s folder. Its code and styles are picked up automatically \u2014 anything that cannot be read becomes a question rather than a guess.</p></div>
<div class="${cx('dropzone', picked && 'picked')}" role="button" tabindex="0" aria-label="Drop a component folder" data-dropzone>${picked
    ? html`<div class="picked-head"><strong>${picked.folder}</strong><button type="button" class="btn btn-ghost btn-sm" data-action="add-change">Change</button></div><div class="picked-files">${picked.files.map((f) => html`<div><span class="kind">${STYLE_RE.test(f.name) ? 'css' : 'code'}</span>${f.name}</div>`)}</div>`
    : html`<div class="drop-empty">${icon('folder')}<strong>Drop a component folder here</strong><span>or <button type="button" class="link-button" data-action="add-browse">browse</button></span><em>.tsx .jsx .ts .js .css .scss \u2014 tests and stories skipped</em></div>`}</div>
<input type="file" id="add-files" multiple hidden webkitdirectory directory>
<div class="grid2">
<div class="field"><label for="imp-id">Id <span class="muted small">optional</span></label><input class="input mono" id="imp-id" value="${id}" placeholder="${picked ? idFromFolder(picked.folder) : 'from the folder name'}" autocomplete="off"></div>
<div class="field"><label for="imp-mode">If it already exists</label><select class="input" id="imp-mode"><option value="merge"${mode === 'merge' ? raw(' selected') : ''}>Merge \u2014 keep existing answers</option><option value="replace"${mode === 'replace' ? raw(' selected') : ''}>Replace \u2014 discard answers</option></select></div>
</div>
<details class="alt"><summary>${icon('chevron')}Or enter a path on disk</summary><input class="input mono" id="imp-path" value="${path}" placeholder="src/components/Button" autocomplete="off" aria-label="Path on disk"></details>
<div class="dialog-foot"><button class="btn btn-outline" data-action="add-cancel">Cancel</button><button class="btn btn-default" data-action="add-submit"${canAdd ? '' : raw(' disabled')}>Add component</button></div>`;
}

export const deleteDialogView = ({ name, files, error, keep = false }) =>
  html`<div class="dialog-head"><h2 id="del-title">Delete ${name}?</h2><p class="muted">Removes the contract and its entire platform-specs directory. This cannot be undone.</p></div>
<div class="filelist">${error ? html`<div class="danger">${error}</div>` : ''}${!files && !error ? html`<div class="muted">Checking\u2026</div>` : ''}${(files || []).map((f) => html`<div class="${cx(f.endsWith('.contract.json') && 'strong')}">${f}</div>`)}</div>
<div class="keep"><input type="checkbox" id="keep-specs"${keep ? raw(' checked') : ''}><div><label for="keep-specs">Keep platform specs</label><p class="muted small">Keeping them means platform teams consume specs for a component that no longer exists.</p></div></div>
<div class="dialog-foot"><button class="btn btn-outline" data-action="delete-cancel">Cancel</button><button class="btn btn-destructive" data-action="delete-confirm">Delete</button></div>`;
