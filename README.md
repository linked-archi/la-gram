# la-gram

An RDF-first architecture modeller for [Linked.Archi](https://meta.linked.archi/) metamodels.

The model lives in an RDF store; the diagram, the model tree, files and the
collaboration document are views of it. Metamodels — ArchiMate 4.0 and 3.2
bundled, the Linked.Archi Core (a generic element and relationship, to add
alongside a language or use alone), and every other language, framework and
extension published on `meta.linked.archi` — are loaded at runtime, so the palette, the relationship
rules, the notation and the validation all come from data.

- **Model / views** — one model, any number of diagram, catalog and matrix views; an element is one resource wherever it appears. Delete from a view or from the model.
- **Relationships the metamodel permits** — connect, change type and the "+" menu offer only what the metamodel's relationship shapes allow (ArchiMate's relationship matrix); "+" appends a new element — asking which relationship when several fit — or brings in what the element is already related to in the model.
- **Published vocabulary** — `arch:inModel`, `arch:inView`, qualified relationships plus their unqualified triples, `arch-vis:ArchNode`/`Link` geometry; older models are migrated on open.
- **Graph** — the Graph tab draws what the selected element is related to, 1–5 hops out, filterable by element and relationship type; the query behind it — as a SELECT (a table) or a CONSTRUCT (the triples) — runs in the SPARQL tab or downloads as `.rq`; the graph becomes a new view, laid out as drawn, or a Turtle file.
- **SPARQL** — the SPARQL Query tab shows results as tables with prefixed names that select the concept; *Render as new view* makes a diagram of the elements and relationships a result mentions.
- **Notation as published** — elements are drawn from the notation data in the shapes the published pictures show (ArchiMate's banded objects, 3D devices, wavy deliverables, the meaning cloud, the dashed grouping folder; EDGY's arrows and tag pills…), with their badges and label colours, and relationship ends from the published marker symbols.
- **Validation** — live SHACL against the loaded metamodels' shapes and the core shapes; the Validation tab counts the violations.
- **Change an element's type** — in the property panel, the *type* field lists every element type of the loaded metamodels (or right-click › Change type…); the element keeps its identity, name, properties and placements, and relationships the new type does not permit are named before and kept after (validation flags them).
- **Right-click menu** — on an element or a relationship: rename, change type, append; show its properties, its place in the model tree or its relationship graph; copy its IRI; delete it from the view or the model.
- **Rename in place** — double-click an element's box (or select it and press F2) and type its name; Enter keeps it, Esc drops it, undo brings the old one back.
- **About ‹type›** — under the model tree, what the loaded ontology and taxonomy say about the selected type (for a view, its viewpoint) or the type picked in the palette: definition, guidance, other names, classification and the other types in its group, superclasses, changes, the specification section. Folds to its header; resizes by its top edge.
- **Properties** — the selected concept in vertical tabs (information, properties, analysis, views); adding a property offers what applies to its type (by the vocabularies' `rdfs:domain` and SHACL shapes), what the model already uses and documentation properties — or any name, prefixed name or IRI.
- **Files** — Turtle, TriG (per-layer graphs), JSON-LD, N-Quads, N-Triples, RDF/XML; ArchiMate Exchange import; SVG/PNG export.
- **Collaboration** — real-time rooms (Yjs over Hocuspocus) that share the model's triples; presence and soft locks.
- **Undo everywhere** — every canvas change, including placements and model-level deletes.
- **See the RDF** — the "{ } RDF" toggle opens a panel on the right with the live model as Turtle (or any other format), exactly as it would be saved.
- **Layout** — the model tree on the left; the palette on the right; under the canvas, tabs for **Properties**, **Validation** (with the violation count), **SPARQL Query** and **Graph**. The tree, the palette and the RDF panel hide from the toolbar ("☰ Model", "▦ Palette", "{ } RDF") and resize by their inner edge; the bottom panel resizes by its top edge, folds to its tabs (click the open tab) and maximizes over the workspace (⤢; Esc restores). Sizes are remembered.
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

Desktop: `npm run build:electron && npm run electron`.

### Bundled metamodels, and refreshing them

ArchiMate 4.0 and 3.2, the core vocabularies and their icons and markers ship in `assets/`, a
snapshot of what meta.linked.archi serves, used first (`?assets=bundled-first`). To refresh it
from a `linked-archi-meta` checkout (by default `../../../linked-archi-meta`):

```bash
npm run sync-assets -- --check   # what differs (exit 1 if anything does)
npm run sync-assets              # update assets/, then: npm run build
npm run sync-assets -- --meta ~/src/linked-archi-meta
```

It runs linked-archi-meta's own publishing scripts into a temporary folder and refreshes each
bundled file from its published path, so it maps files exactly as the site does. Files the site
does not publish (la-gram's core metamodel manifest and taxonomy) are left alone. Asset fetches
always revalidate, so after a rebuild a plain reload loads the new files.

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
