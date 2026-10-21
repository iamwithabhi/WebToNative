# @flow/components

React component library built on the Flow design tokens and icon set. Components are developed and reviewed in Storybook.

- React 19, TypeScript, Vite
- Storybook 10 (`@storybook/react-vite`) with docs and a11y addons
- Vitest + Testing Library (jsdom)
- Plain CSS driven by CSS custom properties generated from the token files

The package is `private` and not published.

## Requirements

- Node 20 or newer (developed on Node 24)
- The sibling folders `../tokens` and `../icons` (see [Inputs](#inputs))

## Quick start

```bash
cd components
npm install
npm run storybook        # regenerates tokens + icons, then serves http://localhost:6006
```

`npm run storybook` runs `npm run generate` first, so edits to `../tokens` or `../icons` are picked up on the next start.

## Scripts

| Script | What it does |
|---|---|
| `npm run storybook` | Generate, then start Storybook on port 6006 |
| `npm run build-storybook` | Generate, then build a static Storybook to `dist-storybook/` |
| `npm run generate` | Run `tokens` and `icons` |
| `npm run tokens` | Build CSS variables and `tokens.ts` from `../tokens` |
| `npm run icons` | Build one React component per SVG in `../icons` |
| `npm run lint:tokens` | Fail on base-tier token references or hardcoded colours in component source |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run build` | generate, typecheck, lint tokens, test, then `vite build` to `dist/` |

## Inputs

Tokens and icons come from folders next to this one. They are the source of truth; nothing here edits them.

```
Flow/
├── tokens/        DTCG JSON: Base, Theme Light/Dark, text styles, effect styles
├── icons/         SVG files
└── components/    this package
```

Override the locations with `DS_TOKENS_DIR` and `DS_ICONS_DIR`.

`scripts/build-tokens.mjs` reads these files by name, so renaming them breaks the build:

- `Base.value.tokens.json`
- `🔒 Theme.Light.tokens.json`
- `🔒 Theme.Dark.tokens.json`
- `text.styles.tokens.json`
- `effect.styles.tokens.json`

`manifest.json` is not read.

## Project structure

```
components/
├── .storybook/        main.ts (framework, addons), preview.ts (theme toolbar, a11y)
├── scripts/
│   ├── build-tokens.mjs
│   ├── build-icons.mjs
│   └── lint-tokens.mjs
└── src/
    ├── Counter/       Counter.tsx, counter.css, Counter.stories.tsx, Counter.test.tsx
    ├── icons/
    │   ├── Icon.tsx, icon.css, Icons.stories.tsx
    │   └── generated/     generated, gitignored
    ├── tokens/            generated, gitignored
    └── index.ts           public exports (also imports the token CSS)
```

Generated and gitignored: `src/tokens/*.css`, `src/tokens/tokens.ts`, `src/icons/generated/`. Do not edit them. Run `npm run generate`.

## Tokens

### Pipeline

`npm run tokens` writes to `src/tokens/`:

| File | Contents |
|---|---|
| `base.css` | Primitive values as `--base-*` |
| `semantic.css` | Light and Dark theme tokens: `--semantic-*`, `--component-*`, `--feature-*`, `--merchandise-*`, `--legacy-*` |
| `typography.css` | Text styles as variables, plus `.ds-text-*` utility classes |
| `elevation.css` | Shadow styles as `--semantic-elevation-*` |
| `index.css` | Imports the four files above |
| `tokens.ts` | `TokenName` union, `TypographyClass` union, and a typed `token()` helper |

Aliases are emitted as `var()` chains rather than flattened, so switching theme re-resolves every level.

### Naming

Path segments are kebab-cased and joined with `-`:

```
Semantic.Color.CTA.Background       →  --semantic-color-cta-background
Semantic.Color.Border.Moderate      →  --semantic-color-border-moderate
Semantic.Spacing.8                  →  --semantic-spacing-8
Semantic.BorderRadius.100%          →  --semantic-border-radius-full
Semantic.Typography.Label.L         →  --semantic-typography-label-l-font-size  (+ .ds-text-label-l)
```

Opacity tokens are authored as 0 to 100 and are divided by 100 for CSS.

### The rule

Components may only use the **Semantic** and **Component** tiers. They must never reference `--base-*` or hardcode a colour.

`npm run lint:tokens` enforces this, and `npm run build` runs it. It fails on:

- `var(--base-…)`
- hex colours
- `rgb()`, `rgba()`, `hsl()`, `hsla()`

`src/tokens/` and `src/icons/generated/` are exempt.

### Theming

Light is the default. Dark applies when `data-theme="dark"` is set on an ancestor (usually `<html>`). With no attribute set, the theme follows `prefers-color-scheme`. Set `data-theme="light"` to force light.

In Storybook, use the **Theme** toolbar toggle.

### Gaps in the token scale

The scale has no 2px border width and no 44px size. Components compose around that:

| Need | How it is composed |
|---|---|
| 2px focus ring | `calc(2 * var(--semantic-border-width-default))` |
| 44px minimum touch target | `--semantic-size-48` (clears both the 44px and 48px platform floors) |
| 104px Counter width | `calc(2 * var(--semantic-size-40) + var(--semantic-size-24))` |

## Icons

`npm run icons` generates one component per SVG, exported from `src/index.ts`.

Naming: `-` and `_` split words, the `sys` token is dropped, and `f` becomes `Filled`.

```
add-sys-small.svg          →  AddSmallIcon
access-time-f-sys.svg      →  AccessTimeFilledIcon
```

Name collisions get a numeric suffix (`RadioButtonCheckedFilled1Icon`).

The source fill `#1F1F1F` is rewritten to `currentColor`, so colour follows CSS `color`. Any other colour in a file is left as authored.

```tsx
import { AddIcon, Icon, icons, iconNames } from '@flow/components';

<AddIcon size="lg" tone="brand" />
<AddIcon title="Add item" />        {/* gets role="img" and a name */}
```

| Prop | Values | Maps to |
|---|---|---|
| `size` | `xs` `sm` `md` (default) `lg` `xl` | `--semantic-size-12` / `16` / `20` / `24` / `32` |
| `tone` | `inherit` (default) `brand` `bold` `rich` `emphasis` `muted` `soft` `inverse` `success` `warning` `danger` `info` | `--semantic-color-icon-*` and the status icon tokens |
| `title` | string | Accessible name. Omit for decorative icons, which get `aria-hidden` |

`icons` is a name-to-component map and `iconNames` lists every key, for dynamic lookup. Prefer direct imports where possible so unused icons tree-shake away.

Browse them in Storybook under **Foundations / Icons**.

## Components

### Counter

A stepper with a value between two buttons. 104 × 32px.

```tsx
import { Counter } from '@flow/components';

<Counter
  label="Quantity, Blue T-shirt"
  defaultValue={1}
  max={10}
  onChange={(n) => setQty(n)}
/>
```

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` | `number` | | Controlled value. Pair with `onChange` |
| `defaultValue` | `number` | `0` | Starting value when uncontrolled |
| `min` | `number` | `0` | |
| `max` | `number` | `99` | |
| `step` | `number` | `1` | |
| `onChange` | `(value: number) => void` | | Called with the clamped next value. Not called when already at a bound |
| `frozen` | `boolean` | `false` | Read-only. Value stays focusable and readable |
| `fullWidth` | `boolean` | `false` | |
| `label` | `string` | `"Quantity"` | Accessible name. Make it specific when a page has several Counters |
| `labelledBy` | `string` | | `id` of visible text that names the control. Replaces `label` |
| `describedBy` | `string` | | `id` of help, limit, or error text |
| `formatValueText` | `(value: number) => string` | | Sets `aria-valuetext`, e.g. `"2 items"` |
| `decrementLabel` | `string` | `"Decrease <label>"` | |
| `incrementLabel` | `string` | `"Increase <label>"` | |
| `className` | `string` | | |

Behaviour:

- Pressing and holding a button repeats every 150ms.
- Keyboard on the value: Arrow keys step, PageUp/PageDown step by 10×, Home/End jump to `min`/`max`.
- The value scales briefly on change. `prefers-reduced-motion` is respected.
- A short haptic pulse fires where `navigator.vibrate` exists.

Accessibility:

- The value is `role="spinbutton"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`. It is the only tab stop.
- The step buttons are `tabIndex={-1}` and are reached by touch or pointer.
- At a bound a button gets `aria-disabled` rather than the native `disabled`, so it stays focusable.
- Button names are composed from the field name (`"Decrease Quantity"`), so several Counters on one page are distinguishable.
- There is no `aria-live` region. A focused spinbutton announces its own value changes.
- Each step button has a 48 × 48px hit area, larger than the 40 × 32px it renders at.

## Testing

```bash
npm test
```

Vitest runs in jsdom. Counter imports generated icons and some tests read the generated token CSS, so run `npm run generate` first on a fresh checkout.

jsdom has no layout engine, so the touch-target tests assert the CSS contract by parsing `counter.css` and resolving tokens, not computed geometry. Nothing here verifies real screen reader output.

## Adding a component

1. Create `src/<Name>/` with `<Name>.tsx`, `<name>.css`, `<Name>.stories.tsx`, `<Name>.test.tsx`.
2. Style with `--semantic-*` / `--component-*` tokens only, then run `npm run lint:tokens`.
3. Use icons from the generated set, not inline SVG.
4. Export from `src/index.ts`.
5. Run `npm run build`.

See `CLAUDE.md` for the conventions in full.

## Known limitations

- **Pointer focus is unverified in a real browser.** Pressing a Counter button calls `focus()` on the value so the change is announced. Chrome focuses a button on mouse-down, which may override that. Tested in jsdom only, which does not model it.
- **Some component tokens skip the semantic tier.** Many `--component-*` tokens alias `--base-*` directly (for example pressed backgrounds). The lint checks component source, not the token files, so it does not catch this.
- **The CSS bundle ships every token.** `src/index.ts` imports `tokens/index.css`, so `dist/index.css` includes all tiers, used or not (roughly 230 kB, 26 kB gzipped, at time of writing).
- **`package.json` `main` points at `src/index.ts`.** `npm run build` also emits `dist/`, but the package does not reference it yet.

## Troubleshooting

- **Storybook build fails with `Cannot read properties of undefined (reading 'fileExists')`.** `typescript` was bumped to 7.x. `react-docgen-typescript` needs the 5.x compiler API. Keep `typescript` at `^5.9`.
- **esbuild or fsevents will not run after install.** `allowScripts` in `package.json` pre-approves both. If npm still warns, run `npm approve-scripts <pkg>` then `npm rebuild <pkg>`.
- **`npm test` fails on missing modules under `icons/generated` or `tokens`.** Run `npm run generate`.
- **Storybook says change detection is unavailable.** `Flow/` is not a git repository. Harmless.
