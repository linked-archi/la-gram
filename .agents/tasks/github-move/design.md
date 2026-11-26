# Design: la-gram and the kernel on GitHub

## Key design decisions

**GH-DD-1. Written once, with git-filter-repo, in mirror clones.** `build-github-history.sh` clones each checkout
(`git clone --mirror --no-local`), keeps branches and tags, and runs git-filter-repo with a mailmap (every
identity to one, GH-2), literal replacements of the workspace's and the home folder's absolute paths, in files
and messages, and `--replace-refs delete-no-add`. git-filter-repo also rewrites the hashes commit messages cite.
The mailmap is built from the repository: the script refuses any identity under another name, so another
contributor's commits would keep their author. Why a mirror clone: the checkouts stay as they are until the
result is pushed and checked, and a run can be repeated.

**GH-DD-2. The kernel's history: a graft onto la-gram's.** The kernel's first commit (2026-11-21, "init")
is grafted (`git replace --graft`) onto la-gram's `406a827` (`3ef817d` on GitHub) ("drag views into views", six minutes earlier),
filtered to the kernel's files, and git-filter-repo makes the graft part of the history. `406a827` is the
la-gram commit whose files differ least from the kernel's first commit. The 22 that differ are the 14 tests
left in la-gram (KD-4), the adapted turtle-writer test, and the 7 files synced again on 2026-11-23, which la-gram
had changed after the copy. The kernel's first commit therefore shows what the kernel did differently from
la-gram, and every later kernel commit keeps its files (GH-4). Of the import README's way, laying the
kernel's files over as one commit, this keeps the kernel's own 7 commits.

**GH-DD-3. Merged branches stay behind.** A branch merged into `main` adds no commit to the history. The
release branch's tag (`la-gram-v0.3.0`) keeps the release.

**GH-DD-4. Branches and tags only.** The push names `refs/heads/*` and `refs/tags/*`. `--mirror` would push
whatever else the clone has, and replace refs would name the old commits.

**GH-DD-5. The first push runs no la-gram workflow.** `main` has no workflow yet, `pre-release` is not a branch
the workflow runs on for a push, and the tags were made before it. Its first run is the pull request from
`pre-release` to `main`, once the settings and environments of `../pull-deploy/tasks.md` are in place. The
rulesets come after the push: one requiring pull requests on `main` refuses the first push.

**GH-DD-6. The checkouts move their branches, not their folders.** A new clone would lose what Git ignores
there: `node_modules/`, the builds, the task folders under `.agents/tasks/` that are not tracked. The branches
are reset to GitHub's, and only the files GH-2 changed change on disk.

**GH-DD-7. The kernel's CI leaves out the timing tests.** They time the runner, which a shared runner's
neighbours slow, as la-gram's workflow leaves out its own. `npm test` runs them locally.

**GH-DD-8. GitLab private after 0.4.0 is live.** The archived project keeps the history as it was before GH-2,
so it is not left public. It becomes private only once app.linked.archi serves 0.4.0, whose links point to
GitHub: before that, the app's Help menu sends people to GitLab. Desktop installs of 0.3.0 keep their GitLab
links, which then stop opening. la-gram-git was never released from GitLab, so nothing published depends on it.
