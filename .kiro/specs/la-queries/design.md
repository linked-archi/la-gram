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
| D10 | Source of truth between the RDF questions and the `linked-archi-query` catalogue: decided when that work starts | Not needed for meta and la-gram |
| D11 | The class is `arch:ModelQuestion`, not `arch:Question`; its label is the question, ending in a question mark (checked); `arch:Concern`'s scope note says how the two differ; `arch:QuestionSet` is defined as a unit of publication | A concern is an interest held in the system, a model question asks one thing the description answers. Concerns are often worded as questions, so "Question" beside "Concern" invited the reading "a stakeholder's question is a concern". `arch:CompetencyQuestion` (opaque to architects) and `arch:ModelQuery` (loses the stakeholder framing) were the alternatives |

**To confirm:** the question set files and namespaces —
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

**Bindings.** `mount-ui` supplies them from the workbench: selection → `focus`, open model → `model`, open view →
`view`, its `arch:viewConformsToViewpoint` → `viewpoint`, palette pick → `conceptType`, two picked elements →
`from`/`to`.

**SPARQL tab.** A Questions menu (stage groups, fitting-viewpoint first, concern filter, disabled entries saying what to
select) fills the editor with `buildQuery(…)` and runs it; the result header shows `arch:answers` and
`arch:doesNotProve`.

**Right-click menu.** "Ask about this element…" opens the questions taking `?focus`, run in the SPARQL tab.

**Model checks.** The Validation tab gets a "Model checks" action: it runs the offered finding questions and adds a
result per row — `focusNode` from the `arch:findingFocus` column, `severity` from `arch:findingSeverity`, `message`
the question's label, `sourceShape` the question's IRI — so the View / Model scope, the badge and the canvas markers
apply unchanged. Checks run on request (Requirement 12.2); the results stay until the next run or a model change.

**Views.** "New view" from a question's result passes the question's viewpoint when it fits exactly one.

**Performance.** Queries run synchronously on the main thread today. The budget (500 ms at 350 000 triples) is held by
a benchmark test over `scripts/bench-model.mjs`; a question that cannot meet it moves to the validation worker (which
has the model, but not yet the metamodel graphs) or is not offered on large models.

## Tests

- meta: the `questions` SHACL profile; a pyoxigraph runner over a tool-written and a converter-written fixture (each
  finding: its culprit, not its near miss); a timing check on a generated 350 000-triple model.
- la-gram: `questions.test.ts` (the proposal's suite, plus the converter-written fixture), a bench test with the budget,
  workbench tests for the menu, the right-click entry and model checks, a browser test for the Questions menu.
