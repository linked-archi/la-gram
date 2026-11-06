# la-gram-git in CI

Two templates check the la-gram models a pull or merge request changes, and comment on the request with
its changes by element:

| File | For | Set up with |
|---|---|---|
| [`github/la-gram-git.yml`](github/la-gram-git.yml) | GitHub Actions | `npx @linked-archi/la-gram-git init github` |
| [`gitlab/la-gram-git.gitlab-ci.yml`](gitlab/la-gram-git.gitlab-ci.yml) | GitLab CI — gitlab.com and self-managed | `npx @linked-archi/la-gram-git init gitlab` |

`init` copies the template into the repository you run it in and overwrites nothing: on GitLab, a
repository that has a `.gitlab-ci.yml` gets `la-gram-git.gitlab-ci.yml` beside it, to include. You can copy
the files by hand as well. Commit the result, and open a request.

## What the job does

1. **`la-gram-git check --base <target branch>`** checks every model file in the repository: a file with a
   model extension (`.ttl`, `.trig`, `.jsonld`, `.nq`, `.nt`, `.rdf`) and an `arch:Model` in it. Other RDF
   files, such as vendored ontologies and shapes, are left alone. **The job fails** when a model file:
   - does not parse;
   - is not exactly as la-gram writes it (the output says which `la-gram-git fix` command rewrites it);
   - refers to something it does not have — a relationship end, a view's node, a folder entry;
   - has a SHACL violation that the change adds. Violations the file already had where the branch started
     are listed, not failed, so an old model can be improved one request at a time.

   Warnings and Info are counted, never failed. Findings of the shapes' SPARQL-based rules (ArchiMate's
   principles, viewpoint conformance) are listed and do not fail the job for now. Each finding names the
   IRI of its shape, which opens the shape's documentation. On GitHub each failure is also an annotation
   on the file.
2. **`la-gram-git diff <target branch> --comment`** writes the request's model changes by element as
   Markdown — the concepts added, changed and removed, as la-gram's History tab words them — into the job's
   log, and posts them as a comment on the request. On a later push it updates the same comment. It runs
   whether or not the check passed, and a comment that cannot be made never fails the job.

The checks use the metamodels bundled with la-gram-git: ArchiMate 4.0 and 3.2, la-gram's basic metamodel and
Linked.Archi's core. A model declaring a metamodel the tool does not have is validated without it, and the
output says so.

## GitHub Actions

The workflow runs on `pull_request`. It comments with the workflow's own `GITHUB_TOKEN`, which is why it
asks for `pull-requests: write`. A pull request from a fork gets a read-only token: its check runs, and its
diff goes to the job's log instead of a comment.

## GitLab CI

The job runs in merge request pipelines (`$CI_PIPELINE_SOURCE == "merge_request_event"`). If the rest of your
pipeline runs on branch pushes, GitLab then runs both a branch pipeline and a merge request pipeline for
each push to a branch with an open request; GitLab's documentation on `workflow:rules` describes how to keep
one.

**The comment needs a token.** The job's own `CI_JOB_TOKEN` cannot comment on a merge request, so
la-gram-git reads one from the CI/CD variable `LA_GRAM_GIT_TOKEN`:

1. Create a **project access token** (or a group access token, to share one across projects) with the role
   **Reporter**, the scope **`api`**, and an expiry date.
2. Add it under *Settings › CI/CD › Variables* as `LA_GRAM_GIT_TOKEN`, **masked**. Leave it unprotected:
   merge request pipelines run on the request's branch, which is not protected, and a protected variable is
   not given to them. Anyone who can run a pipeline in the project can therefore use it — which is why it
   should have no more than Reporter and `api`.

Without the variable the job still checks, and the diff goes to the job's log. The token is sent only to
your GitLab's API (`CI_API_V4_URL`), in a header, and never written to the log.

**Self-managed GitLab** works the same way: la-gram-git reads the instance's API address from the job.
The template uses the `node:22` image from Docker Hub. If your runners cannot reach it, use a mirror, or
la-gram-git's own image (below).

## Variations

- **Pin a version.** The templates run `@linked-archi/la-gram-git@0`, the newest 0.x release. Write
  `@0.1.0` to pin one, and update it when you choose.
- **Your own shapes.** Add `--shapes <folder>` to the `check` line to validate against a folder of your
  repository's or organisation's shapes (`.ttl`) as well as the metamodels'. Each file names its graph
  with an `owl:Ontology`, as a shapes document does; one that does not is refused by name.
- **Only some files.** Name files or folders after the command: `check models/ --base …`.
- **The container image instead of npx.** It has la-gram-git installed, with Node.js and Git, so the job
  downloads nothing more. On GitLab:

  ```yaml
  la-gram-git:
    image: registry.gitlab.com/linked-archi/linked-archi-tools/modellers/la-gram/la-gram-git:0
    rules:
      - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    variables:
      GIT_DEPTH: 0
    script:
      - git fetch --quiet origin "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
      - la-gram-git check --base "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
    after_script:
      - la-gram-git diff "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" --comment
  ```

  On GitHub Actions, as the job's container. Keep the template's `on:` and `permissions:`:

  ```yaml
  jobs:
    models:
      runs-on: ubuntu-latest
      container: registry.gitlab.com/linked-archi/linked-archi-tools/modellers/la-gram/la-gram-git:0
      steps:
        - uses: actions/checkout@v4
          with:
            fetch-depth: 0
        - name: Check the models
          run: la-gram-git check --base "origin/${{ github.base_ref }}"
        - name: Comment with their changes by element
          if: always()
          run: la-gram-git diff "origin/${{ github.base_ref }}" --comment
          env:
            GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  ```

  Tags: each version (`0.1.0`), its major version (`0`) and `latest`. The image is built for `linux/amd64`,
  as GitHub's and gitlab.com's standard runners are. Its tags, platform, local use and copying it into your
  own registry are described in
  [the package's README](https://gitlab.com/linked-archi/linked-archi-tools/modellers/la-gram/-/blob/main/packages/la-gram-git/README.md#the-container-image).

## Merging, not only checking

CI checks a merge; it does not do one. The host merges a request as text, and two changes to one model
file can conflict as text even when they changed different elements. la-gram itself merges by element
when it saves to Git, so most teams need nothing more. For people who merge with `git` on the command line,
`la-gram-git init merge-driver` sets up la-gram's merge in their clone. GitHub and gitlab.com cannot run a
merge driver when they merge a request; a self-managed GitLab can, configured by its administrator:
see [la-gram's merge driver on Gitaly](https://gitlab.com/linked-archi/linked-archi-tools/modellers/la-gram/-/blob/main/packages/la-gram-git/docs/gitaly.md).
