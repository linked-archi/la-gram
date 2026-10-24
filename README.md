# la-gram

An RDF-first architecture modeller for [Linked.Archi](https://meta.linked.archi/) metamodels.

The model lives in an RDF store; the diagram, the model tree, files and the
collaboration document are views of it. Metamodels — ArchiMate 4.0 and 3.2
and Basic bundled (Basic is the generic language, to add alongside another or
use alone: its Connection relates any two elements), and every other language,
framework and extension published on `meta.linked.archi` (the Metamodels menu
lists its catalogue) — are loaded at runtime, so the palette, the relationship
rules, the notation and the validation all come from data.

- **Model / views** — one model, any number of diagram, catalog and matrix views; an element is one resource wherever it appears. Delete from a view or from the model.
- **Relationships the metamodel permits** — connect, change type and the "+" menu offer only what the metamodel's relationship shapes allow (ArchiMate's relationship matrix); "+" appends a new element — asking which relationship when several fit — or brings in what the element is already related to in the model.
- **Published vocabulary** — `arch:inModel`, `arch:inView`, qualified relationships plus their unqualified triples, which they `rdf:reifies` (RDF 1.2), `arch-vis:ArchNode`/`Link` geometry; older models are migrated on open.
- **Graph** — the Graph tab draws what the selected element is related to, 1–5 hops out, filterable by element and relationship type; the query behind it — as a SELECT (a table) or a CONSTRUCT (the triples) — runs in the SPARQL tab or downloads as `.rq`; the graph becomes a new view, laid out as drawn, or a Turtle file.
- **SPARQL** — the SPARQL Query tab shows results as tables with prefixed names that select the concept; *Render as new view* makes a diagram of the elements and relationships a result mentions.
- **Notation as published** — elements are drawn from the notation data in the shapes the published pictures show (ArchiMate's banded objects, 3D devices, wavy deliverables, the meaning cloud, the dashed grouping folder; EDGY's arrows and tag pills, C4's person…) — a notation declares its own shapes, with their geometry, in its own files — with their badges and label colours, and relationship ends from the published marker symbols. A kind of element with a look of its own is a class of its own (C4's Database, drawn as a cylinder); another audience's look is another notation set.
- **Validation** — live SHACL against the loaded metamodels' shapes and the core shapes; the Validation tab counts the violations.
- **Change an element's type** — in the property panel, the *type* field lists every element type of the loaded metamodels (or right-click › Change type…); the element keeps its identity, name, properties and placements, and relationships the new type does not permit are named before and kept after (validation flags them).
- **Right-click menu** — on an element or a relationship: rename, change type, append; show its properties, its place in the model tree or its relationship graph; copy its IRI; delete it from the view or the model.
- **Nesting** — drop or move an element onto another to draw it inside: it moves with its container, which grows to hold it; the drop asks which relationship the nesting stands for (composition, assignment, … — what the notation says nesting may draw and the metamodel permits), or none. Nested ArchiMate Exchange diagrams import nested.
- **Rename in place** — double-click an element's box (or select it and press F2) and type its name; Enter keeps it, Esc drops it, undo brings the old one back.
- **About ‹type›** — under the model tree, what the loaded ontology and taxonomy say about the selected type (for a view, its viewpoint) or the type picked in the palette: definition, guidance, other names, classification and the other types in its group, superclasses, changes, the specification section. Folds to its header; resizes by its top edge.
- **Properties** — the selected concept in vertical tabs (information, properties, analysis, views); adding a property offers what applies to its type (by the vocabularies' `rdfs:domain` and SHACL shapes), what the model already uses and documentation properties — or any name, prefixed name or IRI. A property whose shape lists its values is a choice of them; a boolean is a checkbox.
- **Files** — Turtle, TriG (per-layer graphs), JSON-LD, N-Quads, N-Triples, RDF/XML; ArchiMate Exchange import; SVG/PNG export.
- **Settings** — *File › Settings…*, kept on this machine and applied at once: which modules are on, and Git's defaults — repository, branch, folder for new files, the commit message (`{action} {model}`, with `{path}` and `{branch}`), the start of a new branch's name, whether *Remember* starts ticked — the tokens kept and the host kinds learned, to forget. What the deployment sets (below) is shown, not offered for change.
- **Git** — *File › Open from Git…* opens a model from a GitHub or GitLab repository (github.com, gitlab.com, GitHub Enterprise, self-managed GitLab) by its address: a link to a file opens it, a link to a repository, branch or folder lists its model files — or another branch's. *File › Save to Git…* commits the model as one file, to a branch or a new one, at a path whose extension picks the format. The model stays bound to its file — the next save asks only for the message — and a save never overwrites a change it has not seen: when the file moved on, it goes to a new branch, overwrites, or the newer version is opened instead, as chosen. A public repository opens without a token; otherwise the token is asked for, sent to its host only, and kept encrypted with the system keychain by the desktop app, for the session by the browser (or, if asked, in the browser). A module that can be switched off: *File › Settings…*, `?git=off`, or `LA_GRAM_GIT=off npm run build` to leave it out.
- **Collaboration** — real-time rooms (Yjs over Hocuspocus) that share the model's triples; presence and soft locks.
- **Undo everywhere** — every canvas change, including placements and model-level deletes, and every property edit.
- **History** — the History tab saves *checkpoints* of the model, each with a message; lists them with what each changed, shows a checkpoint's triples added and removed — or how the model differs from it now — and restores one (undoably). Checkpoints are kept on this machine (IndexedDB), per model: they are not Git commits — *File › Save to Git…* makes those.
- **See the RDF** — the "{ } RDF" toggle opens a panel on the right with the live model as Turtle (or any other format), exactly as it would be saved.
- **Layout** — the model tree on the left; the palette on the right; under the canvas, tabs for **Properties**, **Validation** (with the violation count), **SPARQL Query**, **Graph** and **History**. The tree, the palette and the RDF panel hide from the toolbar ("☰ Model", "▦ Palette", "{ } RDF") and resize by their inner edge; the bottom panel resizes by its top edge, folds to its tabs (click the open tab) and maximizes over the workspace (⤢; Esc restores). Sizes are remembered.
- **Your namespace** — every IRI is an HTTP URI in the model's namespace, written as `m:element-…`, `m:view-…`. New models start under the placeholder `https://example.org/`; **Model settings** (click the model name) sets your own namespace and prefix and moves the model into it.

## Run

Requires Node 22+.

```bash
npm ci
npm run dev            # build and serve on http://localhost:8080
npm run collab         # optional: collaboration server on ws://localhost:1234
```

Then open http://localhost:8080. Useful URL parameters:

| Parameter | Example | Meaning |
|---|---|---|
| `metamodel` | `?metamodel=https://meta.linked.archi/c4/metamodel%23C4Model` | metamodel(s) to load (repeatable) |
| `assets` | `?assets=remote-first` | `bundled-first` (default), `remote-first`, `offline` |
| `model` | `?model=https://example.org/shop.ttl` | open a model file by URL |
| `room` / `ws` / `user` | `?room=shop&user=Ana` | join a collaboration room |
| `rdf` | `?rdf=1` | start with the RDF panel open |
| `base` | `?base=https://acme.com/ea/` | base for new models' namespaces (`{base}{notation}/{uuid}/`), `https://example.org/` by default |
| `git` | `?git=https://github.com/acme/arch/blob/main/models/shop.ttl` | open a model from Git at startup; `off` switches Git storage off for the session |

### Deployment configuration

An optional `la-gram.config.json` beside `index.html` sets, for everyone using that installation, which modules it offers and how Git storage behaves. Drop it into a built directory, or build it in — `LA_GRAM_CONFIG=deploy/acme.json npm run build` (or `npm run package` for the desktop app):

```json
{
  "modules": { "git": "on" },
  "git": {
    "hosts": [
      { "host": "github.com", "kind": "github" },
      { "host": "git.acme.example", "kind": "gitlab", "api": "https://git.acme.example/api/v4" }
    ],
    "rememberTokens": "ask",
    "defaults": {
      "repository": "https://git.acme.example/architecture/models",
      "branch": "main",
      "folder": "models",
      "message": "{action} {model}",
      "branchPrefix": "la-gram/"
    }
  }
}
```

- `modules.git` — `on` (the default), `off` (until a user switches it on in *File › Settings…*) or `unavailable` (not offered).
- `git.hosts` — when given, the only Git hosts la-gram talks to: an address on another is refused before anything is asked or sent. `kind` is `github` or `gitlab`; `api` defaults to `https://api.github.com`, `https://HOST/api/v3` (GitHub Enterprise) or `https://HOST/api/v4` (GitLab).
- `git.rememberTokens` — `ask` (the default: users may tick *Remember*) or `never` (tokens are kept for the session only, in the browser and the desktop app).
- `git.defaults` — what a new save starts from; the message template knows `{action}` (Add, Update), `{model}`, `{path}` and `{branch}`.

It is read once at startup, from the app's own address only. A file that fails the check — not JSON, an unknown value, anything that looks like a token or password (tokens are never configured) — is reported, and Git storage stays off until it is fixed. Keys la-gram does not know are reported and ignored.

Desktop: `npm run build:electron && npm run electron` runs it (Electron 44; the renderer is sandboxed and without Node, and reaches files only through the native dialogs); `npm run package` builds the app for this machine into `dist/packages/la-gram-<platform>-<arch>/` (`-- --platform win32 --arch x64` for another). The app carries only the desktop build — the bundled metamodels included, so it works offline — and is not signed: on macOS, open it with right-click › Open the first time. In a terminal inside VS Code, run it with `ELECTRON_RUN_AS_NODE` unset (`env -u ELECTRON_RUN_AS_NODE npm run electron`): VS Code sets it, and Electron then starts as plain Node.

### Bundled metamodels, and refreshing them

ArchiMate 4.0 and 3.2, Basic, the core vocabularies and their icons and markers ship in `assets/`, a
snapshot of what meta.linked.archi serves, used first (`?assets=bundled-first`), with
meta.linked.archi's catalogue (`assets/catalog.ttl`) — the metamodels the Metamodels menu offers,
complete offline; unless offline, the published catalogue replaces it when it arrives. To refresh it
from a `linked-archi-meta` checkout (by default `../../../linked-archi-meta`):

```bash
npm run sync-assets -- --check   # what differs (exit 1 if anything does)
npm run sync-assets              # update assets/, then: npm run build
npm run sync-assets -- --meta ~/src/linked-archi-meta
```

It runs linked-archi-meta's own publishing scripts into a temporary folder and refreshes each
bundled file from its published path, so it maps files exactly as the site does. The catalogue
comes from the checkout's last generated site (`.onto-docs/catalog.ttl`; run
`.scripts/docgen/generate-docs.sh` there for a current one). Everything bundled is
meta.linked.archi's. Asset fetches always revalidate, so after a rebuild a plain reload loads the
new files.

## Test

```bash
npm run typecheck
npm test                    # unit + jsdom integration (Vitest)
npm run test:browser:build  # production build + Playwright suite (needs Chrome, or LA_GRAM_CHROME)
```

## Collaboration server

`server/collab-server.mjs` keeps each room in `data/rooms/<room>.nt` (one triple
per line, authoritative) and `<room>.ttl` (pretty Turtle), and serves the live
model over HTTP: `GET /rooms`, `GET /rooms/<room>.ttl`. Configure with `PORT`
and `DATA_DIR`.

## Documentation

- `.kiro/specs/la-gram/` — requirements, design, tasks (what is done, what is next, and a change log)
- `.kiro/steering/project-conventions.md` — principles and code conventions
- `docs/linked-archi-tool-spec.md` — the broader, implementation-independent tool specification; Appendix D says what la-gram implements of it
