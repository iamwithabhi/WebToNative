/**
 * The rules of the reader's state that are not drawing: which pages a component has, which findings
 * belong to which page, and how many errors a page's chip counts.
 *
 * Pure functions of the validation report, so they are tested in Node. app.js holds the state itself
 * and calls these; nothing here decides anything about a component, the server resolves and validates.
 */

export const TABS = [
  ['overview', 'Overview'],
  ['props', 'Props'],
  ['appearance', 'Appearance'],
  ['events', 'Events'],
  ['motion', 'Motion & interaction'],
  ['a11y', 'Accessibility'],
  ['platform', 'Left to platform'],
  ['specs', 'Platform specs'],
];

/** Which findings a page's count is made of: the start of the finding's code. */
export const TAB_CODES = {
  overview: 'meta', props: 'prop', appearance: 'appearance', motion: 'motion', a11y: 'a11y', platform: 'adaptable',
};

/** Which findings each page shows beneath it, so a gap appears where it belongs. */
export const PANE_GAPS = {
  overview: ['meta'],
  props: ['prop', 'axes', 'composition'],
  appearance: ['appearance', 'size', 'focusRing', 'token'],
  events: ['event'],
  motion: ['motion', 'behavior'],
  a11y: ['a11y'],
  platform: ['adaptable'],
};

/** The pages of a component: eight, and a ninth that appears after an import. */
export const tabsFor = (importReport) => (importReport ? [...TABS, ['import', 'Import report']] : TABS);

/** The findings that point at a given area (warnings and errors; notes that are only information are left out). */
export const gapsFor = (validation, ...prefixes) =>
  (validation?.findings || []).filter((f) => f.severity !== 'info' && prefixes.some((p) => f.code.startsWith(p)));

/** How many errors a page carries, for its chip's count. */
export const tabErrors = (validation, tab) => gapsFor(validation, TAB_CODES[tab] || '\u0000').filter((f) => f.severity === 'error').length;
