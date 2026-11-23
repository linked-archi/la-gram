# View references — requirements

Recorded 2026-11-21. VR numbers belong to this task. When it lands, the criteria are added to la-gram's
requirements under Req 3.23 (*References to other views*) without renumbering it, and Req 3.23's last sentence —
la-gram does not yet make one, or open its view from it — goes.

A **reference** is a figure standing for another view of the model, the view it **opens** (core-vis 0.9's
`arch-vis:ViewReferenceNode` and `arch-vis:referencesView`; Req 3.23). The **holder** of a reference is the view it
is drawn in.

## Making one

- **VR-1 From the tree, by dragging.** A view's row dragged from the model tree onto the open diagram makes a
  reference to that view where it is let go: on the diagram, or inside the element's box, the group or the shape
  under the pointer (VR-5). One undoable step; the reference is selected. Only diagrams take one: dropped on a
  catalog or a matrix, nothing is made. The open view's own row makes nothing on its own diagram, and a toast says so: "This is the open view: drag it onto another view's diagram to reference it."
- **VR-2 From the tree, by its menu.** A view's right-click menu offers *Reference in the open view* when a diagram
  is open and the view is not that diagram: a reference at the centre of the visible area, selected, one undoable
  step.
- **VR-3 What it is made with.** No text of its own (VR-4), 120 × 55, its colours unset (drawn blue-grey, Req 3.23),
  in the holder's coordinates. The view it opens is then presented in the holder (`arch:inView`), as Req 3.23 says.

## Its text

- **VR-4 The view's name, unless it has its own.** A reference with no `skos:prefLabel` shows the name of the view it
  opens, as that name is now: renaming the view changes every reference to it that has no text of its own, in every
  view, for collaborators too. F2, or *Text* in the property panel, gives it text of its own, its `skos:prefLabel`,
  language-tagged; emptied, it shows the view's name again. The panel's *Text* shows the view's name greyed when it
  has none of its own. A reference read from a file keeps the text it came with.

## Nesting

- **VR-5 Inside an element, a group or a shape.** A reference dropped, moved or made (VR-1) inside an element's box,
  a group or a shape is drawn inside it (`arch-vis:inNode`), moves with it, and comes out when dragged out — as
  any figure (Req 3.12, 3.13). Nothing goes inside a reference: it is not offered as a container to anything
  dropped, moved or pasted.

## Lines

- **VR-6 A line from it, or to it.** A reference's pad offers *Draw a line to…*, and Connect from an element or
  another figure ends on one: a line standing for no relationship (Req 3.13), with its own look (Req 3.15) and text.
  No relationship ends on a reference: with a relationship type picked in the palette, none is drawn from it or to
  it, and a relationship's end is not dropped on one.

## Opening the view it references

- **VR-7 Double-click, the pad, the menu.** Double-clicking a reference opens the view it opens, as does *Open view*
  on its pad and in its right-click menu. Double-click does not edit its text (F2 does, VR-4). A reference whose view
  is not in the model opens nothing and says so in a toast; validation reports it too (core-vis-shapes 0.5.0).

## Changing the view it opens

- **VR-8 *Opens* in the property panel.** A reference selected shows *Opens*: the view's name, *Open* (VR-7) and
  *Change…*, a filterable list of the model's other diagrams, catalogs and matrices; the one chosen becomes the view
  it opens, one undoable step. The view it opened leaves the holder's `arch:inView` with its last reference there,
  and the new one is presented (Req 3.23). Its text of its own, if any, stays.

## Deleting

- **VR-9 A reference.** Deleted as any figure — Delete, its pad, its menu — one undoable step; the view it opens
  leaves the holder with its last reference there (Req 3.23).
- **VR-10 A view others reference.** Deleting a view that references in other views open asks first and says what
  goes with it: "Delete the view "Payments"? The elements and relationships it shows stay in the model. 3
  references to it, in 2 other views, are deleted with it." Undo brings them back (Req 3.23).

## The views' side

- **VR-11 Referenced from.** A view selected in the model tree lists, in its panel, the views that hold a reference
  to it — *Referenced from* — each a link that opens that view; none, and the section is not shown.

## Everything else, as for any figure

- **VR-12** Undo and redo, collaboration (a collaborator's reference appears and follows their changes), copy and
  paste and *Duplicate view* (Req 3.22, 3.23), the Appearance and Image tabs (Req 3.15, 3.17), SVG and PNG export
  (drawn as on the canvas), and the Exchange import (Req 13.4).
