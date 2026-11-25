# Tasks: la-gram and the kernel on GitHub

## Done (2026-11-25)

- [x] Decisions (README.md)
- [x] la-gram's history checked: no commit, message or file version names company data; the only token-like
      strings are test fixtures (`config.test`, `git-open.test`, `git-save.test`)
- [x] `build-github-history.sh`; trial run with `--allow-dirty` passed (README.md, *The history*) (GH-2 to GH-6)
- [x] The kernel's `.github/workflows/kernel.yml` and `.github/dependabot.yml`; its unused `.gitlab-ci.yml`
      removed. `npx vitest run --project unit`, the workflow's command, passes (51 files, 851 tests) (GH-7)

- [x] Names and GitLab's visibility decided (README.md, decisions 7 and 8)
- [x] The kernel's `package.json` (`repository`, `homepage`, `bugs`) and `README.md`: GitHub; its link to la-gram,
      a path into the workspace, now la-gram's repository

- [x] Work in progress committed: la-gram `b4efe20`, the kernel `5a7cfc2`; trial run again on them, passed

**Stopped here, 2026-11-25:** both on GitHub, both checkouts following it. The kernel's first run failed on
a test timeout. The fix, `vitest.config.ts` with la-gram's `testTimeout` and its change-log entry, is in the
kernel's working tree: to commit and push to `main`. Next: 5.

## 1. Before the build

- [x] `git status` clean in both: la-gram `93900a5`, the kernel `cbb620b`

## 2. Build

- [x] `build-github-history.sh`, without `--allow-dirty`: all checks pass. la-gram 196 commits, 4 branches,
      3 tags; the kernel 98 + 9 commits
- [x] `cited-hashes.txt`, the commits cited by hash with their new hashes, kept here for 5. `406a827` is
      `3ef817d` on GitHub

## 3. On GitHub

- [x] Both repositories public, empty before the push; descriptions; la-gram's homepage
      `https://app.linked.archi/la-gram/`
- [x] Both: workflow permissions *Read repository contents*; Actions may not create or approve pull requests
- [x] la-gram's environments: `production`, required reviewer `linked-k`, self-review allowed, deployments
      from tags `la-gram-v*` only; `alpha`, from branch `main` only
- [x] Pushed, the kernel then la-gram, branches and tags only. GitHub's refs are exactly the build's. One
      contributor in each. la-gram's push ran no workflow (GH-DD-5)
- [x] Secret scanning and push protection on, both
- [ ] The kernel's workflow passes on `main`. First run, 2026-11-25: 850 of 851 unit tests passed;
      `model-merge.property.test.ts` timed out at Vitest's 5 s (6.9 s on the runner, 0.7 s in a local full run)
- [x] la-gram's rulesets: `main`, pull requests with no approval needed (one maintainer), the checks `test`,
      `web` and `docs`, no force-push or deletion, no bypass; `release tags`, `refs/tags/la-gram-v*`
      created, moved or deleted only by admins and maintainers (`la-gram-alpha` not included)
- [ ] `.github/CODEOWNERS` in la-gram (`/.github/` and `/ops/`), then *Require review from Code Owners* in
      the `main` ruleset
- [x] The kernel's `main`: no ruleset, direct pushes for now. Decision confirmed on 2026-11-25

## 4. The checkouts follow GitHub

- [x] Each checkout's history before the move kept in `.git/pre-github-history.bundle` (branches and tags):
      the kernel's existed nowhere else, la-gram's `pre-release` not on GitLab
- [x] la-gram: GitLab is the remote `gitlab`, without tags; `origin` is GitHub; the four branches on
      GitHub's, the tags replaced, the merged branches deleted; one identity on branches and tags
- [x] The kernel: `origin` GitHub, `main` on GitHub's; one identity
- [ ] Old commits dropped (`git reflog expire`, `git gc`) in both, with the `gitlab` remote's removal (7),
      not before: until then the old history is at hand

## 5. la-gram, GitHub only (a pull request; GH-8, GH-9)

- [ ] *With the move of the repository* in `../pull-deploy/tasks.md`: `src/help-links.ts` (`REPOSITORY`,
      `RELEASES`), `webpack.config.js` (`repository`; `GITHUB_SHA`, `GITHUB_REF_TYPE` for `CI_COMMIT_*`),
      `mkdocs.yml` `extra.social`
- [ ] la-gram-git in `.github/workflows/la-gram.yml`: npm by trusted publishing (OIDC, provenance); the image to
      ghcr.io, `linux/amd64` and `linux/arm64`, tags version, major, `latest`; the header comment
- [ ] npmjs.com: `@linked-archi/la-gram-git`'s trusted publisher is GitHub Actions, `linked-archi/la-gram`,
      `la-gram.yml`
- [ ] `.gitlab-ci.yml` out; `src/__tests__/release-pipeline.test.ts` out or reduced to what remains
- [ ] The links: `packages/la-gram-git/` (`package.json` `repository`, `README.md`, `Dockerfile`, `ci/`),
      `ci/README.md` and its templates, `README.md`, and `docs-site/` (`developing/specifications.md`,
      `developing/releasing.md`, `operating/container-image.md`, `operating/ci.md`, `index.md`,
      `getting-started/desktop.md`); `src/ui/__tests__/help.test.ts`, `src/__tests__/version-page.test.ts`
- [ ] The hashes in `cited-hashes.txt` updated in their files (GH-6), and in the kernel's. Not in
      `build-github-history.sh`: its `KERNEL_BASE` is a commit of the old history, which it reads. In this
      task's README and design, the new hash beside the old
- [ ] `.agents/specs/la-gram/`: requirements, design, the change-log entry; `CLAUDE.md` and `conventions.md`
      link to the kernel's repository
- [ ] Tests, build, `npm run docs:build`
- [ ] The pull request: `test`, `package`, `web`, `docs` pass; merged, the alpha published

## 6. The kernel's documents

- [ ] `.agents/specs/kernel/tasks.md`: "the clean GitLab CI run" → GitHub Actions; publication (K02) to npm,
      not GitLab's package registry; the change-log entry
- [ ] `.agents/tasks/import-from-la-gram/README.md`: history imported (this task, GH-DD-2); its checklist ticked,
      "Remote created (GitLab)" → GitHub
- [ ] `.agents/README.md`, `AGENTS.md`: no GitLab

## 7. The switch-over and GitLab

- [ ] The server's pull deploy: *On the server* and *In the repository, with the switch-over* in
      `../pull-deploy/tasks.md`
- [ ] GitLab: `DEPLOY_SSH_KEY` and the deploy variables deleted; the description pointing to GitHub; archived
- [ ] la-gram checkout: `gitlab` remote removed, old commits dropped (README.md)
- [ ] `tools/modellers/la-gram-vscode/package.json`: its link to GitLab, with that repository's own change

## 8. Release 0.4.0

- [ ] Tag `la-gram-v0.4.0` on GitHub: the Release, la-gram-git on npm and ghcr.io, the server installs it
- [ ] app.linked.archi serves 0.4.0: then the GitLab project private (GH-DD-8)
