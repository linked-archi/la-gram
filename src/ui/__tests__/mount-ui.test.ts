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
  const metamodelLoader: MetamodelLoader = {
    loadMetamodel: vi.fn(
      async (): Promise<MetamodelInfo> => ({ iri: 'urn:mm', name: '', version: '', description: '' }),
    ),
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
    addElementToView: vi.fn(),
    removeElementFromView: vi.fn(),
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
      ['palette', 'PALETTE-PANEL'],
      ['explorer', 'MODEL-EXPLORER'],
      ['property-panel', 'PROPERTY-PANEL'],
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

    it('fills the validation slot with the validation panel and SPARQL editor', () => {
      const els = slotted(ui, 'validation');
      expect(els).toHaveLength(1);
      expect(els[0].contains(ui.validationPanel)).toBe(true);
      expect(els[0].contains(ui.sparqlEditor)).toBe(true);
    });

    it('leaves no slot empty', () => {
      for (const slot of ['palette', 'explorer', 'property-panel', 'canvas', 'validation']) {
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
      expect(ui.modelExplorer.rdfStore).toBe(store);
      expect(ui.propertyPanel.rdfStore).toBe(store);
      expect(ui.sparqlEditor.rdfStore).toBe(store);
      expect(ui.catalogView.rdfStore).toBe(store);
      expect(ui.matrixView.rdfStore).toBe(store);
    });

    it('gives the element manager to the editing panels', () => {
      expect(ui.propertyPanel.elementManager).toBe(app.components.elementManager);
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

      expect(app.components.paletteGenerator.generatePalette).toHaveBeenCalledWith('urn:mm');
      expect(ui.palettePanel.palette).toEqual(SAMPLE_PALETTE);
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

    it('creates an element when a palette entry is dropped on the canvas', () => {
      const data = new Map<string, string>([
        ['application/json', JSON.stringify({ iri: 'urn:t:Actor', label: 'Actor', kind: 'element' })],
      ]);
      const drop = new Event('drop', { bubbles: true }) as DragEvent;
      Object.defineProperty(drop, 'dataTransfer', {
        value: { getData: (t: string) => data.get(t) ?? '' },
      });
      Object.defineProperty(drop, 'clientX', { value: 40 });
      Object.defineProperty(drop, 'clientY', { value: 55 });

      ui.canvasHost.dispatchEvent(drop);

      expect(app.components.elementManager.createElement).toHaveBeenCalledWith(
        'urn:t:Actor',
        DEFAULT_MODEL_IRI,
        expect.objectContaining({ width: 130, height: 60 }),
      );
    });

    it('ignores a drop that carries no palette payload', () => {
      const drop = new Event('drop', { bubbles: true }) as DragEvent;
      Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => '' } });

      ui.canvasHost.dispatchEvent(drop);

      expect(app.components.elementManager.createElement).not.toHaveBeenCalled();
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
