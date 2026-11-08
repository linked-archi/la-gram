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
- **Model tree** — the whole model on the left in three groups, Views, Elements and Relationships: by type, or with the model's own folders in them, each kind in folders of its own. A model converted from Archi (or another tool that keeps folders) opens in its folders, each folded, subfolders then concepts by name, and what no folder holds by type after them; *Folders* | *Types* in the tree's header switches, remembered in this browser (on a model without folders, *Folders* is greyed out). Make folders from the right-click menu — *New folder…* on a group or in a folder, *Rename…*, *Delete folder* (what it holds is kept) — and file a view, element, relationship or folder with *Move to folder…*, which lists the group's folders with their paths, filters by any words you type and puts the ones you last used first, or by dragging rows onto a folder. Ctrl/Cmd- or Shift-click selects several in the tree, and a selection on the canvas moves too (right-click one of them); all undoable, and saved with the model. To keep an Archi model's folders, export it from Archi with `--xmlexchange.exportFolders` before converting it — without that option Archi's Exchange file has none. Filter by name or type; the open view's concepts are marked.
- **Relationships the metamodel permits** — connect, change type and the "+" menu offer only what the metamodel's relationship shapes allow (ArchiMate's relationship matrix); "+" appends a new element — asking which relationship when several fit — or brings in what the element is already related to in the model. A line drawn for a relationship the model already has between the two, but this view does not show, asks whether to use that one or make another.
- **Published vocabulary** — `arch:inModel`, `arch:inView`, qualified relationships plus their unqualified triples, which they `rdf:reifies` (RDF 1.2), `arch-vis:ArchNode`/`Link` geometry; older models are migrated on open.
- **Graph** — the Graph tab draws what the selected element is related to, 1–5 hops out, filterable by element and relationship type; the query behind it — as a SELECT (a table) or a CONSTRUCT (the triples) — runs in the SPARQL tab or downloads as `.rq`; the graph becomes a new view, laid out as drawn, or a Turtle file.
- **SPARQL** — the SPARQL Query tab shows results as tables with prefixed names that select the concept; *Render as new view* makes a diagram of the elements and relationships a result mentions.
- **Model questions** — the questions the core and the model's language publish (ArchiMate 4.0 and 3.2 so far: "Which services does nothing realise?", "What is affected if this element changes?"): the SPARQL tab's *Questions* menu lists them by stage, those fitting the open view's viewpoint first, filterable by concern; picking one runs its query, bound to the open model, view and viewpoint and the selected element, and says what a row means and what it does not prove. Right-click an element › *Ask about this element…* for the questions about it. A view of the answer follows the question's viewpoint.
- **Notation as published** — elements are drawn from the notation data in the shapes the published pictures show (EDGY's arrows and tag pills, C4's person…) — a notation declares its own shapes, with their geometry, in its own files — with their badges and label colours, and relationship ends from the published marker symbols. A kind of element with a look of its own is a class of its own (C4's Database, drawn as a cylinder); another audience's look is another notation set.
- **Validation** — live SHACL against the loaded metamodels' shapes and the core shapes, relationships checked against the relationship tables, the shapes' SPARQL-based rules (ArchiMate's self-loops and principles, core's viewpoint rules) run with Oxigraph, and references to anything the model does not have; it runs in a background worker, so editing never waits for it. The Validation tab shows the open view's findings or the whole model's, and counts the violations; each finding links to the shape it comes from, on the metamodel's documentation. *Model checks* adds, on request, the findings the loaded languages' questions state — orphans, unrealised services, unrealised requirements…
- **Change an element's type** — in the property panel, the *Type* field searches every element type of the loaded metamodels by name (or right-click › Change type…), their IRIs a switch away — types that share a name show theirs; the element keeps its identity, name, properties and placements, and relationships the new type does not permit are named before and kept after (validation flags them).
- **Back and forward between views** — ← and → in the toolbar, or Alt+← / Alt+→, go back to the views you came from (the model tree, *Appears in views*, a revealed concept — any way you got there), each as you left it: zoom, scroll and selection.
- **Right-click menu** — on an element or a relationship: rename, change type, move to a folder (when the model has folders), append; show its properties, its place in the model tree, its relationship graph, the questions about it, or a relationship's ends; copy its IRI; delete it from the view or the model. On one of several selected: move them all to a folder. On the empty canvas, the open view's: rename it, set its viewpoint, duplicate it, select all, zoom to fit, its properties, its place in the tree, its IRI, export it as SVG or PNG, delete it.
- **Nesting** — drop or move an element onto another to draw it inside: it moves with its container, which grows to hold it and keeps its name at the top, above what is inside; the drop asks which relationship the nesting stands for (composition, assignment, … — what the notation says nesting may draw and the metamodel permits), or none. While nested, no line runs between the element and its container — the nesting shows them; moved out, the relationships the view showed are drawn as lines again. Nested ArchiMate Exchange diagrams import nested. Relationships' lines, and their names, are drawn above every element, nested ones included, as ArchiMate tools draw them.
- **Rename in place** — double-click an element's box (or select it and press F2) and type its name; Enter keeps it, Esc drops it, undo brings the old one back. A relationship is named the same way, on its line: double-click the line (or its name), or select it and press F2; emptied, its name is removed.
- **An element placed twice** — drag an element from the model tree onto a view that already shows it to place it again, as ArchiMate allows: each placement moves, nests and is deleted on its own, lines join the placements they were drawn between — a relationship can be drawn again from another placement — and selecting the element selects every placement.
- **Groups, notes and shapes** — the *Shapes* switch above the canvas opens a row of figures drawn with no model element behind them: a group (its name in a tab, holding elements), a sticky note, and rectangles, ellipses, circles, diamonds, hexagons, octagons and parallelograms — dragged onto the diagram, or clicked and placed; renamed, moved, resized and deleted as elements are; selected, the panel gives their text, and their look in the *Appearance* tab. Connect from a note (or a group or a shape) draws a dashed line to what it is about — drawing only, no relationship in the model; its Appearance tab makes it solid or dotted, puts an arrowhead, a diamond or a dot at either end and sets its text's font. Double-click the line (or select it and press F2) to write on it: the text is drawn at its middle — drag it elsewhere, as a relationship's name — and is the line's *Text* in the panel. An ArchiMate Exchange file's groups, notes and the lines from them import as these.
- **Appearance** — select an element, a relationship's line, a figure or a line from a note on the canvas (one or several) and the property panel's *Appearance* tab sets how it looks in this view: fill colour, gradient and opacity, line colour, width, opacity and style, icon colour, text alignment and position, font (name, size, bold, italic, underline) and font colour, each with a reset to its notation's, and *Reset all*; for a line, where its text sits along it — near its source, at its middle, near its target. The look belongs to that placement or line alone — another placement of the element keeps its own — is stored on its own core-vis style, and is undoable. A notation may set the same for a type — drawn where a placement sets nothing. The *Figure* tab, next to it, draws an element as its shape with its icon, as its icon with its name under it, or as its shape alone. The *Label* tab says what an element's label says, in place of its name alone: text with placeholders — `{name}` (its name for the presentation chosen), `{type}`, a property's values by its prefixed name (`{dcterms:creator}`, `{skos:prefLabel}` for its own name; a resource shown by its name), a path (`{am4:assignedTo/skos:prefLabel}`, `^` to follow one backwards) — each line of it a line of the label, a line whose placeholders all come to nothing left out. It is said for the presentation chosen in the toolbar's *Presentation* (a presentation context: an audience), or the same in every presentation — with none chosen, for every one; a notation may say it too, for a type, and a presentation context for everything shown in it. Renaming in place still renames the element; what cannot be read is said, and drawn as written. **Names by presentation**, in the property panel's information tab, gives an element or a relationship a name for each audience — "Card payments" for executives, `pgw-svc` for developers (a SKOS-XL `skosxl:altLabel`, its text also a `skos:altLabel`) — drawn in place of its own name, and shown by `{name}`, while that presentation is chosen; its own name stays its `skos:prefLabel`. The *Image* tab puts a picture in an element or a figure: type or paste its address in *Address* — an https URL or a `data:image/…` URI — or *Choose file…* to keep a picture file of up to 200 KB in the model itself (as a `data:` URI); then choose a *Position*: a corner, a side, the centre (at its own size, made smaller to fit) or *Fill*. For an element, *Draw it* … *as the figure, its name under it* puts the picture in place of the whole figure instead — its own icon, drawn as the Figure tab's *Icon* draws the glyph; a figure picked in the Figure tab puts the notation's glyph back. Under *Pictures in this model* the tab lists, as thumbnails, every picture any element or figure of the model already has (none yet, it says so); click one to give it to what is selected. *Remove image* takes it away. Inside the figure, the picture is drawn over its fill, under its text and glyph. A picture given by its address is linked, not copied into the model, and is fetched where the view is drawn; the desktop app draws https and `data:` pictures only. With a presentation chosen in the toolbar, the Appearance, Figure and Image tabs set the look for that presentation alone — of an element, a group, a note, a shape or a line, a scope bar over them saying which presentation, *The same in every presentation* to switch (shared by the three tabs) — and the format painter copies and gives the look for that presentation; the model tree shows an element's own picture for it as the row's icon. The Image tab, for instance, sets the picture for that presentation alone — "for *Executive / C-Level*", a style of the placement's for that presentation over its style for every one — or, *The same in every presentation*, for every one: a picture inside the box for developers, the picture as the whole figure for executives. **Pictures by presentation**, under Names by presentation, gives an element its own picture for every presentation and one for each (an address, or a file kept in the model); a placement drawn as its icon shows the element's picture for the presentation chosen — *Draw it as its own picture* in the Image tab — while box-with-badge keeps the type's glyph as its badge. Renamed in place, a name is typed in its own font, where it is drawn. The format painter (🖌 above the canvas) copies a look: click the brush, click what has the look, then each thing to give it to — each one undoable; Esc or the brush again puts it down. A model converted from Archi, or an Exchange file opened directly, keeps the colours and fonts its diagrams had; the *Notation only* switch above the canvas draws everything as its notation does instead (off by default, remembered in this browser; while it is on, the Appearance tab says so).
- **Relationship names** — the *Relationship names* switch above the canvas shows each named relationship's name at the middle of its line — or near its source or its target end, where the line's Appearance tab (or its notation) puts it; off by default, remembered in this browser. A relationship without a name shows nothing. Drag a name to move it elsewhere: the view keeps where it is (an `arch-vis:LabelNode`), and it follows its line as the line moves; right-click › *Move name back to its place* undoes that. All undoable.
- **About ‹type›** — under the model tree, what the loaded ontology and taxonomy say about the selected type (for a view, its viewpoint) or the type picked in the palette: definition, guidance, other names, classification and the other types in its group, superclasses, changes, the specification section. Folds to its header; resizes by its top edge.
- **Properties** — the selected concept in vertical tabs (information, properties, analysis, views); adding a property offers what applies to its type (by the vocabularies' `rdfs:domain` and SHACL shapes), what the model already uses and documentation properties — or any name, prefixed name or IRI. A property whose shape lists its values is a choice of them; a boolean is a checkbox.
- **Files** — Turtle, TriG (per-layer graphs), JSON-LD, N-Quads, N-Triples, RDF/XML; ArchiMate Exchange import (without the file's folders — convert it with `archimate2linkedarchi` to keep them); the open diagram exported as SVG or PNG from the File menu or the canvas's right-click menu, cropped to what is drawn, with its glyphs and pictures in the file — so an SVG shows them wherever it is opened — and a PNG at twice the drawn size. A picture linked from a site that does not let it be read from the app (no CORS header) cannot be put in the file: the SVG links to it, the PNG leaves it out, and a message names it.
- **Settings** — *File › Settings…*, a tab per part, kept on this machine and applied at once: which metamodels the Metamodels menu offers (also from the menu's *Choose which to show…*), which modules are on, and Git's defaults — repository, branch, folder for new files, the commit message (`{action} {model}`, with `{path}` and `{branch}`), the start of a new branch's name, whether *Remember* starts ticked — the tokens kept and the host kinds learned, to forget. What the deployment sets (below) is shown, not offered for change.
- **Git** — *File › Open from Git…* opens a model from a GitHub or GitLab repository (github.com, gitlab.com, GitHub Enterprise, self-managed GitLab) by its address: a link to a file opens it, a link to a repository, branch or folder lists its model files — or another branch's. *File › Save to Git…* commits the model as one file, to a branch or a new one, at a path whose extension picks the format. The model stays bound to its file — the next save asks only for the message — and a save never overwrites a change it has not seen: when the file moved on, *Merge with the newer version* (offered first) combines the two and commits the result to the same branch; or it goes to a new branch, overwrites, or the newer version is opened instead, as chosen. Changes made on both sides to the same thing — a name, a node's position, a route, a relationship's ends, a concept deleted on one side and changed on the other — are listed in a **Conflicts** tab, each with *Keep mine* and *Take theirs* (*Keep it* and *Delete it* for a deletion); until chosen, the model holds the version before either. An element placed on a diagram on both sides keeps both placements, listed with *Keep only mine* and *Keep only theirs*. *Update from main…* merges another branch into the bound one, so that its merge request merges cleanly: committed as a merge commit on GitHub, and to a new branch started from main on GitLab, whose API cannot record a merge. A save asks first when conflicts are not chosen, or when an imported model has blank nodes (which a merge cannot match). *Open merge request…* proposes the bound branch for merging into the default one — a pull request on GitHub, a merge request on GitLab — titled by the branch's last commit and described by its changes by element; it is offered too right after a save to a new branch, and an open one is named rather than opened again. A public repository opens without a token; otherwise the token is asked for, sent to its host only, and kept encrypted with the system keychain by the desktop app, for the session by the browser (or, if asked, in the browser). A module that can be switched off: *File › Settings…*, `?git=off`, or `LA_GRAM_GIT=off npm run build` to leave it out.
- **Collaboration** — real-time rooms (Yjs over Hocuspocus) that share the model's triples; presence and soft locks. When two people set a property that takes one value at the same moment — a node's position, a name in one language, or anything the loaded metamodels declare functional or limit to one value (`sh:maxCount 1`, `sh:uniqueLang`) — every client keeps the same one. The model's `dcterms:modified` keeps the later stamp.
- **Undo everywhere** — every canvas change, including placements and model-level deletes, and every property edit.
- **History** — the History tab saves *checkpoints* of the model, each with a message; lists them with what each changed, shows what a checkpoint changed — or how the model differs from it now — **by element** (each concept added, removed or changed: a name old → new, a relationship's ends, a view's shapes placed, moved, rerouted) or as triples added and removed, and restores one (undoably). Checkpoints are kept on this machine (IndexedDB), per model: they are not Git commits — *File › Save to Git…* makes those. For a model bound to a file in Git, the tab lists that file's commits beside the checkpoints, newest first — each with its author and a link to it on the host — read when the tab opens and on *Read again*; a commit's changes are shown the same way, against the commit before it or the model now, and *Open this version* makes the model the file at that commit (undoably), still bound to its branch. Bound to a branch other than the default, the first entry is the branch against the default: what merging it would bring.
- **See the RDF** — the "{ } RDF" toggle opens a panel on the right with the live model as Turtle (or any other format), written as it would be saved: the open view (its concepts and diagram), the selection, or the whole model — a large model's size rather than its text, with Copy and Download.
- **Layout** — the model tree on the left; the palette on the right, relationship types first and each section folding; under the canvas, tabs for **Properties**, **Validation** (with the violation count), **SPARQL Query**, **Graph** and **History**. The tree, the palette and the RDF panel hide from the toolbar ("☰ Model", "▦ Palette", "{ } RDF") and resize by their inner edge; the bottom panel resizes by its top edge, folds to its tabs (click the open tab) and maximizes over the workspace (⤢; Esc restores) — as does the RDF panel, from its own header. Sizes are remembered.
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

## la-gram-git — models in Git, on the command line and in CI

`la-gram-git` is built from la-gram's own engine, so it says of a model file what la-gram would. It is released as the npm package `@linked-archi/la-gram-git` (Node 20 or later) and as a container image, from la-gram's GitLab pipeline:

```sh
npx @linked-archi/la-gram-git check --base origin/main    # every model file parses, is as la-gram writes it,
                                                           # refers to nothing missing, adds no violation
npx @linked-archi/la-gram-git fix                          # rewrite model files as la-gram writes them
npx @linked-archi/la-gram-git diff origin/main --comment   # the change by element, on the pull or merge request
npx @linked-archi/la-gram-git init github                  # or gitlab: the CI file; or merge-driver
```

- [`packages/la-gram-git/README.md`](packages/la-gram-git/README.md) — the package: every command, what fails a check, exit codes, the image.
- [`ci/README.md`](ci/README.md) — the CI templates for GitHub Actions and GitLab CI, and how to set them up.
- [`packages/la-gram-git/docs/gitaly.md`](packages/la-gram-git/docs/gitaly.md) — the merge driver on a self-managed GitLab's Gitaly servers, for its administrators.

`npm run build:cli` builds the tool into `packages/la-gram-git/`; `node packages/la-gram-git/dist/la-gram-git.js --help` runs it from there.

### Releasing la-gram-git

`.gitlab-ci.yml` runs for merge requests and the default branch: la-gram's tests (the benchmarks left out), then la-gram-git's package — built, packed, installed from the packed file and run on `packages/la-gram-git/smoke/`. Nothing is published, and a newer push cancels what is still running. Other branches and other tags start nothing.

On a tag `la-gram-git-v<version>` it runs the same, then publishes from that one packed file: the npm package, and the image `$CI_REGISTRY_IMAGE/la-gram-git` for `linux/amd64` and `linux/arm64` — each built and tried on its own platform (the Arm64 one on gitlab.com's `saas-linux-small-arm64` runner, available on the Free tier), then combined under the version, its major version and `latest`. A pre-release version (`0.2.0-rc.1`) goes to npm under the dist-tag `next` and gets no `latest` or major image tag.

Once, before the first release:

1. Create the npm organisation `linked-archi` on npmjs.com.
2. In this project on GitLab: protect the tags `la-gram-git-v*` (*Settings › Repository › Protected tags*); let everyone pull the image (*Settings › General › Visibility*: the container registry for everyone with access).
3. Add `NPM_TOKEN` (*Settings › CI/CD › Variables*, protected and masked): an npm granular access token that can publish `@linked-archi` packages, with an expiry. Protected, it reaches only pipelines of protected tags.

After the first release, publish without a token: on npmjs.com, the package's *Settings › Trusted publishing*, GitLab CI/CD, with the namespace `linked-archi/linked-archi-tools/modellers`, the project `la-gram` and the file `.gitlab-ci.yml`. npm then takes the pipeline's OIDC token, and publishes provenance with the package. A new trusted publisher must be used within two days, so set it up just before the next release. Then delete `NPM_TOKEN` and revoke the token.

Each release:

1. Set the version in `packages/la-gram-git/package.json`, and commit.
2. Tag that commit `la-gram-git-v<the version>` and push the tag. The `package` job fails when the two differ.

## Test

```bash
npm run typecheck
npm test                    # unit + jsdom integration (Vitest)
npm run test:browser:build  # production build + Playwright suite (needs Chrome, or LA_GRAM_CHROME)
```

### Benchmark

How long a modeller waits on large models: the built web app opens each model
in Chrome, then its largest view, renames an element in it, and opens the model
again over itself; and the memory it holds is measured.

```bash
npm run build:web
npm run bench                                   # generated models of 10 000 to 500 000 triples
npm run bench -- --sizes 100000 --view-size 5000   # views of 5 000 nodes
npm run bench -- path/to/model.ttl              # models of your own
npm run bench:model -- --triples 250000 --out model.ttl   # a generated model, to open by hand
```

A generated model is the same each time for the same options: ArchiMate 4.0
elements of 30 types, two permitted relationships each, laid-out views — and a
few faults planted (an unnamed element in 997, an impermissible relationship in
503), so that validation always finds the same. Models and results (JSON) are
kept in `test-results/bench/`; a table is printed.

## Collaboration server

`server/collab-server.mjs` keeps each room in `data/rooms/<room>.nt` (one triple
per line, authoritative) and `<room>.ttl` (pretty Turtle), and serves the live
model over HTTP: `GET /rooms`, `GET /rooms/<room>.ttl`. Configure with `PORT`
and `DATA_DIR`.

## Documentation

- `.kiro/specs/la-gram/` — requirements, design, tasks (what is done, what is next, and a change log)
- `.kiro/steering/project-conventions.md` — principles and code conventions
- `docs/linked-archi-tool-spec.md` — the broader, implementation-independent tool specification; Appendix D says what la-gram implements of it

## Licence

la-gram is licensed under the [Apache License, Version 2.0](LICENSE).

The metamodel files it ships under `assets/` are copies of Linked.Archi's published definitions (`https://meta.linked.archi/`), each under the licence it states — Creative Commons Attribution 4.0 for most, Attribution-ShareAlike for a few (`core/core-vis-onto.ttl`; some entries of `catalog.ttl`, which describe other vocabularies).
