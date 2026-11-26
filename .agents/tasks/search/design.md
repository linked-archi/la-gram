# Design: search

## Pieces

- **`ui/panels/find-bar.ts`**, a Lit component both searches use: the field, the count, ↑ ↓ ×, and what its host adds
  — *Aa* (the RDF panel), *Select all* and a note with a link (the canvas). It searches nothing: it says what is
  typed and pressed (`find-query`, `find-step`, `find-close`, `find-select-all`, `find-elsewhere`), and shows what
  its host tells it.
- **`ui/canvas/canvas-search.ts`**: what a shape's texts are (`searchTextsOf`), and `CanvasSearch` — the matches in
  reading order, the current one, stepping, *Select all* — over a host the canvas gives it (its shapes, a type's
  name, selecting, scrolling, the markers).
- **`ui/panels/text-search.ts`**: `findMatches` (the offsets of a query in a text) and `rangesOf` (those offsets as
  DOM ranges over an element's text nodes), for the RDF panel.
- **`mount-ui.ts`**: the canvas's find bar, over the diagram host; Ctrl/⌘+F; searching again on a model change and on
  another view; "N more in other views" from the model's contents, as the tree lists them.

## Key design decisions

**SR-DD-1. A bar of la-gram's, not diagram-js's search pad.** diagram-js has one (bpmn-js's Ctrl+F): a field with a
list of results under it. The bar here is the same for the canvas and the RDF panel, steps through matches as a
text editor's does, and has room for *Select all* and what is elsewhere in the model.

**SR-DD-2. Outlines are markers.** Each match carries `la-search-match`, the current one `la-search-current` too:
classes on its diagram-js element, painted on its `.djs-outline` as a selection is, in another colour. Exports drop
the outlines (`.djs-outline` is removed from what is exported), so a search open while exporting leaves no trace.

**SR-DD-3. The RDF panel's matches are highlights, not markup.** Its text is one HTML string, assigned once per
change (key design decision on the RDF panel's tokenizer); wrapping matches in elements would mean writing it again
on every keystroke and splitting its tokens. The CSS Custom Highlight API paints DOM ranges without touching the
DOM (`CSS.highlights`, `::highlight(…)`): the text, its blocks and the click that selects a subject are as they were.
Where a browser has no highlights, the current match is the page's text selection, and the others are not painted.

**SR-DD-4. Ctrl/⌘+F goes where the focus is.** One listener on the window, as Ctrl+S's: the event's composed path
says whether the key came from the RDF panel, the model tree or the SPARQL editor. Found while testing in the
browser: the RDF panel's text and the tree's rows take no focus, so after a click on them the key comes from the
page itself; then the path of the last `pointerdown`, captured on the window, decides. Everywhere else it is the
canvas's, while a diagram is open; otherwise the browser's own find, which reads a catalog's or a matrix's table.

**SR-DD-5. Elsewhere counts concepts, not text.** "N more in other views" counts the model's elements and
relationships whose name or type's name holds the text and that the open view does not place, read from the same
contents the model tree lists. The tree's filter, which the link sets, matches name and type as well.
