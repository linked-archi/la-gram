# Design

Recorded 2026-11-17. **Stages 1–2 implemented; automatic commits remain planned.** This builds on `src/git/`; it does not introduce another
storage layer or replace the existing model merge engine.

## GS-DD-1: distinguish observing a remote version from incorporating it

Keep three separate notions:

| State | Meaning |
|---|---|
| Incorporated base | `GitBinding.commit` and `version`: remote state already represented in the working model |
| Last observation | Most recent checked head/file version and check time; a read-only status |
| Current working model | Canonical model snapshot from the RDF store, including local edits |

Never advance the incorporated base during a check-only request. Otherwise the next merge could treat
remote changes not present locally as local deletions. Manual pull reads the base at the bound commit; `git-observation.ts` caches that immutable snapshot and the last observed head/file for scheduled checks. Read a moved head's file at that immutable commit, not via a branch name again.
An unrelated commit may move the head while leaving the model file unchanged: report no incoming
model changes. Ignore serialization-only ordering differences when comparing canonical snapshots.
Each open editor keeps its own incorporated base: another tab's persisted binding update must not
silently advance this editor's base while its working model still holds the earlier version.

Use Git-specific snapshot comparison, not just `app.isDirty()`: a local file save can clear the app's
unsaved marker without committing to Git. Manual pull captures the current snapshot after all I/O and merges/applies synchronously. Scheduled
checks also capture the latest snapshot after I/O. Local-status updates debounce effective store changes
by 150 ms; do not serialize the entire model on every pointer movement.

## GS-DD-2: separate reconciliation from committing

`git-merge.ts` exports `reconcile`, shared by Save’s merge-with-newer path and manual pull. It
merges and applies without committing. `git-pull.ts` handles pinned reads, validation, lifecycle checks,
binding updates and result messages; `Access` supplies the existing public/private read flow.
`updateFromBranch` keeps its existing behaviour. `git-sync.ts` owns scheduling/status, while
`applyGitObservation` shares the final synchronous application and an extra clean-only guard.

Return explicit outcomes: unchanged, remote incorporated, merged with local changes, conflicts, needs
attention, or obsolete request. Applying a result uses `MergeSupport.replace`, the existing recorded
store change and `MergeSupport.conflicts`. Preserve the active view/selection where they still exist.
Register the new base only after parsing, identity checks and application succeed. Undo changes the
working snapshot, not the remote base; it must therefore make the restored version a local Git change.

A no-local-change pull never needs a commit. A dirty pull merges but does not commit. Once a pull's
conflicts are chosen, manual Save to Git records the result. A pending `binding.update` is left to the
existing cross-branch merge flow so its parentage/branch handling is not lost.

## GS-DD-3: make asynchronous results conditional on their inputs

Manual pull captures model identity, full binding, incorporated base and model-loaded generation.
After each read (including failures), verify the destination/lifecycle and room state. Capture the
working snapshot only after all reads, then merge/apply with no await: in-flight edits are included
without a revision retry loop. Stopping the module invalidates pending reads. Automatic commit writes
will additionally need snapshot revision tracking across their asynchronous work.

The planned auto-commit stage must serialize a particular snapshot. If more edits arrive during the write, update the successful
binding to the returned commit but keep those edits dirty; the current `saved()` callback must not
unconditionally clear them. A result for a model no longer open may record the successful commit for
its original binding, but must not replace, rebind or mark clean the newly open model. Report a completed
write even if the operation was stopped locally: an HTTP request already sent cannot be assumed cancelled.

## GS-DD-4: one scheduler, one operation, one automation owner

The controller is owned by `git/module.ts` and disposed through `stop()`. A common local gate and
short operation lock coordinate manual flows and scheduled checks. Use a completion-scheduled timeout,
not overlapping interval callbacks. The clock, visibility, connectivity, locks and providers are injected
for tests. Effective store mutations debounce local status independently of the app dirty marker.

Use browser-profile ownership keyed by host/repository/branch/path to elect the one automatic checker (and, in Stage 3, writer),
and a separate short-lived operation lock shared by manual and automatic mutations. A long-held
ownership lock must not prevent a manual save in another tab. Prefer Web Locks when available; when
ownership cannot be established, pause automation with a visible reason rather than allowing duplicate
writers. Recheck the remote after acquiring the operation lock. Across devices the provider's
expected-version check remains authoritative. No new leader or token is introduced on the collaboration
server.

Pause timers while hidden/offline and in shared rooms. On resume, check the remote once when due and
only then evaluate auto-pull or auto-commit. Permission failures need a user action; network/rate-limit
failures back off. Reuse host error classification and extend it only where retry metadata is needed.
Stopping or changing settings invalidates reads already in flight. An uncertain commit response is
reconciled by reading the remote before another write.

## GS-DD-5: automatic writes are a separate, explicit opt-in

Automatic checks and clean-only pull can use personal Git defaults. Auto-commit enablement is scoped
to the model and complete destination, persisted locally alongside bindings/settings without tokens;
switching to a new branch/file does not inherit enablement. Use the existing credential store without
prompts in background work and existing `commitMessage`/serialization code.

Extract a commit primitive that accepts a prepared snapshot and message without opening dialogs;
manual save wraps it with the existing prompts. Background operations cannot select overwrite, create
a branch, skip a blank-node warning or save unresolved conflicts. Auto-commit checks the remote even
when scheduled read-only checks are off. It can merge non-conflicting local and remote changes; the
clean-only restriction belongs to automatic pull, not to this pre-commit reconciliation.

Idle mode resets its deadline on model edits. Interval mode commits only when the Git snapshot differs.
Both remain paused after a conflict until a manual save or explicit resume. No-op pulls, status changes
and remote checks do not reset the idle timer or trigger commits of their own.

## GS-DD-6: status is visible and independent of history

Manual pull reports progress and results through existing notifications and the Conflicts tab.
The Git bottom tab shows destination, local/incoming changes, last successful check, next scheduled
check, current settings and a pause/error reason. Its badge indicates New, Paused, checking or errors.
It offers **Check for remote changes**, **Pull from Git** and **Git settings…**; File also exposes Check.
Background updates never open the tab or a dialog. Last-commit timing and auto-commit pause/resume are
for Stage 3. Settings are Off/1/2/5/10-minute checks and clean-only automatic pull Off/On, both Off by
default; turning checks off cancels/invalidate pending scheduled work.

Keep `HistoryGitSource` lazy: no periodic commit-history requests. Pull/commit updates its source key as
existing Git operations do. Checks leave `binding.commit` unchanged and therefore do not pretend a
new remote version has been incorporated.

## Integration and deferred work

Implementation touches `src/git/module.ts`, `git-save.ts`, `git-merge.ts`, `bindings.ts`,
`settings-section.ts`, their tests, and the UI/dirty-state hooks as required. Reuse `model-merge.ts`,
`merge-support.ts`, credentials and both providers. Add no dependency without a concrete need.

Shared-room hydration, a designated room committer, shared conflict choices, server authentication,
webhooks and server-side automatic commits remain in [Git collaboration Phase 4](../git-collaboration/tasks.md).
This task does not finish that phase or implement release publishing, multi-file models or new providers.
