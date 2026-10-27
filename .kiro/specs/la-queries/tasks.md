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

## 3. la-gram engine

- [ ] Loader: role `questions` through `arch:hasQuestionSet`; core set as a core asset; `sync-assets` (Req 7)
- [ ] `model-manager/questions.ts` from the draft, tests from the draft plus the converter-written fixture (Req 3, 7.3)
- [ ] Bench test with the budget (Req 12.1): `am4q:viewpoint-scope` (0.66 s for the Layered viewpoint at 350 000 triples) runs off the main thread or is offered with a warning on models of that size

## 4. la-gram workbench

- [ ] Questions menu in the SPARQL tab, bindings, caveats with the result (Req 8)
- [ ] "Ask about this element…" in the right-click menu (Req 9)
- [ ] Model checks in the Validation tab, with scope, badge and markers (Req 10)
- [ ] New view from a question's result conforms to its viewpoint (Req 11)
- [ ] la-gram specs (requirements, design, tasks) and README updated

## 5. Later

- [ ] Deliverable sections ask questions: `la-generate`, then the ArchiMate 4.0 templates reworked, keeping their published layout (Req 13)
- [ ] `linked-archi-query`: the source-of-truth decision (D10), the new identifiers, `layer-crossing` for ArchiMate 4.0
- [ ] Converters: viewpoint IRIs meta defines (`amvp:OrganizationViewpoint`, not `amvp:Organization`)
