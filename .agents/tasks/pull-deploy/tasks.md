# Tasks: pull deploy

## Written (2026-11-23)

- [x] `.github/workflows/la-gram.yml`: test, package (la-gram-git, not published), web, docs, desktop,
      release, alpha; build records; no secret; actions pinned (DP-1 to DP-5)
- [x] `.github/dependabot.yml`: the actions' updates
- [x] `ops/pull-deploy/la-gram-pull`: production, alpha, `--dry-run`, `--force`, rollback, adopt
      (DP-6 to DP-13)
- [x] `ops/pull-deploy/la-gram-pull@.service`, `la-gram-pull@.timer`, `la-gram-pull.conf.example` (DP-14)
- [x] `ops/pull-deploy/README.md`: install, dry run, switch-over, rollback, failures
- [x] `src/__tests__/pull-deploy.test.ts`. Not run yet: run `npm test` before the merge request
- [x] `bash -n ops/pull-deploy/la-gram-pull`

**Stopped here, 2026-11-25:** the repository is on GitHub and set up (`../github-move/`); the repository's
part is written, to merge by the first pull request. Next: its first run, then the server.

## On GitHub, once (DP-3, DP-5)

Done 2026-11-25, but the first run.

- [x] The repository at `linked-archi/la-gram`
- [x] *Settings › Actions › General*: workflow permissions *Read repository contents*; *Allow GitHub
      Actions to create and approve pull requests* off
- [x] Ruleset `release tags`, for tags `la-gram-v*` and `la-gram-git-v*`: creation, update and deletion
      restricted to admins and maintainers. Not `la-gram-alpha`: the workflow deletes and makes it (DP-DD-6)
- [x] Ruleset `main`: pull requests (no approval needed, one maintainer), the `test`, `web` and `docs`
      checks required, no force-push or deletion
- [x] Environment `production`: required reviewer; deployment tags `la-gram-v*` only; *Prevent
      self-review* off, as the only maintainer
- [x] Environment `alpha`: deployment branch `main` only
- [x] `.github/CODEOWNERS`: `/.github/` and `/ops/`. *Require review from Code Owners* not on: no one may
      approve their own pull request, so with one maintainer it would hold every change there. Recorded
      (2026-11-25), not started: on with a second maintainer
- [x] Secret scanning and push protection on
- [ ] First run: a pull request (test, package, web, docs); a merge (the alpha published); *Run workflow*
      with *desktop* (the five apps as artifacts)

## On the server (ops/pull-deploy/README.md)

- [ ] Install: the user, the files, `/etc/la-gram-pull.conf`, `gh` ≥ 2.70
- [ ] Dry run of both channels against a real release and alpha; a changed byte refused
- [ ] Switch over: `DEPLOY_SSH_KEY` deleted in GitLab first, then `adopt`, then the timers
- [ ] Try: a pre-release (not installed), a release, a merge to main, a rollback and `--force`
- [ ] `OnFailure=` notification
- [ ] The SSH deploy away: the GitLab variables, the key in `authorized_keys`, the deploy user if meta
      no longer needs it; `adopted-*` folders once replaced

## In the repository, with the switch-over

Done 2026-11-25 with the move to GitHub (`../github-move/`, its 5), in the pull request that makes GitHub
la-gram's only home: `.gitlab-ci.yml` went altogether.

- [x] `.gitlab-ci.yml` out, all of it
- [x] `src/__tests__/release-pipeline.test.ts` out; its operating-page checks in *pull-deploy.test*
- [x] `README.md`, *Releasing la-gram*: GitHub's Release, its environment, how the server installs it;
      *Once, before the first release* as the GitHub settings above
- [x] `docs-site/developing/releasing.md`: the workflow job by job; the pull deploy, from
      `ops/pull-deploy/README.md` (*Installed by the server*)
- [x] `docs-site/operating/web-app.md`: *app.linked.archi*, the server installs it; the links and `versions/`
- [x] `src/help-links.ts`: the comment on `DOWNLOADS` → la-gram-pull
- [x] `.agents/specs/la-gram/`: condensed, not copied — Req 15.8 and 15.10 rewritten, Req 15.11 (installed by
      the server), key design decision 43 (DP-DD-1 to DP-DD-8 in short); the change-log entry. DP-1 to DP-15
      and DP-DD-1 to DP-DD-8 stay here, in full

## With the move of the repository

Done 2026-11-25 (`../github-move/`, its 5).

- [x] `src/help-links.ts` `REPOSITORY`, `RELEASES` (`/-/releases` → `/releases`); `webpack.config.js`
      `repository`; `mkdocs.yml` `extra.social` (GitHub's icon and link)
- [x] `webpack.config.js`: reads GitHub's `GITHUB_SHA` and `GITHUB_REF_TYPE`; the workflow's `CI_COMMIT_*` away
      (DP-DD-8)
- [x] la-gram-git's releases: npm trusted publishing from GitHub Actions, the image to ghcr.io
