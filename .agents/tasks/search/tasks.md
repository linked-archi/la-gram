# Tasks: search

## For 0.4.0

- [x] `find-bar.ts` (SR-1) — *find-bar.test*
- [x] `text-search.ts`: `findMatches`, `rangesOf` — *text-search.test*
- [x] `canvas-search.ts` and the canvas's methods; markers and their CSS (SR-2, SR-3) — *canvas-search.test*
- [x] The canvas toolbar's 🔍 — *canvas-toolbar.test*
- [x] `rdf-panel.ts`: 🔍, the bar, highlights, searched again on a new text, too large (SR-6) — *rdf-panel.test*
- [x] `model-explorer.ts`: the filter set and focused from outside — *model-explorer.test*
- [x] `mount-ui.ts`: the canvas's bar, Ctrl/⌘+F (SR-7), searched again (SR-5), elsewhere (SR-4) — *workbench.test*
- [x] Browser suite: the canvas's search and the RDF panel's, from Ctrl/⌘+F
- [x] Specs: Requirement 23; design (*Search*, key design decision); tasks change log
- [x] `README.md`; docs-site: the canvas's *Search*, the RDF panel's *Search*, keyboard shortcuts
- [x] `npm run typecheck`, `npm test` (122 files, 2068 tests), `npm run build`, `npm run test:browser:build` (97),
      `npm run docs:build` — 2026-11-26
- [x] The in-app *Keyboard shortcuts* dialog: *Search* — *help.test*

Checked by eye on the suite's screenshots (`search-canvas`, `search-rdf-panel`): the bar over the diagram's top
right, the matches outlined, the current one stronger and selected; the panel's matches yellow, the current one
orange.
