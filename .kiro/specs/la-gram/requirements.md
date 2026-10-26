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
criterion says so. Requirements 12–19 are specific to la-gram. The broader,
implementation-independent tool specification is `docs/linked-archi-tool-spec.md`.

## Glossary

- **Model** — an `arch:Model`: elements, relationships and views. At runtime the
  store's default graph; at rest a file.
- **Element / Relationship** — model concepts. A relationship is an
  `arch:QualifiedRelationship` subclass instance with `arch:source`/`arch:target`
  *and* the unqualified triple its class maps to (`arch:unqualifiedForm`), which
  the instance `rdf:reifies` (RDF 1.2).
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
   - *la-gram:* the selector lists `meta.linked.archi`'s DCAT catalogue (`https://meta.linked.archi/catalog`): every metamodel manifest it themes `languages`, `frameworks`, `extensions` or `core`, under those sections, by label (the examples' metamodels are not offered), A copy ships with the app, so the list is complete offline; unless offline, the published catalogue replaces it when it arrives, so a newly published metamodel is offered without a new la-gram (`src/metamodel-manager/catalogue.ts`)
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
12. **Basic, the generic language** — meta.linked.archi's Basic, bundled so it works offline: added to a language or alone, it offers its element types (Node, SpecialNode, GroupNode) and its relationship types, of which **Connection** relates any two elements — of Basic, of another language, or across them — and ranks last among a language's relationships (like Association, it never makes a choice ambiguous); Association and Aggregation keep Basic's restrictions. The first-loaded language's grouping stays the default. Unloading it keeps the core ontology every model depends on. A core class (`arch:Element`, `arch:QualifiedRelationship`) is never a palette type; Basic's notation draws one that a model contains
   - *la-gram:* `meta.linked.archi` publishes no core manifest, so la-gram bundles one (`assets/core/core-metamodel.ttl`) with a small classification (`assets/core/core-tax.ttl`, `https://meta.linked.archi/core/tax#`) naming the two generic concepts — the palette offers a core class only when this classification names it
12. Documents the editor cannot use (derivation rules, deliverable templates, reference models, the framework document) are recorded as *skipped* rather than fetched. Reference data is loaded: it names the values properties take

---

### Requirement 2: Palette Generation & Viewpoint Filtering

**User Story:** As a modeler, I want a palette derived from the loaded metamodel's ontology, grouped by its taxonomy and filtered by the view's viewpoint — so that the tool adapts to any metamodel without code changes.

#### Acceptance Criteria

1. Dual classification: the **SKOS taxonomy** decides which concepts appear and how they are grouped; the **OWL ontology** provides the class instantiated. Linked by shared IRI or `rdfs:seeAlso`
2. Only concrete (instantiable) element types are offered; `arch:isAbstractClass true` is excluded
3. Labels: `skos:prefLabel` → `rdfs:label` → local name
4. Definitions: `skos:definition` → `rdfs:comment`
5. Grouping derives from the taxonomy scoped by `arch:conceptClassification`, navigating `skos:narrower` and inverse `skos:broader`; group and axis roles are detected structurally; with no classification loaded the palette lists the ontology's element classes grouped by a guess from their names, and says so ("No classification loaded — types grouped by name")
6. Several classification axes are preserved; a "Group by" selector switches between them (structural axes preferred as default); no metamodel-specific special cases
7. Relationship-only axes are not offered for element grouping
8. The palette is filtered by the **open view's** viewpoint (`arch:includesConcept`); a viewpoint naming a class includes its subclasses (`rdfs:subClassOf*`), as the published viewpoint conformance shapes read it
9. Viewpoint filtering is non-destructive: elements outside the viewpoint stay on the canvas, greyed out, still editable
10. With no viewpoint, all concepts are offered
11. With several metamodels loaded, the palette shows the union
12. Visual notation comes from the metamodel's `arch:notationSet` (`arch-vis:NotationSet` / `arch-vis:VisualNotation`)
13. Each `arch-vis:VisualNotation` provides shape, fill, line, icon, icon placement, rendering mode and default size
14. Three rendering modes: `ShapeWithBadge`, `IconCentric`, `ShapeOnly`
15. **Presentation contexts** (`arch:presentationContextScheme`) are offered in the toolbar; the chosen context's `arch:usesNotationSet` restyles palette and canvas. The sets the contexts name are loaded with the metamodel, so an alternative set needs no other reference; the manifest's `arch:notationSet` stays the default
16. Notation lookup, the same for palette and canvas. For a class C, the active set A is the set that the active presentation context names with `arch:usesNotationSet`, or else the primary metamodel's `arch:notationSet`. The fallback layers F are the default sets (`arch:notationSet`) of all loaded metamodels except A itself, in load order. F includes the default set of A's own metamodel when a presentation context picked an alternative set. (1) A descriptor in A for C. (2) A descriptor for C in F, the first match in load order. (3) C's own `arch:prefVisNotation`. (4) A descriptor for the nearest superclass of C that has one in A or F. The walk goes breadth-first over `rdfs:subClassOf`: by distance first, and superclasses at the same distance in IRI order. It stops at `arch:Element` and `arch:QualifiedRelationship`. For each superclass, A is checked first, then F in load order. (5) Built-in defaults. Elements: a rectangle with a white fill and a black line. Relationships: a solid black line. Anything published for the class itself beats anything inherited; among inherited descriptors the nearest ancestor wins; the active set only breaks ties. Relationships are drawn black unless a descriptor states a colour; they differ by line style and arrowhead
17. **Relationship ends** are drawn from the published marker symbols: each `arch-vis:Decoration` names its SVG with `arch-vis:decorSymbol`, placed as the vocabulary describes (pointing in +x, the connector meeting the middle of its viewBox's right edge, mirrored at a source end, `currentColor` taking the line's colour). The core-vis markers ship with the app; built-in geometry draws a decoration only while its symbol loads, or when none is published or it cannot be loaded
18. **Element shapes** are drawn as the notation describes them, so the canvas matches the published pictures. The eight core shapes (`Rectangle`, `RoundedRectangle`, `Octagon`, `Ellipse`, `Circle`, `Hexagon`, `Diamond`, `Parallelogram`) are drawn natively. Any other shape is declared by the notation that uses it — ArchiMate's 3D box, banded, tabbed and wavy rectangles, cloud and folder; EDGY's arrow and pill; C4's person, mobile device, web browser and cylinder — with a core fallback and its geometry as path templates (`arch-vis:outlinePath`, `detailPath`, `contentBox`, `labelBox`, `shapeVariables`), and drawn from those: no notation needs code. A shape whose templates cannot be evaluated, or that has none, is drawn as its fallback; one with neither, as a rectangle. Only core-vis's own names are core shapes. Inner lines (a template's `detailPath`) are drawn but are not outline: connections dock against the outline. The badge and the label sit in the content box (below a band, on a 3D box's front face, above a wave); the label in the label box when there is one (a folder's tab), on as many lines as it is tall enough for. `arch-vis:borderStyle` dashes or dots the outline (ArchiMate's grouping). The label takes `arch-vis:fontColor`, else the line colour (under an IconCentric icon, else black). The badge is the published glyph as it is: its lines opaque, transparent where the element's fill shows through. A shape too small to hold one line of its label (a junction's 15 px circle) draws no badge, and its name — if it has one of its own, not its type's — under it, where it is also typed when renamed
19. **A look per kind, a set per audience.** A kind of element with a look of its own is a subclass with a descriptor of its own (C4: `c4:Database` ⊂ `c4:Container`, drawn as a cylinder); a different look for a different audience is a notation set chosen by a presentation context (Req 2.15). Notation data has no conditions on element values

---

### Requirement 3: Element Creation & Properties

**User Story:** As a modeler, I want to create elements from the palette, name them, and manage their properties, so that each element carries full semantic metadata.

#### Acceptance Criteria

1. Dragging a palette entry onto the canvas creates the element at the drop point; clicking an entry arms click-to-place
2. Each element has a stable IRI (UUID-based, minted at creation, never changed), its class, a language-tagged `skos:prefLabel`, and `arch:inModel`; it is placed in the open view as an `arch-vis:ArchNode`
3. The label is editable in the property panel — and on the canvas, in the element's box: double-click it (or select it and press F2), type (the name starts selected, so typing replaces it), Enter or a click elsewhere keeps it, Esc drops it; one line, and never empty. It is the `skos:prefLabel` in the language shown (other languages' names are kept), an undoable canvas step; the canvas, the tree and the property panel follow
4. Selecting an element (canvas or tree) shows it in the property panel (the Properties tab under the canvas): kind, type, IRI, properties, relationships, the views it appears in. Fields are named in words and links by the name of what they link to, so the panel reads without knowing RDF; clicking a field's name or a link shows the IRIs behind it. A link's value is added by picking a concept of the model by name (or typing an address or text)
5. Properties are persisted with the element and included in every export
6. Properties are added by picking or typing a property and a value; values can be removed (not the type, not the name). The picker offers what applies to the concept's type (by `rdfs:domain` / SHACL), what the model already uses, documentation properties, and — folded — the rest; never diagram geometry, notation styling, metamodel-authoring terms or a property its vocabulary deprecates (`owl:deprecated`). Entries show the name first, the prefixed IRI smaller. Any property can be typed: a plain name (a new property in the model's namespace, `m:owner`), a prefixed name, or an IRI. The panel lists, in order: ID (the IRI), type, `inModel`, `prefLabel`, `skos:definition` — the name and the definition always, empty until filled in (emptying the definition removes it; the name cannot be emptied) — then — in the panel's own *Properties* tab, with the add field — every other property by label. `arch:inView` is not listed: the views are in the toolbar and under "Appears in views". A property whose SHACL shape lists its values (`sh:in`) is a choice of them, for adding and editing, each labelled by its name in the loaded data (a metamodel's reference data: "Serverless Function") else its local name in words — a link too, which is then offered as an attribute (Backstage's `bs:lifecycleState`); a boolean is a checkbox (true/false when adding); an added value takes the shape's datatype. An edit replaces the value edited and no other (the name in another language stays); with a view open, each edit, addition and removal is an undoable step, and undo puts the canvas back too
7. Deleting: **Delete from View** (the canvas default — Delete key, pad ×) removes the placement only; **Delete from Model** (pad ✖, tree menu) removes the element everywhere after a confirmation listing the views it appears in
8. Delete from Model removes every relationship connected to the element, in every view
9. Edit latency ≤ 16 ms per command
10. **About ‹type›** — a section of the left panel, under the model tree, tells what the loaded metamodels say about the selected concept's type (for a view, its viewpoint) — or about a type picked in the palette, until something is selected: from the ontology its definition, other names, guidance (`skos:scopeNote`), typical ends and unqualified form of a relationship, a viewpoint's concepts, stakeholders, concerns and purposes, the classes it specializes (with their definitions), what changed, and its source in the specification; from the taxonomy where it is classified — the path under each axis ("Element by Domain › Business Domain"), the group's definition and notes, and the other types in the group. The section folds to its header ("About Business Actor") and is resized by its top edge — its height and folding remembered; its parts fold too, and which are open is remembered; any type or concept it names opens its own page, with a way back; a new selection shows its own type again. With nothing selected, or a type the metamodels say nothing about, it says so
11. **Change an element's type** — from the property panel, where an element's *Type* is a choice of every element type of the loaded metamodels, searched by name (grouped as in the palette; types that share a name show their IRIs, and the list's "Show IRIs" shows every one; also for an element not in the open view), or from the right-click menu's "Change type…", a searchable menu of the same types with the current one marked, where types that share a name show their IRIs and "Show IRIs" (the same setting) shows every one. The element keeps its IRI, name, properties and placement in every view; a name that was still the old type's default becomes the new type's. Relationships the new type is not permitted in are named first (e.g. "Assignment → Cashier") and, if the user goes ahead, kept — validation flags them; nothing is deleted. One undoable step
12. **Nesting** — an element is drawn inside another by dropping or moving it there (an element too small to hold a name, a junction, holds nothing); the placement is stored as `arch-vis:inNode` on its node, bounds staying in the diagram's coordinates. What is inside moves with its container, which grows to hold it, and the container's name moves to its top. A drop into an element offers the relationships the nesting may stand for — those whose notation lets nesting draw them, with the dropped element as the end drawn inside (`arch-vis:nestedEnd`), and the metamodel permits between the two (ArchiMate: composition, aggregation, assignment, realization, access, specialization; C4: containment, deployment) — or None; the one picked is created in the model and not drawn as a line. Nothing is offered when the model already relates them so. One undoable step each

---

### Requirement 4: Relationship Creation & Integrity

**User Story:** As a modeler, I want to create relationships the metamodel allows, with the tool keeping the model structurally sound.

#### Acceptance Criteria

1. Selecting an element shows diagram-js's context pad with Connect and Append
2. Connect (pad or toolbar tool), Append and "change type" offer only the relationship types the metamodel permits for the pair, best first: where the metamodel publishes relationship shapes (ArchiMate 4.0 and 3.2 — the relationship matrix), exactly the pairs they list, a shape on a superclass applying to its subclasses (Composition ⊂ Aggregation); elsewhere the `arch:domainIncludes`/`arch:rangeIncludes` hints (closure-aware); within what is permitted: first a relationship a scoped proposal order of the language names for the two elements (`arch:RelationshipProposalOrder` with `arch:domainIncludes`), then those the language's metamodel figures draw for the pair (the relationship tables' `drawnBy`, ArchiMate 4.0 and 3.2) in the language's general proposal order, then those the tables let a modeller draw directly (the tables' upper case — ArchiMate 4.0 and 3.2), then those permitted only as the conclusion of a derivation, then the fallbacks — Association and the core's generic relationship; within the last three, a relationship whose `arch:domainIncludes`/`arch:rangeIncludes` hints describe the pair first. The menus say why in words ("proposed first", "drawn in the metamodel", "only by derivation", "always permitted")
3. Dropping the connection on a target creates the relationship with the best-ranked type; the pad's "change type" menu lists the alternatives
4. Append ("+" on the pad) lists the element types a relationship is permitted to, with their icons, and creates the new element *and* the relationship to it, as one undo step. When one specific relationship is permitted (Association aside, directed or not) it is created directly; when several are, a second step asks which, Association last. A drag from the menu takes the best-ranked one. The menu has two tabs: **New element** (the above, grouped by the palette's categories) and **Existing relationships** (n) — the relationships the element already has in the model, those whose other end is not in the view first; a click brings the other end into the view beside the element (right for outgoing, left for incoming, at a free spot) with the relationship drawn, a drag places it where dropped; nothing new is created in the model
5. Relationship types are in the palette; picking one arms the connect tool with that type, required: a pair the metamodel does not permit it for cannot be connected, and releasing on one says which relationships the pair permits (never a different type in its place)
6. Connections are bound to their elements and follow them
7. Each relationship is a qualified resource (stable IRI, class type, `arch:source`, `arch:target`, `arch:inModel`) *and* the unqualified triple, which the resource `rdf:reifies` (RDF 1.2, kept in step through retype and reconnect, added on load where missing); it is drawn as an `arch-vis:Link` with its route
8. Relationships are first-class: selectable, with properties, in the tree, in the property panel
9. Relationships support custom properties like elements
10. Connections cannot exist unattached (diagram-js reconnect rules)
11. Changing a relationship's type keeps its IRI and properties (retyped in place), undoably
12. Deletion as for elements: from the view by default, from the model on request
13. `domainIncludes`/`rangeIncludes` are indicative; SHACL decides validity — the relationship shapes both for what is offered and in validation, so an offered relationship never fails validation
14. A kind of relationship is a subclass of its relationship class, sharing its predicate (ArchiMate's `ReadAccess`, `WriteAccess`, `ReadWriteAccess` and `DirectedAssociation`): it is offered wherever its class is, drawn with its own ends, and changed by changing the relationship's type. A bare triple with the shared predicate is the most general class
15. Two selected elements: the context pad offers "Connect these two…", a menu of the relationships they may have in either direction, ranked as connect ranks them (derived-only ones marked); the pick creates the relationship, as one undo step

---

### Requirement 5: RDF Export

**User Story:** As an architect, I want to save the model as RDF, so it can live in Git, be loaded into a triplestore, or be read by other Linked Data tools.

#### Acceptance Criteria

1. Export uses prefixed names where possible
2. Prefixes derive from the loaded vocabularies' own `vann:preferredNamespacePrefix`/`Uri` declarations plus the standard ones and `m:` (or the prefix the model declares) for the model's namespace; only prefixes used are written. Every IRI la-gram mints is a flat name in the model's namespace, so the model is written as prefixed names (`m:model`, `m:element-…`, `m:view-…`, `m:node-…`, `m:link-…`)
3. Labels are exported as language-tagged `skos:prefLabel`
4. Properties are exported as written (`skos:definition` for descriptions)
5. Relationships are exported in both forms (qualified resource and unqualified triple), with the resource's `rdf:reifies` of the triple — in every format but JSON-LD, which has no triple terms; RDF 1.2 Turtle is read as well as written (a model carrying meta's derivations imports)
6. View geometry is exported as `arch-vis:ArchNode`/`arch-vis:Link` with bounds and routes
7. An **RDF panel** on the right shows the live model as it would be saved — hidden by default, toggled from the toolbar ("{ } RDF") or opened with `?rdf=1`; what it shows — the open **view** (the default: the view, its concepts and its diagram), the **selection** (every concept selected), or the whole **model** (a model too large to show gives its size, with Copy and Download) — remembered per browser; format selector (Turtle default), a "geometry" toggle (the no-geometry profile), counts of what is shown (elements, relationships, views, triples), Copy and Download of what is shown; syntax-highlighted; the selected concept's statements are highlighted and clicking a subject's statements selects it; it does no work while hidden and refreshes debounced while shown; resizable by its left edge (width remembered per browser)
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
3. Validation runs after every change, debounced (300 ms); the compiled shapes engine is cached until the metamodels change. It runs off the UI thread (a Web Worker in the browser and the desktop app), so editing never waits for it; a change made while it runs is validated when it ends, and only the latest results are shown. After an edit only the concepts whose results it can change are validated again — the same results as validating the whole model, which is done on opening and when the metamodels change
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
10. Saving a version is an explicit action: the History tab saves a *checkpoint* of the model's working state with a message (and the author's collaboration name), kept on this machine per model. *la-gram:* it says "checkpoint", not "commit", which means a Git commit (Req 18)
11. Joining a room loads its persisted state
12. The same model always serializes to the same text (deterministic ordering)
13. Delete from view vs. from model, as Req 3.7
14. Version history: the checkpoints, newest first, with the triples each added and removed; a checkpoint's differences from the one before or from the model now; restore a checkpoint — one undoable step
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
6. Panels hideable — the model tree, the palette and the RDF panel; the bottom panel folds to its tabs and maximizes; the RDF panel maximizes too (⤢ in its header; Esc or ⤡ restores; one panel at a time)
7. Panels resizable with persisted sizes — the model tree by its right edge, the palette and the RDF panel by their left edge, the bottom panel by its top edge (remembered per browser; the canvas keeps at least 240 × 160 px)
8. Selecting on the canvas updates the property panel and the tree
9. Canvas context actions are diagram-js's context pad (delete from view, delete from model, connect, append, a relationship's change type) and a **right-click menu** on elements and relationships, at the pointer — on a line wherever it is clicked, its handles included: Rename (F2) or a relationship's Rename…, Change type… (Req 3.11) or Change relationship type…, Append…; Properties, Show in model tree, Show relationship graph or a relationship's Show source and Show target; Copy IRI; Delete from view, Delete from model… On the empty canvas, the open view's: Rename view…, Set viewpoint…, Duplicate view; Select all, Zoom to fit; View properties, Show in model tree; Copy IRI; Delete view…
10. Keyboard: Delete, Ctrl/Cmd+Z/Y, zoom; keys typed in panel fields never reach the canvas

---

### Requirement 12: Catalog & Matrix Views (la-gram)

1. A view may be a Catalog (tabular listing of elements by type, inline editing) or a Matrix (relationships between two element types)
2. Opening such a view shows the corresponding component in the centre
3. The matrix reads relationships in both the current and the retired vocabulary
4. A catalog lists, and a matrix indexes, the elements the view presents — its `arch:inView` members (the core's "a Catalog that lists it, a Matrix that indexes it"); an "Add" picker adds the model's elements of a type, and a catalog row can be removed (its membership, not the element)
5. A catalog groups its members by type, with a column for each property they have (structural links left out); a matrix takes its rows and columns from its members of a chosen row type and column type (by default the two most common), the choice kept per view in the browser

### Requirement 13: Import (la-gram)

1. ArchiMate Model Exchange File Format (3.x) files import as ArchiMate 3.2 models: elements, relationships (including relationship-to-relationship; an access's `accessType` and an association's `isDirected` as the kinds of access and `am:DirectedAssociation`, an absent `accessType` being the format's default, Write), property values, and diagrams with nested nodes and bendpoints
2. `AndJunction`/`OrJunction` map onto the ontology's `Junction_And`/`Junction_Or`
3. Types the loaded ontology does not define are reported, not invented
4. Nodes that stand for no element are skipped and counted; a node nested in another is drawn inside its nearest ancestor that stands for an element
5. Any RDF file can be opened as a model (Req 9.8); one without `arch:Model` is adopted (model resource, membership, and a grid layout when it has no geometry)

### Requirement 14: Diagram Export (la-gram)

1. The open view exports as SVG and PNG, cropped to content, without interaction chrome

### Requirement 15: Web & Desktop (la-gram)

1. One codebase runs in modern browsers and as an Electron app
2. The desktop build reads and writes files natively — through the native dialogs, and only a file chosen in one; the web build uses file pickers and downloads
3. The desktop renderer runs sandboxed, without Node, under a Content-Security-Policy that admits script only from the app itself

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

---

### Requirement 18: Git Storage (la-gram, optional module)

**User Story:** As an architect, I want to open a model from a Git repository and save it back as a commit — given the repository's link and an access token — so that the model is versioned and reviewed where the rest of the architecture lives.

#### Acceptance Criteria

1. Git storage is a module that can be switched off. Off, la-gram shows nothing of it, loads none of its code, sends nothing to a Git host and reads no stored token. It is switched in the build (`LA_GRAM_GIT=off` leaves it out of the bundle altogether) and, in a build that has it, by a setting on this machine — on by default, *File › Settings…* — which `?git=off` overrides for the session
2. A repository is given by its link as copied from the browser — `https://github.com/org/repo`, `https://gitlab.com/group/subgroup/repo`, a GitHub Enterprise or self-managed GitLab address — optionally naming a branch and a file in it (`…/blob/main/models/shop.ttl`, `…/-/blob/main/models/shop.ttl`). The host decides the provider: GitHub and GitLab first; others (Gitea, Bitbucket, Azure DevOps) later, behind the same interface
3. The module talks to the host's REST API over HTTPS — no Git client, no clone, no proxy — so the web and desktop builds behave alike. A self-hosted server that refuses cross-origin requests works in the desktop build only, and the web build says so
4. Access is by a token the user gives: on GitHub a fine-grained personal access token with *Contents: read and write* on the repository (read to open only), on GitLab a personal, project or group access token with `api` (`read_repository` to open only). A public repository opens without one
5. The token is a secret. It is sent only to the host it was given for, and never written into the model, a saved file, the URL, the collaboration room, the log or an error message. The desktop build keeps it encrypted with the operating system's keychain, in the main process; the web build keeps it for the session, or in this browser when the user asks it to. A token can be forgotten
6. **Save to Git** commits the model as one file — in a format of Req 9.8, which the path's extension decides, Turtle by default, and deterministic (Req 9.12), so the commit's diff is the change — to a branch and path (`models/<model name>.ttl` by default) with a message (`Update <model name>` by default); creating the file when it is not there. It may commit to a new branch, started from the chosen one. The commit is the token's account's
7. A save never overwrites a change it has not seen: the commit names the version of the file it replaces (the one opened, or saved last); when the file has moved on, nothing is written, and the user chooses — open the newer version, save to a new branch, or overwrite
8. After a save or an open the model is bound to that file: the next save commits there without asking again for repository, branch and path. The binding — host, repository, branch, path, the file's version and the commit it is at — is kept per model on this machine, as version history is (Req 9.10), not in the model. A commit leaves the model clean (no unsaved changes)
9. **Open from Git**: a link to a file opens it; a link to a repository, or a branch, lists the model files in it (Req 9.8's extensions) to choose one. It opens as Open does — declared metamodels loaded, retired vocabulary migrated (Req 9.15) — and binds the model. `?git=<link>` opens one at startup
10. Failures are said in words: a wrong or expired token, no access, no such repository, branch or file, the file changed (criterion 7), a rate limit, a file too large, the network or a cross-origin refusal
11. In a collaboration room, opening from Git replaces the room's model, asking first as Open does; saving commits what the room holds; the token and the binding stay with the user who saves
12. Checkpoints saved in the History tab (Req 9.10) stay on this machine: a Git save is one commit of the model as it is, not a push of them
13. *Configured by the deployment* (Req 19): the Git hosts la-gram may talk to — each with its kind (GitHub or GitLab) and API address. When the list is given, an address on any other host is refused and no token is sent there; a listed self-hosted host needs no choice of kind. Without the list, any host, as before
14. *Configured by the deployment*: whether a token may be remembered — `ask` (the checkbox is offered; the default) or `never` (every token is kept for the session only, on the web and the desktop alike); and a default repository and folder for new saves
15. *Personal settings* (Req 19): a default repository, branch and folder for new saves, the commit message (a template: `{action}` Add or Update, `{model}`, `{path}`, `{branch}`; `{action} {model}` by default), the prefix of a new branch's suggested name (`la-gram/` by default), and whether the token checkbox starts ticked. A personal setting wins over the deployment's default, never over its policy (criteria 13–14)
16. The kind chosen for a self-hosted host not in the deployment's list is remembered for that host on this machine, and offered next time
17. No token is ever configured: a configuration that holds one is refused

---

### Requirement 19: Configuration (la-gram)

**User Story:** As whoever deploys la-gram for an organisation, I want to set once which Git hosts it may use, what it remembers and which modules it offers; as an architect, I want my own defaults kept — so that la-gram fits the organisation without a rebuild, and me without retyping.

#### Acceptance Criteria

1. **Deployment configuration**: an optional `la-gram.config.json` beside the app's `index.html` — dropped into a deployed web build, or put into a build or desktop package with `LA_GRAM_CONFIG=<file>`. Without it la-gram behaves as it does with none of these settings
2. It says, per switchable module (Req 18.1), `on` (the default), `off` (off until the user switches it on) or `unavailable` (not offered, as if the build left it out); and for Git storage what Req 18.13–18.14 list
3. It is read once, at startup, from the app's own origin only: no URL parameter points to another, so a link cannot widen what a deployment allows. No file — or a page served in its place, as a server answering every path with its index does — means no configuration
4. A file that is there but cannot be read — not JSON, not the expected shape, an unknown policy value, a token in it — is reported in words, and what it governs fails closed: Git storage does not start, rather than run without the hosts list it may have meant to give. Unknown keys are reported and ignored
5. **Settings** (*File › Settings…*, replacing *File › Modules…*): one dialog with a section per part of la-gram — the modules' switches, and each module's own settings (Git: Req 18.15, the tokens kept, to forget one). Kept on this machine (this browser profile), applied at once
6. What the deployment enforces is shown, not offered for change, and says it is set by the deployment; what it only defaults is offered, the deployment's value as the default
7. Precedence, first winning: the build (a module left out); the deployment's `unavailable` and its policies (Req 18.13–18.14); the address (`?git=off`, for the session); personal settings; the deployment's defaults; la-gram's own

