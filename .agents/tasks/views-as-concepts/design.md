# Views as model concepts — design

Recorded 2026-11-21, before the work, from the code on `basic-interaction` with the view-references task done;
corrected to what was built (2026-11-21).

## What exists already

| Part | Where | What it does |
|---|---|---|
| Presence | `ViewManager.addFigure`, `collectNodeQuads` | `V arch:inView H` with the first reference in H, taken with the last (DD-42) |
| Geometry | `arch-vis:ViewReferenceNode`, `arch-vis:referencesView` | the reference node, a figure in `NodeInfo.figure` |
| Core types | `RelationshipManager.getValidRelationships` | Association, Has Part, Refines where no language relates two concepts (Req 4.21) |
| Shapes | core-shapes | a relationship's `arch:source`, `arch:target` are `sh:class arch:ModelConcept`: a view validates |
| Nesting offer | `nesting.ts`, `DiagramCanvas.offerNesting` | types whose notation has `arch-vis:nestedEnd`, read from the palette definition's relationship types — the core's among them (`core`), hidden from the palette panel only |

## Decisions

- **VC-DD-1 A reference stays a figure, and stands for its view wherever a concept is asked for.** Its look, text,
  glyph, Appearance and Image tabs are a figure's, and stay so. Where a concept is asked for, it answers with its
  view: in the view manager, a reference node's concept is its `arch-vis:referencesView` (`conceptOf`), a view's
  placements in a view are its reference nodes there (`nodeIrisFor`), and `placedIn` and `viewsContaining` count them;
  so `addRelationshipToView`, `refreshLinksOf`, `readLink`, `getNode` and `removeElementFromView` work for a view as
  for an element. On the canvas, a reference shape is indexed under its view (`placements`), so `shapesOf`, `reveal`
  and the store-led drawing of relationships find it, and `conceptOf(shape)` gives the view for the connect gesture,
  the nesting offer and the context menu. Making references element shapes instead would have given relationships
  for free and lost their look.
- **VC-DD-2 The view's class is the reference's type for the rules.** A reference shape carries
  `typeIri` — `arch:Diagram`, `arch:Catalog` or `arch:Matrix` — so `getValidRelationships` answers for the pair and
  the core's three types come through Req 4.21's rule unchanged. A figure's connector rule (a line standing for no
  relationship) applies to groups, notes and shapes only; a reference is no container still (`canContain`).
- **VC-DD-3 Selection maps a reference to its view in mount-ui.** The canvas says which shapes are selected, by
  node, as before — a collaborator's presence marks the reference; `onCanvasSelection` selects the view a reference
  opens (`referencedViewOf`), and `headingFor(view)` adds the canvas's `selectedReference()` as the panel's
  `reference` part — the reference's node, its own text, *Opens*, *Change…*. The panel's properties are the view's;
  the reference's *Text* row writes the node (`PropertyEntry.subject`). A reference pointed at another view while
  the panel shows it is followed (`onModelChanged`).
- **VC-DD-4 F2 writes the view's name.** A reference's `label` is its view's name, which F2 edits, and its drawn
  text is `labelText` — its own text when it has one, an empty one too. The relabel command writes a reference's
  name on its view and relabels every reference to it on the canvas. The *Text* row writes the node's
  `skos:prefLabel`.
- **VC-DD-5 The core's relationship types get a notation, in linked-archi-meta.** `core/core-notation.ttl`
  (`https://meta.linked.archi/core-notation#`, 0.1.0) holds a NotationSet with a descriptor for `arch:Refines`:
  its line as a generic relationship's (solid, open arrowhead at the refined concept) and `arch-vis:nestedEnd
  arch-vis:SourceEnd`. No manifest names it: it is loaded with the core, as core-shapes is, and la-gram consults its
  sets last (`coreNotationSetIris`), after every loaded metamodel's, and never as the active set. The nesting offer
  needs no change: the palette definition's relationship types carry the core's (`core`; only the palette panel
  leaves them out, Req 4.21), so Refines comes with its `nestedEnds`. A note, a group or a shape nested in an element
  is offered nothing, now that a core type has nested ends.
- **VC-DD-6 Zoom in reads the semantic graph.** `ViewManager.viewsRefining(concept)` — the views `V` with
  `V arch:refines concept` or `concept arch:refinedInto V` — by name; the pad's *Zoom in* opens the one, or a popup
  menu of several; the right-click menu lists each.
- **VC-DD-7 Deleting a view takes its relationships.** `collectViewQuads` adds, for each relationship touching the
  view (`relationshipsTouching`), `collectRelationshipQuads`: its resource, triple, pointers and links everywhere.
  The confirmation counts them beside the references.
- **VC-DD-8 Both copies.** The model-manager and metamodel-manager changes and the bundled asset are made in la-gram
  and `linked-archi-kernel`, file for file, as DD-42's were.

## Tests

| Criterion | Test |
|---|---|
| VC-1, VC-2, VC-7, VC-10 | `workbench.test` |
| VC-3, VC-4, VC-5, VC-9 | `view-canvas.test`, `rdf-rule-provider.test`, `nesting.test` |
| VC-5's notation | `notation-resolver.test` or `palette-generator.test`, `bundled-assets.test` |
| VC-6 | `view-manager.test`, `view-canvas.test` |
| VC-7, VC-9, the view manager | `view-manager.test` |
| VC-11 | `canvas-clipboard.test` or `clipboard.test` |
| Chrome | `workbench.spec`: a line drawn from an element to a reference |
