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

**Stopped here, 2026-11-23:** everything below waits for the repository on GitHub.

## On GitHub, once (DP-3, DP-5)

- [ ] The repository at `linked-archi/la-gram`, or `REPO` changed in `la-gram-pull.conf.example` and the
      Release notes in the workflow
- [ ] *Settings › Actions › General*: workflow permissions *Read repository contents*; *Allow GitHub
      Actions to create and approve pull requests* off
- [ ] Ruleset for tags `la-gram-v*`: creation, update and deletion restricted to maintainers. Do not
      include `la-gram-alpha`: the workflow deletes and makes it (DP-DD-6)
- [ ] Ruleset for `main`: pull requests, the `test`, `web` and `docs` checks required
- [ ] Environment `production`: required reviewer; deployment tags `la-gram-v*` only; *Prevent
      self-review* off if you are the only maintainer
- [ ] Environment `alpha`: deployment branch `main` only
- [ ] `.github/CODEOWNERS`: `/.github/ @<maintainer>` and `/ops/ @<maintainer>`, and *Require review from
      Code Owners* in the `main` ruleset
- [ ] Secret scanning and push protection on
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

## In the repository, with the switch-over (one merge request)

- [ ] `.gitlab-ci.yml`: `web-deploy`, `alpha-deploy` and `la-gram-release` out; the `desktop` jobs' upload
      to the package registry out, with the release header comment's lines on them
- [ ] `src/__tests__/release-pipeline.test.ts`: its web-deploy, alpha-deploy and Releases-page tests out,
      or the whole file, if la-gram's jobs leave `.gitlab-ci.yml` altogether
- [ ] `README.md`, *Releasing la-gram*: GitHub's Release, its environment, how the server installs it;
      *Once, before the first release* as the GitHub settings above
- [ ] `docs-site/developing/releasing.md`: the workflow job by job, as it is for `.gitlab-ci.yml` now; the
      pull deploy, from `ops/pull-deploy/README.md`
- [ ] `docs-site/operating/web-app.md`: *app.linked.archi*, "the release copies the build into the
      folder" → the server installs it; the links and `versions/`
- [ ] `src/help-links.ts`: the comment on `DOWNLOADS` (`.gitlab-ci.yml`, web-deploy) → la-gram-pull
- [ ] `.agents/specs/la-gram/requirements.md`: DP-1 to DP-15 under Req 15, replacing the SSH deploy in
      Req 15.8 and 15.10; `design.md`: DP-DD-1 to DP-DD-8 as key design decisions; `tasks.md`: the
      change-log entry, the test file in italics, the limitations above

## With the move of the repository (not this task)

- [ ] `src/help-links.ts` `REPOSITORY`, `RELEASES` (`/-/releases` → `/releases`); `webpack.config.js`
      `repository`; `mkdocs.yml` `extra.social` (the GitLab icon and link)
- [ ] `webpack.config.js`: read GitHub's `GITHUB_SHA` and `GITHUB_REF_TYPE` too, and the workflow's
      `CI_COMMIT_*` away (DP-DD-8)
- [ ] la-gram-git's releases: npm trusted publishing from GitHub Actions, the image to ghcr.io
