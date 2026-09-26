# Requirements: la-gram

## Introduction

la-gram is an RDF-first architecture modeller: the model lives in an RDF store
(Oxigraph) and every other representation — the diagram canvas, the model tree,
catalog and matrix views, files, the collaboration document — is a projection of
it. Metamodels are published Linked.Archi assets (`meta.linked.archi`) loaded at
runtime; the diagram canvas is diagram-js; real-time collaboration is Yjs over
Hocuspocus. It runs in the browser and as an Electron desktop app.

These requirements are adapted from the `la-modeller-excalidraw` specification
(`tools/modellers/excalidraw-linked-archi-yjs-demo/.kiro/specs/la-modeller-excalidraw/`),
which is the reference for behaviour; requirement numbers 1–11 match it so the
two can be compared line by line. Where la-gram deliberately differs, the
criterion says so. Requirements 12–16 are specific to la-gram. The broader,
implementation-independent tool specification is `docs/linked-archi-tool-spec.md`.

## Glossary

- **Model** — an `arch:Model`: elements, relationships and views. At runtime the
  store's default graph; at rest a file.
- **Element / Relationship** — model concepts. A relationship is an
  `arch:QualifiedRelationship` subclass instance with `arch:source`/`arch:target`
  *and* the unqualified triple its class maps to (`arch:unqualifiedForm`).
- **View** — an `arch:View` (`arch:Diagram`, `arch:Catalog` or `arch:Matrix`)
  presenting a subset of the model; conforms to a viewpoint.
- **Placement / geometry** — `arch-vis:ArchNode` (an element in a view) and
  `arch-vis:Link` (a relationship in a view), with bounds and routes.
- **Canvas** — the diagram-js surface showing one diagram view. Not persisted.
- **Metamodel** — an `arch:Metamodel` manifest and the documents it names
  (ontology, taxonomy, notation, shapes, viewpoints, presentation contexts).

---

### Requirement 1: Metamodel Loading & Discovery

**User Story:** As an enterprise architect, I want the tool to load metamodels from `meta.linked.archi` (or anywhere else), and to let me add my own — so that I can work with published metamodels, custom extensions or third-party ontologies.

#### Acceptance Criteria

1. On startup, load the default metamodel — ArchiMate 4.0 (`https://meta.linked.archi/archimate4/metamodel#ArchiMate4`) — or the metamodels named by `?metamodel=` (repeatable, comma-separated)
2. Offer every published metamodel in a selector so the user can add one, or switch to it (replacing the others)
   - *la-gram:* `meta.linked.archi` publishes no machine-readable catalogue (the site root and `/catalog` answer 404 to `Accept: text/turtle`), so the 25 published manifests ship as a built-in catalogue generated from the `linked-archi-meta` repository (`src/metamodel-manager/catalogue.ts`)
3. Parse the manifest and discover all linked resources via `owl:imports` and `arch:*` properties (`arch:modelConcepts`, `arch:conceptClassification`, `arch:notationSet`, `arch:formalRules`, `arch:architectureViewpoints`, `arch:presentationContextScheme`, …)
4. Load discovered resources in parallel (one level of the reference graph at a time) with `Accept: text/turtle`
5. Multi-value Accept headers with quality parameters must not be sent (the server returns 404)
6. In addition to the catalogue, the user can:
   - Provide the IRI of a **complete metamodel** (any `arch:Metamodel` subject or manifest); all its assets are discovered and loaded
   - Upload a **complete metamodel** (a manifest file); its other documents resolve through the normal sources
   - Upload **individual semantic assets** (an ontology, a shapes file, a viewpoints file), added to the loaded pool
7. Switching metamodels updates the palette, relationship validity and validation shapes; model content that does not match the new metamodel stays, is shown as *unclassified*, and is flagged by validation — never removed
8. ~~No hardcoded/embedded ontology~~ — *la-gram deviates deliberately:* ArchiMate 4.0 and 3.2 (and the core ontologies and shapes) ship with the app so it starts and edits offline, and so ArchiMate Exchange files import without network. Every other metamodel comes from the network or an upload. Source order is configurable: `?assets=bundled-first` (default in the browser), `remote-first`, or `offline`
9. Track asset loading status per document (loaded / already-loaded / skipped / unavailable / error, origin, triple count) and show it ("Show loaded assets")
10. Cold-start to interactive ≤ 3 seconds (measured: ≈ 1.2 s with the bundled ArchiMate 4.0)
11. Multiple metamodels can be loaded simultaneously; palette, validity rules and validation use the union
12. Documents the editor cannot use (derivation rules, deliverable templates, reference data, the framework document) are recorded as *skipped* rather than fetched

---

### Requirement 2: Palette Generation & Viewpoint Filtering

**User Story:** As a modeler, I want a palette derived from the loaded metamodel's ontology, grouped by its taxonomy and filtered by the view's viewpoint — so that the tool adapts to any metamodel without code changes.

#### Acceptance Criteria

1. Dual classification: the **SKOS taxonomy** decides which concepts appear and how they are grouped; the **OWL ontology** provides the class instantiated. Linked by shared IRI or `rdfs:seeAlso`
2. Only concrete (instantiable) element types are offered; `arch:isAbstractClass true` is excluded
3. Labels: `skos:prefLabel` → `rdfs:label` → local name
4. Definitions: `skos:definition` → `rdfs:comment`
5. Grouping derives from the taxonomy scoped by `arch:conceptClassification`, navigating `skos:narrower` and inverse `skos:broader`; group and axis roles are detected structurally
6. Several classification axes are preserved; a "Group by" selector switches between them (structural axes preferred as default); no metamodel-specific special cases
7. Relationship-only axes are not offered for element grouping
8. The palette is filtered by the **open view's** viewpoint (`arch:includesConcept`)
9. Viewpoint filtering is non-destructive: elements outside the viewpoint stay on the canvas, greyed out, still editable
10. With no viewpoint, all concepts are offered
11. With several metamodels loaded, the palette shows the union
12. Visual notation comes from the metamodel's `arch:notationSet` (`arch-vis:NotationSet` / `arch-vis:VisualNotation`)
13. Each `arch-vis:VisualNotation` provides shape, fill, line, icon, icon placement, rendering mode and default size
14. Three rendering modes: `ShapeWithBadge`, `IconCentric`, `ShapeOnly`
15. **Presentation contexts** (`arch:presentationContextScheme`) are offered in the toolbar; the chosen context's `arch:usesNotationSet` restyles palette and canvas
16. Fallback: context's notation set → metamodel's `arch:notationSet` → the class's `arch:prefVisNotation`

---

### Requirement 3: Element Creation & Properties

**User Story:** As a modeler, I want to create elements from the palette, name them, and manage their properties, so that each element carries full semantic metadata.

#### Acceptance Criteria

1. Dragging a palette entry onto the canvas creates the element at the drop point; clicking an entry arms click-to-place
2. Each element has a stable IRI (UUID-based, minted at creation, never changed), its class, a language-tagged `skos:prefLabel`, and `arch:inModel`; it is placed in the open view as an `arch-vis:ArchNode`
3. The label is editable in the property panel; the canvas and the tree follow
4. Selecting an element (canvas or tree) shows it in the property panel (the Properties tab under the canvas): kind, type, IRI, properties, relationships, the views it appears in
5. Properties are persisted with the element and included in every export
6. Properties are added by picking or typing a property and a value; values can be removed (not the type, not the name). The picker offers what applies to the concept's type (by `rdfs:domain` / SHACL), what the model already uses, documentation properties, and — folded — the rest; never diagram geometry, notation styling or metamodel-authoring terms. Entries show the name first, the prefixed IRI smaller. Any property can be typed: a plain name (a new property in the model's namespace, `m:owner`), a prefixed name, or an IRI. The panel lists, in order: ID (the IRI), type, `inModel`, `prefLabel`, `skos:definition` — the name and the definition always, empty until filled in (emptying the definition removes it; the name cannot be emptied) — then — in the panel's own *Properties* tab, with the add field — every other property by label. `arch:inView` is not listed: the views are in the toolbar and under "Appears in views"
7. Deleting: **Delete from View** (the canvas default — Delete key, pad ×) removes the placement only; **Delete from Model** (pad ✖, tree menu) removes the element everywhere after a confirmation listing the views it appears in
8. Delete from Model removes every relationship connected to the element, in every view
9. Edit latency ≤ 16 ms per command

---

### Requirement 4: Relationship Creation & Integrity

**User Story:** As a modeler, I want to create relationships the metamodel allows, with the tool keeping the model structurally sound.

#### Acceptance Criteria

1. Selecting an element shows diagram-js's context pad with Connect and Append
2. Connect (pad or toolbar tool) offers only the relationship types the metamodel's `arch:domainIncludes`/`arch:rangeIncludes` allow (closure-aware), best first
3. Dropping the connection on a target creates the relationship with the best-ranked type; the pad's "change type" menu lists the alternatives
4. Append creates a new element of an allowed type *and* the relationship to it, as one undo step
5. Relationship types are in the palette; picking one arms the connect tool with that type preferred
6. Connections are bound to their elements and follow them
7. Each relationship is a qualified resource (stable IRI, class type, `arch:source`, `arch:target`, `arch:inModel`) *and* the unqualified triple; it is drawn as an `arch-vis:Link` with its route
8. Relationships are first-class: selectable, with properties, in the tree, in the property panel
9. Relationships support custom properties like elements
10. Connections cannot exist unattached (diagram-js reconnect rules)
11. Changing a relationship's type keeps its IRI and properties (retyped in place), undoably
12. Deletion as for elements: from the view by default, from the model on request
13. `domainIncludes`/`rangeIncludes` are indicative (suggestions); only SHACL decides validity

---

### Requirement 5: RDF Export

**User Story:** As an architect, I want to save the model as RDF, so it can live in Git, be loaded into a triplestore, or be read by other Linked Data tools.

#### Acceptance Criteria

1. Export uses prefixed names where possible
2. Prefixes derive from the loaded vocabularies' own `vann:preferredNamespacePrefix`/`Uri` declarations plus the standard ones and `m:` (or the prefix the model declares) for the model's namespace; only prefixes used are written. Every IRI la-gram mints is a flat name in the model's namespace, so the model is written as prefixed names (`m:model`, `m:element-…`, `m:view-…`, `m:node-…`, `m:link-…`)
3. Labels are exported as language-tagged `skos:prefLabel`
4. Properties are exported as written (`skos:definition` for descriptions)
5. Relationships are exported in both forms (qualified resource and unqualified triple)
6. View geometry is exported as `arch-vis:ArchNode`/`arch-vis:Link` with bounds and routes
7. An **RDF panel** on the right shows the live model as it would be saved — hidden by default, toggled from the toolbar ("{ } RDF") or opened with `?rdf=1`; format selector (Turtle default), a "geometry" toggle (the no-geometry profile), counts (elements, relationships, views, triples), Copy and Download; syntax-highlighted; the selected concept's statements are highlighted and clicking a subject's statements selects it; it does no work while hidden and refreshes debounced while shown; resizable by its left edge (width remembered per browser)
8. Save produces a download (browser) or a file (desktop)
9. Formats: Turtle (default), TriG, JSON-LD, N-Quads, N-Triples, RDF/XML
10. *la-gram:* formats that carry graphs use the Linked.Archi layout (DD-15): `{ns}graph/model`, `{ns}graph/semantic`, `{ns}graph/views`, `{ns}` being the model's namespace `{base}{notation}/{modelId}/`
11. *la-gram:* a "without diagram geometry" profile drops the views graph but keeps views and `arch:inView` membership
12. Only the model is exported — never the metamodel

---

### Requirement 6: SHACL Validation (Client-side)

**User Story:** As a modeler, I want real-time SHACL feedback so I can fix problems as I model.

#### Acceptance Criteria

1. Validation runs against every `shapes` graph of the loaded metamodels (`arch:formalRules`) plus the core and core-vis shapes
2. The data graph is the model plus the `rdfs:subClassOf` axioms and the types of every resource the model references (so `sh:targetClass` on superclasses and `sh:class` on referenced viewpoints/metamodels work)
3. Validation runs after every change, debounced (300 ms); the compiled shapes engine is cached until the metamodels change
4. `sh:sparql` constraints are stripped client-side (left to the server, Req 8)
5. Each result shows severity, the concept's name, the message and the source shape
6. `sh:message` is shown when present; otherwise a generated message
7. Results are in the Validation tab under the canvas; clicking one shows the concept (switching to a view that contains it). The tab shows the number of Violations, so they are seen while another tab is open; Warnings and Infos are listed but not counted — a view without a viewpoint is a Warning (the published viewpoint shapes declare `sh:severity` on their property shapes)
8. Violating concepts are marked on the canvas
9. Results match what a server-side SHACL engine reports for the core constraints

---

### Requirement 7: Real-time Collaboration

**User Story:** As a team member, I want to edit the same model with others in real time, seeing who is there, without conflicts.

#### Acceptance Criteria

1. Several users edit the same model concurrently with CRDT-based conflict resolution
2. The room is set by `?room=`; "Share" in the toolbar picks one and puts it in the URL
3. The server by `?ws=` (default `ws://localhost:1234`); the display name by `?user=`
4. **All model data is synced** — the whole default graph, geometry included — not canvas state; clients may show different views
5. Local changes are pushed with echo prevention (transaction origins)
6. Connection status and collaborators (avatars) are shown in the toolbar
7. Sync latency ≤ 200 ms in the same region
8. Edits made while disconnected are merged on reconnect (Yjs); concurrent edits of single-valued properties (bounds, labels, routes) converge deterministically on every client
9. A concept another user has selected is highlighted and locked (cannot be moved, resized, deleted or re-routed) until they deselect it
10. Awareness carries identity, colour, open view and selection
11. Joining a room with content adopts the room's model; sharing into an empty room pushes the local one; replacing a shared model (New/Open/Import) asks first

---

### Requirement 8: Server-side Validation (Next Iteration)

**User Story:** As an architect, I want authoritative SHACL validation on the server, including SPARQL constraints.

#### Acceptance Criteria

1. The server evaluates the full shapes graph, including `sh:SPARQLConstraintComponent`
2. Triggered on demand (and on commit, Req 9)
3. Returns a standard `sh:ValidationReport`
4. The client merges server results with its own (deduplicated by focus node + path + message)
5. Results are annotated with their source (server / client)
6. Exposed over HTTP

---

### Requirement 9: Model Persistence

**User Story:** As an architect, I want my model to persist, and to navigate its views.

#### Acceptance Criteria

1. The storage model is **Model → Views + Elements + Relationships**; the canvas is a projection
2. A model has a name, `arch:modelConformsToMetamodel` statements, and contains elements, relationships and views (members name it with `arch:inModel`)
3. An element carries its identity independent of any view
4. A relationship likewise
5. A view presents a subset (`arch:inView`) with geometry (`arch-vis:*`); it conforms to a viewpoint (`arch:viewConformsToViewpoint`)
6. The canvas shows one diagram view; changes project back to the model and the view
7. Every resource has a stable IRI, an HTTP(S) URI in the model's namespace
7a. *la-gram:* each model has a namespace, stated on the model as `vann:preferredNamespaceUri` with its prefix as `vann:preferredNamespacePrefix` (`m` by default). New models get `{base}{notation}/{uuid}/` with base `https://example.org/` unless configured (`?base=`), shown and editable when the model is created
7b. *la-gram:* **Model settings** edits the name, namespace and prefix; changing the namespace moves the model's existing IRIs into it (default) or applies only to IRIs minted from then on; namespaces must be absolute IRIs and prefixes must not stand for another namespace; collaborators follow the move
8. Files: Turtle, TriG, JSON-LD, RDF/XML, N-Quads, N-Triples
9. Collaborative rooms persist continuously on the server (debounced) as N-Triples plus a Turtle snapshot, and are readable over HTTP (`/rooms/<room>.ttl`)
10. Committing a version is an explicit action — *not yet (Phase 2)*
11. Joining a room loads its persisted state
12. The same model always serializes to the same text (deterministic ordering)
13. Delete from view vs. from model, as Req 3.7
14. Version history (commits, diff, restore) — *not yet (Phase 2)*
15. *la-gram:* models written with retired vocabulary (`arch:partOfModel`, `arch:exposedInView`, `arch:contains`, `arch:conformsToMetamodel`, `arch:viewpoint`, `arch:relSource`/`relTarget`/`relPredicate`, element-level bounds) are migrated on open

---

### Requirement 10: Model Tree & Navigation

**User Story:** As an architect, I want the whole model in a tree so I can navigate views and find concepts.

#### Acceptance Criteria

1. The model tree is the left column, full height
2. Model → Views + Elements (grouped by type) + Relationships (grouped by type) + Unclassified
3. The open view is highlighted; concepts placed in it are marked
4. Double-click opens a view; single click selects
5. Right-click menus:
   - **Model**: Rename, Model settings (name, namespace, prefix — also on double-click), New diagram / catalog / matrix
   - **View**: Open, Rename, Set viewpoint, Duplicate, Delete (concepts stay)
   - **Element**: Select on canvas / Add to current view, Rename, Delete from model
   - **Relationship**: Select on canvas / Add to current view, Show source, Show target, Rename, Delete from model
6. Selecting on the canvas reveals the concept in the tree
7. Every concept is in the tree regardless of the open view; dragging one onto the canvas places it (and draws its relationships to what is already placed)
8. Views are created (with a viewpoint), renamed and deleted from the tree or the toolbar
9. The tree filters by name or type

---

### Requirement 11: UI Layout & Interaction

**User Story:** As a user, I want a clear multi-panel layout with the canvas as the workspace.

#### Acceptance Criteria

1. Left, full height: the model tree
2. Centre: the canvas with its tool strip (connect, lasso, hand), or a catalog/matrix view
3. Top: the app toolbar — model name (opens Model settings; unsaved-changes dot), File, Metamodels, undo/redo, view selector + new view, viewpoint, presentation context, the "▦ Palette" and "{ } RDF" toggles, collaboration
4. Bottom, under the canvas: a tabbed panel — **Properties**, **Validation** (the number of violations shown on the tab), **SPARQL Query**. Properties is the property panel (kind, type, IRI, properties with SHACL-derived fields, add/remove, relationships, views) with vertical tabs on its left — *‹Kind› information* (ID, type, `inModel`, name, definition), *Properties* (the added ones and the add field), *Analysis* (relationships), *Appears in views* — with counts; the open tab stays open across selections and reloads. Clicking the open tab (or ▾) folds the panel to its tabs; the open tab, the height and the folding are remembered
5. Right: the palette — shown by default, hidden from the toolbar's "▦ Palette" toggle
5a. Far right, full height: the RDF panel (Req 5.7) — hidden by default
6. Panels hideable — the palette and the RDF panel; the bottom panel folds to its tabs; the model tree *not yet*
7. Panels resizable with persisted sizes — the palette and the RDF panel by their left edge, the bottom panel by its top edge (remembered per browser; the canvas keeps at least 240 × 160 px); the model tree *not yet*
8. Selecting on the canvas updates the property panel and the tree
9. Canvas context actions are diagram-js's context pad (delete from view, delete from model, connect, append, change type)
10. Keyboard: Delete, Ctrl/Cmd+Z/Y, zoom; keys typed in panel fields never reach the canvas

---

### Requirement 12: Catalog & Matrix Views (la-gram)

1. A view may be a Catalog (tabular listing of elements by type, inline editing) or a Matrix (relationships between two element types)
2. Opening such a view shows the corresponding component in the centre
3. The matrix reads relationships in both the current and the retired vocabulary

### Requirement 13: Import (la-gram)

1. ArchiMate Model Exchange File Format (3.x) files import as ArchiMate 3.2 models: elements, relationships (including relationship-to-relationship), property values, and diagrams with nested nodes and bendpoints
2. `AndJunction`/`OrJunction` map onto the ontology's `Junction_And`/`Junction_Or`
3. Types the loaded ontology does not define are reported, not invented
4. Nodes that stand for no element are skipped and counted
5. Any RDF file can be opened as a model (Req 9.8); one without `arch:Model` is adopted (model resource, membership, and a grid layout when it has no geometry)

### Requirement 14: Diagram Export (la-gram)

1. The open view exports as SVG and PNG, cropped to content, without interaction chrome

### Requirement 15: Web & Desktop (la-gram)

1. One codebase runs in modern browsers and as an Electron app
2. The desktop build reads and writes files natively; the web build uses file pickers and downloads

### Requirement 16: SPARQL (la-gram)

1. A SPARQL 1.1 editor, the SPARQL Query tab under the canvas, queries the live store (model and metamodels) with syntax highlighting and prefix completion
2. CONSTRUCT results can be rendered as a view — *existing component; view creation from it not yet wired*
