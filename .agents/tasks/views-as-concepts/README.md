# Views as model concepts on a diagram (VC)

Recorded 2026-11-21. **Done** (2026-11-21; Has Part by nesting, 2026-11-22): la-gram's Req 3.23, DD-42 and change
log say what it does now; the core notation waits to be published with linked-archi-meta. Files here: `requirements.md` (VC-n), `design.md` (VC-DD-n)
and `tasks.md`, the checklist.

## Goal

A view is a model concept, as an element and a relationship are: a view reference on a diagram is the view's
placement there, as an element's box is the element's. Dropping a view into another view, nesting it in an
element and linking an element or a relationship to it are each said in the model's semantic graph and drawn in the
geometry, and the panels' *Analysis* and *Appears in views* show them. An element or a relationship that a view
refines can be zoomed into from the canvas, whether or not a reference to that view is drawn.

The view-references task (`../view-references/`, Req 3.23, DD-42) made the reference a figure that points at a view:
drawing first. Its `arch:inView` presence was right; treating it as drawing — no relationship ends on it (VR-6), the
panel shows a figure, nesting it means nothing — was not what was meant. This task turns it the other way round.

## Decisions (confirmed 2026-11-21)

1. **Selecting a reference shows the view** — its name, type, viewpoint, properties, *Analysis* and *Appears in
   views* — with the reference's own look and its *Text* and *Opens*. **F2 renames the view**, as it renames an
   element; the reference's own text, which may be empty, is edited in *Text* only.
2. **Linking an element or a relationship to a view draws a relationship**: the core's Association, Has Part and
   Refines, offered as for two concepts no loaded language relates (Req 4.21). The reference's pad offers *Connect*,
   not *Draw a line to…*; a note's line to a reference stays drawing.
3. **Nesting a view in an element asks what the nesting stands for**, as nesting an element does. The answer comes
   from the notation, as for elements: a **core notation in linked-archi-meta** says Refines may be drawn by nesting
   the refining view inside. *2026-11-22:* it describes all three of the core's types now, and Has Part may be drawn
   by nesting too, the part inside the whole: a view nested in an element is offered Has Part, then Refines.
4. **Zoom in** on the pad and in the right-click menu of any element or relationship a view refines (`V arch:refines
   X`, or `X arch:refinedInto V` read from a file), whether or not a reference is drawn: it opens the view, or lists
   them when several do.
5. **Deleting a view deletes the relationships that end on it**, as deleting an element does, and the confirmation
   says so.

## Where the work is

- **linked-archi-meta**: `core/core-notation.ttl` (new), its registrations and guides; published by the user.
- **la-gram**: `src/model-manager/view-manager.ts`, `interfaces.ts`; `src/metamodel-manager/bundled-assets.ts`,
  `notation-resolver.ts`; `src/ui/canvas/` (`diagram-canvas.ts`, `rdf-rule-provider.ts`, `rdf-modeling.ts`,
  `rdf-label-editing.ts`, `rdf-context-pad-provider.ts`, `nesting.ts`, a zoom menu); `src/ui/mount-ui.ts`,
  `src/ui/panels/property-panel.ts`, `model-explorer.ts`; `assets/core/core-notation.ttl` (synced from the checkout).
- **linked-archi-kernel**: the same model-manager and metamodel-manager files, file for file, and the asset; its
  change log. It has no Git; its checks are `npm run typecheck` and `npm test`.
- **Rules**: describe behaviour, never by comparison with another tool. Do not commit, stage or push.
- **Checks (la-gram)**: `npm run typecheck`, `npm test`, `npm run test:browser:build`, `npm run build`,
  `npm run docs:build`.
