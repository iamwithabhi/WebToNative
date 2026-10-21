# CLAUDE.md

React component library (React 19, TypeScript, Vite, Storybook 10, Vitest). See `README.md` for the full picture. This file holds the rules and gotchas.

## Commands

Run from `components/`.

```bash
npm run generate        # tokens + icons -> src/tokens, src/icons/generated
npm run storybook       # generates first, serves :6006
npx tsc --noEmit        # typecheck
npm run lint:tokens     # token contract
npm test                # vitest run (jsdom)
npm run build           # generate + tsc + lint:tokens + test + vite build
```

Before calling work done: `npx tsc --noEmit`, `npm run lint:tokens`, `npm test`, and `npm run build` if you touched anything exported.

## Hard rules

1. **Tokens: Semantic and Component tiers only.** Never `var(--base-*)`, never hex, `rgb()`, or `hsl()`. This applies to CSS, TSX, and story inline styles. `npm run lint:tokens` enforces it. Do not weaken or exempt files from the lint to get past it.
2. **Never hand-edit generated files:** `src/tokens/*.css`, `src/tokens/tokens.ts`, `src/icons/generated/`. Change `scripts/` or the inputs, then `npm run generate`. They are gitignored.
3. **`../tokens` and `../icons` are inputs, not part of this package.** Do not edit them unless asked.
4. **Icons come from the generated set.** Pick the closest existing icon. No inline SVG in components.
5. **Do not bump `typescript` past `^5.9`.** TS 7 breaks `react-docgen-typescript` and the Storybook build with `Cannot read properties of undefined (reading 'fileExists')`.
6. **When editing `package.json`, keep `devDependencies` and `allowScripts`.** An earlier rewrite dropped `devDependencies`, and the next `npm i` pruned every dev dependency.
7. **Do not invent tokens.** If a value is not in the token set, compose from tokens that exist (see below) and say so. Check a token exists with a grep of `src/tokens/semantic.css` before using it.

## Token gaps and how we handle them

| Missing | Use |
|---|---|
| 2px border width (scale is 1 / 1.5 / 4) | `calc(2 * var(--semantic-border-width-default))` |
| 44px size (scale is 40, 48, 56) | `--semantic-size-48` for touch targets |
| A px value with no token | `calc()` over existing tokens, with a comment explaining why |

If the spec you are given contains hex values that are not in the token set, map by the **name or role** the spec gives them (for example `--c-border-moderate` maps to `--semantic-color-border-moderate`) and report that the rendered colour differs slightly. Do not match by nearest colour alone.

## Token naming

Segments are kebab-cased: `Semantic.Color.CTA.Background` becomes `--semantic-color-cta-background`. `100%` becomes `full`, `5%` becomes `5`. Text styles are variables (`--semantic-typography-label-l-font-size`) and classes (`.ds-text-label-l`).

Dark theme is `[data-theme='dark']`, plus `prefers-color-scheme: dark` when the attribute is not `light`.

`scripts/build-tokens.mjs` hardcodes the input filenames and does not read `manifest.json`.

## Component conventions

- Layout: `src/<Name>/<Name>.tsx`, `<name>.css`, `<Name>.stories.tsx`, `<Name>.test.tsx`. Export from `src/index.ts`.
- CSS classes: `ds-<name>`, elements `ds-<name>__<element>`. Variants and state through `data-*` attributes (`data-size`, `data-full-width`), not modifier classes.
- Component-local custom properties: `--ds-<name>-*` (for example `--ds-counter-touch-target`).
- Do not put `overflow: hidden` on a container whose children use a `::after` hit-area overlay. It clips the overlay.
- Document props with JSDoc. Storybook prop tables are generated from it.
- Stories: title `Components/<Name>`, `tags: ['autodocs']`. For callback props:

  ```ts
  onChange: {
    action: 'changed',
    control: false,
    description: '...',
    table: { category: 'Events', type: { summary: '(value: number) => void' } },
  }
  ```

- `.storybook/preview.ts` sets `a11y: { test: 'error' }`, so a11y violations fail stories.
- Add `lint:tokens`-clean CSS. Comment lines that do not start with `*` or `//` are still scanned by the lint, so avoid writing `rgb(` or a hex-looking string inside a CSS comment continuation.

## Accessibility conventions

Counter is the reference.

- Match the ARIA role to the widget pattern. Counter is `spinbutton`, with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and optional `aria-valuetext`.
- Prefer `aria-disabled` over native `disabled` on controls a keyboard user may be focused on when they hit a bound.
- Compose button names from the field name so repeated instances differ.
- When `labelledBy` is used, drop `aria-label`. If both exist, `aria-labelledby` wins and the `aria-label` silently does nothing.
- Minimum pointer target is 48px via an `::after` overlay, not by enlarging the visible box. Drop the overlay when the control is unavailable.
- Respect `prefers-reduced-motion`.

## Testing

- jsdom has no layout engine, no blur-on-disable, and no screen reader. Touch-target tests assert the CSS contract by parsing the CSS and resolving tokens.
- Do not claim a focus, announcement, or geometry behaviour is verified unless it was run in a real browser or with real assistive tech. Say it is unverified.
- jsdom has no `PointerEvent`. Dispatch `new MouseEvent('pointerdown', { bubbles: true })` for React's `onPointerDown`.
- Tests need generated files. Run `npm run generate` first on a fresh checkout.

## Environment notes

- In the agent shell, `node` and `npm` are not on `PATH`. They live in `/usr/local/bin`. Use `PATH="/usr/local/bin:$PATH"` or full paths.
- `rg` is not installed. Use the Grep tool.
- `Flow/` is not a git repository.
- Run Storybook in the background and poll for it:

  ```bash
  PATH="/usr/local/bin:$PATH" nohup /usr/local/bin/npm run storybook -- --no-open > <logfile> 2>&1 < /dev/null &
  curl --retry 15 --retry-connrefused --retry-delay 2 -s -o /dev/null -w '%{http_code}' http://localhost:6006/
  pkill -f "storybook dev"      # stop
  ```

## Open items

- **Pointer focus on Counter is unverified in a real browser.** Pointer-down calls `focus()` on the spinbutton, but Chrome focuses a button on mouse-down and may override it. If a click does not move focus to the value, this is why.
- **Some `--component-*` tokens alias `--base-*` directly** in the token source, for example pressed backgrounds. The lint does not see this. Prefer semantic tokens, and flag it when a component token is the only option.
- **Opacity tokens are authored 0 to 100** with type `dimension`. The build divides by 100 when the value is above 1.
