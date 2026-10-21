# component-contracts

Read a React component. Produce one spec file per platform, containing only
what the component actually states.

```bash
node bin/cc.js open              # reader UI at http://localhost:4321
node bin/cc.js import <path>     # draft a contract from component source
node bin/cc.js validate          # list what the component does not say
node bin/cc.js build             # write platform specs
node bin/cc.js list              # show every contract
node bin/cc.js delete <id>       # remove a contract and its specs
npm test                         # the tool's tests and the reader's
```

No dependencies and nothing to install, to run it or to change it. Node 20+ runs the tool. The reader UI is plain
HTML, CSS and JavaScript in `src/ui`: there is no build step, so a change to a file there is what the browser gets
on the next reload. The tests were run on Node 24; see "Tests".

---

## What it is for

A design system states a component once. Two platform teams then reimplement
it, each making a hundred small decisions the design never covered — and the
three versions drift.

This reads the component and writes down every decision it *does* make, in a
form each platform can consume without inferring anything.

What it will not do is fill in the rest. A gap in the design stays a gap in
the output, named and visible. The alternative — inventing a plausible value —
produces a spec that looks complete and is wrong, which is worse than one that
is honestly incomplete.

---

## The pipeline

```
React component  →  contract.json  →  artifact (per platform)  →  ios.json
                    what it states     narrowed to one platform    android.json
```

Each stage may only narrow what the previous stage said.

| Stage | Command | Does |
|---|---|---|
| **Import** | `cc import` | Props from the TS interface, axes from `cva()` or `data-*`, appearance and states from CSS, the element tree from JSX |
| **Validate** | `cc validate` | 53 rules. Notes are warnings, not failures |
| **Resolve** | *(internal)* | Flattens the cascade, converts curves, translates roles, drops what the platform lacks |
| **Closure** | *(internal)* | Is every row internally consistent? |
| **Emit** | `cc build` | One self-contained file per platform |

---

## The output is data, not source

`platform-specs/counter/ios.json` and `android.json`.

It used to emit `.swift` and `.kt`. That forced SwiftUI and Jetpack Compose on
teams who might use neither, and referred to a `DSTokens` accessor invented
from a pattern in the config. The spec is now **platform-specific but
framework-agnostic**: it says what iOS and Android each need, and the team
builds it in the environment they already have.

What that distinction means in practice:

| Genuinely platform | Merely framework |
|---|---|
| 44pt against 48dp | `CGFloat` against `Dp` |
| a `button` trait against a `Button` role | `import SwiftUI` |
| `action` against `onClick` | `Color`, `Font.Weight`, `Sendable` |

### How to read a spec

The file is laid out to be built from, top to bottom. It opens with a `guide`
saying so.

| Section | What it is |
|---|---|
| `props`, `axes`, `stateDocs` | The component API, with the author's own doc comment on each prop |
| `sourceConstants` | Named numbers the author stated at module scope (a repeat interval, a haptic length, an icon-size map), each with its doc comment |
| `styles` | The fully enumerated matrix: one row per variant × size × state |
| `nodes` | **One description per node**: layout, appearance, and `conditional` changes |
| `animations` | Every transition and loop, complete on its own |
| `hitAreas`, `focusRings` | Lifted out of the stylesheet into what they are. A ring marked `focusVisible` is drawn for keyboard focus only, not for a tap |
| `accessibility` | Component-level semantics, and a per-node `accessibility` inside `nodes`: role, announced states with **when** they apply (including ones a spread helper sets, such as a blocked button's `disabled`), the range a control announces (`valueRange`), `labelledBy` / `describedBy`, and `tabOrder` |
| `accessibility.touchTarget` | The size the component states, the platform's own guidance, and which one to `buildTo`, side by side |
| `behaviorSource` | The component's **logic**, quoted verbatim, plus the web events and feedback it uses. See below |
| `externalComponents` | Nodes that are another component (icons): their size and glyph are not stated here |
| `tokens` | Every token path, with `usedAs` (`text.size`, `padding.top`, `hitArea.min.width`) taken from where it appears |
| `nodes[].appearance.typography` | The text token, stated the way a colour is: `{semantic.typography.label.l}`, one composite for the font family, size, weight, line height and letter spacing. The five tokens it stands for are not listed, anywhere in the file. It is used only when every text property a node sets is a token of one such group; otherwise they are stated one by one under `appearance.text`. The contract carries it too (a `typography` role in place of the five, and the composite declared in `tokens` as type `typography`), so it is in `tokens[]` with `usedAs: typography` and no `{reference}` is left undeclared |
| `unresolvedConditions`, `conditionallyRendered`, `implementationNotes` | What the tool could **not** read, so you know to read the source |
| `coverage` | Every stylesheet rule, placed or accounted for |
| `evidence` | The raw rules the above came from. Trace a value here; do not build from it |

```jsonc
{
  "nodes": [
    {
      "name": "button", "parent": "root", "role": "button",
      "layout": {
        "container": { "kind": "stack", "axis": "horizontal", "crossAlign": "center", "mainAlign": "center" },
        "size": {
          "width":  { "mode": "flex", "grow": 1, "shrink": 1, "basis": 0 },   // a share of the main axis
          "height": { "mode": "fill" }                                         // stretch, in THIS parent
        }
      },
      "appearance": { "foreground": "{semantic.color.icon.brand.primary}" },
      "conditional": [
        { "when": [{ "node": "button", "attribute": "aria-disabled", "equals": "true", "driver": null }],
          "appearance": { "foreground": "{semantic.color.disabled.icon}" } }
      ]
    }
  ],
  "animations": [
    {
      "node": "value", "property": "transform",
      "rest": { "value": { "scale": 1 }, "from": "identity (CSS transform: none)" },
      "changes": [{
        "to": { "scale": 1.1 },
        "when": [{ "node": "value", "attribute": "data-pop", "equals": "true",
                   "driver": { "state": "pop", "activatedIn": ["setValue"], "resetAfterMs": 100 } }]
      }],
      "timing": { "durationMs": 100, "curve": { "named": "linear" } },
      "reducedMotion": { "durationMs": 0.01, "effectivelyInstant": true }
    }
  ]
}
```

Things to notice.

**Tokens are paths, in braces.** The braces mark a reference, so a consumer
never has to guess whether a dotted string is a token or a value. `value` is
`null` in the token index, honestly: values live in your design system, not in
the component.

**Layout is stated for the parent it sits in.** `flex: 1 1 0` and
`align-self: stretch` mean different things along different axes, so the spec
resolves them (`flex`, `fill`, `fixed`, `hug`) rather than leaving every team to
re-read flexbox. An unset `align-items` is CSS's own default, stretch.

**An animation never names a bare "transform".** It says which function
(`scale`, `translate`, `rotate`), what it starts from and why, what it goes to,
and when. A transition with nothing that sets a target is not emitted, and the
reason is in `implementationNotes`.

**A condition says what drives it.** `driver` is a prop (`data-full-width` is the
`fullWidth` prop), a value the component computes (`derived`), a source-backed
state with where it is activated and its reset, a helper that is spread onto the
element (`spread`, with `logic` pointing at the quoted statements that set the
attribute), a source expression, or `null`. `null` means the cause is set inside
the component and nothing quoted explains it: it is listed under
`unresolvedConditions`, so read the source for those.

**A value read from the markup is one of four things.** `{prop}` is a prop the
component declares. `{derived}` is a value the component computes itself, whose
statement is in `behaviorSource`: `{value}` in the markup is usually
`const value = clamp(...)`, not the `value` prop, and a derived value that shares
a prop's name is the derived value. `{expression}` is source text, with `uses`
naming the derived values it reads, and `{literal}`. A `{prop}` that is not in
`props` is modelled as a state (`loading`, `disabled`): find it in `axes.state`.
An expression is never called a prop because it starts with one: `labelledBy ?
undefined : label` is an expression.

**Behaviour is quoted, not translated.** A stylesheet cannot say when a button is
disabled, what holding it does or which keys act on it. That is logic, and the
choices are to invent a state machine or to hand the team the source. This does
the second. `behaviorSource.entries` holds the statements the markup depends on,
exactly as written, found by following names: start from what the markup refers
to (a handler, a spread helper, `aria-label={decrementName}`) and follow only what
those statements refer to in turn. That includes the state they read and write
(`useState`, `useRef`, with `hook` saying which), and the statement that keeps a
ref in step with a value, because code that names `holdTimer` with no declaration
cannot be translated. An effect is kept when it touches anything reachable, which
is where "releasing anywhere ends the hold" lives. Each entry lists what it
`uses`, and a node lists the entries its own markup refers to under `logic`.

`behaviorSource.events` names the web events and feedback the source uses
(`event.pointerDown`, `event.pointerCancel`, `event.keyDown`, `feedback.haptic`)
and where, by name. It says the source listens for them, not what it does:
that is the quoted statement. Nothing in `behaviorSource` is evaluated or
summarised, and an entry over 2,500 characters is cut and marked `truncated`.

**Accessibility is a concept, not a spelling.** `kind` says which mechanism the
platform uses, `concept` names it. You write `.adjustable`, an adjustable action,
or whatever your codebase uses.

### Framework idioms (optional)

`ds.config.json` can name the framework each platform builds in:

```json
"frameworks": { "ios": "swiftui", "android": "compose" }
```

Each spec then carries an advisory `implementationHints` block: for every
concept *that file uses*, the SwiftUI or Compose idiom. A hint has a `note` that
is framework-neutral and shared, and a `frameworkNote` that is that framework's
own, so a SwiftUI file never carries Compose advice or the reverse (a test checks
the emitted text). Notes cover the places where the result is subtly wrong if the
idiom is taken at face value (a border that draws inside the node, a hit area that
cannot be layout-neutral, a stack's default spacing). It is kept apart from the data, so the data stays agnostic. Remove a
platform from the setting and its spec carries no hints.

The idioms were authored from framework documentation and **are not compiled in
this repository**. Treat each as a starting point.

### What gets read, and what does not

The CSS reader is bounded: it is not a browser. Anything it does not understand
is reported rather than dropped.

| Reported where | What |
|---|---|
| `coverage.unplaced` | A stylesheet rule that could not be placed on a node, with why |
| `coverage.droppedByDesign` | Rules a platform legitimately lacks (hover on touch) |
| `droppedProperties.webOnly` | Browser-only properties (`cursor`, `user-select`, `touch-action`) |
| `droppedProperties.unrecognised` | Properties it does not know, so nobody assumes they were applied |
| `conditionallyRendered` | Nodes behind a ternary or `&&`. *That* they are conditional is detected; the condition is not extracted |
| `unresolvedConditions` | Attributes whose cause the markup does not state and no quoted statement explains. A spread of a helper whose quoted source sets the attribute is *located* (`driver.spread`), not listed here |
| `behaviorSource` | Only statements reachable from the markup are quoted. The *condition* behind `conditionallyRendered`, guards on a state's activation and what re-triggers an animation are inside those statements, not extracted separately |

Coverage is measured against the rules the stylesheet **has**, not the ones that
reached a node. Measuring after matching made a rule that matched nothing
invisible, which is the one case it exists to catch.

---

## Tokens come from the component

There is no shared token library and no token directory. A component's
vocabulary is read from the component itself:

> A custom property the stylesheet **declares** is local.
> One it only **reads** comes from the design system.

That distinction needs no configuration, which is why `cssPrefix` is optional.

---

## Closure is internal consistency

`checkClosed` asks one question: *is every row of the resolved artifact
internally consistent?*

- every row has the same fields
- no value is null, undefined, or empty
- row count equals variants × sizes × states
- absent keys are checked first — iterating an object only sees what is there

It is deliberately **not** a checklist. An external list would demand things
the design never stated, forcing the tool either to block on everything or to
invent values.

`--strict` (default) refuses to write a spec that fails closure. `--no-strict`
writes it with gaps intact and reports `incomplete` rather than success.

---

## What gets dropped

`hover` has no honest equivalent on a touch platform. Mapping it to `pressed`
would be a fabrication that looks like a feature — so it is removed and
recorded in diagnostics.

The same applies to feedback mechanisms: a `ripple` is Android-only, a
`highlight` is not. Each is dropped where it does not exist.

---

## The reader UI

`node bin/cc.js open` — four pages, all read-only.

| Page | Shows |
|---|---|
| `/` | Per component: props, appearance (with an **outline** of each node's border, padding and gap), motion, accessibility, platform specs |
| `/about.html` | How the tool works, and what each file does |
| `/checks.html` | All 53 validation rules and the closure check |
| `/mapping.html` | Every web → iOS/Android mapping |

The last three are **generated from the source they describe** — file
descriptions from each file's own opening comment, validation rules parsed out
of `validate.js`, mappings read from `platform-map.json`. Documentation that
restates the code goes stale the first time someone edits it.

The Appearance pane opens with an **outline**: the component's parts as nested
boxes, with each node's border, padding and gap drawn where they sit, and one
outline more for each layout that changes behind a condition (a size, full width).
It is built from the resolved platform nodes, so it shows what the spec says and
nothing else. It is schematic, not to scale: a token's value lives in the platform
token library, so the bands are labelled, not measured, and proportions follow only
`flex`, `fill` and `hug`. Padding or a gap that is not stated is drawn as zero.

The Motion & interaction page is one table. Each row is a motion: **when** it starts
(`button pressed, not disabled`, `value pop is set`), **what moves** and from where to
where, **timing**, and what **reduced motion** does. Under a trigger it says what the markup
says sets it (`disabled is set by buttonProps(...)`, `set in setValue`), and nothing it cannot
read. A value that fades between several state colours is one row, not one per colour.

Below it, **Interaction** lists what the user can do (press, release, keys, haptics) and which
handler in the source deals with each, then the amounts the author named
(`HOLD_INTERVAL_MS 150 ms`, "Repeat interval while a button is held") with the author's own
note and where each is used. What a handler does is logic, so it is quoted exactly as written
and not interpreted, collapsed until opened. An action is attributed to a handler only because
the handler's own text uses the event. The complete logic is also in `spec.md` and in each
platform file under `behaviorSource`. A **State machine** appears on this page only if a
person wrote one into the contract; the importer never does, so it is usually absent rather
than drawn empty.

Only the Overview fields are editable. Everything else comes from the
component, and the way to change it is to change the component.

The reader is called ToNative. Its name is a logo set in Tiny5, a font kept in `src/ui/fonts` (it is the only font
the reader ships; everything else uses the system's own). The package, the `cc` command and the `TOOL` string
written into the platform files keep the name `component-contracts`.

Save is in the open component's own list item in the rail, and appears only while it has unsaved edits. Delete is
at the bottom of the Overview.

### Changing the reader UI

The reader is plain HTML, CSS and JavaScript (ES modules), served as it is from `src/ui`. There is nothing to
install, no build and no generated file. Edit a file, reload the page (the server reads `src/ui` on every request
and sends it with `no-store`). A change to `src/` or `bin/` JavaScript needs the server restarted instead.

A page is drawn by pure functions: each view takes data and returns an HTML string, written with the `html` tag in
`src/ui/js/html.js`, which escapes every value put into it (`raw` marks the few that are already HTML).
`js/app.js` is the only file that touches the page itself: it holds the state, calls the API, listens for clicks
and puts the strings on the page. Because views and the logic in `js/lib` do not need a browser, they are tested
from Node.

Tables are not styled one by one. Padding, alignment, wrapping and the text of headers, row labels and cells are
set once, in `css/app.css` under `.tbl`, and the markup is built once, in `js/views/table.js`: an identifier is
`code()`, a second line under a value is `sub()`, and a table is a `tableBlock()`. `npm test` fails if a view
builds raw table markup or its own `<code>`, or styles anything inline that does not have to be.

What the tests cannot see is how a page *looks*, and what a button does in a browser. `scripts/e2e.mjs` drives a
real Chrome through opening, editing, saving, every page, theme, adding and deleting a component. It builds a
throwaway project of its own and removes it, so it touches none of your files. It needs `playwright-core` and
Chrome, which are not dependencies of this project, so it is not part of `npm test`:

```bash
PLAYWRIGHT_DIR=<folder with playwright-core installed> node scripts/e2e.mjs
```

---

## Layout

```
src/core/
  import/
    index.js         assembles a contract from source
    visual.js        CSS -> rules: conditions, media, keyframes, arithmetic
    jsx.js           markup -> element tree, data-* drivers, conditional nodes
    interaction.js   boolean state, its activation, its timed reset
    constants.js     named constants and prop doc comments
  semantics.js     rules -> nodes, animations, hit areas, focus rings, coverage
  resolve.js       narrows a contract to one platform
  emit/platform.js artifact -> one JSON per platform
  validate.js      53 rules
  platform-map.json  every web -> platform mapping, as data
  platform-map.js    the loader and three interpreters
  architecture.js  reads the codebase to describe itself
  checks.js        parses validate.js to list its own rules
src/ui/            the reader: plain HTML, CSS and JS, no build
  *.html           the four pages (reader, about, checks, mapping)
  css/app.css      the one stylesheet, theme tokens included
  fonts/           Tiny5, the logo's font
  js/app.js        state, API calls, events: the only code that touches the page
  js/lib/          what the pages work out (names, outline, motion rows, folder collection)
  js/views/        one function per pane; each returns an HTML string
  js/pages/        About, Checks, Mapping
scripts/e2e.mjs   the reader in a real browser (not part of npm test)
contracts/         one .contract.json per component
platform-specs/    generated output
```

`platform-map.json` is the single source for every mapping: accessibility
roles, how CSS roles become spec fields, which properties are browser-only,
how an animation is read, and the SwiftUI and Compose idioms. It is JSON rather
than JavaScript so a Swift, Kotlin, or Python tool can read it without running
a JavaScript runtime — which matters, since the point of the project is output
that needs no inference.

---

## Configuration

`ds.config.json`:

```jsonc
{
  "contractsDir": "./contracts",
  "outDir": "./platform-specs",
  "platforms": ["ios", "android"],
  "emit": { "ios": ["json"], "android": ["json"] },
  "frameworks": { "ios": "swiftui", "android": "compose" }   // optional, see above
}
```

The engine still supports `web` and is tested for it; it is left out of
`platforms` because the web component is the source, not a target.

---

## Tests

```bash
npm test
```

That runs everything under `test/` with Node's test runner, nothing to install: the tool's tests, the reader's
views and logic (drawn to strings and checked, no browser), and checks on the reader's files (no external address, no
build output, nothing past a size budget, a table built in one place, contrast of the theme's colours). The tests
never read `contracts/` or `platform-specs/`.

I ran them on Node 24. The `test` script hands `node --test` a quoted glob, which a Node older than that may not
expand; I did not try Node 20, so if `npm test` finds no files there, that is why.

Several verify by **breaking things**: delete a type declaration and the spec
test fails; remove a rule's rationale and the checks test fails; add a
rationale for a rule that no longer exists and that fails too. The idiom table is
checked in both directions against a component that exercises every concept it
can name: a concept with no idiom fails, and so does an idiom nothing can reach.

A test that has never failed has not been shown to test anything.

---

## Known gaps

- **No version control.** There is no git here, so a lost file is unrecoverable.
  Three have disappeared during development with no code path to explain it
  (`tokens/`, a contract, the test fixtures). `git init` would make that a
  non-event.
- **A condition's cause is located, not evaluated.** A `data-*` attribute set
  from a prop, a computed value, or a boolean state with a source-backed
  activation names its driver. An attribute set through a spread of a helper
  (Counter's `aria-disabled` comes from `buttonProps(...)`) points at the quoted
  statements that set it, and is *not* worked out: the team reads those. Only an
  attribute that neither the markup nor any quoted statement explains is listed
  under `unresolvedConditions`. The activation guard on a state, and what
  re-triggers it, are inside the quoted logic and not extracted separately.
- **`behaviorSource` follows names, so it can miss logic reached another way.**
  A handler picked by a computed key, or logic reached through a function the
  tool cannot see into (a hook from another file), is not found. A source it
  cannot pair (a regex literal, unusual syntax) is skipped and reported instead of
  approximated. The list of web events is a fixed table of names, not a parser.
- **Some things are genuinely not in a component.** Token values, how text should
  scale, the words a screen reader should say for "read-only" (an announced state
  marked `wording: "not stated in the source"`), whether an animation should
  still run under reduced motion, and the size or glyph of an icon from another
  component are not stated, so the spec says so rather than choosing.
- **That a node is conditional is detected; the condition is not.** Button's
  spinner, icons and label are flagged, but when each shows is not extracted.
- **The CSS reader is bounded.** Descendant combinators beyond one ancestor,
  sibling selectors, container queries and `@supports` are reported as manual
  translation, not interpreted. A single-line `interface Props { a?: string }` is
  not read; components are not written that way.
- **The idioms are unverified.** They are authored from documentation and not
  compiled here. Some accessibility mappings beyond the ones checked
  (`isNotEnabled` and a text field's Compose role were wrong and are fixed) may
  also not match every framework version.
- **Files can be large.** Most of a spec's size is the fully enumerated style
  matrix (Button: about 74 of 139 KB pretty-printed; Counter, with little
  variation, is about 76 KB, of which the quoted behaviour is about 9). That is
  deliberate: no inheritance for a consumer to resolve. A compact form would
  change that promise. `stylesNote` says when every row is identical.
- **"Error" overstates it.** No validation finding blocks a build — only the
  closure check does. Counter reports 3 errors and builds fine. Three of them
  (`axes.variant`, `axes.size`, `a11y.role`) fire on components that are
  legitimately without those things. `/checks.html` says so per rule, but the
  severity label is still misleading.
- **No skills layer.** Calling out what is missing, essential, or hygiene
  across a whole library is deferred.
