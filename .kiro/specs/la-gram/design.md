# Design: la-gram

## Overview

The RDF store is the model of record. The diagram canvas (diagram-js), the model
tree, the property panel, catalog and matrix views, files on disk and the
collaboration document are all projections of it, and every change to the model
is a change to triples first. Metamodels are published Linked.Archi assets loaded
at runtime; nothing about any modelling language is compiled in.

This is the design as implemented. The behaviour it serves is in
`requirements.md`; the plan is `tasks.md`; the implementation-independent tool
specification is `docs/linked-archi-tool-spec.md`.

---

## Architecture

```mermaid
graph TB
    subgraph Browser["Browser / Electron renderer (TypeScript, Lit, webpack)"]
        subgraph UI["UI layer — src/ui"]
            Toolbar["app-toolbar<br/>file · metamodels · views · panel toggles · presence"]
            Tree["model-explorer<br/>model tree (left)"]
            Canvas["DiagramCanvas<br/>diagram-js + RDF modules"]
            Alt["catalog-view · matrix-view"]
            Bottom["bottom tabs (app-shell)<br/>property-panel (vertical tabs, property-picker) ·<br/>validation-panel · sparql-editor · graph-panel (Cytoscape.js)"]
            Palette["palette-panel (right)"]
            Rdf["rdf-panel (hidden by default)<br/>live Turtle / TriG / JSON-LD …"]
        end
        Mount["mount-ui — wiring, commands, dialogs"]
        subgraph Core["App — src/app.ts"]
            Session["ModelSession<br/>model + open view + namespace"]
            Managers["Element / Relationship / View managers<br/>property catalog"]
            MM["N3MetamodelLoader<br/>asset sources"]
            Val["RdfShaclValidator (cached)"]
            IO["ModelIO · ArchiMate importer"]
        end
        Store["ObservableRdfStore → Oxigraph (WASM)<br/>default graph = model · named graphs = metamodels"]
        Collab["collab/ — RdfYjsBinding + awareness"]
    end
    Server["server/collab-server.mjs<br/>Hocuspocus · rooms as .nt/.ttl · HTTP /rooms"]
    Meta["meta.linked.archi<br/>(and bundled copies under assets/)"]

    UI --> Mount --> Core --> Store
    Canvas -- "recorded, undoable changes" --> Store
    Store -- "change feed" --> Collab
    Collab <-- "WebSocket (Yjs)" --> Server
    MM -- "Accept: text/turtle" --> Meta
```

### Layers

| Layer | Directory | Responsibility |
|---|---|---|
| RDF engine | `src/rdf-engine` | Oxigraph store (native bulk load), observable wrapper (change feed, recording), IRI minting, parser/serializer, SHACL validator |
| Metamodel manager | `src/metamodel-manager` | Asset sources, manifest-driven loader, catalogue, palette generation (dual classification, axes, notation), viewpoints |
| Model manager | `src/model-manager` | Session, model namespace (minting, moving), element/relationship/view managers, cascade rules, queries, property catalog (what to offer when adding a property), legacy migration, shared vocabulary |
| Import/export | `src/import-export` | Model I/O (six formats, DD-15 partition, profiles), ArchiMate exchange import, SVG/PNG |
| UI | `src/ui` | Shell (layout, side panels, bottom tabs), panels, canvas, dialogs, mounting |
| Collaboration | `src/collab`, `server/` | Y.Doc binding, presence and locks, Hocuspocus server |
| Platform | `src/platform` | Web vs. Electron file access |

---

## Core concepts

### Model / view / canvas

| Concept | RDF | Where at runtime | Persisted |
|---|---|---|---|
| **Model** | `arch:Model` + `arch:modelConformsToMetamodel` + its namespace (`vann:preferredNamespaceUri` / `…Prefix`) | default graph | yes |
| **Element** | a metamodel class; `skos:prefLabel`@en; `arch:inModel` | default graph | yes |
| **Relationship** | `arch:QualifiedRelationship` subclass instance: `arch:source`, `arch:target`, `arch:inModel` — **plus** the unqualified triple (`arch:unqualifiedForm`) | default graph | yes |
| **View** | `arch:View` + `arch:Diagram`/`Catalog`/`Matrix`, `arch:inModel`, `arch:viewConformsToViewpoint` | default graph | yes |
| **Membership** | `arch:inView` on each concept a view presents | default graph | yes |
| **Geometry** | `arch-vis:ArchNode` (bounds, `archElement`, `view`), `arch-vis:Link` (`archRelationship`, `source`/`target` nodes, `points` list with IRI cells) | default graph | yes (droppable profile) |
| **Canvas** | diagram-js elements, keyed by concept IRI | memory | no |

One placement per element per view (the canvas keys shapes by element IRI).

### IRIs

UUID-based, minted at creation, never changed by editing (`rdf-engine/iri.ts`).
A model owns a **namespace**, `{base}{notation}/{modelId}/` (DD-15/DD-29), and
everything minted for it is a flat local name in it — flat because a Turtle
prefixed name cannot contain `/`, so the whole model is written with `m:`:

```
{base}{notation}/{uuid}/           namespace     (base: https://example.org/ unless configured)
{ns}model                          model         m:model
{ns}element-{uuid}                 element       m:element-…
{ns}relationship-{uuid}            relationship  m:relationship-…
{ns}view-{uuid}                    view          m:view-…
{ns}node-{uuid}                    ArchNode      m:node-…
{ns}link-{uuid}                    Link          m:link-…   route: {link}-points-{i} (cells), {link}-p{i} (points)
```

The namespace is stated on the model with the VANN properties the Linked.Archi
ontologies use for their own (`model-manager/model-namespace.ts`):

```turtle
m:model a arch:Model ;
    vann:preferredNamespacePrefix "m" ;
    vann:preferredNamespaceUri "https://example.org/archimate/3f2c…/" .
```

A model that states none (an older file, another tool's) gets a derived one:
`{ns}` for `{ns}model`, else the model IRI plus `/` — where earlier versions of
la-gram minted (`urn:la-gram:archimate/{uuid}/element/{uuid}`).

**Configuring it.** The base for new models is `https://example.org/` (a
placeholder domain) unless `createApp({ base })` / `?base=` says otherwise; New
model shows the namespace it will use and lets it be edited. **Model settings**
(the model name in the toolbar, File menu, tree menu) edits name, namespace and
prefix. Changing the namespace **moves** the model's IRIs into it by default:
every IRI in the model data under the old namespace is rewritten under the new
one, keeping its local name with any `/` turned into `-` (so legacy IRIs become
prefixable), and `arch:Model` becomes `{ns}model`. Terms a loaded vocabulary
defines are never renamed. The move is one store change — one Yjs update —
and a collaborator's session follows it to the same view under its new IRI
(`ModelSession.resync`). Unticking "move" keeps existing IRIs and mints only new
ones in the new namespace. The canvas re-opens the view, which starts a fresh
undo history, so the move itself is not undoable.

No blank nodes are minted: geometry is synchronised triple by triple, and a blank
node has no identity outside its store.

### Named graphs

At runtime the **default graph is the model** and each metamodel document is a
named graph keyed by its ontology IRI — which is what lets a metamodel be
swapped without touching the model and lets files contain only the model. At
rest, formats that carry graphs use DD-15:

```
{ns}graph/model       the arch:Model resource
{ns}graph/semantic    elements, relationships, views, membership
{ns}graph/views       arch-vis geometry only
```

With `{ns}` = `{base}{notation}/{modelId}/`, these are exactly DD-15's graph
IRIs. (The model resource itself is `{ns}model` rather than DD-15's
`{base}{notation}/{modelId}`, so that it too is a prefixed name, `m:model`.)

Loading flattens every quad into the default graph.

---

## Key flows

### Metamodel loading

`N3MetamodelLoader` reads the manifest, follows the `arch:*` asset properties
and `owl:imports` a level at a time in parallel, and asks an **asset source
chain** for each document IRI:

```
uploaded  →  bundled (assets/, mirrors meta.linked.archi)  →  remote (Accept: text/turtle)
```

(`bundled-first`, the browser default; `remote-first` and `offline` reorder or
drop the remote source). Every fetch revalidates (`cache: 'no-cache'`): neither
the static server nor meta.linked.archi sends `Cache-Control`, and a browser
would otherwise keep a heuristically fresh copy for hours. `assets/` is
refreshed from a linked-archi-meta checkout with `npm run sync-assets`, which
uses that repository's own publishing scripts for the mapping. Every discovered document gets a status (loaded,
already-loaded, skipped, unavailable, error) and an origin. Documents are bulk
loaded natively into Oxigraph — 110 ms for the 72 740-quad ArchiMate 3.2
relationship shapes, against 1.4 s quad by quad. Derivation rules, deliverable
templates, reference models and the framework document are skipped. A document
imported by its `owl:versionIRI` (meta's relationship tables import
`…/archimate4/onto/4.0#`) resolves to the bundled document it versions. Reference
data is loaded (and bundled for both ArchiMate versions): its `skos:prefLabel`s
label the `sh:in` choices in the property panel.

**Relationship ends** (Req 2.17). The palette carries each decoration's
published symbol (`decorationSymbols`: `arch-vis:decorSymbol` on the core-vis
`arch-vis:Decoration` individuals, resolved to the bundled
`assets/core-vis/markers/` copy). The renderer draws a `<marker>` from it:
the SVG is rebuilt from plain shape elements and their geometry and paint
attributes only (no scripts, handlers, styles or references), with the
symbol's viewBox and size, `refX`/`refY` at the middle of the viewBox's right
edge, `orient="auto-start-reverse"` at a source end, and `color` set to the
line colour for `currentColor`. The first connection to need a decoration
starts loading its symbol; until it arrives that marker uses built-in
geometry, and is then replaced in place (same id, so every line using it
follows). A symbol that cannot be loaded leaves the built-in marker.

**Element shapes** (Req 2.18). `notation-shapes.ts` turns a shape into one
geometry with two encodings: the drawn body (`shapeGeometry`: a `rect`,
`ellipse`, `circle`, `polygon` or `path`, plus `details`, a path of inner lines)
and the outline in absolute coordinates that connection docking crops against
(`shapePath`). The eight core shapes are coded. A notation's own shape is a
`CustomShape` that `notation.ts` reads from the notation data (`readCustomShape`:
the fallback and the path templates); `drawCustomShape` evaluates its
`shapeVariables` and fills each `{expression}` with a small parser of its own —
numbers, `w`, `h`, the variables, `+ - * /`, parentheses, `min`, `max`; never
`eval` — into the compact path form the core shapes use, and `translatePath`
moves the outline for docking. Templates are absolute SVG path commands, so
arcs and curves reach `path-intersection` as they stand. `shapeLayout` takes the
content and label boxes from the templates (a label box's height decides how
many lines the label gets). A template that cannot be evaluated is reported once
and the shape drawn as its fallback. The ArchiMate shapes come from the bundled
notation files, and their tests check them against the published pictures; the
C4 and EDGY ones are tested from fixtures mirroring linked-archi-meta. The label
is drawn in `arch-vis:fontColor`, else the line colour; under an IconCentric
icon, where it sits on the canvas, black unless `fontColor` is given.

`arch-vis:borderStyle` takes the relationship dash patterns. Badges stay
`<image href>`: the published glyphs are transparent where the element's fill
shows (the vocabulary's `arch-vis:iconSymbol` convention), so they need no
recolouring to match the pictures.

Palette generation (existing, unchanged in approach): dual classification over
the taxonomy (`conceptClassification`) and ontology, several axes. Notation is
resolved per class by `notation-resolver.ts` in five steps (Req 2.16):

For a class C, the active set A is the set that the active presentation context
names with `arch:usesNotationSet`, or else the primary metamodel's
`arch:notationSet`. The fallback layers F are the default sets
(`arch:notationSet`) of all loaded metamodels except A itself, in load order.
F includes the default set of A's own metamodel when a presentation context
picked an alternative set.

1. A descriptor in A for C.
2. A descriptor for C in F, the first match in load order.
3. C's own `arch:prefVisNotation`.
4. A descriptor for the nearest superclass of C that has one in A or F. The
   walk goes breadth-first over `rdfs:subClassOf`: by distance first, and
   superclasses at the same distance in IRI order. It stops at `arch:Element`
   and `arch:QualifiedRelationship`. For each superclass, A is checked first,
   then F in load order.
5. Built-in defaults. Elements: a rectangle with a white fill and a black line.
   Relationships: a solid black line.

Anything published for the class itself beats anything inherited; among
inherited descriptors the nearest ancestor wins; the active set only breaks
ties.

So a generic set such as Basic, when active, leaves ArchiMate's own notation in
place, and an extension subclass of an ArchiMate class with nothing of its own
takes its parent's look. `class-hierarchy.ts` does the walk. The palette
carries every resolved class in `notationIndex`. The canvas's
`NotationStyleRegistry` reads it for types the palette does not list, and so do
the Graph tab's type look and a new view's element sizes in `mount-ui.ts`,
through a registry of their own, so every path gives the same answer. The
loader also loads the sets the presentation contexts name
(`arch:usesNotationSet`).

**The core as a metamodel** ("Linked.Archi Core", bundled:
`core/core-metamodel.ttl`, `https://meta.linked.archi/core/metamodel#Core`).
Its `arch:modelConcepts` is the core ontology itself and its
`arch:conceptClassification` a small scheme (`core/core-tax.ttl`,
`…/core/tax#`): axis *Core Concepts* › group *Generic* › two concepts that
`rdfs:seeAlso` `arch:Element` ("Element") and `arch:QualifiedRelationship`
("Relationship"). Core classes are never palette types otherwise, and a
language's taxonomy listing one does not make it one: the palette
(`taxonomy.ts`, `palette-generator.ts`) and the relationship manager's type
query offer a core class only when the core's own classification names it, by
`rdfs:seeAlso`, and label it as the classification does. So that adding the
core does not disturb a language: its axis always sorts after the language's
(so a language's grouping stays the default), and under a language's axis the
generic element keeps its "Generic" group instead of falling into "Other". The
generic relationship has no domain or range, so it connects any two concepts;
it is scored below Association and, like Association, counts as generic in the
append menu (`isGenericRelationship`), so it never makes a choice ambiguous.
The core ontology document loads under its bundled `coreOntology` role, which
unloading never drops.

### Editing on the canvas — recorded changes

diagram-js owns *when* things happen (its command stack, rules, tools);
la-gram owns *what* the model becomes. Every canvas gesture that changes the
model runs its model operation inside a nested command:

| Gesture | diagram-js command | Nested RDF command |
|---|---|---|
| Palette drop / append | `shape.create` | `rdf.element.create` → element + node (snapshot for redo) |
| Tree drop / "add to view" | `shape.create` (existing IRI) | `rdf.store.change` → node; then draws its relationships (`connection.create` + existing-relationship hint) |
| Connect | `connection.create` | `rdf.relationship.create` → qualified resource + triple + link |
| Change type | `rdf.relationship.retype` | retype in place (same IRI) |
| Change an element's type (property panel, right-click menu) | `rdf.element.retype` | `rdf.store.change` → the `rdf:type` (and the default name); also redraws the shape in the new notation, on undo too |
| Rename in the box (double-click, F2) | `rdf.element.relabel` | `rdf.store.change` → the `skos:prefLabel` in the shown language; also relabels the shape, on undo too |
| Move / resize | `shape.move` / `shape.resize` | `rdf.store.change` → node bounds |
| Route change | `connection.layout` / `updateWaypoints` / `move` | `rdf.store.change` → point list |
| Reconnect end | `connection.reconnect` | `rdf.store.change` → ends, triple, links in other views |
| Delete (key, pad ×) | `shape.delete` / `connection.delete` | `rdf.store.change` → remove from **view** |
| Delete from model (pad ✖, tree) | `rdf.model.delete` | removes shapes, then the concept everywhere |
| Property edit, add, remove (property panel); rename from the tree; restore a version | `rdf.store.edit` (`DiagramCanvas.recordChange`) | the change itself, recorded; undo and redo redraw the canvas from the store |
| Drop or move into an element (nesting) | `shape.create` / `shape.move` with an element as parent | `rdf.store.change` → the node's `arch-vis:inNode`; `AutoResize` grows the containers (nested `shape.resize`); then the "which relationship?" menu — the one picked as `rdf.store.edit`, not drawn |

`rdf.store.change` runs its operation once inside `ObservableRdfStore.record`;
undo applies the inverse diff, redo re-applies it. Re-running logic on redo
would mint new IRIs; replaying the diff cannot.

Changing an element's type (`rdf-element-replace-menu-provider.ts`,
`rdf-element-retype.ts`) is `DiagramCanvas.retypeElement(iri, type)`, asked by
the property panel's type field (`property-retype`, answered so a cancelled
change puts the field back) and by the right-click menu's "Change type…", which
opens the `la-element-replace` popup: the canvas's palette definition — every
loaded element type, unfiltered by the viewpoint, grouped under the palette's
current axis — searching names and groups only (definitions would match half
the list). An element in the open view changes through the command, undoably;
one that is not (selected in the tree) changes in the store directly, like any
property panel edit. Before either, the canvas checks each of the element's relationships with
`getValidRelationships(source, target)` under the new type; any that would not
be permitted are passed to `confirmRetypeElement` (the app's confirm dialog,
listing them) and, if confirmed, kept for validation to flag — deleting
relationships to make a type change fit would silently lose model content.

The **right-click menu** (`rdf-context-menu-provider.ts`, popup provider
`la-context-menu`) opens on `element.contextmenu` for elements and
relationships (the browser's menu is suppressed; the concept is selected first).
The canvas decides the actions (`contextMenuActions`) in sections — edit
(Rename, Change type… / Change relationship type…), relate (Append…), show
(Properties, Show in model tree, Show relationship graph), copy (Copy IRI),
delete (Delete from view, Delete from model…) — and hands the "show" and
"copy" ones to the host (`onContextAction`). A menu an action opens (the type
menu, the append menu) is opened on the next tick: diagram-js closes the menu
an entry was picked from after its action runs. The pad keeps delete, connect,
append and a relationship's change type; an element's type moved to the panel
and the menu.

Renaming in the box (`ui/canvas/rdf-label-editing.ts`) uses
`diagram-js-direct-editing`, the text box bpmn-js edits its labels with (its
`DirectEditing` class, declared in la-gram's own module: the package entry
imports a diagram-js folder without `/index.js`, which Node's ESM loader
refuses). The provider offers element shapes only, lays the box over the shape
with the renderer's font scaled by the zoom and room for the badge, hides the
drawn name meanwhile (a marker), and selects the whole name. Completing with a
changed, non-empty name runs `rdf.element.relabel`; canvas commands are not
followed by a re-read of the store, so the command relabels the shape itself on
execute and on revert.

### Which relationships are permitted

`RelationshipManager.getValidRelationships(source, target)` answers for connect,
append and "change type". The authority is the metamodel's **relationship
shapes**: ArchiMate 4.0's and 3.2's are generated from the specification's
relationship matrix — one node shape per qualified relationship class whose
`sh:or` lists every permitted (source class, target classes) pair.
`model-manager/relationship-table.ts` reads them into a lookup, walking the RDF
lists with indexed quad lookups (136 ms for ArchiMate 4.0, 500 ms for 3.2; the
same as one SPARQL query with `rdf:rest*` took ~50 s), cached until the loaded
graphs change. As in validation, `sh:targetClass` reaches subclasses, so every
shape on a class in the relationship's closure must admit the pair — Composition
is allowed exactly where Aggregation is. Relationship classes no shape covers
(metamodels without relationship shapes) fall back to the `domainIncludes` /
`rangeIncludes` hints. Before the table, the hints admitted every ArchiMate 4.0
pair, and the relationship an append created by default failed the shapes for
68% of them.

**Direct first.** The shapes say what is permitted, not how: the relationship
tables meta publishes beside them (`archimate4-relationship-tables.ttl`,
`archimate3.2-relationship-tables.ttl`, bundled with role `relationshipTables`,
kept out of the shapes graph) also say which relationships a modeller may draw
directly — the specification's upper case — and which are permitted only as the
conclusion of a derivation (`am4:realizes am4rt:permittedDirectlyBy
am4rt:permitsDirectRealization`). `model-manager/direct-permissions.ts` reads
them, finding the annotation by its declaration and name
(`permittedDirectlyBy`) in whatever namespace, and the manager marks each
candidate `direct: true | false`, or leaves it unmarked where the tables do not
say (a junction, which they do not list). Candidates come in three tiers —
direct, only by derivation, the fallbacks (Association and the core's generic
relationship) — and by score within a tier; Specialization, valid between any
two elements of one type, is nudged down as Composition and Aggregation are. So
a derived-only relationship is offered but is the default only where nothing
except a fallback is direct: between two business actors in 4.0 the default is
Aggregation (Serving, Flow and Triggering are lower case), between a node and a
process a derived-only one (Assignment, the first of five at the same score)
rather than Association. The change-type menu says "only
by derivation", and so does the candidate's reason.

**Append.** "+" on the pad lists the element types some relationship is
permitted to, with the palette's icons. Association is permitted between any two
elements, so a silent default would always hide a choice: the entry decides
alone only when one *specific* relationship is permitted (or Association alone);
otherwise a second menu lists them, best-ranked first, Association last, and the
pick is required for that one append. A drag from the menu cannot pause to ask
and takes the best-ranked one.

**A relationship type from the palette.** Picking one arms the connect tool with
that type *required* (`RdfRuleProvider.setPreferredType`): `canConnect` answers
it or nothing, so a pair that does not permit it shows the not-allowed cursor,
and releasing on one creates nothing and tells the user why
(`RdfRuleProvider.refusal` → `DiagramCanvas` `onNotice` → a toast listing what
the pair permits). It used to be a mere preference, quietly replaced by the
best-ranked type where forbidden — which hid the rule.

**Existing relationships.** The same menu's header carries two tabs (diagram-js
header entries in their own group, styled as a tab strip): *New element* and
*Existing relationships (n)* — what the element is already related to in the
model, other ends not in the view listed first. A click places the other end
beside the source (`findFreePosition`, right of it for an outgoing relationship,
left for an incoming one) through the same path as the tree's "Add to current
view", which draws its relationships to what is placed; a drag is the tree's
drag. The tabs exist only when either list has something, because a header entry
alone makes a popup menu non-empty — and emptiness is what hides the pad's "+".

### Store → canvas

Changes that do not come from the canvas — a collaborator, the tree, the
property panel, opening a file — reach the canvas as `model-changed` events, and
`DiagramCanvas.syncFromStore()` reconciles the drawn view with the store
(add / remove / move / relabel / re-route) **without** the command stack, so they
never appear in the undo history. Markers (viewpoint, validation, remote
selection, lock) are kept per concept and re-applied to shapes drawn later.

### Layout

```
┌──────────────────────── toolbar ─────────────────────────┐
│ model    │ canvas                      │ palette │ RDF    │
│ tree     │─────────────────────────────│         │ (hidden│
│          │ [Properties|Validation|SPARQL|Graph]  │  until │
│          │ bottom panel                │         │ opened)│
└──────────┴─────────────────────────────┴─────────┴────────┘
```

`app-shell.ts` is a CSS grid with named slots: `explorer`, `canvas`,
`properties` / `validation` / `sparql` / `graph` (the bottom panel's tabs), `palette`,
`rdf`. The tree and the two right-hand columns are *side panels*: each column's
width is a CSS variable that is 0 while the panel is hidden, and each has a
drag handle on its inner edge — the tree's right (≥ 160 px), the palette's and
the RDF panel's left (≥ 180, ≥ 280 px). The bottom panel's row height is
dragged by its top edge (≥ 120 px); clicking the open tab folds the row to the
tab strip, and another tab opens and unfolds it. The canvas keeps at least
240 × 160 px.

*Maximized*, the bottom panel spans the grid's rows 2–3 and every column, over
the other panels (`z-index`), which stay laid out underneath and are `inert` —
so the canvas keeps its size, viewbox and selection, and nothing has to be
re-laid out on restore. Esc restores unless a dialog or a diagram-js popup is
open; so does folding, and `mount-ui` restores it when a view is opened. The
Graph tab watches its drawing area with a `ResizeObserver` (Cytoscape.js
notices window resizes only) and refits when it changes. Sizes, the open tab and the folding are remembered per browser in
`localStorage`. The Validation tab carries the number of violations, since it
is often not the open one. A `ResizeObserver` on the canvas host tells
diagram-js (`canvas.resized()`) whenever a panel changes the canvas's size.

### Property panel tabs

The panel (the bottom panel's Properties tab) has vertical tabs on the left,
under the heading (kind and type), each with a count where one applies:
**‹Kind› information** — ID, type, `inModel`, name, definition, always in that
order; **Properties** — everything else on the concept, then the add field;
**Analysis** — the relationships (or a relationship's ends); **Appears in
views**. Only the open tab's pane is rendered; its fields sit side by side where
there is room, a text area taking the whole row. Up/Down move between the tabs.
The open tab is kept in `localStorage` (`la-gram:property-panel-tab`), so it
holds from one selection to the next and across reloads; a concept without that
tab (a model has no analysis) shows its information instead.

### Type guide (About ‹type›)

The left column is the model tree over `type-guide-panel` (the shell's `guide`
slot): what the loaded metamodels say about the selected concept's type — or
about a type picked in the palette (element or relationship), which stays until
something is selected. Starting to create clears the canvas selection, so a
cleared selection does not clear a palette pick; nor does the refresh after a
model change. The
shell sizes the section like the bottom panel — its height is dragged by its
top edge (≥ 90 px, the tree keeping 120 px), it folds to its header, and both
are remembered (`la-gram:guide-height`, `la-gram:guide-folded`); the header
asks for the fold (`guide-fold-toggle`) and the shell answers
(`guide-panel-changed`). It lives there rather than in the property panel: it
describes the *type*, not the concept being edited, and stays in view while
the bottom panel shows validation, a query or the graph.

The guide is read by `metamodel-manager/type-guide.ts` from whatever
metamodels are loaded (all graphs of the store), structurally, so any notation
that publishes the same properties gets the same page. From the ontology:
`skos:definition`, `skos:scopeNote` (as paragraphs — the published texts are
hard-wrapped, so a line break starts a paragraph only after a sentence ends),
`skos:altLabel`, `skos:changeNote`, `arch:isAbstractClass`, the
`rdfs:subClassOf` closure nearest first, `rdfs:seeAlso` / `dcterms:source`
links that are web pages rather than resources of the metamodels, and facts by
kind — `arch:domainIncludes` / `rangeIncludes` / `unqualifiedForm` for a
relationship, `arch:includesConcept` / `targetsStakeholder` /
`viewpointFramesConcern` / `viewpointHasPurpose` for a viewpoint. From the taxonomy: every SKOS concept
that holds the type (`skos:narrower`, or the type's `skos:broader`), with the
path up to its top concept (the axis), the concept's definition, notes and
changes, and its other members. The host caches a guide per type until a
metamodel or a model is loaded. `guideIri` says what to describe: the type, or
for a view its viewpoint. Links inside the section open another type's page in
place (a trail with a way back); the trail is dropped when the selection's
type changes, not when the host merely re-sends the same one after a model
change. The sections are `<details>`, their open state in
`localStorage` (`la-gram:about-sections`); guidance and classification start
open, superclasses and changes folded. Source links open in a new browser tab
— in Electron in the system browser: the main process denies new windows and
navigation away from the app, so nothing but the app's own page loads in its
window.

### Adding a property

The property panel's "Add a property…" field is a picker over
`model-manager/property-catalog.ts`, which decides what to offer from the loaded
vocabularies' own `rdfs:domain` declarations (and SHACL shapes) rather than
offering every declared property — the core-vis ontology alone would bring the
diagram geometry and notation styling. Groups: **For ‹type›** (domain or shape
covers the selected concept's type closure), **Used in this model** (literal-valued
properties on the model's concepts, and anything in the model's namespace — so a
custom property added once is offered everywhere), **Documentation** (SKOS, Dublin
Core, PROV — not `skos:definition`, which the panel always lists under the name,
nor `dcterms:description`, which would say it again), and **More** (no declared domain; folded until opened or searched).
Never offered: `arch-vis:` / `sh:` / `owl:` terms, what the tool writes itself
(type, membership, ends, conformance, the name, the model's namespace) and the
metamodel-authoring annotations (`arch:unqualifiedForm`, `domainIncludes`, …).
A property whose domain is another class is not listed but can be typed. Typed
text resolves as a CURIE with a known prefix, an absolute IRI, or a plain name in
the model's namespace (`cost center` → `m:costCenter`). Each entry shows the name
first and the prefixed IRI under it. The list floats (`position: fixed`) under the
field, or above it when there is more room there — as in the bottom panel — so
no scrolling container clips it; a native `<datalist>` could neither group
nor put the name first.

### Relationship graph

The Graph tab (`ui/panels/graph-panel.ts`) draws the relationships around the
selected element. `model-manager/relationship-graph.ts` gets the graph's triples
two ways, required by tests to be the same set:

- `buildGraphQuery` writes the "query behind the graph" the tab exports, run
  in the SPARQL Query tab or downloaded (`.rq`): a `CONSTRUCT` (the triples —
  RDF) or, from the same `WHERE`, a `SELECT` (one row per relationship: source,
  relationship, type, target and their names — a table). It is plain SPARQL
  1.1, so it runs on any store holding the model.
- `traverseGraph` walks the store breadth first with indexed lookups
  (`getQuads` on `arch:source` / `arch:target` / `rdf:type`, memoised). This is
  what is drawn, and what the Turtle export (`ModelIO.serializeQuads`, the
  model's prefixes and ordering) writes.

Both find every qualified relationship (`arch:source` + `arch:target`) within
*n* hops, either direction: the elements within *n − 1* hops level by level,
then one more hop for the relationships and their ends. Filters sit on every
hop (`FILTER(?rt IN (…))`, `FILTER(?nt IN (…))` in the query), so a type left out
prunes the traversal; relationship ends that are themselves relationships are
not followed. The depth is capped at 5. In the query, each level is a
`SELECT DISTINCT` subquery over the previous one, so it does not enumerate
paths as a flat UNION of hop chains would; a level includes the one before
(a hop's ends include the element it starts from), and the root is added to
the last level explicitly, since a filter may leave it out.

*The query's shape* (2026-09-27) is chosen for Oxigraph, measured on
synthetic models with two relationships per element (Node). Oxigraph joins a
bound variable into triple patterns, property paths and filters one lookup at
a time, but:

- a `UNION` on the right of a join is evaluated over the whole model — so a
  hop's two directions are one property path, `?p ^(arch:source|arch:target) ?r`
  (the union form: 1.1 s at depth 1, 2,000 elements; the path: 0 ms);
- anything after a `BIND` in a group is evaluated on its own — so the other
  end of a relationship is picked by a filter,
  `?r arch:source|arch:target ?n FILTER(!sameTerm(?n, ?p) || sameTerm(?s, ?t))`
  (with `BIND(IF(…))`: 4.7 s at depth 1, 2,000 elements; without: 1 ms);
- a join between a level (a subquery) and the next hop is reordered so that
  the subquery is re-run for every relationship in the model — so every hop
  is written `OPTIONAL { … } FILTER(BOUND(?r))`, the same rows as a join, which
  the optimizer does not reorder (depth 2, 2,000 elements: 9.4 s → 58 ms). The
  filter must end the hop's own group: a group's `FILTER` applies after all of
  its `OPTIONAL`s, and a later `OPTIONAL { ?r skos:prefLabel … }` would bind
  `?r` where the hop did not (the agreement tests caught this).

The first shape (subquery levels with `UNION`, `BIND` and `NOT EXISTS`) took
1.7 s at depth 2 and 7 s at depth 5 at 100 elements, and 13.9 s at depth 1 at
200. This one: 10 ms at depth 5 at 100 elements; 42 ms at 500; 0.4 s at 2,000;
around a hub (a hundred relationships on the root) 0.2 s at 500 and 3.4 s at
2,000 elements, depth 5.

The walk still draws, because it touches only what it reaches — 1–2 ms in
those cases, 62 ms around the 2,000-element hub. The agreement tests
(`relationship-graph.test.ts`) run the walk, the `CONSTRUCT` and the `SELECT`
on a hand-made model, corner cases (several types, labels in several
languages, loops, untyped things, other graphs) and generated models, at every
depth and filter, so the export stays honest: run on the same model, the query
returns exactly what is drawn.

**＋ New view** sends the drawn elements and relationships, with their
positions in the drawing, to the same path as the SPARQL tab's *Render as new
view* (below); the positions are spread by 1.3 — the drawing's boxes are
smaller and closer than a diagram's.

Drawing is Cytoscape.js (`graph-view.ts`, behind a factory so the panel is
tested without a canvas): round rectangles in the notation's fill colour with the
badge glyph, edges with the notation's line style and end decorations; rings
(breadth-first, circular, around the root), tree or force-directed layout; a fit
never zooms past 1.25×. The view is created the first time the tab is shown — a
hidden container has no size — and the panel neither queries nor draws while the
tab is hidden; while shown it refreshes 300 ms after a model change. The root
follows the selection unless the selection came from the graph itself.

### SPARQL tab and views from results

`sparql-editor` runs the query on the store and shows the result as a table: a
SELECT's rows, with its projected variables as the columns (read from the
query, so a column no row binds is still there); a CONSTRUCT's triples as
subject / predicate / object; at most 500 rows. IRIs are prefixed names —
the model's prefixes (`ModelIO.collectPrefixes`, read when the query runs) and
the vocabularies' — and clicking one reveals the concept as the RDF panel
does. The query-form detection masks IRIs and strings before it strips
comments, so a `#` in `<…/core#>` is not a comment.

*Render as new view* (`model-manager/view-from-results.ts`): `planView` takes
the IRIs the result mentions, in order, and keeps the model's elements
(`rdf:type` in the default graph — a metamodel class is not one) and the
relationships between elements, each bringing its ends; `placeNodes` turns
layout centres into bounds at each element's notation default size;
`ModelSession.createViewWith` writes the diagram, its nodes and links in one
batch and opens it. Without positions from a drawing, the layout is the Graph
tab's tree, run headless (`layoutPositions` in `graph-view.ts`, Cytoscape.js
without a container). Like *New view*, it is not on the canvas's undo stack;
deleting the view removes it.

### RDF panel

`rdf-panel` shows the model exactly as Save would write it: its text comes from
`App.saveModel` (so from `ModelIO`), in any of the six formats, with or without
geometry. It is hidden by default (the shell's fourth column is 0 wide) and does
no work while hidden; while shown it re-serializes on model events, debounced
250 ms. Highlighting is a line tokenizer producing one HTML string, assigned
once per change — cheaper than an editor component for a read-only view of a
possibly large file — and it wraps each subject's statements in a block keyed by
the subject IRI, which is what lets the panel highlight the selected concept and
turn a click on statements into a selection.

### Validation

Shapes: every `shapes` graph of the loaded metamodels + core + core-vis shapes
(+ legacy `urn:la-gram:shapes`), cached as one array so the validator keeps its
compiled engine. Data: the model + all `rdfs:subClassOf` axioms + the types of
referenced resources. `sh:sparql` is stripped (server-side, Req 8). Debounced
300 ms. Results go to the Validation tab; the tab carries the number of
Violations (Warnings and Infos are listed, not counted), and violating concepts
are marked on the canvas. Measured: 140 ms for a 500-element model against the ArchiMate 4.0
element and relationship shapes.

### Collaboration

```mermaid
sequenceDiagram
    participant A as Client A (store)
    participant YA as Y.Doc A
    participant S as Hocuspocus
    participant YB as Y.Doc B
    participant B as Client B (store)
    A->>YA: change feed (origin local) → set/delete N-Triples keys
    YA->>S: update
    S->>YB: update
    YB->>B: apply under origin "remote" (no echo)
    B->>B: normalise single-valued properties (greatest key wins)
    B->>YB: retract losers (local change)
    S->>S: onStoreDocument → rooms/<room>.nt + .ttl
```

The server's Turtle snapshot uses the model's own prefix, read from the model's
`vann:` statements as the editor reads them. A namespace move arrives at the
other clients as one update; `ModelSession.resync` re-points them at the model
and at the same view under its new IRI.

The Y.Doc holds one `Y.Map<true>` keyed by canonical N-Triples: an RDF graph is a
set of triples, and a map-as-set is its CRDT. Single-valued predicates (bounds,
points, list cells, endpoints, `skos:prefLabel` per language) are normalised
deterministically after remote changes, so concurrent moves converge. Awareness
carries name, colour, open view and selection; what others select is marked and
locked (a rule at priority 3000 denies move/resize/delete/re-route).

### Files

`ModelIO.serialize` writes the default graph only, sorted (deterministic;
`rdf:type` first under each subject), with prefixes from the loaded
vocabularies' `vann:` declarations and the model's own (`m:` unless it declares
another), partitioned per DD-15 for graph formats; `no-geometry` drops the views graph. Turtle and
TriG go through n3's writer; JSON-LD, RDF/XML, N-Quads, N-Triples through
Oxigraph. `ModelSession.adopt` runs after every load: migrate retired
vocabulary, ensure `arch:Model` and `arch:inModel`, ensure a view, and lay the
elements out in a grid when the data has no geometry.

**The desktop build.** Electron 44. The window is sandboxed, with context
isolation and without Node integration: the renderer is the web build (webpack
target `web`), served from `app://la-gram/` — a standard, secure scheme the main
process registers and answers from the build's `renderer/` directory, the
bundled assets included — so it fetches its assets as the web build does, has an
origin for IndexedDB, and every response carries a Content-Security-Policy:
script only from the app itself and WebAssembly (Oxigraph), styles inline too,
data from `https:`, `ws:`/`wss:` and localhost (remote metamodels, the
collaboration server). The renderer reaches the desktop only through the
preload's bridge, `window.laGramDesktop` (`src/electron-preload.ts`,
`src/platform/desktop-bridge.ts`): the native open and save dialogs, and reading
or writing a file — one the user chose in a dialog this session, and no other.
Before, the renderer ran with Node integration and asked Electron for `dialog`,
which only the main process has, so Open and Save had no native dialog.

### Nesting

A node drawn inside another says so with `arch-vis:inNode` (core-vis 0.5);
bounds stay in diagram coordinates, so a renderer that ignores nesting still
draws everything in place. On the canvas the container is the shape's
diagram-js parent: moving it moves what is inside, `RdfAutoResize` (diagram-js
`AutoResize`, margins for the name) grows it to fit, and its name moves to the
top of its content box once it holds something. Any element can hold others
(`RdfRules`: not a relationship, not a junction, not itself or what it holds).
`syncFromStore` draws containers first and re-parents a shape whose container
changed in the store (`reparentDirect`, as diagram-js's own commands do); a
removed container leaves what it held drawn.

What a nesting means is a relationship of its own. The notation says which
relationships nesting may draw and which end goes inside (`arch-vis:nestedEnd`
on the relationship's `VisualNotation`); after a drop, `nestingOffers`
(`canvas/nesting.ts`) lists those the metamodel permits between the two and the
model does not already have, and the menu creates the one picked — or none.

### Version history

A commit (`model-manager/version-history.ts`) is a snapshot of the default
graph — model and view geometry — as canonical N-Triples: sorted, one triple
per line, so snapshots compare line by line and the same model gives the same
commit. Snapshots, not deltas: restore and diff need no other commit. They are
kept per model IRI in IndexedDB (Chromium in the browser and Electron alike),
in memory where there is none; a saved file does not carry them. Each commit
records its time (strictly after the model's previous one), message, author
(the collaboration name, when in a room) and parent. The History tab lists
them with +/− triple counts against the parent, shows a commit's triples added
and removed — against its parent or against the model now — with prefixed
names, and restores one: the default graph is replaced as one `rdf.store.edit`
step, so undo takes it back while the view is open; in a room, collaborators
receive it like any other change. Blank-node labels are not stable across
sessions, so a triple about a blank node may show as removed and added again.

---

## Key design decisions

1. **Store first.** The canvas never holds state the store does not; it is
   rebuilt from the store on every view switch and reconciled on every external
   change. (The alternative — semantic data in canvas elements, RDF at export —
   is what `la-modeller-excalidraw` does, and what makes integrity a post-hoc
   fix-up there.)
2. **The published vocabulary, exactly.** `arch:inModel`, `arch:inView`,
   `arch:modelConformsToMetamodel`, `arch:viewConformsToViewpoint`,
   `arch:source`/`arch:target`, `arch-vis:ArchNode`/`Link` — core 0.4.0 and
   core-vis, validated by `core-shapes` and `core-vis-shapes`. Retired terms are
   migrated on load, never written.
3. **Both relationship forms** (DD-10): the qualified resource is what views
   draw and properties hang off; the unqualified triple is what SPARQL walks.
4. **Offline first, network when asked.** ArchiMate 4.0 and 3.2 are bundled;
   every other published metamodel is one click away when online.
5. **Undo = inverse diff.** One mechanism for every model change a gesture
   makes.
6. **Collaboration shares the model, not the canvas.** A triple-set CRDT;
   deterministic convergence for single-valued properties; soft locks on
   selection.
7. **Indicative vs. normative.** `domainIncludes`/`rangeIncludes` are hints;
   the relationship shapes decide — what the canvas offers as well as what
   validation reports (`relationship-table.ts`).
8. **A model owns a namespace.** HTTP IRIs, minted flat in it, so every IRI of
   the model is a prefixed name in Turtle; the namespace is data on the model
   and can be moved.
9. **The vocabularies decide what to offer.** Properties are suggested by
   `rdfs:domain` and SHACL, not listed wholesale.
10. **The relationship graph is drawn with Cytoscape.js, not D3** (2026-09-27).
    Cytoscape.js is a graph component — pan/zoom, drag, click/double-click,
    selection, fit, and breadth-first (rings, tree) and force layouts built in,
    canvas-rendered so hundreds to thousands of nodes stay responsive, and a
    stylesheet whose arrow shapes and line styles map almost one-to-one onto the
    notation's decorations; `graph-view.ts` is ~250 lines. D3 is a toolkit: the
    SVG rendering, markers, labels, hit-testing, fit and every layout but force
    would be ours to write and test (d3-hierarchy needs a tree; a relationship
    graph is not one), and an SVG force graph slows past a thousand or two
    nodes. Cost accepted: 435 KB minified / 137 KB gzipped (≈3% of the bundle,
    which Oxigraph dominates), MIT, no dependencies. What D3 would buy — and the
    reason to revisit — is drawing the graph with the diagram's own ArchiMate
    shapes (`notation-shapes.ts` already builds them as SVG) and trivial SVG
    export; diagram-js with an auto-layout (elkjs) was the third option, heavier
    for a read-only view. Switching is contained: the drawing sits behind
    `GraphView` / `GraphViewFactory`, so the panel, query, filters and exports
    would not change.
11. **The graph is walked; the query is exported** (2026-09-27). The Graph tab
    offers the SPARQL query behind the graph because a query is the portable,
    rerunnable definition of "what this element is related to" — it runs on
    any SPARQL 1.1 store and can be edited in the SPARQL tab; as a `SELECT` it
    is a table, as a `CONSTRUCT` it returns RDF. It is generated because depth
    and filters vary, and SPARQL has no bounded-length paths or per-hop filters
    in property paths. Its shape is chosen for Oxigraph's evaluator (see
    *Relationship graph*): tens of milliseconds where the first shape took
    seconds to minutes. The drawing still walks the store, which touches only
    what it reaches, and tests hold the walk and both query forms to the same
    result.
12. **A bottom tab is maximized in the window, not opened in another**
    (2026-09-27). The SPARQL and Graph tabs work on the model in this window's
    store; a second window (a popup in the browser, a `BrowserWindow` in
    Electron) would need its own copy of the model kept in step — the
    collaboration channel could do it, at the cost of a second store,
    popup-blocker handling and a second Electron renderer. The browser's
    Fullscreen API on the panel was ruled out too: only the full-screened
    element is shown, so the dialogs the panels open ("New view", toasts) would
    open unseen. Maximizing within the window works the same in the browser and
    Electron, keeps every dialog, and the OS's own full screen gives the whole
    display; side by side with the canvas is the resizable panel's job. The
    reason to revisit: a second monitor. Then a synced second window, over the
    collaboration channel, is the path.

---

## Technology stack

| Concern | Choice |
|---|---|
| Canvas | diagram-js 14 (MIT) + custom RDF renderer, rules, modeling, context pad, popup menus |
| Relationship graph | Cytoscape.js 3 (MIT) |
| Renaming on the canvas | diagram-js-direct-editing 3 (MIT) |
| UI | Lit 3 web components, CodeMirror 6 (SPARQL) |
| RDF store / SPARQL | Oxigraph 0.4 (WASM in the browser, native module in Node) |
| Parsing / writing | n3 (Turtle, TriG, N-Triples, N-Quads), Oxigraph (JSON-LD, RDF/XML) |
| SHACL | rdf-validate-shacl |
| Collaboration | Yjs 13 + Hocuspocus 4 (provider and server) |
| Build | webpack 5 (web, electron-main, electron-preload, electron-renderer — the web build again), TypeScript 5 (strict) |
| Tests | Vitest (unit, jsdom) + Playwright (browser suite against the production build) |
| Desktop | Electron 44 — sandboxed renderer without Node, `app://la-gram/`, Content-Security-Policy, preload bridge for files |

## Running

| What | Command |
|---|---|
| Build and serve (http://localhost:8080) | `npm run dev` |
| Collaboration server (ws://localhost:1234) | `npm run collab` |
| Unit tests | `npm test` |
| Browser tests (builds first) | `npm run test:browser:build` |
| Type-check | `npm run typecheck` |
| Desktop | `npm run build:electron && npm run electron`; package the app with `npm run package` (`scripts/package-electron.mjs`: `@electron/packager`, `dist/electron` and `package.json` only, in an asar; `dist/packages/`) |
