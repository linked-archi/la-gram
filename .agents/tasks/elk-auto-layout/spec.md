# la-gram — ELK automatic layout (spec draft)

Status: draft, 2026-11-07 (open questions resolved) · Owner: Kalin · Target: la-gram 0.2

## 1. Problem

la-gram has three layout code paths today, none of them suited to ArchiMate diagrams:

| Where | What it does now | Code |
|---|---|---|
| Opening foreign RDF with no geometry | 6-column grid, sorted by type, fixed 140×60 boxes | `model-session.ts` `autoLayoutIfNoGeometry`, `AUTO_LAYOUT` |
| *Render as new view* (SPARQL / Questions) | Headless Cytoscape `breadthfirst` tree on default-size nodes, then `placeNodes` spreads centres ×1.1 | `mount-ui.ts` `newViewFrom` → `graph-view.ts` `layoutPositions` |
| *Render as new view* from the Graph tab | Keeps the Graph tab's drawn positions ×1.3 | same |
| Existing view | Nothing — no "tidy up" command | — |

Consequences: no layering by direction of flow, nodes ignore their real notation size during layout (sizes are applied after), routes are straight lines that cross through boxes, nesting (composition/assignment shown as containment) is not laid out, and imported models (ArchiMate Exchange without diagrams, CSV/RDF from pipelines) open as an unreadable grid.

## 2. Goals / non-goals

**Goals**
- G1 Layered (Sugiyama) layout with orthogonal routes for generated views, using **ELK** (`elkjs`).
- G2 One layout service used by all three paths above, plus a new **Arrange** command on existing views.
- G3 Real sizes: each node laid out at its notation's default size (`lookStyles.styleFor(type).defaultWidth/Height`) or its current bounds.
- G4 ArchiMate-aware: layers (Strategy/Motivation → Business → Application → Technology → Physical/Implementation) as ordered bands; flow direction configurable.
- G5 Nested nodes laid out hierarchically (children inside parent, parent sized to fit).
- G6 Result written as normal geometry (`arch-vis:ArchNode` bounds + `arch-vis:Link` waypoints) in **one batch** → one undo step, one change for collaborators.
- G7 Off the UI thread; deterministic for the same input (stable diffs in Git).

**Non-goals (v1)**: incremental/interactive layout while dragging; label placement optimisation beyond ELK defaults; layout of catalog/matrix views; force-directed layouts on the canvas (the Graph tab keeps Cytoscape).

## 3. User-facing behaviour

1. **Render as new view** — default algorithm becomes *Layered (ELK)*; the Graph-tab path keeps "as drawn" when all centres are known (current behaviour), with an option to re-layout.
2. **Open model without geometry** — replaces the grid with ELK layered; falls back to the grid if ELK fails or the model has > N elements (N = 2 000, configurable) and the toast says so.
3. **Arrange view…** (canvas toolbar + view right-click menu):
   - Scope: *whole view* or *selection only* (selection: others act as fixed obstacles — v2; v1 lays out the selection as a subgraph and places it at its former top-left).
   - Options dialog (remembered per browser, like other toolbar switches): Direction (Down / Right / Up / Left, default Down), Group by ArchiMate layer (on), Spacing (Compact / Normal / Roomy), Keep routes (off → routes recomputed).
   - One undoable step `rdf.view.arrange`; toast "Arranged N elements, M relationships".
4. Elements outside the view's viewpoint are laid out like the rest (they stay greyed).

## 4. Design

### 4.1 Module layout
```
src/layout/
  layout-service.ts      // public API, picks engine, runs worker, falls back
  elk-graph.ts           // view/plan  ->  ELK JSON graph   (pure, unit-tested)
  elk-result.ts          // ELK result -> Map<iri, Bounds> + Map<linkIri, Point[]>
  archimate-layers.ts    // type -> layer index, from metamodel data
  elk.worker.ts          // elkjs in a Web Worker (bundled build `elkjs/lib/elk-worker.min.js`)
  grid-layout.ts         // existing AUTO_LAYOUT grid, moved here as fallback
```

### 4.2 API
```ts
export interface LayoutInput {
  nodes: Array<{ id: string; width: number; height: number; parent?: string; layer?: number; fixed?: Bounds }>;
  edges: Array<{ id: string; source: string; target: string; kind?: 'nesting' | 'flow' | 'other' }>;
}
export interface LayoutOptions {
  algorithm: 'layered' | 'grid';
  direction: 'DOWN' | 'RIGHT' | 'UP' | 'LEFT';
  groupByLayer: boolean;
  spacing: 'compact' | 'normal' | 'roomy';
  routes: 'orthogonal' | 'none';
}
export interface LayoutResult {
  bounds: Map<string, Bounds>;          // top-left, diagram coordinates
  waypoints: Map<string, Point[]>;     // per edge id, including end points
  engine: 'elk' | 'grid';
  warnings: string[];
}
export function layout(input: LayoutInput, options: LayoutOptions, signal?: AbortSignal): Promise<LayoutResult>;
```
`layoutPositions` (Cytoscape) stays for the Graph tab only. `placeNodes` is retired for diagram views (ELK already returns top-left bounds at real size); keep it for the Graph-tab "as drawn" path.

### 4.3 Mapping to ELK
- Root options: `elk.algorithm=layered`, `elk.direction`, `elk.edgeRouting=ORTHOGONAL`, `elk.hierarchyHandling=INCLUDE_CHILDREN`, `elk.layered.considerModelOrder.strategy=NODES_AND_EDGES` (determinism + respects input order), `elk.randomSeed=1`, spacing presets (`elk.spacing.nodeNode` 30/50/80, `elk.layered.spacing.nodeNodeBetweenLayers` 50/80/120).
- **Layers (G4)**: `elk.partitioning.activate=true`, each node `elk.partitioning.partition = layerIndex`. Layer index comes from the metamodel, not hard-coded: read the SKOS layer/axis classification the palette already uses (`archimate-layers.ts` builds `type → index` from it; unknown → middle partition). Order: Motivation/Strategy 0, Business 1, Application 2, Technology 3, Physical 4, Implementation & Migration 5 (direction DOWN); reversed when the user picks UP.
- **Nesting (G5)**: a placement whose parent is another placement becomes an ELK child node; the nesting relationship itself is **not** passed as an edge (it is shown by containment). Parent padding = notation's `containerLayout` band (so children start below the label band).
- **Edges**: relationships between placed nodes; relationship-to-relationship links (end on another link) are excluded from layout and re-docked by the existing `AttachedConnectionBehavior` afterwards. Edges crossing hierarchy levels are allowed (`INCLUDE_CHILDREN`).
- **Flow edges** (`triggering`, `flow`, `serving`, `realization`) get normal priority; `association` gets `elk.layered.priority.direction=0` so it doesn't drive layering. Which types are which: from metamodel data if available, else this default table in `archimate-layers.ts`.
- **Fixed nodes** (selection-only arrange, v2): `elk.position` + `org.eclipse.elk.noLayout` — not in v1.

### 4.4 Writing the result
`ModelSession.applyLayout(viewIri, result)` inside `this.batch(...)`:
- `views.updateBounds(nodeIri, bounds)` for each node;
- `views.setWaypoints(linkIri, points)` when `routes='orthogonal'`; empty waypoints otherwise (the `CroppingLayouter` then computes the straight route, as today);
- `touch()`, emit `views-changed`; registered on the command stack as `rdf.view.arrange` so undo restores previous bounds and waypoints in one step.
`createViewWith` gains an optional `waypoints` map so *Render as new view* writes routes in the same batch.

Waypoints are written as ELK's start + bends + end: la-gram's routes include their ends (§8 Q2), and the docking service re-crops them against the notation outline.

### 4.5 Worker, size, failure
- elkjs runs in a dedicated worker (same pattern as the SHACL worker); one in flight per view; `AbortSignal` cancels on view close.
- Timeout 10 s → fallback to grid + warning toast.
- Above 2 000 nodes: grid by default, ELK on explicit Arrange with a confirm.
- Electron: worker file must be included in the sandboxed renderer bundle (webpack `new Worker(new URL(...))`), no Node needed.

### 4.6 Determinism
Sort nodes by (layer, type, label, IRI) and edges by IRI before building the ELK graph; fixed `randomSeed`; round coordinates to integers (as `placeNodes` does). Same model ⇒ same geometry ⇒ clean Git diffs and stable `la-gram-git fix` output.

### 4.7 Headless / CLI (optional, v1.1)
Because `layout-service` is DOM-free, expose `la-gram-git layout <file> --view <iri|all-without-geometry>` (elkjs runs in Node without the worker). Useful for pipeline-generated models (VIO / ArchiAtlas imports).

## 5. Dependencies & licensing
- `elkjs` (^0.9/0.10, ~1.5 MB min, lazy-loaded only when layout runs). License **EPL-2.0** — weak copyleft at file level; using it unmodified as a dependency of an Apache-2.0 app is generally fine, but confirm with whoever signs off licences before release and add it to the NOTICE/third-party list.
- No other new dependency. Cytoscape remains for the Graph tab.

## 6. Acceptance criteria
1. Opening an ArchiMate Exchange file without diagrams yields a view where Business elements are above Application above Technology (direction DOWN) and no two nodes overlap.
2. *Render as new view* on a 30-element result produces orthogonal routes with no route passing through a node's interior (checked on bounds).
3. Nested placements: every child's bounds lie inside its parent's bounds minus the label band.
4. Arrange is one undo step; undo restores exact previous bounds and waypoints; collaborators receive one change.
5. Running layout twice on the same input gives byte-identical Turtle.
6. 500 elements / 800 relationships lay out in < 3 s on the benchmark machine, UI stays responsive (no long task > 100 ms on the main thread).
7. Worker failure or timeout falls back to grid with a toast; nothing is half-written.

## 7. Tests
- Unit (vitest): `elk-graph.test` (mapping: partitions, children, excluded nesting edges, sort order), `elk-result.test` (coordinate translation for nested nodes — ELK child coords are relative to parent), `archimate-layers.test` (from bundled 3.2 / 4.0 metamodels).
- Integration: `model-session.test` — adopt foreign data now uses layered layout; `applyLayout` single batch + undo.
- Browser (Playwright, `workbench.spec`): Arrange button → no overlaps, undo; Render as new view from a Question.
- Bench: add `layout` to `npm run bench` at 100 / 500 / 2 000 elements.

## 8. Open questions — resolved from the code (2026-11-07)

1. **Nesting is explicit.** A nested placement has `arch-vis:inNode` pointing at its parent node (`NodeInfo.parentNodeIri`, written in `view-manager.ts`). Bounds are stored **in diagram (absolute) coordinates**, as core-vis gives them, not relative to the parent. ELK's child coordinates are relative to their parent, so `elk-result.ts` must add up the ancestors' offsets before writing. G5 maps directly: `inNode` gives the ELK parent. Containment comes from the data, not from overlapping bounds.
2. **Saved routes include their end points.** `arch-vis:points` is the whole route, an `rdf:List` of `arch-vis:Point`s. The importer writes `[clip(start), …bendpoints, clip(end)]`, and `CroppingLayouter.layoutConnection` treats `route[0]` and the last point as the ends, re-anchoring them, with the middle points as bends. So write ELK's `startPoint + bendPoints + endPoint` as is. Docking re-crops the ends against the real outline (ELK only knows rectangles). An empty route still means "straight, computed".
3. **Layer bands come from the taxonomy, but the axis differs per language.** ArchiMate 3.2 publishes *Element by Layer* and ArchiMate 4.0 *Element by Domain* (both also have *Element by Aspect*). Basic and core publish neither. So `archimate-layers.ts` takes the metamodel's band axis (3.2 → Layer, 4.0 → Domain), ordered by the axis's group order as the palette already resolves it (`taxonomy.ts`, `groupsByAxis`). With no band axis, layer grouping is turned off and the layout stays plain layered. A metamodel could later name its band axis explicitly, which would make EDGY and C4 work without code.
4. **Viewpoints: no special treatment.** Greyed elements are laid out with the rest, because they are in the view and the viewpoint never removes them. Decision for v1.
5. **"Place only the new ones": v2.** Use ELK's interactive layered strategy with fixed nodes (`elk.position`, `noLayout`) for *Add related elements*. Not in v1.

## 9. Plan (estimate)
| Step | Effort |
|---|---|
| `layout-service` + ELK mapping + worker + fallback | 2–3 d |
| ArchiMate layer partitioning from metamodel | 1 d |
| Nested nodes | 1–2 d |
| `applyLayout` / `createViewWith` waypoints, undo, collab | 1 d |
| Wire 3 entry points + Arrange UI/options | 1–2 d |
| Tests, bench, docs (README, tasks.md) | 2 d |
| **Total** | **~8–11 days** |
