---
title: Releasing
description: la-gram's GitHub workflow, job by job, how app.linked.archi installs what it publishes, the one-time setup before the first release, and how to make a release of la-gram or of la-gram-git.
---
# Releasing

One workflow, `.github/workflows/la-gram.yml`, tests every pull request and releases two products from
their own tags:

| Tag | Releases |
|---|---|
| `la-gram-git-v<version>`, the version in `packages/la-gram-git/package.json` | la-gram-git: the npm package and the container image |
| `la-gram-v<version>`, the version in `package.json` | la-gram: the GitHub Release, with the desktop apps and the web app with this documentation, which app.linked.archi then installs |

Between releases, each push to `main` publishes the **alpha** — the next release as it is being made —
which app.linked.archi installs at https://app.linked.archi/la-gram-alpha/ ([The alpha](#alpha)).

Nothing in the workflow reaches app.linked.archi: the server fetches what the workflow publishes, and
installs it only when its build record says this workflow built it ([Installed by the
server](#installed-by-the-server)).

The excerpts below are copied from `.github/workflows/la-gram.yml`; `# …` marks lines left out.

## When the workflow runs {#when-the-workflow-runs}

| Event | Jobs |
|---|---|
| a pull request | `version`, `test`, `package`, `web`, `docs` |
| a push to `main` | the same, `web` built as the alpha; then `alpha`, while `package.json` says a pre-release |
| a tag `la-gram-v*` | `version`, `test`, `web`, `docs`, the five `desktop` jobs, then `release` |
| a tag `la-gram-git-v*` | `version`, `test`, `package`, then `npm`, the two `image` jobs and `image-tags` |
| *Run workflow*, by hand | as a pull request; with *desktop* ticked, the five `desktop` jobs too |

A push to any other branch, and any other tag, starts nothing.

```yaml
on:
  pull_request:
  push:
    branches: [main]
    tags: ['la-gram-v*', 'la-gram-git-v*']
  workflow_dispatch:
    inputs:
      desktop:
        description: Package the five desktop apps too, to try (kept three days)
        type: boolean
        default: false
```

## Defaults {#defaults}

The run's token, `GITHUB_TOKEN`, may only read; the jobs that publish ask for more, each for itself. A
newer push to the same pull request cancels what is still running; `main` and tags run to the end. No job
runs Electron: the desktop jobs' packager downloads each target's own
([Building](building.md#env-electron-skip-binary-download)). Every action is pinned to a commit, its
version beside it, and Dependabot proposes their updates (`.github/dependabot.yml`). No job leaves the
token in the checkout for the steps after it (`persist-credentials: false`).

```yaml
permissions:
  contents: read

concurrency:
  group: la-gram-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

env:
  ELECTRON_SKIP_BINARY_DOWNLOAD: "1"
  npm_config_audit: "false"
  npm_config_fund: "false"
```

## Jobs {#jobs}

The jobs every pull request runs. The `main` ruleset needs `test`, `web` and `docs` to pass before a pull
request merges.

**`version`** says what the run is. On la-gram's tag, the tag's version must be `package.json`'s; on
la-gram-git's, `packages/la-gram-git/package.json`'s; either way the run stops here when they differ,
before anything is built. On a push to `main`, a pre-release version (`0.4.0-alpha`) makes it the alpha.
Its outputs: `kind`, la-gram's (`release`, `prerelease`, `alpha` or `none`), and `cli`, la-gram-git's
(`release`, `prerelease` or `none`).

```yaml
          case "$REF" in
            refs/tags/la-gram-git-v*)
              # …
              if [ "${REF_NAME#la-gram-git-v}" != "$CLI_VERSION" ]; then
                echo "::error::The tag $REF_NAME says ${REF_NAME#la-gram-git-v}; packages/la-gram-git/package.json says $CLI_VERSION."
                exit 1
              fi
              case "$CLI_VERSION" in *-*) CLI=prerelease ;; *) CLI=release ;; esac
              ;;
            refs/tags/*)
              # …
              if [ "${REF_NAME#la-gram-v}" != "$VERSION" ]; then
                echo "::error::The tag $REF_NAME says ${REF_NAME#la-gram-v}; package.json says $VERSION."
                exit 1
              fi
              case "$VERSION" in *-*) KIND=prerelease ;; *) KIND=release ;; esac
              ;;
            refs/heads/main)
              if [ "$EVENT" = push ]; then
                case "$VERSION" in *-*) KIND=alpha ;; esac
              fi
              ;;
          esac
```

**`test`**: the type check and Vitest, without the benchmarks, which time the machine they run on. The
browser suite and the Electron test are not run in CI ([Testing](testing.md#npm-run-test-browser)).

```yaml
      - run: npm ci --prefer-offline
      - run: npm run typecheck
      - run: npx vitest run --exclude '**/{*-bench,bench-*}.test.ts'
```

**`package`** (never on `la-gram-v*`): la-gram-git as npm will have it. It builds, packs, installs the
packed file globally, checks the installed version, and runs `check` on the smoke model and on these pages'
example model. Its artifact, `la-gram-git`, is the `.tgz`, kept a week, which `npm` and the image jobs
publish.

```yaml
      - run: npm ci --prefer-offline
      - run: npm run build:cli
      - run: |
          PACKAGE_VERSION="$(node -p 'require("./packages/la-gram-git/package.json").version')"
          (cd packages/la-gram-git && npm pack)
          npm install --global "./packages/la-gram-git/linked-archi-la-gram-git-$PACKAGE_VERSION.tgz"
          test "$(la-gram-git --version)" = "$PACKAGE_VERSION"
          la-gram-git check packages/la-gram-git/smoke
          # …
          la-gram-git check docs-site/examples
```

The example model's check runs on la-gram-git's release tags too, on purpose: a la-gram-git whose writer
or findings change fails there until the example is brought up to date
([the example model](documentation.md#the-example-model)).

**`web`** (never on `la-gram-git-v*`): the web app, `npm run build:web`. It checks that the build has its
page, its icon, its WebAssembly and its version's page, and keeps `dist/web/` a week as its artifact. On a
push to `main` it builds the alpha, `LA_GRAM_CHANNEL=alpha` ([The alpha](#alpha)). The version's page
names the commit it was built from, from GitHub's `GITHUB_SHA`, and none on a tag.

```yaml
    env:
      LA_GRAM_CHANNEL: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && 'alpha' || '' }}
      VERSION: ${{ needs.version.outputs.version }}
    steps:
      # …
      - run: npm ci --prefer-offline
      - run: npm run build:web
      - run: |
          test -f dist/web/index.html && test -f dist/web/favicon.svg && ls dist/web/*.wasm
          # This version's page: the IRI the edits it records name as their agent (scripts/version-page.mjs).
          test -f "dist/web/v$VERSION/index.html"
```

**`docs`** (never on `la-gram-git-v*`): these pages, `docs-site/` built by MkDocs and Material for MkDocs
in Python's own image, `python:3.14.10-slim-trixie`, with exactly the versions `requirements-docs.txt`
pins: `--no-deps` installs only what the file names, and `pip check` fails the job if a package needs one
it does not. `mkdocs build --strict` fails on a broken link or anchor, a page left out of the navigation,
a page without a description, or a script the server's Content-Security-Policy would block. It needs
nothing from other jobs, so it starts at once, and its artifact is `dist/web/docs/`, inside the web app's
folder.

```yaml
  docs:
    if: ${{ !startsWith(github.ref, 'refs/tags/la-gram-git-v') }}
    runs-on: ubuntu-latest
    container: python:3.14.10-slim-trixie
    # …
      - run: python -m venv /tmp/venv
      - run: /tmp/venv/bin/pip install --quiet --no-deps --requirement requirements-docs.txt
      - run: /tmp/venv/bin/python -m pip check
      - run: /tmp/venv/bin/mkdocs build --strict
```

`npm run docs:build` runs the same build locally ([Writing the documentation](documentation.md#commands)).

## Desktop apps {#desktop-apps}

**`desktop`** packages the app for five targets, a job each, on GitHub's Linux runners: macOS on Apple
silicon and Intel, Windows x64, Linux x64 and arm64. On a `la-gram-v*` tag the jobs run for the Release;
by hand, *Run workflow* with *desktop* ticked, they keep their `release/` folder three days as the run's
artifacts, to try a build before a release.

Each job:

1. runs `npm run package -- --platform "$PLATFORM" --arch "$ARCH"`, up to three times, waiting 60 and then
   120 seconds between tries, since Electron's downloads from GitHub fail now and then;
2. on macOS, signs the app ad hoc again with `rcodesign` 0.29.0, whose download's SHA-256 is checked,
   so that macOS calls a downloaded copy an app from an unidentified developer, which *Open Anyway*
   opens, rather than "damaged";
3. zips the app, `la-gram-<version>-<platform>-<arch>.zip`, or a `.tar.gz` for Linux, which keeps the
   files' modes.

```yaml
    strategy:
      fail-fast: false
      matrix:
        include:
          - { platform: darwin, arch: arm64 }
          - { platform: darwin, arch: x64 }
          - { platform: win32, arch: x64 }
          - { platform: linux, arch: x64 }
          - { platform: linux, arch: arm64 }
```

The apps are not signed by a developer: the first open of a downloaded copy asks to be allowed
([Desktop app](../getting-started/desktop.md)).

## The Release {#release}

**`release`** (on `la-gram-v*`, after `test`, `web`, `docs` and the five `desktop` jobs) makes the GitHub
Release *la-gram &lt;version&gt;*:

- the five desktop apps;
- the web app with its documentation as one file, `la-gram-web-<version>.tar.gz`, after checking that it
  has both pages and its version's page;
- `SHA256SUMS.txt`;
- the build record, an attestation of every file (`actions/attest-build-provenance`), signed with the
  run's short-lived OIDC token, beside them as `la-gram-<version>.attestation.*`. Anyone can check a file
  with `gh attestation verify <file> --repo linked-archi/la-gram`.

It runs in the environment `production`, whose deployment rule admits `la-gram-v*` tags only and whose
required reviewer approves it: publishing the Release is deploying it, since app.linked.archi installs the
newest release by itself. A pre-release tag (`la-gram-v0.4.0-rc.1`) makes a GitHub pre-release, which the
server never installs.

```yaml
    environment:
      name: production
      url: https://github.com/${{ github.repository }}/releases/tag/${{ github.ref_name }}
    permissions:
      contents: write # the Release
      id-token: write # the OIDC token the build record is signed with
      attestations: write # the build record
```

## The alpha {#alpha}

Between releases, `package.json` says the next release's alpha, `0.4.0-alpha`, and each push to `main`
publishes it, to try what the next release will have. `alpha` because pre-release labels sort as text:
`0.4.0-alpha` comes before `0.4.0-beta.1`, `0.4.0-rc.1` and `0.4.0`, as it should, where a label such as
`snapshot` would come after `rc`.

**`web`**, on a push to `main`, builds it for its channel, `LA_GRAM_CHANNEL=alpha`:

- **Its browser storage is its own.** The alpha and the release are one site, app.linked.archi, whose
  pages share what the browser keeps; the alpha keeps its settings, its Git tokens, the files its models
  are bound to and its checkpoints under its own names, so that what it writes — in a form the release
  may not read yet — and what the release writes stay apart. A token given to the release is asked for
  again in the alpha.
- **Its version's page** names the commit it was built from, and the alpha's app and documentation,
  instead of a Release: `https://app.linked.archi/la-gram/v0.4.0-alpha`, which the edits made in the alpha
  name as their agent, says which build of the alpha it is now — the last pushed.

**`alpha`** (on a push to `main`, while `package.json` says a pre-release) then publishes the web app with
its documentation, as one file named after the version and the commit, as the GitHub pre-release
`la-gram-alpha`, which it deletes and makes again each time, with its sums and its build record. It runs in
the environment `alpha`, which admits `main` only. When `package.json` says a release (`0.4.0`), it does
not run: from the release's merge until the next alpha's, the alpha stays as it was.

## Installed by the server {#installed-by-the-server}

app.linked.archi installs what the workflow publishes by itself: a timer runs `la-gram-pull` every five
minutes for each channel, as its own user, with no rights it does not need. Its files and how to install,
try, switch over and roll back are in
[`ops/pull-deploy/README.md`](https://github.com/linked-archi/la-gram/blob/main/ops/pull-deploy/README.md).

| | Production | Alpha |
|---|---|---|
| Takes | the newest release `la-gram-v<x.y.z>`: never a draft, a pre-release or la-gram-git's | the pre-release `la-gram-alpha` |
| Its build record must name | its tag | `main` |
| Serves it at | `/la-gram/`, with the desktop apps in `downloads/` | `/la-gram-alpha/` |

Before anything is served, each file it downloads must have the SHA-256 that the release's
`SHA256SUMS.txt` gives, and a build record that `gh attestation verify` accepts: signed for
`.github/workflows/la-gram.yml` in this repository, on a GitHub-hosted runner, from the ref above. A file
uploaded by hand, or built in another workflow, on another branch or in a fork, has none, and is refused.

A release's desktop apps go into its `downloads/` under names without the version
(`la-gram-darwin-arm64.zip`…), with their `SHA256SUMS.txt`: the links in la-gram's menu and in this
documentation stay. Every version's page stays served, so that every version a model names as its agent
resolves. The new folder replaces the old in one rename, and the server checks the site serves it; if not,
it puts the old one back.

No CI job connects to the server, and no key to it is kept anywhere: a compromised workflow, action or
account can at most publish a release, and the server installs only a file whose build record says this
workflow built it, from a release tag or from `main`.

## npm {#npm}

**`npm`** (on `la-gram-git-v*` only, after `test` and `package`) publishes the packed file to npm, as
`@linked-archi/la-gram-git`, `--access public`, with provenance. A pre-release version (`0.2.0-rc.1`) goes
under the dist-tag `next`, any other under `latest`. It runs in the environment `la-gram-git`, whose
deployment rule admits `la-gram-git-v*` tags only and whose required reviewer approves it: what npm has
published cannot be taken back.

- **By trusted publishing:** npm takes the run's OIDC token for this repository, this workflow and the
  environment `la-gram-git`, and needs no secret. It needs npm 11.5.1 or later, which the job installs.
- **The first release**, before the package exists on npm to set trusted publishing up on, takes
  `NPM_TOKEN`, a secret of the environment `la-gram-git`, written to `.npmrc` as a reference that npm
  resolves, never as its value. It is deleted after ([Before the first release](#before-the-first-release)).

```yaml
    environment:
      name: la-gram-git
      # …
    permissions:
      contents: read
      id-token: write # the OIDC token npm takes, and signs the provenance with
    # …
      - run: npm install --global npm@11 # trusted publishing needs npm 11.5.1 or later
      - env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: |
          case "$VERSION" in *-*) DIST_TAG=next ;; *) DIST_TAG=latest ;; esac
          if [ -n "$NPM_TOKEN" ]; then echo '//registry.npmjs.org/:_authToken=${NPM_TOKEN}' > "$HOME/.npmrc"; fi
          npm publish "./linked-archi-la-gram-git-$VERSION.tgz" --access public --tag "$DIST_TAG" --provenance
```

## Container image {#container-image}

**`image`** (on `la-gram-git-v*`, after `npm`, so that the one approval releases both) builds the image from
the same packed file, a job per platform, each natively on its own runner: GitHub's amd64 runner, and its
arm64 runner, free for public repositories, so nothing is emulated. Each runs `--version` and checks the
smoke model, then pushes `ghcr.io/linked-archi/la-gram-git:<version>-<arch>` with the run's token.

**`image-tags`**, after both, makes each published tag name both platforms with
`docker buildx imagetools create`: the version, and for a release also its major version and `latest`
([Container image](../operating/container-image.md#tags)).

```yaml
    strategy:
      matrix:
        include:
          - { arch: amd64, runner: ubuntu-24.04 }
          - { arch: arm64, runner: ubuntu-24.04-arm }
    permissions:
      contents: read
      packages: write # the image
    # …
      - run: |
          docker build --build-arg VERSION="$VERSION" --tag "$IMAGE:$VERSION-$ARCH" packages/la-gram-git
          test "$(docker run --rm "$IMAGE:$VERSION-$ARCH" la-gram-git --version)" = "$VERSION"
          docker run --rm --interactive "$IMAGE:$VERSION-$ARCH" sh -c 'cat > shop.ttl && la-gram-git check shop.ttl' < packages/la-gram-git/smoke/shop.ttl
          docker push "$IMAGE:$VERSION-$ARCH"
```

## Before the first release {#before-the-first-release}

Once, on GitHub, in the repository's *Settings*, by a maintainer:

1. **Actions › General:** *Workflow permissions*, *Read repository contents and packages permissions*;
   *Allow GitHub Actions to create and approve pull requests* cleared.
2. **Environments:** `production`, with a required reviewer and the deployment tag pattern `la-gram-v*`
   only; `alpha`, the deployment branch `main` only; `la-gram-git`, with a required reviewer and the tag
   pattern `la-gram-git-v*` only. With one maintainer, clear *Prevent self-review*.
3. **Rules › Rulesets:** `main`, pull requests with the status checks `test`, `web` and `docs`, and no
   force-push or deletion; `release tags`, the tags `la-gram-v*` and `la-gram-git-v*`, which only
   maintainers may create, move or delete. Not `la-gram-alpha`, which the `alpha` job deletes and makes.
4. **Advanced Security:** secret scanning and push protection.

For la-gram on app.linked.archi: install `la-gram-pull` on the server
([its README](https://github.com/linked-archi/la-gram/blob/main/ops/pull-deploy/README.md), *Install*), and
serve its folders with the rules of [Hosting the web app](../operating/web-app.md).

For la-gram-git on npm: create the npm organization `linked-archi`, and add `NPM_TOKEN` to the environment
`la-gram-git`, an npm granular access token that can publish `@linked-archi` packages, with an expiry.
After the first release, set up trusted publishing on npmjs.com — the package's *Settings › Trusted
publishing*: GitHub Actions, the organization `linked-archi`, the repository `la-gram`, the workflow
`la-gram.yml`, the environment `la-gram-git` — just before the next release, since a new trusted publisher
must be used within two days; then delete `NPM_TOKEN` and revoke the token. After the first image, check
in the organization's *Packages* that `la-gram-git`'s visibility is *Public*.

## Each release {#each-release}

A release is a version set by a pull request, then an annotated tag on the merged commit, pushed by a
maintainer, then an approval. Between releases `package.json` says the next one's alpha
([The alpha](#alpha)): the release's pull request sets the release's version, `0.4.0`, and once it is
tagged, a pull request sets the next alpha's, `npm version 0.5.0-alpha --no-git-tag-version`. For la-gram
0.4.0:

1. On a branch from an up-to-date `main`, set the version with `npm version 0.4.0 --no-git-tag-version`
   (it writes `package.json` and `package-lock.json`, and without the option would also commit and tag,
   with its own tag name), run `npm run typecheck && npm test`, commit, push, and open the pull request.
   To try a desktop app first, run the workflow on the branch with *desktop* ticked and download the
   run's artifact. Merge when its checks pass.
2. On `main`, pulled, check the version with `node -p 'require("./package.json").version'`, then tag
   and push: `git tag -a la-gram-v0.4.0 -m "la-gram 0.4.0"` and `git push origin la-gram-v0.4.0`.
3. In *Actions*, the run waits at `release` for the environment `production`'s reviewer: *Review
   deployments*, then approve. When it is done, *Releases* lists *la-gram 0.4.0*; within five minutes,
   https://app.linked.archi/la-gram/, reloaded, says *Version 0.4.0* in *About la-gram*.

For la-gram-git, the same with its own version: `npm version 0.2.0 --no-git-tag-version` in
`packages/la-gram-git/`, the tag `la-gram-git-v0.2.0`, and the approval of `npm` in the environment
`la-gram-git`.

```console
$ node -p 'require("./package.json").version'
0.4.0-alpha
$ node -p 'require("./packages/la-gram-git/package.json").version'
0.1.0
```

When something goes wrong:

- **A job fails on something passing**, a download or the network: *Re-run failed jobs*. Do not tag again.
- **The tag's version is not the package's:** `version` stops the run before anything is built. Delete
  the tag on GitHub and locally (`git push origin :refs/tags/la-gram-v0.4.0`, `git tag -d
  la-gram-v0.4.0`); set the version, merge, and tag again.
- **Something is wrong in what was released:** do not move the tag. Fix it by a pull request, and
  release the next version. To serve the release before it meanwhile, roll back on the server
  ([its README](https://github.com/linked-archi/la-gram/blob/main/ops/pull-deploy/README.md), *Roll back*).
