# Implementation Plan: notation fallback follow-up

Repo: `linked.archi/tools/modellers/la-gram` (use absolute paths). Branch `spec-alignment`, HEAD must stay `36f0a448ae54a38a13e115ab231d84bc8023908f`.
Rules: no commit/stage/push/stash/add; `git diff --cached` empty at the end. Do not touch `assets/`, `bundled-assets.ts`, `bundled-assets.test.ts`, `linked-archi-meta/`, `_la-web/`, or `.agents/tasks/notation-fallback/`. No new deps. Tests: `npx vitest --run <path>` (never watch). Full gate: `npm run typecheck && npm test && npm run build:web`.
The previous run's working-tree changes stay; build on them.

Decisions:
- Lookup order: exact-class steps before any superclass step (anything specific to the class beats any generic descriptor; ties go to the chosen set). `NotationSource` values keep their names; only their order and numbering change.
- Issue 3: mount-ui gets one `NotationStyleRegistry` of its own (`lookStyles`), refreshed with `update(currentPalette)` wherever `currentPalette` is reassigned. That reuses the palette-then-index logic already tested in `notation-styles.ts` rather than duplicating it, and avoids coupling to a canvas instance that may not exist when the Graph tab or new-view sizing runs.
- Item 5 (flat axis): leave `taxonomy.ts:326-327` unchanged. The data side gets fixed upstream, and a per-scheme synthesis changes palette grouping for every language. Report this decision in the final summary.

- [ ] 1. Reorder `NotationResolver.lookup` in `src/metamodel-manager/notation-resolver.ts`.
      New body order: (1) `this.active` exact → `exactMatch('active', …)`; (2) loop over `this.fallbacks` exact → `'fallback'`; (3) `own` → `'pref-vis-notation'`; (4) `nearestIn(this.active, superClasses)` → `'active-superclass'`; (5) loop over fallbacks outside, `nearestIn` (superclass distance) inside → `'fallback-superclass'`; (6) `'default'`. Compute `superClasses` only after step 3. Rewrite the header comment (lines ~9-24) to the new six steps plus the "specific beats generic; chosen set first among equals" rationale. Keep the two pinned interpretations: a context-chosen alternative set keeps its own metamodel's default as a fallback layer (no change to `orderedFallbackSets`), and sets-outside/distance-inside for step 5. Replace the guide sentence at lines 23-24 with: "The visual notation guide in `linked-archi-meta` documents this order; it is updated separately." Renumber the `NotationSource` doc comments and the `ResolvedNotation.prefVisNotation` comment (exact = 1, 2; inherited = 4, 5; own image = 3).
      Files: src/metamodel-manager/notation-resolver.ts
      Verify: `npm run typecheck` is clean. Resolver tests are expected to fail on the old-order cases until item 2.

- [ ] 2. Update and extend `src/metamodel-manager/__tests__/notation-resolver.test.ts`.
      Renumber the test titles to the new steps. Flip the old order tests: '2 before 3' becomes "an exact fallback descriptor beats the active set's superclass descriptor" (expect `source: 'fallback'`), and '4 before 5' becomes "the class's own image beats the active set's superclass descriptor" (a class with `prefVisNotation`, no exact descriptor anywhere, an active-set descriptor on its parent, expects `'pref-vis-notation'`). Keep the tie-by-IRI, load-order, sets-outside and no-active-set tests. Add Basic-fixture-based tests that load Basic plus bundled ArchiMate 4.0 into one store and build the resolver with Basic's set active (follow the setup in `src/ui/canvas/__tests__/notation-fallback-integration.test.ts`; if that is heavy, put these cases there instead):
      - `am4:Composition` resolves with `source 'fallback'` and keeps its `FilledDiamond` source decoration;
      - `am4:BusinessActor` resolves with `source 'fallback'` from the ArchiMate set (its style, not Basic's rectangle);
      - `basic:Node` resolves to the active set's `arch:Element` descriptor (`active-superclass`): rectangle with the rectangle set (ModellerContext), circle with the bubble set (WorkshopContext);
      - `basic:Association` and `basic:Aggregation` resolve `active` to their exact descriptors (Aggregation: HollowDiamond source, NoDecoration target; neither has a colour).
      Look up the exact am4 IRIs, the decoration property names and the shape values in `src/metamodel-manager/notation.ts` and the bundled ArchiMate 4.0 notation (read-only).
      Files: src/metamodel-manager/__tests__/notation-resolver.test.ts (and possibly src/ui/canvas/__tests__/notation-fallback-integration.test.ts)
      Depends on: items 1 and 3 (the Basic cases need the reshaped fixture). Do item 3 before writing them.
      Verify: `npx vitest --run src/metamodel-manager src/ui/canvas` passes.

- [ ] 3. Reshape `src/metamodel-manager/__tests__/basic-fixture.ts` to the real Basic files.
      Read the real files first (read-only): `linked.archi/linked-archi-meta/modelingLanguages/basic/{basic-onto,basic-tax,basic-notation,basic-presentation-contexts,basic-metamodel}.ttl` and `notation-bubble/basic-notation-bubble.ttl`. Mirror their IRIs where they exist, and copy no prose verbatim beyond IRIs and labels. Required shape:
      - presentation contexts `ModellerContext` (rectangle set) and `WorkshopContext` (bubble set). Rename the `RECTANGLE_CONTEXT`/`BUBBLE_CONTEXT` values (keep the export names, or rename them and update every importer);
      - ontology classes include `basic:Node` (⊂ arch:Element), `basic:Association` and `basic:Aggregation` (⊂ arch:QualifiedRelationship), plus whatever the existing tests use;
      - both sets carry descriptors for `arch:Element`, `arch:QualifiedRelationship`, `basic:Association` (SolidLine, NoDecoration at both ends) and `basic:Aggregation` (SolidLine, HollowDiamond source, NoDecoration target). Relationship descriptors carry no colour;
      - the taxonomy has an axis concept wrapping group concepts that list the classes.
      Rewrite the header comment to describe exactly this shape. Then fix fallout in the importers: grep for `basic-fixture` under `src/`, which covers loader, palette, catalogue, notation-styles and mount-ui tests.
      Files: src/metamodel-manager/__tests__/basic-fixture.ts plus the importing tests
      Verify: `npm test` passes, except the old-order resolver cases that item 2 addresses (do 1 → 3 → 2, then run the full suite).

- [ ] 4. Route `graphLook` (~line 885) and `sizeOf` (~line 978) in `src/ui/mount-ui.ts` through a `NotationStyleRegistry`.
      Import `NotationStyleRegistry` from `./canvas/notation-styles.js`. Create `const lookStyles = new NotationStyleRegistry(currentPalette)` next to the `currentPalette` declaration, and call `lookStyles.update(currentPalette)` at every reassignment of `currentPalette` (grep `currentPalette =`).
      - `graphLook`: when `lookStyles.elementType(typeIri)` exists or `styleFor` returns a style, use `labelFor(typeIri) ?? labelOf(store, typeIri)`, `styleFor().fillColor` and an icon from `iconHref(style.iconSymbol, assetUrl)`. Keep the existing `element.iconSymbol?.url` fallback by checking the palette entry first, as today. Otherwise use `relationshipStyleFor(typeIri)` for lineStyle/sourceDecor/targetDecor with the same label rule. Otherwise use `{ label: labelOf(store, typeIri) }`.
      - `sizeOf`: for each rdf:type, take the first `lookStyles.styleFor(type)` that is defined, then fall back to `NOTATION_DEFAULTS`.
      Check `VisualStyle` and the registry method signatures in `notation-styles.ts` and `notation.ts` before writing.
      Add tests in `src/ui/__tests__/mount-ui.test.ts`, following its existing harness: a class absent from the palette but present in `notationIndex` (e.g. a Basic class with the bubble set active) gets the 80×80 default size and the index colour from the Graph look. A relationship absent from the palette gets the index line style and decorations. If driving `mount-ui` is impractical, extract `graphLook`/`sizeOf` as pure helpers (`src/ui/notation-look.ts`, taking `(registry, store, assetUrl)`) and unit-test them in `src/ui/__tests__/notation-look.test.ts`. Choose extraction if the mount-ui harness cannot set a palette with a `notationIndex`.
      Files: src/ui/mount-ui.ts, src/ui/__tests__/mount-ui.test.ts (or new notation-look.ts + test)
      Verify: `npx vitest --run src/ui` passes; `npm run typecheck` is clean.

- [ ] 5. Update the spec text to the new order.
      In `.agents/specs/la-gram/requirements.md` line ~84 (Req 2.16), rewrite the sequence as: (1) active set for C → (2) other loaded metamodels' default sets for C, load order → (3) C's own prefVisNotation → (4) active set for C's nearest superclass (BFS, IRI ties, stop at arch:Element / arch:QualifiedRelationship) → (5) default sets for nearest superclass, sets in load order outside, distance inside → (6) built-in defaults. Add the rule "anything specific to the class beats any generic descriptor; among equals the chosen set comes first" and keep the black-relationships sentence. In `.agents/specs/la-gram/design.md` lines ~171-177, apply the same order. Grep both files and `.agents/specs/la-gram/tasks.md` for other order listings ("nearest superclass", "prefVisNotation", "six steps") and align them.
      Files: .agents/specs/la-gram/requirements.md, design.md (tasks.md if it lists the order)
      Verify: `npm test` passes; reread the edited paragraphs against item 1's code order.

- [ ] 6. Final gate.
      Run `npm run typecheck && npm test && npm run build:web`; all must pass. Confirm `git rev-parse HEAD` = 36f0a448ae54a38a13e115ab231d84bc8023908f, `git diff --cached` is empty, and `git status --short assets src/**/bundled-assets*` shows nothing new. Delete any /tmp files. Report the touched files, uncommitted, and the item-5 flat-axis decision (left as-is, with the reason).
