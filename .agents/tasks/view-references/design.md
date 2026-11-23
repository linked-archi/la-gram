# View references — design

Recorded 2026-11-21, before the work, from the code on `basic-interaction` as it was then.

## What exists already (Req 3.23, DD-42)

| Part | Where | What it does |
|---|---|---|
| The figure | `model-manager/interfaces.ts` | `FigureKind` `reference`, its view `FigureInfo.view` |
| Writing one | `ViewManager.addFigure` | `arch-vis:ViewReferenceNode`, `arch-vis:referencesView`, the view's `arch:inView` the holder (not for itself) |
| Reading one | `ViewManager.figureOf` | `{ kind: 'reference', view, text }` |
| Removing one | `ViewManager.collectNodeQuads` | the node, and the view's `arch:inView` with its last reference in the holder |
| Deleting a view | `ViewManager.collectViewQuads` | the references to it in other views too |
| Copy and paste | `placement-copy.ts` | kept; a note where the target model lacks the view |
| Drawing | `rdf-renderer.ts` | a box with a small view in its top left (`viewGlyph`) |
| Rules | `rdf-rule-provider.ts` `canContain` | nothing goes inside one |
| Import | `archimate-importer.ts` | a `Label` with a `<viewRef>` naming a view of the file |

## Decisions

- **VR-DD-1 Made as any figure is.** A reference is made through `addFigure` with `kind: 'reference'` and `view`,
  inside the canvas's figure-create command, so undo, collaboration, nesting on drop and selection come as they do
  for a note. The model tree starts the drag: `explorer-drag-start` carries view rows too, with the row's kind, and
  `mount-ui` calls a new `DiagramCanvas.startCreateReference(viewIri, event)` beside `startPlaceExisting`. VR-2's
  menu entry calls `DiagramCanvas.placeReference(viewIri)`, placing it at the centre of the visible area as
  `placeExisting` does for an element.
- **VR-DD-2 The view's name, read when drawn.** A new reference has no `skos:prefLabel`. The canvas draws
  `figure.text`, else the label of `figure.view` (`ViewManager.getView`). A rename of a view is a `skos:prefLabel`
  write on the view, which no figure cache rule sees today, so the canvas sync gains one: a label written on a view
  redraws the references to it in the open diagram (`ViewManager.referencesTo(viewIri)`, the reference nodes that
  open it, in any view).
- **VR-DD-3 Double-click opens.** `rdf-label-editing.ts` leaves a reference out of double-click editing (F2 keeps
  it); the canvas emits `open-referenced-view` with the view for a reference's double-click, its pad's *Open view*
  and its menu's, and `mount-ui` opens it (`session.openView`), or says it is not in the model.
- **VR-DD-4 Changing the view it opens is one store change.** `ViewManager.setReferenceView(holder, node, opens)`
  replaces `arch-vis:referencesView` and moves the presence by the rule `collectNodeQuads` and `addFigure` follow:
  the old view's `arch:inView` the holder goes with its last reference there, the new one's is written unless it is
  the holder. Run through `rdf.store.change`, so it is one undoable step and one change for collaborators; its
  quads are computed first (`setReferenceViewQuads`), as a removal's `collect…` twin is.
- **VR-DD-5 The deletion says what goes.** `delete-view` in `mount-ui` counts `referencesTo(viewIri)` by holder,
  other than the view itself, and names them in the confirmation. The deletion itself is `collectViewQuads`, which
  already takes them.
- **VR-DD-6 The model-manager part in both copies** (decided 2026-11-21). `referencesTo` and `setReferenceView` are
  new behaviour in `src/model-manager/`, written in la-gram and in `linked-archi-kernel`, file for file, as DD-42's
  reading part was, and noted in the kernel's change log. L01, the move onto the kernel, comes after the 0.3
  release as a task of its own. Everything else here is la-gram's own code (`ui/`, `import-export/`).
- **VR-DD-7 Nesting and lines are the figure rules, unchanged.** `canContain` already refuses a reference as a
  container and accepts one moved into an element, a group or a shape; the pad gives every figure *Draw a line to…*;
  the connect rules refuse a relationship ending on a figure. The work here is tests that hold them to it for a
  reference, not new rules.
- **VR-DD-8 Referenced from, from the semantic graph.** A view's panel reads the views that reference it from its
  `arch:inView` edges to other views, which Req 3.23 keeps true, rather than walking every view's nodes; the same
  answer holds for a model opened without its views graph.

## Tests

| Criterion | Test |
|---|---|
| VR-1–3, VR-5 | `view-canvas.test` (drag from the tree, the menu entry, nested on drop, undo); `workbench.spec` (Chrome: drag a view row into an element's box) |
| VR-4 | `view-manager.test` (`referencesTo`), `view-canvas.test` (the name drawn, a rename redrawn, F2 text) |
| VR-6 | `rdf-rule-provider.test`, `view-canvas.test` (a line to and from a reference; no relationship) |
| VR-7 | `rdf-label-editing.test`, `workbench.test` (double-click and menu open the view; a missing view said) |
| VR-8 | `view-manager.test` (`setReferenceView`: presence moved, undo), `property-panel.test` |
| VR-10 | `workbench.test` (the confirmation's count) |
| VR-11 | `property-panel.test` |
