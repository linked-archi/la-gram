# Pending: derivation in la-gram, and derived relationships in the matrix

Recorded 2026-11-05. Nothing here has been started. la-gram was at `3ca4759` and
linked-archi-meta at `fa3e69e`.

**The case.** A matrix of applications against applications shows only the relationships drawn directly
between two applications. It doesn't show those that run through what each application is assigned to or
realises, or what it is made of: its functions, processes, services and sub-components. ArchiMate's valid
derivation rules give exactly those:

- **Flow:** A is assigned to function FA, FA flows to FB, and B is assigned to FB. DR5 gives A → FB, then
  DR6 gives A → B.
- **Serving:** A realises service SA, SA serves function FB, and B is assigned to FB. DR3 gives A → FB, then
  DR4 gives A → B.
- **Parts:** A serves B1, and B is composed of B1. DR4 gives A serves B.
- **Data access:** A is assigned to F, and F accesses D. DR3 gives A accesses D.

Valid derivations hold in any model, so a matrix may show them, as long as they're marked as derived.

## The rule that comes first

**Derivation runs only when the modeller explicitly asks for it.** This means:
- **No derivation on its own:** never when a model opens, never after an edit, and never because a view or
  matrix opens.
- **Rules not fetched until asked:** the rules file isn't even fetched until then. la-gram's Req 2.12 records
  derivation rules as skipped when a metamodel loads, and that stays so.
- **Out-of-date results stay as they are:** after a change to the model, results from an earlier run aren't
  silently re-run. They're marked out of date and offer *Derive again*.
- **Results are not saved unless asked:** they're kept apart from the model, as meta's DD-28 keeps them in a
  graph of their own. They're saved, beside the model, only when the modeller asks.

Neither la-gram's requirements and design nor meta's design decisions say this today. It goes into
`.kiro/specs/la-gram/requirements.md` as an acceptance criterion when the feature is built.

## Hard constraints

- Never commit, stage, stash or push. Run `git status` first, and never revert changes you didn't make.
- Don't touch the real company model: no timing, copying or quoting it unless the user asks. The timings
  below come from made-up models in the reserved example namespace.
- Changing meta's rules or their generator is the user's decision. The approach below needs no change in
  meta.
- Finish a change with tests, then docs (`README.md`, and the requirements, design and tasks in
  `.kiro/specs/la-gram/`, including the change log), then `npm run build`, then tell the user to reload.

## What la-gram does today

- **Not deriving:** la-gram doesn't derive (`.kiro/specs/la-gram/design.md`, around line 1710: "the rules
  need a server-side engine"). This feature reverses that note, which must be rewritten.
- **Derivations from a file:** it shows those a file brings (Req 4.7, `src/model-manager/derivations.ts`):
  - listed under *Derived relationships* in the tree;
  - drawn faded with a D or P badge;
  - rule and premises shown in the properties panel;
  - *Confirm* for a potential one.
- **The matrix** (`src/ui/views/matrix-view.ts`, `buildMatrixData`, line 139):
  - **Derivations not marked:** it treats every resource with `arch:source` and `arch:target` as a
    relationship, so a loaded derivation fills a cell like a stated one.
  - **Potential ones look stated:** an unconfirmed potential derivation shows as if the model stated it.
  - **One per cell:** it keeps one relationship per cell, the last one found.
- **The rules aren't bundled:** neither 4.0's nor 3.2's are in `assets/`. ArchiMate 4's manifest declares
  them (`arch:derivationRules`, `archimate4-metamodel.ttl:135`).

## What the probe found (2026-11-05)

The probe used la-gram's `oxigraph` 0.5.11, run in Node, on meta's
`modelingLanguages/archimate/4.0/archimate4-derivation-rules.ttl`. It ran only `:Qualification` and DR1–DR8,
not the potential rules.

- **How it ran the rules:** the prefixes come from the rules ontology's `sh:declare`. Each rule's
  `sh:construct` is run as a plain SPARQL CONSTRUCT over the whole store, with `$this` rewritten as `?this`,
  and the results are added. Rules run in their shape's `sh:order`, then by name, repeated until a pass adds
  nothing.
- **Same results:** on a small model the rules derived exactly the relationships above. Claims App → Billing
  App got Flow (DR6) and Serving (DR4).
- **As published, too slow:** each rule's ArchiMate restrictions (Appendix B.4) ask about 15 times per
  candidate what kind of element something is, each through `rdf:type/rdfs:subClassOf*`. 30 apps took 30 s,
  and 100 apps 147 s.
- **Two rewrites in the working copy** keep the results the same (identical counts of derived triples):
  1. **Supertypes up front:** add every element's supertypes as `rdf:type` triples,
     `INSERT { ?x a ?sup } WHERE { ?x a ?c . ?c rdfs:subClassOf+ ?sup . FILTER(isIRI(?sup)) }`. Then
     replace `rdf:type/rdfs:subClassOf*` with `rdf:type` in the rules.
  2. **Qualify once:** run `:Qualification` once, before the rules, not on every pass. Each relationship a
     rule derives already carries its resource, so later passes can't qualify anything. On the second pass
     it was 5.2 s of 5.6 s.

  Timings, on made-up models: each app has 3 functions and 2 services, plus random flows and serving
  between them.

  | Apps | Relationships | As published | With both rewrites | Triples added |
  |---|---|---|---|---|
  | 100 | 909 | 147 s | 0.4 s | 22,625 |
  | 300 | 2,729 | not run | 2.0 s | 69,551 |
  | 500 | 4,549 | ran over 7 min without finishing | 3.9 s | 117,181 |
  | 1,000 | 9,099 | not run | 14 s | 234,418 |

- **What to keep in mind:**
  - It still grows faster than the model.
  - Each derivation writes about 10 triples (its resource and provenance).
  - In the browser it must run off the main thread.
  - `$this` as a free variable matches SHACL's focus nodes here because every rule binds it through a
    pattern its targets cover. The test against meta's own run (below) checks this.

## What to build

1. **The rules:** bundle meta's derivation rules for 4.0 and 3.2 in `assets/`, laid out as on the site. Load
   them only when derivation is asked for.
2. **A runner:** in a background worker, over a copy of the model and its metamodel in one working store.
   - It reads each rule, its order and its prefixes, and applies the two rewrites.
   - It runs `:Qualification` once, then the valid rules until nothing new appears.
   - It returns only what the rules derived. Supertypes added in the working copy never reach the model.
3. **A *Derive* command:** in the model's menu, and in the matrix as *Include derived relationships*; either
   one is a request.
   - Results are kept apart from the model and shown through the existing derived-relationship UI.
   - They're marked out of date after an edit, with *Derive again*.
   - *Save derivations beside the model* is a separate, explicit action.
4. **The matrix:**
   - show every relationship between a pair, not only one;
   - mark derived cells with a D, faded, with the path (the premises) in the tooltip;
   - leave out unconfirmed potential derivations, or show them as a P (decision below).
5. **A test against meta:** run la-gram's runner on `examples/archimate4-derivation-example.ttl` and on 3.2's,
   and compare with meta's own run (`.scripts/validate.sh --shacl archimate4-derivation`, and
   `archimate-derivation` for 3.2). Then add a matrix test with the application case above.
6. **Docs:** rewrite the design note that says la-gram does not derive, and add the requirement that
   derivation runs only when asked.

## Decisions for the user

- **D1 The request:** where it's asked for: a *Derive* command, the matrix switch, or both (recommended).
- **D2 Saving:** whether derivations can be saved beside the model, as a separate file or in the same file
  marked apart (DD-28).
- **D3 Potential derivations in the matrix:** leave them out (recommended), or show them as P.
- **D4 Potential rules (PDR1–PDR12):** later, on a request of their own. They're untested here, and they need
  the relationship tables loaded.
- **D5 Real model:** whether to time the runner on the real model, locally, before building.

## Done when

- The user has answered D1–D5, and the answers are recorded here.
- Derivation runs only on request. A test shows nothing derived on open, on edit or when a matrix opens
  without the switch.
- la-gram's results match meta's run on both derivation examples.
- The matrix shows the application case derived and marked D, and shows several relationships per cell.
- Tests pass, the docs are updated, `npm run build` has run, and the user has been told to reload. Nothing is
  committed.
