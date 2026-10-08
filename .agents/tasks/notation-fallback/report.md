# Report: Basic notation discovery and superclass fallback (la-gram)

First iteration: there was no `review.json`, so everything was implemented from
`.agents/tasks/notation-fallback/plan.md`. All work is uncommitted, in the working tree.

## Outcome

- **Catalogue.** Basic (`https://meta.linked.archi/basic/metamodel#Basic`) is in the Metamodels menu.
- **Loader.** It now loads the notation sets that presentation contexts name. Basic's bubble set arrives
  with the metamodel, and the manifest's `arch:notationSet` stays the default.
- **Lookup.** The palette and the canvas both style a class through one six-step lookup.
  - The superclass walk is breadth-first. Ties go to the lower IRI, and the walk ends at `arch:Element` /
    `arch:QualifiedRelationship`.
  - Other loaded metamodels' default sets are layered after the active set, in load order.
- **Relationships.** They render black unless a descriptor states a colour.

## Files changed

Modified:

| File | Change |
|---|---|
| `src/metamodel-manager/catalogue.ts` | Basic entry (`kind: 'language'`, after Backstage). Header comment corrected: the catalogue is maintained by hand, and Basic is listed ahead of publication. |
| `src/metamodel-manager/metamodel-loader.ts` | `ARCH_USES_NOTATION_SET`; `roleFromVia('arch:usesNotationSet') → 'notation'`; `discoverContextNotationSets` follows each loaded `presentationContexts` document; doc comments. |
| `src/metamodel-manager/palette-generator.ts` | Routed through `NotationResolver`. Builds `superClassMap` once and shares it. Adds the `defaultNotationSetIris` active-set step, `styleWithResolvedIcon`, `buildNotationIndex` and `indexEntryFor`. `buildSuperClassMap` / `closureOf` moved out. Module doc gives the six steps. |
| `src/metamodel-manager/interfaces.ts` | `PaletteOptions.defaultNotationSetIris`, `PaletteDefinition.notationIndex`; doc comments on `style` / `relationshipStyle`. |
| `src/metamodel-manager/index.ts` | Re-exports the resolver types and functions. |
| `src/ui/canvas/notation-styles.ts` | Palette entry first, then `notationIndex`, in `styleFor`, `renderingModeFor` and `relationshipStyleFor`. |
| `src/ui/mount-ui.ts` | `regeneratePalette` passes `defaultNotationSetIris` (the loaded metamodels' `notationSetIri`, in load order). |
| `src/metamodel-manager/__tests__/metamodel-loader.test.ts` | `arch:usesNotationSet targets` block (2 tests). |
| `src/metamodel-manager/__tests__/palette-generator.test.ts` | `notation fallback layering` block (7 tests). |
| `src/ui/canvas/__tests__/notation-styles.test.ts` | `notationIndex` block (7 tests). |
| `src/ui/__tests__/mount-ui.test.ts` | One test pinning the load-order wiring. |
| `.kiro/specs/la-gram/requirements.md` | Req 2.15 and 2.16 (the six steps, black relationships); Req 1.2 wording (hand-maintained catalogue, Basic). |
| `.kiro/specs/la-gram/design.md` | Palette-generation paragraph: the six steps, `notation-resolver.ts`, `class-hierarchy.ts`, `notationIndex`, `usesNotationSet` loading. |
| `.kiro/specs/la-gram/tasks.md` | One checked line under Task 2, naming the tests. |

New:

| File | Purpose |
|---|---|
| `src/metamodel-manager/class-hierarchy.ts` | `NOTATION_ROOTS`, `compareIris`, `buildSuperClassMap` and `closureOf` (moved verbatim), `superClassesNearestFirst` |
| `src/metamodel-manager/notation-resolver.ts` | `NotationSource`, `ResolvedNotation`, `NotationIndexEntry`, `NotationResolver`, `orderedFallbackSets`, `storeDefaultNotationSetIris` |
| `src/metamodel-manager/__tests__/basic-fixture.ts` | Basic-like asset set as inline Turtle, one string per document (manifest, ontology, taxonomy, rectangle set, bubble set, contexts). `basicAssetSource()` chains `UploadedAssetSource` with the bundle, for the core imports. |
| `src/metamodel-manager/__tests__/catalogue.test.ts` | 5 tests |
| `src/metamodel-manager/__tests__/class-hierarchy.test.ts` | 12 tests |
| `src/metamodel-manager/__tests__/notation-resolver.test.ts` | 17 tests |
| `src/ui/canvas/__tests__/notation-fallback-integration.test.ts` | 6 tests (jsdom, real renderer) |

Not touched:

- `assets/`, `bundled-assets.ts` and `bundled-assets.test.ts`;
- `rdf-renderer.ts` and `notation-shapes.ts`;
- `linked-archi-meta/` (read only) and `_la-web/`.

`npm run build:web` rewrote the git-ignored `dist/web/`. The smoke run wrote to the git-ignored
`test-results/browser/`.

## Design notes

**Where the walk lives.** `superClassesNearestFirst(classIri, superClassMap, stopAt = NOTATION_ROOTS)` in
`class-hierarchy.ts`.

- It is breadth-first and level by level. Each level holds the classes at the shortest distance *k* and is
  sorted with `compareIris`, a plain code-unit comparison (not `localeCompare`).
- A `visited` set lists each class once, at its shortest distance, which also makes cycles terminate.
- A root is included when it is reached but is never expanded. `arch:Element ⊑ arch:ModelConcept` is real
  core data and is never walked past.
- For a root itself the result is `[]`.

**How the layering is wired.** `NotationResolver` (in `notation-resolver.ts`) is the only place the order
exists. `resolve(C)` is memoised and runs the steps in this order:

1. `active.notations.get(C)` → `active`.
2. The first of `superClassesNearestFirst(C)` that the active set describes → `active-superclass`.
3. For each fallback set, in order, `set.notations.get(C)` → `fallback`.
4. C's own `arch:prefVisNotation` → `pref-vis-notation`.
5. For each fallback set, in order, the nearest superclass it describes → `fallback-superclass`. Sets are
   the outer loop and distance the inner loop.
6. Nothing → `default`.

The image (`prefVisNotation`) follows these rules:

- Exact hits (steps 1 and 3) use the descriptor's image, else C's own, which is today's merge.
- Superclass hits (steps 2 and 5) use the descriptor's image, because the class takes that look.
- Step 4 uses C's own image.

Wiring in `generatePalette`:

- **The active set.** An explicit `notationSetIri` comes first, then the presentation context, then the
  first `defaultNotationSetIris` entry that has descriptors, then `buildVisualNotations(graph)` as before.
- **The fallback sets.** `orderedFallbackSets(graph, active.iri, defaultNotationSetIris ?? storeDefaultNotationSetIris(graph))`
  keeps the given order and drops the active set, repeats and sets with no descriptors.
- **One resolver.** A single resolver feeds the element entries, the relationship entries and
  `notationIndex`.

`notationIndex` is plain data on the palette:

- It covers every class in `superClassMap`, every concept the consulted sets describe, and the two roots.
  `default` results are left out.
- Each class's `arch:unqualifiedForm` predicate is added as an alias key, but never over an existing key.
- `NotationStyleRegistry` treats a palette entry as authoritative for its IRI. The index answers only for
  IRIs the palette does not list, such as a class no taxonomy names.
- Because both paths come from one resolver, the canvas and the palette agree. A test checks this for
  every palette class under three configurations.
- `filterByViewpoint` spreads the palette, so the index survives filtering (tested).

**Determinism.**

- **Graph order never decides anything.** Same-distance superclasses are ordered by IRI.
- **Fallback layers.** They follow the caller's load order (`app.loadedMetamodels()`, primary first). With
  no order given, they follow `storeDefaultNotationSetIris`, sorted by metamodel IRI and then set IRI.
- **Active set.** With a load order given, it is the primary metamodel's set, no longer whichever
  `arch:notationSet` the store iterates first.
- **Index.** Index keys are visited in IRI order, so a predicate that two classes share always aliases
  the same one.
- **Loader.** It sorts the `usesNotationSet` references it discovers, so the status list does not depend
  on store order.

**Relationship colour.** The renderer is unchanged. A relationship descriptor without
`arch-vis:lineColor` gives `lineColor: undefined`, and the renderer draws `NOTATION_DEFAULTS.lineColor`
(`#000000`). Tests pin this in the resolver, the palette, the registry and the rendered SVG
(`stroke="#000000"`).

## Verification

Baseline before any change: `npm run typecheck` exit 0; `npm test` gave 72 files and 1285 tests, all passed.

```
$ npm run typecheck
> la-gram@0.1.0 typecheck
> tsc --noEmit
EXIT=0

$ npm test
 Test Files  76 passed (76)
      Tests  1342 passed (1342)
   Duration  17.86s
EXIT=0

$ npm run build:web
  WARNING in asset size limit: The following asset(s) exceed the recommended size limit (244 KiB).
  WARNING in entrypoint size limit: ... (244 KiB). This can impact web performance.
  web (webpack 5.105.4) compiled with 2 warnings in 8135 ms
EXIT=0

$ npx vitest --run --config vitest.browser.config.ts tests/browser/smoke.spec.ts
 ✓ tests/browser/smoke.spec.ts  (18 tests) 8067ms
EXIT=0
```

- **Test count.** +57 tests: 40 in the 4 new files, 17 added to existing files.
- **Lint.** There is no lint script and no ESLint in the project. The strict `tsc --noEmit` is the static
  check, and it is clean.
- **Build warnings.** The two warnings are webpack's bundle-size hints; the bundle is 1.72 MiB against a
  244 KiB hint. I did not build the baseline to compare.

**Mutation checks.** Each mutation was made on a backup and then restored; SHA-256 hashes were checked
after restore.

| Mutation | Tests that failed |
|---|---|
| Step 3 moved before step 2 | 2 |
| Per-level IRI sort removed | 4, including the resolver tie-break |
| Loader follow-up disabled | 4: loader, palette and canvas bubble tests |

**Before/after palette snapshot.** A scratch script dumped every palette entry's style, relationship
style, icons and the asset-status list for five setups: bundled ArchiMate 4.0, ArchiMate 3.2, Core,
AM4 + Core and Core + AM4.

- The before and after JSON are byte-identical (SHA-256 `d091fa2a…0da0d267` for both).
- The bundled languages are styled exactly, so step 1 always wins.
- ArchiMate's contexts name only the default set, so the loader adds no status entries.

**Loader and lookup script.** `/tmp/la-gram-scratch/exercise-fallback.ts`, run with `npx vite-node`,
exercises the loader and the lookup on the fixtures. Output, abridged:

```
== Basic fixture: discovered documents
  loaded  manifest              basic/metamodel#             via manifest
  loaded  ontology              basic                        via arch:modelConcepts
  loaded  taxonomy              basic/tax#                   via arch:conceptClassification
  loaded  notation              basic/notation#              via arch:notationSet
  loaded  presentationContexts  basic/presentation-contexts# via arch:presentationContextScheme
  loaded  coreOntology          core#                        via owl:imports (…)
  loaded  coreVisOntology       core-vis#                    via owl:imports (…)
  loaded  notation              basic/notation-bubble#       via arch:usesNotationSet
  default set: basic/notation#BasicRectangleNotation
== no context: active set basic/notation#BasicRectangleNotation
  basic#Node         active-superclass  via core#Element                Rectangle fill #E8F0EA line #424242
  basic#Association  active-superclass  via core#QualifiedRelationship  SolidLine NoDecoration→OpenArrowhead colour (none: black)
  basic#association  active-superclass  via core#QualifiedRelationship  (same, through the alias)
== bubble context: active set basic/notation-bubble#BasicBubbleNotation
  basic#Node         active-superclass  via core#Element                Circle fill #E8F0EA line #424242
== ArchiMate 4.0 + 3.2, active set archimate4/notation#ArchiMate40StandardNotation
  archimate4/onto#: 42 palette elements → {"active":42}
  archimate3/onto#: 62 palette elements → {"fallback":62}
```

**Cost.** With AM4, AM3.2 and Core loaded (116 726 quads), most of `generatePalette`'s time is the
existing store-to-n3 snapshot (2150 ms in the breakdown). The new parts are small:

- `buildSuperClassMap`: 11 ms. It was already built once per call inside `discoverRelationships`; now it is
  built once and shared.
- Resolving all 209 classes for the index: 1 ms.
- Fallback sets: 2 ms.

The scratch scripts and logs under `/tmp/la-gram-scratch/` were deleted after use.

## Final git state

- Repo root: `linked.archi/tools/modellers/la-gram`.
- HEAD: `36f0a448ae54a38a13e115ab231d84bc8023908f`, unchanged.
- `git diff --cached`: empty.
- `git status --short` at the start was `?? .agents/` (the plan). That is untouched, and this report is now
  beside it.
- `git status --short` at the end: 14 modified files (listed above), 7 new untracked source and test files,
  and `?? .agents/`. Nothing under `assets/` or `bundled-assets*` changed.

## Interpretations and deviations

- **"Default set of another loaded metamodel".** I implemented this as the loaded metamodels' default sets
  in load order, minus the active set.
  - If a context makes an alternative set of metamodel M active, M's own default becomes a fallback layer.
  - If M's default is active, the fallback layers are exactly the other metamodels' defaults.
- **Step 5.** Set order is the outer loop and superclass distance the inner loop. The first set that
  describes any superclass wins, even if a later set describes a nearer one. A test pins this.
- **Own `arch:prefVisNotation`.** It is read as the first object of any term type, which is what the
  palette always did. The plan's step 4 said "IRI-first as `objectValue` does", but that helper is not
  IRI-first, so I kept today's behaviour.
- **Empty load order.** `mount-ui` omits `defaultNotationSetIris` when no loaded metamodel names a set
  (Core alone, for example). The generator then falls back to the graph's metamodels in IRI order instead
  of "explicitly none", and the existing exact-call assertions in `mount-ui.test.ts` stay unchanged. A new
  test pins the non-empty wiring.
- **Generator called without a load order** (tests, other callers). The active set is still the graph's
  first `arch:notationSet` in store order, as before. Only the fallback layers use IRI order.
- **Visible changes beyond Basic.** These follow from the requested order:
  - With several languages loaded, a non-active language's classes are now styled from their own default
    set. With AM4 and AM3.2 loaded, AM3.2's 62 elements were previously unstyled.
  - A class with no exact descriptor but a described superclass takes that look, including the
    descriptor's palette image.
  - The no-context active set is now the primary metamodel's set, not store order.
  - With one metamodel loaded, nothing changes (the snapshot above).
- **Small additions outside the plan's file lists:**
  - the shared `basic-fixture.ts`;
  - one `mount-ui.test.ts` test;
  - the Req 1.2 wording fix, which matches the corrected catalogue comment;
  - the doc comments on `ElementTypeInfo.style` and `RelationshipTypeInfo.relationshipStyle`;
  - removing the now-unused `graph` parameter of the private `toElementTypeInfo`.
- **Catalogue edited by hand.** No generator owns it: `package.json` has no such script, and nothing in
  `webpack.config.js` or `server/` references it. `language` was the closest existing kind, so no new kind
  was added.

## Not done

- **Basic's manifest is not published yet.** Until it is, choosing Basic in the menu reports "No source
  could provide the metamodel manifest" and changes nothing else. Basic's files are not bundled, per the
  rules.
- **Fixtures are Basic-like, not the real files.** At the time of reading, `linked-archi-meta` had no
  Basic manifest, contexts or taxonomy (only the two notation files, which are uncommitted there), so the
  fixtures are inline and Basic-like. They mirror the notation files' values: fill `#E8F0EA`, element line
  `#424242`, uncoloured relationship descriptors.
- **The guide's Fallback Logic was not cross-checked.** In
  `linked-archi-meta/doc/guide/visual-notation-guide.md:56-60` it still showed the old three steps when I
  read it. The six steps here follow the brief verbatim, but I could not compare them with the concurrent
  run's text.
- **`tests/browser/workbench.spec.ts` was not run.** It contains a live test against `meta.linked.archi`.
  The offline `smoke.spec.ts` was run against the new build and passed.
- **`loadDocument` does not follow `arch:usesNotationSet`.** Uploading a single presentation-contexts file
  therefore does not pull in its sets. This is out of scope per plan D2.

Nothing committed or staged.
