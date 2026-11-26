# Line shape: one line routed as chosen

Recorded 2026-11-26, la-gram at `17f1d63` (`pre-release`). For 0.4.0.

## Goal

A modeller tidies one line, or a few, without arranging the rest of the view. *Arrange relationships* routes every
line of the selected elements, or of the whole view; with only a line selected, it routes the whole view. A line can
be bent by hand, one bend at a time, but not given a shape in one step.

*Line shape* gives the selected lines one of four shapes, each one undoable step:

1. **Straight**: the bends removed; centre to centre, cropped at the outlines, as a new line is drawn.
2. **Right angles**: routed by la-gram's router, around the elements in its way, as *Arrange relationships* routes
   it, while the view's other lines stay where they are and are avoided.
3. **Horizontal first**: one bend; out of its source sideways, into its target from above or below.
4. **Vertical first**: one bend; out of its source upwards or downwards, into its target from the side.

## What was decided

Decision confirmed on 2026-11-26:

1. **A route, set once, for 0.4.0.** A shape is written as the line's route, its `arch-vis:points`, as a bend
   dragged by hand is. Nothing new is stored: every tool that reads core-vis, and every earlier la-gram, draws the
   line as it was shaped. A right-angled line already stays right-angled when an element moves (Req 4.6).
2. **The four shapes above.** Not offered: isometric lines, entity-relation lines.
3. **Two ways in:** a *Line shape* button in the canvas toolbar, with its menu (enabled when a line is selected), and
   the line's right-click menu, for one line or several selected.
4. **Later, with the core update: a shape the line keeps, and curved lines.** Not in 0.4.0. See *Later* below.

Also: *Arrange relationships* with lines selected routes those lines too, and the lines it does not route stay where
they are and are avoided. Before, with only a line selected, it routed every line of the view.

## Later: a shape the line keeps, and curved lines

Recorded 2026-11-26, not started. A release after 0.4.0, with the next core-vis and kernel.

- **What:** a line's shape as a property of the line, not only its route. A line set to *Right angles* is routed
  again whenever an element it touches moves, or one moves into its way. A line set to *Curved* is drawn as a curve
  through its bends. Other tools keep reading the route, which la-gram writes as before.
- **Why it waits:** core-vis has no term for it. A line's style (`arch-vis:Style`) has `lineStyle`, `lineColor`,
  `lineWidth`, `sourceDecor`, `targetDecor` and `labelAnchor`, but nothing that says how a line is routed. A term goes
  into meta's core-vis first, then into the kernel's bundled assets, then into la-gram. To decide: the term's name
  and its values; whether a relationship type's notation may set it as a default.
- **What it changes in la-gram:** the *Line shape* menu sets the property as well as the route; the *Appearance*
  tab shows it for a line; the canvas draws a curved line as a curve; moving an element routes its kept-shape
  lines again in the same undoable step; the copy, the merge (one value per line) and the exports carry it.

## Files

- `requirements.md`: what *Line shape* does (LS-n).
- `design.md`: how it works, and the choices made (LS-DD-n).
- `tasks.md`: the checklist, and where it stopped.
