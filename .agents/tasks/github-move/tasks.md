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

- [x] Work in progress committed: la-gram `478a967`, the kernel `4c17b7e`; trial run again on them, passed

**Stopped here, 2026-11-25:** 5 and 6 written, in the working trees: to commit (la-gram on `pre-release`,
the kernel on `main`), then la-gram's pull request from `pre-release` to `main`, whose run is the workflow's
first. Its `test`, `web` and `docs` must pass for it to merge. Not checked by `actionlint` here; the YAML parses
and `pull-deploy.test` checks its jobs.

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
      from tags `la-gram-v*` only; `alpha`, from branch `main` only; `la-gram-git`, required reviewer
      `linked-k`, from tags `la-gram-git-v*` only
- [x] Pushed, the kernel then la-gram, branches and tags only. GitHub's refs are exactly the build's. One
      contributor in each. la-gram's push ran no workflow (GH-DD-5)
- [x] Secret scanning and push protection on, both
- [x] The kernel's workflow passes on `main` (`894c295`). Its first run failed one property test at Vitest's 5 s
      (`model-merge.property.test.ts`: 6.9 s on the runner, 0.7 s in a local full run): la-gram's `testTimeout`
      of 20 s, lost when the kernel's configuration was adapted, is back
- [x] la-gram's rulesets: `main`, pull requests with no approval needed (one maintainer), the checks `test`,
      `web` and `docs`, no force-push or deletion, no bypass; `release tags`, `refs/tags/la-gram-v*` and
      `refs/tags/la-gram-git-v*` created, moved or deleted only by admins and maintainers (`la-gram-alpha` not
      included)
- [x] `.github/CODEOWNERS` in la-gram (`/.github/` and `/ops/`). *Require review from Code Owners* stays off:
      GitHub lets no one approve their own pull request, so with one maintainer it would hold every change
      there. Recorded (2026-11-25), not started: turn it on with a second maintainer
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

- [x] *With the move of the repository* in `../pull-deploy/tasks.md`: `src/help-links.ts` (`REPOSITORY`, exported,
      `RELEASES`, the issues), `src/ui/help.ts` (*Every release, on GitHub*), `scripts/version-page.mjs` (GitHub's
      `/releases/tag/`, `/tree/`, `/commit/`), `webpack.config.js` (`repository`; `GITHUB_SHA`, none when
      `GITHUB_REF_TYPE` is `tag`), `mkdocs.yml` `extra.social` — *version-page.test, help.test*
- [x] la-gram-git in `.github/workflows/la-gram.yml`: the tag `la-gram-git-v*` (`version` checks it, `cli`);
      `package` on it, its packed file the artifact; `npm`, environment `la-gram-git`, trusted publishing with
      provenance, `NPM_TOKEN` for the first publish only; `image` on `ubuntu-24.04` and `ubuntu-24.04-arm` and
      `image-tags` (version, major, `latest`) to `ghcr.io/linked-archi/la-gram-git`; `web` and `docs` not on it;
      the header comment, and `.gitlab-ci.yml`'s reasons (desktop signing, the example model) brought over
      — *pull-deploy.test, package.test*
- [x] `.gitlab-ci.yml` out; `release-pipeline.test.ts` out, its operating-page checks moved to
      *pull-deploy.test*; *package.test* reads the workflow
- [x] The links: `packages/la-gram-git/` (`package.json` `repository`, `homepage`, `README.md`, `Dockerfile`),
      `ci/README.md` and its templates, `README.md`, and `docs-site/`; *Releasing* written again for the workflow
      and the server's side; *Hosting the web app*, *Container image*, `ops/pull-deploy/README.md`
- [x] The hashes in `cited-hashes.txt` updated in their files (GH-6), and in the kernel's. Not in
      `build-github-history.sh`: its `KERNEL_BASE` is a commit of the old history, which it reads. In this
      task's README and design, the new hash beside the old
- [x] `.agents/specs/la-gram/`: Req 15.8, 15.10, 20.9; Req 15.11 (installed by the server) and 15.12 (GitHub
      only); design's *Releases* and *Release*, key design decision 43; the change-log entry. `conventions.md`
      links to the kernel's repository
- [x] Tests, build, `npm run docs:build` (2026-11-25; see the change log)
- [ ] The pull request: `test`, `package`, `web`, `docs` pass; merged, the alpha published
- [ ] npmjs.com, at la-gram-git's first release: `NPM_TOKEN` in the environment `la-gram-git` first; after it,
      the trusted publisher (GitHub Actions, `linked-archi/la-gram`, `la-gram.yml`, environment
      `la-gram-git`), then the secret deleted and the token revoked; the image's visibility *Public* on ghcr.io

## 6. The kernel's documents

- [x] `.agents/specs/kernel/tasks.md`: the checks on GitHub Actions; the hashes; publication (K02):
      *To decide*, npm or GitHub Packages, now that GitLab's package registry is gone
- [x] `.agents/tasks/import-from-la-gram/README.md`: history imported (this task, GH-DD-2); its checklist ticked,
      the remote on GitHub
- [x] `.agents/README.md`, `AGENTS.md`: no GitLab in either
- [ ] To decide: the kernel's publication (K02)

## 7. The switch-over and GitLab

- [ ] The server's pull deploy: *On the server* in `../pull-deploy/tasks.md`; its *In the repository* part is
      done here (5)
- [ ] GitLab: `DEPLOY_SSH_KEY` and the deploy variables deleted; the description pointing to GitHub; archived
- [ ] la-gram checkout: `gitlab` remote removed, old commits dropped (README.md)
- [ ] `tools/modellers/la-gram-vscode/package.json`: its link to GitLab, with that repository's own change

## 8. Release 0.4.0

- [ ] Tag `la-gram-v0.4.0` on GitHub: the Release, la-gram-git on npm and ghcr.io, the server installs it
- [ ] app.linked.archi serves 0.4.0: then the GitLab project private (GH-DD-8)
