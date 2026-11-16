---
title: la-gram
description: la-gram, the semantic modeller for enterprise and IT architecture, its web and desktop apps, la-gram-git and the collaboration server.
---
# la-gram

*Semantic Modeller for Enterprise and IT Architecture*, built on
[Linked.Archi](https://meta.linked.archi/) metamodels.

The model lives in an RDF store; the diagram, the model tree, the files and the collaboration document
are views of it. la-gram works with any metamodel that follows the Linked.Archi principles, loaded while
it runs, so the palette, the relationship rules, the notation and the validation all come from data:
ArchiMate 4.0, ArchiMate 3.2, Basic and the Architecture Decisions extension are bundled, every other language, framework and extension
published on [meta.linked.archi](https://meta.linked.archi/) is a menu entry away, and your own loads from
an address or a file.

[Open la-gram](https://app.linked.archi/la-gram/){ .md-button .md-button--primary }
[Open the example model](https://app.linked.archi/la-gram/?model=docs/examples/shop.ttl){ .md-button }

## What there is

| Product | What it is | Where to get it |
|---|---|---|
| The web app | la-gram in the browser: nothing to install, models opened from and saved to files or Git | [app.linked.archi/la-gram](https://app.linked.archi/la-gram/) |
| The desktop app | the same app for macOS, Windows and Linux, working offline with everything bundled | [Download](getting-started/desktop.md#download), or *Download the desktop app…* in la-gram's menu; every release on the project's [Releases page](https://gitlab.com/linked-archi/linked-archi-tools/modellers/la-gram/-/releases) |
| la-gram-git | the command line for model files in Git: check, fix, diff and merge them, in CI too | once released, [`@linked-archi/la-gram-git` on npm](https://www.npmjs.com/package/@linked-archi/la-gram-git) and a [container image](operating/container-image.md#tags) |
| The collaboration server | a small Node server for real-time rooms that share a model | `server/collab-server.mjs` in the [source](https://gitlab.com/linked-archi/linked-archi-tools/modellers/la-gram) |

la-gram-git is built from la-gram's own engine, so it says of a model file what la-gram would. Its
commands are in the [la-gram-git reference](reference/la-gram-git.md), and how to run it on every merge
request in [la-gram-git in CI](operating/ci.md).

## Where to go next

- [Getting started](getting-started/index.md): open la-gram in the browser or as a desktop app, then make
  [your first model](getting-started/first-model.md).
- [User guide](guide/index.md): the workbench part by part, from the canvas to Git storage.
- [Reference](reference/index.md): URL parameters, the deployment configuration file, keys, file formats
  and the la-gram-git commands, each option on its own.
- [Operating](operating/index.md): hosting the web app, running the collaboration server, la-gram-git in
  CI.
- [Developing](developing/index.md): building, testing and releasing la-gram, and writing these pages.
- [Troubleshooting and FAQ](troubleshooting.md): when something does not do what you expect.

la-gram is licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0). The
metamodels it bundles are Linked.Archi's, each under the licence it states. The open-source packages built
into it are each under their own licence: *About la-gram › Third-party licences* lists them, with their texts.
