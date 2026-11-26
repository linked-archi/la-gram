# Requirements: pull deploy (DP-n)

Each says what la-gram's release and app.linked.archi do once this task is done. When they are, they go
into `.agents/specs/la-gram/requirements.md`, under Req 15 (releases), replacing what Req 15.8 and 15.10
say of the SSH deploy (`tasks.md`).

## Publishing

- **DP-1** A tag `la-gram-v<x.y.z>` or `la-gram-v<x.y.z>-<pre-release>` whose version is not
  `package.json`'s publishes nothing.
- **DP-2** A tag `la-gram-v<version>` publishes the GitHub Release *la-gram &lt;version&gt;* with the five desktop
  apps (`la-gram-<version>-<platform>-<arch>.zip`, Linux `.tar.gz`), the web app with its documentation
  as `la-gram-web-<version>.tar.gz`, `SHA256SUMS.txt`, and the build record of each file. With a
  pre-release part it is published as a pre-release.
- **DP-3** The Release is published only after a required reviewer approves it, in the environment
  `production`, which admits `la-gram-v*` tags only.
- **DP-4** A push to main while `package.json` says a pre-release (`0.3.0-alpha`) replaces the pre-release
  `la-gram-alpha`: the web app built for the alpha's channel, as `la-gram-web-<version>-<commit12>.tar.gz`,
  with its sums and build record, in the environment `alpha`, which admits main only. With a release
  version on main, nothing is published.
- **DP-5** No secret is stored for the workflow. Its token is read-only except in the two publishing jobs;
  every action is pinned to a commit; no checkout keeps the token.

## Installing

- **DP-6** The server installs, as `/la-gram/`, the newest non-draft, non-pre-release Release whose tag is
  `la-gram-v<x.y.z>`, and as `/la-gram-alpha/` the pre-release `la-gram-alpha`, each within ten minutes
  of its publication.
- **DP-7** It installs a file only if the file's SHA-256 is the one `SHA256SUMS.txt` gives, and its build
  record says `.github/workflows/la-gram.yml` in the repository built it on a GitHub-hosted runner, from
  `refs/tags/<tag>` (production) or `refs/heads/main` (alpha).
- **DP-8** A web app is installed only with `index.html`, `docs/index.html` and its version's page, and
  with no path outside its folder and no link.
- **DP-9** What is served changes in one rename, and is the new build only if the site then serves it: its
  `index.html` names the new build's entry script, and the script the site serves has the new folder's
  bytes. Otherwise the build served before is served again. (The page is not compared byte for byte: the
  server may add to its HTML. Decision confirmed on 2026-11-26.)
- **DP-10** A build refused (DP-7, DP-8, DP-9) or rolled back is not fetched again until a newer one is
  published, or the operator forces it.
- **DP-11** Every version's page stays served at `/la-gram/v<version>/`, the alpha's too, which each alpha
  replaces (Req 9.16).
- **DP-12** The release served has the desktop apps in `downloads/`, named as `DESKTOP_DOWNLOADS` names
  them, with their `SHA256SUMS.txt`.
- **DP-13** The operator can roll either channel back to the build served before with one command, and
  `KEEP_RELEASES`/`KEEP_ALPHAS` builds (default 2) are kept for it.
- **DP-14** The installer runs as its own user without a shell, privileges or capabilities, writes only
  the web root and its own state, and two runs never overlap.
- **DP-15** No connection is made to the server for a deploy, and the server holds no credential that can
  write to GitHub. A token, if one is set at all, can read public repositories only.
