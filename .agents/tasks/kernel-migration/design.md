# la-gram on @linked-archi/kernel — design

Recorded 2026-11-20, before the work. The numbers below were counted on 2026-11-20 in the working tree on
`basic-interaction`.

## What changes in la-gram

| Part | Today | After |
|---|---|---|
| The moved code | `src/rdf-engine/`, `src/metamodel-manager/`, `src/model-manager/`, `src/import-export/model-io.ts` | in `node_modules/@linked-archi/kernel/src/`, same paths |
| Imports of it | 221 relative import statements in 67 source files; 180 in 59 test files | `@linked-archi/kernel/<module>/<file>.js` |
| Source files importing it | `ui/` 123 statements, `app.ts` 32, `cli/` 22, `git/` 20, `layout/` 9, `import-export/` 9, `collab/` 5, `index.ts` 1 | the same files, new paths |
| `assets/` | 271 files, copied by three webpack targets, digested by `assetsVersion()` | read from the installed kernel |
| Tests | 49 moved test files here; 14 that stayed | 14, in `src/__tests__/kernel/` |
| `sync-assets` | `scripts/sync-assets.mjs`, its test, `npm run sync-assets` | the kernel's |

## KM-DD-1 Switch the import paths mechanically

The kernel's provisional exports (kernel KD-5) map `@linked-archi/kernel/*.js` to `src/*.ts`. Because the kernel kept
la-gram's paths (kernel KD-1), each import is rewritten by a rule:

```
'../model-manager/model-diff.js'           → '@linked-archi/kernel/model-manager/model-diff.js'
'../../rdf-engine/iri.js'                  → '@linked-archi/kernel/rdf-engine/iri.js'
'../import-export/model-io.js'             → '@linked-archi/kernel/import-export/model-io.js'
'./model-manager/index.js' (from app.ts)   → '@linked-archi/kernel/model-manager/index.js'
```

- **How.** The rewrite is a script, `tasks/kernel-migration/rewrite-imports.mjs`, run once and kept here. It
  resolves each relative specifier against its file and rewrites only those that land in a moved file; any other
  import is left as it is. Its diff is reviewed as a diff of import lines only: `git diff --stat` before deletion
  shows no other line changed.
- **No API change here.** K02 narrows the exports later, and la-gram then follows the frozen names in a change of
  its own. `api-usage.md` (KM-12) is what K02 freezes them from.
- **Why not one import of the package root.** The root exports each module as a namespace, so every call site would
  change from `diffModels(…)` to `modelManager.diffModels(…)`. That is far more than an import-path change, and the
  names are not frozen yet.

## KM-DD-2 An installed package, not a linked folder

`"@linked-archi/kernel": "file:../../platform/linked-archi-kernel"` would make `node_modules/@linked-archi/kernel` a
link to the kernel's folder, which has its own `node_modules/`. Imports from the kernel's files would then find the
kernel's copies of `n3` and `oxigraph` first. That means two n3s, whose terms are different classes, and two Oxigraph
WebAssembly instances. A bundler following the link also sees the files outside `node_modules`, so rules keyed on
`node_modules` would not apply.

So la-gram installs a **tarball**: `npm pack` in the kernel, then
`"@linked-archi/kernel": "file:../../platform/linked-archi-kernel/linked-archi-kernel-0.0.0.tgz"`. npm unpacks it
into `node_modules/` with no `node_modules/` of its own and dedupes its dependencies against la-gram's. From K02, a
registry version replaces it.

A test (KM-3) resolves `n3`, `oxigraph` and `rdf-validate-shacl` from the kernel's `package.json` and from la-gram's,
and expects the same file.

## KM-DD-3 Compile the kernel's TypeScript where la-gram compiles its own

The kernel publishes TypeScript (kernel KD-2). Three places in la-gram's build skip `node_modules`, and each needs a
change.

| Place | Today | Change |
|---|---|---|
| webpack's `ts-loader` rule, in `sharedModuleRules` and la-gram-git's own rule | `exclude: /node_modules/` | `exclude: /node_modules\/(?!@linked-archi\/kernel\/)/`, with `allowTsInNodeModules: true` in the loader's options |
| la-gram-git's `externals` | every bare import stays an import, for Node to resolve | `@linked-archi/kernel` and its subpaths are bundled. Node never loads `.ts` (KM-6). n3, oxigraph and rdf-validate-shacl stay external, as la-gram-git's `package.json` declares them |
| Vitest | externalizes `node_modules`, so Node would import the kernel's `.ts` | `test.server.deps.inline: ['@linked-archi/kernel']` in `vitest.config.ts` |

`tsc --noEmit` type-checks the kernel's files that la-gram imports. The kernel uses la-gram's compiler options
(kernel `tsconfig.json`), so it reports the same as before.

The web and desktop builds parse the kernel's `new Worker(new URL('./validation.worker.ts', import.meta.url))` as
they parse la-gram's own: the worker chunk is still emitted (KM-5). la-gram-git turns worker parsing off as before,
and no worker runs in Node.

## KM-DD-4 The bundled metamodels come from the installed kernel

```js
const require = createRequire(import.meta.url);
const KERNEL_ASSETS = path.join(path.dirname(require.resolve('@linked-archi/kernel/package.json')), 'assets');
```

The constant replaces `path.resolve(__dirname, 'assets')` in three places:

- `bundledAssetsPlugin()`, used by the web and desktop renderer builds;
- la-gram-git's `CopyWebpackPlugin`;
- `assetsVersion()`.

The copies land at `assets/` in each output, as today, so URLs and `?assets=` modes do not change.

The kernel finds the assets in Node by walking up from its own module:

- under Vitest, that is `node_modules/@linked-archi/kernel/src/metamodel-manager/`, which reaches the kernel's
  `assets/`;
- in la-gram-git's bundle, `import.meta.url` is the bundle's (`importMeta: false`), which reaches the copy beside
  `dist/`, as today.

## KM-DD-5 Tests

- **Moved tests** are deleted here (KM-9). The kernel runs them; la-gram's CI does not.
- **The 14 that stayed** move to `src/__tests__/kernel/` (KM-10). They import `../../app.js` and la-gram's UI or
  command-line files relatively, and the kernel's by package path.
  - Two used `../../../scripts/bench-model.mjs` only through the moved timing tests, so `scripts/bench-model.mjs`
    stays for `npm run bench:model`.
- **Two new tests:**
  - *kernel-deps.test.ts* (KM-3, KM-4): one copy of each RDF library; the n3 pins agree.
  - *kernel-assets.test.ts* (KM-7): `assetsVersion()` reads the kernel's `assets/`; every file the bundled-asset
    registry names exists there.

## KM-DD-6 Order: one branch, staged, each stage green

| Stage | Work | Green means |
|---|---|---|
| 0 | Compare la-gram's moved files with the kernel's; port differences to the kernel; `npm pack` it | `diff -r` shows only `turtle-writer.test.ts` |
| 1 | Install the tarball; build-config changes (KM-DD-3, KM-DD-4); remove the aliases | build and tests pass on la-gram's own copies, the kernel installed beside them |
| 2 | Rewrite the imports (KM-DD-1) | everything passes on the package; la-gram's copies are now unused |
| 3 | Delete the copies, `assets/`, the moved tests, `sync-assets`; move the 14; add the two tests | every check in KM-11 |
| 4 | Documentation and specifications (KM-13, KM-14); `api-usage.md` (KM-12) | the docs build; the kernel's transition section removed |

One commit per stage: a stage that fails can be reverted on its own.

## Open questions

| Question | Decided in |
|---|---|
| Whether `ts-loader` compiles files from a tarball under `node_modules` with `allowTsInNodeModules`, or the rule needs `onlyCompileBundledFiles` | Stage 1 |
| If K02 renames the build flags or makes the asset base a setting, la-gram's `DefinePlugin` and `assetUrl` callers change with it | the K02 change, in la-gram at the same time |
| Electron packaging (`scripts/package-electron.mjs`): it copies from `dist/`, so it should need no change | Stage 3, by running `npm run package` once |
| `src/storage-scope.ts`, copied to the kernel on 2026-11-23 because `version-history.ts` imports it. la-gram's settings, tokens and Git bindings use it too. If K02 has made the checkpoints' store name the caller's, la-gram keeps its file and the kernel's copy goes; otherwise la-gram imports the kernel's | Stage 2, after K02 |
