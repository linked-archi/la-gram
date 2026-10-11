> Copied from `tools/modellers/excalidraw-linked-archi-yjs-demo/linked-archi-tool-spec.md` (2026-09-25) so this repository is self-contained. It is implementation-independent; la-gram's own requirements are in `.kiro/specs/la-gram/`.
>
> **Updated 2026-09-26 (v0.2)** with what building la-gram settled: the core namespace IRI (§0), property editing (§5.4), validation display (§5.5), formats and a live RDF view (§5.13), the model namespace and IRI shape (§8.1), the at-rest graph layout (§8.2), a triple-set Y.Doc (§8.3), and the implementation status (Appendix D).
>
> **Updated 2026-10-10:** drawing from the notation data — core shapes natively, a notation's own shapes from their path templates, relationship ends from the published marker symbols (§5.2 notes); allowed values as a choice in property editing (§5.4); the implementation status (Appendix D).

# Linked.Archi Modeling Tool — Specification

**Version:** 0.2 (draft, 2026-09-26)
**Status:** Working specification — interface contracts are normative, implementation options are illustrative
**Scope:** A collaborative, semantic-driven modeling tool that consumes `meta.linked.archi` assets and supports the full lifecycle from freehand ideation to formally typed, SHACL-validated enterprise architecture.

---

## 0. Document conventions

- Words in **MUST** / **SHOULD** / **MAY** carry RFC 2119 weight when capitalized.
- Sections titled "Interface" are normative — any implementation must satisfy them.
- Sections titled "Implementation option" are illustrative — they are concrete realizations of an interface and are explicitly substitutable.
- All IRIs use the `arch:` prefix for the Linked.Archi core namespace (`https://meta.linked.archi/core#`), `arch-vis:` for core-vis (`https://meta.linked.archi/core-vis#`), and `:` (`m:` in la-gram) for the model's own namespace (§8.1).

---

## 1. Introduction

### 1.1 Purpose

The tool enables individuals and teams to describe enterprise architecture — at any level of formality — as an RDF graph backed by the metamodels, ontologies, taxonomies, SHACL shapes, viewpoints, and deliverable templates published by `meta.linked.archi`. It is collaborative (Miro-grade), pluggable in storage and rendering, and supports a sketch-first workflow that progressively hardens into a fully typed model.

### 1.2 Design philosophy

Six principles drive every design choice:

1. **The metamodel is data, not code.** Every concept that drives the UI — palette entries, relationship validity, property forms, viewpoint composition, document templates — is loaded at runtime from RDF assets. Replacing or extending a metamodel requires no recompilation.
2. **Interfaces over implementations.** The tool defines small interfaces (storage, validator, palette provider, renderer, sync provider, AI tool) and treats each implementation as substitutable. A team may run the same tool against Oxigraph in the browser, Fuseki on a server, or GraphDB in a corporate datacenter.
3. **One canvas, many formalities.** Ideation sketches and rigorously typed architecture live on the same canvas. Promotion from sketch to typed element is an explicit, reversible operation — never a re-creation.
4. **SHACL is the validation contract.** The tool surfaces real `sh:ValidationResult` entries — the same a server-side validator would emit — so what the user sees is what production validation will report.
5. **Provenance is mandatory.** Every triple — whether typed by a human, inferred by a rule, or proposed by an AI — carries `prov:wasGeneratedBy` provenance so trust can be audited.
6. **CRDT is the truth at runtime; RDF is the truth at rest.** The Y.Doc is the live state during a session; persistent storage is RDF (Turtle in Git, triples in a store, or both).

### 1.3 In scope / out of scope

In scope: metamodel loading, palette generation, relationship validity enforcement, property editing, SHACL validation, viewpoint filtering, deliverable generation, real-time collaboration, freehand sketching, progressive typing, AI assistance via MCP, persistence to RDF.

Out of scope (v0.1): identity/SSO, organization management, payments, mobile-native apps, simulation/execution of the modeled systems.

---

## 2. Definitions

- **Metamodel** — a bundle of OWL ontology, SKOS taxonomy, SHACL shapes, viewpoints, and deliverable templates declared via an `arch:Metamodel` manifest.
- **Element** — a node in the model. Always has at least `rdf:type :Element`. May additionally have one or more specialized types (e.g. `rdf:type cp:Microservice`).
- **Relationship** — an edge between two elements. Always has at least `rdf:type :Relationship` and an unqualified predicate; may also have a qualified-relationship resource carrying metadata.
- **Sketch artifact** — a freehand stroke, image, sticky note, or text annotation on the canvas. Has no semantic class until promoted.
- **Promotion** — the explicit act of attaching a more specific `rdf:type` to an existing element (or converting a sketch artifact into an element).
- **Viewpoint** — a filtered, stakeholder-specific projection of a model defined by `arch:Viewpoint` individuals.
- **Presentation context** — a stakeholder profile (Executive, Architect, Developer, …) that reshapes palette, detail level, and available deliverable templates.
- **Workspace** — a single live editing session, identified by a room ID. Backed by one Y.Doc and projects to one or more RDF named graphs.
- **Pane** — one user's local view of a workspace.

---

## 3. The ideation-to-modeling continuum

The tool supports four formality bands on the same canvas, distinguished only by what each element claims about itself in RDF:

| Band | rdf:type assertions | Validation runs | Typical UI |
|---|---|---|---|
| **Sketch** | none (the artifact is not yet an RDF subject) | none | freehand strokes, sticky notes |
| **Ideation** | `:Element` / `:Relationship` only | base shape: label required | rounded rectangle, neutral color |
| **Domain-typed** | `:Element`, `domain:Concept` (e.g. `:Capability`) | base shape + domain shapes | typed chip, domain color |
| **Fully typed** | `:Element`, `domain:Concept`, plus a fine-grained class (e.g. `cp:Microservice`) | full SHACL node shape | full notation, all properties |

Movement between bands **MUST** be reversible and lossless:

- **Promote**: add a more specific `rdf:type`. The element keeps its existing properties; new properties may now be required by the more specific shape, which appear as new SHACL violations until filled.
- **Demote**: remove a specific `rdf:type`. Properties that are no longer required remain on the element (they are not silently dropped) but lose their validation enforcement.
- **Convert sketch to element**: turn a freehand region or sticky note into an `:Element` with `:Element` as its only type. The original stroke remains attached as a `:Annotation` with `:annotates` linking it to the new element.

This continuum is the architectural answer to "the tool does not need to differ much as the ideation can simply use generic core classes." A whiteboard scribble, a brown-paper post-it, and a TOGAF ADD all live in the same RDF graph, distinguished only by their type assertions.

### 3.1 The base shapes

The project-local namespace MUST declare two base classes and the matching SHACL shapes:

```turtle
:Element a owl:Class ;
  rdfs:label "Element" .

:Relationship a owl:Class ;
  rdfs:label "Relationship" .

:ElementShape a sh:NodeShape ;
  sh:targetClass :Element ;
  sh:property [
    sh:path rdfs:label ;
    sh:name "Label" ;
    sh:minCount 1 ;
    sh:message "Every element should have a label, even in ideation."
  ] .
```

All specialized metamodel classes (`cp:Microservice`, `archimate:ApplicationComponent`, etc.) **MUST** be declared as `rdfs:subClassOf :Element` so SHACL validation cascades cleanly.

---

## 4. Architecture layers

The tool is organized as a layered architecture. Each layer declares an interface; concrete implementations are listed in section 7.

```
┌─────────────────────────────────────────────────────────────┐
│  L6  Workbench shell (optional)                             │
│      file tree, multi-editor, problems pane, terminal       │
├─────────────────────────────────────────────────────────────┤
│  L5  AI / agent layer                                       │
│      MCP server, LLM tool calls, constrained generation     │
├─────────────────────────────────────────────────────────────┤
│  L4  Canvas + sketch surface                                │
│      infinite canvas, layers, freehand, awareness overlays  │
├─────────────────────────────────────────────────────────────┤
│  L3  Diagram & modeling framework                           │
│      palette, rules, properties panel, command stack        │
├─────────────────────────────────────────────────────────────┤
│  L2  Engine services                                        │
│      SPARQL · SHACL · derivation rules · deliverable gen    │
├─────────────────────────────────────────────────────────────┤
│  L1b Collaboration backbone     │  L1a RDF storage adapter  │
│      CRDT, awareness, sync      │      query/update/list    │
├─────────────────────────────────────────────────────────────┤
│  L0  Semantic asset sources                                 │
│      ontologies, taxonomies, SHACL, viewpoints, templates   │
└─────────────────────────────────────────────────────────────┘
```

Each layer above may be **omitted** independently: a CLI deployment skips L3–L6; an embeddable widget skips L6; a standalone web app skips L6 but keeps everything else.

---

## 5. Functional specification

For each capability, the spec lists: the **goal**, the **interface contract** (normative), and **implementation notes**.

### 5.1 Metamodel loading

**Goal.** At startup or on demand, load one or more `arch:Metamodel` bundles and make their assets queryable.

**Interface.**

```typescript
interface MetamodelLoader {
  // Load a metamodel by manifest IRI; resolves all five linked assets
  load(manifestIri: IRI): Promise<MetamodelHandle>;
  // List all loaded metamodels
  list(): MetamodelHandle[];
  // Unload (releases memory but not persisted data)
  unload(handle: MetamodelHandle): void;
}

interface MetamodelHandle {
  manifestIri: IRI;
  ontologyGraph: NamedGraph;       // arch:ontologyGraph
  taxonomyGraph: NamedGraph;       // arch:taxonomyGraph
  shapesGraph: NamedGraph;         // arch:shapesGraph
  viewpointGraph: NamedGraph;      // arch:viewpointGraph
  templateGraph: NamedGraph;       // arch:templateGraph
}
```

**Notes.** A workspace MAY load multiple metamodels simultaneously (e.g. ArchiMate 4.0 plus a custom Cloud Platform extension); the palette, validity, and validation **MUST** honor the union.

### 5.2 Palette generation

**Goal.** Produce the palette entries the user sees, derived from the loaded metamodels.

**Interface.**

```typescript
interface PaletteProvider {
  getEntries(context: PaletteContext): PaletteEntry[];
}

interface PaletteContext {
  loadedMetamodels: MetamodelHandle[];
  activeViewpoint?: IRI;
  presentationContext?: IRI;
  formalityBand: 'sketch' | 'ideation' | 'domain' | 'full';
}

interface PaletteEntry {
  classIri: IRI;
  label: string;          // skos:prefLabel
  description?: string;
  groupLabel: string;     // from the SKOS taxonomy
  visualNotation: VisualNotation;
}
```

**Notes.** A kind of element with a look of its own **SHOULD** be a subclass with a descriptor of its own, and a different look for a different audience a different notation set chosen by a presentation context — not a condition on element values. An element **SHOULD** be drawn from its `arch-vis:Style` as the core-vis vocabulary describes each value — the eight core `arch-vis:ShapeType`s natively, and a notation's own shape from its path templates (its inner lines are not part of the outline connections meet), else as its `arch-vis:fallbackShape`, `arch-vis:borderStyle` for the outline, and each `arch-vis:Decoration`'s `arch-vis:decorSymbol` for relationship ends — so that a diagram looks like the notation's published pictures. Entries **MUST** be derived from SPARQL queries over the union of loaded ontologies + taxonomies. In `sketch` and `ideation` bands, the palette **SHOULD** be restricted to `:Element` and the most generic relationship types. The active viewpoint's `arch:includesConcept` set filters entries when set.

### 5.3 Relationship proposal & validity

**Goal.** Given a candidate source/target pair, determine which relationship types are valid.

**Interface.**

```typescript
interface RulesProvider {
  validRelationships(source: ElementRef, target: ElementRef): RelationshipCandidate[];
  canMove(elements: ElementRef[], target: Point): boolean;
  canCreate(classIri: IRI, target: Point): boolean;
}

interface RelationshipCandidate {
  classIri: IRI;
  label: string;
  derivationDistance: 0 | 1 | 2;   // direct, derived via rule, derived via inference
}
```

**Notes.** Validity **MUST** combine `arch:domainIncludes` / `arch:rangeIncludes` from ontologies with SHACL relationship-validity shapes; where shapes exist they decide what is offered, not only what validation reports afterwards (a shape on a relationship superclass applies to its subclasses, as in validation). When more than one candidate is valid, the tool **SHOULD** present a choice rather than auto-selecting; a relationship permitted between any two elements (ArchiMate's Association) need not count towards the choice. Nesting one element inside another is drawing, stored as `arch-vis:inNode`: a tool **MAY** offer the relationships it may stand for — those whose notation names the nested end (`arch-vis:nestedEnd`) and the validity rules permit — and **MUST NOT** create one unasked.

### 5.4 Property editing

**Goal.** For a selected element, render an editable form derived from its SHACL node shape.

**Interface.**

```typescript
interface PropertyShapeReader {
  getShape(elementIri: IRI): PropertyShape;
}

interface PropertyShape {
  classIri: IRI;
  fields: PropertyField[];
}

interface PropertyField {
  path: IRI;                        // sh:path
  label: string;                    // sh:name
  required: boolean;                // sh:minCount >= 1
  multiplicity: { min: number; max?: number };
  datatype?: IRI;                   // sh:datatype
  allowedValues?: Array<Literal | IRI>; // sh:in → a choice (values may be IRIs, e.g. named states)
  pattern?: string;                 // sh:pattern → regex
  message?: string;                 // sh:message
}
```

**Notes.** Field order **SHOULD** follow `sh:order` when present; required fields come first otherwise. Property edits **MUST** flow through the same command stack as graph mutations so undo/redo and provenance work uniformly.

**Identity first.** The form **SHOULD** open with what identifies the concept — its IRI, its type(s), the model it belongs to, its name (`skos:prefLabel`) and its definition (`skos:definition`) — and list the name and definition even when empty, so they can be filled in; the concept's other properties follow. Membership in views (`arch:inView`) **SHOULD** be shown as navigation (the views the concept appears in), not as editable fields. Relationships and view membership **MAY** be shown alongside the form (la-gram: vertical tabs *information · properties · analysis · views*).

**Adding a property.** The properties offered for a concept **SHOULD** be those that apply to its type — whose `rdfs:domain`, or a SHACL property shape targeting the type or a superclass, says so — together with properties the model already uses and general documentation properties (SKOS, Dublin Core, PROV); the rest **MAY** be reachable by search. Diagram geometry and notation styling (`arch-vis:`) and metamodel-authoring annotations (`arch:unqualifiedForm`, `arch:domainIncludes`, …) **MUST NOT** be offered as properties of model concepts. A property's human-readable name **SHOULD** be shown before its IRI. Any IRI or prefixed name **MAY** be entered; a bare name **SHOULD** become a property in the model's namespace (§8.1).

### 5.5 Live SHACL validation

**Goal.** After every edit, report violations and surface them on the canvas and in a problems panel.

**Interface.**

```typescript
interface Validator {
  validate(dataGraph: RDFGraph, shapesGraph: RDFGraph): ValidationReport;
}

interface ValidationReport {
  conforms: boolean;
  results: ValidationResult[];
}

interface ValidationResult {
  focusNode: IRI;
  resultPath?: IRI;
  message: string;
  severity: 'sh:Violation' | 'sh:Warning' | 'sh:Info';
  sourceShape: IRI;
  sourceConstraintComponent: IRI;
}
```

**Notes.** Validation **MUST** run on every committed edit, debounced no longer than 250ms. Each `focusNode` **MUST** map back to a canvas element and be annotated visually. The report **MUST** carry the same fields the wire-format `sh:ValidationReport` would, so server-side validation produces identical output. Results **SHOULD** be grouped by severity, and the number of Violations **SHOULD** stay visible while the results list is not (la-gram: on the Validation tab). A severity stated on a node shape does not reach the property shapes nested in it, so published shapes state it on each property shape; a tool **MUST NOT** re-interpret severities.

### 5.6 Viewpoint filtering

**Goal.** Restrict the displayed model to elements relevant to a chosen viewpoint.

**Interface.**

```typescript
interface ViewpointFilter {
  apply(viewpointIri: IRI, model: ModelGraph): FilteredView;
}

interface FilteredView {
  visibleElements: Set<IRI>;
  visibleRelationships: Set<IRI>;
  hiddenWithIndicator: Set<IRI>;    // adjacent but hidden — shown as edge stubs
}
```

**Notes.** A viewpoint **SHOULD NOT** be a destructive filter — hidden elements remain in the underlying graph and become visible again when the viewpoint is cleared. A viewpoint that names a class **MUST** be read as including its subclasses (`rdfs:subClassOf*`), as the viewpoint conformance shapes do: a viewpoint naming `c4:Container` admits `c4:Database`.

### 5.7 Deliverable generation

**Goal.** Execute an `arch:DeliverableTemplate` against the current model and produce a structured document.

**Interface.**

```typescript
interface DeliverableGenerator {
  generate(templateIri: IRI, model: ModelGraph): GeneratedDeliverable;
}

interface GeneratedDeliverable {
  format: 'markdown' | 'html' | 'pdf' | 'docx';
  bytes: Uint8Array | string;
  sectionsExecuted: SectionTrace[];   // for debugging template authors
}
```

**Notes.** The generator **MUST** execute each `arch:TemplateSection`'s `arch:sectionQuery` SPARQL against the current data graph and bind the results to `arch:sectionResultKey` before rendering through the Handlebars/Jinja `arch:templateResource`. AI prose enhancement, if used, **MUST** be a separately auditable step that produces a diff against the deterministic baseline.

### 5.8 Freehand sketch layer

**Goal.** Allow free-form drawing alongside RDF-backed elements on the same canvas.

**Interface.**

```typescript
interface SketchLayer {
  strokes: Stroke[];
  shapes: BasicShape[];
  text: TextAnnotation[];
  stickies: StickyNote[];

  add(item: SketchItem): SketchItemId;
  remove(id: SketchItemId): void;
  promote(id: SketchItemId, asType: IRI): IRI;   // returns the new element IRI
  annotate(sketchId: SketchItemId, elementIri: IRI): void;
}
```

**Notes.** Sketch items **MUST** be persisted in the workspace's RDF graph as resources of type `:SketchArtifact` (subclass of `prov:Entity`), with geometry serialized as a literal blob. Promotion **MUST** mint a new element IRI and create a `:promotedFrom` link to the original sketch artifact so the lineage is preserved. The sketch layer **MAY** be hidden via viewpoint filter but **MUST NOT** be deleted by formality changes.

### 5.9 Progressive typing

**Goal.** Support the four-band continuum from section 3 as first-class operations.

**Interface.**

```typescript
interface TypePromoter {
  promote(elementIri: IRI, addedType: IRI): TypePromotionResult;
  demote(elementIri: IRI, removedType: IRI): void;
  currentBand(elementIri: IRI): FormalityBand;
  suggestPromotions(elementIri: IRI): TypeSuggestion[];   // AI-assisted, optional
}

interface TypePromotionResult {
  newRequiredFields: PropertyField[];   // appear in property panel
  newViolations: ValidationResult[];    // surface immediately
}
```

**Notes.** Promotion is reversible. Suggestions **MAY** be generated by an AI tool that inspects the element's label, properties, and neighborhood and returns ranked type candidates from the loaded metamodels.

### 5.10 Real-time collaboration

**Goal.** Multiple users **MUST** be able to edit the same workspace concurrently with sub-200ms perceived latency over a typical residential connection.

**Interface.**

```typescript
interface SyncProvider {
  connect(workspaceId: string, identity: UserIdentity): Promise<SyncSession>;
}

interface SyncSession {
  awareness: AwarenessChannel;
  document: SharedDocument;
  disconnect(): void;
}

interface AwarenessChannel {
  setCursor(point: Point): void;
  setSelection(elementIris: IRI[]): void;
  onPeerUpdate(callback: (peers: PeerState[]) => void): void;
}
```

**Notes.** The shared document **SHOULD** be a CRDT (Yjs, Automerge, or equivalent) so offline edits and network partitions reconcile without operator intervention. Awareness state (cursors, selections, current tool) **MUST NOT** be persisted to RDF — it is ephemeral session metadata.

### 5.11 Persistence & versioning

**Goal.** Save the workspace state so it survives session and machine boundaries; support review and rollback.

**Interface.**

```typescript
interface StorageAdapter {
  read(workspaceId: string): Promise<ModelGraph>;
  write(workspaceId: string, graph: ModelGraph, meta: CommitMeta): Promise<CommitId>;
  history(workspaceId: string): AsyncIterable<CommitMeta>;
  diff(from: CommitId, to: CommitId): RDFDiff;
}

interface CommitMeta {
  id: CommitId;
  timestamp: ISOTimestamp;
  authorIris: IRI[];
  message?: string;
}
```

**Notes.** Two implementation patterns are equally valid: Turtle-in-Git (atomic commits, code-review friendly, slower for large models) or named-graph snapshots in a triplestore (faster, less reviewable). The tool **SHOULD** support both behind the same `StorageAdapter` interface.

### 5.12 AI assistance

**Goal.** AI agents read and write the model through the same interfaces as humans, with provenance attached to every AI-authored triple.

**Interface.**

```typescript
interface AITool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  execute(input: any, context: AIContext): Promise<AIResult>;
}

interface AIContext {
  workspaceId: string;
  authorIri: IRI;       // the AI agent's stable identity
  user: UserIdentity;   // the human on whose behalf it acts
}

interface AIResult {
  proposedEdits: GraphEdit[];           // not committed automatically
  validationPreview: ValidationReport;  // SHACL run on proposed state
  rationale: string;
  provenance: ProvenanceBundle;         // PROV-O for every proposed triple
}
```

**Notes.** All AI tools **MUST** be exposed via MCP so any compatible client (Claude Desktop, Claude Code, custom agents) can drive them. AI-proposed edits **MUST** be SHACL-validated before being offered for human acceptance. Accepted edits **MUST** carry `prov:wasGeneratedBy` referencing the AI agent's IRI and `prov:wasAttributedTo` referencing the human who accepted them.

### 5.13 Import / export

**Goal.** Interoperate with existing modeling tools and data formats.

**Interface.**

```typescript
interface FormatAdapter {
  name: string;
  mediaTypes: string[];
  importFrom(bytes: Uint8Array): Promise<ModelGraph>;
  exportTo(graph: ModelGraph): Promise<Uint8Array>;
}
```

**Notes.** v0.1 **MUST** support Turtle, TriG, N-Quads, and JSON-LD; N-Triples and RDF/XML **SHOULD** be supported too. v0.2 **SHOULD** support the ArchiMate Exchange Format (import), Archi's `.archimate` XML and BPMN 2.0 XML.

Export **MUST** write the model only, never the metamodel, in a deterministic order (the same model always serializes to the same text, so files diff cleanly); prefixes **SHOULD** come from the vocabularies' own `vann:` declarations plus the model's own (§8.1), and graph-carrying formats **SHOULD** use the Linked.Archi layout (§8.2). A profile without diagram geometry **SHOULD** be offered. The tool **SHOULD** offer a live view of the model's serialization that is exactly what export writes (la-gram: the RDF panel).

---

## 6. Non-functional requirements

| Concern | Target |
|---|---|
| Cold-start to interactive | ≤ 3 seconds with a 500-element seed model |
| Edit latency (local) | ≤ 16ms per command |
| Sync latency (peer-to-peer) | ≤ 200ms in the same region |
| SHACL revalidation | ≤ 250ms debounce; full revalidation completes in ≤ 1s for 5,000-triple data graph |
| Model size | Up to 50,000 triples per workspace without paging |
| Offline | Edits **MUST** queue locally and reconcile on reconnect |
| Browser support | Latest two versions of Chrome, Firefox, Safari, Edge |
| Accessibility | WCAG 2.2 AA: keyboard navigation for all canvas actions, screen-reader-friendly property panel, sufficient contrast |
| Internationalization | UI strings externalized; element labels render in the user's preferred `skos:prefLabel` language |

---

## 7. Implementation options

This section enumerates concrete realizations of the interfaces in section 5. Any combination satisfying every interface is a valid build.

### 7.1 Three reference compositions

| Composition | Best when |
|---|---|
| **A. Browser-first ("Miro-like")** | Wide audience, no IDE needed, one-click-to-edit URL, AI features visible inline |
| **B. GLSP-based standalone** | Diagram-centric, server-side semantic engine, multiple client kinds (browser + VS Code + agent) need to share one server |
| **C. Theia workbench** | Architecture-as-code teams who edit Turtle files directly, want a Problems pane for SHACL, expect Git-backed flows |

The remainder of this section lists implementation options per layer; any composition is a valid path through them.

### 7.2 L4 — Canvas / sketch surface

| Option | License | Notes |
|---|---|---|
| **Excalidraw + custom semantic layer** | MIT | Strongest freehand fit. Excalidraw provides the sketch experience natively; the semantic layer renders RDF-backed elements as a separate stratum and tracks promotion. Recommended when the ideation-to-modeling continuum is the headline feature. |
| **tldraw SDK** | Source-available (commercial license required for prod) | Closest to Miro feel; first-class multiplayer via `@tldraw/sync`. Excluded if "fully OSS" is required. |
| **ReactFlow / XYFlow** | MIT | Node-and-edge focused; weaker freehand story. Good when the tool will primarily render typed elements. |
| **diagram-js** (bpmn-io) | MIT | Mature palette/rules/context-pad pattern; replace `bpmn-moddle` with a Linked.Archi-derived moddle descriptor. No native multiplayer; CRDT bridge required. |
| **Sprotty** (Eclipse) | EPL | The renderer underneath GLSP. Mandatory if composition B or C is chosen. |
| **maxGraph / mxGraph** | Apache-2.0 | Powers draw.io. Heavy but exhaustively featured. |
| **AntV X6 / G6** | MIT | Graph-focused alternatives; English documentation has improved. |
| **Custom SVG** | — | Acceptable for proof-of-concept (see the demo artifacts in this conversation). Not recommended for production. |

### 7.3 L3 — Modeling framework

| Option | Notes |
|---|---|
| **Eclipse GLSP (Graphical Language Server Platform)** | Recommended for compositions B and C. Server in Node or Java hosts the metamodel, rules, and validation; client renders. Multiple clients share one server. |
| **Sirius Web** | Spring + PostgreSQL + GraphQL + React. Faster path if the team is Java/Spring native and willing to bridge RDF↔EMF. |
| **diagram-js modules** | Use the palette/rules/properties patterns directly in the browser. Recommended for composition A. |
| **Custom** | Acceptable if the framework is kept thin and matches the section 5 interfaces. |

### 7.4 L2 — Engine services

The engine **MUST** provide SPARQL 1.1, SHACL validation, and SHACL rules. Concrete libraries:

| Service | Browser | Server |
|---|---|---|
| RDF store | Oxigraph WASM, n3.js Store | Oxigraph native, Apache Jena Fuseki, GraphDB, Stardog |
| SPARQL engine | Comunica, Oxigraph WASM | Fuseki, GraphDB, Stardog, Oxigraph |
| SHACL validator | rdf-validate-shacl (Zazuko), shacl-engine | pyshacl, Jena SHACL, TopBraid SHACL API |
| Reasoner | (limited) Comunica RDFS inference | Jena RDFS/OWL, ELK, HermiT, Pellet |
| Deliverable generator | Handlebars + SPARQL bindings (browser-side) | Jinja2 + SPARQL (server-side), Pandoc for output formats |

### 7.5 L1a — RDF storage adapter

| Option | Best when |
|---|---|
| **Oxigraph (server or WASM)** | Default for new deployments; one engine for both ends |
| **Apache Jena / Fuseki** | JVM shops; mature; native SHACL |
| **GraphDB** | Need strong OWL reasoning |
| **Stardog** | Need data virtualization over relational sources |
| **AWS Neptune** | AWS-native; accept the SPARQL 1.1 caveats |
| **Turtle-in-Git + Comunica federation** | Architecture-as-code, no server required, CI-friendly |
| **Custom HTTP endpoint** | Treat any SPARQL 1.1 endpoint as an adapter |

### 7.6 L1b — Collaboration backbone

| Option | Notes |
|---|---|
| **Yjs + y-websocket** | Default; mature; rich provider ecosystem |
| **Yjs + y-webrtc** | P2P; no server; works for small teams |
| **Yjs + y-broadcastchannel** | Same-origin cross-tab only; trivial demo path |
| **Yjs + PartyKit / Cloudflare Durable Objects** | Managed-but-portable runtime |
| **Yjs + Liveblocks** | Managed service; tradeoff: vendor lock-in |
| **Automerge** | Stronger offline semantics; sparser bindings; pick if offline is the top priority |
| **GLSP protocol** | If composition B/C: extend GLSP actions with awareness messages instead of bolting on Yjs |

### 7.7 L5 — AI / agent layer

| Capability | Implementation |
|---|---|
| Tool exposure | MCP server hosting `query-graph`, `propose-element`, `propose-relationship`, `validate`, `generate-deliverable`, `suggest-promotions` |
| RAG over graph | Pre-built natural-language cards per element (label + types + neighbors), indexed via embeddings (e.g. text-embedding-3) |
| Constrained generation | SHACL validation as a gate on every proposed graph edit; rejected proposals are returned with the violation list for the agent to repair |
| Orchestration | LangChain, LlamaIndex (Python); Vercel AI SDK, LangChain.js (TypeScript) |
| Provenance | PROV-O bundle attached to every accepted triple; agent identity is a stable IRI |

### 7.8 L6 — Workbench shell

| Option | Use when |
|---|---|
| **Eclipse Theia** | Composition C; users want VS Code-style multi-pane editing |
| **VS Code extension** | Users already live in VS Code; the modeling tool is a side feature |
| **Apache Che** | Multi-tenant cloud-hosted workspaces with Kubernetes isolation |
| **None** | Composition A; the tool is a standalone web app |

---

## 8. Data and storage model

### 8.1 IRI conventions

| Resource | IRI pattern |
|---|---|
| Workspace | `https://{instance}/ws/{workspaceId}` |
| Element | `https://{instance}/ws/{workspaceId}/el/{uuid}` |
| Relationship (qualified form) | `https://{instance}/ws/{workspaceId}/rel/{uuid}` |
| Sketch artifact | `https://{instance}/ws/{workspaceId}/sketch/{uuid}` |
| Commit | `https://{instance}/ws/{workspaceId}/commit/{sha}` |
| User | `https://{instance}/u/{username}` (or external IdP IRI) |
| AI agent | `https://{instance}/agent/{agentId}` |

The table is illustrative, for a multi-workspace server. IRIs **MUST NOT** encode mutable data (labels, positions). Once minted, an element IRI is permanent for the lifetime of the workspace — changed only by an explicit namespace move (below).

**Model namespace.** Each model **MUST** have a namespace, stated on the model resource with `vann:preferredNamespaceUri` and `vann:preferredNamespacePrefix` — the convention the Linked.Archi ontologies use for their own — and every IRI minted for the model **MUST** be in it. The namespace **SHOULD** follow the published layout `{base}{notation}/{modelId}/` (Linked.Archi DD-15/DD-29). The base **MUST** be configurable and **SHOULD** default to a placeholder such as `https://example.org/`, never to a domain the tool does not own. Local names **SHOULD** be valid Turtle prefixed-name locals — letters, digits, `-`, `_`, and no `/` — so the whole model serializes as prefixed names:

| Resource | IRI (la-gram) | Written as |
|---|---|---|
| Model | `{ns}model` | `m:model` |
| Element | `{ns}element-{uuid}` | `m:element-…` |
| Relationship (qualified form) | `{ns}relationship-{uuid}` | `m:relationship-…` |
| View | `{ns}view-{uuid}` | `m:view-…` |
| Diagram node / link | `{ns}node-{uuid}` / `{ns}link-{uuid}` | `m:node-…` / `m:link-…` |
| Route (list cells, points) | `{link}-points-{i}` / `{link}-p{i}` | `m:link-…-p0` |

Moving a model to another namespace renames every IRI the model owns and **MUST** be applied as one change (one CRDT update), never partially; terms a loaded vocabulary defines are never renamed. A model that states no namespace gets one derived from its IRI.

### 8.2 Named graph layout

Each workspace persists into the following named graphs:

| Graph IRI suffix | Contents |
|---|---|
| `/data` | The model: elements, relationships, properties |
| `/sketch` | Sketch artifacts, strokes, annotations |
| `/provenance` | PROV-O triples for every authored or AI-generated triple |
| `/awareness` | (ephemeral) presence info during a session — **MUST NOT** be persisted |
| `/derived` | Triples produced by SHACL rules; rebuildable from `/data` |
| `/snapshot/{commitId}` | Optional point-in-time snapshots when not using Git |

The workspace graphs describe a server-side store. At rest, a model file in a graph-carrying format (TriG, N-Quads, JSON-LD) **SHOULD** use the Linked.Archi layout (DD-15) under the model's namespace — `{ns}graph/model` (the model resource), `{ns}graph/semantic` (elements, relationships, views, membership), `{ns}graph/views` (geometry only, droppable on its own); formats without graphs carry the union, with `arch:inModel` on every concept keeping membership recoverable. In a browser store, the model **MAY** be the default graph with each metamodel document in a named graph of its own (la-gram), which lets a metamodel be swapped without touching the model.

### 8.3 Y.Doc shape

```
yDoc
├─ Y.Map "elements"           // elementId → { type, x, y, properties, createdBy }
├─ Y.Map "relationships"      // relId → { type, source, target, createdBy }
├─ Y.Map "sketches"           // sketchId → { kind, geometry, attached?: elementId }
├─ Y.Map "viewports"          // paneId → { x, y, zoom }   (ephemeral)
└─ Y.Map "metadata"           // { workspaceId, loadedMetamodels, activeViewpoint }
```

The Y.Doc is projected to RDF on every commit; projection rules are deterministic so the same Y.Doc state always produces the same triples.

**Alternative: a triple set.** The Y.Doc **MAY** instead hold the RDF graph itself — one `Y.Map` keyed by each triple's canonical N-Triples form (a graph is a set of triples, and a map-as-set is its CRDT). The RDF store then stays the model of record at runtime too, and no projection is needed; a single-valued property edited concurrently needs a deterministic convergence rule (la-gram: the greatest key wins), and blank nodes are avoided because they have no identity across replicas. This is la-gram's shape; §8.4 then does not apply.

### 8.4 Projection rules (Y.Doc → RDF)

For every entry in `elements`:

```
<el/{id}> rdf:type <{type1}>, <{type2}>, ... .   # one per declared type
<el/{id}> rdfs:label "{label}" .
<el/{id}> {propPath} {propValue} .              # one per filled property
<el/{id}> :renderedAt [ :x {x} ; :y {y} ] .      # visual position
```

For every entry in `relationships`:

```
<el/{source}> <{type}> <el/{target}> .           # unqualified form
<rel/{id}> rdf:type :Relationship, <{type}> ;    # qualified form
   :unqualifiedForm <{type}> ;
   :source <el/{source}> ;
   :target <el/{target}> .
```

This satisfies the Linked.Archi three-declaration pattern and keeps SPARQL traversal cheap.

---

## 9. Interface catalog (summary)

For convenient reference:

| Interface | Section | Purpose |
|---|---|---|
| `MetamodelLoader` | 5.1 | Load `arch:Metamodel` bundles |
| `PaletteProvider` | 5.2 | Derive palette entries |
| `RulesProvider` | 5.3 | Relationship validity, move/create rules |
| `PropertyShapeReader` | 5.4 | SHACL-derived property forms |
| `Validator` | 5.5 | SHACL validation |
| `ViewpointFilter` | 5.6 | Viewpoint projection |
| `DeliverableGenerator` | 5.7 | Template execution |
| `SketchLayer` | 5.8 | Freehand and sticky artifacts |
| `TypePromoter` | 5.9 | Progressive typing |
| `SyncProvider` | 5.10 | Real-time collaboration |
| `StorageAdapter` | 5.11 | Persistence and versioning |
| `AITool` | 5.12 | Agent integration |
| `FormatAdapter` | 5.13 | Import / export |

Every interface **MUST** be small enough to be re-implementable in under 500 lines of code in a typical language. If an implementation grows beyond that, the interface is doing too much and **SHOULD** be split.

---

## 10. AI / agent integration in detail

### 10.1 The MCP server

A reference MCP server **MUST** expose at least these tools:

- `list-metamodels` → loaded metamodel manifest IRIs
- `query-graph` → execute a SPARQL query against the data + shapes + ontology graphs
- `get-element` → resolve an element IRI to its full state
- `propose-element` → validate-and-stage a new element (SHACL gate)
- `propose-relationship` → validate-and-stage a new relationship (validity matrix + SHACL gate)
- `propose-promotion` → suggest type promotions for an element
- `generate-deliverable` → execute a `arch:DeliverableTemplate`
- `validate` → run SHACL on the current data graph

And these prompts:

- `explore-ontology` → guided walkthrough of the loaded metamodels
- `architecture-overview` → narrative summary of the model
- `impact-analysis` → trace dependencies from a focus element

### 10.2 The proposal lifecycle

```
agent ──proposes──▶ stage area ──validates──▶ diff view ──human decides──▶ commit
                       │                          │
                       └── reject? return ────────┘
                            violations to agent
```

This loop is non-negotiable. No AI-authored triple lands in the data graph without (a) passing SHACL and (b) being explicitly accepted by a human, with both facts recorded in `/provenance`.

### 10.3 Sketch-aware AI

When the active band is Sketch or Ideation, AI assistance **SHOULD** include:

- "Suggest what this sketch element might become" — returns ranked type candidates
- "Cluster these sketches into capability domains" — proposes grouping into `:Capability` elements
- "Propose missing connections" — given an ideation diagram with floating elements, suggests likely `:dependsOn` / `:realizes` relationships

These are all instances of the same `AITool` interface; they differ only in their prompt templates and result shapes.

---

## 11. Adoption roadmap

A phased plan that maps the interfaces above to deliverables:

| Phase | Months | Deliverables |
|---|---|---|
| **0. Foundation** | 1 | Storage adapter, metamodel loader, SHACL validator wired to a CLI; ingest a Linked.Archi manifest, validate a Turtle model, output a deliverable |
| **1. Single-user editor** | 2–3 | Canvas + palette + property panel + rules; one user; one metamodel; in-browser Oxigraph |
| **2. Collaboration** | 4–5 | Yjs sync, awareness cursors, projection to RDF on commit; multi-tab and multi-machine |
| **3. Sketch + progressive typing** | 6–7 | Freehand layer (Excalidraw or equivalent), promotion flows, base `:Element` / `:Relationship` shapes |
| **4. AI** | 8–9 | MCP server, proposal lifecycle, constrained generation, sketch-aware suggestions |
| **5. Workbench (optional)** | 10–11 | Theia integration, Problems panel, Git-backed Turtle workflows |
| **6. Hardening** | 12 | Performance tuning, accessibility audit, internationalization, format adapters |

Phases 0–4 are **MUST**; 5–6 are **SHOULD**.

---

## 12. Open questions

These are decisions explicitly deferred until prototype evidence is available:

1. **Granularity of CRDT operations.** Do we ship one Y.Doc op per character of a label edit (responsive but chatty), or batch (efficient but laggy)? Benchmark required.
2. **Eager vs. lazy RDF projection.** Project on every keystroke, or only on commit? Affects subscriber count and SHACL revalidation cost.
3. **Sketch geometry encoding.** Store strokes as inline literals (simple, large) or as references to a blob store (efficient, more moving parts)?
4. **Cross-metamodel promotion.** Should an `:Element` be promotable to a class from *any* loaded metamodel, or only the active one? Probably yes-to-any, but UI implications need work.
5. **AI agent identity.** One IRI per agent instance, or per agent + per workspace + per user? Affects PROV-O cardinality.
6. **Awareness state size.** How much per-user data (cursor, selection, tool, draft input) does awareness carry before we tier it?
7. **Conflict resolution for type promotions.** If user A demotes a class while user B is adding a property required by that class, what wins? CRDT defaults may be wrong here.
8. **License posture.** Apache-2.0 or EPL? Affects which OSS frameworks can be embedded versus federated.

---

## Appendix A — Linked.Archi asset inventory consumed

The tool **MUST** be able to consume the following published asset families without modification:

- Core ontology (`arch:`) — classes, properties, manifest type
- Modeling languages: ArchiMate 4.0, ArchiMate 3.2, BPMN 2.0.2, BPMN Lite, UML 2.5.1, C4 + Structurizr, Backstage, SAP LeanIX, Business Model Canvas, UAF, DoDAF
- Frameworks: TOGAF 10, TOGAF 9.2, Zachman, EA on a Page, EDGY 23, TIME, ATAM, ADMIT
- SKOS taxonomies for palette grouping and layer classification
- SHACL shape graphs: element shapes, relationship-validity shapes, principle shapes, viewpoint-conformance shapes, derivation rules (`sh:SPARQLRule`)
- Viewpoint definitions (`arch:Viewpoint` individuals)
- Deliverable templates (`arch:DeliverableTemplate` with `arch:TemplateSection` and SPARQL queries)
- Reference data and reference models
- Presentation contexts (Executive, Architect, Developer, …)
- Tactics extension, Reference Architecture ontology, ArchiMate Reference Models

---

## Appendix B — Glossary

- **CRDT** — Conflict-free Replicated Data Type
- **GLSP** — Graphical Language Server Platform (Eclipse)
- **IRI** — Internationalized Resource Identifier
- **MCP** — Model Context Protocol (Anthropic's open standard for AI tool exposure)
- **OWL** — Web Ontology Language
- **PROV-O** — W3C Provenance Ontology
- **RDF** — Resource Description Framework
- **SHACL** — Shapes Constraint Language
- **SKOS** — Simple Knowledge Organization System
- **SPARQL** — RDF query language

---

## Appendix C — Reference implementations worth studying

These are existing open-source projects whose patterns the build can lift or learn from:

- **Linked.Archi reference tooling** — static navigator (React + Comunica), MCP server (TypeScript + Oxigraph), validation script (Java + RDF4J), deliverable generator
- **bpmn-io / diagram-js** — palette, rules, properties patterns; the `moddle` JSON descriptor convention
- **Eclipse GLSP Workflow example** — fork-and-replace template for composition B
- **Eclipse Sirius Web** — full-stack reference for composition C-equivalent
- **Excalidraw** — freehand canvas, sticky notes, collaborative cursors
- **Archi** (Apache-2.0) — the original ArchiMate desktop modeler; canonical relationship-validity matrix as `.csv`
- **TopBraid Composer / WebProtégé** — ontology authoring UX patterns
- **VS Code's Problems panel** — gold standard for surfacing validation results
- **tldraw** (source-available) — sync architecture worth studying even if the SDK isn't licensed for production

---

## Appendix D — Implementation status (la-gram, 2026-10-10)

What la-gram (`tools/modellers/la-gram`) implements of this specification. Details: `.kiro/specs/la-gram/` (requirements, design, tasks).

| Section | Status in la-gram | Notes |
|---|---|---|
| §1.2 (1) metamodel is data | ✓ | Metamodels loaded at runtime from `meta.linked.archi`; ArchiMate 4.0 / 3.2 also bundled for offline use |
| §1.2 (5) provenance mandatory | ✗ | No `prov:` on authored triples yet |
| §1.2 (6) CRDT truth at runtime | differs | The RDF store is the model of record; the Y.Doc mirrors it as a triple set (§8.3 alternative) |
| §5.1 Metamodel loading | ✓ | Manifest discovery, parallel levels, `Accept: text/turtle`, catalogue, load by IRI, uploads, several at once, switching; the core ontology as a metamodel (generic element and relationship) |
| §5.2 Palette generation | ✓ | SKOS + OWL dual classification, axes, notation sets, presentation contexts; elements drawn as the notation describes them — the core shapes natively, a notation's own shapes from their path templates (else their fallback), relationship ends from the published marker symbols, badges as published, labels in `arch-vis:fontColor` |
| §5.3 Relationship validity | ✓ mostly | Offers exactly what the relationship shapes permit (hints only where no shape exists). Nesting offers what the notation lets it draw and the shapes permit, or none. Append asks which relationship when several specific ones are permitted, and has a second tab for the element's existing relationships (bringing the other end into the view); connect takes the one picked in the palette, else the best-ranked, changeable in place afterwards — not a choice up front as §5.3 asks; no suggestion popup for two selected elements yet |
| §5.4 Property editing | ✓ | SHACL-derived fields — `sh:in` values as a choice, labelled from the metamodel's reference data, booleans as a checkbox, added values typed by their shape; identity first; adding by applicability; custom names in the model namespace; an element's type as a choice of the loaded types. Property edits are undoable steps on the open view's stack |
| §5.5 Live SHACL validation | ✓ | Debounced 300 ms (spec: ≤ 250 ms); `sh:sparql` left to a server that does not exist yet; violations marked on the canvas and counted on the Validation tab |
| §5.6 Viewpoint filtering | ✓ | Palette filtered, outside-viewpoint shapes greyed, never removed |
| §5.7 Deliverable generation | ✗ | |
| §5.8 Freehand sketch layer | ✗ | |
| §5.9 Progressive typing | ✗ | |
| §5.10 Real-time collaboration | ✓ mostly | Yjs over Hocuspocus; presence, remote selection, soft locks; no remote cursors; awareness not persisted |
| §5.11 Persistence & versioning | partly | Files in six formats; rooms persisted by the server (`.nt` + `.ttl`); commits as N-Triples snapshots per model in IndexedDB, with history, diff (added/removed triples) and restore — on this machine, not yet in a shared store (Git or a triplestore) |
| §5.12 AI assistance | ✗ | |
| §5.13 Import / export | ✓ | Turtle, TriG, JSON-LD, N-Quads, N-Triples, RDF/XML; ArchiMate Exchange import; SVG/PNG; no-geometry profile; live RDF panel |
| (beyond this spec) Relationship graph | ✓ | The relationships around an element to a chosen depth, filterable by type; its query as SELECT (table) or CONSTRUCT, run in the SPARQL tab or exported; the graph as a new view or Turtle; SPARQL results render as a new view |
| (beyond this spec) Canvas editing | ✓ | Rename in place (double-click or F2), change an element's type (property panel or right-click), a right-click menu on elements and relationships |
| §8.1 IRI conventions | ✓ | Per-model namespace, flat local names, `vann:` on the model, Model settings to move it |
| §8.2 Named graph layout | ✓ at rest | DD-15 partition in graph formats; at runtime model = default graph, metamodels = named graphs |
| §8.3 / §8.4 Y.Doc | differs | Triple-set Y.Doc; labels are `skos:prefLabel`@lang (not `rdfs:label`), geometry is `arch-vis:ArchNode`/`Link` (not `:renderedAt`) |

---

*End of specification v0.2*
