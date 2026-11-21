# la-gram on @linked-archi/kernel — tasks

Recorded 2026-11-20. **Not started.** Criteria refer to [requirements.md](requirements.md); the stages and choices
are in [design.md](design.md).

## Documentation before implementation

- [x] Record the goal, what moves and what stays, the order and the transition rule (2026-11-20).
- [x] Write requirements (KM-1–15) and design (KM-DD-1–6) from the code as it was on 2026-11-20.
- [x] Make the task folder visible to Git (`.gitignore`), like `git-sync`.
- [x] List it under *Queued next* in `.agents/specs/la-gram/tasks.md`.

## Stage 0: one code base

- [ ] The kernel's K01 tests pass in the kernel repository.
- [ ] Commit la-gram's work in progress on these modules.
- [ ] Compare: `diff -r` of `src/rdf-engine`, `src/metamodel-manager`, `src/model-manager`, `model-io.ts`, the
      fixtures and `assets/` against the kernel. Port every difference to the kernel, with its test (KM-1).
- [ ] `npm pack` in the kernel.

## Stage 1: the package beside la-gram's copies

- [ ] Install the tarball (KM-2); `npm ls n3 oxigraph rdf-validate-shacl` shows one copy each (KM-3).
- [ ] `ts-loader` rules, la-gram-git `externals`, Vitest `server.deps.inline` (KM-DD-3).
- [ ] `KERNEL_ASSETS` in `bundledAssetsPlugin`, la-gram-git's copy and `assetsVersion()` (KM-DD-4, KM-7).
- [ ] Remove the three aliases (KM-8).
- [ ] `npm run typecheck`, `npm test`, `npm run build` pass.

## Stage 2: imports

- [ ] `rewrite-imports.mjs`; run it; review: only import lines changed (KM-DD-1).
- [ ] `npm run typecheck`, `npm test`, `npm run build`, `npm run test:browser:build` pass.

## Stage 3: delete the copies

- [ ] Delete the three modules, `model-io.ts` and its test, `assets/`, the moved tests and fixtures, `sync-assets`
      and its test and npm script (KM-9, KM-13).
- [ ] Move the 14 to `src/__tests__/kernel/`; add *kernel-deps.test* and *kernel-assets.test* (KM-10, KM-3, KM-4, KM-7).
- [ ] Every check in KM-11, including la-gram-git's check of `docs-site/examples` and the smoke model, and
      byte-identical saves of the example models.
- [ ] `npm run package` once (design, *Open questions*).
- [ ] The commit names the kernel commit the deleted files match (KM-15).

## Stage 4: documentation

- [ ] `api-usage.md`: the kernel files and names la-gram imports (KM-12).
- [ ] la-gram: `README.md`, `.agents/conventions.md`, the design's module paths, Req 1.9, `docs-site/developing/`,
      the change log (KM-14). `npm run docs:build` passes.
- [ ] Kernel: remove *While la-gram still holds a copy* from its conventions; tick L01 in its plan.
- [ ] Platform: L01 done in `linked-archi-platform/docs/plan.md`.
