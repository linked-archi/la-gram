# Pictures and looks per presentation context

Status: done 2026-11-08 (phases A–F, follow-ups included), released in la-gram 0.2.0 · Repos: `linked-archi-meta` (vocabulary, shapes, docs) and
`tools/modellers/la-gram` (modeller) · Files here: `requirements.md`, `design.md`, `tasks.md` (the checklist —
start there).

## Goal

The Image tab works per presentation context, as the Label tab does: for the presentation chosen in the toolbar, a
placement shows its own picture — inside the figure at a position, or as the figure — or the same in every
presentation. And an element itself may have a picture per audience, model data like its names per audience.

## What was decided with the user (2026-11-08)

1. **Element pictures per audience mirror names per audience.** The canonical picture is `arch:prefVisNotation`;
   one for an audience is an `arch:altVisNotation` whose value is a `schema:ImageObject` with `schema:contentUrl`
   and `arch:inPresentationContext`. (Names: `skos:prefLabel`; `skosxl:altLabel` → `skosxl:Label` with a context.)
2. **The domains of `arch:prefVisNotation` and `arch:altVisNotation` are loosened** from `rdfs:domain skos:Concept`
   to `arch:domainIncludes`, so that giving an element a picture does not make it a SKOS concept.
3. **`arch:inPresentationContext` (core 0.5.0) also scopes a `schema:ImageObject` and an `arch-vis:Style`.**
4. **The goal is the Image tab per context.** How a picture is drawn — inside at a position, or as the figure — is a
   placement's look, so a placement's look must be able to differ per context: a diagram element may have one style
   for every context and one per context (design §2). The user asked that the task, requirements and design be
   written before the work, so another agent can continue.
5. **An element's picture is drawn where the element is drawn as its icon** (`IconCentric`, by its notation or its
   placement), in place of the notation's glyph; in box-with-badge mode the badge keeps showing the type. A placement
   can still show any picture inside or as the figure through the Image tab, per context.

Versions: everything new goes into the versions already open and uncommitted — core 0.5.0, core shapes 0.4.0,
core-vis 0.7, core-vis shapes 0.3.0. The user said earlier changes may stay in 0.7 ("you can leave it at 0.7").

## Rules for whoever continues (the user's standing instructions)

- Never commit, stage, stash or push; `git status` first; never revert changes you did not make.
- Ask questions in plain text in the reply, not with a question tool. Names and namespaces are the user's call:
  anything not decided above or in `design.md`, propose and wait.
- Published docs (`doc/`, literals in published assets) never name `.scripts/` or `.reference/` paths.
- Run meta's documentation generator only on a scratch copy of meta, never in the repository.
- Protected: `tools/modellers/excalidraw-linked-archi-yjs-demo`, `linked-archi-meta/.agents/tasks/notation-order-followup/`.
- Finish each la-gram change with tests, docs (README, `.agents/specs/la-gram/` requirements, design, the change log in
  `tasks.md`), `npm run build`, and tell the user to reload.
- Describe behaviour as a requirement, never by comparison with another tool ("as Archi does").
- la-gram's bundled meta assets are refreshed from a scratch copy of meta: `rsync -a --exclude .git --exclude
  .onto-docs linked-archi-meta/ <scratch>/meta/`, then `npm run sync-assets -- --meta <scratch>/meta`. When a
  version or a date in an ontology header changes, regenerate the catalogue first by running the documentation
  generator in the scratch copy (it writes `.onto-docs/catalog.ttl`, which `sync-assets` copies).

## Where things are

- Names per audience, label expressions: `la-gram/src/model-manager/context-names.ts`, `label-expression.ts`;
  meta `doc/guide/names-and-labels-per-audience.md`, DD-34 in `doc/guide/design-decisions.md`,
  `examples/labels-per-presentation.ttl`.
- A placement's own style: `la-gram/src/model-manager/view-manager.ts` (`setAppearance`, `ownStyle`,
  `appearanceOf`, `readNode`), `src/model-manager/appearance.ts`, the canvas `src/ui/canvas/diagram-canvas.ts`
  (`syncFromStore`, `restyle`, `selectedAppearance`, `refreshLabelTexts`), the renderer
  `src/ui/canvas/rdf-renderer.ts`, the panel `src/ui/panels/property-panel.ts` (`_renderImage`, `_renderLabelTab`),
  wiring `src/ui/mount-ui.ts`.
- The cascade on delete: `la-gram/src/model-manager/cascade.ts` (`ownedQuads`).
