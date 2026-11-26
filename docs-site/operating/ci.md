---
title: la-gram-git in CI
description: The CI templates that check the la-gram models a pull or merge request changes and comment with their changes, for GitHub Actions and GitLab CI.
---
# la-gram-git in CI

Two templates, in la-gram's `ci/` folder, run [la-gram-git](../reference/la-gram-git.md) in a model
repository's CI. On each pull or merge request they:

1. **check** every model file, and fail the job when the change breaks one: a file that does not parse,
   is not as la-gram writes it, refers to what it lacks, or gains a SHACL violation
   ([`check --base`](../reference/la-gram-git.md#check-base));
2. **comment** on the request with its model changes by element, and update that comment on each later
   push ([`diff --comment`](../reference/la-gram-git.md#diff-comment)). This runs whether the check
   passed or not, and a comment that cannot be made never fails the job.

Set a repository up with `la-gram-git init github` or `la-gram-git init gitlab`
([init](../reference/la-gram-git.md#init-github)), which copy the template and overwrite nothing, or copy
the file by hand. Commit it, and open a request.

## GitHub Actions {#github-actions}

`ci/github/la-gram-git.yml`, copied to `.github/workflows/la-gram-git.yml`:

```yaml
--8<-- "ci/github/la-gram-git.yml"
```

| Part | Does |
|---|---|
| `on: pull_request` | runs for every pull request, on each push to it |
| `permissions: contents: read`, `pull-requests: write` | reads the repository, and comments with the workflow's own `GITHUB_TOKEN`. A pull request from a fork gets a read-only token: its check runs, and its changes go to the job's log instead of a comment |
| `actions/checkout@v4` with `fetch-depth: 0` | the whole history, so that the branch the change goes into is there to compare with |
| `actions/setup-node@v4`, `node-version: 22` | Node.js for `npx` |
| `npx --yes @linked-archi/la-gram-git@0 check --base "origin/${{ github.base_ref }}"` | the check, against the pull request's target branch |
| `diff "origin/${{ github.base_ref }}" --comment`, `if: always()` | the comment, even when the check failed, with `GITHUB_TOKEN` passed to the step |

The check's failures are also annotations on the files, in the pull request's *Files changed* tab
(`GITHUB_ACTIONS=true`, [environment](../reference/la-gram-git.md#environment)).

## GitLab CI {#gitlab-ci}

`ci/gitlab/la-gram-git.gitlab-ci.yml`, as the repository's `.gitlab-ci.yml` or included from it:

```yaml
--8<-- "ci/gitlab/la-gram-git.gitlab-ci.yml"
```

| Part | Does |
|---|---|
| the job `la-gram-git`, `image: node:22` | Node.js from Docker Hub; any image with Node 20 or later and Git does |
| `rules: if: $CI_PIPELINE_SOURCE == "merge_request_event"` | merge request pipelines only |
| `GIT_DEPTH: 0`, then `git fetch --quiet origin "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"` | the whole history, and the target branch, to compare with |
| `check --base "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"` | the check, against the merge request's target branch |
| `after_script: … diff … --comment` | the comment; an `after_script` runs whether the script passed or failed |

The job runs in merge request pipelines. If the rest of your pipeline runs on branch pushes, GitLab then
runs a branch pipeline and a merge request pipeline for each push to a branch with an open request;
GitLab's `workflow:rules` keep one of them.

**The comment needs a token.** The job's own `CI_JOB_TOKEN` cannot comment on a merge request, so
la-gram-git reads one from the CI/CD variable `LA_GRAM_GIT_TOKEN`:

1. Create a **project access token** (or a group access token, to share one across projects) with the
   role **Reporter**, the scope **`api`** and an expiry date.
2. Add it in *Settings › CI/CD › Variables* as `LA_GRAM_GIT_TOKEN`, **masked**. Leave it unprotected:
   merge request pipelines run on the request's branch, which is not protected, and a protected variable
   is not given to them. Anyone who can run a pipeline in the project can use it, which is why it should
   have no more than Reporter and `api`.

Without the variable the job still checks, and the changes go to the job's log, with the line
*Not commented: LA_GRAM_GIT_TOKEN is not set…*. The token is sent only to your GitLab's API
(`CI_API_V4_URL`), in a header, and never written to the log. A self-managed GitLab works the same way.

## Variations {#variations}

**Pin a version.** The templates run `@linked-archi/la-gram-git@0`, the newest 0.x release. Pin one
with `@0.1.0`, and update it when you choose:

```yaml
- npx --yes @linked-archi/la-gram-git@0.1.0 check --base "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
```

**Your own shapes.** Add `--shapes <folder>` to the `check` line to validate against a folder of your
repository's or organization's shapes (`.ttl`) as well as the metamodels'
([`check --shapes`](../reference/la-gram-git.md#check-shapes)):

```yaml
- npx --yes @linked-archi/la-gram-git@0 check --base "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" --shapes shapes/
```

**Only some files.** Name files or folders after the command; `check` searches the folders:

```yaml
- npx --yes @linked-archi/la-gram-git@0 check models/ --base "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
```

**The container image instead of npx.** It has la-gram-git installed, with Node.js and Git, so the job
downloads nothing more ([Container image](container-image.md)). On GitLab:

```yaml
la-gram-git:
  image: ghcr.io/linked-archi/la-gram-git:0
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

On GitHub Actions, as the job's container; keep the template's `on:` and `permissions:`:

```yaml
jobs:
  models:
    runs-on: ubuntu-latest
    container: ghcr.io/linked-archi/la-gram-git:0
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

The image's tags are each version, its major version and `latest`, for `linux/amd64` and `linux/arm64`
([tags](container-image.md#tags)). If your runners cannot reach Docker Hub for `node:22`, the image, or
a mirror of either, does instead.

## Merging, not only checking

CI checks a merge; it does not make one. The host merges a request as text, and two changes to one model
file can conflict as text even when they changed different elements. la-gram merges by element when it
saves to Git, so most teams need nothing more. For people who merge with `git` on the command line,
`la-gram-git init merge-driver` sets up la-gram's merge in their clone
([init merge-driver](../reference/la-gram-git.md#init-merge-driver)). GitHub and gitlab.com cannot run a
merge driver when they merge a request; a self-managed GitLab can, set up by its administrator:
[Merge driver on Gitaly](gitaly.md).
