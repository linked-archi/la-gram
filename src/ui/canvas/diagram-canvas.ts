/**
 * DiagramCanvas — a real diagram-js `Diagram` wired to the RDF model.
 *
 * This is a plain class (NOT a Lit component) because diagram-js manages its own
 * DOM: it is handed a host element and takes over that subtree.
 *
 * ## Direction of data flow
 *
 * The RDF store is the model of record, so element *creation* always flows
 * store → canvas:
 *
 * ```
 * palette drop / palette entry / addElement()
 *   → ElementManager.createElement()      (triples)
 *   → EventBus 'element-created'
 *   → DiagramCanvas.addElement()          (diagram-js shape)
 * ```
 *
 * Layout is the one thing the canvas owns, so it flows the other way: diagram-js
 * command hooks (`shape.move`, `shape.resize`) write bounds back through
 * `ElementManager.updateLayout`. Deletion can start at either end — a
 * `guard` flag keeps a store-initiated removal from deleting the triples twice.
 *
 * Relationships are the exception: a connection is *drawn* by diagram-js's
 * connect tool, and the triples are written in the same command. `RdfModeling`
 * asks the rules which relationship type the pair admits, so the connection is
 * created already carrying it and the triple is asserted by a nested
 * `rdf.relationship.create` command — one undo group, no intermediate typeless
 * state. See `rdf-modeling.ts`.
 *
 * ## Modules
 *
 * The custom modules under `src/ui/canvas/` are registered as follows:
 *
 * - `rdf-renderer` — a didi module (`rdfRendererModule`), because diagram-js has
 *   to construct the renderer itself for it to hook `render.shape`.
 * - `rdf-rule-provider` — likewise (`rdfRulesModule`), so the rules reach the
 *   command stack.
 * - `rdf-modeling` — likewise (`rdfModelingModule`), and *last*, because it
 *   rebinds the `modeling` service the connect tool depends on, plus the
 *   `layouter` and `connectionDocking` services that dock a connection to the
 *   shapes' outlines. diagram-js registers no `connectionDocking` at all and its
 *   `BaseLayouter` runs lines to shape *centres*; bpmn-js supplies the same two
 *   bindings from its own modeling module. See `connection-docking.ts`.
 * - `rdf-context-pad-provider` and `rdf-replace-menu-provider` — registered
 *   against the `contextPad` and `popupMenu` services after boot, which is how
 *   diagram-js expects *providers* (as opposed to services) to be contributed.
 *
 * Note what is *not* in the module list: diagram-js's own `palette`. Its entries
 * would be the metamodel's element types, which is exactly what the sidebar
 * `palette-panel` offers, and two palettes listing the same 42 types is worse
 * than either alone. The three global tools it used to carry now live in
 * `canvas-toolbar` above the diagram; the element types live in the sidebar,
 * which starts its drags through {@link DiagramCanvas.startCreate} and so gets
 * the same `create` gesture the in-canvas palette had.
 *
 * Of diagram-js's own features, note the ones that carry no code here but change
 * behaviour:
 *
 * - `connection-preview` — the line follows the pointer during a connect drag and
 *   a bendpoint move, instead of appearing only on drop.
 * - `snapping` — moves and resizes snap to neighbouring element edges and
 *   centres. Its `CreateMoveSnapping` also listens on `create.*`, so registering
 *   `create` below is what finally gives it something to snap during a sidebar
 *   palette drag or an append drag.
 * - `create` — the drag-to-create gesture: a `createPreview` that follows the
 *   pointer, `shape.create` rule checks against the hovered parent, and on drop
 *   either `modeling.createElements` or — when a `source` hint was given —
 *   `modeling.appendShape`, which is what makes an append produce a shape *and* a
 *   connection in one command. Pulls in `dragging`, `preview-support`, `rules`
 *   and `selection`, all of which were already present.
 * - `auto-place` — positions an appended shape beside its source
 *   (`AutoPlace.append` → `modeling.appendShape`) and selects it
 *   (`AutoPlaceSelectionBehavior`). This is the click half of the append gesture,
 *   where there is no drag to take a position from.
 * - `editor-actions` — named `undo` / `redo` / `zoom` / `stepZoom` /
 *   `removeSelection` actions, registered for whichever services exist.
 * - `keyboard` — binds those actions to Ctrl+Z, Ctrl+Y, Ctrl+±, Delete.
 *
 * Both `create` and `auto-place` end their work in `modeling.appendShape`, whose
 * `postExecute` calls `modeling.connect` — which is {@link RdfModeling}'s
 * override. So the relationship type is still decided by the rules and the triple
 * is still written by the same nested command, exactly as for a hand-drawn
 * connection. Nothing special is needed to make an append RDF-correct beyond
 * minting the new element's IRI, which `rdf-modeling.ts` does from
 * `shape.create.preExecute`.
 *
 * `label-support` is deliberately *not* registered: it moves and deletes separate
 * label *elements*, and this app draws labels inside the shape's own graphics, so
 * it would have nothing to act on.
 */

import { lineOutlineIntersections } from './straight-docking.js';
import { closestPointOnPolyline, pointAlong } from './connection-docking.js';
import Diagram from 'diagram-js';
import { DataFactory } from 'n3';
import { NAMESPACES } from '../../rdf-engine/namespaces.js';

// diagram-js feature modules. These are plain didi module declarations; the
// package ships no type declarations for the index files, hence the assertions.
import ModelingModule from 'diagram-js/lib/features/modeling/index.js';
import { findFreePosition, generateGetNextPosition } from 'diagram-js/lib/features/auto-place/AutoPlaceUtil.js';
import MoveModule from 'diagram-js/lib/features/move/index.js';
import ResizeModule from 'diagram-js/lib/features/resize/index.js';
import SelectionModule from 'diagram-js/lib/features/selection/index.js';
import OutlineModule from 'diagram-js/lib/features/outline/index.js';
import ConnectModule from 'diagram-js/lib/features/connect/index.js';
import BendpointsModule from 'diagram-js/lib/features/bendpoints/index.js';
import ContextPadModule from 'diagram-js/lib/features/context-pad/index.js';
import RulesModule from 'diagram-js/lib/features/rules/index.js';
import GlobalConnectModule from 'diagram-js/lib/features/global-connect/index.js';
import LassoToolModule from 'diagram-js/lib/features/lasso-tool/index.js';
import HandToolModule from 'diagram-js/lib/features/hand-tool/index.js';
import PopupMenuModule from 'diagram-js/lib/features/popup-menu/index.js';
import ConnectionPreviewModule from 'diagram-js/lib/features/connection-preview/index.js';
import SnappingModule from 'diagram-js/lib/features/snapping/index.js';
import CreateModule from 'diagram-js/lib/features/create/index.js';
import AutoPlaceModule from 'diagram-js/lib/features/auto-place/index.js';
import KeyboardModule from 'diagram-js/lib/features/keyboard/index.js';
import EditorActionsModule from 'diagram-js/lib/features/editor-actions/index.js';
import MoveCanvasModule from 'diagram-js/lib/navigation/movecanvas/index.js';
import ZoomScrollModule from 'diagram-js/lib/navigation/zoomscroll/index.js';

import type {
  ElementTypeInfo,
  PaletteDefinition,
  RelationshipTypeInfo,
} from '../../metamodel-manager/interfaces.js';
import type {
  ElementManager,
  RelationshipManager,
  Bounds,
  Point,
  ViewManager,
} from '../../model-manager/interfaces.js';
import type { ObservableRdfStore } from '../../rdf-engine/observable-store.js';
import type { EventBus } from '../event-bus.js';
import { NotationStyleRegistry } from './notation-styles.js';
import { NOTATION_DEFAULTS, labelFitsInside } from './notation-shapes.js';
import { toolFromManagerName, type CanvasTool } from './canvas-tools.js';
import { RdfRenderer, drawnConnectionLabel, rdfRendererModule, type RdfBusinessObject, type RenderOptions } from './rdf-renderer.js';
import { RdfRuleProvider, rdfRulesModule, type RelationshipRefusal } from './rdf-rule-provider.js';
import { humanize } from '../../model-manager/vocabulary.js';
import { isRenamable, rdfLabelEditingModule, type LabelWriter } from './rdf-label-editing.js';
import { RdfElementReplaceMenuProvider, ELEMENT_REPLACE_MENU_ID } from './rdf-element-replace-menu-provider.js';
import { RETYPE_ELEMENT_COMMAND, RetypeElementHandler, type RetypeElementContext } from './rdf-element-retype.js';
import { RdfContextMenuProvider, CONTEXT_MENU_ID, type ContextMenuAction } from './rdf-context-menu-provider.js';
import {
  rdfModelingModule,
  RDF_CHANGE_COMMAND,
  RDF_STORE_EDIT_COMMAND,
  RDF_EXISTING_RELATIONSHIP_HINT,
  RDF_MODEL_DELETE_COMMAND,
  RETYPE_RELATIONSHIP_COMMAND,
  type ModelDeleteContext,
  type RdfChangeContext,
  type RdfElementRequest,
  type RdfElementResult,
  type RdfElementWriter,
  type RdfRelationshipRequest,
  type RdfRelationshipWriter,
  type RetypeRelationshipContext,
} from './rdf-modeling.js';
import { RdfContextPadProvider, toContextPadElement, type ContextPadElement } from './rdf-context-pad-provider.js';
import { PAIR_CONNECT_MENU_ID, RdfPairConnectMenuProvider, type PairConnectContext, type PairEnd } from './rdf-pair-connect-menu-provider.js';
import {
  RdfReplaceMenuProvider,
  RELATIONSHIP_REPLACE_MENU_ID,
  type RelationshipReplaceContext,
} from './rdf-replace-menu-provider.js';
import {
  RdfAppendMenuProvider,
  RdfAppendRelationshipMenuProvider,
  APPEND_TARGET_MENU_ID,
  APPEND_RELATIONSHIP_MENU_ID,
  type AppendMenuContext,
  type ExistingRelationship,
} from './rdf-append-menu-provider.js';
import { NEST_MENU_ID, RdfNestMenuProvider, nestingOffers, nestingShownBy, type NestingOffer } from './nesting.js';
import { rdfAutoResizeModule } from './rdf-auto-resize.js';
import {
  appendableTargetTypes,
  shapesOf,
  identityClosure,
  relationshipKey,
  type AppendTarget,
  type ClassClosure,
} from './relationship-resolution.js';

/** The bit of `RdfStore` the canvas needs to unwrite a direct relationship triple. */
export interface RelationshipTripleStore {
  getQuads(
    subject?: unknown,
    predicate?: unknown,
    object?: unknown,
    graph?: unknown,
  ): unknown[];
  removeQuads(quads: never[]): void;
  /**
   * Optional, and only used to make *redo* of an element creation restore the
   * same element.
   *
   * `ElementManager.createElement` mints its own IRI and cannot be told one, so
   * re-running it on redo would produce a different element and leave the
   * relationship triple from the same undo group pointing at the first IRI.
   * With this, the triples the first creation wrote are snapshotted and replayed
   * verbatim instead. Without it, redo mints a fresh element — see
   * {@link DiagramCanvas.elementWriter}.
   */
  addQuads?(quads: never[]): void;
}

/** Options for initializing the DiagramCanvas. */
export interface DiagramCanvasOptions {
  container: HTMLElement;
  eventBus: EventBus;
  elementManager: ElementManager;
  relationshipManager: RelationshipManager;
  paletteDefinition: PaletteDefinition;
  modelIri: string;
  /**
   * `rdfs:subClassOf*` closure resolver, used to match domain/range constraints
   * that metamodels declare against abstract superclasses. Defaults to treating
   * a type as its own closure, which is only right for flat test metamodels.
   */
  classClosure?: ClassClosure;
  /**
   * Store used to retract a direct relationship triple.
   *
   * `RelationshipManager.deleteRelationship` only works on a
   * `arch:QualifiedRelationship` resource, which has an IRI. A relationship
   * written as a direct triple has none, so retracting it means deleting the
   * exact quad — which needs the store. Without it, deleting or retyping a
   * connection leaves the old triple behind.
   */
  rdfStore?: RelationshipTripleStore;
  /**
   * Node diagram-js's `keyboard` binds its key handling to.
   *
   * diagram-js never fires the `attach` event that `Keyboard` waits for (only
   * bpmn-js's `BaseViewer.attachTo` does), so `config.keyboard.bindTo` alone
   * binds nothing; the canvas binds explicitly after boot. Defaults to the
   * container's document, which is what makes Ctrl+Z work without the canvas
   * having to be focusable. `Keyboard` ignores key events originating in inputs
   * and textareas, so this does not steal undo from the SPARQL editor.
   */
  keyboardBindTo?: EventTarget | null;
  /**
   * Notified whenever diagram-js arms or drops a global tool.
   *
   * The toolbar above the canvas needs this to show which tool is active, and it
   * cannot infer it from its own clicks: a tool also deactivates on its own when
   * its gesture completes or `Escape` cancels it, and clicking the armed tool
   * again toggles it off inside `ToolManager`. `null` means no tool is armed.
   */
  onToolChanged?: (tool: CanvasTool | null) => void;
  /**
   * Something the user should be told, briefly — e.g. why a connection was
   * refused. The host shows it (a toast in the app).
   */
  onNotice?: (message: string, level: 'info' | 'warning') => void;
  /**
   * The views and their geometry. With it, the canvas draws one `arch:View`
   * at a time ({@link DiagramCanvas.showView}), writes layout to that view's
   * `arch-vis:ArchNode`s and `arch-vis:Link`s, and "delete" means *delete from
   * the view*. Without it (an embedded diagram, most unit tests) the canvas has
   * no views to speak of, layout goes to `ElementManager.updateLayout` if the
   * manager offers it, and delete removes from the model.
   */
  viewManager?: ViewManager;
  /**
   * The observable store the managers write through. Lets every model change
   * made for a canvas gesture be recorded once and undone/redone exactly.
   */
  changeStore?: ObservableRdfStore;
  /** Type, label and icon of a model concept, for drawing a view from the store. */
  describeElement?: (iri: string) => ConceptDescription | undefined;
  /**
   * Asked before "delete from model". Receives the concept and the views it
   * appears in; returns whether to go ahead. Absent means "yes".
   */
  confirmDeleteFromModel?: (request: DeleteFromModelRequest) => boolean | Promise<boolean>;
  /**
   * Asked before changing an element's type when some of its relationships are
   * not permitted with the new type. Returns whether to go ahead. Absent means "yes".
   */
  confirmRetypeElement?: (request: RetypeElementRequest) => boolean | Promise<boolean>;
  /**
   * The right-click menu's actions that belong to the rest of the app: show
   * the concept's properties, reveal it in the model tree, show its relationship
   * graph, ask the questions about it, copy its IRI.
   */
  onContextAction?: (action: CanvasContextAction, iri: string) => void;
  /**
   * Whether the model has folders to file concepts in: the right-click menu
   * then offers *Move to folder…* — and, on one of several selected, moving
   * them all (Req 10.14), the selection kept.
   */
  canMoveToFolder?: () => boolean;
}

/** A right-click menu action the host carries out. */
export type CanvasContextAction =
  | 'properties'
  | 'reveal-tree'
  | 'graph'
  | 'ask'
  | 'copy-iri'
  | 'rename'
  | 'show-source'
  | 'show-target'
  | 'move-to-folder'
  | 'rename-view'
  | 'set-viewpoint'
  | 'duplicate-view'
  | 'delete-view';

/** What {@link DiagramCanvasOptions.confirmRetypeElement} is asked about. */
export interface RetypeElementRequest {
  iri: string;
  label: string;
  fromLabel: string;
  toLabel: string;
  /** The relationships the new type is not permitted in, as "Assignment → Cashier". */
  notPermitted: string[];
}

/** What {@link DiagramCanvasOptions.describeElement} returns. */
export interface ConceptDescription {
  typeIri?: string;
  label?: string;
  /** The label is a name the concept has, not one made from its IRI. */
  named?: boolean;
  /**
   * The name the model gives the concept, read from the model alone; absent
   * when it gives none. What a relationship's line is labelled with: read for
   * every line each time a view is drawn, so kept cheap (Task 22).
   */
  modelName?: string;
  iconUrl?: string;
  /** A relationship derived by a rule that the model does not state, by its certainty. */
  derivation?: 'valid' | 'potential';
  /** The rule that derived it, by local name. */
  derivationRule?: string;
}

/** What {@link DiagramCanvasOptions.confirmDeleteFromModel} is asked about. */
export interface DeleteFromModelRequest {
  iri: string;
  kind: 'element' | 'relationship';
  label: string;
  /** IRIs of every view the concept appears in. */
  views: string[];
}

/** CSS marker for a shape whose type the open view's viewpoint does not include. */
export const OUTSIDE_VIEWPOINT_MARKER = 'la-outside-viewpoint';

/** CSS marker for a concept another collaborator has selected. */
export const LOCKED_MARKER = 'la-locked';

/** Rules a collaborator's lock denies, and where each keeps its elements. */
const LOCKED_ACTIONS = [
  'elements.move',
  'shape.resize',
  'elements.delete',
  'connection.updateWaypoints',
  'connection.reconnect',
];

/** Tracks an element on the canvas. */
export interface CanvasElement {
  iri: string;
  typeIri: string;
  label: string;
  iconUrl?: string;
  bounds: Bounds;
}

/** A relationship drawn on the canvas. */
export interface CanvasRelationship {
  sourceIri: string;
  targetIri: string;
  /** IRI of the relationship *type* (the palette concept, e.g. `am4:Serving`). */
  typeIri: string;
  /**
   * IRI actually used as the predicate of the direct triple — the type's
   * `arch:unqualifiedForm` when it publishes one. Needed to retract the triple.
   */
  predicateIri?: string;
  /** IRI of the relationship instance, when the model has one. */
  relationshipIri?: string;
}

const { namedNode } = DataFactory;

/** The id diagram-js gives the single root element of the diagram. */
const ROOT_ID = 'urn:la-gram:diagram-root';

/**
 * Whether a triggering event looks like a click rather than a drag.
 *
 * diagram-js's tools take an `autoActivate` flag: a `dragstart` already *is* the
 * drag and must not be auto-activated, whereas a plain click has to arm the tool
 * so it follows the pointer until the next click.
 */
/**
 * Priority for the shadow-input keyboard guard.
 *
 * diagram-js's own bindings (`editorActions` via `KeyboardBindings`) register at
 * the default 1000, and a higher number runs first — so this has to outrank them
 * to get its answer in before `removeSelection` claims the key.
 */
const KEYBOARD_GUARD_PRIORITY = 2000;

/** Elements that own their keystrokes: text fields and anything contenteditable. */
function isEditableElement(node: EventTarget | null | undefined): boolean {
  const element = node as (HTMLElement & { tagName?: string }) | null | undefined;
  const tagName = element?.tagName;
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
  return element?.isContentEditable === true;
}

/**
 * Whether a key event started inside a text field, shadow roots included.
 *
 * `composedPath()` is the point: it reports the path as it was *before* shadow-DOM
 * retargeting, so an `<input>` inside a Lit component is visible here even though
 * `event.target` has already been rewritten to the component host. Falls back to
 * `target` where `composedPath` is unavailable.
 */
function isEditableEventTarget(event: KeyboardEvent | undefined): boolean {
  if (!event) return false;
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  if (path.length > 0) return path.some((node) => isEditableElement(node));
  return isEditableElement(event.target);
}

function isClickLike(event: unknown): boolean {
  const type = (event as { type?: unknown } | null | undefined)?.type;
  return typeof type === 'string' ? !/^(drag|touch)/.test(type) : true;
}

/** Minimal shape of the diagram-js elements this class handles. */
interface DjsShape {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  businessObject?: RdfBusinessObject;
  waypoints?: Array<{ x: number; y: number }>;
  parent?: unknown;
  children?: DjsShape[];
  source?: DjsShape;
  target?: DjsShape;
  incoming?: DjsShape[];
  outgoing?: DjsShape[];
}

/** What `Connect` holds when a drag ends over a pair it refused. */
interface RefusedConnectContext {
  canExecute?: unknown;
  start?: DjsShape;
  hover?: DjsShape;
}

/** A type's name from its IRI, when the palette has none: `ApplicationComponent` → `Application Component`. */
function fragmentLabel(iri: string): string {
  return humanize(localName(iri));
}

/** The diagram-js services this class resolves. Structural, not nominal. */
interface DjsServices {
  canvas: {
    addShape(shape: unknown, parent?: unknown): DjsShape;
    addConnection(connection: unknown, parent?: unknown): DjsShape;
    removeShape(shape: unknown): unknown;
    removeConnection(connection: unknown): unknown;
    addMarker(element: unknown, marker: string): void;
    removeMarker(element: unknown, marker: string): void;
    hasMarker(element: unknown, marker: string): boolean;
    scrollToElement(element: unknown, padding?: unknown): void;
    setRootElement(root: unknown): unknown;
    getRootElement(): unknown;
    getContainer(): HTMLElement;
    viewbox(): { x: number; y: number; scale: number };
  };
  elementFactory: {
    createRoot(attrs: Record<string, unknown>): unknown;
    createShape(attrs: Record<string, unknown>): DjsShape;
    createConnection(attrs: Record<string, unknown>): DjsShape;
  };
  elementRegistry: {
    get(id: string): DjsShape | undefined;
    getAll(): DjsShape[];
    getGraphics(element: unknown): SVGElement | undefined;
  };
  modeling: {
    createConnection(
      source: unknown,
      target: unknown,
      attrs: Record<string, unknown>,
      parent: unknown,
      hints?: Record<string, unknown>,
    ): DjsShape;
    /** `RdfModeling.connect` — consults the rules when given no attributes. */
    connect(
      source: unknown,
      target: unknown,
      attrs?: Record<string, unknown> | null,
      hints?: Record<string, unknown>,
    ): DjsShape | undefined;
    removeElements(elements: unknown[]): void;
  };
  eventBus: {
    on(event: string | string[], callback: (event: any, ...rest: any[]) => void): void;
    on(event: string | string[], priority: number, callback: (event: any, ...rest: any[]) => unknown): void;
    fire(event: string, payload?: unknown): unknown;
  };
  commandStack: { execute(command: string, context: unknown): void; clear(): void; registerHandler(command: string, handler: unknown): void };
  layouter: { layoutConnection(connection: unknown, hints?: unknown): Array<{ x: number; y: number }> };
  contextPad: { registerProvider(provider: unknown): void };
  /**
   * diagram-js's popup menu, host of the relationship-type chooser.
   *
   * `isEmpty` throws when handed no target, hence the guards at the call sites.
   */
  popupMenu: {
    registerProvider(id: string, provider: unknown): void;
    open(target: unknown, providerId: string, position: unknown, options?: unknown): void;
    isEmpty(target: unknown, providerId: string): boolean;
    /** Re-read the open menu's entries (after a tab switch). */
    refresh(): void;
    close(): void;
    isOpen(): boolean;
  };
  /** Binds key handling to a DOM node; see `DiagramCanvasOptions.keyboardBindTo`. */
  keyboard: {
    bind(node: EventTarget): void;
    getBinding(): EventTarget | null;
    /**
     * `Keyboard.addListener(priority, listener, type)`.
     *
     * A listener returning `false` makes `EventBus.fire` return `false`, which is
     * what stops `Keyboard._keyHandler` from calling `preventDefault()` on the DOM
     * event. See {@link DiagramCanvas.guardKeyboardAgainstShadowInputs}.
     */
    addListener(
      priority: number,
      listener: (context: { keyEvent?: KeyboardEvent }) => false | undefined,
      type?: string,
    ): void;
  };
  selection: { select(element: unknown): void; get(): DjsShape[] };
  /**
   * diagram-js's connect tool.
   *
   * Real signature, from `diagram-js@14.11.3`
   * `lib/features/connect/Connect.js`:
   * `start(event, start, connectionStart?, autoActivate?)`. When
   * `connectionStart` is not an object it is read as `autoActivate` and the
   * start point defaults to the mid-point of `start`, so the three-argument
   * `start(event, shape, true)` call is legal.
   */
  connect: {
    start(
      event: unknown,
      start: unknown,
      connectionStart?: unknown,
      autoActivate?: boolean,
    ): void;
  };
  /** `GlobalConnect.start(event, autoActivate)` — pick the tool, then drag. */
  globalConnect: { start(event: unknown, autoActivate?: boolean): void };
  /**
   * diagram-js's create tool.
   *
   * `start(event, elements, context?)`. The `context.source` hint is what turns a
   * plain create into an *append*: `Create` then asks the `connection.create`
   * rule about the pair and, on drop, routes through `modeling.appendShape`
   * instead of `modeling.createElements` — so the shape and the connection are
   * made by one command group.
   */
  create: { start(event: unknown, elements: unknown, context?: Record<string, unknown>): void };
  /** `AutoPlace.append(source, shape, hints?)` — place beside the source and connect. */
  autoPlace: { append(source: unknown, shape: unknown, hints?: unknown): DjsShape | undefined };
  lassoTool: { activateSelection(event: unknown, autoActivate?: boolean): void };
  handTool: { activateHand(event: unknown, autoActivate?: boolean): void };
}

/**
 * Main canvas wrapper that runs diagram-js with the custom RDF modules.
 */
export class DiagramCanvas {
  private container: HTMLElement;
  private eventBus: EventBus;
  private elementManager: ElementManager;
  private relationshipManager: RelationshipManager;
  private modelIri: string;
  private classClosure: ClassClosure;
  private rdfStore?: RelationshipTripleStore;
  private onToolChanged?: (tool: CanvasTool | null) => void;
  private onNotice?: (message: string, level: 'info' | 'warning') => void;
  private viewManager?: ViewManager;
  private changeStore?: ObservableRdfStore;
  private describeElement?: (iri: string) => ConceptDescription | undefined;
  private confirmDeleteFromModel?: (request: DeleteFromModelRequest) => boolean | Promise<boolean>;
  private confirmRetypeElement?: (request: RetypeElementRequest) => boolean | Promise<boolean>;
  private onContextAction?: (action: CanvasContextAction, iri: string) => void;
  private canMoveToFolder?: () => boolean;
  /** Where the right-click menu was opened, for the menus it opens in turn. */
  private contextMenuAt: { x: number; y: number } | undefined;
  /** What the renderer draws beyond the notation — relationships' names — kept here to switch and redraw. */
  private readonly renderOptions: RenderOptions = { relationshipNames: false };

  /** The `arch:View` on the canvas, when a view manager is in use. */
  private viewIri: string | undefined;

  /** Whether a type is in the open view's viewpoint; `undefined` = no viewpoint. */
  private viewpointFilter: ((typeIri: string) => boolean) | undefined;

  /** Concepts another collaborator has selected: shown, not editable here. */
  private locked: ReadonlySet<string> = new Set();

  /**
   * Marker → the concepts that should carry it. Kept, not just applied, so a
   * shape drawn *after* the marker was set (a remote element arriving after the
   * collaborator's selection did, a view opened after validation ran) gets it.
   */
  private markerSets = new Map<string, ReadonlySet<string>>();

  /** The palette definition currently in force. */
  private paletteDefinition: PaletteDefinition;

  /** Custom RDF modules */
  readonly ruleProvider: RdfRuleProvider;
  readonly contextPadProvider: RdfContextPadProvider;
  readonly replaceMenuProvider: RdfReplaceMenuProvider;
  /** The relationships two selected elements may have (the pad's "Connect these two…"). */
  readonly pairConnectMenuProvider: RdfPairConnectMenuProvider;
  readonly elementReplaceMenuProvider: RdfElementReplaceMenuProvider;
  readonly contextMenuProvider: RdfContextMenuProvider;
  readonly appendMenuProvider: RdfAppendMenuProvider;
  /** The append's second step: which relationship, when several are permitted. */
  readonly appendRelationshipMenuProvider: RdfAppendRelationshipMenuProvider;
  /** After a drop into a container: which relationship the nesting stands for. */
  readonly nestMenuProvider: RdfNestMenuProvider;
  readonly notationStyles: NotationStyleRegistry;

  /** The diagram-js instance, or `null` once destroyed. */
  private diagram: Diagram | null = null;

  /** Relationship registry keyed by the connection's diagram-js id. */
  private relationships = new Map<string, CanvasRelationship>();
  /**
   * The connections not named by their relationship's IRI — one the user draws
   * gets diagram-js's id, and its relationship after — which are all
   * {@link findConnection} must look through when the IRI is not an id.
   */
  private otherwiseNamed = new Set<DjsShape>();

  /**
   * Set while a removal originated in the RDF store, so the diagram-js delete
   * hook does not try to delete the triples that are already gone.
   */
  private removingFromStore = false;

  /**
   * Set while the canvas is rewriting a connection in place (a type change), so
   * its own store→canvas listeners do not undraw and redraw it.
   */
  private suppressSync = false;

  /**
   * Appendable target types per source type.
   *
   * `RelationshipManager.getValidRelationships` takes a *pair* and re-reads the
   * store on every call, so deriving "what can I append?" costs one call per
   * candidate target type. The context pad asks whether the append menu is empty
   * on every open, so without this the derivation would run on every pad render.
   * Cleared by {@link updatePaletteDefinition}, which is the only thing that can
   * change the answer.
   */
  private appendTargetCache = new Map<string, AppendTarget[]>();

  private initialized = false;

  constructor(options: DiagramCanvasOptions) {
    this.container = options.container;
    this.eventBus = options.eventBus;
    this.elementManager = options.elementManager;
    this.relationshipManager = options.relationshipManager;
    this.modelIri = options.modelIri;
    this.classClosure = options.classClosure ?? identityClosure;
    this.rdfStore = options.rdfStore;
    this.onToolChanged = options.onToolChanged;
    this.onNotice = options.onNotice;
    this.viewManager = options.viewManager;
    this.changeStore = options.changeStore;
    this.describeElement = options.describeElement;
    this.confirmDeleteFromModel = options.confirmDeleteFromModel;
    this.confirmRetypeElement = options.confirmRetypeElement;
    this.onContextAction = options.onContextAction;
    this.canMoveToFolder = options.canMoveToFolder;

    this.notationStyles = new NotationStyleRegistry(options.paletteDefinition);
    this.paletteDefinition = options.paletteDefinition;

    this.ruleProvider = new RdfRuleProvider(this.relationshipManager);

    this.contextPadProvider = new RdfContextPadProvider(
      this.elementManager,
      this.relationshipManager,
      options.paletteDefinition,
      (sourceElement, event, autoActivate) =>
        this.startConnect(sourceElement, event, autoActivate),
      (element: ContextPadElement) => this.deleteFromPad(element),
      this.classClosure,
      {
        // Exactly bpmn-js's gate: the pad asks the menu whether it has entries.
        isAvailable: (element) => this.canReplaceRelationshipType(element),
        open: (element, event) => this.openRelationshipReplaceMenu(element, event),
      },
      {
        // The same gate for `append`: the menu is empty when the metamodel
        // permits no target, and an empty menu means no button.
        isAvailable: (element) => this.canAppend(element),
        open: (element, event) => this.openAppendMenu(element, event),
      },
    );

    this.replaceMenuProvider = new RdfReplaceMenuProvider(
      this.relationshipManager,
      (target) => this.resolveReplaceContext(target),
      (connectionId, typeIri) => this.applyRelationshipTypeChoice(connectionId, typeIri),
      (iri) => this.paletteDefinition.relationshipTypes.find((r) => r.iri === iri)?.iconUrl,
    );

    this.pairConnectMenuProvider = new RdfPairConnectMenuProvider(
      this.relationshipManager,
      (target) => this.resolvePair(target),
      (source, target, candidate) => this.connectPair(source, target, candidate),
      (iri) => this.paletteDefinition.relationshipTypes.find((r) => r.iri === iri)?.iconUrl,
    );
    this.contextPadProvider.setPairSupport({
      // The gate the other pad menus use: the menu has entries, or no button.
      isAvailable: (elements) => {
        const services = this.services();
        return !!services && !services.popupMenu.isEmpty(elements, PAIR_CONNECT_MENU_ID);
      },
      open: (elements, event) =>
        this.services()?.popupMenu.open(elements, PAIR_CONNECT_MENU_ID, this.padMenuPosition(event), {
          title: 'Connect these two',
          width: 320,
          search: true,
        }),
    });

    this.elementReplaceMenuProvider = new RdfElementReplaceMenuProvider(
      (target) => {
        const shape = target as DjsShape | undefined;
        const shown = shape?.businessObject;
        if (!shape || shown?.kind !== 'element' || !shown.iri) return undefined;
        return { shapeId: shape.id, currentTypeIri: shown.typeIri };
      },
      () => this.paletteDefinition.elementGroups,
      (shapeId, typeIri) => void this.retypeElement(shapeId, typeIri),
      () => this.services()?.popupMenu.refresh(),
    );

    this.contextMenuProvider = new RdfContextMenuProvider(
      (target) => this.contextMenuActions(target),
      () => this.services()?.popupMenu.close(),
    );

    this.appendMenuProvider = new RdfAppendMenuProvider(
      (target) => this.resolveAppendContext(target),
      (sourceTypeIri) => this.appendTargets(sourceTypeIri),
      {
        place: (context, typeIri, relationshipTypeIri) => this.appendElement(context, typeIri, relationshipTypeIri),
        drag: (context, typeIri, event) => this.startAppend(context, typeIri, event),
        chooseRelationship: (context, target) => this.openAppendRelationshipMenu(context, target),
        showExisting: (context, relationship) => this.showExistingRelationship(context, relationship),
        dragExisting: (_context, relationship, event) => this.startPlaceExisting(relationship.otherIri, event),
        refresh: () => this.services()?.popupMenu.refresh(),
      },
      (context) => this.existingRelationships(context),
    );

    this.appendRelationshipMenuProvider = new RdfAppendRelationshipMenuProvider(
      {
        place: (context, typeIri, relationshipTypeIri) => this.appendElement(context, typeIri, relationshipTypeIri),
      },
      (iri) => this.paletteDefinition.relationshipTypes.find((r) => r.iri === iri)?.iconUrl,
    );
    this.nestMenuProvider = new RdfNestMenuProvider(
      (offer) => this.nestAs(offer),
      (iri) => this.paletteDefinition.relationshipTypes.find((r) => r.iri === iri)?.iconUrl,
    );

    const keyboardBindTo =
      options.keyboardBindTo === undefined
        ? (this.container.ownerDocument as EventTarget | null)
        : options.keyboardBindTo;

    this.diagram = new Diagram({
      canvas: { container: this.container },
      // `Keyboard` reads this, but only binds on the `attach` event — which
      // plain diagram-js never fires. Declared anyway so the configured node is
      // discoverable through `config.keyboard`, and bound explicitly below.
      keyboard: { bindTo: keyboardBindTo ?? undefined },
      modules: [
        ModelingModule,
        RulesModule,
        SelectionModule,
        MoveModule,
        ResizeModule,
        OutlineModule,
        ConnectModule,
        ConnectionPreviewModule,
        CreateModule,
        AutoPlaceModule,
        GlobalConnectModule,
        LassoToolModule,
        HandToolModule,
        BendpointsModule,
        SnappingModule,
        ContextPadModule,
        PopupMenuModule,
        EditorActionsModule,
        KeyboardModule,
        MoveCanvasModule,
        ZoomScrollModule,
        rdfRendererModule(this.notationStyles, this.renderOptions),
        rdfRulesModule(this.ruleProvider),
        rdfAutoResizeModule,
        // Last, so its `modeling` binding replaces the one ModelingModule made.
        rdfModelingModule(this.relationshipWriter(), this.elementWriter(), this.changeStore ?? null),
        // Renaming on the canvas: double-click or F2 (needs `rdfChangeStore` from the line above).
        rdfLabelEditingModule(this.labelWriter()),
      ] as never[],
    });

    this.initRoot();
    if (this.viewManager) {
      this.contextPadProvider.setDeleteFromModelHandler((element) => {
        this.deleteFromModel(element.iri);
      });
    }
    this.registerProviders();
    this.bindKeyboard(keyboardBindTo);
    this.guardKeyboardAgainstShadowInputs();
    this.otherwiseNamed.clear();
    this.restackOnlyWhatChanged();
    this.wireDiagramEvents();
    this.setupEventListeners();
    this.initialized = true;
  }

  /** Whether the canvas is initialized and ready. */
  isInitialized(): boolean {
    return this.initialized;
  }

  /** Get the container element. */
  getContainer(): HTMLElement {
    return this.container;
  }

  /** The underlying diagram-js instance, for callers that need a service. */
  getDiagram(): Diagram | null {
    return this.diagram;
  }

  /** The custom renderer instance, once diagram-js has constructed it. */
  get renderer(): RdfRenderer | undefined {
    return this.service<RdfRenderer>('rdfRenderer');
  }

  /** Get all elements currently on the canvas, keyed by IRI. */
  getElements(): Map<string, CanvasElement> {
    const elements = new Map<string, CanvasElement>();
    for (const shape of this.shapes()) {
      const canvasElement = toCanvasElement(shape);
      if (canvasElement) elements.set(canvasElement.iri, canvasElement);
    }
    return elements;
  }

  /** Get a specific element by IRI. */
  getElement(iri: string): CanvasElement | undefined {
    const shape = this.services()?.elementRegistry.get(iri);
    return shape ? (toCanvasElement(shape) ?? undefined) : undefined;
  }

  // ── Views ──────────────────────────────────────────────────────────────

  /** Point new elements at another model (after New / Open). */
  setModelIri(modelIri: string): void {
    this.modelIri = modelIri;
  }

  /** The `arch:View` on the canvas, if any. */
  currentView(): string | undefined {
    return this.viewIri;
  }

  /**
   * Put a view on the canvas: clear it, draw the view's nodes and links from
   * the store, and start a fresh undo history — undoing into a view that is no
   * longer shown would edit something the user cannot see.
   *
   * The view drawn already in this task — opening a model says it is loaded,
   * then that its view is open — is only brought up to date: drawing a view of
   * thousands twice cost as much again (Task 22).
   */
  showView(viewIri: string | undefined): void {
    const services = this.services();
    if (!services) return;
    if (viewIri && viewIri === this.viewIri && viewIri === this.drawnThisTask) {
      this.syncFromStore();
      return;
    }
    this.viewIri = viewIri;
    this.clearDiagram();
    if (viewIri && this.viewManager) this.syncFromStore();
    services.commandStack.clear();
    this.drawnThisTask = viewIri;
    queueMicrotask(() => {
      this.drawnThisTask = undefined;
    });
  }

  /**
   * After a change, diagram-js re-stacks the graphics of every child of each
   * changed element's parent, to match the model's order — every shape and
   * link of a view of 10 000, for one shape moved (Task 22). Only what changed
   * can be out of place: each is put right after its sibling before it, and a
   * parent where that sibling is not in place yet is re-stacked whole, as
   * diagram-js does.
   */
  private restackOnlyWhatChanged(): void {
    const graphics = this.diagram?.get('graphicsFactory') as
      | { updateContainments(elements: DjsShape[]): void; _getChildrenContainer(parent: DjsShape): SVGElement }
      | undefined;
    const registry = this.diagram?.get('elementRegistry') as { getGraphics(element: DjsShape): SVGElement | undefined } | undefined;
    if (!graphics || !registry) return;
    const restackWhole = graphics.updateContainments.bind(graphics);
    graphics.updateContainments = (elements: DjsShape[]) => {
      const whole = new Set<DjsShape>();
      for (const element of elements) {
        const parent = element.parent as DjsShape | undefined;
        const siblings = (parent as { children?: DjsShape[] } | undefined)?.children;
        if (!parent || !siblings || whole.has(parent)) continue;
        const group = registry.getGraphics(element)?.parentNode as SVGElement | null | undefined;
        if (!group) continue;
        const container = graphics._getChildrenContainer(parent);
        const at = siblings.indexOf(element);
        const before = at > 0 ? (registry.getGraphics(siblings[at - 1])?.parentNode as SVGElement | null | undefined) : null;
        if (at < 0 || (before && before.parentNode !== container)) {
          whole.add(parent);
          continue;
        }
        const next = before ? before.nextSibling : container.firstChild;
        if (next !== group) container.insertBefore(group, next);
      }
      if (whole.size > 0) restackWhole([...whole].flatMap((parent) => (parent as { children?: DjsShape[] }).children?.slice(0, 1) ?? []));
    };
  }

  /**
   * A stored route as the line to draw. Its first and last points are its ends
   * when they lie on their shapes' outlines — as la-gram writes a route, and a
   * BPMN diagram has it; otherwise they are bends — as the ArchiMate converter
   * writes Archi's bend points — and the line runs from the shape through them,
   * docked to the outline as a line drawn here is. One point is one bend.
   *
   * An end on a relationship — a relationship whose source or target is a
   * relationship — is on that relationship's line rather than an outline.
   */
  private drawnRoute(points: readonly Point[], source: DjsShape, target: DjsShape): Array<{ x: number; y: number }> {
    const first = points[0];
    const last = points[points.length - 1];
    const fromSource = points.length >= 2 && this.atEnd(first, source);
    const toTarget = points.length >= 2 && this.atEnd(last, target);
    if (fromSource && toTarget) return points.map((p) => ({ x: p.x, y: p.y }));
    const centre = (shape: DjsShape) =>
      shape.waypoints ? pointAlong(shape.waypoints, 0.5) : { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
    const bends = points.slice(fromSource ? 1 : 0, toTarget ? points.length - 1 : points.length).map((p) => ({ x: p.x, y: p.y }));
    const route = [fromSource ? { x: first.x, y: first.y } : centre(source), ...bends, toTarget ? { x: last.x, y: last.y } : centre(target)];
    const docking = this.diagram?.get('connectionDocking') as
      | { getCroppedWaypoints(connection: unknown, source?: unknown, target?: unknown): Array<{ x: number; y: number }> }
      | undefined;
    return docking ? docking.getCroppedWaypoints({ waypoints: route, source, target }, source, target) : route;
  }

  /** Whether a stored route's end point is where it meets `end`: its outline, or its line. */
  private atEnd(point: Point, end: DjsShape): boolean {
    if (!end.waypoints) return this.onOutline(point, end);
    const on = closestPointOnPolyline(end.waypoints, point);
    return Math.hypot(on.x - point.x, on.y - point.y) <= 3;
  }

  /**
   * Whether a point lies on a shape's outline, within 3 pixels: a short probe
   * across it meets the outline docking crops against; for an outline with
   * curves, which the probe cannot read, on the edge of the shape's bounds.
   */
  private onOutline(point: Point, shape: DjsShape): boolean {
    const graphics = this.diagram?.get('graphicsFactory') as { getShapePath(shape: DjsShape): string } | undefined;
    const outline = graphics?.getShapePath(shape);
    const near = 3;
    if (outline) {
      let readable = true;
      for (const [dx, dy] of [[near, 0], [0, near]]) {
        const hits = lineOutlineIntersections(outline, { x: point.x - dx, y: point.y - dy }, { x: point.x + dx, y: point.y + dy });
        if (hits === undefined) {
          readable = false;
          break;
        }
        if (hits.length > 0) return true;
      }
      if (readable) return false;
    }
    const within = (v: number, from: number, to: number) => v >= from - near && v <= to + near;
    const x0 = shape.x;
    const y0 = shape.y;
    const x1 = shape.x + shape.width;
    const y1 = shape.y + shape.height;
    const onVertical = (Math.abs(point.x - x0) <= near || Math.abs(point.x - x1) <= near) && within(point.y, y0, y1);
    const onHorizontal = (Math.abs(point.y - y0) <= near || Math.abs(point.y - y1) <= near) && within(point.x, x0, x1);
    return onVertical || onHorizontal;
  }

  /** The view {@link showView} drew in the current task, if any. */
  private drawnThisTask: string | undefined;

  /**
   * Make the canvas match the open view in the store: draw what is missing,
   * remove what is gone, move what moved, relabel what was renamed.
   *
   * The store→canvas direction, so it bypasses the command stack entirely
   * (`canvas.addShape` / `removeShape`, not `modeling`). Called after a view is
   * opened, after a remote collaborator's change, after a model-level delete
   * from the explorer, and after property edits.
   */
  syncFromStore(): void {
    const services = this.services();
    const viewIri = this.viewIri;
    if (!services || !viewIri || !this.viewManager) return;

    const nodes = this.viewManager.getNodes(viewIri);
    const links = this.viewManager.getLinks(viewIri);
    const wantedShapes = new Map(nodes.map((n) => [n.elementIri, n]));
    const wantedLinks = new Map(links.map((l) => [l.relationshipIri, l]));

    // The connections drawn, by relationship: looked up once, not a scan of the
    // canvas a link — which made drawing a view of thousands quadratic (Task 22).
    const drawnLinks = new Map<string, DjsShape>();
    this.removingFromStore = true;
    try {
      for (const connection of this.connections()) {
        const iri = connection.businessObject?.iri;
        if (!iri || !wantedLinks.has(iri)) this.removeConnectionDirect(connection);
        else if (!drawnLinks.has(iri)) drawnLinks.set(iri, connection);
      }
      for (const shape of this.shapes()) {
        const iri = shape.businessObject?.iri;
        if (!iri || !wantedShapes.has(iri)) this.removeShapeDirect(shape);
      }
    } finally {
      this.removingFromStore = false;
    }

    // Containers before what is drawn inside them.
    for (const node of containersFirst(nodes)) {
      const description = this.describeElement?.(node.elementIri);
      const existing = services.elementRegistry.get(node.elementIri);
      const container = this.containerFor(node.parentElementIri);
      if (existing && existing.parent !== container) this.reparentDirect(existing, container);
      if (existing) {
        const b = existing;
        const moved =
          b.x !== node.bounds.x || b.y !== node.bounds.y || b.width !== node.bounds.width || b.height !== node.bounds.height;
        const relabelled = description?.label !== undefined && description.label !== b.businessObject?.label;
        const retyped = description?.typeIri !== undefined && description.typeIri !== b.businessObject?.typeIri;
        if (retyped && b.businessObject && description?.typeIri) b.businessObject.typeIri = description.typeIri;
        if (moved || relabelled || retyped) {
          this.updateElement(node.elementIri, {
            ...(relabelled ? { label: description?.label, named: description?.named ?? true } : {}),
            ...(moved ? { bounds: node.bounds } : {}),
          });
        }
      } else {
        this.addElement(
          node.elementIri,
          description?.typeIri ?? '',
          node.bounds,
          description?.label,
          description?.iconUrl,
          description?.named,
          node.parentElementIri,
        );
      }
    }

    for (const link of links) {
      const existing = services.elementRegistry.get(link.relationshipIri) ?? drawnLinks.get(link.relationshipIri);
      const description = this.describeElement?.(link.relationshipIri);
      const typeIri = description?.typeIri ?? '';
      if (existing) {
        // Renamed — in the dialog, the property panel, by a collaborator, or undone:
        // its line shows the name in force. Redrawn alone, as a renamed shape is.
        const name = description?.modelName;
        const drawnName = existing.businessObject?.named ? existing.businessObject.label : undefined;
        if (existing.businessObject && name !== drawnName) {
          existing.businessObject.label = name;
          existing.businessObject.named = name !== undefined;
          services.eventBus.fire('element.changed', { element: existing });
        }
        const route =
          link.waypoints.length > 0 && existing.source && existing.target
            ? this.drawnRoute(link.waypoints, existing.source as DjsShape, existing.target as DjsShape)
            : undefined;
        if (route && !sameRoute(existing.waypoints, route.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })))) {
          existing.waypoints = route;
          services.eventBus.fire('elements.changed', { elements: [existing] });
        }
        if (typeIri && existing.businessObject && existing.businessObject.typeIri !== typeIri) {
          existing.businessObject.typeIri = typeIri;
          const record = this.relationships.get(existing.id);
          if (record) record.typeIri = typeIri;
          services.eventBus.fire('elements.changed', { elements: [existing] });
        }
        // Confirmed, or the confirmation undone: drawn as what it now is.
        const derived = this.derivationOf(link.relationshipIri);
        const drawn = existing.businessObject;
        if (drawn && (drawn.derivation !== derived.derivation || drawn.derivationRule !== derived.derivationRule)) {
          delete drawn.derivation;
          delete drawn.derivationRule;
          Object.assign(drawn, derived);
          services.eventBus.fire('elements.changed', { elements: [existing] });
        }
        continue;
      }
      this.addRelationship(
        link.sourceElementIri,
        link.targetElementIri,
        typeIri,
        link.relationshipIri,
        link.waypoints,
      );
    }

    this.applyViewpointMarkers();
  }

  /**
   * Grey out shapes whose type the view's viewpoint does not include — they
   * stay editable, the viewpoint is guidance rather than a wall (Req 2.9).
   * Pass `undefined` when the view has no viewpoint.
   */
  setViewpointFilter(filter: ((typeIri: string) => boolean) | undefined): void {
    this.viewpointFilter = filter;
    this.applyViewpointMarkers();
  }

  /**
   * Put a CSS marker on exactly the given concepts (shapes or connections, by
   * IRI) and take it off everything else. Used for validation results and for
   * what other collaborators have selected.
   */
  setMarkers(marker: string, iris: ReadonlySet<string>): void {
    this.markerSets.set(marker, iris);
    const services = this.services();
    if (!services) return;
    for (const element of services.elementRegistry.getAll()) {
      if (!element.parent) continue;
      const iri = element.businessObject?.iri;
      const want = iri !== undefined && iris.has(iri);
      const has = services.canvas.hasMarker(element, marker);
      if (want && !has) services.canvas.addMarker(element, marker);
      if (!want && has) services.canvas.removeMarker(element, marker);
    }
  }

  /**
   * Lock concepts another collaborator is editing: they cannot be moved,
   * resized, deleted or re-routed here, and wear the `la-locked` marker.
   */
  setLockedIris(iris: ReadonlySet<string>): void {
    this.locked = iris;
    this.setMarkers(LOCKED_MARKER, iris);
  }

  /** The visible area, in diagram coordinates — restored with {@link restoreViewport}. */
  viewport(): { x: number; y: number; width: number; height: number } | undefined {
    const canvas = this.service<{ viewbox(): { x: number; y: number; width: number; height: number } }>('canvas');
    if (!canvas) return undefined;
    try {
      const { x, y, width, height } = canvas.viewbox();
      return [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0 ? { x, y, width, height } : undefined;
    } catch {
      return undefined; // jsdom has no layout
    }
  }

  /** Show a visible area {@link viewport} returned. */
  restoreViewport(box: { x: number; y: number; width: number; height: number }): void {
    try {
      this.service<{ viewbox(box: unknown): unknown }>('canvas')?.viewbox(box);
    } catch {
      /* jsdom has no layout */
    }
  }

  /**
   * The shapes selected with `element` showing concepts of its kind — elements
   * or relationships — when the model has folders to move them to; none when
   * it is not selected.
   */
  private selectedAlike(element: DjsShape): DjsShape[] {
    if (!this.onContextAction || !this.canMoveToFolder?.()) return [];
    const selected = this.service<{ get(): DjsShape[] }>('selection')?.get() ?? [];
    if (!selected.includes(element)) return [];
    const kind = element.businessObject?.kind;
    return selected.filter((s) => s.businessObject?.iri && s.businessObject.kind === kind);
  }

  /** The concepts selected on the canvas. */
  selectedIris(): string[] {
    const selected = this.service<{ get(): DjsShape[] }>('selection')?.get() ?? [];
    return selected.map((element) => element.businessObject?.iri).filter((iri): iri is string => Boolean(iri));
  }

  /** Select these concepts, as far as the open view draws them. */
  selectIris(iris: readonly string[]): void {
    const services = this.services();
    if (!services) return;
    const elements = iris.map((iri) => services.elementRegistry.get(iri) ?? this.findConnection(iri)).filter(Boolean);
    services.selection.select(elements);
  }

  /** Select a concept on the canvas and scroll it into view. Returns whether it is drawn. */
  reveal(iri: string): boolean {
    const services = this.services();
    const element = services?.elementRegistry.get(iri) ?? this.findConnection(iri);
    if (!services || !element) return false;
    services.selection.select(element);
    try {
      services.canvas.scrollToElement(element, { top: 80, bottom: 80, left: 80, right: 80 });
    } catch {
      /* jsdom has no layout; selecting is what matters */
    }
    return true;
  }

  /**
   * Start dragging an element that exists in the model onto the open view — the
   * model tree's gesture. Dropping creates a placement (a node), not a new
   * element, and draws the element's relationships to anything already placed.
   * An element already in the view is selected instead.
   */
  startPlaceExisting(iri: string, event: unknown): void {
    const services = this.services();
    if (!services || !event || !this.viewIri) return;
    if (this.reveal(iri)) return;
    const shape = this.buildExistingShape(iri);
    if (shape) services.create.start(event, shape);
  }

  /**
   * Place an element that exists in the model at a position (or at the centre of
   * the visible area), undoably. The "Add to current view" of the model tree.
   */
  placeExisting(iri: string, position?: { x: number; y: number }): boolean {
    const services = this.services();
    if (!services || !this.viewIri) return false;
    if (this.reveal(iri)) return true;
    const shape = this.buildExistingShape(iri);
    if (!shape) return false;
    const viewbox = services.canvas.viewbox() as { x: number; y: number; width?: number; height?: number };
    const at = position ?? {
      x: Math.round(viewbox.x + (viewbox.width ?? 800) / 2),
      y: Math.round(viewbox.y + (viewbox.height ?? 600) / 2),
    };
    (services.modeling as unknown as { createShape(s: unknown, p: unknown, parent: unknown): unknown }).createShape(
      shape,
      at,
      services.canvas.getRootElement(),
    );
    this.reveal(iri);
    return true;
  }

  /**
   * Draw a relationship that exists in the model into the open view, undoably.
   * Both ends must already be placed here.
   *
   * @returns whether it is drawn now (it may already have been).
   */
  drawExistingRelationship(relationshipIri: string): boolean {
    const services = this.services();
    if (!services || !this.viewIri) return false;
    if (this.findConnection(relationshipIri)) return this.reveal(relationshipIri);
    const rel = this.relationshipManager.getRelationship?.(relationshipIri);
    if (!rel) return false;
    const source = services.elementRegistry.get(rel.sourceIri);
    const target = services.elementRegistry.get(rel.targetIri);
    if (!source || !target) return false;
    const typeIri = this.describeElement?.(relationshipIri)?.typeIri ?? rel.classIri;
    const businessObject: RdfBusinessObject = {
      iri: relationshipIri,
      typeIri,
      kind: 'relationship',
      ...this.relationshipNameOf(relationshipIri),
      ...this.derivationOf(relationshipIri),
    };
    services.modeling.createConnection(
      source,
      target,
      { id: relationshipIri, businessObject },
      services.canvas.getRootElement(),
      { [RDF_EXISTING_RELATIONSHIP_HINT]: relationshipIri },
    );
    this.relationships.set(relationshipIri, {
      sourceIri: rel.sourceIri,
      targetIri: rel.targetIri,
      typeIri,
      predicateIri: rel.predicateIri,
      relationshipIri,
    });
    return true;
  }

  /**
   * Delete a concept from the *model* — every view, every relationship —
   * after asking {@link DiagramCanvasOptions.confirmDeleteFromModel}. Undoable
   * as one step when the concept is on the canvas.
   *
   * @returns whether anything was deleted — a promise of it when the
   *   confirmation is asynchronous (a dialog).
   */
  deleteFromModel(iri: string): boolean | Promise<boolean> {
    const services = this.services();
    const drawn = services?.elementRegistry.get(iri) ?? this.findConnection(iri);
    const isRelationship =
      drawn?.businessObject?.kind === 'relationship' ||
      (!drawn && this.relationshipManager.getRelationship?.(iri) !== undefined);
    const kind: 'element' | 'relationship' = isRelationship ? 'relationship' : 'element';
    const label =
      drawn?.businessObject?.label ?? this.describeElement?.(iri)?.label ?? localName(iri);
    const views = this.viewManager?.viewsContaining(iri) ?? [];
    const answer = this.confirmDeleteFromModel ? this.confirmDeleteFromModel({ iri, kind, label, views }) : true;
    if (typeof answer !== 'boolean') {
      return answer.then((ok) => (ok ? this.performModelDelete(iri, isRelationship) : false));
    }
    return answer ? this.performModelDelete(iri, isRelationship) : false;
  }

  /** The delete itself, once confirmed. Looks the concept up again: a dialog took time. */
  private performModelDelete(iri: string, isRelationship: boolean): boolean {
    const services = this.services();
    const drawn = services?.elementRegistry.get(iri) ?? this.findConnection(iri);
    const apply = isRelationship
      ? () => this.relationshipManager.deleteRelationship(iri)
      : () => this.elementManager.deleteElement(iri);

    if (services) {
      const context: ModelDeleteContext = { elements: drawn ? [drawn] : [], apply };
      services.commandStack.execute(RDF_MODEL_DELETE_COMMAND, context);
    } else {
      apply();
    }
    this.eventBus.emit(isRelationship ? 'relationship-deleted' : 'element-deleted', {
      iri,
      elementIri: iri,
      relationshipIri: iri,
      fromModel: true,
    });
    return true;
  }

  /**
   * Draw an element on the canvas.
   *
   * Idempotent by IRI: a repeat call updates the existing shape rather than
   * failing on diagram-js's duplicate-id check.
   */
  addElement(
    iri: string,
    typeIri: string,
    bounds: Bounds,
    label?: string,
    iconUrl?: string,
    named: boolean = label !== undefined,
    parentIri?: string,
  ): void {
    const services = this.services();
    if (!services) return;

    const existing = services.elementRegistry.get(iri);
    if (existing) {
      this.updateElement(iri, { label, iconUrl, bounds });
      return;
    }

    const style = this.notationStyles.styleFor(typeIri);
    const businessObject: RdfBusinessObject = {
      iri,
      typeIri,
      label: label ?? this.notationStyles.labelFor(typeIri) ?? localName(iri),
      named: label !== undefined && named,
      kind: 'element',
      iconUrl,
    };

    const shape = services.elementFactory.createShape({
      id: iri,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width || style?.defaultWidth || NOTATION_DEFAULTS.width,
      height: bounds.height || style?.defaultHeight || NOTATION_DEFAULTS.height,
      businessObject,
    });

    services.canvas.addShape(shape, this.containerFor(parentIri));
    if (this.viewpointFilter && typeIri && !this.viewpointFilter(typeIri)) {
      services.canvas.addMarker(shape, OUTSIDE_VIEWPOINT_MARKER);
    }
    this.applyKeptMarkers(shape);
  }

  /** Give a freshly drawn element every kept marker naming it. */
  private applyKeptMarkers(element: DjsShape): void {
    const services = this.services();
    const iri = element.businessObject?.iri;
    if (!services || !iri) return;
    for (const [marker, iris] of this.markerSets) {
      if (iris.has(iri)) services.canvas.addMarker(element, marker);
    }
  }

  /**
   * Remove an element's shape (and any connections touching it) from the canvas.
   *
   * This is the store-initiated path: the triples are assumed to be gone
   * already, so the delete hook is suppressed. Use {@link deleteFromCanvas} for
   * a deletion that starts on the canvas.
   */
  removeElement(iri: string): void {
    const services = this.services();
    if (!services) return;

    const shape = services.elementRegistry.get(iri);

    // Store-led: straight off the canvas, not through `modeling` — a command
    // here would land on the undo stack, and undoing it would bring back a shape
    // whose triples are gone.
    this.removingFromStore = true;
    try {
      if (shape) this.removeShapeDirect(shape);
    } finally {
      this.removingFromStore = false;
    }

    // Drop bookkeeping for relationships that touched the element, whether or
    // not diagram-js had a connection for them.
    for (const [key, relationship] of this.relationships) {
      if (relationship.sourceIri === iri || relationship.targetIri === iri) {
        this.relationships.delete(key);
      }
    }
  }

  /**
   * Delete an element from the canvas *and* from the RDF store.
   *
   * Goes through diagram-js's command stack so the removal is undoable and the
   * connected relationships are cleaned up; the resulting `shape.delete` hook
   * removes the triples.
   */
  deleteFromCanvas(iri: string): void {
    const services = this.services();
    const shape = services?.elementRegistry.get(iri);
    if (!services || !shape) {
      // Nothing drawn — still honour the intent against the store.
      this.elementManager.deleteElement(iri);
      this.eventBus.emit('element-deleted', { iri, elementIri: iri });
      return;
    }
    services.modeling.removeElements([shape]);
  }

  /**
   * Update an element's label, icon or bounds and redraw it.
   *
   * Deliberately not routed through the command stack: this is the store→canvas
   * direction (the model already changed), so it must not become an undoable
   * canvas edit that would then be written back again.
   */
  updateElement(
    iri: string,
    updates: Partial<Pick<CanvasElement, 'label' | 'iconUrl' | 'bounds'>> & { named?: boolean },
  ): void {
    const services = this.services();
    if (!services) return;

    const shape = services.elementRegistry.get(iri);
    if (!shape) return;

    const businessObject: RdfBusinessObject = shape.businessObject ?? { iri, typeIri: '' };
    if (updates.label !== undefined) {
      businessObject.label = updates.label;
      businessObject.named = updates.named ?? true;
    }
    if (updates.iconUrl !== undefined) businessObject.iconUrl = updates.iconUrl;
    shape.businessObject = businessObject;

    if (updates.bounds !== undefined) {
      shape.x = updates.bounds.x;
      shape.y = updates.bounds.y;
      shape.width = updates.bounds.width;
      shape.height = updates.bounds.height;
      // What moved: the context pad follows it, and its siblings are re-stacked.
      services.eventBus.fire('elements.changed', { elements: [shape] });
      return;
    }
    // Renamed only: redrawn alone — `elements.changed` re-inserts every sibling's
    // graphics to keep their order, 30 000 in a view of 10 000 (Task 22).
    services.eventBus.fire('element.changed', { element: shape });
  }

  /**
   * Draw a relationship between two elements.
   *
   * Both ends must already be on the canvas; without them there is nothing to
   * connect, and the relationship is recorded but not drawn so it appears once
   * the shapes arrive.
   */
  addRelationship(
    sourceIri: string,
    targetIri: string,
    typeIri: string,
    relationshipIri?: string,
    waypoints?: Point[],
  ): void {
    // A qualified relationship is keyed by its own IRI, so two relationships of
    // one type between one pair are two connections; a bare triple has only the
    // pair-and-type key.
    const key = relationshipIri ?? relationshipKey(sourceIri, targetIri, typeIri);
    const predicateIri = this.paletteDefinition.relationshipTypes.find(
      (rel) => rel.iri === typeIri,
    )?.unqualifiedPredicateIri;
    this.relationships.set(key, {
      sourceIri,
      targetIri,
      typeIri,
      predicateIri,
      relationshipIri,
    });

    const services = this.services();
    if (!services) return;
    if (services.elementRegistry.get(key)) return;

    const source = services.elementRegistry.get(sourceIri);
    const target = services.elementRegistry.get(targetIri);
    if (!source || !target) return;

    const businessObject: RdfBusinessObject = {
      iri: relationshipIri ?? key,
      typeIri,
      kind: 'relationship',
      ...(relationshipIri ? { ...this.relationshipNameOf(relationshipIri), ...this.derivationOf(relationshipIri) } : {}),
    };

    // Store-led, so added directly rather than through `modeling` (see
    // removeElement). The route is the persisted one when there is one, else
    // what the layouter would draw.
    const connection = services.elementFactory.createConnection({
      id: key,
      businessObject,
      source,
      target,
      waypoints: [],
    });
    connection.waypoints =
      waypoints && waypoints.length > 0
        ? this.drawnRoute(waypoints, source, target)
        : services.layouter.layoutConnection(connection, { source, target });
    services.canvas.addConnection(connection, services.canvas.getRootElement());
    this.applyKeptMarkers(connection);
  }

  /** Get all relationships on the canvas, keyed by connection id. */
  getRelationships(): Map<string, CanvasRelationship> {
    return new Map(this.relationships);
  }

  /**
   * Start a connection from an element, as the context pad's Connect entry does.
   *
   * Hands off to diagram-js's `connect` service, which owns the rubber-band
   * drag, the `connection.create` rule checks on hover and the
   * `modeling.connect` call on drop. `autoActivate` is what turns a *click* on
   * the pad button (as opposed to a drag off it) into an armed tool that follows
   * the mouse.
   */
  startConnect(source: ContextPadElement | string, event?: unknown, autoActivate?: boolean): void {
    const services = this.services();
    if (!services) return;

    const iri = typeof source === 'string' ? source : source.iri;
    const shape =
      (typeof source === 'string' ? undefined : (source.diagramElement as DjsShape | undefined)) ??
      services.elementRegistry.get(iri);
    if (!shape) return;

    // A click on the pad button carries no drag, so arm the tool; a dragstart
    // already is the drag and must not be auto-activated on top of it.
    services.connect.start(event ?? null, shape, autoActivate ?? isClickLike(event));
  }

  /**
   * Start a drag that creates a new element of `typeIri` where it is dropped.
   *
   * The palette's own gesture, and bpmn-js's `PaletteProvider` pattern: hand a
   * shape with no IRI to diagram-js's `create` service and let it own the
   * preview, the snapping and the drop position. The RDF element is minted inside
   * the resulting `shape.create` command, so the whole creation is one undoable
   * unit — see `rdf-modeling.ts`.
   *
   * `event` is required, and not merely for the start position: `Create.start`
   * always passes `autoActivate: true` to `dragging.init`, which immediately calls
   * `move(event)` → `toPoint(event)`. Handed nothing, that dereferences `null` and
   * throws before the drag exists.
   */
  startCreate(typeIri: string, event: unknown): void {
    const services = this.services();
    const shape = this.buildNewShape(typeIri);
    if (!services || !shape || !event) return;
    services.create.start(event, shape);
  }

  /**
   * Start an *append* drag: a new element of `typeIri`, plus a relationship to it
   * from `source`, wherever the drag is dropped.
   *
   * The `{ source }` hint is the whole mechanism. `Create` reads it, asks the
   * `connection.create` rule about the pair on every hover (so the drop is
   * refused when the metamodel forbids the relationship), and on drop routes
   * through `modeling.appendShape` rather than `modeling.createElements` —
   * which creates the shape and then calls {@link RdfModeling.connect}. Two model
   * changes, one command group.
   */
  startAppend(
    source: AppendMenuContext | ContextPadElement | string,
    typeIri: string,
    event: unknown,
  ): void {
    const services = this.services();
    const sourceShape = this.resolveShape(source);
    const shape = this.buildNewShape(typeIri);
    // `event` is required for the same reason as in {@link startCreate}.
    if (!services || !sourceShape || !shape || !event) return;
    services.create.start(event, shape, { source: sourceShape });
  }

  /**
   * Append a new element of `typeIri` to `source`, positioned automatically.
   *
   * The click half of the append gesture, where there is no drag to take a
   * position from. `AutoPlace.append` puts the shape a fixed distance to the
   * right of its source, then goes through the same `modeling.appendShape` —
   * so the relationship is created exactly as it is for the drag.
   *
   * @param relationshipTypeIri The relationship to create, when the user chose
   *   one; it is preferred for this append only, and — like any preference — only
   *   honoured when the metamodel permits it for the pair.
   * @return the appended shape, or `undefined` when nothing could be appended.
   */
  appendElement(
    source: AppendMenuContext | ContextPadElement | string,
    typeIri: string,
    relationshipTypeIri?: string,
  ): DjsShape | undefined {
    const services = this.services();
    const sourceShape = this.resolveShape(source);
    const shape = this.buildNewShape(typeIri);
    if (!services || !sourceShape || !shape) return undefined;
    const previous = this.ruleProvider.getPreferredType();
    if (relationshipTypeIri) this.ruleProvider.setPreferredType(relationshipTypeIri);
    try {
      return services.autoPlace.append(sourceShape, shape);
    } finally {
      if (relationshipTypeIri) this.ruleProvider.setPreferredType(previous);
      // No command runs when the append is refused; do not leave the menu open.
      services.popupMenu.close();
    }
  }

  /**
   * The element types the metamodel permits appending to `sourceTypeIri`.
   *
   * Derived, never listed: see
   * {@link import('./relationship-resolution.js').appendableTargetTypes} for how,
   * and {@link appendTargetCache} for why the answer is memoized.
   */
  appendTargets(sourceTypeIri: string): AppendTarget[] {
    const cached = this.appendTargetCache.get(sourceTypeIri);
    if (cached) return cached;

    const targets = appendableTargetTypes(
      this.paletteDefinition,
      this.classClosure,
      (source, target) => this.relationshipManager.getValidRelationships(source, target),
      sourceTypeIri,
      shapesOf(this.relationshipManager),
    );
    this.appendTargetCache.set(sourceTypeIri, targets);
    return targets;
  }

  /**
   * Ask for `typeIri` the next time a relationship is created.
   *
   * How picking a relationship type in the palette works. A relationship is not a
   * shape, so there is nothing to drag onto the canvas; instead the type is
   * recorded here and the connect tool is armed, and {@link RdfRuleProvider}
   * promotes that type whenever the metamodel permits it for the pair the user
   * actually connects. Because the promotion happens *after* the metamodel has
   * ruled, a preference for a forbidden type is simply ignored rather than
   * producing an invalid relationship.
   *
   * Cleared when diagram-js drops the connect tool, so the preference lasts for
   * the gesture the user asked for and no longer.
   */
  setPreferredRelationshipType(typeIri: string | undefined): void {
    this.ruleProvider.setPreferredType(typeIri);
  }

  /** The relationship type currently preferred over the metamodel's ranking. */
  preferredRelationshipType(): string | undefined {
    return this.ruleProvider.getPreferredType();
  }

  /**
   * "Realization is not permitted from Application Component to Application
   * Component. Permitted: Aggregation, …" — in the palette's words.
   */
  refusalMessage(refusal: RelationshipRefusal, sourceTypeIri: string, targetTypeIri: string): string {
    const palette = this.paletteDefinition;
    const elementLabel = (iri: string) =>
      palette.elementGroups.flatMap((group) => group.elements).find((element) => element.iri === iri)?.label ??
      fragmentLabel(iri);
    const relationshipLabel = (iri: string) =>
      palette.relationshipTypes.find((type) => type.iri === iri)?.label ?? fragmentLabel(iri);
    const what =
      `${relationshipLabel(refusal.typeIri)} is not permitted from ${elementLabel(sourceTypeIri)} ` +
      `to ${elementLabel(targetTypeIri)}.`;
    return refusal.permitted.length === 0
      ? `${what} No relationship is.`
      : `${what} Permitted: ${refusal.permitted.map((type) => type.label ?? relationshipLabel(type.iri)).join(', ')}.`;
  }

  /** Activate one of the canvas's global tools. */
  activateTool(tool: CanvasTool, event?: unknown): void {
    const services = this.services();
    if (!services) return;

    const autoActivate = isClickLike(event);
    switch (tool) {
      case 'connect':
        services.globalConnect.start(event ?? null, autoActivate);
        return;
      case 'lasso':
        services.lassoTool.activateSelection(event ?? null, autoActivate);
        return;
      case 'hand':
        services.handTool.activateHand(event ?? null, autoActivate);
        return;
    }
  }

  /**
   * Relationship types the metamodel allows between two element types.
   *
   * Exposed so a caller can inspect the offer without reaching for the manager
   * itself, and so the ranking it sees is exactly the one the canvas used. The
   * relationship-type menu resolves its own candidates the same way.
   */
  relationshipCandidates(sourceTypeIri: string, targetTypeIri: string): RelationshipTypeInfo[] {
    return this.relationshipManager.getValidRelationships(sourceTypeIri, targetTypeIri);
  }

  /**
   * Replace an existing connection's relationship type, undoably.
   *
   * Delegates to the `rdf.relationship.retype` command, so retracting the old
   * triple and asserting the new one is a single entry on diagram-js's command
   * stack: `commandStack.undo()` puts the previous type and its triple back.
   * The connection itself is kept — same diagram-js id, same waypoints — and
   * redrawn with the new notation.
   *
   * Returns `false` when the connection is unknown, the type is unchanged, or
   * the metamodel does not allow the type for the pair. Nothing is executed in
   * those cases, so nothing lands on the undo stack either.
   */
  changeRelationshipType(connectionId: string, typeIri: string): boolean {
    const services = this.services();
    const connection = services?.elementRegistry.get(connectionId);
    const existing = this.relationships.get(connectionId);
    if (!services || !connection || !existing) return false;
    if (existing.typeIri === typeIri) return false;

    const sourceType = services.elementRegistry.get(existing.sourceIri)?.businessObject?.typeIri;
    const targetType = services.elementRegistry.get(existing.targetIri)?.businessObject?.typeIri;
    if (!sourceType || !targetType) return false;

    const candidates = this.relationshipManager.getValidRelationships(sourceType, targetType);
    const chosen = candidates.find((candidate) => candidate.iri === typeIri);
    if (!chosen) return false;

    const context: RetypeRelationshipContext = {
      connection,
      from: {
        connectionId,
        sourceIri: existing.sourceIri,
        targetIri: existing.targetIri,
        typeIri: existing.typeIri,
        predicateIri: existing.predicateIri ?? existing.typeIri,
        candidates,
      },
      to: {
        connectionId,
        sourceIri: existing.sourceIri,
        targetIri: existing.targetIri,
        typeIri: chosen.iri,
        predicateIri: chosen.unqualifiedPredicateIri ?? chosen.iri,
        candidates,
      },
      fromRelationshipIri: existing.relationshipIri,
    };

    services.commandStack.execute(RETYPE_RELATIONSHIP_COMMAND, context);
    return true;
  }

  /**
   * Update the palette definition (e.g. after a metamodel load or viewpoint
   * change).
   *
   * Re-indexes the notation styles and redraws every element, so the switch is
   * visible immediately.
   *
   * ## Why nothing has to be re-rendered here
   *
   * The palette *DOM* is the sidebar's problem, not this class's: `palette-panel`
   * is a Lit component holding the definition as a reactive property, so it
   * re-renders itself. This used to be the place diagram-js's own `Palette` had
   * to be forced to rebuild — it builds its DOM only from `diagram.init` and
   * `registerProvider`, and the metamodel arrives after both — but that palette
   * is no longer registered.
   *
   * The provider-backed features need nothing either, because they build their
   * DOM per interaction rather than once:
   *
   * - `contextPad.open` → `_updateAndOpen` → `getEntries(target)` →
   *   `_getProviders()`, on every open.
   * - `popupMenu.open` → `_getContext` → `_getProviders`, likewise; and
   *   `isEmpty` re-asks too, so the pad's `replace`/`append` gating is current.
   *
   * The drawn shapes are the third case: `NotationStyleRegistry.update` above
   * re-indexes the styles, but a re-index paints nothing, so the
   * `elements.changed` fire is what makes the renderer repaint them.
   */
  /**
   * @param options.iconsOnly Only icons changed — what the menus show, nothing
   *   drawn: the shapes are not redrawn.
   */
  /**
   * Show relationships' names on their lines, or not (the canvas toolbar's
   * switch, off by default): every line is redrawn, alone — no re-stacking.
   */
  setRelationshipNamesShown(shown: boolean): void {
    if (this.renderOptions.relationshipNames === shown) return;
    this.renderOptions.relationshipNames = shown;
    const services = this.services();
    if (!services) return;
    for (const connection of this.connections()) services.eventBus.fire('element.changed', { element: connection });
  }

  /** Whether relationships' names are shown on their lines. */
  relationshipNamesShown(): boolean {
    return this.renderOptions.relationshipNames;
  }

  updatePaletteDefinition(paletteDefinition: PaletteDefinition, options: { iconsOnly?: boolean } = {}): void {
    this.paletteDefinition = paletteDefinition;
    // The palette is what the append offer is derived from, so every memoized
    // answer is now stale.
    this.appendTargetCache.clear();
    this.contextPadProvider.updatePaletteDefinition(paletteDefinition);
    if (options.iconsOnly) return;
    this.notationStyles.update(paletteDefinition);

    const services = this.services();
    if (!services) return;

    const elements = services.elementRegistry.getAll().filter((element) => element.parent);
    if (elements.length > 0) {
      services.eventBus.fire('elements.changed', { elements });
    }
  }

  /**
   * The drawn diagram as a standalone SVG document, cropped to its content —
   * what "export view as SVG/PNG" saves. Interaction chrome (hit areas,
   * outlines, bendpoint handles) is stripped.
   */
  toSvg(padding = 20): string {
    const services = this.services();
    const svg = this.container.querySelector('svg');
    if (!services || !svg) return '<svg xmlns="http://www.w3.org/2000/svg"/>';

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const element of services.elementRegistry.getAll()) {
      if (!element.parent) continue;
      // A copy: a line's own waypoints are not to be added to.
      const points = [
        ...(element.waypoints ?? [
          { x: element.x, y: element.y },
          { x: element.x + element.width, y: element.y + element.height },
        ]),
      ];
      // A line's name reaches past its route's box: the crop takes it in.
      const label = element.waypoints ? drawnConnectionLabel(element as never, this.renderOptions)?.box : undefined;
      if (label) {
        points.push({ x: label.x, y: label.y }, { x: label.x + label.width, y: label.y + label.height });
      }
      for (const p of points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    if (!Number.isFinite(minX)) {
      minX = 0;
      minY = 0;
      maxX = 100;
      maxY = 100;
    }
    const x = Math.floor(minX - padding);
    const y = Math.floor(minY - padding);
    const width = Math.ceil(maxX - minX + 2 * padding);
    const height = Math.ceil(maxY - minY + 2 * padding);

    const layer = svg.querySelector('.viewport')?.cloneNode(true) as Element | undefined;
    if (layer) {
      layer.removeAttribute('transform');
      for (const chrome of layer.querySelectorAll(
        '.djs-hit, .djs-outline, .djs-bendpoint, .djs-segment-dragger, .djs-dragger, .djs-resizer, .djs-context-pad',
      )) {
        chrome.remove();
      }
    }
    const defs = svg.querySelector('defs')?.outerHTML ?? '';
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}">` +
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#ffffff"/>` +
      `${defs}${layer?.innerHTML ?? ''}</svg>`
    );
  }

  /** Tear the diagram down and leave the host container empty. */
  destroy(): void {
    this.initialized = false;
    this.relationships.clear();
    this.appendTargetCache.clear();
    if (this.diagram) {
      this.diagram.destroy();
      this.diagram = null;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Delete whatever the context pad was opened on.
   *
   * The pad's element identity is an RDF IRI, which is also the diagram-js id
   * for a *shape* but not for a connection (whose id is generated by
   * `modeling.connect`). Prefer the diagram-js element the pad carries, so
   * deleting a connection removes the connection rather than looking up a
   * shape that does not exist.
   */
  private deleteFromPad(element: ContextPadElement): void {
    const services = this.services();
    const diagramElement = element.diagramElement as DjsShape | undefined;
    if (services && diagramElement && services.elementRegistry.get(diagramElement.id)) {
      services.modeling.removeElements([diagramElement]);
      return;
    }
    this.deleteFromCanvas(element.iri);
  }

  /**
   * A diagram-js shape for a *not yet existing* element of `typeIri`.
   *
   * Deliberately IRI-less: nothing has been written to RDF yet, and the empty
   * `iri` is exactly what `RdfElementBehavior` keys off to mint one when the
   * `shape.create` command runs. The `typeIri` is set, because the
   * `connection.create` rule consults it on every hover of an append drag to
   * decide whether the drop is allowed at all.
   *
   * Size comes from the notation when it publishes one, so the shape previews at
   * the size it will be created at.
   */
  private buildNewShape(typeIri: string): DjsShape | undefined {
    const services = this.services();
    if (!services || !typeIri) return undefined;

    const style = this.notationStyles.styleFor(typeIri);
    const declared = this.elementTypeInfo(typeIri);
    const width = style?.defaultWidth ?? NOTATION_DEFAULTS.width;
    const height = style?.defaultHeight ?? NOTATION_DEFAULTS.height;
    const businessObject: RdfBusinessObject = {
      iri: '',
      typeIri,
      label: declared?.label ?? this.notationStyles.labelFor(typeIri) ?? localName(typeIri),
      // A new element is named after its type — except one too small to show a
      // name (a junction), which would otherwise carry its type under it.
      named: labelFitsInside(width, height),
      kind: 'element',
      ...(declared?.iconUrl !== undefined ? { iconUrl: declared.iconUrl } : {}),
    };

    return services.elementFactory.createShape({ width, height, businessObject });
  }

  /** The palette's entry for an element type, when it publishes one. */
  private elementTypeInfo(typeIri: string): ElementTypeInfo | undefined {
    for (const group of this.paletteDefinition.elementGroups) {
      const found = group.elements.find((element) => element.iri === typeIri);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * Change an element's type to one of the loaded element types, as one
   * undoable step (`rdf.element.retype`). Its IRI, name, properties and
   * placements stay; a name that was the old type's default becomes the new
   * type's. Relationships the new type is not permitted in are named first
   * ({@link DiagramCanvasOptions.confirmRetypeElement}) and, if the user goes
   * ahead, kept — validation flags them; nothing is deleted.
   *
   * @returns Whether the type was changed.
   */
  async retypeElement(iri: string, typeIri: string): Promise<boolean> {
    const services = this.services();
    // In the open view, the change is a canvas command; otherwise (an element
    // selected in the tree) the same change is made in the store directly.
    const shape = services?.elementRegistry.get(iri);
    const shown = shape?.businessObject?.kind === 'element' ? shape.businessObject : undefined;
    const described = shown ? undefined : this.describeElement?.(iri);
    const fromTypeIri = shown?.typeIri ?? described?.typeIri;
    const name = shown?.label ?? described?.label;
    if (!fromTypeIri || fromTypeIri === typeIri) return false;
    const to = this.elementTypeInfo(typeIri);
    if (!to) return false;
    const fromLabel = this.elementTypeInfo(fromTypeIri)?.label ?? this.notationStyles.labelFor(fromTypeIri) ?? localName(fromTypeIri);

    const notPermitted = this.relationshipsNotPermitted(iri, typeIri);
    if (notPermitted.length > 0 && this.confirmRetypeElement) {
      const go = await this.confirmRetypeElement({
        iri,
        label: name ?? localName(iri),
        fromLabel,
        toLabel: to.label,
        notPermitted,
      });
      if (!go) return false;
    }

    // A name still the old type's default follows the type.
    const label = name === fromLabel ? to.label : undefined;
    const writeLabel = this.labelWriter();
    const RDF_TYPE = NAMESPACES.rdf + 'type';
    const apply = (): void => {
      const store = this.rdfStore;
      const old = ((store?.getQuads(namedNode(iri), namedNode(RDF_TYPE), namedNode(fromTypeIri)) ?? []) as Array<{
        graph: { termType: string };
      }>).filter((q) => q.graph.termType === 'DefaultGraph');
      if (old.length > 0) store?.removeQuads(old as never[]);
      store?.addQuads?.([DataFactory.quad(namedNode(iri), namedNode(RDF_TYPE), namedNode(typeIri)) as never]);
      if (label) writeLabel(iri, label);
    };
    if (!services || !shape || !shown) {
      apply();
      this.eventBus.emit('element-updated', { iri, typeIri });
      this.eventBus.emit('model-changed', { origin: 'properties', iri });
      return true;
    }
    const context: RetypeElementContext = {
      element: shape,
      typeIri,
      ...(to.iconUrl ? { iconUrl: to.iconUrl } : {}),
      ...(label ? { label } : {}),
      apply,
    };
    services.commandStack.execute(RETYPE_ELEMENT_COMMAND, context);
    this.eventBus.emit('element-updated', { iri, typeIri });
    return true;
  }

  /**
   * Open the right-click menu on an element or a relationship — selecting it,
   * unless it is one of several selected that can be moved to a folder
   * together — or on the canvas root, for the open view (clearing the
   * selection), at a point on the page.
   */
  openContextMenu(element: DjsShape, at: { x: number; y: number }): void {
    const services = this.services();
    if (!services) return;
    const onCanvas = element === services.canvas.getRootElement();
    if (onCanvas || this.selectedAlike(element).length < 2) {
      this.service<{ select(element: unknown): void }>('selection')?.select(onCanvas ? null : element);
    }
    this.contextMenuAt = at;
    services.popupMenu.open(element, CONTEXT_MENU_ID, at, { width: 240 });
  }

  /** The element-type menu on a shape, at a point on the page (the right-click menu's "Change type…"). */
  openElementTypeMenu(element: DjsShape, at: { x: number; y: number }): void {
    const services = this.services();
    if (!services || services.popupMenu.isEmpty(element, ELEMENT_REPLACE_MENU_ID)) return;
    services.popupMenu.open(element, ELEMENT_REPLACE_MENU_ID, at, { title: 'Change element type', width: 320, search: true });
  }

  /**
   * What the right-click menu offers for `target`: renaming and changing the
   * type, appending (elements), where to look at it (properties, tree, graph,
   * the questions about it; a relationship's ends), its IRI, and deleting it. On the canvas root, the
   * open view's: renaming it, its viewpoint, duplicating it, selecting
   * everything, zooming to fit, its properties, tree entry and IRI, and
   * deleting it — what the model tree offers for a view.
   */
  private contextMenuActions(target: unknown): ContextMenuAction[] {
    if (target && target === this.services()?.canvas.getRootElement()) return this.viewContextMenuActions();
    const element = target as DjsShape | undefined;
    const shown = element?.businessObject;
    if (!element || !shown?.iri) return [];
    const iri = shown.iri;
    // One of several selected: moving them to a folder together.
    const alike = this.selectedAlike(element);
    if (alike.length > 1) {
      const words = shown.kind === 'relationship' ? 'relationships' : 'elements';
      return [{ id: 'move-to-folder', label: `Move ${alike.length} ${words} to folder…`, section: 'edit', run: () => this.onContextAction?.('move-to-folder', iri) }];
    }
    const at = this.contextMenuAt ?? { x: 0, y: 0 };
    const pad = toContextPadElement(element as never);
    // A menu opened from this one's action would be closed with it: open it next.
    const then = (open: () => void) => () => void setTimeout(open, 0);
    const host = (action: CanvasContextAction) => () => this.onContextAction?.(action, iri);
    const actions: ContextMenuAction[] = [];

    if (shown.kind === 'element') {
      actions.push({
        id: 'rename',
        label: 'Rename',
        section: 'edit',
        shortcut: 'F2',
        run: () => this.service<{ activate(element: unknown): boolean }>('directEditing')?.activate(element),
      });
      if (!this.services()?.popupMenu.isEmpty(element, ELEMENT_REPLACE_MENU_ID)) {
        actions.push({ id: 'change-type', label: 'Change type…', section: 'edit', run: then(() => this.openElementTypeMenu(element, at)) });
      }
      if (this.canAppend(pad)) {
        actions.push({ id: 'append', label: 'Append…', section: 'relate', run: then(() => this.openAppendMenu(pad, { clientX: at.x, clientY: at.y })) });
      }
    } else if (shown.kind === 'relationship') {
      // Named on its line, as an element in its box; a derivation the model does not state is not (as in the model tree).
      if (isRenamable(element)) {
        actions.push({
          id: 'rename',
          label: 'Rename',
          section: 'edit',
          shortcut: 'F2',
          run: () => this.service<{ activate(element: unknown): boolean }>('directEditing')?.activate(element),
        });
      }
      if (this.canReplaceRelationshipType(pad)) {
        actions.push({
          id: 'change-type',
          label: 'Change relationship type…',
          section: 'edit',
          run: then(() => this.openRelationshipReplaceMenu(pad, { clientX: at.x, clientY: at.y })),
        });
      }
    }

    if (this.onContextAction && this.canMoveToFolder?.()) {
      actions.push({ id: 'move-to-folder', label: 'Move to folder…', section: 'edit', run: host('move-to-folder') });
    }
    if (this.onContextAction) {
      actions.push({ id: 'properties', label: 'Properties', section: 'show', run: host('properties') });
      actions.push({ id: 'reveal-tree', label: 'Show in model tree', section: 'show', run: host('reveal-tree') });
      if (shown.kind === 'element') {
        actions.push({ id: 'graph', label: 'Show relationship graph', section: 'show', run: host('graph') });
        actions.push({ id: 'ask', label: 'Ask about this element…', section: 'show', run: host('ask') });
      } else if (shown.kind === 'relationship') {
        actions.push({ id: 'show-source', label: 'Show source', section: 'show', run: host('show-source') });
        actions.push({ id: 'show-target', label: 'Show target', section: 'show', run: host('show-target') });
      }
      actions.push({ id: 'copy-iri', label: 'Copy IRI', section: 'copy', run: host('copy-iri') });
    }

    actions.push({
      id: 'delete',
      label: this.viewManager ? 'Delete from view' : 'Delete',
      section: 'delete',
      shortcut: 'Delete',
      run: () => this.deleteFromPad(pad),
    });
    if (this.viewManager) {
      actions.push({ id: 'delete-model', label: 'Delete from model…', section: 'delete', run: () => void this.deleteFromModel(iri) });
    }
    return actions;
  }

  /** The right-click menu on the empty canvas: the open view's actions, as the model tree offers them, and the canvas's. */
  private viewContextMenuActions(): ContextMenuAction[] {
    const viewIri = this.viewIri;
    const services = this.services();
    if (!viewIri || !services) return [];
    const host = (action: CanvasContextAction) => () => this.onContextAction?.(action, viewIri);
    const actions: ContextMenuAction[] = [];
    if (this.onContextAction) {
      actions.push(
        { id: 'rename-view', label: 'Rename view…', section: 'edit', run: host('rename-view') },
        { id: 'set-viewpoint', label: 'Set viewpoint…', section: 'edit', run: host('set-viewpoint') },
        { id: 'duplicate-view', label: 'Duplicate view', section: 'edit', run: host('duplicate-view') },
      );
    }
    actions.push(
      {
        id: 'select-all',
        label: 'Select all',
        section: 'view',
        run: () => {
          const root = services.canvas.getRootElement();
          const all = services.elementRegistry.getAll().filter((e) => e !== root && !(e as { labelTarget?: unknown }).labelTarget);
          this.service<{ select(elements: unknown): void }>('selection')?.select(all);
        },
      },
      {
        id: 'zoom-fit',
        label: 'Zoom to fit',
        section: 'view',
        run: () => this.service<{ zoom(value: string, center?: string): unknown }>('canvas')?.zoom('fit-viewport', 'auto'),
      },
    );
    if (this.onContextAction) {
      actions.push(
        { id: 'properties', label: 'View properties', section: 'show', run: host('properties') },
        { id: 'reveal-tree', label: 'Show in model tree', section: 'show', run: host('reveal-tree') },
        { id: 'copy-iri', label: 'Copy IRI', section: 'copy', run: host('copy-iri') },
        { id: 'delete-view', label: 'Delete view…', section: 'delete', run: host('delete-view') },
      );
    }
    return actions;
  }

  /**
   * The element's relationships that would not be permitted with `typeIri`,
   * as "Assignment → Cashier" (outgoing) or "Serving ← Till" (incoming).
   * Relationships to or from a relationship are not judged here.
   */
  private relationshipsNotPermitted(iri: string, typeIri: string): string[] {
    const relationships = this.relationshipManager.getRelationshipsOf?.(iri) ?? [];
    const lines: string[] = [];
    for (const relationship of relationships) {
      const outgoing = relationship.sourceIri === iri;
      const otherIri = outgoing ? relationship.targetIri : relationship.sourceIri;
      const other = this.describeElement?.(otherIri);
      const otherType = relationship.sourceIri === relationship.targetIri ? typeIri : other?.typeIri;
      if (!otherType || this.relationshipManager.getRelationship?.(otherIri)) continue;
      const [source, target] = outgoing ? [typeIri, otherType] : [otherType, typeIri];
      const permitted = this.relationshipManager.getValidRelationships(source, target).some((c) => c.iri === relationship.classIri);
      if (permitted) continue;
      const name = this.paletteDefinition.relationshipTypes.find((r) => r.iri === relationship.classIri)?.label ?? localName(relationship.classIri);
      lines.push(`${name} ${outgoing ? '→' : '←'} ${other?.label ?? localName(otherIri)}`);
    }
    return lines;
  }

  /** The diagram-js shape behind an IRI, a pad element or an append context. */
  private resolveShape(
    source: AppendMenuContext | ContextPadElement | string,
  ): DjsShape | undefined {
    const services = this.services();
    if (!services) return undefined;

    if (typeof source === 'string') return services.elementRegistry.get(source);

    const carried = (source as { diagramElement?: unknown }).diagramElement as
      | DjsShape
      | undefined;
    if (carried && services.elementRegistry.get(carried.id)) return carried;

    const iri = (source as AppendMenuContext).sourceIri ?? (source as ContextPadElement).iri;
    return iri ? services.elementRegistry.get(iri) : undefined;
  }

  /**
   * The RDF facts the append menu needs about a diagram-js shape.
   *
   * Returns `undefined` for a connection, a multi-element target, or anything
   * without a type — none of which can be the source of an append.
   */
  private resolveAppendContext(target: unknown): AppendMenuContext | undefined {
    if (!target || Array.isArray(target)) return undefined;

    const shape = target as DjsShape;
    if (shape.waypoints) return undefined;

    const businessObject = shape.businessObject;
    if (!businessObject?.iri || !businessObject.typeIri) return undefined;
    if (businessObject.kind === 'relationship') return undefined;

    return {
      sourceIri: businessObject.iri,
      sourceTypeIri: businessObject.typeIri,
      diagramElement: shape,
    };
  }

  /** Whether the append menu has any target to offer for a shape. */
  private canAppend(element: ContextPadElement): boolean {
    const services = this.services();
    const diagramElement = element.diagramElement;
    if (!services || !diagramElement) return false;
    return !services.popupMenu.isEmpty(diagramElement, APPEND_TARGET_MENU_ID);
  }

  /** Open the append-target menu under the context pad. */
  private openAppendMenu(element: ContextPadElement, event: unknown): void {
    const services = this.services();
    const diagramElement = element.diagramElement;
    if (!services || !diagramElement) return;

    this.appendMenuPosition = this.padMenuPosition(event);
    this.appendMenuProvider.startOn(diagramElement);
    services.popupMenu.open(diagramElement, APPEND_TARGET_MENU_ID, this.appendMenuPosition, {
      title: 'Append element',
      width: 300,
      search: true,
    });
  }

  /**
   * The relationships an element has in the model, with what is known about the
   * other end — the append menu's "Existing relationships" tab. Relationships to
   * relationships (an ArchiMate association may point at one) and to itself are
   * left out: there is no element to bring in.
   */
  existingRelationships(context: AppendMenuContext): ExistingRelationship[] {
    const services = this.services();
    const rows: ExistingRelationship[] = [];
    for (const rel of this.relationshipManager.getRelationshipsOf?.(context.sourceIri) ?? []) {
      const out = rel.sourceIri === context.sourceIri;
      const other = out ? rel.targetIri : rel.sourceIri;
      if (other === context.sourceIri || this.relationshipManager.getRelationship?.(other)) continue;
      const description = this.describeElement?.(other);
      const otherType = description?.typeIri
        ? this.paletteDefinition.elementGroups.flatMap((g) => g.elements).find((e) => e.iri === description.typeIri)
        : undefined;
      const typeLabel =
        this.paletteDefinition.relationshipTypes.find((r) => r.iri === rel.classIri)?.label ?? localName(rel.classIri);
      const iconUrl = description?.iconUrl ?? otherType?.iconUrl;
      rows.push({
        relationshipIri: rel.iri,
        typeLabel,
        direction: out ? 'out' : 'in',
        otherIri: other,
        otherLabel: description?.label ?? localName(other),
        ...(otherType ? { otherTypeLabel: otherType.label } : {}),
        ...(iconUrl ? { otherIconUrl: iconUrl } : {}),
        otherInView: Boolean(services?.elementRegistry.get(other)),
        drawn: Boolean(this.findConnection(rel.iri)),
      });
    }
    return rows;
  }

  /**
   * Bring the other end of an existing relationship into the view — beside the
   * source, right of it for an outgoing relationship and left for an incoming
   * one, at the first free spot — and draw the relationship. Placing an element
   * draws its relationships to what is already placed, so this is usually one
   * undoable step; an element already here only gets the relationship drawn.
   */
  showExistingRelationship(context: AppendMenuContext, row: ExistingRelationship): boolean {
    const services = this.services();
    const source = this.resolveShape(context);
    if (!services || !source || !this.viewIri) return false;
    try {
      if (!services.elementRegistry.get(row.otherIri)) {
        const shape = this.buildExistingShape(row.otherIri);
        if (!shape) return false;
        const gap = 60;
        const start = {
          x:
            row.direction === 'out'
              ? source.x + source.width + gap + shape.width / 2
              : source.x - gap - shape.width / 2,
          y: source.y + source.height / 2,
        };
        const at = findFreePosition(
          source as never,
          shape as never,
          start,
          generateGetNextPosition({ y: { margin: 30, minDistance: 20 } }),
        );
        if (!this.placeExisting(row.otherIri, at)) return false;
      }
      const drawn = this.drawExistingRelationship(row.relationshipIri);
      this.reveal(row.relationshipIri);
      return drawn;
    } finally {
      services.popupMenu.close();
    }
  }

  /** Where the append menu opened, so its second step opens in the same place. */
  private appendMenuPosition: { x: number; y: number } | undefined;

  /**
   * The append's second step: several specific relationships are permitted to
   * the chosen type, so ask which. Replaces the first menu in place.
   */
  private openAppendRelationshipMenu(context: AppendMenuContext, target: AppendTarget): void {
    const services = this.services();
    if (!services || !context.diagramElement) return;
    this.appendRelationshipMenuProvider.pending = { context, target };
    services.popupMenu.open(
      context.diagramElement,
      APPEND_RELATIONSHIP_MENU_ID,
      this.appendMenuPosition ?? this.padMenuPosition(undefined),
      {
        title: 'Which relationship?',
        width: 300,
        search: true,
      },
    );
  }

  /**
   * The RDF facts the replace menu needs about a diagram-js connection.
   *
   * Returns `undefined` for anything that is not a connection this canvas has a
   * relationship for, and for a multi-element target — the menu changes one
   * relationship at a time.
   */
  private resolveReplaceContext(target: unknown): RelationshipReplaceContext | undefined {
    if (!target || Array.isArray(target)) return undefined;

    const connection = target as DjsShape;
    const relationship = connection.id ? this.relationships.get(connection.id) : undefined;
    if (!relationship) return undefined;

    const services = this.services();
    const sourceTypeIri = services?.elementRegistry.get(relationship.sourceIri)?.businessObject
      ?.typeIri;
    const targetTypeIri = services?.elementRegistry.get(relationship.targetIri)?.businessObject
      ?.typeIri;
    if (!sourceTypeIri || !targetTypeIri) return undefined;

    return {
      connectionId: connection.id,
      sourceTypeIri,
      targetTypeIri,
      currentTypeIri: relationship.typeIri,
    };
  }

  /**
   * Whether the popup menu has more than one type to offer for a connection.
   *
   * This is what gates the context pad's `replace` entry, and it is asked of the
   * menu rather than of the metamodel so the two can never disagree.
   */
  private canReplaceRelationshipType(element: ContextPadElement): boolean {
    const services = this.services();
    const diagramElement = element.diagramElement;
    if (!services || !diagramElement) return false;
    return !services.popupMenu.isEmpty(diagramElement, RELATIONSHIP_REPLACE_MENU_ID);
  }

  /**
   * Open the relationship-type menu under the context pad.
   *
   * bpmn-js positions its replace menu off the *pad's* bounding rect rather than
   * off the pointer, so the menu appears attached to the button that opened it;
   * `ContextPad` renders that button inside `.djs-context-pad`, which is what is
   * measured here. `ContextPad#getPad` would give the same node but is deprecated
   * in diagram-js 14. Falls back to the pointer, then to the canvas origin, so a
   * synthetic trigger still opens the menu somewhere sane.
   */
  private openRelationshipReplaceMenu(element: ContextPadElement, event: unknown): void {
    const services = this.services();
    const diagramElement = element.diagramElement;
    if (!services || !diagramElement) return;

    services.popupMenu.open(
      diagramElement,
      RELATIONSHIP_REPLACE_MENU_ID,
      this.padMenuPosition(event),
      {
        title: 'Change relationship type',
        width: 300,
        // Only takes effect above five entries (PopupMenuComponent's own
        // threshold), which is where a flat list stops being scannable.
        search: true,
      },
    );
  }

  /** Where a pad-opened popup menu goes: just below the context pad. */
  private padMenuPosition(event: unknown): { x: number; y: number } {
    const PAD_OFFSET = 5;
    const services = this.services();
    const pad = services?.canvas.getContainer().querySelector('.djs-context-pad');

    if (pad) {
      const rect = pad.getBoundingClientRect();
      if (rect.width || rect.height || rect.left || rect.bottom) {
        return { x: rect.left, y: rect.bottom + PAD_OFFSET };
      }
    }

    const pointer = event as { x?: number; y?: number } | null | undefined;
    return { x: pointer?.x ?? 0, y: pointer?.y ?? 0 };
  }

  /**
   * Apply a pick made in the popup menu.
   *
   * Retyping executes a command, and `commandStack.changed` is one of the popup
   * menu's own auto-close events, so the menu normally closes itself. Picking the
   * type that is already in force executes nothing, so it is closed explicitly —
   * otherwise choosing "no change" would leave the menu open.
   */
  private applyRelationshipTypeChoice(connectionId: string, typeIri: string): void {
    this.changeRelationshipType(connectionId, typeIri);
    this.services()?.popupMenu.close();
  }

  /** Resolve a diagram-js service, or `undefined` once destroyed. */
  private service<T>(name: string): T | undefined {
    if (!this.diagram) return undefined;
    return (this.diagram as unknown as { get(n: string, strict?: boolean): T }).get(name, false) ?? undefined;
  }

  /** All diagram-js services at once, or `null` once destroyed. */
  private services(): DjsServices | null {
    if (!this.diagram) return null;
    const get = <T>(name: string): T =>
      (this.diagram as unknown as { get(n: string): T }).get(name);
    return {
      canvas: get('canvas'),
      elementFactory: get('elementFactory'),
      elementRegistry: get('elementRegistry'),
      modeling: get('modeling'),
      eventBus: get('eventBus'),
      commandStack: get('commandStack'),
      layouter: get('layouter'),
      contextPad: get('contextPad'),
      popupMenu: get('popupMenu'),
      keyboard: get('keyboard'),
      selection: get('selection'),
      connect: get('connect'),
      globalConnect: get('globalConnect'),
      create: get('create'),
      autoPlace: get('autoPlace'),
      lassoTool: get('lassoTool'),
      handTool: get('handTool'),
    };
  }

  /** Every drawn shape (root and connections excluded). */
  private shapes(): DjsShape[] {
    const services = this.services();
    if (!services) return [];
    return services.elementRegistry
      .getAll()
      .filter((element) => element.parent && !element.waypoints);
  }

  /** Every drawn connection. */
  private connections(): DjsShape[] {
    const services = this.services();
    if (!services) return [];
    return services.elementRegistry.getAll().filter((element) => element.parent && element.waypoints);
  }

  /**
   * The connection drawing a relationship, by the relationship's IRI: its id,
   * or one of the few otherwise named — not a scan of the canvas, which made
   * drawing a view of thousands quadratic (Task 22).
   */
  private findConnection(relationshipIri: string): DjsShape | undefined {
    const services = this.services();
    if (!services) return undefined;
    const byId = services.elementRegistry.get(relationshipIri);
    if (byId) return byId;
    for (const c of this.otherwiseNamed) if (c.businessObject?.iri === relationshipIri && services.elementRegistry.get(c.id)) return c;
    return undefined;
  }

  /** Remove a connection without a command (store-led). */
  private removeConnectionDirect(connection: DjsShape): void {
    const services = this.services();
    if (!services || !services.elementRegistry.get(connection.id)) return;
    services.canvas.removeConnection(connection);
    this.relationships.delete(connection.id);
  }

  /**
   * Remove a shape and every connection touching it, without a command
   * (store-led). What was drawn inside it moves out to its container first:
   * removing a shape takes the graphics of its children with it.
   */
  private removeShapeDirect(shape: DjsShape): void {
    const services = this.services();
    if (!services || !services.elementRegistry.get(shape.id)) return;
    for (const connection of [...(shape.incoming ?? []), ...(shape.outgoing ?? [])]) {
      this.removeConnectionDirect(connection);
    }
    const container = (shape.parent as DjsShape | undefined) ?? (services.canvas.getRootElement() as DjsShape);
    for (const child of [...(shape.children ?? [])].filter((c) => !c.waypoints)) this.reparentDirect(child, container);
    services.canvas.removeShape(shape);
  }

  /** The shape an element is drawn inside — the element's, when drawn — else the diagram. */
  private containerFor(parentIri: string | undefined): DjsShape {
    const services = this.services()!;
    const parent = parentIri ? (services.elementRegistry.get(parentIri) as DjsShape | undefined) : undefined;
    return parent && !parent.waypoints ? parent : (services.canvas.getRootElement() as DjsShape);
  }

  /**
   * Move a shape into another container without a command (store-led: a
   * collaborator's nesting, an import). diagram-js moves the graphics on
   * `elements.changed`, as its own commands have it do.
   */
  private reparentDirect(shape: DjsShape, container: DjsShape): void {
    const services = this.services();
    const previous = shape.parent as DjsShape | undefined;
    if (!services || previous === container) return;
    const at = previous?.children?.indexOf(shape) ?? -1;
    if (at >= 0) previous!.children!.splice(at, 1);
    (container.children ??= []).push(shape);
    shape.parent = container;
    services.eventBus.fire('elements.changed', { elements: [shape, ...(previous ? [previous] : []), container] });
  }

  /** Remove everything drawn, without commands. */
  private clearDiagram(): void {
    const services = this.services();
    if (!services) return;
    try {
      services.popupMenu.close();
    } catch {
      /* nothing open */
    }
    services.selection.select(null);
    this.removingFromStore = true;
    try {
      for (const connection of this.connections()) this.removeConnectionDirect(connection);
      for (const shape of this.shapes()) this.removeShapeDirect(shape);
    } finally {
      this.removingFromStore = false;
    }
    this.relationships.clear();
  }

  /** Re-apply the viewpoint marker to every shape. */
  private applyViewpointMarkers(): void {
    const services = this.services();
    if (!services) return;
    for (const shape of this.shapes()) {
      const typeIri = shape.businessObject?.typeIri;
      const outside = Boolean(this.viewpointFilter && typeIri && !this.viewpointFilter(typeIri));
      const has = services.canvas.hasMarker(shape, OUTSIDE_VIEWPOINT_MARKER);
      if (outside && !has) services.canvas.addMarker(shape, OUTSIDE_VIEWPOINT_MARKER);
      if (!outside && has) services.canvas.removeMarker(shape, OUTSIDE_VIEWPOINT_MARKER);
    }
  }

  /** A shape for an element that exists in the model, to be placed in the view. */
  private buildExistingShape(iri: string): DjsShape | undefined {
    const services = this.services();
    const description = this.describeElement?.(iri);
    if (!services || !description?.typeIri) return undefined;
    const style = this.notationStyles.styleFor(description.typeIri);
    const businessObject: RdfBusinessObject = {
      iri,
      typeIri: description.typeIri,
      label: description.label ?? localName(iri),
      named: description.named ?? description.label !== undefined,
      kind: 'element',
      placeExisting: true,
      ...(description.iconUrl ? { iconUrl: description.iconUrl } : {}),
    };
    return services.elementFactory.createShape({
      id: iri,
      width: style?.defaultWidth ?? NOTATION_DEFAULTS.width,
      height: style?.defaultHeight ?? NOTATION_DEFAULTS.height,
      businessObject,
    });
  }

  /**
   * After a drop into a container: ask which relationship the nesting stands
   * for — of those the notation lets nesting draw and the metamodel permits
   * between the two — unless the model already relates them so, or none fits.
   */
  private offerNesting(inner: DjsShape, outer: DjsShape): void {
    const services = this.services();
    const innerObject = inner.businessObject;
    const outerObject = outer.businessObject;
    if (!services || !innerObject?.iri || !outerObject?.iri || inner.parent !== outer) return;
    const innerEnd = { iri: innerObject.iri, typeIri: innerObject.typeIri };
    const outerEnd = { iri: outerObject.iri, typeIri: outerObject.typeIri };
    const existing = (this.relationshipManager.getRelationshipsOf?.(innerEnd.iri) ?? []).filter(
      (r) => r.sourceIri === outerEnd.iri || r.targetIri === outerEnd.iri,
    );
    const types = this.paletteDefinition.relationshipTypes;
    if (nestingShownBy(outerEnd, innerEnd, types, existing)) return;
    const offers = nestingOffers(
      outerEnd,
      innerEnd,
      types,
      (source, target) => this.relationshipManager.getValidRelationships(source, target),
      existing,
    );
    if (offers.length === 0) return;
    const outerLabel = outerObject.label ?? localName(outerEnd.iri);
    this.nestMenuProvider.pending = { outerLabel, innerLabel: innerObject.label ?? localName(innerEnd.iri), offers };
    const box = services.elementRegistry.getGraphics(inner)?.getBoundingClientRect?.();
    services.popupMenu.open(inner, NEST_MENU_ID, box ? { x: box.left, y: box.bottom + 4 } : { x: 0, y: 0 }, {
      title: 'Which relationship?',
      width: 300,
    });
  }

  /** The relationship picked for a nesting, created in the model — undoably, and not drawn: the nesting shows it. */
  private nestAs(offer: NestingOffer | undefined): void {
    this.services()?.popupMenu.close();
    this.nestMenuProvider.pending = undefined;
    const create = this.relationshipManager.createQualifiedRelationship?.bind(this.relationshipManager);
    if (!offer || !create) return;
    const modelIri = this.modelIri;
    this.recordChange(() => {
      create({
        typeIri: offer.type.iri,
        ...(offer.type.unqualifiedPredicateIri && offer.type.unqualifiedPredicateIri !== offer.type.iri
          ? { predicateIri: offer.type.unqualifiedPredicateIri }
          : {}),
        sourceIri: offer.sourceIri,
        targetIri: offer.targetIri,
        ...(modelIri ? { modelIri } : {}),
      });
    });
  }

  /**
   * Run a change made outside the canvas — a property edited in the panel — as
   * one undoable step on the canvas's command stack, so undo and redo take it
   * back with the rest. False when there is no open view to record it on: the
   * change is then made as it is, and is not undoable.
   */
  recordChange(apply: () => void): boolean {
    const services = this.services();
    if (!services || !this.viewIri || !this.changeStore) {
      apply();
      return false;
    }
    const context: RdfChangeContext = { apply };
    services.commandStack.execute(RDF_STORE_EDIT_COMMAND, context);
    return true;
  }

  /**
   * Run a model operation as a nested, recorded command (see
   * `RdfChangeHandler`). Only legal from a command-stack pre/postExecute hook,
   * which is the only place it is called from.
   */
  private change(apply: () => void): void {
    const services = this.services();
    if (!services) return;
    const context: RdfChangeContext = { apply };
    services.commandStack.execute(RDF_CHANGE_COMMAND, context);
  }

  /** Whether edits should go to a view (as opposed to the legacy element-level path). */
  private hasViewContext(): boolean {
    return Boolean(this.viewManager && this.viewIri);
  }

  /** A connection's route, rounded, as persisted. */
  private routeOf(connection: DjsShape): Point[] {
    return (connection.waypoints ?? []).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  }

  /** Persist a connection's route to the open view, as a recorded change. */
  private writeRoute(connection: DjsShape | undefined): void {
    const relationshipIri = connection?.businessObject?.iri;
    const viewIri = this.viewIri;
    const viewManager = this.viewManager;
    if (!connection || !relationshipIri || !viewIri || !viewManager) return;
    // Drawn in this view: what the view shows, kept as its shapes move — not
    // every link of it read again after each move (Task 22).
    const placedIn = (viewManager as { placedIn?(viewIri: string): ReadonlySet<string> }).placedIn;
    const drawn = placedIn
      ? placedIn.call(viewManager, viewIri).has(relationshipIri)
      : viewManager.getLinks(viewIri).some((l) => l.relationshipIri === relationshipIri);
    if (!drawn) return;
    const route = this.routeOf(connection);
    this.change(() => viewManager.updateLinkWaypoints(viewIri, relationshipIri, route));
  }

  /**
   * After an existing element is placed, draw its relationships to every
   * element already in the view — what users of Archi expect, and what makes
   * "add to view" useful for exploring a model.
   */
  /** What a relationship's connection carries of its derivation: nothing for one the model states. */
  /** A relationship's own name, for its line: none when the model gives it none. */
  private relationshipNameOf(relationshipIri: string): Pick<RdfBusinessObject, 'label' | 'named'> {
    const name = this.describeElement?.(relationshipIri)?.modelName;
    return name ? { label: name, named: true } : {};
  }

  private derivationOf(relationshipIri: string): Pick<RdfBusinessObject, 'derivation' | 'derivationRule'> {
    const description = this.describeElement?.(relationshipIri);
    if (!description?.derivation) return {};
    return { derivation: description.derivation, ...(description.derivationRule ? { derivationRule: description.derivationRule } : {}) };
  }

  private drawRelationshipsOf(shape: DjsShape): void {
    const services = this.services();
    const iri = shape.businessObject?.iri;
    if (!services || !iri || !this.relationshipManager.getRelationshipsOf) return;
    // Then those ending on a relationship just drawn, and so on.
    const ends = [iri];
    for (let at = 0; at < ends.length; at++) {
      this.drawRelationshipsAt(ends[at], ends);
    }
  }

  /** Draw the relationships at one end that both ends allow; note each drawn in `drawn`. */
  private drawRelationshipsAt(iri: string, drawn: string[]): void {
    const services = this.services();
    if (!services || !this.relationshipManager.getRelationshipsOf) return;
    for (const rel of this.relationshipManager.getRelationshipsOf(iri)) {
      if (this.findConnection(rel.iri)) continue;
      // A derivation the model does not state is drawn when asked for, not with its ends.
      if (this.describeElement?.(rel.iri)?.derivation) continue;
      const source = services.elementRegistry.get(rel.sourceIri);
      const target = services.elementRegistry.get(rel.targetIri);
      if (!source || !target) continue;
      const typeIri = this.describeElement?.(rel.iri)?.typeIri ?? rel.classIri;
      const businessObject: RdfBusinessObject = { iri: rel.iri, typeIri, kind: 'relationship', ...this.relationshipNameOf(rel.iri) };
      services.modeling.createConnection(
        source,
        target,
        { id: rel.iri, businessObject },
        services.canvas.getRootElement(),
        // Draw, do not create: the relationship is already in the model.
        { [RDF_EXISTING_RELATIONSHIP_HINT]: rel.iri },
      );
      this.relationships.set(rel.iri, {
        sourceIri: rel.sourceIri,
        targetIri: rel.targetIri,
        typeIri,
        predicateIri: rel.predicateIri,
        relationshipIri: rel.iri,
      });
      drawn.push(rel.iri);
    }
  }

  /** Give the diagram its single root element so shapes have a parent. */
  private initRoot(): void {
    const services = this.services();
    if (!services) return;
    const root = services.elementFactory.createRoot({ id: ROOT_ID });
    services.canvas.setRootElement(root);
  }

  /** Contribute the context-pad and popup-menu providers. */
  private registerProviders(): void {
    const services = this.services();
    if (!services) return;
    services.contextPad.registerProvider(this.contextPadProvider);
    services.popupMenu.registerProvider(
      RELATIONSHIP_REPLACE_MENU_ID,
      this.replaceMenuProvider,
    );
    services.popupMenu.registerProvider(ELEMENT_REPLACE_MENU_ID, this.elementReplaceMenuProvider);
    services.popupMenu.registerProvider(CONTEXT_MENU_ID, this.contextMenuProvider);
    services.commandStack.registerHandler(RETYPE_ELEMENT_COMMAND, RetypeElementHandler);
    services.popupMenu.registerProvider(APPEND_TARGET_MENU_ID, this.appendMenuProvider);
    services.popupMenu.registerProvider(APPEND_RELATIONSHIP_MENU_ID, this.appendRelationshipMenuProvider);
    services.popupMenu.registerProvider(NEST_MENU_ID, this.nestMenuProvider);
    services.popupMenu.registerProvider(PAIR_CONNECT_MENU_ID, this.pairConnectMenuProvider);
  }

  /** The two selected elements a pair menu was opened on, or nothing. */
  private resolvePair(target: unknown): PairConnectContext | undefined {
    if (!Array.isArray(target) || target.length !== 2) return undefined;
    const ends: PairEnd[] = [];
    for (const shape of target as DjsShape[]) {
      const shown = shape?.businessObject;
      if (!shown || shown.kind !== 'element' || !shown.iri || !shown.typeIri) return undefined;
      ends.push({ shapeId: shape.id, iri: shown.iri, typeIri: shown.typeIri, label: shown.label ?? localName(shown.iri) });
    }
    return { a: ends[0], b: ends[1] };
  }

  /**
   * Create the relationship picked in the pair menu, and draw it: the same
   * `modeling.connect` a connect drag ends in, so it is one undoable step and
   * the RDF is written by the same command.
   */
  private connectPair(source: PairEnd, target: PairEnd, candidate: RelationshipTypeInfo): void {
    const services = this.services();
    const from = services?.elementRegistry.get(source.shapeId);
    const to = services?.elementRegistry.get(target.shapeId);
    if (!services || !from || !to) return;
    services.modeling.connect(from, to, {
      typeIri: candidate.iri,
      ...(candidate.unqualifiedPredicateIri ? { unqualifiedPredicateIri: candidate.unqualifiedPredicateIri } : {}),
      typeLabel: candidate.label,
    });
  }

  /**
   * Give diagram-js's `keyboard` a node to listen on.
   *
   * `Keyboard` binds itself from an `attach` event, which `BaseViewer` in bpmn-js
   * fires and plain diagram-js never does — so `config.keyboard.bindTo` on its
   * own leaves undo/redo unbound. Binding here is what actually makes Ctrl+Z,
   * Ctrl+Y, Ctrl+± and Delete reach `editorActions`. `diagram.destroy` unbinds.
   */
  private bindKeyboard(node: EventTarget | null): void {
    if (!node) return;
    this.services()?.keyboard.bind(node);
  }

  /**
   * Stop diagram-js's `keyboard` from stealing keystrokes aimed at a text field
   * inside a shadow root.
   *
   * ## The bug this fixes
   *
   * `Keyboard._isEventIgnored` decides whether a key belongs to the editor by
   * asking `isInput(event.target)`. That works while every input is in the light
   * DOM — which is the case in bpmn-js, and the assumption upstream is built on.
   *
   * Every panel in this app is a Lit component, so its inputs live in a shadow
   * root, and `keyboard` is bound to `document`. A `keydown` inside a shadow root
   * is **retargeted** by the time it reaches the document: `event.target` is the
   * *host* element — `<palette-panel>`, `<sparql-editor>` — not the `<input>`.
   * `isInput` therefore says "no", the key is treated as an editor shortcut, and
   * `editorActions` claims it. Backspace and Delete are bound to
   * `removeSelection`, so `_keyHandler` calls `preventDefault()` on the DOM event
   * and the browser never edits the text: characters could not be deleted from the
   * palette's search box at all, and the same held for the property panel's
   * editors and the SPARQL editor.
   *
   * ## The fix
   *
   * `event.composedPath()` reports the path *before* retargeting, so the real
   * originating element is visible there. A high-priority listener that returns
   * `false` when the path contains an editable element makes `EventBus.fire`
   * return `false`, and `_keyHandler` then skips its `preventDefault()` — leaving
   * the keystroke to the field, which is where it was aimed.
   *
   * ## One deliberate deviation from upstream
   *
   * diagram-js lets Cmd/Ctrl combinations through from an input
   * (`_isModifiedKeyIgnored`), so stock behaviour is that Ctrl+Z typed into a
   * textarea undoes a *diagram* command. This guard suppresses modified keys too.
   * In an app whose panels are all text editors, Ctrl+Z in the SPARQL editor
   * undoing someone's last shape move is a bug, not a shortcut.
   */
  private guardKeyboardAgainstShadowInputs(): void {
    const keyboard = this.services()?.keyboard;
    if (!keyboard) return;

    const guard = (context: { keyEvent?: KeyboardEvent }): false | undefined =>
      isEditableEventTarget(context.keyEvent) ? false : undefined;

    // Above `editorActions`' own bindings, which register at default priority.
    keyboard.addListener(KEYBOARD_GUARD_PRIORITY, guard, 'keyboard.keydown');
    keyboard.addListener(KEYBOARD_GUARD_PRIORITY, guard, 'keyboard.keyup');
  }

  /**
   * Hook diagram-js's command stack and selection so canvas-side edits reach
   * the RDF store and the rest of the UI.
   */
  private wireDiagramEvents(): void {
    const services = this.services();
    if (!services) return;
    const djs = services.eventBus;

    djs.on('connection.added', (event: { element: DjsShape }) => {
      if (event.element.id !== event.element.businessObject?.iri) this.otherwiseNamed.add(event.element);
    });
    djs.on('connection.removed', (event: { element: DjsShape }) => this.otherwiseNamed.delete(event.element));

    // Right-click on an element or a relationship: select it, and open the
    // context menu at the pointer instead of the browser's; on the empty
    // canvas, the open view's menu.
    //
    // Over a line, diagram-js draws its segment and bendpoint handles in the
    // overlays layer, on top of it, and they belong to no diagram element: a
    // right-click there reaches the root. Their group names the line.
    djs.on('element.contextmenu', 1500, (event: { element?: DjsShape; originalEvent?: MouseEvent }) => {
      const root = this.services()?.canvas.getRootElement();
      let element = event.element;
      if (element && element === root) {
        const handles = (event.originalEvent?.target as Element | null)?.closest?.('.djs-bendpoints[data-element-id]');
        const line = handles ? this.services()?.elementRegistry.get(handles.getAttribute('data-element-id') ?? '') : undefined;
        if (line) element = line;
      }
      const shown = element?.businessObject;
      const onConcept = Boolean(shown?.iri) && (shown?.kind === 'element' || shown?.kind === 'relationship');
      const onCanvas = element === root && Boolean(this.viewIri);
      if (!element || (!onConcept && !onCanvas)) return undefined;
      event.originalEvent?.preventDefault();
      this.openContextMenu(element, { x: event.originalEvent?.clientX ?? 0, y: event.originalEvent?.clientY ?? 0 });
      return false;
    });

    // Which global tool is armed. `ToolManager` is the only honest source: the
    // tools deactivate themselves when their gesture completes, `Escape` cancels
    // them, and re-activating the armed tool toggles it off — none of which a
    // toolbar watching its own clicks would see. The three tool modules already
    // depend on `tool-manager`, so nothing extra is registered for this.
    djs.on('tool-manager.update', (event: { tool?: string | null }) => {
      const tool = toolFromManagerName(event?.tool);
      // A preselected relationship type belongs to the connect gesture that
      // asked for it. diagram-js drops the tool on `connect.ended` /
      // `connect.canceled` at LOW_PRIORITY — after the `connect.end` handler has
      // already run `modeling.connect` — so the preference is still in force when
      // the rules are consulted, and gone by the next gesture.
      if (tool !== 'connect') this.ruleProvider.setPreferredType(undefined);
      this.onToolChanged?.(tool);
    });

    // A relationship type picked in the palette is required (RdfRuleProvider):
    // released on an element the pair does not permit it for, the drag creates
    // nothing — so say why, and what the pair does permit. Ahead of `Connect`'s
    // own handler, while the preference is still in force; diagram-js keeps the
    // ends of a refused pair in `start` and `hover`.
    djs.on('connect.end', 1500, (event: { context?: RefusedConnectContext }) => {
      const context = event.context;
      if (!context || context.canExecute) return;
      const sourceType = context.start?.businessObject?.typeIri;
      const targetType = context.hover?.businessObject?.typeIri;
      if (!sourceType || !targetType || context.hover?.waypoints) return;
      const refusal = this.ruleProvider.refusal(sourceType, targetType);
      if (refusal) this.onNotice?.(this.refusalMessage(refusal, sourceType, targetType), 'warning');
    });

    // Layout is the canvas's own state, so it is the one thing written back.
    //
    // With views, as a nested recorded change inside the move/resize command, so
    // undoing the move puts the old bounds back in the store too. Without, the
    // legacy element-level sink, after the fact.
    djs.on(
      ['commandStack.shape.move.postExecute', 'commandStack.shape.resize.postExecute'],
      (event: { context?: { shape?: DjsShape } }) => {
        const shape = event.context?.shape;
        if (shape && this.hasViewContext()) this.writeLayout(shape);
      },
    );
    djs.on(
      ['commandStack.shape.move.postExecuted', 'commandStack.shape.resize.postExecuted'],
      (event: { context?: { shape?: DjsShape } }) => {
        const shape = event.context?.shape;
        if (shape && !this.hasViewContext()) this.writeLayout(shape);
      },
    );

    // Routes: whenever diagram-js lays a connection out or the user bends it.
    djs.on(
      [
        'commandStack.connection.create.postExecute',
        'commandStack.connection.layout.postExecute',
        'commandStack.connection.updateWaypoints.postExecute',
        'commandStack.connection.move.postExecute',
      ],
      (event: { context?: { connection?: DjsShape } }) => {
        if (this.hasViewContext()) this.writeRoute(event.context?.connection);
      },
    );

    // Reattaching a connection end moves the relationship in the model: its
    // ends, its unqualified triple, and its links in other views. Nested, so
    // undoing the reconnect restores all of it.
    djs.on(
      'commandStack.connection.reconnect.postExecute',
      (event: { context?: { connection?: DjsShape } }) => {
        const connection = event.context?.connection;
        const relIri = connection?.businessObject?.iri;
        const sourceIri = connection?.source?.businessObject?.iri;
        const targetIri = connection?.target?.businessObject?.iri;
        const reconnect = this.relationshipManager.reconnectRelationship;
        if (!relIri || !sourceIri || !targetIri || !reconnect || !this.viewManager) return;
        const viewManager = this.viewManager;
        this.change(() => {
          this.relationshipManager.reconnectRelationship?.(relIri, sourceIri, targetIri);
          viewManager.refreshLinksOf?.(relIri);
        });
      },
    );
    // Keep the canvas's relationship record in step, both ways.
    djs.on(
      ['commandStack.connection.reconnect.executed', 'commandStack.connection.reconnect.reverted'],
      (event: { context?: { connection?: DjsShape } }) => {
        const connection = event.context?.connection;
        const record = connection ? this.relationships.get(connection.id) : undefined;
        const sourceIri = connection?.source?.businessObject?.iri;
        const targetIri = connection?.target?.businessObject?.iri;
        if (record && sourceIri && targetIri) {
          record.sourceIri = sourceIri;
          record.targetIri = targetIri;
        }
      },
    );

    // Deleting on the canvas deletes from the *view*: the node or link goes,
    // the concept stays in the model. Nested, so undo restores the geometry.
    djs.on('commandStack.shape.delete.preExecute', (event: { context?: { shape?: DjsShape } }) => {
      const shape = event.context?.shape;
      const iri = shape?.businessObject?.iri;
      const viewIri = this.viewIri;
      const viewManager = this.viewManager;
      if (!iri || !viewIri || !viewManager || this.removingFromStore) return;
      this.change(() => viewManager.removeElementFromView(viewIri, iri));
    });
    djs.on(
      'commandStack.connection.delete.preExecute',
      (event: { context?: { connection?: DjsShape } }) => {
        const iri = event.context?.connection?.businessObject?.iri;
        const viewIri = this.viewIri;
        const viewManager = this.viewManager;
        if (!iri || !viewIri || !viewManager || this.removingFromStore) return;
        this.change(() => viewManager.removeRelationshipFromView(viewIri, iri));
      },
    );

    // An existing element dropped into the view: draw its relationships to what
    // is already here, in the same undo step.
    djs.on('commandStack.shape.create.postExecute', (event: { context?: { shape?: DjsShape } }) => {
      const shape = event.context?.shape;
      if (shape?.businessObject?.placeExisting && this.hasViewContext()) {
        delete shape.businessObject.placeExisting;
        this.drawRelationshipsOf(shape);
      }
    });

    // Collaboration locks: deny the edit rules for anything another user holds.
    // Registered above the metamodel rules so a lock always wins.
    djs.on(
      LOCKED_ACTIONS.map((action) => `commandStack.${action}.canExecute`),
      3000,
      (event: { context?: Record<string, unknown> }) => {
        if (this.locked.size === 0) return undefined;
        const ctx = event.context ?? {};
        const elements = [
          ...((ctx['shapes'] as DjsShape[] | undefined) ?? []),
          ...((ctx['elements'] as DjsShape[] | undefined) ?? []),
          ...(ctx['shape'] ? [ctx['shape'] as DjsShape] : []),
          ...(ctx['connection'] ? [ctx['connection'] as DjsShape] : []),
        ];
        return elements.some((e) => e.businessObject?.iri && this.locked.has(e.businessObject.iri)) ? false : undefined;
      },
    );

    // A change made outside the canvas, undone or redone: no shape command
    // carries it back, so the canvas redraws from the store once it settles.
    let storeEdited = false;
    djs.on([`commandStack.${RDF_STORE_EDIT_COMMAND}.executed`, `commandStack.${RDF_STORE_EDIT_COMMAND}.reverted`], () => {
      storeEdited = true;
    });

    // Every command changes the model; tell the rest of the app once it settles.
    // Clearing the stack (a view opened) changes nothing.
    djs.on('commandStack.changed', (event: { trigger?: string }) => {
      if (event.trigger === 'clear') return;
      if (storeEdited) {
        storeEdited = false;
        this.syncFromStore();
      }
      this.eventBus.emit('model-changed', { origin: 'canvas', viewIri: this.viewIri });
    });

    // Nesting. The container an element is created in is written with it — after
    // the element's own node (`rdf.element.create`, at the default priority); a
    // move writes its container with its bounds (`writeLayout`).
    djs.on('commandStack.shape.create.postExecute', 500, (event: { context?: { shape?: DjsShape } }) => {
      const shape = event.context?.shape;
      if (shape && this.hasViewContext() && containerIri(shape)) this.writeLayout(shape);
    });
    // The containers on both sides are redrawn — a container's name moves to its
    // top once something is inside it — and a drop into an element asks which
    // relationship the nesting stands for, once the command has settled.
    let nested: { inner: DjsShape; outer: DjsShape } | undefined;
    const redraw = (...containers: Array<DjsShape | undefined>) => {
      const elements = containers.filter((c): c is DjsShape => c?.businessObject?.kind === 'element');
      if (elements.length > 0) djs.fire('elements.changed', { elements });
    };
    djs.on('commandStack.shape.create.postExecuted', (event: { context?: { shape?: DjsShape } }) => {
      const shape = event.context?.shape;
      const outer = shape?.parent as DjsShape | undefined;
      redraw(outer);
      if (shape && outer?.businessObject?.kind === 'element') nested = { inner: shape, outer };
    });
    djs.on(
      'commandStack.shape.move.postExecuted',
      (event: { context?: { shape?: DjsShape; oldParent?: DjsShape; newParent?: DjsShape } }) => {
        const { shape, oldParent, newParent } = event.context ?? {};
        if (!shape || !newParent || newParent === oldParent) return;
        redraw(oldParent, newParent);
        if (newParent.businessObject?.kind === 'element') nested = { inner: shape, outer: newParent };
      },
    );
    djs.on(
      ['commandStack.shape.create.reverted', 'commandStack.shape.move.reverted'],
      (event: { context?: { parent?: DjsShape; oldParent?: DjsShape; newParent?: DjsShape } }) => {
        const context = event.context ?? {};
        redraw(context.parent, context.oldParent, context.newParent);
      },
    );
    djs.on('commandStack.changed', (event: { trigger?: string }) => {
      const pending = nested;
      nested = undefined;
      if (pending && event.trigger === 'execute') queueMicrotask(() => this.offerNesting(pending.inner, pending.outer));
    });

    // A shape created *on the canvas* (a palette drag, an append) already has its
    // triples — `rdf.element.create` wrote them inside the same command group.
    // What is left is telling the rest of the app, and it has to happen here
    // rather than from the writer: at `execute` time the shape is not on the
    // canvas yet.
    djs.on(
      'commandStack.shape.create.postExecuted',
      (event: { context?: { shape?: DjsShape } }) => {
        const shape = event.context?.shape;
        const businessObject = shape?.businessObject;
        if (!shape || !businessObject?.iri || !businessObject.typeIri) return;
        this.emitWithoutSelfSync('element-created', {
          iri: businessObject.iri,
          elementIri: businessObject.iri,
          typeIri: businessObject.typeIri,
          label: businessObject.label,
          iconUrl: businessObject.iconUrl,
          bounds: {
            x: Math.round(shape.x),
            y: Math.round(shape.y),
            width: Math.round(shape.width),
            height: Math.round(shape.height),
          },
        });
      },
    );

    // Undo of such a creation. `shape.create.revert` has removed the shape and
    // the nested `rdf.element.create.revert` is about to remove the triples, so
    // the business object still carries the IRI at this point.
    djs.on('commandStack.shape.create.reverted', (event: { context?: { shape?: DjsShape } }) => {
      const iri = event.context?.shape?.businessObject?.iri;
      if (!iri) return;
      this.emitWithoutSelfSync('element-deleted', { iri, elementIri: iri });
    });

    // `elements.move` and `elements.delete` delegate to the per-shape commands,
    // so hooking the shape-level ones covers multi-selection too.
    djs.on('commandStack.shape.delete.postExecuted', (event: { context?: { shape?: DjsShape } }) => {
      const shape = event.context?.shape;
      if (shape) this.onShapeDeleted(shape);
    });

    djs.on(
      'commandStack.connection.delete.postExecuted',
      (event: { context?: { connection?: DjsShape } }) => {
        const connection = event.context?.connection;
        if (connection) this.onConnectionDeleted(connection);
      },
    );

    // A newly drawn connection arrives typed with its triple already written, and
    // nothing is opened on top of it. bpmn-js behaves the same way — the replace
    // menu is only ever opened from an explicit pad click — and here there is a
    // mechanical reason too: `commandStack.changed` is one of the popup menu's
    // auto-close events and fires *after* every `postExecuted` handler, so a menu
    // opened from this phase would be torn down again before the user saw it.
    // The pad's `replace` entry, present exactly when there is a choice, is the
    // way in.

    djs.on('selection.changed', (event: { newSelection?: DjsShape[] }) => {
      const selected = event.newSelection ?? [];
      const iri = selected[0]?.businessObject?.iri;
      this.eventBus.emit('selection-changed', {
        iri,
        iris: selected.map((element) => element.businessObject?.iri).filter(Boolean),
      });
    });

    // A click on the empty canvas with nothing selected changes no selection,
    // so diagram-js says nothing; it is said all the same — what was selected
    // elsewhere (the tree) gives way to the view. Before diagram-js's own
    // handler (1000), which clears a selection and says so itself.
    djs.on('element.click', 1500, (event: { element?: DjsShape }) => {
      const services = this.services();
      if (!services || event.element !== services.canvas.getRootElement()) return;
      if (services.selection.get().length === 0) this.eventBus.emit('selection-changed', { iri: undefined, iris: [] });
    });
  }

  /** Write a shape's current bounds back to the model. */
  private writeLayout(shape: DjsShape): void {
    const iri = shape.businessObject?.iri;
    if (!iri) return;
    const bounds: Bounds = {
      x: Math.round(shape.x),
      y: Math.round(shape.y),
      width: Math.round(shape.width),
      height: Math.round(shape.height),
    };
    const viewIri = this.viewIri;
    const viewManager = this.viewManager;
    if (viewIri && viewManager) {
      const parentIri = containerIri(shape);
      this.change(() => {
        viewManager.updateNodeBounds(viewIri, iri, bounds);
        viewManager.setNodeParent?.(viewIri, iri, parentIri);
      });
      return;
    }
    this.elementManager.updateLayout?.(iri, bounds);
    this.eventBus.emit('element-updated', { iri, elementIri: iri, bounds });
  }

  /** A shape was removed on the canvas: drop the triples unless the store led. */
  private onShapeDeleted(shape: DjsShape): void {
    const iri = shape.businessObject?.iri;
    if (!iri) return;
    for (const [key, relationship] of this.relationships) {
      if (relationship.sourceIri === iri || relationship.targetIri === iri) {
        this.relationships.delete(key);
      }
    }
    if (this.removingFromStore) return;
    // With views the nested change already removed the node; the element stays.
    if (this.hasViewContext()) return;
    this.elementManager.deleteElement(iri);
    this.eventBus.emit('element-deleted', { iri, elementIri: iri });
  }

  /** A connection was removed on the canvas. */
  private onConnectionDeleted(connection: DjsShape): void {
    const relationship = this.relationships.get(connection.id);
    this.relationships.delete(connection.id);
    if (this.removingFromStore || !relationship) return;
    if (this.hasViewContext()) return;

    this.retractRelationship(relationship);
    // The connection is already gone from the canvas; only the rest of the app
    // still needs telling.
    this.emitWithoutSelfSync('relationship-deleted', {
      sourceIri: relationship.sourceIri,
      targetIri: relationship.targetIri,
      typeIri: relationship.typeIri,
    });
  }

  /**
   * The RDF side of a connection, for the `rdf.relationship.*` commands.
   *
   * The commands own *when* — `rdf.relationship.create` inside the
   * `connection.create` group so undo reverses both, `rdf.relationship.retype`
   * as its own undoable step — and this owns *what*: the triple, the canvas's
   * relationship registry, and the app-level notification. `remove` is the exact
   * inverse of `create`, so the same pair serves a connect, its undo, a retype
   * and the retype's undo.
   */
  private relationshipWriter(): RdfRelationshipWriter {
    return {
      create: (request: RdfRelationshipRequest): string | undefined => {
        // The Linked.Archi pattern when the manager supports it: a qualified
        // resource typed with its class plus the unqualified triple, drawn as a
        // link in the open view. A bare triple otherwise.
        let relationshipIri: string | undefined;
        if (this.relationshipManager.createQualifiedRelationship) {
          relationshipIri = this.relationshipManager.createQualifiedRelationship({
            typeIri: request.typeIri,
            ...(request.predicateIri && request.predicateIri !== request.typeIri
              ? { predicateIri: request.predicateIri }
              : {}),
            sourceIri: request.sourceIri,
            targetIri: request.targetIri,
            ...(this.modelIri ? { modelIri: this.modelIri } : {}),
            ...(request.iri ? { iri: request.iri } : {}),
          }).iri;
          if (this.viewManager && this.viewIri) {
            this.viewManager.addRelationshipToView(this.viewIri, relationshipIri);
          }
        } else {
          relationshipIri = this.relationshipManager.createRelationship(
            request.predicateIri,
            request.sourceIri,
            request.targetIri,
          )?.value;
        }

        this.relationships.set(request.connectionId, {
          sourceIri: request.sourceIri,
          targetIri: request.targetIri,
          typeIri: request.typeIri,
          predicateIri: request.predicateIri,
          relationshipIri,
        });

        // The connection is already drawn — this notification is for the rest of
        // the app, not for the canvas's own store→canvas listener, which would
        // otherwise draw a *second* connection under its own key.
        this.emitWithoutSelfSync('relationship-created', {
          sourceIri: request.sourceIri,
          targetIri: request.targetIri,
          typeIri: request.typeIri,
          relationshipIri,
        });

        return relationshipIri;
      },

      // In place only when the manager can: otherwise the command falls back to
      // retract + assert, which is right for a bare triple.
      ...(this.relationshipManager.retypeRelationship
        ? {
            retype: (relationshipIri: string, _from: RdfRelationshipRequest, to: RdfRelationshipRequest): void => {
              this.relationshipManager.retypeRelationship?.(relationshipIri, to.typeIri);
              const record = this.relationships.get(to.connectionId);
              if (record) {
                record.typeIri = to.typeIri;
                record.predicateIri = to.predicateIri;
              }
              this.emitWithoutSelfSync('relationship-created', {
                sourceIri: to.sourceIri,
                targetIri: to.targetIri,
                typeIri: to.typeIri,
                relationshipIri,
              });
            },
          }
        : {}),

      draw: (relationshipIri: string): void => {
        if (this.viewManager && this.viewIri) {
          this.viewManager.addRelationshipToView(this.viewIri, relationshipIri);
        }
      },

      remove: (request: RdfRelationshipRequest, relationshipIri?: string): void => {
        this.relationships.delete(request.connectionId);
        this.retractRelationship({
          sourceIri: request.sourceIri,
          targetIri: request.targetIri,
          typeIri: request.typeIri,
          predicateIri: request.predicateIri,
          relationshipIri,
        });
        this.emitWithoutSelfSync('relationship-deleted', {
          sourceIri: request.sourceIri,
          targetIri: request.targetIri,
          typeIri: request.typeIri,
        });
      },
    };
  }

  /**
   * The RDF side of a *shape*, for the `rdf.element.create` command.
   *
   * The element twin of {@link relationshipWriter}: the command owns *when*
   * (inside the `shape.create` group, so undo reverses both) and this owns
   * *what* — the triples, and nothing else. The app-level `element-created`
   * notification is deliberately **not** emitted here: at `execute` time the
   * shape is not on the canvas yet, and a listener that reacted by drawing it
   * would collide with the `shape.create` that is about to. It is emitted from
   * `shape.create.postExecuted` instead; see {@link wireDiagramEvents}.
   *
   * ## Redo
   *
   * `ElementManager.createElement` mints its own IRI, so a redo that simply
   * called it again would create a *different* element — and the relationship
   * triple written by the sibling `rdf.relationship.create` in the same group
   * would still name the first one. When the store can be written to, the triples
   * of the first creation are snapshotted and replayed verbatim instead, which
   * keeps the IRI (and therefore the shape id and the relationship) stable across
   * any number of undo/redo cycles. Without a store, redo mints a fresh element
   * and the relationship triple from the same group is left pointing at the
   * previous IRI.
   */
  /**
   * Writes a name typed on the canvas: the `skos:prefLabel` in the language
   * shown (the English one, else an untagged one, else English is added), leaving
   * the element's names in other languages as they are. An empty name — a
   * relationship's, emptied — removes the one in that language.
   */
  private labelWriter(): LabelWriter {
    return (iri: string, label: string) => {
      const prefLabel = NAMESPACES.skos + 'prefLabel';
      const existing = (this.rdfStore?.getQuads(namedNode(iri), namedNode(prefLabel)) ?? []) as Array<{
        object: { termType: string; language?: string };
        graph: { termType: string };
      }>;
      const inModel = existing.filter((q) => q.graph.termType === 'DefaultGraph' && q.object.termType === 'Literal');
      const shown = inModel.find((q) => q.object.language === 'en') ?? inModel.find((q) => !q.object.language);
      const language = shown ? (shown.object.language ?? '') : 'en';
      const replaced = inModel.filter((q) => (q.object.language ?? '') === language);
      if (replaced.length > 0) this.rdfStore?.removeQuads(replaced as never[]);
      if (label === '') return;
      this.rdfStore?.addQuads?.([
        DataFactory.quad(namedNode(iri), namedNode(prefLabel), DataFactory.literal(label, language || undefined)) as never,
      ]);
    };
  }

  private elementWriter(): RdfElementWriter {
    return {
      create: (request: RdfElementRequest): RdfElementResult | undefined => {
        const store = this.rdfStore;

        // Redo of a creation that was snapshotted: put the same element back.
        if (request.iri && request.snapshot && request.snapshot.length > 0 && store?.addQuads) {
          store.addQuads(request.snapshot as never[]);
          return { iri: request.iri, snapshot: request.snapshot };
        }

        const create = (): string | undefined => {
          const iri = this.elementManager.createElement(request.typeIri, this.modelIri, {
            ...(request.label ? { label: request.label } : {}),
          })?.value;
          if (!iri) return undefined;
          if (this.viewManager && this.viewIri) {
            this.viewManager.addElementToView(this.viewIri, iri, request.bounds);
          } else {
            this.elementManager.updateLayout?.(iri, request.bounds);
          }
          return iri;
        };

        // With a recording store the snapshot is exactly what was written — the
        // element *and* its node — so redo restores both.
        if (this.changeStore) {
          const { result: iri, added } = this.changeStore.record(create);
          return iri ? { iri, snapshot: added } : undefined;
        }

        const iri = create();
        if (!iri) return undefined;
        // Snapshot only when it can be replayed; an unusable one would be a lie.
        const snapshot =
          store?.addQuads !== undefined ? store.getQuads(namedNode(iri), null, null, null) : [];
        return { iri, snapshot };
      },

      place: (iri: string, bounds: Bounds): void => {
        if (this.viewManager && this.viewIri) this.viewManager.addElementToView(this.viewIri, iri, bounds);
      },

      remove: (iri: string): void => {
        this.elementManager.deleteElement(iri);
      },
    };
  }

  /**
   * Emit an app event without letting the canvas's own listener act on it.
   *
   * Save-and-restore rather than a plain flag, because a type change already
   * holds the guard while it emits.
   *
   * For the element events the guard is not merely an optimisation. They are
   * emitted from command-stack hooks, and `element-deleted` from
   * `shape.create.reverted` — which runs inside `CommandStack._atomicDo`, where
   * the canvas's own listener calling `modeling.removeElements` would throw
   * `illegal invocation in <execute> or <revert> phase`. The shape is already
   * gone by then anyway; only the rest of the app still needs telling.
   */
  private emitWithoutSelfSync(
    type: 'relationship-created' | 'relationship-deleted' | 'element-created' | 'element-deleted',
    detail: Record<string, unknown>,
  ): void {
    const previous = this.suppressSync;
    this.suppressSync = true;
    try {
      this.eventBus.emit(type, detail);
    } finally {
      this.suppressSync = previous;
    }
  }

  /**
   * Retract a relationship from the store.
   *
   * A qualified relationship has an IRI and goes through the manager. A direct
   * triple has none, so the exact quad is deleted from the store — which is why
   * {@link DiagramCanvasOptions.rdfStore} exists. Without a store, a direct
   * triple cannot be retracted and is left in place rather than silently
   * reported as gone.
   */
  private retractRelationship(relationship: CanvasRelationship): void {
    if (relationship.relationshipIri) {
      this.relationshipManager.deleteRelationship(relationship.relationshipIri);
      return;
    }
    const store = this.rdfStore;
    if (!store) return;

    const predicateIri = relationship.predicateIri ?? relationship.typeIri;
    const quads = store.getQuads(
      namedNode(relationship.sourceIri),
      namedNode(predicateIri),
      namedNode(relationship.targetIri),
      null,
    );
    if (quads.length > 0) store.removeQuads(quads as never[]);
  }

  /** Set up EventBus listeners to sync canvas state with the RDF store. */
  private setupEventListeners(): void {
    this.eventBus.on('element-created', (event) => {
      // Suppressed while the canvas is announcing a creation it performed itself:
      // the shape is already drawn, and re-entering the modeling layer from a
      // command hook is illegal anyway. See `emitWithoutSelfSync`.
      if (this.suppressSync) return;
      const detail = event.detail;
      if (detail?.iri && detail?.typeIri && detail?.bounds) {
        this.addElement(
          detail.iri as string,
          detail.typeIri as string,
          detail.bounds as Bounds,
          detail.label as string | undefined,
          detail.iconUrl as string | undefined,
        );
      }
    });

    this.eventBus.on('element-deleted', (event) => {
      if (this.suppressSync) return;
      const detail = event.detail;
      if (detail?.iri) {
        this.removeElement(detail.iri as string);
      }
    });

    this.eventBus.on('element-updated', (event) => {
      const detail = event.detail;
      if (detail?.iri) {
        this.updateElement(detail.iri as string, {
          label: detail.label as string | undefined,
          iconUrl: detail.iconUrl as string | undefined,
          bounds: detail.bounds as Bounds | undefined,
        });
      }
    });

    this.eventBus.on('relationship-created', (event) => {
      if (this.suppressSync) return;
      const detail = event.detail;
      if (detail?.sourceIri && detail?.targetIri && detail?.typeIri) {
        this.addRelationship(
          detail.sourceIri as string,
          detail.targetIri as string,
          detail.typeIri as string,
          detail.relationshipIri as string | undefined,
        );
      }
    });

    this.eventBus.on('relationship-deleted', (event) => {
      if (this.suppressSync) return;
      const detail = event.detail;
      const relationshipIri = detail?.relationshipIri as string | undefined;
      const key =
        detail?.sourceIri && detail?.targetIri && detail?.typeIri
          ? relationshipKey(detail.sourceIri as string, detail.targetIri as string, detail.typeIri as string)
          : undefined;
      const services = this.services();
      const connection =
        (relationshipIri ? this.findConnection(relationshipIri) : undefined) ??
        (key ? services?.elementRegistry.get(key) : undefined);
      this.removingFromStore = true;
      try {
        if (connection) this.removeConnectionDirect(connection);
      } finally {
        this.removingFromStore = false;
      }
      if (key) this.relationships.delete(key);
    });
  }
}

/** Project a diagram-js shape onto the public {@link CanvasElement} shape. */
function toCanvasElement(shape: DjsShape): CanvasElement | null {
  const businessObject = shape.businessObject;
  if (!businessObject?.iri) return null;
  return {
    iri: businessObject.iri,
    typeIri: businessObject.typeIri,
    label: businessObject.label ?? localName(businessObject.iri),
    iconUrl: businessObject.iconUrl,
    bounds: { x: shape.x, y: shape.y, width: shape.width, height: shape.height },
  };
}

/** Whether a drawn route matches a persisted one (to the pixel). */
function sameRoute(current: Array<{ x: number; y: number }> | undefined, persisted: Point[]): boolean {
  if (!current || current.length !== persisted.length) return false;
  return current.every(
    (p, i) => Math.round(p.x) === persisted[i].x && Math.round(p.y) === persisted[i].y,
  );
}

/** Last fragment or path segment of an IRI. */
function localName(iri: string): string {
  if (iri.includes('#')) return iri.slice(iri.lastIndexOf('#') + 1);
  const trimmed = iri.replace(/\/$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || iri;
}

/** The element a shape is drawn inside, when it is inside one rather than on the diagram. */
function containerIri(shape: DjsShape): string | undefined {
  const parent = shape.parent as DjsShape | undefined;
  return parent?.businessObject?.kind === 'element' ? parent.businessObject.iri : undefined;
}

/** Nodes ordered so every container comes before what is drawn inside it. */
function containersFirst<T extends { elementIri: string; parentElementIri?: string }>(nodes: readonly T[]): T[] {
  const byIri = new Map(nodes.map((n) => [n.elementIri, n]));
  const depth = (node: T): number => {
    let d = 0;
    const seen = new Set<string>();
    for (let p = node.parentElementIri; p && byIri.has(p) && !seen.has(p); p = byIri.get(p)!.parentElementIri) {
      seen.add(p);
      d++;
    }
    return d;
  };
  return [...nodes].map((node) => [depth(node), node] as const).sort((a, b) => a[0] - b[0]).map(([, node]) => node);
}
