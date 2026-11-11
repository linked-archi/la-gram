# Implementation Plan: basic notation discovery and superclass fallback (la-gram)

Project: `linked.archi/tools/modellers/la-gram` (ALWAYS use absolute paths;
relative paths resolve against the parent workspace `linked.archi`).

## Ground rules (binding on every step)

- **Never commit or stage.** No `git add`, `commit`, `push`, `stash`, `tag`, `merge`, `rebase`, no PR.
  Leave every change in the working tree and report the file list. Source:
  `linked.archi/.kiro/steering/no-autonomous-commits.md`.
- Baseline git state, recorded at planning time (la-gram is its own repository):
  - repo root: `linked.archi/tools/modellers/la-gram`
  - HEAD: `36f0a448ae54a38a13e115ab231d84bc8023908f`
  - `git status --short`: empty (clean tree)
  - `git diff --cached`: empty
  - This plan folder (`.agents/`) is not git-ignored, so `.agents/tasks/notation-fallback/` shows as untracked.
    That is expected; do not stage it.
- If uncommitted changes that are not ours appear later, never revert or modify them.
- Do not touch: `assets/` (vendored snapshot: `assets/core`, `assets/archimate3`, `assets/archimate4`),
  `BUNDLED_ASSETS` / `BUNDLED_ICON_PREFIXES` in `src/metamodel-manager/bundled-assets.ts`,
  `src/metamodel-manager/__tests__/bundled-assets.test.ts` (pins 26 assets),
  `linked.archi/linked-archi-meta/**` (a concurrent run edits it; read-only),
  `linked.archi/_la-web/**`.
- No new dependencies. `node_modules` is present; do not reinstall.
- Tests run single-shot only (`npm test` = `vitest --run`). Never `npm run test:watch`.

## Commands (from `package.json`, verified)

Run from `linked.archi/tools/modellers/la-gram`:

- Typecheck: `npm run typecheck` (`tsc --noEmit`, strict).
- Full tests: `npm test` (`vitest --run`). One file: `npx vitest --run <path>`.
- Build: `npm run build:web` (webpack production, web target only; writes `dist/`, which is git-ignored).
- Lint: **there is no lint script and no ESLint in `devDependencies`/`node_modules/.bin`.** `npm run typecheck`
  is the static check. "No new lint errors" is satisfied by a clean typecheck; say so in the report.

Baseline at planning time: typecheck exit 0; `npm test` → 72 files, 1285 tests, all passing; tree stays clean
after the run.

## Verified facts the plan relies on

- `src/metamodel-manager/catalogue.ts:18` `CatalogueKind = 'core' | 'language' | 'framework' | 'extension'`;
  `METAMODEL_CATALOGUE` at `:29-57`, hand-maintained (no generator script in `package.json`, nothing in
  `webpack.config.js`/`server/` references it). Consumed by `src/ui/mount-ui.ts` and
  `src/metamodel-manager/__tests__/core-metamodel.test.ts` (asserts `METAMODEL_CATALOGUE[0]` is Core).
- `src/metamodel-manager/metamodel-loader.ts`: `MANIFEST_ASSET_PROPERTIES` (`:107-121`), `documentIriFor`
  (`:130-136`), `roleFromVia` (`:156-178`), level-by-level walk in `loadMetamodelFromManifest`
  (`:268-317`) that, for each `outcome === 'loaded'` status, reads that graph's `owl:imports` from the store
  (`:306-312`). `arch:usesNotationSet` is never followed.
- `src/metamodel-manager/notation.ts`: `buildVisualNotations(store, setIri?)` (`:350`) returns
  `NotationSet { iri, label, notations: Map<conceptIri, VisualNotation> }` or `null` when the set has no
  members; `resolveDefaultNotationSet` (`:280-293`) is store-order dependent; `resolveNotationSetForContext`
  (`:265-273`).
- `src/metamodel-manager/palette-generator.ts`: one active set (`resolveNotationSet`, `:228-235`); element
  lookup `notationSet?.notations.get(cls.iri)` then class `arch:prefVisNotation` (`:242-250`); relationship
  lookup the same (`:361-364`); module-private `buildSuperClassMap` (`:434-454`) and unordered `closureOf`
  (`:457-468`).
- Canvas path: `RdfRenderer` (`src/ui/canvas/rdf-renderer.ts:136, 180, 310`) reads only
  `NotationStyleRegistry` (`src/ui/canvas/notation-styles.ts`), which indexes the palette's element and
  relationship entries by IRI (+ `unqualifiedPredicateIri`). No entry → `NOTATION_DEFAULTS`
  (`src/ui/canvas/notation-shapes.ts:34-55`: Rectangle, `#FFFFFF`, `#000000`). Connections stroke
  `style?.lineColor ?? NOTATION_DEFAULTS.lineColor` (`rdf-renderer.ts:313`).
- The only real palette caller is `regeneratePalette` in `src/ui/mount-ui.ts:774-787`; it passes the full
  (unfiltered) palette to `diagramCanvas.updatePaletteDefinition`. `app.loadedMetamodels()`
  (`src/app.ts:198`) returns metamodels in load order (primary first, later loads appended); each
  `LoadedMetamodel.notationSetIri` is the manifest's `arch:notationSet`.
- `UploadedAssetSource` (`src/metamodel-manager/asset-sources.ts:228-258`) serves inline fixtures by document
  IRI, so loader tests need no network. `N3MetamodelLoader(parser, store, source)` takes a source.

## Design decisions

- **D1. Catalogue.** Add `{ iri: 'https://meta.linked.archi/basic/metamodel#Basic', label: 'Basic', kind: 'language' }`
  by hand, between Backstage and Business Model Canvas (entries are ordered by path: `archimate3`,
  `archimate4`, `backstage`, `basic`, `bmc`). `language` is the closest kind: Basic is a small modelling
  language with its own classes, notation sets and taxonomy. A new kind is not needed. No generator owns the
  file, so it is edited by hand; fix the header comment, which wrongly says "generated", to say it is
  maintained by hand from the manifests. Add a note that Basic's manifest is not published yet, so until then
  choosing it reports a load error and nothing else breaks.
- **D2. Loader.** In the manifest walk, when a document with role `presentationContexts` loads, read
  `?ctx arch:usesNotationSet ?set` from that document's named graph (same store-read pattern as the
  `owl:imports` follow-up) and queue each named-node object as `{ referencedIri: set, via: 'arch:usesNotationSet' }`.
  The existing batch dedup reduces it with `documentIriFor` and skips documents already seen. So ArchiMate
  contexts that name the default set add no status entry. `roleFromVia('arch:usesNotationSet')` returns
  `'notation'`. `LoadedMetamodel.notationSetIri` stays the manifest's `arch:notationSet`, so the default is
  unchanged. `loadDocument` (uploads) is out of scope.
- **D3. Breadth-first superclass walk is one shared helper.** New `src/metamodel-manager/class-hierarchy.ts` holds
  `buildSuperClassMap` and `closureOf`, moved verbatim from `palette-generator.ts` and exported, plus
  `superClassesNearestFirst(classIri, superClassMap, stopAt = NOTATION_ROOTS)`. `NOTATION_ROOTS` is
  `arch:Element` and `arch:QualifiedRelationship`. It returns C's superclasses (C excluded) level by level.
  Each level holds the classes at shortest distance *k* and is sorted by plain code-unit string comparison
  (`a < b`, never `localeCompare`), so ties break by IRI, deterministically. A root is included when it is
  reached but is never expanded, so the walk ends at the two core classes. A `visited` set makes it
  cycle-safe. If C is itself a root, the result is `[]`. The palette path and the canvas path both get their
  answers from this helper and nothing else (see D5/D6).
- **D4. Layered lookup lives in one resolver.** New `src/metamodel-manager/notation-resolver.ts`:
  - `type NotationSource = 'active' | 'active-superclass' | 'fallback' | 'pref-vis-notation' | 'fallback-superclass' | 'default'`
  - `interface ResolvedNotation { source; notation?: VisualNotation; matchedClassIri?: string; notationSetIri?: string; prefVisNotation?: string }`
  - `class NotationResolver(graph: Store, active: NotationSet | null, fallbacks: readonly NotationSet[], superClassMap)`
    with a memoised `resolve(classIri)`. It applies exactly this order:
    1. `active.notations.get(C)` → `active`
    2. first `s` in `superClassesNearestFirst(C)` with `active.notations.has(s)` → `active-superclass`
    3. first fallback set (in list order) with `notations.has(C)` → `fallback`
    4. C's own `arch:prefVisNotation` (first object, as today) → `pref-vis-notation`
    5. for each fallback set in list order, the nearest superclass with a descriptor in that set →
       `fallback-superclass`. Sets form the outer loop and the walk the inner loop. This applies step 2 per
       set and keeps one set's look together.
    6. nothing → `default` (renderers keep `NOTATION_DEFAULTS`)
  - `prefVisNotation` of the result: for exact hits (1, 3) it is `descriptor.prefVisNotation ?? C's own
    arch:prefVisNotation`, which is today's merge, kept. For superclass hits (2, 5) it is
    `descriptor.prefVisNotation`, the inherited look. For step 4 it is C's own. For step 6 it is undefined.
  - `orderedFallbackSets(graph, activeIri, defaultSetIris)`: dedupe while keeping order, drop `activeIri`,
    `buildVisualNotations` each one, drop `null`s.
  - `storeDefaultNotationSetIris(graph)`: every `?mm a arch:Metamodel ; arch:notationSet ?set` (named nodes),
    sorted by metamodel IRI and then set IRI (code-unit). This is the deterministic order used when the caller
    gives no load order (tests, other callers).
- **D5. Palette wiring.** `PaletteOptions.defaultNotationSetIris?: readonly string[]` holds the loaded
  metamodels' `arch:notationSet` in load order.
  - Active set: an explicit `notationSetIri` first, then the presentation context, then the first entry of
    `defaultNotationSetIris` that builds a non-null set, then `buildVisualNotations(graph)` as today.
  - Fallbacks: `orderedFallbackSets(graph, active?.iri, options.defaultNotationSetIris ?? storeDefaultNotationSetIris(graph))`.
  - Build `superClassMap` once per `generatePalette` and share it between `discoverRelationships` and the
    resolver.
  - Both `toElementTypeInfo` and `discoverRelationships` take `notation` and `prefVisNotation` from
    `resolver.resolve(iri)`. Icon resolution (`resolveUri`) is unchanged.
  - Pinning the no-context active set to the primary metamodel's set replaces the store-order result. With one
    metamodel loaded, the result is identical.
- **D6. Canvas wiring through plain data, built by the same resolver.** Add
  `PaletteDefinition.notationIndex?: Record<string, NotationIndexEntry>`. `NotationIndexEntry` is
  `{ source, notationSetIri?, matchedClassIri?, style?, renderingMode?, relationshipStyle? }`, exported from
  `notation-resolver.ts`.
  - `generatePalette` fills it for every key of `superClassMap`, every concept in the active and fallback
    sets, and the two roots. It keeps only results whose `source !== 'default'`.
  - It adds an alias key for each class's `arch:unqualifiedForm` predicate, unless that key already exists.
  - `style` uses the same resolved-icon copy as palette entries: extract one helper,
    `styleWithResolvedIcon(notation)`, and use it in both places.
  - `NotationStyleRegistry` keeps the palette entries first, which keeps hand-built palettes in tests working.
    It then falls back to `notationIndex` in `styleFor`, `renderingModeFor` and `relationshipStyleFor`.
    `labelFor` and `elementType` stay palette-only.
  - Because palette entries come from the same resolver, both paths give the same answer for every class. The
    index also styles canvas types that are not palette entries, such as classes outside the taxonomy.
  - `filterByViewpoint` spreads the palette, so the index survives filtering. `rdf-renderer.ts` is not changed.
- **D7. Load order from the app.** `regeneratePalette` in `mount-ui.ts` passes
  `defaultNotationSetIris: app.loadedMetamodels().flatMap((m) => (m.notationSetIri ? [m.notationSetIri] : []))`.
- **D8. Relationship colour.** No renderer change. A relationship descriptor without `arch-vis:lineColor`
  renders `#000000` (the `NOTATION_DEFAULTS` fallback), and a relationship with no descriptor renders solid
  black. Tests pin both.
- **D9. Specs.** `.agents/conventions.md` requires spec updates in the same change. Update
  `.agents/specs/la-gram/requirements.md` Req 2 items 15–16 (`:83-84`) with the six-step order and the loading of
  `usesNotationSet` targets. Update `.agents/specs/la-gram/design.md:171` (fallback sentence) and add one checked
  line to `.agents/specs/la-gram/tasks.md` near `:34`.

### Interpretations to report (not blockers)

- "Default set of *another* loaded metamodel" is implemented as the default sets of the loaded metamodels in
  load order, minus the active set. If the active set is an alternative (chosen by a context) of metamodel M,
  M's own default is a fallback layer. If the active set is M's default, the fallbacks are exactly the other
  metamodels' defaults.
- In step 5, set order is the outer loop and superclass distance the inner loop (D4).
- Basic's manifest is not live yet, so the catalogue entry works only after `linked-archi-meta` publishes it.
  Bundling the basic files is out of scope.

## Steps

- [ ] 1. Add the Basic catalogue entry and its test.
      Insert the D1 entry after `backstage/metamodel#BackstageCatalog` in `METAMODEL_CATALOGUE`. Correct the header
      comment: maintained by hand, and Basic is listed ahead of publication. Create
      `src/metamodel-manager/__tests__/catalogue.test.ts`. It asserts one entry with
      `iri === 'https://meta.linked.archi/basic/metamodel#Basic'`, `label === 'Basic'` and `kind === 'language'`;
      that every catalogue IRI is unique; that `METAMODEL_CATALOGUE[0]` is still Core; and that
      `CATALOGUE_KIND_LABELS` covers every kind used.
      Files: `src/metamodel-manager/catalogue.ts`, `src/metamodel-manager/__tests__/catalogue.test.ts` (new)
      Verify: `npx vitest --run src/metamodel-manager/__tests__/catalogue.test.ts src/metamodel-manager/__tests__/core-metamodel.test.ts` passes; `npm run typecheck` exits 0.

- [ ] 2. Follow `arch:usesNotationSet` from presentation-context documents (D2).
      In `metamodel-loader.ts`, add `const ARCH_USES_NOTATION_SET = namedNode(NAMESPACES.arch + 'usesNotationSet')`
      and `case 'arch:usesNotationSet': return 'notation';` in `roleFromVia`. In the `loadMetamodelFromManifest`
      walk, inside the `status.outcome === 'loaded'` branch and after the imports follow-up, if
      `status.role === 'presentationContexts'`, push
      `{ referencedIri: q.object.value, via: 'arch:usesNotationSet' }` for every NamedNode object of
      `this.store.getQuads(null, ARCH_USES_NOTATION_SET, null, namedNode(status.documentIri))`. Put it in a small
      private `discoverContextNotationSets(documentIri)`. Update the class doc comment's discovery paragraph.
      Add a `describe('arch:usesNotationSet targets')` block to `src/metamodel-manager/__tests__/metamodel-loader.test.ts`.
      It builds an `UploadedAssetSource` holding inline Turtle for these documents:
      `https://meta.linked.archi/basic/metamodel#` (`basicmm:Basic a arch:Metamodel` with
      `arch:modelConcepts <https://meta.linked.archi/basic>`, `arch:notationSet basicnot:BasicRectangleNotation`,
      `arch:presentationContextScheme <https://meta.linked.archi/basic/presentation-contexts#>` and
      `arch:conceptClassification <https://meta.linked.archi/basic/tax#>`), the ontology, the taxonomy, the
      rectangle notation document `https://meta.linked.archi/basic/notation#`, the bubble document
      `https://meta.linked.archi/basic/notation-bubble#`, and the presentation contexts (two contexts: one names
      the rectangle set, one the bubble set). Pass that source to `new N3MetamodelLoader(parser, store, source)`
      and call `loadMetamodelByIri('https://meta.linked.archi/basic/metamodel#Basic')`. Assert:
      `graphsByRole.notation` equals `['https://meta.linked.archi/basic/notation#', 'https://meta.linked.archi/basic/notation-bubble#']`;
      the bubble's status has `via: 'arch:usesNotationSet'`, `role: 'notation'` and `outcome: 'loaded'`;
      `loaded.notationSetIri` is still `…/basic/notation#BasicRectangleNotation`; quads exist in the bubble graph;
      the context that names the default set adds no second status for `…/basic/notation#`. A further case:
      a context naming an absent document yields one status with `outcome: 'unavailable'` and no throw.
      Files: `src/metamodel-manager/metamodel-loader.ts`, `src/metamodel-manager/__tests__/metamodel-loader.test.ts`
      Verify: `npx vitest --run src/metamodel-manager/__tests__/metamodel-loader.test.ts src/metamodel-manager/__tests__/palette-generator.test.ts` passes. The palette file holds the bundled ArchiMate 4.0 `graphsByRole.notation === [notation#]` assertion, which must stay green. `npm run typecheck` exits 0.

- [ ] 3. Extract the class-hierarchy helper and add the breadth-first walk (D3).
      Create `src/metamodel-manager/class-hierarchy.ts` with `NOTATION_ROOTS` (a `ReadonlySet` of
      `NAMESPACES.arch + 'Element'` and `NAMESPACES.arch + 'QualifiedRelationship'`), plus `buildSuperClassMap`
      and `closureOf` moved unchanged from `palette-generator.ts`. Bring their private `uniqueInOrder` dependency
      along, or keep a local copy. Add `superClassesNearestFirst` as specified in D3. Delete the moved functions
      from `palette-generator.ts` and import them. Create
      `src/metamodel-manager/__tests__/class-hierarchy.test.ts` (n3 `Parser` + `Store` from inline Turtle, as in
      `notation.test.ts` `storeFromTurtle`). Cover: a diamond `C ⊑ B, C ⊑ A, A ⊑ P, B ⊑ P, P ⊑ arch:Element`
      gives `[A, B, P, arch:Element]` with A before B even when B is declared first. A deeper superclass never
      precedes a nearer one. `arch:Element ⊑ arch:ModelConcept` is not walked past (ModelConcept absent).
      A cycle `X ⊑ Y ⊑ X` terminates. `superClassesNearestFirst(arch:Element)` is `[]`. `closureOf` behaviour is
      unchanged.
      Files: `src/metamodel-manager/class-hierarchy.ts` (new), `src/metamodel-manager/palette-generator.ts`, `src/metamodel-manager/__tests__/class-hierarchy.test.ts` (new)
      Verify: `npx vitest --run src/metamodel-manager` passes; `npm run typecheck` exits 0.

- [ ] 4. Add the layered notation resolver (D4). Depends on step 3.
      Create `src/metamodel-manager/notation-resolver.ts` with `NotationSource`, `ResolvedNotation`,
      `NotationIndexEntry`, `NotationResolver`, `orderedFallbackSets` and `storeDefaultNotationSetIris`, exactly as
      specified in D4. Read `arch:prefVisNotation` IRI-first as `palette-generator`'s `objectValue` does.
      Re-export the public types and functions from `src/metamodel-manager/index.ts`. Create
      `src/metamodel-manager/__tests__/notation-resolver.test.ts` with inline Turtle: an active set A, fallback
      sets F1 and F2, and classes under `arch:Element` and `arch:QualifiedRelationship`. Cover one case per step,
      each asserting `source`, `notationSetIri`, `matchedClassIri` and `prefVisNotation`:
      (1) exact in A;
      (2) no exact in A, with descriptors in A for the parent P and for `arch:Element` → P wins (nearest);
      two parents at equal distance both described → the lower IRI wins;
      (2 before 3) A has a superclass descriptor and F1 an exact one → `active-superclass`;
      (3) exact in F1 beats F1's superclass descriptor and C's own `prefVisNotation`;
      (load order) F1 and F2 both exact for C → F1 wins with `[F1, F2]` and F2 with `[F2, F1]`;
      (4) only C's own `prefVisNotation` and an F1 superclass descriptor → `pref-vis-notation`;
      (5) no own `prefVisNotation` → `fallback-superclass` naming the F1 set and the matched superclass;
      (6) nothing → `default`.
      Also cover: `orderedFallbackSets` drops the active IRI, duplicates and member-less sets;
      `storeDefaultNotationSetIris` returns metamodel-IRI order whatever the insertion order; and a relationship
      class resolved through `arch:QualifiedRelationship` carries `relationshipStyle` with `lineColor` undefined.
      Files: `src/metamodel-manager/notation-resolver.ts` (new), `src/metamodel-manager/index.ts`, `src/metamodel-manager/__tests__/notation-resolver.test.ts` (new)
      Verify: `npx vitest --run src/metamodel-manager/__tests__/notation-resolver.test.ts` passes; `npm run typecheck` exits 0.

- [ ] 5. Route the palette through the resolver and emit `notationIndex` (D5, D6 producer side). Depends on step 4.
      In `src/metamodel-manager/interfaces.ts`: add `defaultNotationSetIris?: readonly string[]` to `PaletteOptions`
      and `notationIndex?: Record<string, NotationIndexEntry>` to `PaletteDefinition`, both with doc comments.
      Import the type from `./notation-resolver.js`. In `palette-generator.ts`: extend `resolveNotationSet` with the
      `defaultNotationSetIris` step; build `superClassMap` once in `generatePalette`; build the fallback sets and a
      `NotationResolver`; pass the resolver into `toElementTypeInfo` and `discoverRelationships` in place of
      `notationSet`, using `resolved.notation` and `resolved.prefVisNotation`; extract `styleWithResolvedIcon`;
      build `notationIndex` per D6 and return it. `notationSetIri` and `notationSetLabel` still report the active
      set. Update the module doc comment with the six-step order.
      Add a `describe('notation fallback layering')` block to `src/metamodel-manager/__tests__/palette-generator.test.ts`.
      It uses the existing `TEST_METAMODEL` plus a second inline `loader.loadMetamodel` document: basic-like, with
      `basic:Node ⊑ arch:Element`, `basic:Association ⊑ arch:QualifiedRelationship`, a taxonomy naming both,
      `basicmm:Basic a arch:Metamodel ; arch:notationSet basicnot:BasicRectangleNotation`, a rectangle set with
      descriptors for `arch:Element` (fill and line set) and `arch:QualifiedRelationship` (`lineStyle`
      and `targetDecor`, no `lineColor`), a bubble set with an `arch:Element` descriptor, and a context naming the
      bubble set. Assert:
      - with `notationSetIri` = the rectangle set: the `basic:Node` palette style equals the rectangle Element
        descriptor style, and `notationIndex[basic:Node].source === 'active-superclass'`;
      - with the bubble context: `basic:Node` gets the bubble style;
      - `basic:Association.relationshipStyle.lineColor` is undefined;
      - with `defaultNotationSetIris: [ex:StandardNotation, BasicRectangleNotation]`: `ex:Process` keeps its exact
        style (`active`); `ex:Component` takes the rectangle Element style (`fallback-superclass`); `ex:Actor`
        keeps `style` undefined and its own `prefVisNotation` (`pref-vis-notation`, step 4 before step 5);
        `ex:Serving` keeps its exact style;
      - with the order reversed (`[BasicRectangleNotation, ex:StandardNotation]`, no context): the rectangle set is
        active. `ex:Process` (`⊑ ex:Element ⊑ arch:Element`, exact only in `ex:StandardNotation`) resolves to
        `active-superclass` with the rectangle Element style, because step 2 precedes step 3. This pins the
        specified order.
      Existing assertions in this file must pass unchanged.
      Files: `src/metamodel-manager/interfaces.ts`, `src/metamodel-manager/palette-generator.ts`, `src/metamodel-manager/__tests__/palette-generator.test.ts`
      Verify: `npx vitest --run src/metamodel-manager` passes, including the bundled ArchiMate 4.0 block (42 elements, every one styled) and `core-metamodel.test.ts`; `npm run typecheck` exits 0.

- [ ] 6. Make the canvas registry consult `notationIndex`, and pass load order from the UI (D6 consumer side, D7, D8). Depends on step 5.
      In `src/ui/canvas/notation-styles.ts`: store `paletteDefinition.notationIndex ?? {}` in `update()`.
      `styleFor` returns the palette entry style, then `index[iri]?.style`. `renderingModeFor` keeps the existing
      logic when a palette entry exists; otherwise it returns `entry.renderingMode ?? effectiveRenderingMode(entry.style)`
      for an index entry and `effectiveRenderingMode(undefined)` when there is none. `relationshipStyleFor`
      returns the palette entry, then `index[iri]?.relationshipStyle`. Update the file doc comment.
      In `src/ui/mount-ui.ts` `regeneratePalette`, pass `defaultNotationSetIris` per D7.
      Tests:
      - extend `src/ui/canvas/__tests__/notation-styles.test.ts`: the index styles a type absent from the palette;
        a palette entry wins over an index entry for the same IRI; an alias key styles a connection by predicate;
        an empty index changes nothing;
      - create `src/ui/canvas/__tests__/notation-fallback-integration.test.ts` (`// @vitest-environment jsdom`,
        harness from `render-harness.ts`, palette from `SparqlPaletteGenerator` over the basic-like inline fixture
        of step 5). Draw `basic:Node`: body `fill` and `stroke` equal the rectangle Element descriptor. Draw a
        class `⊑ arch:Element` that no taxonomy names: same style through the index. Draw a `basic:Association`
        connection: `stroke === '#000000'`, and `data-line-style`/`data-target-decor` match the descriptor. Draw
        a relationship type with no descriptor anywhere: `stroke === '#000000'`, `data-line-style === 'SolidLine'`.
      Files: `src/ui/canvas/notation-styles.ts`, `src/ui/mount-ui.ts`, `src/ui/canvas/__tests__/notation-styles.test.ts`, `src/ui/canvas/__tests__/notation-fallback-integration.test.ts` (new)
      Verify: `npx vitest --run src/ui/canvas` passes; `npm run typecheck` exits 0.

- [ ] 7. Update the living specs (D9).
      `.agents/specs/la-gram/requirements.md` Req 2: item 15 adds that the targets of the contexts'
      `arch:usesNotationSet` are loaded with the metamodel; item 16 becomes the six-step order (active exact →
      active nearest superclass, breadth-first, ties by IRI, ending at `arch:Element`/`arch:QualifiedRelationship`
      → other loaded metamodels' default sets, exact, in load order → the class's `arch:prefVisNotation` →
      those sets' nearest superclass → built-in defaults; relationships black unless a descriptor states a colour).
      `.agents/specs/la-gram/design.md:171`: the same order in one sentence, naming `notation-resolver.ts` and
      `class-hierarchy.ts`. `.agents/specs/la-gram/tasks.md`: add a checked line under the notation items (`:31-34`)
      naming the new tests.
      Files: `.agents/specs/la-gram/requirements.md`, `.agents/specs/la-gram/design.md`, `.agents/specs/la-gram/tasks.md`
      Verify: re-read the edited passages against D4 (order and wording identical); no code impact.

- [ ] 8. Full verification and report.
      Run `npm run typecheck` (exit 0), `npm test` (all files pass, with the count at least 1285 plus the new
      tests) and `npm run build:web` (exit 0). There is no linter; report that the typecheck is the static check.
      Optional: an inline scratch script under `/tmp`, deleted afterwards, may run loader and palette on the step-2
      fixtures and print `notationIndex` sources. Then run `git status --short` and confirm:
      - only the files named in steps 1–7 changed, plus the untracked `.agents/` folder;
      - nothing under `assets/` or `bundled-assets*` changed, and nothing is staged (`git diff --cached` empty);
      - HEAD is still `36f0a448ae54a38a13e115ab231d84bc8023908f`.
      Report the changed-file list as uncommitted and ready for review, and list the "Interpretations to report".
      Files: none
      Verify: the commands above, with the stated outcomes.
