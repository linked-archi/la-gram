# Design — pictures and looks per presentation context

One pattern runs through every audience-specific thing: **several values, each for one presentation context
(`arch:inPresentationContext`) or — without it — for every context, at most one per context.** Names (SKOS-XL
labels), label expressions, and now pictures (ImageObjects) and a placement's styles follow it.

## 1. Vocabulary — core 0.5.0 (`core/core-onto.ttl`)

```turtle
ex:paymentGateway
    arch:prefVisNotation ex:paymentGateway-picture ;                 # for every audience
    arch:altVisNotation  ex:paymentGateway-picture-1a2b3c4d .         # for one
ex:paymentGateway-picture
    a                 schema:ImageObject ;
    schema:contentUrl "https://example.org/pictures/gateway.svg"^^xsd:anyURI .
ex:paymentGateway-picture-1a2b3c4d
    a                          schema:ImageObject ;
    schema:contentUrl          "https://example.org/pictures/card-payments.png"^^xsd:anyURI ;
    arch:inPresentationContext am4pc:ExecutiveContext .
```

- `:prefVisNotation`, `:altVisNotation`: replace `rdfs:domain skos:Concept` with
  `:domainIncludes skos:Concept, :ModelConcept, <https://meta.linked.archi/core-vis#VisualNotation>`; keep their
  `schema:domainIncludes`, `rdfs:range schema:ImageObject`, `rdfs:subPropertyOf schema:image`. `altVisNotation`'s
  definition: the audience form above; its old example ("one per alternative PresentationContext or NotationSet")
  is made concrete. `prefVisNotation`'s: on an element, its own picture; a value may be the image's IRI or an
  ImageObject with `schema:contentUrl`.
- `:inPresentationContext`: `:domainIncludes` adds `schema:ImageObject` and `arch-vis:Style`; definition and
  example extended.
- History note of 0.5.0 extended (no version change: 0.5.0 is not committed).

## 2. Vocabulary — core-vis 0.7 (`core/core-vis-onto.ttl`)

- `arch-vis:style`: drop `owl:FunctionalProperty`; comment: a diagram element has at most one style for every
  context and at most one for each context; in a context the look is the former overlaid by the latter, value by
  value.

  ```turtle
  ex:gatewayNode arch-vis:style ex:gatewayNode-style, ex:gatewayNode-style-5e6f7a8b .
  ex:gatewayNode-style
      a arch-vis:Style ; arch-vis:fillColor "#b5c9ff" .
  ex:gatewayNode-style-5e6f7a8b
      a                          arch-vis:Style ;
      arch:inPresentationContext am4pc:ExecutiveContext ;
      arch-vis:iconSymbol        "https://example.org/pictures/card-payments.png"^^xsd:anyURI ;
      arch-vis:renderingMode     arch-vis:IconCentric .
  ```
- `arch-vis:IconCentric` (scope note) and `arch-vis:iconSymbol` (comment): an element's own picture (R3) is the icon
  of a diagram element drawn as its icon, unless the diagram element's own style names one.
- History note of 0.7 extended.

**Rejected:** a single `arch-vis:style` with per-context overrides hung under it (`arch-vis:contextStyle`, say). It
would keep the old cardinality, but needs a new term and is a second shape of the same idea; with several styles
each optionally for a context, styles follow the pattern of names, label expressions and pictures. Tools that read
one style keep working on data with one style; la-gram is the only reader of several.

## 3. Shapes

core shapes 0.4.0 (`core/core-shapes.ttl`), section "NAMES PER PRESENTATION CONTEXT" → "NAMES AND PICTURES PER
PRESENTATION CONTEXT":
- `:PictureShape` — `sh:targetClass schema:ImageObject`, `sh:targetObjectsOf arch:altVisNotation`: at most one
  `schema:contentUrl` (`xsd:anyURI`), at most one `arch:inPresentationContext` (IRI).
- `:PictureForAudienceShape` — SPARQL on subjects of `arch:altVisNotation`: a value with a context has a
  `schema:contentUrl`; at most one value per context.
- `:CanonicalPictureShape` — `sh:targetObjectsOf arch:prefVisNotation`: `arch:inPresentationContext` max 0.
- `sh:declare` adds `schema`.

core-vis shapes 0.3.0 (`core/core-vis-shapes.ttl`): the DiagElement shape's `arch-vis:style` loses `sh:maxCount 1`
(keeps `sh:class arch-vis:Style`); a SPARQL constraint: at most one style without a context, at most one per
context; `StyleShape` gets `arch:inPresentationContext` max 1, IRI.

## 4. Docs and examples (meta)

- `doc/guide/names-and-labels-per-audience.md` → title "Names, Labels and Pictures per Presentation Context" (file
  name kept): sections "Pictures for an audience" (R1, Turtle, SPARQL to read a picture for a context), "A
  placement's look per context" (R2), "Where an element's picture is drawn" (R3); the precedence summary; validation
  table rows. `mkdocs.yml` nav label and `doc/guide/index.md` row updated.
- A new DD-35 (pictures and per-context styles, with the rejected alternatives of §2), rather than extending DD-34:
  DD-34's title — and so the links to it — stay as they were. (Changed while doing A8, 2026-11-08.)
- `examples/labels-per-presentation.ttl`: the gateway gets a canonical and an executive picture; a placement gets a
  style for executives drawing the picture as the figure; the comments give what each context shows.
- `doc/guide/ontology-reference.md`, `doc/guide/visual-notation-guide.md`: one line each.

## 5. la-gram

### 5.1 Pictures of an element — `src/model-manager/element-pictures.ts` (new; the twin of `context-names.ts`)

- `picturesOf(store, iri): ElementPicture[]` — `{ context?: string; url: string; node: string }` for
  `prefVisNotation` (no context) and every `altVisNotation`; a value that is an IRI with no `schema:contentUrl` is
  its own URL; a URL that `imageUri` refuses is skipped.
- `pictureOf(store, iri, context): string | undefined` — the one for `context`, else the `prefVisNotation`.
- `pictureChange(store, iri, context | undefined, url | null): { remove, add }` — the ImageObject for that scope
  (and its link) goes; a new one is `{element}-picture` or `{element}-picture-{shortHash(context)}`, typed
  `schema:ImageObject`, `schema:contentUrl` an `xsd:anyURI` literal, `arch:inPresentationContext` when scoped,
  linked by `prefVisNotation` (no context) or `altVisNotation`.
- Vocabulary (`vocabulary.ts`): `prefVisNotation`, `altVisNotation`, `ImageObject`, `contentUrl` (schema:
  `http://schema.org/`).
- Cascade (`cascade.ts` `ownedQuads`): an element's `prefVisNotation`/`altVisNotation` objects nothing else points
  at go with it.

### 5.2 A placement's styles per context — `view-manager.ts`

- Style IRIs: `{node}-style` (every context, as now), `{node}-style-{shortHash(context)}`.
- `setAppearance(viewIri, iri, changes, context?)` — writes on the style for `context` (created on demand: the
  `arch-vis:style` link, `a arch-vis:Style`, `arch:inPresentationContext`), else on `{node}-style` as now
  (`ownStyle`). When a style has nothing left but its type (and its context), it goes, with its link.
- `ownStyle` must take the style **without** a context when copying a converter's or a shared style (today it takes
  every `arch-vis:style` value and merges them: with several, it must only consider the one without a context).
- `appearanceOf(subject)` reads the style without a context; `contextAppearancesOf(subject)` →
  `Record<context, Appearance>`. `NodeInfo.contextAppearances?` (and `LinkInfo` later).
- `labelExpressionsOf` keeps reading the every-context style's expressions (label expressions already carry their
  own context).
- `duplicateView` copies context styles; `placementQuads` already removes every `arch-vis:style` object (check it
  loops all values: `read(nn(styleIriOf(node)))` reads only `{node}-style` — add the context styles).
- The view cache is cleared on `arch-vis:` writes; a context style is always written with an `arch-vis:` triple, so
  no change is needed — verify with a test.
- `ViewManager` interface: the `context?` parameter, `contextAppearances`.

### 5.3 Canvas — `diagram-canvas.ts`

- The look drawn: `lookFor(node) = { ...node.appearance, ...node.contextAppearances?.[activeContext] }`
  (`activeContext` = `notationStyles.activePresentationContext`). `syncFromStore` puts it in `appearanceToDraw` and
  `restyle`; a context switch (palette update) re-runs it for every placement — extend `refreshLabelTexts` into
  `refreshForContext()` (labels, names, looks, element pictures).
- Element pictures: `RdfBusinessObject.elementPicture?: string` set by the refresh from
  `labelSource.pictureFor?(elementIri)` (mount-ui: `pictureOf(store, iri, app.activePresentationContext())`).
- `selectedAppearance`: `ImageChoices` gains `context?`, `contextLabel?`, `forContext?: ImageScope`,
  `forEvery?: ImageScope` (`ImageScope = { image?, position, asFigure }`); `used` adds the elements' pictures
  (`picturesOf`). `own`/`defaults` for the Appearance tab stay those of the every-context style (follow-up).
- `presentationContextInUse` exists already.

### 5.4 Renderer — `rdf-renderer.ts`

- `drawShape`: when the effective mode is `IconCentric` and the own look has no `iconSymbol`, the icon is
  `businessObject.elementPicture` if set, else the notation's glyph; not recoloured by the icon colour (as an own
  icon). `effectiveMode` must treat an element picture as an icon (so a notation with no glyph but an element with a
  picture can still be drawn as its icon); `drawnMode` and the docking outline stamp include it.

### 5.5 Panel — `property-panel.ts`

- Image tab: the scope line and *The same in every presentation* checkbox as in `_renderLabelTab`
  (`_imageEveryContext` state, reset when the selection changes); every write carries `everyContext`.
- `AppearanceChangeDetail` gains `context?: string | null` (null: every context); `mount-ui`'s
  `onAppearanceChange` passes it to `setAppearance`. Image tab writes: scope chosen → `context`; every → `null`, and
  then the context style's image keys are taken away so the every-context one shows (as the Label tab does).
- Figure tab: writes the every-context style and, when a presentation is chosen, takes away that context's
  `renderingMode`, `shapeType`, `iconSymbol` (R4.6).
- *Pictures by presentation* (`_renderContextPictures`), under *Names by presentation*: one row for every
  presentation, one per context; each an address field, *Choose file…* (reusing `_keepPictureFile`), a thumbnail;
  event `context-picture-change` `{ elementIri, context: string | null, url: string | null }` → `mount-ui` applies
  `pictureChange` in `changeProperties`, then `refreshLabels`.

### 5.6 Tests

- `element-pictures.test.ts`: write, read both forms, replace, remove, scopes, IRIs.
- `view-manager.test.ts`: a context style written, read, merged; emptied goes; copied with the view; removed with
  the node; the converter-style copy ignores context styles.
- `appearance-render.test.ts`: an element picture drawn as the icon in IconCentric, not in badge mode; an own
  `iconSymbol` wins.
- `workbench.test.ts`: the Image tab for a context and for every one; switching context switches the picture;
  Pictures by presentation; validation (core and core-vis shapes accept, and report two pictures for one context);
  the Figure tab clears the context's figure.
- `workbench.spec.ts` (browser): a picture for Executive drawn as the figure when Executive is chosen, inside for
  every presentation.
- `element-manager.test.ts`: the cascade takes the pictures.

## 6. Risks

- Several `arch-vis:style` values: any la-gram code that reads `read(node, visStyle)[0]` assumes one — grep
  `T.visStyle` and decide per use (every-context style vs context style).
- The format painter copies the every-context look only (follow-up).
- Merge: the new resources are named, so the merge matches them.

## 7. Phase F — every look per presentation (R7)

### 7.1 Model
- `readNode` reads `contextAppearances` for figures too (today it skips them); `readLink` reads them for links.
  `duplicateView` copies a link's (as a node's).
- `FigureInfo` stays the figure's look for every presentation.

### 7.2 Canvas
- `lookFor(info)` for nodes and links; figures drawn with `figureFor(node) = { ...node.figure, ...context look }`
  (`syncFigure` compares with `sameAppearance`); lines restyled with their look for the context in the link sync
  and connectors' sync.
- `refreshLabelTexts` (the per-context refresh) also restyles figures and lines: for every shape and connection,
  its node or link (by key), its look for the presentation chosen.
- `selectedAppearance(scope?)`: `scope` `'context' | 'every'` given by the panel (default: computed — R7.1). With
  the context scope: `own` = the context's own look of the first one, `defaults` = its look for every presentation
  over the kind's defaults, `mixed` over the context looks; `figureChoices` marks the figure drawn for the context.
  `AppearanceSelection` gains `scope: 'context' | 'every'`, `contextLabel`, and `hasContextLook` (the first one
  has a style for the presentation chosen) and `hasEveryLook` for the default rule.
- `appearanceOfDrawn` also returns the target's context look (`contextOwn`).

### 7.3 Panel and wiring
- One state `_lookEveryContext` (replacing `_imageEveryContext`) for the Appearance, Figure and Image tabs, reset
  as R7.1; a shared scope bar (`_renderLookScope`) on the three tabs; the panel sends `look-scope-change`
  `{ everyContext }` so `mount-ui` re-reads `selectedAppearance(scope)`.
- `_appearanceChange` in the context scope sends `context`; in the every scope, the Appearance tab sends nothing more
  (R7.2), the Image tab `clearContext` (as now), the Figure tab `clearContext` for figure keys.
- Figure tab in the context scope: options' `changes` computed for the context (R7.3) by `figureChoices(…,
  scope)`.
- Format painter (`paint`): picks `lookFor` of the first; writes with `context` when a presentation is chosen.

### 7.4 Model tree (`model-explorer.ts`)
- A row's icon: the element's picture for the presentation chosen (`pictureOf`), else its type swatch; the explorer
  gets a `pictureOf?(iri)` provider from `mount-ui` and refreshes on `presentation-context-changed` and model
  changes.

### 7.5 Tests
- view-manager: figures' and links' context looks read and copied.
- workbench: Appearance tab per scope (writes, defaults, reset), Figure tab per scope (notation's figure over
  another for every presentation), a note's and a line's look per presentation drawn, the format painter per
  presentation, the shared scope across tabs; the tree icon.
- browser: a colour for executives only.

