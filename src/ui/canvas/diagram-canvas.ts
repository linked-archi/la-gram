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
import { NAMESPACES } from '@linked-archi/kernel/rdf-engine/namespaces.js';

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
} from '@linked-archi/kernel/metamodel-manager/interfaces.js';
import type {
  ElementManager,
  FigureInfo,
  FigureKind,
  LinkInfo,
  NodeInfo,
  RelationshipInfo,
  RelationshipManager,
  Bounds,
  Point,
  ViewInfo,
  ViewManager,
} from '@linked-archi/kernel/model-manager/interfaces.js';
import type { ObservableRdfStore } from '@linked-archi/kernel/rdf-engine/observable-store.js';
import type { EventBus } from '../event-bus.js';
import { NotationStyleRegistry } from './notation-styles.js';
import { NOTATION_DEFAULTS, labelFitsInside } from './notation-shapes.js';
import { toolFromManagerName, type CanvasTool } from './canvas-tools.js';
import {
  CONNECTOR_STYLE,
  RdfRenderer,
  connectionLabelLayout,
  drawnConnectionLabel,
  labelOffsetOf,
  rdfRendererModule,
  type LabelOffset,
  type RdfBusinessObject,
  type RenderOptions,
} from './rdf-renderer.js';
import { MOVE_LINK_LABEL_COMMAND, rdfLinkLabelModule, type LabelledLine, type LinkLabelWriter } from './rdf-link-label.js';
import { RdfRuleProvider, rdfRulesModule, type RelationshipRefusal, type RdfConnectionAttrs } from './rdf-rule-provider.js';
import { humanize } from '@linked-archi/kernel/model-manager/vocabulary.js';
import { sameAppearance, type Appearance, type AppearanceKey, type LabelAnchor } from '@linked-archi/kernel/model-manager/appearance.js';
import { labelFromExpression, parseLabelExpression, type LabelSource } from '@linked-archi/kernel/model-manager/label-expression.js';
import { assetUrl } from '@linked-archi/kernel/metamodel-manager/bundled-assets.js';
import { iconHref, shapeGeometry, shapePath } from './notation-shapes.js';
import {
  APPEARANCE_FIELDS,
  appearanceOfFigure,
  elementDefaults,
  fieldsFor,
  figureDefaults,
  IMAGE_KINDS,
  lineDefaults,
  type AppearanceSelection,
  type AppearanceTarget,
  type FigureChoices,
  type FigureOption,
  type ImageChoices,
  type ImageScope,
  type LabelChoices,
} from '../appearance-selection.js';
import { isRenamable, rdfLabelEditingModule, type LabelWriter } from './rdf-label-editing.js';
import { conceptIriOf, isViewReference, viewClassOf } from './view-reference.js';
import { RdfZoomMenuProvider, ZOOM_MENU_ID } from './zoom-in.js';
import { RdfElementReplaceMenuProvider, ELEMENT_REPLACE_MENU_ID } from './rdf-element-replace-menu-provider.js';
import { RETYPE_ELEMENT_COMMAND, RetypeElementHandler, type RetypeElementContext } from './rdf-element-retype.js';
import { RdfContextMenuProvider, CONTEXT_MENU_ID, type ContextMenuAction } from './rdf-context-menu-provider.js';
import {
  rdfModelingModule,
  RDF_CHANGE_COMMAND,
  RDF_STORE_EDIT_COMMAND,
  RDF_EXISTING_RELATIONSHIP_HINT,
  RDF_MODEL_DELETE_COMMAND,
  plannedBounds,
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
import { NEST_MENU_ID, RdfNestMenuProvider, nestingOffers, nestingShownBy, relationshipsShownByNesting, type NestingOffer } from './nesting.js';
import { REUSE_MENU_ID, RdfReuseMenuProvider, type RdfReuseCheck } from './reuse-relationship.js';
import { rdfAutoResizeModule } from './rdf-auto-resize.js';
import { CanvasClipboard, fromTextField, type CanvasClipboardHost, type CanvasClipboardOptions } from './canvas-clipboard.js';
import { isMacPlatform, keyCombo } from '../help.js';
import { rdfOrderingModule, shapeIndex } from './rdf-ordering.js';
import { joinLastStep, lastStepId } from './undo-steps.js';
import { CanvasArrange, type ArrangeAvailability, type ArrangeShape, type ShapedLines } from './canvas-arrange.js';
import { LINE_SHAPES, type LineShape } from '../../layout/line-shapes.js';
import type { Alignment, DistributeAxis, GridAxis, SizeDimension, SizeReference } from '../../layout/arrange-geometry.js';
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
  /**
   * Copy, cut, paste and duplicate on the canvas (copy-paste task): where a copy comes from, and how to
   * ask. Without it, the canvas copies and pastes nothing.
   */
  clipboard?: CanvasClipboardOptions;
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
  | 'arrange-view'
  | 'arrange-relationships'
  | 'align-to-grid'
  | 'sizes'
  | 'line-straight'
  | 'line-right-angles'
  | 'line-horizontal-first'
  | 'line-vertical-first'
  | 'delete-view'
  | 'export-svg'
  | 'export-png'
  | 'copy-svg'
  | 'copy-png';

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
/** One thing drawn, for the Appearance, Figure and Image tabs: its node or link, its own look for every presentation and for the one chosen, and its defaults. */
interface DrawnLook {
  target: AppearanceTarget;
  own: Appearance;
  defaults: Appearance;
  contextOwn?: Appearance;
}

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

/**
 * Copy and paste's own keys (Ctrl/⌘+D, Ctrl/⌘+Shift+V, Ctrl/⌘+Alt+V): under the guard against text fields,
 * above diagram-js's bindings, as F2's renaming is (`rdf-label-editing.ts`).
 */
const CLIPBOARD_KEY_PRIORITY = 1500;

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
    addShape(shape: unknown, parent?: unknown, parentIndex?: number): DjsShape;
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
     * event. See {@link DiagramCanvas.guardKeyboardAgainstShadowInputs}. One returning `true` has
     * handled the key: `_keyHandler` then prevents the browser's own (Ctrl/⌘+D's bookmark).
     */
    addListener(
      priority: number,
      listener: (context: { keyEvent?: KeyboardEvent }) => boolean | undefined,
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
  private readonly renderOptions: RenderOptions = { relationshipNames: false, notationOnly: false };

  /**
   * Each node's and link's own look as the store last said, by IRI: what a
   * placement or a line is drawn with when it is first drawn.
   */
  private appearanceToDraw = new Map<string, Appearance>();

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
  /** The question asked when a line drawn is a relationship the model already has (`reuse-relationship.ts`). */
  readonly reuseMenuProvider: RdfReuseMenuProvider;
  /** The views refining what the pad's *Zoom in* was clicked on, when several do (`zoom-in.ts`, VC-6). */
  readonly zoomMenuProvider: RdfZoomMenuProvider;
  readonly notationStyles: NotationStyleRegistry;

  /** The diagram-js instance, or `null` once destroyed. */
  private diagram: Diagram | null = null;

  /** Relationship registry keyed by the connection's diagram-js id. */
  private relationships = new Map<string, CanvasRelationship>();
  /**
   * The line a connect with no type chosen just drew, and its undo step, while the relationship-type menu it
   * opened is open: a type picked there joins that step (Req 4.2).
   */
  private drawnAwaitingType: { connectionId: string; stepId: number } | undefined;
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

  /** Copy and paste (`canvas-clipboard.ts`), when the app gives it what it needs. */
  private readonly clipboard?: CanvasClipboard;
  /** Where the pointer is on the page while it is over the diagram, for a paste there. */
  private pointerClient: { x: number; y: number } | undefined;
  /** The listeners copy and paste added, to take away with the canvas. */
  private clipboardListeners: Array<[EventTarget, string, EventListener]> = [];
  /** Stops redrawing the references to a view renamed in the store ({@link renameReferencesTo}). */
  private stopFollowingViewNames: (() => void) | undefined;

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
    if (options.clipboard) this.clipboard = new CanvasClipboard(this.clipboardHost(), options.clipboard);

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
    this.reuseMenuProvider = new RdfReuseMenuProvider(
      (iri) => this.paletteDefinition.relationshipTypes.find((r) => r.iri === iri)?.iconUrl,
    );
    this.zoomMenuProvider = new RdfZoomMenuProvider((viewIri) => {
      this.services()?.popupMenu.close();
      this.zoomMenuProvider.pending = undefined;
      this.openView(viewIri);
    });
    // *Zoom in* on the pad of an element or a relationship a view refines (VC-6).
    this.contextPadProvider.setZoomSupport({
      isAvailable: (element) => this.viewsRefining(element.diagramElement).length > 0,
      open: (element, event) => this.zoomIn(element.diagramElement as DjsShape, this.padMenuPosition(event)),
    });

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
        // Lines at the root, above every shape, whatever is created or moved.
        rdfOrderingModule,
        // Last, so its `modeling` binding replaces the one ModelingModule made.
        rdfModelingModule(this.relationshipWriter(), this.elementWriter(), this.changeStore ?? null, this.reuseCheck()),
        // Renaming on the canvas: double-click or F2 (needs `rdfChangeStore` from the line above).
        rdfLabelEditingModule(this.labelWriter()),
        // Moving a relationship's name along with its line, kept in the view.
        rdfLinkLabelModule(this.linkLabelWriter(), (line) => this.canMoveLinkLabel(line)),
      ] as never[],
    });

    this.initRoot();
    if (this.viewManager) {
      this.contextPadProvider.setDeleteFromModelHandler((element) => {
        this.deleteFromModel(element.iri);
      });
      // A reference's view: through the app's confirmation, which counts what goes with it (VC-7).
      if (this.onContextAction) {
        this.contextPadProvider.setDeleteViewHandler((element) => this.deleteReferencedView(element.diagramElement as DjsShape));
      }
    }
    // A view reference's *Open view* (Req 3.23).
    this.contextPadProvider.setOpenViewHandler((element) => {
      const shape = element.diagramElement as DjsShape | undefined;
      if (shape) this.openReferencedView(shape);
    });
    // A view renamed — anywhere, by anyone, or undone — renames the references to it here that have no text of
    // their own (VR-DD-2): a name written on a view, which no figure of the open view's carries.
    const prefLabel = NAMESPACES.skos + 'prefLabel';
    this.stopFollowingViewNames = this.changeStore?.subscribe((change) => {
      let named: Set<string> | undefined;
      for (const q of [...change.added, ...change.removed]) {
        if (q.predicate.value !== prefLabel || !this.viewManager?.getView(q.subject.value)) continue;
        (named ??= new Set()).add(q.subject.value);
      }
      if (named) this.renameReferencesTo(named);
    });
    this.registerProviders();
    this.bindKeyboard(keyboardBindTo);
    this.guardKeyboardAgainstShadowInputs();
    this.bindClipboard();
    this.otherwiseNamed.clear();
    this.restackOnlyWhatChanged();
    this.wireDiagramEvents();
    this.setupEventListeners();
    this.initialized = true;
  }

  // ── Copy and paste ─────────────────────────────────────────────────

  /** What the canvas does for its clipboard (`canvas-clipboard.ts`). */
  private clipboardHost(): CanvasClipboardHost {
    return {
      target: () => {
        const store = this.changeStore;
        const views = this.viewManager;
        const viewIri = this.viewIri;
        if (!store || !views || !viewIri) return undefined;
        return { viewIri, modelIri: this.modelIri, deps: { store, elements: this.elementManager, relationships: this.relationshipManager, views } };
      },
      selectedPlacements: () => {
        const viewIri = this.viewIri;
        const selected = this.service<{ get(): DjsShape[] }>('selection')?.get() ?? [];
        return selected
          .map((shape) => {
            const shown = shape.businessObject;
            if (shape.waypoints || !shown) return undefined;
            if (shown.kind === 'figure') return shown.iri;
            return shown.nodeIri ?? (viewIri ? this.viewManager?.getNode(viewIri, shown.iri)?.nodeIri : undefined);
          })
          .filter((iri): iri is string => Boolean(iri));
      },
      pointer: () => (this.pointerClient ? this.diagramPointAt(this.pointerClient) : undefined),
      record: (apply) => this.recordChange(apply),
      selectPlacements: (iris) => this.selectPlacements(iris),
      removeSelectionFromView: () => this.service<{ trigger(action: string): unknown }>('editorActions')?.trigger('removeSelection'),
      notice: (message, level) => this.onNotice?.(message, level),
      sizeOf: (typeIri) => {
        const style = this.notationStyles.styleFor(typeIri);
        return { width: style?.defaultWidth ?? NOTATION_DEFAULTS.width, height: style?.defaultHeight ?? NOTATION_DEFAULTS.height };
      },
      viewport: () => this.viewport(),
    };
  }

  /** The placements selected on the open diagram — nodes of elements and figures — by node IRI. */
  selectedPlacements(): string[] {
    return this.clipboardHost().selectedPlacements();
  }

  /** The arrange options (Req 22, `canvas-arrange.ts`), made once the canvas has its services. */
  private arrangeOptions?: CanvasArrange;
  private arranger(): CanvasArrange {
    return (this.arrangeOptions ??= new CanvasArrange({
      all: () => {
        const services = this.services();
        if (!services) return [];
        const root = services.canvas.getRootElement();
        return services.elementRegistry.getAll().filter((e) => e !== root) as unknown as ArrangeShape[];
      },
      selected: () => (this.services()?.selection.get() ?? []) as unknown as ArrangeShape[],
      locked: (shape) => !!shape.businessObject?.iri && this.locked.has(shape.businessObject.iri),
      defaultSizeOf: (shape) => {
        const object = shape.businessObject;
        if (object?.kind === 'figure' && object.figure) return FIGURE_SIZES[object.figure.kind];
        const style = object?.typeIri ? this.notationStyles.styleFor(object.typeIri) : undefined;
        return { width: style?.defaultWidth ?? NOTATION_DEFAULTS.width, height: style?.defaultHeight ?? NOTATION_DEFAULTS.height };
      },
      // No route given: the layouter draws it as a new line, centre to centre, cropped at the outlines (Req 4.6).
      straightRoute: (line) => this.services()?.layouter.layoutConnection(line, { source: line.source, target: line.target, waypoints: [] }),
      execute: (command, context) => {
        const services = this.services();
        if (!services || !this.viewIri) return false;
        services.commandStack.execute(command, context);
        return true;
      },
    }));
  }

  /** What the quick actions may do with the selection as it is. */
  arrangeAvailability(): ArrangeAvailability {
    return this.arranger().availability();
  }

  /** Align the selected placements to their bounding box's edge or centre: how many moved. */
  alignSelection(alignment: Alignment): number {
    return this.arranger().align(alignment);
  }

  /** Equal gaps between the selected placements, along the axis. */
  distributeSelection(axis: DistributeAxis): number {
    return this.arranger().distribute(axis);
  }

  /** The selected placements, or the view's, their top-left corners to the grid. */
  alignToGrid(axis: GridAxis, grid: number, wholeView = false): number {
    return this.arranger().alignToGrid(axis, grid, wholeView);
  }

  /** The selected placements' widths, heights or both made the largest's, the smallest's or the median. */
  matchSizes(reference: SizeReference, dimension: SizeDimension): number {
    return this.arranger().matchSize(reference, dimension);
  }

  /** The selected placements, or the view's, each at its default size. */
  defaultSizes(wholeView = false): number {
    return this.arranger().defaultSize(wholeView);
  }

  /** The selected lines and the lines of the selected placements, or the view's, routed again around the placements, which stay. */
  arrangeRelationships(wholeView = false): number {
    return this.arranger().arrangeRelationships(wholeView);
  }

  /** *Line shape* (Req 22.9): the selected lines given the shape, as their routes, in one step. */
  shapeLines(shape: LineShape): ShapedLines {
    return this.arranger().shapeLines(shape);
  }

  /** Copy concepts chosen in the model tree (Ctrl/⌘+C there), into a copy event's data; false when nothing was. */
  copyConcepts(iris: readonly string[], data?: DataTransfer | null): boolean {
    return this.clipboard?.copyConcepts(iris, data) ?? false;
  }

  /** The model tree's *Copy* on these concepts. */
  copyConceptsFromMenu(iris: readonly string[]): boolean {
    return this.clipboard?.copyConceptsFromMenu(iris) ?? false;
  }

  /** A point on the page, in the diagram's coordinates. */
  private diagramPointAt(client: { x: number; y: number }): { x: number; y: number } | undefined {
    const canvas = this.service<{ viewbox(): { x: number; y: number; scale: number }; getContainer?(): HTMLElement }>('canvas');
    if (!canvas) return undefined;
    const rect = (canvas.getContainer?.() ?? this.container).getBoundingClientRect();
    const box = canvas.viewbox();
    const scale = box.scale || 1;
    return { x: Math.round(box.x + (client.x - rect.left) / scale), y: Math.round(box.y + (client.y - rect.top) / scale) };
  }

  /** Select the placements a paste made: nodes and links, by their IRIs. */
  private selectPlacements(iris: readonly string[]): void {
    const services = this.services();
    if (!services) return;
    const wanted = new Set(iris);
    const shapes = services.elementRegistry.getAll().filter((shape) => {
      const shown = shape.businessObject;
      if (!shown) return false;
      if (shown.kind === 'figure' || shown.kind === 'connector') return wanted.has(shown.iri);
      return wanted.has(shown.nodeIri ?? '') || wanted.has(shown.linkIri ?? '');
    });
    services.selection.select(shapes);
  }

  /**
   * Whether a key or clipboard event is the canvas's: from the diagram, or from the page with nothing else
   * focused — not from a panel, and not under a dialog.
   */
  private clipboardOwns(event: Event): boolean {
    if (!this.clipboard || !this.viewIri || this.container.ownerDocument.querySelector('.la-dialog')) return false;
    const path = event.composedPath?.() ?? [];
    if (path.includes(this.container)) return true;
    const active = this.container.ownerDocument.activeElement;
    return !active || active === this.container.ownerDocument.body || active === this.container.ownerDocument.documentElement;
  }

  /**
   * Copy and paste's keys and events: the browser's copy, cut and paste events (Ctrl/⌘+C, X, V and the
   * desktop app's Edit menu); Ctrl/⌘+Shift+V, Ctrl/⌘+Alt+V and Ctrl/⌘+D, which are not paste events; and
   * the pointer, for a paste where it is.
   */
  private bindClipboard(): void {
    const clipboard = this.clipboard;
    if (!clipboard || this.clipboardListeners.length > 0) return;
    const doc = this.container.ownerDocument;
    const on = (target: EventTarget, type: string, listener: EventListener) => {
      target.addEventListener(type, listener);
      this.clipboardListeners.push([target, type, listener]);
    };
    on(doc, 'copy', (event) => (clipboard.copyingConcepts() || this.clipboardOwns(event)) && clipboard.onCopyEvent(event as ClipboardEvent));
    on(doc, 'cut', (event) => this.clipboardOwns(event) && clipboard.onCopyEvent(event as ClipboardEvent, true));
    on(doc, 'paste', (event) => this.clipboardOwns(event) && clipboard.onPasteEvent(event as ClipboardEvent));
    on(this.container, 'pointermove', (event) => {
      const e = event as PointerEvent;
      this.pointerClient = { x: e.clientX, y: e.clientY };
    });
    on(this.container, 'pointerleave', () => {
      this.pointerClient = undefined;
    });
    this.services()?.keyboard.addListener(
      CLIPBOARD_KEY_PRIORITY,
      (context: { keyEvent?: KeyboardEvent }) => {
        const e = context.keyEvent;
        if (!e || !(e.ctrlKey || e.metaKey) || fromTextField(e) || !this.clipboardOwns(e)) return undefined;
        // By the key's place, not its letter: ⌥ changes the letter on a Mac.
        if (e.code === 'KeyD' && !e.shiftKey && !e.altKey) {
          void clipboard.duplicate();
          return true;
        }
        if (e.code === 'KeyV' && e.shiftKey && !e.altKey) {
          void clipboard.paste('copies');
          return true;
        }
        if (e.code === 'KeyV' && e.altKey && !e.shiftKey) {
          void clipboard.paste('references');
          return true;
        }
        return undefined;
      },
      'keyboard.keydown',
    );
  }

  private unbindClipboard(): void {
    for (const [target, type, listener] of this.clipboardListeners) target.removeEventListener(type, listener);
    this.clipboardListeners = [];
  }

  /**
   * The right-click menu's copy and paste: cut, copy and duplicate what is selected (`placed`: an element or
   * a figure is), and the three pastes, at the menu's place, once something is copied.
   */
  private clipboardMenuActions(placed: boolean): ContextMenuAction[] {
    const clipboard = this.clipboard;
    if (!clipboard) return [];
    const mac = isMacPlatform();
    const key = (combo: string) => keyCombo(combo, mac);
    const at = () => (this.contextMenuAt ? this.diagramPointAt(this.contextMenuAt) : undefined);
    const actions: ContextMenuAction[] = [];
    if (placed) {
      actions.push(
        { id: 'cut', label: 'Cut', section: 'clipboard', shortcut: key('Mod+X'), run: () => void clipboard.copyFromMenu(true) },
        { id: 'copy', label: 'Copy', section: 'clipboard', shortcut: key('Mod+C'), run: () => void clipboard.copyFromMenu() },
      );
    }
    if (clipboard.canPaste()) {
      actions.push(
        { id: 'paste', label: 'Paste', section: 'clipboard', shortcut: key('Mod+V'), run: () => void clipboard.paste('auto', at()) },
        { id: 'paste-copies', label: 'Paste as copies', section: 'clipboard', shortcut: key('Mod+Shift+V'), run: () => void clipboard.paste('copies', at()) },
        {
          id: 'paste-references',
          label: 'Paste as references',
          section: 'clipboard',
          shortcut: key('Mod+Alt+V'),
          run: () => void clipboard.paste('references', at()),
        },
      );
    }
    if (placed) {
      actions.push({ id: 'duplicate', label: 'Duplicate', section: 'clipboard', shortcut: key('Mod+D'), run: () => void clipboard.duplicate() });
    }
    return actions;
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
    const shape = this.shapeOf(iri) ?? this.services()?.elementRegistry.get(iri);
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
    // Another view: the format painter put down, its look the last view's.
    if (viewIri !== this.viewIri) this.stopFormatPainter();
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
   *
   * In each parent's order: an element is placed after its sibling before it,
   * so that sibling — when it changed too — has to be in place first. Placed in
   * the order the changes came, a line laid out again after a container moved
   * below it went after the container's old place: to the front, under every
   * shape.
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
      // Each element's place looked up once, as before; then placed in that order.
      const placed = elements
        .map((element) => {
          const siblings = (element.parent as { children?: DjsShape[] } | undefined)?.children;
          return { element, siblings, at: siblings?.indexOf(element) ?? -1 };
        })
        .sort((a, b) => a.at - b.at);
      for (const { element, siblings, at } of placed) {
        const parent = element.parent as DjsShape | undefined;
        if (!parent || !siblings || whole.has(parent)) continue;
        const group = registry.getGraphics(element)?.parentNode as SVGElement | null | undefined;
        if (!group) continue;
        const container = graphics._getChildrenContainer(parent);
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
   * Each element's placements on the canvas, and each placement by its node —
   * an element may be placed more than once in a view. Kept as shapes are added
   * and removed, so a lookup is not a scan of a view of thousands (Task 22).
   * The first placement of an element keeps its element's IRI as its id; each
   * further one takes its node's.
   */
  private readonly placements = new Map<string, Set<DjsShape>>();
  private readonly placementByNode = new Map<string, DjsShape>();

  /** Every placement of an element on the canvas. */
  private shapesOf(elementIri: string): DjsShape[] {
    return [...(this.placements.get(elementIri) ?? [])];
  }

  /** A placement of an element: the one its IRI keys, else the first. */
  private shapeOf(elementIri: string): DjsShape | undefined {
    const keyed = this.services()?.elementRegistry.get(elementIri);
    if (keyed && !keyed.waypoints && keyed.businessObject?.iri === elementIri) return keyed;
    return this.placements.get(elementIri)?.values().next().value;
  }

  /** The placement drawing a node; a figure's node keys its shape. */
  private shapeOfNode(nodeIri: string | undefined): DjsShape | undefined {
    if (!nodeIri) return undefined;
    return this.placementByNode.get(nodeIri) ?? this.services()?.elementRegistry.get(nodeIri);
  }

  /**
   * Each relationship's lines, and each line by its link — a relationship may be
   * drawn more than once in a view. Kept as connections are added and removed.
   */
  private readonly lines = new Map<string, Set<DjsShape>>();
  private readonly lineByLink = new Map<string, DjsShape>();

  /** Every line of a relationship on the canvas. */
  private linesOf(relationshipIri: string): DjsShape[] {
    return [...(this.lines.get(relationshipIri) ?? [])];
  }

  /** The line drawing a link. */
  private lineOfLink(linkIri: string | undefined): DjsShape | undefined {
    return linkIri ? this.lineByLink.get(linkIri) : undefined;
  }

  /** A line of a relationship between these two shapes, either way round when `eitherWay`. */
  private lineBetween(relationshipIri: string, a: DjsShape, b: DjsShape, eitherWay = false): DjsShape | undefined {
    return this.linesOf(relationshipIri).find(
      (line) => (line.source === a && line.target === b) || (eitherWay && line.source === b && line.target === a),
    );
  }

  /** The link a line draws: its own, or — a line drawn before links were told apart — its relationship's. */
  private linkKeyOf(line: DjsShape): string | undefined {
    return line.businessObject?.linkIri ?? line.businessObject?.iri;
  }

  /** What draws a concept: an element's placement, or a relationship's line. */
  private drawnOf(iri: string): DjsShape | undefined {
    return this.shapeOf(iri) ?? this.findConnection(iri);
  }

  /** The node a placement draws: its own, or — a figure — the shape's IRI. */
  private nodeKeyOf(shape: DjsShape): string | undefined {
    return shape.businessObject?.nodeIri ?? shape.businessObject?.iri;
  }

  /**
   * Containers that got or lost something inside them while the store was
   * drawn, to redraw once it is: a container is drawn before what is inside it
   * (`containersFirst`), so it was drawn empty — its name in the middle, under
   * what was then drawn there — until something moved it again.
   */
  private readonly containersToRedraw = new Set<DjsShape>();

  /** Redraw the containers {@link containersToRedraw} holds: each alone, its name where its contents put it. */
  private redrawContainers(): void {
    const services = this.services();
    const root = services?.canvas.getRootElement();
    for (const container of this.containersToRedraw) {
      if (services && container !== root && services.elementRegistry.get(container.id)) {
        services.eventBus.fire('element.changed', { element: container });
      }
    }
    this.containersToRedraw.clear();
  }

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
    this.appearanceToDraw = new Map();
    for (const drawn of [...nodes, ...links]) {
      // A placement's or a line's look for the presentation chosen: its style for every context, its style for that one over it.
      const look = this.lookFor(drawn);
      if (look) this.appearanceToDraw.set('nodeIri' in drawn ? drawn.nodeIri : drawn.linkIri, look);
    }
    const wantedShapes = new Set(nodes.map((n) => n.nodeIri));
    const wantedLinks = new Set(links.map((l) => l.linkIri));
    const wantedRelationships = new Set(links.map((l) => l.relationshipIri));

    // The connections drawn, by relationship: looked up once, not a scan of the
    // canvas a link — which made drawing a view of thousands quadratic (Task 22).
    const drawnLinks = new Map<string, DjsShape>();
    this.removingFromStore = true;
    try {
      for (const connection of this.connections()) {
        const iri = connection.businessObject?.iri;
        const link = connection.businessObject?.linkIri;
        // Each line its link; a line not told its link yet stands for its relationship's.
        if (!iri || (link ? !wantedLinks.has(link) : !wantedRelationships.has(iri))) this.removeConnectionDirect(connection);
        else if (!drawnLinks.has(link ?? iri)) drawnLinks.set(link ?? iri, connection);
      }
      for (const shape of this.shapes()) {
        const node = this.nodeKeyOf(shape);
        if (!node || !wantedShapes.has(node)) this.removeShapeDirect(shape);
      }
    } finally {
      this.removingFromStore = false;
    }

    // Containers before what is drawn inside them.
    for (const node of containersFirst(nodes)) {
      if (node.figure) {
        this.syncFigure(node);
        continue;
      }
      const description = this.describeElement?.(node.elementIri);
      const existing = this.shapeOfNode(node.nodeIri);
      const container = this.containerFor(node.parentNodeIri);
      if (existing && existing.parent !== container) this.reparentDirect(existing, container);
      if (existing) {
        const b = existing;
        const moved =
          b.x !== node.bounds.x || b.y !== node.bounds.y || b.width !== node.bounds.width || b.height !== node.bounds.height;
        const relabelled = description?.label !== undefined && description.label !== b.businessObject?.label;
        const retyped = description?.typeIri !== undefined && description.typeIri !== b.businessObject?.typeIri;
        if (retyped && b.businessObject && description?.typeIri) b.businessObject.typeIri = description.typeIri;
        if (moved || relabelled || retyped) {
          this.updateShape(existing, {
            ...(relabelled ? { label: description?.label, named: description?.named ?? true } : {}),
            ...(moved ? { bounds: node.bounds } : {}),
          });
        }
        // Its look changed — in the panel, by a collaborator, or undone.
        this.restyle(existing, this.lookFor(node));
      } else {
        this.addElement(
          node.elementIri,
          description?.typeIri ?? '',
          node.bounds,
          description?.label,
          description?.iconUrl,
          description?.named,
          node.parentNodeIri,
          node.nodeIri,
        );
      }
    }

    for (const link of links) {
      // A line standing for no relationship: a note's, to what it is about.
      if (link.connector) {
        this.syncConnector(link, drawnLinks.get(link.linkIri));
        continue;
      }
      const unclaimed = drawnLinks.get(link.relationshipIri);
      const existing =
        drawnLinks.get(link.linkIri) ??
        (unclaimed && !unclaimed.businessObject?.linkIri ? unclaimed : undefined);
      if (existing?.businessObject && !existing.businessObject.linkIri) {
        existing.businessObject.linkIri = link.linkIri;
        this.lineByLink.set(link.linkIri, existing);
        drawnLinks.delete(link.relationshipIri);
      }
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
        // Its name moved, or back at the middle — by a collaborator, or an edit undone.
        // Measured from the route as now drawn; a pixel is the bounds' rounding, not a move.
        const kept = link.label ? labelOffsetOf(existing.waypoints ?? [], link.label) : undefined;
        const shown = existing.businessObject?.labelOffset;
        const moved = !kept || !shown ? kept !== shown : Math.abs(kept.x - shown.x) > 1 || Math.abs(kept.y - shown.y) > 1;
        if (existing.businessObject && moved) {
          if (kept) existing.businessObject.labelOffset = kept;
          else delete existing.businessObject.labelOffset;
          services.eventBus.fire('element.changed', { element: existing });
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
        this.restyle(existing, this.lookFor(link));
        continue;
      }
      this.addRelationship(
        link.sourceElementIri,
        link.targetElementIri,
        typeIri,
        link.relationshipIri,
        link.waypoints,
        link.label,
        {
          source: this.shapeOfNode(link.sourceNodeIri) ?? this.lineOfLink(link.sourceNodeIri) ?? this.drawnOf(link.sourceElementIri),
          target: this.shapeOfNode(link.targetNodeIri) ?? this.lineOfLink(link.targetNodeIri) ?? this.drawnOf(link.targetElementIri),
        },
        link.linkIri,
      );
    }

    this.redrawContainers();
    this.applyViewpointMarkers();
    this.refreshLabelTexts();
  }

  /**
   * How a placement looks in the presentation context chosen: its style for
   * every context, laid over value by value by its style for that context
   * (core-vis 0.7) — `undefined` when it sets nothing.
   */
  /** Its own look for the presentation chosen alone — `undefined` with none chosen, or none of its own for it. */
  private contextLookOf(info: Pick<NodeInfo, 'contextAppearances'>): Appearance | undefined {
    const context = this.notationStyles.activePresentationContext;
    return context ? info.contextAppearances?.[context] : undefined;
  }

  /** A figure as it is drawn for the presentation chosen: its look for every one, the chosen one's laid over it. */
  private figureFor(node: Pick<NodeInfo, 'figure' | 'contextAppearances'>): FigureInfo | undefined {
    const context = this.notationStyles.activePresentationContext;
    const forContext = context ? node.contextAppearances?.[context] : undefined;
    return node.figure && forContext ? { ...node.figure, ...forContext } : node.figure;
  }

  private lookFor(node: Pick<NodeInfo, 'appearance' | 'contextAppearances'>): Appearance | undefined {
    const context = this.notationStyles.activePresentationContext;
    const forContext = context ? node.contextAppearances?.[context] : undefined;
    if (!forContext) return node.appearance;
    return { ...(node.appearance ?? {}), ...forContext };
  }

  /** Where label expressions read what they show: the model, its prefixes, names. Set by the workbench. */
  private labelSourceOf: LabelSource | undefined;

  set labelSource(source: LabelSource | undefined) {
    this.labelSourceOf = source;
    this.refreshLabelTexts();
  }

  get labelSource(): LabelSource | undefined {
    return this.labelSourceOf;
  }

  /**
   * The label expression an element's placement is drawn with in the
   * presentation context chosen: its own for that context, its own for every
   * context, its type's notation's (for the context, else for every one), the
   * context's — `undefined` for its name alone.
   */
  labelExpressionOf(node: Pick<NodeInfo, 'labelExpressions'>, typeIri: string | undefined): { expression: string; own: boolean } | undefined {
    const context = this.notationStyles.activePresentationContext;
    const own =
      (context ? node.labelExpressions?.find((l) => l.context === context) : undefined) ?? node.labelExpressions?.find((l) => !l.context);
    if (own) return { expression: own.expression, own: true };
    const notation = this.notationStyles.labelExpressionFor(typeIri);
    return notation !== undefined ? { expression: notation, own: false } : undefined;
  }

  /**
   * What each element's label says, by its expression (`labelExpressionOf`) —
   * else its name for the presentation context chosen (a SKOS-XL name) —
   * drawn in place of its canonical name; and each relationship's name on its
   * line, its name for that context. Redrawn where that changed. After a
   * sync, a command — a rename on the canvas is not followed by one — and a
   * change of presentation context.
   */
  private refreshLabelTexts(): void {
    const services = this.services();
    const viewIri = this.viewIri;
    if (!services || !viewIri || !this.viewManager) return;
    const nodes = new Map(this.viewManager.getNodes(viewIri).map((node) => [node.nodeIri, node]));
    for (const shape of services.elementRegistry.getAll().filter((e) => e.businessObject?.kind === 'element' && !e.waypoints)) {
      const businessObject = shape.businessObject!;
      const key = this.nodeKeyOf(shape);
      // A shape drawn before its placement was in the store knows only its element: its first placement, then.
      const node = key ? (nodes.get(key) ?? this.viewManager.getNode(viewIri, key)) : undefined;
      if (!node) continue;
      businessObject.nodeIri ??= node.nodeIri;
      // Its look for the presentation chosen (core-vis 0.7: a style per context).
      this.restyle(shape, this.lookFor(node));
      const said = this.labelExpressionOf(node, businessObject.typeIri);
      const source = this.labelSourceOf;
      const text = !source
        ? undefined
        : said
          ? labelFromExpression(said.expression, node.elementIri, source)
          : source.nameForContext?.(node.elementIri);
      // Its element's picture for that presentation (core 0.5.0), its icon where it is drawn as its icon.
      const picture = source?.pictureFor?.(node.elementIri);
      if (businessObject.labelText === text && businessObject.elementPicture === picture) continue;
      if (text === undefined) delete businessObject.labelText;
      else businessObject.labelText = text;
      if (picture === undefined) delete businessObject.elementPicture;
      else businessObject.elementPicture = picture;
      services.eventBus.fire('element.changed', { element: shape });
    }
    // A figure, for the presentation chosen: its look for it over its look for every one.
    for (const shape of services.elementRegistry.getAll().filter((e) => e.businessObject?.kind === 'figure' && !e.waypoints)) {
      const node = nodes.get(this.nodeKeyOf(shape) ?? '');
      const figure = node ? this.figureFor(node) : undefined;
      if (!figure || sameAppearance(shape.businessObject!.figure, figure)) continue;
      shape.businessObject!.figure = figure;
      services.eventBus.fire('element.changed', { element: shape });
    }
    // A line — a relationship's, or one from a note — its look for the presentation chosen; a relationship's name its name there.
    const allLinks = this.viewManager.getLinks(viewIri);
    // By its link — or, a line not told its link yet, by its relationship's first.
    const links = new Map([...allLinks.map((link) => [link.relationshipIri, link] as const).reverse(), ...allLinks.map((link) => [link.linkIri, link] as const)]);
    const source = this.labelSourceOf;
    for (const line of services.elementRegistry.getAll().filter((e) => (e.businessObject?.kind === 'relationship' || e.businessObject?.kind === 'connector') && e.waypoints)) {
      const businessObject = line.businessObject!;
      const link = links.get(this.linkKeyOf(line) ?? '');
      if (link) this.restyle(line, this.lookFor(link));
      if (businessObject.kind !== 'relationship') continue;
      const text = source?.nameForContext?.(businessObject.iri);
      if (businessObject.labelText === text) continue;
      if (text === undefined) delete businessObject.labelText;
      else businessObject.labelText = text;
      services.eventBus.fire('element.changed', { element: line });
    }
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
   * The shapes selected with `element` of its kind: elements or figures when
   * the model has folders to move them to, lines always (to shape them); none
   * when it is not selected.
   */
  private selectedAlike(element: DjsShape): DjsShape[] {
    const kind = element.businessObject?.kind;
    // Lines, for Line shape, whether or not the model has folders (Req 22.10).
    const lines = kind === 'relationship' || kind === 'connector';
    if (!this.onContextAction || (!lines && !this.canMoveToFolder?.())) return [];
    const selected = this.service<{ get(): DjsShape[] }>('selection')?.get() ?? [];
    if (!selected.includes(element)) return [];
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
    const elements = iris.flatMap((iri) => {
      const placed = this.shapesOf(iri);
      if (placed.length > 0) return placed;
      const lines = this.linesOf(iri);
      if (lines.length > 0) return lines;
      const line = this.findConnection(iri);
      return line ? [line] : [];
    });
    services.selection.select(elements);
  }

  /**
   * Select a concept on the canvas — every placement of an element — and scroll
   * the first into view. Returns whether it is drawn.
   */
  reveal(iri: string): boolean {
    const services = this.services();
    const placed = this.shapesOf(iri);
    const lines = this.linesOf(iri);
    const element = this.shapeOf(iri) ?? this.findConnection(iri);
    if (!services || !element) return false;
    services.selection.select(placed.length > 1 ? placed : lines.length > 1 ? lines : element);
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
    // Dragged in again, an element already here is placed once more.
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
  drawExistingRelationship(relationshipIri: string, ends: { source?: DjsShape; target?: DjsShape } = {}): boolean {
    const services = this.services();
    if (!services || !this.viewIri) return false;
    const rel = this.relationshipManager.getRelationship?.(relationshipIri);
    if (!rel) return false;
    const source = ends.source ?? this.drawnOf(rel.sourceIri);
    const target = ends.target ?? this.drawnOf(rel.targetIri);
    // Drawn already: between these placements — or, none named, at all.
    const drawn = ends.source || ends.target ? source && target && this.lineBetween(relationshipIri, source, target) : this.findConnection(relationshipIri);
    if (drawn) return this.reveal(relationshipIri);
    if (!source || !target) return false;
    const typeIri = this.describeElement?.(relationshipIri)?.typeIri ?? rel.classIri;
    const businessObject: RdfBusinessObject = {
      iri: relationshipIri,
      typeIri,
      kind: 'relationship',
      ...this.relationshipNameOf(relationshipIri),
      ...this.derivationOf(relationshipIri),
    };
    const line = services.modeling.createConnection(
      source,
      target,
      { id: relationshipIri, businessObject },
      services.canvas.getRootElement(),
      { [RDF_EXISTING_RELATIONSHIP_HINT]: relationshipIri },
    );
    this.relationships.set(line?.id ?? relationshipIri, {
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
    const drawn = this.drawnOf(iri);
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
    const drawn = isRelationship ? this.linesOf(iri) : this.shapesOf(iri);
    const apply = isRelationship
      ? () => this.relationshipManager.deleteRelationship(iri)
      : () => this.elementManager.deleteElement(iri);

    if (services) {
      const context: ModelDeleteContext = { elements: drawn, apply };
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
    parentNodeIri?: string,
    nodeIri?: string,
  ): void {
    const services = this.services();
    if (!services) return;

    // The placement this node draws — without a node, the element's (an event from elsewhere).
    const node = nodeIri ?? (this.viewIri ? this.viewManager?.getNode(this.viewIri, iri)?.nodeIri : undefined);
    const existing = node ? this.shapeOfNode(node) : this.shapeOf(iri);
    if (existing) {
      this.updateShape(existing, { label, iconUrl, bounds });
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
      ...(node ? { nodeIri: node } : {}),
      ...(node && this.appearanceToDraw.get(node) ? { appearance: this.appearanceToDraw.get(node)! } : {}),
    };

    const shape = services.elementFactory.createShape({
      // The element's IRI keys its first placement; a further one, its node.
      id: services.elementRegistry.get(iri) && node ? node : iri,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width || style?.defaultWidth || NOTATION_DEFAULTS.width,
      height: bounds.height || style?.defaultHeight || NOTATION_DEFAULTS.height,
      businessObject,
    });

    // Under the lines already drawn (rdf-ordering.ts): added without a command, so placed here.
    const container = this.containerFor(parentNodeIri);
    services.canvas.addShape(shape, container, shapeIndex(container));
    if (container !== services.canvas.getRootElement()) this.containersToRedraw.add(container);
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

    // Store-led: straight off the canvas, not through `modeling` — a command
    // here would land on the undo stack, and undoing it would bring back a shape
    // whose triples are gone.
    this.removingFromStore = true;
    try {
      for (const shape of this.shapesOf(iri)) this.removeShapeDirect(shape);
    } finally {
      this.removingFromStore = false;
    }
    this.redrawContainers();

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
   * A figure from the store, as `syncFromStore` draws an element: drawn when it
   * is not, moved, re-parented or given its new text when it is.
   */
  private syncFigure(node: NodeInfo): void {
    const services = this.services();
    const figure = this.figureFor(node);
    if (!services || !figure) return;
    const existing = this.shapeOfNode(node.nodeIri);
    const container = this.containerFor(node.parentNodeIri);
    if (!existing) {
      const shape = services.elementFactory.createShape({
        id: node.elementIri,
        ...node.bounds,
        businessObject: this.figureObject(node.elementIri, figure),
      });
      services.canvas.addShape(shape, container, shapeIndex(container));
      if (container !== services.canvas.getRootElement()) this.containersToRedraw.add(container);
      return;
    }
    if (existing.parent !== container) this.reparentDirect(existing, container);
    const b = node.bounds;
    const moved = existing.x !== b.x || existing.y !== b.y || existing.width !== b.width || existing.height !== b.height;
    const recoloured = !sameAppearance(existing.businessObject?.figure, figure);
    let retexted = false;
    const businessObject = existing.businessObject;
    if (businessObject) {
      // A reference pointed at another view — changed in the panel, by a collaborator, or undone — is that view's
      // placement now, of its class (VC-DD-1, VC-DD-2).
      const opened = businessObject.figure?.kind === 'reference' ? businessObject.figure.view : undefined;
      businessObject.figure = figure;
      if (figure.kind === 'reference') {
        businessObject.nodeIri ??= node.nodeIri;
        businessObject.typeIri = this.referenceTypeOf(figure);
        if (opened !== figure.view) this.reindexPlacement(existing, opened, figure.view);
      }
      // Its text — a reference's view's name too, which a rename or another view changes.
      retexted = this.showFigureText(businessObject, this.figureTextOf(figure));
    }
    if (moved) this.updateShape(existing, { bounds: b });
    else if (retexted || recoloured) services.eventBus.fire('element.changed', { element: existing });
  }

  /** A reference that opens another view now: found under that view's placements, no longer the one it opened. */
  private reindexPlacement(shape: DjsShape, from: string | undefined, to: string | undefined): void {
    if (from) {
      const set = this.placements.get(from);
      set?.delete(shape);
      if (set?.size === 0) this.placements.delete(from);
    }
    if (to) {
      let set = this.placements.get(to);
      if (!set) this.placements.set(to, (set = new Set()));
      set.add(shape);
    }
  }

  /** What a relationship's notation says of its name — its size, where it sits — under the line's own. */
  private nameNotationOf(line: DjsShape): { fontSize?: number; labelAnchor?: LabelAnchor } | undefined {
    return this.notationStyles.relationshipStyleFor(line.businessObject?.typeIri);
  }

  /** Draw a placement or a line with its look as the store now says, when that changed. */
  private restyle(drawn: DjsShape, appearance: Appearance | undefined): void {
    const businessObject = drawn.businessObject;
    if (!businessObject || sameAppearance(businessObject.appearance, appearance)) return;
    if (appearance) businessObject.appearance = appearance;
    else delete businessObject.appearance;
    this.services()?.eventBus.fire('element.changed', { element: drawn });
  }

  /**
   * What the property panel's Appearance tab edits: each selected thing's node
   * or link and what it is, the first one's own look and what it is drawn
   * with where it sets nothing, and the fields every one of them has.
   * `undefined` with nothing drawn selected, or no view open.
   */
  selectedAppearance(scope?: 'context' | 'every'): AppearanceSelection | undefined {
    const viewIri = this.viewIri;
    if (!viewIri || !this.viewManager) return undefined;
    const selected = this.service<{ get(): DjsShape[] }>('selection')?.get() ?? [];
    const described = selected
      .map((element) => this.appearanceOfDrawn(viewIri, element))
      .filter((d): d is DrawnLook => d !== undefined);
    const first = described[0];
    if (!first) return undefined;
    // With a presentation chosen, the look edited is its own — or the look for every presentation: by default its own
    // when the first one has one, or has no look at all for every presentation (core-vis 0.7: a style per context).
    const context = this.notationStyles.activePresentationContext;
    const hasContextLook = !!first.contextOwn && Object.keys(first.contextOwn).length > 0;
    const hasEveryLook = Object.keys(first.own).length > 0;
    const inScope: 'context' | 'every' = !context ? 'every' : (scope ?? (hasContextLook || !hasEveryLook ? 'context' : 'every'));
    // In the scope of one presentation: its own values; what it is drawn with otherwise, its look for every one.
    const ownOf = (d: DrawnLook): Appearance => (inScope === 'context' ? (d.contextOwn ?? {}) : d.own);
    const defaultsOf = (d: DrawnLook): Appearance => (inScope === 'context' ? { ...d.defaults, ...d.own } : d.defaults);
    const firstNode = first.target.kind === 'element' ? this.viewManager.getNode(viewIri, first.target.iri) : undefined;
    const figure = this.figureChoices(selected, { ...first.own, ...(first.contextOwn ?? {}) }, first.defaults, inScope === 'context' ? first.own : undefined);
    // A picture for elements and figures — every one selected — not for a line.
    const elements = described.every((d) => d.target.kind === 'element');
    // What a style says of the picture: its own icon — drawn as the figure in icon mode, as the badge in box mode
    // (core-vis: arch-vis:iconSymbol) — else the picture in it. The mode is its own, else what it is drawn with under it.
    // Its element's picture, where it has no icon of its own: its figure in icon mode, its badge where its style asks
    // for it (core-vis 0.8: arch-vis:useElementPicture), else inside the box.
    const scopeOf = (own: Appearance | undefined, under: Appearance): ImageScope => {
      const mode = own?.renderingMode ?? under.renderingMode;
      const useElementPicture = own?.useElementPicture ?? under.useElementPicture;
      return {
        ...(own?.iconSymbol
          ? { image: own.iconSymbol, ...(mode === 'IconCentric' ? { asFigure: true } : { asBadge: true }) }
          : own?.image
            ? { image: own.image }
            : {}),
        position: own?.imagePosition ?? 'TopLeft',
        ...(!own?.iconSymbol && mode === 'IconCentric' ? { elementAsFigure: true } : {}),
        ...(!own?.iconSymbol && useElementPicture && mode !== 'IconCentric' ? { elementAsBadge: true } : {}),
      };
    };
    const elementPicture = elements && firstNode ? this.labelSourceOf?.pictureFor?.(firstNode.elementIri) : undefined;
    const image = described.every((d) => IMAGE_KINDS.includes(d.target.kind))
      ? {
          ...scopeOf(first.own, first.defaults),
          canBeFigure: elements,
          // Per presentation: an element's placement, a figure.
          ...(context
            ? {
                context,
                ...(this.notationStyles.activePresentationContextLabel ? { contextLabel: this.notationStyles.activePresentationContextLabel } : {}),
                forContext: scopeOf(first.contextOwn, { ...first.defaults, ...first.own }),
              }
            : {}),
          ...(elementPicture ? { elementPicture } : {}),
          used: this.viewManager.usedImages?.() ?? [],
        }
      : undefined;
    const label = described.every((d) => d.target.kind === 'element') ? this.labelChoices(viewIri, selected[0]!, first.target.iri) : undefined;
    const fields = fieldsFor(described.map((d) => d.target.kind));
    // What each is drawn with: its own value, else its default — the first one's is not the others'.
    const shown = (d: DrawnLook, key: AppearanceKey) => ownOf(d)[key] ?? defaultsOf(d)[key];
    const mixed = fields.filter((key) => described.some((d) => shown(d, key) !== shown(first, key)));
    return {
      targets: described.map((d) => d.target),
      own: ownOf(first),
      defaults: defaultsOf(first),
      fields,
      scope: inScope,
      ...(context && this.notationStyles.activePresentationContextLabel ? { contextLabel: this.notationStyles.activePresentationContextLabel } : {}),
      ...(mixed.length > 0 ? { mixed } : {}),
      ...(figure ? { figure } : {}),
      ...(image ? { image: image satisfies ImageChoices } : {}),
      ...(label ? { label } : {}),
      ...(context ? { context } : {}),
    };
  }

  /** The presentation context chosen — the audience — that a name or a label expression for one context is for. */
  get presentationContextInUse(): string | undefined {
    return this.notationStyles.activePresentationContext;
  }

  /** What the Label tab shows of an element's placement. */
  private labelChoices(viewIri: string, shape: DjsShape, nodeIri: string): LabelChoices {
    const context = this.notationStyles.activePresentationContext;
    const node = this.viewManager?.getNode(viewIri, nodeIri);
    const own = node?.labelExpressions ?? [];
    const forContext = context ? own.find((l) => l.context === context)?.expression : undefined;
    const forEvery = own.find((l) => !l.context)?.expression;
    const inherited = this.notationStyles.labelExpressionFor(shape.businessObject?.typeIri);
    const inForce = forContext ?? forEvery ?? inherited;
    const businessObject = shape.businessObject;
    return {
      ...(context ? { context } : {}),
      ...(this.notationStyles.activePresentationContextLabel ? { contextLabel: this.notationStyles.activePresentationContextLabel } : {}),
      ...(forContext !== undefined ? { forContext } : {}),
      ...(forEvery !== undefined ? { forEvery } : {}),
      ...(inherited !== undefined ? { inherited } : {}),
      shown: businessObject?.labelText ?? businessObject?.label ?? '',
      errors: inForce !== undefined && this.labelSourceOf ? parseLabelExpression(inForce, this.labelSourceOf.prefixes).errors : [],
    };
  }

  /** Draw every element's label as its expression says now: after the Label tab writes one. */
  refreshLabels(): void {
    this.refreshLabelTexts();
  }

  /**
   * The figures the selection may be drawn as (the Figure tab): only when every
   * one is an element whose notation has a glyph to draw — a badge, or the figure.
   */
  private figureChoices(selected: DjsShape[], own: Appearance, defaults: Appearance, everyLook?: Appearance): FigureChoices | undefined {
    if (selected.length === 0 || selected.some((element) => element.businessObject?.kind !== 'element')) return undefined;
    const hrefs = selected.map((element) => iconHref(this.notationStyles.styleFor(element.businessObject?.typeIri)?.iconSymbol, assetUrl));
    const [iconHrefOfFirst] = hrefs;
    if (!iconHrefOfFirst || hrefs.some((href) => !href)) return undefined;
    const typeIri = selected[0]!.businessObject?.typeIri;
    const style = this.notationStyles.styleFor(typeIri);
    const notationMode = this.notationStyles.renderingModeFor(typeIri);
    const outline = (shape: VisualStyleShape, badge: boolean, dashed: boolean): FigureOption['preview'] => {
      const details = shapeGeometry(shape, 72, 40).details;
      return { outline: shapePath(shape, 0, 0, 72, 40), ...(details ? { details } : {}), badge, dashed };
    };
    const defaultShape = style?.customShape ?? style?.shapeType;
    const dashed = style?.borderStyle === 'DashedLine';
    const NAMES: Record<string, string> = { ShapeWithBadge: 'Shape with icon', IconCentric: 'Icon', ShapeOnly: 'Shape only' };
    // For one presentation (`everyLook`, its look for every one): absent keys fall back to that look, so a figure
    // it says is overridden with the notation's mode and default shape, said out.
    const defaultShapeIri = style?.customShape?.iri ?? (style?.shapeType ? NAMESPACES['arch-vis'] + style.shapeType : undefined);
    const overriding = !!everyLook && (everyLook.renderingMode !== undefined || everyLook.shapeType !== undefined);
    const generic = (mode: 'ShapeWithBadge' | 'IconCentric' | 'ShapeOnly', notation: boolean): FigureOption => ({
      label: NAMES[mode]!,
      mode,
      ...(notation ? { notation: true } : {}),
      changes: overriding
        ? { renderingMode: mode, shapeType: everyLook?.shapeType !== undefined ? (defaultShapeIri ?? null) : null }
        : { renderingMode: notation ? null : mode, shapeType: null },
      preview: mode === 'IconCentric' ? { icon: true } : outline(defaultShape, mode === 'ShapeWithBadge', dashed),
    });
    const options: FigureOption[] = [generic(notationMode, true)];
    // The notation's other figures, for one type: another's may not be this one's.
    const oneType = selected.every((element) => element.businessObject?.typeIri === typeIri);
    for (const alternative of oneType ? (style?.alternatives ?? []) : []) {
      const shapeIri = alternative.customShape?.iri ?? (alternative.shapeType ? NAMESPACES['arch-vis'] + alternative.shapeType : undefined);
      if (!shapeIri) continue;
      const mode = alternative.renderingMode === 'IconCentric' ? 'IconCentric' : alternative.renderingMode === 'ShapeOnly' ? 'ShapeOnly' : 'ShapeWithBadge';
      options.push({
        label: alternative.customShape?.label ?? humanize(alternative.shapeType ?? 'Shape'),
        mode,
        shapeIri,
        changes: { renderingMode: mode, shapeType: shapeIri },
        preview: outline(alternative.customShape ?? alternative.shapeType, mode === 'ShapeWithBadge', (alternative.borderStyle ?? style?.borderStyle) === 'DashedLine'),
      });
    }
    for (const mode of ['ShapeWithBadge', 'IconCentric', 'ShapeOnly'] as const) if (mode !== notationMode) options.push(generic(mode, false));
    // Drawn with a picture in place of the notation's glyph (the Image tab) — its own, or its element's as its badge
    // (core-vis 0.8): none of these — and any of them puts the glyph back.
    const pictured = !!own.iconSymbol || !!own.useElementPicture;
    if (pictured) {
      for (const option of options) option.changes = { ...option.changes, iconSymbol: null, useElementPicture: null };
    }
    // Drawn now as its own shape, its own mode — else as the notation draws it.
    const selectedIndex = pictured
      ? -1
      : own.shapeType
      ? options.findIndex((option) => option.shapeIri === own.shapeType)
      : own.renderingMode
        ? options.findIndex((option) => !option.shapeIri && (option.notation ? notationMode : option.mode) === own.renderingMode)
        : 0;
    return {
      options,
      selected: pictured ? -1 : Math.max(0, selectedIndex),
      iconHref: iconHrefOfFirst,
      fillColor: own.fillColor ?? defaults.fillColor ?? NOTATION_DEFAULTS.fillColor,
      lineColor: own.lineColor ?? defaults.lineColor ?? NOTATION_DEFAULTS.lineColor,
    };
  }

  /** One thing drawn, for the Appearance tab: its node or link, its own look, what it is drawn with otherwise. */
  private appearanceOfDrawn(viewIri: string, element: DjsShape): DrawnLook | undefined {
    const businessObject = element.businessObject;
    const viewManager = this.viewManager;
    if (!businessObject || !viewManager) return undefined;
    if (businessObject.kind === 'figure' || businessObject.kind === 'element') {
      const key = this.nodeKeyOf(element);
      const node = key ? viewManager.getNode(viewIri, key) : undefined;
      if (!node) return undefined;
      const contextOwn = this.contextLookOf(node);
      if (node.figure) {
        return {
          target: { iri: node.nodeIri, kind: node.figure.kind },
          own: appearanceOfFigure(node.figure),
          defaults: figureDefaults(node.figure.kind),
          ...(contextOwn ? { contextOwn } : {}),
        };
      }
      return {
        target: { iri: node.nodeIri, kind: 'element' },
        own: node.appearance ?? {},
        defaults: elementDefaults(this.notationStyles.styleFor(businessObject.typeIri)),
        ...(contextOwn ? { contextOwn } : {}),
      };
    }
    if (businessObject.kind === 'relationship' || businessObject.kind === 'connector') {
      const links = viewManager.getLinks(viewIri);
      const key = this.linkKeyOf(element);
      const link = links.find((l) => l.linkIri === key) ?? links.find((l) => l.relationshipIri === businessObject.iri);
      if (!link) return undefined;
      const connector = businessObject.kind === 'connector';
      const contextOwn = this.contextLookOf(link);
      return {
        target: { iri: link.linkIri, kind: connector ? 'connector' : 'relationship' },
        own: link.appearance ?? {},
        ...(contextOwn ? { contextOwn } : {}),
        defaults: lineDefaults(
          connector
            ? { lineColor: CONNECTOR_STYLE.lineColor, lineStyle: 'DashedLine', sourceDecor: 'NoDecoration', targetDecor: 'NoDecoration' }
            : this.notationStyles.relationshipStyleFor(businessObject.typeIri),
        ),
      };
    }
    return undefined;
  }

  /**
   * Draw each element and relationship as its notation does, leaving out the
   * look set on it in the view — or with it (the canvas toolbar's "Notation
   * only" switch, off by default). Everything is redrawn, alone.
   */
  setNotationOnly(on: boolean): void {
    if ((this.renderOptions.notationOnly ?? false) === on) return;
    this.renderOptions.notationOnly = on;
    const services = this.services();
    if (!services) return;
    for (const element of [...this.shapes(), ...this.connections()]) services.eventBus.fire('element.changed', { element });
  }

  /** Whether the canvas draws the notation alone. */
  notationOnly(): boolean {
    return this.renderOptions.notationOnly ?? false;
  }

  /**
   * What a figure's shape carries: its node as its IRI, its text as its name. A reference to another view is its
   * view's placement (VC-DD-1): its node is its placement's too, and its type the view's class (VC-DD-2).
   */
  private figureObject(iri: string, figure: FigureInfo): RdfBusinessObject {
    if (figure.kind !== 'reference') return { iri, typeIri: '', kind: 'figure', figure, ...this.figureTextOf(figure) };
    return { iri, ...(iri ? { nodeIri: iri } : {}), typeIri: this.referenceTypeOf(figure), kind: 'figure', figure, ...this.figureTextOf(figure) };
  }

  /** The class of the view a reference opens: its type for the rules (VC-DD-2) — a diagram's when it opens none. */
  private referenceTypeOf(figure: FigureInfo): string {
    return viewClassOf(figure.view ? this.viewManager?.getView(figure.view)?.type : undefined);
  }

  /**
   * The text a figure shows: its own, `named`. A reference to another view is named as its view is — what F2
   * renames — and its own text, an empty one too, is drawn in place of the name (`labelText`, VC-DD-4). A reference
   * whose view is not in the model has no name.
   */
  private figureTextOf(figure: FigureInfo): Pick<RdfBusinessObject, 'label' | 'named' | 'labelText'> {
    if (figure.kind === 'reference') {
      const name = figure.view ? this.viewManager?.getView(figure.view)?.label : undefined;
      return { ...(name ? { label: name, named: true } : {}), ...(figure.text !== undefined ? { labelText: figure.text } : {}) };
    }
    return figure.text !== undefined ? { label: figure.text, named: true } : {};
  }

  /** Give a figure's shape the text it shows now — what it no longer has, taken away: whether that changed it. */
  private showFigureText(businessObject: RdfBusinessObject, shown: Pick<RdfBusinessObject, 'label' | 'named' | 'labelText'>): boolean {
    const changed =
      (businessObject.label ?? '') !== (shown.label ?? '') ||
      Boolean(businessObject.named) !== Boolean(shown.named) ||
      businessObject.labelText !== shown.labelText;
    if (shown.label === undefined) delete businessObject.label;
    else businessObject.label = shown.label;
    if (shown.named === undefined) delete businessObject.named;
    else businessObject.named = shown.named;
    if (shown.labelText === undefined) delete businessObject.labelText;
    else businessObject.labelText = shown.labelText;
    return changed;
  }

  /**
   * Start a drag that draws a new figure where it is dropped — a group, a shape
   * of a core-vis shape type, a note — as the toolbar's figures do. The node is
   * written inside the resulting `shape.create` command, so one undo takes it
   * back. A drop into an element or a figure draws it inside.
   */
  startCreateFigure(kind: FigureKind, shapeType: string | undefined, event: unknown): void {
    const services = this.services();
    if (!services || !event || !this.viewIri) return;
    const figure: FigureInfo = { kind, ...(kind === 'shape' && shapeType ? { shapeType } : {}) };
    const shape = services.elementFactory.createShape({ ...FIGURE_SIZES[kind], businessObject: this.figureObject('', figure) });
    services.create.start(event, shape);
  }

  /**
   * Start a drag that makes a reference to `viewIri` where it is let go — on the
   * diagram, or inside the element, the group or the shape under the pointer —
   * the model tree's drag of a view's row (Req 3.23, VR-DD-1). Made as any figure
   * is, in the figure-create command: one undoable step, selected once made. The
   * open view's own row makes nothing on its own diagram: refused as it is
   * dragged over it, and said why when let go there.
   */
  startCreateReference(viewIri: string, event: unknown): void {
    const services = this.services();
    const shape = this.referenceShape(viewIri);
    if (!services || !shape || !event) return;
    services.create.start(event, shape);
  }

  /**
   * Make a reference to `viewIri` at the centre of the visible area, selected,
   * as one undoable step — the model tree's *Reference in the open view*, as
   * {@link placeExisting} places an element. False for the open view itself.
   */
  placeReference(viewIri: string): boolean {
    const services = this.services();
    const shape = viewIri === this.viewIri ? undefined : this.referenceShape(viewIri);
    if (!services || !shape) return false;
    const viewbox = services.canvas.viewbox() as { x: number; y: number; width?: number; height?: number };
    const at = {
      x: Math.round(viewbox.x + (viewbox.width ?? 800) / 2),
      y: Math.round(viewbox.y + (viewbox.height ?? 600) / 2),
    };
    (services.modeling as unknown as { createShape(s: unknown, p: unknown, parent: unknown): unknown }).createShape(
      shape,
      at,
      services.canvas.getRootElement(),
    );
    this.service<{ select(element: unknown): void }>('selection')?.select(shape);
    return true;
  }

  /**
   * A reference to `viewIri` not yet written: 120 × 55, no text of its own — it
   * shows the view's name — and its colours unset (VR-3). None without a diagram
   * open, or for what is no view of the model.
   */
  private referenceShape(viewIri: string): DjsShape | undefined {
    const services = this.services();
    if (!services || !this.viewIri || !this.viewManager?.getView(viewIri)) return undefined;
    const figure: FigureInfo = { kind: 'reference', view: viewIri };
    return services.elementFactory.createShape({ ...FIGURE_SIZES.reference, businessObject: this.figureObject('', figure) });
  }

  /** Whether a shape is a reference to the open view not yet made: what its own row's drag would make (VR-1). */
  private isOwnViewReference(shape: DjsShape | undefined): boolean {
    const businessObject = shape?.businessObject;
    return (
      businessObject?.kind === 'figure' &&
      !businessObject.iri &&
      businessObject.figure?.kind === 'reference' &&
      businessObject.figure.view === this.viewIri
    );
  }

  /**
   * Ask the app to open the view a reference opens (`open-referenced-view`): its
   * double-click, its pad's and its menu's *Open view*. The app opens it, or
   * says it is not in the model (Req 3.23).
   */
  private openReferencedView(element: DjsShape): void {
    const figure = element.businessObject?.kind === 'figure' ? element.businessObject.figure : undefined;
    const nodeIri = this.nodeKeyOf(element);
    if (figure?.kind !== 'reference' || !nodeIri) return;
    this.eventBus.emit('open-referenced-view', { nodeIri, ...(figure.view ? { viewIri: figure.view } : {}) });
  }

  /**
   * The reference selected on the canvas — the first selected, when it is one — and the view it opens: what the
   * property panel shows the view of, with the reference's own text and *Opens* (VC-1, VC-DD-3).
   */
  selectedReference(): { nodeIri: string; viewIri?: string } | undefined {
    const [first] = this.service<{ get(): DjsShape[] }>('selection')?.get() ?? [];
    const nodeIri = first && isViewReference(first) ? this.nodeKeyOf(first) : undefined;
    if (!nodeIri) return undefined;
    const viewIri = conceptIriOf(first);
    return { nodeIri, ...(viewIri ? { viewIri } : {}) };
  }

  /**
   * A reference's *Delete from model…*: its view, deleted as the model tree deletes it — the app asks first, and
   * says how many references to it and relationships with it go with it (VC-7).
   */
  private deleteReferencedView(element: DjsShape): void {
    const viewIri = conceptIriOf(element);
    if (viewIri) this.onContextAction?.('delete-view', viewIri);
  }

  /**
   * The views refining what a shape or a line stands for — an element, a relationship — by name: what zooming in
   * from it opens (VC-6). None for a figure, or without a view manager that can tell.
   */
  private viewsRefining(element: unknown): ViewInfo[] {
    const businessObject = (element as DjsShape | undefined)?.businessObject;
    if (businessObject?.kind !== 'element' && businessObject?.kind !== 'relationship') return [];
    const concept = conceptIriOf(element);
    return concept ? (this.viewManager?.viewsRefining?.(concept) ?? []) : [];
  }

  /** *Zoom in* from a shape or a line: the one view refining it opens; several are listed at `at`, to pick one. */
  private zoomIn(element: DjsShape, at: { x: number; y: number }): void {
    const views = this.viewsRefining(element);
    const services = this.services();
    if (views.length === 0 || !services) return;
    if (views.length === 1) {
      this.openView(views[0]!.iri);
      return;
    }
    this.zoomMenuProvider.pending = { views };
    services.popupMenu.open(element, ZOOM_MENU_ID, at, { title: 'Zoom in', width: 280 });
  }

  /** Ask the app to open a view (`open-view`): zooming in (VC-6). */
  private openView(viewIri: string): void {
    this.eventBus.emit('open-view', { viewIri });
  }

  /**
   * Redraw the references in the open diagram to these views, whose names may
   * have changed: each is named as its view is now — renamed here, in the tree,
   * in the panel, by a collaborator, or undone (VR-DD-2) — which shows where it
   * has no text of its own (VC-DD-4).
   */
  private renameReferencesTo(viewIris: ReadonlySet<string>): void {
    const services = this.services();
    const viewIri = this.viewIri;
    const viewManager = this.viewManager;
    if (!services || !viewIri || !viewManager?.referencesTo) return;
    for (const renamed of viewIris) {
      for (const reference of viewManager.referencesTo(renamed)) {
        if (reference.holderIri !== viewIri) continue;
        const shape = this.shapeOfNode(reference.nodeIri);
        const businessObject = shape?.businessObject;
        if (!shape || businessObject?.kind !== 'figure' || businessObject.figure?.kind !== 'reference') continue;
        if (this.showFigureText(businessObject, this.figureTextOf(businessObject.figure))) {
          services.eventBus.fire('element.changed', { element: shape });
        }
      }
    }
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
    // Its name and icon on every placement; bounds are a placement's own.
    for (const shape of this.shapesOf(iri)) {
      this.updateShape(shape, updates.bounds !== undefined && this.shapesOf(iri).length > 1 ? { ...updates, bounds: undefined } : updates);
    }
  }

  /** Update one placement's label, icon or bounds and redraw it. */
  private updateShape(
    shape: DjsShape,
    updates: Partial<Pick<CanvasElement, 'label' | 'iconUrl' | 'bounds'>> & { named?: boolean },
  ): void {
    const services = this.services();
    if (!services) return;
    const iri = shape.businessObject?.iri ?? shape.id;
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
    labelBounds?: Bounds,
    ends: { source?: DjsShape; target?: DjsShape } = {},
    linkIri?: string,
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
    // Drawn already: the link's line, or — no link named — the relationship's.
    if (linkIri ? this.lineOfLink(linkIri) : services.elementRegistry.get(key)) return;

    // Between the placements given — the link's — else an end's first.
    const source = ends.source ?? this.drawnOf(sourceIri);
    const target = ends.target ?? this.drawnOf(targetIri);
    if (!source || !target) return;

    const businessObject: RdfBusinessObject = {
      iri: relationshipIri ?? key,
      typeIri,
      kind: 'relationship',
      ...(relationshipIri ? { ...this.relationshipNameOf(relationshipIri), ...this.derivationOf(relationshipIri) } : {}),
      ...(linkIri ? { linkIri } : {}),
      ...(linkIri && this.appearanceToDraw.get(linkIri) ? { appearance: this.appearanceToDraw.get(linkIri)! } : {}),
    };

    // Store-led, so added directly rather than through `modeling` (see
    // removeElement). The route is the persisted one when there is one, else
    // what the layouter would draw.
    const connection = services.elementFactory.createConnection({
      // The relationship's IRI keys its first line; a further one, its link.
      id: services.elementRegistry.get(key) && linkIri ? linkIri : key,
      businessObject,
      source,
      target,
      waypoints: [],
    });
    connection.waypoints =
      waypoints && waypoints.length > 0
        ? this.drawnRoute(waypoints, source, target)
        : services.layouter.layoutConnection(connection, { source, target });
    // Its name where the view keeps it: the same offset from the middle of the route as drawn.
    const labelOffset = labelBounds ? labelOffsetOf(connection.waypoints, labelBounds) : undefined;
    if (labelOffset) businessObject.labelOffset = labelOffset;
    services.canvas.addConnection(connection, services.canvas.getRootElement());
    this.applyKeptMarkers(connection);
  }

  /**
   * Draw a line standing for no relationship — from a note or another figure —
   * or keep the one drawn in step: its ends, its route. Store-led, as
   * {@link addRelationship}.
   */
  private syncConnector(link: LinkInfo, existing: DjsShape | undefined): void {
    const services = this.services();
    if (!services) return;
    const source = this.shapeOfNode(link.sourceNodeIri);
    const target = this.shapeOfNode(link.targetNodeIri);
    // Re-pointed — by a collaborator, or an edit undone: drawn again between its ends.
    if (existing && (existing.source !== source || existing.target !== target)) {
      this.removingFromStore = true;
      try {
        this.removeConnectionDirect(existing);
      } finally {
        this.removingFromStore = false;
      }
      existing = undefined;
    }
    if (!source || !target) return;
    if (existing) {
      const route = link.waypoints.length > 0 ? this.drawnRoute(link.waypoints, source, target) : undefined;
      if (route && !sameRoute(existing.waypoints, route.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })))) {
        existing.waypoints = route;
        services.eventBus.fire('elements.changed', { elements: [existing] });
      }
      // What it says, and where — changed by a collaborator, or an edit undone.
      const drawn = existing.businessObject;
      if (drawn) {
        const kept = link.text && link.label ? labelOffsetOf(existing.waypoints ?? [], link.label) : undefined;
        const shown = drawn.labelOffset;
        const moved = !kept || !shown ? kept !== shown : Math.abs(kept.x - shown.x) > 1 || Math.abs(kept.y - shown.y) > 1;
        if ((drawn.label ?? '') !== (link.text ?? '') || moved) {
          if (link.text) Object.assign(drawn, { label: link.text, named: true });
          else {
            delete drawn.label;
            drawn.named = false;
          }
          if (kept) drawn.labelOffset = kept;
          else delete drawn.labelOffset;
          services.eventBus.fire('element.changed', { element: existing });
        }
      }
      this.restyle(existing, this.lookFor(link));
      return;
    }
    const businessObject: RdfBusinessObject = {
      iri: link.linkIri,
      linkIri: link.linkIri,
      typeIri: '',
      kind: 'connector',
      ...(this.lookFor(link) ? { appearance: this.lookFor(link)! } : {}),
      ...(link.text ? { label: link.text, named: true } : {}),
    };
    const connection = services.elementFactory.createConnection({ id: link.linkIri, businessObject, source, target, waypoints: [] });
    connection.waypoints =
      link.waypoints.length > 0
        ? this.drawnRoute(link.waypoints, source, target)
        : services.layouter.layoutConnection(connection, { source, target });
    // What it says, where the view keeps it.
    const labelOffset = link.text && link.label ? labelOffsetOf(connection.waypoints, link.label) : undefined;
    if (labelOffset) businessObject.labelOffset = labelOffset;
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
      this.shapeOf(iri);
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

    const sourceType = (connection.source as DjsShape | undefined)?.businessObject?.typeIri ?? this.drawnOf(existing.sourceIri)?.businessObject?.typeIri;
    const targetType = (connection.target as DjsShape | undefined)?.businessObject?.typeIri ?? this.drawnOf(existing.targetIri)?.businessObject?.typeIri;
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
    // Another notation set — another presentation — may label elements otherwise.
    this.refreshLabelTexts();

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
   * outlines, bendpoint handles) is stripped. Written as XML (an HTML
   * serialisation would write a non-breaking space as `&nbsp;`, which XML does
   * not know), with every `<defs>` of the canvas — the lines' end markers are
   * in their own. Its pictures are still linked: `inlineImages` puts them in.
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
      const label = element.waypoints
        ? drawnConnectionLabel(element as never, this.renderOptions, this.nameNotationOf(element))?.box
        : undefined;
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
      for (const chrome of layer.querySelectorAll(
        '.djs-hit, .djs-outline, .djs-bendpoint, .djs-segment-dragger, .djs-dragger, .djs-resizer, .djs-context-pad',
      )) {
        chrome.remove();
      }
    }
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const doc = svg.ownerDocument;
    const out = doc.createElementNS(SVG_NS, 'svg');
    out.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:xlink', 'http://www.w3.org/1999/xlink');
    out.setAttribute('width', String(width));
    out.setAttribute('height', String(height));
    out.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
    for (const defs of Array.from(svg.children).filter((child) => child.localName === 'defs')) {
      out.appendChild(defs.cloneNode(true));
    }
    const background = doc.createElementNS(SVG_NS, 'rect');
    for (const [name, value] of Object.entries({ x, y, width, height })) background.setAttribute(name, String(value));
    background.setAttribute('fill', '#ffffff');
    out.appendChild(background);
    for (const child of Array.from(layer?.childNodes ?? [])) out.appendChild(child);
    return new XMLSerializer().serializeToString(out);
  }

  /** Tear the diagram down and leave the host container empty. */
  destroy(): void {
    this.unbindClipboard();
    this.stopFollowingViewNames?.();
    this.stopFollowingViewNames = undefined;
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
    const shape = this.shapeOf(iri);
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
      // Its other placements are retyped with it.
      others: this.shapesOf(iri).filter((placement) => placement !== shape),
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
   * the questions about it; a relationship's ends), its IRI, and deleting it —
   * a figure, from the view only, a reference opening its view first. On the canvas root, the
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
      const lines = shown.kind === 'relationship' || shown.kind === 'connector';
      const words = shown.kind === 'relationship' ? 'relationships' : 'elements';
      return [
        ...this.clipboardMenuActions(!lines),
        // A line from a note or a figure is in no folder.
        ...(shown.kind !== 'connector' && this.canMoveToFolder?.()
          ? [{ id: 'move-to-folder', label: `Move ${alike.length} ${words} to folder…`, section: 'edit' as const, run: () => this.onContextAction?.('move-to-folder', iri) }]
          : []),
        // Every selected line given the shape.
        ...(lines ? this.lineShapeMenuActions(element, iri) : []),
      ];
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
      // Cut, copy and duplicate it — with the others selected — and paste.
      actions.push(...this.clipboardMenuActions(true));
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
      // A name moved by hand: back to its place on its line — the middle, or the end its look anchors it at — undoably.
      if (shown.labelOffset && drawnConnectionLabel(element, this.renderOptions, this.nameNotationOf(element)) && this.canMoveLinkLabel(element)) {
        actions.push({
          id: 'name-to-middle',
          label: 'Move name back to its place',
          section: 'edit',
          run: () => this.services()?.commandStack.execute(MOVE_LINK_LABEL_COMMAND, { connection: element, offset: undefined }),
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
      // A line is copied with its ends: only pasting here.
      actions.push(...this.clipboardMenuActions(false));
      actions.push(...this.lineShapeMenuActions(element, iri));
    } else if (shown.kind === 'connector') {
      // A line from a note or a figure: shaped as a relationship's line is.
      actions.push(...this.lineShapeMenuActions(element, iri));
    } else if (shown.kind === 'figure') {
      // A reference to another view opens it, first, as its double-click does (Req 3.23) — and, its view's
      // placement, renames the view as an element's box renames the element (VC-DD-4).
      if (isViewReference(element)) {
        actions.push({ id: 'open-view', label: 'Open view', section: 'view', run: () => this.openReferencedView(element) });
        actions.push({
          id: 'rename',
          label: 'Rename',
          section: 'edit',
          shortcut: 'F2',
          run: () => this.service<{ activate(element: unknown): boolean }>('directEditing')?.activate(element),
        });
      }
      // A group, a note, a shape or a reference: cut, copied and duplicated as an element is.
      actions.push(...this.clipboardMenuActions(true));
    }
    // Refined by a view — `V arch:refines` it — an element or a relationship zooms into each (VC-6).
    this.viewsRefining(element).forEach((view, index) => {
      actions.push({ id: `zoom-in-${index}`, label: `Zoom in: ${view.label || localName(view.iri)}`, section: 'view', run: () => this.openView(view.iri) });
    });

    // Drawing — a figure, a line from one — is in no folder, no tree and no model: taken off the view only. A
    // reference is its view's placement: what is looked at, its IRI copied, deleted from the model, is the view.
    const concept = shown.kind === 'element' || shown.kind === 'relationship';
    const reference = isViewReference(element) ? conceptIriOf(element) : undefined;
    const ofView = (action: CanvasContextAction) => () => (reference ? this.onContextAction?.(action, reference) : undefined);
    if (concept && this.onContextAction && this.canMoveToFolder?.()) {
      actions.push({ id: 'move-to-folder', label: 'Move to folder…', section: 'edit', run: host('move-to-folder') });
    }
    if (this.onContextAction && reference) {
      actions.push({ id: 'properties', label: 'Properties', section: 'show', run: ofView('properties') });
      actions.push({ id: 'reveal-tree', label: 'Show in model tree', section: 'show', run: ofView('reveal-tree') });
      actions.push({ id: 'copy-iri', label: 'Copy IRI', section: 'copy', run: ofView('copy-iri') });
    } else if (this.onContextAction) {
      actions.push({ id: 'properties', label: 'Properties', section: 'show', run: host('properties') });
      if (concept) actions.push({ id: 'reveal-tree', label: 'Show in model tree', section: 'show', run: host('reveal-tree') });
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
    if (this.viewManager && concept) {
      actions.push({ id: 'delete-model', label: 'Delete from model…', section: 'delete', run: () => void this.deleteFromModel(iri) });
    }
    // A reference's view, deleted from the model as the tree deletes it, after the app asks (VC-7).
    if (this.viewManager && reference && this.onContextAction) {
      actions.push({ id: 'delete-model', label: 'Delete view from model…', section: 'delete', run: () => this.deleteReferencedView(element) });
    }
    return actions;
  }

  /**
   * *Line shape* on a line's right-click menu (Req 22.9, LS-8): the four shapes, in a group of their own, for the
   * selected lines — this one, or the several selected with it. None for a line no shape applies to (LS-1).
   */
  private lineShapeMenuActions(line: DjsShape, iri: string): ContextMenuAction[] {
    if (!this.onContextAction || !this.arranger().shapeable(line as unknown as ArrangeShape)) return [];
    return LINE_SHAPES.map(({ shape, label }) => ({
      id: `line-${shape}`,
      label,
      section: 'route' as const,
      run: () => this.onContextAction?.(`line-${shape}`, iri),
    }));
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
        { id: 'arrange-view', label: 'Arrange view…', section: 'edit', run: host('arrange-view') },
        { id: 'arrange-relationships', label: 'Arrange relationships…', section: 'edit', run: host('arrange-relationships') },
        { id: 'align-to-grid', label: 'Align to grid…', section: 'edit', run: host('align-to-grid') },
        { id: 'sizes', label: 'Sizes…', section: 'edit', run: host('sizes') },
      );
    }
    actions.push(...this.clipboardMenuActions(false));
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
        // The picture, to paste into a document or a slide (Req 14.4).
        { id: 'copy-png', label: 'Copy view as PNG', section: 'copy', run: host('copy-png') },
        { id: 'copy-svg', label: 'Copy view as SVG', section: 'copy', run: host('copy-svg') },
        { id: 'export-svg', label: 'Export view as SVG', section: 'export', run: host('export-svg') },
        { id: 'export-png', label: 'Export view as PNG', section: 'export', run: host('export-png') },
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

    if (typeof source === 'string') return this.drawnOf(source);

    const carried = (source as { diagramElement?: unknown }).diagramElement as
      | DjsShape
      | undefined;
    if (carried && services.elementRegistry.get(carried.id)) return carried;

    const iri = (source as AppendMenuContext).sourceIri ?? (source as ContextPadElement).iri;
    return iri ? this.drawnOf(iri) : undefined;
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
        otherInView: this.shapesOf(other).length > 0,
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
      if (!this.shapeOf(row.otherIri)) {
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
    const sourceTypeIri = ((connection.source as DjsShape | undefined) ?? this.drawnOf(relationship.sourceIri))?.businessObject?.typeIri;
    const targetTypeIri = ((connection.target as DjsShape | undefined) ?? this.drawnOf(relationship.targetIri))?.businessObject?.typeIri;
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

  /** The relationship-type menu on a line, at a point: after a connect that chose no type. */
  private openRelationshipTypeMenuAt(connection: DjsShape, at: { x: number; y: number }): void {
    const services = this.services();
    if (!services || services.popupMenu.isEmpty(connection, RELATIONSHIP_REPLACE_MENU_ID)) return;
    services.popupMenu.open(connection, RELATIONSHIP_REPLACE_MENU_ID, at, {
      title: 'Change relationship type',
      width: 300,
      search: true,
    });
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
    const drawn = this.drawnAwaitingType?.connectionId === connectionId ? this.drawnAwaitingType : undefined;
    const changed = this.changeRelationshipType(connectionId, typeIri);
    // Picked from the menu the drawing opened: one undo takes the line away, not the type first (Req 4.2).
    if (changed && drawn) joinLastStep(this.services()?.commandStack, drawn.stepId);
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
    const indexed = this.lines.get(relationshipIri)?.values().next().value;
    if (indexed) return indexed;
    const byId = services.elementRegistry.get(relationshipIri);
    if (byId) return byId;
    for (const c of this.otherwiseNamed) if (c.businessObject?.iri === relationshipIri && services.elementRegistry.get(c.id)) return c;
    return undefined;
  }

  /**
   * Remove a connection without a command (store-led) — and from its ends:
   * diagram-js's canvas unsets a connection's parent, not its `source` and
   * `target`, so its ends still listed it among their `incoming`/`outgoing`,
   * and deleting one of them later deleted the line again, parentless — and
   * threw.
   */
  private removeConnectionDirect(connection: DjsShape): void {
    const services = this.services();
    if (!services || !services.elementRegistry.get(connection.id)) return;
    services.canvas.removeConnection(connection);
    // Unset, the references take it out of the ends' lists.
    connection.source = undefined;
    connection.target = undefined;
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
    // Emptied, its name goes back to the middle.
    if (container !== services.canvas.getRootElement()) this.containersToRedraw.add(container);
  }

  /** The shape a node is drawn inside — the placement drawing that node — else the diagram. */
  private containerFor(parentNodeIri: string | undefined): DjsShape {
    const services = this.services()!;
    const parent = this.shapeOfNode(parentNodeIri);
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
    // Before the first line, as a moved shape goes (rdf-ordering.ts).
    const children = (container.children ??= []);
    children.splice(shapeIndex(container) ?? children.length, 0, shape);
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
      // An element's type; a figure has none the viewpoint judges — a reference's view's class neither.
      const typeIri = shape.businessObject?.kind === 'figure' ? undefined : shape.businessObject?.typeIri;
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
    // An element, or a reference — its view, of its class: a view nested in an element may refine it (VC-5). A
    // note, a group or a shape stands for nothing.
    const innerIri = innerObject.kind === 'element' || isViewReference(inner) ? conceptIriOf(inner) : undefined;
    if (!innerIri || outerObject.kind !== 'element') return;
    const innerEnd = { iri: innerIri, typeIri: innerObject.typeIri };
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

  /**
   * Before a line drawn on the canvas creates a relationship: when the model
   * already relates the two by the type, in that direction, and this view does
   * not draw it, ask — the existing one, drawn here too, or a new one
   * (`reuse-relationship.ts`). The question opens once the drag has ended.
   * Derivations the model does not state are not offered: they are not its
   * statements.
   */
  private reuseCheck(): RdfReuseCheck {
    return ({ source, target, typeIri, createNew }) => {
      const services = this.services();
      // The concepts at the ends — a reference's view (VC-DD-1).
      const sourceIri = conceptIriOf(source);
      const targetIri = conceptIriOf(target);
      if (!services || !this.viewIri || !sourceIri || !targetIri) return false;
      const existing = this.relationshipsBetween(sourceIri, targetIri).filter(
        (r) =>
          r.classIri === typeIri &&
          r.sourceIri === sourceIri &&
          r.targetIri === targetIri &&
          // Drawn in this view, but not between these placements: drawn again here.
          !this.lineBetween(r.iri, source as DjsShape, target as DjsShape) &&
          !this.describeElement?.(r.iri)?.derivation,
      );
      if (existing.length === 0) return false;
      const typeLabel = this.paletteDefinition.relationshipTypes.find((t) => t.iri === typeIri)?.label ?? localName(typeIri);
      const close = () => {
        this.reuseMenuProvider.pending = undefined;
        this.services()?.popupMenu.close();
      };
      this.reuseMenuProvider.pending = {
        typeIri,
        typeLabel,
        sourceLabel: source.businessObject?.label ?? localName(sourceIri),
        targetLabel: target.businessObject?.label ?? localName(targetIri),
        existing: existing.map((r) => {
          const name = this.relationshipNameOf(r.iri).label;
          return { iri: r.iri, ...(name ? { name } : {}) };
        }),
        useExisting: (iri) => {
          close();
          // Between the placements the line was drawn between.
          this.drawExistingRelationship(iri, { source: source as DjsShape, target: target as DjsShape });
        },
        createNew: () => {
          close();
          createNew();
        },
      };
      const shape = target as DjsShape;
      queueMicrotask(() => {
        if (!this.reuseMenuProvider.pending) return;
        const box = shape ? services.elementRegistry.getGraphics(shape)?.getBoundingClientRect?.() : undefined;
        services.popupMenu.open(shape ?? {}, REUSE_MENU_ID, box ? { x: box.left, y: box.bottom + 4 } : { x: 0, y: 0 }, {
          title: 'The model already has this relationship',
          width: 320,
        });
      });
      return true;
    };
  }

  /** The relationship picked for a nesting, created in the model — undoably, and not drawn: the nesting shows it. */
  private nestAs(offer: NestingOffer | undefined): void {
    this.services()?.popupMenu.close();
    this.nestMenuProvider.pending = undefined;
    const create = this.relationshipManager.createQualifiedRelationship?.bind(this.relationshipManager);
    if (!offer || !create) return;
    const modelIri = this.modelIri;
    const viewIri = this.viewIri;
    const viewManager = this.viewManager;
    this.recordChange(() => {
      const created = create({
        typeIri: offer.type.iri,
        ...(offer.type.unqualifiedPredicateIri && offer.type.unqualifiedPredicateIri !== offer.type.iri
          ? { predicateIri: offer.type.unqualifiedPredicateIri }
          : {}),
        sourceIri: offer.sourceIri,
        targetIri: offer.targetIri,
        ...(modelIri ? { modelIri } : {}),
      });
      // The view's, shown by the nesting: drawn as a line if what is inside is taken out.
      if (viewIri && viewManager?.addMember) viewManager.addMember(viewIri, created.iri);
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
    // A connector is its own link, in no membership.
    const placedIn = (viewManager as { placedIn?(viewIri: string): ReadonlySet<string> }).placedIn;
    const drawn =
      connection.businessObject?.kind === 'connector' ||
      (placedIn
        ? placedIn.call(viewManager, viewIri).has(relationshipIri)
        : viewManager.getLinks(viewIri).some((l) => l.relationshipIri === relationshipIri));
    if (!drawn) return;
    const route = this.routeOf(connection);
    // A name moved off the middle follows the line: its bounds are written with the route.
    const offset = connection.businessObject?.labelOffset;
    const label = offset ? this.labelBoundsAt(connection, offset) : undefined;
    // That line's link.
    const link = this.linkKeyOf(connection) ?? relationshipIri;
    this.change(() => {
      viewManager.updateLinkWaypoints(viewIri, link, route);
      if (label) viewManager.setLinkLabel?.(viewIri, link, label);
    });
  }

  /** The box a line's name takes at `offset` from the middle of its route, as the view keeps it. */
  private labelBoundsAt(line: LabelledLine, offset: LabelOffset): Bounds | undefined {
    const businessObject = line.businessObject;
    const name = businessObject?.named ? (businessObject.label ?? '') : '';
    const box = connectionLabelLayout(line.waypoints ?? [], name, { offset })?.box;
    if (!box) return undefined;
    // Whole pixels, as the view keeps bounds, around the centre rounded: the centre is what is read back.
    const width = 2 * Math.round(box.width / 2);
    const height = 2 * Math.round(box.height / 2);
    const centre = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    return { x: centre.x - width / 2, y: centre.y - height / 2, width, height };
  }

  /** Keeps where a line's name was moved to in the open view, or drops it (`rdf.link.label.move`). */
  private linkLabelWriter(): LinkLabelWriter {
    return (line, offset) => {
      const link = line.businessObject?.linkIri ?? line.businessObject?.iri;
      if (!link || !this.viewIri) return;
      this.viewManager?.setLinkLabel?.(this.viewIri, link, offset ? this.labelBoundsAt(line, offset) : undefined);
    };
  }

  /** A line's name moves in an open view, unless a collaborator holds the line. */
  private canMoveLinkLabel(line: LabelledLine): boolean {
    const iri = line.businessObject?.iri;
    return this.hasViewContext() && !!this.viewManager?.setLinkLabel && !!iri && !this.locked.has(iri);
  }

  /**
   * After an existing element is placed, draw its relationships to every
   * element already in the view — what makes "add to view" useful for exploring a model.
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
    // An element's — a reference's view's (VC-4).
    const iri = conceptIriOf(shape);
    if (!services || !iri || !this.relationshipManager.getRelationshipsOf) return;
    // Then those ending on a relationship just drawn, and so on.
    const ends = [iri];
    for (let at = 0; at < ends.length; at++) {
      this.drawRelationshipsAt(ends[at], ends);
    }
  }

  /** Draw the relationships at one end that both ends allow; note each drawn in `drawn`. */
  private drawRelationshipsAt(iri: string, drawn: string[]): void {
    if (!this.relationshipManager.getRelationshipsOf) return;
    for (const rel of this.relationshipManager.getRelationshipsOf(iri)) {
      if (this.drawLine(rel)) drawn.push(rel.iri);
    }
  }

  /**
   * Draw a relationship the model has as a line in the open view, inside the
   * command running — its link written with it (`RDF_EXISTING_RELATIONSHIP_HINT`).
   * Not when it is drawn already, when an end is not drawn, or when it is a
   * derivation the model does not state (drawn when asked for, not with its ends).
   */
  private drawLine(rel: RelationshipInfo, ends: { source?: DjsShape; target?: DjsShape } = {}): boolean {
    const services = this.services();
    if (!services) return false;
    if (this.describeElement?.(rel.iri)?.derivation) return false;
    // Between the placements given, else an end's first.
    const source = ends.source ?? this.drawnOf(rel.sourceIri);
    const target = ends.target ?? this.drawnOf(rel.targetIri);
    if (!source || !target) return false;
    // Drawn already: between these placements — or, none named, at all.
    if (ends.source || ends.target ? this.lineBetween(rel.iri, source, target) : this.findConnection(rel.iri)) return false;
    const typeIri = this.describeElement?.(rel.iri)?.typeIri ?? rel.classIri;
    const businessObject: RdfBusinessObject = { iri: rel.iri, typeIri, kind: 'relationship', ...this.relationshipNameOf(rel.iri) };
    const line = services.modeling.createConnection(
      source,
      target,
      { id: rel.iri, businessObject },
      services.canvas.getRootElement(),
      // Draw, do not create: the relationship is already in the model.
      { [RDF_EXISTING_RELATIONSHIP_HINT]: rel.iri },
    );
    this.relationships.set(line?.id ?? rel.iri, {
      sourceIri: rel.sourceIri,
      targetIri: rel.targetIri,
      typeIri,
      predicateIri: rel.predicateIri,
      relationshipIri: rel.iri,
    });
    return true;
  }

  /** The relationships between two elements, in the model. */
  private relationshipsBetween(a: string, b: string): RelationshipInfo[] {
    return (this.relationshipManager.getRelationshipsOf?.(a) ?? []).filter(
      (r) => (r.sourceIri === a && r.targetIri === b) || (r.sourceIri === b && r.targetIri === a),
    );
  }

  /**
   * Nested: no line runs between an element and its container — what is inside
   * is not crossed by lines to what holds it. Every relationship between the
   * two drawn in the view, of any type and either way, loses its line and stays
   * the view's (`arch:inView`), to be drawn again when the element is taken out
   * ({@link showAsLines}). And the relationships the nesting may stand for — of
   * a type nesting may draw, the inner element the end drawn inside (Req 3.12) —
   * are the view's though no line drew them: the nesting shows them. Others the
   * model has between the two, which the view does not show, stay out of it.
   * Inside the command that nested it, so undo puts the lines back.
   */
  private showByNesting(inner: DjsShape, outer: DjsShape): void {
    const services = this.services();
    const viewIri = this.viewIri;
    const viewManager = this.viewManager;
    // The concepts: a reference's view, nested in an element it may refine (VC-5).
    const innerIri = conceptIriOf(inner);
    const outerIri = outer.businessObject?.iri;
    if (!services || !viewIri || !viewManager?.addMember || !innerIri || !outerIri) return;
    if (outer.businessObject?.kind !== 'element') return;
    const between = this.relationshipsBetween(innerIri, outerIri);
    const shownByNesting = new Set(
      relationshipsShownByNesting(
        { iri: outerIri, typeIri: outer.businessObject.typeIri },
        { iri: innerIri, typeIri: inner.businessObject?.typeIri ?? '' },
        this.paletteDefinition.relationshipTypes,
        between,
      ).map((r) => r.iri),
    );
    for (const rel of between) {
      const lines = this.linesOf(rel.iri);
      // The lines between these two placements — not those drawn to another placement of either.
      const here = lines.filter((l) => (l.source === inner && l.target === outer) || (l.source === outer && l.target === inner));
      if (lines.length > 0 && here.length === 0) continue;
      if (here.length === 0 && !shownByNesting.has(rel.iri)) continue;
      // Their links go from the view (`connection.delete`), and with the last, its arch:inView…
      if (here.length > 0) services.modeling.removeElements(here);
      // …which the view keeps: it still shows it, by the nesting.
      this.change(() => viewManager.addMember!(viewIri, rel.iri));
    }
  }

  /**
   * Taken out of a container: what the view showed by the nesting is drawn as
   * lines — the relationships between the two that are the view's
   * (`arch:inView`) and have no line in it, and those the nesting stood for
   * though the view never said so (of a type nesting may draw, the element the
   * end drawn inside: a model nested as it was opened — converted from Archi,
   * say — records no more). Never others the model has between them. In the
   * same command as the move.
   */
  private showAsLines(inner: DjsShape, outer: DjsShape): void {
    const viewIri = this.viewIri;
    const viewManager = this.viewManager;
    const innerIri = conceptIriOf(inner);
    const outerIri = outer.businessObject?.iri;
    if (!viewIri || !viewManager || !innerIri || !outerIri || outer.businessObject?.kind !== 'element') return;
    const between = this.relationshipsBetween(innerIri, outerIri);
    const shownByNesting = new Set(
      relationshipsShownByNesting(
        { iri: outerIri, typeIri: outer.businessObject.typeIri },
        { iri: innerIri, typeIri: inner.businessObject?.typeIri ?? '' },
        this.paletteDefinition.relationshipTypes,
        between,
      ).map((r) => r.iri),
    );
    for (const rel of between) {
      // Drawn somewhere in the view already: no second line for it.
      if (this.linesOf(rel.iri).length > 0) continue;
      if (!shownByNesting.has(rel.iri) && !viewManager.viewsContaining(rel.iri).includes(viewIri)) continue;
      this.drawLine(rel, rel.sourceIri === innerIri ? { source: inner, target: outer } : { source: outer, target: inner });
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
    services.popupMenu.registerProvider(REUSE_MENU_ID, this.reuseMenuProvider);
    services.popupMenu.registerProvider(ZOOM_MENU_ID, this.zoomMenuProvider);
    services.popupMenu.registerProvider(PAIR_CONNECT_MENU_ID, this.pairConnectMenuProvider);
  }

  /** The two selected elements a pair menu was opened on, or nothing. */
  private resolvePair(target: unknown): PairConnectContext | undefined {
    if (!Array.isArray(target) || target.length !== 2) return undefined;
    const ends: PairEnd[] = [];
    for (const shape of target as DjsShape[]) {
      const shown = shape?.businessObject;
      // An element, or a reference — its view, of its class (VC-DD-1).
      const iri = shown && (shown.kind === 'element' || isViewReference(shape)) ? conceptIriOf(shape) : undefined;
      if (!shown || !iri || !shown.typeIri) return undefined;
      ends.push({ shapeId: shape.id, iri, typeIri: shown.typeIri, label: shown.label ?? localName(iri) });
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
    // Each element's placements, and each placement by its node — a reference's under its node and its view, whose
    // placement it is (VC-DD-1): found from the view to select it, to draw a relationship with the view to it.
    const placementKeys = (shape: DjsShape): string[] => {
      const iri = shape.businessObject?.iri;
      if (!iri || shape.businessObject?.kind === 'relationship') return [];
      const view = isViewReference(shape) ? conceptIriOf(shape) : undefined;
      return view && view !== iri ? [iri, view] : [iri];
    };
    djs.on('shape.added', 2000, (event: { element: DjsShape }) => {
      const shape = event.element;
      for (const key of placementKeys(shape)) {
        let set = this.placements.get(key);
        if (!set) this.placements.set(key, (set = new Set()));
        set.add(shape);
      }
      const node = shape.businessObject?.nodeIri;
      if (node && shape.businessObject?.kind !== 'relationship') this.placementByNode.set(node, shape);
    });
    djs.on('shape.removed', 2000, (event: { element: DjsShape }) => {
      const shape = event.element;
      for (const key of placementKeys(shape)) {
        const set = this.placements.get(key);
        set?.delete(shape);
        if (set?.size === 0) this.placements.delete(key);
      }
      const node = shape.businessObject?.nodeIri;
      if (node && this.placementByNode.get(node) === shape) this.placementByNode.delete(node);
    });
    // A block, not an expression: diagram-js stops an event at the first listener that returns
    // a value, and `Set.delete` returns one — every later listener missed every removed line.
    djs.on('connection.removed', (event: { element: DjsShape }) => {
      this.otherwiseNamed.delete(event.element);
    });
    // Each relationship's lines, and each line by its link — before any other listener can
    // stop the event (diagram-js stops it at the first that returns a value).
    djs.on('connection.added', 2000, (event: { element: DjsShape }) => {
      const line = event.element;
      const iri = line.businessObject?.iri;
      if (!iri) return;
      let set = this.lines.get(iri);
      if (!set) this.lines.set(iri, (set = new Set()));
      set.add(line);
      const link = line.businessObject?.linkIri;
      if (link) this.lineByLink.set(link, line);
    });
    djs.on('connection.removed', 2000, (event: { element: DjsShape }) => {
      const line = event.element;
      for (const [iri, set] of this.lines) {
        if (set.delete(line) && set.size === 0) this.lines.delete(iri);
      }
      const link = line.businessObject?.linkIri;
      if (link && this.lineByLink.get(link) === line) this.lineByLink.delete(link);
    });

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
      // An element, a relationship, or a figure — a reference's menu opens its view (Req 3.23).
      const onConcept = Boolean(shown?.iri) && (shown?.kind === 'element' || shown?.kind === 'relationship' || shown?.kind === 'figure');
      const onCanvas = element === root && Boolean(this.viewIri);
      if (!element || (!onConcept && !onCanvas)) return undefined;
      event.originalEvent?.preventDefault();
      this.openContextMenu(element, { x: event.originalEvent?.clientX ?? 0, y: event.originalEvent?.clientY ?? 0 });
      return false;
    });

    // A reference to another view opens it when double-clicked (Req 3.23, VR-DD-3); F2 renames its view (VC-DD-4).
    djs.on('element.dblclick', (event: { element?: DjsShape }) => {
      if (event.element && isViewReference(event.element)) this.openReferencedView(event.element);
    });

    // The open view's own row, dragged from the model tree, makes nothing on its own diagram (VR-1): refused as it
    // is dragged over it — above the metamodel's rules — and let go there, said why.
    djs.on('commandStack.shape.create.canExecute', 2500, (event: { context?: { shape?: DjsShape } }) =>
      this.isOwnViewReference(event.context?.shape) ? false : undefined,
    );
    djs.on('create.end', 1500, (event: { context?: { shape?: DjsShape; target?: unknown } }) => {
      const context = event.context;
      if (!this.isOwnViewReference(context?.shape)) return undefined;
      if (context?.target) this.onNotice?.("This is the open view: drag it onto another view's diagram to reference it.", 'info');
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

    // A relationship drawn with no type chosen is the best-ranked one; where the pair permits more than one
    // specific relationship, the relationship-type menu opens on the new line at once — every type the pair
    // permits, best first, as when changing it later — so another is one pick away, and Escape keeps the
    // best-ranked. After `Connect`'s own handler (default priority), which made the line; a type picked in
    // the palette is still in force here (see `tool-manager.update` above) and asks for no menu.
    djs.on('connect.end', 500, (event: { context?: { connection?: DjsShape; canExecute?: unknown }; originalEvent?: MouseEvent }) => {
      const connection = event.context?.connection;
      if (!connection || this.ruleProvider.getPreferredType()) return;
      const attrs = event.context?.canExecute as RdfConnectionAttrs | false | undefined;
      const specific = (attrs && !attrs.connector ? attrs.candidates ?? [] : []).filter((c) => !c.fallback);
      if (specific.length < 2) return;
      const pointer = event.originalEvent;
      const at = pointer && typeof pointer.clientX === 'number' ? { x: pointer.clientX + 8, y: pointer.clientY + 8 } : this.padMenuPosition(undefined);
      // The drawing's undo step, read before the menu opens: a type picked there joins it (Req 4.2).
      const stepId = lastStepId(this.services()?.commandStack);
      this.openRelationshipTypeMenuAt(connection, at);
      if (stepId !== undefined && this.services()?.popupMenu.isOpen()) this.drawnAwaitingType = { connectionId: connection.id, stepId };
    });
    // Closed — a type picked, Escape, a click elsewhere, another menu: a later change of type is a step of its own.
    djs.on('popupMenu.close', () => {
      this.drawnAwaitingType = undefined;
    });

    // A relationship retyped on one of its lines: its other lines show it too, undo included.
    djs.on(
      [`commandStack.${RETYPE_RELATIONSHIP_COMMAND}.executed`, `commandStack.${RETYPE_RELATIONSHIP_COMMAND}.reverted`],
      (event: { context?: { connection?: DjsShape } }) => {
        const line = event.context?.connection;
        const iri = line?.businessObject?.iri;
        const typeIri = line?.businessObject?.typeIri;
        if (!line || !iri || !typeIri) return;
        const others = this.linesOf(iri).filter((other) => other !== line && other.businessObject?.typeIri !== typeIri);
        for (const other of others) other.businessObject!.typeIri = typeIri;
        if (others.length > 0) djs.fire('elements.changed', { elements: others });
      },
    );

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
        // A connector's ends are nodes of the view: re-pointed there, nothing in the model.
        if (connection?.businessObject?.kind === 'connector') {
          const link = this.linkKeyOf(connection);
          const sourceNodeIri = connection.source ? this.nodeKeyOf(connection.source as DjsShape) : undefined;
          const targetNodeIri = connection.target ? this.nodeKeyOf(connection.target as DjsShape) : undefined;
          const viewIri = this.viewIri;
          const viewManager = this.viewManager;
          if (!link || !sourceNodeIri || !targetNodeIri || !viewIri || !viewManager?.reconnectConnector) return;
          this.change(() => viewManager.reconnectConnector!(viewIri, link, { sourceNodeIri, targetNodeIri }));
          return;
        }
        const relIri = connection?.businessObject?.iri;
        // The concepts at its new ends — a reference's view among them (VC-3).
        const sourceIri = conceptIriOf(connection?.source);
        const targetIri = conceptIriOf(connection?.target);
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
        const sourceIri = conceptIriOf(connection?.source);
        const targetIri = conceptIriOf(connection?.target);
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
      // That placement: the element leaves the view with its last.
      const node = shape ? this.nodeKeyOf(shape) : undefined;
      const viewIri = this.viewIri;
      const viewManager = this.viewManager;
      if (!node || !viewIri || !viewManager || this.removingFromStore) return;
      this.change(() => viewManager.removeElementFromView(viewIri, node));
    });
    djs.on(
      'commandStack.connection.delete.preExecute',
      (event: { context?: { connection?: DjsShape } }) => {
        const connection = event.context?.connection;
        // That line: the relationship leaves the view with its last.
        const link = connection ? this.linkKeyOf(connection) : undefined;
        const viewIri = this.viewIri;
        const viewManager = this.viewManager;
        if (!link || !viewIri || !viewManager || this.removingFromStore) return;
        this.change(() => viewManager.removeRelationshipFromView(viewIri, link));
      },
    );

    // An existing element dropped into the view: draw its relationships to what
    // is already here, in the same undo step.
    djs.on('commandStack.shape.create.postExecute', (event: { context?: { shape?: DjsShape } }) => {
      const shape = event.context?.shape;
      if (shape?.businessObject?.placeExisting && this.hasViewContext()) {
        delete shape.businessObject.placeExisting;
        // Its relationships are drawn with its first placement; a further one gets the lines drawn to it.
        if (this.shapesOf(shape.businessObject.iri).length <= 1) this.drawRelationshipsOf(shape);
      }
      // A reference made — dragged from the tree, placed by its menu — is its view's placement: the view's
      // relationships to what the view shows are drawn with the first, as an element's (VC-4).
      const view = shape && isViewReference(shape) && shape.businessObject?.iri ? conceptIriOf(shape) : undefined;
      if (shape && view && this.hasViewContext() && this.shapesOf(view).length <= 1) this.drawRelationshipsOf(shape);
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

    // A figure drawn on the canvas: its node is written in the same command, and
    // the shape takes the node's IRI before it is drawn — undo takes both back,
    // redo puts the same node back.
    djs.on('commandStack.shape.create.preExecute', (event: { context?: { shape?: DjsShape; position?: Partial<Bounds>; parent?: DjsShape } }) => {
      const context = event.context;
      const shape = context?.shape;
      const businessObject = shape?.businessObject;
      const viewIri = this.viewIri;
      const viewManager = this.viewManager;
      if (!shape || businessObject?.kind !== 'figure' || businessObject.iri || !businessObject.figure) return;
      if (!viewIri || !viewManager?.addFigure) return;
      const bounds = plannedBounds(shape, context?.position);
      const parentKind = context?.parent?.businessObject?.kind;
      const parentIri = parentKind === 'element' || parentKind === 'figure' ? context?.parent?.businessObject?.iri : undefined;
      const figure = businessObject.figure;
      this.change(() => {
        const iri = viewManager.addFigure!(viewIri, { ...figure, bounds, ...(parentIri ? { parentIri } : {}) });
        shape.id = iri;
        businessObject.iri = iri;
        // A reference is its view's placement, this node: a line drawn from it is drawn from it (VC-DD-1).
        if (figure.kind === 'reference') businessObject.nodeIri = iri;
      });
    });

    // A line drawn from a note or another figure, or to one: a link standing for
    // no relationship, written in the same command, the line taking its IRI
    // before it is drawn — as a figure is.
    djs.on(
      'commandStack.connection.create.preExecute',
      (event: { context?: { connection?: DjsShape; source?: DjsShape; target?: DjsShape } }) => {
        const { connection, source, target } = event.context ?? {};
        const businessObject = connection?.businessObject;
        const viewIri = this.viewIri;
        const viewManager = this.viewManager;
        if (!connection || businessObject?.kind !== 'connector' || businessObject.iri || !source || !target) return;
        const sourceNodeIri = this.nodeKeyOf(source);
        const targetNodeIri = this.nodeKeyOf(target);
        if (!viewIri || !viewManager?.addConnector || !sourceNodeIri || !targetNodeIri) return;
        this.change(() => {
          const link = viewManager.addConnector!(viewIri, { sourceNodeIri, targetNodeIri });
          if (!link) return;
          connection.id = link;
          businessObject.iri = link;
          businessObject.linkIri = link;
        });
      },
    );

    // Nesting. The container an element is created in is written with it — after
    // the element's own node (`rdf.element.create`, at the default priority); a
    // move writes its container with its bounds (`writeLayout`).
    djs.on('commandStack.shape.create.postExecute', 500, (event: { context?: { shape?: DjsShape } }) => {
      const shape = event.context?.shape;
      if (shape && this.hasViewContext() && containerIri(shape)) this.writeLayout(shape);
    });
    // What a nesting shows, it shows instead of a line; taken out, it is drawn as
    // one again (showByNesting, showAsLines) — in the same command. Noted as each
    // shape is created or moved, done when the whole move or creation is: a move
    // of several lays out their lines after moving the shapes, so a line hidden
    // halfway would be laid out with no ends. Redo replays what was done, and
    // runs none of these.
    let nestingChanges: Array<{ shape: DjsShape; from?: DjsShape; to: DjsShape }> = [];
    let within = 0;
    const settleNesting = () => {
      if (within > 0 || nestingChanges.length === 0) return;
      const changes = nestingChanges;
      nestingChanges = [];
      for (const { shape, from, to } of changes) {
        if (from) this.showAsLines(shape, from);
        this.showByNesting(shape, to);
      }
    };
    djs.on(['commandStack.elements.move.preExecute', 'commandStack.elements.create.preExecute'], () => {
      within++;
    });
    djs.on(['commandStack.elements.move.postExecuted', 'commandStack.elements.create.postExecuted'], () => {
      within = Math.max(0, within - 1);
      settleNesting();
    });
    // After an existing element's relationships are drawn as it is placed (default priority).
    djs.on('commandStack.shape.create.postExecute', 250, (event: { context?: { shape?: DjsShape } }) => {
      const shape = event.context?.shape;
      const to = shape?.parent as DjsShape | undefined;
      if (shape && to && this.hasViewContext()) nestingChanges.push({ shape, to });
    });
    djs.on('commandStack.shape.move.postExecute', 250, (event: { context?: { shape?: DjsShape; oldParent?: DjsShape } }) => {
      const { shape, oldParent } = event.context ?? {};
      const to = shape?.parent as DjsShape | undefined;
      if (!shape || !to || !oldParent || to === oldParent || !this.hasViewContext()) return;
      nestingChanges.push({ shape, from: oldParent, to });
    });
    djs.on(['commandStack.shape.create.postExecuted', 'commandStack.shape.move.postExecuted'], settleNesting);
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
      // A rename on the canvas, undone or redone: what a label expression shows of it.
      queueMicrotask(() => this.refreshLabelTexts());
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
        // A figure is no element — a reference neither, though it carries its view's class as its type.
        if (!shape || !businessObject?.iri || !businessObject.typeIri || businessObject.kind === 'figure') return;
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

    // The format painter: a click picks a look, or gives the picked one — not a selection.
    djs.on('element.click', 2000, (event: { element?: DjsShape }) => {
      if (!this.painter || !event.element) return undefined;
      this.paint(event.element);
      return true;
    });
    // Esc puts the format painter down.
    djs.on('keyboard.keydown', 2000, (event: { keyEvent?: KeyboardEvent }) => {
      if (!this.painter || event.keyEvent?.key !== 'Escape') return undefined;
      this.stopFormatPainter();
      return true;
    });
  }

  /**
   * The format painter: off, picking what to copy the look of, or
   * — a look picked — giving it to what is clicked.
   */
  private painter: { look?: { own: Appearance } } | undefined;

  /** Start the format painter — or, started, stop it (the toolbar's button). */
  toggleFormatPainter(): void {
    if (this.painter) this.stopFormatPainter();
    else {
      this.painter = {};
      this.container.classList.add('la-format-painter');
      this.eventBus.emit('format-painter-changed', { state: 'pick' });
    }
  }

  /** Stop the format painter (Esc, the toolbar's button again, another view opened). */
  stopFormatPainter(): void {
    if (!this.painter) return;
    this.painter = undefined;
    this.container.classList.remove('la-format-painter', 'la-format-painting');
    this.eventBus.emit('format-painter-changed', { state: 'off' });
  }

  /** Whether the format painter is on, and what it does with the next click. */
  formatPainterState(): 'off' | 'pick' | 'paint' {
    return !this.painter ? 'off' : this.painter.look ? 'paint' : 'pick';
  }

  /**
   * A click with the format painter on: the first picks the clicked thing's own
   * look — for the presentation chosen, its look for every one with that
   * presentation's laid over it; each after gives it to the clicked one, as one
   * undoable step — what its kind has of it, a value the picked look leaves
   * unset taken back to the target's default, its figure left as it is — for
   * the presentation chosen (its style for it), or for every one with none.
   */
  private paint(element: DjsShape): void {
    const viewIri = this.viewIri;
    const viewManager = this.viewManager;
    if (!viewIri || !viewManager || !this.painter) return;
    const drawn = this.appearanceOfDrawn(viewIri, element);
    if (!drawn) return;
    if (!this.painter.look) {
      // What it looks like for the presentation chosen: its look for every one, that presentation's laid over it.
      this.painter.look = { own: { ...drawn.own, ...(drawn.contextOwn ?? {}) } };
      this.container.classList.add('la-format-painting');
      this.eventBus.emit('format-painter-changed', { state: 'paint' });
      return;
    }
    const look = this.painter.look.own;
    const changes = Object.fromEntries(APPEARANCE_FIELDS[drawn.target.kind].map((key) => [key, look[key] ?? null]));
    // Given for the presentation chosen — its style for it — or, with none, for every one.
    const context = this.notationStyles.activePresentationContext;
    this.recordChange(() => viewManager.setAppearance?.(viewIri, drawn.target.iri, changes, context));
  }

  /** Write a shape's current bounds back to the model. */
  private writeLayout(shape: DjsShape): void {
    const iri = shape.businessObject?.iri;
    if (!iri) return;
    // The placement this shape draws.
    const node = this.nodeKeyOf(shape) ?? iri;
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
        viewManager.updateNodeBounds(viewIri, node, bounds);
        viewManager.setNodeParent?.(viewIri, node, parentIri);
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
            const link = this.viewManager.addRelationshipToView(this.viewIri, relationshipIri, undefined, {
              ...(request.sourceNodeIri ? { sourceNodeIri: request.sourceNodeIri } : {}),
              ...(request.targetNodeIri ? { targetNodeIri: request.targetNodeIri } : {}),
            });
            if (link) request.linkIri = link;
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

      draw: (relationshipIri: string, ends?: { sourceNodeIri?: string; targetNodeIri?: string }): string | undefined => {
        if (!this.viewManager || !this.viewIri) return undefined;
        // The link joining these placements, when there is one; else another line of it.
        const same = this.viewManager
          .getLinks(this.viewIri)
          .find(
            (l) =>
              l.relationshipIri === relationshipIri &&
              (!ends?.sourceNodeIri || l.sourceNodeIri === ends.sourceNodeIri) &&
              (!ends?.targetNodeIri || l.targetNodeIri === ends.targetNodeIri),
          );
        return same?.linkIri ?? this.viewManager.addRelationshipToView(this.viewIri, relationshipIri, undefined, ends, { another: true });
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
      // Emptied, a name goes — a relationship's, a note's, a group's or a shape's text: nothing drawn. A view
      // reference's F2 names its view, never with nothing (VC-DD-4); its own text is the panel's to write.
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

        let nodeIri: string | undefined;
        const create = (): string | undefined => {
          const iri = this.elementManager.createElement(request.typeIri, this.modelIri, {
            ...(request.label ? { label: request.label } : {}),
          })?.value;
          if (!iri) return undefined;
          if (this.viewManager && this.viewIri) {
            nodeIri = this.viewManager.addElementToView(this.viewIri, iri, request.bounds);
          } else {
            this.elementManager.updateLayout?.(iri, request.bounds);
          }
          return iri;
        };

        // With a recording store the snapshot is exactly what was written — the
        // element *and* its node — so redo restores both.
        if (this.changeStore) {
          const { result: iri, added } = this.changeStore.record(create);
          return iri ? { iri, snapshot: added, ...(nodeIri ? { nodeIri } : {}) } : undefined;
        }

        const iri = create();
        if (!iri) return undefined;
        // Snapshot only when it can be replayed; an unusable one would be a lie.
        const snapshot =
          store?.addQuads !== undefined ? store.getQuads(namedNode(iri), null, null, null) : [];
        return { iri, snapshot, ...(nodeIri ? { nodeIri } : {}) };
      },

      // Dropped into the view: a placement — another, when it is placed already.
      place: (iri: string, bounds: Bounds): string | undefined =>
        this.viewManager && this.viewIri ? this.viewManager.addElementToView(this.viewIri, iri, bounds, { another: true }) : undefined,

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
      const keyed = key ? services?.elementRegistry.get(key) : undefined;
      const connections = relationshipIri ? this.linesOf(relationshipIri) : keyed ? [keyed] : [];
      this.removingFromStore = true;
      try {
        for (const connection of connections) this.removeConnectionDirect(connection);
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
/** A shape to outline: a core one's name, or a notation's own. */
type VisualStyleShape = Parameters<typeof shapePath>[0];

/** The node of the shape a shape is drawn inside — an element's placement, a figure — if any. */
function containerIri(shape: DjsShape): string | undefined {
  const parent = shape.parent as DjsShape | undefined;
  const kind = parent?.businessObject?.kind;
  return kind === 'element' || kind === 'figure' ? (parent!.businessObject!.nodeIri ?? parent!.businessObject!.iri) : undefined;
}

/** How big a figure is drawn when it is made: a group holds things, a note some text. */
export const FIGURE_SIZES: Record<FigureKind, { width: number; height: number }> = {
  group: { width: 400, height: 260 },
  shape: { width: 120, height: 80 },
  note: { width: 185, height: 80 },
  reference: { width: 120, height: 55 },
};

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
