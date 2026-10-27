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

## Deliverables (phase 6)

**la-generate** (Kotlin, RDF4J; reads `arch:DeliverableTemplate`, runs `arch:sectionQuery`, renders Handlebars):

1. RDF4J 6.1 (and Java 25, as meta): `relationship-integrity` uses RDF 1.2 triple terms, which 5.1 cannot parse.
2. Load the question sets with the templates: the core set always, a language's through its manifest's
   `arch:hasQuestionSet`, into named graphs as la-gram does.
3. `arch:sectionAsks` (an `rdf:List`): ask each question in order, pre-binding with `VALUES` exactly as meta's
   `QuestionRunner` and la-gram do — `?model` the deliverable's model, `?viewpoint` the section's
   `arch:sectionViewpoint`, the `arch:templateParameter` values. One whose required parameter stays unbound is
   reported as not asked, never run unbound.
4. Context: `sections.<sectionResultKey>.<question resultKey> = { label, answers, doesNotProve, isFinding, severity,
   rows }`; a finding with no rows renders as "none found" with the concern it meets, never as an empty table.
5. Embed the model's views that follow the section's viewpoint (`?view arch:viewConformsToViewpoint ?viewpoint ;
   arch:inModel ?model`) — what `arch:templateRequiresViewpoint` was meant for.
6. `arch:sectionQuery` keeps working, so the ArchiMate 3.2, core and framework templates are unchanged.

**meta:** the ArchiMate 4.0 templates rewritten from `archimate4-deliverable-templates.proposed.ttl` — the names
`arch:ModelQuestion` and `am4q:`, no `owl:Ontology` (metadata on the first template), no history wording — with
sections for ARS and APD, a "Quality of this description" appendix of the quality findings, and an ArchiMate 4.0
Change Impact Assessment taking `?focus` (optional plateaus `?from`, `?to`). Docgen's template page links each
section's questions to their Question Set page.

**Check:** generate each template from meta's questions example model; the output compared with a golden file, and
every question a section asks either answered or reported as not asked.

## linked-archi-query (phase 7)

D10: the RDF question sets are the source of truth. `la-query --catalog` reads a TTL question set as catalogue
entries: name `dcterms:identifier`, purpose `dcterms:description` and the question, `answers` / `does_not_prove`,
`stage`, parameters from `sh:parameter` (`?focus` ↔ `FOCUS_IRI`, …), `requires` from `arch:requiresDataset` — plus
what only RDF has: concerns, stakeholders, viewpoints, findings and their severity. The core set and the ArchiMate sets
(4.0, 3.2) are read from the published sets; the role-based `.rq` templates remain for other dataset profiles, under the same
identifiers. The new identifiers (`core/unpresented`, `core/viewpoint-conformance`, `core/viewpoint-scope`,
`core/views-with-unknown-viewpoint`, the 20 `notation/archimate4/*`, the 3.2 set's `notation/archimate/*`) come with
them; `notation/archimate/layer-crossing` is the 3.2 set's question, and `notation/archimate4/cross-domain-relationships`
its ArchiMate 4.0 counterpart; `linked-archi-analyse` selects questions
by concern (`arch:questionAddressesConcern`), the selection a deliverable section makes. A check runs every
catalogue entry read from RDF on meta's example model and compares the answers with `QuestionRunner`'s.

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
