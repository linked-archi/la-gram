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
- [ ] Inline label editing on the canvas (double-click)

### Task 4: Relationships (Req 4)
- [x] Connect from the context pad or the toolbar; rules from domain/range (closure-aware)
- [x] Append: element + relationship in one command
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
- [x] Layout: model tree left (full height); palette right, hideable ("▦ Palette") and resizable; bottom tabs Properties / Validation (violation count) / SPARQL Query, resizable by the top edge, folding to the tabs; sizes, tab and folding remembered — *app-shell.test, mount-ui.test, workbench.test, workbench.spec, smoke.spec*
- [ ] Hideable / resizable model tree
- [ ] Right-click canvas menu (the context pad covers the same actions today)

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
- [x] SPARQL console (existing component)
- [x] Performance: cold start ≈ 1.2 s; 500 elements — create 140 ms, draw 56 ms, validate 140 ms, save 20 ms (Chrome, bundled ArchiMate 4.0)
- [ ] Accessibility audit (keyboard navigation of palette and tree, WCAG AA contrast, focus management in dialogs)
- [ ] Catalog/matrix views driven by the view's own membership (`arch:inView`) and settings
- [ ] Render SPARQL CONSTRUCT results as a new view
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

### Not yet committed (2026-09-26) — layout, properties

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

