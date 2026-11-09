# Basic notation discovery and six-step notation fallback in la-gram

la-gram can now find the Basic asset set and style any class through one layered notation lookup. Basic joins the hand-maintained Metamodels catalogue as a modelling language. The manifest loader now also loads the notation sets that presentation contexts name with `arch:usesNotationSet`, so Basic's bubble set arrives with the metamodel. A new `NotationResolver` applies the six specified steps over a breadth-first superclass walk (ties broken by IRI, stopping at `arch:Element` / `arch:QualifiedRelationship`). The palette entries and a new `notationIndex` both come from that resolver, and the canvas reads the index for types the palette does not list. Relationship descriptors carry no colour, so connections draw black.

Watch for:

- When Basic's set is active, every other loaded language takes Basic's generic look, and ArchiMate relationships lose their diamonds and arrowheads. This is a consequence of the specified order (confirmed).
- With ArchiMate 4.0 loaded, Basic's element types are missing from the palette: the real `basic-tax.ttl` is flat, and the test fixture is not (confirmed; the root cause predates this change).
- Two `mount-ui.ts` lookups ignore the new index (confirmed, minor).
- The notation guide still documents the old three steps (confirmed, minor).

**Verdict**: APPROVED

## High-level view

Basic is reachable two ways. The catalogue has an entry for `https://meta.linked.archi/basic/metamodel#Basic` (label "Basic", kind `language`, the same fields as its neighbours). The loader reads `arch:usesNotationSet` back from each presentation-contexts graph it loads and queues the targets like manifest references. Dedup by document means a context naming the default set adds nothing, and `LoadedMetamodel.notationSetIri` stays the manifest's `arch:notationSet`. The ArchiMate 3.2, ArchiMate 4.0 and C4 contexts in `linked-archi-meta` name only their own default sets, so those languages fetch nothing new. I loaded the concurrent run's uncommitted Basic files by the catalogue IRI. That pulls in Basic's six documents and the two core imports, with the bubble set arriving via `arch:usesNotationSet`. Until the manifest is published, the menu entry reports a load error; the report states this trade-off.

The order lives only in `NotationResolver.lookup` and matches the brief step for step. The brief leaves two readings open; the report explains both and tests pin them:

- an alternative set chosen by a context keeps its own metamodel's default as a fallback layer;
- step 5 loops over the sets on the outside and superclass distance on the inside.

`NotationStyleRegistry` answers from the palette entry, else from `notationIndex`. Both come from the same memoised resolver, so the render path cannot disagree with the palette. Two consumers in `mount-ui.ts` bypass the registry and still read palette entries only: new-view sizing and the Graph tab's type look.

The specified order has a visible cost when Basic's set is active, meaning Basic is the primary metamodel or a Basic context is chosen. Every other loaded language's elements and relationships then match Basic's `arch:Element` / `arch:QualifiedRelationship` descriptors at step 2, before their own exact descriptors at step 3. The startup flow keeps ArchiMate 4.0 active and is not affected.

Basic's own element types drop out of the palette whenever another language contributes taxonomy axes. la-gram synthesises an axis for a flat taxonomy only when no other axis exists, and Basic's is the only flat taxonomy published. The fixture's taxonomy has an axis wrapper, so no test sees the gap. The notation index still styles Basic shapes on the canvas.

The resolver's header says the notation guide in `linked-archi-meta` carries the same order (`notation-resolver.ts:23-24`). The guide's Fallback Logic (`doc/guide/visual-notation-guide.md:56-60`) still lists the old three steps, while la-gram's Req 2.16 now lists six (confirmed). The concurrent run plans the guide update as its item 1.10.

Re-verified for the gate:

- Typecheck is clean.
- Three full test runs passed (76 files, 1342 tests).
- `npm run build:web` and `npm run build` both succeed.
- HEAD is unchanged at `36f0a448`, and nothing is staged.
- `assets/`, `bundled-assets.ts` and its test are untouched.
- No Basic or bundled ArchiMate relationship descriptor states a colour, so connections draw `#000000`.

<details>
<summary>Issues (4)</summary>

1. **Basic-active override of other languages** — With Basic's set active (Basic primary, or a Basic context chosen), step 2 gives every other loaded language's elements and relationships Basic's generic look and flattens ArchiMate's relationship notation (confirmed, non-blocking; follows the brief). Decide whether that is intended. If it is not, change the order in the spec. Either way, pin the relationship case with a test.
2. **Basic elements missing from the palette next to another language** — `taxonomy.ts:326-327` synthesises a flat axis only when the store has no axis at all. The real `basic-tax.ttl`, the only flat published taxonomy, therefore contributes no palette entries once ArchiMate 4.0 is loaded (confirmed, non-blocking; the root cause predates this change). Give `basic-tax.ttl` an axis concept as every other taxonomy has, or synthesise a flat axis per scheme in la-gram. Then reshape `basic-fixture.ts` to match the real files.
3. **Palette-only sizing and Graph look** — `sizeOf` (`mount-ui.ts:978`) and `graphLook` (`mount-ui.ts:885`) ignore `notationIndex`. Classes the palette does not list get 120×55 boxes in new views, and no colour or line style in the Graph tab (confirmed, non-blocking). Read both through `NotationStyleRegistry` or the index.
4. **Guide still documents three steps** — `notation-resolver.ts:23-24` says the guide carries the same order, but `visual-notation-guide.md:56-60` has the old three steps (confirmed, non-blocking). Land the concurrent guide update with this change, or reword the comment.

</details>

<details>
<summary>Details</summary>

### How the pieces connect

```
manifest ─► N3MetamodelLoader ─► store (one named graph per document)
               └─ presentationContexts loaded ─► queue arch:usesNotationSet targets
                                                  (dedup by document; default set not repeated)

regeneratePalette (mount-ui) ── defaultNotationSetIris: loaded metamodels' arch:notationSet, load order
   └─► generatePalette
         ├─ active set:  notationSetIri → context → first default with descriptors → store default
         ├─ fallbacks:   the other defaults in load order (active and repeats dropped)
         └─ NotationResolver (memoised; one superClassMap shared with relationship discovery)
               ├─► palette entries: style, relationshipStyle, prefVisNotation
               └─► notationIndex: every class, both roots, unqualifiedForm aliases

NotationStyleRegistry: palette entry, else notationIndex ─► RdfRenderer, DiagramCanvas sizing
mount-ui sizeOf / graphLook: palette entries only
```

### Basic's generic descriptors win over other languages when Basic is active

I ran a scratch script against the real Basic files, with Basic loaded first and the bundled ArchiMate 4.0 after it. `regeneratePalette` passes `[BasicRectangleNotation, ArchiMate40StandardNotation]`, so the rectangle set is active. All 42 ArchiMate elements resolve to `active-superclass` through `arch:Element`, and all 11 relationship types through `arch:QualifiedRelationship`. Two examples:

- `am4:BusinessActor` turns from `#FFFFB5` into Basic's `#E8F0EA` `ShapeOnly` rectangle, with Basic's `element.svg` as its palette image.
- `am4:Composition` changes from `FilledDiamond→NoDecoration` to `NoDecoration→OpenArrowhead`.

That erases the line-style and arrowhead differences the user named as the way relationships are told apart. Choosing a Basic context while ArchiMate is loaded has the same effect.

The resolver follows the brief exactly (`notation-resolver.ts:127-160`). `palette-generator.test.ts:506` pins the element case; nothing pins the relationship case. The coder cannot change this without departing from the brief, so it does not block this loop; it is a spec question. Two alternative orders would avoid it:

- consult other metamodels' exact descriptors (step 3) before the active set's superclass descriptors (step 2);
- apply step 2 only to classes of the active set's own metamodel.

### Basic's elements drop out of the palette next to ArchiMate

`buildClassificationAxes` treats a concept as an axis only when its children are groups that list members. A taxonomy without that wrapper gets a synthesised "Classification" axis, but only when `axes.length === 0` across the whole store (`taxonomy.ts:326-327`). The real `basic-tax.ttl` is flat: its top concepts `:Elements` and `:Relationships` list the classes directly. The concurrent run wrote it after the coder finished. Every other `*-tax.ttl` in `linked-archi-meta` yields a real axis under la-gram's rules, so Basic is the only one affected. Scratch runs against the real files:

```
Basic alone                         axes ["Classification"]                         Node, SpecialNode, GroupNode listed
ArchiMate 4.0 + Basic               axes ["Element by Domain","Element by Aspect"]  no Basic element listed
ArchiMate 4.0 + Basic, axis added   axes ["Basic Concepts", …]                      Node, SpecialNode, GroupNode listed
```

Adding Basic to a session that already has ArchiMate 4.0, the startup default, therefore offers no Basic element types to place. Switching to Basic alone works. Basic's relationship types are unaffected, because relationship discovery does not go through the taxonomy. The notation index still resolves `basic:Node` (`fallback-superclass`) for the canvas.

`basic-fixture.ts:118` wraps the fixture taxonomy in an axis concept "so Basic's elements reach the palette next to another language". The report does not raise the flat case as a limitation, and the fixture's header still says it is shaped like the published files. The taxonomy code is unchanged in this diff. The gap shows now because Basic is the first flat taxonomy the catalogue offers.

### Palette-only consumers outside the registry

`sizeOf` (`mount-ui.ts:978`) sizes elements for a view built from Graph-tab or SPARQL results. It looks types up only in `currentPalette.elementGroups`, and `placeNodes` writes the size into the new view's bounds, which `DiagramCanvas.addElement` keeps whenever they are non-zero. A class the palette does not list is therefore drawn at `NOTATION_DEFAULTS` (120×55), even when `notationIndex` resolves a style with its own default size, such as the bubble set's 80×80 circle (confirmed).

`graphLook` (`mount-ui.ts:885`) gives such a class no colour chip in the Graph tab, and an unlisted relationship type no line style or decorations (confirmed).

Neither function changed in this diff. Both now disagree with the canvas for exactly the classes the index was added for. The `DiagramCanvas` create and add paths go through the registry and already use the index.

### Test coverage

The 57 new tests cover what the brief asks for:

- a resolver case per step, asserting source, set, matched class and image;
- the tie-break, with parents declared in reverse IRI order so that store order and IRI order disagree;
- load order in both directions for steps 3 and 5, with "2 before 3" and "4 before 5" pinned;
- the root stop and cycles;
- the loader follow-up, including an unavailable target;
- registry precedence;
- a jsdom render asserting `stroke="#000000"`, the line style and the arrowhead marker.

Fixtures are inline Turtle served by `UploadedAssetSource`, with the bundle behind it for the core imports, so the tests need no network.

Not tested:

- the relationship side of the Basic-active override;
- the real flat Basic taxonomy next to another language;
- `sizeOf` and `graphLook` for a class the palette does not list;
- `loadDocument` uploads of a contexts file, which are out of scope per plan D2.

The fixture also differs from the real files in two smaller ways. Its contexts are `RectangleContext` and `BubbleContext`, where the real ones are `ModellerContext` and `WorkshopContext`. Its rectangle set has no `basic:Association` or `basic:Aggregation` descriptors.

### Verification and repository state

- **Typecheck.** `npm run typecheck` exited 0.
- **Tests.** `npm test` passed 76 files and 1342 tests on three runs (42 s, 35 s and 19 s). An earlier attempt, started in parallel with `tsc`, printed nothing before the tool's 600 s timeout. It did not recur and left no process behind, and nothing ties it to this change.
- **Builds.** `npm run build:web` exited 0 with webpack's two bundle-size warnings, as in the report. `npm run build` compiled web, electron-main and electron-renderer. `dist/` and `test-results/` are git-ignored.
- **Real Basic files.** Scratch `vite-node` scripts under `/tmp` loaded them read-only and were deleted afterwards.
  - `basic:Node`, `SpecialNode` and `GroupNode` resolve through `arch:Element`: rectangles, or circles in the Workshop context.
  - `basic:Association` and `basic:Aggregation` resolve to their exact descriptors.
  - No relationship carries a line colour.

Repository state:

- **la-gram HEAD and staging.** HEAD is `36f0a448ae54a38a13e115ab231d84bc8023908f`, as the plan recorded. `git diff --cached` is empty, and there is no stash.
- **la-gram working tree.** `git status --short` lists only unstaged modifications and untracked entries: 14 modified files, 7 new files and `.agents/`.
- **Bundled assets.** The diff over `assets/`, `bundled-assets.ts` and `bundled-assets.test.ts` is empty.
- **Other changes.** The plan recorded a clean tree at the start, so this task had no other change to disturb.
- **`linked-archi-meta`.** The only file written there between the plan and the report is the concurrent run's own plan. That run's Basic files came after the report.
- **`_la-web`.** Nothing there is newer than the plan.

</details>

<details>
<summary>Files changed</summary>

- `src/metamodel-manager/notation-resolver.ts` (new): `NotationResolver` (six steps), `orderedFallbackSets`, `storeDefaultNotationSetIris`, index entry type
- `src/metamodel-manager/class-hierarchy.ts` (new): `superClassesNearestFirst`, `compareIris`, `NOTATION_ROOTS`; `buildSuperClassMap` and `closureOf` moved here
- `src/metamodel-manager/palette-generator.ts`: resolver wiring, default-set step for the active set, `notationIndex`, `styleWithResolvedIcon`
- `src/metamodel-manager/metamodel-loader.ts`: `arch:usesNotationSet` follow-up and its role mapping
- `src/metamodel-manager/catalogue.ts`: Basic entry; the header now says the catalogue is maintained by hand
- `src/metamodel-manager/interfaces.ts`: `PaletteOptions.defaultNotationSetIris`, `PaletteDefinition.notationIndex`
- `src/metamodel-manager/index.ts`: resolver re-exports
- `src/ui/canvas/notation-styles.ts`: index fallback in `styleFor`, `renderingModeFor`, `relationshipStyleFor`
- `src/ui/mount-ui.ts`: passes the loaded metamodels' default sets in load order
- Tests:
  - new files: `catalogue.test.ts`, `class-hierarchy.test.ts`, `notation-resolver.test.ts`, `notation-fallback-integration.test.ts` and the shared `basic-fixture.ts`;
  - new blocks in `metamodel-loader.test.ts`, `palette-generator.test.ts`, `notation-styles.test.ts` and `mount-ui.test.ts`.
- `.agents/specs/la-gram/requirements.md`, `design.md`, `tasks.md`: Req 1.2 and 2.15–2.16, the palette-generation paragraph and one task line

Full diff: `git diff` in `tools/modellers/la-gram`, plus the untracked files that `git status --short` lists.

</details>
