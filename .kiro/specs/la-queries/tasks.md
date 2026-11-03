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
- [x] `QuestionRunner` (RDF4J) and `examples/archimate4-questions-example.ttl` with its expected file, in `--questions` and `--ci`: 36 questions, four ways each, 39 cases (Req 6.2)
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

## 4a. Questions for the model's languages — done 2026-10-27

- [x] la-gram offers a language's questions only for a model that declares that language, any loaded one's when it declares none (D14, Req 7.3): ArchiMate 4.0's questions answered nothing on an ArchiMate 3.2 model (no `am4:Capability`), which read as "nothing realised". *workbench.test (an imported Exchange model: 16 questions offered, 7 model checks)*

## 5. Converters: viewpoint IRIs — done 2026-10-27

- [x] The ArchiMate converter's viewpoint table holds the published catalogue's 25 names (`amvp:OrganizationViewpoint`, …), Application Structure and Value Stream added (Req 14.1)
- [x] `ArchiMateViewpointTest`: the 25 specification names resolve, each to its own individual; what is claimed equals what the published catalogue defines (Req 14.2); every converter test passes; the ArchiMate converter jar rebuilt
- [x] ADR 0006 and the changelog say so
- [x] la-gram does not rewrite old IRIs; converted models are reconverted (D13, Req 14.3)

## 6. Deliverables (la-generate, then meta) — done 2026-10-30

- [x] la-generate: RDF4J 6.1, Java 25, Kotlin 2.3, Gradle 9.6; TriG, N-Quads and N-Triples read as one graph; `--data`, `--param`
- [x] la-generate: a baseline of every section-query template first — 292 outputs byte-identical after the move
- [x] la-generate: question sets from the files given (D20); `arch:sectionAsks` asked in order with `VALUES` pre-binding; metamodel probes; not asked reported with the reason (Req 13.1)
- [x] la-generate: the context per question, display rows, "none found" for an empty finding; bundled Markdown and HTML layouts (D25)
- [x] la-generate: the views that follow the section's viewpoint, with their elements (Req 13.3, D21); `arch:sectionQuery` unchanged (Req 13.4)
- [x] la-generate: questions bound to `?model` not asked when nothing is `arch:inModel` the model (D24)
- [x] meta: the ArchiMate 4.0 templates from the draft — published IRIs, ARS and APD sections, the quality appendix, a Change Impact Assessment taking `?focus` (Req 13.2); in the manifest
- [x] meta: the ArchiMate 3.2 templates the same way, asking the 3.2 questions, with a Change Impact Assessment (Req 13.2, D22); in the manifest
- [x] meta docgen: a template's parameters, and each section's concerns and questions, linked to their Question Set entries (built in a scratch copy)
- [x] meta docs: Deliverable Templates and Deliverable Generator Spec rewritten; the ArchiMate 4.0 and 3.2 guides' template sections
- [x] Golden outputs from meta's questions examples, Markdown, in la-generate's tests (Req 13.5, D23); unit tests (20 in all); README, CHANGELOG
- [x] la-gram: the two ArchiMate manifests synced with the Change Impact Assessment line (meta b823d39); bundle rebuilt
- [x] la-generate: a section that asks nothing presents its viewpoint, concerns and views (D26); golden files of the core templates; 22 tests
- [x] meta: the core templates ask the core questions (D27), without an `owl:Ontology` header, their formats without layouts that do not exist; core's template vocabulary defines a deliverable as produced from a model; `arch:templateResource` on a template or a format
- [x] meta: every relationship qualified (D28) — core, the relationship guide and both ArchiMate guides agree; NordFreight with `arch:inModel` on its 40 elements and views and a resource for each of its 35 relationships (the 4.0 relationship shapes report clean); its Architecture Definition Document asks every question
- [x] meta: the other example models follow D28 — acme-corp, payflow, custom-metamodel, meridian, the LeanIX docs example, ml-fraud-detection and the two extension examples: a resource for each of 139 relationships, `rdf:reifies` on the 20 resources that lacked it, LeanIX's resources reached by their type's qualified predicate, not `arch:hasQualifiedRelationship`, and ml-fraud's contract resource reached from its source; the EDGY and UML guides no longer write a resource only "when metadata needed". The derivation and principles examples are test data, left as they are; la-gram's bundled core ontology synced
- [x] meta: derivations are propositions (D29) — the 4.0 and 3.2 rules regenerated without the direct triple, a premise asserted or derived as valid, `DeriveRules` reading a derivation premise by the triple it reifies; the rules that start from a triggering or flow (DR7, DR8, PDR8, PDR10, PDR11) target the sources of qualified relationships (`sh:targetObjectsOf arch:source`), as a derived one has no triple for `sh:targetSubjectsOf` to find; the expected derivations unchanged; core's `QualifiedRelationship`, the relationship guide (§7.1, §9.2's materialisation from the qualified predicate only, §10.3, §13), both ArchiMate guides, their derivation diagrams, validation.md and the ontology reference
- [x] meta: a derivation rule is a plan (D30) — the 4.0 and 3.2 rules regenerated: a derivation's `prov:wasGeneratedBy` names its derivation activity (`derivation-activity-<key>`, a `prov:Activity`) whose association (`derivation-activity-<key>-association`) has the rule as `prov:hadPlan`, each rule `a sh:SPARQLRule , prov:Plan`; `DeriveRules` reads the rule as the activity's plan; TIME's rule a plan, its derivation activities blank nodes; the check example's derivations, both ArchiMate guides (a section on which rule and what ran it, with the update that adds the agent), their derivation diagrams, the TIME guide, the ontology reference, the ArchiMate README, validation.md, DD-27 and DD-28; the same derivations, profiles and table checks pass
- [x] meta: what runs the rules records its run, and derivations are kept in their own graph in a store or beside the model in a file (D31) — DD-27 and DD-28 rewritten, the 4.0 guide's "Which Rule, and What Ran It" and "Where Derivations Are Kept" with examples, the 3.2 and TIME guides, the ontology reference, the README and the TIME rules' description
- [x] meta: a valid derivation is a statement, a potential one a proposition (D32) — the 4.0 and 3.2 rules regenerated: a valid rule asserts the triple and qualified predicate; a premise's triple is asserted, not an unconfirmed potential derivation; the five targets back to `sh:targetSubjectsOf`; the namespace `urn:linked-archi:` with no model or several. `DeriveRules` checks a valid derivation's triple and qualified predicate. Same derivations: 37, 37 and 38, the expected results untouched. DD-27, DD-28 (with `{base}graph/derived` across models) and DD-29, both ArchiMate guides, the relationship modelling and TIME guides, validation, the ontology reference, core's `arch:QualifiedRelationship` note, the README and the merged-dataset diagram
- [x] la-gram: opening a model leaves a proposition as it is (D32) — loading gave each potential derivation a qualified predicate, half of confirming it, and `arch:inModel`, and laying out a model with no geometry drew it (`ModelSession.propositions()`); on NordFreight with its derivations none of the 88 now gets any of them, where all 88 got the predicate and `arch:inModel`, and valid ones still load as relationships. The bundled core and catalogue are synced, the catalogue from a scratch copy of meta
- [ ] la-gram: how a derivation shows, and confirming one (D32) — the tree and what else reads `arch:source` list a potential derivation as a relationship (168 on NordFreight with its derivations, 35 without), and no action asserts its triple with its qualified predicate
- [x] meta and la-gram: what the questions read with derivations loaded (D33) — core's `neighbours` and `dependents` and twelve ArchiMate questions in each version read direct triples, seven of them along the chains the valid rules follow and four, too slow to walk on the benchmark model, by their fixed steps; `reifies-audit` leaves propositions alone; the identifiers `core/neighbours` and `core/dependents`; the expected answers of both question examples updated where the rules derive more; the relationship guide and both ArchiMate guides; BPMN and UML direct predicates, with the converters writing them. Synced to la-gram. Not done: the APM templates, which still read the resources
- [ ] la-gram: record a run if it comes to derive — it does not: the rules are not bundled, needing a server-side engine. Then a `prov:Activity` with itself as the agent (`prov:agent` on the run's association, a `prov:SoftwareAgent`) and when it ran, each derivation activity `dcterms:isPartOf` it — D31
- [x] meta docgen: an ontology that also holds viewpoints or a concept scheme is documented by WIDOCO — the core ontology, and four extension ontologies (built in a scratch copy)

## 7. linked-archi-query — done 2026-10-30

- [x] Decisions D16–D19: the one-graph reading, direct triples by default, the metamodel checked when a question runs, one name with two implementations
- [x] Converters: `--emit-direct-rel-triples` on by default, negatable, in every converter; BPMN reports flows reaching no predicate only when the flag is named; docs, changelog; 1 457 tests pass; the jars rebuilt (D17)
- [x] `la-connect`: `default_graph: "union"` per query (`default_graphs` in `execute-many`), local data answered from a merged copy, an endpoint refusing; the reading echoed in the result (D16)
- [x] `la-query`: the bundled sets and their index (`make questions`), `--catalog questions.ttl`, the field mapping of design § linked-archi-query (Req 15.1)
- [x] One entry, two implementations; `catalog show` and `dump` say which runs where (Req 15.2, D19)
- [x] Requirements read from the query, with remedies; metamodel ASKs run in the same call, refusing or handing to the template (D17, D18)
- [x] `catalog concerns`, `--concern`; `la-analyse plan --concern` (Req 15.3)
- [x] `tests/test_questions.py`: every case of meta's two expected files, flattened and in converter graphs (Req 15.4); profile reference (`union_default_graph`), skill docs, template and machine contracts, changelog, docs site
- [x] Four core questions named apart from the templates whose names they shared: `core/model-inventory`, `core/missing-definitions`, `core/duplicate-labels`, `core/architecture-state`, after their local names; `make questions`
- [x] The default profile and fixtures (linked-archi-apm 0.10.0): fixtures re-extracted from current converter output, direct triples and their bridges included; `linked-archi-default` claims `direct_rel_triples` and a `partial` `rdf_reifies`; `linked-archi-qualified` describes output without them; `linked-archi-direct` deprecated; `la-analyse` takes `PREDICATE_PATH` from `core/reified-predicates`

## 8. ArchiMate 3.2 questions, and specialisations — done 2026-10-27

- [x] `archimate3.2-questions.ttl` (`amq:`, `https://meta.linked.archi/archimate3/questions#`): 19 questions, layers for domains, each type asked about as a two-step type set (Req 16.1, D15)
- [x] `arch:hasQuestionSet` on the ArchiMate 3.2 metamodel; `docgen-index.yaml`, `_redirects`, `llms.txt`, `llms-full.txt`; the ArchiMate README's files and namespaces; the docs render (19 questions) and the catalogue validates
- [x] `examples/archimate3.2-questions-example.ttl` and its expected file (38 cases, the core findings among them); `validate.sh --questions` runs per version; the `questions` profile holds both sets; `--ci` passes (Req 16.2)
- [x] The 15 ArchiMate 4.0 questions that matched a type exactly read a type set, and declare `arch:ModelAndMetamodelDataset`; `application-dependencies` also follows the function assigned to a component; the 4.0 example has a strategic capability and a regulatory requirement (Req 5.3, 3.8)
- [x] `plateau-difference` (3.2) compares where `?from` and `?to` are bound; `data-never-written`'s write check holds with `am:Access` beside a read
- [x] la-gram: the 3.2 set bundled (`questions`, `archimate3`) and synced; `questions.test` (the 3.2 suite on Oxigraph, the 4.0 example updated); `bench-model.mjs --language 3.2` and a 3.2 benchmark (every question under 0.3 s at 350 000 triples); `workbench.test` (an imported 3.2 model: 35 questions, 14 model checks, `amq:capability-realisation` asked) (Req 16.3)
- [x] Docs: validation guide, modelling-languages guide, `.scripts/README.md`
- [x] Converter: accesses typed by kind (`am:ReadAccess`, `am:WriteAccess` — also when the attribute is absent — `am:ReadWriteAccess`, `am:Access`), the deprecated `am:accessType` no longer written; a `relationships:` entry wins; `ArchiMateAccessKindTest`, every converter test passes, the jar rebuilt; a converted sample answers the 3.2 questions as expected
