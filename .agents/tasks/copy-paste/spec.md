# la-gram — Copy / paste on the canvas (spec draft)

Status: draft, 2026-11-07 · Target: la-gram 0.2

## 1. Problem

There is no copy/paste of diagram content. The clipboard is used only to copy IRIs and RDF text (`type-guide-panel.ts`, `rdf-panel.ts`). The closest existing feature is `ViewManager.duplicateView`, which re-places the same elements in a copy of a view (`addElementToView(..., { another: true })`).

Copy/paste in an RDF modeller has to answer one question that a drawing tool doesn't: **does pasting make new concepts or new placements of the same concepts?** Archi answers it by context (same model → new copies by default, with "Paste Special" to reference). la-gram should make it explicit.

## 2. Behaviour

| Action | Shortcut | Result |
|---|---|---|
| Copy | Ctrl/Cmd+C | Copies the selected nodes, the links between them, groups/notes/free shapes |
| Cut | Ctrl/Cmd+X | Copy, then *remove from view* (never deletes from the model) |
| Paste | Ctrl/Cmd+V | **Into another view of the same model: places the same elements** (reference). **Into the same view: new copies** (a second placement of an element in the same view is rare and confusing) |
| Paste as copies | Ctrl/Cmd+Shift+V | Always new elements and relationships, new IRIs |
| Paste as references | Ctrl/Cmd+Alt+V | Always the same elements, extra placement (`another: true`) |
| Duplicate | Ctrl/Cmd+D | Paste as copies, offset +20/+20, in the same view |

Also in the canvas right-click menu and the Edit menu, with the mode named ("Paste as copies").

**Paste position:** at the pointer if it is on the canvas; otherwise at the copied bounds +20/+20, repeated pastes stepping further. The pasted content becomes the selection.

**Toast:** "Pasted 5 elements (new), 4 relationships" / "Placed 5 existing elements, 4 relationships".

## 3. What gets copied

The clipboard payload is a **self-contained RDF fragment** (N-Triples text with a la-gram MIME type), not diagram-js internal state:
- For each selected node: the element's model triples (type, `skos:prefLabel`, properties, documentation, folder membership is **not** copied) and its `arch-vis:ArchNode` geometry and appearance.
- Links: a relationship is copied only when **both ends are in the selection** (the qualified relationship, its unqualified triple, `rdf:reifies`, its `arch-vis:Link` waypoints, label position). Relationship-to-relationship links follow when their end link is copied.
- Nested children come with their parent; the nesting relationship comes too.
- Groups, notes, free shapes and connectors: geometry and text.
- Header: source model IRI and namespace, source view IRI, metamodel IRIs, la-gram version.

Written to the system clipboard as two flavours: `web application/x-la-gram+n-triples` (custom flavour, async Clipboard API) and `text/plain` Turtle (so pasting into a text editor or the RDF panel gives readable RDF). An in-memory fallback is used when clipboard permission is denied (Electron sandboxed renderer: use the custom flavour via `navigator.clipboard.write`, falls back to in-memory within the app).

## 4. Paste modes in detail

**As copies**
- Mint a new IRI for every element, relationship, node and link (`mintIri(namespace, kind)`), with a consistent old→new IRI map so internal references (relationship ends, link ends, nesting) are rewritten.
- Labels unchanged (no "Copy of …"; Archi adds that and users remove it). Configurable later.
- Properties copied as-is, except any whose metamodel property is marked identifying (e.g. an external ID). Those are dropped and listed in the toast. Use SHACL `sh:maxCount 1` plus a metamodel annotation, or a hard-coded list in v1.

**As references**
- Only geometry is new: `addElementToView(view, element, bounds, { another: true })` for each element, then `addRelationshipsToView` for the copied relationships, which already exist in the model.
- If an element no longer exists in the model (deleted since copying), it is pasted as a copy, with a warning.

**Across models** (a different model open, or another la-gram window)
- References are impossible, so the paste is always as copies into the target namespace.
- **Type check against the target's metamodels:** an element whose type is not loaded is pasted as *unclassified* (or skipped, per a dialog); a relationship the target's relationship shapes don't allow is skipped and listed. This reuses the same rules as connect / change type.

**Pasting plain RDF** (text/plain Turtle from outside): out of scope for v1; the RDF panel / import already handles that path.

## 5. Implementation

- Use diagram-js's own `copyPaste` and `clipboard` modules for selection handling, keyboard binding and positioning, but **hook their descriptors**: on `copyPaste.copyElement` serialise from the store (the RDF fragment above), not from the shapes; on `copyPaste.pasteElements` stop the default creation and call a new session method.
- New `ModelSession.paste(viewIri, fragment, { mode, at })` in `src/model-manager/clipboard.ts`:
  1. parse the fragment (N3),
  2. resolve mode (same-model rule from §2),
  3. build the IRI map, rewrite the quads, run the metamodel checks,
  4. write everything inside `this.batch(...)`: one undoable step `rdf.view.paste`, one change for collaborators,
  5. emit `views-changed`, select the pasted nodes.
- Cut = copy + the existing *remove from view* command, in one compound command.
- Validation re-runs normally after the batch (the SHACL worker sees one change).

## 6. Acceptance criteria

1. Copy 3 elements and 2 relationships in view A, paste in view B of the same model: no new model triples; 3 new nodes and 2 links; the tree shows the elements once.
2. Paste as copies: 3 new element IRIs and 2 new relationship IRIs in the model namespace; ends rewritten; nothing points at the originals.
3. A relationship with only one end selected is not copied.
4. Paste is one undo step; undo leaves the store byte-identical to before.
5. Cross-model paste of a type the target doesn't have: per the dialog choice, with the skipped items listed.
6. Pasting into a text editor gives valid Turtle.
7. Works in Electron (sandboxed) and in the browser, including when clipboard permission is denied (in-app fallback).

## 7. Tests

- Unit: `clipboard.test` (fragment build from a selection, IRI rewrite, one-end-only relationship dropped, nesting, cross-model type checks).
- Integration: `model-session.test` (`paste` in each mode, undo, collab single change).
- Browser (`workbench.spec`): Ctrl/Cmd+C / V between two views, Ctrl/Cmd+D, cut, right-click menu entries.

## 8. Open questions

1. Is "same view → copies, other view → references" the right default, or should Ctrl/Cmd+V always reference (the RDF-first view) and only Shift give copies?
2. Should copied elements be filed into the source's folder in the target (same model only)?
3. Which properties count as identifying and are dropped on copy?
4. Copy from the model tree (not just the canvas) into a view: same payload, so cheap to add. v1 or v2?

## 9. Estimate

| Step | Effort |
|---|---|
| Fragment build / parse, IRI rewrite (`clipboard.ts`) | 1–1.5 d |
| diagram-js copyPaste hooks, keyboard, menus | 1 d |
| Modes, cross-model metamodel checks | 1–1.5 d |
| System clipboard flavours + fallback (web / Electron) | 0.5–1 d |
| Tests and docs | 1.5 d |
| **Total** | **~5–6.5 days** (estimate) |
