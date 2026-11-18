---
inclusion: auto
description: Project conventions, architecture principles, and development workflow for la-gram, the RDF-first diagram-js architecture modeller.
---

# la-gram — Project Conventions

## What This Is

An RDF-first architecture modeller for Linked.Archi metamodels: diagram-js canvas,
Oxigraph store, SHACL validation, Yjs/Hocuspocus collaboration, browser and
Electron. One of the Linked.Archi modeller implementations; its behavioural
reference is the `la-modeller-excalidraw` spec, adapted in `.agents/specs/la-gram/`.

## Architecture Principles

1. **The store is the model of record.** Every representation — canvas, tree,
   panels, files, the collaboration document — is a projection of the RDF store.
   Nothing is kept in the canvas that the store does not hold.
2. **The metamodel is data, not code.** Palette, relationship rules, notation,
   viewpoints and validation come from loaded metamodel documents. No
   language-specific logic.
3. **SHACL is the validation contract.** Shapes decide — what is offered as well
   as what validation reports; `domainIncludes`/`rangeIncludes` are hints, used
   only where no shape covers a relationship type.
4. **Use the published vocabulary exactly.** Core 0.4.0 and core-vis: `arch:inModel`,
   `arch:inView`, `arch:modelConformsToMetamodel`, `arch:viewConformsToViewpoint`,
   qualified relationships with `arch:source`/`arch:target` plus the unqualified
   triple, `arch-vis:ArchNode`/`arch-vis:Link`. Retired terms are migrated on load,
   never written.
5. **CRDT is runtime truth for a shared room; RDF is truth at rest.** The Y.Doc
   carries the model's triples, not canvas state.
6. **Undo is an inverse diff.** A canvas gesture's model change runs once inside a
   recorded `rdf.store.change`; undo/redo replay the diff, never the logic.

## Tech Stack

- **Canvas:** diagram-js 14 + custom RDF modules (renderer, rules, modeling, pad, menus)
- **UI:** Lit 3 web components, CodeMirror 6
- **RDF:** Oxigraph 0.4 (WASM/native), n3, rdf-validate-shacl
- **Collaboration:** Yjs 13 + Hocuspocus 4
- **Build/test:** webpack 5, TypeScript 5 (strict), Vitest (+ jsdom), Playwright
- **Desktop:** Electron

## Code Conventions

- Model data lives in the store's **default graph**; each metamodel document in a
  named graph keyed by its ontology IRI. Never write model data to a named graph
  at runtime; never read "all quads" when you mean the model (`modelQuads`).
- IRIs are minted with `rdf-engine/iri.ts` in the layout every Linked.Archi tool
  shares (DD-41): `{ns}{kind}/{uuid}`, a node or a line in its view's IRI
  (`{view}#node/{uuid}`), a part under its owner with `/` (`partIri`); never
  counters. Names minted before keep theirs (`{ns}element-{uuid}`, `{node}-style`)
  and are read either way (`isPartNamed`); never rename a part. Mint through the
  managers, which look the namespace up (`model-manager/model-namespace.ts`);
  never hard-code a base.
- Labels and other human text are language-tagged (`@en` by default) — the
  Linked.Archi shapes reject plain strings.
- RDF terms for the model layer come from `model-manager/vocabulary.ts` (`IRI`,
  `T`, `triple`, `langLiteral`…); do not re-declare predicate constants.
- Every removal a user can undo has a `collect…` twin returning exactly the quads
  it removes.
- Canvas-side model changes go through commands (`rdf.element.create`,
  `rdf.relationship.*`, `rdf.store.change`, `rdf.model.delete`); store-side
  changes reach the canvas through `syncFromStore()` and never the command stack.
- Panels emit events; `mount-ui` and the App execute them. Panels do not write the store.
- What relationships are permitted is `RelationshipManager.getValidRelationships`'s answer
  (relationship shapes first, `domainIncludes`/`rangeIncludes` hints only where no shape
  covers); never decide validity from the hints elsewhere.
- No blank nodes in model data: geometry uses IRI-named list cells.
- Comments explain *why* and name the spec or design decision (DD-n) behind a choice.

## File Structure

```
src/
  app.ts                  App: metamodels, session, I/O, validation, events
  index.ts                entry point, URL parameters
  rdf-engine/             store, observable wrapper, IRIs, parser/serializer, SHACL
  metamodel-manager/      asset sources, loader, catalogue, palette, notation, viewpoints
  model-manager/          session, namespace, element/relationship/view managers, cascade, queries,
                          property catalog, migration
  import-export/          model I/O, ArchiMate exchange import, SVG/PNG, legacy TTL I/O
  ui/                     shell, mount-ui, dialogs, panels/, canvas/, views/
  collab/                 Y.Doc binding, collaboration start-up
  platform/               web vs. Electron file access
server/collab-server.mjs  Hocuspocus server with RDF persistence
assets/                   bundled metamodels (mirror of meta.linked.archi)
tests/browser/            Playwright suite against dist/web
docs/                     broader tool specification
```

## Running

- `npm run dev` — build (development) and serve on http://localhost:8080
- `npm run collab` — collaboration server on ws://localhost:1234 (then open `?room=name`)
- `npm test` / `npm run typecheck` / `npm run test:browser:build`

## Workflow

- Specs are living documents, not gates: a change and the documents that describe
  it go in together.
- Keep the bundled assets byte-identical to their meta source; refresh them with
  `npm run sync-assets` from the published site by default, or explicitly use a
  local checkout (`npm run sync-assets -- --meta <checkout>`). Never edit the copies here.
- A piece of work another person or agent may have to continue gets a folder,
  `.agents/tasks/<name>/`, written before the work: its README (goal, what was
  decided), `requirements.md`, `design.md` and `tasks.md` (a checklist, ticked as
  it goes, with a dated note where it stopped).

### Finishing a change

A change is finished when each of these says what la-gram does now:

1. **Tests.** `npm run typecheck` and `npm test`; for anything drawn on the canvas
   or clicked in a panel, the browser suite too (`npm run test:browser:build`). A
   fixed bug gets a test that fails without the fix.
2. **`README.md`**: the feature's bullet.
3. **`.agents/specs/la-gram/requirements.md`**: its acceptance criteria, numbered
   (Req n.m), as requirements: what la-gram does, never "as another tool does".
4. **`.agents/specs/la-gram/design.md`**: how it works; a choice made for a reason
   as a numbered key design decision.
5. **`.agents/specs/la-gram/tasks.md`**: the `- [x]` lines under their task, with
   `(Req n.m)` and the test files; an entry at the top of the change log — what it
   does and why, the test files in italics; the known limitations; findings not
   started as `- [ ]` "recorded (date), not started" under *Queued next*.
6. **The documentation site, `docs-site/`**: the pages that describe the feature,
   written as it works now — no comparison with what it did before — and as
   *Writing the documentation* says (`docs-site/developing/documentation.md`): UI
   labels exactly as la-gram shows them, each option with its values, its default
   in bold and an example. A new page goes into `mkdocs.yml`'s `nav`.
7. **Bundled assets**, when the change needs meta's: refreshed from the published site by default,
   or explicitly from a `linked-archi-meta` checkout (`docs-site/developing/assets.md`).
8. **Build.** `npm run build`, then `npm run docs:build` — strict, a warning fails
   it — after the app's build, which empties `dist/web/`, where the site is built.

## Key References

- Requirements & behaviour: `#[[file:.agents/specs/la-gram/requirements.md]]`
- Design: `#[[file:.agents/specs/la-gram/design.md]]`
- Tasks and change log: `.agents/specs/la-gram/tasks.md` (read when finishing a change)
- Writing the documentation: `docs-site/developing/documentation.md` (read when writing a page)
- Broader tool spec (reference, not all applicable): `#[[file:docs/linked-archi-tool-spec.md]]`
