# Requirements: search

In la-gram's specification: Requirement 23, *Search*.

**SR-1. The find bar.** A text field with what matches ("3 of 7", "No matches"), ↑ and ↓ to the previous and next
match, and × to close. Enter goes to the next match, Shift+Enter to the previous, from the last back to the first;
Esc closes it. Typing searches as it goes. Opened again, it holds its last text, selected, and searches again.

**SR-2. The canvas's.** Over the diagram's top right, from Ctrl/⌘+F or the canvas toolbar's 🔍. It searches the open
diagram: an element's name, a relationship's name, the text of a note, a group, a shape or a line from one, a view
reference's name and own text, and the type's name of an element or a relationship. Case is ignored; the text is
matched anywhere in a name. Each placement and each line that matches is a match: an element placed twice is two.

**SR-3. The canvas's matches.** In reading order: top to bottom in rows of 20 px, left to right in a row. Each is
outlined; the current one is selected — its properties shown — and scrolled into view. *Select all* selects every
match and leaves the bar open. Closing the bar takes the outlines away and leaves the selection as it is.

**SR-4. Elsewhere in the model.** How many elements and relationships of the model match by name or type and are
not in the open view: "4 more in other views" — a link that opens the model tree filtered by the same text.

**SR-5. Kept up to date.** A change to the model or another view opened searches again; the current match stays
current while it still matches.

**SR-6. The RDF panel's.** In its header, from Ctrl/⌘+F in the panel or its 🔍. It searches the text shown: every
match highlighted, the current one more strongly and scrolled into view. Case is ignored unless *Aa* is pressed.
A new text — the model changed, another scope, format, geometry or provenance — is searched again, the current
match kept as near its place as the new text allows. A whole model too large to show has no text to search: the
bar says "Too large to show, so not searched".

**SR-7. Ctrl/⌘+F.** By where the focus is — or, with nothing focused, where the pointer was last pressed (the RDF
text and the tree's rows take no focus): in the RDF panel, its search; in the model tree, the filter, focused with
its text selected; anywhere else, while a diagram is open, the canvas's search. Not under a dialog. With a catalog or a matrix open,
and in the SPARQL editor, la-gram leaves the key to the browser.
