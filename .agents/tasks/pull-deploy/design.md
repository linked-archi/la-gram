# Design: pull deploy (DP-DD-n)

## Flow

```
GitHub: .github/workflows/la-gram.yml                    app.linked.archi: la-gram-pull@<channel>.timer
  tag la-gram-v0.2.0                                       every 5 min, per channel
    test, web, docs, desktop ×5                              ask GitHub (ETag: a 304 costs nothing)
    release (environment production, reviewer)  ───────►     download web tarball (+ desktop apps)
      tar dist/web → la-gram-web-0.2.0.tar.gz                sha256 against SHA256SUMS.txt
      sha256sum → SHA256SUMS.txt                             gh attestation verify: workflow, ref, hosted runner
      attest-build-provenance (OIDC, Sigstore)               unpack (no ../, no links) into releases/.new-<id>
      gh release create                                      version pages → versions/ → the new folder
  push main, 0.3.0-alpha                                     mv into releases/<id>; swap the link in one rename
    test, web (channel alpha), docs                          fetch SITE/la-gram/index.html: the new one?
    alpha (environment alpha)                                  no → link back, folder away, build held
      rolling pre-release la-gram-alpha                      prune to KEEP
```

## Key design decisions

**DP-DD-1. The server pulls.** Push needs a credential for the server in CI: an SSH key, however
restricted (`restrict`, `command="rrsync …"`), is still a write path into the server from every job that
can read it. GitHub Pages needs none, but sends no response headers of the site's choosing, and
app.linked.archi's Content-Security-Policy, `X-Frame-Options` and cache rules
(`docs-site/operating/web-app.md`) would be lost or weakened (`frame-ancestors` does not work from a
`<meta>` tag). Pull keeps nginx as it is and leaves no credential anywhere. It costs a delay of up to
about five minutes, and a script on the server.

**DP-DD-2. The build record is the trust, the checksum only a check.** `SHA256SUMS.txt` is published with
the files it lists, by the same token: whoever can replace one can replace the other. The build record is
signed with a certificate Sigstore issues for the job's OIDC identity. `gh attestation verify` checks that
identity is this repository's `.github/workflows/la-gram.yml` (`--signer-workflow`), at the channel's ref
(`--source-ref`), on a GitHub-hosted runner (`--deny-self-hosted-runners`). A release made by hand, by
another workflow, from another branch, a fork or a pull request, has no such record. The record is also
published beside the files (`la-gram-<id>.attestation.json[l]`) and passed with `--bundle`, so the check
needs no API call of its own.

**DP-DD-3. Publishing is deploying.** The server installs whatever the newest release is, so the
approval GitLab gave by protecting the deploy variables is the GitHub environment `production`: a
required reviewer, and a deployment rule that admits `la-gram-v*` tags only. The tag rule is a ruleset
that lets only maintainers create `la-gram-v*` tags (`tasks.md`). The alpha's environment, `alpha`,
admits main only and needs no reviewer, as `alpha-deploy` needed none.

**DP-DD-4. nginx unchanged: links, one rename.** `la-gram` and `la-gram-alpha` become links to folders
under `releases/` and `alpha/`, swapped with `ln -sfn … .swap && mv -T .swap la-gram`, so a request sees
the old folder or the new, never half of one. The version pages, which rsync's `P /v[0-9]*/` protected,
live in `versions/`, which nothing removes, and are copied into each release before it is served. The
alpha's page goes into `versions/` and into the release served, as `alpha-deploy` put it into
`LA_GRAM_DEPLOY_PATH/v<version>/`. The tarball's version pages are the only ones taken from it: the
others come from `versions/`.

**DP-DD-5. The desktop apps stay on the server.** Linking la-gram's menu to the GitHub Release instead
would change `DESKTOP_DOWNLOADS`, its documentation and a test, and send users to GitHub. The server
fetches the five files and checks each as the web app (DP-7), and serves them under the names without the
version. The cost is about 0.7 GB per release kept (`KEEP_RELEASES`, 2).

**DP-DD-6. The alpha is one pre-release, made again.** A release per push would fill the Releases page.
`la-gram-alpha` is deleted with its tag and created at the new commit. Between the two, the server finds
none and waits (not a failure). Its file is named after the version and the commit, which names the
alpha's folder on the server. This rules out GitHub's *immutable releases* for the repository: they forbid
deleting a published release's tag. If they are wanted for `la-gram-v*`, the alpha has to move (a release
per commit, pruned by the workflow).

**DP-DD-7. Hold what fails.** A build refused for a check that fails, or that the site did not serve, or
that was rolled back, is written to `<channel>.hold`, and skipped until a newer build is published or the
run is `--force`d. Without it, the server would download 0.7 GB every five minutes to refuse it again, or
reinstall the release just rolled back. A failed download or a GitHub error is not held: the next run tries
again.

**DP-DD-8. GitHub's variables for GitLab's names.** `webpack.config.js` names the commit on the version's
page from `CI_COMMIT_SHA`, unless `CI_COMMIT_TAG` is set. The workflow sets both from GitHub's context,
so the build is the same on either CI until the switch-over renames them (`tasks.md`).

## Limitations

- **The server needs `gh`**, 2.70 or later, for the build-record check; `cosign verify-blob-attestation`
  would do the same without it, but is not written.
- **A rollback of the alpha leaves its version's page** as the newer alpha wrote it.
- **Not run yet.** The workflow and the script are checked by `src/__tests__/pull-deploy.test.ts` and
  `bash -n` only. Their first run is the dry run in `ops/pull-deploy/README.md`.
