# Views as model concepts — requirements

Recorded 2026-11-21. VC numbers belong to this task. When it lands, the criteria are added to la-gram's requirements
under Req 3.23, whose VR-6 bullet (no relationship ends on a reference) they replace.

A **reference** is a view's placement on a diagram (core-vis 0.9's `arch-vis:ViewReferenceNode`); its **holder** is
the view it is drawn in, and the view it **opens** is the concept it stands for.

## The reference is the view's placement

- **VC-1 Selected, the view.** A reference selected on the canvas selects the view it opens: the property panel shows
  the view — *View information* (ID, type, name, definition, viewpoint), *Properties*, *Analysis*, *Appears in
  views* — with the reference's look (*Appearance*, *Image*) and, in the information tab, the reference's own *Text*
  and *Opens*. The model tree reveals the view's row. A view selected elsewhere — in the tree, by its link — selects
  the references to it in the open diagram. A view's row carries the *In the open view* dot while the open diagram
  holds a reference to it.
- **VC-2 Its name, and its text.** It shows the view's name, unless it has text of its own (Req 3.23, VR-4, an empty
  one drawing nothing). F2 and the right-click menu's *Rename* rename the view, as they rename an element: every
  reference to it follows, in every view; a view's name is not emptied. Its own text is edited in its *Text*.

## Relationships

- **VC-3 To and from a view.** A relationship may have a view as an end. Connect from an element, a relationship's
  line or a reference, to a reference — or from a reference — draws a relationship of a type the loaded metamodels
  permit between the two; where no loaded language relates them, the core's Association, Has Part and Refines
  (Req 4.21). It is written as any relationship — its resource, its triple — and drawn as a line between the two
  placements (`arch-vis:Link`); it is renamed, retyped, re-pointed, deleted from the view and from the model as any.
  With a relationship type picked in the palette, it is drawn when permitted. A reference's pad offers *Connect*;
  a line from a note, a group or a shape to a reference stands for no relationship, as before (Req 3.13).
- **VC-4 Placed, its relationships drawn.** A reference made (VR-1, VR-2) draws the view's relationships to what is
  placed in the diagram, as placing an element does (Req 3.7). Pasted, it brings the lines copied with it, as a
  pasted element does (VC-11).

## Nesting

- **VC-5 In an element, what the nesting stands for.** A reference made or moved inside an element's box asks what
  the nesting stands for, as an element does (Req 3.12): the relationship types permitted between the two whose
  notation says they may be drawn by nesting with the view inside — the core's *Refines*, by the core notation — then
  *None*. The one picked is made, the view refining the element (`V arch:refines E`), shown by the nesting rather than
  a line, one undoable step; a nesting the model already states asks nothing, and taken out, the relationship is
  drawn as a line. Inside a group or a shape, nothing is asked. *2026-11-22:* the core's *Has Part* is offered too,
  first — the element having the view as a part (`E arch:hasPart V`), the part inside the whole.

## Zoom in

- **VC-6 From what a view refines.** An element or a relationship that a view refines — `V arch:refines X`, or
  `X arch:refinedInto V` — offers *Zoom in* on its pad and in its right-click menu, whether or not a reference to the
  view is drawn: refined by one view, it opens it; by several, a menu lists them by name and opens the one picked.
  Back comes back (Req 11.11).

## Deleting

- **VC-7 A view, with its relationships.** Deleting a view deletes the relationships that have it as an end, in every
  view, as deleting an element deletes its relationships; the confirmation says how many go, with the references to
  it: *Delete the view "Payments"? The elements and relationships it shows stay in the model. 3 references to it, in
  2 other views, and 2 relationships with it are deleted with it.* With another diagram open, undo brings them all
  back (Req 3.23). A reference's *Delete view from model…*, on its pad and in its right-click menu, deletes its view
  so.
- **VC-8 A reference.** *Delete from view* takes it off the view with its lines, the view and its relationships
  staying in the model (VR-9).

## Changing the view it opens

- **VC-9 Its lines go.** *Change…* (VR-8) takes the lines of the relationships of the view it opened off the view;
  lines standing for no relationship stay.

## The panels

- **VC-10 Analysis and Appears in views.** A view's *Analysis* lists its relationships, each end a link, as an
  element's does; its *Appears in views* lists the views presenting it (`arch:inView`). An element's or a
  relationship's *Analysis* lists its relationships with views as any other.

## Everything else, as for a placement

- **VC-11** Undo and redo, collaboration, copy and paste (a relationship to a view pasted in the same model ends on
  that view; into another model, where the view is not, it is left out and the reference is a note), SVG and PNG
  export, the Exchange import (a connection to a `viewRef` label stays a line standing for no relationship).
