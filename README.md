# la-gram

A semantic modeller for enterprise and IT architecture, built on [Linked.Archi](https://meta.linked.archi/) metamodels.

The model lives in an RDF store; the diagram, the model tree, files and the
collaboration document are views of it. It works with any metamodel that
follows the Linked.Archi principles, loaded at runtime, so the palette, the
relationship rules, the notation and the validation all come from data: the
reference metamodels — ArchiMate 4.0 and 3.2, Basic and the Architecture Decisions and Architecture Processes extensions bundled (Basic is the
generic language, to add alongside another or use alone: its Connection relates
any two elements), and every other language, framework and extension published
on `meta.linked.archi` (the Metamodels menu lists its catalogue) — and your own,
from an address (*Metamodels › Load by IRI…*) or a file (*Metamodels › Upload
metamodel or asset file…*).

- **Model / views** — one model, any number of diagram, catalog and matrix views; an element is one resource wherever it appears. Delete from a view or from the model.
- **Model tree** — the whole model on the left in three groups, Views, Elements and Relationships: by type, or with the model's own folders in them, each kind in folders of its own. A model converted from Archi (or another tool that keeps folders) opens in its folders, each folded, subfolders then concepts by name, and what no folder holds by type after them; *Folders* | *Types* in the tree's header switches, remembered in this browser (on a model without folders, *Folders* is greyed out). Make folders from the right-click menu — *New folder…* on a group or in a folder, *Rename…*, *Delete folder* (what it holds is kept) — and file a view, element, relationship or folder with *Move to folder…*, which lists the group's folders with their paths, filters by any words you type and puts the ones you last used first, or by dragging rows onto a folder. Make views and elements where they belong, from the same menu: *New diagram view*, *New catalog view* and *New matrix view* on the Views group or a folder of views — named, a viewpoint chosen, filed there and opened — and *New element…* on the Elements group or a folder of elements — a type from the loaded metamodels', grouped as the palette groups them, then a name — filed there in one undoable step and placed in no view, selected in the tree to be dragged onto a diagram; an element type's row offers *New ‹type›…*. Ctrl/Cmd- or Shift-click selects several in the tree, and a selection on the canvas moves too (right-click one of them); all undoable, and saved with the model. To keep an Archi model's folders, export it from Archi with `--xmlexchange.exportFolders` before converting it — without that option Archi's Exchange file has none. Filter by name or type; the open view's concepts are marked.
- **Relationships the metamodel permits** — a blue preview line follows the pointer while connecting, across empty canvas and onto a target; connect, change type and the "+" menu offer only what the metamodel's relationship shapes allow (ArchiMate's relationship matrix), in the metamodel's order of proposal — what may be drawn directly before what only a derivation gives, Association last; between two processes Triggering and Flow first, from a process to a service Realization, elsewhere the strongest first; a line drawn with no type chosen opens the relationship types on it when several fit, the line and the type picked one step to undo; "+" appends a new element — asking which relationship when several fit — or brings in what the element is already related to in the model. A line drawn for a relationship the model already has between the two, but this view does not show, asks whether to use that one or make another.
- **Links written as triples open as relationships** — a file that states a link only as a triple (`am4:serves`, `ad:modifiesConcept`, or `ap:taskOfActivity`, the other way round from the drawn `ap:hasTask`) opens with each link a relationship, listed and drawn, named as the Linked.Archi rules name it.
- **An icon for every type** — each palette entry shows the icon its notation publishes; a type with none, or one whose icon does not load, shows its figure as the canvas draws it (an element) or its line and ends (a relationship), in the palette and the menus.
- **Every type offered, an incomplete metamodel said** — an element type no classification names is listed under *Other*; the palette says of each loaded metamodel what it leaves out — nothing to draw, no classification named, so many types left out of it — and *Show loaded assets…* lists the types.
- **Across metamodels** — two elements no loaded metamodel relates (an ArchiMate component and an ATAM risk) are connected by the core's own relationship types: Association, Has Part, Refines. A relationship type with no notation is drawn with an arrowhead at its target.
- **Published vocabulary** — `arch:inModel`, `arch:inView`, qualified relationships plus their unqualified triples, which they `rdf:reifies` (RDF 1.2), `arch-vis:ArchNode`/`Link` geometry; older models are migrated on open.
- **Graph** — the Graph tab draws what the selected element is related to, 1–5 hops out, filterable by element and relationship type, drawn live with forces (d3-force) — or in rings or as a tree: the graph moves into place and comes to rest; drag an element and the elements linked to it follow, let go and it settles back among them. Its link distance, charge strength and collision radius are set by sliders, followed live and remembered. The query behind it — as a SELECT (a table) or a CONSTRUCT (the triples) — runs in the SPARQL tab or downloads as `.rq`; the graph becomes a new view, laid out as drawn, or a Turtle file.
- **SPARQL** — the SPARQL Query tab shows results as tables with prefixed names that select the concept; *Render as new view* makes a diagram of the elements and relationships a result mentions, laid out as *Arrange view* lays one out.
- **Model questions** — the questions the core and the model's language publish (ArchiMate 4.0 and 3.2 so far: "Which services does nothing realise?", "What is affected if this element changes?"): the SPARQL tab's *Questions* menu lists them by stage, those fitting the open view's viewpoint first, filterable by concern; picking one runs its query, bound to the open model, view and viewpoint and the selected element, and says what a row means and what it does not prove. Right-click an element › *Ask about this element…* for the questions about it. A view of the answer follows the question's viewpoint.
- **Notation as published** — elements are drawn from the notation data in the shapes the published pictures show (EDGY's arrows and tag pills, C4's person…) — a notation declares its own shapes, with their geometry, in its own files — with their badges and label colours, and relationship ends from the published marker symbols. A kind of element with a look of its own is a class of its own (C4's Database, drawn as a cylinder); another audience's look is another notation set.
- **Validation** — live SHACL against the loaded metamodels' shapes and the core shapes, relationships checked against the relationship tables, the shapes' SPARQL-based rules (ArchiMate's self-loops and principles, core's viewpoint rules) run with Oxigraph, and references to anything the model does not have; it runs in a background worker, so editing never waits for it. The Validation tab shows the open view's findings or the whole model's, and counts the violations; each finding links to the shape it comes from, on the metamodel's documentation. *Model checks* adds, on request, the findings the loaded languages' questions state — orphans, unrealised services, unrealised requirements…
- **Change an element's type** — in the property panel, the *Type* field searches every element type of the loaded metamodels by name (or right-click › Change type…), their IRIs a switch away — types that share a name show theirs; the element keeps its identity, name, properties and placements, and relationships the new type does not permit are named before and kept after (validation flags them).
- **Back and forward between views** — ← and → in the toolbar, or Alt+← / Alt+→, go back to the views you came from (the model tree, *Appears in views*, a revealed concept — any way you got there), each as you left it: zoom, scroll and selection.
- **Right-click menu** — on an element or a relationship: rename, change type, move to a folder (when the model has folders), append; show its properties, its place in the model tree, its relationship graph, the questions about it, or a relationship's ends; copy its IRI; delete it from the view or the model. On one of several selected: move them all to a folder. On the empty canvas, the open view's: rename it, set its viewpoint, duplicate it, select all, zoom to fit, its properties, its place in the tree, its IRI, export it as SVG or PNG, delete it.
- **Nesting** — drop or move an element onto another to draw it inside: it moves with its container, which grows to hold it and keeps its name at the top, above what is inside; the drop asks which relationship the nesting stands for (composition, assignment, … — what the notation says nesting may draw and the metamodel permits), or none. While nested, no line runs between the element and its container — the nesting shows them; moved out, the relationships the view showed are drawn as lines again. Nested ArchiMate Exchange diagrams import nested. Relationships' lines, and their names, are drawn above every element, nested ones included, as ArchiMate tools draw them.
- **Arrange view** — *Arrange view…*, on the canvas toolbar or the empty canvas's right-click menu, lays the diagram out — or what is selected, with what is nested in it — with ELK's layered layout, in a worker: in rows the way the relationships lead (*Direction* **Down**, Right, Up, Left), each element at its size and inside its parent, routes at right angles — from the middle of a side, bending clear of the elements, as *Arrange relationships* draws them, up to 500 elements — and with *Group by band* in the bands the metamodel orders (ArchiMate: Motivation and Strategy above Business, Application, Technology); the same diagram is always placed the same. One step to undo, one change for collaborators. A model opened with no geometry, and *Render as new view*, are laid out the same way. Above 2 000 elements, or after 10 s, the elements go in a grid, and la-gram says why.
- **Tidy without laying out again** — the menu beside *Arrange view* (and the empty canvas's right-click menu) opens *Arrange relationships…* — the lines routed again at right angles around the elements, which stay —, *Align to grid…* (10, **20**, 40 px; across, down or both) and *Sizes…* (match to the **largest**, smallest or median; or each its default size). Quick actions in the toolbar act at once on the selection with the dialogs' last choices: align left, centre, right, top, middle, bottom; distribute; match width, height, size; default size; align to grid; arrange relationships. Each is one step to undo.
- **Rename in place** — double-click an element's box (or select it and press F2) and type its name; Enter keeps it, Esc drops it, undo brings the old one back. A relationship is named the same way, on its line: double-click the line (or its name), or select it and press F2; emptied, its name is removed.
- **An element placed twice** — drag an element from the model tree onto a view that already shows it to place it again, as ArchiMate allows: each placement moves, nests and is deleted on its own, lines join the placements they were drawn between — a relationship can be drawn again from another placement — and selecting the element selects every placement.
- **Copy and paste** — Ctrl/⌘+C, X and V on a diagram copy the selection — with what is nested in it and the lines between its elements — as RDF. Pasted into another view of the same model, it is the same elements and relationships placed again; into the same view or another model, new copies, with their names and definitions only, filed in the original's folder (*Paste as copies* and *Paste as references*, Ctrl/⌘+Shift+V and Ctrl/⌘+Alt+V, force either). Ctrl/⌘+D duplicates. It goes at the pointer, is selected, and is one step to undo; another la-gram window pastes it, and a text editor gets Turtle. *Copy* in the model tree copies elements and relationships to place them in a diagram.
- **Groups, notes and shapes** — the *Shapes* switch above the canvas opens a row of figures drawn with no model element behind them: a group (its name in a tab, holding elements), a sticky note, and rectangles, ellipses, circles, diamonds, hexagons, octagons and parallelograms — dragged onto the diagram, or clicked and placed; renamed, moved, resized and deleted as elements are; selected, the panel gives their text, and their look in the *Appearance* tab. Connect from a note (or a group or a shape) draws a dashed line to what it is about — drawing only, no relationship in the model; its Appearance tab makes it solid or dotted, puts an arrowhead, a diamond or a dot at either end and sets its text's font. Double-click the line (or select it and press F2) to write on it: the text is drawn at its middle — drag it elsewhere, as a relationship's name — and is the line's *Text* in the panel. An ArchiMate Exchange file's groups, notes and the lines from them import as these.
- **Appearance** — select an element, a relationship's line, a figure or a line from a note on the canvas (one or several) and the property panel's *Appearance* tab sets how it looks in this view: fill colour, gradient and opacity, line colour, width, opacity and style, icon colour, text alignment and position, font (name, size, bold, italic, underline) and font colour, each with a reset to its notation's, and *Reset all*; for a line, where its text sits along it — near its source, at its middle, near its target. The look belongs to that placement or line alone — another placement of the element keeps its own — is stored on its own core-vis style, and is undoable. A notation may set the same for a type — drawn where a placement sets nothing. The *Figure* tab, next to it, draws an element as its shape with its icon, as its icon with its name under it, or as its shape alone. The *Label* tab says what an element's label says, in place of its name alone: text with placeholders — `{name}` (its name for the presentation chosen), `{type}`, a property's values by its prefixed name (`{dcterms:creator}`, `{skos:prefLabel}` for its own name; a resource shown by its name), a path (`{am4:assignedTo/skos:prefLabel}`, `^` to follow one backwards) — each line of it a line of the label, a line whose placeholders all come to nothing left out. It is said for the presentation chosen in the toolbar's *Presentation* (a presentation context: an audience), or the same in every presentation — with none chosen, for every one; a notation may say it too, for a type, and a presentation context for everything shown in it. Renaming in place still renames the element; what cannot be read is said, and drawn as written. **Names by presentation**, in the property panel's information tab, gives an element or a relationship a name for each audience — "Card payments" for executives, `pgw-svc` for developers (a SKOS-XL `skosxl:altLabel`, its text also a `skos:altLabel`) — drawn in place of its own name, and shown by `{name}`, while that presentation is chosen; its own name stays its `skos:prefLabel`. The *Image* tab puts a picture in an element or a figure: type or paste its address in *Address* — an https URL or a `data:image/…` URI — or *Choose file…* to keep a picture file of up to 200 KB in the model itself (as a `data:` URI); then choose a *Position*: a corner, a side, the centre (at its own size, made smaller to fit) or *Fill*. For an element, *Draw it* … *as the figure, its name under it* puts the picture in place of the whole figure instead — its own icon, drawn as the Figure tab's *Icon* draws the glyph; a figure picked in the Figure tab puts the notation's glyph back — and *in the badge* puts it in place of the type's glyph in the corner, the figure kept. With no picture of its own, *Draw it* is about the element's own picture (Pictures by presentation): inside the box (where it is drawn by default), as the figure, or in the badge — followed as the element's picture changes; *Use its element's own picture* gives up a picture of the placement's own for it. Under *Pictures in this model* the tab lists, as thumbnails, every picture any element or figure of the model already has (none yet, it says so); click one to give it to what is selected. *Remove image* takes it away. Inside the figure, the picture is drawn over its fill, under its text and glyph. A picture given by its address is linked, not copied into the model, and is fetched where the view is drawn; the desktop app draws https and `data:` pictures only. With a presentation chosen in the toolbar, the Appearance, Figure and Image tabs set the look for that presentation alone — of an element, a group, a note, a shape or a line, a scope bar over them saying which presentation, *The same in every presentation* to switch (shared by the three tabs) — and the format painter copies and gives the look for that presentation; the model tree shows an element's own picture for it as the row's icon. The Image tab, for instance, sets the picture for that presentation alone — "for *Executive / C-Level*", a style of the placement's for that presentation over its style for every one — or, *The same in every presentation*, for every one: a picture inside the box for developers, the picture as the whole figure for executives. **Pictures by presentation**, under Names by presentation, gives an element its own picture for every presentation and one for each (an address, or a file kept in the model); a placement drawn as a box shows the element's picture for the presentation chosen inside the box (where the Image tab gives it no picture of its own), the badge still the type's glyph; the Image tab's *Draw it* draws it as the figure instead, or in the badge. Renamed in place, a name is typed in its own font, where it is drawn. The format painter (🖌 above the canvas) copies a look: click the brush, click what has the look, then each thing to give it to — each one undoable; Esc or the brush again puts it down. A model converted from Archi, or an Exchange file opened directly, keeps the colours and fonts its diagrams had; the *Notation only* switch above the canvas draws everything as its notation does instead (off by default, remembered in this browser; while it is on, the Appearance tab says so).
- **Relationship names** — the *Relationship names* switch above the canvas shows each named relationship's name at the middle of its line — or near its source or its target end, where the line's Appearance tab (or its notation) puts it; off by default, remembered in this browser. A relationship without a name shows nothing. Drag a name to move it elsewhere: the view keeps where it is (an `arch-vis:LabelNode`), and it follows its line as the line moves; right-click › *Move name back to its place* undoes that. All undoable.
- **About ‹type›** — under the model tree, what the loaded ontology and taxonomy say about the selected type (for a view, its viewpoint) or the type picked in the palette: definition, guidance, other names, classification and the other types in its group, superclasses, changes, the specification section. Folds to its header; resizes by its top edge.
- **Properties** — the *IRI* button beside an element's editable *Type* reveals its full IRI without opening the chooser. The selected concept in vertical tabs (information, properties, analysis, views): the analysis tab its relationships, the properties tab every other property; adding a property offers what applies to its type (by the vocabularies' `rdfs:domain` and SHACL shapes), what the model already uses and documentation properties — or any name, prefixed name or IRI. A property whose shape lists its values is a choice of them; a boolean is a checkbox.
- **Files** — Turtle, TriG (per-layer graphs), JSON-LD, N-Quads, N-Triples, RDF/XML; ArchiMate Exchange import (without the file's folders — convert it with `archimate2linkedarchi` to keep them); the open diagram exported as SVG or PNG from the File menu or the canvas's right-click menu, cropped to what is drawn, with its glyphs and pictures in the file — so an SVG shows them wherever it is opened — and a PNG at twice the drawn size. A picture linked from a site that does not let it be read from the app (no CORS header) cannot be put in the file: the SVG links to it, the PNG leaves it out, and a message names it.
- **Settings** — *File › Settings…*, a tab per part, kept on this machine and applied at once: which metamodels the Metamodels menu offers (also from the menu's *Choose which to show…*), which modules are on, and Git's defaults — repository, branch, folder for new files, the commit message (`{action} {model}`, with `{path}` and `{branch}`), the start of a new branch's name, whether *Remember* starts ticked — the tokens kept and the host kinds learned, to forget. What the deployment sets (below) is shown, not offered for change.
- **Git** — *File › Open from Git…* opens a model from a GitHub or GitLab repository (github.com, gitlab.com, GitHub Enterprise, self-managed GitLab) by its address: a link to a file opens it, a link to a repository, branch or folder lists its model files — or another branch's. *File › Save to Git…* commits the model as one file, to a branch or a new one, at a path whose extension picks the format. The model stays bound to its file — the next save asks only for the message — and a save never overwrites a change it has not seen: when the file moved on, *Merge with the newer version* (offered first) combines the two and commits the result to the same branch; or it goes to a new branch, overwrites, or the newer version is opened instead, as chosen. Changes made on both sides to the same thing — a name, a node's position, a route, a relationship's ends, a concept deleted on one side and changed on the other — are listed in a **Conflicts** tab, each with *Keep mine* and *Take theirs* (*Keep it* and *Delete it* for a deletion); until chosen, the model holds the version before either. An element placed on a diagram on both sides keeps both placements, listed with *Keep only mine* and *Keep only theirs*. *Update from main…* merges another branch into the bound one, so that its merge request merges cleanly: committed as a merge commit on GitHub, and to a new branch started from main on GitLab, whose API cannot record a merge. A save asks first when conflicts are not chosen, or when an imported model has blank nodes (which a merge cannot match). Moving a model saved to Git to another namespace asks first, and the model stays bound to its file; a merge into the moved model moves the other version after it (DD-41), and a merge someone asks for — *Pull from Git*, *Merge with the newer version*, *Update from main…* — of a version that has the model moved to another namespace moves the open model there, still bound to its file; automatic checks and auto-commit stop instead, saying that *Pull from Git* follows it. *Open merge request…* proposes the bound branch for merging into the default one — a pull request on GitHub, a merge request on GitLab — titled by the branch's last commit and described by its changes by element; it is offered too right after a save to a new branch, and an open one is named rather than opened again. A public repository opens without a token; otherwise the token is asked for, sent to its host only, and kept encrypted with the system keychain by the desktop app, for the session by the browser (or, if asked, in the browser). A module that can be switched off: *File › Settings…*, `?git=off`, or `LA_GRAM_GIT=off npm run build` to leave it out.
- **Pull from Git** — *File › Pull from Git* brings the bound file’s current branch into the model without committing. Local edits survive through the existing three-way merge; conflicts go to the Conflicts tab, and *Save to Git* commits when you choose. A changed pull is undoable; a no-op adds no undo step. Available outside shared rooms.
- **Optional auto-commit** — Off by default for each model and Git destination; save after 1/2/5/10 minutes idle or at a 5/10/15/30-minute interval. Reconciles before writing, skips unchanged content, preserves edits during saves, and stays paused after conflicts until manual Save or Resume. Pending-write fingerprints prevent blind retries after lost responses. [Guide](docs-site/guide/git.md#auto-commit).
- **Git remote checks** — *File › Check for remote changes* observes the bound file without changing the model; the **Git** tab shows local/incoming changes, last and next check times, and pause reasons. Settings offer checks every 1, 2, 5 or 10 minutes and optional automatic pull only when unchanged locally; both are off by default. One visible, online tab checks each destination, with backoff on network/rate-limit failures and no background credential prompts. *Save to Git* remains the action that commits.
- **Collaboration** — real-time rooms (Yjs over Hocuspocus) that share the model's triples; presence and soft locks. When two people set a property that takes one value at the same moment — a node's position, a name in one language, or anything the loaded metamodels declare functional or limit to one value (`sh:maxCount 1`, `sh:uniqueLang`) — every client keeps the same one. The model's `dcterms:modified` keeps the later stamp.
- **Undo everywhere** — every canvas change, including placements and model-level deletes, and every property edit.
- **History** — the History tab saves *checkpoints* of the model, each with a message; lists them with what each changed, shows what a checkpoint changed — or how the model differs from it now — **by element** (each concept added, removed or changed: a name old → new, a relationship's ends, a view's shapes placed, moved, rerouted) or as triples added and removed, and restores one (undoably). Checkpoints are kept on this machine (IndexedDB), per model: they are not Git commits — *File › Save to Git…* makes those. For a model bound to a file in Git, the tab lists that file's commits beside the checkpoints, newest first — each with its author and a link to it on the host — read when the tab opens and on *Read again*; a commit's changes are shown the same way, against the commit before it or the model now, and *Open this version* makes the model the file at that commit (undoably), still bound to its branch — a commit that has the model in another namespace after a second question, *Open and move*. Bound to a branch other than the default, the first entry is the branch against the default: what merging it would bring.
- **See the RDF** — the "{ } RDF" toggle opens a panel on the right with the live model as Turtle (or any other format), written as it would be saved: the open view (its concepts and diagram), the selection, or the whole model — a large model's size rather than its text, with Copy and Download.
- **Layout** — the model tree on the left; the palette on the right, relationship types first and each section folding, the sections in the order the metamodel gives (ArchiMate 4.0: Business, Application, Technology, Common, Strategy, Motivation, Implementation and Migration), each in the order of the aspects; under the canvas, tabs for **Properties**, **Validation** (with the violation count), **SPARQL Query**, **Graph** and **History**. The tree, the palette and the RDF panel hide from the toolbar ("☰ Model", "▦ Palette", "{ } RDF") and resize by their inner edge; the bottom panel resizes by its top edge, folds to its tabs (click the open tab) and maximizes over the workspace (⤢; Esc restores) — as does the RDF panel, from its own header. Sizes are remembered.
- **Help and About** — the icon and name at the top left open la-gram's menu: *About la-gram*, the keyboard shortcuts (⌘ and ⌥ on a Mac, with a link to their page in the documentation), *la-gram documentation* — the guide built from `docs-site/`, which the web app serves beside it in `docs/`, of its own version (https://app.linked.archi/la-gram/docs/, which the desktop app opens) — the Linked.Archi guides (the documentation, the quick start, the modelling guide, the ArchiMate 4.0 primer, names, labels and pictures per audience, the metamodel catalogue), *Download the desktop app…* (a link to each platform's app of the latest release, this computer's first, with how to open it, the checksums and every release), and la-gram's README, source and issue tracker, each opened in another tab. *About la-gram* shows the version, where it runs (the browser, or the desktop app's Electron), the metamodels loaded and the bundled snapshot, the licence and the open-source components it is built with — with *Third-party licences*, the licences of every package bundled — and copies that line for a report. The tab and the window are titled by the open model ("• Payments platform — la-gram" while it has unsaved changes). In the desktop app, the menu bar's Help lists the same pages and *About la-gram* opens the system's About panel. The toolbar fits from 1100 px wide: on a narrower window its selectors and panel toggles drop their words (each says it on hover).
- **Your namespace** — every IRI is an HTTP URI in the model's namespace, in the layout every Linked.Archi tool shares: `element/…`, `view/…`, a diagram's nodes and lines in their view (`view/…#node/…`), their styles and routes under them. Turtle writes them with a prefix per kind (`me:…`, `mg:views`) and per view (`mve7282c35:node\/5`), and what no prefix fits relative to the namespace (`@base`). A model saved before keeps its names (`m:element-…`) and is edited in place. New models start under the placeholder `https://example.org/`; **Model settings** (click the model name) sets your own namespace and prefix and moves the model into it, asking first in a collaboration room and for a model saved to Git.

## Run

You need [Node.js](https://nodejs.org/) 22 or later, which comes with npm. `npm ci` installs everything
else, the desktop app's Electron included (a download of about 100 MB, once). Google Chrome is needed
only for the browser tests and `npm run icons`.

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

### Desktop app

The same app as a desktop application (Electron 44), reading and writing files through the system's
dialogs. The latest release's apps are at app.linked.archi — [macOS (Apple silicon)](https://app.linked.archi/la-gram/downloads/la-gram-darwin-arm64.zip),
[macOS (Intel)](https://app.linked.archi/la-gram/downloads/la-gram-darwin-x64.zip),
[Windows](https://app.linked.archi/la-gram/downloads/la-gram-win32-x64.zip),
[Linux x64](https://app.linked.archi/la-gram/downloads/la-gram-linux-x64.tar.gz),
[Linux arm64](https://app.linked.archi/la-gram/downloads/la-gram-linux-arm64.tar.gz), their
[SHA-256 sums](https://app.linked.archi/la-gram/downloads/SHA256SUMS.txt) — and la-gram's menu links them
(*Download the desktop app…*); every release's are on the project's
[Releases page](https://gitlab.com/linked-archi/linked-archi-tools/modellers/la-gram/-/releases).
Unzip and open; nothing else to install. To build one yourself, from a checkout, after `npm ci`:

```bash
npm run build:electron && npm run electron   # build and run it
npm run package                              # the app for this machine, in dist/packages/
npm run package -- --platform win32 --arch x64   # or for another: darwin, win32, linux; x64, arm64
```

`npm run package` writes `dist/packages/la-gram-<platform>-<arch>/` — on macOS `la-gram.app`, which can
be moved to Applications. The app carries everything it needs, the bundled metamodels included, so it
works offline and needs nothing installed — no Node. It is not signed. An app you package yourself
opens as it is; one downloaded from elsewhere is stopped the first time — on macOS, open it from
*System Settings › Privacy & Security › Open Anyway*; on Windows, *More info › Run anyway*.

- In a terminal inside VS Code, run it with `ELECTRON_RUN_AS_NODE` unset
  (`env -u ELECTRON_RUN_AS_NODE npm run electron`): VS Code sets it, and Electron then starts as plain
  Node.
- If Electron was not downloaded (an install with `--ignore-scripts`), `node node_modules/electron/install.js`
  fetches it.
- The renderer is sandboxed and without Node, and reaches files only through the native dialogs.

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


### Bundled metamodels, and refreshing them

ArchiMate 4.0 and 3.2, Basic, the core vocabularies and their icons and markers ship in `assets/`, a
snapshot of what meta.linked.archi serves, used first (`?assets=bundled-first`), with
meta.linked.archi's catalogue (`assets/catalog.ttl`) — the metamodels the Metamodels menu offers,
complete offline; unless offline, the published catalogue replaces it when it arrives.
`sync-assets` refreshes this snapshot from **https://meta.linked.archi/ by default**:

```bash
npm run sync-assets -- --check   # compare with the published site; exit 1 if anything differs
npm run sync-assets              # update assets/ from the published site
npm run build                    # build from that snapshot
npm run sync-assets -- --meta ../../../linked-archi-meta  # use a local checkout explicitly
```

`LINKED_ARCHI_META=<path>` also selects a local checkout; `--meta` takes precedence over it.
`--online` selects the published site even when that environment variable is set. The online sync
fetches the catalogue, bundled Turtle documents and icons, and stages the downloads before writing:
a failed request fails the sync and keeps the existing snapshot. It does not fall back to a local
checkout. Local mode runs that checkout's publishing scripts and takes its last generated catalogue
from `.onto-docs/catalog.ttl`; generate that catalogue from the same revision before a local sync.

The sync refreshes the languages already bundled. Other catalogue entries, including LeanIX, load
from meta.linked.archi when selected. Reopen la-gram after a publication to refresh documents already
loaded in the session. Builds copy `assets/` as it stands and do not sync automatically. Each build
replaces its generated asset copy, including the CLI package's, so removed semantic files disappear
from the output too.

### Icons

The favicon is `src/icons/favicon.svg`: the Linked.Archi mark, simplified to stay legible at 16 px.
The desktop app's icon is `src/icons/app-icon.svg`, the same mark on a tile (the bare mark at 32 px
and less). Their renderings are kept beside them — `favicon.ico` for browsers that take no SVG
favicon, `app-icon.icns` and `app-icon.ico` for `npm run package`, `app-icon.png` for the window
and, unpackaged on macOS, the Dock. Run `npm run icons` after changing an SVG (it draws with the
system Chrome, or `LA_GRAM_CHROME`).

## la-gram-git — models in Git, on the command line and in CI

`la-gram-git` is built from la-gram's own engine, so it says of a model file what la-gram would. It is released as the npm package `@linked-archi/la-gram-git` (Node 20 or later) and as a container image, from la-gram's GitLab pipeline:

```sh
npx @linked-archi/la-gram-git check --base origin/main    # every model file parses, is as la-gram writes it,
                                                           # refers to nothing missing, adds no violation
npx @linked-archi/la-gram-git fix                          # rewrite model files as la-gram writes them
npx @linked-archi/la-gram-git diff origin/main --comment   # the change by element, on the pull or merge request
npx @linked-archi/la-gram-git init github                  # or gitlab: the CI file; or merge-driver
```

`check` also lists, never failing, the IRIs outside the layout every Linked.Archi tool mints (DD-41), names given before it counted as legacy. The merge driver carries a move of the model to another namespace on one side over to the other before it merges.

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

In short — la-gram-git 0.2.0, whose version is its own, in `packages/la-gram-git/package.json`:

```bash
git switch main && git pull && git switch -c release-la-gram-git-0.2.0
(cd packages/la-gram-git && npm version 0.2.0 --no-git-tag-version)
npm run typecheck && npm test
git commit -am "la-gram-git 0.2.0"
git push -u origin release-la-gram-git-0.2.0

# Merge the merge request when its pipeline passes, then:
git switch main && git pull
git tag -a la-gram-git-v0.2.0 -m "la-gram-git 0.2.0"
git push origin la-gram-git-v0.2.0
```

### Releasing la-gram

On a merge request and the default branch, the pipeline also builds the web app (the `web` job), and
offers the desktop apps as manual jobs (`desktop`, one per platform): run one to try a build — it
is kept for three days as the job's artifact.

On a tag `la-gram-v<version>` — the version in `package.json` — after the tests it publishes la-gram:

- **the desktop apps**, packaged on GitLab's Linux runners for macOS (Apple silicon and Intel),
  Windows x64 and Linux x64 and arm64; zipped (Linux as `.tar.gz`), uploaded to the project's package
  registry (`la-gram/<version>/la-gram-<version>-<platform>-<arch>.zip`) and listed on the project's
  *Releases* page;
- **the web app** at https://app.linked.archi/la-gram/: the build copied over SSH onto the server that
  serves app.linked.archi (the host of meta.linked.archi), where nginx serves it under `/la-gram/` —
  with this documentation in its `docs/`, and the desktop apps in its `downloads/`, fetched from the
  package registry and named without the version (`la-gram-darwin-arm64.zip`…), each replacing the last
  release's, with `SHA256SUMS.txt`: the links in la-gram's menu and its documentation stay.

A pre-release — `la-gram-v0.3.0-rc.1` — gets its desktop apps and its Release, for trying; the web app
and the downloads on app.linked.archi stay as the last release left them.

The apps are not signed by a developer (see *Desktop app*). Each release adds about 0.7 GB to the
project's package registry: delete old versions' packages there (*Deploy › Package registry*) when they
are no longer wanted.

#### Once, before the first release

1. **Protect the release tags.** In this project on GitLab: *Settings › Repository › Protected tags ›
   Add new*; in *Tag*, type `la-gram-v*` and choose *Create wildcard*; *Allowed to create*:
   Maintainers; *Protect*. Only maintainers can then make (or delete) a release tag, and the protected
   variables below reach its pipeline: GitLab gives a protected variable only to pipelines of
   protected branches and tags.
2. **Let anyone download the apps:** *Settings › General › Visibility, project features, permissions*:
   the package registry for everyone with access.
3. **Create the environment `production`,** so the variable form can offer it: *Operate ›
   Environments › Create an environment*, the name `production` (its URL
   `https://app.linked.archi/la-gram/`), *Save*. (The first deploy would create it too, but the
   variables come first.)
4. **Add the deploy variables:** *Settings › CI/CD › Variables › Add variable*, each with *Protect
   variable* ticked, *Expand variable reference* cleared, and the environment scope `production` — only
   the job that deploys the web app (`web-deploy`, environment `production`) then gets them:

   | Key | Type | Visibility | Value |
   |---|---|---|---|
   | `DEPLOY_SSH_KEY` | File | Visible | the deploy user's private SSH key — all of it, its `BEGIN` and `END` lines included, ending with a new line |
   | `DEPLOY_HOST` | Variable | Visible | `app.linked.archi` |
   | `DEPLOY_USER` | Variable | Visible | `deploy` |
   | `LA_GRAM_DEPLOY_PATH` | Variable | Visible | `/var/www/linked-archi-app/la-gram` |

   *Visible* for the key too: GitLab masks only a value of one line with no spaces, and a key has
   several — the form, which offers *Masked* first, refuses it. Nothing prints it: a *File* variable
   gives the job the path of a file holding the value, which the job copies into place. The other
   three are no secrets. The key and the user are the ones meta.linked.archi's deploy uses (its
   project's *Settings › CI/CD › Variables*); a key of la-gram's own, added to the deploy user's
   `~/.ssh/authorized_keys`, works as well.
5. **On the server:** the folder, for the deploy user —

   ```bash
   sudo mkdir -p /var/www/linked-archi-app/la-gram
   sudo chown -R deploy:www-data /var/www/linked-archi-app
   ```

   — and the web server's site for app.linked.archi, which is kept with the host's own configuration.
   What la-gram needs of it: the folder served at `/la-gram/` (`/la-gram` sent there); `.wasm` as
   `application/wasm` and `.ttl` as `text/turtle`; `index.html` and the bundled metamodels revalidated
   on every load (they change with a release under the same names — the metamodels carry `?v=`), the
   scripts and the WebAssembly, named by their content, cacheable for good. A Content-Security-Policy,
   if the site sends one, must allow scripts from the site with `'wasm-unsafe-eval'` (no
   `'unsafe-eval'` is needed: a production build has no `eval`), workers from `blob:`, images from
   `data:`, `blob:` and `https:`, inline styles, and connections to `https:` and `wss:`. After that,
   retry the release's `web-deploy` job (or run the next release).

#### Each release

In short — la-gram 0.2.0:

```bash
git switch main && git pull && git switch -c release-0.2.0
npm version 0.2.0 --no-git-tag-version
npm run typecheck && npm test
git commit -am "la-gram 0.2.0"
git push -u origin release-0.2.0

# Merge the merge request when its pipeline passes, then:
git switch main && git pull
git tag -a la-gram-v0.2.0 -m "la-gram 0.2.0"
git push origin la-gram-v0.2.0
```

Step by step, from the default branch, after a merge request:

1. **The version, by a merge request.** On a branch from an up-to-date `main`, set it — `npm version`
   writes `package.json` and `package-lock.json` (without `--no-git-tag-version` it would also commit
   and tag, with its own tag name) — and push:

   ```bash
   git switch main
   git pull
   git switch -c release-0.2.0
   npm version 0.2.0 --no-git-tag-version
   git commit -am "la-gram 0.2.0"
   git push -u origin release-0.2.0
   ```

   Open the merge request. Its pipeline runs the tests and builds the web app; to try a desktop app
   first, run its manual `desktop` job there and download the job's artifact. Merge.

2. **The tag, on the merged commit,** annotated, and pushed — pushing the tag starts the release:

   ```bash
   git switch main
   git pull
   node -p 'require("./package.json").version'   # 0.2.0
   git tag -a la-gram-v0.2.0 -m "la-gram 0.2.0"
   git push origin la-gram-v0.2.0
   ```

   Or in GitLab: *Code › Tags › New tag*, the name `la-gram-v0.2.0`, *Create from* `main`, a message,
   *Create tag*.

3. **Follow it** in *Build › Pipelines*: the tests; then `web`, `docs` and the five `desktop` jobs; then
   `web-deploy` and `la-gram-release`. When it is done, *Deploy › Releases* lists *la-gram 0.2.0* with
   the five downloads, and https://app.linked.archi/la-gram/, reloaded, says *Version 0.2.0* in
   *About la-gram* (the menu under the name at the top left); *Download the desktop app…*, in the same
   menu, downloads 0.2.0's apps.

The first release is `la-gram-v0.1.0`: `package.json` says 0.1.0 already, so step 1 needs no
`npm version` (it refuses to set the version it has) — only `main` with everything in it.

When something goes wrong:

- **A job fails on something passing** — a download from GitHub, the network: *Retry* the job in the
  pipeline. Do not tag again.
- **The tag's version is not `package.json`'s:** the `web` job stops the pipeline before anything is
  published. Delete the tag in *Code › Tags* (a protected tag cannot be deleted with Git), and with
  `git tag -d la-gram-v0.2.0` on your machine; set the version, merge, tag again.
- **Something is wrong in what was released:** do not move the tag. Fix it by a merge request and
  release the next version (`0.2.1`).

## Test

```bash
npm run typecheck
npm test                    # unit + jsdom integration (Vitest)
npm run test:browser:build  # production build + Playwright suite (needs Chrome, or LA_GRAM_CHROME)
```

### Benchmark

How long a modeller waits on large models: the built web app opens each model
in Chrome, then its largest view, renames an element in it, and opens the model
again over itself; and the memory it holds is measured. Each run also measures
the Graph tab at depths 1–5 on every model, and runs the graph model's sweep —
trees of 100 to 3 000 elements, animated and under reduced motion, at full and
4× CPU — which checks the force layout's limits and fails the run when they do
not hold; and *Arrange view* on diagrams of 100, 500 and 2 000 elements, each
with twice as many relationships, at full and 4× CPU — the run fails when one,
at full CPU, is not laid out by ELK or has an element over another.

```bash
npm run build:web
npm run bench                                   # generated models of 10 000 to 500 000 triples
npm run bench -- --sizes 100000 --view-size 5000   # views of 5 000 nodes
npm run bench -- path/to/model.ttl              # models of your own
npm run bench -- --graph                        # the Graph tab's sweep alone
npm run bench -- --layout                       # Arrange view alone
npm run bench:model -- --triples 250000 --out model.ttl   # a generated model, to open by hand
```

A generated model is the same each time for the same options: ArchiMate 4.0
elements of 30 types, two permitted relationships each, laid-out views — and a
few faults planted (an unnamed element in 997, an impermissible relationship in
503), so that validation always finds the same. Models and results (JSON) are
kept in `test-results/bench/`; a table for each is printed.

## Collaboration server

`server/collab-server.mjs` keeps each room in `data/rooms/<room>.nt` (one triple
per line, authoritative) and `<room>.ttl` (pretty Turtle), and serves the live
model over HTTP: `GET /rooms`, `GET /rooms/<room>.ttl`. Configure with `PORT`
and `DATA_DIR`.

## Documentation

- [la-gram's documentation](https://app.linked.archi/la-gram/docs/) — how to use, configure, run and build la-gram, published with the web app; its source is `docs-site/` (MkDocs, Material for MkDocs)
- `.agents/specs/la-gram/` — requirements, design, tasks (what is done, what is next, and a change log)
- `.agents/conventions.md` — principles and code conventions
- `.agents/tasks/` — one folder per piece of work: its plan, requirements, design and report
- `.kiro/` — links to `.agents/specs/` and `.agents/conventions.md`, where Kiro looks for them
- `AGENTS.md`, `CLAUDE.md` — point coding agents to `.agents/conventions.md`, and its checklist for finishing a change
- `docs/linked-archi-tool-spec.md` — the broader, implementation-independent tool specification; Appendix D says what la-gram implements of it

The documentation builds in its own Python environment, `.venv-docs/` (Python 3.11 or later), with
exactly the versions `requirements-docs.txt` pins:

```bash
npm run docs:setup     # once: make .venv-docs/ and install requirements-docs.txt into it
npm run docs:serve     # preview on http://127.0.0.1:8000/la-gram/docs/, rebuilt on every save
npm run docs:build     # strict, as CI builds it, into dist/web/docs/: any warning fails it
```

After `npm run docs:build`, `npm run dev` serves the documentation on http://localhost:8080/docs/,
beside the app: the app's build leaves `dist/web/docs/` in place. CI's `docs` job builds it for every
merge request, and `web-deploy` publishes it with the web app. Screenshots, the build's hooks and the
server's Content-Security-Policy: *Developing › Writing the documentation*, in the documentation.

## Licence

la-gram is licensed under the [Apache License, Version 2.0](LICENSE).

The open-source packages built into it are each under their own licence. Every build writes them, with the text of each licence and notice file the package ships, to `third-party-licences.txt` beside the web app's and the desktop renderer's `index.html`; *About la-gram* links to it.

The metamodel files it ships under `assets/` are copies of Linked.Archi's published definitions (`https://meta.linked.archi/`), each under the licence it states — Creative Commons Attribution 4.0 for most, Attribution-ShareAlike for a few (`core/core-vis-onto.ttl`; some entries of `catalog.ttl`, which describe other vocabularies).
