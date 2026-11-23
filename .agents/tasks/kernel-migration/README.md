# la-gram on @linked-archi/kernel (L01)

Recorded 2026-11-20. **Not started.** It starts when the kernel repository's K01 tests pass. Files here:
`requirements.md` (KM-n), `design.md` (KM-DD-n) and `tasks.md`, the checklist.

## Goal

la-gram builds and runs on `@linked-archi/kernel`, the package its model logic moved to, and keeps no copy of that
logic. Nothing la-gram does changes: the same screens, files, findings and commands.

## Why

The Linked.Archi workspace, an EA workspace over the same models, uses the same model logic. If two copies of that
logic were kept, the two tools would drift apart: different IRIs, triples or findings for the same edit. One package
used by both keeps a model either tool saves one the other would have saved. See platform decision PD-14
(`linked-archi-platform/docs/decisions.md`).

## Relationship to other work

| Work | Where | How it bears on this |
|---|---|---|
| K01, the kernel repository | `tools/platform/linked-archi-kernel` | Copied 2026-11-20 from this repository's working tree on `basic-interaction`. This task starts when its tests pass |
| K02, the kernel's public API | the kernel repository | Freezes the API from the calls the workspace and la-gram make. This task records la-gram's calls for it (KM-12) |
| L02, la-gram's canvas as a web component | this repository, later | Waits for this task, so the workspace and la-gram share one kernel at runtime |
| The workspace's W02 | `tools/platform/linked-archi-workspace` | Meets the same packaging questions (KM-DD-2, KM-DD-3), and should answer them the same way |
| [IRI layout](../iri-layout/README.md), [Git sync](../git-sync/README.md) | here | Done or in progress in the code that moves; their behaviour moves unchanged |

## What moves, and what stays

**Moves** to the kernel: `src/rdf-engine/`, `src/metamodel-manager/` and `src/model-manager/`, with
`src/import-export/model-io.ts`. With them go:

- their tests, except 14;
- the merge and diff fixtures;
- `scripts/sync-assets.mjs` and its test;
- `assets/`.

The kernel repository's `.agents/tasks/import-from-la-gram/copy-manifest.json` lists every file.

**Stays** in la-gram:

- everything else: `app.ts`, `ui/`, `git/`, `cli/`, `layout/`, `collab/`, `platform/`, the rest of `import-export/`;
- the 14 tests that need la-gram's application. They test the kernel's modules through it, and keep doing so against
  the package.

## Agreed direction

1. **Sync first.** Anything la-gram changed in these modules after 2026-11-20 goes to the kernel before the switch:
   la-gram's copy and the kernel's must be identical when la-gram starts using the package (KM-1).
2. **Switch mechanically.** Import paths change, and nothing else. The kernel's provisional exports reach every
   module file by its path, so `../model-manager/model-diff.js` becomes
   `@linked-archi/kernel/model-manager/model-diff.js` (KM-DD-1).
3. **Consume it as an installed package, not a linked folder** (KM-DD-2): a packed tarball until K02 publishes, then
   a registry version.
4. **Delete the copies**, `assets/` included, in the same branch, once every build and test passes on the package.
5. **One rule while both copies exist:** a fix to these modules is made in the kernel first and copied here in the
   same piece of work. New behaviour goes into the kernel only. The rule ends with this task.

## Done when

1. **Every target builds on the package:** the web app, the desktop app and la-gram-git.
2. **Every check passes:** typecheck, the unit suite, the browser suite, the docs build, and la-gram-git's check of
   `docs-site/examples` and its smoke model.
3. **Saved files are unchanged:** the example models save byte-identically before and after.
4. **No copies remain:** `src/` holds none of the three modules or `model-io.ts`, and there is no `assets/` folder.
5. **The documentation says where the code now lives.**
