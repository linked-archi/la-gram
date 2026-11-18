# Git synchronization: pull, remote checks and optional auto-commit

Recorded 2026-11-17. **Stages 1–3 complete.** The user agreed to these three
increments and asked that they be documented beside the existing pending Git work before coding.

## Goal

A model opened from Git can incorporate changes to its own branch without saving first, report remote
changes regularly, and optionally commit local changes regularly. Local edits survive synchronization;
conflicts are resolved with the existing merge engine and Conflicts tab.

## Relationship to the existing work

- [Task 19, Git storage](../../specs/la-gram/tasks.md): open/save is implemented.
- Tasks 20 and 21: settings and Git history are implemented. Req 18.23 currently says that History is
  never polled. This work introduces a separate check of the bound model file, not polling its history.
- [Git collaboration, Phases 1–3](../git-collaboration/tasks.md): reuse merging, review and the CI/CLI
  infrastructure. This work does not depend on the recorded pending CLI release.
- Git collaboration Phase 4, shared rooms and branches, remains pending. The original
  [C8 proposal](../../../docs/git-collaboration-spec.md) described room polling and server commits;
  the adapted plan defers server committing until room authentication exists.

This increment handles an individual editor with no collaboration room. Its new pull and automation
are inactive in a shared room until Phase 4 supplies a single committer and shared conflict handling.
Existing manual Git operations keep their present room behaviour.

## Agreed direction

1. **Pull from Git** incorporates the bound file's latest version on the current branch without committing.
2. **Regular remote checks** report incoming changes; optional automatic pull applies them only when the
   model has no changes relative to its Git baseline.
3. **Optional auto-commit** saves changed models after an idle period or at an interval, checking and
   merging the remote version first. Manual commits remain the default; automation pauses on conflicts.

These are client operations using the existing GitHub/GitLab providers and the user's credentials.
There is no new vocabulary, Git clone, server-held token or background service running after the app closes.

## Settings

Regular checks, clean-only automatic pull and destination-scoped auto-commit are implemented.

| Setting | Values and default | Scope |
|---|---|---|
| Check for remote changes | **Off**, every 1, 2, 5 or 10 minutes | Personal default; only the active bound model |
| Pull automatically when unchanged locally | **Off**, On | Only when regular checks are enabled |
| Auto-commit | **Off**, after idle, at an interval | Explicit opt-in for one model, host, repository, branch and file |
| Idle period | 1, **2**, 5 or 10 minutes without model edits | When after-idle mode is selected |
| Commit interval | 5, **10**, 15 or 30 minutes | When interval mode is selected; only if changed |

Auto-commit enablement names its destination. A new binding never inherits write enablement from a
different destination; remembered enablement is local to the same model and destination. A personal
working branch is the recommended destination. The commit message uses the existing message template.

## Files and next step

- [requirements.md](requirements.md): acceptance criteria, GS-1–GS-24; manual pull is Req 18.24.
- [design.md](design.md): integration, state, concurrency and lifecycle decisions.
- [tasks.md](tasks.md): staged checklist and dated hand-off.

Manual pull is implemented in `src/git/git-pull.ts` and the File menu, with the existing merge and
Conflicts tab. Stage 2 adds `git-observation.ts`, `git-sync.ts`, `git-locks.ts` and the Git status tab.
Stage 3 adds `auto-commit-settings.ts` and `git-auto-commit.ts`: explicit idle/interval settings, persistent
pause/resume, remote reconciliation and an immutable write with a durable fingerprint journal.
Uncertain responses pause for bounded remote confirmation and explicit Resume. The implementation
is Req 18.26 and key design decision 31. Shared-room Phase 4 remains pending.
