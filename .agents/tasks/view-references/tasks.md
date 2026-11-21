# View references — tasks

Recorded 2026-11-21. **Done** (2026-11-21): every item below, checks passed; the changes are uncommitted in the
working trees (la-gram and `linked-archi-kernel`). Criteria refer to [requirements.md](requirements.md); the choices
are in [design.md](design.md).

## Documentation before implementation

- [x] Record the goal, the proposed direction and the open decisions (2026-11-21).
- [x] Write requirements (VR-1–12) and design (VR-DD-1–8) from the code as it was on 2026-11-21.
- [x] Make the task folder visible to Git (`.gitignore`), like `kernel-migration`.
- [x] List it under *Queued next* in `.agents/specs/la-gram/tasks.md`.
- [x] Decide VR-DD-6 (both copies) and the open view's own row (VR-1: nothing made, a toast says why) (2026-11-21).

## Making one (VR-1–3)

- [x] `explorer-drag-start` for view rows; `DiagramCanvas.startCreateReference`; nested where let go — *view-canvas.test*
  (and *model-explorer.test*: the row's kind; *workbench.spec*: a view's row dragged into an element's box in Chrome)
- [x] The tree's *Reference in the open view*; `DiagramCanvas.placeReference` — *view-canvas.test, model-explorer.test*

## Its text (VR-4)

- [x] The view's name drawn when it has no text of its own; `ViewManager.referencesTo`; a view's rename redraws
  them — *view-manager.test, view-canvas.test*
- [x] The panel's *Text* with the view's name greyed — *property-panel.test*

## Opening, changing, deleting (VR-7–10)

- [x] Double-click, pad and menu *Open view*; a missing view said — *rdf-label-editing.test, workbench.test*
  (and *view-canvas.test*: the event, the pad and the menu)
- [x] *Opens* in the panel, with *Open* and *Change…*; `ViewManager.setReferenceView` through `rdf.store.change` —
  *view-manager.test, property-panel.test* (and *workbench.test*: picked, undone)
- [x] The delete-view confirmation counts the references that go with it — *workbench.test*

## Nesting, lines, the views' side (VR-5, VR-6, VR-11)

- [x] Tests holding the figure rules to a reference: nested, nothing inside, lines to and from, no relationship —
  *rdf-rule-provider.test, view-canvas.test*
- [x] *Referenced from* in a view's panel — *property-panel.test* (and *workbench.test*)

## Finishing (la-gram's checklist)

- [x] `README.md`; Req 3.23 extended with VR-1–12; DD-42 extended; the change log; *Known limitations* and *Queued
  next* updated
- [x] `docs-site/guide/canvas.md` (*View references*), `docs-site/guide/models-and-views.md` (the tree's menu,
  *Referenced from*); also `model-tree.md`, `files.md` and `reference/keyboard.md`
- [x] The model-manager part in the kernel too, if VR-DD-6 says so; the kernel's change log
- [x] Checks: `npm run typecheck`, `npm test`, `npm run test:browser:build`, `npm run build`, `npm run docs:build`

## Notes (2026-11-21)

- **Found on the way, done with it.** The canvas's right-click menu did not open on figures — the browser's did —
  although the guide listed one; VR-7 and VR-9 need a reference's. It opens on groups, notes, shapes and references
  now, without the model's entries (*Move to folder…*, *Show in model tree*, *Delete from model…*). Deleting a view
  other than the open one left the references to it drawn on the open diagram until it was next redrawn; it is now
  a recorded change there, so they leave at once and undo brings them back (VR-10's last sentence).
- **Left as it is.** Deleting the open view is not undoable: another view opens, with an undo history of its own
  (la-gram's known limitation 3). Recorded under *Known limitations*.
