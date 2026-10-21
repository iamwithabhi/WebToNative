/**
 * Which pane to show for the reader's state.
 *
 * One pure function from the state to markup: the open page picks the view, and each view is given
 * only the findings that point at it. Kept apart from app.js so that "what is on screen for this state"
 * can be tested in Node, with no browser.
 */

import { html } from '../html.js';
import { PANE_GAPS, gapsFor } from '../lib/state.js';
import { a11yView } from './a11y.js';
import { appearanceView } from './appearance.js';
import { emptyView } from './chrome.js';
import { eventsView } from './events.js';
import { importReportView } from './import-report.js';
import { motionView } from './motion.js';
import { overviewView } from './overview.js';
import { platformView } from './platform.js';
import { propsView } from './props.js';
import { specsView } from './specs.js';

/** `S` is the app's state: contract, validation, previews, tokens, tokenMap, config, tab, importReport, importMerge, ready. */
export function paneView(S) {
  const c = S.contract;
  if (!c) return S.ready ? emptyView() : '';
  const gaps = (tab) => gapsFor(S.validation, ...PANE_GAPS[tab]);

  switch (S.tab) {
    case 'overview': return overviewView({ contract: c, tokens: S.tokens, gaps: gaps('overview'), canDelete: true });
    case 'props': return propsView({ contract: c, gaps: gaps('props') });
    case 'appearance':
      return appearanceView({
        contract: c, previews: S.previews, tokens: S.tokens, tokenMap: S.tokenMap,
        requiredSizeKeys: S.config?.vocab.requiredSizeKeys ?? [], gaps: gaps('appearance'),
      });
    case 'events': return eventsView({ contract: c, gaps: gaps('events') });
    case 'motion': return motionView({ previews: S.previews, behavior: c.behavior, gaps: gaps('motion') });
    case 'a11y': return a11yView({ contract: c, previews: S.previews, gaps: gaps('a11y') });
    case 'platform': return platformView({ contract: c, previews: S.previews, gaps: gaps('platform') });
    case 'specs': return specsView({ previews: S.previews });
    case 'import': return S.importReport ? importReportView({ report: S.importReport, merge: S.importMerge }) : html``;
    default: return '';
  }
}
