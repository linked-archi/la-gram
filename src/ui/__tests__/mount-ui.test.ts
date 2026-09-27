// @vitest-environment jsdom

/**
 * Tests for mountUi — the module that fills app-shell's five named slots.
 *
 * These cover the "blank screen" regression: without mounting, app-shell
 * renders empty slots and nothing is visible.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataFactory } from 'n3';
import type { NamedNode, Quad } from '@rdfjs/types';
import type {
  RdfStore,
  ShaclValidator,
  SparqlResult,
  TtlParser,
  TtlSerializer,
  ValidationReport,
  ValidationResult,
} from '../../rdf-engine/interfaces.js';
import type {
  LoadedMetamodel,
  MetamodelLoader,
  MetamodelInfo,
  PaletteDefinition,
  PaletteGenerator,
  ViewpointManager,
} from '../../metamodel-manager/interfaces.js';
import type {
  Bounds,
  ElementManager,
  RelationshipManager,
  ViewInfo,
  ViewManager,
} from '../../model-manager/interfaces.js';
import type { PlatformService } from '../../platform/interfaces.js';
import { ModelOperations } from '../../model-manager/model-operations.js';
import { TtlFileIO } from '../../import-export/ttl-file-io.js';
import { EventBus } from '../event-bus.js';
import { App, type AppComponents } from '../../app.js';
import { mountUi, DEFAULT_MODEL_IRI, type MountedUi } from '../mount-ui.js';
import { RELATIONSHIP_REPLACE_MENU_ID } from '../canvas/rdf-replace-menu-provider.js';
import { installJsdomSvgSupport } from './jsdom-svg-support.js';

// mountUi constructs a real diagram-js Diagram for the canvas slot, which needs
// the SVG layout APIs jsdom does not implement.
installJsdomSvgSupport();

const { namedNode, quad } = DataFactory;

const SHAPES_GRAPH = 'urn:la-gram:shapes';

const SAMPLE_PALETTE: PaletteDefinition = {
  elementGroups: [
    {
      category: 'Business',
      elements: [{ iri: 'urn:t:Actor', label: 'Actor', isAbstract: false }],
    },
  ],
  relationshipTypes: [],
};

// ── Stubs ─────────────────────────────────────────────────────────────

function stubStore(seed: Quad[] = []): RdfStore {
  const quads: Quad[] = [...seed];
  return {
    addQuads: vi.fn((qs: Quad[]) => quads.push(...qs)),
    removeQuads: vi.fn(),
    getQuads: vi.fn(
      (s?: NamedNode | null, p?: NamedNode | null, o?: NamedNode | null, g?: NamedNode | null) =>
        quads.filter((q) => {
          if (s && q.subject.value !== s.value) return false;
          if (p && q.predicate.value !== p.value) return false;
          if (o && q.object.value !== o.value) return false;
          if (g && q.graph.value !== g.value) return false;
          return true;
        }),
    ),
    query: vi.fn((): SparqlResult => ({ type: 'bindings', results: [] })),
    update: vi.fn(),
  };
}

function buildComponents(overrides: Partial<AppComponents> = {}): AppComponents {
  const parser: TtlParser = { parse: vi.fn(() => ({ ok: true as const, quads: [] })) };
  const serializer: TtlSerializer = { serialize: vi.fn(() => '') };
  const store = overrides.store ?? stubStore();
  const platform: PlatformService = {
    readFile: vi.fn(async () => ({ content: '', name: 't.ttl' })),
    writeFile: vi.fn(async () => {}),
    showOpenDialog: vi.fn(async () => null),
    showSaveDialog: vi.fn(async () => null),
    isDesktop: vi.fn(() => false),
  };
  const validator: ShaclValidator = {
    validate: vi.fn((): ValidationReport => ({ conforms: true, results: [] })),
    validateIncremental: vi.fn((): ValidationReport => ({ conforms: true, results: [] })),
  };
  const metamodelInfo: MetamodelInfo = { iri: 'urn:mm', name: '', version: '', description: '' };
  const loadedMetamodel: LoadedMetamodel = {
    metamodelIri: 'urn:mm',
    manifestGraphIri: 'urn:mm',
    info: metamodelInfo,
    graphsByRole: {},
    assets: [],
  };
  const metamodelLoader: MetamodelLoader = {
    loadMetamodel: vi.fn(async (): Promise<MetamodelInfo> => metamodelInfo),
    loadMetamodelFromManifest: vi.fn(async (): Promise<LoadedMetamodel> => loadedMetamodel),
    loadBundledMetamodel: vi.fn(async (): Promise<LoadedMetamodel> => loadedMetamodel),
    loadShapes: vi.fn(async () => {}),
    resolveImports: vi.fn(async () => {}),
  };
  const paletteGenerator: PaletteGenerator = {
    generatePalette: vi.fn((): PaletteDefinition => SAMPLE_PALETTE),
    filterByViewpoint: vi.fn((p: PaletteDefinition) => p),
  };
  const viewpointManager: ViewpointManager = {
    getViewpoints: vi.fn(() => []),
    getPermittedTypes: vi.fn(() => ({ elements: [], relationships: [] })),
  };
  const elementManager: ElementManager = {
    createElement: vi.fn(
      (_t: string, m: string, _p: Bounds) => namedNode(`${m}/elem-1`) as unknown as NamedNode,
    ),
    updateProperty: vi.fn(),
    deleteElement: vi.fn(),
    updateLayout: vi.fn(),
  };
  const relationshipManager: RelationshipManager = {
    getValidRelationships: vi.fn(() => []),
    createRelationship: vi.fn(() => null),
    deleteRelationship: vi.fn(),
  };
  const viewManager: ViewManager = {
    createView: vi.fn(() => namedNode('urn:v') as unknown as NamedNode),
    getViews: vi.fn((): ViewInfo[] => []),
    getView: vi.fn(() => undefined),
    renameView: vi.fn(),
    setViewpoint: vi.fn(),
    deleteView: vi.fn(),
    collectViewQuads: vi.fn(() => []),
    duplicateView: vi.fn(() => namedNode('urn:v2') as unknown as NamedNode),
    addElementToView: vi.fn(() => 'urn:v/node/1'),
    removeElementFromView: vi.fn(),
    collectNodeQuads: vi.fn(() => []),
    getNodes: vi.fn(() => []),
    getNode: vi.fn(() => undefined),
    updateNodeBounds: vi.fn(),
    addRelationshipToView: vi.fn(() => undefined),
    removeRelationshipFromView: vi.fn(),
    collectLinkQuads: vi.fn(() => []),
    getLinks: vi.fn(() => []),
    updateLinkWaypoints: vi.fn(),
    viewsContaining: vi.fn(() => []),
  };

  return {
    platform,
    parser,
    serializer,
    store,
    validator,
    metamodelLoader,
    paletteGenerator,
    viewpointManager,
    elementManager,
    relationshipManager,
    viewManager,
    modelOperations: new ModelOperations(parser, serializer, store),
    ttlFileIO: new TtlFileIO(parser, serializer, store, platform),
    eventBus: overrides.eventBus ?? new EventBus(),
    ...overrides,
  };
}

/** Direct light-DOM children of the shell assigned to a given slot. */
function slotted(ui: MountedUi, slot: string): Element[] {
  return [...ui.shell.children].filter((el) => el.getAttribute('slot') === slot);
}

describe('mountUi', () => {
  let root: HTMLElement;
  let app: App;
  let ui: MountedUi;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    app = new App(buildComponents());
    ui = mountUi(app, root);
  });

  afterEach(() => {
    ui.dispose();
    root.remove();
  });

  describe('custom element registration', () => {
    it.each([
      'app-shell',
      'palette-panel',
      'property-panel',
      'model-explorer',
      'validation-panel',
      'sparql-editor',
      'catalog-view',
      'matrix-view',
    ])('registers <%s>', (tag) => {
      expect(customElements.get(tag)).toBeDefined();
    });
  });

  describe('slot assignment', () => {
    it('appends the shell to the root', () => {
      expect(ui.shell.parentElement).toBe(root);
      expect(root.querySelectorAll('app-shell')).toHaveLength(1);
    });

    it.each([
      ['explorer', 'MODEL-EXPLORER'],
      ['palette', 'PALETTE-PANEL'],
      ['properties', 'PROPERTY-PANEL'],
      ['validation', 'VALIDATION-PANEL'],
      ['sparql', 'SPARQL-EDITOR'],
      ['graph', 'GRAPH-PANEL'],
      ['rdf', 'RDF-PANEL'],
    ])('fills the %s slot with %s', (slot, tagName) => {
      const els = slotted(ui, slot);
      expect(els).toHaveLength(1);
      expect(els[0].tagName).toBe(tagName);
    });

    it('fills the canvas slot with the diagram host', () => {
      const els = slotted(ui, 'canvas');
      expect(els).toHaveLength(1);
      expect(els[0].contains(ui.canvasHost)).toBe(true);
    });

    it('puts the properties, validation and SPARQL editor in the bottom panel’s tabs', () => {
      expect(slotted(ui, 'properties')[0]).toBe(ui.propertyPanel);
      expect(slotted(ui, 'validation')[0]).toBe(ui.validationPanel);
      expect(slotted(ui, 'sparql')[0]).toBe(ui.sparqlEditor);
    });

    it('leaves no slot empty', () => {
      for (const slot of ['toolbar', 'explorer', 'canvas', 'properties', 'validation', 'sparql', 'graph', 'palette', 'rdf']) {
        expect(slotted(ui, slot).length).toBeGreaterThan(0);
      }
    });
  });

  describe('component wiring', () => {
    it('passes the App event bus to the shell', () => {
      expect(ui.shell.eventBus).toBe(app.components.eventBus);
    });

    it('gives the store to every store-backed panel', () => {
      const { store } = app.components;
      // The model tree reads a classified snapshot of the store, not raw quads.
      expect(ui.modelExplorer.contentsProvider).toBeTypeOf('function');
      expect(ui.propertyPanel.rdfStore).toBe(store);
      expect(ui.sparqlEditor.rdfStore).toBe(store);
      expect(ui.catalogView.rdfStore).toBe(store);
      expect(ui.matrixView.rdfStore).toBe(store);
    });

    it('gives the element manager to the catalog, and routes property edits through the App', () => {
      // The property panel emits edits instead of writing: the App tags text
      // with its language, which the Linked.Archi shapes require of labels.
      expect(ui.propertyPanel.elementManager).toBeUndefined();
      expect(ui.catalogView.elementManager).toBe(app.components.elementManager);
    });

    it('gives the validator to the validation panel', () => {
      expect(ui.validationPanel.validator).toBe(app.components.validator);
    });

    it('initializes the diagram canvas on the canvas host', () => {
      expect(ui.diagramCanvas.isInitialized()).toBe(true);
      expect(ui.diagramCanvas.getContainer()).toBe(ui.canvasHost);
    });
  });

  describe('event routing', () => {
    it('pushes validation-updated results into the validation panel', () => {
      const result: ValidationResult = {
        focusNode: namedNode('urn:e:1') as unknown as NamedNode,
        resultPath: namedNode('urn:p:1') as unknown as NamedNode,
        sourceShape: namedNode('urn:s:1') as unknown as NamedNode,
        message: 'boom',
        severity: 'Violation',
      };

      app.components.eventBus.emit('validation-updated', {
        conforms: false,
        resultCount: 1,
        results: [result],
      });

      expect(ui.validationPanel.conforms).toBe(false);
      expect(ui.validationPanel.results).toEqual([result]);
    });

    it('regenerates the palette when a metamodel is loaded', () => {
      expect(ui.palettePanel.palette.elementGroups).toHaveLength(0);

      app.components.eventBus.emit('metamodel-loaded', { metamodelIri: 'urn:mm' });

      expect(app.components.paletteGenerator.generatePalette).toHaveBeenCalledWith('urn:mm', {
        axisIri: undefined,
      });
      expect(ui.palettePanel.palette).toEqual(SAMPLE_PALETTE);
    });

    it('regroups the palette when the panel asks for another axis', () => {
      app.components.eventBus.emit('metamodel-loaded', { metamodelIri: 'urn:mm' });

      ui.palettePanel.dispatchEvent(
        new CustomEvent('palette-axis-change', {
          detail: { axisIri: 'urn:axis:aspect' },
          bubbles: true,
          composed: true,
        }),
      );

      expect(app.components.paletteGenerator.generatePalette).toHaveBeenLastCalledWith('urn:mm', {
        axisIri: 'urn:axis:aspect',
      });
    });

    it('regroups the palette through setPaletteAxis', () => {
      app.components.eventBus.emit('metamodel-loaded', { metamodelIri: 'urn:mm' });

      ui.setPaletteAxis('urn:axis:domain');

      expect(app.components.paletteGenerator.generatePalette).toHaveBeenLastCalledWith('urn:mm', {
        axisIri: 'urn:axis:domain',
      });
    });

    it('routes an explorer selection to the property panel', () => {
      const seen: string[] = [];
      app.components.eventBus.on('selection-changed', (e) => {
        seen.push(e.detail?.iri as string);
      });

      ui.modelExplorer.dispatchEvent(
        new CustomEvent('explorer-select', { detail: { iri: 'urn:e:42' } }),
      );

      expect(ui.propertyPanel.selectedIri).toBe('urn:e:42');
      expect(seen).toContain('urn:e:42');
    });

    it('translates a property-panel edit into a property-edited bus event', () => {
      ui.propertyPanel.dispatchEvent(
        new CustomEvent('property-edit', {
          detail: { elementIri: 'urn:e:1', predicate: 'urn:p:label', value: 'Hello' },
        }),
      );

      expect(app.components.elementManager.updateProperty).toHaveBeenCalledWith(
        'urn:e:1',
        'urn:p:label',
        expect.objectContaining({ value: 'Hello' }),
      );
    });

    /**
     * Pressing on a sidebar entry hands the gesture to diagram-js's `create`
     * rather than writing triples, which is the whole point of dropping the HTML5
     * drag-and-drop path: the drag gets a preview, snapping and a drop position
     * from diagram-js, and the element is minted inside the `shape.create`
     * command. `dragging` is put in manual mode so the armed drag can be
     * inspected without a real pointer.
     */
    const armedDrag = (): { prefix?: string } | null => {
      const diagram = ui.diagramCanvas.getDiagram()!;
      return (
        diagram as unknown as { get(n: string): { context(): { prefix?: string } | null } }
      )
        .get('dragging')
        .context();
    };

    const manualDragging = (): void => {
      const diagram = ui.diagramCanvas.getDiagram()!;
      (diagram as unknown as { get(n: string): { setOptions(o: unknown): void } })
        .get('dragging')
        .setOptions({ manual: true });
    };

    it('starts a diagram-js create drag when a sidebar entry is pressed', () => {
      manualDragging();

      ui.palettePanel.dispatchEvent(
        new CustomEvent('palette-drag-start', {
          detail: {
            iri: 'urn:t:Actor',
            label: 'Actor',
            kind: 'element',
            sourceEvent: new MouseEvent('mousedown', { clientX: 40, clientY: 55, button: 0 }),
          },
        }),
      );

      expect(armedDrag()?.prefix).toBe('create');
      // Nothing is written until the drop.
      expect(app.components.elementManager.createElement).not.toHaveBeenCalled();
    });

    it('arms the connect tool with the type when a relationship entry is picked', () => {
      manualDragging();

      ui.palettePanel.dispatchEvent(
        new CustomEvent('palette-drag-start', {
          detail: {
            iri: 'urn:t:Serving',
            label: 'Serving',
            kind: 'relationship',
            sourceEvent: new MouseEvent('click', { clientX: 5, clientY: 5, button: 0 }),
          },
        }),
      );

      // A relationship is not a shape, so there is nothing to create — the type
      // is remembered and the connect tool takes over.
      expect(ui.diagramCanvas.preferredRelationshipType()).toBe('urn:t:Serving');
      expect(armedDrag()?.prefix).toBe('global-connect');
    });

    it('ignores an entry that names no type', () => {
      manualDragging();

      ui.palettePanel.dispatchEvent(
        new CustomEvent('palette-drag-start', {
          detail: { iri: '', label: '', kind: 'element', sourceEvent: new MouseEvent('mousedown') },
        }),
      );

      // `Dragging.context()` reports `undefined` when nothing is armed.
      expect(armedDrag()).toBeFalsy();
      expect(app.components.elementManager.createElement).not.toHaveBeenCalled();
    });

    it('activates a tool from the toolbar, and clears any preselected type', () => {
      manualDragging();
      ui.diagramCanvas.setPreferredRelationshipType('urn:t:Serving');

      ui.canvasToolbar.dispatchEvent(
        new CustomEvent('toolbar-tool', {
          detail: { tool: 'hand', sourceEvent: new MouseEvent('click', { button: 0 }) },
        }),
      );

      expect(armedDrag()?.prefix).toBe('hand');
      // Picking a tool by hand means "use the metamodel's own ranking again".
      expect(ui.diagramCanvas.preferredRelationshipType()).toBeUndefined();
    });

    it('shows the armed tool on the toolbar, and stops showing it when dropped', () => {
      manualDragging();
      const diagram = ui.diagramCanvas.getDiagram()!;
      const dragging = (
        diagram as unknown as { get(n: string): { cancel(): void } }
      ).get('dragging');

      ui.canvasToolbar.dispatchEvent(
        new CustomEvent('toolbar-tool', {
          detail: { tool: 'lasso', sourceEvent: new MouseEvent('click', { button: 0 }) },
        }),
      );
      expect(ui.canvasToolbar.activeTool).toBe('lasso');

      dragging.cancel();
      expect(ui.canvasToolbar.activeTool).toBeUndefined();
    });
  });

  describe('canvas view switching', () => {
    it('shows the diagram by default', () => {
      expect(ui.activeCanvasView()).toBe('diagram');
      expect(ui.canvasHost.hidden).toBe(false);
      expect(ui.catalogView.hidden).toBe(true);
      expect(ui.matrixView.hidden).toBe(true);
    });

    it.each(['catalog', 'matrix'] as const)('switches to the %s view', (kind) => {
      ui.setActiveCanvasView(kind);

      expect(ui.activeCanvasView()).toBe(kind);
      expect(ui.canvasHost.hidden).toBe(true);
      expect(ui.catalogView.hidden).toBe(kind !== 'catalog');
      expect(ui.matrixView.hidden).toBe(kind !== 'matrix');
    });
  });

  describe('relationship drawing', () => {
    it('registers the relationship-replace popup menu on the canvas diagram', () => {
      // Retyping is diagram-js's own affair now: the provider lives on the
      // `popupMenu` service, so `mountUi` has nothing left to wire for it.
      const diagram = ui.diagramCanvas.getDiagram()!;
      const popupMenu = (
        diagram as unknown as {
          get(name: string): { isEmpty(target: unknown, providerId: string): boolean };
        }
      ).get('popupMenu');

      expect(ui.diagramCanvas.replaceMenuProvider).toBeDefined();
      // No relationship types in the empty starting palette, so nothing to offer
      // — but the provider is registered, which is what `isEmpty` returning
      // without throwing "provider not found" shows.
      expect(popupMenu.isEmpty({ id: 'nothing' }, RELATIONSHIP_REPLACE_MENU_ID)).toBe(true);
    });

    it('binds diagram-js keyboard handling, so undo has a key', () => {
      const diagram = ui.diagramCanvas.getDiagram()!;
      const keyboard = (
        diagram as unknown as { get(name: string): { getBinding(): EventTarget | null } }
      ).get('keyboard');
      const editorActions = (
        diagram as unknown as { get(name: string): { getActions(): string[] } }
      ).get('editorActions');

      expect(keyboard.getBinding()).toBe(document);
      expect(editorActions.getActions()).toEqual(expect.arrayContaining(['undo', 'redo']));
    });

    it('gives the canvas a relationship manager that falls back to the palette', () => {
      // The App's manager reports nothing (it queries the default graph, while
      // the metamodel is loaded into named graphs), so without the fallback the
      // rule provider would refuse every connection.
      expect(app.components.relationshipManager.getValidRelationships('a', 'b')).toEqual([]);

      app.components.eventBus.emit('metamodel-loaded', { metamodelIri: 'urn:mm' });
      ui.palettePanel.palette = SAMPLE_PALETTE;

      // SAMPLE_PALETTE declares no relationship types, so there is still nothing
      // to offer — but the canvas asked the wrapper, not the bare manager.
      expect(ui.diagramCanvas.relationshipCandidates('urn:t:Actor', 'urn:t:Actor')).toEqual([]);
    });

    it('puts the global tools in a toolbar above the diagram, not in the canvas', () => {
      // diagram-js's own palette is not registered at all — its entries would be
      // the element types the sidebar already lists.
      const diagram = ui.diagramCanvas.getDiagram()!;
      expect(() =>
        (diagram as unknown as { get(n: string): unknown }).get('palette'),
      ).toThrow();

      expect(ui.canvasToolbar).toBeDefined();
      // Mounted ahead of the diagram host, inside the canvas slot.
      const area = ui.canvasHost.parentElement!;
      expect(Array.from(area.children).indexOf(ui.canvasToolbar)).toBe(0);
      expect(Array.from(area.children).indexOf(ui.canvasHost)).toBe(1);
    });
  });

  describe('shapes graph propagation', () => {
    it('reads the shapes named graph for the property and validation panels', () => {
      const shapeQuad = quad(
        namedNode('urn:shape:1'),
        namedNode('http://www.w3.org/ns/shacl#targetClass'),
        namedNode('urn:t:Actor'),
        namedNode(SHAPES_GRAPH),
      ) as unknown as Quad;

      const store = stubStore([shapeQuad]);
      const scopedApp = new App(buildComponents({ store }));
      const scopedUi = mountUi(scopedApp, root);

      expect(scopedUi.propertyPanel.shapesGraph).toEqual([shapeQuad]);
      expect(scopedUi.validationPanel.shapesGraph).toEqual([shapeQuad]);

      scopedUi.dispose();
    });
  });

  describe('dispose', () => {
    it('removes the shell and stops listening to the bus', () => {
      const { eventBus } = app.components;
      ui.dispose();

      expect(ui.shell.parentElement).toBeNull();
      expect(eventBus.listenerCount('validation-updated')).toBe(0);
      expect(eventBus.listenerCount('metamodel-loaded')).toBe(1); // App's own listener
    });
  });
});
