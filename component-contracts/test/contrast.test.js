/**
 * The header text may be quiet, but never too quiet to read.
 *
 * Reducing contrast is a design choice with a floor: WCAG AA asks 4.5:1 for text this size. This reads
 * the reader's theme tokens and the rules the header and the page chips are actually styled by (both in
 * css/app.css), computes the contrast each would have in both themes, and fails if any falls below the
 * floor or if the title is no quieter than full strength. The colour conversion is checked against what
 * Chrome measured when the pages were drawn, so the arithmetic is not taken on trust.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FLOOR = 4.5;

/* ---------------- colour arithmetic ---------------- */

const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp = (v) => Math.min(1, Math.max(0, v));

/** oklch(L C H) -> sRGB 0..255, the way a browser draws it. */
function oklch(L, C, H = 0) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((v) => clamp(toSrgb(clamp(v))) * 255);
}

/** A colour at some opacity over another, blended in sRGB as a browser composites. */
const over = (fg, alpha, bg) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));
const luminance = (rgb) => { const [r, g, b] = rgb.map((c) => toLinear(Math.round(c) / 255)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/* ---------------- reading the stylesheet ---------------- */

const css = await readFile(join(ROOT, 'src/ui/css/app.css'), 'utf8');

/** The body of the rule for a selector, or null. */
function rule(selector) {
  const start = css.indexOf(`\n${selector} {`);
  return start < 0 ? null : css.slice(start, css.indexOf('}', start));
}

/** The theme's tokens: `--name: oklch(L C H)` in the :root and .dark blocks. */
function themes() {
  const block = (selector) => {
    const start = css.indexOf(`\n${selector} {`);
    assert.ok(start >= 0, `no ${selector} block in app.css`);
    return css.slice(start, css.indexOf('\n}', start));
  };
  const read = (text) => Object.fromEntries([...text.matchAll(/--([\w-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s*([\d.]*)/g)].map((m) => [m[1], oklch(Number(m[2]), Number(m[3]), Number(m[4] || 0))]));
  return { light: read(block(':root')), dark: read(block('.dark')) };
}

test('the colour conversion agrees with what Chrome drew for these tokens', () => {
  const { light, dark } = themes();
  const near = (got, want) => got.every((v, i) => Math.abs(Math.round(v) - want[i]) <= 1);
  assert.ok(near(dark.foreground, [250, 250, 250]), `dark foreground ${dark.foreground.map(Math.round)}`);
  assert.ok(near(dark.background, [10, 10, 10]), `dark background ${dark.background.map(Math.round)}`);
  assert.ok(near(dark['muted-foreground'], [161, 161, 161]), `dark muted ${dark['muted-foreground'].map(Math.round)}`);
  assert.ok(near(light['muted-foreground'], [115, 115, 115]), `light muted ${light['muted-foreground'].map(Math.round)}`);
  assert.ok(near(light.background, [255, 255, 255]));
  // And the ratio itself: Chrome's composited pixels gave 7.7:1 (dark) and 4.7:1 (light) for muted text on the page.
  assert.ok(Math.abs(contrast(dark['muted-foreground'], dark.background) - 7.7) < 0.1);
  assert.ok(Math.abs(contrast(light['muted-foreground'], light.background) - 4.7) < 0.1);
});

test('muted grey, the quietest the header and idle chips go, is readable on every surface it sits on', () => {
  for (const [name, theme] of Object.entries(themes())) {
    for (const surface of ['background', 'card']) {
      const r = contrast(theme['muted-foreground'], theme[surface]);
      assert.ok(r >= FLOOR, `${name}: muted text on ${surface} is ${r.toFixed(2)}:1, under ${FLOOR}`);
    }
  }
});

test('the header title is a step quieter than full strength and still clearly readable', () => {
  const title = rule('.title');
  assert.ok(title, 'the title rule');
  const m = title.match(/color:\s*color-mix\(in oklab,\s*var\(--foreground\)\s*(\d+)%,\s*transparent\)/);
  assert.ok(m, 'the title states how strong it is (color-mix of foreground NN%)');
  const alpha = Number(m[1]) / 100;
  assert.ok(alpha < 1, 'it is not full strength');
  for (const [name, theme] of Object.entries(themes())) {
    const full = contrast(theme.foreground, theme.background);
    const shown = contrast(over(theme.foreground, alpha, theme.background), theme.background);
    assert.ok(shown < full - 1, `${name}: the title (${shown.toFixed(1)}:1) is not meaningfully quieter than full strength (${full.toFixed(1)}:1)`);
    assert.ok(shown >= FLOOR, `${name}: the title is ${shown.toFixed(2)}:1, under ${FLOOR}`);
  }
});

test('the header links and the version are muted grey, and idle chips are muted grey at full strength', () => {
  assert.match(rule('.header-link'), /color:\s*var\(--muted-foreground\)/, 'the links use muted grey');
  assert.match(rule('.version'), /color:\s*var\(--muted-foreground\)/, 'and so does the version');
  const idle = rule('.page-chip');
  assert.match(idle, /color:\s*var\(--muted-foreground\)/, 'idle chips are muted');
  // Muted grey at full strength is the floor: any further fade of it would be under 4.5:1.
  assert.doesNotMatch(idle, /color:\s*color-mix/, 'idle chips are not faded below the muted grey');
});

test('the open page chip is full-strength text on the accent fill, and its hover fill stays readable', () => {
  const open = rule(".page-chip[aria-selected='true']");
  assert.ok(open, 'the open chip rule');
  assert.match(open, /background:\s*var\(--accent\)/, 'filled with the accent');
  assert.match(open, /color:\s*var\(--foreground\)/, 'and its text is full strength');
  const hover = rule('.page-chip:hover');
  assert.match(hover, /color:\s*var\(--foreground\)/);
  const mix = hover.match(/background:\s*color-mix\(in oklab,\s*var\(--accent\)\s*(\d+)%,\s*transparent\)/);
  assert.ok(mix, 'the hover fill is the accent at some strength');
  for (const [name, theme] of Object.entries(themes())) {
    assert.ok(contrast(theme.foreground, theme.accent) >= FLOOR, `${name}: text on the open chip is under ${FLOOR}`);
    assert.ok(contrast(theme.foreground, over(theme.accent, Number(mix[1]) / 100, theme.background)) >= FLOOR, `${name}: hovered chip text is under ${FLOOR}`);
  }
});
