# Requirements: line shape

In la-gram's specification: Req 22.9 and 22.10, and the changed Req 22.2.

**LS-1. Which lines.** The selected lines: a relationship's line, or a line from a note or a figure, between two
placements (elements or figures). Not shaped, and kept as they are: a line ending on another line, a line from an
element to itself, and a line another collaborator holds. *Right angles*, *Horizontal first* and *Vertical first*
also keep a line between placements that overlap, or one of which holds the other.

**LS-2. Straight.** The bends removed: the line runs from centre to centre, cropped at the two outlines, as a new
line is drawn (Req 4.6).

**LS-3. Right angles.** The line routed as *Arrange relationships* routes it (Req 22.2): at right angles, around the
elements and figures in its way, with as few bends as they allow. The view's other lines stay where they are; the
line crosses as few of them as it can, docks where none of them docks, and does not run along one where they share
a gap. Several lines selected are routed together, as *Arrange relationships* routes them.

**LS-4. Horizontal first, Vertical first.** One bend, at the corner of the two centres. *Horizontal first* leaves
the source from the side facing the target, at the middle of that side, and enters the target from above or below, at
the middle; *Vertical first* the other way round. Where the two placements are side by side (their heights overlap)
the line is straight and horizontal, and where one is above the other (their widths overlap) straight and vertical:
at the middle of the smaller placement's side where the other's side reaches it, else at the middle of what the two
sides share. The bend does not go around other elements: *Right angles* does.

**LS-5. One step.** Each is one undoable step and one change for collaborators, written to the view as a bent line
is: the line's route (`arch-vis:points`). A line's name moved by hand keeps its place relative to the middle of the
line (Req 4.18).

**LS-6. Said.** How many lines were shaped: "Shaped 2 lines.", or "The line is shaped so already." / "The lines are
shaped so already." Where some were left as they are (LS-1), how many: "Shaped 1 line; 1 left as it is." Where none
could be shaped, why: "The line is left as it is: a line ending on a line or on its own element, between elements
that overlap or hold one another, or held by a collaborator keeps its route."

**LS-7. The toolbar.** A *Line shape* button in the canvas toolbar, after *Arrange relationships*, opens a menu of
the four, each with a picture of its shape. Disabled until a line LS-1 applies to is selected.

**LS-8. The right-click menu.** On a line, the four, in a group of their own. Right-clicking one of several lines
selected keeps them selected — whether or not the model has folders — and the four shape every selected line.

**LS-9. Arrange relationships on a selection.** Routes the selected lines and the lines of the selected placements.
The view's other lines stay where they are and are avoided as LS-3 avoids them. With nothing selected, or the whole
view chosen in its dialog, every line, as before.
