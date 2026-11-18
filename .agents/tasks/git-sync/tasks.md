# Git synchronization checklist

Recorded 2026-11-17. **Stages 1–2 complete; Stage 3 not started.** Criteria refer to
[requirements.md](requirements.md); the integration choices are in [design.md](design.md).

## Documentation before implementation

- [x] Record scope, existing behaviour, proposed defaults and the separation from shared-room Phase 4.
- [x] Write planned requirements and design, including Git baseline, in-flight edits and lifecycle.
- [x] Link this work beside the pending Git collaboration tasks and from that plan.
- [x] Make the new task folder visible to Git without staging files or exposing other ignored task folders.

## Stage 1: manual Pull from Git

- [x] Extract reconciliation without a commit; retain existing save-conflict and cross-branch behaviour (GS-1–6).
- [x] Read the incorporated base and capture the latest snapshot after I/O; handle undo and local-file saves correctly (GS-4–5, GS-13, GS-17).
- [x] Coordinate manual Git operations and reject obsolete results after model/destination changes (GS-5, GS-18–19).
- [x] Wire Pull from Git, status and the existing Conflicts tab; keep room usage out of this increment (GS-1–6, GS-8, GS-19).
- [x] Test clean and dirty pulls, same-branch changes, disjoint edits, conflicts, no-op/undo, missing base/file,
      model replacement, edits in flight, pending branch merges, and both providers (GS-23).
- [x] Run the required checks; update the main specs, README, Git guide and change log for this stage (GS-24).

## Stage 2: periodic checks and optional clean-only pull

- [x] Add settings, check-only status and the manual check action (GS-7–9, GS-22).
- [x] Add single-owner scheduling, cancellation, visibility/connectivity handling and backoff (GS-11, GS-18–20).
- [x] Add automatic pull only for an unchanged working model, checked again immediately before applying (GS-10).
- [x] Test due times with a fake clock, unchanged files on moved heads, dirty models, duplicate clients,
      credentials, policy restrictions, rate limits, stop/resume and late replies; no history polling (GS-23).
- [x] Run the required checks; document the actual defaults and active-client timing limits (GS-24).

## Stage 3: optional auto-commit

- [ ] Add per-destination opt-in, idle/interval modes and explicit pause/resume (GS-12, GS-15, GS-22).
- [ ] Reuse commit primitives without dialogs; reconcile remote changes and skip identical content (GS-13–16).
- [ ] Preserve edits made during a commit; reconcile uncertain write responses before retries (GS-17, GS-21).
- [ ] Test conflict pause, manual resume, missing tokens, blank-node/pending-merge decisions, concurrent remote
      saves, snapshot changes during writes, no-op/undo and destination changes (GS-23).
- [ ] Browser-test settings, status, manual operations alongside automation, and keyboard access using fake
      Git hosts; check web and desktop wiring (GS-22–23).
- [ ] Run type checking, unit and browser suites, app build and strict docs build; update all user docs,
      task statuses and limitations. Leave shared-room Phase 4 pending (GS-24).

## Where it stopped

2026-11-18: Stage 2 is complete. The Git tab reports
local/incoming changes and check timing, and File offers a manual Check action. Settings are Off / 1 / 2 /
5 / 10 minutes, with clean-only automatic pull Off by default. `git-observation.ts` caches immutable
base/remote snapshots independently of the binding; `git-sync.ts` captures the latest working model
and rechecks the clean-only condition synchronously before applying. Model status updates debounce
effective store changes by 150 ms. Automatic work never commits or opens a credential dialog.

`git-locks.ts` uses a queued owner lock per destination plus a separate short operation lock for manual
and automatic flows. The owner releases when hidden, offline, stopped, in a room or blocked by a
manual decision; waiting editors retain independent Git bases. Unsupported/denied lock APIs pause
automation and preserve manual actions. Lifecycle/settings transitions invalidate in-flight reads;
network/server/rate-limit failures back off up to ten minutes or the host's later retry time.

Verification: type checking, all 2,595 unit tests, all 90 browser tests, the web/desktop/CLI build,
strict docs build and `git diff --check` pass. The eleven Git browser tests include settings, keyboard
Check, automatic clean-only pull, local-file saves and two actual tabs with handover on close. The Git
status screenshot was inspected. Stage 3 optional auto-commit is next; its write-specific concurrency and
failure safeguards are still pending. Shared-room Phase 4 is also pending. No staging, commits,
pushes or real repository writes were performed.
