# Requirements: la-gram and the kernel on GitHub

**GH-1** la-gram and the kernel are public repositories under `github.com/linked-archi`, under Apache-2.0,
with their `.agents/` folders.

**GH-2** Every commit and annotated tag pushed has one author, committer and tagger:
`Kalin Maldzhanski <k@apptik.io>`. No commit, tag or version of a file gives an absolute path of the
workspace or of the home folder.

**GH-3** la-gram's history on GitHub has every commit of `main`, `pre-release`, `refine-storage`,
`spec-alignment` and the tags `la-gram-v0.1.0` to `la-gram-v0.3.0`: the same files (but for GH-2's paths),
messages and dates, the same number of commits.

**GH-4** The kernel's history begins with la-gram's history of the kernel's files. The kernel's own commits
follow, each with the files it had (but for GH-2's paths).

**GH-5** Nothing of the history as it was before GH-2 reaches GitHub: no push from a checkout that still has
it, no `--mirror` push, no replace refs.

**GH-6** A commit cited by hash in la-gram's or the kernel's files is cited by its hash on GitHub.

**GH-7** The kernel's checks on GitHub Actions: types, the unit tests and the package's contents, on each pull
request and push to `main`, with a read-only token and actions pinned to commits.

**GH-8** From la-gram 0.4.0, la-gram is built, released, published and deployed from GitHub only:

- the web app and the desktop apps, by the GitHub Release (`../pull-deploy/`, DP-n);
- la-gram-git on npm, by trusted publishing from GitHub Actions, with provenance;
- la-gram-git's container image on ghcr.io, for `linux/amd64` and `linux/arm64`, with the tags the GitLab
  image has: the version, its major version and `latest`;
- no `.gitlab-ci.yml`.

**GH-9** From 0.4.0, every link to la-gram's repository, releases, files and image (in the app, its
documentation, la-gram-git's package and its CI templates) points to GitHub.

**GH-10** la-gram's GitLab project is archived after the switch, its description pointing to GitHub, and private
once 0.4.0 is installed on app.linked.archi.
