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

import Diagram from 'diagram-js';
import { DataFactory } from 'n3';

// diagram-js feature modules. These are plain didi module declarations; the
// package ships no type declarations for the index files, hence the assertions.
import ModelingModule from 'diagram-js/lib/features/modeling/index.js';
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
import type { ElementManager, RelationshipManager, Bounds } from '../../model-manager/interfaces.js';
import type { EventBus } from '../event-bus.js';
import { NotationStyleRegistry } from './notation-styles.js';
import { NOTATION_DEFAULTS } from './notation-shapes.js';
import { toolFromManagerName, type CanvasTool } from './canvas-tools.js';
import { RdfRenderer, rdfRendererModule, type RdfBusinessObject } from './rdf-renderer.js';
import { RdfRuleProvider, rdfRulesModule } from './rdf-rule-provider.js';
import {
  rdfModelingModule,
  RETYPE_RELATIONSHIP_COMMAND,
  type RdfElementRequest,
  type RdfElementResult,
  type RdfElementWriter,
  type RdfRelationshipRequest,
  type RdfRelationshipWriter,
  type RetypeRelationshipContext,
} from './rdf-modeling.js';
import { RdfContextPadProvider, type ContextPadElement } from './rdf-context-pad-provider.js';
import {
  RdfReplaceMenuProvider,
  RELATIONSHIP_REPLACE_MENU_ID,
  type RelationshipReplaceContext,
} from './rdf-replace-menu-provider.js';
import {
  RdfAppendMenuProvider,
  APPEND_TARGET_MENU_ID,
  type AppendMenuContext,
} from './rdf-append-menu-provider.js';
import {
  appendableTargetTypes,
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
}

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
}

/** The diagram-js services this class resolves. Structural, not nominal. */
interface DjsServices {
  canvas: {
    addShape(shape: unknown, parent?: unknown): DjsShape;
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
  };
  modeling: {
    createConnection(
      source: unknown,
      target: unknown,
      attrs: Record<string, unknown>,
      parent: unknown,
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
    fire(event: string, payload?: unknown): unknown;
  };
  commandStack: { execute(command: string, context: unknown): void };
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

  /** The palette definition currently in force. */
  private paletteDefinition: PaletteDefinition;

  /** Custom RDF modules */
  readonly ruleProvider: RdfRuleProvider;
  readonly contextPadProvider: RdfContextPadProvider;
  readonly replaceMenuProvider: RdfReplaceMenuProvider;
  readonly appendMenuProvider: RdfAppendMenuProvider;
  readonly notationStyles: NotationStyleRegistry;

  /** The diagram-js instance, or `null` once destroyed. */
  private diagram: Diagram | null = null;

  /** Relationship registry keyed by the connection's diagram-js id. */
  private relationships = new Map<string, CanvasRelationship>();

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
    );

    this.appendMenuProvider = new RdfAppendMenuProvider(
      (target) => this.resolveAppendContext(target),
      (sourceTypeIri) => this.appendTargets(sourceTypeIri),
      {
        place: (context, typeIri) => this.appendElement(context, typeIri),
        drag: (context, typeIri, event) => this.startAppend(context, typeIri, event),
      },
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
        rdfRendererModule(this.notationStyles),
        rdfRulesModule(this.ruleProvider),
        // Last, so its `modeling` binding replaces the one ModelingModule made.
        rdfModelingModule(this.relationshipWriter(), this.elementWriter()),
      ] as never[],
    });

    this.initRoot();
    this.registerProviders();
    this.bindKeyboard(keyboardBindTo);
    this.guardKeyboardAgainstShadowInputs();
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

  /**
   * Draw an element on the canvas.
   *
   * Idempotent by IRI: a repeat call updates the existing shape rather than
   * failing on diagram-js's duplicate-id check.
   */
  addElement(iri: string, typeIri: string, bounds: Bounds, label?: string, iconUrl?: string): void {
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

    services.canvas.addShape(shape, services.canvas.getRootElement());
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

    this.removingFromStore = true;
    try {
      if (shape) services.modeling.removeElements([shape]);
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
    updates: Partial<Pick<CanvasElement, 'label' | 'iconUrl' | 'bounds'>>,
  ): void {
    const services = this.services();
    if (!services) return;

    const shape = services.elementRegistry.get(iri);
    if (!shape) return;

    const businessObject: RdfBusinessObject = shape.businessObject ?? { iri, typeIri: '' };
    if (updates.label !== undefined) businessObject.label = updates.label;
    if (updates.iconUrl !== undefined) businessObject.iconUrl = updates.iconUrl;
    shape.businessObject = businessObject;

    if (updates.bounds !== undefined) {
      shape.x = updates.bounds.x;
      shape.y = updates.bounds.y;
      shape.width = updates.bounds.width;
      shape.height = updates.bounds.height;
    }

    services.eventBus.fire('elements.changed', { elements: [shape] });
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
  ): void {
    const key = relationshipKey(sourceIri, targetIri, typeIri);
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
    };

    services.modeling.createConnection(
      source,
      target,
      { id: key, businessObject },
      services.canvas.getRootElement(),
    );
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
   * @return the appended shape, or `undefined` when nothing could be appended.
   */
  appendElement(
    source: AppendMenuContext | ContextPadElement | string,
    typeIri: string,
  ): DjsShape | undefined {
    const services = this.services();
    const sourceShape = this.resolveShape(source);
    const shape = this.buildNewShape(typeIri);
    if (!services || !sourceShape || !shape) return undefined;
    return services.autoPlace.append(sourceShape, shape);
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
  updatePaletteDefinition(paletteDefinition: PaletteDefinition): void {
    this.paletteDefinition = paletteDefinition;
    // The palette is what the append offer is derived from, so every memoized
    // answer is now stale.
    this.appendTargetCache.clear();
    this.contextPadProvider.updatePaletteDefinition(paletteDefinition);
    this.notationStyles.update(paletteDefinition);

    const services = this.services();
    if (!services) return;

    const elements = services.elementRegistry.getAll().filter((element) => element.parent);
    if (elements.length > 0) {
      services.eventBus.fire('elements.changed', { elements });
    }
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
    const businessObject: RdfBusinessObject = {
      iri: '',
      typeIri,
      label: declared?.label ?? this.notationStyles.labelFor(typeIri) ?? localName(typeIri),
      kind: 'element',
      ...(declared?.iconUrl !== undefined ? { iconUrl: declared.iconUrl } : {}),
    };

    return services.elementFactory.createShape({
      width: style?.defaultWidth ?? NOTATION_DEFAULTS.width,
      height: style?.defaultHeight ?? NOTATION_DEFAULTS.height,
      businessObject,
    });
  }

  /** The palette's entry for an element type, when it publishes one. */
  private elementTypeInfo(typeIri: string): ElementTypeInfo | undefined {
    for (const group of this.paletteDefinition.elementGroups) {
      const found = group.elements.find((element) => element.iri === typeIri);
      if (found) return found;
    }
    return undefined;
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

    services.popupMenu.open(diagramElement, APPEND_TARGET_MENU_ID, this.padMenuPosition(event), {
      title: 'Append element',
      width: 300,
      search: true,
    });
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
    services.popupMenu.registerProvider(APPEND_TARGET_MENU_ID, this.appendMenuProvider);
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

    // Layout is the canvas's own state, so it is the one thing written back.
    djs.on(
      ['commandStack.shape.move.postExecuted', 'commandStack.shape.resize.postExecuted'],
      (event: { context?: { shape?: DjsShape } }) => {
        const shape = event.context?.shape;
        if (shape) this.writeLayout(shape);
      },
    );

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
    this.elementManager.updateLayout(iri, bounds);
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
    this.elementManager.deleteElement(iri);
    this.eventBus.emit('element-deleted', { iri, elementIri: iri });
  }

  /** A connection was removed on the canvas. */
  private onConnectionDeleted(connection: DjsShape): void {
    const relationship = this.relationships.get(connection.id);
    this.relationships.delete(connection.id);
    if (this.removingFromStore || !relationship) return;

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
        const created = this.relationshipManager.createRelationship(
          request.predicateIri,
          request.sourceIri,
          request.targetIri,
        );
        const relationshipIri = created?.value;

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
  private elementWriter(): RdfElementWriter {
    return {
      create: (request: RdfElementRequest): RdfElementResult | undefined => {
        const store = this.rdfStore;

        // Redo of a creation that was snapshotted: put the same element back.
        if (request.iri && request.snapshot && request.snapshot.length > 0 && store?.addQuads) {
          store.addQuads(request.snapshot as never[]);
          return { iri: request.iri, snapshot: request.snapshot };
        }

        const created = this.elementManager.createElement(
          request.typeIri,
          this.modelIri,
          request.bounds,
        );
        const iri = created?.value;
        if (!iri) return undefined;

        // Snapshot only when it can be replayed; an unusable one would be a lie.
        const snapshot =
          store?.addQuads !== undefined ? store.getQuads(namedNode(iri), null, null, null) : [];

        return { iri, snapshot };
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
      if (detail?.sourceIri && detail?.targetIri && detail?.typeIri) {
        const key = relationshipKey(
          detail.sourceIri as string,
          detail.targetIri as string,
          detail.typeIri as string,
        );
        const services = this.services();
        const connection = services?.elementRegistry.get(key);
        this.removingFromStore = true;
        try {
          if (connection && services) services.modeling.removeElements([connection]);
        } finally {
          this.removingFromStore = false;
        }
        this.relationships.delete(key);
      }
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

/** Last fragment or path segment of an IRI. */
function localName(iri: string): string {
  if (iri.includes('#')) return iri.slice(iri.lastIndexOf('#') + 1);
  const trimmed = iri.replace(/\/$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || iri;
}
