# la-gram released on GitHub, installed by app.linked.archi itself (pull deploy)

Recorded 2026-11-23. **Files written, not in use.** `.gitlab-ci.yml` still releases la-gram and deploys
it over SSH, until the switch-over in `tasks.md`. Files here: `requirements.md` (DP-n), `design.md`
(DP-DD-n) and `tasks.md`, the checklist.

## Goal

la-gram moves to GitHub, and no key to app.linked.archi is kept anywhere: not in GitHub, not in GitLab.
The server fetches what the release workflow publishes, checks how it was built, and puts it in place itself.

## Why

`.gitlab-ci.yml`'s `web-deploy` and `alpha-deploy` copy the build over SSH with `DEPLOY_SSH_KEY`, the
deploy user's private key. That user is the one meta.linked.archi's deploy uses. Anyone who could read
that variable, or run a job with it (a changed pipeline, a compromised action or image), could write to
the server. Moving the same jobs to GitHub would move the key with them. With the server pulling:

- CI holds no secret of the server's, and the server accepts nothing from CI;
- a compromised workflow, action or account can at most publish a release, and the server installs only
  a file whose build record says this workflow built it, from a release tag or from main;
- the deploy user, its key and the SSH access for deploys go away.

## Relationship to other work

| Work | Where | How it bears on this |
|---|---|---|
| The move of the repository to GitHub | not yet a task | This task needs the repository on GitHub (`linked-archi/la-gram` is assumed: `REPO` in `ops/pull-deploy/la-gram-pull.conf.example`). The links to GitLab in the app and the documentation change with the move, not here (`tasks.md`, *With the move*) |
| la-gram-git's releases | `.gitlab-ci.yml`, `npm`, `image-*`, `container-image` | Stay on GitLab for now. Out of scope: they hold no server key (npm by trusted publishing, the image by the job token) |
| [Hosting the web app](../../../docs-site/operating/web-app.md) | `docs-site/operating/` | nginx's rules do not change: the server follows the links |

## What was decided

1. **The server pulls; nothing pushes** (DP-DD-1). Of three ways considered: push over SSH from GitHub with
   a restricted key (`restrict`, `rrsync`); GitHub Pages; pull. Pages could not send the
   Content-Security-Policy, framing and cache headers app.linked.archi sends (`docs-site/operating/web-app.md`).
   A restricted key still leaves a key. Pull leaves none.
2. **The build record is what is trusted** (DP-DD-2), not the checksum: `SHA256SUMS.txt` comes from the
   same release as the files it lists.
3. **Publishing is deploying** (DP-DD-3): the approval moves to the GitHub environment `production`, on the
   job that publishes the Release.
4. **nginx unchanged** (DP-DD-4): links, swapped in one rename; the version pages copied into the release served.
5. **The desktop apps stay beside the web app** (DP-DD-5), in `downloads/`: `DESKTOP_DOWNLOADS` and the
   documentation's links do not change.

## Files

| Path | What |
|---|---|
| `.github/workflows/la-gram.yml` | the tests, the builds, the Release on a `la-gram-v` tag, the rolling pre-release `la-gram-alpha` from main; build records; no secret |
| `.github/dependabot.yml` | updates for the actions the workflow pins to commits |
| `ops/pull-deploy/la-gram-pull` | the server's script: fetch, check, unpack, swap, check the site, roll back, prune |
| `ops/pull-deploy/la-gram-pull@.service`, `…@.timer` | a check every five minutes per channel, as its own user, sandboxed |
| `ops/pull-deploy/la-gram-pull.conf.example` | `/etc/la-gram-pull.conf` |
| `ops/pull-deploy/README.md` | install, dry run, switch-over, rollback, failures, removing the SSH deploy |
| `src/__tests__/pull-deploy.test.ts` | the workflow and the script name the same files, workflow and refs; no secret; actions pinned; the unit's limits |
