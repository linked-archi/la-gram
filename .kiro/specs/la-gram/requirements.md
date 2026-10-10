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
criterion says so. Requirements 12–17 are specific to la-gram. The broader,
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
   - *la-gram:* `meta.linked.archi` publishes no machine-readable catalogue (the site root and `/catalog` answer 404 to `Accept: text/turtle`), so the published manifests ship as a built-in catalogue maintained by hand from the `linked-archi-meta` repository (`src/metamodel-manager/catalogue.ts`). Basic (`https://meta.linked.archi/basic/metamodel#Basic`) is listed ahead of its publication; until then choosing it reports a load error
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
12. **Linked.Archi Core** — the core ontology as a metamodel, first in the selector (its own "Core" section), bundled: added to a language or alone, it offers a generic **Element** (`arch:Element`, in a "Generic" palette group) and a generic **Relationship** (`arch:QualifiedRelationship`), which may connect any two model concepts and ranks last among a language's relationships (like Association, it never makes a choice ambiguous). A language's grouping stays the default; its elements are unaffected. Unloading it keeps the core ontology every model depends on
   - *la-gram:* `meta.linked.archi` publishes no core manifest, so la-gram bundles one (`assets/core/core-metamodel.ttl`) with a small classification (`assets/core/core-tax.ttl`, `https://meta.linked.archi/core/tax#`) naming the two generic concepts — the palette offers a core class only when this classification names it
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
15. **Presentation contexts** (`arch:presentationContextScheme`) are offered in the toolbar; the chosen context's `arch:usesNotationSet` restyles palette and canvas. The sets the contexts name are loaded with the metamodel, so an alternative set needs no other reference; the manifest's `arch:notationSet` stays the default
16. Notation lookup, the same for palette and canvas. For a class C, the active set A is the set that the active presentation context names with `arch:usesNotationSet`, or else the primary metamodel's `arch:notationSet`. The fallback layers F are the default sets (`arch:notationSet`) of all loaded metamodels except A itself, in load order. F includes the default set of A's own metamodel when a presentation context picked an alternative set. (1) A descriptor in A for C. (2) A descriptor for C in F, the first match in load order. (3) C's own `arch:prefVisNotation`. (4) A descriptor for the nearest superclass of C that has one in A or F. The walk goes breadth-first over `rdfs:subClassOf`: by distance first, and superclasses at the same distance in IRI order. It stops at `arch:Element` and `arch:QualifiedRelationship`. For each superclass, A is checked first, then F in load order. (5) Built-in defaults. Elements: a rectangle with a white fill and a black line. Relationships: a solid black line. Anything published for the class itself beats anything inherited; among inherited descriptors the nearest ancestor wins; the active set only breaks ties. Relationships are drawn black unless a descriptor states a colour; they differ by line style and arrowhead
17. **Relationship ends** are drawn from the published marker symbols: each `arch-vis:Decoration` names its SVG with `arch-vis:decorSymbol`, placed as the vocabulary describes (pointing in +x, the connector meeting the middle of its viewBox's right edge, mirrored at a source end, `currentColor` taking the line's colour). The core-vis markers ship with the app; built-in geometry draws a decoration only while its symbol loads, or when none is published or it cannot be loaded
18. **Element shapes** are drawn as the vocabulary describes them, so the canvas matches the published pictures: besides the plain outlines (`Rectangle`, `RoundedRectangle`, `Octagon`, `Ellipse`, `Circle`, `Hexagon`, `Diamond`, `Parallelogram`), `BandedRectangle`, `DoubleBandedRectangle`, `TabbedRectangle`, `Box3D`, `WavyRectangle`, `WavyBandedRectangle`, `Cloud`, `Folder`, `RightArrow`, `Stadium` and `Cylinder`, with the proportions their `rdfs:comment`s give. Inner lines (bands, tabs, a 3D box's front edges, a cylinder's rim) are drawn but are not outline: connections dock against the outline. The badge and the label sit in the part the inner lines leave (below a band, on a 3D box's front face, above a wave); a `Folder`'s label sits in its tab, on one line. `arch-vis:borderStyle` dashes or dots the outline (ArchiMate's grouping). A shape type la-gram does not know is drawn as a rectangle. The label takes `arch-vis:fontColor`, else the line colour (under an IconCentric icon, else black). The badge is the published glyph as it is: its lines opaque, transparent where the element's fill shows through

---

### Requirement 3: Element Creation & Properties

**User Story:** As a modeler, I want to create elements from the palette, name them, and manage their properties, so that each element carries full semantic metadata.

#### Acceptance Criteria

1. Dragging a palette entry onto the canvas creates the element at the drop point; clicking an entry arms click-to-place
2. Each element has a stable IRI (UUID-based, minted at creation, never changed), its class, a language-tagged `skos:prefLabel`, and `arch:inModel`; it is placed in the open view as an `arch-vis:ArchNode`
3. The label is editable in the property panel — and on the canvas, in the element's box: double-click it (or select it and press F2), type (the name starts selected, so typing replaces it), Enter or a click elsewhere keeps it, Esc drops it; one line, and never empty. It is the `skos:prefLabel` in the language shown (other languages' names are kept), an undoable canvas step; the canvas, the tree and the property panel follow
4. Selecting an element (canvas or tree) shows it in the property panel (the Properties tab under the canvas): kind, type, IRI, properties, relationships, the views it appears in
5. Properties are persisted with the element and included in every export
6. Properties are added by picking or typing a property and a value; values can be removed (not the type, not the name). The picker offers what applies to the concept's type (by `rdfs:domain` / SHACL), what the model already uses, documentation properties, and — folded — the rest; never diagram geometry, notation styling or metamodel-authoring terms. Entries show the name first, the prefixed IRI smaller. Any property can be typed: a plain name (a new property in the model's namespace, `m:owner`), a prefixed name, or an IRI. The panel lists, in order: ID (the IRI), type, `inModel`, `prefLabel`, `skos:definition` — the name and the definition always, empty until filled in (emptying the definition removes it; the name cannot be emptied) — then — in the panel's own *Properties* tab, with the add field — every other property by label. `arch:inView` is not listed: the views are in the toolbar and under "Appears in views"
7. Deleting: **Delete from View** (the canvas default — Delete key, pad ×) removes the placement only; **Delete from Model** (pad ✖, tree menu) removes the element everywhere after a confirmation listing the views it appears in
8. Delete from Model removes every relationship connected to the element, in every view
9. Edit latency ≤ 16 ms per command
10. **About ‹type›** — a section of the left panel, under the model tree, tells what the loaded metamodels say about the selected concept's type (for a view, its viewpoint) — or about a type picked in the palette, until something is selected: from the ontology its definition, other names, guidance (`skos:scopeNote`), typical ends and unqualified form of a relationship, a viewpoint's concepts, stakeholders and purposes, the classes it specializes (with their definitions), what changed, and its source in the specification; from the taxonomy where it is classified — the path under each axis ("Element by Domain › Business Domain"), the group's definition and notes, and the other types in the group. The section folds to its header ("About Business Actor") and is resized by its top edge — its height and folding remembered; its parts fold too, and which are open is remembered; any type or concept it names opens its own page, with a way back; a new selection shows its own type again. With nothing selected, or a type the metamodels say nothing about, it says so
11. **Change an element's type** — from the property panel, where an element's *type* is a choice of every element type of the loaded metamodels (grouped as in the palette; also for an element not in the open view), or from the right-click menu's "Change type…", a searchable menu of the same types with the current one marked. The element keeps its IRI, name, properties and placement in every view; a name that was still the old type's default becomes the new type's. Relationships the new type is not permitted in are named first (e.g. "Assignment → Cashier") and, if the user goes ahead, kept — validation flags them; nothing is deleted. One undoable step

---

### Requirement 4: Relationship Creation & Integrity

**User Story:** As a modeler, I want to create relationships the metamodel allows, with the tool keeping the model structurally sound.

#### Acceptance Criteria

1. Selecting an element shows diagram-js's context pad with Connect and Append
2. Connect (pad or toolbar tool), Append and "change type" offer only the relationship types the metamodel permits for the pair, best first: where the metamodel publishes relationship shapes (ArchiMate 4.0 and 3.2 — the relationship matrix), exactly the pairs they list, a shape on a superclass applying to its subclasses (Composition ⊂ Aggregation); elsewhere the `arch:domainIncludes`/`arch:rangeIncludes` hints (closure-aware)
3. Dropping the connection on a target creates the relationship with the best-ranked type; the pad's "change type" menu lists the alternatives
4. Append ("+" on the pad) lists the element types a relationship is permitted to, with their icons, and creates the new element *and* the relationship to it, as one undo step. When one specific relationship is permitted (Association aside) it is created directly; when several are, a second step asks which, Association last. A drag from the menu takes the best-ranked one. The menu has two tabs: **New element** (the above, grouped by the palette's categories) and **Existing relationships** (n) — the relationships the element already has in the model, those whose other end is not in the view first; a click brings the other end into the view beside the element (right for outgoing, left for incoming, at a free spot) with the relationship drawn, a drag places it where dropped; nothing new is created in the model
5. Relationship types are in the palette; picking one arms the connect tool with that type preferred
6. Connections are bound to their elements and follow them
7. Each relationship is a qualified resource (stable IRI, class type, `arch:source`, `arch:target`, `arch:inModel`) *and* the unqualified triple; it is drawn as an `arch-vis:Link` with its route
8. Relationships are first-class: selectable, with properties, in the tree, in the property panel
9. Relationships support custom properties like elements
10. Connections cannot exist unattached (diagram-js reconnect rules)
11. Changing a relationship's type keeps its IRI and properties (retyped in place), undoably
12. Deletion as for elements: from the view by default, from the model on request
13. `domainIncludes`/`rangeIncludes` are indicative; SHACL decides validity — the relationship shapes both for what is offered and in validation, so an offered relationship never fails validation

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

1. Left, full height: the model tree, and under it the *About ‹type›* section (Req 3.10) — shown by default, hidden together from the toolbar's "☰ Model" toggle
2. Centre: the canvas with its tool strip (connect, lasso, hand), or a catalog/matrix view
3. Top: the app toolbar — model name (opens Model settings; unsaved-changes dot), File, Metamodels, undo/redo, view selector + new view, viewpoint, presentation context, the "☰ Model", "▦ Palette" and "{ } RDF" toggles, collaboration
4. Bottom, under the canvas: a tabbed panel — **Properties**, **Validation** (the number of violations shown on the tab), **SPARQL Query**, **Graph** (Req 17). Properties is the property panel (kind, type, IRI, properties with SHACL-derived fields, add/remove, relationships, views) with vertical tabs on its left — *‹Kind› information* (ID, type, `inModel`, name, definition), *Properties* (the added ones and the add field), *Analysis* (relationships), *Appears in views* — with counts; the open tab stays open across selections and reloads. Clicking the open tab (or ▾) folds the panel to its tabs; the open tab, the height and the folding are remembered. **⤢** (or a double-click on the tab strip) maximizes the panel over the whole workspace — for a large graph, a long query or a wide result — and **⤡**, Esc or folding restores it; opening a view (a new view from results, a revealed concept) restores it too. Maximized is not remembered: a reload starts restored
5. Right: the palette — shown by default, hidden from the toolbar's "▦ Palette" toggle
5a. Far right, full height: the RDF panel (Req 5.7) — hidden by default
6. Panels hideable — the model tree, the palette and the RDF panel; the bottom panel folds to its tabs and maximizes
7. Panels resizable with persisted sizes — the model tree by its right edge, the palette and the RDF panel by their left edge, the bottom panel by its top edge (remembered per browser; the canvas keeps at least 240 × 160 px)
8. Selecting on the canvas updates the property panel and the tree
9. Canvas context actions are diagram-js's context pad (delete from view, delete from model, connect, append, a relationship's change type) and a **right-click menu** on elements and relationships, at the pointer: Rename (F2), Change type… (Req 3.11) or Change relationship type…, Append…; Properties, Show in model tree, Show relationship graph; Copy IRI; Delete from view, Delete from model…
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
2. Results are tables: a SELECT's rows under its projected variables (a column no row binds is still shown); a CONSTRUCT's or DESCRIBE's triples as subject / predicate / object; the first 500 rows, with the count. IRIs are shown as prefixed names with the model's and the vocabularies' prefixes (the full IRI on hover), and clicking one shows that concept as the RDF panel does (selected on the canvas, opening a view that shows it if the open one does not; else in the tree). A long query scrolls in its own box, and the results are scrolled into sight after a run
3. **Render as new view** (SELECT and CONSTRUCT results): a new diagram with the model's elements the result mentions and the relationships between elements it mentions, a relationship bringing its ends; laid out as a tree, each element at its notation's default size; named in a dialog; opened

---

### Requirement 17: Relationship Graph (la-gram)

**User Story:** As an architect, I want to see what an element is related to — directly and a few steps out — as a graph, narrow it to the kinds of elements and relationships I care about, and take the result elsewhere.

#### Acceptance Criteria

1. The **Graph** tab under the canvas draws the relationships around the selected element: the element in the middle, every qualified relationship within *n* hops in either direction, and the elements at their ends
2. The depth is selectable, 1–5 hops (2 by default, remembered); the layout is selectable (rings around the element, tree, force-directed), and the graph can be fitted to the panel
3. Element types and relationship types can be filtered (all shown by default, with counts); a type left out is not traversed — the graph is pruned, not only greyed
4. Nodes and edges are drawn with the notation: fill colour and badge glyph of the element type; line style and end decorations of the relationship type; the relationship's own name after its type
5. The graph follows the selection (canvas, tree, catalog); clicking a node or edge selects that concept; double-clicking a node makes it the middle
6. The SPARQL query behind the graph is offered as a `SELECT` (a table: one row per relationship, with source, relationship type and target, and their names — the default, remembered) or a `CONSTRUCT` (the triples); either can be run in the SPARQL Query tab or downloaded (`.rq`). What is drawn can be downloaded as Turtle (`.ttl`) with the model's prefixes. The exported query, run on the same model, returns exactly what is drawn (the tab draws by walking the store, which tests hold to the query's result); in la-gram it runs in tens of milliseconds at a few hundred elements
7. **＋ New view** makes the drawn graph a diagram: its elements and relationships, laid out as drawn, each element at its notation's default size (Req 16.3)
8. The tab does no work while it is not shown; while shown it refreshes, debounced, when the model changes; a graph at depth 5 draws in milliseconds in a model of thousands of elements

