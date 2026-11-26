---
title: Keyboard and mouse
description: Every keyboard shortcut and mouse gesture in la-gram, on Windows, Linux and macOS.
---
# Keyboard and mouse

Every key and gesture la-gram responds to, by where it works. On a Mac, ⌘ (Command) takes the place of
Ctrl and ⌥ (Option) the place of Alt. The tabs below show both; the choice of tab is kept across the
page.

The toolbar's undo and redo buttons say *Undo (Ctrl+Z)* and *Redo (Ctrl+Y)* on every platform. On a Mac
the keys are ++cmd+z++ and ++cmd+y++ (or ++shift+cmd+z++), as below; the canvas takes the Ctrl forms
there too.

The examples use the example model:
[open it](https://app.linked.archi/la-gram/?model=docs/examples/shop.ttl) in a second tab.

## Files {#files}

These work anywhere in la-gram, except under a dialog, in place of the browser's own *Open* and *Save
page*. A field you are typing in is left first, so what it holds is saved.

=== "Windows and Linux"

    | Keys | Does |
    |---|---|
    | ++ctrl+o++ | *File › Open…*: open a model file |
    | ++ctrl+s++ | *File › Save*: save the model as TriG |

=== "macOS"

    | Keys | Does |
    |---|---|
    | ++cmd+o++ | *File › Open…*: open a model file |
    | ++cmd+s++ | *File › Save*: save the model as TriG |

1. Change the model: the ● after its name says it has unsaved changes.
2. Press ++ctrl+s++ (++cmd+s++ on a Mac): `Acme-online-shop.trig` is saved, and the ● goes.

## On the canvas {#canvas}

The canvas takes these keys when it has the focus: click an empty part of it first.

=== "Windows and Linux"

    | Keys | Does |
    |---|---|
    | ++ctrl+z++ | undo the last change on the canvas or in the property panel |
    | ++ctrl+y++ or ++ctrl+shift+z++ | redo |
    | ++delete++ or ++backspace++ | delete the selection from the view; the model keeps it |
    | ++ctrl+c++ | copy the selection |
    | ++ctrl+x++ | cut the selection: copy it, and delete it from the view |
    | ++ctrl+v++ | paste: the same elements into another view of the model; copies into this view or another model |
    | ++ctrl+shift+v++ | paste as copies |
    | ++ctrl+alt+v++ | paste as references: the same elements, placed again |
    | ++ctrl+d++ | duplicate the selection, as copies |
    | ++ctrl+shift+bracket-right++ / ++ctrl+bracket-right++ | bring the selection to the front / one step forward |
    | ++ctrl+bracket-left++ / ++ctrl+shift+bracket-left++ | send the selection one step backward / to the back |
    | ++f2++ | rename the one selected element, relationship or figure — on a view reference, its view |
    | ++ctrl+plus++ / ++ctrl+minus++ | zoom in / out one step |
    | ++ctrl+0++ | zoom to 100 % |
    | ++esc++ | put the format painter down; cancel a connection, lasso or move in progress |
    | ++enter++ / ++esc++ while renaming | keep the new name / keep the old one |

=== "macOS"

    | Keys | Does |
    |---|---|
    | ++cmd+z++ (or ++ctrl+z++) | undo the last change on the canvas or in the property panel |
    | ++cmd+y++ or ++shift+cmd+z++ (or the Ctrl forms) | redo |
    | ++delete++ or ++backspace++ | delete the selection from the view; the model keeps it |
    | ++cmd+c++ | copy the selection |
    | ++cmd+x++ | cut the selection: copy it, and delete it from the view |
    | ++cmd+v++ | paste: the same elements into another view of the model; copies into this view or another model |
    | ++shift+cmd+v++ | paste as copies |
    | ++alt+cmd+v++ | paste as references: the same elements, placed again |
    | ++cmd+d++ | duplicate the selection, as copies |
    | ++shift+cmd+bracket-right++ / ++cmd+bracket-right++ | bring the selection to the front / one step forward |
    | ++cmd+bracket-left++ / ++shift+cmd+bracket-left++ | send the selection one step backward / to the back |
    | ++f2++ | rename the one selected element, relationship or figure — on a view reference, its view |
    | ++cmd+plus++ / ++cmd+minus++ (or the Ctrl forms) | zoom in / out one step |
    | ++cmd+0++ (or ++ctrl+0++) | zoom to 100 % |
    | ++esc++ | put the format painter down; cancel a connection, lasso or move in progress |
    | ++enter++ / ++esc++ while renaming | keep the new name / keep the old one |

- **Undo** covers what you change in this view: placing, moving, connecting, renaming, deleting from the
  view, and property edits. Its history belongs to the open view and starts again when another view
  opens. Changes that come from elsewhere (a collaborator, an import, a deletion from the model tree of a
  concept not on the canvas) are not undone from here; see [Undo](../troubleshooting.md#undo).
- **++f2++** acts on one selected element, relationship or figure only, and not while the focus is in a
  text field. On a [view reference](../guide/canvas.md#view-references) it renames the view, every
  reference to it with it; the reference's own text is its *Text* in the Properties tab. Clicking elsewhere while renaming keeps the new name, as ++enter++ does.
- **Delete** never deletes from the model: *Delete from model (all views)* on the context pad or the
  right-click menu does, after asking.
- **Drawing order** — ++cmd+bracket-left++ and ++cmd+bracket-right++ are the browser's back and forward on a
  Mac; while the canvas has the focus, they change what is drawn above what instead:
  [Order](../guide/canvas.md#order).
- **Copy and paste** — what each pastes, and where: [Copy and paste](../guide/canvas.md#copy-and-paste). The
  keys copy the diagram's selection unless a text field has the focus or text is selected on the page,
  which they copy as usual.

With the example model:

1. Click *Gift wrapping* on the canvas, press ++f2++, type "Gift wrap" and press ++enter++.
2. Press ++ctrl+z++ (++cmd+z++ on a Mac): the name is "Gift wrapping" again.
3. Press ++ctrl+y++ (++cmd+y++): "Gift wrap" again. Press ++ctrl+z++ once more to leave it as it was.
4. Press ++ctrl+minus++ twice, then ++ctrl+0++: back at 100 %.

## Views {#views}

=== "Windows and Linux"

    | Keys | Does |
    |---|---|
    | ++alt+left++ / ++alt+right++ | open the view before / after, in the order you opened them |

=== "macOS"

    | Keys | Does |
    |---|---|
    | ++option+left++ / ++option+right++ | open the view before / after, in the order you opened them |

They work anywhere but in a text field, where they move the cursor by a word, and not while a dialog is
open. The toolbar's ← and → buttons do the same, and their tooltips name the view they go to.

1. In the model tree, double-click *Who is who*: the catalog view opens.
2. Press ++alt+left++ (++option+left++): *How the shop serves its customers* is open again.
3. Press ++alt+right++ (++option+right++): *Who is who*.

## Search {#search}

=== "Windows and Linux"

    | Keys | Where | Does |
    |---|---|---|
    | ++ctrl+f++ | anywhere, with a diagram open | opens the diagram's [search](../guide/canvas.md#search) |
    | ++ctrl+f++ | in the RDF panel | opens [its search](../guide/rdf-panel.md#search) |
    | ++ctrl+f++ | in the model tree | puts the cursor in its [filter](../guide/model-tree.md#filter) |
    | ++enter++ / ++shift+enter++ | in a find bar | the next match / the previous |
    | ++esc++ | in a find bar | closes it |

=== "macOS"

    | Keys | Where | Does |
    |---|---|---|
    | ++cmd+f++ | anywhere, with a diagram open | opens the diagram's [search](../guide/canvas.md#search) |
    | ++cmd+f++ | in the RDF panel | opens [its search](../guide/rdf-panel.md#search) |
    | ++cmd+f++ | in the model tree | puts the cursor in its [filter](../guide/model-tree.md#filter) |
    | ++enter++ / ++shift+enter++ | in a find bar | the next match / the previous |
    | ++esc++ | in a find bar | closes it |

It goes by where you are: where the keyboard is, or else where you last clicked — the RDF panel's text
and the tree's rows take no keyboard focus. In the SPARQL editor, with a catalog or a matrix open, and
while a dialog is open, the browser's own find works as usual.

1. Click the empty canvas and press ++ctrl+f++ (++cmd+f++): the diagram's find bar opens.
2. Click a block of statements in the RDF panel and press it again: the panel's own opens.

## SPARQL editor {#sparql-editor}

=== "Windows and Linux"

    | Keys | Does |
    |---|---|
    | ++ctrl+enter++ | run the query |

=== "macOS"

    | Keys | Does |
    |---|---|
    | ++cmd+enter++ or ++ctrl+enter++ | run the query |

In the *Questions* menu, ++up++ and ++down++ move between the questions and ++esc++ closes it.

1. Open the *SPARQL Query* tab and click in the editor.
2. Press ++ctrl+enter++ (++cmd+enter++): the results are under the editor.

## Model tree {#model-tree}

=== "Windows and Linux"

    | Keys | Does |
    |---|---|
    | ++ctrl++ + click | add a row to the selection, or take it out |
    | ++shift++ + click | select every row from the last one clicked to this one |
    | ++ctrl+c++ | copy the selected elements and relationships, to paste into a diagram |
    | ++esc++ while dragging rows | cancel the drag |

=== "macOS"

    | Keys | Does |
    |---|---|
    | ++cmd++ + click | add a row to the selection, or take it out |
    | ++shift++ + click | select every row from the last one clicked to this one |
    | ++cmd+c++ | copy the selected elements and relationships, to paste into a diagram |
    | ++esc++ while dragging rows | cancel the drag |

Several rows are selected to move them to a folder together, with *Move … to folder…* or by dragging.
Views, elements, relationships and folders can be selected so; the model's own row and the group
headings cannot.

1. In the model tree, click *Payments*, then ++ctrl++-click (++cmd++-click) *Web shop*: both are selected.
2. ++shift++-click *Customer*: every element row from *Web shop* to *Customer* is selected.

## Panels {#panels}

| Keys and gestures | Does |
|---|---|
| ++esc++ | restore the bottom panel or the RDF panel when it is maximized, unless a dialog or a menu is open |
| double-click the empty part of the bottom tab strip | maximize the bottom panel over the workspace, or restore it |
| click the open bottom tab | fold the panel down to its tabs, or unfold it |
| drag a panel's edge | resize it; the size is remembered ([stored data](stored-data.md#panel-sizes)) |

The ⤢ button at the right of the tab strip maximizes and restores too; its tooltip says *Restore the
panel (Esc)* while the panel is maximized.

1. Double-click the empty strip to the right of the *History* tab: the bottom panel covers the workspace.
2. Press ++esc++: it is back at its size.

## Dialogs and lists {#dialogs}

| Keys | Where | Does |
|---|---|---|
| ++enter++ | any dialog | the dialog's main button (*Apply*, *Create*, *Save*…), unless the focus is in a text area, where it starts a new line. A dialog whose fields have a problem stays open and says which |
| ++esc++ | any dialog | cancel: close it and change nothing. A click outside the dialog does the same |
| ++up++ / ++down++ | *File › Settings…* | move to the tab above or below |
| ++up++ / ++down++, ++enter++, ++esc++ | a picker's list, such as the property panel's *Type* | move through the list, take the highlighted entry, close the list |
| ++up++ / ++down++ | the property panel's tabs | move to the tab above or below |
| ++enter++ / ++esc++ | a catalog view's cell, while editing it | keep the value / drop it |

1. Choose *File › Settings…*, and press ++down++ while a tab has the focus: the next tab opens.
2. Press ++esc++: the dialog closes and nothing changes.

## Typing in fields {#typing-in-fields}

Keys typed in a panel's field (the property panel, the palette's search, the SPARQL editor, the tree's
filter) **never reach the canvas**, combinations with Ctrl or ⌘ included. ++ctrl+z++ in the *Name* field
undoes your typing there, and ++backspace++ deletes a character, not the selected element.

1. Select *Web shop*, and in the property panel's *Name* field, type "s".
2. Press ++backspace++: the "s" goes, and *Web shop* stays on the canvas.

## Mouse {#mouse}

=== "Windows and Linux"

    | Gesture | Does |
    |---|---|
    | click | select an element or a relationship |
    | ++shift++ + click | add to the selection, or take from it |
    | ++shift++ + drag on the canvas | select with a lasso |
    | drag on an empty part of the canvas | move around the diagram |
    | double-click | rename what is under the pointer; a view reference: open the view it references |
    | right-click | the right-click menu of what is under the pointer, or of the canvas |
    | scroll | scroll up and down |
    | ++shift++ + scroll | scroll sideways |
    | ++ctrl++ + scroll, or a trackpad's pinch | zoom in or out |

=== "macOS"

    | Gesture | Does |
    |---|---|
    | click | select an element or a relationship |
    | ++shift++ + click | add to the selection, or take from it |
    | ++shift++ + drag on the canvas | select with a lasso |
    | drag on an empty part of the canvas | move around the diagram |
    | double-click | rename what is under the pointer; a view reference: open the view it references |
    | right-click, or ++ctrl++ + click | the right-click menu of what is under the pointer, or of the canvas |
    | scroll | scroll up and down |
    | ++shift++ + scroll | scroll sideways |
    | ++cmd++ + scroll (or ++ctrl++ + scroll), or a trackpad's pinch | zoom in or out |

The canvas toolbar's tools do the same by a click: the lasso and the hand, and the connect tool.

1. ++shift++-drag around *Customer* and *Place order*: both are selected.
2. Drag on an empty part of the canvas: the diagram moves with the pointer.

## Graph tab {#graph-tab}

The same on every platform:

| Gesture | Does |
|---|---|
| click an element or a line | select that element or relationship, on the canvas and in the Properties tab |
| double-click an element | make it the element in the middle, and select it |
| drag an element | move it; with *Layout* **Force**, the elements linked to it follow, and when you let go it settles back among them. The element in the middle stays where you drop it, and the graph follows it |
| drag the background | move the graph |
| scroll, or a trackpad's pinch | zoom in or out |

Once you have clicked, dragged or scrolled in the drawing, the view stays where you put it until you
choose another element, depth, filter or layout, change the *Forces*, or choose *Fit*. More on each gesture in
[Relationship graph › Navigate](../guide/graph.md#navigate).

1. Select *Web shop* and open the *Graph* tab.
2. Drag *Card payment* away from *Web shop*: *Payments*, linked to it, follows. Let go: *Card payment*
   settles back.
3. Double-click *Card payment*: the graph is drawn round it, and framed when it comes to rest.

## The Keyboard shortcuts dialog {#shortcuts-dialog}

*Keyboard shortcuts*, in la-gram's menu (the icon and name at the top left), lists the common keys and
gestures, by where they work. On a Mac it writes them ⌘Z, ⇧⌘Z, ⌥←; elsewhere Ctrl+Z, Ctrl+Shift+Z,
Alt+←.

It leaves out a few that this page has: ++esc++ to restore a maximized panel, the double-click on the tab
strip, ++enter++ and ++esc++ while renaming, ++esc++ to cancel a tree drag, the keys of the catalog
cells and the *Questions* menu, and the [Graph tab](#graph-tab)'s gestures.

1. Open la-gram's menu, at the top left.
2. Choose *Keyboard shortcuts*: the list opens in a dialog. Press ++esc++ to close it.
