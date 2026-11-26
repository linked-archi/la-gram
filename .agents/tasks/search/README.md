# Search on the canvas and in the RDF panel

Recorded 2026-11-26, la-gram on `pre-release`. For 0.4.0.

## Goal

A modeller finds something by its name in the open diagram, and a word in the RDF panel's text. The model tree
filters the whole model by name or type (Req 10.9), but nothing searches the diagram in view or the text the RDF
panel shows. The browser's own find (Ctrl+F) reads the page, not the diagram's viewport, and the desktop app has
none.

## What was decided

Decision confirmed on 2026-11-26:

1. **The canvas: a find bar** over the diagram's top right, from Ctrl/⌘+F or a 🔍 button in the canvas toolbar.
   It says how many match ("3 of 7"); ↑/↓, Enter and Shift+Enter step through them; each match is outlined, and the
   current one is selected and scrolled into view, so the Properties tab shows it. *Select all* selects every match.
   Esc closes it and takes the outlines away.
2. **What the canvas search matches:** an element's or a relationship's name, the text of a note, a group, a shape
   or a view reference, and the type's name — "Application Component" finds every one. Not definitions or other
   property values.
3. **The open view only**, with a line saying how many more concepts of the model match in other views
   ("4 more in other views"), which opens the model tree filtered by the same text.
4. **The RDF panel: the same bar** in its header, from Ctrl/⌘+F in the panel or its 🔍 button: every match
   highlighted, the current one scrolled into view, the count, ↑/↓. Plain text, case ignored unless *Aa* is on; no
   regular expressions. A whole model too large to show (Req 5.7) has no text to search: the bar says so.
5. **Ctrl/⌘+F opens the search of where the focus is:** the RDF panel's in the RDF panel, the tree's filter in the
   model tree, the canvas's anywhere else while a diagram is open — in place of the browser's own find, as Ctrl+S
   and Ctrl+O are. With a catalog or a matrix open, and in the SPARQL editor, the browser's own find is left.
6. **In 0.4.0.**

## Files

- `requirements.md`: what the searches do (SR-n).
- `design.md`: how they work, and the choices made (SR-DD-n).
- `tasks.md`: the checklist, and where it stopped.
