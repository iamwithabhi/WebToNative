/**
 * The loader for the three reference pages: About, Checks and Mapping.
 *
 * Each page module exports an `endpoint` to fetch and a `view` that draws what it fetched. This picks the
 * module for the page it is in (from `<body data-page>`), fetches once, and draws it; a failure is shown as
 * a message in the page, never thrown. The Mapping page also keeps its section nav highlighting the
 * section in view while a long page scrolls.
 */

import { api } from './lib/api.js';
import { navView } from './pages/shell.js';

const PAGES = {
  about: () => import('./pages/about.js'),
  checks: () => import('./pages/checks.js'),
  mapping: () => import('./pages/mapping.js'),
};

const root = document.getElementById('root');
const page = await PAGES[document.body.dataset.page]();

let result;
try {
  result = { data: await api(page.endpoint), error: null };
} catch (err) {
  result = { data: null, error: err instanceof Error ? err.message : String(err) };
}

const draw = (active) => { root.innerHTML = String(page.view({ ...result, active })); };
draw(null);

// A long page keeps its place in the nav: highlight the section nearest the top of the screen.
if (result.data && document.body.dataset.page === 'mapping') {
  const ids = result.data.sections.map((s) => s.id);
  const seen = new Set();
  let current = null;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) (e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id));
    const next = ids.find((id) => seen.has(id)) ?? null;
    if (next === current) return;
    current = next;
    // Only the nav is redrawn, so the page does not jump while it is being read.
    root.querySelector('.page-nav').outerHTML = String(navView(page.nav(result.data.sections, current)));
  }, { rootMargin: '-56px 0px -70% 0px' });
  for (const id of ids) { const el = document.getElementById(id); if (el) io.observe(el); }
}
