# Tasks — Questions

See [requirements.md](requirements.md) and [design.md](design.md).

## 1. Core vocabulary (meta) — done 2026-10-27

- [x] `arch:ModelQuestion`, `arch:QuestionSet`, `arch:DatasetScope` and its two individuals, `arch:QuestionStageScheme` and its seven stages, in `core/core-onto.ttl` (Req 1.1–1.2)
- [x] Question properties, including `arch:questionHasPurpose` and `arch:findingFocus`; `arch:questionAddressesConcern` ranges over `arch:Consideration` (Req 1.2–1.3)
- [x] Parameter properties `arch:focus`, `model`, `view`, `viewpoint`, `conceptType`, `from`, `to` (Req 1.4)
- [x] `arch:hasQuestionSet`; `arch:sectionAsks`, `sectionAddressesConcern`, `sectionTargetsStakeholder`, `templateParameter` (Req 1.5–1.6)
- [x] Shapes in `core/core-shapes.ttl`; the query check written with `sh:or` because RDF4J does not evaluate `sh:xone`; RDF4J and pyshacl agree on nine malformed cases and pass two good ones; existing profiles (core-vis, archimate, archimate4, c4, bpmn) still pass; `--registration` and `--references` clean (Req 1.7)
- [x] DD-33 in `doc/guide/design-decisions.md`; the terms in `doc/guide/ontology-reference.md` (Req 1.8)
- [x] `arch:Question` renamed `arch:ModelQuestion` (D11): definitions set it apart from `arch:Concern`, whose scope note says how they differ; the label must end in a question mark (checked by RDF4J and pyshacl, with a concern-style noun phrase as the failing case); `arch:QuestionSet` defined as a unit of publication

## 2. Question sets (meta) — done 2026-10-27

- [x] File names and namespaces confirmed: `core/core-questions.ttl` (`archq:`), `archimate4-questions.ttl` (`am4q:`)
- [x] Core set (16): root `arch:QuestionSet`, parameters on `arch:` properties, `?conceptType`, most specific types, `arch:findingFocus` on each finding, labels ending in a question mark (Req 2.1, 3, 4)
- [x] `viewpoint-conformance` admits specialisations; `views-with-unknown-viewpoint` reports what it cannot judge (Req 3.5)
- [x] ArchiMate 4.0 set (20): type sets read once and in two steps; `viewpoint-scope` set-wise (0.66 s worst case at 350 000 triples), `application-dependencies` 9 ms (Req 5)
- [x] `arch:hasQuestionSet` on the ArchiMate 4.0 metamodel (Req 2.4)
- [x] Docgen *Question Set* type, renderer and page; `docgen-index.yaml`, `_redirects`, `llms.txt`, `llms-full.txt`; the catalogue validates (Req 2.2–2.3)
- [x] `questions` SHACL profile (Req 6.1)
- [x] `QuestionRunner` (RDF4J) and `examples/archimate4-questions-example.ttl` with its expected file, in `--questions` and `--ci`: 36 questions, four ways each, 38 cases (Req 6.2)
- [x] Docs: DD-33, ontology reference, validation guide, modelling-languages guide; `validate.sh --ci` passes

## 3. la-gram engine — done 2026-10-27

- [x] Loader: role `questions` through `arch:hasQuestionSet` (followed, not skipped; recognised in uploads); the core set bundled as `coreQuestions` and loaded with the core files; the two sets added to `assets/` and `sync-assets` run (core ontology and shapes, the ArchiMate 4.0 manifest refreshed) (Req 7.1–7.2)
- [x] `model-manager/questions.ts`: `listQuestions`, `offeredQuestions`, `missingParameters`, `buildQuery`, `prebind`, `stageOf` (Req 3, 7.3)
- [x] `questions.test.ts`: all 36 questions on meta's example model with all and required parameters; each finding's culprits and near misses; every answer the same with the inferable core and abstract types added — on Oxigraph, as meta checks it on RDF4J; loaded at startup, nothing in the model graph
- [x] `questions-bench.test.ts` (Req 12.1): 350 000 triples, the Layered viewpoint, every question within 1 s and `viewpoint-scope` within 2 s (measured 0.66 s) — the whole test 2.7 s. `viewpoint-scope` stays on the main thread (D12)

## 4. la-gram workbench — done 2026-10-27

- [x] Questions menu beside *Run* in the SPARQL tab: stage groups, *Fits this view* first, concern filter, what is bound by name, disabled entries saying what to select; a pick runs the bound query, headed by the question, what a row means and what it does not prove (Req 8)
- [x] Bindings from the workbench: open model, view and viewpoint, one selected element or two, the palette pick (Req 8.2)
- [x] "Ask about this element…" in an element's right-click menu: the menu on the questions taking `?focus`, bound to it (Req 9)
- [x] Model checks in the Validation tab: on request, `?model` bound, rows as results beside the SHACL ones — scope, badge and markers alike; how many ran, which stopped at their limit, which could not run and why, stale after an edit, dropped with another model (Req 10, 12.2)
- [x] New view from a question's result: named after it, following the viewpoint it fits, or was asked about (Req 11)
- [x] `viewpoint-scope` on the main thread: recorded (D12, Req 12.1)
- [x] Tests: `questions.test` (hints, a view's viewpoint, model checks — failed and capped too), `sparql-editor.test` (groups, the menu, asking, caveats, the view request), `validation-panel.test` (checks merged, scoped, reported), `workbench.test` (the whole flow on the real app), `workbench.spec` (right-click → ask, the menu and its concern filter, model checks, in Chrome)
- [x] la-gram specs (requirements 6.11, 11.9, 16.4; design; tasks) and README updated

## 5. Later

- [ ] Deliverable sections ask questions: `la-generate`, then the ArchiMate 4.0 templates reworked, keeping their published layout (Req 13)
- [ ] `linked-archi-query`: the source-of-truth decision (D10), the new identifiers, `layer-crossing` for ArchiMate 4.0
- [ ] Converters: viewpoint IRIs meta defines (`amvp:OrganizationViewpoint`, not `amvp:Organization`)
