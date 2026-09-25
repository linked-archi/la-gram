# la-gram

An RDF-first architecture modeller for [Linked.Archi](https://meta.linked.archi/) metamodels.

The model lives in an RDF store; the diagram, the model tree, files and the
collaboration document are views of it. Metamodels — ArchiMate 4.0 and 3.2
bundled, and every other language, framework and extension published on
`meta.linked.archi` — are loaded at runtime, so the palette, the relationship
rules, the notation and the validation all come from data.

- **Model / views** — one model, any number of diagram, catalog and matrix views; an element is one resource wherever it appears. Delete from a view or from the model.
- **Published vocabulary** — `arch:inModel`, `arch:inView`, qualified relationships plus their unqualified triples, `arch-vis:ArchNode`/`Link` geometry; older models are migrated on open.
- **Validation** — live SHACL against the loaded metamodels' shapes and the core shapes.
- **Files** — Turtle, TriG (per-layer graphs), JSON-LD, N-Quads, N-Triples, RDF/XML; ArchiMate Exchange import; SVG/PNG export.
- **Collaboration** — real-time rooms (Yjs over Hocuspocus) that share the model's triples; presence and soft locks.
- **Undo everywhere** — every canvas change, including placements and model-level deletes.

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

- `.kiro/specs/la-gram/` — requirements, design, tasks (what is done, what is next)
- `.kiro/steering/project-conventions.md` — principles and code conventions
- `docs/linked-archi-tool-spec.md` — the broader, implementation-independent tool specification
