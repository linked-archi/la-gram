---
title: Model tree and folders
description: The model tree in la-gram, its groups, filter and menus, the model's own folders, making views and elements in them, and moving views, elements and relationships into them.
---
# Model tree and folders

The model tree, on the left, shows the whole model the way the store holds it, whatever the open view
draws: its views, its elements and its relationships. ☰ *Model* in the toolbar hides and shows it.

## Groups {#groups}

| Group | Holds |
|---|---|
| Views | every view, the open one in bold, a catalog or matrix with its kind |
| Elements | the elements, by type, each type with its count |
| Relationships | the relationships, by type, each written *Source → Target* |
| Unclassified | concepts whose types no loaded metamodel defines: an unloaded language's, or a file's own; shown only when there are some |
| Derived relationships | relationships a derivation rule concluded and the model does not state, under *Valid* and *Potential*; shown only when the model's file brings some (see [Derived relationships](#derived-relationships)) |

The groups and the types fold; a folded group keeps its count.

1. Open the example model. *Elements* lists **Application Component** (2), **Business Actor** (2),
   **Process** (1) and **Service** (3).
2. Unfold *Relationships*: **Serving** lists "Card payment → Web shop", "Gift wrapping → Customer" and
   "Online ordering → Place order".

## Folders or types {#folders-or-types}

*Folders* | *Types*, in the tree's header, switches how the groups are laid out:

| Choice | Lays out |
|---|---|
| **Folders** | the model's own folders in each group, each folded; subfolders, then concepts, by name; then what no folder holds, by type |
| *Types* | by type only, the folders left out |

**Folders** is the default, remembered in this browser. A model without folders is shown by type, and
*Folders* is greyed out until it has one. A model converted from Archi, or another tool that keeps
folders, opens in its folders. To keep an Archi model's folders, export it from Archi with
`--xmlexchange.exportFolders` before converting it: without that option, Archi's exchange file has none.

1. Open a model with folders.
2. Click *Types* in the tree's header: the same concepts, by type.
3. Click *Folders* to go back.

## Filter {#filter}

*Filter by name or type…*, under the header, keeps the rows whose name or type has what you type, in
folded folders too. *Nothing matches.* says when nothing does. ++ctrl+f++ (++cmd+f++ on a Mac) in the tree
puts the cursor in it, and the diagram's [search](canvas.md#search) sets it with *N more in other views*.

1. Type "pay" in *Filter by name or type…*.
2. Under *Elements*, the tree shows "Payments" and "Card payment" only.

## Select and open {#select-and-open}

| Gesture | On | Does |
|---|---|---|
| click | a row | selects it: on the canvas too, and in the Properties tab |
| ++ctrl++-click (++cmd++ on a Mac), ++shift++-click | rows | selects several |
| **double-click** | a view | opens it |
| double-click | an element or a relationship | shows it on the canvas, opening a view that has it when the open one does not |
| double-click | the model | opens *Model settings* |

1. Double-click "Who is who" under *Views*: the catalog opens.
2. Double-click "Gift wrapping" under *Elements*: the diagram opens again, with "Gift wrapping" selected.

## Placed marker {#placed-marker}

A dot after a row marks a concept the open diagram draws (*In the open view*, it says on hover): an
element, a relationship, or a view the diagram holds a [view reference](canvas.md#view-references) to.
Rows with no dot are in the model, but not drawn in this view, and can be dragged onto it. A view's row
dragged onto the diagram makes a view reference to that view where you let go; clicked, it selects the
references to it there. A catalog or a matrix
draws nothing, so with one open no row has the dot.

1. Open the example's diagram: every element and relationship has the dot.
2. Make a new diagram with ＋ › *New diagram*: no row has it.
3. Drag "Customer" from the tree onto the new diagram: its row has the dot again.

## Menus {#menus}

Right-click a row for its menu.

| On | Entries |
|---|---|
| the model | *Rename model…*, *Model settings…*, *New diagram view*, *New catalog view*, *New matrix view* |
| the *Views* group | *New diagram view*, *New catalog view*, *New matrix view*, *New folder…* |
| the *Elements* group | *New element…*, *New folder…* |
| the *Relationships* group | *New folder…* |
| a folder | of views: *New diagram view*, *New catalog view*, *New matrix view*; of elements: *New element…*; then *New folder…*, *Rename…*, *Move to folder…*, *Delete folder (keeps its contents)* |
| an element type, under *Elements* | *New ‹type›…*: *New Business Actor…* on **Business Actor** |
| a view | *Open*, *Open beside* ([Two views at once](models-and-views.md#split-view)), *Select on canvas* (when the open diagram references it), *Reference in the open view* (while another view, a diagram, is open), *Rename…*, *Set viewpoint…*, *Duplicate*, *Move to folder…*, *Delete view (keeps its elements)* |
| an element | *Select on canvas* (when the open view shows it) or *Add to current view*, *Rename…*, *Copy*, *Move to folder…*, *Delete from model…* |
| a relationship | *Select on canvas* or *Add to current view*, *Confirm — state it in the model* (a potential derivation), *Show source*, *Show target*, *Rename…*, *Copy*, *Move to folder…*, *Delete from model…* |
| one of several selected | *Copy 2 elements* (or relationships), and *Move 2 elements to folder…* when the model has folders |

*Copy* copies elements and relationships to paste into a diagram — with, from several elements, the
relationships between them — and la-gram says *Copied 2 elements: paste into a diagram to place them.*;
++ctrl+c++ (++cmd+c++) does the same for the rows selected. A derived relationship the model does not state
is not copied. See [Copy and paste](canvas.md#copy-and-paste). *Move to folder…* is offered once the model has a folder. *Add to current view* places the element on the
open diagram; a relationship, when both its ends are there. *Reference in the open view* makes a [view
reference](canvas.md#view-references) to the view in the middle of the open diagram.

1. Open "Who is who", then right-click "Gift wrapping" under *Elements*.
2. Choose *Add to current view*: la-gram says *Open a diagram view to place it in.*, as a catalog is not
   one. Open the diagram and choose *Select on canvas* instead.

## Folders {#folders}

A model's folders are its own, saved with it (`arch:Folder`), and each group has its own: a folder of
views holds views, a folder of elements holds elements.

| Entry | Dialog | Does |
|---|---|---|
| *New folder…*, on a group or in a folder | *New folder*, *Name* (**New folder**) | makes a folder there |
| *Rename…*, on a folder | *Rename folder*, *Name* | renames it |
| *Delete folder (keeps its contents)* | *Delete folder*: *What it holds stays in the model and moves to* the folder above, or *up to the top of its group* | deletes the folder only |

Every folder change is one undoable step.

1. Right-click *Elements*, and choose *New folder…*.
2. Name it "Applications", and choose *OK*.
3. Right-click "Applications", and choose *New folder…* again: "Payments platform", inside it.

## New views and elements {#new-views-and-elements}

Make a view or an element where it belongs: right-click its folder, or its group.

| Entry | On | Asks | Makes |
|---|---|---|---|
| *New diagram view*, *New catalog view*, *New matrix view* | *Views*, or a folder of views | *Name* (**New diagram**, **New catalog**, **New matrix**), then the *Viewpoint* (**— none —**), as [New view](models-and-views.md#new-view) does | the view, in the folder, and opens it |
| *New element…* | *Elements*, or a folder of elements | *New element*: the element types of the loaded metamodels, under the palette's groups, with *Filter…*; then *Name* (**the type's name**) | the element, in the folder, in no view |
| *New ‹type›…* | an element type's row | *Name* (**the type's name**) | the element, of that type, in no folder |

Made from a group, a view or an element is in no folder. A new element is selected in the tree, its
folder unfolded, and shown in the Properties tab: drag its row onto a diagram to draw it there. Making it
and filing it are one undoable step. The *Relationships* group makes nothing new: draw a relationship
between its two elements on a diagram.

1. Right-click "Applications" under *Elements*, and choose *New element…*.
2. Type "app comp" in *Filter…*, choose **Application Component**, and *OK*.
3. Name it "Fraud check", and choose *OK*: "Fraud check" is in "Applications", selected, with no dot.
4. Drag it onto the diagram.

## Move to folder {#move-to-folder}

*Move to folder…* files a view, an element, a relationship or a folder. Its dialog, *Move to folder*,
lists the group's folders, each with the folders it is in (*in Applications ▸ Payments platform*):

| Entry | Puts it |
|---|---|
| **— No folder —** | directly under the group, out of its folders |
| *Recent* | the last five folders you moved into, in this session, first |
| *All folders* | every folder of the group, by path |
| *— At the top of Elements —* | for a folder: at the top of its group |

A list of more than ten entries has *Filter…* over it, which keeps the entries whose name or path has
every word you type.

Several at once: select them in the tree (++ctrl++-, ++cmd++- or ++shift++-click), or on the canvas, and
right-click one: the menu has *Move 3 elements to folder…* alone. Rows dragged onto a folder move into
it, the selection with them; dragged onto a group, out of their folders. ++esc++ cancels a drag.

1. Click "Payments", and ++shift++-click "Web shop", under *Elements*.
2. Right-click one of them, and choose *Move 2 elements to folder…*.
3. Choose "Payments platform", and *OK*.
4. Drag "Card payment" onto "Applications": it moves there.

## Derived relationships {#derived-relationships}

A derivation rule concludes relationships from others, as ArchiMate's derivation rules do. la-gram does
not run the rules; it shows what a model's file brings, under *Derived relationships*:

| Under | Is | On hover |
|---|---|---|
| *Valid* | a derivation that holds: its direct triple is asserted, though nobody stated it | *Derived (valid)*, and the rule |
| *Potential* | a proposition, not asserted until confirmed; its menu has *Confirm — state it in the model* | *Potential derivation, not confirmed*, and the rule |

A derived relationship has no *Rename…* or *Move to folder…*. Confirming a potential one asserts its
triple and the qualified predicate leading to it, and its membership of the model, in one undoable step:
it is then a relationship of the model, filed under *Relationships*, its certainty kept as the record of
the rule that proposed it.

1. Open a model whose file holds derivations, and unfold *Derived relationships › Potential*.
2. Right-click one, and choose *Confirm — state it in the model*.
3. It is now under *Relationships*, by its type.
