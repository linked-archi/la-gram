# la-gram on @linked-archi/kernel — tasks

Recorded 2026-11-20. **Implementation verified 2026-11-24; documentation follow-up remains.** Criteria refer to [requirements.md](requirements.md); the stages and choices
are in [design.md](design.md).

## Owner-requested sequence, 2026-11-24

1. [x] Re-read PD-16, PD-17 and WD-15. ArchiMate 4.0 is the bundled default; the chosen metamodel controls content.
2. [x] Check current integration: workspace typecheck, 34 tests, library/site build, all 11 CSP host checks;
   la-gram browser **4 files / 95 tests**; Electron main/preload/renderer build; CLI `check` on
   `docs-site/examples` and `packages/la-gram-git/smoke`; packed CLI installed in a clean temporary consumer and
   checked the smoke model. All passed. Build size warnings remain.
3. [x] `scripts/verify-interoperability.mjs` passed in the workspace: canonical download, field edit, exact
   undo/redo, protected dirty configuration, durable recovery, views/questions, la-gram canvas rename, and
   complete RDF equality on return. Both browser error lists were empty.
4. [x] la-gram unit suite **118 files / 2041 tests**, plus the added real-App interoperability test, passed.
5. [x] Kernel verification commit: `fa73c6ef49b6b4b63fd62a1c531502dade8c5257` (source checkpoint `0cee219`).
   The copies removed by this migration match that kernel's source; the manifest records each destination and hash.
6. [x] Step 3: complete KM-12–14 docs/API inventory and remove the kernel's copy-transition instructions.
7. [ ] Step 4: remove the workspace-specific facade from the kernel; adjust this task's consumer tests/package only.

E1/A is **open**, pending ArchiMate 3.2 and a Studio-generated extension, fixed-screen implementation, and the
remaining local acceptance criteria. Browser file handoff does not close shared persistence or live-room gates.

## Documentation before implementation

- [x] Record the goal, what moves and what stays, the order and the transition rule (2026-11-20).
- [x] Write requirements (KM-1–15) and design (KM-DD-1–6) from the code as it was on 2026-11-20.
- [x] Make the task folder visible to Git (`.gitignore`), like `git-sync`.
- [x] List it under *Queued next* in `.agents/specs/la-gram/tasks.md`.

## Stage 0: one code base

- [x] The kernel's K01 tests pass in the kernel repository.
- [x] Commit la-gram's work in progress on these modules.
- [x] Compare: `diff -r` of `src/rdf-engine`, `src/metamodel-manager`, `src/model-manager`, `model-io.ts`, the
      fixtures and `assets/` against the kernel. Port every difference to the kernel, with its test (KM-1).
- [x] `npm pack` in the kernel.

## Stage 1: the package beside la-gram's copies

- [x] Install the tarball (KM-2); `npm ls n3 oxigraph rdf-validate-shacl` shows one copy each (KM-3).
- [x] `ts-loader` rules, la-gram-git `externals`, Vitest `server.deps.inline` (KM-DD-3).
- [x] `KERNEL_ASSETS` in `bundledAssetsPlugin`, la-gram-git's copy and `assetsVersion()` (KM-DD-4, KM-7).
- [x] Remove the three aliases (KM-8).
- [x] `npm run typecheck`, `npm test`, `npm run build` pass.

## Stage 2: imports

- [x] `rewrite-imports.mjs`; run it; review: only import lines changed (KM-DD-1).
- [x] `npm run typecheck`, `npm test`, `npm run build`, `npm run test:browser:build` pass.

## Stage 3: delete the copies

- [ ] Delete the three modules, `model-io.ts` and its test, `assets/`, the moved tests and fixtures, `sync-assets`
      and its test and npm script (KM-9, KM-13).
- [x] Move the 14 to `src/__tests__/kernel/`; add *kernel-deps.test* and *kernel-assets.test* (KM-10, KM-3, KM-4, KM-7).
- [ ] Every check in KM-11, including la-gram-git's check of `docs-site/examples` and the smoke model, and
      byte-identical saves of the example models.
- [ ] `npm run package` once (design, *Open questions*).
- [x] The commit names the kernel commit the deleted files match (KM-15).

## Stage 4: documentation

- [x] `api-usage.md`: the kernel files and names la-gram imports (KM-12).
- [x] la-gram: `README.md`, `.agents/conventions.md`, the design's module paths, Req 1.9, `docs-site/developing/`,
      the change log (KM-14). `npm run docs:build` passes.
- [x] Kernel: remove *While la-gram still holds a copy* from its conventions; tick L01 in its plan.
- [ ] Platform: L01 done in `linked-archi-platform/docs/plan.md`.

## Documentation result — owner step 3, 2026-11-24

KM-12: `api-usage.md` inventories **59 module paths**, exported names and callers from the application TypeScript;
`inventory-api.mjs` reproduces it. KM-13/14: README, conventions/file tree, requirements, design, task log and
four developing pages now describe the installed kernel. Obsolete local synchronization instructions are removed.
The kernel's copy-transition section is removed, and its README/design/plan describe package delivery.
`npm run docs:build` passed with strict MkDocs: no warnings. No runtime code changed in this documentation step.

Checkboxes above record the final checked implementation, not separate green intermediate commits. The initial
source work was already checkpointed by the owner; the implementation commits are kernel `fa73c6e`, la-gram
`5bc9123`, workspace `65e6cd7`. The retained ModelIO consumer regression test and shared merge/diff fixtures remain
in la-gram because app/CLI tests consume them; their ownership will be reconciled in the next package cleanup.
Historical byte-for-byte fixture-save comparison, the optional Electron packaged artifact, and platform roadmap
closure are left unchecked where no new evidence was collected. L01 consumption is implemented; E1/A is open.

## Owner step 4 — neutral package boundary, 2026-11-24

- [x] Package 0.1.1 removes the workspace application facade; same archive installed in both consumers.
- [x] Consumer interoperability test now exercises the real App against neutral shared RDF fixtures.
- [x] Typecheck and **119 files / 2,042 tests**; full web/Electron/CLI build; CLI documentation and smoke checks pass.
- [x] Browser suite: **4 files / 95 tests**; two-application browser handoff, isolated installed CLI smoke check
  and strict docs build all pass.

Every changed la-gram file and its reason is in `workspace-integration-changes.md`. No production canvas code changed.
