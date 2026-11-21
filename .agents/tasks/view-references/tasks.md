# View references — tasks

Recorded 2026-11-21. **Ready to start**: direction confirmed and decisions taken (2026-11-21). Criteria refer to [requirements.md](requirements.md); the choices are in
[design.md](design.md).

## Documentation before implementation

- [x] Record the goal, the proposed direction and the open decisions (2026-11-21).
- [x] Write requirements (VR-1–12) and design (VR-DD-1–8) from the code as it was on 2026-11-21.
- [x] Make the task folder visible to Git (`.gitignore`), like `kernel-migration`.
- [x] List it under *Queued next* in `.agents/specs/la-gram/tasks.md`.
- [x] Decide VR-DD-6 (both copies) and the open view's own row (VR-1: nothing made, a toast says why) (2026-11-21).

## Making one (VR-1–3)

- [ ] `explorer-drag-start` for view rows; `DiagramCanvas.startCreateReference`; nested where let go — *view-canvas.test*
- [ ] The tree's *Reference in the open view*; `DiagramCanvas.placeReference` — *view-canvas.test, model-explorer.test*

## Its text (VR-4)

- [ ] The view's name drawn when it has no text of its own; `ViewManager.referencesTo`; a view's rename redraws
  them — *view-manager.test, view-canvas.test*
- [ ] The panel's *Text* with the view's name greyed — *property-panel.test*

## Opening, changing, deleting (VR-7–10)

- [ ] Double-click, pad and menu *Open view*; a missing view said — *rdf-label-editing.test, workbench.test*
- [ ] *Opens* in the panel, with *Open* and *Change…*; `ViewManager.setReferenceView` through `rdf.store.change` —
  *view-manager.test, property-panel.test*
- [ ] The delete-view confirmation counts the references that go with it — *workbench.test*

## Nesting, lines, the views' side (VR-5, VR-6, VR-11)

- [ ] Tests holding the figure rules to a reference: nested, nothing inside, lines to and from, no relationship —
  *rdf-rule-provider.test, view-canvas.test*
- [ ] *Referenced from* in a view's panel — *property-panel.test*

## Finishing (la-gram's checklist)

- [ ] `README.md`; Req 3.23 extended with VR-1–12; DD-42 extended; the change log; *Known limitations* and *Queued
  next* updated
- [ ] `docs-site/guide/canvas.md` (*View references*), `docs-site/guide/models-and-views.md` (the tree's menu,
  *Referenced from*)
- [ ] The model-manager part in the kernel too, if VR-DD-6 says so; the kernel's change log
- [ ] Checks: `npm run typecheck`, `npm test`, `npm run test:browser:build`, `npm run build`, `npm run docs:build`
