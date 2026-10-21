# CLAUDE.md

Guidance for AI agents working in this repository. Read `README.md` first for
what the tool does; this covers how to work on it without breaking it.

---

## The one rule

**Never fabricate.** This tool exists because a plausible-looking guess is
worse than a stated gap — it produces a spec that looks complete and is wrong,
and nobody checks it until the component ships broken.

That applies to the tool's output *and* to your work on the tool:

- A missing value becomes a note, never a default
- A rule with no recorded reason says so, rather than getting invented prose
- A file with no description renders as undescribed, not as a guess
- Token values are `null` because we genuinely do not know them

If you cannot determine something from the source, say so. Do not infer it
from a name and write it down as fact.

---

## Setup and the working loop

### What you need

- **Node 20+** runs the tool. The tests have been run on Node 24 only: the `test` script hands `node --test` a quoted
  glob, which an older Node may not expand, and that has not been tried. In an agent shell `node` may not be on
  `PATH`: use its absolute path (`/usr/local/bin/node` here) and give `npm` a `PATH`, e.g.
  `PATH="/usr/local/bin:/usr/bin:/bin"`.
- **Nothing to install**, to run the tool, its tests or to change the reader UI. The root `package.json` has no
  dependencies and must stay that way, and there is no second `package.json`: the reader is plain HTML, CSS and
  JavaScript with no build. (It was React, Vite and shadcn once, and a `web/node_modules` of 263 MB; a test fails if
  `assets/`, `node_modules`, a source map or a package manifest appears in `src/ui`, or `web/package.json` comes back.
  A root-level `node_modules` is not checked.)

```bash
npm test          # the tool's tests and the reader's views and logic. Green before you start.
```

If it is not green, stop and find out why. Do not build on a broken base. The count changes as tests are
added, so do not hardcode it in a doc and trust it: run the suite.

### Run the server

```bash
node bin/cc.js open --no-open --port=4321 > /tmp/cc.log 2>&1 &     # then http://localhost:4321
```

**Port 4321 is the user's.** It serves their real `contracts/` and `platform-specs/`. Use 4390 and up for your
own. To restart theirs and nothing else: `pkill -f "cc.js open --no-open --port=4321"`. A bare
`pkill -f "cc.js open"` kills every instance, including yours. The other commands (`import`, `validate`,
`build`, `list`, `delete`) are in the README.

### What needs a restart (checked, not assumed)

Node caches modules, so after a change to `src/` or `bin/` JavaScript, **restart the server**, or you will debug
output that is no longer being produced: a new route returned 404 until the restart. A **changed reader UI file
needs none**: `src/ui` is read from disk on every request with `no-store`, and a changed file was served at once.
Either way, tell the user to reload (Cmd+Shift+R).

### Changing the tool (`src/`, `bin/`)

1. `npm test` is green. 2. Archive (below). 3. Change it. 4. Break it on purpose (see How to verify).
5. Restart the server. 6. For a refactor, prove the output is byte-identical.

### Changing the reader UI (`src/ui`)

Edit the file and reload. There is no build, no stamp and no generated file. The fast loop is the Node tests
(`npm test`, or one file: `node --test test/ui-views.test.js`); they draw each view to a string from Counter data
the tests rebuild on every run, so nothing is committed that could go stale. What they cannot see is how a page looks
or what a button does, so also load it in a browser (below) and run `scripts/e2e.mjs`:

```bash
PLAYWRIGHT_DIR=/tmp/shot node scripts/e2e.mjs     # builds its own temp project and server, removes both
```

### There is no git

No version control. A deleted file is gone. Three have vanished during development with no code path to
explain it (`tokens/`, a contract, `test/fixtures/`). Before destructive work or a large change, archive the
project outside the repo (it is about 2 MB):

```bash
rsync -a . <somewhere-outside>/cc-before-<what>/
```

Afterwards `diff -rq contracts <archive>/contracts` (and `platform-specs`) shows whether the user's own files
changed. Recommending `git init` to the user is reasonable and has been raised.

### Try things on a copy, never on the user's workspace

The CLI roots itself at where it is installed, not at the working directory, so experiments must run from a
**copy of the whole project**, on another port:

```bash
rsync -a . /tmp/scratch/
(cd /tmp/scratch && node bin/cc.js open --no-open --port=4390 > /tmp/scratch.log 2>&1 &)
```

A UI change is tried in the copy's `src/ui` the same way: edit the file there and reload.

Seed it through the API (`POST /api/import` with an absolute path under the copy; `PUT /api/contract/<id>` with
`{ contract }`), never by running the CLI from somewhere else. Destructive flows (delete, import, build) belong
here. When done: `pkill -f "port=4390"`, delete the copy, and diff the real `contracts/` against the archive.

### Look at the UI in a real browser

```bash
mkdir -p /tmp/shot && cd /tmp/shot && npm init -y && npm i playwright-core        # outside the repo
# chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
```

It finds what Node tests cannot: page errors, computed styles, geometry (overflow, wrapping, baselines),
keyboard use, and effective colour contrast (composite the colour over its real background on a canvas, then
apply WCAG). Several real bugs here were found only this way. Some agent environments cannot *view* a
screenshot (the viewer shows only images that existed before it first read them): then verify by measurement,
say plainly that you did not look, and ask the user to. Keep these scripts out of the repo.

### Traps on this machine

- **zsh** aborts `grep --include=*.ts` with "no matches found". Use the Grep tool. `rg` is not installed, and an
  empty result from a missing tool reads as "no matches".
- **Never `pgrep -fl`**: it prints command lines, and some carry tokens. Use `ps -axo pid,command`, cut.
- A server started in the background can be reaped when the command that started it ends in an error. Start it
  and use it in the same command, and `curl` it before relying on it.
- Write any script longer than a few lines to a file with a quoted heredoc, and make each edit an exact match
  that asserts it matched exactly once. Inline `node -e` scripts and unchecked replaces have silently done nothing.

### Where things are

```
bin/cc.js             the CLI
src/core/             the pipeline: import/ -> semantics -> resolve -> emit/ ; platform-map.json holds every
                      mapping; validate.js, docs.js, architecture.js, checks.js, mapping-table.js generate the pages
src/server/index.js   serves src/ui and the API the reader calls
src/ui/               the reader: plain HTML, CSS and JS, served as it is
  *.html              the four pages; css/app.css is the one stylesheet; fonts/tiny5.woff2 is the logo's font
  js/app.js           state, API calls, events, dialogs: the ONLY file that touches the DOM
  js/html.js          the auto-escaping `html` tag
  js/lib/             pure logic (names, outline, motion rows, folder collection, which pane and findings show)
  js/views/           one function per pane (data in, HTML string out); table.js and shared.js make tables, chips, code
  js/pages/           About, Checks, Mapping
scripts/e2e.mjs      the reader in a real browser; not part of npm test (needs playwright-core and Chrome)
test/                 Node tests; fixtures in test/fixtures
contracts/, platform-specs/   the user's own files and the delivered output: tests must not read them
```

---

## How to verify

**Prove a test works by breaking the thing it tests.** A test that has never
failed has not been shown to test anything. This has caught real problems:

- A parser that silently dropped a rule whose message was a variable, not a
  literal — the page showed 52 rules while the validator ran 53
- A Kotlin `data class` that was never emitted, while the file still
  referenced the type. Braces balanced, so the structural check passed and the
  file would not have compiled

**Check output is byte-identical after a refactor.** If it is meant to be
behaviour-preserving, prove it:

```bash
cp -R platform-specs /tmp/before && rm -rf platform-specs
node bin/cc.js build > /dev/null 2>&1
diff -rq /tmp/before platform-specs && echo "identical"
```

**Do not let a shell failure read as success.** `grep --include` failing made
every line of a duplicate-detection check print "single definition" when
nothing had been checked. If a verification loop reports what you hoped for,
confirm the command actually ran.

---

## Things that have gone wrong here before

| Mistake | What it cost |
|---|---|
| Rewriting a function from memory instead of preserving it | Silently dropped four branches of `platformRole`; tests still passed because nothing exercised them |
| Inventing a branch that never existed | Added an `opacity` case to `typeForRole` during a file-format change |
| A `python replace` that matched nothing | Wrote a spec referencing an undeclared type; the build reported success |
| Trusting balanced braces as "valid" | Comments and missing declarations do not affect brace counts |
| A test reading `contracts/` | Broke the moment the user emptied their own workspace |
| A motion reading that guessed | Read `linear` as easeInOut, wrote reduced motion `"fade"` for a spinner whose CSS slows it to 2s, hardcoded a 360° rotation, and defaulted a hit-area `strategy` the component never stated |
| Measuring coverage after the loss | 8 of 10 rules matched no node and vanished, yet coverage said "2 of 2 placed". Measure against what the source HAS |
| A test that loops over a list that is now empty | It passed while checking nothing. After moving data, check every loop still iterates |
| `String.replace(x, "...$'...")` | `$'` in a replacement string expands to the rest of the file and corrupted `jsx.js` to 688 lines. Use the edit tool, or a replacer function |
| A large script embedded in `node -e '...'` | One apostrophe in a comment broke the shell and the edit silently never ran while its tests were already appended |
| Trusting a subagent's empty reply | It created nothing. Check that the files exist before building on them |
| Running `cc import` from a temp directory to "test in isolation" | The CLI resolves its root from where it is installed, not from the working directory, so it wrote a Button contract and specs into the user's real `contracts/` and `platform-specs/`. Experiment in memory (`importFromPath`, `resolve`, `emitPlatformJson`) and never through the CLI. If it happens, remove exactly what was created with `deleteComponent` after a dry run |
| Reading a prop as the first word of an expression | `labelledBy ? undefined : label` was reported as the `labelledBy` prop, and `formatValueText?.(value)` as the `formatValueText` prop. A prop reference is the whole expression being one declared name |
| Reporting `{value}` as the `value` prop | The markup's `value` was a local `const value = clamp(...)`; the prop was `controlled`. A component-scope declaration of the same name wins. `describeRef` in `semantics.js` is the one place this is decided |
| Giving the markup reader only `contract.props` | `loading` and `disabled` are modelled as states and dropped from it, so `aria-busy={loading \|\| undefined}` was called an unknown expression. Pass the declared set, `{...tsProps.props, ...contract.props}` |
| Flattening two CSS pseudo-classes into one state | `:focus` and `:focus-visible` both became `focused`, so a keyboard-only ring read as "every focus" and two reviewers rated it their top gap. When a mapping merges two things, keep the difference as a flag |
| A hardcoded value presented as read from the source | `labelRequired: true` was written by the importer regardless of the prop, and contradicted `label?: string` in the same file. A field that looks derived must be derived |
| Reading only the markup for what a node announces | A blocked button is `aria-disabled` only through a spread helper, so it announced nothing. The attribute is found literally in the quoted helper and its condition is the spread |
| Emitting a `{reference}` the token list does not declare | The typography composite was built in the semantic layer, so it never passed through the token machinery and `tokens[]` did not list it. A test now checks that every brace reference in the output is in `tokens`. A fact the platform files state should be recorded in the contract by the importer, so the reader UI and the token list agree with it |
| A helper that creates parents on the way down | `fillGap` in `mergeDraft` built `hitArea: {}` on every re-import whether or not it had anything to keep. Look at the contract diff after a re-import: an unexpected key is a bug, not noise |
| A section that can never have content | The Motion page's "Interaction" table read `contract.behavior.states`, a hand-written state machine that the importer never writes and the read-only reader cannot edit, so it was empty for every imported component. Before adding a section, check what fills the data it reads |
| Showing the same fact three times | The Motion page listed each animation in a table, again in "what changes", and again as 25 quoted source blocks. A page answers one question: here, which motion on which trigger. The rest lives in spec.md and `behaviorSource` |
| A sabotage that does not change behaviour | Appending a harmless property to prove a guard is missing reads as "MISSED". Make the sabotage actually disable the behaviour, then conclude |
| A whole-file `sed` to repair escapes in text that was just appended | It touched the entire file. Compare against the archive before trusting it, or use the edit tool on the lines in question |
| A single-line `interface XProps { a?: string }` in a test | The props reader does not read it (known), so the test silently had no props. Write test interfaces over several lines, as components are |
| Testing a page's logic and never running the page | The Mapping page threw `a is not defined` (a comment swallowed a loop body) for as long as it existed, and every Node test passed because none ran it. Run the pages in a real browser and fail on page errors |
| Testing only the branches your fixture reaches | The Motion page drew an empty code chip for a hand-written contract's trigger (a state, no node), and its `reducedMotion: { mode }` branch had no test, because Counter produces neither. A sabotage pass found it. Check what the resolver can produce, not only what the fixture does |
| `pgrep -fl` | It prints each process's command line, and some carry API tokens: Figma tokens reached a transcript once. Use `ps -axo pid,command` and cut the output, or `pgrep -f` for the pid alone |
| A search tool that is not installed | `rg` is not on this machine, and `rg ... \| head` printed nothing, which reads as "no matches". Use the Grep tool, and check the command ran |
| Styling each table where it is used | Nineteen Mapping tables had tiny uppercase headers and bold chips, the other tables had 14px medium headers, and a monospace chip held a "why not" sentence. Eight cell boxes and thirteen text styles across 60 tables, found only by measuring computed styles in Chrome. Set it once, centrally, and let a test keep it there |
| Matching a button by a regex on its name | `/Counter\s*0 variants/` still matched after Save was nested inside the opener, because the name just grew a word. Assert the structure (`opener.querySelector('button')` is null, Save is its sibling), not only a name that a substring can satisfy |
| A guard whose conditions hide each other | The platform-word regex had three conditions that each protect a path, but every test string was protected by two at once, so dropping any one passed. For each condition, add a case only that one protects (`specs/ios`, `platforms.ios`, `android/res`, `ios.json`) |
| One "MISSED" in a sabotage run | It was not reproducible in four repeats, but it was real to the harness. Re-run a miss before concluding either way, and make the harness retry once |
| A test that looks for the one string it expects | "A rule with no recorded reason gets none" counted the known reason's text, so a mutation that rendered an empty reason block for a rule with none went unnoticed. To prove something was not invented, count the blocks, do not look for the one you expect |
| Putting a value into text without checking its type | The applied-values list drew `{value: 8, unit: 'px'}` as `[object Object]`. It was in the React UI too and was found only when porting, because the new view code was read line by line. `valueWords` is the one place a token value becomes words |
| A harness crash read as a result | The sabotage run died creating a file in a folder that did not exist, and the output was cut off, so a tally was not known. Make the harness create what it needs and clean up after itself, check the tree afterwards, and read the final line, not the progress |
| A fixture that is not the real component | The Button fixture is `cva`-shaped and the real Button is not, which hid bugs. Keep faithful copies for the behaviours that matter and run the real component in memory as a second check |

The pattern in most of these: **the verification was weaker than the claim**.

---

## Conventions that are load-bearing

**Tests must not depend on `contracts/` or `platform-specs/`.** Those belong
to the user and can be emptied at any time. Use `test/fixtures/` and build
into `mkdtemp`. The suite passes with both directories deleted — keep it that
way.

**Every mapping lives in `platform-map.json`.** Not in the resolver, not in an
emitter. It is JSON so a non-JavaScript consumer can read it. `platform-map.js`
is a thin loader plus three interpreters and must contain no mapping
knowledge — a test greps it for hardcoded names like `isButton` and `CGFloat`.
That now includes how CSS roles become spec fields (`semantics`), which
properties are browser-only, how an animation is read (`animation`), and the
SwiftUI and Compose `idioms`.

**The idiom table and the concept vocabulary agree in both directions.** A
test runs a component that exercises every concept the semantic layer can name:
a concept with no idiom fails, and so does an idiom no concept can reach. Add
a concept in `semantics.js` and you must add its idiom, and the reverse.

**Nothing the CSS reader sees may disappear silently.** A property is mapped,
recorded as browser-only, or reported as unrecognised. A rule is placed, dropped
by design, or listed under `coverage.unplaced`. If you add a code path that
skips something, record the skip.

**An animation never names a property without a target.** `transform` with
nothing that sets a transform is not emitted; it is noted. A start value that is
not stated is the identity, and says so. Never invent a start, an end or a
timing, and never fill in what reduced motion does.

**Text is stated as one token, the way colour is.** `typography.js` recognises the composite a
component's five text tokens make up (`semantic.typography.label.l`), and the importer puts it in
the contract in place of them; the resolver does the same for the matrix, and only if every row
can, because rows must share a shape. The five are then never listed anywhere, evidence included.
Do not call it a "style" in the output or the docs. If a node's text tokens do not all agree on
one composite, nothing is claimed and they stay as they are. The merge of several rules into one
node must happen on the raw properties before the composite is decided, not after.

**The reader UI is plain HTML, CSS and JS, and what it works out is pure.** `src/ui` is the source and what is
served: no build, no install, no generated file. A view is a function from data to an HTML string, written with the
`html` tag in `js/html.js`, which escapes every value put into it; `raw` is for text that is already HTML and nothing
else. `js/app.js` is the only file that touches the DOM. What the pages work out (`js/lib/outline.js`, `motion.js`,
`tokens.js`, `collect.js`, `state.js`) has no DOM and is tested from Node, and so are the views, on Counter data that
`test/helpers/ui-data.js` rebuilds each run. Every class the outline draws must be styled (a test checks). The reader
loads nothing from outside and ships one font, Tiny5; the rest is the system font stack (Inter was dropped to keep it
lean: a deliberate trade, not a loss to repair). `test/ui-files.test.js` holds it to that: no external address, no
`assets/`, `node_modules`, source map or package manifest in it, no `web/package.json`, and a size budget. Tests check structure and labels, never appearance, and the summary
must say that.

**Tables are drawn by one scheme: the markup in `js/views/table.js`, the look in `css/app.css` under `.tbl`.** Column
header 12px medium muted; row label (`th[scope=row]`) 14px medium; cell 14px regular, top-aligned, `10px 16px`;
`numeric` and `nowrap` are options. An identifier is `code()` (12px mono, regular, always), a second line is `sub()`, a
list of chips is `chipList()`, and a table is a `tableBlock()`. The Props and Events panes are label-and-value
`fact()` rows, not tables, and every value in them is a `chip()` (the outline pill), including where an open question
points (`gapList`'s `chipPaths`); a test fails on a `<code>` or bare mono text there. Never give a table element its own
size, weight, padding, alignment or wrapping, and never write raw table or `<code>` markup in a view: a test fails on
all of it. To change how every table looks, change the one stylesheet block. A pill in a line of text, or a swatch beside
a label, makes its row taller than a row of words (baseline alignment), which is why lists of chips are flex rows.

**Platforms are shown as iOS and Android; their ids stay lowercase.** `js/lib/platform.js` is the one place:
`platformName` for an id, `withPlatformNames` for a sentence the tool wrote. Use them wherever a platform is
printed. Never apply them to data, a file path or a dotted key (`ios.json`, `platforms.ios`): the ids are the
contract's and the platform files' own words, and the regex leaves path- and key-shaped text alone. The Mapping
page's "Platform" column is labelled in `mapping-table.js`, beside its `iOS`/`Android` headers.

**The reader is called ToNative; the package is still `component-contracts`.** The name is a logo in the rail,
with the tagline "Web to Native" under it (the platforms are shown in the status column, not here),
set in Tiny5 (`fonts/tiny5.woff2`, self-hosted, never loaded from Google at run time). Tiny5 is drawn
on an 8-pixel grid, so it is crisp only at a size that is a multiple of 8: it is 24px, a fixed px size, not rem.
The CLI banner, the package name and the `TOOL` string written into the platform files were not renamed (the
last is output, so changing it changes the delivered specs).

**Save is in the open component's own list item, and only while that item has unsaved edits. Delete is at the
bottom of the Overview.** Neither is in the rail's footer. The list item is a container, not a button: a button
cannot hold a button, and Save is the opener's sibling so the opener's name stays the component's.

**The pages of a component are chips, and the header text is quiet on purpose.** `chipsView` in `js/views/chrome.js`
draws them: a tab list (`role=tablist`/`tab`, `aria-selected`, arrow keys, Home and End handled in `app.js`), restyled as
chips, and it wraps onto a second row below about 1500px instead of scrolling. The header title is 75% of the
foreground; the links, the version and the idle chips are muted grey, which is as quiet as text can go: 4.7:1 in the
light theme against the 4.5:1 AA floor. `test/contrast.test.js` reads the theme tokens and the rules from
`css/app.css` and computes the contrast, in both themes. Quieten a colour further and it fails. Do not "fix" it by lowering the floor.

**Generated docs read from source.** `architecture.js` reads each file's
opening comment, `checks.js` parses `validate.js`, `mapping-table.js` reads
`platform-map.json`. Never hand-write a list that describes code.

**Every source file opens with a block comment** saying what it is for (`.js` and `.css`; the four HTML pages are
exempt). A test enforces this, and `/about.html` displays it.

**Every validation rule needs a rationale** in `INTENT` in `checks.js`. Two
tests enforce it: one fails on a rule without one, the other on a rationale
for a rule that no longer exists.

**Behaviour is quoted, never interpreted.** `import/logic.js` copies the
component's statements verbatim, found by following names from what the markup
refers to. Do not evaluate them, summarise them or turn them into a state
machine: a field that is not literally in the source is a guess. Reachability is
the only filter, and it includes the state those statements read and write, a
statement that keeps a ref in step with a value, and any effect that touches
something reachable. Cut over the length limit, mark it `truncated`.

**A value read from the markup is `{prop}`, `{derived}`, `{expression}` or
`{literal}`, decided by `describeRef`.** The emitter, `spec.md` and the UI all go
through it. Do not re-derive "is this a prop" anywhere else.

**Events and feedback are a table in `platform-map.json`** (`semantics.events`),
matched as whole words against the quoted source and the markup's `on*`
attributes. A new event needs an entry in the table and an idiom for both
frameworks; the two-way test fails on either alone.

**Quoted source is the component's own text.** `behaviorSource` holds the
component's TypeScript, so the banned-framework-name scans apply to everything
else. If one trips on a quoted statement, exempt the quoted source; do not edit
it.

**"Refine the mapping" is answered with evidence, not self-assessment.** What
worked: two independent subagent reviewers, one per platform, each building from
the JSON alone and listing every point where they had to guess, then fixing the
guesses that were data gaps and leaving the ones that are decisions or are not in
the source. Reviewers read `CLAUDE.md` if it is in their working directory, which
contaminates the result: say so, or run them from elsewhere. Do not report a
numeric before/after unless both rounds used the same list.

---

## The output contract

`ios.json` / `android.json` are **platform-specific but framework-agnostic**.

Never emit, outside `implementationHints`: `SwiftUI`, `Compose`, `CGFloat`,
`Font.Weight`, `Sendable`, `androidx`, `TextUnit`, `import`, `DSTokens`,
`.isButton`, `Role.`, `HStack`, `Row(`, `scaleEffect`, `graphicsLayer`, or any
`accessibility[A-Z]` API name. Tests scan for these.

`implementationHints` is the one place framework idioms may appear. It is
advisory, opt-in per platform through `frameworks` in `ds.config.json`, built only
from the concepts that file uses, and never overrides the data. The idioms are
authored from documentation and not compiled here: do not describe them as
verified.

A hint's `note` is shared by both frameworks and must name neither; framework
advice goes in `notes.swiftui` or `notes.compose`, and the emitter sends a file
only its own. A test fails on a shared note that names a framework and on a file
that carries the other framework's advice. Never put a claim about one component
in the mapping data: it is read for every component (a note once said the source
used `aria-disabled` "precisely so focus is not lost", which was true of Counter
and false as general advice).

Do emit the concept: `kind: "traits"`, `concept: ["adjustable"]`,
`actions: ["increment", "decrement"]`.

Keep genuinely platform-specific things — 44pt against 48dp, `action` against
`onClick`. Dropping those would make the two files identical and pointless.

---

## Be direct with the user

Report what actually happened, including your own mistakes. Several real bugs
in this codebase were found only because a failure was investigated rather
than worked around.

When something is ambiguous and the answer materially changes the work — a
format, a dependency, a deletion — ask. Two conflicting options were resolved
that way rather than guessed at.

When you change something beyond what was asked, say so explicitly and give
the reasoning. Editing mapping data, dropping ~600 lines of redundant
assertions, and removing a stale table were all reasonable calls that still
needed flagging.

Do not claim a thing is verified when it is reasoned. Where Chrome is installed, drive the page
with `playwright-core` (install it outside the repo, in a scratch directory): that measures
overflow, clipping and sticky positions, and fails on page errors. Colour, contrast and whether
it looks right are still calculated or reasoned until someone looks. If you cannot view an image,
say so rather than describing one. Say which each claim is.
