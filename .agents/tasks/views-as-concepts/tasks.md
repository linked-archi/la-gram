# Views as model concepts — tasks

Recorded 2026-11-21. **Done** (2026-11-21). Criteria refer to [requirements.md](requirements.md); the choices are in
[design.md](design.md).

## Before

- [x] Goal, decisions, requirements (VC-1–11), design (VC-DD-1–8) (2026-11-21).
- [x] The task folder visible to Git (`.gitignore`); listed under *Queued next*.

## The model manager, both copies (VC-DD-1, VC-DD-6, VC-DD-7)

- [x] A reference node's concept is its view: `conceptOf`, `nodeIrisFor`, `placedIn`, `viewsContaining`
- [x] `collectViewQuads` takes the view's relationships — and a concept's `arch:refinedInto` it;
  `setReferenceViewQuads` takes the old view's lines
- [x] `viewsRefining`
- [x] Tests — *view-manager.test*, *clipboard.test* (VC-11); the kernel copy and its change log

## The core notation (VC-DD-5)

- [x] linked-archi-meta: `core/core-notation.ttl` (`archnot:`, 0.1.0); docgen index, `_redirects`, `llms.txt`,
  `llms-full.txt`, the core-vis SHACL profile; DD-42, the ontology reference, the visual notation guide (2026-11-21)
- [x] la-gram and the kernel: the asset (byte-identical, `sync-assets --check`), `coreNotation` loaded with the core,
  `coreNotationSetIris` the last fallback layer, never the active set — *bundled-assets.test, palette-generator.test*
- [x] Nesting needs no change: the palette's relationship types carry the core's (`core`, hidden from the palette panel
  only), so Refines comes with its `nestedEnds` (2026-11-21)

## The canvas (VC-1–6, VC-9)

- [x] References indexed under their node and their view; `conceptIriOf` (`view-reference.ts`); the view's class as
  their type; `nodeIri` their own node
- [x] Rules and connect: relationships to and from a reference, connectors only from drawing —
  *rdf-rule-provider.test, view-canvas.test*
- [x] Placed, its relationships drawn; nested, what it stands for — *view-canvas.test*
- [x] F2 renames the view (*rdf-label-editing.test*); the pad's *Connect*, *Delete view from model…*, *Zoom in*
  (`zoom-in.ts`); the right-click menu

## The panels and the app (VC-1, VC-2, VC-7, VC-10)

- [x] Selection maps a reference to its view; the panel's reference rows write the reference —
  *property-panel.test*
- [x] The delete-view confirmation counts relationships; a view row's placed dot and *Select on canvas* —
  *model-explorer.test*
- [x] Zoom in opens the view, Back comes back — *workbench.test*; a line drawn from an element to a reference —
  *workbench.spec*

## Finishing

- [x] Req 3.23 (VR-6 replaced), 2.16, 4.21, 11.9, the tree's View menu; DD-42 and the notation lookup; the change log,
  Known limitations; README; the guide's pages
- [x] Checks: `npm run typecheck`, `npm test`, `npm run test:browser:build`, `npm run build`, `npm run docs:build`;
  the kernel's
