# la-gram-git

la-gram's architecture models in Git — checked, rewritten as la-gram writes them, compared by element,
merged by element — on the command line and in CI.

It is built from [la-gram](https://github.com/linked-archi/la-gram)'s own
engine, with the metamodels la-gram bundles, so what it says of a model file is what la-gram would: each
file is opened as la-gram's *File › Open* opens it, and validated against the same shapes.

```sh
npx @linked-archi/la-gram-git check --base origin/main   # fails a change that breaks a model
npx @linked-archi/la-gram-git fix                        # rewrites model files as la-gram writes them
npx @linked-archi/la-gram-git diff origin/main           # the change by element, as Markdown
npx @linked-archi/la-gram-git init gitlab                # or github: CI for pull and merge requests
```

## Install

- **npx**, nothing installed: `npx @linked-archi/la-gram-git <command>`. Node.js 20 or later.
- **Globally**, for the merge driver or everyday use: `npm install --global @linked-archi/la-gram-git`,
  then `la-gram-git <command>`.
- **The container image**, with Node.js and Git included: see [The container image](#the-container-image).

`la-gram-git --help` lists the commands; `la-gram-git --version` gives the version.

## Which files are models

A model file has a model extension — `.ttl`, `.trig`, `.jsonld`, `.nq`, `.nt` or `.rdf` — and an
`arch:Model` in it. Commands take files and folders; folders are searched, skipping hidden folders and
`node_modules`; with none, the current folder is searched. Other RDF files found in a folder, such as
vendored ontologies and shapes, are left alone. A file named on the command line that is not a model is an
error for `check`.

## Commands

### `check [paths…] [--base <branch>] [--shapes <folder>]`

Fails when a model file:

- does not parse;
- is not exactly as la-gram writes it — its triples serialized as la-gram's *Save* writes them: order,
  prefixes and layout. The output says from which line it differs and gives the `fix` command;
- refers to something it does not have: a relationship's source or target, a view's node, a folder's entry;
- has a SHACL violation from the shapes of the metamodels it declares.

With `--base <branch>`, a violation fails only when the change adds it: the file is checked again as it was
where the current branch left `<branch>`, and violations it had there are listed, not failed. Parsing, the
written form and missing references fail always.

Never failed, only listed: warnings and info (counted), and the findings of the shapes' SPARQL-based rules —
ArchiMate's principles, viewpoint conformance and the like — which are advisory for now. Each finding names
the IRI of its shape; on meta.linked.archi the IRI opens the shape's documentation.

Also listed, never failed: the model's IRIs that are outside the layout every Linked.Archi tool mints
([IRI Minting](https://meta.linked.archi/docs/guide/iri-minting/)) — a name not `{kind}/{id}`, a shape not named in
its view, a part not under its owner, a second `#`, a character a path cannot hold — and a namespace the model
does not state, or one that is not an `https:` or `http:` IRI ending in `/`. Names given before the layout,
la-gram's `element-…`, the converters' `view/…/node/…` and the Linked.Archi derivation rules' `derivation-…`, are
counted as legacy: no tool renames them.

`--shapes <folder>` adds the shapes (`.ttl`) of a folder — your repository's, or your organisation's — to the
metamodels'. Each file is a shapes document, as la-gram loads one: it names its graph with an
`owl:Ontology` (`<https://example.org/my-shapes> a owl:Ontology .`). A file that does not parse or names no
graph is refused, by name, before any model is checked (exit 2).

In GitHub Actions, each failure is also written as an annotation on its file.

### `fix [paths…]`

Rewrites model files exactly as la-gram writes them, changing no triple. It does not add what opening a
model in la-gram adds — a default view, a layout, retired vocabulary migrated: that is not a matter of how
the file is written.

### `diff <branch> [paths…] [--head <ref>] [--comment]`

What the change does to its model files, by element, as Markdown on the standard output: the concepts
added, changed and removed, as la-gram's History tab words them — since the change left `<branch>`, as a
host's own diff of a request is. `--head` compares another ref than `HEAD`; paths limit it to those files.

With `--comment`, the Markdown is also posted on the pull or merge request the CI job runs for, or
la-gram-git's earlier comment there is updated:

- **GitHub Actions** — with `GITHUB_TOKEN` in the step's environment (`pull-requests: write`);
- **GitLab CI**, gitlab.com or self-managed — with a project or group access token (role Reporter, scope
  `api`) in the masked CI/CD variable `LA_GRAM_GIT_TOKEN`; the job's own token cannot comment.

Without a token, or outside a request, the comment is skipped with the reason on the standard error. A
comment that cannot be made never changes the exit code.

### `merge <base> <ours> <theirs> <path>`

Git's merge driver for model files (Git passes `%O %A %B %P`): the model merged by element, with la-gram's
own merge — the one *Save to Git* uses. Two changes to different elements merge even where they touched
neighbouring lines. The result is written to `<ours>` as la-gram writes it.

Where the two changes met, it exits 1 and Git marks the file conflicted. The changes meet when:
- one property of one element was changed both ways;
- one side deleted an element the other changed;
- a node was moved, or a line rerouted, both ways on a view;
- together, the two changes break a metamodel's count limit.

At those places the file holds the version from before either change (a deleted element is kept for now),
never `<<<<<<<` markers, which no RDF tool could read. The conflicts are listed in words on the standard
error.

When one side moved the model to another namespace, which renames every IRI in it, the common version and the
other side are moved after it first, each IRI keeping its local part, and the driver says so: the other
side's changes land in the new namespace. Both sides moved alike: merged as one. Each to a namespace of its
own: not merged, the file left as yours, exit 1.

`.gitattributes` routes files by extension, so ontologies and shapes files come to the driver too. A file
that is not a la-gram model on both sides, or does not parse, is merged as Git merges text without the
driver: with conflict markers where the changes meet. Resolve them in la-gram, or by editing the
file, and commit it.

### `init github|gitlab|merge-driver`

Sets the repository you run it in up. Nothing is overwritten.

- `github` writes `.github/workflows/la-gram-git.yml`.
- `gitlab` writes `.gitlab-ci.yml`, or, when there is one, `la-gram-git.gitlab-ci.yml` beside it, to
  `include:`.
- `merge-driver` routes the model files to the driver in `.gitattributes` — commit that, for everyone — and
  defines the driver in this clone's Git configuration. Each person runs it once in their clone, with
  la-gram-git installed globally; a clone without it merges model files as text, as before.

The CI templates and how to set them up — the token, pinning a version, your own shapes, the container image
in a job — are described in
[ci/README.md](https://github.com/linked-archi/la-gram/blob/main/ci/README.md).

## The container image

`ghcr.io/linked-archi/la-gram-git` has la-gram-git installed globally on Node.js 22, with Git.

- **Tags:** each version (`0.1.0`), its major version (`0`) and `latest`. A pre-release (`0.2.0-rc.1`) has
  only its own tag. For a build that never changes, pin the digest `docker pull` prints:
  `…/la-gram-git@sha256:…`.
- **Platforms:** `linux/amd64` and `linux/arm64`, under each tag: Docker takes the one for its machine,
  an Apple silicon Mac or an ARM runner included. The release builds each on its own platform and tries
  it there; `<version>-amd64` and `<version>-arm64` are those builds, which the tags above combine.
- **No entrypoint:** name the tool in the command, `docker run … la-gram-git check`. Without a command
  it prints the help.

On your machine, mount the repository's top folder (Git needs its `.git`) at `/repo`, the working folder:

```sh
IMAGE=ghcr.io/linked-archi/la-gram-git:0
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/repo" "$IMAGE" la-gram-git check --base origin/main
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/repo" "$IMAGE" la-gram-git fix
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/repo" "$IMAGE" la-gram-git diff origin/main > changes.md
```

- **`--user`** makes the files `fix` rewrites belong to you rather than to root. Whoever owns the mounted
  repository, the image lets Git read it (Git's `safe.directory`). In PowerShell, write `-v "${PWD}:/repo"`
  and leave `--user` out.
- **Paths** are the container's: relative to `/repo`. A `--shapes` folder outside the repository is
  mounted too: `-v "$HOME/our-shapes:/shapes:ro"` … `--shapes /shapes`.
- **`--base`** compares with a branch the clone has. Fetch it on your machine first: `git fetch origin main`.

**In CI**, make it the job's image — `image:` on GitLab, `container:` on GitHub Actions; both are in
[ci/README.md](https://github.com/linked-archi/la-gram/blob/main/ci/README.md).
The job's environment then reaches la-gram-git as it is, which `diff --comment` needs. Run with `docker run`
inside a job instead, the variables have to be passed in with `-e`: on GitLab `GITLAB_CI`,
`CI_MERGE_REQUEST_IID`, `CI_PROJECT_ID`, `CI_API_V4_URL` and `LA_GRAM_GIT_TOKEN`.

**Your own registry.** Where your machines or runners cannot reach `ghcr.io`, copy the image
into your registry:

```sh
docker pull ghcr.io/linked-archi/la-gram-git:0.1.0
docker tag ghcr.io/linked-archi/la-gram-git:0.1.0 registry.example.com/tools/la-gram-git:0.1.0
docker push registry.example.com/tools/la-gram-git:0.1.0
```

Or build it yourself: the `Dockerfile` is in la-gram's repository, beside the package.

**Not for the merge driver.** Git runs the driver once for every model file it merges, and starting a
container each time adds to every merge: install the npm package where the driver runs.

## The merge driver on the server

GitHub and gitlab.com merge a pull or merge request as text and cannot run a merge driver. A self-managed
GitLab can, set up by its administrator on its Gitaly servers — an option, never a requirement:
[la-gram's merge driver on Gitaly](https://github.com/linked-archi/la-gram/blob/main/packages/la-gram-git/docs/gitaly.md).
la-gram itself merges by element when it saves to Git, and `check` in CI holds on every host.

## Metamodels

Bundled: ArchiMate 4.0 and 3.2, la-gram's basic metamodel, and Linked.Archi's core, with their shapes, from
[meta.linked.archi](https://meta.linked.archi). la-gram-git reads only these copies and makes no network
request, apart from `diff --comment` to the host's API. A model that declares a metamodel la-gram-git does
not have is validated without it, and `check` says so.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | All is well. |
| 1 | `check`: a model file failed. `merge`: the merge left conflicts. |
| 2 | It could not run: a wrong argument, a path that is not there, Git failing. |

## Environment

| Variable | Read by | |
|---|---|---|
| `GITHUB_TOKEN` | `diff --comment` in GitHub Actions | the workflow's token, to comment |
| `LA_GRAM_GIT_TOKEN` | `diff --comment` in GitLab CI | a project or group access token, to comment |
| `LA_GRAM_GIT_DEBUG` | every command | set, it keeps la-gram's own log on the standard output |

Tokens are read from the environment, sent only to the host's API in a header, and never written or shown.

## Licence

Apache License 2.0. The metamodel files under `assets/` are Linked.Archi's, each under the licence it
states.
