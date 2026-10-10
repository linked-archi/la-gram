# Tasks: la-gram

Organised like the `la-modeller-excalidraw` task list, so the two can be read
side by side; ticks reflect la-gram as it is. `(Req n.m)` points at
`requirements.md`. Tests named in *italics* cover the task.

---

## Phase 0: Foundation

### Task 1: Metamodel loading (Req 1)
- [x] Load the default metamodel (ArchiMate 4.0) at startup; `?metamodel=` for others
- [x] Parse the manifest; follow `arch:*` asset properties and `owl:imports` — *metamodel-loader.test*
- [x] Load a level of references in parallel, `Accept: text/turtle` only — *asset-sources.test*
- [x] Asset source chain: uploaded → bundled → remote; `?assets=` modes — *asset-sources.test*
- [x] Native bulk load into Oxigraph (13× faster on the relationship shapes)
- [x] Per-document status (loaded / already-loaded / skipped / unavailable / error, origin, triples); "Show loaded assets"
- [x] Skip documents the editor cannot use (derivation rules, templates, reference data)
- [x] Built-in catalogue of the 25 published metamodels (no endpoint exists) — `catalogue.ts`
- [x] Add a metamodel; switch to one (replace); unload one — *workbench.test*
- [x] Load by IRI; upload a manifest or an individual asset (role inferred) — *asset-sources.test*
- [x] Several metamodels at once; palette, rules and validation use the union
- [x] Bundle ArchiMate 4.0 and 3.2 with core, core-vis and their shapes; icons for both offline
- [x] Remote metamodel verified live in the browser (C4, 9 documents) — *workbench.spec*
- [ ] Publish a machine-readable catalogue on meta.linked.archi and read it instead of the built-in list

### Task 2: Palette (Req 2)
- [x] Dual classification (SKOS for grouping, OWL for instantiation); abstract classes excluded
- [x] Labels and definitions with fallbacks; several axes with a "Group by" selector
- [x] Relationship types in the palette; picking one arms connect with that type
- [x] Visual notation from `arch-vis:NotationSet`; three rendering modes; icons in the palette
- [x] Filter by the open view's viewpoint — *workbench.test*
- [x] Outside-viewpoint shapes greyed, not hidden — *view-canvas.test*
- [x] Presentation-context selector; palette and canvas follow the context's notation set
- [x] Notation fallback: superclass walk and other metamodels' default sets, one five-step lookup (the class's own descriptors and image before inherited ones; the nearest ancestor among inherited ones) for palette, canvas, Graph tab and new-view sizes; `arch:usesNotationSet` targets loaded; Basic in the catalogue — *class-hierarchy.test, notation-resolver.test, palette-generator.test, notation-styles.test, notation-fallback-integration.test, mount-ui.test, metamodel-loader.test, catalogue.test*
- [x] OWL-only fallback when there is no taxonomy
- [ ] Show a notice when the OWL-only fallback is in use

### Task 3: Elements (Req 3)
- [x] Drag or click-to-place from the palette; element minted inside the create command
- [x] UUID IRIs; `rdf:type`, `skos:prefLabel`@en, `arch:inModel`; node in the open view — *element-manager.test*
- [x] Undo/redo restores the same IRI — *view-canvas.test*
- [x] Property panel: kind, type, IRI, SHACL-derived fields, add/remove values
- [x] Field order: ID, type, `inModel`, `prefLabel`, `definition` (name and definition always listed), then the rest (added properties); no `inView` rows
- [x] Vertical tabs: information, properties (+ add field), analysis, appears in views; counts; Up/Down; open tab remembered — *property-panel.test, workbench.test, workbench.spec*
- [x] Property picker: grouped by applicability (domain / shapes), used in model, documentation, More (folded); no geometry / styling / authoring terms; name first, CURIE second; custom names in the model namespace — *property-catalog.test, property-picker.test, workbench.test, workbench.spec*
- [x] Delete from view (default) vs. delete from model (confirmation lists views) — *view-canvas.test, workbench.spec*
- [x] Delete from model cascades to relationships and every view, undoable in one step — *view-canvas.test*
- [x] Inline label editing on the canvas (double-click, F2) — see Phase 5, Rename on the canvas

### Task 4: Relationships (Req 4)
- [x] Connect from the context pad or the toolbar; rules from domain/range (closure-aware)
- [x] Permitted relationships from the metamodel's relationship shapes (the matrix), superclass shapes applied; hints only where no shape covers — also in the pad's and the append menu's prefilters — *relationship-table.test, relationship-resolution.test*
- [x] Append: element + relationship in one command
- [x] Append menu: type icons; asks which relationship when several specific ones are permitted (Association last), else creates it directly — *rdf-append-menu-provider.test, append-interaction.test, workbench.spec*
- [x] Append menu tabs: *New element* / *Existing relationships (n)* — brings a related element (and the relationship) into the view beside the source, or where dragged — *rdf-append-menu-provider.test, connect-integration.test, workbench.spec*
- [x] Qualified resource + unqualified triple + link in the view — *connect-integration.test*
- [x] Change type in place (same IRI, properties kept), undoable — *connect-integration.test*
- [x] Reattaching an end moves the relationship in the model and in other views, undoable — *view-canvas.test*
- [x] Relationship notation (line style, decorations) from the notation set
- [x] Relationships as first-class: selectable, properties, tree, analysis
- [x] Routes persisted as `arch-vis:points` (IRI-celled lists)
- [ ] Suggestion popup when exactly two elements are selected

### Task 5: RDF export (Req 5)
- [x] Six formats: Turtle, TriG, JSON-LD, N-Quads, N-Triples, RDF/XML — *model-io.test* (round-trip each)
- [x] Model only, never the metamodel; deterministic ordering
- [x] Prefixes from the vocabularies' `vann:` declarations and the model's own (`m:`); only used ones; `rdf:type` first under each subject
- [x] DD-15 partition (`graph/model`, `graph/semantic`, `graph/views`) for graph formats
- [x] "Without diagram geometry" profile
- [x] SVG / PNG of the open view (Req 14)
- [x] RDF panel (Req 5.7): hidden by default, toolbar toggle / `?rdf=1`, six formats, geometry toggle, counts, copy, download, highlighting, selection ⇄ statements, no work while hidden, resizable — *rdf-panel.test, workbench.test, workbench.spec*
- [x] HTTP URIs in a per-model namespace (Req 9.7a): `{base}{notation}/{uuid}/`, base `https://example.org/` or `?base=`; flat local names so Turtle writes `m:…` throughout; namespace + prefix stated with `vann:` on the model; DD-15 graphs under the namespace — *model-namespace.test, model-io.test*
- [x] Model settings (Req 9.7b): name, namespace, prefix; move existing IRIs (legacy `…/element/…` flattened) or only new ones; prefix clashes refused; one store change, collaborators follow; New model shows the namespace — *model-namespace.test, workbench.test, workbench.spec*

### Task 6: Validation (Req 6)
- [x] Shapes: every loaded metamodel's `shapes` graphs + core + core-vis shapes (previously the app validated against an empty graph)
- [x] Data: model + `rdfs:subClassOf` + types of referenced resources
- [x] Compiled engine cached until the metamodels change; debounced 300 ms
- [x] `sh:sparql` stripped client-side
- [x] Results named by label; click reveals the concept (opening a view that has it)
- [x] Violations marked on the canvas — *workbench.test*
- [x] Validation tab under the canvas; Violations counted on the tab, Warnings/Infos listed only — *workbench.test, workbench.spec*

### Task 7: Collaboration (Req 7)
- [x] Store ⇄ Y.Doc binding: triple set keyed by canonical N-Triples; echo prevention — *rdf-yjs-binding.test*
- [x] Deterministic convergence of single-valued properties — *rdf-yjs-binding.test* (concurrent offline moves)
- [x] Room/server/user from the URL; "Share" picks a room — *workbench.spec*
- [x] Join adopts the room's model; an empty room receives the local one
- [x] Presence: avatars and status in the toolbar; remote selections highlighted
- [x] Soft locks: others' selections cannot be moved/resized/deleted/re-routed — *workbench.spec*
- [x] Replacing a shared model asks first
- [x] Hocuspocus server: rooms persisted as `.nt` + `.ttl`; `GET /rooms`, `/rooms/<room>.ttl|.nt` — *workbench.spec*
- [ ] Remote cursor positions
- [ ] Offline persistence across reloads (y-indexeddb)
- [ ] Authentication / room access control on the server

### Task 8: UI layout (Req 11)
- [x] Toolbar, palette, model tree, canvas with tool strip, property panel, validation + SPARQL
- [x] Dialogs (prompt / confirm / choose / info) and toasts
- [x] RDF panel hideable (hidden by default) and resizable, width remembered
- [x] Layout: model tree left (full height), hideable ("☰ Model") and resizable by its right edge; palette right, hideable ("▦ Palette") and resizable; bottom tabs Properties / Validation (violation count) / SPARQL Query / Graph, resizable by the top edge, folding to the tabs, maximizing over the workspace (⤢; Esc restores); sizes, tab and folding remembered — *app-shell.test, mount-ui.test, workbench.test, workbench.spec, smoke.spec*
- [x] Hideable / resizable model tree
- [x] Right-click canvas menu — see Phase 5 (Req 11.9)

---

## Phase 1: Visual notation & metamodel selection — done
Rendering modes, notation-driven shapes and relationship decorations, presentation
contexts, metamodel selection/switching/upload, several metamodels at once (Tasks 1, 2).

## Phase 2: Model persistence & navigation

### Task 13: Model/view RDF structure
- [x] Patterns: `arch:Model`, `arch:inModel`, `arch:inView`, `arch:viewConformsToViewpoint`, `arch-vis:ArchNode`/`Link` — `design.md`
- [x] Legacy migration on open (retired `arch:` terms, element-level bounds) — *model-session.test*
- [x] Adopt foreign RDF: model resource, membership, a view, grid layout when there is no geometry — *model-session.test*

### Task 14: Working-state persistence
- [x] Collaboration server persists rooms continuously (debounced, atomic writes)
- [x] Files: open/save in six formats; unsaved-changes indicator and guard

### Task 15: Commit & version history
- [ ] Explicit commit of the working state; history list; diff (added/removed triples); restore

### Task 16: Model tree — done
- [x] Model → Views / Elements by type / Relationships by type / Unclassified; placed markers — *model-explorer.test*
- [x] Context menus per kind; filter; reveal on canvas selection; drag to place — *workbench.spec*

### Task 17: View switching — done
- [x] Toolbar selector and tree; canvas rebuilt from the store; undo history reset per view

### Task 18: Element reuse across views — done
- [x] One resource, many placements; drop from the tree; draws relationships to placed elements — *view-canvas.test*

## Phase 3: Server-side validation
- [ ] `POST /validate` with full SHACL incl. `sh:SPARQLConstraintComponent` (pyshacl or Jena)
- [ ] Merge server results with client results, tagged by source

## Phase 4: Collaboration enhancements
- [x] Locking (soft, on selection)
- [x] Awareness: identity, colour, open view, selection
- [ ] Cursors; "follow" a collaborator
- [ ] Offline queue across reloads

## Phase 5: Polish & production readiness
- [x] Viewpoint greying
- [x] Change an element's type (Req 3.11), from the property panel and the right-click menu — *rdf-element-retype.test, workbench.test, workbench.spec*
- [x] Right-click menu on the canvas (Req 11.9) — *rdf-element-retype.test, workbench.test, workbench.spec*
- [x] Rename on the canvas (Req 3.3): in-place editing of an element's name, undoable — *rdf-label-editing.test, workbench.spec*
- [x] Linked.Archi Core metamodel (Req 1.12): generic Element and Relationship — *core-metamodel.test, bundled-assets.test, taxonomy.test, workbench.spec*
- [x] About ‹type› (Req 3.10): the ontology's and the taxonomy's guidance on the selected type (a view's viewpoint), a foldable, resizable section under the model tree — *type-guide.test, type-guide-panel.test, app-shell.test, workbench.test, workbench.spec*
- [x] SPARQL console: SELECT tables under their projected columns, CONSTRUCT triples as a table, prefixed names that reveal the concept, 500-row cap, results scrolled into sight — *sparql-editor.test, workbench.test, workbench.spec*
- [x] Relationship graph (Req 17): Graph tab; depth 1–5; element/relationship type filters that prune; notation styling; rings / tree / force; follows selection, double-click re-roots; drawn by walking the store; the query behind it as SELECT (table) or CONSTRUCT, run in the SPARQL tab or exported as `.rq`, the drawn triples as `.ttl`; ＋ New view laid out as drawn; tests hold walk and both query forms to the same result — *relationship-graph.test, graph-panel.test, workbench.test, workbench.spec*
- [x] Performance: cold start ≈ 1.2 s; 500 elements — create 140 ms, draw 56 ms, validate 140 ms, save 20 ms (Chrome, bundled ArchiMate 4.0)
- [ ] Accessibility audit (keyboard navigation of palette and tree, WCAG AA contrast, focus management in dialogs)
- [ ] Catalog/matrix views driven by the view's own membership (`arch:inView`) and settings
- [x] Render SPARQL results (SELECT or CONSTRUCT) as a new view: the elements and relationships they mention, laid out as a tree — *view-from-results.test, model-session.test, graph-layout.test, workbench.test*
- [ ] Electron packaging and a smoke test of the desktop build (bundles build; not launched in CI)

## Beyond the reference spec (tool spec phases 3–4)
- [ ] Freehand sketch layer and progressive typing (tool spec §5.8–5.9)
- [ ] AI assistance via MCP with SHACL-gated proposals (tool spec §5.12, §10)

---

## Known limitations

1. **One placement per element per view.** ArchiMate allows an element to appear twice in a diagram; the canvas keys shapes by element IRI. Exchange imports skip the second placement and count it.
2. **Container and label nodes** from exchange files are skipped (core-vis has `arch-vis:ContainerNode`; the editor does not draw it yet).
3. **Store-led changes are not undoable** from the canvas (a collaborator's edit, an import, a model-level delete started from the tree for a concept not on the canvas).
4. **SPARQL constraints** only on a server (Phase 3).
5. ~~**Published shape issue:** `ViewMustDeclareViewpointShape` in the ArchiMate viewpoint shapes puts `sh:severity sh:Warning` on the node shape; SHACL does not propagate it to the property shape, so a view without a viewpoint reports a Violation rather than a Warning. Fix belongs in `linked-archi-meta`.~~ Fixed upstream — the property shapes now declare their own `sh:severity` in both languages (`ViewMustDeclareViewpointShape` / `ViewpointCompletenessShape` in 3.2, `ViewDeclaresViewpointShape` / `ViewpointCompletenessShape` in 4.0), and both bundled copies are re-synced from `linked-archi-meta` (`assets/archimate3/archimate3.2-viewpoint-shapes.ttl`; `assets/archimate4/archimate4-viewpoint-shapes.ttl` on 2026-09-26). A view without a viewpoint reports a Warning. Every other bundled asset matches `linked-archi-meta`.

---

## Change log

### Not yet committed (2026-09-27) — graph performance, SPARQL tab, views from results

- **`npm run sync-assets`** (`scripts/sync-assets.mjs`): refreshes `assets/` from a linked-archi-meta checkout by running its publishing scripts (`copy-ttl-sources.sh`, `copy-icon-assets.sh`) into a temporary folder and copying each bundled file from its published path (TTLs by namespace, icons by path; new icons in bundled folders added); `--check` reports and exits 1. First run brought in the 2026-10-08 relationship shapes for ArchiMate 3.2 and 4.0 (relationships as sources and targets where the spec allows).
- **A notation's own shapes, as data** (Req 2.18): core-vis keeps the eight core shapes; the 14 shapes added for ArchiMate, EDGY and C4 moved into those notations' files, each with `arch-vis:fallbackShape` and its geometry as path templates (`arch-vis:shapeVariables`, `outlinePath`, `detailPath`, `contentBox`, `labelBox`), checked by a core-vis SHACL shape. la-gram reads them (`readCustomShape`) and draws them from the templates (`drawCustomShape`, its own expression parser) — the per-shape code is gone, and a core shape is matched in core-vis's namespace only. The canvas draws as before (same outlines, checked against the published pictures).
- **C4 as published** (Req 2.18, 2.19, 3.6): in linked-archi-meta, the `Person`, `MobileDevice` and `WebBrowser` shapes and `Cylinder` at C4's proportions; the C4 ontology's kinds of container and external elements are subclasses — `c4:Database`, `c4:MobileApp`, `c4:ClientSideWebApp`, `c4:ExternalPerson`, `c4:ExternalSoftwareSystem` — each with a descriptor of its own (no conditions on element values: a look per kind is a class, a look per audience a notation set). Every C4 and Structurizr term links to its c4model.com page and Structurizr DSL section (a 404 and two missing anchors fixed); `structurizr:InfrastructureNode` is no longer a subclass of `DeploymentNode`, as in the DSL; `c4:technology` also on components and Using relationships, as c4model.com asks. The C4 notation is shape-only, with the person shape. The property panel makes a `sh:in` property a choice (adding and editing; ArchiMate's `am4:accessType`, Backstage's `bs:lifecycleState`), a boolean a working checkbox, and an added value typed by its shape; the catalog offers a link whose shape lists its values. Also in linked-archi-meta: every notation's default sizes typed `xsd:double` (199 pairs in 8 files violated core-vis-shapes), and the paused notation-order plan verified done.
- **EDGY as published** (Req 2.18): `arch-vis:RightArrow` and `arch-vis:Stadium` join the core-vis vocabulary, replacing EDGY's own `edgynot:RightArrow`, `TagPill` and `MetricPill` (deprecated, `dcterms:isReplacedBy`); EDGY's activity, story, process and journey are arrows, its tags and metrics pills with the name inside. la-gram reads `arch-vis:fontColor` for the label — EDGY's white-bordered facets get black names, the black tag a white one, and C4's dark boxes the white text they declare. EDGY is not bundled: it shows this once linked-archi-meta is published.
- **ArchiMate data and pictures agree** (Req 2.18), in linked-archi-meta: the 3.2 notation had the application and technology colours swapped (application elements green, technology cyan) — now application `#AFFFFF`, technology `#AFFFAF`, as the pictures and 4.0; 3.2 Gap, Location, Grouping and the Or junction take their pictures' colours. The elements ArchiMate tells apart by shape alone — business and data object, product, contract, representation, deliverable, meaning, value, work package, grouping — are `ShapeOnly`, as their pictures (no badge). Seven 3.2 pictures drawn by hand (business function, event, service and interaction; application process and service; representation) are now generated like the rest: rounded behaviour corners, the right colours, the interaction badge in place of the collaboration one, representation wavy with a band. `archimate-pictures.test.ts` holds the data to the pictures: colour, badge, corners.
- **Outline badges** (Req 2.18): the ArchiMate 4.0 and 3.2 badge glyphs in linked-archi-meta were solid grey where the published pictures paint the element colour; those parts are now transparent (66 glyphs), with a mask where such a part covers a line drawn before it (application component, collaboration, artifact), so a badge looks like its picture's on any fill — checked against every picture marked by its generator (`archimate-glyphs.test.ts`). The vocabulary's `arch-vis:iconSymbol` states the convention.
- **ArchiMate shapes as published** (Req 2.18): new core-vis shape types — `BandedRectangle`, `DoubleBandedRectangle`, `TabbedRectangle`, `Box3D`, `WavyRectangle`, `WavyBandedRectangle`, `Cloud`, `Folder`, `Cylinder` — and `arch-vis:borderStyle`, in linked-archi-meta with their geometry in the vocabulary; the ArchiMate 4.0 and 3.2 notations use them (objects banded, contract double-banded, product tabbed, device/equipment/facility/plateau as 3D boxes, deliverable/gap wavy, representation wavy and banded, meaning a cloud, grouping a dashed folder; location and resource square-cornered, as their pictures). The canvas draws them, docks against their outlines and lays the badge and label out inside the inner lines.
- **Relationship ends from the published markers** (Req 2.17): the canvas draws each decoration from its `arch-vis:decorSymbol` SVG (bundled under `assets/core-vis/markers/`), sanitised and placed by the convention now written into the vocabulary; built-in geometry only as a fallback. Asset fetches revalidate (`cache: 'no-cache'`), so a re-synced snapshot or a new publication is not hidden by the browser cache.
- **Change an element's type** (Req 3.11): from the property panel's type field (a choice of the loaded element types, grouped as in the palette — also for elements not in the view) or the right-click menu's "Change type…" (searchable); same IRI, name, properties and placements; the default name follows; relationships not permitted with the new type named before, kept after; undoable on the canvas.
- **Right-click menu** (Req 11.9): on elements and relationships — Rename, Change type…, Append…; Properties, Show in model tree, Show relationship graph; Copy IRI; Delete from view, Delete from model…
- **Rename on the canvas** (Req 3.3): double-click an element's box (or F2) and type its name — Enter keeps, Esc drops, undo/redo restore; the name in the shown language, never empty. `diagram-js-direct-editing` (MIT, bpmn-io) is a new dependency.
- **Linked.Archi Core** (Req 1.12): the core ontology as a metamodel, first in the Metamodels menu — a generic **Element** (palette group "Generic") and a generic **Relationship**, alone or alongside a language, whose grouping stays the default. Bundled manifest and classification (`assets/core/core-metamodel.ttl`, `core-tax.ttl`) until meta.linked.archi publishes them; the palette and the relationship manager offer a core class only when the core's own classification names it. The generic relationship ranks last and never makes an append ambiguous.

- **Graph query, fast** (Req 17.6): the generated query is reshaped for Oxigraph — a property path for the two directions, a filter instead of `BIND`, every hop as `OPTIONAL { … } FILTER(BOUND(?r))` so the optimizer cannot reorder it: 10 ms at depth 5 on 100 elements (was 7 s), 42 ms on 500 (was minutes). Offered as **SELECT** (a table, the default) or **CONSTRUCT**, and *Run in SPARQL tab* runs it.
- **SPARQL tab** (Req 16.2): results as tables — SELECT under its projected columns, CONSTRUCT as subject / predicate / object — with prefixed names that reveal the concept; the long query scrolls in its own box and the results come into sight.
- **Layout** (Req 11.1, 11.4, 11.6–11.7): the model tree hides ("☰ Model" in the toolbar) and resizes by its right edge, like the palette and the RDF panel. The bottom panel maximizes over the workspace (⤢, or double-click the tab strip; ⤡, Esc or folding restores; opening a view restores it) — in the window rather than a separate one (design decision 12); the Graph drawing follows its area's size.
- **About ‹type›** (Req 3.10): a section under the model tree, in the left panel — folds to its header, resizes by its top edge, both remembered — with what the ontology and the taxonomy say about the selected concept's type, or a type picked in the palette — definition, other names, guidance, a relationship's typical ends, a viewpoint's concepts and stakeholders (for a view: its viewpoint), superclasses, changes, the specification link; classification per axis with the group's notes and its other types. Sections fold (remembered); linked types open in place with a way back. In Electron, web links open in the system browser.
- **Build**: the web bundle is named by its content (`bundle.<hash>.js`) — `npm run serve` sends no cache headers, and a plain reload kept running a cached `bundle.js` after a rebuild.
- **Views from results** (Req 16.3, 17.7): *Render as new view* works (it was a button with nothing behind it) for SELECT and CONSTRUCT results, and the Graph tab has **＋ New view**, laid out as drawn.
- **Graph performance** (Req 17.6, 17.8): running the Graph tab's SPARQL CONSTRUCT in Oxigraph took seconds from 100 elements (7 s at depth 5) and grew with the model, so the tab walks the store breadth first instead — milliseconds, growing with what is reached; the query stays the export, and tests require the walk and the query to return the same triples (decision 11).
- **SPARQL tab**: an empty `CONSTRUCT` result with a `#` in a `PREFIX` IRI came back as an empty table — the query-form detection read comments inside IRIs and let the prefix-stripping swallow the query; it now masks IRIs and strings first and takes the first form keyword.

### 2026-09-27 — relationship graph (commit `88ba85e`)

- **Relationship graph** (Req 17): a **Graph** tab under the canvas — the relationships around the selected element to a chosen depth (1–5), filterable by element and relationship type (filters prune the traversal), drawn with the notation (Cytoscape.js, a new dependency — decision 10 in the design); exports the SPARQL CONSTRUCT behind it (`.rq`, or into the SPARQL tab) and what is drawn as Turtle.

### 2026-09-26 — relationships, append menu (commit `baf413d`)

- **Relationships** (Req 4.2, 4.4, 4.13): what connect, append and "change type" offer comes from the relationship shapes (ArchiMate's matrix), not the domain/range hints alone — before, 68% of the relationships an ArchiMate 4.0 append created by default failed validation. The append menu's icons load (they were asset-relative paths the page could not resolve), and it asks which relationship when several specific ones are permitted. It has two tabs, **New element** and **Existing relationships**: the second brings what the element is already related to in the model into the view, beside it, with the relationship.

### 2026-09-26 — layout, properties, docs (commit `eac25c4`)

- **Layout** (Req 11): model tree left (full height); palette right (hideable "▦ Palette", resizable); under the canvas, tabs **Properties / Validation / SPARQL Query** — resizable by the top edge, folding to the tabs, remembered; the number of Violations on the Validation tab.
- **Property panel** (Req 3.4, 3.6): the Properties tab, with vertical tabs — *‹Kind› information* (ID, type, `inModel`, name, definition; the name and the definition always listed, emptying the definition removes it), *Properties* (added ones + add field), *Analysis*, *Appears in views* — counts, Up/Down, the open tab remembered.
- **Adding a property** (Req 3.6): a picker grouped by applicability (`rdfs:domain`, SHACL), *Used in this model*, *Documentation*, folded *More*; no geometry, styling or metamodel-authoring terms; `skos:definition` and `dcterms:description` not offered; name first, CURIE second; plain names become properties in the model namespace; the list floats, so the bottom panel does not clip it.
- **Assets:** `archimate4-viewpoint-shapes.ttl` re-synced from `linked-archi-meta` (severity on the property shapes): a view without a viewpoint is a Warning in ArchiMate 4.0 too.
- **Docs:** specs, README, conventions and the tool spec brought up to date; the tool spec gains the model-namespace, property-editing and format decisions and an implementation-status appendix.

### 2026-09-25 — RDF view, IRIs, first property panel changes (commit `c19608c`)

- **RDF panel** (Req 5.7): the live model as Turtle (or TriG, JSON-LD, N-Quads, N-Triples, RDF/XML) on the far right, hidden by default (`{ } RDF`, `?rdf=1`); geometry toggle, counts, copy, download, highlighting, selection ⇄ statements; resizable.
- **HTTP URIs and a model namespace** (Req 9.7a/b): `urn:la-gram:` replaced by `{base}{notation}/{uuid}/`, base `https://example.org/` (or `?base=`); flat local names so the whole model is written with `m:`; the namespace and prefix stated on the model with `vann:`; **Model settings** changes them and moves the model's IRIs (legacy IRIs flattened); collaborators follow. DD-15 graph IRIs under the namespace; the collaboration server's snapshot uses the model's prefix; `rdf:type` first under each subject.
- **Property panel:** hideable and resizable on the right (since moved to the bottom tabs); fields ordered ID, type, `inModel`, `prefLabel`, then the rest; no `inView` rows.

### 2026-09-25 — Phase 1: spec alignment (commit `0ab0acf`)

- Requirements, design and tasks ported from the `la-modeller-excalidraw` specification (numbers 1–11 kept for comparison; 12–16 la-gram's own); the implementation-independent tool spec copied to `docs/`.
- Test fixtures read from the bundled assets instead of absolute paths.
- Model / view / canvas on the published vocabulary (`arch:inModel`, `arch:inView`, qualified relationships + unqualified triples, `arch-vis:` geometry), several views, the model tree, six file formats with the DD-15 partition, ArchiMate Exchange import, legacy migration on open.
- Metamodels discovered and loaded at runtime (catalogue, load by IRI, uploads, several at once, switching), presentation contexts, validation against the real shapes.
- Real-time collaboration: store ⇄ Y.Doc triple set, deterministic convergence, presence and soft locks, a Hocuspocus server persisting rooms as `.nt` + `.ttl`.
- Fixed on the way: validation read an empty shapes graph, Save exported the metamodel, counter-based IRIs, malformed literals from the property panel, reconnect not updating the model.

