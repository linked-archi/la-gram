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
import './panels/property-panel.js';
import './panels/model-explorer.js';
import './panels/validation-panel.js';
import './panels/sparql-editor.js';
import './views/catalog-view.js';
import './views/matrix-view.js';

import type { AppShell } from './app-shell.js';
import type { PalettePanel, PaletteDragDetail } from './panels/palette-panel.js';
import type { PropertyPanel, PropertyEditDetail } from './panels/property-panel.js';
import type { ModelExplorer, ExplorerSelectDetail } from './panels/model-explorer.js';
import type { ValidationPanel, ValidationNavigateDetail } from './panels/validation-panel.js';
import type { SparqlEditor } from './panels/sparql-editor.js';
import type { CatalogView, CatalogSelectDetail } from './views/catalog-view.js';
import type { MatrixView } from './views/matrix-view.js';

// The diagram canvas is a plain class, not a custom element: it takes a host
// DOM node in its constructor and manages that subtree itself.
import { DiagramCanvas } from './canvas/diagram-canvas.js';

const { namedNode } = DataFactory;

/** Named graph holding SHACL shapes (mirrors N3MetamodelLoader). */
const SHAPES_GRAPH_IRI = 'urn:la-gram:shapes';

/** Model IRI used for elements dropped onto the canvas before a model is loaded. */
export const DEFAULT_MODEL_IRI = 'urn:la-gram:model-1';

/** Default bounds for an element created by dropping a palette entry. */
const DROPPED_ELEMENT_SIZE = { width: 130, height: 60 };

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

  const canvasHost = document.createElement('div');
  canvasHost.className = 'la-diagram-host';

  const catalogView = document.createElement('catalog-view');
  catalogView.rdfStore = store;
  catalogView.elementManager = elementManager;
  catalogView.hidden = true;

  const matrixView = document.createElement('matrix-view');
  matrixView.rdfStore = store;
  matrixView.hidden = true;

  canvasArea.append(canvasHost, catalogView, matrixView);

  const diagramCanvas = new DiagramCanvas({
    container: canvasHost,
    eventBus,
    elementManager,
    relationshipManager,
    paletteDefinition: emptyPalette(),
    modelIri: DEFAULT_MODEL_IRI,
  });

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

  // ── Palette drag → drop on the canvas creates an element ─────────────
  const onDragOver = (e: DragEvent): void => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };

  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    const raw = e.dataTransfer?.getData('application/json');
    if (!raw) return;

    let detail: PaletteDragDetail;
    try {
      detail = JSON.parse(raw) as PaletteDragDetail;
    } catch {
      return;
    }
    if (detail.kind !== 'element' || !detail.iri) return;

    const rect = canvasHost.getBoundingClientRect();
    eventBus.emit('palette-drag', {
      typeIri: detail.iri,
      modelIri: DEFAULT_MODEL_IRI,
      x: Math.max(0, Math.round(e.clientX - rect.left)),
      y: Math.max(0, Math.round(e.clientY - rect.top)),
      ...DROPPED_ELEMENT_SIZE,
    });
  };

  canvasHost.addEventListener('dragover', onDragOver);
  canvasHost.addEventListener('drop', onDrop);

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

  const onMetamodelLoaded: ModelEventHandler = (event) => {
    const metamodelIri = event.detail?.metamodelIri as string | undefined;
    if (metamodelIri) {
      const palette = paletteGenerator.generatePalette(metamodelIri);
      palettePanel.palette = palette;
      diagramCanvas.updatePaletteDefinition(palette);
    }
    refreshGraphs();
  };

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
    modelExplorer.removeEventListener('explorer-select', onExplorerSelect);
    catalogView.removeEventListener('catalog-select', onCatalogSelect);
    validationPanel.removeEventListener('validation-navigate', onValidationNavigate);
    propertyPanel.removeEventListener('property-edit', onPropertyEdit);
    canvasHost.removeEventListener('dragover', onDragOver);
    canvasHost.removeEventListener('drop', onDrop);
    diagramCanvas.destroy();
    shell.remove();
  };

  return {
    shell,
    palettePanel,
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
    dispose,
  };
}
