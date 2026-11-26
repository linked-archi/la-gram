---
title: Developing
description: How la-gram is put together, its architecture and source layout, and where to start changing it.
---
# Developing

la-gram is a TypeScript application: one source tree, built by webpack into the web app, the desktop
app and la-gram-git. Its model of record is an RDF store; everything else is a view of it. And it has no
code for any one modelling language: the palette, the relationship rules, the notation, the viewpoints,
validation and the model questions all come from the metamodel documents it loads.

| Page | Covers |
|---|---|
| [Building](building.md) | the npm scripts, build switches and outputs |
| [Testing and benchmarks](testing.md) | the type check, unit tests, browser suite and benchmarks |
| [Bundled metamodels and icons](assets.md) | updating the kernel’s pinned semantic assets, and rendering the icons |
| [Releasing](releasing.md) | the workflow, job by job, how the server installs a release, and how to make one |
| [Writing the documentation](documentation.md) | these pages: their toolchain, rules and example model |
| [Specifications](specifications.md) | the requirements, design and conventions, and how current each is |

## Layers

From the platform up to the UI; `createApp`, in `src/app.ts`, puts them together.

```text
Platform (web | Electron)  →  RDF engine  →  Metamodel manager  →  Model manager  →  Import/Export  →  UI
src/platform/                 @linked-archi/kernel/rdf-engine/  @linked-archi/kernel/metamodel-manager/  @linked-archi/kernel/model-manager/  src/import-export/  src/ui/
```

| Layer | Does |
|---|---|
| **Entry**, `src/index.ts` | reads the [URL parameters](../reference/url-parameters.md), starts reading the [deployment configuration](../reference/configuration.md), creates the app and mounts the UI, opens `?model=`, starts collaboration, registers the switchable modules and starts those that are on, and guards unsaved changes |
| **Platform**, `src/platform/` | what differs between the browser and the desktop: files, secrets |
| **RDF engine**, `@linked-archi/kernel/rdf-engine/` | the store: Oxigraph, compiled to WebAssembly, under an observable wrapper that undo and collaboration listen to; SHACL validation, the SPARQL-based constraints (run with Oxigraph) and the relationship tables, in a Web Worker, 300 ms after the last change |
| **Metamodel manager**, `@linked-archi/kernel/metamodel-manager/` | where metamodel documents come from (uploaded, bundled, published, in the [`assets`](../reference/url-parameters.md#assets) order), the manifest-driven loader that follows `arch:*` references and `owl:imports`, the DCAT catalogue, the palette, notation lookup, viewpoints, taxonomy and the type guide |
| **Model manager**, `@linked-archi/kernel/model-manager/` | the session (the model and its open view), namespaces and IRIs, elements, relationships, views and folders, appearance and label expressions, names and pictures per presentation, derived relationships, model questions, diff and merge, and the History checkpoints in IndexedDB |
| **Import/Export**, `src/import-export/` | the ArchiMate exchange import and image export; complete RDF [model files](../reference/file-formats.md) are read and written by `@linked-archi/kernel/import-export/model-io.js` |
| **UI**, `src/ui/` | Lit web components in an `<app-shell>`; `mount-ui.ts` wires each panel to the app: panels emit events, `mount-ui` acts on them. The canvas is diagram-js, with la-gram's own modules for rendering, rules, modelling, the context pad, popup menus, label editing and line docking |
| **Modules**, `src/modules.ts` | the parts that can be switched off; Git storage, `src/git/`, is loaded into a chunk of its own when it starts, and a build can leave it out |
| **Collaboration**, `src/collab/` | the store's model mirrored into a Yjs document, one entry per triple; presence (name, colour, open view, selection) over Hocuspocus; the [server](../operating/collaboration-server.md) is `server/collab-server.mjs` |
| **CLI**, `src/cli/` | [la-gram-git](../reference/la-gram-git.md): the same `createApp` in Node, offline, with validation inline, one app per file |
| **Desktop**, `src/electron-main.ts`, `src/electron-preload.ts` | the Electron window, its `app://` scheme and policy, and the bridge ([Desktop app internals](../reference/desktop.md)) |

## The data model

- **The model is the store's default graph.** Each metamodel document loaded is a named graph of its own,
  named by its ontology IRI, so a model never mixes with its metamodel.
- **Membership and conformance** are statements: `arch:inModel`, `arch:inView`,
  `arch:modelConformsToMetamodel`, `arch:viewConformsToViewpoint`.
- **Relationships** are written twice: the plain triple, and a relationship resource with `arch:source`
  and `arch:target`, linked by `rdf:reifies` (RDF 1.2).
- **Geometry** is RDF too: `arch-vis:ArchNode` and `arch-vis:Link`, with IRI-named list cells, no blank
  nodes.
- **At rest**, a format with graphs splits the model into `{ns}graph/model`, `{ns}graph/semantic` and
  `{ns}graph/views`, plus `{ns}graph/provenance`; retired terms are migrated as a file opens
  ([File formats and vocabulary](../reference/file-formats.md)).

While the app runs, the browser's console has it, for looking around:
`window.__LA_GRAM_APP__`, `__LA_GRAM_UI__`, `__LA_GRAM_COLLAB__` and `__LA_GRAM_MODULES__`.

## Where to start

1. `npm ci`, then `npm run dev`, and open http://localhost:8080/ ([Building](building.md)).
2. Read `src/index.ts`, then `createApp` in `src/app.ts`: the whole start-up, in order.
3. Pick the layer of your change from the table above; each folder's main file opens with a comment that
   says what it does and why.
4. Before a pull request: `npm run typecheck && npm test`, and `npm run test:browser` after a change to
   the canvas or the panels ([Testing](testing.md)).
