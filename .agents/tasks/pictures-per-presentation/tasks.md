# Tasks — pictures and looks per presentation context

Tick as you go; add a dated note under a phase when you stop mid-way. Requirements: `requirements.md` (R1–R6);
design: `design.md` (§1–§6). Rules: `README.md`.

## Phase A — meta vocabulary, shapes, docs (R1–R3, R6.1)

- [x] A1 core 0.5.0: `prefVisNotation`/`altVisNotation` domains → `:domainIncludes`; definitions (design §1)
- [x] A2 core 0.5.0: `inPresentationContext` domainIncludes `schema:ImageObject`, `arch-vis:Style`; definition, example; history note
- [x] A3 core-vis 0.7: `arch-vis:style` not functional; comment; `IconCentric` and `iconSymbol` notes (R3); history note
- [x] A4 core shapes 0.4.0: `PictureShape`, `PictureForAudienceShape`, `CanonicalPictureShape`; `sh:declare schema`; history note
- [x] A5 core-vis shapes 0.3.0: style cardinality rule (SPARQL), `StyleShape` context max 1; history note
- [x] A6 example `examples/labels-per-presentation.ttl`: pictures and a per-context style; validation profile passes
- [x] A7 negative check on a scratch copy: each new shape reports bad data
- [x] A8 docs: guide page (pictures, per-context styles), DD-35 (new; see design §4), ontology reference, visual notation guide, index, nav
- [x] A9 `.scripts/validate.sh` (syntax) and `--shacl core-vis` pass

## Phase B — la-gram model (R2, R5.2, R5.4)

- [x] B1 vocabulary terms; `element-pictures.ts` + tests
- [x] B2 view-manager: styles per context (`setAppearance(…, context)`, `contextAppearancesOf`, `NodeInfo.contextAppearances`), `ownStyle` ignoring context styles, duplicate, removal + tests
- [x] B3 audit every `T.visStyle` read for the several-styles case — view-manager: `styleOf(subject, context?)` for the figure, the look, the label expressions; `ownStyle` copies only every-context styles; removal through `ownStylesQuads`; cascade loops every style
- [x] B4 cascade: pictures owned by an element + test

## Phase C — canvas and renderer (R2.2, R3, R4.4)

- [x] C1 look for the context in `syncFromStore`/`restyle`; refresh on context switch (`refreshForContext`)
- [x] C2 element picture on the business object; renderer: icon in IconCentric, not in badge mode; `effectiveMode`, `drawnMode`, docking stamp + tests

## Phase D — panel and wiring (R4, R5.1, R5.3)

- [x] D1 `AppearanceChangeDetail.context`; `onAppearanceChange` passes it
- [x] D2 Image tab scope (line, checkbox, writes per scope; every-scope write clears the context's image keys)
- [x] D3 Figure tab clears the shown context's figure and icon (R4.6)
- [x] D4 *Pictures in this model* includes element pictures
- [x] D5 *Pictures by presentation* section + `context-picture-change` wiring
- [x] D6 workbench tests; browser test — and, found by the test: the Label and Image tabs' *The same in every presentation* now resets when the presentation is switched, not only when the selection changes

## Phase E — finish (R6.2)

- [x] E1 sync meta assets (catalogue regenerated on the scratch copy if a header changed)
- [x] E2 la-gram docs: README, `.kiro` requirements (Req 3.17, new criterion), design, change log
- [x] E3 `npm test`, `npm run build`, `npm run test:browser`
- [x] E4 report to the user: what changed, what is uncommitted, follow-ups

## Status

Done 2026-11-08: phases A–E. Everything is uncommitted in both repos. Also changed while doing it: the information
tab's generic properties no longer list `arch:prefVisNotation`/`arch:altVisNotation` links (shown as Pictures by
presentation), as they no longer list `skosxl:altLabel`.

## Follow-ups (not in this task)

- The Appearance and Figure tabs per context; the format painter copying a context's look.
- Per-context looks for figures (groups, notes, shapes) and lines.
- The palette and the model tree showing an element's picture.
