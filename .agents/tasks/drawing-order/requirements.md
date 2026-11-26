# Requirements: drawing order

To become a criterion of la-gram's Req 22 (*Align, Size and Route*) and amend Req 3.6 (moving) and Req 13.1 (the
ArchiMate exchange import).

**DO-1. What is drawn above what.** Among the placements and figures drawn in the same place — the view's top level,
or inside one container — the higher `arch-vis:zOrder` above; absent, 0; the same, by IRI in code point order. What is
nested is drawn above its container; every line above every shape, as now. The same everywhere a view is open, after
a save and a load, and in a collaborator's window.

**DO-2. The four.** On the selected elements and figures, less what is in a selected container:

- ***Bring to front***: above every other in the same place; several keep their order among themselves.
- ***Send to back***: below every other in the same place.
- ***Bring forward***: past the next one it overlaps, above it — and no further.
- ***Send backward***: past the next one it overlaps, below it.

Each one undoable step, one change for collaborators, written as the zOrders of the nodes it changes
(`modelManager.reorder`). Already in front, at the back, or with nothing it overlaps that way: nothing changes, and
la-gram says so. Not for a placement another collaborator holds.

**DO-3. Where.** The right-click menu on an element, a figure, or one of several selected: the four in a group of
their own. The canvas toolbar: an *Order* button with a menu of the four, each with its picture, enabled while an
element or a figure is selected. Keys, while the canvas has the focus: Ctrl/⌘+Shift+] to the front, Ctrl/⌘+] forward,
Ctrl/⌘+[ backward, Ctrl/⌘+Shift+[ to the back — in place of the browser's own (⌘[ and ⌘] go back and forward in a
Mac's browsers).

**DO-4. New and moved.** A placement added — dropped from the palette or the tree, appended, pasted, duplicated —
goes in front of the placements it overlaps in its place — to the front of its place — where it would be drawn below
one of them, and has no zOrder where it would not. Moving a shape, or nesting it in another, keeps its zOrder: it no longer comes to the
top. Taken into a container, it is ordered among the container's other contents by the same rule.

**DO-5. Kept.** A copy keeps the zOrders of what it copies, relative to each other; *Duplicate view* the same. A merge
takes one value per node, a conflict where both sides changed the same node's. The ArchiMate exchange import keeps the
file's order: each node in a view or a container its position among its siblings in the file (Req 13.1).

**DO-6. Said.** The property panel says nothing of it. The RDF panel shows `arch-vis:zOrder` with the geometry.
