# Drawing order: to the front, to the back

Recorded 2026-11-26, la-gram on `pre-release`. Done the same day, for 0.4.0, on kernel `0.1.5-k02b.1`.

## Goal

A modeller puts a shape behind the elements it frames, or a note on top of what it covers: *Bring to front*, *Bring
forward*, *Send backward*, *Send to back*, for elements and figures that overlap without one holding the other. And
what is on top stays on top after a save, a load, a merge, in a collaborator's window and in any other tool.

Today nothing records it. la-gram draws a view's nodes in the order the store gives them — by IRI hash, so
effectively at random — and a moved shape goes on top until the next reload.

## What was decided

Decision confirmed on 2026-11-26:

1. **Stored in core-vis**: `arch-vis:zOrder`, an integer on a node, its drawing order among the nodes drawn in the
   same place — the view's top level, or the inside of one container — the higher above; absent, 0; the same, by IRI
   (code point order). A nested node stays above its container; lines stay above every shape. linked-archi-meta's
   DD-45; core-vis 0.10, core-vis-shapes 0.6.0.
2. **In 0.4.0**, which ships the K02b kernel: `0.1.5-k02b.1`, the K02b candidate with drawing order, in la-gram and
   the workspace. (First recorded as after 0.4.0; changed when 0.4.0 took the K02b kernel.)
3. **All four**: *Bring to front*, *Bring forward*, *Send backward*, *Send to back*. A step goes past the next shape
   the selected one overlaps.
4. **Two ways in**: the right-click menu on an element or a figure, one or several selected, and the canvas toolbar
   (a button with its menu, as *Line shape*); with keys.
5. **A move no longer brings a shape to the top**: what is drawn is what is saved.

## Where it stands

- **meta**, done 2026-11-26: core-vis 0.10, core-vis-shapes 0.6.0, DD-45, the ontology reference, the diagram example
  (`linked-archi-meta/.agents/tasks/drawing-order/`).
- **kernel**, done 2026-11-26: the assets, `NodeInfo.zOrder`, `setNodeZOrder`, copies and merges
  keep it, `drawing-order.ts` (`compareDrawingOrder`, `sortByDrawingOrder`, `reorder`) — its `tasks.md`, *Drawing
  order*.
- **kernel package** `0.1.5-k02b.1` (2026-11-26), pinned in la-gram and the workspace.
- **la-gram**: done 2026-11-26 — `tasks.md` here; la-gram's Req 22.11, 22.12, 13.1 and key design decision 46.

## Files

- `requirements.md`: what la-gram does (DO-n).
- `design.md`: how, and the choices made (DO-DD-n).
- `tasks.md`: the checklist.
