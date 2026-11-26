# Tasks: line shape

## For 0.4.0

- [x] `orthogonal-router.ts`: kept lines — the search's crossings, the ends held, the channels (LS-DD-2)
      — *orthogonal-router.test*
- [x] `line-shapes.ts`: `elbowRoute`, horizontal or vertical first, straight where no corner fits (LS-4, LS-DD-3)
      — *line-shapes.test*
- [x] `canvas-arrange.ts`: `shapeLines`, the lines LS-1 applies to, `availability().lines`; *Arrange relationships*
      with selected lines and kept lines (LS-9) — *canvas-arrange.test*
- [x] `diagram-canvas.ts`: `straightRoute`, `shapeLines`; the right-click group, on one line and on several —
      lines keep their selection on a right-click without folders too (LS-8) — *canvas-arrange.test*
- [x] `canvas-toolbar.ts`: the *Line shape* button and its menu (LS-7) — *canvas-toolbar.test*
- [x] `mount-ui.ts`: the toolbar's event, the menu's actions, what is said (LS-6); *Arrange relationships…*'s
      *Arrange* field counts the selected lines — *workbench.test*
- [x] Browser suite: a line shaped from the toolbar, undone
- [x] Specs: Req 22.2 changed, 22.9, 22.10; design (*Line shape*, key design decision); tasks change log, *Queued
      next* (a shape the line keeps, curved lines)
- [x] `README.md`; docs-site: *Tidy a diagram*, the line's right-click menu
- [x] `npm run typecheck`, `npm test` (118 files, 2042 tests), `npm run build`, `npm run test:browser:build` (96),
      `npm run docs:build` — 2026-11-26

Found on the way (2026-11-26): a kept line that bends was first held as a straight one, and a routed line turning the
same way docked on its inner side and crossed its turn. A kept bent line now takes its place in the bent lines' order
as one that cannot move — *orthogonal-router.test* (*docks beside a kept line that turns the same way sooner*).

## Later (README, *Later*)

- [ ] A shape the line keeps, and curved lines: a core-vis term first (meta), then the kernel, then la-gram.
      Recorded (2026-11-26), not started
