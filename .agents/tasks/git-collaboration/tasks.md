# Pending: Git collaboration (merge, review, CI, shared rooms)

Recorded 2026-11-05. la-gram was at `3ca4759`. Phase 1 done 2026-11-05 (the merge, then its wiring), committed
as `06d6ba2`. Phase 2 done 2026-11-05, committed as `12bdb91`. Phase 3 part 1 (the engine and the command) done 2026-11-06,
committed; part 2 (the release and the templates' docs) done 2026-11-06, not committed, not released.

**Source:** `docs/git-collaboration-spec.md` and its Python reference scripts in
`docs/git-collaboration/reference/`. They were copied in by the user and aren't committed yet. This plan
keeps the spec's ideas where they hold for la-gram, and corrects or reshapes the rest (see *Corrections to
the spec*). Where the two disagree, this plan applies. The spec's component ids (C1–C8) are cited so the
two can be compared.

## Decisions taken (2026-11-05)

- **Hosts:** GitHub, GitLab.com and self-managed GitLab, all three supported.
  - Only a self-managed GitLab whose administrator configures the driver on its Git servers (Gitaly) can run
    a custom merge driver when a merge request is merged; GitHub and GitLab.com never can.
  - So **la-gram's own merge is the main path everywhere**, and CI is the check that holds everywhere.
  - A merge driver configured in Gitaly is an optional extra for self-managed GitLab.
- **The CI tool lives in la-gram's repository**, as a package built from the same source as the editor, so
  that what CI checks can't drift from what la-gram writes.
- **Shared rooms:** the person who shares a room commits it to Git from their own la-gram, with their token
  and as the author. A server that commits for the room comes only after the room server has
  authentication.
- **Deferred:**
  - history committed into the repository by hooks (C6) and a SPARQL server for any commit (C7), see
    *Deferred*;
  - splitting a model across files;
  - the Flexo comparison harness.

### Decided when Phase 1 started (2026-11-05)

- **Blank nodes:** warn before a Git save of a model that has them; no IRIs given on import.
- **Menu names:** as below — *Merge with the newer version*, *Update from main*, *Open merge request*.
- **A conflict holds base's version** in the merged model (a deleted concept: the version that keeps it), not
  neither side's as `rdf_merge.py` does — neither would leave a retargeted relationship without its end.
- **`sh:maxCount 1` is read per target class**, not as a rule for every subject; shapes nested in `sh:or`,
  `sh:xone` and the like, and `sh:maxCount 0`, are not read.
- **Two placements** of one element (or relationship) in one view, one by each side, are a conflict of their own:
  the merged model keeps the node whose IRI sorts first.
- Added while building it, to report: a relationship's connection (types, ends, `rdf:reifies`, the reified and
  qualified triples) and a concept's types merge as a whole too, reported as single-value conflicts.

### Decided for Phase 1's wiring (2026-11-05)

- ***Update from main* on GitLab:** its REST API makes commits of one parent only, so a commit there cannot
  record main as merged, and the host's text merge could still conflict. la-gram commits the merged model to a
  **new branch started from main's head** and binds the model to it; its merge request replaces the old one's.
  On GitHub, a real merge commit (Git database API, both heads as parents) on the bound branch.
- **The Conflicts tab's buttons:** *Keep mine* / *Take theirs*; for a deleted concept *Keep it* / *Delete it*.
- **Saving with conflicts not chosen** asks first; it is not blocked.
- **`dcterms:modified`** set on both sides takes the later stamp, in the room and the merge, with no conflict.
- **Two placements:** the dropped side's links take their `arch:inView` with them.

### Decided while building Phase 2 (2026-11-05), to report

- **Where the branch's diff is shown:** in the History tab, as its first entry when the model is bound to a branch
  other than the default (the branch against the default since they parted: committed, or with the model now) —
  no new menu entry. And in the merge request's description.
- **The merge request's dialog** says the host's word: *Open pull request* on GitHub, *Open merge request* on
  GitLab; the File-menu entry is *Open merge request…* on both, as decided. Its title is the branch's last commit of
  the file; its description the changes by element in Markdown, editable, as they are when it is opened.
- **Offered after a save that made a new branch**, into the branch it started from (the default branch for GitLab's
  *Update from main*). Not after a save to an existing branch: *File › Open merge request…* is there.
- **Checkpoints are shown by element too**, with *As triples* for the old view.
- **The History tab reads Git without asking for a token**: a host that wants one says so in the tab, and
  *Read again* asks.

### Decided for Phase 3 (2026-11-05)

- **Name:** `@linked-archi/la-gram-git`, command `la-gram-git` (the npm organisation `linked-archi` is the user's to
  create).
- **Licence:** Apache-2.0 (`LICENSE`, added 2026-11-05). The repository is public since 2026-11-05.
- **Release:** from la-gram's own GitLab pipeline on a version tag: the npm package, and the image in the project's
  container registry. Claude writes the jobs and never runs a publish.
- **Distribution:** both a public npm package and a container image.
- **Templates:** files in la-gram's repository, to copy, with docs.
- **Shapes:** the metamodels bundled with the tool, plus `--shapes <dir>` for a repository's or organisation's own.
- **Strictness:** a check fails only on SHACL findings the request adds (compared with the target branch); the
  rest are listed. Parsing, the canonical form and missing references always fail.
- **`sh:sparql`:** run with Oxigraph in la-gram's engine, so the editor's Validation tab shows them too, and CI.
  Advisory at first in CI: they have never run on real models.
- **The diff comment:** GitHub with the workflow's own token; GitLab with a project or group access token in a
  masked CI variable, else the diff goes to the job's log.
- **A file not as la-gram writes it:** fails, printing the command that fixes it; never fixed by CI.
- **The local merge driver:** part of Phase 3, in the same package.
- **Impact** (the spec's advisory stage): not now; maybe later, from la-gram's model questions.

## Hard constraints

- Never commit, stage, stash or push. Run `git status` first, and never revert changes you didn't make.
- Tokens:
  - Tokens follow Req 18.5: sent only to their host, and never in the model, a file, the URL, the room, a log
    or an error message.
  - No token is ever configured on the room server.
  - Tests use no real tokens or real repositories; use mocked providers, as `src/git/__tests__` does.
- Names of new vocabulary, menus and packages are the user's decisions; ask before choosing them.
- Finish each change with tests, then docs (`README.md`, and the requirements, design and tasks in
  `.kiro/specs/la-gram/`, including the change log), then `npm run build`, then tell the user to reload.

## What exists today (verified 2026-11-05)

- **Identity:** IRIs are minted once and kept: `{ns}element-{uuid}` and the like (`src/rdf-engine/iri.ts`).
- **Serialisation:**
  - The output is deterministic (`compareQuads`, Req 9.12).
  - Formats that hold graphs carry the DD-15 split (`partitionModel`, `src/import-export/model-io.ts`).
  - The default Git format is Turtle, one file per model (Req 18.6).
- **Save to Git:**
  - A save names the version of the file it replaces (`expectedVersion`).
  - On a conflict la-gram offers only a new branch, overwrite, or open the newer version (`resolveConflict`,
    `src/git/git-save.ts:215`).
  - The binding keeps the file's version and the commit it was opened at (`binding.commit`, used as
    `startFrom`).
- **Providers** (`src/git/providers/provider.ts`): `readFile(ref, path)` (line 65) reads a file at any
  commit, so the merge base can be fetched. There are also `branchHead`, `defaultBranch` and `commitFile`
  (one file per commit).
- **Single values in the room:** `SINGLE_VALUED` (`src/collab/rdf-yjs-binding.ts:59`) lists bounds, point
  coordinates, link ends, list cells (`rdf:first`/`rdf:rest`), `arch:source`/`arch:target`, and
  `skos:prefLabel` (one per language).
- **Routes:** a route is an `rdf:List` whose cells are named by position, `m:link-…-points-<i>` and
  `m:link-…-p<i>` (`src/model-manager/view-manager.ts:633`).
- **Local history:** `snapshotOf` and `diffSnapshots` compare canonical N-Triples
  (`src/model-manager/version-history.ts:121`, `:134`). Checkpoints are kept in IndexedDB.
- **SHACL:** the validator skips `sh:sparql` constraints (`src/rdf-engine/shacl-validator.ts:25`), so those
  rules run nowhere today.
- **The room server** (`server/collab-server.mjs`) has no authentication.

## Corrections to the spec

1. **Hosted merges don't run custom merge drivers.**
   - §9 step 7 and C3 assume GitLab runs `merge=rdf` and that a clean filter makes the canonical form
     "impossible to bypass".
   - GitHub and GitLab.com never run custom drivers, and self-managed GitLab does only if an administrator
     configures them in Gitaly.
   - A clean filter runs only where it's installed.
   - So the merge lives in la-gram (Phase 1), and CI checks the canonical form (Phase 3).
2. **The reference merge (`rdf_merge.py`) doesn't match la-gram's model:**
   - It looks for geometry predicates that don't exist, `core-vis#x`, `width` and `point` (line 236);
     la-gram's are `bounds-x/-y/-w/-h` and `point-x/-y`.
   - It checks positions only for TriG files (line 223), but la-gram saves Turtle, with geometry, by default.
   - For TriG it merges everything into the default graph (lines 147–149), which loses the DD-15 graphs.
   - It doesn't treat labels as single-valued per language, although the spec's own acceptance test expects
     it.
3. **Routes must merge as a whole.** Merged triple by triple, two reroutes of one line make a route neither
   person drew. The same goes for a node's bounds.
4. **Deleted concepts left referenced.** The delete-versus-change check (line 156) looks only at the
   element's own triples. A relationship end, view node or folder entry added on the other side that points
   to the deleted concept would be left pointing at nothing.
5. **The room server holding a token (C8, DR-9):** with no authentication, it would break Req 18.5, and
   every commit would be the server's rather than its author's.
6. **History committed into the repository (C6):**
   - Hooks don't run for la-gram's commits (they go through the hosts' APIs) nor for merges on the host.
   - Each record needs another commit, and it duplicates Git.
7. **Smaller points:**
   - New vocabulary in meta's namespace (`https://meta.linked.archi/mms#`) is the user's naming decision;
     prefer PROV-O, as meta's DD-27 does.
   - The examples use `model.linked.archi`, not a reserved example domain; change that before publishing.
   - la-gram's browser tests run on Vitest with Playwright, not on Playwright's own test runner.

## Phase 1: merging in la-gram (C2 and C4, in TypeScript)

- [x] **Single values, defined once:** move `SINGLE_VALUED` out of the room binding into a module the room
  and the merge share. Add the loaded metamodels' `owl:FunctionalProperty` and `sh:maxCount 1` paths, and
  make labels single-valued per language (`sh:uniqueLang`, `skos:prefLabel`).
- [x] **The merge module:** a three-way merge over canonical N-Triples (base, ours, theirs), reusing
  `snapshotOf` and `diffSnapshots`.
  - Changes that don't touch each other are combined.
  - Conflicts are returned as data, never written into a file as `<<<<<<<` markers. Their kinds:
    - a single value changed differently on each side;
    - a concept deleted on one side and changed or referred to on the other, including references to it
      added on the other side;
    - a node's bounds or a line's route changed on both sides, treated as one unit each;
    - a shape's count limit broken by the combined result, checked with the in-app SHACL validator.
- [x] **Blank nodes:** warn before a Git save of a model that has them (decided 2026-11-05) — asked once a
  session per model.
- [x] ***Merge with the newer version***, offered first when a save conflicts:
  - the base is the file at `binding.commit`, theirs is the branch head, and ours is the model;
  - with no conflicts, commit with `expectedVersion` set to the head's version, merging again if the branch
    moves on in the meantime;
  - with conflicts, load the result and open a *Conflicts* panel, modelled on the Validation tab, showing
    both values to pick from. Save again once they're resolved.
- [x] ***Update from main*** (or from any branch): merge another branch into the bound one with the same
  merge. On every host, this makes a merge request mergeable without a server-side driver — on GitHub by a
  merge commit, on GitLab by a new branch from main (see *Decided for Phase 1's wiring*).
- [x] **Tests:**
  - [x] a fixture for each kind of conflict (`src/__tests__/fixtures/merge/`, *model-merge.test*);
  - [x] fast-check properties: the result doesn't depend on which side is ours, merging a model with itself
    changes nothing, and changes that don't touch each other never conflict (*model-merge.property.test*);
  - [x] a browser test with two clients saving the same bound file (`tests/browser/git-merge.spec.ts`).
- [x] **Measure:** time the merge on a large model, made up or real but only with the user's agreement. If
  it is over about 1 s, consider splitting the model into its DD-15 graphs as files. Made up, 350 000 triples
  (*model-merge-bench.test*): merging about 0.5 s; reading one version from Turtle 0.5–0.6 s, so part 2's three
  reads cost more than the merge.

## Phase 2: review in la-gram

- [x] **A diff by element** (from the spec's `semantic_diff.py`): added, removed and changed concepts, single
  values shown as old → new. For a branch compared with main, and for a commit compared with its parent
  (`src/model-manager/model-diff.ts`, worded by `model-diff-text.ts`; 200 ms on 350 000 triples). Unlike the
  reference, a line is put under the concept it is about — a view's shapes and route cells under the view, a
  relationship's triple under the relationship — rather than under its subject.
- [x] **Task 21:** the History tab shows the file's Git commits beside the checkpoints, with their changes in
  this diff and *Open this version*. Its sub-tasks are in `.kiro/specs/la-gram/tasks.md` (Task 21).
- [x] ***Open merge request*** after saving to a branch:
  - GitHub: `POST /repos/{owner}/{repo}/pulls`. GitLab: `POST /projects/:id/merge_requests`.
  - A provider method for each host, with the result's link shown (`fileCommits`, `findMergeRequest`,
    `openMergeRequest`; `src/git/git-review.ts`).
  - Req 18.4 gains the scopes: on GitHub *Pull requests: read and write*; on GitLab, `api` already covers it.

## Phase 3: CI as the safety net (C5, and C1's checker)

Part 1 done 2026-11-06 (Req 6.4, 6.12, Req 20; design *Validation*, *la-gram-git*):

- [x] `sh:sparql` in la-gram's validation engine, with Oxigraph — the editor and CI alike.
- [x] Missing references, in the same engine.
- [x] `la-gram-git` (`src/cli/`, `packages/la-gram-git/`): `check`, `fix`, `diff --comment`, `merge`, `init`;
  `cli.test` on real Git repositories; the built tool run against real `git merge`s through the driver.
- [x] The templates in `ci/` (their docs: part 2).

Found on the way, to report (2026-11-06):

- **Three of meta's rule kinds are slow in Oxigraph** — `FILTER NOT EXISTS` over a property path:
  `OrphanedElementShape` (ArchiMate 4.0 and 3.2) grows with the square of the model (31 s at 100 000 triples);
  `RelationshipEndpointConformanceShape`, `ViewElementConformanceShape` / `ElementConformanceShape` take 1–3 s on
  Archisurance. Written with `MINUS` (the same results, checked): 70 ms and 11–15 ms. **Done in
  linked-archi-meta (2026-11-06, uncommitted there), and copied into `assets/`.**
- **Meta's relationship rules disagree with its relationship tables**: `TriggeringSourceConstraint` and the
  like (triggering and flow only between behaviour elements) flag relationships the ArchiMate 4.0 tables
  permit — hundreds on the benchmark model, 20 on Archisurance. Analysed 2026-11-06: hand-written for 3.2
  (2026-04-13) from chapter 5's generic metamodel, copied to 4.0 (2026-05-03) without the "core layers"
  condition and with "(not motivation elements)" added to the message only. Run against one relationship of
  each pair the tables permit: in 4.0 the flow and triggering rules each reject about 410 (Plateau triggers
  Plateau, which the tables give as direct, among them), assignment's two 146 and 51 (22 direct: a component
  assigned to a data object or a role), access's two 93 and 24, `SpecializationSameTypeShape` 51 (10 direct); in 3.2 the same kinds, plus
  `NoRealizationOfBusinessActiveStructureShape`, `MotivationAssignmentShape`, `CoreInterfaceAssignmentShape`.
  The relationship shapes generated from the tables already check every relationship's ends. Proposed:
  remove the rules that restate the tables; keep those the tables cannot say (self-loops, cycles, one
  whole, junctions, deep specialization). **Done in linked-archi-meta (2026-11-06, uncommitted there), and
  copied into `assets/`**: 11 shapes out of 4.0's element shapes, 24 out of 3.2's (a work package realizing
  a deliverable, which 3.2's rule called deprecated, is one 3.2's figures draw); meta's docs updated.
  Archisurance now: 13 violations, none from meta's rules; validation 1.7 s, from 9.4 s.
- With both ArchiMate languages loaded, each language's generic rules (`OrphanedElementShape`, the
  viewpoint conformance rules) target `arch:Element` or every view, so Archisurance gets each such finding
  twice — once per language. **`OrphanedElementShape` scoped to each language's elements and junctions
  (2026-11-06, in meta and `assets/`).** The engine also leaves out findings about resources the model
  only refers to (the catalogue's viewpoints, found incomplete because only their types are validated).
  **The viewpoint rules are in core now (2026-11-06, the user's choice; in meta and `assets/`):** the
  five shapes moved to `core-shapes.ttl` under the 4.0 names, kept generic (any viewpoint, custom or
  another framework's); each ArchiMate version's viewpoint shapes imports core and adds none. Meta's
  `core-vis`, `archimate4` and `backstage` profiles load their viewpoint catalogue as data, and the
  diagram example's view declares a viewpoint. Archisurance: no finding twice.
- `core/core-vis-onto.ttl` states CC BY-SA 3.0, where meta's README says CC BY 4.0 for the whole.
- la-gram's public `main` on GitLab is at "sync" (2026-09-24); the work is on the local branch `refine-storage`.

Part 2:

- [x] Release from la-gram's GitLab pipeline on a version tag: the npm package, the container image
  (2026-11-06; `.gitlab-ci.yml`, tag `la-gram-git-v<version>`; `packages/la-gram-git/Dockerfile`). Not run on
  GitLab yet: the user creates the npm organisation, protects the tags, adds `NPM_TOKEN`, and tags.
- [x] The templates' docs (`ci/README.md`); the package's README; self-managed GitLab's server-side driver
  (`packages/la-gram-git/docs/gitaly.md`). On the way: the driver merges a file that is not a model as text.

The plan as first written:

- [x] **A command-line tool** in la-gram's repository, built from la-gram's engine (package name is the user's
  call). It checks:
  - that every model file parses;
  - that each file is exactly as la-gram writes it, which replaces the clean filter as the enforcement;
  - SHACL against the model's metamodel shapes, with the same messages as the editor;
  - the `sh:sparql` constraints, run with Oxigraph, closing the gap in the in-app validator;
  - that no relationship end, view node or folder entry points to something missing.
- [x] **The diff by element** (Phase 2's), posted as a comment on the merge or pull request.
- [x] **CI templates for both hosts:** a GitLab CI template, which also serves self-managed GitLab, and a
  GitHub Actions workflow.
  - GitHub Actions' own token can comment on a pull request.
  - On GitLab, posting a note needs a project or group access token in a masked CI variable, since the job
    token can't.
- [x] **A local merge driver:** the same merge for people who use `git` on the command line, set up by a
  documented init script. For self-managed GitLab, document how an administrator configures it in Gitaly,
  as an option and never a requirement.

## Phase 4: shared rooms and branches (C8, reshaped)

- [ ] A room bound to a branch: the person who shared it saves the room's model to Git from their la-gram,
  with Phase 1's merge.
  - Others in the room see that it was saved, with the commit.
  - No token goes to the server or to the other participants.
- [ ] ***Update from main*** in a room: the merge's result applies to the shared model as one change, and its
  conflicts are shown to everyone in the room.
- [ ] Revisit a server that commits for the room only after the room server has authentication. That needs a
  design of its own: whose identity, and how authorship is kept.

## Deferred

- **C6, history committed into the repository:** if queryable history is needed, CI publishes each commit's
  snapshot or delta to a store as an artefact, never as a commit.
- **C7, SPARQL at any commit:** la-gram opens any commit (Task 21) and queries it in its SPARQL tab. A server
  only if tools outside la-gram need it.
- **Splitting a model across files (DR-4):** one file per model until Phase 1's measurements say otherwise.
  Then the DD-15 three-file split first.
- **The Flexo comparison (`pilot_harness.py`):** only if Flexo becomes a real option.
- **Optional:** a Turtle layout that keeps each subject's final `.` on a line of its own, so that adding a
  triple doesn't change its neighbour's line. This gives fewer text conflicts where the host merges as
  text, but every saved file changes once.

## Still to decide

- Whether `docs/git-collaboration-spec.md` and `docs/git-collaboration/` are committed as they are, or with a
  note pointing to the corrections above.

## Done when (per phase)

- **Phase 1:** two la-gram clients saving the same bound file merge without a new branch on GitHub, GitLab.com
  and self-managed GitLab (mocked providers). A real conflict is resolved in the panel and saved. All
  fixtures and property tests pass.
- **Phase 2:** a branch's and a commit's changes are shown by element, and a merge or pull request is opened
  on both host kinds.
- **Phase 3:** a merge or pull request with a SHACL violation, a non-canonical file or a dangling reference
  fails in CI on both hosts, and a good one gets the diff as a comment.
- **Phase 4:** a room's save commits as the person who shared it, and *Update from main* reaches everyone in
  the room.
