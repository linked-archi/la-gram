---
title: la-gram-git command line
description: Every command, option and exit code of la-gram-git, la-gram's command-line tool for model repositories.
---
# la-gram-git command line

`la-gram-git` is la-gram's engine on the command line: it checks model files as la-gram would, rewrites
them as la-gram writes them, compares and merges them by element, and sets a repository up for CI. It is
built from la-gram's own source, with the metamodels la-gram bundles, so what it says of a model file is
what la-gram would.

It needs Node.js 20 or later, and Git for the commands that read history. It runs as:

- **the npm package** `@linked-archi/la-gram-git`, once released: `npx @linked-archi/la-gram-git <command>`,
  or `npm install --global @linked-archi/la-gram-git` and then `la-gram-git <command>`;
- **the container image**, with Node.js and Git inside ([Container image](../operating/container-image.md));
- **from a la-gram checkout**, after `npm run build:cli`: `node packages/la-gram-git/dist/la-gram-git.js <command>`.

The examples below were run that last way, from a la-gram checkout, on its smoke model
(`packages/la-gram-git/smoke/`), on the example model of these pages (`docs-site/examples/`) and on scratch
copies. They are written as `la-gram-git`, which is the same program installed.

| Command | Does |
|---|---|
| [`check`](#check) | fails a model file that does not parse, is not as la-gram writes it, refers to what it lacks, or breaks a shape |
| [`fix`](#fix) | rewrites model files as la-gram writes them |
| [`diff`](#diff) | the changes to model files by element, as Markdown |
| [`merge`](#merge) | Git's merge driver: merges a model file by element |
| [`init`](#init-github) | sets a repository up: the CI file for GitHub or GitLab, or the merge driver |

## Commands

### `check [paths…]` {#check}

Checks each model file it is given, or finds in the folders it is given; the **current folder** when it
is given none. A file **fails** when it:

1. does not parse;
2. is not exactly as la-gram writes it: its triples in la-gram's order, prefixes and layout. The output
   says from which line it differs, and gives the [`fix`](#fix) command;
3. refers to something it does not have: a relationship's source or target, a view's node, a folder's
   entry;
4. has a SHACL violation, from the shapes of the metamodels it declares ([`--base`](#check-base) narrows
   this to violations a change adds).

**Never failed, only listed:** warnings and info, counted; and the findings of the shapes' SPARQL-based
rules (ArchiMate's principles, viewpoint conformance and the like), which are advisory for now. Each
finding names its shape's IRI, which on meta.linked.archi opens the shape's documentation.

The example model, from inside its folder, with no path given:

```console
$ cd docs-site/examples && la-gram-git check
✓ shop.ttl
  · 3 from the shapes' SPARQL-based rules (advisory):
  ·   warning: Gift wrapping (Service) · Service Gift wrapping is not realized by anything. (https://meta.linked.archi/archimate4/principle-shapes#ServiceWithoutRealizationShape)
  ·   info: Online ordering (Service) · Service Online ordering is realized by only one application component (Web shop). Consider redundancy for critical services. (https://meta.linked.archi/archimate4/principle-shapes#SinglePointOfFailureShape)
  ·   info: Card payment (Service) · Service Card payment is realized by only one application component (Payments). Consider redundancy for critical services. (https://meta.linked.archi/archimate4/principle-shapes#SinglePointOfFailureShape)

1 model file checked: all well.
```

Two copies of it that fail, one with a Turtle comment added and one whose Serving points at
`m:storefront`, which it does not have (exit code 1, output shortened with `…`):

```console
$ la-gram-git check broken
✗ broken/commented.ttl
    not as la-gram writes it (from line 1): `la-gram-git fix broken/commented.ttl` rewrites it
  · 3 from the shapes' SPARQL-based rules (advisory):
  …
✗ broken/dangling.ttl
    https://example.org/acme/shop/card-payment-serves-web-shop (Serving) · Target: Every QualifiedRelationship must have exactly one arch:target pointing to a ModelConcept. (https://meta.linked.archi/core-shapes#QualifiedRelationshipShape)
    …
    https://example.org/acme/shop/card-payment-serves-web-shop (Serving) · Target: Its target is not in the model: https://example.org/acme/shop/storefront
  …

2 of 2 model files failed.
```

### `check --base <branch>` {#check-base}

With `--base <branch>`, a SHACL violation fails only when the change adds it. la-gram-git finds where
the current branch left `<branch>` (`git merge-base`), checks each file again as it was there, and lists
the violations it already had as *N violations already there where the branch started (not failed)*. An
old model can then be improved one request at a time. Parsing, the written form and missing references
fail whatever the base.

`<branch>` is any Git revision: `origin/main` in CI, where the target branch has been fetched.

```console
$ la-gram-git check --base b98b9d4~1 packages/la-gram-git/smoke
✓ packages/la-gram-git/smoke/shop.ttl
  · 1 warning, 0 info
  · 5 from the shapes' SPARQL-based rules (advisory):
  …

1 model file checked: all well.
```

The smoke model did not exist at `b98b9d4~1`, so nothing was there to compare with, and the result is
the plain check's.

### `check --shapes <folder>` {#check-shapes}

Adds the shapes in a folder's `.ttl` files to the metamodels': your repository's own rules, or your
organization's. Each file must be a shapes document as la-gram loads one: it parses, and names its graph
with an `owl:Ontology` (or a `skos:ConceptScheme`). A file that does not is refused by name, before any
model is checked, with exit code 2. Its violations fail the check like the metamodels' own.

A shapes file that asks every application component for a definition:

```turtle
@prefix owl: <http://www.w3.org/2002/07/owl#>.
@prefix sh: <http://www.w3.org/ns/shacl#>.
@prefix skos: <http://www.w3.org/2004/02/skos/core#>.
@prefix am4: <https://meta.linked.archi/archimate4/onto#>.
@prefix acme: <https://example.org/acme/shapes#>.

<https://example.org/acme/shapes> a owl:Ontology.

acme:ComponentHasDefinition a sh:NodeShape;
    sh:targetClass am4:ApplicationComponent;
    sh:property [
        sh:path skos:definition;
        sh:minCount 1;
        sh:severity sh:Violation;
        sh:message "Every application component says what it is (skos:definition)."
    ].
```

```console
$ la-gram-git check --shapes shapes docs-site/examples
✗ docs-site/examples/shop.ttl
    Web shop (Application Component) · Definition: Every application component says what it is (skos:definition). (https://example.org/acme/shapes#ComponentHasDefinition)
    Payments (Application Component) · Definition: Every application component says what it is (skos:definition). (https://example.org/acme/shapes#ComponentHasDefinition)
  · 3 from the shapes' SPARQL-based rules (advisory):
  …

1 of 1 model file failed.
```

The same file without its `owl:Ontology` line, and a folder that is not there (exit code 2 each):

```console
$ la-gram-git check --shapes shapes-bad docs-site/examples
la-gram-git: --shapes: acme-shapes.ttl declares no owl:Ontology. A shapes document names its graph with one: <https://example.org/my-shapes> a owl:Ontology .
`la-gram-git --help` lists the commands.
$ la-gram-git check --shapes /srv/acme/shapes docs-site/examples
la-gram-git: --shapes takes a folder: /srv/acme/shapes is not one.
`la-gram-git --help` lists the commands.
```

### `fix [paths…]` {#fix}

Rewrites each model file exactly as la-gram writes it, the same paths as `check` takes. A file that is
already so is left untouched. Turtle comments go: anything a file should say belongs in its RDF, as a
`skos:editorialNote`, for example. A file named on the command line that is not a model is left as it
is, with a message. `fix` always exits 0 when it could run.

```console
$ la-gram-git fix models
Rewrote models/shop.ttl
1 file rewritten.
$ la-gram-git fix models
Every model file is as la-gram writes it.
$ la-gram-git fix shapes/acme-shapes.ttl
shapes/acme-shapes.ttl: not a la-gram model, left as it is.
Every model file is as la-gram writes it.
```

### `diff <branch> [paths…]` {#diff}

What a change does to its model files, **by element**, as Markdown: the concepts added, changed and
removed, worded as la-gram's History tab words them. The change runs from where it left `<branch>` (the
merge base, as a merge request's own diff does) to `HEAD`, or to [`--head`](#diff-head).

- **Without paths**, every model file the change touched. **With paths**, those files, which are file
  paths from the repository's top: unlike `check`, `diff` does not search folders.
- The output starts with the line `<!-- la-gram-git:diff -->`, which lets
  [`--comment`](#diff-comment) find its comment again.
- `diff` reads Git's history and changes nothing; it exits 0 when it could run.

The smoke model, as the commit that added it changed it, in la-gram's own history:

```console
$ la-gram-git diff b98b9d4~1 --head b98b9d4 packages/la-gram-git/smoke/shop.ttl
<!-- la-gram-git:diff -->
## Model changes by element

### `packages/la-gram-git/smoke/shop.ttl` (new)

**Changes by element:** 4 added

- ➕ **Smoke test** _Model_ — added
  - Name (en): “Smoke test”
  - + Model conforms to metamodel: ArchiMate4Metamodel
- ➕ **Billing** _Application Component_ — added
  - Name (en): “Billing”
  - + Serves: Portal
- ➕ **Portal** _Application Component_ — added
  - Name (en): “Portal”
- ➕ **Serving** Billing → Portal — added
  - Source: Billing
  - Target: Portal

<sub>la-gram-git, from 4a850331 to b98b9d4</sub>
```

A folder given as a path is not searched, so nothing is compared:

```console
$ la-gram-git diff b98b9d4~1 --head b98b9d4 packages/la-gram-git/smoke
<!-- la-gram-git:diff -->
## Model changes by element

_No model file changed._

<sub>la-gram-git, from 4a850331 to b98b9d4</sub>
```

### `diff --head <ref>` {#diff-head}

The end of the change: **`HEAD`** by default, or any revision. Without it, the footer says *to this
change*:

```console
$ la-gram-git diff b98b9d4 packages/la-gram-git/smoke/shop.ttl
<!-- la-gram-git:diff -->
## Model changes by element

### `packages/la-gram-git/smoke/shop.ttl`

_No changes to the model._

<sub>la-gram-git, from b98b9d4b to this change</sub>
```

### `diff --comment` {#diff-comment}

Also posts the Markdown as a comment on the pull or merge request the CI job runs for, or updates
la-gram-git's earlier comment there (the one with the `<!-- la-gram-git:diff -->` marker), so a request
has one comment that follows its pushes. It reads the request from the CI's
[environment](#environment):

| CI | Needs | Comments as |
|---|---|---|
| GitHub Actions | `GITHUB_TOKEN` for the step, and a `pull_request` event | the workflow's token, with `pull-requests: write` |
| GitLab CI | a merge request pipeline, and `LA_GRAM_GIT_TOKEN` | a project or group access token, role Reporter, scope `api` |

When it cannot comment, it says why on the standard error, starting *Not commented:*, and still exits 0:
a comment that cannot be made (a fork's read-only token, say) never fails the job. The token goes only
to the host's API, in a header.

Run outside CI, then as a GitLab job outside a merge request, then in one without the token, then as a
GitHub step without its token (each prints the Markdown above, then):

```text
Not commented: not running in GitHub Actions or GitLab CI.
Not commented: this pipeline does not run for a merge request.
Not commented: LA_GRAM_GIT_TOKEN is not set: a project or group access token, in a masked CI/CD variable, is needed to comment (the job token cannot).
Not commented: GITHUB_TOKEN is not set for this step (env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}).
```

### `merge <base> <ours> <theirs> <path>` {#merge}

Git's merge driver for model files: Git calls it with `%O %A %B %P`, the common version, ours, theirs and
the file's path. It merges **by element**, as la-gram's *Save to Git* does, and writes the result into
`<ours>` as la-gram writes it.

- **No conflict:** exit 0.
- **Conflicts:** they are listed on the standard error, and the driver exits 1, so Git marks the file
  conflicted. Where two changes met, the file holds the version before either, never `<<<<<<<` markers,
  which no RDF tool could read. Edit the file, or open it in la-gram, or take one side with
  `git checkout --ours` / `--theirs`, then `git add` it.
- **A file that is not a la-gram model** on both sides, or does not parse, is merged as text, as Git
  would without the driver (`git merge-file`): with conflict markers where the changes meet.

`la-gram-git init merge-driver` sets it up ([below](#init-merge-driver)). Run by hand, on three copies of
the example model: ours renames *Gift wrapping*, theirs renames *Card payment*:

```console
$ la-gram-git merge base.ttl ours.ttl theirs.ttl models/shop.ttl
$ grep 'prefLabel "Gift wrap\|prefLabel "Card pay' ours.ttl
    skos:prefLabel "Card payments"@en;
    skos:prefLabel "Gift wrap"@en;
```

Two other copies in which both sides rename *Gift wrapping*, differently (exit code 1):

```console
$ la-gram-git merge base.ttl ours2.ttl theirs2.ttl models/shop.ttl
la-gram-git: models/shop.ttl: 1 change made on both sides to the same thing:
  Gift wrapping (Service) · Name (en) — changed differently on each side: ours “Gift wrap”, theirs “Gift-wrapping service”
Where two changes met, the file holds the version before either. Edit it — or open it in la-gram — or take one side whole with `git checkout --ours` / `--theirs`, then `git add` it.
```

A shapes file, which is not a model, changed differently on both sides:

```console
$ la-gram-git merge base.ttl ours2.ttl theirs2.ttl shapes/acme-shapes.ttl
la-gram-git: shapes/acme-shapes.ttl is not a la-gram model, so it was merged as text: 1 conflict, marked in the file.
$ grep -c '^<<<<<<< ours' ours2.ttl
1
```

Changed apart, a sentence on one side and a line on the other, the same file merges cleanly as text,
with exit code 0.

### `init github` {#init-github}

Writes the GitHub Actions workflow, `.github/workflows/la-gram-git.yml`, at the top of the repository it
runs in: pull requests then have their models checked and get a comment with their changes. It
overwrites nothing. The workflow is described in [la-gram-git in CI](../operating/ci.md#github-actions).

```console
$ la-gram-git init github
Wrote .github/workflows/la-gram-git.yml: commit it, and pull requests have their models checked.
$ la-gram-git init github
.github/workflows/la-gram-git.yml is there already: left as it is.
```

### `init gitlab` {#init-gitlab}

Writes the GitLab CI job: into a new `.gitlab-ci.yml`, or, when the repository has one, into
`la-gram-git.gitlab-ci.yml` beside it, to `include:`. It overwrites nothing, and says which token the
comment needs ([la-gram-git in CI](../operating/ci.md#gitlab-ci)).

```console
$ la-gram-git init gitlab
Wrote .gitlab-ci.yml: commit it, and merge requests have their models checked.
To comment on merge requests, add a project or group access token (role Reporter, scope api) as a masked CI/CD variable named LA_GRAM_GIT_TOKEN.
$ la-gram-git init gitlab
Wrote la-gram-git.gitlab-ci.yml beside your .gitlab-ci.yml. Include it there:
  include:
    - local: la-gram-git.gitlab-ci.yml
To comment on merge requests, add a project or group access token (role Reporter, scope api) as a masked CI/CD variable named LA_GRAM_GIT_TOKEN.
$ la-gram-git init gitlab
la-gram-git.gitlab-ci.yml is there already: left as it is.
```

### `init merge-driver` {#init-merge-driver}

Routes the model files to la-gram-git's merge, in two places:

- **`.gitattributes`**, committed, so it is everyone's: one line per model extension, added only where
  missing;
- **this clone's Git configuration**, `merge.la-gram-git.name` and `merge.la-gram-git.driver`: each
  clone's own. A clone without them merges the files as text, as before. Each person runs
  `la-gram-git init merge-driver` once, with la-gram-git installed globally.

GitHub and gitlab.com cannot run a merge driver when they merge a request; a self-managed GitLab can, set
up by its administrator ([Merge driver on Gitaly](../operating/gitaly.md)).

```console
$ la-gram-git init merge-driver
Added 6 lines to .gitattributes: commit it.
Defined the la-gram-git merge driver in this clone's Git configuration; each clone runs `la-gram-git init merge-driver` once (with la-gram-git installed: npm install --global @linked-archi/la-gram-git).
$ cat .gitattributes
# Model files merged by element (la-gram-git)
*.ttl merge=la-gram-git
*.trig merge=la-gram-git
*.jsonld merge=la-gram-git
*.nq merge=la-gram-git
*.nt merge=la-gram-git
*.rdf merge=la-gram-git
$ git config --get-regexp '^merge\.la-gram-git\.'
merge.la-gram-git.name la-gram models, merged by element
merge.la-gram-git.driver la-gram-git merge %O %A %B %P
```

A second run adds nothing, and says *.gitattributes routes the model files already.*

### `--help` {#help}

`--help`, `-h` and `help` print the usage on the standard output and exit 0. **No command at all prints
the same usage and exits 2**, as does an unknown command, with a line saying so.

```console
$ la-gram-git --help
la-gram-git — la-gram's models in Git: checked, rewritten, compared, merged.

  la-gram-git check [paths…] [--base <branch>] [--shapes <folder>]
      Each model file parses, is exactly as la-gram writes it, refers to
      nothing it lacks, and breaks no shape. With --base, a violation fails
      only when the change adds it (the file as it was where the branch left
      <branch> is checked too). The shapes' SPARQL-based rules are reported,
      not failed. --shapes adds a folder's shapes (.ttl) to the metamodels'.

  la-gram-git fix [paths…]
      Rewrite model files exactly as la-gram writes them.

  la-gram-git diff <branch> [paths…] [--head <ref>] [--comment]
      What the change does to its model files, by element, as Markdown — since
      it left <branch>. With --comment, also posted on the pull or merge
      request the CI job runs for, or updated there.

  la-gram-git merge <base> <ours> <theirs> <path>
      Git's merge driver (%O %A %B %P): the model merged by element.

  la-gram-git init github|gitlab|merge-driver
      Set this repository up: the CI file for GitHub or GitLab, or the merge
      driver for model files.

Paths are files or folders (searched for model files: .ttl .trig .jsonld .nq .nt .rdf); the
current folder when none is given.
$ la-gram-git frobnicate
la-gram-git: No command "frobnicate".
`la-gram-git --help` lists the commands.
```

### `--version` {#version}

`--version` and `-v` print the package's version and exit 0.

```console
$ la-gram-git --version
0.1.0
```

## Which files are models {#which-files}

A **model file** has a model extension, `.ttl`, `.trig`, `.jsonld`, `.nq`, `.nt` or `.rdf`, and an
`arch:Model` in it. Commands take files and folders. Folders are searched, in name order, skipping
hidden folders and files (a leading `.`) and `node_modules`. Other RDF files found in a folder, such as
vendored ontologies and shapes, are left alone. A file named on the command line that is not a model
fails `check`, and `fix` leaves it as it is with a message.

```console
$ la-gram-git check shapes
No model files to check.
$ la-gram-git check shapes/acme-shapes.ttl
✗ shapes/acme-shapes.ttl
    not a la-gram model: it has no arch:Model

1 of 1 model file failed.
```

## Exit codes {#exit-codes}

| Exit code | Means |
|---|---|
| **0** | all is well: every model file checked passed; `fix`, `diff` and `init` did their work; a merge had no conflict |
| **1** | a model file failed `check`, or a `merge` left conflicts |
| **2** | it could not run: no command, an unknown one, a wrong argument, a path that is not there, a refused `--shapes` file, or Git failing |

```console
$ la-gram-git check docs-site/examples; echo $?
…
1 model file checked: all well.
0
$ la-gram-git check nowhere; echo $?
la-gram-git: nowhere is not there.
`la-gram-git --help` lists the commands.
2
```

## Environment {#environment}

| Variable | Read by | Does |
|---|---|---|
| `LA_GRAM_GIT_DEBUG` | every command | set to anything: la-gram's own log lines, such as which metamodels loaded, are printed on the standard output. Unset, they are left out, so that `diff`'s standard output is only its Markdown |
| `GITHUB_ACTIONS=true` | `check`, `diff --comment` | `check` also writes each failure as a `::error` annotation on its file; `--comment` comments on GitHub |
| `GITHUB_TOKEN` | `diff --comment` on GitHub | the token to comment with: the workflow's own, `${{ secrets.GITHUB_TOKEN }}` |
| `GITHUB_EVENT_PATH` | `diff --comment` on GitHub | the event file, from which the pull request's number is read |
| `GITHUB_API_URL` | `diff --comment` on GitHub | the API, **`https://api.github.com`** by default; GitHub Enterprise sets its own |
| `GITHUB_REPOSITORY` | `diff --comment` on GitHub | the repository, `owner/name` |
| `GITLAB_CI=true` | `diff --comment` | comment on GitLab |
| `CI_MERGE_REQUEST_IID` | `diff --comment` on GitLab | the merge request; absent outside a merge request pipeline |
| `LA_GRAM_GIT_TOKEN` | `diff --comment` on GitLab | the access token to comment with; the job's own token cannot |
| `CI_API_V4_URL` | `diff --comment` on GitLab | the API, **`https://gitlab.com/api/v4`** by default; GitLab sets it for a self-managed instance |
| `CI_PROJECT_ID` | `diff --comment` on GitLab | the project |

GitHub Actions and GitLab CI set all of these themselves but `LA_GRAM_GIT_DEBUG` and the two tokens,
which the job passes. Warnings always go to the standard error.

A failure as GitHub sees it (output shortened):

```console
$ GITHUB_ACTIONS=true la-gram-git check broken/commented.ttl
✗ broken/commented.ttl
    not as la-gram writes it (from line 1): `la-gram-git fix broken/commented.ttl` rewrites it
  …
::error file=broken/commented.ttl,title=la-gram-git::not as la-gram writes it (from line 1): `la-gram-git fix broken/commented.ttl` rewrites it

1 of 1 model file failed.
```

What `LA_GRAM_GIT_DEBUG` adds (the first lines):

```console
$ LA_GRAM_GIT_DEBUG=1 la-gram-git check packages/la-gram-git/smoke
[app] Loaded metamodel ArchiMate 4.0 Metamodel (13 graphs, notation set https://meta.linked.archi/archimate4/notation#ArchiMate40StandardNotation).
[app] 4 referenced graphs were not loaded: https://meta.linked.archi/archimate4/derivation# (skipped), https://meta.linked.archi/archimate4/reference-models# (skipped), https://meta.linked.archi/archimate4/deliverable-templates# (skipped), https://meta.linked.archi/archimate/framework# (skipped)
…
✓ packages/la-gram-git/smoke/shop.ttl
…
```

## Git {#git}

`check --base`, `diff`, `merge` (for files that are not models) and `init merge-driver` run the `git`
on the `PATH`, in the current folder: `git show`, `git merge-base`, `git diff --name-only`,
`git rev-parse --show-toplevel`, `git config` and `git merge-file`. They read files at a commit without
checking anything out, so they work on a CI's detached checkout. In CI, fetch the history and the target
branch: `fetch-depth: 0` on GitHub, `GIT_DEPTH: 0` and a `git fetch` on GitLab. Git's own message is
passed on, with exit code 2:

```console
$ la-gram-git diff main
la-gram-git: fatal: not a git repository (or any of the parent directories): .git
```

## Metamodels {#metamodels}

la-gram-git has the metamodels la-gram bundles, and only those: ArchiMate 4.0 and 3.2, la-gram's Basic
metamodel and the Linked.Archi core. It works **offline**: it fetches nothing from meta.linked.archi.
A model that declares a metamodel it does not have is validated without that metamodel, and the output
says so; the check does not fail for it. A newer la-gram-git release brings newer metamodels.

A copy of the smoke model that declares the C4 metamodel:

```console
$ la-gram-git check c4-model
✓ c4-model/shop.ttl
  · 1 warning, 0 info
  …
  · validated without https://meta.linked.archi/c4/metamodel#C4Model: la-gram-git does not have it

1 model file checked: all well.
```
