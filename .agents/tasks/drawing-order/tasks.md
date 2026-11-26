# Tasks: drawing order

## Before la-gram

- [x] meta: core-vis 0.10 (`arch-vis:zOrder`), core-vis-shapes 0.6.0, DD-45, the ontology reference, the diagram
      example — validated (2026-11-26)
- [x] kernel: the assets synced; `NodeInfo.zOrder`, `setNodeZOrder`, copies and merges; `drawing-order.ts` with
      property tests (2026-11-26)
- [x] kernel: packaged as `0.1.5-k02b.1` from `a9f0b38` (2026-11-26), pinned in la-gram and the workspace; the
      workspace's typecheck, 76 tests, build and 15 host checks pass on it

## la-gram (in 0.4.0, on kernel `0.1.5-k02b.1`; 2026-11-26)

- [x] The kernel archive installed: `vendor/`, `package.json`, the lockfile
- [x] Drawing in drawing order on load and after a change; re-stacking a parent's shapes (DO-1) —
      *drawing-order.test* (the SVG's order checked too)
- [x] `RdfOrdering` and `shapeIndex`: a move keeps the order; into another parent, DO-4 — *rdf-ordering.test,
      drawing-order.test*
- [x] `DiagramCanvas.reorderSelection`: the four, by parent, one step, locked placements left (DO-2) —
      *drawing-order.test*
- [x] New placements in front of what they overlap: palette, tree, *Append*, paste, *Duplicate*, and a move into or
      out of a container (DO-4) — *drawing-order.test, canvas-clipboard.test*. Layouts are not: *Arrange view* and
      *Render as new view* place nothing over anything
- [x] The right-click group, the toolbar's *Order* menu, the keys, what is said (DO-3) — *canvas-toolbar.test,
      drawing-order.test, workbench.test*; one of several elements or figures selected keeps the selection with or
      without folders, and a figure is no longer offered *Move to folder…*
- [x] The ArchiMate exchange import keeps the file's order where nodes in one place overlap (DO-5) —
      *archimate-importer.test*
- [x] Browser suite: a shape sent behind another, saved, reopened, still behind
- [x] Specs: Req 22.11 (the four), 22.12 (new and moved placements), 13.1 (the import); design, *Drawing order*;
      key design decision 46; change log
- [x] `README.md`; docs-site: *Order* under *Tidy a diagram*, the right-click table, the toolbar, *Keyboard and
      mouse*, *File formats*; the in-app shortcuts — *help.test*
- [x] `npm run typecheck`, `npm test`, `npm run build`, `npm run test:browser:build`, `npm run docs:build`
      (2026-11-26; counts in the change log)
- [ ] Converters (meta's ArchiMate exchange converter and the others): keep the file's order as `arch-vis:zOrder` —
      each its own change
