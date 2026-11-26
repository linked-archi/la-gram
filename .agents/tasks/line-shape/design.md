# Design: line shape

## How it runs

`CanvasArrange.shapeLines(shape)` (`src/ui/canvas/canvas-arrange.ts`) takes the selected lines LS-1 applies to,
computes each one's route, and runs the changed ones as `la.arrange.apply`'s routes: `modeling.updateWaypoints` for
each, nested in one command. So a shape is one undo step, written to the store as a bent line is (the canvas's
`connection.updateWaypoints` hook), and a line's moved name follows as it does for any re-route.

- **Straight:** the canvas's layouter (`CroppingLayouter`, `connection-docking.ts`) asked for the line with no route:
  centre to centre, cropped at the outlines by the docking service, each end keeping the centre as its reference. The
  host gives it (`ArrangeHost.straightRoute`).
- **Right angles:** `routeOrthogonal` (`src/layout/orthogonal-router.ts`) with the selected lines as its edges and
  every other line of the view as a kept line (LS-DD-2).
- **Horizontal first, Vertical first:** `elbowRoute` (`src/layout/line-shapes.ts`), pure (LS-DD-3).

## Key design decisions

**LS-DD-1. A route, not a property, for 0.4.0.** The route is what core-vis has (`arch-vis:points`), and what every
tool draws. A property the line keeps needs a core-vis term, so it waits for the next core-vis and kernel (README,
*Later*). Until then a shape is kept by what la-gram already does with a route: a right-angled one stays
right-angled when an element moves (Req 4.6), a straight one with no bends runs centre to centre.

**LS-DD-2. The router takes kept lines.** `routeOrthogonal(nodes, edges, options, kept)`: `kept` are lines already on
the diagram, with their points, which it does not route and never moves. They count as the lines routed before
the edges:

1. **The search** weighs the crossings of their axis-aligned segments as it weighs those of a line it routed
   (diagonal segments are not weighed: the search's segments are horizontal or vertical).
2. **The ends** (`spreadEnds`): a kept line's end on a side is held where it is — a straight one as a straight line's
   is, a bent one in the order of the bent lines as one that cannot move, so that a routed line turning the same way
   docks on the side where neither crosses the other. A routed line on the same point moves off it, and the others
   are placed around it.
3. **The channels** (`centreChannels`): a kept segment holds its place in its gap. A routed segment sharing the gap is
   placed as near the middle as it can be, at least the spacing from each kept one.

With no kept lines, the router does what it did, so *Arrange relationships* on the whole view and *Arrange view*
route as before.

**LS-DD-3. Elbows are one bend, not routed around elements.** One bend at the corner of the two centres is the shape
the modeller asked for. Routing around elements is *Right angles*. Where no corner lies outside both placements (they
are side by side, or one above the other), the line runs straight between them, at a point their facing sides
share: the middle of the smaller one's side where the other's side reaches it, else the middle of what they share,
as the router docks a straight line. Ends on the bounding box, as the router's are.

**LS-DD-4. Arrange relationships on a selection keeps the other lines.** The same kept lines (LS-DD-2): routing the lines
of a few elements no longer docks them on top of, or runs them along, the view's other lines. A line selected is
routed with the lines of the selected elements.

**LS-DD-5. The same four in both menus.** The toolbar's button opens a menu (a picture of each shape and its name),
as the arrange menu beside *Arrange view* opens its dialogs. The right-click menu has the four names in a group of
their own. Both shape the selected lines: right-clicking a line selects it, unless it is one of several selected.
