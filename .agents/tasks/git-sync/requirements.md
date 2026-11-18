# Requirements

Recorded 2026-11-17. **Manual pull is Req 18.24; regular checks and clean-only pull are Req 18.25; auto-commit remains planned.** GS numbers belong to this task. When stages land, add their
acceptance criteria to Req 18 and Req 19 without renumbering existing criteria.

## Manual pull

- **GS-1.** A bound model offers **Pull from Git** for its current repository, branch and file. It does
  not select another branch, create a branch or write a Git commit.
- **GS-2.** A pull reads the file at a pinned head commit. With no local Git changes, it applies that
  version; with local changes, it merges the incorporated base, current model and remote version.
- **GS-3.** A merge uses the existing model merge rules and Conflicts tab. It preserves disjoint edits;
  conflicting values retain the merge engine's held version until chosen. Resolving a pull's conflicts
  does not itself commit. A further pull waits until those conflicts have been resolved.
- **GS-4.** Applying a pull is one undoable model change through the existing store-change path. Its
  remote base advances to the incorporated head; undo restores the prior model as local changes against
  that base. A pull with identical model content creates no undo entry.
- **GS-5.** A pull does not discard edits made during its network requests or mark them saved. It checks
  the active model and binding, and captures the latest working snapshot immediately before applying a result. A switched model or
  destination never receives the previous operation's result.
- **GS-6.** An absent file/branch, unreadable base, different model identity, parse failure or denied
  access leaves local data and the incorporated base intact and explains what needs attention. A pending
  cross-branch merge (`binding.update`) must be finished through the existing manual flow first. Blank
  nodes that cannot be matched safely between versions stop the pull without applying changes.

## Remote checks and automatic pull

- **GS-7.** A configurable interval checks the active bound file for changes, with a manual **Check for
  remote changes** action too. It distinguishes changes to that file from unrelated repository commits.
- **GS-8.** Checking does not change the model, its incorporated base or its dirty state. The visible
  status distinguishes checking, no incoming changes, incoming changes, local changes, conflicts and
  paused/error states, and gives the destination and last successful check time.
- **GS-9.** History remains demand-loaded under Req 18.23. A remote check does not fetch the history list;
  a successful pull or commit refreshes the bound History source through the existing mechanism.
- **GS-10.** Automatic pull is opt-in. It applies incoming changes only when the current model equals
  its Git baseline immediately before application and there are no unresolved conflicts. With local
  changes it reports incoming changes and leaves pulling to the user.
- **GS-11.** Background checks never open authentication or confirmation dialogs. Missing credentials
  or permission pause the operation with an action the user can take. Existing host restrictions and
  token retention rules apply to every request.

## Optional automatic commits

- **GS-12.** Auto-commit is off by default and enabled explicitly for a particular model and Git
  destination. It supports idle and interval modes with the proposed settings in [README.md](README.md).
  Manual Save to Git and its message prompt remain available.
- **GS-13.** Only model content different from the incorporated Git baseline is committed. Undoing
  changes back to that baseline, or saving the same model repeatedly, produces no automatic commit.
  Saving a local file does not falsely make the model unchanged relative to Git.
- **GS-14.** Before an automatic commit, read the remote file and reconcile newer content using the same
  three-way merge as manual pull. Commit only a conflict-free result, naming the file version it replaces.
  A concurrent remote change leads to a bounded re-read/re-merge, never an overwrite fallback.
- **GS-15.** Conflicts pause auto-commit and are visible in the existing Conflicts tab. Finishing conflict
  choices does not silently publish: a manual save or explicit resume is required. Blank-node warnings,
  a pending cross-branch merge, or any condition requiring a manual decision pause automation too.
- **GS-16.** An automatic commit uses the existing message template, user's token/account and serialization
  format. It never opens a merge request, chooses another destination or creates a branch on its own.
- **GS-17.** An edit during a commit request remains a local change after the commit succeeds. The binding
  records the successful commit, but the app marks clean only if its current model equals what was committed.

## Lifecycle and completion

- **GS-18.** One operation at a time changes a binding/model: manual pull/save/update and automatic work
  cannot overlap. Within the same browser profile, only one tab/window automates a given destination;
  other devices still rely on the provider's expected-version check.
- **GS-19.** Schedulers stop or invalidate pending results when Git is disabled/unavailable, the model
  closes, its binding changes, the app is disposed, or a collaboration room is joined. New pull and
  automation are inactive in rooms for this increment; Phase 4 remains responsible for room integration.
- **GS-20.** Hidden, offline or suspended clients do not accumulate scheduled requests. On returning,
  perform at most one due check before proceeding; exact background timing is not guaranteed. Network
  failures and rate limits use bounded backoff and any retry information available from the host.
- **GS-21.** A transport failure after sending a commit is an uncertain result: reconcile with the remote
  before retrying. Do not blindly duplicate a commit. Failed requests never mark the model saved.
- **GS-22.** Settings and status are available in both web and desktop, with keyboard-operable controls.
  No token, status or scheduler configuration is written into model RDF or shared with a room.
- **GS-23.** Deterministic tests cover merges, conflicts, no-op saves, in-flight edits, stale requests,
  timers, duplicate-client ownership, pause/resume and provider errors using fake hosts and clocks.
  Browser tests verify the actual controls and status; no real repository writes are used for tests.
- **GS-24.** Each stage is finished with the repository's required type check, unit/browser tests, app
  build and strict documentation build. User-facing documentation states the implemented defaults,
  scope and limitations; the task list distinguishes completed stages from those still pending.
