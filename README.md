# la-gram

An RDF-first architecture modeller for [Linked.Archi](https://meta.linked.archi/) metamodels.

The model lives in an RDF store; the diagram, the model tree, files and the
collaboration document are views of it. Metamodels — ArchiMate 4.0 and 3.2
bundled, and every other language, framework and extension published on
`meta.linked.archi` — are loaded at runtime, so the palette, the relationship
rules, the notation and the validation all come from data.

- **Model / views** — one model, any number of diagram, catalog and matrix views; an element is one resource wherever it appears. Delete from a view or from the model.
- **Published vocabulary** — `arch:inModel`, `arch:inView`, qualified relationships plus their unqualified triples, `arch-vis:ArchNode`/`Link` geometry; older models are migrated on open.
- **Validation** — live SHACL against the loaded metamodels' shapes and the core shapes; the Validation tab counts the violations.
- **Properties** — the selected concept in vertical tabs (information, properties, analysis, views); adding a property offers what applies to its type (by the vocabularies' `rdfs:domain` and SHACL shapes), what the model already uses and documentation properties — or any name, prefixed name or IRI.
- **Files** — Turtle, TriG (per-layer graphs), JSON-LD, N-Quads, N-Triples, RDF/XML; ArchiMate Exchange import; SVG/PNG export.
- **Collaboration** — real-time rooms (Yjs over Hocuspocus) that share the model's triples; presence and soft locks.
- **Undo everywhere** — every canvas change, including placements and model-level deletes.
- **See the RDF** — the "{ } RDF" toggle opens a panel on the right with the live model as Turtle (or any other format), exactly as it would be saved.
- **Layout** — the model tree on the left; the palette on the right; under the canvas, tabs for **Properties**, **Validation** (with the violation count) and **SPARQL Query**. The palette and the RDF panel hide from the toolbar and resize by their left edge; the bottom panel resizes by its top edge and folds to its tabs (click the open tab). Sizes are remembered.
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
