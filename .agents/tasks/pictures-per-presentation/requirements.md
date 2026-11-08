# Requirements — pictures and looks per presentation context

Terms: a **presentation context** is an audience a metamodel names (`arch:presentationContextScheme`); the toolbar's
*Presentation* chooses one, or none. A **placement** is an element's node in a view. "For every context" means
without `arch:inPresentationContext`.

## R1 — An element's pictures (vocabulary: core 0.5.0)

1. An element's canonical picture is `arch:prefVisNotation`; a picture for one audience is an `arch:altVisNotation`
   whose value is a `schema:ImageObject` with exactly one `schema:contentUrl` (an `xsd:anyURI`: an http(s) URL or a
   `data:image/…` URI) and `arch:inPresentationContext`. An `arch:altVisNotation` without a context is an
   alternative for no particular audience.
2. A value of either property may be the image's own IRI (as published notations write it) or an ImageObject with
   `schema:contentUrl`; readers accept both.
3. `arch:prefVisNotation` and `arch:altVisNotation` say where they apply with `arch:domainIncludes` (concepts,
   model concepts, visual notations), not `rdfs:domain skos:Concept`.
4. `arch:inPresentationContext` may be said of a `schema:ImageObject` and of an `arch-vis:Style`, as of a
   `skosxl:Label` and an `arch-vis:LabelExpression`.
5. Core shapes check: an ImageObject has at most one context and at most one `schema:contentUrl`; one with a context
   has exactly one `schema:contentUrl`; a `prefVisNotation` value has no context; an element has at most one picture
   per context.

## R2 — A placement's look per context (vocabulary: core-vis 0.7)

1. A diagram element may have several styles (`arch-vis:style`): at most one for every context and at most one for
   each context (`arch:inPresentationContext` on the style). `arch-vis:style` is no longer an
   `owl:FunctionalProperty`; core-vis shapes check the "at most one each" rule instead of `sh:maxCount 1`.
2. In a context, a diagram element is drawn with its style for every context overlaid by its style for that context,
   value by value. With no context chosen, the style for every context alone.
3. Data with one style per diagram element — everything written so far — means what it meant.

## R3 — Where an element's picture is drawn (core-vis 0.7)

1. A diagram element drawn as its icon (`arch-vis:IconCentric`, by its notation or its own style) whose element has a
   picture for the context shown — its `arch:altVisNotation` for that context, else its `arch:prefVisNotation` — is
   drawn with that picture as its icon, in place of the notation's glyph, unless its own style names an
   `arch-vis:iconSymbol`.
2. In box-with-badge mode the badge stays the notation's glyph (it says the element's type).

## R4 — la-gram: the Image tab per context

1. The Image tab says which presentation its changes are for: "for *Developer / Engineering* — the presentation
   chosen now", or "in every presentation", with *The same in every presentation* to switch, as the Label tab does;
   with no presentation chosen, it edits the look for every presentation only.
2. For the scope shown it sets the picture (address, *Choose file…*, or one of the model's pictures), the position,
   and *Draw it* inside or as the figure, and *Remove image*; each change one undoable step for every one selected.
3. What it writes goes on the placement's style for that context (`{node}-style-{hash of the context}`, typed
   `arch-vis:Style`, with `arch:inPresentationContext`) or on its style for every context (`{node}-style`).
4. The canvas draws each placement with the look for the presentation chosen (R2.2), and again whenever the
   presentation is switched.
5. *Pictures in this model* also lists the elements' own pictures (R1).
6. The Figure tab, picking a figure, writes the style for every context and takes away the shown context's own figure
   and own icon, so the figure picked is what is drawn.

## R5 — la-gram: an element's pictures per presentation

1. *Pictures by presentation*, under *Names by presentation* in the information tab of an element, has a field for
   every presentation and one for every presentation (`arch:prefVisNotation`): an address, or *Choose file…* (kept in
   the model as a `data:` URI, up to 200 KB), or empty to take it away. One undoable step each.
2. It writes an ImageObject named after the element (`{element}-picture` for every presentation,
   `{element}-picture-{hash of the context}` for one), typed `schema:ImageObject`, its `schema:contentUrl` an
   `xsd:anyURI` literal.
3. A placement drawn as its icon shows the element's picture for the presentation chosen (R3).
4. Deleting the element takes its pictures with it (the cascade's owned resources).

## R6 — Documentation and examples

1. Meta: the guide page on names and labels per audience covers pictures and per-context styles, every case with an
   example; DD-34 is extended; `examples/labels-per-presentation.ttl` shows each case and is checked by the core-vis
   validation profile; the ontology reference and the visual notation guide are updated.
2. la-gram: README, `.kiro/specs/la-gram/requirements.md` (Req 3.17 and a new criterion for element pictures),
   `design.md`, and a change-log entry.

## Out of scope for now (recorded as follow-ups in `tasks.md`)

- The Appearance and Figure tabs per context (the mechanism, R2, already allows it).
- Per-context looks for figures (groups, notes, shapes) and lines.
- Converters: the exchange format has no presentation contexts.
