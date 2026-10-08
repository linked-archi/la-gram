# Specific-before-inherited notation lookup, a Basic-shaped fixture and index-backed Graph look

`NotationResolver.lookup` now runs everything published for the class itself before anything it would inherit. That covers the active set's descriptor for C, another loaded metamodel's default-set descriptor for C and C's own `arch:prefVisNotation`; the superclass descriptors come after, active set first. With Basic's set active, ArchiMate classes therefore keep their own notation, while Basic's element classes still take the active set's rectangle or circle. `mount-ui.ts` now reads the Graph-tab look and new-view sizes through a `NotationStyleRegistry` of its own, so types the palette does not list get the index's answer there too. The test fixture now mirrors the real Basic files, and Req 2.16, `design.md` and `tasks.md` describe the new order.

Watch for:

- Req 2.16, `design.md` and the resolver header say steps 2 and 5 use "another loaded metamodel's" default set. The code also keeps the active context's own metamodel default (the pinned reading). EDGY's new Overview map context is the first data on which this changes the answer (confirmed, non-blocking).
- The ArchiMate-beside-Basic cases are pinned only on a resolver built by hand in the test, not through `generatePalette` or the canvas (confirmed, minor).

**Verdict**: APPROVED

## High-level view

The six steps in `notation-resolver.ts:132-163` match the brief exactly. That includes the breadth-first walk with IRI ties, ending at `arch:Element` / `arch:QualifiedRelationship`, and the superclass list is computed only after step 3. Step 6 leaves the renderer's existing built-ins in charge: a white rectangle with a black line, and a solid black line with no markers. With the old order restored in an isolated copy, exactly the seven order-pinning tests fail.

One resolver per palette feeds both the palette entries and `notationIndex`. The canvas reads them through `NotationStyleRegistry`. In `mount-ui.ts`, `lookStyles` is refreshed at the only `currentPalette` reassignment, and `graphLook` and `sizeOf` read through it. Against HEAD's `mount-ui.ts`, the three new look and size tests fail and the palette-precedence test passes.

`basic-fixture.ts` matches the brief and the real Basic files. `ModellerContext` names the rectangle set and `WorkshopContext` the bubble set. Association has no decoration at either end, Aggregation a hollow diamond at the source only, and no relationship descriptor states a colour. A scratch run through `generatePalette` on the real files beside ArchiMate 4.0 gives the same answers. The report had deferred that run.

The spec text follows the new order, but it does not say which default sets count as fallback layers when a context picks an alternative set. The code keeps that context's own metamodel default as a layer. EDGY's Overview map context is the first case where this changes the drawing.

All gates pass: typecheck, 76 files and 1357 tests, and `build:web` with webpack's two size warnings. HEAD is still `36f0a448`, and nothing is staged or committed. `assets/`, `bundled-assets.ts` and its test are untouched, and the build output contains no Basic file.

<details>
<summary>Issues (2)</summary>

1. **Unwritten fallback-layer rule** — Req 2.16, `design.md` and the resolver and palette-generator headers say steps 2 and 5 use another loaded metamodel's default set. `orderedFallbackSets` also keeps the active context's own metamodel default. With the reorder, that decides EDGY's Overview map look: `edgy:Metrics` and `edgy:Tagging` take the v2 descriptors where the literal text gives built-in defaults (confirmed, non-blocking). State the rule in those texts and pin it with a test in which the alternative set lacks a class its default describes. Then pass the same wording to the concurrent run's guide.
2. **ArchiMate-beside-Basic only at resolver level** — The `am4:Composition` / `am4:BusinessActor` cases build the resolver by hand in `inContext`. Nothing loads Basic and ArchiMate 4.0 through `generatePalette` or the renderer (confirmed, minor; a scratch run on the real files agrees). Optionally, add one palette-level assertion with Basic primary: Composition's `relationshipStyle` keeps `FilledDiamond`.

</details>

<details>
<summary>Details</summary>

### Lookup order in `NotationResolver.lookup`

```
step  code (notation-resolver.ts)                          NotationSource
1     this.active?.notations.get(C)                        'active'
2     for set of this.fallbacks: set.notations.get(C)      'fallback'
3     ownPrefVisNotation(graph, C)                         'pref-vis-notation'
      superClasses = superClassesNearestFirst(C, map)      (computed here, after 3)
4     nearestIn(this.active, superClasses)                 'active-superclass'
5     for set of this.fallbacks: nearestIn(set, ...)       'fallback-superclass'
6     (nothing)                                            'default'
```

The previous order was 1, 4, 2, 3, 5, 6. In a copy under `/tmp` with the old order restored, these tests fail and every other test passes:

- "2 before 4" and "3. … before any superclass descriptor";
- the four `am4:Composition` / `am4:BusinessActor` cases, one per Basic context;
- "with Basic first…".

Step 5 keeps the pinned loop, with sets in load order on the outside and superclass distance on the inside. The step-6 built-ins come from files this change does not touch: `NOTATION_DEFAULTS` in `notation-shapes.ts:34-41`, and the connection path in `rdf-renderer.ts:308-332`, which draws `#000000`, `SolidLine` and no markers.

### Fallback-layer membership is wider than Req 2.16 says

Req 2.16, the `design.md` paragraph, the resolver and palette-generator headers and the concurrent run's guide all describe steps 2 and 5 as using another loaded metamodel's default set. But `orderedFallbackSets` drops only the active set's IRI. So when a context picks an alternative set, that context's own metamodel default stays a layer at steps 2 and 5. This is the pinned reading from the previous loop, and the plan kept it on purpose.

The reorder is what makes it matter. Step 2 now runs before step 4, so an alternative set loses every class that its own metamodel's default describes exactly and the alternative does not. Under the old order, its superclass descriptors would have won those classes.

Basic does not show this: both its sets describe the same four classes. EDGY does. The concurrent run's uncommitted `edgy-presentation-contexts.ttl` gives the Overview map context the v1 set, and v1 has no descriptor for `edgy:Metrics` or `edgy:Tagging`.

A scratch load of those files shows both classes resolving `fallback` from the v2 default set, with fills `#16D917` and `#000000`. The other classes resolve `active` from v1. The two classes sit under `edgy:EnterpriseLabel ⊂ arch:ModelConcept`, and EDGY classes carry no `arch:prefVisNotation`, so under the literal text they would fall through to the built-in white rectangle.

v2's look is arguably the better answer, so the fix belongs in the text and a test, not the code. As it stands, the rule is unwritten, and no test pins it in a case where it decides the answer (confirmed).

### Basic and ArchiMate 4.0 on the real files

A read-only `vite-node` script under `/tmp` loaded two inputs: the real Basic files, served under the fixture's document IRIs, and then the bundled ArchiMate 4.0. It generated palettes the way `mount-ui` does:

```
scenario                        active set   am4 index sources                      Composition src decor   BusinessActor   basic:Node
Basic primary, no context       rectangle    fallback 64, active-superclass 19      FilledDiamond           #FFFFB5         Rectangle 120×60
Basic primary, Modeller         rectangle    fallback 64, active-superclass 19      FilledDiamond           #FFFFB5         Rectangle 120×60
Basic primary, Workshop         bubble       fallback 64, active-superclass 19      FilledDiamond           #FFFFB5         Circle 80×80
ArchiMate primary, Workshop     bubble       fallback 64, active-superclass 19      FilledDiamond           #FFFFB5         Circle 80×80
ArchiMate primary, no context   ArchiMate    active 64, fallback-superclass 19      FilledDiamond           #FFFFB5         Rectangle 120×60
```

The 19 inherited ArchiMate entries are abstract categories and the two junctions. None of them is a palette entry.

Three more results held in every scenario:

- Basic's Association and Aggregation kept their own lines.
- No relationship carried a colour.
- Basic's three element types were palette entries, even with ArchiMate primary. The real `basic-tax.ttl` axis has closed the earlier flat-taxonomy gap.

### Test coverage

The new and flipped tests pin every boundary the reorder moved:

- 2 before 4, 3 before 4 and 5, and 4 before 5, each on inline Turtle;
- both Basic contexts beside the bundled ArchiMate 4.0, for `am4:Composition`, `am4:BusinessActor`, `basic:Node`, `basic:Association` and `basic:Aggregation`;
- the palette-level "with Basic first" case, using the test language.

The Workshop-context Association case also pins 1 before 2. The `mount-ui` block drives the real `mountUi` with an index-carrying palette, and covers colour, line, palette precedence and the 80 × 80 new-view size.

Not tested:

- ArchiMate classes beside Basic through `generatePalette` or the renderer. The Basic block builds its resolver by hand in `inContext`, repeating the generator's choice of active set and fallback order. The generator's own wiring is pinned only with the test language.
- The fallback-layer membership where it decides the answer: an alternative set that lacks a class its own metamodel's default describes.

### Verification and repository state

Gates:

- `npm run typecheck` exited 0.
- `npm test` passed 76 files and 1357 tests, matching the report.
- `npm run build:web` exited 0 with the two webpack size warnings.

Mutation checks ran in a copy under `/tmp`, with `node_modules` and `assets` symlinked and only the copy edited:

- With the old resolver order, exactly the seven tests listed above failed.
- With HEAD's `mount-ui.ts`, the three new look and size tests failed. So did the previous loop's default-sets test, which HEAD predates. "keeps palette entries ahead of the index" passed.

Repository state:

- **HEAD and staging.** HEAD is `36f0a448ae54a38a13e115ab231d84bc8023908f`, and the reflog has no new entry. `git diff --cached` is empty, and there is no stash.
- **Working tree.** `git status --short` lists the same 14 modified files, 7 untracked files and `.agents/` as the report.
- **Bundled assets.** The diff over `assets/`, `bundled-assets.ts` and `bundled-assets.test.ts` is empty, and nothing is untracked under `assets/`. `bundled-assets.ts` has no Basic entry, and `dist/web/assets` holds only `archimate3`, `archimate4` and `core`.
- **`_la-web` and `notation-fallback/`.** Nothing under `_la-web` is newer than the plan. `.agents/tasks/notation-fallback/` was last written before the plan.
- **`linked-archi-meta`.** The files newer than the plan all fall in the scope of the concurrent `basic-asset-set-and-edgy` run: Basic and EDGY asset files, guides, redirects, the nginx config, the docgen index and that run's report. Timestamps cannot prove who wrote them. That run's uncommitted guide now lists the same six steps.

</details>

<details>
<summary>Files changed in this step</summary>

- `src/metamodel-manager/notation-resolver.ts`: the lookup order, its header and the step numbering in the `NotationSource` / `ResolvedNotation` docs.
- `src/ui/mount-ui.ts`: the `lookStyles` registry; `graphLook` and `sizeOf` read through it.
- `src/metamodel-manager/__tests__/basic-fixture.ts`: reshaped to the real Basic files, with `MODELLER_CONTEXT` / `WORKSHOP_CONTEXT` and the new line-style constants.
- `src/metamodel-manager/__tests__/notation-resolver.test.ts`: renumbered and flipped order tests, "4 before 5", and the Basic-beside-ArchiMate block.
- `src/metamodel-manager/__tests__/palette-generator.test.ts`: the Association/Aggregation expectations and "with Basic first" flipped.
- `src/ui/canvas/__tests__/notation-fallback-integration.test.ts`: the Association and Aggregation markers and the unlisted `Linking` class.
- `src/ui/__tests__/mount-ui.test.ts`: the "notation look outside the canvas" block.
- Comments only: `palette-generator.ts`, `notation-styles.ts` and `interfaces.ts`.
- `.kiro/specs/la-gram/requirements.md` (Req 2.16), `design.md` and `tasks.md`: the new order.

The pre-step snapshot was deleted, so this list comes from the report, checked against the current files. The full diff against HEAD also holds the previous loop's changes. It is `git diff` plus the untracked files in `git status --short`, run in `tools/modellers/la-gram`.

</details>
