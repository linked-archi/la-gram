# Git-Native Collaborative Editing for Linked.Archi — Implementation Specification

**Target editor:** `la-gram` (RDF-native architecture modeller)
**Repo under spec:** the *model* repository (the TTL/TriG store in Git), plus additions to the `la-gram` codebase
**Status:** execution-ready design — hand to a human team or a coding agent and build from it
**Author context:** consolidates a multi-step design session; grounded in a direct read of the la-gram source tree

---

## 0. How to use this document

This is a build specification, not an essay. It is organised so that:

- **§1–§4** give you the thesis, the problem, an inventory of what la-gram *already* does, and the gap. Read these once.
- **§5–§7** define the target architecture, the design decisions (each with an ID like `DR-3` you can cite in code review), and the repository layout.
- **§8** is the heart: one **component spec** per unit of work (`C1`…`C8`). Each names its purpose, where the code lives, which existing la-gram files it touches, the algorithm, and **acceptance criteria** you can test against.
- **§9** is an end-to-end walkthrough proving the pieces compose.
- **§10** is a phased execution plan with milestones.
- **§11–§14** cover testing, risks/open decisions, and appendices (including the language-agnostic reference implementations).

Every reference to a la-gram source file uses its real path, e.g. `src/git/git-save.ts`. Every new file this spec asks you to create is called out with **NEW:** and a path.

A coding agent executing this should treat each `C#` in §8 as an independent task with the acceptance criteria as its definition of done, respecting the dependency order in §10.

---

## 1. Executive summary (the thesis)

Several architects must edit one RDF architecture model concurrently. The model is authored in **la-gram**, serialized to **Turtle/TriG**, and stored in **Git** (GitLab). We want branches, intermediate saves, pull requests, conflict safety, and a Miro-style live editing room — without the classic "RDF-in-Git is a text/semantics mismatch" pain.

**Key finding from reading the la-gram source: roughly 60% of the required foundation already exists.** The work is *evolution*, not greenfield.

What already exists and is load-bearing:

1. **Stable identity.** Every element gets a random UUID IRI at creation and keeps it for life (`src/rdf-engine/iri.ts`). This is the single most important precondition for both Git merge sanity and CRDT identity — and it is done.
2. **Deterministic serialization.** The model is written with a fixed quad ordering (`src/import-export/model-io.ts → compareQuads`), so "the commit's diff is the change."
3. **A working CRDT room.** Real-time collaboration already runs on Yjs modelling the graph as an **OR-Set of triples**, with deterministic resolution of single-valued properties, over Hocuspocus (`src/collab/rdf-yjs-binding.ts`, `src/collab/start.ts`, `server/collab-server.mjs`).
4. **Layered partitioning.** On save the model is split into DD-15 named graphs (`graph/model`, `graph/semantic`, `graph/views`) for graph-capable formats (`model-io.ts → partitionModel`).
5. **A complete Git client** with optimistic-concurrency conflict detection (`src/git/*`), and an in-app **SHACL validator** (`src/rdf-engine/shacl-validator.ts`) plus a local checkpoint/diff history (`src/model-manager/version-history.ts`).

What is **missing** — the actual scope of this project:

- **A3 (the big one): a semantic three-way merge** at the Git layer. Today a concurrent Git conflict is *avoided*, not *merged*: la-gram detects the host has moved on and offers "new branch / overwrite / open newer" (`git-save.ts → resolveConflict`). No triples are actually merged.
- **Server-side CI gates** on pull requests (SHACL + semantic diff + impact), independent of the editor.
- **Queryable commit history** (a Flexo-style commit graph) and **SPARQL-at-any-commit** serving.
- **Binding the live room to a Git branch** with checkpoint→commit and rebase-from-main→room flows.

**Recommended implementation language: TypeScript**, as a small Node package reusing la-gram's own `rdf-engine` (n3, oxigraph, rdf-validate-shacl) — *not* a parallel Python stack. Reimplementing canonicalisation, SHACL and partitioning in Python would duplicate code that already exists and must stay byte-for-byte compatible with what the editor writes. The Python reference implementations (Appendix §13) define the algorithms language-neutrally and serve as a fallback/CI-portable option.

---

## 2. The problem, briefly

RDF is a **set of triples**; Git is **line-based text VCS**. A naïve `git merge` of a `.ttl` file produces:

- **spurious conflicts** from serialization order,
- **garbage diffs** from blank-node relabeling,
- and, worst, **silently wrong merges** — a text merge can keep two values of a single-valued property, producing an invalid model that still "merged cleanly."

The fix is not a branching policy; it is making the on-disk form and the merge operation **graph-aware**. la-gram has already solved the two hardest prerequisites (stable IRIs, deterministic output). This project adds the graph-aware merge and the review/serving infrastructure around it.

---

## 3. What la-gram already provides (grounded inventory)

This section is the factual basis for the gap analysis. Each row cites the source file so an implementer can verify.

### 3.1 Runtime model & identity

| Capability | Where | Notes |
|---|---|---|
| RDF store is the single source of truth at runtime; diagram/tree/files are projections | `README.md`, `src/rdf-engine/` | "CRDT is the truth at runtime; RDF is the truth at rest" |
| RDF engine | `oxigraph` + `n3` (`package.json`) | oxigraph gives in-browser SPARQL; n3 parses/writes |
| **Stable IRIs for life** | `src/rdf-engine/iri.ts` | `mintIri` → `{ns}element-{uuid}` (random v4 UUID). Rename/move/round-trip never change identity |
| Model namespace layout | `iri.ts`, `model-namespace.ts` | `{base}{notation}/{modelId}/`; prefix `m:` |
| Blank nodes | `iri.ts`, `version-history.ts` | Model layer **mints none**; imported files may carry them — a known edge case |

### 3.2 Serialization & file formats

| Capability | Where | Notes |
|---|---|---|
| **Deterministic serialization** | `model-io.ts → compareQuads` | graph → subject → `rdf:type`-first → predicate → object. "deterministic output (Req 9.12)" |
| Formats | `model-io.ts → MODEL_FORMATS` | Turtle, TriG, JSON-LD, N-Quads, N-Triples, RDF/XML |
| **DD-15 named-graph partition** | `model-io.ts → partitionModel / partitionGraphs` | `graph/model`, `graph/semantic`, `graph/views`. TriG/N-Quads/JSON-LD carry it; triple-only formats get the union + `arch:inModel` for membership recovery |
| `no-geometry` profile | `model-io.ts` | Drops the views graph for pipeline consumers |
| Pretty Turtle serializer | `src/rdf-engine/ttl-serializer.ts` | Shortest-prefix selection, subject grouping |

### 3.3 Collaboration (the live room)

| Capability | Where | Notes |
|---|---|---|
| **CRDT = OR-Set of triples** | `src/collab/rdf-yjs-binding.ts` | `Y.Map<true>` named `triples`, keyed by canonical N-Triples line (`quadKey`). Concurrent adds merge; add/remove resolves deterministically |
| **Single-valued property resolution** | `rdf-yjs-binding.ts → normalize` + `SINGLE_VALUED` set | After each remote change, keeps greatest key, retracts others — deterministic across clients. This is the runtime equivalent of conflict class C1/C5 |
| Presence + soft locks | `src/collab/start.ts` | Yjs awareness: cursors, selection; a peer's selection is **locked** on other canvases |
| Transport | `@hocuspocus/*` | `server/collab-server.mjs` |
| **Room persistence** | `collab-server.mjs → onStoreDocument` | Writes `data/rooms/<room>.nt` (authoritative, sorted) + `<room>.ttl` (pretty). Atomic write. Debounced 1.5s / max 10s |
| **HTTP serving of the live model** | `collab-server.mjs → onRequest` | `GET /rooms`, `GET /rooms/<room>.ttl`, `GET /rooms/<room>.nt` — for tools that don't speak Yjs |
| Seed policies | `rdf-yjs-binding.ts → SeedPolicy` | `prefer-room` / `push-local` |

### 3.4 Git client

| Capability | Where | Notes |
|---|---|---|
| Open from Git | `src/git/git-open.ts` | File/repo/branch/folder; binds model to `{branch, path, version, commit}` |
| Save to Git | `src/git/git-save.ts` | Commits the model as **one file**; extension picks format |
| Providers | `src/git/providers/{github,gitlab}.ts`, `provider.ts` | REST; `commitFile`, `readFile`, `listFiles`, `listBranches`, `branchHead`, `defaultBranch` |
| **Optimistic concurrency** | `provider.ts → FileChange.expectedVersion`; `git-save.ts` | A file's *version* = GitHub blob SHA / GitLab last-commit. Host refuses a commit naming a superseded version → `GitError('conflict')` |
| **Conflict handling (today)** | `git-save.ts → resolveConflict` | Offers: new branch from where you were / overwrite / open newer. **No triple merge** |
| Host allow-list, tokens | `credentials.ts`, `host-kinds.ts`, `link.ts`, deployment `la-gram.config.json` | Tokens kept in keychain (desktop) / session (web) |

### 3.5 Validation & local history

| Capability | Where | Notes |
|---|---|---|
| **In-app SHACL** | `src/rdf-engine/shacl-validator.ts` | `rdf-validate-shacl`; full + incremental (single-resource); caches compiled shapes; strips unsupported `sh:sparql` constraints; human-readable messages |
| Live validation | Validation tab | Against loaded metamodels' shapes + core shapes |
| **Local checkpoints** | `src/model-manager/version-history.ts` | Snapshots (not deltas) as canonical N-Triples in **IndexedDB**, per model IRI. `snapshotOf`, `diffSnapshots`, restore. **Not Git commits** — explicitly local |

---

## 4. Gap analysis

Mapping the target design (from the design session) to la-gram reality:

| Design element | la-gram today | Gap | Component |
|---|---|---|---|
| Stable IRIs / skolemization | ✅ UUID IRIs for life; mints no blank nodes | Skolemize **imported** blank nodes on ingest | `C1` |
| Canonical serialization | ⚠️ Deterministic ordering done | Add true canonical form + enforce at Git boundary (clean filter); optional RDFC-1.0 for imported bnodes | `C1`, `C3` |
| File sharding (many small files) | ❌ One file per model; graph-level partition only | Decide: keep single-file + semantic merge (recommended start) vs. shard | `DR-4`, `C7`(opt) |
| **Semantic three-way merge driver** | ❌ Conflicts avoided, not merged | Build it; wire as `merge=rdf` and into the client conflict path | **`C2`, `C4`** |
| Element-level PR diff | ⚠️ In-app snapshot diff exists (`version-history.ts`) | Server-side PR diff rendering | `C5` |
| CI gates (SHACL, diff, impact) | ❌ none server-side (SHACL only in-app) | Build GitLab CI reusing the engine | `C5` |
| Queryable commit graph | ⚠️ Local IndexedDB checkpoints only | Repo-side commit-graph sidecar | `C6` |
| SPARQL-at-any-commit | ⚠️ Collab server serves live room over HTTP; oxigraph in-app | Serving layer over Git history | `C7` |
| CRDT room | ✅ Yjs/Hocuspocus, presence, soft locks | — | — |
| Room ↔ branch (checkpoint/rebase) | ❌ Room persists to disk only; Git is client-side single-file | Bind room to branch; checkpoint→commit; rebase main→room | **`C8`** |

**Scope of this project = C1–C8.** C2/C4 (semantic merge) and C8 (room↔branch) are the highest-value; C5 (CI) is the highest-leverage safety net; C6/C7 are the "Flexo-inspired" enhancements.

---

## 5. Target architecture

Two cooperating tiers. **Tier 2 already largely exists**; the project mostly adds Tier 1 depth and the bridge between them.

```
        Architect A        Architect B        Architect C
             \                 |                 /
              \                |                /     live co-editing
        ┌──────────────────────────────────────────────┐
        │ TIER 2 — la-gram live room (EXISTS today)      │
        │  • Yjs OR-Set of triples  (rdf-yjs-binding.ts) │
        │  • single-valued normalize = runtime C1/C5      │
        │  • presence + soft locks  (start.ts)            │
        │  • Hocuspocus server, .nt/.ttl persistence,     │
        │    HTTP GET /rooms/<r>.ttl  (collab-server.mjs) │
        └───────────────┬─────────────────▲──────────────┘
          checkpoint →  │                 │  ← rebase (main moved)
          (flatten to   │                 │   diff & apply into Y.Doc
           canonical    │                 │
           TTL, commit) ▼                 │        NEW: C8
        ┌──────────────────────────────────────────────┐
        │ TIER 1 — Git durable source of truth           │
        │  • canonical TTL/TriG  (C1, model-io.ts)        │
        │  • merge=rdf semantic three-way  (C2) NEW       │
        │  • client merge in conflict path (C4) NEW       │
        │  • PR + CI: SHACL + semantic diff + impact (C5) │
        │  • commit-graph sidecar history/ (C6) NEW       │
        │  • SPARQL-at-any-commit serving  (C7) NEW       │
        └────────────────────────────────────────────────┘
                 spine: stable UUID IRIs (iri.ts, EXISTS)
```

**The binding rule (DR-1): one live room ↔ one Git branch.** The room is the live CRDT working copy of a branch; checkpoints are commits on that branch; publishing is a PR into `main`.

---

## 6. Design decisions

Each is citable in review (e.g. "per DR-3").

- **DR-1 — Room is bound to a branch.** A collaboration room materialises one branch's model into the Yjs doc; checkpoints commit back to that branch; `main` is reached only via PR. Rationale: keeps the live layer and Git coherent; the room never floats free of a persistent projection.

- **DR-2 — Implement Git tooling in TypeScript, reusing la-gram's engine.** The merge driver, canonicaliser, semantic diff, and CI validation are a Node package (`la-gram-git/`) that imports `src/rdf-engine` and `src/import-export/model-io`. Rationale: the on-disk form must stay byte-identical to what the editor writes; duplicating `compareQuads`, SHACL, and partition logic in another language invites drift. The Python reference impls (§13) remain the language-neutral spec and a CI-portable fallback.

- **DR-3 — Merge at the triple level, never the text level.** Register a `merge=rdf` driver and *also* run the same algorithm client-side in la-gram's conflict path (C4). Conflicts are represented out-of-band (valid RDF + sidecar), never as `<<<<<<<` markers that would make the `.ttl` unparseable.

- **DR-4 — Start single-file; shard only if needed.** la-gram saves one file today. A semantic merge driver makes single-file concurrent editing safe without sharding. Defer file sharding (one file per element / per view) until profiling shows merge cost or review noise demands it. Rationale: lowest friction; avoids reworking `git-save.ts`'s single-file binding now. (If/when sharding: shard by the DD-15 partition that `partitionModel` already computes.) **See §7.4 for the full trade-off analysis, hybrid options, and decision rubric.**

- **DR-5 — Canonical form is enforced at the Git boundary.** A `.gitattributes` clean filter runs the canonicaliser on every blob entering the index, so no client can commit non-canonical TTL regardless of tool or hand edit. la-gram's own writer already produces deterministic output; the filter guarantees it repo-wide.

- **DR-6 — Reuse the runtime conflict semantics in the merge driver.** The set of single-valued predicates in `rdf-yjs-binding.ts` (`SINGLE_VALUED`) and the functional-property rule drive the *same* C1/C5 classification in the Git merge driver. One definition of "single-valued," shared by runtime and merge. Discover functional predicates from the metamodel (`owl:FunctionalProperty` + `sh:maxCount 1`) so no domain knowledge is hard-coded.

- **DR-7 — Checkpoints are the bridge, not a replacement for local history.** The IndexedDB checkpoint history (`version-history.ts`) stays as a personal, offline undo timeline. Git checkpoints (C8) are the shared, durable ones. They coexist; do not conflate.

- **DR-8 — Validation runs at three points.** (a) live in the room (exists), (b) in the merge driver for *within-shard* cardinality (C2/C3 conflict class), and (c) in CI for *whole-graph* invariants that no single merge can see (C5). Each catches what the others cannot.

- **DR-9 — The room server owns the Git working copy for checkpoint/rebase (C8).** Client-side `git-save.ts` remains for solo/offline authoring; when a room is active, checkpoints/rebases are coordinated by the collab server so all participants share one branch state. Rationale: N clients each pushing to the same branch would thrash optimistic concurrency.

---

## 7. Repository layout & conventions

### 7.1 Model repository (single-file start, DR-4)

```
model-repo/
├── .gitattributes                 # merge=rdf, clean filter (C3)
├── .gitlab-ci.yml                 # CI gates (C5)
├── ontology/                      # metamodel + shapes, vendored or submodule
│   ├── core.ttl  core-vis.ttl
│   └── shapes/ core-shapes.ttl core-vis-shapes.ttl <metamodel>-shapes.ttl
├── models/
│   └── <model>.ttl                # the model, as la-gram saves it today
├── history/                       # commit-graph sidecar (C6)
│   ├── commits.ttl                # lineage + per-commit metadata
│   └── <sha>.trig                 # per-commit added/removed delta graphs
└── la-gram-git/                   # the Node tooling package (C2,C5,C6,C7)
    ├── package.json
    ├── canonicalize.ts  rdf-merge.ts  semantic-diff.ts
    ├── commit-objects.ts  sparql-serving.ts
    └── assemble-graph.ts
```

### 7.2 Optional sharded layout (DR-4, if adopted later)

```
models/<model>/
├── elements/<type>/ELEMENT-<uuid>.ttl   # one file per element (filename = IRI slug)
├── relations/ELEMENT-<uuid>.rels.ttl    # relationships sharded by source
└── views/VIEW-<uuid>.trig               # one named graph per view (geometry)
```
This mirrors `partitionModel`'s existing split; `git-save.ts` would gain a "sharded" save mode writing per-subject files instead of one blob.

### 7.3 Conventions

- **Branch naming:** `la-gram/<model>-<stamp>` for tool-created branches (already the default `branchPrefix` in `git-save.ts → gitDefaults`); `session/<room>` for room branches (C8); `feature/<change>` for manual work.
- **Commit message template:** `{action} {model}` (already the default; `{path}`, `{branch}` available).
- **Formats in Git:** `.ttl` for single-file; `.trig` for sharded views (named graphs). Both are canonicalised by the clean filter.

---

### 7.4 Single-file vs. sharded storage — detailed trade-off analysis

This is the decision behind **DR-4 / OPEN-1**, expanded. It is the most consequential layout choice in the project, so it deserves its own treatment. The recommendation remains *start single-file, shard later if profiling demands it* — but here is the full reasoning so the call can be revisited with eyes open.

#### 7.4.1 What actually drives the decision

Two variables dominate; everything else is secondary:

1. **Conflict surface = the unit Git locks on.** Git detects conflicts per *file*. With one file, *every* concurrent save touches *that* file, so **every concurrent change collides at the Git layer** — even when the edits are semantically disjoint. With one file per element, two architects editing different elements touch different files and Git merges them with **no semantic merge driver needed at all**.
2. **Merge cost = how much the driver (C2) must parse and reconcile.** Single-file forces the semantic merge driver to parse and three-way-merge the *entire model* on every collision — `O(model size)`. Sharded runs it only on the handful of files genuinely co-edited — `O(change size)`.

Put bluntly: **single-file makes C2 run constantly on the whole graph; sharding makes C2 run rarely on tiny slices.** That single sentence is the trade-off. Everything below elaborates it and prices the cost of getting there.

#### 7.4.2 Single-file (`models/<model>.ttl`) — the status quo

| | |
|---|---|
| **Pros** | • **Zero rework** — this is exactly what `git-save.ts` does today (model bound 1:1 to `{branch, path, version, commit}`).<br>• **Always-coherent on disk** — the whole graph is one atomic blob; no cross-file referential integrity to maintain, no partial-graph reads.<br>• **No assembly step** — SHACL, semantic diff, and SPARQL see the complete model directly; `assemble-graph.ts` is a near no-op.<br>• **Simple tooling invocation** — one path through the clean filter (C3), one `merge=rdf` invocation, one `expectedVersion` check (reuses la-gram's existing per-blob optimistic concurrency verbatim — `provider.ts`).<br>• **Human-readable as one document** — open/diff/review the entire model in one place; a reviewer sees everything.<br>• **No naming scheme, no orphans** — no filename↔IRI slug mapping, no dangling-file or delete-the-file bookkeeping. |
| **Cons** | • **Maximum conflict surface** — every concurrent save collides at Git, so **C2 runs on every concurrent change**, even disjoint ones.<br>• **Merge cost scales with model size** — the driver parses/merges the whole graph each time; on a large model this is the dominant latency.<br>• **Coarse PR diffs** — the whole file reads as "changed"; reviewers lose per-element boundaries (the C5 semantic-diff mitigates this, but the *file* diff is still monolithic).<br>• **No per-element Git history** — `git blame`/log can't answer "who last touched element X" (the C6 commit-graph sidecar is specifically there to compensate).<br>• **Large blobs** — every commit stores a full canonical copy (Git delta-compresses, so disk cost is modest, but working-tree churn is real).<br>• **Every non-room client save races** — outside the room's single-committer model (DR-9), any two solo saves contend on the one blob. |

#### 7.4.3 Sharded (`elements/<type>/ELEMENT-<uuid>.ttl`, `views/VIEW-<uuid>.trig`, …)

| | |
|---|---|
| **Pros** | • **Conflict surface shrinks to the file** — disjoint edits touch different files → Git auto-merges them; **C2 only runs on files genuinely co-edited**.<br>• **Merge cost is proportional to the change**, not the model — fast even on huge models.<br>• **Element-scoped PR diffs for free** — the set of changed files *is* the set of changed elements; reviewers get ownership boundaries without any tooling.<br>• **Meaningful Git history/blame per element/view** — "who changed `APP-7f3a9c`" is answerable from Git itself.<br>• **Parallel work scales** — many architects on different parts almost never collide.<br>• **Smaller blobs, smaller per-commit churn**; enables sparse/partial checkout of a subtree.<br>• **Natural fit to DD-15** — `partitionModel` already computes the element/relationship/view split; the filenames just persist what the code already separates. |
| **Cons** | • **Significant rework** — needs a new *sharded save* mode in `git-save.ts` and a new binding model (model ↔ a **tree/folder**, not a file). The whole open/save/bind flow in `git-open.ts`/`git-save.ts` assumes one file.<br>• **Cross-file referential integrity** — a relationship file references elements in other files; deletes and retypes must keep those refs consistent, and a dangling reference is now possible.<br>• **Every whole-graph op must assemble first** — SHACL, semantic diff, SPARQL, and any `minCount`/matrix invariant require `assemble-graph.ts` to union all shards; a shard read mid-write could see a partial graph.<br>• **Multi-file commits need a batch/tree API** — `provider.ts → commitFile` is **single-file**; GitHub (create-tree + commit) and GitLab (commit with multiple `actions`) both support batch commits, but this is new provider code, and **per-file `expectedVersion` becomes per-tree** optimistic concurrency (harder).<br>• **Naming & lifecycle bookkeeping** — filename = IRI slug; deleting an element must delete its file(s); orphan/dangling files must be swept.<br>• **Layout reflow churn** — moving one box dirties one view file (good), but an auto-layout touching many elements' geometry dirties many files at once.<br>• **Harder to read the whole model** as a single document. |

#### 7.4.4 Hybrid / middle grounds (often the sweet spot)

Sharding is not all-or-nothing. From coarsest to finest:

1. **DD-15 partition as ~3 files** — `model.ttl`, `semantic.ttl`, `views.trig`. This is the **single highest-leverage split**: it separates *what the architecture is* from *how it's drawn*, so a box move dirties only `views.trig` and never the semantic element. Cheap because `partitionModel` already computes exactly this partition — the save just writes three blobs instead of one. Captures most of sharding's review/merge benefit for a fraction of the rework.
2. **Shard by package / layer / viewpoint** — one file per ArchiMate layer (business/application/technology) or per architectural package. Conflict surface tracks team ownership (the application team rarely touches the technology file). Moderate rework; no per-element explosion.
3. **Shard views only** — one `.trig` per diagram (views are high-churn and mutually independent), but keep the semantic model as one file. Isolates the noisiest edits (layout) from the model substance.
4. **Full per-element** — the §7.2 layout. Maximum parallelism, maximum bookkeeping.

**The element-vs-view separation (option 1) is the recommended first move if single-file ever shows strain** — it's the 80/20: most of the benefit, least of the cost, and it rides on code that already exists.

#### 7.4.5 Decision rubric

| Signal | Lean single-file | Lean sharded |
|---|---|---|
| Model size | ≤ ~5–10k triples | tens of thousands+ |
| Concurrent architects (outside a room) | few; mostly room-based | many, often solo/PR-based |
| C2 merge latency measured | < ~1 s on full model | exceeds ~1 s |
| PR review pain | acceptable with C5 element-diff | reviewers need file-level ownership |
| "Who touched X" need | satisfied by C6 sidecar | want it from Git natively |
| Appetite for `git-save.ts` rework now | low (ship sooner) | justified by scale |

**Trigger to revisit (make this a tracked metric):** when C2's measured runtime on the full model exceeds ~1 s, **or** PR diffs become a recurring review complaint, adopt hybrid option 1 (DD-15 three-file) first; go full per-element only if that is still insufficient.

#### 7.4.6 la-gram-specific implementation implications

If/when sharding is adopted, these are the concrete code touch-points (none are needed for the single-file start):

- **`git-save.ts`** — new sharded save mode; binding changes from model↔file to model↔`{repo, branch, folder}`. The conflict path (C4) must diff/merge a *tree*, not a blob.
- **`git-open.ts`** — opening a model means reading a folder of shards and assembling them (reuse `assemble-graph.ts`), not reading one file.
- **`providers/provider.ts`** — add a batch/tree commit (`commitFiles(changes[])`) using GitHub's tree API / GitLab's multi-action commit; generalise `expectedVersion` to a per-tree precondition.
- **`model-io.ts`** — a `serializeSharded()` that emits one unit per element/view from the existing `partitionModel` output, with filename = IRI slug.
- **C2 `rdf-merge.ts`** — unchanged in logic, but now invoked per-file by Git on the rare co-edited shard; the three-way algorithm is identical.
- **C5 `assemble-graph.ts`** — becomes load-bearing (it's near-trivial in single-file); every validate/diff step depends on it.

The reassuring part: **the semantic merge driver (C2), the canonicaliser (C1), and the conflict taxonomy do not change** between the two layouts. Sharding changes *how often* and *on how much* C2 runs, and the save/open plumbing around it — not the merge intelligence itself. That is why starting single-file costs nothing in rework when you later shard: the hard part (graph-aware merge) is layout-independent.

---

## 8. Component specifications (the build)

Each component is an independently buildable unit. **Location** says where code lives; **Touches** names existing la-gram files; **Done when** is the acceptance test.

---

### C1 — Canonical serialization hardening

**Purpose.** Guarantee that semantically equal models produce byte-identical files, so a text diff ≈ a semantic diff and the merge driver has a clean base.

**Location.** `la-gram-git/canonicalize.ts` (CLI + library). Optionally a small hardening of `src/import-export/model-io.ts`.

**Touches.** `src/import-export/model-io.ts` (`compareQuads`, `write`), `src/rdf-engine/ttl-serializer.ts`, ingest path `ModelIO.load`.

**What exists.** `compareQuads` already sorts deterministically; `MODEL_FORMATS` + partition already fixed. So canonical *ordering* is done.

**What to add.**
1. **Skolemize imported blank nodes on load.** In `ModelIO.load`, after parsing, replace any blank node with a minted IRI (`mintIri(namespace,'node')` or a dedicated `skolem-<uuid>`), recording nothing extra — the model layer already mints IRIs for everything it creates, so this only touches foreign imports. Removes the "triple about a blank node shows as removed+added" issue noted in `version-history.ts`.
2. **A standalone canonicaliser** (`canonicalize.ts`) that reads a TTL/TriG file and rewrites it exactly as la-gram would (reusing `model-io.ts` serialization). Used by the clean filter (C3) and CI.
3. **(Optional) RDFC-1.0 (URDNA2015)** only if models that still contain blank nodes must round-trip through non-la-gram tools. Given DR-4 and that la-gram mints IRIs, this is low priority.

**Done when.**
- Loading a model with blank nodes, saving, reloading, saving again → byte-identical files.
- `canonicalize.ts <file>` is idempotent: running it twice yields no diff.
- A model saved by la-gram passes `canonicalize --check` with zero changes.

---

### C2 — Semantic three-way merge driver

**Purpose.** Replace text merge with a graph merge: union independent triple changes, flag only true semantic conflicts.

**Location.** `la-gram-git/rdf-merge.ts` (Node CLI invoked by Git).

**Touches.** Reuses `src/rdf-engine/*` (parse/serialize), `src/rdf-engine/shacl-validator.ts` (C3-class check), and the `SINGLE_VALUED` definition from `src/collab/rdf-yjs-binding.ts` (promote it to a shared module `src/rdf-engine/single-valued.ts` so both the binding and the merge driver import it — DR-6).

**Git contract.** Registered as:
```
# .git/config
[merge "rdf"]
  name   = RDF semantic three-way merge
  driver = node la-gram-git/dist/rdf-merge.js %O %A %B %P
```
Git passes `%O` base, `%A` ours (**also the output path**), `%B` theirs, `%P` repo path.

**Algorithm.**
```
1. Parse O, A, B → three graphs (n3/oxigraph).
2. ΔA = (A−O added, O−A removed); ΔB likewise.
3. merged = O + ΔA.added + ΔB.added − ΔA.removed − ΔB.removed.
4. Classify true conflicts (see taxonomy); for C1/C5 remove BOTH
   candidate objects from merged so no value is silently chosen.
5. Write canonical merged graph to %A.
   If conflicts: keep %A valid RDF, prepend a '#'-comment block,
   and emit <path>.conflicts.json sidecar. exit 1.
   Else exit 0.
```

**Conflict taxonomy (shared with runtime, DR-6).**

| Class | Meaning | Resolution |
|---|---|---|
| A1–A4 | independent adds / disjoint subjects / same add / same delete | auto-union |
| **C1** | functional property set to different objects on each side | human picks |
| **C2** | one side deletes a subject the other modifies | human decides |
| **C3** | union violates SHACL cardinality (`maxCount`/`minCount`) | human trims |
| **C4** | same diagram node placed differently (views) | human picks position |
| **C5** | functional literal differs by value/datatype/lang | human picks |
| N1–N3 | ordering / formatting / bnode relabel | eliminated by C1 before merge |

**Functional-predicate discovery.** Union of: predicates typed `owl:FunctionalProperty` in the loaded ontology, predicates with a `sh:maxCount 1` property shape, and the geometric/structural set already in `SINGLE_VALUED` (bounds, points, source/target, view, membership). No hard-coded domain list.

**Why no `<<<<<<<` markers.** They make the `.ttl` unparseable, so neither a validator, nor la-gram, nor the room server could load the file to help resolve. The sidecar JSON is consumed by C4/C8 to render in-room resolution markers.

**Reference impl.** `docs/git-collaboration/reference/rdf_merge.py` (Appendix §13) is the exact algorithm in Python — port it to TS reusing the engine.

**Done when.**
- Two branches adding different `arch:realizes` links to the same element merge cleanly (A1).
- Two branches setting `skos:prefLabel` (same lang) to different strings produce `exit 1` + a `C1` entry in the sidecar, and neither label in the merged file.
- Deleting an element on one branch while renaming it on the other yields `C2`.
- A merge that would create a 3rd value of a `maxCount 2` property yields `C3`.
- Fixtures for every class live in `la-gram-git/__tests__/merge/`.

---

### C3 — `.gitattributes` wiring & clean filter

**Purpose.** Make canonical form and semantic merge impossible to bypass.

**Location.** `model-repo/.gitattributes`, plus `la-gram-git/canonicalize.ts` (C1) as the clean filter.

**Content.**
```gitattributes
*.ttl   filter=rdfcanon merge=rdf diff=rdf
*.trig  filter=rdfcanon merge=rdf diff=rdf
```
```
# .git/config (shipped via a setup script, since filters aren't cloned)
[filter "rdfcanon"]
  clean  = node la-gram-git/dist/canonicalize.js --stdin
  smudge = cat
[merge "rdf"]
  driver = node la-gram-git/dist/rdf-merge.js %O %A %B %P
[diff "rdf"]
  textconv = node la-gram-git/dist/canonicalize.js --stdin
```

**Setup.** A `la-gram-git/install-hooks.sh` (or `npm run repo:init`) writes the `.git/config` filter/merge/diff sections, since Git does not clone them. Document this as a required one-time step per clone.

**Done when.**
- A hand-edited, reordered `.ttl` committed by a plain `git add` lands canonical in the index (verify with `git cat-file -p :models/<m>.ttl`).
- `git diff` on a model shows semantic changes, not reordering noise.

---

### C4 — Client-side semantic merge in la-gram's conflict path

**Purpose.** When la-gram hits a Git conflict today it can only diverge or overwrite. Add a fourth, default choice: **Merge** — perform the C2 three-way merge in-browser using the in-app engine, push the result, and surface true conflicts in the UI.

**Location.** `src/git/git-merge.ts` **NEW**; wire into `src/git/git-save.ts → resolveConflict`.

**Touches.** `git-save.ts` (`resolveConflict`, `GitSaveContext`), `src/git/providers/provider.ts` (`readFile` to fetch base & theirs), `src/rdf-engine/*`, the new shared `single-valued.ts`.

**Flow.**
```
On GitError('conflict') for a bound file:
  base   = provider.readFile(startFrom)        // the commit we opened/last saved
  theirs = provider.readFile(branchHead)       // current head
  ours   = ctx.serialize(format)               // the in-memory model
  {merged, conflicts} = threeWayMerge(base, ours, theirs)   // C2 algorithm, TS
  if conflicts.empty:
     commit merged with expectedVersion = theirs.version   // fast-forward safe
     rebind; done
  else:
     load merged into the store (default graph), mark the conflicted
     subjects (from sidecar) with a visual flag; open the Validation/Conflict
     panel; let the architects resolve, then Save to Git again.
```

**UI.** Add a "Merge with the newer version" option to the existing `resolveConflict` chooser (it already offers branch/overwrite/open). Conflicts render in a new **Conflicts** sub-tab (mirror the Validation tab's list in `validation-panel.ts`).

**Interaction with optimistic concurrency.** After a clean merge, commit names `expectedVersion = theirs.version` so the push is accepted iff head hasn't moved again; if it has, loop (re-fetch theirs, re-merge). This reuses the existing `expectedVersion` machinery in `provider.ts` — no provider change needed.

**Done when.**
- Two la-gram instances editing the same bound file: the second save offers **Merge**, auto-unions disjoint edits, and commits without a branch divergence.
- A genuine C1 conflict opens the Conflicts panel listing the element + both values; after the user picks one and saves, the commit succeeds.
- Offline/solo save path is unchanged.

---

### C5 — Server-side CI pipeline (SHACL + semantic diff + impact)

**Purpose.** A safety net independent of the editor: no PR merges to `main` that is syntactically broken, SHACL-invalid, or silently destructive — and give reviewers an element-level diff.

**Location.** `model-repo/.gitlab-ci.yml` + `la-gram-git/{assemble-graph,semantic-diff,validate}.ts`.

**Touches.** Reuses `src/rdf-engine/shacl-validator.ts` (same shapes, same messages as the editor — DR-8) and `partitionModel`/serialization.

**Pipeline.**
```yaml
stages: [parse, validate, diff, impact]

parse:
  stage: parse
  script: node la-gram-git/dist/parse-check.js models/**/*.ttl models/**/*.trig

shacl:
  stage: validate
  script:
    - node la-gram-git/dist/validate.js
        --data  $(node la-gram-git/dist/assemble-graph.js)
        --shapes ontology/shapes/*.ttl
    # enforces ArchNodeShape, PlacedDiagElementShape, cardinality, relationship matrix

semantic-diff:
  stage: diff
  script: node la-gram-git/dist/semantic-diff.js origin/main HEAD > diff.md
  artifacts: { paths: [diff.md] }      # posted as a PR/MR note

impact:
  stage: impact
  script: node la-gram-git/dist/impact.js --changed $(git diff --name-only origin/main)
  allow_failure: true                   # advisory
```

**assemble-graph.** Because the model may be sharded (DR-4 future) or partitioned into named graphs, every validate/diff step must first union all shards/graphs into one in-memory graph — a whole-graph invariant (e.g. "every application realizes ≥1 capability") cannot be checked per file. Mirrors `partitionModel` in reverse.

**semantic-diff.** Groups the triple delta by subject → 🟢 added / 🔴 removed / 🟡 modified **elements**, with functional properties shown `old → new` and set-valued as `+/−`. Reference impl: `docs/git-collaboration/reference/semantic_diff.py`. In-app, `version-history.ts → diffSnapshots` already does the triple-level diff; semantic-diff adds the element grouping and metamodel-aware rendering.

**SHACL note.** `shacl-validator.ts` strips `sh:sparql` constraints (rdf-validate-shacl can't run them). CI should *also* run a SPARQL-based checker (e.g. `pyshacl` with SPARQL support, or oxigraph SPARQL queries) for the self-loop/cycle rules that the in-app validator silently skips — otherwise those rules are never enforced anywhere. This is the one place a Python tool (`pyshacl`) is justified alongside the TS stack.

**Done when.**
- A PR introducing a `maxCount` violation fails `shacl`.
- A PR renaming an element posts a `diff.md` showing `🟡 <element> label: old → new`, not a Turtle patch.
- A PR that deletes a capability still realized by an app is flagged by `impact` (advisory).
- The SPARQL-constraint checker catches a relationship self-loop that the in-app validator skips.

---

### C6 — Commit-graph sidecar (queryable history)

**Purpose.** Make every Git commit a first-class, SPARQL-queryable RDF object ("who changed what, when; show me the model at commit Z") — Flexo's best idea, without adopting Flexo.

**Location.** `la-gram-git/commit-objects.ts`; data in `model-repo/history/`.

**Touches.** Reuses the merge/diff delta logic; driven from a `post-commit`/`post-merge` hook or from C8's checkpoint step.

**Data model.**
```turtle
commit:<sha> a mms:Commit ;
  prov:wasDerivedFrom commit:<parent> ;
  prov:wasAttributedTo "Name <email>" ;
  prov:generatedAtTime "…"^^xsd:dateTime ;
  mms:addedCount N ; mms:removedCount M ;
  mms:touched m:element-… , m:view-… .
```
Full added/removed triple sets go in a per-commit named graph `history/<sha>.trig` (`<commit>#added`, `#removed`), so diffing two commits is set algebra over recorded deltas — no blob re-reads.

**Relationship to `version-history.ts`.** That module already computes canonical snapshots and diffs in-app (IndexedDB). C6 is its repo-side, shared, queryable counterpart. Consider refactoring so both import one `snapshot/diff` core (the `snapshotOf`/`diffSnapshots` functions are already the right shape).

**Reference impl.** `docs/git-collaboration/reference/git_commit_objects.py`.

**Done when.**
- `commit-objects record HEAD` appends a commit object + writes the delta graph.
- A SPARQL query over `history/commits.ttl` returns every commit that `mms:touched` a given element, newest first.
- `commit-objects diff <a> <b>` returns added/removed counts without reading Git blobs.

---

### C7 — SPARQL-at-any-commit serving layer

**Purpose.** Query the model as of any commit over live SPARQL, without adopting Flexo.

**Location.** `la-gram-git/sparql-serving.ts`; serves into a SPARQL 1.1 store (Apache Jena **Fuseki**, or reuse **oxigraph** which is already a dependency and can run server-side).

**Touches.** Consumes C6's delta graphs; conceptually extends `collab-server.mjs`'s existing HTTP serving (which already serves the *live room* model) to serve *historical commits*.

**Design (mirrors Flexo's materialized snapshots).**
- `sync` loads the current branch-head model as one named graph `commit:<sha>` + the lineage graph — the cheap always-on baseline.
- `materialize <sha>` reconstructs an old commit by replaying `history/` deltas along first-parent ancestry and serves it as its own named graph (opaque IRI, like Flexo).
- Query scoped by `--commit` injects a `FROM <commit:sha>` clause.

**Note.** la-gram already embeds oxigraph and runs SPARQL in-browser (SPARQL tab). For *current-branch* queries you may not need a server at all — point the SPARQL tab at the room server's `GET /rooms/<room>.ttl`. The serving layer is specifically for **historical** commits and for external tools.

**Reference impl.** `docs/git-collaboration/reference/sparql_serving.py`.

**Caveat (performance).** Full-ancestry replay is fine for hundreds of commits; for tens of thousands add periodic checkpoint snapshots (materialise every N commits, replay only the tail).

**Done when.**
- `sync` then a SPARQL query returns current-model results.
- `materialize <old-sha>` then a query returns that commit's state.
- Reconstruction uses only `history/` deltas (no `git show` of model blobs).

---

### C8 — Room ↔ branch binding (checkpoint & rebase)

**Purpose.** Turn the existing room into a branch-bound working copy: hydrate from a branch, checkpoint to commits, and pull `main`'s movement into the live Y.Doc with conflicts surfaced in-room.

**Location.** Extend `server/collab-server.mjs` (room server owns the Git working copy — DR-9) + a thin client affordance in `src/collab/start.ts` / app toolbar.

**Touches.** `server/collab-server.mjs` (`onStoreDocument`, new Git ops), `src/collab/rdf-yjs-binding.ts` (apply a remote delta into the Y.Doc), `src/git/*` (reuse providers, or server-side `git`), `rdf-merge.ts` (C2).

**Flows.**
1. **Open/Hydrate.** Room created for `session/<room>` branch → server checks out/reads the branch model → seeds the Y.Doc (`onLoadDocument` already hydrates from `.nt`; extend to hydrate from the Git branch on first creation).
2. **Edit.** Unchanged — Yjs convergence + presence (exists).
3. **Checkpoint.** On the existing debounce (1.5s/10s) or an explicit "Checkpoint" button, flatten the Y.Doc to canonical TTL (reuse `linesOf` → `toTurtle`, already in `collab-server.mjs`) and commit to `session/<room>` with `expectedVersion` = last room commit. Record a C6 commit object.
4. **Rebase (main moved).** Server polls/webhooks `main`; on change, compute the triple delta base→main and **apply it into the Y.Doc** as a `remote`-origin transaction (so it flows to every client via the existing binding). True conflicts (C2 sidecar) are published as awareness markers → architects resolve in-room.
5. **Publish.** "Open PR" action creates a GitLab MR from `session/<room>` → `main`, through C5 gates.

**Why server-side (DR-9).** N clients each pushing the same branch would thrash `expectedVersion`. The server serialises checkpoints and is the single committer for the room; clients just edit the Y.Doc.

**Done when.**
- Creating a room from a branch hydrates the model from Git (not just from `.nt`).
- An explicit checkpoint produces a commit on `session/<room>` and a `history/` entry.
- Pushing an unrelated change to `main` appears in the live room within the poll interval, with no data loss; a conflicting change shows an in-room conflict marker.
- "Open PR" creates an MR that runs the C5 pipeline.

---

## 9. End-to-end lifecycle walkthrough

Two architects, Ana and Ben, one model on `main`.

1. **Ana opens** `models/shop.ttl` from Git (`git-open.ts`) → model bound to `{main, shop.ttl, version, commit}`. She clicks **Share** → room `shop` on `session/shop` branch (C8 hydrate).
2. **Ben joins** the same room (`?room=shop`). Both see presence; Ben selects the "Billing" app → it's soft-locked for Ana (`start.ts`).
3. They edit concurrently. Ana adds a `realizes` link; Ben renames a different element. The Yjs OR-Set unions both; no conflict (A1/A2). Single-valued races (e.g. both nudge the same node) resolve by `normalize` (runtime C1).
4. **Checkpoint** (C8): server flattens the Y.Doc to canonical TTL, commits to `session/shop`, records a commit object (C6).
5. Meanwhile **Carol merges an unrelated PR to `main`**. The room server detects it (C8 rebase), diffs base→main, applies the delta into the live Y.Doc — Ana and Ben see Carol's elements appear. One triple genuinely conflicts (Carol and Ana both set the model's `dcterms:title`): a C1 marker appears in the **Conflicts** panel; Ana picks the value.
6. **Publish**: "Open PR" → MR `session/shop` → `main`. CI runs (C5): parse ✓, SHACL ✓, semantic-diff posts "🟢 2 added, 🟡 1 modified" for review, impact advisory ✓.
7. A reviewer approves; GitLab merges. The `merge=rdf` driver (C2) handles the merge commit at the Git layer (belt-and-suspenders with the room's rebase). `main` is updated; the commit object is recorded.
8. Later, an analyst runs **SPARQL-at-any-commit** (C7): "materialise the commit from step 7, list every application realizing a capability" — served from Fuseki/oxigraph over the reconstructed snapshot.

Every step maps to a component; nothing is hand-waved.

---

## 10. Execution plan (phases, tasks, milestones)

Dependency-ordered. Each task = a `C#` slice with the §8 acceptance criteria as its DoD.

**Phase 0 — Foundations (1 sprint).**
- `C1` canonicaliser + skolemize-on-import. *Milestone: idempotent canonical round-trip.*
- Promote `SINGLE_VALUED` to shared `src/rdf-engine/single-valued.ts`. *(enables DR-6)*
- Scaffold `la-gram-git/` Node package (tsconfig, build to `dist/`, test harness).

**Phase 1 — Git-level safety (1–2 sprints).**
- `C2` semantic merge driver + full conflict-class fixtures. *Milestone: all C1–C5 fixtures pass.*
- `C3` `.gitattributes` + clean filter + `repo:init`. *Milestone: non-canonical commit normalised in index.*
- `C5` CI pipeline (parse + SHACL + semantic-diff + impact) incl. the SPARQL-constraint checker. *Milestone: a bad PR is red; a good PR shows an element diff.*

**Phase 2 — Editor integration (1–2 sprints).**
- `C4` client-side Merge option in `git-save.ts` conflict path + Conflicts panel. *Milestone: two editors merge a shared file without divergence; a real conflict is resolvable in-UI.*

**Phase 3 — Flexo-inspired history & serving (1–2 sprints).**
- `C6` commit-graph sidecar + hook; refactor `version-history.ts` to share the snapshot/diff core. *Milestone: SPARQL over `history/` answers "who touched element X".*
- `C7` serving layer (prefer oxigraph server to avoid new infra). *Milestone: query any commit.*

**Phase 4 — Live room ↔ branch (2 sprints, highest complexity).**
- `C8` server-owned checkpoint/rebase + Publish-PR. *Milestone: the §9 walkthrough runs end to end.*

**Validation track (parallel):** stand up the **pilot bake-off** (`docs/git-collaboration/reference/pilot_harness.py`) comparing this Git stack against a real Flexo-MMS instance on identical scenarios, to decide whether any remaining Flexo advantage (policy engine, serving at scale) ever justifies adopting it. Keep the Git-native stack as the default per the design session's conclusion.

---

## 11. Testing & acceptance strategy

- **Unit (Vitest, existing harness).** Each `la-gram-git` module gets fixtures. The merge driver's fixtures are the normative conflict taxonomy (one per A/C class). Reuse la-gram's existing test style (`src/**/__tests__`).
- **Property tests (fast-check, already a devDep).** Merge driver invariants: *order-independence* (merge(A,B)=merge(B,A) up to canonical form), *idempotence* (merge(X,X)=X), *union-correctness* (disjoint edits never conflict). These catch whole classes of bugs a few examples miss.
- **Golden-file tests.** Canonicaliser: a corpus of models → canonical outputs committed as goldens; CI fails on drift.
- **Integration (Playwright, existing `test:browser`).** C4: drive two browser contexts editing one bound file, assert the Merge path. C8: two contexts in one room + a scripted `main` push, assert rebase appears.
- **CI self-test.** The pipeline validates the `ontology/shapes` against the sample model on every run so shape regressions are caught.
- **Determinism gate.** A CI job asserts that re-serializing every model is a no-op (guards C1/DR-5).

---

## 12. Risks, caveats & open decisions

- **OPEN-1 — Single-file vs. sharding (DR-4).** Start single-file. Revisit if: merge driver runtime on the full model exceeds ~1s, or PR diffs are too coarse. Sharding reuses `partitionModel` but requires a new sharded save mode in `git-save.ts`. **Full analysis, hybrid middle-grounds, decision rubric, and the exact la-gram touch-points are in §7.4** — the recommended first step if single-file strains is the DD-15 three-file hybrid (§7.4.4 option 1), not full per-element sharding.
- **OPEN-2 — Where the merge truly happens.** C4 (client) and C2 (`merge=rdf` at Git) overlap deliberately (defence in depth). Decide whether server-side room checkpoints (C8) should *always* go via `merge=rdf` or via the TS `threeWayMerge` directly. Recommendation: one shared TS implementation invoked by both; `merge=rdf` is a thin CLI wrapper around it.
- **RISK-1 — `sh:sparql` constraints are silently unenforced in-app** (`shacl-validator.ts` strips them). Mitigation: C5 must run a SPARQL-capable checker, or those rules never run anywhere. Explicitly tracked in C5's "Done when."
- **RISK-2 — Imported blank nodes.** Until C1's skolemization ships, imported models with blank nodes will diff noisily and merge poorly. Gate Git save of blank-node-bearing models behind a warning until then.
- **RISK-3 — Rebase storms (C8).** A fast-moving `main` could rebase the room frequently. Mitigation: batch/debounce rebases (reuse the existing debounce), and only rebase on `main` changes that touch overlapping subjects.
- **RISK-4 — Two histories.** IndexedDB checkpoints (`version-history.ts`) vs. Git commits vs. C6 commit-graph. Keep roles crisp (DR-7): local undo timeline, shared durable truth, queryable projection. Don't let users confuse them — the History tab already labels its items "checkpoints," not "commits."
- **OPEN-3 — Serving store.** Fuseki (mature, external) vs. oxigraph server (already a dep, no new infra). Recommendation: oxigraph first; Fuseki only if a feature is missing.
- **OPEN-4 — OSLC.** Out of scope here, but if la-gram must link model elements to Jira/GitLab issues/PLM, OSLC is the integration surface — orthogonal to this storage/versioning work and addable later.

---

## 13. Appendix — reference implementations (language-neutral spec)

These Python scripts from the design session are the **normative algorithm definitions**. Port to TypeScript per DR-2, reusing la-gram's engine. They are directly runnable for a pilot and as a CI-portable fallback.

| File | Defines | Maps to |
|---|---|---|
| `docs/git-collaboration/reference/rdf_merge.py` | three-way graph merge + full conflict taxonomy (C1–C5), sidecar output | **C2**, C4 |
| `docs/git-collaboration/reference/semantic_diff.py` | element-level PR diff (added/removed/modified, functional vs set-valued) | **C5** |
| `docs/git-collaboration/reference/git_commit_objects.py` | commit-graph sidecar (`mms:Commit`, delta named graphs, diff) | **C6** |
| `docs/git-collaboration/reference/sparql_serving.py` | reconstruct-by-replay + serve any commit as a named graph | **C7** |
| `docs/git-collaboration/reference/pilot_harness.py` | Git-vs-Flexo bake-off: one scenario suite, two adapters, one scorecard | validation track |

Each was authored to mirror la-gram's realities (DD-15 partition, geometry predicates in `core-vis`, the `SINGLE_VALUED` set) so the TS port is a transliteration, not a redesign.

---

## 14. Appendix — glossary

- **DD-15** — the Linked.Archi design decision defining the `graph/model | semantic | views` partition; implemented in `model-io.ts`.
- **OR-Set** — observed-remove set CRDT; la-gram's `triples` map is one (adds win, removes are observed).
- **Optimistic concurrency / `expectedVersion`** — a commit names the file version it replaces; the host rejects it if the branch moved on (GitHub blob SHA / GitLab last-commit). la-gram's conflict trigger.
- **Canonical serialization** — a deterministic byte form for a graph so text diff ≈ semantic diff; la-gram's `compareQuads` ordering + (C1) blank-node skolemization.
- **Functional / single-valued property** — at most one object per subject (per language for labels); `owl:FunctionalProperty` ∪ `sh:maxCount 1` ∪ la-gram's `SINGLE_VALUED`. The source of C1/C5 conflicts.
- **Room** — a live Yjs/Hocuspocus session sharing one model's triples; bound 1:1 to a Git branch (DR-1).
- **Checkpoint** — (Git sense) a commit on the room's branch flattened from the live Y.Doc; (local sense) an IndexedDB snapshot in the History tab. Kept distinct (DR-7).
```
