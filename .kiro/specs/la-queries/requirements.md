# Requirements — Questions: stakeholder questions as executable, concern-bound SPARQL

**Scope:** `linked-archi-meta` (core and ArchiMate 4.0) and `la-gram`. Starting point: [PROPOSAL.md](PROPOSAL.md)
and its drafts, as reviewed (see [design.md](design.md) § Review). Related but not in scope: document generation
(`la-generate`), the `linked-archi-query` catalogue, and the converters.

A *model question* (`arch:ModelQuestion`) is a question the model answers, with the SPARQL that answers it, bound
to the concerns it informs, the stakeholders who ask it and the viewpoints it fits. It is not a concern: a concern is
an interest a stakeholder holds in the system ("Impact of change"), informed by many questions and views; a model
question asks one thing the architecture description answers ("What is affected if this element changes?"). It is defined once, in meta, and used by la-gram (offered beside
the open view, asked about the selection, run as model checks), by deliverable sections, and by analysis agents.

---

### Requirement 1: Question vocabulary in the core

**User Story:** As a metamodel author, I want the terms to describe a question in the core, next to Stakeholder,
Concern, Purpose and Viewpoint, so that every language's questions are described alike.

#### Acceptance Criteria

1. `arch:ModelQuestion` (`rdfs:subClassOf sh:SPARQLExecutable`), named by the question itself — one sentence ending
   in a question mark, where a concern is a noun phrase — carries its query in exactly one of `sh:select`,
   `sh:construct`, `sh:ask`, its prefixes through `sh:prefixes`, its inputs through `sh:parameter`
2. A question is bound to the 42010 terms with `arch:questionAddressesConcern` (range `arch:Consideration`),
   `arch:questionTargetsStakeholder`, `arch:questionHasPurpose`, `arch:questionFitsViewpoint`, and staged with
   `arch:questionStage` from `arch:QuestionStageScheme` (orientation, resolution, discovery, analysis, enrichment,
   quality, views)
3. Its result is described with `arch:answers`, `arch:doesNotProve`, `arch:resultIsFinding`, `arch:findingSeverity`
   (SHACL's scale), `arch:findingFocus` (the result variable naming what each finding is about),
   `arch:requiresDataset` (`arch:ModelDataset` / `arch:ModelAndMetamodelDataset`), `arch:requiresMetamodel`,
   `arch:defaultLimit`, `arch:resultKey`
4. Parameters are core properties used as `sh:path`: `arch:focus`, `arch:model`, `arch:view`, `arch:viewpoint`,
   `arch:conceptType`, `arch:from`, `arch:to`; the variable a parameter binds is the property's local name; they are
   never asserted in model data
5. A question set's root is an `arch:QuestionSet`; a metamodel links its question sets with `arch:hasQuestionSet`
6. Template sections ask questions: `arch:sectionAsks` (an `rdf:List` of `arch:ModelQuestion`), `arch:sectionAddressesConcern`,
   `arch:sectionTargetsStakeholder`, `arch:templateParameter` (`rdfs:subPropertyOf sh:parameter`);
   `arch:sectionQuery` remains the inline form
7. Core shapes check a question: a language-tagged label ending in a question mark, one query, one stage, `arch:resultIsFinding`, parameters
   with one `sh:path` each; a finding gives its severity and focus, a listing neither; a question set gives its
   title, `vann:` prefix and namespace and well-formed `sh:declare` entries. RDF4J (CI) and pyshacl agree
8. The decision is recorded as DD-33 and the terms in the ontology reference; `arch:Concern`'s scope note says how a
   concern differs from a model question

### Requirement 2: Question sets are instance data

**User Story:** As a maintainer of meta, I want question sets published and documented like the other assets, so
that tools and readers find them.

#### Acceptance Criteria

1. A question set file's root is an `arch:QuestionSet` carrying `dcterms:title`, licence,
   `vann:preferredNamespaceUri`, `vann:preferredNamespacePrefix` and the `sh:declare` prefixes; it is never an
   `owl:Ontology`
2. The documentation generator has a *question set* asset type: a page per set listing its questions by stage, with
   concerns, parameters, what a row means and what it does not prove
3. Each set is registered in `docgen-index.yaml`, `.site-root/_redirects`, `llms.txt` and `llms-full.txt`, and passes
   `validate.sh --registration`
4. The ArchiMate 4.0 metamodel links its set with `arch:hasQuestionSet`; the core set applies to every metamodel and is
   not linked

### Requirement 3: How a question is written

**User Story:** As a question author, I want conventions that make a question portable, correct on any model and
fast, so that one text serves every tool.

#### Acceptance Criteria

1. The query text has no `PREFIX` lines (they come from `sh:declare`) and no `LIMIT` (`arch:defaultLimit` is appended
   for browsing)
2. A runner pre-binds a parameter with `VALUES ?name { … }` as the first element of the outermost `WHERE` group, binds
   only declared parameters, and does not run a question whose required parameter is unbound; an unbound optional
   parameter means "any"; parameters are not used inside sub-selects
3. Model data is read from the default graph; the metamodel through `{ P } UNION { GRAPH ?g { P } }`, looked up once per
   query (a sub-select of the types concerned), never once per row
4. A question that reports or groups by type uses the concept's most specific type: its answer is the same whether
   `arch:Element`, `arch:ModelConcept`, `arch:QualifiedRelationship` or a language's abstract classes are asserted,
   inferred or absent
5. A viewpoint admits the types it names and their subclasses; a finding over views whose viewpoint is unknown says so
   rather than passing them
6. Each row is one subject or one link (several neighbours summarised with `GROUP_CONCAT`, IRIs kept); labels in
   English or untagged
7. A finding question's `arch:findingFocus` names a result column holding a concept IRI
8. A type a question asks about counts with its subtypes — the language's own (`am:Constraint` under
   `am:Requirement`) and a model's specialisations — read as a set once per query, in two steps (the types under it
   within each document, then their specialisations in any document); a row reports the type asked about, so a
   supertype asserted or inferred beside a specialisation does not repeat it (D15)

### Requirement 4: The core question set

**User Story:** As a modeller of any language, I want the questions every model can answer — inventory, detail,
neighbours, orphans, views, viewpoint conformance and scope, definitions, duplicate names, relationship integrity,
architecture state.

#### Acceptance Criteria

1. The 15 core questions of the proposal and "Which views follow a viewpoint the loaded metamodels do not define?", written to Requirement 3, in `core/core-questions.ttl` (`archq:`)
2. On a converted model (each concept also typed `arch:Element`, `arch:ModelConcept`) each lists each concept once and
   reports no finding that comes from those types

### Requirement 5: The ArchiMate 4.0 question set

**User Story:** As an ArchiMate 4.0 stakeholder, I want questions bound to the concerns the ArchiMate 4.0 viewpoints
frame — impact of change, application dependencies, data access, realisation and traceability, and the findings that
show where a concern is not met.

#### Acceptance Criteria

1. The 20 ArchiMate 4.0 questions of the proposal, written to Requirement 3, in `archimate4-questions.ttl` (`am4q:`), linked from the ArchiMate 4.0 metamodel
2. `viewpoint-scope` answers without a per-row anchor search (it grew with the square of the model: 24 s at 70 000
   triples); `applications-without-technology`, `unrealised-requirements` and `application-dependencies` look up
   their type sets once
3. Every type a question asks about counts with its specialisations (Requirement 3.8)

### Requirement 6: Verification in meta

**User Story:** As a maintainer, I want CI to catch a question that is malformed, wrong or slow.

#### Acceptance Criteria

1. A `questions` SHACL profile validates every question set against the core shapes
2. A runner (RDF4J, meta's own toolchain — a second engine beside la-gram's Oxigraph) asks every question of an
   example model — each ArchiMate version's, with the core questions — with all its parameters and with its required ones, in named graphs and merged, as written and with
   the inferable core and abstract types added: the four answers agree, and each finding question catches exactly its
   culprits and none of its near misses
3. The speed budget is checked where it matters, in la-gram (Requirement 12)

### Requirement 7: la-gram loads the questions

**User Story:** As a la-gram user, I want the questions of the loaded languages available without configuration.

#### Acceptance Criteria

1. A metamodel's question sets are loaded through `arch:hasQuestionSet`, into named graphs like its other documents,
   bundled or fetched; the core set is a core asset
2. Questions are never written into the model and never validated as model data
3. A question is offered only while the ontologies it requires are loaded, and — when the open model declares the
   languages it is in (`arch:modelConformsToMetamodel`) — only for those (D14)

### Requirement 8: Questions in the SPARQL tab

**User Story:** As a modeller, I want to pick a question instead of writing SPARQL, and still see and edit the SPARQL.

#### Acceptance Criteria

1. A Questions menu lists the offered questions by stage, those fitting the open view's viewpoint first, filterable by
   concern
2. Parameters are bound from the workbench: `?focus` the selection, `?model` the open model, `?view` the open view,
   `?viewpoint` its viewpoint, `?conceptType` a type picked, `?from`/`?to` two elements picked; a question whose
   required parameter is unbound is shown disabled with what to select
3. Picking a question puts the runnable query — prefixes, `VALUES`, `LIMIT` — in the editor and runs it; what a row means
   and what it does not prove are shown with the result

### Requirement 9: Ask about this element

**User Story:** As a modeller, I want to ask about the element I am looking at from its right-click menu.

#### Acceptance Criteria

1. The element's right-click menu offers "Ask about this element…" with the offered questions that take `?focus`
2. Picking one runs it in the SPARQL tab, bound to the element

### Requirement 10: Model checks

**User Story:** As a modeller, I want the findings the questions state — orphans, unrealised services, unrealised
requirements — beside the SHACL results, so I see where a concern is not met.

#### Acceptance Criteria

1. The Validation tab runs the offered finding questions on request ("Model checks") and lists their rows as results:
   severity from `arch:findingSeverity`, the concept from `arch:findingFocus`, the question as the message, the question's
   IRI as the source
2. The tab's View / Model scope, the violation count and the canvas markers apply to them as to SHACL results
3. A check that cannot run (a required parameter unbound, an error) is reported, not dropped

### Requirement 11: From answers to views

**User Story:** As a modeller, I want a question's answer as a view.

#### Acceptance Criteria

1. "New view" from a question's result conforms to the question's viewpoint when it fits exactly one

### Requirement 12: Performance

**User Story:** As a modeller with a large model, I want questions not to freeze the workbench.

#### Acceptance Criteria

1. Every question answers within 500 ms on la-gram's Oxigraph for a generated ArchiMate 4.0 model of 350 000 triples;
   one that cannot is run off the main thread or not offered on models of that size — or, a listing asked only when
   picked, recorded as a decision with its measurement and held to its own limit (design D12: `viewpoint-scope`)
2. Model checks run on request, not after every edit

### Requirement 16: The ArchiMate 3.2 question set

**User Story:** As a modeller with an ArchiMate 3.2 model — as the converters and the Exchange import write — I want
the ArchiMate questions too, not only the core ones.

#### Acceptance Criteria

1. The ArchiMate 4.0 questions that hold in 3.2, 19, written to Requirement 3, in `archimate3.2-questions.ttl`
   (`amq:`), linked from the ArchiMate 3.2 metamodel: layers where 4.0 has domains; what belongs in a view of a
   viewpoint is the core question, each 3.2 type having a layer; concerns, stakeholders and viewpoints 3.2's own
2. Checked as the ArchiMate 4.0 set is (Requirement 6), on a 3.2 example model with the core questions
3. la-gram bundles it and offers it for 3.2 models (D14); every question within the benchmark's limits at 350 000
   triples of a generated 3.2 model

### Requirement 14: Converted views follow defined viewpoints

**User Story:** As a modeller, I want a converted view to name a viewpoint the catalogue defines, so its conformance
can be judged and its scope asked.

#### Acceptance Criteria

1. The ArchiMate converter maps each ArchiMate 3.2 viewpoint name to the individual the published catalogue defines,
   all 25; a name it does not know is reported and dropped, never guessed
2. A test checks what the converter claims against the published catalogue
3. Models converted before are reconverted; consumers do not rewrite their viewpoint IRIs (D13)

### Requirement 15: The query catalogue reads the question sets

**User Story:** As an AI-assisted analyst, I want `linked-archi-query` to ask the same questions la-gram and the
deliverables ask, chosen by concern.

#### Acceptance Criteria

1. `la-query` reads a question set as catalogue entries, with their concerns, stakeholders, viewpoints and findings
2. The RDF question is the source of truth (D10); a role-based template for another dataset layout keeps its
   `dcterms:identifier`
3. `linked-archi-analyse` selects questions by concern
4. Entries read from RDF answer meta's example model as `QuestionRunner` does

### Requirement 13 (later): Deliverable sections ask questions

**User Story:** As an architect, I want a deliverable whose sections answer their concerns and state their findings.

#### Acceptance Criteria

1. Template sections ask questions with `arch:sectionAsks`; a generator binds `?model`, `?viewpoint` and the template
   parameters, reports a question it could not ask, and states an empty finding as "none found"
2. The ArchiMate 4.0 templates are reworked once `la-generate` supports this, keeping the published layout (metadata on
   the first template, no `owl:Ontology`)
3. A section embeds the model's views that follow its viewpoint
4. Templates with `arch:sectionQuery` keep working
5. Generated from meta's example model, every template's output matches its golden file
