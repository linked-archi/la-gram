---
title: Drawing on the canvas
description: How to place, connect, rename, nest, move and delete elements on la-gram's canvas, with the context pad, the right-click menu, figures and undo.
---
# Drawing on the canvas

The canvas draws the open diagram view. What can be connected, and how, comes from the loaded
metamodels: connect, change type and append offer only what their relationship shapes permit (for
ArchiMate, its relationship tables).

## Tools {#tools}

The canvas toolbar, above the diagram, starts with three tools. A tool lasts for one gesture, then the
canvas is back to selecting.

| Tool | Tooltip | Does |
|---|---|---|
| ↗ | *Connect — click a source element, then a target* | draws a relationship of the type the metamodel ranks first for the two (or the type chosen in the palette) |
| ⬚ | *Lasso select* | drag a rectangle round what to select |
| ✋ | *Pan the canvas* | drag to move the view; dragging the empty canvas does the same |

After them come the format painter (🖌, see [Appearance](appearance.md#format-painter)) and three
switches: *Relationship names*, *Notation only* and *Shapes*.

1. Click ⬚ in the canvas toolbar.
2. Drag a rectangle round "Customer" and "Place order": both are selected.

## Placing elements {#placing-elements}

Elements come from the palette or the model tree:

- **From the palette**, drag an element type onto the canvas, or click it, then click the canvas where
  it goes. The new element is named after its type.
- **From the model tree**, drag an element's row onto the canvas. It is placed (again, if the view
  already shows it), and the relationships the model has between it and what the view shows are drawn
  too.

A relationship type in the palette is placed the same way: click it, then click the source, then the
target.

1. In the palette, click **Business Actor**, then click the canvas: a Business Actor is placed.
2. From the model tree, drag "Card payment" onto an empty part of the canvas: it is placed a second
   time.

## Rename in place {#rename-in-place}

**Double-click** an element's box, or select it and press ++f2++, and type its name: ++enter++ keeps
it, ++esc++ drops it, and undo brings the old one back. A relationship is named the same way on its line:
double-click the line, or its name. A relationship's name emptied is removed. A name is typed in its own
font, where it is drawn.

1. Double-click "Gift wrapping".
2. Type "Gift wrap service", and press ++enter++.
3. Press ++ctrl+z++ (++cmd+z++ on a Mac): the old name is back.

## Connecting {#connecting}

Select an element: its context pad, beside it, has *Connect*. Drag from it to the target, or click it and
then the target. Only the targets the metamodel permits accept the line, and the relationship drawn is
the type it ranks first for the two; *Change relationship type* changes it after. A relationship type
chosen in the palette first is drawn instead, when permitted. A line that is not permitted is refused, and
the message says which types are: *Realization is not permitted from Application Component to Application
Component. Permitted: Aggregation, …*

<figure markdown="span">
  ![Web shop selected on the canvas, with its context pad beside it: delete from view, delete from model, connect, and append.](../assets/screenshots/guide/canvas/context-pad.png)
  <figcaption>An element's context pad.</figcaption>
</figure>

| Pad entry | For |
|---|---|
| *Delete from view* | an element or a relationship: takes it off this view |
| *Delete from model (all views)* | an element or a relationship: see [Delete](#delete) |
| *Connect* | an element: draws a relationship from it |
| *Append element* | an element: a new or related element, connected to it |
| *Change relationship type: Serving* | a relationship: the types permitted between its ends |
| *Draw a line to…* | a group, a note or a shape: a line that is no relationship |
| *Connect these two…* | two elements selected |

1. Select "Payments".
2. Drag from *Connect* in its pad to "Online ordering". An Assignment is drawn: the type ArchiMate 4.0
   ranks first from an Application Component to a Service.
3. To make it a Realization, select the line and choose *Change relationship type* in its pad. To draw a
   Realization at once, click **Realization** in the palette first.

## Append {#append}

*Append element*, in the context pad, opens a menu of what can follow the element, in two tabs:

| Tab | Lists |
|---|---|
| *New element* | the element types a relationship from it may reach, by domain, each with its relationships (*choose: Assignment / Serving / Flow / Triggering*) or the one it would be (*via Influence*) |
| *Existing relationships (N)* | what the element is already related to in the model, to bring into this view |

A new element is placed beside it, connected. When several relationships fit, la-gram asks *Which
relationship?*.

1. Select "Web shop", and choose *Append element* in its pad.
2. Under **Application Domain**, choose **Data Object**.
3. Choose **Access** when asked *Which relationship?*. A Data Object is placed, with the access drawn to
   it.

## Change relationship type {#change-relationship-type}

A selected relationship's pad has *Change relationship type:* and its type (*Change relationship type:
Serving*, say), which opens *Change relationship type*: the types the metamodel permits between its two
ends, each saying why it is allowed. The right-click menu's *Change relationship type…* does the same.
The relationship keeps its identity, its name and its placements.

1. Select the line from "Card payment" to "Web shop".
2. Choose *Change relationship type* in its pad, and pick **Flow**.

## Connect these two {#connect-these-two}

With two elements selected, the pad offers *Connect these two…*, which lists the relationships allowed
between them in both directions (*Customer → Gift wrapping*, then *Gift wrapping → Customer*), each
saying why it is allowed: *always permitted*, *only by derivation* (the relationship tables permit it as
the conclusion of a derivation, not drawn directly), or because the language's metamodel figures draw it.

1. Click "Customer", then ++shift++-click "Online ordering".
2. Choose *Connect these two…* in the pad.
3. Under "Customer → Online ordering", pick **Association**.

## Lines from figures {#lines-from-figures}

A group, a note or a shape (see [Shapes](#shapes)) has *Draw a line to…* in its pad. The line it draws,
dashed, stands for no relationship: a note's to what it is about. Its Appearance tab makes it solid or
dotted and puts an arrowhead, a diamond or a dot at either end
([Line ends](appearance.md#line-ends)). Double-click it to write on it: the text sits at its middle, and
can be dragged elsewhere.

1. Open *Shapes*, and click and place a **Note** beside "Gift wrapping". Double-click it and type
   "Realized by nothing on purpose".
2. Choose *Draw a line to…* in the note's pad, and click "Gift wrapping".

## Nesting {#nesting}

Drop or move an element onto another to draw it inside. The drop asks *Which relationship?* the nesting
stands for: those the notation lets nesting draw and the metamodel permits (composition, aggregation,
assignment…), or **None** (*Only drawn inside: no relationship in the model*). The container grows to
hold what is inside, keeps its name at the top, and moves with it.

While nested, no line runs between the element and its container: the nesting shows it. Moved out, the
relationships the view showed are drawn as lines again. Relationships' lines and names are drawn above
every element, nested ones included.

1. Drag "Web shop" onto "Payments"' empty corner, and drop it.
2. Choose **None** when asked *Which relationship?*. "Web shop" is drawn inside "Payments", with no new
   relationship in the model.
3. Undo to take it out again.

## Reuse a relationship {#reuse-a-relationship}

Drawing a relationship the model already has between the two, but this view does not show, asks first:
*The model already has this relationship*.

| Choice | Does |
|---|---|
| *Use “Its name”*, or *Use the existing Serving* | draws the relationship the model has: one relationship, in both views |
| *New Serving* | makes another relationship of this type between the two |

1. Select the line from "Card payment" to "Web shop", and press ++delete++: it is off the view, still
   in the model.
2. In the palette, click **Serving**, then "Card payment", then "Web shop".
3. Choose *Use the existing* Serving: the model still has one Serving between them, drawn again.

## Relationship names {#relationship-names}

The *Relationship names* switch shows each named relationship's name on its line, at its middle, or near
its source or its target where the line's Appearance tab (or its notation) puts it. It is **off** by
default, remembered in this browser. A relationship without a name shows nothing.

Drag a name to move it: the view keeps where it is, as an `arch-vis:LabelNode`, and it follows its line as
the line moves. Right-click › *Move name back to its place* undoes that. All undoable.

1. Double-click the line from "Web shop" to "Online ordering", type "serves online", and press
   ++enter++.
2. Switch *Relationship names* on: the name is drawn at the line's middle.
3. Drag the name up, out of the way.

## Shapes {#shapes}

The *Shapes* switch opens a second row of figures, drawn with no model element behind them. It is
**closed** by default, remembered in this browser.

| Figure | Drawn as |
|---|---|
| Group | a box with its name in a tab, holding what is put in it |
| Note | a sticky note |
| Rectangle, Rounded rectangle, Ellipse, Circle, Diamond, Hexagon, Octagon, Parallelogram | that shape |

Drag one onto the diagram, or click it and place it. Figures are renamed, moved, resized and deleted as
elements are; selected, the Properties tab gives their text, and their look in the Appearance tab.
A figure that sets no colours of its own is drawn neutral: a group light grey, a shape white, **a note
yellow**. An ArchiMate Exchange file's groups, notes and the lines from them import as these.

1. Click *Shapes* above the canvas.
2. Drag **Rounded rectangle** onto the diagram, double-click it and type "Checkout".

## Move, resize and bend {#move-resize-bend}

Drag an element to move it, with its lines; a selection moves together. Drag a selected element's corner
handles to resize it. Drag a line's segment to add a bendpoint, and a bendpoint to move it. A move snaps
to line up with the elements around it.

1. Drag "Gift wrapping" a little to the right: its line follows.
2. Select it and drag its bottom right handle to make it wider.
3. Drag the middle of its line to "Customer" sideways: the line bends.

## Placed twice {#placed-twice}

As ArchiMate allows, an element can be placed more than once on a view: drag it from the model tree onto
a view that already shows it. Each placement moves, nests and is deleted on its own, and lines join the
placements they were drawn between; a relationship can be drawn again from another placement. Clicking
one placement **selects every placement** of the element.

1. Drag "Customer" from the model tree onto the diagram, apart from the one there.
2. Click either: both are selected.

## Copy and paste {#copy-and-paste}

Copy what is selected on a diagram — elements, groups, notes and shapes, with what is nested in them and
the lines between them — and paste it into this view, another view, or another model. A line goes with
its two ends: a relationship with only one end selected is not copied.

| Keys (Windows and Linux / macOS) | Right-click menu | Does |
|---|---|---|
| ++ctrl+c++ / ++cmd+c++ | *Copy* | copies the selection |
| ++ctrl+x++ / ++cmd+x++ | *Cut* | copies it, then deletes it from the view; the model keeps it |
| ++ctrl+v++ / ++cmd+v++ | *Paste* | pastes by where it goes (below) |
| ++ctrl+shift+v++ / ++shift+cmd+v++ | *Paste as copies* | always makes new elements and relationships |
| ++ctrl+alt+v++ / ++alt+cmd+v++ | *Paste as references* | always places the same elements again |
| ++ctrl+d++ / ++cmd+d++ | *Duplicate* | pastes the selection as copies into this view, 20 px right and down; the clipboard keeps what it held |

*Paste* decides by where it goes:

| Pasted into | Is |
|---|---|
| another view of the model it was copied from | **the same elements and relationships, placed again**: nothing new in the model |
| the view it was copied from | **copies**: new elements and relationships |
| another model | **copies**, always — *Paste as references* says so and makes copies |

- **A copy** is a new element or relationship of the same type, with the original's names, in every
  language, and its definition. Its other properties are left out, and la-gram says how many. In the
  model it was copied from, a copy goes into the original's folder.
- **A reference** is the element itself, placed again: pasted into the view it came from, the element is
  placed a second time ([Placed twice](#placed-twice)). One deleted from the model since it was copied is
  pasted as a copy, and la-gram says so.
- **Where:** at the pointer when it is over the diagram; otherwise where it was copied from, 20 px right
  and down, and 20 px further for each paste of the same copy. Lines keep their bends and moved names,
  and nesting is kept.
- **Into another model**, la-gram asks about elements of types the model's metamodels do not define:
  *Paste them, unclassified* or *Leave them out*. A relationship the model's rules do not permit between
  its two ends is left out. What was left out is said.
- **What was pasted is selected**, and la-gram says what it did: *Pasted 2 new elements and 1 new
  relationship; 1 property left out.* or *Placed 2 elements and 1 relationship again.* One paste is one
  step to undo.
- **Another window**: ++ctrl+v++ (++cmd+v++) pastes what another la-gram window copied. *Paste as
  copies*, *Paste as references*, *Duplicate* and the menu's *Paste* paste what this window copied last,
  or last pasted.
- **A text editor**: pasting there gives the copy as Turtle.
- **From the model tree**: *Copy* in a row's right-click menu, or ++ctrl+c++ (++cmd+c++) with rows
  selected, copies elements and relationships without their places; pasted into a diagram, they go in
  rows of six at each type's own size ([Model tree › Menus](model-tree.md#menus)).

1. Drag a rectangle round "Customer" and "Place order", and press ++ctrl+c++ (++cmd+c++).
2. Open another diagram view, point at an empty part of it, and press ++ctrl+v++ (++cmd+v++): the same
   two elements are placed there, and la-gram says *Placed 2 elements … again*.
3. Press ++ctrl+d++ (++cmd+d++): two new elements, copies of them, appear beside them.
4. Undo: the copies are gone.

## Delete {#delete}

| From | Does |
|---|---|
| *Delete from view*, or ++delete++ / ++backspace++ | takes the selection off this view; the model keeps it |
| *Delete from model (all views)* in the pad, *Delete from model…* in the right-click menu | removes it from the model and from every view |

Deleting from the model asks first, in *Delete element from model* (or *Delete relationship from model*):
*"Web shop" will be removed from the model and from every view it appears in*, with the views listed and,
for an element, *— and every relationship connected to it*. *Delete from model* confirms. Both are
undoable from the canvas. A figure has *Delete* only: it is in no model.

1. Select "Gift wrapping", and choose *Delete from model (all views)* in its pad.
2. Read the views it is in, and choose *Delete from model*.
3. Undo: it is back, with its relationship.

## Undo and redo {#undo-redo}

↶ and ↷ in the toolbar, or the keys, undo and redo what was done on the canvas, in the Properties tab and
in the model tree: placements, moves, model-level deletes, property edits, folder changes.

=== "Windows and Linux"

    | Keys | Does |
    |---|---|
    | ++ctrl+z++ | undo |
    | ++ctrl+y++ or ++ctrl+shift+z++ | redo |

=== "macOS"

    | Keys | Does |
    |---|---|
    | ++cmd+z++ | undo |
    | ++cmd+y++ or ++shift+cmd+z++ | redo |

The toolbar's tooltips say *Undo (Ctrl+Z)* and *Redo (Ctrl+Y)* on every platform; on a Mac the keys are
++cmd+z++ and ++cmd+y++.

What undo does not cover:

- The undo history belongs to the **open view**: it starts again when another view opens.
- Changes that do not come from the canvas are not on it: a collaborator's edit, an opened or imported
  file, and a model-level delete from the model tree of a concept the open view does not show.

To try it:

1. Move "Customer".
2. Press ++ctrl+z++ (++cmd+z++): it is back where it was.
3. Press ++ctrl+y++ (++cmd+y++): moved again.

## Right-click menu {#right-click-menu}

Right-click on the canvas for what applies to what is under the pointer.

| On | Entries |
|---|---|
| an element | *Rename* (F2), *Change type…*, *Cut*, *Copy*, *Paste*, *Paste as copies*, *Paste as references* (once something is copied), *Duplicate*, *Append…*, *Move to folder…* (when the model has folders), *Properties*, *Show in model tree*, *Show relationship graph*, *Ask about this element…*, *Copy IRI*, *Delete from view*, *Delete from model…* |
| a relationship | *Rename* (F2), *Move name back to its place* (when its name was moved), *Change relationship type…*, *Paste*, *Paste as copies*, *Paste as references* (once something is copied), *Move to folder…*, *Properties*, *Show in model tree*, *Show source*, *Show target*, *Copy IRI*, *Delete from view*, *Delete from model…* |
| a group, a note or a shape | *Cut*, *Copy*, the three pastes (once something is copied), *Duplicate*, and its other entries |
| the empty canvas (the open view) | *Rename view…*, *Set viewpoint…*, *Duplicate view*, *Paste*, *Paste as copies*, *Paste as references* (once something is copied), *Select all*, *Zoom to fit*, *View properties*, *Show in model tree*, *Copy IRI*, *Export view as SVG*, *Export view as PNG*, *Delete view…* |
| one of several selected | elements: *Cut*, *Copy*, the three pastes (once something is copied), *Duplicate*, and *Move 2 elements to folder…* when the model has folders; relationships: the three pastes (once something is copied), and *Move 2 relationships to folder…* when the model has folders |

What the entries do beyond the canvas:

| Entry | Does |
|---|---|
| *Properties*, *View properties* | selects it and opens the Properties tab |
| *Show in model tree* | shows the model tree, and the row, unfolded |
| *Show relationship graph* | opens the Graph tab with it at the centre |
| *Ask about this element…* | opens the SPARQL tab's Questions menu with the questions about it |
| *Copy IRI* | copies its IRI, and says *IRI copied* |
| *Show source*, *Show target* | selects the relationship's end, opening a view that shows it if this one does not |
| *Export view as SVG*, *Export view as PNG* | as [File › Export](files.md#export-svg-png) |

1. Right-click "Gift wrapping", and choose *Ask about this element…*.
2. The SPARQL tab opens, with the questions about "Gift wrapping".
