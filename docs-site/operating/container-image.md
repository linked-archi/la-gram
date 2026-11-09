---
title: Container image
description: la-gram-git's container image, with Node.js and Git, its build arguments, what it holds, its tags, and how to build it yourself.
---
# Container image

la-gram-git's container image holds the npm package, installed globally, with Node.js and Git. A CI job
that uses it as its image runs `la-gram-git` with nothing to download; on a desktop, it runs la-gram-git
without installing Node.js.

```console
$ docker run --rm -v "$PWD/packages/la-gram-git/smoke:/repo" la-gram-git:docs-example la-gram-git check
✓ shop.ttl
  · 1 warning, 0 info
  · 5 from the shapes' SPARQL-based rules (advisory):
  ·   warning: Billing (Application Component) · Application component Billing directly serves another application component Portal without an intermediary service. (https://meta.linked.archi/archimate4/principle-shapes#DirectComponentToComponentServingShape)
  …

1 model file checked: all well.
```

Mount the repository at `/repo`, the image's working folder, and name the command:
`docker run --rm -v "$PWD:/repo" <image> la-gram-git check`. Commands that read history
(`check --base`, `diff`) need the repository's `.git` in the mount, which mounting its top folder gives.

## Build arguments {#build-arguments}

| Argument | Values | Default |
|---|---|---|
| `NODE_IMAGE` | the base image: any Node.js 20 or later image based on Debian, as `apt-get` installs Git | **`node:22-bookworm-slim`** |
| `VERSION` | the version written into the image's `org.opencontainers.image.version` label; it changes nothing else | **`0.0.0`** |

The release pipeline passes `VERSION` from the release tag. Read the labels with `docker image inspect`:

```console
$ docker build --build-arg VERSION=0.1.0 -t la-gram-git:docs-example packages/la-gram-git
…
#11 naming to docker.io/library/la-gram-git:docs-example done
$ docker image inspect --format '{{json .Config.Labels}}' la-gram-git:docs-example
{"org.opencontainers.image.description":"la-gram's architecture models in Git: checked, rewritten as la-gram writes them, compared and merged by element","org.opencontainers.image.documentation":"https://gitlab.com/linked-archi/linked-archi-tools/modellers/la-gram/-/tree/main/packages/la-gram-git","org.opencontainers.image.licenses":"Apache-2.0","org.opencontainers.image.source":"https://gitlab.com/linked-archi/linked-archi-tools/modellers/la-gram","org.opencontainers.image.title":"la-gram-git","org.opencontainers.image.version":"0.1.0"}
```

Another base image, Node 20's:

```console
$ docker build --build-arg VERSION=0.1.0 --build-arg NODE_IMAGE=node:20-bookworm-slim -t la-gram-git:docs-node20 packages/la-gram-git
…
$ docker run --rm la-gram-git:docs-node20 sh -c 'node --version && la-gram-git --version'
v20.20.2
0.1.0
```

## Contents {#contents}

- **Node.js**, from the base image (22, by default).
- **Git and `ca-certificates`**, from Debian: `check --base`, `diff`, `merge` and `init` call Git, and
  `diff --comment` calls the Git host's API over HTTPS.
- **`git config --system --add safe.directory '*'`**: a repository mounted into the container belongs to
  the host's user, not the container's, and Git refuses to read a repository another user owns. The image
  runs nothing but la-gram-git, so it trusts the one it is given.
- **la-gram-git**, installed globally with `npm install --global` from the packed `.tgz`, so the image
  holds exactly what npm publishes.
- **`WORKDIR /repo`**, empty.
- **No `ENTRYPOINT` of its own.** A CI job runs its script in the image's shell, which an entrypoint
  would replace; the base image's `docker-entrypoint.sh` runs whatever command is given. Name the tool:
  `la-gram-git check`.
- **`CMD ["la-gram-git", "--help"]`**: run with no command, the image prints the usage.

```console
$ docker run --rm la-gram-git:docs-example la-gram-git --version
0.1.0
$ docker run --rm la-gram-git:docs-example sh -c 'node --version; git --version; git config --system --get-all safe.directory; ls /repo | wc -l'
v22.23.4
git version 2.39.5
*
0
$ docker run --rm la-gram-git:docs-example
la-gram-git — la-gram's models in Git: checked, rewritten, compared, merged.
…
$ docker image inspect --format '{{json .Config.WorkingDir}} {{json .Config.Cmd}} {{json .Config.Entrypoint}}' la-gram-git:docs-example
"/repo" ["la-gram-git","--help"] ["docker-entrypoint.sh"]
```

A model can also go in on the standard input, which is how the release pipeline tries each image, since
its Docker service cannot see the job's files:

```console
$ docker run --rm -i la-gram-git:docs-example sh -c 'cat > /repo/shop.ttl && la-gram-git check' < packages/la-gram-git/smoke/shop.ttl
✓ shop.ttl
…
1 model file checked: all well.
```

## Tags {#tags}

Each la-gram-git release publishes the image to la-gram's GitLab container registry, as
`$CI_REGISTRY_IMAGE/la-gram-git`, which for la-gram's project is
`registry.gitlab.com/linked-archi/linked-archi-tools/modellers/la-gram/la-gram-git`:

| Tag | For release `0.1.0` | For a pre-release `0.2.0-rc.1` |
|---|---|---|
| the version | `:0.1.0` | `:0.2.0-rc.1` |
| the major version | `:0` | — |
| `latest` | `:latest` | — |
| per platform | `:0.1.0-amd64`, `:0.1.0-arm64` | `:0.2.0-rc.1-amd64`, `:0.2.0-rc.1-arm64` |

The version, major and `latest` tags each cover `linux/amd64` and `linux/arm64`, so x86 and Arm runners
take the image for their platform. Each platform's image is built and tried on its own platform before
the tags are made ([Releasing](../developing/releasing.md#container-image)). The CI templates' variations
use `:0` ([la-gram-git in CI](ci.md#variations)). Until the first la-gram-git release, the registry has
no tag, and a pull answers *no such manifest*: build the image yourself, below.

```console
$ docker manifest inspect registry.gitlab.com/linked-archi/linked-archi-tools/modellers/la-gram/la-gram-git:0
no such manifest: registry.gitlab.com/linked-archi/linked-archi-tools/modellers/la-gram/la-gram-git:0
```

## Build it yourself {#build-it-yourself}

From a la-gram checkout, after `npm ci`: build the package, pack it, and build the image from the packed
file. `packages/la-gram-git/.dockerignore` leaves out everything but `linked-archi-la-gram-git-*.tgz`, so
the build context is the packed package alone, exactly what npm would install.

```console
$ npm run build:cli && (cd packages/la-gram-git && npm pack)
…
npm notice filename: linked-archi-la-gram-git-0.1.0.tgz
npm notice package size: 853.2 kB
npm notice unpacked size: 7.0 MB
npm notice total files: 273
linked-archi-la-gram-git-0.1.0.tgz
$ docker build --build-arg VERSION=0.1.0 -t la-gram-git:docs-example packages/la-gram-git
…
$ docker run --rm la-gram-git:docs-example la-gram-git --version
0.1.0
```

To copy the published image into your own registry, pull its tag and push it under your name, or copy
the multi-platform list with `docker buildx imagetools create --tag <your-registry>/la-gram-git:0
registry.gitlab.com/linked-archi/linked-archi-tools/modellers/la-gram/la-gram-git:0`.

Remove what the build left behind with `docker image rm la-gram-git:docs-example` and
`rm packages/la-gram-git/linked-archi-la-gram-git-*.tgz`.
