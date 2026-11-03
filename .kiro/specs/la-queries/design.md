# Design — Questions

See [requirements.md](requirements.md). The vocabulary and its rationale are meta's
[DD-33 — Model Questions Are SPARQL Executables Bound to Concerns](../../../../../../linked-archi-meta/doc/guide/design-decisions.md#dd-33-model-questions-are-sparql-executables-bound-to-concerns).

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | `arch:ModelQuestion` and its properties live in the core, beside Stakeholder, Concern, Purpose and Viewpoint | The core describes how stakeholders' concerns shape the architecture description; questions are one more thing concerns shape |
| D2 | Question sets are instance data: root `arch:QuestionSet`, never `owl:Ontology`; a new docgen asset type | As deliverable templates; docgen classifies such assets by the absence of `owl:Ontology` |
| D3 | Parameters are core properties: `arch:focus`, `arch:model`, `arch:view`, `arch:viewpoint`, `arch:conceptType`, `arch:from`, `arch:to` | One set of variable names for every language's questions; no question set depends on another. `conceptType`, not `type`, keeps the input apart from a `?type` result column |
| D4 | Per-class question properties (`questionAddressesConcern`, `questionTargetsStakeholder`, `questionHasPurpose`, `questionFitsViewpoint`), as the core's other 42010 links | Reusing `arch:targetsStakeholder` (domain `arch:Viewpoint`) would make a question a viewpoint under RDFS |
| D5 | Converters may keep asserting `arch:Element` / `arch:ModelConcept`; questions must not depend on them | They are inferable; a triplestore with RDFS inference adds more. A question's answer is the same with or without them |
| D6 | A finding names its subject column (`arch:findingFocus`) | So findings become validation results on the right concept |
| D7 | Labels in English with an untagged fallback | As proposed; a `?lang` parameter can come later |
| D8 | `am4vp:` purposes: `skos:exactMatch` to `archvp:` for now | As proposed; retire later |
| D9 | Scope: core and ArchiMate 4.0 first; other languages' sets the same way later | As proposed |
| D10 | The RDF question sets are the source of truth for every question they hold: what is asked, why, and the query for the Linked.Archi layout. `linked-archi-query` reads them as catalogue entries; its role-based `.rq` templates stay only for other dataset layouts, linked by `dcterms:identifier` (decided 2026-10-27) | The RDF questions now carry fixes the templates do not (most specific types, metamodel reads in any graph, specialisations admitted); exporting the catalogue to RDF, as the proposal had it, would lose them. Concerns, stakeholders and findings exist only in RDF |
| D11 | The class is `arch:ModelQuestion`, not `arch:Question`; its label is the question, ending in a question mark (checked); `arch:Concern`'s scope note says how the two differ; `arch:QuestionSet` is defined as a unit of publication | A concern is an interest held in the system, a model question asks one thing the description answers. Concerns are often worded as questions, so "Question" beside "Concern" invited the reading "a stakeholder's question is a concern". `arch:CompetencyQuestion` (opaque to architects) and `arch:ModelQuery` (loses the stakeholder framing) were the alternatives |
| D12 | `viewpoint-scope` stays on the main thread in la-gram | 0.66 s for the Layered viewpoint (which admits nearly every type) at 350 000 triples, every other question under 0.3 s. It is a listing, asked only when picked, never by the model checks; the validation worker does not hold the metamodel graphs it reads. The benchmark holds it to 2 s, so a regression to the draft's quadratic form (24 s at 70 000) still fails |
| D13 | la-gram does not rewrite a converted model's viewpoint IRIs; such models are reconverted (decided 2026-10-27) | The converter fix is the source of the right IRIs; a rewrite in one consumer would leave every other consumer of the old files wrong, and hide that they are |
| D14 | A language's questions are offered for a model that declares conformance to that language (`arch:modelConformsToMetamodel`), or for any model that declares none | ArchiMate 4.0 stays loaded beside ArchiMate 3.2; its questions on a 3.2 model found no `am4:Capability` and answered nothing, which read as "none realised" |
| D15 | A question asks for a type with its subtypes, read as a two-step type set once per query, and reports the type asked about | ArchiMate 3.2 defines subtypes of its own (`am:Constraint` under `am:Requirement`, `am:Device` under `am:Node`), and a model may specialise a type; a one-step set misses a model's subclass of a language's subtype, and reporting the matched type would repeat a row wherever a supertype is asserted or inferred beside it |
| D16 | `linked-archi-query` asks a question of the dataset read as one graph: local data from the merge of its graphs, on request per query; an endpoint only when the profile declares `capabilities.union_default_graph`. Templates keep their graph scoping (decided 2026-10-30) | The questions are written and checked for one graph (la-gram, meta's check); converter TriG keeps the model in named graphs and an empty default graph. Asked per query, the strict default that makes a template's missing scope fail loudly stays for everything else. A merge, not pyoxigraph's union: that keeps a triple once per graph holding it |
| D17 | The converters write direct relationship triples by default (`--no-emit-direct-rel-triples` leaves them out); a question reading them is gated on `direct_rel_triples` (decided 2026-10-30) | The core requires the direct triple always, and 28 of the 55 questions follow relationships along it; without it, "which services does nothing realise?" would list every service. The bundled default profile describes that output, and `linked-archi-qualified` output without them |
| D18 | A question reading the metamodel is checked when it runs - each `arch:requiresMetamodel` ontology, a viewpoint catalogue, unqualified forms - and refused, naming the published Turtle, when it is not loaded; `linked-archi-query` never fetches it (decided 2026-10-30) | Without it a question answers from type sets of one type and a catalogue of no viewpoints, which reads as an answer. Choosing data is the user's, as everywhere in the package |
| D19 | A question and a template of one name are one entry with two implementations: the question where the dataset fits it, the template elsewhere; `query render` on named graphs gives the template. A question asking something a template does not takes a name of its own (decided 2026-10-30) | Separate names would leave the analysis skill choosing between two entries for one question. Four core questions first shared a template's name while asking something else, and were renamed after their local names: `core/model-inventory` (the template `core/inventory` reports graphs), `core/missing-definitions` (`core/coverage-gaps` checks a predicate you name), `core/duplicate-labels` (`core/label-collisions` pairs names across models) and `core/architecture-state` (`core/lifecycle` reads notation lifecycle fields) |
| D20 | la-generate reads the question sets and metamodel documents from the files it is given (`--data`) and fetches nothing; a question whose documents are missing is reported as not asked, naming the published Turtle (decided 2026-10-30) | As D18 for linked-archi-query: choosing data is the user's. A deliverable that silently fetched would differ by network |
| D21 | A section lists the model's views that follow its viewpoint, with the elements each shows (`arch:inView`), and embeds a view's image only where the model links one (`schema:image`); drawing a view from its geometry is later (decided 2026-10-30) | The converters write no images and meta's examples no geometry; a listing is right for every model today |
| D22 | ArchiMate 3.2 has the same four templates as 4.0, the Change Impact Assessment included, asking the 3.2 questions; its sections ask the core `viewpoint-scope`, as 3.2 has none of its own (decided 2026-10-30) | Most models, converted from exchange files, are 3.2. 3.2's layers need no common-domain rule, which is all 4.0's own `viewpoint-scope` adds |
| D23 | The golden files are la-generate's: each template of both versions generated from meta's questions example as Markdown, compared byte for byte; `syncMeta` copies the documents they read (decided 2026-10-30) | The generator's output is what is checked, so the check lives with it; HTML renders the same context. A meta change reaches the golden files through a reviewed sync |
| D24 | When nothing is `arch:inModel` the deliverable's model, the questions bound to `?model` are reported as not asked, not answered (2026-10-30) | Such a model (one stating membership with `dcterms:isPartOf`, as older converter output does, or none at all, as meta's NordFreight example did until D28) answered every one of them "none found", a false all-clear |
| D25 | The rewritten templates name no layout (`arch:templateResource`); la-generate renders a template that asks questions with its own layouts, and never with the layouts it bundles for section-query columns (2026-10-30) | meta publishes no layout files, so the names pointed nowhere; a question section carries what a layout needs (label, rows, caveat, status) |
| D26 | In a template whose sections ask questions, a section that asks none and has no query presents its viewpoint, concerns and views (2026-10-31) | It printed "No elements found" — a query section's line — without its viewpoint or views; the core templates have sections only a language's questions could answer |
| D27 | The core templates ask the core questions, keeping their sections and viewpoints; a section none of them answers (stakeholders, process, interface, deployment, decisions, roadmap) presents its views (2026-10-31) | They asked nothing and produced a title alone; the core questions are what is known of a model in any language |
| D28 | Every relationship is written as its direct triple, qualified predicate and resource; a graph trimmed to direct triples is a projection for traversal, not a model the questions are asked of (2026-10-31) | One shape for converters and modelling tools; the core questions read the resources, so a direct-only model answered falsely (every element an orphan). meta's guides, the relationship guide's §5 and NordFreight now follow core |
| D29 | A derived relationship is a proposition — since D32, a potential one: its resource reifies the triple without asserting it, with its certainty and provenance, and no direct triple or qualified predicate; a model's relationships are those whose triple is asserted, and asserting it, with its qualified predicate, confirms a derivation (2026-10-31) | RDF 1.2 reads a triple term as a proposition, a triple as a statement; the rules wrote the triple for every derivation, so a query for `?a am4:serves ?b` returned potential relationships as stated ones. The rules now take a premise as asserted (its triple) or derived as valid. Open: the core questions read `arch:source`, and so would count propositions loaded with the model |
| D30 | A derivation rule is a plan (`prov:Plan`), not an activity: a derivation is generated by a derivation activity — the rule applied to its premises — a `prov:Activity` whose `prov:qualifiedAssociation` has the rule as `prov:hadPlan`, with an IRI from the same rule and premises as the derivation's (`derivation-activity-<key>`); what runs the rules — la-gram, a pipeline, any other application — adds itself as the agent (`prov:agent`) and when it ran, where it knows (2026-11-01) | `prov:wasGeneratedBy` ranges over activities, and an activity happens once and takes time; a rule is applied again and again, and PROV-O makes activity and entity (a plan is one) disjoint. Typing the rule `prov:Activity` met the range by mistyping the rule. Minted IRIs, not blank nodes, so deriving again gives the same graph. Named a derivation activity, not an application: an application is software, an agent (`prov:SoftwareAgent`). meta's DD-27 and DD-28, both ArchiMate guides, the TIME guide and rules, the ontology reference and the ArchiMate README say so. Open: la-gram and the platform record their agent — as D31's run |
| D31 | What runs the rules records its run: a `prov:Activity` of its own (`{base}provenance/run/{token}`, keyed by its job), with its agent on its association, when it ran and the rules it ran (`prov:used`), and each derivation activity it produced `dcterms:isPartOf` it. A rule run is not a converter run: in a pipeline, a job of its own, after a conversion or apart from one. Derivations are kept in a graph of their own in a store (`…/graph/derived`), beside the model in a file or an editor (2026-11-01) | A SHACL rule reads only the data graph, and a run in a derivation's key would give the same derivation a new IRI on every run; so the rules run as published and the run is recorded after them, its agent and times said once rather than on each derivation activity. meta's DD-27 and DD-28, the ArchiMate 4.0 guide (Which Rule, and What Ran It; Where Derivations Are Kept), the 3.2 and TIME guides, the ontology reference and the ArchiMate README say so. Open: la-gram records its run |
| D32 | What a rule derives follows its certainty: a valid derivation is a statement — the direct triple, the qualified predicate and the resource — and a potential one a proposition, the resource alone. What was stated is told from what holds by the graph (the model and semantic graphs, the union), and in a file by the resource. Derivations across models keep the dataset-wide `{base}graph/derived`, with IRIs in `urn:linked-archi:` (2026-11-02) | Appendix B separates "certainly true in any model where these rules apply" from "potentially true but uncertain", and RDF 1.2 has a form for each; D29's reason was potential relationships returned as stated, which does not hold for valid ones, and `:portal am4:realizes ?x` returned nothing for a relationship the rules call certain. Same derivations as before, only the triple and qualified predicate added: the expected results are unchanged. NordFreight: 35 direct triples, 74 with the valid ones. Cost: a file needs a filter to tell what was stated, and two updates to remove derivations (meta's DD-28). The rules picked either model's namespace with `SAMPLE` when two were loaded, so one derivation got different IRIs across runs; now `urn:linked-archi:`. Open: la-gram's confirm flow and the core questions |
| D33 | The questions follow relationships along their direct triples, and where they ask what serves, realises, is assigned to or triggers what, along the chains the valid derivation rules follow (DR 2 to DR 8), anchored on the relationship asked about; a question about the relationship itself reads its resource (`core/reifies-audit`, `data-access`, `data-never-written`, `model-inventory`, `view-contents`), and no question filters derivations. `core/neighbours-qualified` and `core/dependents-qualified` become `core/neighbours` and `core/dependents`, their IRIs unchanged; `core/reifies-audit` does not report a proposition; BPMN and UML publish a direct predicate for the connectors drawn between two elements (2026-11-03) | A valid derivation asserts its triple and a potential one none, so a question reading triples is right with or without derivations and needs no filter: on NordFreight with all of them, `neighbours` gives 148 rows where the resources gave 336, `reifies-audit` 0 where it gave 88; a path in the rules' shape answers without derivations what they would derive (`capability-realisation` 7 where one hop gave 5), and on both question examples the eleven such questions give what the old ones give with the rules run. Cost: the metamodel must be loaded to tell a relationship predicate; two relationships of one type between the same pair count once; a path does not apply Appendix B.4, so a question restricts its ends where one could cross it (`responsibility-assignments` asks only of active structure); `data-access` still lists a potential access, an accepted risk |

**Confirmed:** the question set files and namespaces —
`core/core-questions.ttl` → `https://meta.linked.archi/core-questions#` (`archq:`) and
`modelingLanguages/archimate/4.0/archimate4-questions.ttl` → `https://meta.linked.archi/archimate4/questions#`
(`am4q:`), "questions" rather than the drafts' "queries", after the class.

## Review of the drafts (2026-10-27)

What was checked, and what it found:

- All four draft Turtle files parse; every `arch:`, `archvp:`, `am4:`, `am4vp:` term they use — in triples and in
  the query text — is defined in meta.
- The proposal's own tests (20) pass on la-gram's Oxigraph: all 35 questions parse, pre-bind and run, and each finding
  catches its culprit on the proposal's fixture.
- **Types.** The converted ArchiSurance model types its 430 elements 1 290 times. `elements-of-type` returned 1 152
  rows; all 64 `duplicate-labels` findings came from grouping by `arch:Element` / `arch:ModelConcept` ("Bank" the
  Business Actor and "Bank" the Business Role); with the view's viewpoint resolved, `viewpoint-conformance` flagged all
  9 elements of the Organization view, twice each.
- **Unknown viewpoints.** The converters write viewpoint IRIs meta does not define (`amvp:Organization`,
  `amvp:InformationStructureVP` for `amvp:OrganizationViewpoint`, …); the viewpoint questions then return nothing,
  which reads as "conforms". (A converter fix; the questions must also report it — Requirement 3.5.)
- **Speed** (generated ArchiMate 4.0 model): `am4q:viewpoint-scope` 1.6 s / 6.5 s / 24 s at 17 500 / 35 000 / 70 000
  triples (quadratic); at 350 000 triples `applications-without-technology` 4–5 s, `unrealised-requirements` 4.6–5.5 s,
  `application-dependencies` 1.3 s; everything else under 0.5 s. Looking the type set up once,
  `applications-without-technology` takes 45 ms and `unrealised-requirements` 23 ms, with the same answers.
- **Conventions.** The drafts declare `owl:Ontology` on question sets and on the reworked templates (D2), and carry
  history-style wording ("Supersedes", "Replaces", "Split from").
- **Catalogue.** The 12 core identifiers match `linked-archi-query` templates; the 3 new core ones and all 20
  `notation/archimate4/*` ones are not in the catalogue yet.
- **Discovery.** la-gram finds a metamodel's documents through its manifest: bundling the files alone would not offer a
  fetched metamodel's questions — hence `arch:hasQuestionSet`.

## Vocabulary (meta, done)

In `core/core-onto.ttl`:

| Term | Kind |
|---|---|
| `arch:ModelQuestion`, `arch:QuestionSet`, `arch:DatasetScope` (`arch:ModelDataset`, `arch:ModelAndMetamodelDataset`) | classes, individuals |
| `arch:QuestionStageScheme` with seven stage concepts | SKOS scheme |
| `arch:questionAddressesConcern`, `questionTargetsStakeholder`, `questionHasPurpose`, `questionFitsViewpoint`, `questionStage`, `answers`, `doesNotProve`, `resultIsFinding`, `findingSeverity`, `findingFocus`, `requiresDataset`, `requiresMetamodel`, `defaultLimit`, `resultKey` | question properties |
| `arch:focus`, `model`, `view`, `viewpoint`, `conceptType`, `from`, `to` | parameter properties |
| `arch:hasQuestionSet` | manifest link |
| `arch:sectionAsks`, `sectionAddressesConcern`, `sectionTargetsStakeholder`, `templateParameter` | section additions |

In `core/core-shapes.ttl`: `archsh:ModelQuestionShape` (the label ends in a question mark),
`ModelQuestionQueryShape` (written with `sh:or`: RDF4J does not evaluate `sh:xone`), `ModelQuestionFindingShape`,
`ModelQuestionListingShape`, `ModelQuestionParameterShape`, `QuestionSetShape`.

## Writing a question

**Most specific type.** Where a question reports or groups by `?type`, it keeps only types no other asserted type of
the concept specialises, and never the core classes:

```sparql
?element rdf:type ?type .
FILTER(?type NOT IN (arch:ModelConcept, arch:Element, arch:QualifiedRelationship))
MINUS { { SELECT DISTINCT ?type WHERE { { ?type arch:isAbstractClass true }
                                       UNION { GRAPH ?g { ?type arch:isAbstractClass true } } } } }
```

(abstract classes are marked `arch:isAbstractClass true`; a concrete subclass asserted beside its concrete
superclass is rare and handled where a question needs it).

**A type set once per query.** A membership test against the class hierarchy is a sub-select joined or subtracted,
not an `EXISTS` with `GRAPH ?g` per row:

```sparql
MINUS {
  { SELECT DISTINCT ?technologyType WHERE {
      { ?technologyType rdfs:subClassOf* am4:TechnologyDomainElement }
      UNION { GRAPH ?g { ?technologyType rdfs:subClassOf* am4:TechnologyDomainElement } } } }
  ?technology rdf:type ?technologyType ;
              am4:serves|am4:realizes|(am4:realizes/am4:serves) ?application .
}
```

**Viewpoints.** A viewpoint admits the types it names (`arch:includesConcept`) and their subclasses. The published
viewpoints name concrete types only (44 in ArchiMate 4.0, 62 in 3.2), so exact matching works for published types;
specialisations need the closure.

## Question sets (meta, done)

- `core/core-questions.ttl` (`archq:`, 16 questions) and
  `modelingLanguages/archimate/4.0/archimate4-questions.ttl` (`am4q:`, 20), roots `arch:QuestionSet`; the ArchiMate
  4.0 manifest links its set with `arch:hasQuestionSet`.
- New beside the drafts: "Which views follow a viewpoint the loaded metamodels do not define?" (a finding about the
  view); viewpoints admit their types' specialisations; `element-detail` names a type from its metamodel in either
  layout; a set of types under a class is read in two steps (within each document, then specialisations in any),
  so a model's own specialisation of an ArchiMate type counts.
- Speed, la-gram's Oxigraph, generated ArchiMate 4.0 model of 350 000 triples: everything within 500 ms except
  `am4q:viewpoint-scope` for the Layered viewpoint (admits nearly every type): 0.66 s — 2.5 s before set-wise
  anchoring, and the draft grew with the square of the model (≈10 min). Same answers as the draft at 17 500 and
  35 000 triples on four viewpoints. `application-dependencies` 1.1 s → 9 ms (each branch checks its own ends,
  instead of every pair of components first).
- A sub-select that uses a parameter's variable projects it, so the pre-binding still applies to its rows (the
  core's wording).
- Checked by `validate.sh --questions` (`QuestionRunner`, RDF4J) over
  `examples/archimate4-questions-example.ttl` and its expected file, in four ways (named graphs / merged × as
  written / inferable types added), part of `--ci`; a copy of `duplicate-labels` without the core-type exclusion
  fails it ("Bank" the actor and "Bank" the role). The `questions` SHACL profile checks both sets.
- The documentation generator has a *Question Set* asset type (`QuestionSetDocRenderer`, `questions.hbs`): the
  questions by stage, with what a row means and does not prove, concerns, stakeholders and viewpoints linked,
  parameters and SPARQL; catalogue `dcterms:conformsTo arch:QuestionSet`. Registered in `docgen-index.yaml`,
  `_redirects`, `llms.txt`, `llms-full.txt`.

## la-gram

**Loading.** The metamodel loader follows `arch:hasQuestionSet` like the manifest's other properties (role
`questions`, a named graph per document, bundled or fetched — not "skipped"); the core set is a core asset with the
core ontology. `sync-assets` copies the sets from meta.

**`model-manager/questions.ts`** (from the draft `example-queries.ts`): `listQuestions(store)` reads the questions from
any graph; `offeredQuestions(questions, loadedOntologies, viewpoint)` filters by `arch:requiresMetamodel` and puts those
fitting the open view's viewpoint first; `buildQuery(question, bindings, { limit })` adds the prefixes, pre-binds the
declared parameters (`prebind`, which masks strings, IRIs and comments to find the outermost `WHERE`) and appends
the limit; a missing required parameter is a `MissingParameterError`.

**Bindings.** `mount-ui` supplies them from the workbench: one selected element → `focus` (on the canvas, else in the
tree), open model → `model`, open view → `view`, its `arch:viewConformsToViewpoint` → `viewpoint`, the type picked in
the palette (until something is selected) → `conceptType`, two selected elements → `from`/`to`. The menu shows what
is bound, by name.

**SPARQL tab.** A Questions menu (stage groups, those fitting the viewpoint first under *Fits this view*, concern
filter, disabled entries saying what to select — `whatToSelect`) fills the editor with `buildQuery(…)` and runs it; the
result header shows the question, `arch:answers` and `arch:doesNotProve`, and "None found" for a finding without rows.
Running an edited query drops the header.

**Right-click menu.** "Ask about this element…" opens the questions taking `?focus`, run in the SPARQL tab.

**Model checks.** The Validation tab gets a "Model checks" action: `runModelChecks` runs the offered finding questions
with `?model` bound — nothing else: the checks are of the whole model, the tab's scope filters — and adds a result per
row, once per concept and question — `focusNode` from the `arch:findingFocus` column, `severity` from
`arch:findingSeverity`, `message` the question's label, `sourceShape` the question's IRI (shown as "Check: …") — so the
View / Model scope, the badge and the canvas markers apply unchanged. Checks run on request (Requirement 12.2); the
results stay until the next run or another model, and after an edit the tab says the model has changed since. A
check that stops at its `arch:defaultLimit` is said to; one that cannot run is listed with why.

**Views.** "New view" from a question's result is named after the question and passes its viewpoint when it fits
exactly one, or else the viewpoint it was asked about (`viewpoint-scope`) — `viewpointOfAnswer`.

**Performance.** Queries run synchronously on the main thread. The budget (500 ms at 350 000 triples) is held by a
benchmark test over `scripts/bench-model.mjs`; a question that cannot meet it moves to the validation worker (which
has the model, but not yet the metamodel graphs) or is not offered on large models — except `viewpoint-scope`, 0.66 s,
which stays (D12). The model checks show "Checking…" before their queries hold the thread.

## Converters (phase 5)

The ArchiMate converter's viewpoint table maps the `viewpoint` attribute to the catalogue's individuals. meta renamed
them (`amvp:Organization`, `amvp:InformationStructureVP` → `amvp:OrganizationViewpoint`,
`amvp:InformationStructureViewpoint`); the table kept the old names, so every converted view pointed at a viewpoint
nothing defines, and two (Application Structure, Value Stream) were not recognised. The table now holds the 25
names, and `ArchiMateViewpointTest` checks what the converter claims against the published catalogue in both
directions (skipped when it cannot be fetched). Converted models are reconverted (D13).

## Deliverables (phase 6, done)

**la-generate 0.2.0** (Kotlin, RDF4J 6.1, Java 25; `tools/generators/la-generate`):

1. Data: `--data` files (Turtle, TriG, N-Quads, N-Triples), read as one graph — every triple in the default
   graph, once (D16's reading). The template file is read apart, so its triples never reach a section query.
   With `--endpoint`, the endpoint is the data and the files only supply definitions.
2. Parameters: each `arch:templateParameter` binds its `sh:path`'s local name; `--param name=IRI`, which must
   occur in the data. A required one without a value stops the run, except `?model`: the data's only
   `arch:Model`. When nothing is `arch:inModel` the model, questions bound to `?model` are not asked (D24).
3. `arch:sectionAsks`, in list order: `?viewpoint` from the section, the rest from the template, as `VALUES`
   at the outermost WHERE (la-gram, la-query and meta's `QuestionRunner` send the same text); the metamodel
   probed as linked-archi-query probes (D18, D20); `LIMIT` one past `arch:defaultLimit`, so a cut-off answer
   says so. Not asked, with the reason: a required parameter unbound, a set not loaded, a metamodel missing.
4. Context, per section: `viewpoint`, `concerns`, `views` (D21) and `questions`; per question: `label`,
   `description`, `answers`, `doesNotProve`, `isFinding`, `severity`, `status` (`answered`, `none-found`,
   `empty`, `not-asked`), `reason`, raw `columns`/`rows`, and `displayColumns`/`displayRows` — an IRI by its
   label (any language when there is no English or untagged one), a label column folded into its IRI's, a
   relationship without a name by its type. Also under `sectionResultKey`, each question under its
   `arch:resultKey`. A question asked again by a later section is marked `repeated`.
5. Layouts: bundled `questions.hbs` and `questions-html.hbs` (D25); a finding with no rows reads
   "**None found** — <concerns>".
6. `arch:sectionQuery` unchanged: 292 outputs of 55 templates (meta's and the playground's, every fallback
   format and playground layout) byte-identical to 0.1.0's.

**meta:** the ArchiMate 4.0 and 3.2 templates rewritten from the draft — `arch:ModelQuestion` IRIs (`archq:`,
`am4q:`, `amq:`), no `owl:Ontology` (metadata on the first template), no history wording, no
`arch:templateResource` (D25), core purposes (`archvp:`). Four templates each: ADD (8 sections, the roadmap
and the quality appendix included), ARS (3), APD (2), Change Impact Assessment (3; `?focus` required,
`?from`/`?to` optional). 3.2 keeps its published section names and result keys; its sections ask
`archq:viewpoint-scope` (D22) and `amq:elements-by-layer` / `amq:cross-layer-relationships`. Both
manifests list the Change Impact Assessment. Docgen's template page lists what a template is produced for,
and each section's concerns and questions in order, a question linked to its entry on its Question Set page.

**Check:** `GoldenTest` generates the four templates of each version from meta's questions example
(`--param focus=:crm`, the two plateaus for the Change Impact Assessment) and compares the Markdown with
`src/test/resources/golden/`; every question a section asks must be asked. `./gradlew syncMeta` copies the
documents read; `-Pgolden.update=true` rewrites the files.

## linked-archi-query (phase 7, done)

D10: the RDF question sets are the source of truth. The catalogue reads them as entries (`questions.py`):

- **Sources.** The core, ArchiMate 4.0 and 3.2 sets are copied from meta into `assets/questions/`, with an index
  `catalog list` reads without an RDF library; `make questions` refreshes both, and a test fails when they disagree.
  A project's own set joins with `--catalog questions.ttl` (pyoxigraph), under a project namespace.
- **Fields.** Name `dcterms:identifier`; purpose the label (the question); `answers`, `does_not_prove`, stage; one
  IRI parameter per `sh:parameter` named after its core property (`arch:focus` ↔ `FOCUS_IRI`, `arch:conceptType` ↔
  `TYPE_IRI`, …; `sh:optional` may be left unset); `LIMIT` from `arch:defaultLimit`; plus what only RDF has:
  concerns, stakeholders, viewpoints, finding focus and severity. A question is built as la-gram and meta's
  check build it: the set's prefixes, `VALUES` at the outermost `WHERE` group.
- **Implementations** (D19). 55 entries, 9 sharing a name with a template (`Q+T`). `query run` asks the
  question where the dataset fits it and the template elsewhere; the envelope's `implementation`, `question`,
  `default_graph` and `finding` say which answered and how.
- **One graph** (D16). `la-connect` takes `default_graph: "union"` per query and answers local data from a merged copy,
  built once per process; an endpoint refuses it.
- **Requirements** (D17, D18). Read from the query: a published unqualified predicate needs `direct_rel_triples`
  (28 questions), `rdf:reifies` `rdf_reifies`, `arch:inModel` `part_of_model_edge`; a refusal says what lifts it. A
  question declaring `arch:ModelAndMetamodelDataset` runs its ASKs first, in the same call; a failed one refuses
  it, naming the published Turtle, or hands it to its template. A notation question is gated on its one required
  ontology, as a notation template is: ArchiMate 4.0's questions on a profile that speaks only 3.2 are refused.
- **By concern.** `catalog concerns`, `--concern` on `catalog list` and `dump`, and `la-analyse plan --concern`, which
  plans the questions informing a concern in stage order, between orientation and provenance — the selection a
  deliverable section makes — leaving out, with a note, a language the profile does not declare.

**Check.** `tests/test_questions.py` asks every case of meta's two expected files through `render` and `la-connect`,
on the flattened example (as meta checks it) and on the example in converter graphs read as one graph: all agree with
`QuestionRunner`'s expectations. Every question renders read-only with all and
with required parameters. linked-archi-apm: 979 tests, `make check` and the strict docs build pass.

**Default profile** (linked-archi-apm 0.10.0). The fixtures are re-extracted from current converter output, so they
carry the direct triples and their `rdf:reifies` bridges; `linked-archi-default` claims `direct_rel_triples` and a
`partial` `rdf_reifies` (a class publishing no unqualified predicate, BPMN's flows among them, has neither), and
`linked-archi-qualified` describes output without them, refusing what follows them.

## ArchiMate 3.2 and specialisations (phase 8, done)

**The 3.2 set** (`archimate3.2-questions.ttl`, `amq:`, 19 questions). The ArchiMate 4.0 questions with 3.2's terms:
`elements-by-layer` and `cross-layer-relationships` (identifier `notation/archimate/layer-crossing`, the catalogue's
name, read from the layer classes rather than type names) for the domain questions; behaviour and services split per
layer in 3.2, so `unassigned-behaviour` asks for business, application and technology processes and functions,
`unrealised-services` for the three services; `application-dependencies` also follows a component through the
function assigned to it (in both versions). No 3.2 `viewpoint-scope`: 4.0 needed its own for its common domain; the
core question serves 3.2. Concerns, stakeholders and viewpoints are 3.2's (`amvp:`), whose local names are 4.0's but
for Business Process Cooperation. Linked from the 3.2 metamodel (`arch:hasQuestionSet`), registered as the 4.0 set.

**Type sets** (D15). Each type asked about is a sub-select read once:
`{ ?asked rdfs:subClassOf* T } UNION { GRAPH ?g { … } }` then `{ ?type rdfs:subClassOf* ?asked } UNION { GRAPH ?g2 { … } }`
— the first step finds the language's subtypes in its ontology graph, the second a model's specialisations of any of
them in the default graph. The 15 ArchiMate 4.0 questions that matched a type exactly now do the same, and declare
`arch:ModelAndMetamodelDataset` (they read the class hierarchy). Two queries were restructured on the way:
- `plateau-difference`: inside a `UNION` branch the pre-bound `?from` and `?to` are not yet bound (a branch is
  evaluated before the join with `VALUES`); the 4.0 draft bound them in each branch by type, so its "not in the other
  plateau" held. Typing them through a set inside the branch would scan every typed resource, so the comparison moved
  to the outer group, where both are bound.
- `data-never-written`: a read access is an `Access`, so a write is a write, read-write or an access of no stated
  kind *and not* a read — the same answer whether `am:Access` is asserted beside `am:ReadAccess` or not.

**Checks.** `QuestionRunner` runs per ArchiMate version (`validate.sh --questions`): 36 questions on the 4.0 example, 35
on the 3.2 example — four ways each. Each example declares specialisations that must count where their types do: a
strategic capability and a regulatory requirement (4.0), a cloud server (a device, a node), a regulatory constraint (a
constraint, a requirement) and a strategic capability (3.2). la-gram runs the same on Oxigraph (`questions.test.ts`),
and the benchmark on a generated 3.2 model (`bench-model.mjs --language 3.2`): every 3.2 question under 0.3 s at
350 000 triples; the 4.0 set unchanged in shape (`am4q:viewpoint-scope` 0.66–0.74 s, the rest under 0.3 s).

**Converted models.** The ArchiMate converter wrote every access as `am:Access` with the deprecated `am:accessType`
literal, so the access questions saw no reads on a converted model. It now types the kind as la-gram's Exchange import
does — `Read` → `am:ReadAccess`, `Write` or no attribute → `am:WriteAccess`, `ReadWrite` → `am:ReadWriteAccess`,
`Access` → `am:Access` — and writes no literal (`ArchiMateAccessKindTest`). Converted with it, a sample Exchange file
answers the 3.2 questions as expected: the object read and never written, the kinds of access, the element its view's
viewpoint does not admit.

## Tests

- meta: the `questions` SHACL profile; a pyoxigraph runner over a tool-written and a converter-written fixture (each
  finding: its culprit, not its near miss); a timing check on a generated 350 000-triple model.
- la-gram: `questions.test.ts` (the proposal's suite, plus the converter-written fixture), a bench test with the budget,
  workbench tests for the menu, the right-click entry and model checks, a browser test for the Questions menu.
