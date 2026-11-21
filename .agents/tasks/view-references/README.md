# View references (VR)

Recorded 2026-11-21. **Done** (2026-11-21): see `tasks.md` for what was made and its notes. Files here:
`requirements.md` (VR-n), `design.md` (VR-DD-n) and `tasks.md`, the checklist.

## Goal

A modeller puts a reference to another view on a diagram, nests it in an element's box, a group or a shape, draws a
line from it or to it, and opens the view it references from it. la-gram already reads, draws, copies and deletes the
references that come with a file (Req 3.23, DD-42); this task lets a modeller make them, change them and use them.

## Direction (confirmed 2026-11-21)

1. **Made from the model tree.** A view dragged from the tree onto the open diagram, or its right-click
   *Reference in the open view*, makes a reference to it — inside the element, group or shape it is let go on.
2. **Its text follows the view.** A reference with no text of its own shows the name of the view it opens, as that
   name changes; F2 gives it text of its own.
3. **Double-click opens the view.** So do its pad's and its right-click menu's *Open view*.
4. **The panel says what it opens**, with *Open* and *Change…* to point it at another view.
5. **Nesting and lines are a figure's.** It goes inside what holds it and moves with it; *Draw a line to…* draws
   a line standing for no relationship from it or to it; no relationship ends on it; it holds nothing.
6. **Deleting a view says what goes with it**: the references to it in other views, counted, before it is deleted.
7. **A view's panel lists the views that reference it**, each opening that view.

## Decisions (2026-11-21)

- **The model-manager part is written in both copies** (VR-DD-6), la-gram's and `linked-archi-kernel`'s, file for
  file, as DD-42's reading part was. Moving la-gram onto the kernel (L01) is a task of its own, after the 0.3
  release, and a large one; this task does not wait for it.
- **The open view's own row makes nothing on its own diagram** (VR-1), and a toast says why.

## Where to start

- **Read first:** la-gram's `AGENTS.md` and `.agents/conventions.md` (code conventions, the finishing checklist),
  then this folder: `requirements.md`, `design.md`, and `tasks.md`, ticked as the work goes, with a dated note where
  it stops.
- **The code:**
  - the tree's drag and menu: `src/ui/panels/model-explorer.ts` (`explorer-drag-start`, the row menus);
  - wiring, the delete-view dialog and panel headings: `src/ui/mount-ui.ts` (`onExplorerDrag`, `delete-view`,
    `headingFor`);
  - the canvas: `src/ui/canvas/diagram-canvas.ts` (`startPlaceExisting`, `placeExisting`, `startCreateFigure`);
  - its pad, double-click editing, rules and drawing: `rdf-context-pad-provider.ts`, `rdf-label-editing.ts`,
    `rdf-rule-provider.ts`, `rdf-renderer.ts`;
  - the panel: `src/ui/panels/property-panel.ts`;
  - the model manager: `src/model-manager/view-manager.ts`, `interfaces.ts`, `vocabulary.ts`.
- **The kernel copy (VR-DD-6):** `tools/platform/linked-archi-kernel` holds the same `src/model-manager/` files at the
  same paths. Make each model-manager change there too, file for file, and add an entry to its change log
  (`.agents/specs/kernel/tasks.md`). It has no Git; its checks are `npm run typecheck` and `npm test` there.
- **Rules:** document behaviour and requirements, never by comparison with another tool. Do not commit, stage or
  push: leave the changes in the working trees and list the files changed.
- **Checks (la-gram):** `npm run typecheck`, `npm test`, `npm run test:browser:build`, `npm run build`, then
  `npm run docs:build`.

## Relationship to other work

| Work | Where | How it bears on this |
|---|---|---|
| Req 3.23, DD-42 | `.agents/specs/la-gram/` | What a reference is and how la-gram reads, draws, copies and deletes it. Done 2026-11-21 |
| L01, the kernel migration | `.agents/tasks/kernel-migration/` | Decides where the model-manager part goes (VR-DD-6) |
| core-vis 0.9, core-vis-shapes 0.5.0 | `linked-archi-meta/core/` | `arch-vis:ViewReferenceNode`, `arch-vis:referencesView`; a reference opens exactly one view and carries no element |
