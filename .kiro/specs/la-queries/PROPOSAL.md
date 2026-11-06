# Example queries for la-gram: questions, concern-driven deliverables, and alignment with the query catalogue

**Status:** draft for discussion · **Scope:** `linked-archi-meta` (core + ArchiMate 4.0), `tools/modellers/la-gram`, `tools/ai-enablement/linked-archi-apm/skills/linked-archi-query`

## 1. The idea in one paragraph

Don't ship "example queries". Ship **questions**: a stakeholder question, the SPARQL that answers it, the concerns it addresses, the viewpoints it fits, what a row means and what it does *not* prove. Each question is defined once, as RDF in `meta.linked.archi`, and is used three ways:

- **la-gram** offers it in the SPARQL panel and on the element context menu.
- **Deliverable sections** ask it for the concerns they answer.
- **linked-archi-query** (and the AI skills on top of it) routes to it by concern.

The core already has every 42010 term needed (`arch:Concern`, `arch:Stakeholder`, `arch:viewpointFramesConcern`, `arch:targetsStakeholder`), and the ArchiMate 4.0 viewpoints already frame concerns (`am4vp:ImpactOfChange`, `am4vp:Completeness` …). What's missing is the link from a concern to a query.

## 2. What's in this drop

| File | Goes to | What it is |
|---|---|---|
| `core-question-terms.ttl` | merge into `linked-archi-meta/core/core-onto.ttl` | `arch:Question` and its properties, the shared stage scheme, and section additions (`arch:sectionAsks`, `arch:sectionAddressesConcern`, `arch:templateParameter`) |
| `core-queries.ttl` | `linked-archi-meta/core/` → `https://meta.linked.archi/core-queries#` (`archq:`) | 15 questions that work for any notation |
| `archimate4-queries.ttl` | `modelingLanguages/archimate/4.0/` → `https://meta.linked.archi/archimate4/queries#` (`am4q:`) | 20 ArchiMate 4.0 questions bound to the viewpoint concerns |
| `archimate4-deliverable-templates.proposed.ttl` (removed: meta's `archimate4-deliverable-templates.ttl` replaced it) | replaces `archimate4-deliverable-templates.ttl` | Reworked templates where sections answer concerns |
| `la-gram/src/model-manager/example-queries.ts` | la-gram | Reads questions from the store; pre-binds parameters; builds the runnable query |
| `la-gram/src/model-manager/__tests__/example-queries.test.ts` | la-gram | Runs all 35 questions on la-gram's Oxigraph against the bundled ArchiMate 4 metamodel and a fixture model, and checks each finding question catches its culprit |

**Verification status.** I checked statically:

- Every `am4:` and `arch:` term used exists in the ontologies.
- Every concern, stakeholder and viewpoint referenced exists in `archimate4-viewpoints.ttl` / `core-viewpoints.ttl`.
- Every question a section asks exists, and every required parameter can be bound.
- Prefixes are declared, braces are balanced, and there are no stray LIMIT or PREFIX lines.

I could **not** execute Oxigraph from my side (the sandbox blocks WebAssembly). The vitest suite is the real check: copy the files in (§8) and run it.

## 3. The question model

```turtle
am4q:impact-of-change
    a                               arch:Question, sh:SPARQLSelectExecutable ;
    dcterms:identifier              "notation/archimate4/impact-of-change" ;   # catalogue name
    skos:prefLabel                  "What is affected if this element changes?"@en ;
    arch:answers                    "One row per element that transitively depends on the focus."@en ;
    arch:doesNotProve               "That each is broken by the change. …"@en ;
    arch:questionStage              arch:AnalysisStage ;
    arch:questionAddressesConcern   am4vp:ImpactOfChange, am4vp:Dependencies ;
    arch:questionFitsViewpoint      am4vp:LayeredViewpoint, … ;
    arch:resultIsFinding            false ;
    arch:requiresDataset            arch:ModelDataset ;
    arch:requiresMetamodel          <https://meta.linked.archi/archimate4/onto#> ;
    arch:defaultLimit               500 ;
    sh:parameter [ sh:path archq:focus ; sh:optional false ; … ] ;
    sh:prefixes                     <https://meta.linked.archi/archimate4/queries#> ;
    sh:select """ SELECT DISTINCT ?impacted ?label ?type WHERE { ?focus (am4:serves|…)+ ?impacted … } """ .
```

**Why SHACL-AF for the executable part.** `sh:select`/`sh:construct`/`sh:ask`, `sh:prefixes`/`sh:declare` and `sh:parameter` are standard and already in the stack la-gram validates with. Prefixes become data rather than text, which is the same rule the catalogue enforces with `{{PREFIXES}}`.

**Conventions** (written down in `arch:Question`'s scope note):

1. **Parameters are ordinary variables**, named after the `sh:path` local name (`archq:focus` → `?focus`). A runner pre-binds them by inserting `VALUES ?focus { <iri> }` as the first element of the outermost WHERE group. That is where the catalogue templates already put `VALUES ?focus { {{FOCUS_IRI}} }`.
   - An optional parameter left unbound means "any".
   - Every stored query is valid SPARQL that runs as-is in any tool.
   - Only *declared* parameters are bound, because result columns such as `?type` and `?view` share names with parameters.
   - Parameters never appear inside sub-SELECTs.
2. **No LIMIT in the text.** `arch:defaultLimit` is appended for browsing. A document generator reads everything.
3. **Model data in the default graph. The metamodel can be in either.** Questions read the metamodel through `{ P } UNION { GRAPH ?g { P } }`. This works today in la-gram (one named graph per document) and on a merged Turtle file or a union-default-graph triplestore. Property paths inside it must stay within one document. The ArchiMate 4 domain superclasses (`am4:ApplicationDomainElement` …) all sit in `archimate4-onto`, so `?type rdfs:subClassOf* am4:TechnologyDomainElement` is fine.
4. **Labels tolerate missing language tags:** `FILTER(lang(?l) = "" || langMatches(lang(?l), "en"))`.
5. **One row per subject or per link.** Several neighbours are either summarised with `GROUP_CONCAT` (with the element IRI kept) or returned as an edge list. Never two independent OPTIONALs.
6. **Findings.** `arch:resultIsFinding true` means each row is a problem against the concern, so *empty = satisfied*. `arch:findingSeverity` uses SHACL's scale, so findings and validation results read the same way.

## 4. Starter set (35 questions)

`?x?` = optional parameter. Concerns are `archvp:` for core questions and `am4vp:` for ArchiMate 4 questions.

| Question | Asks | Stage | Kind | Params | Concerns | Fits viewpoint | linked-archi-query name |
|---|---|---|---|---|---|---|---|
| `archq:model-inventory` | What does the model contain? | orientation | listing | ?model? | — | any | `core/inventory` |
| `archq:elements-of-type` | Which elements are of this type? | resolution | listing | ?type?, ?model? | — | any | `core/elements-by-type` |
| `archq:element-detail` | What is recorded about this element? | resolution | listing | ?focus | — | any | `core/element-detail` |
| `archq:neighbours` | What is this element directly related to? | analysis | listing | ?focus | DependencyConcern | any | `core/neighbours` |
| `archq:reaches-in-two-hops` | What reaches this element within two hops? | analysis | listing | ?focus | DependencyConcern | any | `core/dependents` |
| `archq:orphans` | Which elements take part in no relationship? | quality | finding (Info) | ?model? | QualityConcern | any | `core/orphans` |
| `archq:not-in-any-view` | Which elements appear in no view? | quality | finding (Info) | ?model? | QualityConcern | any | `core/unpresented` |
| `archq:views-showing` | Which views show this element? | views | listing | ?focus | — | any | `core/view-usage-semantic` |
| `archq:view-contents` | What does this view present? | views | listing | ?view | — | any | `core/view-contents-semantic` |
| `archq:viewpoint-conformance` | Which elements does their view's viewpoint not admit? | views | finding (Warning) | ?view? | QualityConcern, GovernanceConcern | any | `core/viewpoint-conformance` |
| `archq:viewpoint-scope` | What in the model belongs in a view of this viewpoint? | views | listing | ?viewpoint, ?model? | — | any | `core/viewpoint-scope` |
| `archq:missing-definitions` | Which elements have no definition? | quality | finding (Info) | ?type?, ?model? | QualityConcern | any | `core/coverage-gaps` |
| `archq:duplicate-labels` | Which elements share a name with another of the same type? | quality | finding (Warning) | ?model? | QualityConcern | any | `core/label-collisions` |
| `archq:relationship-integrity` | Which relationships are out of step with their unqualified triple? | quality | finding (Violation) | — | QualityConcern | any | `core/reifies-audit` |
| `archq:architecture-state` | What is baseline, target or still awaiting approval? | enrichment | listing | ?model? | EvolutionConcern, GovernanceConcern | any | `core/lifecycle` |
| `am4q:viewpoint-scope` | What in the model belongs in a view of this viewpoint? (ArchiMate 4) | views | listing | ?viewpoint, ?model? | — | any | `notation/archimate4/viewpoint-scope` |
| `am4q:elements-by-domain` | How is the model spread over the ArchiMate domains? | orientation | listing | ?model? | ReductionOfComplexity, Completeness | Layered | `notation/archimate4/elements-by-domain` |
| `am4q:cross-domain-relationships` | Which relationships cross domains, and of which kind? | analysis | listing | — | Consistency, ImpactOfChange | Layered | `notation/archimate/layer-crossing` |
| `am4q:responsibility-assignments` | Who is responsible for what? | analysis | listing | — | CompetenciesAuthorityResponsibilities, Responsibilities | Organization, ProcessCooperation | `notation/archimate4/responsibility-assignments` |
| `am4q:unassigned-behaviour` | Which processes and functions has nobody been assigned to? | quality | finding (Warning) | ?model? | Responsibilities, Completeness | ProcessCooperation, Organization | `notation/archimate4/unassigned-behaviour` |
| `am4q:unrealised-services` | Which services does nothing realise? | quality | finding (Warning) | ?model? | Completeness, AddedValueOfProcesses | ServiceRealization, ProcessCooperation | `notation/archimate4/unrealised-services` |
| `am4q:applications-without-technology` | Which application components run on no technology? | quality | finding (Warning) | ?model? | ApplicationPlatforms, InfrastructureQuality | ImplementationAndDeployment, TechnologyUsage | `notation/archimate4/applications-without-technology` |
| `am4q:application-dependencies` | Which applications depend on which? | analysis | listing | — | ApplicationDependencies, ServiceOrchestration | ApplicationCooperation, ApplicationUsage | `notation/archimate4/application-dependencies` |
| `am4q:data-access` | Who reads and writes which information? | analysis | listing | — | InformationStructure, Consistency | InformationStructure, ApplicationCooperation | `notation/archimate4/data-access` |
| `am4q:data-never-written` | Which information is read but never written? | quality | finding (Warning) | — | InformationStructure, Completeness | InformationStructure | `notation/archimate4/data-never-written` |
| `am4q:impact-of-change` | What is affected if this element changes? | analysis | listing | ?focus | ImpactOfChange, Dependencies | Layered, TechnologyUsage, ApplicationCooperation | `notation/archimate4/impact-of-change` |
| `am4q:capability-realisation` | What realises each capability? | analysis | listing | — | StrategyDevelopment, ArchitectureStrategy | CapabilityMap, Strategy | `notation/archimate4/capability-realisation` |
| `am4q:unrealised-capabilities` | Which capabilities does nothing realise? | quality | finding (Info) | ?model? | StrategyDevelopment, Completeness | CapabilityMap | `notation/archimate4/unrealised-capabilities` |
| `am4q:stakeholder-motivation` | What do stakeholders care about? | analysis | listing | — | ArchitectureMission, Motivation | Stakeholder | `notation/archimate4/stakeholder-motivation` |
| `am4q:requirement-traceability` | How does each requirement trace to goals and to the elements that realise it? | analysis | listing | — | ArchitectureTactics, Motivation | RequirementsRealization, GoalRealization | `notation/archimate4/requirement-traceability` |
| `am4q:unrealised-requirements` | Which requirements does no architecture element realise? | quality | finding (Warning) | ?model? | ArchitectureTactics, Motivation | RequirementsRealization | `notation/archimate4/unrealised-requirements` |
| `am4q:principle-rationale` | What motivates each principle, and what does it constrain? | analysis | listing | — | ArchitecturePolicies, Motivation | Motivation | `notation/archimate4/principle-rationale` |
| `am4q:principles-without-requirements` | Which principles has no requirement made concrete? | quality | finding (Info) | ?model? | ArchitecturePolicies | Motivation | `notation/archimate4/principles-without-requirements` |
| `am4q:work-package-deliverables` | What does each work package deliver, and what does that realise? | analysis | listing | — | ArchitectureVision, ArchitecturePolicies | Project, ImplementationAndMigration | `notation/archimate4/work-package-deliverables` |
| `am4q:plateau-difference` | What changes between these two plateaus? | analysis | listing | ?from, ?to | ModelHistory, ArchitectureVision | Migration | `notation/archimate4/plateau-difference` |

Three catalogue names are **new** and should be added to `linked-archi-query`: `core/unpresented`, `core/viewpoint-conformance` and `core/viewpoint-scope`. The others correspond to existing templates. `notation/archimate4/cross-domain-relationships` supersedes `notation/archimate/layer-crossing` for ArchiMate 4.

**Coverage.** Every ArchiMate 4 viewpoint used by the deliverable templates has at least one question that addresses one of its framed concerns. Nine of the catalogue's concerns have no question yet:

- **Next candidates, answerable from the metamodel:**
  - ApplicationStructure and ProcessDependencies. The section scope covers them today, but they deserve dedicated questions such as composition depth or flow/trigger chains between processes.
  - BusinessResults (outcome realisation).
  - Flexibility (specialisation and substitutability).
- **Need data the standard metamodel doesn't hold** (quantities, measures, `arch:QualityMeasure`), so they're better as profile-specific packs: Performance, Scalability, PhysicalEnvironment, ProductDevelopment and ProductValue.

**Two scope questions.** `archq:viewpoint-scope` is vocabulary-neutral. `am4q:viewpoint-scope` refines it for ArchiMate 4's common domain. The Technology Viewpoint admits Process, Function and Service, and ArchiMate 4 gives those no domain. Listed unconditionally, they would put every business process into the technology section. The ArchiMate 4 variant keeps a common-domain element only when it is related to a domain-specific element the same viewpoint admits. ArchiMate 4 deliverables use that one.

## 5. Deliverable templates: from filling sections to answering concerns

### 5.1 What's wrong with the published `archimate4-deliverable-templates.ttl`

| # | Issue | Effect |
|---|---|---|
| 1 | The document's title, licence, `vann:` prefix and description sit on `:ArchitectureDefinitionDocument`; there is no `owl:Ontology` and no `owl:imports` | The ADD individual carries the whole file's `dcterms:title` and description; loaders can't resolve dependencies |
| 2 | Sections list elements of a hand-copied `VALUES ?type {…}` | Drifts from the viewpoint it claims to follow. ADD-S4 lists Equipment, Facility, Material and Distribution Network, which the Technology Viewpoint doesn't admit; ADD-S6 lists Work Packages, Deliverables, Plateaus, Nodes and Devices, which the Implementation and Deployment Viewpoint doesn't admit; ADD-S2 leaves out the actors, roles and application components its viewpoint admits |
| 3 | Related elements come back as labels (`?serves`, `?assignedTo`) | Not linkable, and "Render as new view" gets only the subject |
| 4 | Two independent OPTIONALs in S2, S3 and S6 | Rows multiply: 3 flows × 2 serves = 6 rows per element |
| 5 | `FILTER(lang(?label) = "en")` | Untagged labels from imports disappear without notice |
| 6 | A section only *lists*; nothing in it *judges* | The document can't state "every application runs on known technology" or flag that it doesn't |
| 7 | ARS and APD have no sections at all | Two of three templates generate nothing |
| 8 | `arch:templateRequiresViewpoint` is declared, but no section uses the views | A document generated from a model with carefully drawn views doesn't contain them |
| 9 | Purposes are `am4vp:Designing …`, duplicating `archvp:Designing …` | Filtering by purpose across notations splits in two (add `skos:exactMatch`, or reuse `archvp:`) |
| 10 | No deliverable-level parameters | A Change Impact Assessment can't be produced *for* an element |

### 5.2 The reworked section

```turtle
:ADD-S4 a arch:TemplateSection ; arch:sectionOrder 4 ;
    skos:prefLabel "4. Technology Domain"@en ;
    skos:definition "What infrastructure is there, and does every application run on some of it?"@en ;   # the section's question
    arch:sectionViewpoint am4vp:TechnologyViewpoint ;                                                    # scope + views to embed
    arch:sectionAddressesConcern am4vp:InfrastructureQuality, am4vp:ApplicationPlatforms ;
    arch:sectionAsks ( am4q:viewpoint-scope am4q:applications-without-technology ) ;
    arch:sectionResultKey "technologyDomain" .
```

Every section now has:

- **a headline question** (`skos:definition`);
- **the concerns it answers**, which default to those its viewpoint frames;
- **a scope taken from the viewpoint** (`am4q:viewpoint-scope`, pre-bound with the section viewpoint) instead of a copied type list;
- **one or more findings** that say whether the concern is met.

Generator changes this implies (`la-generate`, Steps 3–5):

1. For each section, run the questions in `arch:sectionAsks` in order. Bind the declared parameters from:
   - `?model` → the deliverable's model;
   - `?viewpoint` → the section's viewpoint;
   - any `arch:templateParameter`.

   Skip a question whose required parameter is unbound, and say so in the output.
2. Context shape: `sections.<sectionResultKey>.<question resultKey> = { label, answers, doesNotProve, isFinding, severity, rows }`. Handlebars renders an empty finding as "✓ none found" with the concern's name, never as an empty table.
3. Embed the views that conform to `arch:sectionViewpoint` (`?view arch:viewConformsToViewpoint ?vp ; arch:inModel ?model`) as images. That is what `templateRequiresViewpoint` was always meant to do.
4. Keep `arch:sectionQuery` as an inline shorthand, so existing templates (3.2, core, frameworks) keep working.
5. Optional, for richer layouts: allow `sh:construct` questions and frame the result as JSON-LD. That gives nested objects (an element with arrays of its relations) without any join logic in templates.

The proposed file also adds:

- sections for ARS (stakeholders → goals → requirement traceability and gaps) and APD (principle rationale and gaps → capability realisation and gaps);
- a section 7 split out of ADD-S6 (roadmap);
- an appendix "Quality of this description" made of the quality findings;
- a parameterised **ArchiMate 4 Change Impact Assessment** (`?focus`, optional `?from`/`?to` plateaus). The core CIA template only has sections without queries.

## 6. la-gram integration

1. **Bundle the assets.**
   - Add `core-queries.ttl` and `archimate4-queries.ttl` to `assets/` and to `assets/catalog.ttl`, with a new `BundledAssetRole` `'queries'`.
   - `sync-assets` picks them up from meta.
   - They load into named graphs like every other document, so nothing changes in the store or serializer. They are never written into the model.
2. **Examples menu in the SPARQL panel** (`listQuestions` + `offeredQuestions`):
   - Group the menu by stage.
   - Hide questions whose `arch:requiresMetamodel` is not loaded.
   - When a view is open, put questions that fit its viewpoint first ("Questions for this view").
   - Show concern chips with a filter by concern.
   - Show `doesNotProve` as a hint under the result count. That is where the caveat helps most.
   - Selecting a question inserts `buildQuery(q, bindings)` into the editor. The user sees and can edit real SPARQL with prefixes, VALUES and LIMIT.
3. **Bindings from the UI:**
   - `?focus` = selection;
   - `?view` = active view;
   - `?viewpoint` = active view's `arch:viewConformsToViewpoint`;
   - `?model` = open model;
   - `?type` = palette type picker;
   - `?from`/`?to` = a two-plateau picker.

   A question with an unbound required parameter is disabled, with "select an element" as the reason.
4. **Context menu → "Ask about this element".** Offer the questions with a required `?focus` (neighbours, impact of change, views showing, element detail).
5. **Results back on the canvas.** Questions return element and relationship IRIs, so the existing "Render as new view" works on every one of them. When the question fits exactly one viewpoint, the new view should conform to it.
6. **Model checks.** Run all `resultIsFinding` questions as a "Model health" pass next to SHACL in the validation panel, with the same severities. A finding is a model-level question SHACL can't express well (a closure over the metamodel, absence across the whole model).
7. **A small engine change worth making:** forward `use_default_graph_as_union` through `RdfStore.query(sparql, options)`. `graph-scope.ts` already notes this would be the clean mechanism. Questions stay portable with the UNION idiom either way. It mainly lets users write metamodel-aware queries by hand.

## 7. Alignment with the linked-archi-query catalogue (APM)

**Principle.** The RDF question is the source of truth for **what is asked and why**: question, concern, stakeholder, viewpoint, caveats, parameters. The catalogue's role-based `.rq` template is the source of truth for **how it is asked across heterogeneous datasets**: profiles, graph roles, `per-model-triple` scoping. `dcterms:identifier` = catalogue name links the two.

### 7.1 Field mapping

| `catalog.json` | RDF |
|---|---|
| name (`core/orphans`) | `dcterms:identifier` |
| `purpose` | `dcterms:description` (+ the question itself in `skos:prefLabel`) |
| `answers` / `does_not_prove` | `arch:answers` / `arch:doesNotProve` |
| `stage` | `arch:questionStage` (same seven values, `skos:notation`) |
| `parameters.X.type` `iri` / `integer` / `string`+`choices` | `sh:nodeKind sh:IRI` or `sh:class` / `sh:datatype xsd:integer` / `sh:in (…)` |
| `parameters.X.default`, `min`, `max` | `sh:defaultValue`, `sh:minInclusive`, `sh:maxInclusive` |
| `LIMIT` parameter | `arch:defaultLimit` (the text carries none) |
| `requires.roles` | `arch:requiresRole` |
| `requires.graph_roles` | `arch:requiresDataset` |
| `alternatives` | `rdfs:seeAlso` |
| header design notes | `skos:scopeNote` / `skos:editorialNote` |
| *(none)* | `arch:questionAddressesConcern`, `arch:questionTargetsStakeholder`, `arch:questionFitsViewpoint`, `arch:resultIsFinding`, `arch:findingSeverity` (**add to the catalogue**) |

Parameter names converge on the variable: `FOCUS_IRI`↔`?focus`, `VIEW_IRI`↔`?view`, `MODEL_IRI`↔`?model`, `TYPE_IRI`↔`?type`, `VIEWPOINT_IRI`↔`?viewpoint`, `VIEW_A_IRI`/`VIEW_B_IRI`↔`?from`/`?to`.

### 7.2 Mechanics

1. **Core questions (role-based):**
   - Add a `la-gram` / `linked-archi-default` profile: `semantic` and `views` graph roles = `default`, roles bound to `arch:` terms. The renderer already supports `is_default_graph`.
   - Add `la-query catalog export --format ttl --profile linked-archi-default`. It renders each core template, strips PREFIX and LIMIT, and emits `core-queries.ttl` with the metadata from `catalog.json`.
   - The hand-written `core-queries.ttl` in this drop is the golden file that export should reproduce. A CI test diffs them, so the two can't drift silently.
2. **Notation questions (ArchiMate 4):**
   - Author them in meta as RDF. They are vocabulary-specific by nature, and the catalogue's `notation/` templates already hardcode terms.
   - Have `la-query --catalog` accept a TTL question file as a project catalogue. Each question becomes a template with no role placeholders and `requires.capabilities` derived from `arch:requiresDataset`.
3. **Fix in the catalogue:** `notation/archimate/layer-crossing` decides the layer with `STRSTARTS(?name, "Business")` and similar tests. ArchiMate 4 types (`am4:Process`, `am4:Service`, `am4:Role`) carry no layer in their names, so they fall through to the raw type name. For ArchiMate 4, route to `notation/archimate4/cross-domain-relationships`, which uses the domain superclasses. For 3.2, use the layer superclasses if `archimate3.2-onto` has them.
4. **Routing by concern:** `linked-archi-analyse` can plan "what's the impact of changing X?" by selecting questions where `arch:questionAddressesConcern am4vp:ImpactOfChange`. That replaces keyword matching on purposes, and it is the same selection a deliverable section makes.

## 8. Trying it

```bash
cd tools/modellers/la-gram
cp …/core-queries.ttl            assets/core/
cp …/archimate4-queries.ttl      assets/archimate4/
cp …/example-queries.ts          src/model-manager/
cp …/example-queries.test.ts     src/model-manager/__tests__/
npx vitest run src/model-manager/__tests__/example-queries.test.ts
```

If something fails, the likeliest causes are, in order:

1. The SPARQL 1.2 triple-term pattern `<<( ?s ?p ?o )>>` in `archq:relationship-integrity` (it needs Oxigraph's RDF 1.2 support, which la-gram already relies on for writing).
2. A path or `EXISTS` corner in the UNION-graph idiom.

The test names the failing question.

## 9. Decisions to make

1. **Namespace.** `arch:Question` in the core (proposed) vs a separate `archq:` vocabulary. Core keeps it next to `arch:sectionQuery` and `arch:Concern`.
2. **Source of truth for core questions.** Catalogue → RDF export (proposed) vs RDF → `.rq` generation.
3. **Language.** Labels are hard-wired to `en` with an untagged fallback. A `?lang` generator parameter would need a default-binding rule, because an unbound `?lang` breaks `langMatches`.
4. **Purpose duplication.** Retire `am4vp:Designing …` in favour of `archvp:` or keep both with `skos:exactMatch`.
5. **Scope of the starter set.** Add packs per framework (TOGAF, C4, BPMN) the same way, or keep la-gram to core + ArchiMate 4 for now.
