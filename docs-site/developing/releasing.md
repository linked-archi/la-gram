---
title: Releasing
description: la-gram's GitLab pipeline, job by job, the one-time setup before the first release, and how to make a release of la-gram or of la-gram-git.
---
# Releasing

One pipeline, `.gitlab-ci.yml`, tests every merge request and releases two products from their own tags:

| Tag | Releases |
|---|---|
| `la-gram-git-v<version>`, the version in `packages/la-gram-git/package.json` | la-gram-git: the npm package and the container image |
| `la-gram-v<version>`, the version in `package.json` | la-gram: the desktop apps, the web app with this documentation and the desktop apps beside it, and the Releases page |

The excerpts below are copied from `.gitlab-ci.yml`; `# …` marks lines left out.

## When the pipeline runs {#when-the-pipeline-runs}

The `workflow` rules start a pipeline for:

- a tag `la-gram-git-v<semver>` or `la-gram-v<semver>`, with an optional pre-release part
  (`la-gram-v0.2.0-rc.1`);
- a merge request;
- the default branch.

Any other tag, and a push to any other branch, starts nothing.

```yaml
workflow:
  rules:
    - if: $CI_COMMIT_TAG =~ /^la-gram-git-v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
    - if: $CI_COMMIT_TAG =~ /^la-gram-v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
    - if: $CI_COMMIT_TAG
      when: never
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

| Pipeline | Runs |
|---|---|
| merge request, default branch | `test`, `package`, `web`, `docs`; the five `desktop` jobs by hand |
| `la-gram-git-v*` | `test`, `package`, then `npm`, `image-amd64`, `image-arm64`, `container-image` |
| `la-gram-v*` | `test`, `web`, `docs`, the five `desktop` jobs, then `web-deploy` (not on a pre-release) and `la-gram-release` |

## Defaults {#defaults}

Every job runs in `node:22` unless it names another image. A newer push to the same merge request or
branch cancels jobs still running (`interruptible: true`), except the release jobs, which are never
cancelled half-way. npm's cache is kept per `package-lock.json`. Four variables apply to every job:

| Variable | Value | Why |
|---|---|---|
| `ELECTRON_SKIP_BINARY_DOWNLOAD` | `"1"` | no job runs Electron; the desktop jobs' packager downloads each target's own ([Building](building.md#env-electron-skip-binary-download)) |
| `npm_config_cache` | `"$CI_PROJECT_DIR/.npm"` | the cached folder |
| `npm_config_audit`, `npm_config_fund` | `"false"` | quieter installs |

```yaml
default:
  image: node:22
  interruptible: true
  cache:
    key:
      files: [package-lock.json]
    paths: [.npm/]
    policy: pull-push

variables:
  ELECTRON_SKIP_BINARY_DOWNLOAD: "1"
  npm_config_cache: "$CI_PROJECT_DIR/.npm"
  npm_config_audit: "false"
  npm_config_fund: "false"
```

## Jobs {#jobs}

The jobs every merge request runs.

**`test`** (stage `test`): the type check and Vitest, without the benchmarks. The browser suite and the
Electron test are not run in CI ([Testing](testing.md#npm-run-test-browser)).

```yaml
test:
  stage: test
  script:
    - npm ci --prefer-offline
    - npm run typecheck
    - npx vitest run --exclude '**/{*-bench,bench-*}.test.ts'
```

**`package`** (stage `build`; never on `la-gram-v*`): la-gram-git as npm will have it. On a release tag,
the tag's version must be `packages/la-gram-git/package.json`'s, or the job stops. It builds, packs,
installs the packed file globally, checks the installed version, and runs `check` on the smoke model and
on these pages' example model. Its artifact is the `.tgz`, kept a week, which `npm` and the image jobs
publish.

```yaml
package:
  stage: build
  rules:
    - if: $CI_COMMIT_TAG =~ /^la-gram-v/
      when: never
    - when: on_success
  script:
    # …
    - npm ci --prefer-offline
    - npm run build:cli
    - (cd packages/la-gram-git && npm pack)
    - npm install --global "./packages/la-gram-git/linked-archi-la-gram-git-$PACKAGE_VERSION.tgz"
    - test "$(la-gram-git --version)" = "$PACKAGE_VERSION"
    - la-gram-git check packages/la-gram-git/smoke
    - la-gram-git check docs-site/examples
```

The example model's check runs on la-gram-git's release tags too, on purpose: a la-gram-git whose
writer or findings change fails there until the example is brought up to date
([the example model](documentation.md#the-example-model)).

**`web`** (stage `build`; never on `la-gram-git-v*`): the web app, `npm run build:web`. On a
`la-gram-v*` tag, the tag's version must be `package.json`'s. It checks that the build has its page, its
icon and its WebAssembly, keeps `dist/web/` a week as its artifact, and passes `VERSION` on, for the
Releases page.

```yaml
web:
  stage: build
  rules:
    - if: $CI_COMMIT_TAG =~ /^la-gram-git-v/
      when: never
    - when: on_success
  script:
    - *la-gram-version
    - npm ci --prefer-offline
    - npm run build:web
    - test -f dist/web/index.html && test -f dist/web/favicon.svg && ls dist/web/*.wasm
    - echo "VERSION=$VERSION" > version.env
  artifacts:
    paths: [dist/web/]
    reports:
      dotenv: version.env
    expire_in: 1 week
```

**`docs`** (stage `build`, the same rules as `web`): these pages, `docs-site/` built by MkDocs and
Material for MkDocs in Python's own image, `python:3.14.10-slim-trixie`, with exactly the versions
`requirements-docs.txt` pins: `--no-deps` installs only what the file names, and `pip check` fails the
job if a package needs one it does not. `mkdocs build --strict` fails on a broken link or anchor, a page
left out of the navigation, a page without a description, or a script the server's
Content-Security-Policy would block. It needs nothing from other jobs (`needs: []`), so it starts at
once, and its artifact is `dist/web/docs/`, inside the web app's folder.

```yaml
docs:
  stage: build
  image: python:3.14.10-slim-trixie
  needs: []
  rules:
    - if: $CI_COMMIT_TAG =~ /^la-gram-git-v/
      when: never
    - when: on_success
  variables:
    PIP_CACHE_DIR: "$CI_PROJECT_DIR/.pip"
    PIP_DISABLE_PIP_VERSION_CHECK: "1"
    NO_MKDOCS_2_WARNING: "true"
  cache:
    key:
      files: [requirements-docs.txt]
    paths: [.pip/]
  script:
    - python -m venv /tmp/venv
    - /tmp/venv/bin/pip install --quiet --no-deps --requirement requirements-docs.txt
    - /tmp/venv/bin/python -m pip check
    - /tmp/venv/bin/mkdocs build --strict
    - test -f dist/web/docs/index.html && test -f dist/web/docs/search/search_index.json
  artifacts:
    paths: [dist/web/docs/]
    expire_in: 1 week
```

`npm run docs:build` runs the same build locally ([Writing the documentation](documentation.md#commands)).

## npm {#npm}

**`npm`** (stage `release`, on `la-gram-git-v*` only, after `package`): publishes the packed file to
npm, as `@linked-archi/la-gram-git`, `--access public`. A pre-release version (`0.2.0-rc.1`) goes under
the dist-tag `next`, any other under `latest`.

- **After the first release, by trusted publishing:** npm takes the pipeline's OIDC token
  (`NPM_ID_TOKEN`, audience `npm:registry.npmjs.org`) for this project and this file, holds no secret,
  and publishes provenance with the package, signed with `SIGSTORE_ID_TOKEN`. It needs npm 11.5.1 or
  later, which the job installs.
- **The first release**, before the package exists on npm to set trusted publishing up on, takes
  `NPM_TOKEN`, a protected, masked CI/CD variable, written to `.npmrc` as a reference that npm resolves,
  never as its value.

```yaml
npm:
  extends: .release
  needs: [package]
  id_tokens:
    NPM_ID_TOKEN:
      aud: "npm:registry.npmjs.org"
    SIGSTORE_ID_TOKEN:
      aud: sigstore
  script:
    - npm install --global npm@11 # trusted publishing needs npm 11.5.1 or later
    - VERSION="${CI_COMMIT_TAG#la-gram-git-v}"
    - case "$VERSION" in *-*) DIST_TAG=next ;; *) DIST_TAG=latest ;; esac
    - if [ -n "${NPM_TOKEN:-}" ]; then echo '//registry.npmjs.org/:_authToken=${NPM_TOKEN}' > "$HOME/.npmrc"; fi
    - npm publish "./packages/la-gram-git/linked-archi-la-gram-git-$VERSION.tgz" --access public --tag "$DIST_TAG"
```

## Container image {#container-image}

**`image-amd64`** and **`image-arm64`** (stage `release`, on `la-gram-git-v*`, after `package`) build
the image from the same packed file, each natively on its platform: the default amd64 runner, and
gitlab.com's Arm64 one, `saas-linux-small-arm64`. Each runs `--version` and checks the smoke model, sent
in on the standard input because the Docker service cannot see the job's files, then pushes
`<version>-<arch>`. Docker-in-Docker uses TLS between the job and its service (`DOCKER_TLS_CERTDIR`), and
on the Arm64 runners an MTU of 1400, which GitLab's documentation gives for them, or the build's
downloads can stall.

**`container-image`**, after both, makes each published tag name both platforms with
`docker buildx imagetools create`: the version, and for a release also its major version and `latest`
([Container image](../operating/container-image.md#tags)).

```yaml
.image-build:
  extends: .release
  needs: [package]
  image: docker:27.5.1
  services:
    - docker:27.5.1-dind
  variables:
    DOCKER_TLS_CERTDIR: "/certs"
  script:
    - VERSION="${CI_COMMIT_TAG#la-gram-git-v}"
    - IMAGE="$CI_REGISTRY_IMAGE/la-gram-git"
    # …
    - docker build --build-arg VERSION="$VERSION" --tag "$IMAGE:$VERSION-$ARCH" packages/la-gram-git
    - test "$(docker run --rm "$IMAGE:$VERSION-$ARCH" la-gram-git --version)" = "$VERSION"
    - docker run --rm --interactive "$IMAGE:$VERSION-$ARCH" sh -c 'cat > shop.ttl && la-gram-git check shop.ttl' < packages/la-gram-git/smoke/shop.ttl
    - docker push "$IMAGE:$VERSION-$ARCH"

image-arm64:
  extends: .image-build
  tags: [saas-linux-small-arm64]
  services:
    - name: docker:27.5.1-dind
      command: ["--mtu=1400"]
  variables:
    ARCH: arm64
```

## Desktop apps {#desktop-apps}

**`desktop`** (stage `build`) packages the app for five targets, a job each: macOS on Apple silicon and
Intel, Windows x64, Linux x64 and arm64. On a `la-gram-v*` tag the jobs run by themselves; on a merge
request or the default branch they are **manual**, may fail without failing the pipeline, and keep their
`release/` folder three days as the artifact, to try a build before a release. Other tags never run them.

Each job:

1. checks the tag's version against `package.json`;
2. runs `npm run package -- --platform "$PLATFORM" --arch "$ARCH"`, up to three times, waiting 60 and then
   120 seconds between tries, since Electron's downloads from GitHub fail now and then;
3. on macOS, signs the app ad hoc again with `rcodesign` 0.29.0, whose download's SHA-256 is checked,
   so that macOS calls a downloaded copy an app from an unidentified developer, which *Open Anyway*
   opens, rather than "damaged";
4. zips the app, `la-gram-<version>-<platform>-<arch>.zip`, or a `.tar.gz` for Linux, which keeps the
   files' modes;
5. on a tag, uploads it to the project's generic package registry, `la-gram/<version>/<file>`.

```yaml
desktop:
  stage: build
  rules:
    - if: $CI_COMMIT_TAG =~ /^la-gram-v/
    - if: $CI_COMMIT_TAG
      when: never
    - when: manual
      allow_failure: true
  parallel:
    matrix:
      - PLATFORM: darwin
        ARCH: [arm64, x64]
      - PLATFORM: win32
        ARCH: x64
      - PLATFORM: linux
        ARCH: [x64, arm64]
```

The apps are not signed by a developer: the first open of a downloaded copy asks to be allowed
([Desktop app](../getting-started/desktop.md)). Each release adds about 0.7 GB to the package registry:
delete old versions' packages there (*Deploy › Package registry*) when they are no longer wanted.

## Web deploy {#web-deploy}

**`web-deploy`** (stage `release`, on a `la-gram-v<x.y.z>` tag without a pre-release part) puts the web
app, with this documentation in its `docs/` folder and the desktop apps in its `downloads/` folder, in
place of the one on app.linked.archi, over SSH.

- **It needs both artifacts**, `web`'s `dist/web/` and `docs`'s `dist/web/docs/`, which GitLab unpacks
  into one folder, and checks that both pages are there before it copies anything: `rsync --delete`
  would take away whichever one was missing. `web`'s artifact also gives it `VERSION`.
- **The desktop apps:** it waits for the five `desktop` jobs, then fetches their files from the package
  registry with the job token, into `dist/web/downloads/`, each named without the version:

    | In the registry | On app.linked.archi |
    |---|---|
    | `la-gram/<version>/la-gram-<version>-darwin-arm64.zip` | `/la-gram/downloads/la-gram-darwin-arm64.zip` |
    | `la-gram/<version>/la-gram-<version>-darwin-x64.zip` | `/la-gram/downloads/la-gram-darwin-x64.zip` |
    | `la-gram/<version>/la-gram-<version>-win32-x64.zip` | `/la-gram/downloads/la-gram-win32-x64.zip` |
    | `la-gram/<version>/la-gram-<version>-linux-x64.tar.gz` | `/la-gram/downloads/la-gram-linux-x64.tar.gz` |
    | `la-gram/<version>/la-gram-<version>-linux-arm64.tar.gz` | `/la-gram/downloads/la-gram-linux-arm64.tar.gz` |

    and writes their sums, `SHA256SUMS.txt`. The next release replaces each file, so a link to one —
    *Download the desktop app…* in la-gram's menu, [Desktop app](../getting-started/desktop.md#download)
    — always gives the latest; the names are `DESKTOP_DOWNLOADS` in `src/help-links.ts`, and a test
    checks the pipeline fetches the same. The server keeps about 0.7 GB of them, one release's.
- **One copy, one version:** the app, its documentation and its desktop apps go in place together, in
  one `rsync`. A pre-release runs no `web-deploy`, so app.linked.archi keeps the last release's apps.
- **One at a time:** `resource_group: app-linked-archi` lets no two deploys overlap.
- **Environment** `production`, with the app's address, so GitLab lists the deploy and only this job sees
  the deploy variables.
- **The copy:** `rsync -az --delete`, folders mode 755 and files 644, into `LA_GRAM_DEPLOY_PATH` on the
  server. Files the new build no longer has are deleted.
- **The server's host key** is taken on first use with `ssh-keyscan`, as the job starts.
- **On a release tag, a failed `docs` or `desktop` job holds `web-deploy` back, and with it the
  Releases page (`la-gram-release`).** Retry the failed job, and both run.

The variables, each protected, scoped to the environment `production`, *Expand variable reference*
cleared; the values here are placeholders:

| Variable | Type | Value |
|---|---|---|
| `DEPLOY_SSH_KEY` | File | the deploy user's private SSH key, all of it, its first and last lines included, ending with a new line. *Visible*: a value of several lines cannot be masked, and as a File it is never printed, the job gets the path of a file |
| `DEPLOY_HOST` | Variable | `<deploy-host>` |
| `DEPLOY_USER` | Variable | `<deploy-user>` |
| `LA_GRAM_DEPLOY_PATH` | Variable | `<deploy-path>`, the folder the web server serves as `/la-gram/` |

```yaml
web-deploy:
  extends: .la-gram-release
  rules:
    - if: $CI_COMMIT_TAG =~ /^la-gram-v\d+\.\d+\.\d+$/
  needs:
    - job: web # the app, and VERSION
      artifacts: true
    - job: docs
      artifacts: true
    - job: desktop # uploaded to the package registry, fetched from there
      artifacts: false
  image: alpine:3.22
  resource_group: app-linked-archi
  environment:
    name: production
    url: https://app.linked.archi/la-gram/
  before_script:
    - apk add --no-cache openssh-client rsync curl
    - mkdir -p ~/.ssh && chmod 700 ~/.ssh
    - cp "$DEPLOY_SSH_KEY" ~/.ssh/id_ed25519 && chmod 600 ~/.ssh/id_ed25519
    - ssh-keyscan -t ed25519,ecdsa,rsa "$DEPLOY_HOST" >> ~/.ssh/known_hosts 2>/dev/null
  script:
    - test -n "$LA_GRAM_DEPLOY_PATH"
    # Both or neither: rsync --delete would take away whichever one is missing.
    - test -f dist/web/index.html && test -f dist/web/docs/index.html
    # …
    - mkdir -p dist/web/downloads
    - |
      for TARGET in darwin-arm64.zip darwin-x64.zip win32-x64.zip linux-x64.tar.gz linux-arm64.tar.gz; do
        curl --fail --silent --show-error --location --retry 3 --header "JOB-TOKEN: $CI_JOB_TOKEN" \
          --output "dist/web/downloads/la-gram-$TARGET" \
          "$CI_API_V4_URL/projects/$CI_PROJECT_ID/packages/generic/la-gram/$VERSION/la-gram-$VERSION-$TARGET" || exit 1
      done
    - (cd dist/web/downloads && sha256sum la-gram-* > SHA256SUMS.txt && cat SHA256SUMS.txt)
    - echo "Deploying to $DEPLOY_USER@$DEPLOY_HOST:$LA_GRAM_DEPLOY_PATH"
    - rsync -az --delete --chmod=D755,F644 dist/web/ "$DEPLOY_USER@$DEPLOY_HOST:$LA_GRAM_DEPLOY_PATH/"
```

What the server has to do with the folder is in [Hosting the web app](../operating/web-app.md).

## The Releases page {#releases-page}

**`la-gram-release`** (stage `release`, on `la-gram-v*`, after the desktop jobs and, on a release,
`web-deploy`) makes the GitLab Release *la-gram &lt;version&gt;*, with a description that says where the
web app is and how to open an unsigned app, and **seven links**:

| Link | To |
|---|---|
| *macOS (Apple silicon)*, *macOS (Intel)*, *Windows (x64)*, *Linux (x64)*, *Linux (arm64)* | the five packages in the registry |
| *Web app* | https://app.linked.archi/la-gram/ |
| *Documentation* | https://app.linked.archi/la-gram/docs/ |

It takes `VERSION` from `web`'s artifact. On a pre-release, `web-deploy` does not run and the Release is
made all the same.

```yaml
la-gram-release:
  extends: .la-gram-release
  needs:
    - job: desktop
      artifacts: false
    - job: web-deploy # not on a pre-release
      artifacts: false
      optional: true
    - job: web # VERSION
      artifacts: true
  image: registry.gitlab.com/gitlab-org/cli:latest
  # …
  release:
    tag_name: $CI_COMMIT_TAG
    name: la-gram $VERSION
    # …
    assets:
      links:
        # … the five packages
        - name: Web app
          url: https://app.linked.archi/la-gram/
          link_type: other
        - name: Documentation
          url: https://app.linked.archi/la-gram/docs/
          link_type: other
```

**This documentation goes live with the next `la-gram-v<x.y.z>` tag.** Until then,
https://app.linked.archi/la-gram/docs/ answers 404: the site is built on every merge request, and
deployed only by a release.

## Before the first release {#before-the-first-release}

Once, in the project on GitLab, by a maintainer:

1. **Protect the release tags**: *Settings › Repository › Protected tags › Add new*, `la-gram-v*` and
   `la-gram-git-v*`, each with *Create wildcard*, *Allowed to create* Maintainers. Only maintainers can then
   make or delete a release tag, and the protected variables reach only its pipelines.
2. **Let users download**: *Settings › General › Visibility, project features, permissions*: the package
   registry and the container registry for everyone with access.
3. **Create the environment `production`**: *Operate › Environments › Create an environment*, the name
   `production`, its address `https://app.linked.archi/la-gram/`.
4. **Add the deploy variables** of [web-deploy](#web-deploy): *Settings › CI/CD › Variables › Add
   variable*, each with *Protect variable* ticked, *Expand variable reference* cleared and the
   environment scope `production`.
5. **Prepare the server**: the folder `<deploy-path>`, writable by `<deploy-user>`, served at
   `/la-gram/` with the rules of [Hosting the web app](../operating/web-app.md).
6. **For la-gram-git on npm**: create the npm organization `linked-archi`, and add `NPM_TOKEN`, an npm
   granular access token that can publish `@linked-archi` packages, with an expiry, protected and masked.
   After the first release, set up trusted publishing on npmjs.com (the package's *Settings › Trusted
   publishing*: GitLab CI/CD, the project's namespace and name, the file `.gitlab-ci.yml`) just before the
   next release, since a new trusted publisher must be used within two days; then delete `NPM_TOKEN` and
   revoke the token.

## Each release {#each-release}

A release is a version set by a merge request, then an annotated tag on the merged commit. For la-gram
0.2.0:

1. On a branch from an up-to-date `main`, set the version with `npm version 0.2.0 --no-git-tag-version`
   (it writes `package.json` and `package-lock.json`, and without the option would also commit and tag,
   with its own tag name), run `npm run typecheck && npm test`, commit, push, and open the merge request.
   To try a desktop app first, run its manual `desktop` job there and download the job's artifact.
   Merge when the pipeline passes.
2. On `main`, pulled, check the version with `node -p 'require("./package.json").version'`, then tag
   and push: `git tag -a la-gram-v0.2.0 -m "la-gram 0.2.0"` and `git push origin la-gram-v0.2.0`. Or in
   GitLab: *Code › Tags › New tag*, `la-gram-v0.2.0`, from `main`, with a message.
3. Follow it in *Build › Pipelines*: `test`; `web`, `docs` and the five `desktop` jobs; then `web-deploy`
   and `la-gram-release`. When it is done, *Deploy › Releases* lists *la-gram 0.2.0*, and
   https://app.linked.archi/la-gram/, reloaded, says *Version 0.2.0* in *About la-gram*.

For la-gram-git, the same with its own version: `npm version 0.2.0 --no-git-tag-version` in
`packages/la-gram-git/`, and the tag `la-gram-git-v0.2.0`. The first la-gram release is `la-gram-v0.1.0`:
`package.json` already says 0.1.0, so step 1 needs no `npm version`.

```console
$ node -p 'require("./package.json").version'
0.1.0
$ node -p 'require("./packages/la-gram-git/package.json").version'
0.1.0
```

When something goes wrong:

- **A job fails on something passing**, a download or the network: *Retry* it in the pipeline. Do not
  tag again.
- **The tag's version is not the package's:** `web` (or `package`) stops the pipeline before anything is
  published. Delete the tag in *Code › Tags* (a protected tag cannot be deleted with Git), and locally
  with `git tag -d`; set the version, merge, and tag again.
- **Something is wrong in what was released:** do not move the tag. Fix it by a merge request, and
  release the next version.
