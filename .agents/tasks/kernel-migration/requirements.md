# la-gram on @linked-archi/kernel — requirements

Recorded 2026-11-20. KM numbers belong to this task. When it lands, the criteria that describe la-gram's behaviour
are added to la-gram's requirements (Req 1.9 and Req 15, *Web & Desktop*) without renumbering them.

## Before the switch

- **KM-1 One code base at the switch.** When la-gram first builds on the package, its copies of the moved files are
  identical to the kernel's, except the one test the kernel adapted (`turtle-writer.test.ts`). A difference found by
  the comparison (`tasks.md`, Stage 0) is ported to the kernel first.

## The dependency

- **KM-2 An installed package.** la-gram depends on `@linked-archi/kernel` as an installed package: a tarball from
  the kernel's `npm pack` until K02 publishes a version, then a version range from the registry. Never a `file:`
  link to the kernel's folder (KM-DD-2).
- **KM-3 One copy of each RDF library.** `n3`, `oxigraph` and `rdf-validate-shacl` are installed once, and every
  bundle and every test run uses that one copy. A test fails when a second copy can be resolved from the kernel's
  modules.
- **KM-4 The n3 pin holds everywhere.** la-gram's and la-gram-git's `package.json` pin n3 at the version the
  kernel's `turtle-writer.ts` names (`N3_VERSION`), and a test in la-gram checks the three agree. That check came
  across in the kernel's copy, and la-gram keeps its own.

## Builds

- **KM-5 Every target.** The web app, the desktop app's renderer, main and preload, and la-gram-git build with the
  kernel's modules compiled from the package's TypeScript (kernel KD-2).
  - The validation worker is still built as its own chunk in the web and desktop builds.
  - The build-time globals the kernel reads (`__LA_GRAM_ASSETS_VERSION__`, `__LA_GRAM_BUILD__`) are still
    defined for its code.
- **KM-6 la-gram-git bundles the kernel.** The command-line tool's bundle holds the kernel's code: Node, which runs
  it, never loads the kernel's TypeScript. `packages/la-gram-git/package.json` keeps its dependencies (`n3`,
  `oxigraph`, `rdf-validate-shacl`), and its packed tarball checks the smoke model.
- **KM-7 The bundled metamodels come from the kernel.** All three targets copy `assets/` from the installed kernel,
  and the assets digest is computed from those files. `?assets=` behaves as before, and la-gram has no `assets/` of
  its own.
- **KM-8 No aliases for moved code.** `@rdf-engine`, `@metamodel-manager` and `@model-manager` are removed from
  `webpack.config.js`, `vitest.config.ts` and `tsconfig.json`. No file imports through them today.

## Tests

- **KM-9 The kernel's tests run in the kernel.** The 49 test files that moved are deleted here; the kernel's CI runs
  them.
- **KM-10 The 14 tests that stayed keep running.** They move to `src/__tests__/kernel/`, importing la-gram's
  application relatively and the kernel's modules by package path, and they pass unchanged otherwise. The list is in
  the kernel's copy manifest.
- **KM-11 Behaviour unchanged.** Typecheck, the unit suite, the browser suite (`npm run test:browser:build`), the
  docs build and la-gram-git's checks pass. `docs-site/examples` and the merge fixtures' base model save
  byte-identically before and after.

## Hand-over

- **KM-12 la-gram's calls, recorded for K02.** The kernel module files and exported names la-gram imports, written to
  `api-usage.md` here, so K02 can freeze an API that la-gram can use.
- **KM-13 Asset refresh is the kernel's.**
  - `scripts/sync-assets.mjs`, `src/__tests__/sync-assets.test.ts` and `npm run sync-assets` are removed here.
  - A refresh is a new kernel version that la-gram takes.
  - `docs-site/developing/assets.md` says so.
- **KM-14 Specifications and documentation say where the code lives:**
  - in this repository: `README.md`, `.agents/conventions.md` (file structure, finishing a change), the design
    (paths to the moved modules), Req 1.9, `docs-site/developing/` (`assets.md`, `building.md`, `testing.md`,
    `index.md`) and the change log;
  - in the kernel: the section *While la-gram still holds a copy*, removed from its conventions when this task ends.
- **KM-15 History says where it went.** The commit that deletes la-gram's copies names the kernel commit they match.
