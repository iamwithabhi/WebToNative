# ToNative

Build a component once for the web, then hand iOS and Android a spec of exactly what it states.

This folder holds a design system's web components and the tool that translates them into platform specs. It is two
projects that share one set of inputs:

```
ToNative/
├── tokens/                      design tokens (DTCG JSON): the source of truth, not edited here
├── icons/                       SVG icons (272): the source of truth, not edited here
├── components/                  @flow/components: the React library, reviewed in Storybook
├── component-contracts/         ToNative: reads a component, writes ios.json and android.json
├── component-handoff-plan.html  the plan this work follows: contract-first multi-platform handoff
└── .claude/launch.json          the two dev servers, by name
```

Each project has its own README with the detail. This file covers how they fit together and how to get running.

| Project | README | Conventions and gotchas |
|---|---|---|
| `components/` | [components/README.md](components/README.md) | [components/CLAUDE.md](components/CLAUDE.md) |
| `component-contracts/` | [component-contracts/README.md](component-contracts/README.md) | [component-contracts/CLAUDE.md](component-contracts/CLAUDE.md) |

---

## How the pieces connect

```
tokens/ + icons/  ──npm run generate──▶  components/src/tokens, src/icons/generated
                                                  │
                                    components/src/<Name>/  (React + CSS, tokens only)
                                                  │
                                         cc import <path>
                                                  ▼
                         component-contracts/contracts/<id>.contract.json
                                                  │
                                              cc build
                                                  ▼
                 component-contracts/platform-specs/<id>/ios.json, android.json, spec.md
```

1. **Tokens and icons are inputs.** `components` generates CSS variables and icon components from them. It never
   edits them.
2. **A component is written once, for the web,** using semantic and component tokens only. Storybook is where it is
   reviewed.
3. **ToNative reads that component** (props, CSS, markup, logic) and drafts a contract that holds only what the
   component states.
4. **It writes one spec per platform.** Visual values (layout, tokens, animation, hit areas, accessibility) are
   translated per platform. Behaviour is quoted as the original TypeScript, never translated, with neutral event
   names (`event.pointerUp`, `feedback.haptic`) and advisory SwiftUI and Compose hints alongside. Anything the
   component does not state is reported as a gap, never filled in.

Today the library has one component, **Counter**, and it is the reference for both projects.

---

## Requirements

- **Node 20 or newer.** Developed on Node 24. On Windows, install it with:

  ```bash
  winget install OpenJS.NodeJS.LTS
  ```

  Open a new terminal afterwards so `node` and `npm` are on `PATH`.
- **Nothing else for ToNative.** It has no dependencies.
- **`npm install` once in `components/`.**

---

## Quick start

From this folder:

```bash
npm install --prefix components
```

Then start either server, or both.

**Storybook** (the component library), at http://localhost:6006:

```bash
npm --prefix components run storybook
```

It regenerates tokens and icons first, so a change in `tokens/` or `icons/` is picked up on the next start.

**ToNative** (the contract reader), at http://localhost:4321:

```bash
node component-contracts/bin/cc.js open
```

In the Claude desktop app, both are also defined in `.claude/launch.json` as `storybook` and `tonative`.

### Producing platform specs

```bash
node component-contracts/bin/cc.js import components/src/Counter --id=counter
node component-contracts/bin/cc.js validate
node component-contracts/bin/cc.js build
```

Re-importing merges with the existing contract and keeps hand-answered fields; add `--replace` to discard them. The
output lands in `component-contracts/platform-specs/<id>/`.

---

## Things to know

- **Fonts are named, not shipped.** The tokens use Inter, but nothing in `tokens/` provides the font files. Storybook
  loads them from `@fontsource/inter` (a dev dependency, imported in `components/.storybook/preview.ts`). An app
  that uses the components has to load Inter itself, or text falls back to the system font.
- **The two theme token files are found by name.** `components/scripts/build-tokens.mjs` reads
  `🔒 Theme.Light.tokens.json` and `🔒 Theme.Dark.tokens.json` exactly. Unzipping on Windows can mangle the emoji
  into `­ƒöÆ`, and then `npm run storybook` fails with `ENOENT`. Rename the files back to the 🔒 names.
- **There is no version control.** Nothing here is a git repository, so a deleted file cannot be recovered, and
  Storybook logs a harmless "change detection failed" warning. `git init` at this level is recommended.
- **Port 4321 is for your own ToNative workspace.** It serves the real `contracts/` and `platform-specs/`. Use 4390
  and up for experiments, on a copy of `component-contracts/` (see its CLAUDE.md).
- **ToNative was developed on macOS, and parts of it are not yet portable to Windows.** 18 of 379 tests fail on path
  handling. The delete safety check is one of them, so deleting a contract may be refused on Windows until that is
  fixed. See [Tests](#tests) for running the suite on Windows at all.

---

## Tests

**components** (Vitest in jsdom; run `npm --prefix components run generate` first on a fresh checkout):

```bash
npm --prefix components test
```

**ToNative** (Node's built-in test runner; it never reads `contracts/` or `platform-specs/`). Run it from inside
`component-contracts/`:

```bash
cd component-contracts
```

```bash
node --test "test/**/*.test.js"
```

On macOS and Linux, `npm test` in `component-contracts/` does the same. **On Windows, `npm test` there runs 0 tests and
reports no failures,** because its script wraps the glob in single quotes, which Windows passes through literally.
Use the `node --test` command above instead. It currently reports 379 tests, 361 passing.
