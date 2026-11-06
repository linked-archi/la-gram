# Notation fallback follow-up: report

First iteration (no `review.json` in this task folder). Built on the previous run's uncommitted working tree in `tools/modellers/la-gram`; none of its changes were reverted except where this brief changes them.

## The order change and why

`NotationResolver.lookup` (`src/metamodel-manager/notation-resolver.ts`) now runs, for class C and active set A:

1. a descriptor in A for C → `active`
2. a descriptor for C in another loaded metamodel's default set, load order → `fallback`
3. C's own `arch:prefVisNotation` → `pref-vis-notation`
4. a descriptor in A for C's nearest superclass (breadth-first, ties by IRI, stop at `arch:Element` / `arch:QualifiedRelationship`) → `active-superclass`
5. a descriptor for C's nearest superclass in those default sets, sets outside and distance inside → `fallback-superclass`
6. built-in defaults (white rectangle with black line; solid black line) → `default`

Before, the active set's superclass step came second. With Basic's set active (Basic primary, or a Basic context chosen), every ArchiMate class matched Basic's `arch:Element` / `arch:QualifiedRelationship` descriptor before its own exact descriptor. That gave `am4:BusinessActor` Basic's rectangle and turned `am4:Composition` into `NoDecoration → OpenArrowhead`, which erased the line-style and arrowhead differences relationships are told apart by (review finding 1). Now anything published for the class itself (steps 1 to 3) beats anything it would inherit (steps 4 and 5), and among equals the chosen set comes first.

The superclass list is computed only after step 3. `NotationSource` keeps its values; only their order and numbering changed. Both pinned interpretations stay as they were, with no change to `orderedFallbackSets` or the inner loop:

- a context-chosen alternative set keeps its own metamodel's default set as a fallback layer;
- step 5 loops over the sets outside and superclass distance inside.

## Files changed in this step

All under `tools/modellers/la-gram`, line counts against a snapshot taken before this step.

- `src/metamodel-manager/notation-resolver.ts` (+31 −25): reordered lookup. The header lists the new six steps and the "specific beats generic; chosen set first among equals" rule. `NotationSource` and `ResolvedNotation.prefVisNotation` docs are renumbered. The guide sentence now says the guide "is meant to document this order; it is updated separately". I did not use the plan's "documents this order": the guide's Fallback Logic still lists three steps, so that wording would repeat the false claim from review finding 4.
- `src/metamodel-manager/__tests__/basic-fixture.ts` (+188 −98): reshaped to the real Basic files. It mirrors their IRIs and labels, with no prose:
  - contexts `ModellerContext` (rectangle set) and `WorkshopContext` (bubble set); exports renamed to `MODELLER_CONTEXT` / `WORKSHOP_CONTEXT`, with every importer updated;
  - both sets carry `arch:Element`, `arch:QualifiedRelationship`, `basic:Association` (SolidLine, NoDecoration at both ends) and `basic:Aggregation` (SolidLine, HollowDiamond source, NoDecoration target), and no relationship descriptor states a colour;
  - the ontology adds the qualified properties and uses the real labels (`SpecialNode`, `GroupNode`);
  - the manifest adds `BasicFramework`, `basedOnFramework` and `versionInfo`;
  - the taxonomy's axis `basictax:BasicConcepts` wraps `Elements` and `Relationships`, which list the classes;
  - one `notationDocument` helper builds both sets, so they differ only in geometry and image base;
  - new style constants `GENERIC_RELATIONSHIP_STYLE`, `ASSOCIATION_STYLE` and `AGGREGATION_STYLE`;
  - the header comment describes exactly this shape.
- `src/metamodel-manager/__tests__/notation-resolver.test.ts` (+224 −38):
  - Titles are renumbered.
  - "2 before 3" is flipped to "2 before 4": an exact fallback descriptor beats the active set's superclass one.
  - New "3. own image before any superclass descriptor", with a new `ex:Pictured` whose parent is described by the active set.
  - New "4 before 5": the active set's farther superclass descriptor beats a nearer fallback one.
  - New block "Basic active beside ArchiMate 4.0". It loads the fixture Basic and then bundled ArchiMate 4.0 through the loader and builds resolvers for each Basic context as the palette does.
  - That block pins: `am4:Composition` → `fallback`, FilledDiamond → NoDecoration; `am4:BusinessActor` → `fallback`, `#FFFFB5`, ShapeWithBadge, actor glyph; `basic:Node` → `active-superclass`, rectangle (Modeller) and circle (Workshop); `basic:Association` and `basic:Aggregation` → `active` with their exact lines and no colour.
- `src/metamodel-manager/__tests__/palette-generator.test.ts` (+62 −21):
  - context renamed;
  - the Association test now expects its own descriptor (`active`, no decorations) and adds Aggregation (HollowDiamond);
  - the "test language first" comments are renumbered and a Basic Aggregation `fallback` check is added;
  - "with Basic first … (step 2 before 3)" is flipped: Process and Serving keep the other language's descriptors (`fallback`), Actor keeps its own image, and Component and Composition take Basic's generic descriptors (`active-superclass`).
- `src/ui/canvas/__tests__/notation-fallback-integration.test.ts` (+40 −11):
  - header updated, context renamed;
  - Association is drawn plain (no markers), Aggregation with a `marker-start` hollow diamond;
  - a new unlisted relationship class `Linking` gets the generic open arrowhead.
- `src/ui/mount-ui.ts` (+27 −15): review issue 3.
  - One `NotationStyleRegistry` (`lookStyles`) is refreshed with `update(palette)` at the only `currentPalette` reassignment.
  - `graphLook` reads the palette entry, else `notationIndex`: colour and icon for elements, line style and decorations for relationships. Labels stay the palette's, else `labelOf`.
  - A type the palette lists as a relationship stays on the relationship branch, so listed types behave exactly as before. I parsed all 14 bundled and published notation files, and none mixes element and relationship properties in one descriptor; the guard costs one line.
  - `sizeOf` takes the first `styleFor` over the element's types, else `NOTATION_DEFAULTS`.
- `src/ui/__tests__/mount-ui.test.ts` (+137 −0): "notation look outside the canvas (Req 2.16)", driving the real `mountUi` with a palette that carries a `notationIndex`:
  - an unlisted class gets the bubble set's colour in the Graph look;
  - `arch:QualifiedRelationship` gets the index's line and decorations;
  - palette entries win over the index, and a listed relationship stays a relationship;
  - a `graph-new-view` places the unlisted element at 80 × 80, not 120 × 55.
- `src/metamodel-manager/palette-generator.ts` (+5 −3), `src/ui/canvas/notation-styles.ts` (+5 −4), `src/metamodel-manager/interfaces.ts` (one doc comment, +3 −2): comments that listed the old order.
- `.kiro/specs/la-gram/requirements.md` (Req 2.16), `design.md` (palette-generation paragraph), `tasks.md` (the notation-fallback task line; `mount-ui.test` added): the new order and its rule. The black-relationships sentence is kept.

`metamodel-loader.test.ts` needed no change. No file was added or removed. `notation-look.ts` was not needed, because the mount-ui harness can set a palette with an index.

## Item 5: flat-axis robustness

Left `taxonomy.ts:326-327` unchanged, as the plan decided. Synthesising an axis per scheme would change palette grouping for every language. The data side is now fixed upstream: `linked-archi-meta/modelingLanguages/basic/basic-tax.ttl` was rewritten during this run (modified 20:24) with the axis `:BasicConcepts` wrapping `:Elements` and `:Relationships`. The fixture mirrors that shape. I only read the file.

## Order-pinning check

I swapped in the pre-step resolver temporarily and ran the resolver and palette tests. Exactly the 7 order-pinning tests failed: "2 before 4", "3. … before any superclass descriptor", the four am4 Composition and BusinessActor cases, and "with Basic first …". The pre-step `mount-ui.ts` failed the 3 new look and size tests; the palette-precedence test passes on both, as a regression guard should. Both files were restored, and the final gate below ran on them.

## Verification

Run sequentially in `tools/modellers/la-gram`, after the last code change:

```
$ npm run typecheck
> la-gram@0.1.0 typecheck
> tsc --noEmit
(exit 0)

$ npm test
> la-gram@0.1.0 test
> vitest --run
 Test Files  76 passed (76)
      Tests  1357 passed (1357)
   Duration  17.51s
(exit 0)

$ npm run build:web
  WARNING in asset size limit: … exceed the recommended size limit (244 KiB).
  WARNING in entrypoint size limit: … exceeds the recommended limit (244 KiB).
  web (webpack 5.105.4) compiled with 2 warnings in 7987 ms
(exit 0)
```

The previous run's gate counted 1342 tests; this step adds 15: 9 resolver, 4 mount-ui, 2 integration. The two webpack warnings are the pre-existing bundle-size warnings, and `dist/` is git-ignored.

## End-to-end check

Skipped. The condition is not met: `linked-archi-meta/.agents/tasks/basic-asset-set-and-edgy/review.json` does not exist (last checked 20:43:07; that folder holds only `plan.md`). The concurrent run was still editing the Basic files during this step, so the real-file run belongs after its review approves them.

## Git state

- HEAD `36f0a448ae54a38a13e115ab231d84bc8023908f`, unchanged.
- `git diff --cached` is empty, and `git stash list` is empty.
- `git status --short` lists the same entries as at the start: 14 modified, 7 untracked files plus `.agents/`.
- `assets/`, `bundled-assets.ts` and `bundled-assets.test.ts` show no change.
- Nothing was written to `linked-archi-meta`, `_la-web` or `.agents/tasks/notation-fallback/`; the commands there were reads only.
- Temporary files under `/tmp` (the pre-step snapshot, test and build logs) are deleted.

Nothing committed or staged.
