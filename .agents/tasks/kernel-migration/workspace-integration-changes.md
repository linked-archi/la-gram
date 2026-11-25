# Why la-gram changes during workspace completion

Updated 2026-11-24 at the user's request to justify every la-gram change. Existing unrelated work is retained.
The workspace must edit the same RDF through the same model implementation; independent copies can diverge.
These changes originate in the kernel and are mirrored here until L01 consumes its package.

## Changes made so far

| File | Change | Why needed | Existing la-gram behaviour |
|---|---|---|---|
| `src/metamodel-manager/bundled-assets.ts` | Optional per-call asset base URL/version for `assetUrl` and `fetchAssetText` | An embedded workspace can be served from a different path than its host; two instances must not change a global base | Without options, Node discovery and document-relative URLs/cache version stay as before |
| `src/metamodel-manager/asset-sources.ts` | Optional settings on each `BundledAssetSource` passed to asset loading | Carries that host configuration through the normal metamodel loader without a second loader implementation | Existing no-argument construction remains valid |
| `src/model-manager/provenance.ts` | Optional software IRI/name/version on `EditProvenance`; cleanup uses the supplied identity | Workspace edits must identify the workspace, rather than be attributed to la-gram | Absent software settings retain la-gram's identity/version and cleanup rules |
| `src/model-manager/version-history.ts` | Optional database name on `IndexedDbVersionStore` / `createVersionStore` | Both apps can share an origin without mixing checkpoints | Default remains la-gram's existing channel-scoped database |
| `src/rdf-engine/validation-service.ts` | Optional worker factory; default worker explicitly uses module mode | Vite hosts need module workers and may need to choose their own worker URL/CSP integration | Inline mode is unchanged; webpack's default worker remains created from the same source; browser validation must be verified |
| `src/rdf-engine/observable-store.ts` | `dispose()` cancels pending writes, clears subscriptions and frees the inner store | Removing/replacing an embedded workspace must release resources, including queued WASM writes | Existing callers are unaffected until they explicitly dispose a store |

## Verification and transition

- Before these changes: kernel typecheck and 837 tests passed. The new shared editor tests pass six scenarios
  covering canonical reload, edit/undo/redo, relationships, recovery, validation and the ArchiMate fixture.
- Run the kernel suite and la-gram's own typecheck/tests/build/browser checks after integration; the baseline
  result is not a claim that the modified la-gram has already passed.
- No model modules or assets have been removed from la-gram yet. Before removal, compare with the packaged
  kernel, record each moved module, and prove the web/desktop/CLI consumers load that package.
- Additional changes and their evidence will be added here as implementation proceeds.

## Migration implementation and file-level record (2026-11-24)

The optional compatibility changes above now live only in the kernel. The source-level comparison passed before
removing copies (one previously adapted writer test excepted). `migration-manifest.json` names every removed file,
its destination and checksum, every moved test, and every source file whose imports changed.

| Files | Justification |
|---|---|
| `package.json`, `package-lock.json`, `vendor/linked-archi-kernel-0.1.0.tgz` | Pin the identical installed archive the workspace uses; remove the retired local sync-assets script. A tarball avoids separate RDF dependency instances. |
| `webpack.config.js` | Compile the installed TypeScript package for web/Electron, bundle it in the CLI, and copy/digest its assets. Existing output asset URLs stay the same. |
| `tsconfig.json`, `vitest.config.ts` | Remove obsolete source aliases and let Vitest transform the installed source package. |
| Every file under `migration-manifest.json#imports` | Mechanical import path change to the shared implementation; no UI or modelling behavior changes. |
| Every file under `migration-manifest.json#removed` | Remove redundant modules, tests, bundled assets and synchronizer after equivalence checks. Their maintained destination is the kernel. |
| `src/__tests__/kernel/*` | Retain the 14 app-dependent tests and their Basic fixture next to the app; shared implementation imports use the package. The questions fixture reads assets from that package. |
| `src/ui/canvas/__tests__/custom-shapes.test.ts`, `decoration-symbols.test.ts`, `notation-shape-fixtures.ts` | Read the actual installed asset snapshot instead of the removed source asset directory. |
| `src/ui/__tests__/mount-ui.test.ts`, `src/ui/canvas/__tests__/notation-fallback-integration.test.ts` | Locate the retained Basic fixture after its move. |
| `src/__tests__/cli-build-assets.test.ts` | Keep its isolated copy fixture valid now that the asset source is inside the installed kernel. |
| `src/cli/__tests__/package.test.ts` | Follow bundled kernel imports while checking external runtime dependencies; the CLI does not ship a TypeScript runtime dependency. |
| `src/__tests__/kernel-package.test.ts` | Verify one instance of each RDF runtime and kernel asset copying for all three model-reading outputs. |
| `src/__tests__/workspace-interoperability.test.ts` | Verify the real la-gram App and the workspace session exchange complete RDF with both tools' provenance. |
| `.agents/tasks/kernel-migration/rewrite-imports.mjs`, `migration-manifest.json`, `tasks.md`, this document | Reproducible migration, file inventory, reasons, and measured results for review. |

The workspace task's `external-files.json` lists every external file changed for this work. Unrelated owner changes
in `docs-site/operating/web-app.md` are excluded from the migration commit.

Verification: kernel 844 tests; la-gram 2041 tests plus the new App interoperability test; all 95 browser tests;
web/Electron/CLI builds; direct and packed CLI smoke checks; complete two-way browser handoff. Documentation and
API inventory are the owner's next requested step and are not marked complete yet.

## Documentation follow-up — owner step 3

Every path changed in this step:

- `README.md`: package ownership, supported metamodel selection and asset upgrade workflow.
- `.agents/conventions.md`: actual file tree and package-based shared-code/asset maintenance.
- `.agents/specs/la-gram/requirements.md`: Req 1.9 describes the installed snapshot and one runtime implementation.
- `.agents/specs/la-gram/design.md`: module locations, package build contract and asset ownership.
- `.agents/specs/la-gram/tasks.md`: implementation evidence and current ownership; gates stay evidence-based.
- `docs-site/developing/assets.md`: removes local synchronization instructions; documents kernel package upgrades.
- `docs-site/developing/building.md`: asset copying and digest source are the installed kernel.
- `docs-site/developing/index.md`: source layers and complete-model I/O location; four RDF partitions.
- `docs-site/developing/testing.md`: separates kernel-owned tests from retained application integrations.
- `.agents/tasks/kernel-migration/inventory-api.mjs` and `api-usage.md`: reproducible list of the 59 module paths,
  exported names and application callers needed by K02 (KM-12).
- `.agents/tasks/kernel-migration/tasks.md` and this document: measured completion and reasons.

Validation: strict documentation build passed. No runtime behavior changed in this step.

## Owner step 4: neutral kernel boundary

- `src/__tests__/workspace-interoperability.test.ts` is replaced by `src/__tests__/kernel-interoperability.test.ts`:
  la-gram verifies the canonical shared fixture through its real App, without importing the workspace's application
  session from the kernel. The full two-application browser handoff remains in the workspace suite.
- `package.json`, `package-lock.json`, and `vendor/`: take the same 0.1.1 archive as the workspace. It removes the
  application-specific exports and retains neutral SHACL descriptors and RDF mutation helpers. Existing modeller
  call signatures are unchanged; the asset-source factory only gains an optional per-instance bundled URL setting.
- This task's API inventory and results are refreshed after validation. No canvas or UI behavior is changed.

- `docs-site/developing/assets.md`: updates the package command to the qualified 0.1.1 filename; this is the
  consumer update procedure, not a local asset synchronization command.

## S01 asset refresh and migration closure checks — 2026-11-25

| Files | Reason |
|---|---|
| `package.json`, `package-lock.json`, `vendor/linked-archi-kernel-0.1.1.tgz` (removed), `vendor/linked-archi-kernel-0.1.2.tgz` | Keep both applications on the exact same kernel and metamodel bytes. The new archive carries the source S01 annotations and reader. |
| `src/import-export/__tests__/model-io.test.ts` (removed) | The kernel runs the identical assertions. Removing the duplicate leaves the real App handoff test and CLI integrations here. |
| `src/__tests__/fixtures/merge/*.trig` and `src/__tests__/fixtures/diff/changes.trig` (removed) | The kernel owns the tests that consume these 15 byte-identical fixtures. The manifest lists each removed path and hash. |
| `docs-site/developing/assets.md` | Update the example archive filename to the verified revision. |
| `.agents/specs/la-gram/design.md` | Point the merge and diff test references to the kernel that runs them. |
| `.agents/tasks/kernel-migration/{tasks.md,migration-manifest.json,workspace-integration-changes.md}` | Record the checks, test ownership and why each file changed. |

KM-11 compared the pre-migration and current App on the documentation and merge base models. The Turtle and
TriG outputs matched byte for byte. The two-application browser handoff checked saved RDF after real form and
canvas edits, including the declared metamodel, geometry and provenance in the 3.2 case.
