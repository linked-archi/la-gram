# Design: drawing order

## How it will work

- **Drawing.** `DiagramCanvas.syncFromStore` adds a container's shapes in drawing order (`sortByDrawingOrder` over the
  nodes with the same `parentNodeIri`), containers before their contents, as now. A change to zOrders re-stacks the
  graphics of that parent's shape children — the canvas re-stacks a parent's children already after a change (*After
  a change, diagram-js re-stacks…*). Lines stay at the root, after every shape (`rdf-ordering.ts`).
- **Ordering on a move.** `RdfOrdering.getOrdering` puts a moved shape at its drawing-order position among its new
  parent's shapes, not last; a shape taken into another parent gets DO-4's zOrder first.
- **The four.** `DiagramCanvas.reorderSelection` collects the selected elements and figures, less what is in a
  selected container and what a collaborator holds, groups them by parent, asks `reorder(siblings, moving, change)`
  for each group, and writes the changes with `recordChange` — `ViewManager.setNodeZOrder` for each — after which
  the canvas syncs from the store and re-stacks: one undo step, one change for collaborators.
- **New placements.** Where the canvas adds a node — `shape.create` (palette, tree, *Append*), after its node and
  container are written, and paste or *Duplicate* inside their recorded change — DO-4's zOrder is written in the same
  step (`inFront`): to the front of its place where it is drawn below one it overlaps; none where it is not.
- **Import.** `import-export/archimate-importer.ts` gives each node of a place its index in the file as zOrder (the
  first none) where any two nodes of that place overlap, and writes nothing for a place where none do.

## Key design decisions

**DO-DD-1. Values only where they matter.** A node gets a zOrder when it is reordered, or when it is placed over
another; most nodes of most diagrams never do. Fewer triples, smaller diffs, fewer merge conflicts; the IRI order
draws the rest the same in every tool.

**DO-DD-2. A step goes past the next shape it overlaps** (the kernel's `reorder`). Order only shows between shapes that
overlap: a step past one it does not overlap would change nothing on screen. No other two overlapping shapes change
places, so a step never surprises elsewhere in the diagram.

**DO-DD-3. Moving keeps the order.** A shape that came to the top on every move would be drawn otherwise after a
reload, because the move wrote nothing. Keeping the order on a move makes what is drawn what is saved; putting a
shape on top is *Bring to front*.

**DO-DD-4. Keys as other drawing tools have them.** Ctrl/⌘+[ and ] with Shift for the ends. ⌘[ and ⌘] are a Mac
browser's back and forward: taken from the browser only while the canvas has the focus, as Ctrl+Z is.
