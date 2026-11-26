---
title: Specifications
description: Where la-gram's requirements, design, task list, conventions and the broader tool specifications are, and how current each is.
---
# Specifications

These are la-gram's engineering documents: they say what la-gram is meant to do and why it is built as
it is. They live in the repository, beside the code, and are not part of this site. Where one of them and
these pages disagree, these pages follow the code; the notes below say where each stands.

## In the repository

| Document | What it is | Status |
|---|---|---|
| [`.agents/specs/la-gram/requirements.md`](https://github.com/linked-archi/la-gram/blob/main/.agents/specs/la-gram/requirements.md) | la-gram's requirements, numbered (Req 18 is the switchable modules and Git storage, Req 19 the deployment configuration) | current; the code cites it |
| [`.agents/specs/la-gram/design.md`](https://github.com/linked-archi/la-gram/blob/main/.agents/specs/la-gram/design.md) | the design: layers, data model, decisions | current |
| [`.agents/specs/la-gram/tasks.md`](https://github.com/linked-archi/la-gram/blob/main/.agents/specs/la-gram/tasks.md) | the task list by phase, what is done and next, known limitations, and a change log, newest first | current; read its known limitations with [Not yet in la-gram](../troubleshooting.md#not-yet-in-la-gram) |
| [`.agents/conventions.md`](https://github.com/linked-archi/la-gram/blob/main/.agents/conventions.md) | principles and code conventions for working on la-gram | partly out of date: it names Oxigraph 0.4 (la-gram uses 0.5), its file structure leaves out `src/git/`, `src/cli/`, `config.ts`, `modules.ts`, `settings.ts`, `packages/`, `ci/` and `scripts/`, and its *Running* section leaves out Python |
| `.agents/tasks/` | one folder per piece of work: its plan, requirements, design and report, kept while it is done | working notes; the specs above say what was decided |
| [`.agents/specs/la-queries/`](https://github.com/linked-archi/la-gram/tree/main/.agents/specs/la-queries) | the proposal and design of model questions, the SPARQL queries metamodels publish | the questions are in la-gram ([SPARQL and model questions](../guide/sparql.md)) |
| [`docs/linked-archi-tool-spec.md`](https://github.com/linked-archi/la-gram/blob/main/docs/linked-archi-tool-spec.md) | the broader Linked.Archi modelling tool specification, independent of la-gram; its Appendix D says what la-gram implements of it | Appendix D is out of date: it leaves SPARQL-based constraints to a server, which la-gram now runs itself, in the Validation tab and in `la-gram-git check`, and it predates Git storage's merge and review, folders, figures and appearance |
| [`docs/git-collaboration-spec.md`](https://github.com/linked-archi/la-gram/blob/main/docs/git-collaboration-spec.md) | the specification of Git-native collaboration on models | ahead of the code: the clean filter (C3), the commit-graph sidecar (C6), SPARQL at any commit (C7) and a room bound to a branch (C8) are not built. Of its Git plumbing, the merge driver is ([`init merge-driver`](../reference/la-gram-git.md#init-merge-driver)); what la-gram does with Git is in [Git storage](../guide/git.md) |
| [`docs/git-collaboration/reference/`](https://github.com/linked-archi/la-gram/tree/main/docs/git-collaboration/reference) | Python prototypes of the merge, the semantic diff and the commit objects, written for that specification | prototypes, not la-gram's code |
| [`README.md`](https://github.com/linked-archi/la-gram/blob/main/README.md) | the repository's front page: what la-gram does, how to run, test and release it | current, in brief; these pages give the detail |
| [`packages/la-gram-git/README.md`](https://github.com/linked-archi/la-gram/blob/main/packages/la-gram-git/README.md) | la-gram-git's README, as npm shows it | current; [la-gram-git command line](../reference/la-gram-git.md) adds the environment variables and aliases it leaves out |
| [`ci/README.md`](https://github.com/linked-archi/la-gram/blob/main/ci/README.md) | the CI templates' README | current; [la-gram-git in CI](../operating/ci.md) covers it, with the templates embedded |

Kiro reads the specs and the conventions where it looks for them: `.kiro/specs` and
`.kiro/steering/project-conventions.md` are links to `.agents/specs` and `.agents/conventions.md`.
`AGENTS.md` and `CLAUDE.md`, at the repository's root, point other coding agents to `conventions.md`, whose
*Finishing a change* lists what a change updates: tests, the README, the specs and these pages.

The Gitaly guide, `packages/la-gram-git/docs/gitaly.md`, is on this site as it is:
[Merge driver on Gitaly](../operating/gitaly.md).

## Reading them in order

1. Start with the [README](https://github.com/linked-archi/la-gram/blob/main/README.md)
   and [Developing](index.md), for the shape of the code.
2. Read `requirements.md` for what is asked, and the parts of `design.md` for the layer you change.
3. Check `tasks.md`'s known limitations and change log for what moved lately.
4. Follow `conventions.md`'s principles, and the code over its file list.
