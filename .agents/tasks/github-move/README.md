# la-gram and the kernel on GitHub

Recorded 2026-11-25. **The histories are built and checked (a trial run); nothing is pushed.** Files here:
`requirements.md` (GH-n), `design.md` (GH-DD-n), `tasks.md` (the checklist, with where it stopped) and
`build-github-history.sh`, which builds the histories that go to GitHub.

## Goal

la-gram (`tools/modellers/la-gram`) and the kernel (`tools/platform/linked-archi-kernel`) move to GitHub,
public, under `linked-archi`. la-gram 0.4.0 is the first release made on GitHub, and only there: nothing of
it is built, published or deployed by GitLab. la-gram's GitLab project is then archived.

## What was decided

Decision confirmed on 2026-11-25:

1. **The kernel first, then la-gram, on the same day.** A public la-gram has the kernel's source in
   `vendor/linked-archi-kernel-*.tgz` and sends anyone changing model logic to the kernel. It must not point
   at a repository nobody can see. The work is la-gram's: the kernel has no remote and no CI to move.
2. **The history is kept, written once for GitHub** (GH-DD-1): every commit and tag by
   `Kalin Maldzhanski <k@apptik.io>`, and the workspace's absolute path in notes written relative
   (`linked.archi/…`). Every commit hash changes. GitLab's history is never pushed to GitHub.
3. **The kernel's history starts from la-gram's** (GH-DD-2): la-gram's history of the kernel's files, up to the
   commit they were copied from, with the kernel's own commits on top. This finishes the history import
   of the kernel's `.agents/tasks/import-from-la-gram/`, in the same rewrite, as a published history must not
   change again. Its steps 2 to 5, which laid the kernel's files over as one commit, are replaced: the kernel
   has its own commits since.
4. **Both public**, under Apache-2.0 as now, with `.agents/`.
5. **la-gram's branches:** `main`, `pre-release`, `refine-storage`, `spec-alignment`, and the tags
   `la-gram-v0.1.0` to `la-gram-v0.3.0`. The branches merged into `main` (`basic-interaction`, `cleanup-menu`,
   `fix-prefix-order`, `release-0.3.0`) stay behind: their commits are in `main` (GH-DD-3).
6. **GitHub only from 0.4.0:** la-gram's release and the server's pull deploy (`../pull-deploy/`);
   la-gram-git's npm releases by trusted publishing from GitHub Actions, its image on ghcr.io;
   `.gitlab-ci.yml` gone. GitLab's project archived after the switch.
7. **Names:** `linked-archi/la-gram`, as `ops/pull-deploy/la-gram-pull.conf.example` has it;
   `linked-archi/kernel`, as its npm name `@linked-archi/kernel`; la-gram-git's image
   `ghcr.io/linked-archi/la-gram-git`, as `ghcr.io/linked-archi/rdf2docs`.
8. **The archived GitLab project is private** (GH-DD-8): it keeps the old history, with its own hashes and
   identities. It is made private once 0.4.0 is installed on app.linked.archi. Until then the app's Help
   menu (`REPOSITORY`, the issue tracker) and la-gram-git 0.1.0's npm page link to it. Desktop installs of 0.3.0
   keep those links, which then no longer open: accepted. la-gram-git's image at `registry.gitlab.com` stops
   being pulled without an account: its users move to ghcr.io's.

## The history

`build-github-history.sh <new folder>` builds both histories from the local checkouts, into bare repositories
in that folder, and checks them. It pushes nothing and changes neither checkout. It refuses a checkout with
uncommitted changes (`--allow-dirty` for a trial). It needs `git-filter-repo` on `PATH`.

Trial run, 2026-11-25, on la-gram's `b4efe20` and the kernel's `5a7cfc2`:

| | Result |
|---|---|
| la-gram | 195 commits, as before; 4 branches, 3 tags; one identity; no home path and no other address in any commit, tag or file version; each branch tip with the same files, but for 5 notes under `.agents/tasks/notation-fallback*/`, whose paths are now relative |
| kernel | 98 commits of la-gram's history of its files, up to `406a827`; its own 8 on top, the tip with the same files but for `.agents/tasks/import-from-la-gram/README.md` (relative paths) |
| cited hashes | On `pre-release`, 20 places in 10 files cite a commit by hash; in the kernel, 3 in 2 files. `cited-hashes.txt` in the folder lists each with its new hash, for every branch: the other branches cite the same commits in older copies, left as they are |

A commit that exists now gets the same new hash in every run (same commits, same rules), so a run after
more commits changes nothing above but adds to it.

## Push

Both repositories created empty on GitHub: no README, licence or `.gitignore`. Then, from the folder the
build wrote, branches and tags only:

```sh
cd <folder>/kernel.git && git push git@github.com:linked-archi/kernel.git 'refs/heads/*:refs/heads/*' 'refs/tags/*:refs/tags/*'
cd <folder>/la-gram.git && git push git@github.com:linked-archi/la-gram.git 'refs/heads/*:refs/heads/*' 'refs/tags/*:refs/tags/*'
```

Never `git push --mirror`, and never from a checkout that still has the old history (GH-DD-4). The kernel's
push runs its workflow on `main`. la-gram's runs nothing (GH-DD-5): its workflow first runs on a pull request.

## The checkouts follow GitHub

Done on 2026-11-25, after `git bundle create .git/pre-github-history.bundle --branches --tags` in each, as
the history before the move. The working trees keep their ignored files (`node_modules/`, task folders):
only the branches move (GH-DD-6). GitLab's remote fetches no tags (`remote.gitlab.tagOpt --no-tags`), which
would be the old ones.

la-gram:

```sh
git remote rename origin gitlab
git remote add origin git@github.com:linked-archi/la-gram.git
git fetch origin --prune --tags --force          # the tags, rewritten, replace the old ones
git checkout -B pre-release origin/pre-release   # the branch checked out: only the 5 notes change on disk
for b in main refine-storage spec-alignment; do git branch -f "$b" "origin/$b"; done
for b in main pre-release refine-storage spec-alignment; do git branch -u "origin/$b" "$b"; done
git branch -D basic-interaction cleanup-menu fix-prefix-order release-0.3.0
git status                                       # nothing to commit
git log --all --format='%an <%ae>' | sort -u     # once the gitlab remote is gone: one identity
```

After GitLab is archived: `git remote remove gitlab`, then `git reflog expire --expire=now --all && git gc --prune=now`
to drop the old commits.

The kernel, which has no remote yet:

```sh
git remote add origin git@github.com:linked-archi/kernel.git
git fetch origin
git checkout -B main origin/main
git branch -u origin/main main
```

Its old commits are dropped with la-gram's, after GitLab is archived.

The workspace (`tools/platform/linked-archi-workspace`) installs the kernel's archive and needs nothing.

## Relationship to other work

| Work | How it bears on this |
|---|---|
| [Pull deploy](../pull-deploy/) | Waits for the repository on GitHub. Its GitHub settings, server install and switch-over are steps here; its *With the move of the repository* list is this task's |
| [Kernel migration](../kernel-migration/) | Its work in progress is committed before the build, in both checkouts |
| The kernel's `.agents/tasks/import-from-la-gram/` | Its history import is done here (decision 3) |
| `tools/modellers/la-gram-vscode/package.json` | Links to la-gram's GitLab project. Another repository: changed with it, not here |
