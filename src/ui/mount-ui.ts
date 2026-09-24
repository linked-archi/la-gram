/**
 * UI mounting — instantiates every panel/view and assigns it to an app-shell slot.
 *
 * `app-shell` only renders the layout grid plus five named slots
 * (`palette`, `canvas`, `property-panel`, `explorer`, `validation`).
 * Nothing fills those slots unless something creates the panel elements,
 * wires them to the App's components and appends them as light-DOM children
 * of the shell — that is this module's job.
 *
 * Importing the panel modules here is also what registers their custom
 * elements: the `@customElement(...)` decorators only run as an import side
 * effect.
 */

import { DataFactory } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';

import type { App } from '../app.js';
import type { PaletteDefinition } from '../metamodel-manager/interfaces.js';
import type { ValidationResult } from '../rdf-engine/interfaces.js';
import type { ModelEventHandler } from './event-bus.js';

// Side-effect imports: register the custom elements.
import './app-shell.js';
import './panels/palette-panel.js';
import './panels/canvas-toolbar.js';
import './panels/property-panel.js';
import './panels/model-explorer.js';
import './panels/validation-panel.js';
import './panels/sparql-editor.js';
import './views/catalog-view.js';
import './views/matrix-view.js';

import type { AppShell } from './app-shell.js';
import type {
  PalettePanel,
  PaletteDragDetail,
  PaletteAxisChangeDetail,
} from './panels/palette-panel.js';
import type { CanvasToolbar, ToolbarToolDetail } from './panels/canvas-toolbar.js';
import type { PropertyPanel, PropertyEditDetail } from './panels/property-panel.js';
import type { ModelExplorer, ExplorerSelectDetail } from './panels/model-explorer.js';
import type { ValidationPanel, ValidationNavigateDetail } from './panels/validation-panel.js';
import type { SparqlEditor } from './panels/sparql-editor.js';
import type { CatalogView, CatalogSelectDetail } from './views/catalog-view.js';
import type { MatrixView } from './views/matrix-view.js';

// The diagram canvas is a plain class, not a custom element: it takes a host
// DOM node in its constructor and manages that subtree itself.
import { DiagramCanvas } from './canvas/diagram-canvas.js';
import { buildClassClosure, type ClassClosure } from './canvas/relationship-resolution.js';

const { namedNode } = DataFactory;

/** Named graph holding SHACL shapes (mirrors N3MetamodelLoader). */
const SHAPES_GRAPH_IRI = 'urn:la-gram:shapes';

/** Model IRI used for elements dropped onto the canvas before a model is loaded. */
export const DEFAULT_MODEL_IRI = 'urn:la-gram:model-1';

/** Empty palette used until a metamodel is loaded. */
function emptyPalette(): PaletteDefinition {
  return { elementGroups: [], relationshipTypes: [] };
}

/** Which element occupies the centre (canvas) slot. */
export type CanvasViewKind = 'diagram' | 'catalog' | 'matrix';

/** Handles to everything mounted into the shell. */
export interface MountedUi {
  shell: AppShell;
  palettePanel: PalettePanel;
  /** The global-tool strip above the diagram. */
  canvasToolbar: CanvasToolbar;
  modelExplorer: ModelExplorer;
  propertyPanel: PropertyPanel;
  validationPanel: ValidationPanel;
  sparqlEditor: SparqlEditor;
  catalogView: CatalogView;
  matrixView: MatrixView;
  /** Host element handed to diagram-js / the DiagramCanvas renderer. */
  canvasHost: HTMLElement;
  diagramCanvas: DiagramCanvas;
  /** Switch the centre area between the diagram, catalog and matrix views. */
  setActiveCanvasView(kind: CanvasViewKind): void;
  /** Currently visible centre view. */
  activeCanvasView(): CanvasViewKind;
  /**
   * Regroup the palette along another classification axis (e.g. "Element by
   * Aspect" instead of "Element by Domain"). Ignored when the metamodel does
   * not publish the axis.
   */
  setPaletteAxis(axisIri: string | undefined): void;
  /** Detach listeners and remove the shell from the document. */
  dispose(): void;
}

/**
 * Create every panel, wire it to the App's components, and mount it into an
 * `<app-shell>` under `root`.
 */
export function mountUi(app: App, root: HTMLElement): MountedUi {
  const {
    eventBus,
    store,
    validator,
    elementManager,
    relationshipManager,
    paletteGenerator,
  } = app.components;

  const shapesGraphNode = namedNode(SHAPES_GRAPH_IRI) as unknown as NamedNode;
  const readShapesGraph = (): Quad[] => store.getQuads(null, null, null, shapesGraphNode);

  // ── Shell ────────────────────────────────────────────────────────────
  // `eventBus` must be assigned before the shell connects, because
  // AppShell.connectedCallback subscribes to whatever bus it holds at
  // that moment. Detaching and re-appending an existing shell re-runs
  // connectedCallback so the subscription targets the App's bus.
  const existing = root.querySelector('app-shell') as AppShell | null;
  const shell: AppShell = existing ?? document.createElement('app-shell');
  shell.remove();
  shell.eventBus = eventBus;

  // ── Left top: palette ────────────────────────────────────────────────
  const palettePanel = document.createElement('palette-panel');
  palettePanel.slot = 'palette';
  palettePanel.palette = emptyPalette();

  // ── Left bottom: model explorer ──────────────────────────────────────
  const modelExplorer = document.createElement('model-explorer');
  modelExplorer.slot = 'explorer';
  modelExplorer.rdfStore = store;
  modelExplorer.eventBus = eventBus;

  // ── Right: property panel ────────────────────────────────────────────
  const propertyPanel = document.createElement('property-panel');
  propertyPanel.slot = 'property-panel';
  propertyPanel.rdfStore = store;
  propertyPanel.elementManager = elementManager;
  propertyPanel.shapesGraph = readShapesGraph();

  // ── Centre: diagram host + alternative catalog/matrix views ──────────
  const canvasArea = document.createElement('div');
  canvasArea.slot = 'canvas';
  canvasArea.className = 'la-canvas-area';

  // The global tools (connect / lasso / hand) used to be entries in diagram-js's
  // own in-canvas palette, which also listed all 42 element types the sidebar
  // lists. That palette is no longer registered; the tools live here instead.
  const canvasToolbar = document.createElement('canvas-toolbar');

  const canvasHost = document.createElement('div');
  canvasHost.className = 'la-diagram-host';

  const catalogView = document.createElement('catalog-view');
  catalogView.rdfStore = store;
  catalogView.elementManager = elementManager;
  catalogView.hidden = true;

  const matrixView = document.createElement('matrix-view');
  matrixView.rdfStore = store;
  matrixView.hidden = true;

  canvasArea.append(canvasToolbar, canvasHost, catalogView, matrixView);

  // The palette drives the closure-aware domain/range matching on the context
  // pad, so it has to be readable as it changes.
  let currentPalette: PaletteDefinition = emptyPalette();

  // Rebuilt after each metamodel load: the subClassOf hierarchy only exists once
  // the ontologies are in the store.
  let classClosure: ClassClosure = buildClassClosure(store);
  const closureLookup: ClassClosure = (typeIri) => classClosure(typeIri);

  const diagramCanvas = new DiagramCanvas({
    container: canvasHost,
    eventBus,
    elementManager,
    relationshipManager,
    paletteDefinition: currentPalette,
    modelIri: DEFAULT_MODEL_IRI,
    classClosure: closureLookup,
    rdfStore: store,
    onToolChanged: (tool) => {
      canvasToolbar.activeTool = tool ?? undefined;
    },
  });

  // Changing a connection's relationship type is diagram-js's own business now:
  // the context pad's `replace` entry opens `popupMenu` on the
  // `la-relationship-replace` provider the canvas registered, and the pick goes
  // straight onto the command stack. Nothing to wire from here.

  // ── Bottom: validation results + SPARQL editor ───────────────────────
  const bottomArea = document.createElement('div');
  bottomArea.slot = 'validation';
  bottomArea.className = 'la-bottom-area';

  const validationPanel = document.createElement('validation-panel');
  validationPanel.validator = validator;
  validationPanel.dataGraph = store.getQuads();
  validationPanel.shapesGraph = readShapesGraph();

  const sparqlEditor = document.createElement('sparql-editor');
  sparqlEditor.rdfStore = store;

  bottomArea.append(validationPanel, sparqlEditor);

  // ── Attach to the document ───────────────────────────────────────────
  shell.append(palettePanel, modelExplorer, propertyPanel, canvasArea, bottomArea);
  root.appendChild(shell);

  // ── Selection routing ────────────────────────────────────────────────
  const selectElement = (iri: string): void => {
    propertyPanel.selectedIri = iri;
    modelExplorer.selectedIri = iri;
    catalogView.selectedIri = iri;
    eventBus.emit('selection-changed', { iri });
  };

  const onExplorerSelect = (e: Event): void => {
    selectElement((e as CustomEvent<ExplorerSelectDetail>).detail.iri);
  };
  const onCatalogSelect = (e: Event): void => {
    selectElement((e as CustomEvent<CatalogSelectDetail>).detail.iri);
  };
  const onValidationNavigate = (e: Event): void => {
    selectElement((e as CustomEvent<ValidationNavigateDetail>).detail.focusNodeIri);
  };

  modelExplorer.addEventListener('explorer-select', onExplorerSelect);
  catalogView.addEventListener('catalog-select', onCatalogSelect);
  validationPanel.addEventListener('validation-navigate', onValidationNavigate);

  // ── Property edits → EventBus (App re-validates) ─────────────────────
  const onPropertyEdit = (e: Event): void => {
    const detail = (e as CustomEvent<PropertyEditDetail>).detail;
    eventBus.emit('property-edited', {
      elementIri: detail.elementIri,
      // App's handler uses `property`; the panel emits it as `predicate`.
      property: detail.predicate,
      value: detail.value,
    });
  };
  propertyPanel.addEventListener('property-edit', onPropertyEdit);

  // ── Palette → diagram-js `create` ────────────────────────────────────
  //
  // One palette now, and it can use diagram-js's `create` service like
  // bpmn-js's does, even though it lives outside the canvas.
  //
  // What made that impossible before was the gesture, not the location: the
  // sidebar dragged with the HTML5 drag-and-drop API, and during a native drag
  // the browser fires `dragover`/`drop` and **no** `mousemove`/`mouseup` — the
  // events diagram-js's `Dragging` listens on. So the drop had to be caught here
  // and its client coordinates translated through the viewbox by hand, with no
  // preview and no snapping, and no browser test could drive it.
  //
  // `palette-panel` now starts the gesture from `mousedown` (and `click`, for
  // click-to-place) and hands the raw event over. `Dragging.init` binds
  // `mousemove`/`mouseup` on `document`, so a press that begins in the sidebar is
  // tracked all the way onto the canvas; diagram-js computes the drop position,
  // shows the preview, applies snapping, and mints the RDF element inside the
  // resulting `shape.create` command. A release that lands outside the canvas
  // finds no hover target and cancels, which is the right answer.
  const onPaletteDragStart = (e: Event): void => {
    const detail = (e as CustomEvent<PaletteDragDetail>).detail;
    if (!detail?.iri) return;

    if (detail.kind === 'relationship') {
      // A relationship type is not a shape, so there is nothing to drag onto the
      // canvas. Picking one arms the connect tool with that type preselected, so
      // the next source→target pair gets the type the user asked for rather than
      // the metamodel's top-ranked guess. See
      // `DiagramCanvas.setPreferredRelationshipType`.
      diagramCanvas.setPreferredRelationshipType(detail.iri);
      diagramCanvas.activateTool('connect', detail.sourceEvent);
      return;
    }

    diagramCanvas.startCreate(detail.iri, detail.sourceEvent);
  };
  palettePanel.addEventListener('palette-drag-start', onPaletteDragStart);

  // ── Toolbar → diagram-js tool services ───────────────────────────────
  // Picking a tool by hand clears any preselected relationship type: the user is
  // asking for the metamodel's own ranking again, not for the type they last
  // clicked in the sidebar.
  const onToolbarTool = (e: Event): void => {
    const detail = (e as CustomEvent<ToolbarToolDetail>).detail;
    if (!detail?.tool) return;
    diagramCanvas.setPreferredRelationshipType(undefined);
    diagramCanvas.activateTool(detail.tool, detail.sourceEvent);
  };
  canvasToolbar.addEventListener('toolbar-tool', onToolbarTool);

  // ── EventBus → panel state ───────────────────────────────────────────
  const refreshGraphs = (): void => {
    const shapes = readShapesGraph();
    propertyPanel.shapesGraph = shapes;
    validationPanel.shapesGraph = shapes;
    validationPanel.dataGraph = store.getQuads();
  };

  const onValidationUpdated: ModelEventHandler = (event) => {
    const detail = event.detail as
      | { conforms?: boolean; results?: ValidationResult[] }
      | undefined;
    validationPanel.conforms = detail?.conforms ?? true;
    validationPanel.results = detail?.results ?? [];
  };

  // ── Palette generation ───────────────────────────────────────────────
  // The metamodel IRI and the chosen grouping axis are kept so the palette can
  // be regenerated when the user switches axis without reloading anything.
  let currentMetamodelIri: string | undefined;
  let currentAxisIri: string | undefined;

  const regeneratePalette = (): void => {
    const palette = paletteGenerator.generatePalette(currentMetamodelIri, {
      axisIri: currentAxisIri,
    });
    // The active axis may differ from the requested one when the metamodel does
    // not publish it; follow what the generator actually used.
    currentAxisIri = palette.activeAxisIri;
    currentPalette = palette;
    palettePanel.palette = palette;
    diagramCanvas.updatePaletteDefinition(palette);
  };

  const onMetamodelLoaded: ModelEventHandler = (event) => {
    // The class hierarchy has just arrived, so the closure index is stale.
    classClosure = buildClassClosure(store);
    const metamodelIri = event.detail?.metamodelIri as string | undefined;
    if (metamodelIri) {
      currentMetamodelIri = metamodelIri;
      regeneratePalette();
    }
    refreshGraphs();
  };

  // The palette panel's "Group by" selector asks for a different axis.
  const onAxisChange = (e: Event): void => {
    const detail = (e as CustomEvent<PaletteAxisChangeDetail>).detail;
    currentAxisIri = detail.axisIri;
    regeneratePalette();
  };
  palettePanel.addEventListener('palette-axis-change', onAxisChange);

  const onModelChanged: ModelEventHandler = () => {
    refreshGraphs();
  };

  eventBus.on('validation-updated', onValidationUpdated);
  eventBus.on('metamodel-loaded', onMetamodelLoaded);
  eventBus.on('model-loaded', onModelChanged);

  // ── Centre view switching ────────────────────────────────────────────
  let active: CanvasViewKind = 'diagram';
  const setActiveCanvasView = (kind: CanvasViewKind): void => {
    active = kind;
    canvasHost.hidden = kind !== 'diagram';
    catalogView.hidden = kind !== 'catalog';
    matrixView.hidden = kind !== 'matrix';
  };

  const dispose = (): void => {
    eventBus.off('validation-updated', onValidationUpdated);
    eventBus.off('metamodel-loaded', onMetamodelLoaded);
    eventBus.off('model-loaded', onModelChanged);
    palettePanel.removeEventListener('palette-axis-change', onAxisChange);
    palettePanel.removeEventListener('palette-drag-start', onPaletteDragStart);
    canvasToolbar.removeEventListener('toolbar-tool', onToolbarTool);
    modelExplorer.removeEventListener('explorer-select', onExplorerSelect);
    catalogView.removeEventListener('catalog-select', onCatalogSelect);
    validationPanel.removeEventListener('validation-navigate', onValidationNavigate);
    propertyPanel.removeEventListener('property-edit', onPropertyEdit);
    diagramCanvas.destroy();
    shell.remove();
  };

  return {
    shell,
    palettePanel,
    canvasToolbar,
    modelExplorer,
    propertyPanel,
    validationPanel,
    sparqlEditor,
    catalogView,
    matrixView,
    canvasHost,
    diagramCanvas,
    setActiveCanvasView,
    activeCanvasView: () => active,
    setPaletteAxis: (axisIri) => {
      currentAxisIri = axisIri;
      regeneratePalette();
    },
    dispose,
  };
}
